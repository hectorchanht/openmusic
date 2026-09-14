// Offline blob cache for downloaded tracks (quick-260607-kyf, P1 of the ju0-deferred items).
//
// IndexedDB-backed: when a user clicks Download in TrackMenu, the fetched audio Blob is also
// persisted here keyed by track uid. Later `player.play()` checks this store before falling
// back to the upstream CDN — a downloaded song plays from the local blob (no network).
//
// Posture (matches the rest of the lib/services NEVER-THROWS pattern):
//  - Every method is SSR-guarded: on the server / unavailable IDB the API resolves to a
//    no-op / null. Callers always see a plain Promise — they cannot fail because IDB is
//    missing. A miss → null → caller uses the CDN URL transparently.
//  - The DB open is lazy + cached. A failed open caches the failure and resolves to null for
//    every subsequent call (no perpetual reconnect loop).
//  - The Blob payload is opaque to this module: it stores and returns the Blob the caller
//    handed it; URL.createObjectURL/revokeObjectURL lifecycle is the caller's responsibility
//    (player owns the URL alongside its `<audio>` element).
//  - One object store, one key path: `tracks` keyed by the track uid string. Schema v1.

import { browser } from '$app/environment';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import write_blob from 'capacitor-blob-writer';
import { MediaStoreSaver } from './media-store';
import { isDeviceUid, deviceContentUri } from './device-track';

const DB_NAME = 'openmusic-blobs';
const STORE = 'tracks';
const VERSION = 1;

// 31-D-13: minimum plausible size for a stored audio Blob. 8192 bytes is well BELOW any real audio
// file (~0.5s of 128kbps) and well ABOVE a truncated/empty write, so the floor can only ever reject
// bytes that were never going to decode. A rejected Blob is returned as `null` — i.e. it behaves
// EXACTLY like a cache miss, and every reader (restore / reresolveCurrent / play) already falls
// through to ensureTrackDetails on a null. That is why the gate lives at this single read boundary
// instead of at the three call sites: one guard, zero call-site cost, no reader can forget it.
const MIN_BLOB_BYTES = 8192;

/** 31-D-13: a stored value is usable only if it is a Blob AND carries plausible audio bytes. */
function isUsableBlob(v: unknown): v is Blob {
	return v instanceof Blob && v.size >= MIN_BLOB_BYTES;
}

// --- Native (Capacitor) filesystem + public-Music backend (999.1-03 D-10, 999.1-06 D-11) -----
//
// On native (Capacitor.isNativePlatform()) a downloaded audio Blob is persisted TWO ways:
//
//   1. App-private offline copy (`Directory.Data` — app-scoped, no runtime permissions, works on
//      every Android version) via `capacitor-blob-writer` — streams the Blob straight to disk
//      WITHOUT a base64 round-trip (@capacitor/filesystem.writeFile would base64-encode it: +33%
//      bloat + a memory spike for large lossless files). This is the OFFLINE-READ SOURCE: get()
//      reads it back so a downloaded song plays offline in-app.
//
//   2. Public `Music/OpenMusic/` copy via the hand-written Kotlin MediaStore bridge
//      (MediaStoreSaver.saveToMusic, 999.1-06 / D-11 resolved public-music-mediastore 2026-06-12)
//      so the file is visible to file managers and other audio apps. The bridge returns a content
//      URI which we record in localStorage keyed by uid so del() can remove that exact entry.
//
// OFFLINE-READ SPLIT (planner-allowed): get() reads the app-private copy (kept from plan 03), NOT
// the content URI — the simplest robust split (no readFromMusic bridge method needed; the public
// copy is purely for visibility). del() removes BOTH the app-private copy and the public entry.
//
// AMENDED 34-D-09: get()/has() now read the app-private copy FIRST and the RECORDED PUBLIC URI
// SECOND. The public copy stopped being visibility-only the moment the import's merge lane could
// find a `Music/OpenMusic/` file whose app-private twin had been evicted — the recorded URI is what
// restores playability for it. The app-private copy is still the primary read; nothing above this
// line changed, a second chance was added below it.
//
// All native functions mirror the web branch's never-throws contract EXACTLY: every path resolves
// false / null / void and NEVER rejects, so a failed public-Music write degrades to CDN playback
// (T-999.1-09 / T-999.1-19) — parity with the IDB branch.

