// Client helper for lyric / name translation. Calls /api/translate with in-memory +
// localStorage caching so switching tabs / re-opening a song doesn't refetch.
//
// CACHE-POISON (WR / debug:dashboard-liked-not-translated): during the /api/translate
// echo-mode bug the endpoint returned the ORIGINALS as a "successful" batch, and this
// helper persisted those originals as if they were final translations — so liked/library
// names viewed during the bug stayed Simplified forever (a cache HIT returned the cached
// original and never re-requested). Two-part hardening:
//   (a) the cache key carries a VERSION segment (CACHE_VER); bumping it abandons every
//       poisoned pre-version entry without asking the user to clear anything.
//   (b) /api/translate now reports a per-line `flags: boolean[]` (true = genuinely
//       translated, false = fell back to the original / echo). We only PERSIST a batch
//       when NO line fell back, so an echo no longer poisons the cache and the lines stay
//       eligible for a later retry. The strict out.length === lines.length contract that
//       every caller relies on is preserved.
import { browser } from '$app/environment';
import { apiFetch } from './api-base';

// Bump to abandon all previously-cached (possibly poisoned) lyrics translations.
// v2→v3 (D-02/D-04): zh-Hant output is now produced deterministically OFFLINE (client-side s2t),
// so any pre-version localStorage entry that was an API ECHO of Traditional must be abandoned.
// purgeStaleLyricsCache() already drops every non-current-version key, so the bump auto-purges.
const CACHE_VER = 'v3';

// TRANSIENT-RESILIENCE (WR / debug:lyric-tr-not-shown-hide-paren): a flaky upstream
// (Google timeout / rate-limit) makes /api/translate return the ORIGINALS as a fake
// HTTP-200 success (every line flags=false). Callers can't tell that from a real result,
// so the lyrics block silently renders untranslated originals ("translation shown
// nowhere") and — because an incomplete batch is never cached — it recurs every render of
// that session. We retry a request whose result is INCOMPLETE (some non-blank line fell
// back) a bounded number of times with short backoff so a single transient blip self-heals
// instead of becoming the final, silent answer. A genuinely-complete success, an off/empty
// pass-through, or a cache hit never retries.
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BASE_MS = 350;

const mem = new Map<string, string[]>();

// quick-261116-lyrux (Task 4) — LINE-LEVEL CACHE. Every layer above this one keyed on
// the exact lines ARRAY (NpLyrics' trCache includes the skip set; the batch key below
// hashes the joined lines; the server's KV key hashes the received array), so ANY
// change to a batch's composition — e.g. Hector un-skipping English after the Korean
// lines already translated — invalidated EVERYTHING and re-translated lines that were
// already paid for. This layer keys PER LINE (`openmusic:line-tr:<VER>:<to>:<hash>`),
// so a re-composed batch resolves its known lines here and only the genuinely-new
// lines reach the pipeline. Same poison rule as the batch cache: only GENUINELY
// translated lines (flag true) are ever stored — an echo can never enter. The key's
// hash is the same `hash()` the batch key uses (house consistency; the SERVER's line
// keys use SHA-256 because its batch keys already do). mem + localStorage, never-throw.
const lineMem = new Map<string, string>();
const lineKey = (line: string, to: string) => `openmusic:line-tr:${CACHE_VER}:${to}:${hash(line)}`;

function lineCacheGet(line: string, to: string): string | null {
	const k = lineKey(line, to);
	const m = lineMem.get(k);
	if (m) return m;
	if (browser) {
		try {
			const v = localStorage.getItem(k);
			if (v) {
				lineMem.set(k, v);
				return v;
			}
		} catch {
			/* ignore */
		}
	}
	return null;
}

function lineCacheSet(line: string, to: string, translated: string): void {
	if (!translated) return; // a genuine translation of a non-blank line is never empty
	const k = lineKey(line, to);
	lineMem.set(k, translated);
	if (browser) {
		try {
			localStorage.setItem(k, translated);
		} catch {
			/* quota */
		}
	}
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hash(s: string): string {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}

export interface TranslateResult {
	/** Positionally-aligned output (out.length === lines.length). Untranslated lines hold the original. */
	out: string[];
	/** Per-line: true if the server genuinely translated this line, false if it fell back to the original. */
	flags: boolean[];
	/** True if every non-empty line was genuinely translated (safe to persist). */
	complete: boolean;
}

// Drop every persisted lyrics translation from BEFORE the current cache version, so poisoned
// echo-era entries can't keep serving Simplified originals. Runs once (cheap; idempotent).
let lyricsPurged = false;
function purgeStaleLyricsCache() {
	if (!browser || lyricsPurged) return;
	lyricsPurged = true;
	try {
		const keys: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			// old (unversioned) keys look like `openmusic:lyrics-tr:<to>:<hash>`; current keys
			// carry the version: `openmusic:lyrics-tr:<VER>:<to>:<hash>`. The line-level
			// keys (quick-261116-lyrux) follow the same versioning and purge the same way.
			if (
				k &&
				((k.startsWith('openmusic:lyrics-tr:') && !k.startsWith(`openmusic:lyrics-tr:${CACHE_VER}:`)) ||
					(k.startsWith('openmusic:line-tr:') && !k.startsWith(`openmusic:line-tr:${CACHE_VER}:`)))
			)
				keys.push(k);
		}
		for (const k of keys) localStorage.removeItem(k);
	} catch {
		/* ignore */
	}
}

