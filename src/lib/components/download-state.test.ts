import { describe, it, expect } from 'vitest';
import {
	downloadState,
	downloadUidForCurrentSource,
	isDownloadedForCurrentSource,
	trackMenuDownloadFace
} from './download-state';

// download-state holds the PURE precedence rule behind the shared download affordance
// (quick-260919-v71), lifted beside the component in the track-menu-gate.ts idiom so it is
// node-testable without a DOM.
//
// THE REGRESSION THIS LOCKS: `library.isDownloaded(uid)` is NOT a "finished" signal.
// `downloadTrack` calls `library.addDownload` BEFORE the fetch by design, so a failed save still
// leaves the song in the library (DL-BUG-01). That makes `downloaded` true for the WHOLE download,
// and DownloadControl tested it before `downloading` — so the DownloadRing was unreachable during
// a real download and the tick appeared the instant the resolve finished. `downloading` is the
// stronger, more specific state and MUST win.

describe('downloadState (quick-260919-v71 precedence)', () => {
	it('downloading + downloaded → busy (addDownload ran pre-fetch; the bytes are still in flight)', () => {
		expect(downloadState({ downloading: true, downloaded: true, unavailable: false })).toBe('busy');
	});

	it('downloading only → busy (album-stub resolve window / localBusy before beginDownload)', () => {
		expect(downloadState({ downloading: true, downloaded: false, unavailable: false })).toBe('busy');
	});

	it('downloaded + unavailable → unavailable (34-D-06: still a download, its file is gone)', () => {
		expect(downloadState({ downloading: false, downloaded: true, unavailable: true })).toBe(
			'unavailable'
		);
	});

	it('downloaded only → downloaded (the finished state: the uid left library.downloading)', () => {
		expect(downloadState({ downloading: false, downloaded: true, unavailable: false })).toBe(
			'downloaded'
		);
	});

	it('nothing set → idle', () => {
		expect(downloadState({ downloading: false, downloaded: false, unavailable: false })).toBe(
			'idle'
		);
	});

	it('unavailable WITHOUT downloaded → idle (unavailable is only meaningful for a download)', () => {
		expect(downloadState({ downloading: false, downloaded: false, unavailable: true })).toBe('idle');
	});
});

// quick-261123-dlsrc (Hector 2026-11-23 04:05, Billy Choi《分擔》): after switching a track's
// source, the menu showed BOTH "✓ Downloaded — MP3 · 6.0 MB" (the OLD source's file) AND
// "Download from source" (the NEW source). Status must follow the CURRENT source only.
describe('current-source download status (quick-261123-dlsrc)', () => {
	const underX = [{ uid: 'netease:1', source: 'netease' }];
	const asY = { uid: 'qq:2', source: 'qq' };
	const asX = { uid: 'netease:1', source: 'netease' };

	it('(1) downloaded under source X, current source = Y → NOT downloaded for the current source', () => {
		expect(isDownloadedForCurrentSource(underX, asY)).toBe(false);
		expect(downloadUidForCurrentSource(underX, asY)).toBeNull();
		// The old-source file remains in the downloads library — it just does not surface.
		expect(underX).toHaveLength(1);
	});

	it('(1) menu face for X-downloaded / Y-current is download-from-source, never downloaded', () => {
		expect(trackMenuDownloadFace({ downloads: underX, track: asY })).toBe('download-from-source');
		expect(trackMenuDownloadFace({ downloads: underX, track: asY, blobPresent: false })).toBe(
			'download-from-source'
		);
	});

	it('(2) current source = X (the downloaded variant) → downloaded, and only downloaded', () => {
		expect(isDownloadedForCurrentSource(underX, asX)).toBe(true);
		expect(downloadUidForCurrentSource(underX, asX)).toBe('netease:1');
		expect(trackMenuDownloadFace({ downloads: underX, track: asX })).toBe('downloaded');
	});

	it('same uid but a mismatched source field is NOT current-source downloaded (variant guard)', () => {
		expect(isDownloadedForCurrentSource(underX, { uid: 'netease:1', source: 'qq' })).toBe(false);
	});

	it('a uid-less stub / null track is never downloaded', () => {
		expect(isDownloadedForCurrentSource(underX, { uid: '', source: 'netease' })).toBe(false);
		expect(isDownloadedForCurrentSource(underX, null)).toBe(false);
		expect(trackMenuDownloadFace({ downloads: underX, track: null })).toBe('download-from-source');
	});

	it('blobPresent (exact-uid blob probe) still counts as the current variant downloaded', () => {
		expect(trackMenuDownloadFace({ downloads: [], track: asY, blobPresent: true })).toBe('downloaded');
	});
});
