import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// quick-261120-gsync — STRUCTURAL pins for the gesture tag writer extraction
// (Hector 2026-11-20: "Better be global logic so whole app can trigger/use"), in
// the same source technique as lyrics-settings-sheet.test.ts (no jsdom here).
// The extraction's whole point is ONE function, ONE path:
//   1. The writer + its entry builder live in the service, nowhere else.
//   2. Both callers (TrackMenu's three gestures, the sheet's Use automatic)
//      route through it, with their probe/toast bindings at the call site.
//   3. The gates that made the TrackMenu behaviour safe travel WITH the code:
//      device boundary, download-target resolution, the exact-uid `=== true`
//      probe gate, the twin blob probe, and the failure callback.
const svc = readFileSync('src/lib/services/gesture-tag-sync.ts', 'utf-8');
const menu = readFileSync('src/lib/components/TrackMenu.svelte', 'utf-8');
const sheet = readFileSync('src/lib/components/LyricsSettingsSheet.svelte', 'utf-8');

describe('gesture-tag-sync — the one shared gesture file-tag writer', () => {
	it('the service owns the writer and the entry builder', () => {
		expect(svc).toContain('export function writeTagsForGesture');
		expect(svc).toContain('export function buildFileSyncEntry');
		expect(svc).toContain('syncFileTags(entry)');
	});

	it('no copy is left behind in TrackMenu', () => {
		expect(menu).not.toContain('function writeTagsForGesture');
		expect(menu).not.toContain('function fileSyncEntry');
		expect(menu).toContain("from '$lib/services/gesture-tag-sync'");
	});

	it('the safety gates travel with the writer', () => {
		// device boundary, stated for the track AND the target
		expect(svc).toContain('isDeviceUid(track.uid)');
		expect(svc).toContain('isDeviceUid(target)');
		// the write target is the download uid (twin-aware), never the gesture uid blindly
		expect(svc).toContain('library.downloadUidFor(track)');
		// a supplied probe stays authoritative at === true; an unprobed caller is probed
		expect(svc).toContain('opts.knownBlobPresent === true');
		expect(svc).toContain('await blobStore.has(target).catch(() => false)');
		// failure speaks through the caller, exactly on a real failure
		expect(svc).toContain("if (r !== 'tagged' && r !== 'device-skipped') opts?.onFailure?.()");
	});

	it('the entry builder keeps the sweep-verbatim construction', () => {
		expect(svc).toContain('names.dnTitle(meta.title, meta.artist)');
		expect(svc).toContain('names.dnArtist(meta.artist)');
		expect(svc).toContain('names.zhLock(meta.album)');
		// twin: name fields come from the DOWNLOAD record
		expect(svc).toContain('library.downloads.find((d) => d.uid === targetUid)');
		// lyrics precedence: the record's own read first, then the gesture track's
		expect(svc).toContain('(rec ? readLyrics(rec) : undefined) ??');
		// cover ladder from the shared seams
		expect(svc).toContain('readChosenCover(track.uid, track.artist, track.title)');
		expect(svc).toContain('player.displayCover');
		expect(svc).toContain('readCoverByUidOrName(track.uid, track.artist, track.title)');
	});

	it('TrackMenu routes all three gestures through the service with its probe + toast', () => {
		expect(menu).toContain("writeTagsForGesture(track, { cover: url }, { knownBlobPresent: blobPresent, onFailure:");
		expect(menu).toContain("writeTagsForGesture(track, { lyrics: lrc }, { knownBlobPresent: blobPresent, onFailure:");
		expect(menu).toContain("writeTagsForGesture(track, { lyrics: fallback }, { knownBlobPresent: blobPresent, onFailure:");
		expect(menu).toContain("toast.show(t('toast.tagsFailed'))");
	});

	it('the sheet candidate pick is the menu pick: pin + the same file write', () => {
		// quick-261120-gpick: pickCandidate used to pin in-app ONLY, so a sheet pick
		// and a TrackMenu pick of the same candidate left the downloaded file in
		// different states. The pick now routes through the service with the
		// sheet's binding (no probe — the service probes; failure → tagsFailed).
		expect(sheet).toContain('pinLyrics(track.uid, lrc)');
		expect(sheet).toContain(
			"writeTagsForGesture(track, { lyrics: lrc }, { onFailure: () => toast.show(t('toast.tagsFailed')) });"
		);
	});

	it('the sheet Use automatic is the same reset: unpin + fallback file re-sync', () => {
		expect(sheet).toContain("from '$lib/services/gesture-tag-sync'");
		expect(sheet).toContain('unpinLyrics(track.uid)');
		expect(sheet).toContain(
			'const fallback = readLyrics(player.current?.uid === track.uid ? player.current : track);'
		);
		expect(sheet).toContain('if (fallback) writeTagsForGesture(track, { lyrics: fallback }, { onFailure:');
	});
});