// One round-trip to /api/translate. Returns the aligned output + per-line flags + completeness,
// or `null` when the request itself threw (transport failure) so the caller can retry. A 200 that
// echoes the originals (transient upstream soft-fail) is NOT null — it returns with `complete:false`,
// which the retry loop also treats as transient.
async function requestOnce(lines: string[], to: string): Promise<TranslateResult | null> {
	try {
		const res = await apiFetch('/api/translate', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ lines, to })
		});
		const data = (await res.json()) as { translated?: unknown; flags?: unknown };
		const aligned = Array.isArray(data.translated) && data.translated.length === lines.length;
		const out = aligned ? (data.translated as unknown[]).map((x) => String(x)) : lines;
		const flags = aligned
			? lines.map((line, i) => {
					// Prefer the server's per-line signal; otherwise infer (output differs from input).
					if (Array.isArray(data.flags) && data.flags.length === lines.length) return Boolean(data.flags[i]);
					return out[i] !== line;
				})
			: lines.map(() => false);
		// A blank line is trivially "complete" (nothing to translate). Persist only when every
		// non-blank line was genuinely translated — otherwise an echo would poison the cache.
		const complete = aligned && lines.every((line, i) => !line || flags[i]);
		return { out, flags, complete };
	} catch {
		return null;
	}
}

/**
 * The API path: send `lines` to /api/translate, returning the aligned output + per-line flags.
 *
 * TRANSIENT-RESILIENCE: a request that throws OR returns an INCOMPLETE batch (a non-blank line
 * fell back — the signature of a flaky/rate-limited upstream) is retried up to MAX_TRANSIENT_RETRIES
 * times with short backoff, so one transient blip no longer becomes the silent final answer. The
 * BEST result across attempts (the most genuinely-translated lines) is returned, so a partial
 * recovery still surfaces what it could translate.
 */
async function runApiLoop(lines: string[], to: string): Promise<TranslateResult> {
	// Identity fallback used only if every attempt throws (transport failure on all tries).
	let best: TranslateResult = { out: lines, flags: lines.map(() => false), complete: false };
	const score = (r: TranslateResult) => r.flags.reduce((n, f) => n + (f ? 1 : 0), 0);
	for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
		const r = await requestOnce(lines, to);
		if (r) {
			if (r.complete) {
				best = r;
				break; // fully translated — nothing better to wait for
			}
			// Keep whichever attempt translated the most lines (partial recovery still surfaces).
			if (score(r) >= score(best)) best = r;
		}
		// Retry transient failures (threw → r===null) and incomplete soft-fails, with backoff.
		if (attempt < MAX_TRANSIENT_RETRIES) await sleep(RETRY_BASE_MS * (attempt + 1));
	}
	return best;
}

