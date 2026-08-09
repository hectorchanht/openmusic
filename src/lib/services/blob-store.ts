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

async function nativeGet(uid: string): Promise<Blob | null> {
	try {
		// Read the app-private copy (the offline-read source) WITHOUT a whole-file base64 round-trip
		// (WR-03 — Filesystem.readFile would return the entire file base64-encoded in one string and
		// we'd atob it byte-by-byte, the same OOM spike as the old write path on EVERY offline play).
		// Resolve the file's URI and let the WebView stream it natively via convertFileSrc + fetch —
		// no per-byte JS work, no giant intermediate string.
		const { uri } = await Filesystem.getUri({ path: nativePath(uid), directory: NATIVE_DIR });
		// RAW fetch (not apiFetch — fetch→apiFetch audit): a LOCAL Capacitor file URI, not /api.
		const res = await fetch(Capacitor.convertFileSrc(uri));
		if (!res.ok) return null;
		// 31-D-13: same size floor as the IDB path — a truncated/empty on-disk copy must read as a
		// miss, never be handed to <audio> as a blob: src that can only fire `error`.
		const blob = await res.blob();
		return isUsableBlob(blob) ? blob : null;
	} catch {
		return null;
	}
}

async function nativeDel(uid: string): Promise<void> {
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

/** Bundled namespace export so callers can `import { blobStore } from '$lib/services/blob-store'`. */
export const blobStore = { put, get, del };
