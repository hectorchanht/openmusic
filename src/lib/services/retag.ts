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

import { blobStore, getStoredName, setStoredName, overwriteDeviceFile } from './blob-store';
import { albumTag, tagAudioBlob, readAudioTags } from './audio-tags';
import { resolveArtworkDataUrl } from './media-artwork';
import { buildDownloadFilename, sanitizeFilename, MAX_FILENAME_BASE } from './download-filename';
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
	/**
	 * quick-260919-30x: the BASE name the user typed for the file on disk, without an extension.
	 * ABSENT (or blank, or a string that sanitizes to nothing) means "name it from the title and
	 * artist", which is exactly today's behaviour — the field is a strict no-op unless used (D-7).
	 * The extension is ALWAYS `out.format`, the SNIFFED container, never anything the user typed
	 * (D-6): a `.txt` in a MediaStore audio entry is not a name the app should be able to write.
	 * Ignored on the web build's `blobStore.put` (the IDB record is uid-keyed), which is why the
	 * editor hides the field there (D-8).
	 */
	filename?: string;
}

/**
 * What happened to ONE file. Everything except `'tagged'` means the file on disk was NOT touched:
 *  - `missing`           the app no longer holds a copy (deleted outside the app)
 *  - `skipped-size` / `unknown-container` / `no-fields` / `error`  straight from the codec
 *  - `verify-failed`     the tagged bytes did not parse back — never written (Pitfall 10)
 *  - `put-failed`        the write itself failed (disk full, IDB error, or a refused/failed
 *                        in-place rewrite of an imported file)
 *  - `device-skipped`    quick-260919-ejm: an imported `device:` file on a platform that CANNOT
 *                        write in place — the web build, or Android below API 29. NOT a refusal
 *                        on principle any more; on a capable device an imported file is tagged
 *                        like any other.
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
	// quick-260919-ejm — AN IMPORTED FILE IS THE USER'S FILE, AND IT IS NOW WRITTEN IN PLACE.
	//
	// This replaces quick-260919-1eh's blanket `if (isDeviceUid(entry.uid)) return 'device-skipped'`.
	// Three things that comment recorded, all still true, and one that changed:
	//
	// 1. THE HAZARD IT NAMED IS STILL REAL. `blobStore.put` has NO device short-circuit: a device uid
	//    reaching it writes an orphan app-private copy that `get` will never read, then MediaStore-
	//    saves a SECOND public copy of a song the user already owns — a silent duplicate of their own
	//    music plus an edit that never shows up. That is still exactly what would happen. It is
	//    avoided because the device path DOES NOT GO THROUGH `put` AT ALL, not because a guard stops
	//    it: the two write sinks are disjoint by routing (see `overwriteDeviceFile`'s first statement,
	//    which refuses a non-device uid just as firmly).
	// 2. THE ROUTE IT DESCRIBED IS STILL THE ROUTE. The Settings -> Downloads sweep lists imported
	//    rows because `blobStore.has` reads the user's file in place (34-D-05), and the metadata
	//    editor's Save is this same function. One fork here covers both, at zero call-site cost.
	// 3. WHAT CHANGED: the user explicitly authorised the in-place rewrite it said was "not this" —
	//    a Kotlin `openFileDescriptor(uri, "rwt")` stream plus a MediaStore column update, with a
	//    temp-then-verify-then-journal ladder in front of it (see `overwriteDeviceFile`). The
	//    condition of that authorisation is the ladder, not the feature.
	//
	// THE FORK SITS AT THE WRITE STEP, deliberately. The codec pass and the verify-before-write round
	// trip are SHARED, not duplicated: a device file gets exactly the same "bytes that do not parse
	// back are never written" protection an app download gets, and there is no second code path for
	// that protection to drift out of.
	const device = isDeviceUid(entry.uid);
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

		// quick-260919-30x (D-6/D-7, T-30x-01): a user-typed base name, if there is one, otherwise
		// the derived name this has always written. `sanitizeFilename` is the SAME single sanitizer
		// the builder uses, so no `/` or `\` can reach MediaStore; `^\.+$` is the "a name of only
		// dots is not a name" guard — `.` and `..` must never become a filename. The extension is
		// appended from `out.format` afterwards, so it is never the user's to choose.
		//
		// quick-260919-3j1 (D-6, T-3j1-01): the RECORDED name is the fallback, and it sits INSIDE the
		// sanitize call rather than beside it — a stored `../evil` or `...` is re-sanitized on READ,
		// so nothing hand-written into localStorage can reach `blobStore.put`. Order is the decision:
		// what the CALLER passes always wins, the remembered name only fills a caller's silence.
		// That silence is the new case — a cover pin, a lyric pin and the player's automatic lyric
		// embed all rewrite this file knowing nothing about its name, and without this line each of
		// them would rename a file the user deliberately named via the editor's File name field.
		if (device) {
			// quick-260919-ejm (D-7): NO NAME, EVER. `entry.filename` is ignored and the sticky-name
			// index is neither read nor written for a device uid — the in-place write cannot rename,
			// and a name threaded into a call that silently drops it is how a rename capability gets
			// added by accident later. `expectedBytes` is the ORIGINAL blob read at the top of this
			// function: the Kotlin side checks it against the row's CURRENT SIZE column, which is the
			// guard against a reassigned MediaStore _ID pointing this uid at a DIFFERENT song
			// (34-D-02). Same `albumTag` the app-download branch uses, so an imported file gets the
			// identical album normalisation.
			const wrote = await overwriteDeviceFile(entry.uid, out.blob, {
				title: entry.title,
				artist: entry.artist,
				album: albumTag(entry.album, entry.title),
				expectedBytes: blob.size
			});
			// 'unsupported' is the web build and Android below API 29 — no MediaStore row to write
			// into, so the honest answer is the skipped bucket, not a failure. Everything else that
			// is not 'ok' left the file either untouched or replayable, and reads as a failed write.
			if (wrote === 'unsupported') return 'device-skipped';
			if (wrote !== 'ok') return 'put-failed';
		} else {
			// The extension comes from the SNIFFED container, not from a URL — the stored Track's
			// audioUrl is nulled by persistence, and a URL extension lies anyway (RESEARCH Pattern 2).
			const base = sanitizeFilename(entry.filename ?? getStoredName(entry.uid) ?? '')
				.trim()
				.replace(/^\.+$/, '')
				.slice(0, MAX_FILENAME_BASE)
				.trim();
			const name = base ? `${base}.${out.format}` : buildDownloadFilename(entry.artist, entry.title, out.format);
			const ok = await blobStore.put(entry.uid, out.blob, name);
			if (!ok) return 'put-failed';
			// quick-260919-3j1 (D-6): remember a name the user TYPED, so no LATER rewrite reverts it.
			// Only when the CALLER supplied one — a DERIVED name is deliberately not recorded, which
			// is what keeps today's behaviour intact: editing the title still renames the file.
			//
			// ponytail: a typed name is sticky with NO "reset to derived" button. The escape hatch is
			// the editor field's own placeholder, which shows the derived name — retyping it re-records
			// it. Upgrade path if anyone asks: a clear affordance that calls a `clearStoredName` export.
			if (entry.filename && base) setStoredName(entry.uid, base);
		}
		// BELOW the fork, so it can never be reachable from only one branch. quick-260919-1eh: the
		// bytes under this uid just changed, so the session memo that caches the file's OWN art + LRC
		// is now describing a file that no longer exists — and for an imported file that memo is the
		// ONLY metadata source, so a missed eviction means the app serves pre-edit tags for the rest
		// of the session. Success path ONLY: every other outcome left the file byte-identical.
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
