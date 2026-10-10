// Discography pack service — dynamic discography for ANY artist (Hector 2026-10-10:
// "Dynamic discography"). Reuses the artist page's loadDiscography (MusicBrainz for CJK),
// then fetches each album's tracklist for the pack view and the tip-jar-gated bulk download.
import { loadDiscography } from '$lib/services/discography-source';
import type { DiscographyEntry } from '$lib/services/discography';
import { resolveStub } from '$lib/services/discovery';
import { getAlbumTracklist } from '$lib/services/lastfm';
import { deezerAlbumTracks } from '$lib/services/deezer';
import { mbTracks } from '$lib/services/musicbrainz';
import type { Track } from '$lib/sources/types';

export interface PackAlbum extends DiscographyEntry {
	/** Fetched tracklist (artist/title stubs); null until loaded. */
	tracks: { artist: string; title: string }[] | null;
}

/** Load the full discography for the pack view (albums + EPs, newest first). */
export async function getDiscographyPack(artistName: string): Promise<PackAlbum[]> {
	const load = await loadDiscography(artistName);
	// Filter to albums/EPs (the artist page's shelf rule), newest first.
	const albums = load.entries.filter((e: DiscographyEntry) => {
		const t = (e.type ?? '').toLowerCase();
		return t.includes('album') || t.includes('ep') || !t;
	});
	return albums.map((e: DiscographyEntry) => ({ ...e, tracks: null }));
}

/** Fetch the tracklist for one album (MusicBrainz → Deezer id → Last.fm, like the album page). */
export async function fetchAlbumTracklist(
	album: PackAlbum,
	artistName: string
): Promise<{ artist: string; title: string }[]> {
	try {
		// MusicBrainz FIRST when present (CJK artists — original-script tracklist).
		if (album.mbid) {
			const rows = await mbTracks(album.mbid, artistName);
			if (rows.length) return rows.map((tr) => ({ artist: tr.artist, title: tr.title }));
		}
		// Deezer id next.
		if (album.id) {
			const dzTracks = await deezerAlbumTracks(album.id);
			if (dzTracks.length) return dzTracks.map((tr) => ({ artist: tr.artist, title: tr.title }));
		}
		// Last.fm fallback by name.
		if (artistName) {
			const lf = await getAlbumTracklist(album.name, artistName).catch(() => []);
			return lf;
		}
	} catch {
		// Never throw — a missing tracklist just means that album is skipped.
	}
	return [];
}

/** Resolve stubs to playable Tracks (max 4 concurrent, like the album page's resolveAll). */
export async function resolvePackTracks(
	stubs: { artist: string; title: string }[],
	onProgress?: (done: number, total: number) => void
): Promise<Track[]> {
	const out: (Track | null)[] = new Array(stubs.length).fill(null);
	let next = 0;
	let done = 0;
	async function worker() {
		while (next < stubs.length) {
			const i = next++;
			const s = stubs[i];
			try {
				out[i] = await resolveStub(s.artist, s.title);
			} catch {
				out[i] = null;
			}
			done++;
			onProgress?.(done, stubs.length);
		}
	}
	await Promise.all([worker(), worker(), worker(), worker()]);
	return out.filter((t): t is Track => t !== null);
}