const NATIVE_DIR = Directory.Data;

/** Filesystem-safe, collision-free path for a uid (uids are `<source>-<id>`, e.g. `netease-123`). */
function nativePath(uid: string): string {
	return `downloads/${uid.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

/** localStorage key for the public-Music content URI the MediaStore bridge returned for `uid`. */
function uriIndexKey(uid: string): string {
	return `openmusic-blob-uri:${uid}`;
}

/** A stable, sanitized public Music/ file name for a uid (audio extension defaults to .mp3). */
function nativeFileName(uid: string): string {
	return `${uid.replace(/[^a-zA-Z0-9._-]/g, '_')}.mp3`;
}

/** Read the recorded public-Music content URI for `uid`, or null. Never throws. */
function getStoredUri(uid: string): string | null {
	try {
		return typeof localStorage !== 'undefined' ? localStorage.getItem(uriIndexKey(uid)) : null;
	} catch {
		return null;
	}
}

function setStoredUri(uid: string, uri: string): void {
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(uriIndexKey(uid), uri);
	} catch {
		// ignore — the index is a best-effort convenience for del().
	}
}

function clearStoredUri(uid: string): void {
	try {
		if (typeof localStorage !== 'undefined') localStorage.removeItem(uriIndexKey(uid));
	} catch {
		// ignore.
	}
}

async function nativePut(uid: string, blob: Blob, filename?: string): Promise<boolean> {
	// Step 1 — app-private offline copy (the get() read source) via capacitor-blob-writer, which
	// streams the Blob straight to disk (NO base64 round-trip). This copy is what get() serves
	// playback from, so its success/failure IS the put() result.
	try {
		await write_blob({ path: nativePath(uid), directory: NATIVE_DIR, blob, recursive: true });
	} catch {
		return false;
	}
	// Step 2 — public Music/OpenMusic/ copy via the MediaStore bridge (D-11). This is visibility-only
	// and best-effort: WR-01 — a public-copy failure (CR-03's runtime-permission case, a transient
	// MediaStore error, etc.) must NOT fail the whole put() when the app-private offline copy already
	// landed and is fully readable by get(). WR-02 — we pass the on-disk file PATH (no blob bytes over
	// the JS bridge); the Kotlin side streams the source file into the MediaStore entry in chunks,
	// eliminating the whole-blob base64 OOM/ANR risk for large lossless files.
	try {
		const { uri: sourcePath } = await Filesystem.getUri({ path: nativePath(uid), directory: NATIVE_DIR });
		// 36-D-19: a re-put for the SAME uid (retag, or the 31-D-12 background repair) used to leave the
		// EARLIER public Music/OpenMusic/ file in place, so MediaStore de-duplicated the name and created
		// a second entry (`Artist - Song (1).m4a`). The device library then showed the song twice, one of
		// them stale. Deleting the recorded previous URI first makes put() idempotent per uid.
		// Ordering is the safety argument: step 1 (the app-private PLAYABLE copy) has ALREADY landed, so a
		// crash between the delete and the save costs at most the public visibility copy, never the file
		// playback reads. Best-effort with the same WR-01 posture — a delete failure must not stop the save.
		const prev = getStoredUri(uid);
		if (prev) {
			try {
				await MediaStoreSaver.deleteFromMusic({ uri: prev });
			} catch {
				// already gone / bridge failure: fall through and save anyway (worst case: a duplicate).
			}
		}
		// DL-FILE-01 (D-06): the PUBLIC MediaStore filename becomes the human `{artist} - {song}.{ext}`
		// name when the caller threads one through put() (TrackMenu supplies it via the new 3rd arg).
		// When absent (album / legacy callers) fall back to nativeFileName(uid) = `<uid>.mp3` so those
		// paths are byte-for-byte unchanged. The app-private copy above stays uid-keyed regardless (D-04).
		const { uri } = await MediaStoreSaver.saveToMusic({ fileName: filename ?? nativeFileName(uid), sourcePath });
		if (uri) setStoredUri(uid, uri);
	} catch {
		// public copy is visibility-only — best-effort; the offline copy already landed (WR-01).
	}
	return true;
}

/**
 * Read a local `file://` or `content://` URI into a Blob, or null. Never throws.
 *
 * WR-03: the WebView's local server streams the file natively via convertFileSrc + fetch — no
 * whole-file base64 round-trip (Filesystem.readFile would hand back the entire file base64-encoded
 * in one string and we'd atob it byte-by-byte, the same OOM spike as the old write path, on EVERY
 * offline play).
 */
async function readContentUri(uri: string): Promise<Blob | null> {
	try {
		// RAW fetch (not apiFetch — fetch→apiFetch audit): a LOCAL Capacitor URI, never /api.
		const res = await fetch(Capacitor.convertFileSrc(uri));
		if (!res.ok) return null;
		// 31-D-13: same size floor as the IDB path — a truncated/empty/unreadable copy must read as a
		// miss, never be handed to <audio> as a blob: src that can only fire `error`.
		const blob = await res.blob();
		return isUsableBlob(blob) ? blob : null;
	} catch {
		return null;
	}
}

/**
 * "Is this URI readable?" without materialising the file. Never throws.
 *
 * ponytail: this opens a stream and immediately cancels it — the ceiling is one round-trip through
 * the local server per probe. Upgrade to `fetch(url, { method: 'HEAD' })` if Capacitor's local
 * server is ever confirmed to answer HEAD (WebViewLocalServer only handles GET today).
 */
async function probeContentUri(uri: string): Promise<boolean> {
	try {
		const res = await fetch(Capacitor.convertFileSrc(uri));
		if (!res.ok) return false;
		try {
			await res.body?.cancel();
		} catch {
			// a body that cannot be cancelled is still a readable file — the answer stands.
		}
		return true;
	} catch {
		return false;
	}
}

async function nativeGet(uid: string): Promise<Blob | null> {
	// 34-D-05: an imported device file is read IN PLACE here, at the SHARED seam. The 31-D-13 comment
	// above states the principle this reuses — "that is why the gate lives at this single read
	// boundary instead of at the three call sites: one guard, zero call-site cost, no reader can
	// forget it." Two things follow from putting the device read here:
	//   1. Every one of the player's five offline-read sites (player.svelte.ts ~581/666/2864/3122/
	//      3335) plays a device file with ZERO edits, including the next one someone writes.
	//   2. RESEARCH Pitfall 2 is dodged. Capacitor's handleLocalRequest (WebViewLocalServer.java:
	//      339-377) answers EVERY Range request with a stream positioned at byte 0 while labelling
	//      it with the requested offset. Returning a Blob keeps the caller on URL.createObjectURL,
	//      and Chromium's own blob storage implements Range correctly.
	//      DO NOT "optimise" the Blob away into a direct `_capacitor_content_` audio.src — that is a
	//      silent seek-corruption bug, not a shortcut.
	// ponytail: the Blob is NOT re-typed from the row's MIME (RESEARCH Pitfall 4 — a content path has
	// no extension so the local server can emit Content-Type: null for FLAC/M4A). A uid carries no
	// MIME, and Chromium content-sniffs blob: sources [ASSUMED A3, device UAT item 3 covers FLAC and
	// m4a]. Upgrade path if UAT disagrees: persist mimeType on the Track and blob.slice(0, size, mime).
	if (isDeviceUid(uid)) {
		const uri = deviceContentUri(uid);
		return uri ? readContentUri(uri) : null;
	}
	try {
		const { uri } = await Filesystem.getUri({ path: nativePath(uid), directory: NATIVE_DIR });
		const blob = await readContentUri(uri);
		if (blob) return blob;
	} catch {
		// getUri rejected (no app-private copy) — fall through to the recorded public URI.
	}
	// 34-D-09: the app-private copy is gone or unusable. The import's merge lane records the public
	// `Music/OpenMusic/` URI for a real-source uid via linkPublicUri, so an evicted download still
	// plays from the copy the app itself wrote. No stored URI → null, exactly as before.
	const stored = getStoredUri(uid);
	return stored ? readContentUri(stored) : null;
}

// quick-260913-jq4: existence WITHOUT reading the file. `stat` returns the size, so the same
// 31-D-13 floor applies — a truncated/empty on-disk copy reports absent on native exactly as it
// reads as a miss on web, and the two platforms can never disagree about what "downloaded" means.
async function nativeHas(uid: string): Promise<boolean> {
	// 34-D-05 (RESEARCH bite #4): `has` MUST agree with `get` or the download badge lies — the exact
	// bug quick-260913-jq4 fixed. A device file has no app-private copy to stat, so its existence
	// question is "is the content URI readable", answered the same way `get` answers it.
	if (isDeviceUid(uid)) {
		const uri = deviceContentUri(uid);
		return uri ? probeContentUri(uri) : false;
	}
	try {
		const { size } = await Filesystem.stat({ path: nativePath(uid), directory: NATIVE_DIR });
		if (typeof size === 'number' && size >= MIN_BLOB_BYTES) return true;
	} catch {
		// not-found / any failure: fall through (parity with nativeGet).
	}
	// 34-D-09: same second chance nativeGet takes, so the two can never disagree.
	const stored = getStoredUri(uid);
	return stored ? probeContentUri(stored) : false;
}

async function nativeDel(uid: string): Promise<void> {
	// ---- 34 PITFALL 1 (DATA LOSS GUARD) ------------------------------------------------------
	// An imported file is the USER'S file, not the app's. `deleteFromMusic` below performs a
	// MediaStore `contentResolver.delete()`, which DELETES THE FILE — so a device uid reaching it
	// would mean "remove from library" silently destroys the user's music. D-04 (play in place, no
	// copy) and D-06 (a missing file stays listed) both forbid this module ever mutating a device
	// file. Refuse, clear any stray index entry, and return.
	//
	// This is the FIRST statement on purpose: no later refactor can slip a delete above it. It is
	// also why `linkPublicUri` refuses device uids — nothing may ever put a device content URI into
	// the index this function reads. The second, independent guard (keeping the library ROW listed)
	// lives at the player's silent-eviction site, Plan 34-02.
	if (isDeviceUid(uid)) {
		clearStoredUri(uid);
		return;
	}
	// Remove the app-private offline copy. Swallow not-found (parity with IDB del()).
	try {
		await Filesystem.deleteFile({ path: nativePath(uid), directory: NATIVE_DIR });
	} catch {
		// not-found / any failure: swallow.
	}
	// Remove the public Music/ entry the app created (D-11), then clear the index. Never throws.
	const uri = getStoredUri(uid);
	if (uri) {
		try {
			await MediaStoreSaver.deleteFromMusic({ uri });
		} catch {
			// not-found / any failure: swallow — parity with the never-throws posture.
		}
		clearStoredUri(uid);
	}
}

let openPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
	if (!browser) return Promise.resolve(null);
	if (typeof indexedDB === 'undefined') return Promise.resolve(null);
	if (openPromise) return openPromise;
	openPromise = new Promise<IDBDatabase | null>((resolve) => {
		try {
			const req = indexedDB.open(DB_NAME, VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(STORE)) {
					db.createObjectStore(STORE);
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
			req.onblocked = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
	return openPromise;
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
	return db.transaction(STORE, mode).objectStore(STORE);
}

/**
 * Persist a Blob under `uid`. Resolves silently on success or any failure (never throws).
 * Returns true if the write landed, false otherwise.
 *
 * DL-FILE-01 (D-06): the optional `filename` is the human `{artist} - {song}.{ext}` name for the
 * PUBLIC native (MediaStore) write only — it is threaded to the Kotlin bridge when supplied and
 * falls back to `<uid>.mp3` when absent (album/legacy callers). The web (IndexedDB) branch ignores
 * it entirely: the browser download anchor names the saved file, and the IDB record is uid-keyed.
 */
export async function put(uid: string, blob: Blob, filename?: string): Promise<boolean> {
	if (!uid) return false;
	if (Capacitor.isNativePlatform()) return nativePut(uid, blob, filename);
	const db = await openDb();
	if (!db) return false;
	return new Promise<boolean>((resolve) => {
		try {
			const req = txStore(db, 'readwrite').put(blob, uid);
			req.onsuccess = () => resolve(true);
			req.onerror = () => resolve(false);
		} catch {
			resolve(false);
		}
	});
}

/**
 * Read the Blob for `uid`. Resolves to the Blob (cache hit), null (miss), or null on any
 * error. Never throws.
 *
 * 31-D-13: a stored value that is not a Blob, or is smaller than MIN_BLOB_BYTES, resolves null —
 * indistinguishable from a miss. Deliberately a READ-ONLY gate: it does NOT delete the entry
 * (eviction is the player's audio.error branch, 31-D-12), because restore() reads this on boot
 * before the user has tapped anything and a mutating read there would destroy library state.
 */
export async function get(uid: string): Promise<Blob | null> {
	if (!uid) return null;
	if (Capacitor.isNativePlatform()) return nativeGet(uid);
	const db = await openDb();
	if (!db) return null;
	return new Promise<Blob | null>((resolve) => {
		try {
			const req = txStore(db, 'readonly').get(uid);
			req.onsuccess = () => {
				const v = req.result as Blob | undefined;
				resolve(isUsableBlob(v) ? v : null); // 31-D-13
			};
			req.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

/**
 * quick-260913-jq4: "is there an offline copy for `uid`?" — WITHOUT materializing it.
 *
 * WHY THIS IS NOT `get(uid) !== null`. The UI asks this question on every menu open, and a stored
 * blob is a whole audio file (a lossless track is tens of MB). `get` would pull those bytes into
 * memory just to compare against null. `getKey` answers from the index alone.
 *
 * WHY THE UI ASKS IT AT ALL. `library.isDownloaded` is membership in the downloads REFERENCE list,
 * and `addDownload` deliberately runs BEFORE the fetch (DL-BUG-01: a failed download still leaves
 * the song re-streamable). On top of that the web save is an `<a download>` click, which reports
 * success even when the user cancels the browser's save dialog — the platform exposes no cancel
 * signal. So the list cannot answer "is this actually downloaded" and this can: the offline copy is
 * what makes an offline play work, and it is the one artifact the app can verify.
 *
 * Same never-throws / SSR-guarded posture as the rest of the module: no IDB, no browser, any error
 * → `false` (absent), never a rejection.
 */
export async function has(uid: string): Promise<boolean> {
	if (!uid) return false;
	if (Capacitor.isNativePlatform()) return nativeHas(uid);
	const db = await openDb();
	if (!db) return false;
	return new Promise<boolean>((resolve) => {
		try {
			const req = txStore(db, 'readonly').getKey(uid);
			req.onsuccess = () => resolve(req.result !== undefined);
			req.onerror = () => resolve(false);
		} catch {
			resolve(false);
		}
	});
}

/**
 * Delete the entry for `uid`. Resolves silently on success / miss / failure. Never throws.
 */
export async function del(uid: string): Promise<void> {
	if (!uid) return;
	if (Capacitor.isNativePlatform()) return nativeDel(uid);
	const db = await openDb();
	if (!db) return;
	await new Promise<void>((resolve) => {
		try {
			const req = txStore(db, 'readwrite').delete(uid);
			req.onsuccess = () => resolve();
			req.onerror = () => resolve();
		} catch {
			resolve();
		}
	});
}

/**
 * 34-D-09: record a public `Music/OpenMusic/` content URI for a REAL-source uid so nativeGet /
 * nativeHas can fall back to it when the app-private copy is gone. Never throws.
 *
 * Only real-source uids may be relinked. A DEVICE uid is refused outright (Pitfall 1): the index
 * this writes is the one `nativeDel` reads to pick a MediaStore row to delete, so a device URI in
 * here is a deleted user file waiting for a refactor to find it. The import's merge lane in
 * device-import.ts is the sole caller.
 */
export function linkPublicUri(uid: string, uri: string): void {
	if (!uid || !uri || isDeviceUid(uid)) return;
	setStoredUri(uid, uri);
}

/** Bundled namespace export so callers can `import { blobStore } from '$lib/services/blob-store'`. */
export const blobStore = { put, get, has, del, linkPublicUri };
