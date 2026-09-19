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
// quick-260919-3j1 (D-6): the SAME cap the metadata editor's typed name is already held to. PURE,
// import-free module — no cycle, nothing reactive.
import { MAX_FILENAME_BASE } from './download-filename';

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

// --- quick-260919-3j1 (D-6): the PER-UID STICKY FILE NAME -------------------------------------
//
// WHY. `retagOne` recomputes the on-disk name from title+artist whenever the caller supplies none.
// That was harmless while the editor's Save was the only single-file writer, because the editor
// always passes what the user typed. This task adds three MORE rewrite triggers (a cover pin, a
// lyric pin, the player's automatic lyric embed), and none of them knows anything about a file
// name — so without this index, pinning a cover would silently rename a file the user deliberately
// named hours ago via quick-260919-30x's File name field. The shipped Settings sweep has the same
// hole.
//
// WHAT IS REMEMBERED. Only a name the user TYPED (retag records it solely when the CALLER supplied
// `filename`). A name the app DERIVED is deliberately NOT recorded, so editing the title still
// renames the file exactly as it does today.
//
// Same posture as the URI index above it — localStorage, per-uid key, try/catch'd, never throws.
// T-3j1-01: the stored value is re-sanitized on READ by retag (the fallback sits INSIDE the
// existing `sanitizeFilename(...)` call), so a hand-edited `../evil` can never reach `blobStore.put`.

/** localStorage key for the user-typed base file name (no extension) recorded for `uid`. */
function nameIndexKey(uid: string): string {
	return `openmusic-blob-name:${uid}`;
}

/** The user-typed base name recorded for `uid`, or null. Never throws. */
export function getStoredName(uid: string): string | null {
	if (!uid) return null;
	try {
		return typeof localStorage !== 'undefined' ? localStorage.getItem(nameIndexKey(uid)) : null;
	} catch {
		return null;
	}
}

/**
 * Record the user-typed base name for `uid`. T-3j1-02: a no-op on an empty uid or empty base, and
 * capped at MAX_FILENAME_BASE so the index can never hold a name longer than one that could be
 * written. Never throws.
 */
export function setStoredName(uid: string, base: string): void {
	if (!uid || !base) return;
	try {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(nameIndexKey(uid), String(base).slice(0, MAX_FILENAME_BASE));
		}
	} catch {
		// ignore — the index is a best-effort convenience, exactly like the URI one.
	}
}

/** Drop the recorded name for `uid`. Never throws. */
function clearStoredName(uid: string): void {
	try {
		if (typeof localStorage !== 'undefined') localStorage.removeItem(nameIndexKey(uid));
	} catch {
		// ignore.
	}
}

// --- quick-260919-ejm: THE IN-PLACE REWRITE OF THE USER'S OWN FILE ---------------------------
//
// THE AUTHORISED EXCEPTION, named once so no later audit reads it as a regression. Everything else
// in this module treats an imported `device:` file as READ-ONLY (34 Pitfall 1): `nativeDel` refuses
// one as its first statement, `linkPublicUri` refuses one outright, and `nativePut` has no device
// branch at all. This function is the ONE write capability the app has against a file it does not
// own. The user authorised it explicitly, for exactly one purpose — editing an imported song's
// metadata rewrites THAT file, at its own path, under its own name — and on one condition: every
// failure short of a process death mid-stream leaves the song byte-identical.
//
// It adds NO delete, rename or move capability. `MediaStoreSaver.writeInPlace` never writes
// DISPLAY_NAME / RELATIVE_PATH / DATA (D-7), and `RetagEntry.filename` is ignored on this path.
//
// WHY TEMP-THEN-STREAM RATHER THAN A BACKUP COPY (D-1). A backup of a 27 MB FLAC doubles peak disk
// for every retag and needs an eviction policy nobody will maintain, and it only protects against
// "the new bytes are wrong" — which `retagOne`'s verify-before-write already catches BEFORE
// anything is opened. Temp-then-stream instead puts a COMPLETE, VERIFIED copy of the NEW bytes on
// disk at the moment of the risky write, which is what makes an interrupted write replayable.
//
// THE ONE WINDOW THAT CANNOT BE CLOSED. Truncate-then-write is not atomic, and MediaStore offers no
// rename-into-place for a file the app does not own, so a process death MID-STREAM leaves a partial
// file. The journal below plus the retained temp file are the recovery: the next `overwriteDeviceFile`
// or the next Settings -> Downloads visit re-streams the complete temp over it. Named, not hidden.