// zh-Hant OFFLINE ROUTING (D-02 / D-04). zh-Hans→zh-Hant is a deterministic char/phrase
// conversion, so Chinese-detected lines are converted CLIENT-SIDE (zero network, works offline /
// on lockscreen) and ONLY the genuinely non-Chinese lines are sent to the API cascade. The dict
// is pulled via a DYNAMIC import so the ~72 KB chunk stays out of the initial bundle AND out of
// every non-zh-Hant path. Never-throw: s2tConvertLines degrades to identity on any fault, and a
// failed dynamic import falls through to the full-API path so zh-Hant never hard-breaks
// (T-25b-03). D-04: isChineseLine rides the kana/hangul-first classifier, so a JA-kana line is
// NOT offline-converted — it lands in the API-bound subset like any other non-Chinese line.
// quick-260926-kvz: the dynamic import now also pulls the ~22 KB gzip t2s dict, because
// s2tConvertLines is the idempotent s2t↔t2s merge (already-Traditional input keeps its spelling).
async function resolveZhHant(lines: string[]): Promise<TranslateResult> {
	let mod: typeof import('./zh-convert');
	try {
		mod = await import('./zh-convert');
	} catch {
		// Offline converter unavailable (transient chunk-load failure) — degrade to the full-API
		// path for the whole batch so zh-Hant still resolves.
		return runApiLoop(lines, 'zh-Hant');
	}
	const { isChineseLine, s2tConvertLines } = mod;

	// Partition by index so results scatter back to their ORIGINAL positions (T-25b-01 — strict
	// positional alignment the callers depend on). Blank lines are trivially complete (nothing to
	// translate) — they belong to NEITHER bucket, so Chinese lyrics with blank separator lines
	// still make ZERO network calls.
	const chineseIdx: number[] = [];
	const apiIdx: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue; // blank: leave out[i]='' / flag false (non-blocking), no request
		if (isChineseLine(line)) chineseIdx.push(i);
		else apiIdx.push(i);
	}

	const out = lines.slice();
	const flags = lines.map(() => false);

	// Chinese subset → offline s2t. A converted Chinese line is a genuine zh-Hant translation, so
	// flag those positions true (already-Traditional input s2t-passes-through unchanged — still
	// correct Traditional, still genuinely translated for this target; T-25b-04 accepted)
	// (true since quick-260926-kvz: s2tConvertLines is the idempotent merge).
	if (chineseIdx.length) {
		const converted = await s2tConvertLines(chineseIdx.map((i) => lines[i]));
		chineseIdx.forEach((orig, j) => {
			out[orig] = converted[j];
			flags[orig] = true;
		});
	}

	// Non-Chinese subset → the EXISTING API retry/best-result loop, scattered back positionally.
	if (apiIdx.length) {
		const api = await runApiLoop(apiIdx.map((i) => lines[i]), 'zh-Hant');
		apiIdx.forEach((orig, j) => {
			out[orig] = api.out[j];
			flags[orig] = api.flags[j];
		});
		// Workers AI (m2m100) returns Simplified-leaning Chinese — normalize genuinely-translated
		// API output to Traditional via the offline converter (quick-261020-wai). Echoes/fallbacks
		// (flag false) are left untouched.
		const normIdx = apiIdx.filter((_, j) => api.flags[j]);
		if (normIdx.length) {
			const normalized = await s2tConvertLines(normIdx.map((i) => out[i]));
			normIdx.forEach((orig, j) => {
				out[orig] = normalized[j];
			});
		}
	}

	// Same completeness rule as the API path: every NON-BLANK line must be flagged. An incomplete
	// API remainder keeps complete=false (so it stays uncached/retryable) even though the offline
	// lines are correct.
	const complete = lines.every((line, i) => !line || flags[i]);
	return { out, flags, complete };
}

/**
 * quick-261116-lyrux (Task 4): resolve `lines` through the LINE-LEVEL cache first and
 * run the EXISTING pipeline (resolveZhHant / runApiLoop) over ONLY the misses, then
 * scatter positionally. This is what makes a lyricsSkip toggle cheap: the previously
 * translated lines are line-hits (flag true — only genuine translations are stored),
 * and the API sees just the newly-included lines.
 *
 * zh-Hant caution (deliberate): CHINESE lines are never line-cache-served and never
 * line-cache-stored. They resolve offline inside resolveZhHant, and serving a stored
 * Chinese conversion would bypass the kvz heal semantics (healZhHantBatch re-derives
 * Chinese positions of persisted output because the converter's answers improved
 * under the same CACHE_VER) — the offline path stays untouched, exactly as before.
 * If the converter can't even load, resolveZhHant degrades to the full-API path, so
 * every line is API-bound and the line cache applies to all of them — the
 * classification below mirrors that fallback.
 */
async function resolveWithLineCache(lines: string[], to: string): Promise<TranslateResult> {
	let isChinese: ((line: string) => boolean) | null = null;
	if (to === 'zh-Hant') {
		try {
			const mod = await import('./zh-convert');
			isChinese = mod.isChineseLine;
		} catch {
			isChinese = null; // converter unavailable → full-API degradation → all API-bound
		}
	}
	const apiBound = (line: string) => !isChinese || !isChinese(line);

	const out = lines.slice();
	const flags = lines.map(() => false);
	const missIdx: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue; // blank: trivially complete, never sent, never cached
		if (apiBound(line)) {
			const hit = lineCacheGet(line, to);
			if (hit !== null) {
				out[i] = hit;
				flags[i] = true;
				continue;
			}
		}
		missIdx.push(i);
	}
	if (missIdx.length) {
		const subLines = missIdx.map((i) => lines[i]);
		const sub = to === 'zh-Hant' ? await resolveZhHant(subLines) : await runApiLoop(subLines, to);
		missIdx.forEach((orig, j) => {
			out[orig] = sub.out[j];
			flags[orig] = sub.flags[j];
			// Persist ONLY genuinely-translated API-bound lines (see the zh-Hant caution
			// above) — an echo never enters the line cache.
			if (sub.flags[j] && apiBound(lines[orig])) lineCacheSet(lines[orig], to, sub.out[j]);
		});
	}
	// Completeness is layer-agnostic: every non-blank line genuine, from ANY layer.
	const complete = lines.every((line, i) => !line || flags[i]);
	return { out, flags, complete };
}

