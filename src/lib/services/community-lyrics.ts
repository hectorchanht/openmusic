// community-lyrics — client side of /api/lyrics (quick-261122-ugcb3, UGC lyrics B3). Never-throw,
// sentinel returns (the comments.ts posture): any failure degrades to "no community lyrics" /
// a typed error, never a throw into the render tree.
//
// Song identity is the comments thread key (commentThreadKey — first 32 hex of SHA-256 of dedupe's
// songKey, deterministic-or-null), so a song's community versions are shared across every source
// copy and both Chinese scripts, exactly like its comment thread.
//
// The `fetcher` parameter is the transport seam: the store passes auth.authedFetch (cookie on web,
// bearer on native) so a submit carries the session and a pin counts as the ACCOUNT's one vote.
// Tests pass a stub.

import { apiFetch } from '$lib/services/api-base';
import type { LyricCheckErr } from '$lib/proxy/community-lyrics';

export { commentThreadKey as lyricsSongKey } from '$lib/services/comments';

export type CommunityLyricClass = 'estimated' | 'precise' | 'plain';
export type CommunityVersion = { id: string; lrc: string; cls: CommunityLyricClass; t: number; pins: number };
export type SubmitErr = 'signin' | 'verify' | 'slow-down' | 'check' | 'invalid' | 'unavailable';
export type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

const CLASSES = new Set(['estimated', 'precise', 'plain']);

/** Defensive projection: a shape drift can never put `undefined` into the render tree. */
export function projectVersions(raw: unknown): CommunityVersion[] | null {
	if (!Array.isArray(raw)) return null;
	return raw
		.filter(
			(v): v is CommunityVersion =>
				!!v &&
				typeof v.id === 'string' &&
				typeof v.lrc === 'string' &&
				CLASSES.has(v.cls) &&
				typeof v.t === 'number' &&
				Number.isFinite(v.t) &&
				typeof v.pins === 'number' &&
				Number.isFinite(v.pins)
		)
		.map(({ id, lrc, cls, t, pins }) => ({ id, lrc, cls, t, pins }));
}

/**
 * A song's public versions, CANONICAL (most-pinned) FIRST, or null (unavailable). The query string
 * is EXACTLY `?k=<k>`: the server busts its edge cache after a write by rebuilding that URL.
 */
export async function fetchCommunityLyrics(
	k: string,
	signal?: AbortSignal,
	fetcher: Fetcher = apiFetch
): Promise<CommunityVersion[] | null> {
	try {
		const res = await fetcher(`/api/lyrics?k=${k}`, { signal });
		if (!res.ok) return null;
		const body = (await res.json()) as { ok?: unknown; versions?: unknown } | null;
		return body?.ok === true ? projectVersions(body.versions) : null;
	} catch {
		return null;
	}
}

export interface SubmitInput {
	k: string;
	lrc: string;
	estimated: boolean;
	title: string;
	artist: string;
	duration: number;
	token: string;
}

/** Submit one version. `token` is the single-use Turnstile token from TurnstileGate. */
export async function submitCommunityLyrics(
	fetcher: Fetcher,
	input: SubmitInput
): Promise<
	| { ok: true; id: string; lrc: string; versions: CommunityVersion[] }
	| { ok: false; err: SubmitErr; reason?: LyricCheckErr }
> {
	try {
		const res = await fetcher('/api/lyrics', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (res.status === 429) return { ok: false, err: 'slow-down' };
		if (res.status === 401) return { ok: false, err: 'signin' };
		const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
		if (res.status === 422) return { ok: false, err: 'check', reason: body?.reason as LyricCheckErr };
		if (res.status === 403) return { ok: false, err: body?.err === 'turnstile' ? 'verify' : 'invalid' };
		if (res.status === 400 || res.status === 413 || res.status === 415) return { ok: false, err: 'invalid' };
		const versions = res.ok && body?.ok === true ? projectVersions(body.versions) : null;
		if (!versions || typeof body?.id !== 'string' || typeof body?.lrc !== 'string') return { ok: false, err: 'unavailable' };
		return { ok: true, id: body.id, lrc: body.lrc, versions };
	} catch {
		return { ok: false, err: 'unavailable' };
	}
}

/** Pin (vote for) or report a version. Returns the fresh list, or null. Fire-and-forget at call sites. */
export async function voteCommunityLyrics(
	fetcher: Fetcher,
	k: string,
	id: string,
	action: 'pin' | 'report'
): Promise<CommunityVersion[] | null> {
	try {
		const res = await fetcher('/api/lyrics', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ k, id, action })
		});
		if (!res.ok) return null;
		const body = (await res.json().catch(() => null)) as { ok?: unknown; versions?: unknown } | null;
		return body?.ok === true ? projectVersions(body.versions) : null;
	} catch {
		return null;
	}
}