/** quick-260919-ejm: `'ok'` wrote the file; `'unsupported'` cannot here; `'failed'` did not write. */
export type DeviceWriteResult = 'ok' | 'unsupported' | 'failed';

/** Optional MediaStore column values + the precondition size, all from the one caller (retagOne). */
export interface DeviceWriteMeta {
	title?: string;
	artist?: string;
	album?: string;
	/** The ORIGINAL file's size, checked Kotlin-side against the row's current SIZE column. */
	expectedBytes?: number;
}

// D-2 — THE PENDING-WRITE JOURNAL. A uid is recorded BEFORE the bridge call and cleared after it,
// so a death in between (or during) is discoverable afterwards, with the temp file as the recovery
// source. Bounded and cleared wholesale on overflow — prewarm.ts's MAX_TRACKED_UIDS idiom: losing
// an entry costs one un-replayed repair, which is cheaper than an LRU nobody will maintain.
//
// ponytail: replay is LAZY — it runs at the top of the next `overwriteDeviceFile` and on the
// Settings -> Downloads mount, and nowhere else. NO app-boot hook, because a file write in the app
// shell's mount is exactly the class of automatic write this codebase has spent three tasks keeping
// out. Upgrade path if device UAT shows a truncated file lingers too long: call
// `replayPendingDeviceWrites()` from the `(app)` layout's existing mount.
const PENDING_KEY = 'openmusic:retag-pending:v1';
const MAX_PENDING = 20;

/** uid -> the size of the temp file that is the recovery source for it. */
type PendingWrites = Record<string, { bytes: number }>;

function readPending(): PendingWrites {
	try {
		if (typeof localStorage === 'undefined') return {};
		const raw = localStorage.getItem(PENDING_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PendingWrites) : {};
	} catch {
		return {};
	}
}

function writePending(rec: PendingWrites): void {
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(PENDING_KEY, JSON.stringify(rec));
	} catch {
		// ignore — a journal that cannot be written costs recovery, never the write itself.
	}
}

/** Record `uid` as mid-write. Clears the whole record on overflow rather than evicting cleverly. */
function markPending(uid: string, bytes: number): void {
	const rec = readPending();
	if (!(uid in rec) && Object.keys(rec).length >= MAX_PENDING) {
		writePending({ [uid]: { bytes } });
		return;
	}
	rec[uid] = { bytes };
	writePending(rec);
}

function clearPending(uid: string): void {
	const rec = readPending();
	if (!(uid in rec)) return;
	delete rec[uid];
	writePending(rec);
}

/**
 * The temp path for `uid`. App-private (`Directory.Data`), same sanitizer `nativePath` uses, so it
 * can never be a user-visible path — and neither can the delete below it.
 */
