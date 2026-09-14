// backup-io.ts — the ONE platform seam for "the backup file leaves the app" (35-D-14/D-16/D-17/D-18).
//
// Posture (matches the rest of lib/services): NEVER THROWS. Every outcome is an ExportResult
// sentinel the caller localizes into a toast — a failure never reaches the render tree, and the
// user backing out of the share sheet is NOT a failure.
//
// D-18: this file is the phase's only isNativePlatform() branch. The page above it stays
// platform-blind; everything platform-specific is here and nowhere else.
//   - web   (D-14): hand a Blob to the existing anchor-save seam. The File System Access API is
//                   deliberately not used — iOS Safari is the primary target and buys nothing there.
//   - native (D-16/D-17): write the JSON into the app cache, then hand the file:// URI to the OS
//                   share sheet so the user can send it to Files / Drive / mail / anywhere, rather
//                   than dropping it into a folder they then have to hunt for.

import { browser } from '$app/environment';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { saveBlobToDisk } from '$lib/services/download-save';

/** 'ok' = the file left the app; 'dismissed' = the user backed out of the share sheet; 'failed' = it did not. */
export type ExportResult = 'ok' | 'dismissed' | 'failed';

/**
 * Send the backup JSON out of the app. Never throws.
 *
 * iOS GESTURE RULE: on the web branch there is NO `await` between entry and the anchor save — an
 * async function runs synchronously up to its first await, so the save still lands inside the tap's
 * gesture task. iOS Safari silently ignores a programmatic anchor activation once a turn of the
 * event loop has passed, which presents as "Export does nothing, only on iPhone". Do not introduce
 * an await above the save call, and keep the envelope build synchronous in the caller.
 */
export async function exportBackup(json: string, filename: string): Promise<ExportResult> {
	if (!browser) return 'failed';
	if (Capacitor.isNativePlatform()) return shareBackupNative(json, filename);
	// MIME: application/json keeps the file human-readable and correctly typed everywhere it lands
	// (D-03). application/octet-stream would force a download on some iOS versions but makes the
	// file uglier and less recognisable on every other platform — not worth the trade.
	// The anchor/object-URL dance itself lives in download-save.ts and is NOT re-implemented here:
	// that seam is grep-guardrailed against DL-BUG-01 (a failure must never navigate).
	return saveBlobToDisk(new Blob([json], { type: 'application/json' }), filename) ? 'ok' : 'failed';
}

/**
 * 35-D-16/D-17: native export via the OS share sheet. Two try blocks on purpose — a write failure
 * and a dismissed sheet are different outcomes for the user.
 */
async function shareBackupNative(json: string, filename: string): Promise<ExportResult> {
	let uri: string;
	try {
		// Encoding.UTF8 means `data` is the plain string. The base64 round-trip that blob-store.ts
		// goes out of its way to avoid (WR-03) is a concern for BINARY blobs only; a UTF-8 text write
		// is exactly what this API is for, so capacitor-blob-writer is not needed here.
		//
		// The cache directory maps to getCacheDir(), which the FileProvider's file_paths.xml already
		// covers with <cache-path>. The app-files directory would need a <files-path> entry that does
		// not exist, and sharing from it fails at runtime with "Failed to find configured root".
		await Filesystem.writeFile({
			path: filename,
			directory: Directory.Cache,
			data: json,
			encoding: Encoding.UTF8
		});
		// getUri returns a file:// URI on Android — the only form the share plugin accepts (it
		// rejects a content:// URI outright and derives its own FileProvider grant from the path).
		({ uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache }));
	} catch {
		return 'failed';
	}
	// The written file is left behind deliberately: Android reclaims the cache directory under
	// storage pressure, so cleanup code would be all risk (deleting the file the share target is
	// still reading) and no benefit.
	try {
		await Share.share({ title: filename, files: [uri], dialogTitle: filename });
		return 'ok';
	} catch {
		// A dismissed sheet REJECTS on Android. After a successful write that is the user changing
		// their mind, not an error — flashing "export failed" here would be the bug.
		return 'dismissed';
	}
}
