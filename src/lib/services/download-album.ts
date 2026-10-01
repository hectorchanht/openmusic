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
//   quick-260930-uia: a ytmusic song is handed to `downloadTrack` like any other — the "never route
//     to YT Music" donor rule lives in download-track.ts (`canDownloadFrom`), so this loop has no
//     donor lookup of its own. `onProgress(n, total)` counts COMPLETED songs (saved, failed or
//     skipped), and zip entries are assembled in album order after every song settles.
//
//   quick-260930-vjp: two-stage pipeline. Every song enters at once and passes two gates handed to
//     `downloadTrack` as `stages`: RESOLVE (link lookup, RESOLVE_POOL=3) feeds TRANSFER (raw audio body
//     → tag → persist, TRANSFER_POOL=8). A song moves to stage 2 the moment its link resolves, so one
//     slow resolve or one slow CDN body no longer holds a slot the rest of the album needs (the old
//     single 3-wide pool took 155 s for 10 songs, mostly a 1-busy tail). Stage 1 shares the apiFetch
//     governor (MAX_CONCURRENT_REQUESTS=8, api fetch-flood-freeze) with playback, so 3 leaves headroom
//     for a song the user starts meanwhile; stage 2 is raw CDN fetches outside that governor.
//     Rows show the busy ring from the moment the album starts (queued is busy); the progress fraction
//     appears once bytes flow (`setDownloadProgress`).
//
// ponytail: 8 lossless bodies can sit in heap at once (~400 MB worst case); lower TRANSFER_POOL or
// stream to IndexedDB if that bites.

import type { Track } from '$lib/sources/types';
import { Capacitor } from '@capacitor/core';
import { library } from '$lib/stores/library.svelte';
import { names } from '$lib/stores/names.svelte';
import { blobStore } from '$lib/services/blob-store';
import { saveBlobToDisk } from '$lib/services/download-save';
import { downloadTrack, type StageGate } from '$lib/services/download-track';
import { sameSongKey } from '$lib/services/dedupe';
import { buildZip, type ZipEntry } from '$lib/services/zip-store';
import {
	albumDir,
	albumFolder,
	buildDownloadFilename,
	extFromAudioUrl,
	sanitizeFilename
} from '$lib/services/download-filename';

const RESOLVE_POOL = 3;
const TRANSFER_POOL = 8;

/** A FIFO semaphore of `n` slots. Each grant's release is idempotent so a double call cannot leak a slot. */
function gate(n: number): StageGate {
	let free = n;
	const waiting: (() => void)[] = [];
	return () =>
		new Promise((grant) => {
			const go = () => {
				let done = false;
				grant(() => {
					if (done) return;
					done = true;
					const next = waiting.shift();
					if (next) next();
					else free++;
				});
			};
			if (free > 0) {
				free--;
				go();
			} else waiting.push(go);
		});
}

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
		// debug album-zip-duplicate-songs: one audio identity, one entry. Six album stubs once resolved to
		// the SAME joox row (a script-blind scoreMatch, fixed at its root), and the zip held eight identical
		// 明年今日 files. The resolver can never be trusted to make an album's uids distinct, so a uid that
		// already produced an entry (or a native move) is skipped here — it counts as not saved.
		const seenUids = new Set<string>();

		// quick-260930-uia: one slot per album position, filled as songs complete in any order, then
		// zipped in index order so `uniqueName`'s `(2)` suffixing stays deterministic in album order.
		const slots: ({ filename: string; blob: Blob } | null)[] = new Array(total).fill(null);
		const stages = { resolve: gate(RESOLVE_POOL), transfer: gate(TRANSFER_POOL) };

		const one = async (i: number, tr: Track) => {
			// Claimed SYNCHRONOUSLY before any await, so two songs can never both take one uid — and
			// `tracks.map` calls this in index order, so the first occurrence wins.
			if (seenUids.has(tr.uid)) return;
			seenUids.add(tr.uid);
			try {
				const held = library.downloads.find((d) => d.uid === tr.uid || sameSongKey(d, tr));
				if (held && (await blobStore.has(held.uid))) {
					if (native) {
						// "saved, not moved" when this resolves false or rejects: the file stays flat.
						await blobStore.moveToDir(held.uid, dir).catch(() => false);
						saved++;
						return;
					}
					const blob = await blobStore.get(held.uid);
					// An empty held blob (an old 403 download saved 0 bytes) falls through to a re-download.
					if (blob?.size) {
						slots[i] = { filename: heldFilename(held), blob };
						saved++;
						return;
					}
				}

				let got: { uid: string; filename: string; blob: Blob } | null = null;
				// 36-D-11 / 36-D-12: `i + 1` over the page's resolved list is the real album order — the
				// tracklist comes from Deezer / MusicBrainz / Last.fm in album order, making this the ONLY
				// legitimate track-number source in the app. `tr.displayIndex` is forbidden here: it is
				// interleaved MULTI-SOURCE search ordering, not a position on a record.
				// `meta.artist || undefined` because the album artist is '' on a deep link, and undefined
				// lets downloadTrack fall back to the track's own artist (D-12's grouping default).
				const res = await downloadTrack(tr, {
					persist: true,
					save: false,
					trackNumber: String(i + 1),
					albumArtist: meta.artist || undefined,
					...(native && dir ? { dir } : {}),
					onSaved: native ? undefined : (uid, filename, blob) => (got = { uid, filename, blob }),
					stages
				});
				if (res !== 'saved') return;
				if (native) {
					saved++;
				} else if (got) {
					const g: { uid: string; filename: string; blob: Blob } = got;
					// Prefer the IndexedDB-backed handle over the in-heap blob (Pitfall 6: a lossless album
					// would otherwise sit whole in memory until the zip is built).
					// A failed put can leave an older/empty stored blob, so only a non-empty one wins.
					const stored = await blobStore.get(g.uid);
					slots[i] = { filename: g.filename, blob: stored?.size ? stored : g.blob };
					saved++;
				}
			} catch {
				// 40-D-06: skip this song, keep going.
			}
		};

		let done = 0;
		await Promise.all(
			tracks.map((tr, i) =>
				one(i, tr).then(() => {
					done++;
					try {
						onProgress?.(done, total);
					} catch {
						// a broken progress callback must not abort the album (36-D-19).
					}
				})
			)
		);
		for (const slot of slots) if (slot) addEntry(slot.filename, slot.blob);

		if (!native && entries.length) {
			const zip = await buildZip(entries);
			if (!zip || !saveBlobToDisk(zip, `${folder}.zip`)) saved = 0;
		}
	} catch {
		// never-throws: report what was counted so far.
	}
	return { saved, total };
}
