// MusicBrainz client service (quick-260831-re9, acting on spike 010). PURE + never-throw, mirroring
// deezer.ts's WR-03 cache posture exactly: a transient failure REJECTS inside cached() so it is
// never pinned for the TTL, and maps to an empty sentinel OUTSIDE so the caller falls back.
//
// WHY: Deezer fragments CJK artists across profiles and romanizes their catalogue. Measured
// 2026-09-01 — 陳奕迅 showed 5 albums (MusicBrainz has 102 release-groups, 57 of them albums/EPs),
// and 周杰倫's Deezer titles are English ("Greatest Works Of Art" for 最偉大的作品). MusicBrainz
// carries original-script titles and resolves every script variant AND the romanized name to one
// artist id, which is also what lets 周傑倫 / Jay Chou / 周杰倫 be ONE artist rather than three.
import { cached } from '$lib/services/ttl-cache';
import { apiFetch } from '$lib/services/api-base';
import { combinedSignal } from '$lib/services/deezer';

const ARTIST_PATH = '/api/musicbrainz/artist';
const ALBUMS_PATH = '/api/musicbrainz/albums';
const TRACKS_PATH = '/api/musicbrainz/tracks';

// Identity and discography are effectively static; match the edge's 24h.
const TTL_MB = 24 * 60 * 60 * 1000;

/** Canonical artist identity + locale-tagged display names. */
export interface MbArtistIdentity {
	mbid: string | null;
	name: string | null;
	country: string | null;
	/** locale → display name, already normalized to the app's tags (`en`, `zh-Hant`, `zh-Hans`, …). */
	names: Record<string, string>;
}

/** One release-group, shaped to drop straight into a DiscographyEntry. */
export interface MbAlbum {
	id: string;
	title: string;
	releaseDate: string | null;
	type: string | null;
	cover: string | null;
}

/** One ordered track (same shape as the Deezer album-tracks reshape). */
export interface MbTrackRow {
	artist: string;
	title: string;
	position: number | null;
}

const EMPTY_IDENTITY: MbArtistIdentity = { mbid: null, name: null, country: null, names: {} };

/**
 * Resolve an artist NAME (any script, or romanized) to one canonical MusicBrainz identity.
 * Returns the empty identity on a miss / low-confidence match / transient failure, so the caller
 * simply keeps using Deezer.
 */
export async function mbArtist(name: string, signal?: AbortSignal): Promise<MbArtistIdentity> {
	if (signal?.aborted) return EMPTY_IDENTITY;
	const clean = (name ?? '').trim();
	if (!clean) return EMPTY_IDENTITY;
	return cached(`mb:artist:${clean}`, TTL_MB, async () => {
		const url = `${ARTIST_PATH}?${new URLSearchParams({ name: clean }).toString()}`;
		const res = await apiFetch(url, { signal: combinedSignal(signal) });
		if (!res.ok) throw new Error(String(res.status));
		const data = (await res.json()) as MbArtistIdentity;
		return data?.mbid ? data : EMPTY_IDENTITY;
	}).catch(() => EMPTY_IDENTITY);
}

/** An artist's full discography (every record type) in the original script. [] on any failure. */
export async function mbAlbums(mbid: string, signal?: AbortSignal): Promise<MbAlbum[]> {
	if (signal?.aborted || !mbid) return [];
	return cached(`mb:albums:${mbid}`, TTL_MB, async () => {
		const url = `${ALBUMS_PATH}?${new URLSearchParams({ mbid }).toString()}`;
		const res = await apiFetch(url, { signal: combinedSignal(signal) });
		if (!res.ok) throw new Error(String(res.status));
		const data = (await res.json()) as { albums?: MbAlbum[] };
		return Array.isArray(data?.albums) ? data!.albums! : [];
	}).catch(() => [] as MbAlbum[]);
}

/** A release-group's ordered tracklist in the original script. [] on any failure. */
export async function mbTracks(
	rgid: string,
	artist = '',
	signal?: AbortSignal
): Promise<MbTrackRow[]> {
	if (signal?.aborted || !rgid) return [];
	return cached(`mb:tracks:${rgid}`, TTL_MB, async () => {
		const qs = new URLSearchParams({ rgid });
		if (artist) qs.set('artist', artist);
		const res = await apiFetch(`${TRACKS_PATH}?${qs.toString()}`, { signal: combinedSignal(signal) });
		if (!res.ok) throw new Error(String(res.status));
		const data = (await res.json()) as { tracks?: MbTrackRow[] };
		return Array.isArray(data?.tracks) ? data!.tracks! : [];
	}).catch(() => [] as MbTrackRow[]);
}

/**
 * Choose the artist display name for a language tag — PURE, exported for testing.
 *
 * This is what makes the merged artist identity respect the artist-language setting: one
 * MusicBrainz artist carries `{en: "Eason Chan", zh-Hant: "陳奕迅", zh-Hans: "陈奕迅"}`, so the same
 * page renders the right name instead of the app showing three separate artists.
 *
 * Resolution order:
 *   1. exact locale match            (`zh-Hant` → 陳奕迅)
 *   2. same base language            (`zh` → whatever zh-* alias exists, e.g. a bare `zh`)
 *   3. the canonical MusicBrainz name (its original script — never blank)
 *   4. the name we were searching with
 *
 * `'auto'` and `'off'` are NOT locales — they mean "follow the app elsewhere", so they fall
 * straight through to the canonical name rather than matching an alias.
 */
export function pickLocaleName(
	names: Record<string, string>,
	canonical: string | null,
	lang: string | null | undefined,
	fallback = ''
): string {
	const canon = (canonical ?? '').trim();
	const tag = (lang ?? '').trim();
	if (tag && tag !== 'auto' && tag !== 'off' && names) {
		const exact = names[tag];
		if (exact) return exact;
		// Same base language, e.g. lang 'zh-Hant' with only a bare 'zh' alias present (or vice versa).
		const base = tag.split('-')[0].toLowerCase();
		for (const [k, v] of Object.entries(names)) {
			if (v && k.split('-')[0].toLowerCase() === base) return v;
		}
	}
	return canon || fallback;
}
