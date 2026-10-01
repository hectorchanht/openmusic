// download-album.ts — the album "Download all" orchestration (40-D-01 D-03 D-04 D-05 D-06).
//
// CONTRACTS (asserted in download-album.test.ts):
//
//   NEVER-THROWS: resolves `{ saved, total }` on every path. It imports NO localization or
//     notification module — it emits counts through `onProgress` and the result, and the album page localizes.
//
//   40-D-04: every song goes through the ONE shared `downloadTrack` with `persist: true, save: false`,
//     so each song gets the offline copy (library Downloads, plays offline) and, on native, the public
//     `Music/OpenMusic/<Artist>/<Album>/` write (40-D-01, via `dir`). No per-song browser save fires.
//
//   40-D-03: on web the persisted blobs are collected into ONE store-only zip whose FILENAME names the
//     album (`<Artist> - <Album>.zip`) and whose entries sit under a `<Artist> - <Album>/` root folder.
//     One save prompt, not one per song. Nothing reached disk when the zip cannot be built or saved,
//     so the count is 0 then.
//
//   40-D-05: a song already downloaded as a single is MOVED (native) into the album folder, or its held
//     blob is reused for the zip (web). No re-fetch, no second library entry. Matched by uid OR
//     `sameSongKey` — resolveStub can pick a different source than the user's single (Pitfall 3).
//
//   40-D-06: a failed song is skipped, never aborts the album; progress still advances.
//
// ponytail: sequential, not concurrent. The per-song resolve already fans <=4 wide inside the page's
// resolveAllCached; parallel downloads on top would compose caps (the api fetch-flood freeze root
// cause). Parallelize only behind the apiFetch governor if album downloads prove too slow.

import type { Track } from '$lib/sources/types';
import { Capacitor } from '@capacitor/core';
import { library } from '$lib/stores/library.svelte';
import { names } from '$lib/stores/names.svelte';
import { blobStore } from '$lib/services/blob-store';
import { saveBlobToDisk } from '$lib/services/download-save';
import { downloadTrack, type DownloadResult } from '$lib/services/download-track';
import { fetchVariants, versionsIncludingOwn } from '$lib/services/variants';
import { probeDownload } from '$lib/services/download-probe';
import { sameSongKey } from '$lib/services/dedupe';
import { buildZip, type ZipEntry } from '$lib/services/zip-store';
import {
	albumDir,
	albumFolder,
	buildDownloadFilename,
	extFromAudioUrl,
	sanitizeFilename
} from '$lib/services/download-filename';

const YTMUSIC = 'ytmusic';

/** `a.mp3` → `a (2).mp3` → `a (3).mp3` for a name already used inside this zip. */
function uniqueName(name: string, used: Set<string>): string {
	let out = name;
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	for (let n = 2; used.has(out); n++) out = `${stem} (${n})${ext}`;
	used.add(out);
	return out;
}

/** The zip entry name for an already-held single: its user-typed name if any, else `Artist - Title`. */
function heldFilename(held: Track): string {
	const ext = extFromAudioUrl(held.audioUrl);
	const stored = blobStore.getStoredName(held.uid);
	if (stored) return sanitizeFilename(`${stored}.${ext}`);
	return buildDownloadFilename(names.dnArtist(held.artist), names.dnTitle(held.title, held.artist), ext);
}

/**
 * Download every track of an album, in album order. `meta` carries the DISPLAY-language names the
 * user sees (folder names). Never rejects.
 */
