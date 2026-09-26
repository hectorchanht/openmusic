// comments — client side of per-song comments (quick-260926-nsz). Never-throw, sentinel returns
// (the lyric-offset-shared.ts posture): any failure degrades to "unavailable", never an error in the
// render tree. Moderation, throttling and Turnstile verification live server-side in
// src/routes/api/comments/+server.ts.

import { apiFetch } from '$lib/services/api-base';
import { songKey } from '$lib/services/dedupe';
import { warmScript, t2sConvertLineSync } from '$lib/services/zh-convert';

export type CommentItem = { id: string; name: string; text: string; t: number };
export type CommentErr = 'slow-down' | 'invalid' | 'verify' | 'unavailable';

const HAN = /\p{Script=Han}/u;

/**
 * The thread key: first 32 hex of SHA-256(songKey(artist, title)) — dedupe's script-folded song
 * identity, so the qq / kuwo / netease / joox copies of one song and its Simplified vs Traditional
 * spellings all land in ONE thread.
 *
 * Deterministic-or-nothing. songKey folds Traditional→Simplified only when the t2s dict is warm and
 * otherwise keys the unfolded spelling. That is fine for dedupe (keys are compared within one call,
 * never persisted) but fatal here: this key IS persisted as the thread namespace, so a cold-dict key
 * would silently open a second thread for the same song. Hence the awaited warm + the null bail.
 *
 * Null when `crypto.subtle` is missing (a non-secure origin, e.g. a phone on the LAN dev server) —
 * comments are simply unavailable there, same degradation as lyricOffsetKey.
 */
export async function commentThreadKey(artist: string, title: string): Promise<string | null> {
	if (!title?.trim() || typeof crypto === 'undefined' || !crypto.subtle) return null;
	try {
		if (HAN.test(artist + title)) {
			await warmScript('zh-Hans');
			if (t2sConvertLineSync(title) === null) return null;
		}
		const s = songKey(artist, title);
		if (!s || !s.split('|')[0]) return null;
		const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
		return Array.from(new Uint8Array(buf).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
	} catch {
		return null;
	}
}

/** Defensive projection: a shape drift can never put `undefined` into the render tree. */
function projectItems(raw: unknown): CommentItem[] | null {
	if (!Array.isArray(raw)) return null;
	return raw
		.filter(
			(i): i is CommentItem =>
				!!i &&
				typeof i.id === 'string' &&
				typeof i.name === 'string' &&
				typeof i.text === 'string' &&
				typeof i.t === 'number' &&
				Number.isFinite(i.t)
		)
		.map(({ id, name, text, t }) => ({ id, name, text, t }));
}

/**
 * The public thread for `k`, or null (unavailable). The query string is EXACTLY `?k=<k>`: the
 * server busts its edge cache after a write by rebuilding that URL.
 */
export async function fetchComments(k: string, signal?: AbortSignal): Promise<CommentItem[] | null> {
	try {
		const res = await apiFetch(`/api/comments?k=${k}`, { signal });
		if (!res.ok) return null;
		const body = (await res.json()) as { ok?: unknown; items?: unknown } | null;
		return body?.ok === true ? projectItems(body.items) : null;
	} catch {
		return null;
	}
}

/**
 * Post one comment. `token` is the single-use Turnstile token from the widget. The `content-type`
 * header is REQUIRED: Cloudflare 403s a JSON POST without it, upstream of the app (the 33-07 curl
 * lesson), and the route refuses anything but application/json.
 */
export async function postComment(
	k: string,
	name: string,
	text: string,
	token: string
): Promise<{ ok: true; items: CommentItem[] } | { ok: false; err: CommentErr }> {
	try {
		const res = await apiFetch('/api/comments', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ k, name, text, token })
		});
		if (res.status === 429) return { ok: false, err: 'slow-down' };
		const body = (await res.json().catch(() => null)) as { ok?: unknown; err?: unknown; items?: unknown } | null;
		// 403 is either a failed Turnstile check (retryable with a fresh token) or a foreign origin.
		if (res.status === 403) return { ok: false, err: body?.err === 'turnstile' ? 'verify' : 'invalid' };
		if (res.status === 400 || res.status === 413 || res.status === 415) return { ok: false, err: 'invalid' };
		const items = res.ok && body?.ok === true ? projectItems(body.items) : null;
		return items ? { ok: true, items } : { ok: false, err: 'unavailable' };
	} catch {
		return { ok: false, err: 'unavailable' };
	}
}

/** Report one comment. Fire-and-forget at the call site: a lost report is one fewer voice. */
export async function reportComment(k: string, id: string): Promise<boolean> {
	try {
		const res = await apiFetch('/api/comments', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ k, id, action: 'report' })
		});
		return res.ok;
	} catch {
		return false;
	}
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
	['year', 365 * DAY],
	['month', 30 * DAY],
	['day', DAY],
	['hour', HOUR],
	['minute', MINUTE]
];

function formatter(lang: string): Intl.RelativeTimeFormat {
	try {
		return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
	} catch {
		// RangeError on an unknown tag — fall back rather than throw into the render tree.
		return new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	}
}

/**
 * "3 minutes ago" in `lang` — the largest whole unit, minutes (incl. 0 → "this minute") under an
 * hour. Native Intl, no date library, no ticking timer: the pane re-renders when its items change,
 * which is enough for this granularity. A future `t` (clock skew) reads as "this minute".
 */
export function relativeTime(t: number, now: number, lang: string): string {
	const d = Math.max(0, now - t);
	const [unit, ms] = UNITS.find(([, size]) => d >= size) ?? ['minute', MINUTE];
	return formatter(lang).format(-Math.floor(d / ms), unit);
}
