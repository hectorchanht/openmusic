// comments — pure helpers behind /api/comments (quick-260926-nsz): one public comment thread per
// SONG (not per source copy), stored in the existing DIAG R2 bucket.
//
// Same posture as lyric-offset.ts / diag-payload.ts: no I/O, no HTTP status knowledge, never-throw
// screens that return a sentinel. The route turns sentinels into 4xx.
//
// Moderation surface (the whole MVP): a per-IP post throttle, report-to-hide at HIDE_REPORTS
// distinct reporters, and a maintainer delete behind DIAG_READ_TOKEN. Posting is additionally gated
// by Cloudflare Turnstile in the route (see $lib/proxy/turnstile).

/**
 * A post body is `{"k","name","text","token"}`: the Turnstile token alone can be 2048 chars, the
 * text up to 280 code points (<= 1120 UTF-8 bytes), the name <= 96 bytes. 4 KiB covers the worst
 * case with slack and is still screened before any parse.
 */
export const MAX_COMMENT_BODY_BYTES = 4096;
/** Newest comments kept per thread — bounds the record and the parse the route does per request. */
export const MAX_ITEMS = 100;
/** Distinct reporters that hide a comment from the public list (the maintainer view still shows it). */
export const HIDE_REPORTS = 3;
export const NAME_MAX = 24;
export const TEXT_MAX = 280;
/** Cloudflare documents a Turnstile token as at most 2048 characters. */
export const TOKEN_MAX = 2048;
export const POST_MIN_GAP_MS = 30_000;
export const POST_DAILY_MAX = 30;
/** Edge-cache TTL of a public GET. A write busts the PoP it landed on; elsewhere it ages out. */
export const COMMENTS_TTL = 60;

export type Comment = { id: string; name: string; text: string; t: number; reporters: string[] };
export type ThreadRecord = { v: 1; items: Comment[] };
export type PublicComment = { id: string; name: string; text: string; t: number };
export type MaintainerComment = PublicComment & { reports: number; hidden: boolean };
export type Throttle = { last: number; day: string; n: number };
export type CommentBody =
	| { action: 'post'; k: string; name: string; text: string; token: string }
	| { action: 'report'; k: string; id: string };

/** The thread key the client computes (first 32 hex of SHA-256 of dedupe's songKey). */
export function isThreadKey(k: string | null): k is string {
	return !!k && /^[0-9a-f]{32}$/.test(k);
}

/**
 * The ONLY two R2 key builders for this feature. Callers pass a value that already passed
 * `isThreadKey` or came out of `voterId`, so the route can never reach `log/` (private listening
 * logs, read-token gated) or `lyric-offset/`, and it never enumerates the bucket.
 */
export function threadObjectKey(k: string): string {
	return `comments/${k}.json`;
}
export function throttleObjectKey(voter: string): string {
	return `comments-throttle/${voter}.json`;
}

// Name: an identity label, so everything invisible or direction-changing goes — C0 + DEL + C1,
// zero-width + LRM/RLM, line/para separators, bidi embeddings/overrides, the word-joiner block,
// bidi isolates and the BOM. "admin\u202E…" RTL-override spoofing and an invisible-suffix copy of
// someone else's name are exactly the impersonation tricks T-nsz-06 is about.
const NAME_STRIP = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
// Text: C0 except \n, DEL + C1, and the same bidi override/isolate set as the name (it closes the
// display-spoofing trick at the cost of one more char class). Zero-width and NBSP-like chars are
// LEFT in text: ZWJ/ZWNJ are load-bearing in emoji sequences and several scripts.
const TEXT_STRIP = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

const codePoints = (s: string) => [...s].length;

export function cleanName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const s = raw.normalize('NFC').replace(NAME_STRIP, '').replace(/\s+/g, ' ').trim();
	const n = codePoints(s);
	return n >= 1 && n <= NAME_MAX ? s : null;
}

/** Over TEXT_MAX is REJECTED, never truncated: a truncated comment silently changes what was said. */
export function cleanText(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const s = raw
		.normalize('NFC')
		.replace(/\r\n?/g, '\n')
		.replace(TEXT_STRIP, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	const n = codePoints(s);
	return n >= 1 && n <= TEXT_MAX ? s : null;
}

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
	!!x && typeof x === 'object' && !Array.isArray(x);

/** Lowercase, as `crypto.randomUUID()` emits. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isCommentId(id: unknown): id is string {
	return typeof id === 'string' && UUID_RE.test(id);
}

/** Never-throw. A post needs a clean name, clean text and a Turnstile token; a report needs an id. */
export function parseCommentBody(text: string): CommentBody | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isPlainObject(raw)) return null;
	const k = typeof raw.k === 'string' ? raw.k : null;
	if (!isThreadKey(k)) return null;
	if (raw.action === undefined || raw.action === 'post') {
		const name = cleanName(raw.name);
		const body = cleanText(raw.text);
		const token = raw.token;
		if (!name || !body || typeof token !== 'string' || !token || token.length > TOKEN_MAX) return null;
		return { action: 'post', k, name, text: body, token };
	}
	if (raw.action === 'report') return isCommentId(raw.id) ? { action: 'report', k, id: raw.id } : null;
	return null;
}

