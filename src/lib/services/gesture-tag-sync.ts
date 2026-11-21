// quick-261120-gsync — THE ONE gesture-driven file tag writer, shared by the whole app.
//
// Extracted from TrackMenu (Hector 2026-11-20: "Better be global logic so whole app can
// trigger/use"), where writeTagsForGesture + its entry builder were component-local.
// Callers: TrackMenu (cover pin / lyric pin / lyric reset) and the LyricsSettingsSheet
// (candidate pick = the same pin; Use automatic = the same reset). The failure toast stays with the CALLERS — services
// in this repo return/signal, the UI localizes (see backup-io) — so a caller passes
// `onFailure` and words it itself.
//
// quick-260919-3j1 (D-1) — THE REWRITE TRIGGER, AND THE LINE NOTHING AUTOMATIC MAY CROSS.
//
// This fires on an EXPLICIT TAP only: a cover pin or a lyric pin, one song, one wasm pass —
// identical in cost and shape to the metadata editor's Save that already ships. An automatic
// cover resolve, `cover-backfill`, `adoptCover` or `healCover` must NEVER reach this line.
// `healCover` alone can fire PER RENDER on a flaky image; rewriting a 27 MB FLAC's tags there
// would be catastrophic. The pin already makes the user's choice permanent in the app without
// touching the file, which is why no automatic path needs this at all.
//
// quick-260919-ejm (D-6) — the device boundary is DELIBERATE, not an echo of a `retagOne`
// guard that has been lifted. A user-file rewrite happens from exactly TWO explicit gestures
// — Edit metadata -> Save, and the confirmed Settings -> Downloads sweep — and a one-tap
// cover or lyric pin is neither: silently rewriting 27 MB of someone's own FLAC as a side
// effect of tapping a thumbnail is not what was authorised. The pin already makes the choice
// permanent IN THE APP for an imported file, which is the whole user-visible benefit, with
// none of the risk. So a device track (or a device target) ends this here, stated, not
// inherited.
//
// FIRE-AND-FORGET: the pin has already repainted every surface, so the file write must never
// block the caller. Success is silent (the caller's pin toast already said it); only a real
// failure speaks, through the caller's `onFailure`.
//
// THE HONEST CEILING: pinning while OFFLINE still writes the text tags, but the ART cannot be
// fetched — `resolveArtworkDataUrl` fails, `tagAudioBlob` then simply runs no picture setter,
// so the file's existing art survives untouched. The Settings -> Downloads sweep repairs it
// later, because that sweep now reads the pin (the other half of this task).
import { library } from '$lib/stores/library.svelte';
import { names } from '$lib/stores/names.svelte';
import { player } from '$lib/stores/player.svelte';
import { readLyrics } from '$lib/stores/lyric-pins.svelte';
import { readChosenCover, readCoverByUidOrName } from '$lib/stores/cover-version.svelte';
import { blobStore } from '$lib/services/blob-store';
import { syncFileTags } from '$lib/services/file-tag-sync';
import { isDeviceUid } from '$lib/services/device-track';
import type { RetagEntry } from '$lib/services/retag';
import type { Track } from '$lib/sources/types';

// The cover ladder for the WRITE path — the same precedence chain TrackMenu's picker ticks
// and the share card carries (pin/crowd → the now-playing reader → the shared cache → the
// stub's art), resolved from the shared seams. 🔴 The cache lookup uses the RAW
// track.artist / track.title, NOT display-language strings — the name layer is matchKey'd
// on raw CATALOG metadata.
function gestureCover(track: Track): string | null {
	return (
		readChosenCover(track.uid, track.artist, track.title) ??
		(player.current?.uid === track.uid ? player.displayCover : null) ??
		readCoverByUidOrName(track.uid, track.artist, track.title) ??
		track.cover ??
		null
	);
}