function tempPath(uid: string): string {
	return `retag-tmp/${uid.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

/**
 * quick-260919-ejm: delete the temp copy for `uid`. This is a NEW `Filesystem.deleteFile` call
 * site, so it is worth being explicit for the quick-260919-30x call-site audit: it targets
 * `Directory.Data/retag-tmp/*` — a file THIS APP wrote milliseconds earlier — and can never name a
 * user file. The user-file delete refusal lives untouched in `nativeDel` above.
 */
async function deleteTemp(uid: string): Promise<void> {
	try {
		await Filesystem.deleteFile({ path: tempPath(uid), directory: NATIVE_DIR });
	} catch {
		// not-found / any failure: swallow, same posture as every other delete in this module.
	}
}

/** The Kotlin reject-code contract. `io:` means a descriptor WAS open and the bytes may be partial. */
function rejectCode(e: unknown): 'unsupported' | 'precheck' | 'denied' | 'io' {
	const msg = String((e as { message?: unknown })?.message ?? e ?? '');
	if (msg.startsWith('unsupported:')) return 'unsupported';
	if (msg.startsWith('precheck:')) return 'precheck';
	if (msg === 'denied' || msg.startsWith('denied')) return 'denied';
	// ANYTHING unrecognised is treated as the dangerous case, never the convenient one: assuming a
	// write did not happen and deleting the only complete copy of the bytes is how a truncated file
	// becomes a permanent one.
	return 'io';
}

/**
 * Finish any write that was interrupted, from its temp file. Never throws, never rejects.
 *
 * Called at the top of `overwriteDeviceFile` and from the Settings -> Downloads mount. The bridge
 * call carries NO `expectedBytes`: after a partial write the row's size no longer matches the
 * original by definition, so the precondition that protects a FRESH write would block the repair.
 * The completeness check that replaces it is the stat below — the temp must still be exactly the
 * size the journal recorded, or it is not a recovery source and the entry is dropped.
 */
export async function replayPendingDeviceWrites(): Promise<void> {
	try {
		if (!Capacitor.isNativePlatform()) return;
		const rec = readPending();
		for (const [uid, entry] of Object.entries(rec)) {
			const target = deviceContentUri(uid);
			if (!target) {
				// Not a device uid, or an id that is not /^\d+$/ — nothing here may ever be written.
				clearPending(uid);
				continue;
			}
			let size = -1;
			try {
				size = Number((await Filesystem.stat({ path: tempPath(uid), directory: NATIVE_DIR }))?.size);
			} catch {
				size = -1;
			}
			if (!Number.isFinite(size) || size <= 0 || size !== entry?.bytes) {
				clearPending(uid);
				await deleteTemp(uid);
				continue;
			}
			try {
				const { uri: sourcePath } = await Filesystem.getUri({ path: tempPath(uid), directory: NATIVE_DIR });
				await MediaStoreSaver.writeInPlace({ uri: target, sourcePath });
				clearPending(uid);
				await deleteTemp(uid);
			} catch (e) {
				// Same contract as the fresh write: only an `io:` failure is worth another attempt.
				if (rejectCode(e) !== 'io') {
					clearPending(uid);
					await deleteTemp(uid);
				}
			}
		}
	} catch {
		// A repair pass that fails is a repair that has not happened yet, never a thrown error into
		// a page mount or a retag loop.
	}
}

/**
 * Rewrite the user's OWN imported file in place: same file, same path, same name, no copy.
 *
 * Ladder rungs 3-10 in order; `retagOne` owns rungs 1-2 (the codec decline and the
 * verify-before-write round trip) so unparseable bytes never reach a file descriptor.
 */
export async function overwriteDeviceFile(uid: string, blob: Blob, meta: DeviceWriteMeta = {}): Promise<DeviceWriteResult> {
	// FIRST STATEMENT, mirroring `nativeDel`'s discipline in the opposite direction: no refactor may
	// slip an app-download uid into the one function that truncates an existing file. `nativePut`
	// has no device short-circuit (the quick-260919-1eh hazard) and this has no real-source one —
	// the two write paths are disjoint by ROUTING, which is why neither needs to guard the other.
	if (!isDeviceUid(uid)) return 'failed';
	if (!Capacitor.isNativePlatform()) return 'unsupported';
	const target = deviceContentUri(uid);
	if (!target) return 'unsupported';
	// Rung 3: the 31-D-13 floor, used here as a WRITE gate rather than a read one. A junk blob must
	// never be the thing that truncates a real song.
	if (!(blob instanceof Blob) || blob.size < MIN_BLOB_BYTES) return 'failed';

	// D-2 recovery point #1. This runs BEFORE the temp path is touched, and deliberately does NOT
	// skip the current uid: the temp file we are about to clobber is the ONLY recovery source for a
	// pending write on this same song, so it gets finished first rather than discarded. One extra
	// stream on a rare path buys a rung that cannot otherwise be closed.
	await replayPendingDeviceWrites();

	const path = tempPath(uid);
	// Rung 4: the temp write. Streams via capacitor-blob-writer (no base64 round-trip — the same
	// WR-02 reasoning `nativePut` documents), to an app-private path. Nothing has opened the user's
	// file yet, so a failure here is byte-identical to never having tried.
	try {
		await write_blob({ path, directory: NATIVE_DIR, blob, recursive: true });
	} catch {
		clearPending(uid);
		await deleteTemp(uid);
		return 'failed';
	}
	// Rung 5: THE COMPLETENESS GATE. A temp file short of the blob's size is not a copy of the new
	// bytes, it is a second way to truncate the song. A stat that rejects counts as incomplete —
	// "could not confirm" is never "confirmed".
	try {
		const size = Number((await Filesystem.stat({ path, directory: NATIVE_DIR }))?.size);
		if (!Number.isFinite(size) || size !== blob.size) {
			clearPending(uid);
			await deleteTemp(uid);
			return 'failed';
		}
	} catch {
		clearPending(uid);
		await deleteTemp(uid);
		return 'failed';
	}

	// Rung 9: recorded BEFORE the bridge call. A death from here on is discoverable, and the temp
	// file beside it is the complete new bytes.
	markPending(uid, blob.size);
	let sourcePath: string;
	try {
		sourcePath = (await Filesystem.getUri({ path, directory: NATIVE_DIR })).uri;
	} catch {
		clearPending(uid);
		await deleteTemp(uid);
		return 'failed';
	}

	try {
		await MediaStoreSaver.writeInPlace({
			uri: target,
			sourcePath,
			// A STRING (the whole param surface is strings, so no numeric-accessor behaviour has to
			// be guessed across Capacitor versions). Omitted entirely when the caller has none —
			// a literal "undefined" would read as a real size and fail every precondition.
			...(typeof meta.expectedBytes === 'number' && Number.isFinite(meta.expectedBytes)
				? { expectedBytes: String(meta.expectedBytes) }
				: {}),
			...(meta.title ? { title: meta.title } : {}),
			...(meta.artist ? { artist: meta.artist } : {}),
			...(meta.album ? { album: meta.album } : {})
		});
	} catch (e) {
		// Rung 8 is the ONLY path that keeps its recovery state. `unsupported:` / `precheck:` /
		// `denied` all mean nothing was written, so the journal entry and the temp are dead weight
		// that would replay a write which was correctly refused.
		const code = rejectCode(e);
		if (code === 'io') return 'failed';
		clearPending(uid);
		await deleteTemp(uid);
		return code === 'unsupported' ? 'unsupported' : 'failed';
	}

	clearPending(uid);
	await deleteTemp(uid);
	return 'ok';
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

/**
 * quick-260919-3j1 (F2): SIZE + the first bytes of a stored file, WITHOUT materialising it.
 *
 * The rule is the one `has`'s doc comment already states: the UI asks on every menu open and a
 * stored blob is a whole audio file (a lossless track is tens of MB), so nothing may pull the bytes
 * into memory to answer a question about them. Twelve bytes is every magic number
 * `containerFromMagic` knows.
 *
 * Native: modelled on `probeContentUri` (open a stream, take what you need, cancel) rather than on
 * `readContentUri` (which materialises). `content-length` is the size; the first chunk off the body
 * reader carries the header. Same URI precedence `nativeGet` uses — see `nativeUri` below.
 *
 * Reading is ALWAYS permitted, including for an imported `device:` file. It is writing, moving and
 * deleting that are refused (34 Pitfall 1) — and an imported file is exactly the case where the
 * app's catalog metadata is thinnest and the file's own numbers are the only truth.
 *
 * Never throws; any failure is null, which the caller renders as "nothing known".
 */
async function nativeStat(uid: string): Promise<{ bytes: number; head: Uint8Array } | null> {
	const uri = await nativeUri(uid);
	if (!uri) return null;
	try {
		const res = await fetch(Capacitor.convertFileSrc(uri));
		if (!res.ok) return null;
		const bytes = Number(res.headers?.get?.('content-length') ?? NaN);
		const reader = res.body?.getReader();
		let head = new Uint8Array(0);
		if (reader) {
			try {
				const { value } = await reader.read();
				if (value) head = value.slice(0, 12);
			} finally {
				// Take the header and drop the rest — a file manager's worth of bytes must not stream
				// behind a label (same posture as probeContentUri's cancel).
				try {
					await reader.cancel();
				} catch {
					// a body that cannot be cancelled is still a readable file — the answer stands.
				}
			}
		}
		// 31-D-13: a truncated copy must stat as absent exactly as it reads as a miss, so the two
		// platforms can never disagree about what "downloaded" means.
		if (!Number.isFinite(bytes) || bytes < MIN_BLOB_BYTES) return null;
		return { bytes, head };
	} catch {
		return null;
	}
}

/**
 * The URI precedence `nativeGet` / `nativeHas` use, lifted so `nativeStat` cannot drift from them:
 * a device uid reads its MediaStore content URI IN PLACE (34-D-05), otherwise the app-private copy
 * (34-D-09 primary), otherwise the recorded public `Music/OpenMusic/` URI. `nativeGet`'s OWN
 * behaviour is unchanged — it still falls back on a READ failure, which a URI alone cannot express,
 * so it keeps its own two-step.
 */
async function nativeUri(uid: string): Promise<string | null> {
	if (isDeviceUid(uid)) return deviceContentUri(uid) || null;
	try {
		const { uri } = await Filesystem.getUri({ path: nativePath(uid), directory: NATIVE_DIR });
		if (uri) return uri;
	} catch {
		// no app-private copy — fall through to the recorded public URI.
	}
	return getStoredUri(uid);
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
 * quick-260919-3j1 (F2): the local file's real SIZE + its first 12 bytes, or null. Never throws.
 *
 * Web: the IDB `get` hands back a LAZY Blob handle, so `blob.size` is free and a 12-byte
 * `slice(0, 12).arrayBuffer()` is the only read — `blob.arrayBuffer()` over the whole file is
 * exactly what this exists to avoid. Reuses `isUsableBlob` so the 31-D-13 floor holds.
 */
export async function stat(uid: string): Promise<{ bytes: number; head: Uint8Array } | null> {
	if (!uid) return null;
	if (Capacitor.isNativePlatform()) return nativeStat(uid);
	const db = await openDb();
	if (!db) return null;
	const blob = await new Promise<Blob | null>((resolve) => {
		try {
			const req = txStore(db, 'readonly').get(uid);
			req.onsuccess = () => {
				const v = req.result as Blob | undefined;
				resolve(isUsableBlob(v) ? v : null);
			};
			req.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
	if (!blob) return null;
	try {
		return { bytes: blob.size, head: new Uint8Array(await blob.slice(0, 12).arrayBuffer()) };
	} catch {
		return null;
	}
}

/**
 * Delete the entry for `uid`. Resolves silently on success / miss / failure. Never throws.
 */
export async function del(uid: string): Promise<void> {
	if (!uid) return;
	// quick-260919-3j1 (T-3j1-02): the name dies with the file, on BOTH platforms. ABOVE the native
	// fork on purpose — nativeDel's device-uid early return would otherwise skip it, leaving an entry
	// that outlives its file and could name the NEXT thing stored under that uid.
	clearStoredName(uid);
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
export const blobStore = { put, get, has, stat, del, linkPublicUri, getStoredName, overwriteDeviceFile };