export function emptyThread(): ThreadRecord {
	return { v: 1, items: [] };
}

const isComment = (e: unknown): e is Comment =>
	isPlainObject(e) &&
	typeof e.id === 'string' &&
	typeof e.name === 'string' &&
	typeof e.text === 'string' &&
	typeof e.t === 'number' &&
	Number.isFinite(e.t) &&
	Array.isArray(e.reporters) &&
	e.reporters.every((r) => typeof r === 'string');

/** Never-throw. Anything not `{v:1, items:[...]}` is empty; bad items are dropped one by one. */
export function parseThread(text: string | null): ThreadRecord {
	let raw: unknown;
	try {
		raw = text ? JSON.parse(text) : null;
	} catch {
		return emptyThread();
	}
	if (!isPlainObject(raw) || raw.v !== 1 || !Array.isArray(raw.items)) return emptyThread();
	return {
		v: 1,
		items: raw.items
			.filter(isComment)
			.map((c) => ({ id: c.id, name: c.name, text: c.text, t: c.t, reporters: [...c.reporters] }))
	};
}

const newestFirst = <T extends { t: number }>(a: T, b: T) => b.t - a.t;

/** Pure: a NEW record with `c` added (reporters start empty), newest-first, capped to MAX_ITEMS. */
export function addComment(rec: ThreadRecord, c: Omit<Comment, 'reporters'>): ThreadRecord {
	const items = [{ ...c, reporters: [] }, ...rec.items].sort(newestFirst).slice(0, MAX_ITEMS);
	return { v: 1, items };
}

/** Null when `id` is unknown. Idempotent per voter: a repeat report changes nothing. */
export function addReport(rec: ThreadRecord, id: string, voter: string): ThreadRecord | null {
	if (!rec.items.some((c) => c.id === id)) return null;
	return {
		v: 1,
		items: rec.items.map((c) =>
			c.id === id && !c.reporters.includes(voter) ? { ...c, reporters: [...c.reporters, voter] } : c
		)
	};
}

export function removeComment(rec: ThreadRecord, id: string): ThreadRecord | null {
	if (!rec.items.some((c) => c.id === id)) return null;
	return { v: 1, items: rec.items.filter((c) => c.id !== id) };
}

/** The public view: hidden items dropped, and ONLY id/name/text/t — never the reporter hashes. */
export function publicItems(rec: ThreadRecord): PublicComment[] {
	return rec.items
		.filter((c) => c.reporters.length < HIDE_REPORTS)
		.sort(newestFirst)
		.map(({ id, name, text, t }) => ({ id, name, text, t }));
}

/** The maintainer view: everything, with a report COUNT and hidden flag — still never the hashes. */
export function maintainerItems(rec: ThreadRecord): MaintainerComment[] {
	return [...rec.items].sort(newestFirst).map(({ id, name, text, t, reporters }) => ({
		id,
		name,
		text,
		t,
		reports: reporters.length,
		hidden: reporters.length >= HIDE_REPORTS
	}));
}

export function parseThrottle(text: string | null): Throttle | null {
	let raw: unknown;
	try {
		raw = text ? JSON.parse(text) : null;
	} catch {
		return null;
	}
	if (!isPlainObject(raw)) return null;
	const { last, day, n } = raw;
	if (typeof last !== 'number' || !Number.isFinite(last)) return null;
	if (typeof day !== 'string') return null;
	if (typeof n !== 'number' || !Number.isFinite(n)) return null;
	return { last, day, n };
}

/** POST_MIN_GAP_MS between posts and POST_DAILY_MAX per UTC day, per address. */
export function checkThrottle(th: Throttle | null, now: number): { ok: true; next: Throttle } | { ok: false } {
	const day = new Date(now).toISOString().slice(0, 10);
	if (th && now - th.last < POST_MIN_GAP_MS) return { ok: false };
	if (th && th.day === day && th.n >= POST_DAILY_MAX) return { ok: false };
	return { ok: true, next: { last: now, day, n: th && th.day === day ? th.n + 1 : 1 } };
}

/**
 * First 16 hex of SHA-256(`ip|comments`). A GLOBAL salt (unlike lyric-offset's per-key one) BY
 * DESIGN: the throttle is per address across every song, so one address cannot spray every thread.
 * The raw IP is never stored or returned.
 *
 * Residual (T-nsz-09): SHA-256 over the IPv4 space is brute-forceable offline, so a leaked BUCKET
 * would de-anonymize reporters. The bucket is private and no hash ever leaves the edge. Upgrade
 * path: HMAC with a secret pepper.
 */
export async function voterId(ip: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|comments`));
	return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
