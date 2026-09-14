// Device-import identity + the ScanRow → Track mapping (Phase 34, D-01/D-02/D-15/D-16).
//
// A PURE module (mirrors downloads-queue.ts: takes its inputs, returns a Track, imports no store,
// no UI, no Capacitor — node-testable under the single Vitest project). Posture matches the rest of
// lib/services: NEVER THROWS. A malformed row yields an empty string or a null sentinel, never an
// exception into an import loop that is halfway through the user's library.
//
// 34-D-01: `device:` is an identity NAMESPACE, not a source. This module is the ONLY place the
// `'device:'` string literal may appear (outside its own test) — the same single-owner discipline
// match-key.ts has over normalization. Everything else asks `isDeviceUid()`.
//
// `source: 'kuwo'` on an emitted Track is a PLACEHOLDER that is never dispatched. Precedent:
// similar.ts:140 mints name-stubs with `source` set to a placeholder and relies on a short-circuit
// before `SOURCES[source].resolve` is ever reached. The equivalent short-circuit for device tracks
// is the `ensureTrackDetails` guard Plan 34-02 adds at catalog.ts:345 — a device track is already
// `detailsLoaded: true` and its bytes come from blobStore, so no network resolve may run for it.
import type { Track } from '$lib/sources/types';
import { makeUid } from '$lib/sources/types';

/** 34-D-01: the pseudo-source segment of an imported file's uid. */
export const DEVICE_SOURCE = 'device' as const;

/** MediaStore writes this literal into TITLE/ARTIST/ALBUM when it has nothing better. */
export const UNKNOWN_TAG = '<unknown>';

/** Flat row emitted by MediaStoreSaverPlugin.kt scanAudio (one-dimensional, no nested arrays). */
export interface ScanRow {
	id: string; // MediaStore _ID as a string (D-02)
	uri: string; // content://media/external/audio/media/<id> — must equal deviceContentUri(deviceUid(id))
	displayName: string; // e.g. "01. Adele - Hello.mp3"
	relativePath: string; // e.g. "Music/", "Music/OpenMusic/", "Download/" (trailing slash)
	title: string; // MediaStore TITLE column ('' or '<unknown>' when absent)
	artist: string;
	album: string;
	durationMs: number;
	mimeType: string;
	size: number;
	track: number; // 0 when unknown
	year: number; // 0 when unknown
}

/** Result of filename parsing (D-12/D-13). Every field is best-effort; none is trusted over a tag. */
export interface ParsedName {
	title: string;
	artist: string;
	album?: string;
	track?: number;
}

/** 34-D-02: the uid for a MediaStore row. Minted through makeUid so the COLON form stays uniform. */
export function deviceUid(id: string): string {
	return makeUid(DEVICE_SOURCE, id);
}

/** True for a uid in the device namespace. The one test every other module uses. */
export function isDeviceUid(uid: string | null | undefined): boolean {
	return typeof uid === 'string' && uid.startsWith(`${DEVICE_SOURCE}:`);
}

/**
 * Rebuild the MediaStore content URI for a device uid, or null for anything else.
 *
 * The string is exact BY CONSTRUCTION: `MediaStoreSaverPlugin.kt scanAudio` (Plan 34-04) queries
 * `MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)` and emits
 * `ContentUris.withAppendedId(collection, id)`, which is exactly this shape. Reconstructing it means
 * NO device URI is ever persisted, and in particular none can enter the `openmusic-blob-uri` index
 * that `nativeDel` feeds to `deleteFromMusic` (RESEARCH Pitfall 1 — that call deletes the file).
 *
 * T-34-03: only `/^\d+$/` ids are accepted, so no path fragment can be smuggled through a uid into
 * a content URI.
 */
export function deviceContentUri(uid: string): string | null {
	if (!isDeviceUid(uid)) return null;
	const id = uid.slice(DEVICE_SOURCE.length + 1);
	if (!/^\d+$/.test(id)) return null;
	return `content://media/external/audio/media/${id}`;
}

/**
 * A MediaStore tag value, or '' when it is not really a tag.
 *
 * Three non-tags: empty/blank, the literal `<unknown>` placeholder, and — when `stem` is given — a
 * value identical to the display-name stem. MediaStore sets TITLE to the stem for a file with no
 * embedded tag, so a stem-equal TITLE is MediaStore's own fallback, not metadata. Without that rule
 * D-15 ("tags win") would make every untagged `Artist - Title.mp3` import with the whole stem as its
 * title and no artist at all.
 */
export function tagOrEmpty(value: string | null | undefined, stem?: string): string {
	const v = typeof value === 'string' ? value.trim() : '';
	if (!v || v === UNKNOWN_TAG) return '';
	if (stem !== undefined && v === stem.trim()) return '';
	return v;
}

/** `"01. Adele - Hello.mp3"` → `"01. Adele - Hello"`. Extension-less names pass through unchanged. */
function stemOf(displayName: string): string {
	const name = typeof displayName === 'string' ? displayName : '';
	return name.replace(/\.[^.]+$/, '');
}

/**
 * Map one scan row + its parsed filename onto a Track. Pure, total, never throws.
 *
 * The emitted Track is a FINISHED track, not a stub: `detailsLoaded: true` with `audioUrl: null`,
 * because its bytes come from `blobStore.get(uid)` (D-04/D-05 — read in place), never from a
 * network resolve.
 */
export function rowToTrack(row: ScanRow, parsed: ParsedName): Track {
	const stem = stemOf(row?.displayName ?? '');
	// 34-D-15: embedded tags win; filename parsing is the FALLBACK, never an override.
	// 34-D-16: the stem is the last resort so an untagged, unparseable file still imports with a
	// visible title rather than being silently skipped.
	const title = tagOrEmpty(row?.title, stem) || parsed?.title || stem;
	const artist = tagOrEmpty(row?.artist) || parsed?.artist || '';
	const album = tagOrEmpty(row?.album) || parsed?.album || '';
	const id = row?.id ?? '';
	const durationMs = row?.durationMs;
	const track: Track = {
		uid: deviceUid(id),
		// Placeholder, never dispatched — see the header note (similar.ts:140 precedent).
		source: 'kuwo',
		songid: id,
		title,
		artist,
		album,
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		quality: null,
		qualityLabel: null,
		keyword: '',
		displayIndex: 0
	};
	// `duration` is optional and unknown-neutral to scoreMatch — omit the key rather than emit a 0
	// or NaN for a row MediaStore could not measure.
	if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0) {
		track.duration = Math.round(durationMs / 1000);
	}
	return track;
}