// quick-260919-3j1 — THE ONE ENTRY BUILDER the pin gestures share, so they cannot drift apart.
// The one thing it must never become is a second copy of the Settings sweep's construction.
//
// D-7: `names.dnTitle` / `dnArtist` / `zhLock` is a VERBATIM copy of that sweep's entry
// (settings/downloads/+page.svelte). `library.applyMetadata` persists an editor edit into
// library.downloads, so `dnTitle(track.title, track.artist)` reproduces the user's OWN edit,
// not the catalog string — a cover pin cannot clobber a manual metadata edit.
//
// NO `filename`: the sticky base recorded by quick-260919-3j1's blob-store index is what keeps
// a user-typed file name from being reverted by a rewrite that knows nothing about it.
//
// `lyrics` is the SAME expression the <MetadataEditor> mount uses, so a cover pin can never
// blank the lyrics the app is currently showing.
//
// quick-261114-fsync: `targetUid` is the DOWNLOAD's uid, which may be a TWIN — the song was
// downloaded under another source's uid than the one the gesture was made on. When it is a
// twin, the entry's uid AND its name fields come from the DOWNLOAD record (the file being
// rewritten is that record's file, and its own strings are the ones an editor edit would have
// persisted there), and the default `lyrics` reads the record first so the rewrite preserves
// the file's own lyrics before falling back to the gesture track's read.
export function buildFileSyncEntry(
	track: Track | null,
	overrides: Partial<RetagEntry>,
	targetUid: string
): RetagEntry | null {
	if (!track?.uid) return null;
	const rec = targetUid !== track.uid ? library.downloads.find((d) => d.uid === targetUid) : undefined;
	const meta = rec ?? track;
	return {
		uid: targetUid,
		title: names.dnTitle(meta.title, meta.artist),
		artist: names.dnArtist(meta.artist),
		album: names.zhLock(meta.album),
		cover: gestureCover(track),
		lyrics:
			(rec ? readLyrics(rec) : undefined) ??
			readLyrics(track && player.current?.uid === track.uid ? player.current : track) ??
			undefined,
		...overrides
	};
}

export function writeTagsForGesture(
	track: Track | null,
	overrides: Partial<RetagEntry>,
	opts?: {
		// A caller that has ALREADY probed the exact-uid blob (TrackMenu probes on open)
		// passes the result and the gate stays exactly `=== true` — never `!== false`:
		// an unprobed caller must not fire a rewrite for a song this app has no copy of.
		// A caller that has not probed (the lyrics sheet) omits it and the service probes
		// `blobStore.has(target)` itself, for the exact-uid case as for the twin case.
		knownBlobPresent?: boolean | null;
		// Invoked once when the write lands a real failure (not 'tagged', not
		// 'device-skipped'). The caller words it (TrackMenu: toast.tagsFailed).
		onFailure?: () => void;
	}
) {
	// quick-260919-ejm (D-6): a device track ends this here — and so does a DEVICE target
	// (downloadUidFor never resolves a catalog track to a device file, but the boundary
	// is stated, not inherited).
	if (!track?.uid || isDeviceUid(track.uid)) return;
	const target = library.downloadUidFor(track);
	if (!target || isDeviceUid(target)) return;
	const trackUid = track.uid;
	// Fire-and-forget, as before — the twin branch just needs one awaited probe first, so
	// the body is an async IIFE rather than a straight-line call.
	void (async () => {
		if (target === trackUid) {
			// the exact-uid gate: a supplied probe is authoritative (`=== true` only);
			// no supplied probe means the service verifies the blob itself.
			const present =
				opts?.knownBlobPresent !== undefined
					? opts.knownBlobPresent === true
					: await blobStore.has(target).catch(() => false);
			if (!present) return;
		} else if (!(await blobStore.has(target).catch(() => false))) {
			return; // the twin record exists but its blob is gone — nothing to write into
		}
		const entry = buildFileSyncEntry(track, overrides, target);
		if (!entry) return;
		const r = await syncFileTags(entry);
		if (r !== 'tagged' && r !== 'device-skipped') opts?.onFailure?.();
	})();
}