/**
 * Translate `lines` to `to`, returning aligned output + per-line genuine-translation flags.
 * Caches (mem + localStorage) only fully-translated batches so an echo/fallback never poisons
 * the cache — plus, since quick-261116-lyrux, a per-LINE cache underneath (see
 * resolveWithLineCache) so a re-composed batch only pays for its new lines.
 * `to === 'off'` or empty input is an identity pass-through (all flags false).
 *
 * D-02: `to === 'zh-Hant'` routes through `resolveZhHant` — Chinese lines convert offline (zero
 * network) and only the non-Chinese remainder hits the API. Every other target is byte-identical
 * to before (full `lines[]` → the API retry loop, no offline branch, no zh-convert import).
 */
export async function translateLinesEx(lines: string[], to: string): Promise<TranslateResult> {
	if (to === 'off' || !lines.length) return { out: lines, flags: lines.map(() => false), complete: false };
	purgeStaleLyricsCache();
	const key = `openmusic:lyrics-tr:${CACHE_VER}:${to}:${hash(lines.join('|'))}`;
	if (mem.has(key)) {
		const out = mem.get(key) as string[];
		return { out, flags: out.map(() => true), complete: true };
	}
	if (browser) {
		try {
			const c = localStorage.getItem(key);
			if (c) {
				let v = JSON.parse(c) as string[];
				if (to === 'zh-Hant') v = await healZhHantBatch(key, lines, v);
				mem.set(key, v);
				return { out: v, flags: v.map(() => true), complete: true };
			}
		} catch {
			/* ignore */
		}
	}

	// D-02 choke-point interception: offline-first for zh-Hant, unchanged API path otherwise.
	// quick-261116-lyrux (Task 4): the pipeline now runs behind the LINE-LEVEL cache —
	// known lines resolve per-line, only misses reach resolveZhHant / runApiLoop.
	const best = await resolveWithLineCache(lines, to);

	if (best.complete) {
		mem.set(key, best.out);
		if (browser) {
			try {
				localStorage.setItem(key, JSON.stringify(best.out));
			} catch {
				/* quota */
			}
		}
	}
	return best;
}

/**
 * quick-260926-kvz: re-derive the Chinese positions of a PERSISTED zh-Hant batch offline. Batches
 * cached before the s2t merge served an already-Traditional 杰 as 傑 (周杰倫 → 周傑倫) for as long
 * as the entry lived, and a cold names flush reading one could re-poison the name cache. Chinese
 * positions are deterministic offline results (resolveZhHant's s2t branch), so recomputing them
 * costs no network; non-Chinese positions came from the API and are kept untouched. That is why
 * CACHE_VER stays v3 — a bump would throw away those paid API lines. Writes back only on an
 * actual change. Never throws.
 *
 * Per line via warmScript + s2tConvertLineSync, NOT s2tConvertLines: the batch call answers
 * IDENTITY when s2t fails to load, which here would overwrite a good cached Traditional value with
 * the untranslated original. The sync call answers null instead, and a null keeps the cached value.
 */
async function healZhHantBatch(key: string, lines: string[], v: string[]): Promise<string[]> {
	if (!Array.isArray(v) || v.length !== lines.length) return v; // tampered / colliding entry
	let mod: typeof import('./zh-convert');
	try {
		mod = await import('./zh-convert');
	} catch {
		return v;
	}
	const { isChineseLine, s2tConvertLineSync, warmScript } = mod;
	const idx: number[] = [];
	for (let i = 0; i < lines.length; i++) if (lines[i] && isChineseLine(lines[i])) idx.push(i);
	if (!idx.length) return v;
	await warmScript('zh-Hant'); // never rejects; loads both dicts for the merge
	const healed = v.slice();
	let changed = false;
	for (const i of idx) {
		const fresh = s2tConvertLineSync(lines[i]);
		if (fresh !== null && fresh !== v[i]) {
			healed[i] = fresh;
			changed = true;
		}
	}
	if (!changed) return v;
	try {
		localStorage.setItem(key, JSON.stringify(healed));
	} catch {
		/* quota — still serve the healed batch this session (mem) */
	}
	return healed;
}

/**
 * Back-compat wrapper preserving the original `string[]` contract (out.length === lines.length).
 * Callers that need the per-line genuine-translation signal use `translateLinesEx`.
 */
export async function translateLines(lines: string[], to: string): Promise<string[]> {
	return (await translateLinesEx(lines, to)).out;
}
