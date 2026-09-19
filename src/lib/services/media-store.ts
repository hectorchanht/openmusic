// Public Music/ MediaStore bridge (999.1-06, D-11) -------------------------------------------
//
// TS wrapper around the HAND-WRITTEN local Capacitor plugin `MediaStoreSaver`
// (android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt — NO npm/git dependency,
// T-999.1-07 mitigation). The plugin writes downloaded audio into the public `Music/OpenMusic/`
// collection via MediaStore.Audio.Media (API 29+ RELATIVE_PATH + IS_PENDING; API <=28 legacy
// DIRECTORY_MUSIC) so a downloaded song is visible to file managers and other audio apps.
//
// blob-store.ts native put() calls saveToMusic() to land the file in public Music/ and records the
// returned content URI; del() calls deleteFromMusic({ uri }) to remove the entry the app created.
// blob-store maps any reject/throw here to its never-throws sentinel (put -> false / del -> void),
// so a failed public-Music write degrades to CDN playback and never crashes the player (T-999.1-19).
//
// 34: the plugin is now READ + WRITE. `requestReadAudio` asks for the audio-read grant AT TAP TIME
// (34-D-14 — never at launch) and `scanAudio` pages the user's own MediaStore.Audio rows under
// Music/ and Download/ (34-D-11) so they can be imported as library entries. Reading is entirely
// permission-gated; bytes STILL never cross the JS bridge in either direction — the scan reads
// columns only, and playback of an imported file goes through `Capacitor.convertFileSrc(contentUri)`
// + fetch in blob-store.ts.

import { registerPlugin } from '@capacitor/core';
import type { ScanRow } from './device-track';

/** Outcome of the 34-D-14 tap-time audio-read permission request. */
export type ReadAudioState = 'granted' | 'denied' | 'denied-permanently' | 'unsupported';

export interface MediaStoreSaverPlugin {
	/**
	 * Copy the audio file at `sourcePath` (a `file://` URI of the app-private offline copy, resolved
	 * via `Filesystem.getUri`) into the public `Music/OpenMusic/` collection under `fileName`. The
	 * Kotlin side STREAMS the source file into the MediaStore entry in chunks — no bytes cross the JS
	 * bridge, eliminating the whole-blob base64 round-trip OOM/ANR risk for large lossless files
	 * (WR-02). Resolves the content URI of the created entry; rejects on any MediaStore failure.
	 */
	saveToMusic(opts: { fileName: string; sourcePath: string }): Promise<{ uri: string }>;
	/**
	 * quick-260919-ejm — THE ONE WRITE CAPABILITY THIS APP HAS AGAINST A FILE IT DOES NOT OWN.
	 *
	 * Rewrite the bytes of an EXISTING MediaStore row IN PLACE: same row, same path, same name, no
	 * second copy. `uri` must be the `content://media/...` URI of a device row (the only caller
	 * passes `deviceContentUri(uid)`); `sourcePath` is a `file://` temp the app already wrote and
	 * verified complete. Nothing is renamed or moved — DISPLAY_NAME / RELATIVE_PATH / DATA are never
	 * written (D-7).
	 *
	 * `expectedBytes` is the target row's size as the JS side read it moments earlier. The Kotlin
	 * side refuses the write when the row's current SIZE column disagrees, which is the guard
	 * against a reassigned MediaStore `_ID` (34-D-02) silently pointing the uid at a DIFFERENT song.
	 * Blank or absent SKIPS that check — the replay path only, where a partial write means the size
	 * no longer matches by definition.
	 *
	 * `title` / `artist` / `album` update the MediaStore columns best-effort AFTER the bytes land
	 * (D-8: the phone's music app renders the columns, not the tags). A failed column update still
	 * resolves — the bytes are already on disk.
	 *
	 * THE REJECT-CODE CONTRACT — route on the PREFIX, it decides whether the user's file is intact:
	 *  - `unsupported:...`  API below 29. Nothing was written.
	 *  - `precheck:...`     a failed precondition (not a media uri, the row changed, the temp source
	 *                       is missing or empty). Nothing was written — no descriptor was opened.
	 *  - `denied`           Android refused write access, or the user dismissed the consent dialog.
	 *                       Nothing was written.
	 *  - `io:...`           the descriptor WAS open and the bytes may be PARTIAL. The caller must
	 *                       keep its pending-write journal entry and the temp file so a replay can
	 *                       finish the job; clearing them here strands a truncated file forever.
	 */
	writeInPlace(opts: {
		uri: string;
		sourcePath: string;
		expectedBytes?: string;
		title?: string;
		artist?: string;
		album?: string;
	}): Promise<void>;
	/**
	 * Delete the MediaStore entry previously created by `saveToMusic` (the `uri` it returned).
	 * Resolves even when the entry is already absent (the plugin swallows not-found).
	 */
	deleteFromMusic(opts: { uri: string }): Promise<void>;
	/**
	 * 34-D-14: request READ_MEDIA_AUDIO (API 33+) / READ_EXTERNAL_STORAGE (API 29-32) at tap time.
	 * Resolves a state; it rejects only on an internal error, and the import store (Plan 34-07) maps
	 * a reject to `'denied'` — the soft state, so the button stays tappable and Android may ask
	 * again. `'denied-permanently'` means the system dialog will not reappear (the UI points at App
	 * info → Permissions instead of re-asking in a loop), and `'unsupported'` (API <= 28, where the
	 * scan has no RELATIVE_PATH column) is the failed sentinel — import is simply unavailable there.
	 */
	requestReadAudio(): Promise<{ state: ReadAudioState }>;
	/**
	 * 34-D-11: one page of MediaStore.Audio rows under `Music/` or `Download/` (and their
	 * subfolders), ordered `_ID ASC` — a deterministic order is what makes paging coherent, so pages
	 * neither overlap nor skip. `limit` is clamped Kotlin-side to 1..1000 (default page 500 =
	 * `SCAN_PAGE_SIZE` in device-import.ts), which bounds the bridge payload. `total` is the FULL
	 * matching count, so the walker stops at `offset >= total`. Rows are flat objects — Capacitor
	 * Android rejects nested arrays.
	 *
	 * Rejects when the permission is not granted or the query fails. A reject means THAT PAGE failed:
	 * the import reports `'failed'` and the D-07 drop pass does NOT run, because a failed page is a
	 * transient failure and never evidence that the missing files are confirmed gone (D-08).
	 */
	scanAudio(opts: { offset: number; limit: number }): Promise<{ rows: ScanRow[]; total: number }>;
}

export const MediaStoreSaver = registerPlugin<MediaStoreSaverPlugin>('MediaStoreSaver');
