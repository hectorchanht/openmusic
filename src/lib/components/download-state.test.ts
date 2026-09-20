import { describe, it, expect } from 'vitest';
import { downloadState } from './download-state';

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
