// non-song — built-in non-music audio detection (2026-10-06, Hector).
// Pins the contract: WhatsApp voice notes/audio, user recordings and voice memos are excluded;
// real songs (tagged or "Artist - Title" files) are not.
import { describe, it, expect } from 'vitest';
import { isNonSongFile, hasTaggableMeta } from './non-song';

describe('isNonSongFile', () => {
	it('flags WhatsApp voice notes by filename prefix', () => {
		expect(isNonSongFile('PTT-20261006-WA0001.opus', 'Music/')).toBe(true);
		expect(isNonSongFile('ptt-20240101-wa0002.opus', 'Download/')).toBe(true);
	});
	it('flags WhatsApp audio by filename prefix', () => {
		expect(isNonSongFile('AUD-20261006-WA0001.mp3', 'Music/')).toBe(true);
	});
	it('flags the WhatsApp tree by path', () => {
		expect(isNonSongFile('something.mp3', 'WhatsApp/Media/WhatsApp Voice Notes/')).toBe(true);
	});
	it('flags user recordings', () => {
		expect(isNonSongFile('Recording 001.m4a', 'Music/')).toBe(true);
		expect(isNonSongFile('My Recording.m4a', 'Sounds/')).toBe(true);
		expect(isNonSongFile('Call recording.mp3', 'Download/')).toBe(true);
	});
	it('flags voice memos', () => {
		expect(isNonSongFile('Voice Memo 2026.m4a', 'Music/')).toBe(true);
		expect(isNonSongFile('voicemail.mp3', 'Download/')).toBe(true);
	});
	it('does not flag real songs', () => {
		expect(isNonSongFile('01. Adele - Hello.mp3', 'Music/')).toBe(false);
		expect(isNonSongFile('Hello.mp3', 'Music/')).toBe(false);
		expect(isNonSongFile('周杰倫 - 青花瓷.flac', 'Music/')).toBe(false);
	});
	it('is null-safe', () => {
		expect(isNonSongFile(null, null)).toBe(false);
		expect(isNonSongFile('', '')).toBe(false);
		expect(isNonSongFile(undefined, undefined)).toBe(false);
	});
});

describe('hasTaggableMeta', () => {
	it('passes app downloads (catalog metadata) without inspecting the title', () => {
		expect(hasTaggableMeta({ uid: 'kuwo:123', title: '' })).toBe(true);
		expect(hasTaggableMeta({ uid: 'netease:456', title: 'PTT-20261006-WA0001' })).toBe(true);
	});
	it('passes device files with a real title', () => {
		expect(hasTaggableMeta({ uid: 'device:1', title: 'Hello' })).toBe(true);
		expect(hasTaggableMeta({ uid: 'device:2', title: '青花瓷' })).toBe(true);
	});
	it('rejects device files with no title', () => {
		expect(hasTaggableMeta({ uid: 'device:1', title: '' })).toBe(false);
		expect(hasTaggableMeta({ uid: 'device:1', title: '   ' })).toBe(false);
		expect(hasTaggableMeta({ uid: 'device:1' })).toBe(false);
	});
	it('rejects device files whose title is a non-song stem', () => {
		expect(hasTaggableMeta({ uid: 'device:1', title: 'PTT-20261006-WA0001' })).toBe(false);
		expect(hasTaggableMeta({ uid: 'device:1', title: 'Recording 001' })).toBe(false);
	});
	it('rejects malformed entries', () => {
		expect(hasTaggableMeta({ uid: '' } as never)).toBe(false);
		expect(hasTaggableMeta(null as never)).toBe(false);
	});
});