export async function downloadAlbum(
	tracks: Track[],
	meta: { artist: string; album: string },
	onProgress?: (n: number, total: number) => void
): Promise<{ saved: number; total: number }> {
	const total = tracks.length;
	let saved = 0;
	try {
		const native = Capacitor.isNativePlatform();
		const dir = albumDir(meta.artist, meta.album);
		const folder = albumFolder(meta.artist, meta.album);
		const entries: ZipEntry[] = [];
		const used = new Set<string>();
		const addEntry = (filename: string, blob: Blob) =>
			entries.push({ name: `${folder}/${uniqueName(filename, used)}`, blob });

		for (const [i, tr] of tracks.entries()) {
			try {
				onProgress?.(i + 1, total);
			} catch {
				// a broken progress callback must not abort the album (36-D-19).
			}
			try {
				const held = library.downloads.find((d) => d.uid === tr.uid || sameSongKey(d, tr));
				if (held && (await blobStore.has(held.uid))) {
					if (native) {
						// "saved, not moved" when this resolves false or rejects: the file stays flat.
						await blobStore.moveToDir(held.uid, dir).catch(() => false);
						saved++;
						continue;
					}
					const blob = await blobStore.get(held.uid);
					// An empty held blob (an old 403 download saved 0 bytes) falls through to a re-download.
					if (blob?.size) {
						addEntry(heldFilename(held), blob);
						saved++;
						continue;
					}
				}

				let got: { uid: string; filename: string; blob: Blob } | null = null;
				// 36-D-11 / 36-D-12: `i + 1` over the page's resolved list is the real album order — the
				// tracklist comes from Deezer / MusicBrainz / Last.fm in album order, making this the ONLY
				// legitimate track-number source in the app. `tr.displayIndex` is forbidden here: it is
				// interleaved MULTI-SOURCE search ordering, not a position on a record.
				// `meta.artist || undefined` because the album artist is '' on a deep link, and undefined
				// lets downloadTrack fall back to the track's own artist (D-12's grouping default).
				const attempt = (audioFrom?: Track) =>
					downloadTrack(tr, {
						persist: true,
						save: false,
						trackNumber: String(i + 1),
						albumArtist: meta.artist || undefined,
						...(native && dir ? { dir } : {}),
						...(audioFrom ? { audioFrom } : {}),
						onSaved: native ? undefined : (uid, filename, blob) => (got = { uid, filename, blob })
					});
				let res: DownloadResult = 'failed';
				// 40-03: a ytmusic file cannot be fetched by the album path (web: the stream proxy's
				// googlevideo 403; native: the direct googlevideo url has no CORS header), so a ytmusic
				// song takes its audio from another source first — the "Download from…" contract
				// (quick-260916-0d9 `audioFrom`): the donor's resolved audio saved under THIS song's
				// identity. Donors come from the picker's own lookup (fetchVariants + versionsIncludingOwn,
				// one row per source) and are resolved through the picker's probeDownload, one at a time.
				// The ytmusic file itself is tried last, for when no other source has the song.
				if (tr.source === YTMUSIC) {
					const donors = versionsIncludingOwn(tr, await fetchVariants(tr)).filter((v) => v.source !== YTMUSIC);
					for (const donor of donors) {
						const p = await probeDownload(donor);
						if (!p.track?.audioUrl) continue;
						res = await attempt(p.track);
						if (res === 'saved') break;
					}
				}
				if (res !== 'saved') res = await attempt();
				if (res !== 'saved') continue;
				if (native) {
					saved++;
				} else if (got) {
					const g: { uid: string; filename: string; blob: Blob } = got;
					// Prefer the IndexedDB-backed handle over the in-heap blob (Pitfall 6: a lossless album
					// would otherwise sit whole in memory until the zip is built).
					// A failed put can leave an older/empty stored blob, so only a non-empty one wins.
					const stored = await blobStore.get(g.uid);
					addEntry(g.filename, stored?.size ? stored : g.blob);
					saved++;
				}
			} catch {
				// 40-D-06: skip this song, keep going.
			}
		}

		if (!native && entries.length) {
			const zip = await buildZip(entries);
			if (!zip || !saveBlobToDisk(zip, `${folder}.zip`)) saved = 0;
		}
	} catch {
		// never-throws: report what was counted so far.
	}
	return { saved, total };
}
