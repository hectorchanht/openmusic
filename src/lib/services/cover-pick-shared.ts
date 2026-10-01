// cover-pick-shared — client side of the crowd-shared cover pick (Phase 40 D-13 / D-15 / D-16).
// Never-throw, sentinel returns (the lyric-offset-shared posture): any failure means "no crowd pick",
// never an error in the render tree. The consensus rule lives server-side in $lib/proxy/cover-pick.

import { apiFetch } from '$lib/services/api-base';
import { matchKey } from '$lib/services/match-key';
import { isDeviceUid } from '$lib/services/device-track';
import { pickQuery } from '$lib/proxy/cover-pick';
import { safeImageUrl, COVER_PICK_IMAGE_HOSTS } from '$lib/proxy/safe-image-url';

/** `u` = exact-uid key, `n` = artist+title name key; either may be absent. */
export type CoverPickKeys = { u: string | null; n: string | null };

async function sha256hex32(s: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return Array.from(new Uint8Array(buf).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * D-13: the two lookup keys, each the first 32 hex of SHA-256 with a domain prefix (`u\n` / `n\n`)
 * so a uid and a match key with the same text never share a record. Only these hashes leave the
 * device. `u` is skipped for an empty or device: uid (a MediaStore row id means nothing to anyone
 * else); `n` is skipped when the match key is `'|'` (no artist, no title). Null when both are
 * skipped, or when `crypto.subtle` is missing (a non-secure LAN `http://` origin).
 */
export async function coverPickKeys(uid: string, artist: string, title: string): Promise<CoverPickKeys | null> {
	if (typeof crypto === 'undefined' || !crypto.subtle) return null;
	try {
		const mk = matchKey(artist, title);
		const u = uid && !isDeviceUid(uid) ? await sha256hex32(`u\n${uid}`) : null;
		const n = mk !== '|' ? await sha256hex32(`n\n${mk}`) : null;
		return u || n ? { u, n } : null;
	} catch {
		return null;
	}
}

/**
 * The crowd pick for each key, or null. The query comes from the server's own `pickQuery`, so the
 * post-vote cache bust rebuilds a byte-identical URL. Every url is re-screened with the vote host
 * allowlist before it can reach the cover cache (T-40-07-01, defense in depth). Under `pnpm dev`
 * without a DIAG binding the route answers 503, which counts toward the apiFetch circuit breaker —
 * harmless at one call per play.
 */
export async function fetchCoverPick(keys: CoverPickKeys, signal?: AbortSignal): Promise<CoverPickKeys | null> {
	try {
		const res = await apiFetch(`/api/cover-pick?${pickQuery(keys)}`, { signal });
		if (!res.ok) return null;
		const body = (await res.json()) as { u?: unknown; n?: unknown } | null;
		const screen = (x: unknown) => (typeof x === 'string' ? safeImageUrl(x, COVER_PICK_IMAGE_HOSTS) : null);
		return { u: screen(body?.u), n: screen(body?.n) };
	} catch {
		return null;
	}
}

/**
 * Cast one pick. The `content-type` header is REQUIRED: Cloudflare 403s a JSON POST without it,
 * upstream of the app. Null keys are omitted from the body. Every failure is swallowed.
 */
export async function submitCoverPick(keys: CoverPickKeys, url: string): Promise<void> {
	try {
		await apiFetch('/api/cover-pick', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...(keys.u ? { u: keys.u } : {}), ...(keys.n ? { n: keys.n } : {}), url })
		});
	} catch {
		// never-throw: a lost pick just means one fewer vote
	}
}
