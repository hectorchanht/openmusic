import { describe, it, expect } from 'vitest';
import { APP_LINK_HOST, arrivalMode, deepLinkPath, stubFromUidParam } from './share-arrival';

// share-arrival is the single source of truth for the three PURE decisions a share arrival makes:
// is this device already listening (cold vs warm), does the `?u=` carrier decode to a usable song
// identity, and is an incoming deep-link URL one of ours. Two of the three are security gates
// (T-38-01, T-38-02), so the hostile-input cases below are the point of this file, not an extra.
//
// Explicitly OUT of scope here: `arriveShared()`, the store-facing orchestration plan 04 appends to
// the module — it needs a mocked player and gets its own describe alongside these.

describe('arrivalMode — cold vs warm (D-01 / D-27)', () => {
	it('a seated-but-silent player is COLD — the shared song takes the seat (D-01)', () => {
		// restore() never calls play(), so this is the state almost every share link lands in.
		expect(arrivalMode({ playing: false, loading: false })).toBe('cold');
	});

	it('real audio output is WARM', () => {
		expect(arrivalMode({ playing: true, loading: false })).toBe('warm');
	});

	it('an in-flight resolve is WARM — arming over it would kill the track the user started (D-27)', () => {
		expect(arrivalMode({ playing: false, loading: true })).toBe('warm');
	});

	it('both flags set is WARM', () => {
		expect(arrivalMode({ playing: true, loading: true })).toBe('warm');
	});
});

describe('stubFromUidParam — the `?u=` carrier gate (T-38-01)', () => {
	it('builds the exact stubToTrack field set, with the path names as title/artist', () => {
		expect(stubFromUidParam('kuwo123', 'Adele', 'Hello')).toEqual({
			uid: 'kuwo:123',
			source: 'kuwo',
			songid: '123',
			title: 'Hello',
			artist: 'Adele',
			album: '',
			cover: null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: 'Hello',
			displayIndex: 1
		});
	});

	it('decodes the sources added by 38-D-30', () => {
		expect(stubFromUidParam('audius42', 'A', 'B')?.source).toBe('audius');
	});

	it('an unknown source, junk or a missing value yields null and never throws', () => {
		// The closed-enum allowlist IS the gate: no match → null → the caller falls back to the
		// name resolve (D-10), and no untrusted string ever reaches SOURCES[source].resolve.
		expect(stubFromUidParam('kugou123', 'A', 'B')).toBeNull();
		expect(stubFromUidParam('evil123', 'A', 'B')).toBeNull();
		expect(stubFromUidParam('', 'A', 'B')).toBeNull();
		expect(stubFromUidParam(null, 'A', 'B')).toBeNull();
		expect(stubFromUidParam(undefined, 'A', 'B')).toBeNull();
	});
});

describe('deepLinkPath — the in-app host gate (T-38-02)', () => {
	it('returns pathname + search for one of our own https links', () => {
		expect(deepLinkPath(`https://${APP_LINK_HOST}/song/Adele/Hello?u=kuwo123`)).toBe(
			'/song/Adele/Hello?u=kuwo123'
		);
	});

	it('compares the host case-insensitively', () => {
		expect(deepLinkPath('https://OPENMUSIC.LOL/album/A/B')).toBe('/album/A/B');
	});

	it('drops the fragment — the router never needs it', () => {
		expect(deepLinkPath(`https://${APP_LINK_HOST}/song/x#frag`)).toBe('/song/x');
	});

	it('rejects a look-alike host — the match is EXACT, never a suffix test', () => {
		expect(deepLinkPath('https://evil-openmusic.lol/song/a/b')).toBeNull();
		expect(deepLinkPath('https://openmusic.lol.evil.com/song/a/b')).toBeNull();
	});

	it('rejects an unclaimed host and a non-https scheme (D-23)', () => {
		expect(deepLinkPath('https://openmusic.pages.dev/song/a/b')).toBeNull();
		expect(deepLinkPath(`http://${APP_LINK_HOST}/song/a/b`)).toBeNull();
		expect(deepLinkPath('javascript:alert(1)')).toBeNull();
	});

	it('returns null for an unparseable or missing value rather than throwing', () => {
		expect(deepLinkPath('not a url')).toBeNull();
		expect(deepLinkPath('')).toBeNull();
		expect(deepLinkPath(null)).toBeNull();
		expect(deepLinkPath(undefined)).toBeNull();
	});
});
