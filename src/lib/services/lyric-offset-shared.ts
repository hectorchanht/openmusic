// lyric-offset-shared — client side of shared lyric time offsets (quick-260926-mzn). Never-throw,
// sentinel returns (the deezer.ts posture): any failure means "no shared offset", never an error in
// the render tree. The consensus rule itself lives server-side in $lib/proxy/lyric-offset.

import { apiFetch } from '$lib/services/api-base';
import { normalizeLyricOffset } from '$lib/services/lrc';

/**
 * The fingerprint key: first 32 hex of SHA-256(`${uid}\n${lrc}`), where `lrc` is the EXACT
 * `readLyrics()` string (pre script-lock, pre parse). A different lyrics pick or a re-tagged file
 * gets its own consensus, so it never inherits an alignment made for other timestamps.
 *
 * Null when `crypto.subtle` is missing: it is undefined on a non-secure origin (a phone hitting the
 * dev server over LAN `http://`), and "no shared offset" is the correct degradation there.
 */
export async function lyricOffsetKey(uid: string, lrc: string): Promise<string | null> {
	if (!uid || !lrc || typeof crypto === 'undefined' || !crypto.subtle) return null;
	try {
		const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${uid}\n${lrc}`));
		return Array.from(new Uint8Array(buf).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
	} catch {
		return null;
	}
}

/**
 * The consensus offset for `k`, or null. The query string is EXACTLY `?k=<k>`: the server busts its
 * edge cache after a vote by rebuilding that URL. Normalized on read (T-mis-01 parity). Under vite
 * dev the route answers 503, which counts toward the apiFetch circuit breaker — harmless at one call
 * per track.
 */
export async function fetchSharedOffset(k: string, signal?: AbortSignal): Promise<number | null> {
	try {
		const res = await apiFetch(`/api/lyric-offset?k=${k}`, { signal });
		if (!res.ok) return null;
		const body = (await res.json()) as { offset?: unknown } | null;
		return typeof body?.offset === 'number' ? normalizeLyricOffset(body.offset) : null;
	} catch {
		return null;
	}
}

/**
 * Submit one vote. The `content-type` header is REQUIRED: Cloudflare 403s a JSON POST without it,
 * upstream of the app (the 33-07 curl lesson). Every failure is swallowed.
 */
export async function submitOffsetVote(k: string, offset: number): Promise<void> {
	try {
		await apiFetch('/api/lyric-offset', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ k, offset: normalizeLyricOffset(offset) })
		});
	} catch {
		// never-throw: a lost vote just means one fewer voice in the consensus
	}
}
