// retag.ts — retro-tag the offline copies this app ALREADY holds (36-D-17 / D-18 / D-19).
//
// WHY THIS EXISTS. Everything downloaded before Phase 36 landed is a wall of untitled files in the
// user's music app. `blobStore.put` is already the full rewrite path on both platforms (web: the
// IndexedDB record; native: the app-private copy AND, since 36-D-19, a replacing public
// Music/OpenMusic/ copy), so retro-tagging needs no new plumbing and no Kotlin — just a loop.
//
// THE THREE RULES THIS MODULE ENFORCES:
//   36-D-17 opt-in only. Nothing here runs on a timer, on mount, or in the background. The page
//           calls `retagDownloads` from a tap handler, after a confirm, and nowhere else.
//   36-D-18 scope = the app's OWN downloads it still holds a copy of. The caller passes the
//           entries (it has already intersected the downloads list with `blobStore.has`); this
//           module never enumerates anything itself and never touches a file it was not handed.
//   36-D-19 per-file isolation. Retag REWRITES files the user already has, so one bad file must
//           cost exactly that one file. Every entry runs in its own try/catch, a failure is a
//           bucket in the report, and the loop never rejects.
//
// VERIFY BEFORE WRITE (RESEARCH Pitfall 10). The tagged bytes are parsed back with `readAudioTags`
// and must return the title we just wrote BEFORE anything reaches the disk. A download writes a
// file that did not exist; a retag OVERWRITES one that did — the asymmetry is why this step exists
// here and not on the download path.
//
// PURITY CONTRACT: no runes store, no localization. Titles/artists arrive ALREADY display-translated
// (the page applies the name-cache lookups), and results come back as discriminants the UI maps to
// strings. That is what lets this run in the node test project.
//
// SEQUENTIAL, not a parallel fan-out: each entry means a wasm tag pass over a whole audio file plus
// a possible artwork fetch. The api-fetch-flood history (and the album download loop that followed
// it) settled this — one at a time, with progress reported per entry.

import { blobStore } from './blob-store';
import { albumTag, tagAudioBlob, readAudioTags } from './audio-tags';
import { resolveArtworkDataUrl } from './media-artwork';
import { buildDownloadFilename } from './download-filename';
// Both PURE (no runes store, no i18n) — the purity contract above still holds.
import { isDeviceUid } from '$lib/services/device-track';
import { forgetLocalEnrichment } from '$lib/services/local-tags';

/** One downloadable the caller wants re-tagged. Strings are already display-translated. */
export interface RetagEntry {
	uid: string;
	title: string;
	artist: string;
	album: string;
	cover: string | null;
	/**
	 * quick-260919-1eh: RAW LRC with `[mm:ss.xx]` timestamps — exactly the quick-260915-062 contract
	 * the download path already writes. ABSENT (or empty) means "leave the file's own lyrics alone",
	 * NEVER "clear them": `tagAudioBlob` runs a setter only for a truthy field, so omission preserves
	 * whatever is on disk (D-4). There is no clear verb in the codec, by design.
	 */
	lyrics?: string;
}

/**
 * What happened to ONE file. Everything except `'tagged'` means the file on disk was NOT touched:
 *  - `missing`           the app no longer holds a copy (deleted outside the app)
 *  - `skipped-size` / `unknown-container` / `no-fields` / `error`  straight from the codec
 *  - `verify-failed`     the tagged bytes did not parse back — never written (Pitfall 10)
 *  - `put-failed`        the write itself failed (disk full, IDB error)
 *  - `device-skipped`    an imported `device:` file — refused on principle, see retagOne
 */
export type RetagItemResult =
	| 'tagged'
	| 'missing'
	| 'device-skipped'
	| 'skipped-size'
	| 'unknown-container'
	| 'no-fields'
	| 'error'
	| 'verify-failed'
	| 'put-failed';

/** Truthful batch outcome: `tagged + every skipped bucket === total`. */
export interface RetagReport {
	total: number;
	tagged: number;
	skipped: Partial<Record<Exclude<RetagItemResult, 'tagged'>, number>>;
}

/**
 * Retag ONE entry. Never throws — every failure mode is a RetagItemResult.
 *
 * quick-260919-1eh: PUBLIC now, because this is BOTH the batch loop's per-item step and the metadata
 * editor's ENTIRE save. The editor reuses it rather than calling `tagAudioBlob` itself precisely for
 * the verify-before-write step below (Pitfall 10) — an editor that wrote its own bytes would be the
 * one path that can replace a working file with unparseable ones.
 */
