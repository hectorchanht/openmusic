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
//   quick-261004-o9t: a ytmusic song is handed to `downloadTrack` like any other and now downloads its
//     OWN audio (native direct / stream proxy with retry, both inside download-track.ts — the
//     quick-260930-uia donor rule is lifted). This loop still has no donor lookup of its own.
//
//   quick-260930-uia: `onProgress(n, total)` counts COMPLETED songs (saved, failed or skipped), and
//     zip entries are assembled in album order after every song settles.
//
//   quick-260930-vjp: two-stage pipeline. Every song enters at once and passes two gates handed to
//     `downloadTrack` as `stages`: RESOLVE (link lookup, RESOLVE_POOL=3) feeds TRANSFER (raw audio body
//     → tag → persist, TRANSFER_POOL=8). A song moves to stage 2 the moment its link resolves, so one
//     slow resolve or one slow CDN body no longer holds a slot the rest of the album needs (the old
//     single 3-wide pool took 155 s for 10 songs, mostly a 1-busy tail). Stage 1 shares the apiFetch
//     governor (MAX_CONCURRENT_REQUESTS=8, api fetch-flood-freeze) with playback; stage 2 is raw CDN
//     fetches outside that governor.
//     Rows show the busy ring from the moment the album starts (queued is busy); the progress fraction
//     appears once bytes flow (`setDownloadProgress`).
//
//   quick-260930-x3q: the qq detail host (tang, called direct from the listener's IP) rate-limits like
//     a token bucket — a burst of ~7, then ~1 call per 3 s — and answers `请求过于频繁`. Measured: an
//     unpaced album fired 11 detail calls in 4 s and the last 4 were limited; 16 calls ~1.8 s apart
//     stayed clean. That used to be handled by spacing EVERY resolve grant 3.5 s apart, which slowed
//     an unlimited album for nothing. Now it is adaptive: resolves run at full speed (RESOLVE_POOL
//     only), and a song whose resolve comes back 'rate-limited' (or 'no-audio') first tries another
//     source at the download tier (`downloadFromDonor`, the shared donor walk). Only a STILL-rate-
//     limited song backs off (RETRY_BACKOFF_MS — 3 s first, the measured refill interval) and retries.
//     A 'no-audio' song is not retried: it simply has no audio.
//     The sleeps sit outside both gates, so a sleeping song holds no slot.
//
//   quick-261001-0p9: the order is now wait FIRST, donor second. A 'rate-limited' song retries qq
//     (RETRY_BACKOFF_MS 3/6/9/12 s, 30 s cap), and only a song still limited after that — or a
//     'no-audio' one, which skips the wait — goes to `downloadFromDonor` with `prefer: 'tier'`: a
//     donor at the same quality AND format as the download tier first, else the best other
//     donor so the album still finishes. Why: tang refills in ~3 s, so donor-first handed
//     a FLAC-tier song an instant mp3 from netease for a blip; qq's own file after a short wait, or
//     a like-for-like file, beats that downgrade. 'failed' still takes no retry and no donor.
//
// ponytail: 4 retries / 30 s cap, one donor walk; add per-host backoff state if a second limited host
// appears. 8 lossless bodies can sit in heap at once (~400 MB worst case); lower TRANSFER_POOL or
// stream to IndexedDB if that bites.

import type { Track } from '$lib/sources/types';
import { Capacitor } from '@capacitor/core';
import { library } from '$lib/stores/library.svelte';
import { names } from '$lib/stores/names.svelte';
import { blobStore } from '$lib/services/blob-store';
import { saveBlobToDisk } from '$lib/services/download-save';
import { downloadFromDonor, downloadTrack, type StageGate } from '$lib/services/download-track';
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
const RETRY_BACKOFF_MS = [3000, 6000, 9000, 12000];

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
			// debug album-row-tick-before-file-done: ONE outer bracket per song, from here to its final
			// outcome. downloadTrack / downloadFromDonor bracket each ATTEMPT and close it in their
			// `finally`, so without this the backoff sleeps below and the hop into the donor walk left the
			// uid "downloaded, not downloading" = a tick on a song with no file yet. library.downloading
			// is refcounted, so the inner brackets nest inside this one.
			library.beginDownload(tr.uid);
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
				// One options object for the first try, the donor pass and every retry.
				const dl = {
					persist: true,
					save: false,
					trackNumber: String(i + 1),
					albumArtist: meta.artist || undefined,
					...(native && dir ? { dir } : {}),
					onSaved: native
						? undefined
						: (uid: string, filename: string, blob: Blob) => (got = { uid, filename, blob }),
					stages
				};
				let res = await downloadTrack(tr, dl);
				// quick-261001-0p9: wait for qq first (bounded backoff, 30 s total), THEN one donor walk —
				// same tier+format first, best otherwise (ordered inside downloadFromDonor). The sleep is a
				// bare timer outside both gates (downloadTrack takes and releases the resolve slot itself),
				// so a waiting song holds no slot. 'no-audio' skips the wait. See the header.
				if (res === 'rate-limited') {
					for (const ms of RETRY_BACKOFF_MS) {
						await new Promise((r) => setTimeout(r, ms));
						res = await downloadTrack(tr, dl);
						if (res !== 'rate-limited') break;
					}
				}
				if (res === 'rate-limited' || res === 'no-audio') {
					res = await downloadFromDonor(tr, dl, { exclude: [tr.source], prefer: 'tier' });
				}
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
			} finally {
				library.endDownload(tr.uid);
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