export async function retagOne(entry: RetagEntry): Promise<RetagItemResult> {
	// quick-260919-1eh — AN IMPORTED FILE IS THE USER'S FILE, NOT THE APP'S (34 Pitfall 1).
	//
	// The guard lives HERE, not at either call site, because the SHIPPED Settings -> Downloads sweep
	// already had this bug: its eligible list is `library.downloads` filtered by `blobStore.has`,
	// imported rows live in `library.downloads`, and `has` returns TRUE for them (nativeHas
	// short-circuits a device: uid to the MediaStore content URI and reads the user's file in place,
	// 34-D-05). So the sweep was feeding device uids straight to `blobStore.put` — which has NO such
	// short-circuit: it would write an orphan app-private copy that `get` will never read, and then
	// MediaStore-save a SECOND public copy of a song the user already owns. A silent duplicate of
	// their own music, plus an edit that never shows up.
	//
	// One guard here covers the batch sweep and the new metadata editor, at zero call-site cost.
	// Editing an imported file needs a Kotlin `openFileDescriptor(uri, "rw")` in-place rewrite plus a
	// MediaStore column update — a native change with its own device UAT, not this.
	if (isDeviceUid(entry.uid)) return 'device-skipped';
	try {
		const blob = await blobStore.get(entry.uid);
		if (!blob) return 'missing';

		const art = await resolveArtworkDataUrl({ cover: entry.cover, title: entry.title, artist: entry.artist });

		// 36-D-11: NO trackNumber — a download's position in an album is not knowable from here (the
		// list order is display ordering, not album order). 36-D-12: albumArtist falls back to the
		// track's own artist. 36-D-10 (an empty album is omitted rather than written blank) now lives
		// inside `albumTag`, which also drops an album equal to the song's own title — so this
		// background path RE-TAGS away the bad album on files downloaded before quick-260919-0mw.
		// A RetagEntry carries ONE title (already display-translated by the caller), so that is the
		// only title available to compare against.
		const out = await tagAudioBlob(
			blob,
			{
				title: entry.title,
				artist: entry.artist,
				album: albumTag(entry.album, entry.title),
				albumArtist: entry.artist,
				// quick-260919-1eh: threaded into the EXISTING single codec pass — a second
				// tagAudioBlob/apply pass would reopen the file and double peak wasm memory
				// (RESEARCH Pitfall 7). `|| undefined` so '' is omission, never a blank write.
				lyrics: entry.lyrics || undefined
			},
			art
		);
		if (out.result !== 'tagged') return out.result;

		// Verify BEFORE write: bytes that do not parse back must never replace a file that works.
		const back = await readAudioTags(new Uint8Array(await out.blob.arrayBuffer()));
		if (!back) return 'verify-failed';
		if (entry.title && back.title !== entry.title) return 'verify-failed';

		// The extension comes from the SNIFFED container, not from a URL — the stored Track's
		// audioUrl is nulled by persistence, and a URL extension lies anyway (RESEARCH Pattern 2).
		const ok = await blobStore.put(entry.uid, out.blob, buildDownloadFilename(entry.artist, entry.title, out.format));
		if (!ok) return 'put-failed';
		// quick-260919-1eh: the bytes under this uid just changed, so the session memo that caches the
		// file's OWN art + LRC is now describing a file that no longer exists. Evict on the success
		// path ONLY — every other outcome left the file byte-identical, so its memo entry is still true.
		forgetLocalEnrichment(entry.uid);
		return 'tagged';
	} catch {
		return 'error';
	}
}

/**
 * Retag every entry, one at a time, reporting progress after each. Never rejects.
 *
 * Call this ONLY from a user gesture (36-D-17).
 */
export async function retagDownloads(
	entries: RetagEntry[],
	onProgress?: (done: number, total: number) => void
): Promise<RetagReport> {
	const list = Array.isArray(entries) ? entries.filter((e) => e && e.uid) : [];
	const report: RetagReport = { total: list.length, tagged: 0, skipped: {} };
	let done = 0;
	for (const entry of list) {
		const result = await retagOne(entry);
		if (result === 'tagged') report.tagged++;
		else report.skipped[result] = (report.skipped[result] ?? 0) + 1;
		done++;
		try {
			onProgress?.(done, report.total);
		} catch {
			// a broken progress callback must not abort the batch (36-D-19).
		}
	}
	return report;
}
