// PURE node tests for the persistence codec (quick-260704-3ov). No localStorage mock, no
// player import, no runes — just call the exported functions with plain objects. Covers the
// whitelist strip, the serialize→parse round-trip, a hand-written legacy-shape blob, the
// null/corrupt/no-uid → null sentinels, reshape defaults, seek clamping, and repeatMode
// migration. These are the invariant that proves the localStorage shape stays byte-identical.
import { describe, it, expect } from 'vitest';
import type { Track } from '$lib/sources/types';
import {
	STATE_KEY,
	serializeTrack,
	serializePlayerState,
	parsePlayerState
} from '$lib/stores/player-persist';

// A FULLY-populated Track — every field present, incl. the volatile ones set to
// non-default values (audioUrl / lrc / lrcUrl real, detailsLoaded true) so the
// whitelist-strip and reshape-null assertions are meaningful.
function mk(overrides: Partial<Track> = {}): Track {
	return {
		uid: 'netease-123',
		source: 'netease',
		songid: '123',
		title: 'Title',
		artist: 'Artist',
		album: 'Album',
		cover: 'https://cdn/cover.jpg',
		audioUrl: 'https://cdn/audio.mp3',
		lrc: '[00:00.00] hi',
		lrcUrl: 'https://cdn/lyrics.lrc',
		detailsLoaded: true,
		quality: 'lossless',
		qualityLabel: 'FLAC',
		keyword: 'search term',
		displayIndex: 7,
		...overrides
	};
}

describe('STATE_KEY', () => {
	it('is the load-bearing localStorage key (must not change)', () => {
		expect(STATE_KEY).toBe('openmusic:player:v1');
	});
});

describe('serializeTrack — whitelist', () => {
	it('keeps ONLY the 11 whitelist fields', () => {
		const out = serializeTrack(mk());
		expect(Object.keys(out).sort()).toEqual(
			[
				'album',
				'artist',
				'cover',
				'displayIndex',
				'keyword',
				'quality',
				'qualityLabel',
				'songid',
				'source',
				'title',
				'uid'
			].sort()
		);
	});

	it('preserves the whitelist values verbatim', () => {
		const out = serializeTrack(mk());
		expect(out.uid).toBe('netease-123');
		expect(out.source).toBe('netease');
		expect(out.songid).toBe('123');
		expect(out.title).toBe('Title');
		expect(out.artist).toBe('Artist');
		expect(out.album).toBe('Album');
		expect(out.cover).toBe('https://cdn/cover.jpg');
		expect(out.quality).toBe('lossless');
		expect(out.qualityLabel).toBe('FLAC');
		expect(out.keyword).toBe('search term');
		expect(out.displayIndex).toBe(7);
	});

	it('strips the volatile fields (audioUrl / lrc / lrcUrl / detailsLoaded)', () => {
		const out = serializeTrack(mk());
		expect('audioUrl' in out).toBe(false);
		expect('lrc' in out).toBe(false);
		expect('lrcUrl' in out).toBe(false);
		expect('detailsLoaded' in out).toBe(false);
	});

	it('strips Last.fm / source-specific extras', () => {
		const out = serializeTrack(mk({ tags: ['rock'], bio: 'x' } as Partial<Track>));
		expect('tags' in out).toBe(false);
		expect('bio' in out).toBe(false);
	});
});

describe('serializePlayerState — byte shape', () => {
	it('produces the v:1 envelope with whitelisted current + queue', () => {
		const s = serializePlayerState({
			current: mk(),
			queue: [mk({ uid: 'qq-1', source: 'qq' }), mk({ uid: 'kuwo-2', source: 'kuwo' })],
			currentTime: 42.5,
			shuffle: true,
			repeatMode: 'one'
		});
		const obj = JSON.parse(s);
		expect(obj).toEqual({
			v: 1,
			current: serializeTrack(mk()),
			queue: [
				serializeTrack(mk({ uid: 'qq-1', source: 'qq' })),
				serializeTrack(mk({ uid: 'kuwo-2', source: 'kuwo' }))
			],
			currentTime: 42.5,
			shuffle: true,
			repeatMode: 'one' // passed through unchanged (serializePlayerState does no migration)
		});
	});

	it('never emits volatile fields in the persisted string', () => {
		const s = serializePlayerState({
			current: mk(),
			queue: [mk({ uid: 'qq-1', source: 'qq' })],
			currentTime: 0,
			shuffle: false,
			repeatMode: 'off'
		});
		expect(s).not.toContain('audioUrl');
		expect(s).not.toContain('detailsLoaded');
		expect(s).not.toContain('cdn/audio.mp3');
		expect(s).not.toContain('cdn/lyrics.lrc');
	});
});

describe('parsePlayerState — round trip', () => {
	it('round-trips a serialized snapshot: uid, queue length, seek, shuffle, repeatMode', () => {
		const snapshot = {
			current: mk(),
			queue: [mk({ uid: 'qq-1', source: 'qq' as const }), mk({ uid: 'kuwo-2', source: 'kuwo' as const })],
			currentTime: 42.5,
			shuffle: true,
			repeatMode: 'one' as const
		};
		const parsed = parsePlayerState(serializePlayerState(snapshot));
		expect(parsed).not.toBeNull();
		expect(parsed!.current.uid).toBe(snapshot.current.uid);
		expect(parsed!.queue).toHaveLength(2);
		expect(parsed!.seek).toBe(42.5);
		expect(parsed!.shuffle).toBe(true);
		expect(parsed!.repeatMode).toBe('one');
	});

	it('brings volatile fields back nulled / false (reshape defaults)', () => {
		const parsed = parsePlayerState(
			serializePlayerState({
				current: mk(),
				queue: [mk({ uid: 'qq-1', source: 'qq' })],
				currentTime: 10,
				shuffle: false,
				repeatMode: 'off'
			})
		);
		expect(parsed!.current.audioUrl).toBeNull();
		expect(parsed!.current.lrc).toBeNull();
		expect(parsed!.current.lrcUrl).toBeNull();
		expect(parsed!.current.detailsLoaded).toBe(false);
		expect(parsed!.queue[0].audioUrl).toBeNull();
		expect(parsed!.queue[0].detailsLoaded).toBe(false);
	});

	it('preserves the whitelist values through a round-trip', () => {
		const parsed = parsePlayerState(
			serializePlayerState({
				current: mk(),
				queue: [],
				currentTime: 0,
				shuffle: false,
				repeatMode: 'off'
			})
		);
		expect(parsed!.current.title).toBe('Title');
		expect(parsed!.current.artist).toBe('Artist');
		expect(parsed!.current.album).toBe('Album');
		expect(parsed!.current.cover).toBe('https://cdn/cover.jpg');
		expect(parsed!.current.quality).toBe('lossless');
		expect(parsed!.current.qualityLabel).toBe('FLAC');
		expect(parsed!.current.keyword).toBe('search term');
		expect(parsed!.current.displayIndex).toBe(7);
		expect(parsed!.current.songid).toBe('123');
	});

	it('parses a HAND-WRITTEN legacy-shape blob (the exact seedState payload)', () => {
		// Mirrors player.svelte.test.ts L1160 seedState — the exact on-disk shape today.
		const raw = JSON.stringify({
			v: 1,
			current: {
				uid: 'netease-r1',
				source: 'netease',
				songid: 'r1',
				title: 'Title',
				artist: 'Artist',
				album: 'Album',
				cover: null,
				quality: null,
				qualityLabel: null,
				keyword: '',
				displayIndex: 1
			},
			queue: [],
			currentTime: 0,
			shuffle: false,
			repeatMode: 'one'
		});
		const parsed = parsePlayerState(raw);
		expect(parsed).not.toBeNull();
		expect(parsed!.current.uid).toBe('netease-r1');
		expect(parsed!.repeatMode).toBe('one');
		expect(parsed!.seek).toBe(0);
	});
});

describe('parsePlayerState — null sentinels (never throws)', () => {
	it('null input → null', () => {
		expect(parsePlayerState(null)).toBeNull();
	});

	it('empty string → null', () => {
		expect(parsePlayerState('')).toBeNull();
	});

	it('corrupt JSON → null (does not throw)', () => {
		expect(() => parsePlayerState('not json{')).not.toThrow();
		expect(parsePlayerState('not json{')).toBeNull();
	});

	it('payload with no current.uid → null', () => {
		expect(parsePlayerState('{"v":1,"current":{}}')).toBeNull();
	});

	it('payload with null current → null', () => {
		expect(parsePlayerState('{"v":1,"current":null}')).toBeNull();
	});

	it('payload missing current → null', () => {
		expect(parsePlayerState('{"v":1}')).toBeNull();
	});
});

describe('parsePlayerState — reshape defaults', () => {
	it('a current with a uid but nothing else gets reshape defaults', () => {
		const parsed = parsePlayerState('{"v":1,"current":{"uid":"x-1"}}');
		expect(parsed).not.toBeNull();
		expect(parsed!.current.uid).toBe('x-1');
		expect(parsed!.current.source).toBe('netease');
		expect(parsed!.current.songid).toBe('');
		expect(parsed!.current.title).toBe('');
		expect(parsed!.current.artist).toBe('');
		expect(parsed!.current.album).toBe('');
		expect(parsed!.current.cover).toBeNull();
		expect(parsed!.current.quality).toBeNull();
		expect(parsed!.current.qualityLabel).toBeNull();
		expect(parsed!.current.keyword).toBe('');
		expect(parsed!.current.displayIndex).toBe(1);
		expect(parsed!.current.audioUrl).toBeNull();
		expect(parsed!.current.detailsLoaded).toBe(false);
	});

	it('missing queue defaults to []', () => {
		const parsed = parsePlayerState('{"v":1,"current":{"uid":"x-1"}}');
		expect(parsed!.queue).toEqual([]);
	});
});

describe('parsePlayerState — seek clamp', () => {
	function parseWithTime(currentTime: unknown) {
		return parsePlayerState(
			JSON.stringify({ v: 1, current: { uid: 'x-1' }, currentTime })
		);
	}

	it('negative → 0', () => {
		expect(parseWithTime(-5)!.seek).toBe(0);
	});

	it('NaN-string → 0', () => {
		expect(parseWithTime('abc')!.seek).toBe(0);
	});

	it('undefined → 0', () => {
		expect(parseWithTime(undefined)!.seek).toBe(0);
	});

	it('positive number preserved', () => {
		expect(parseWithTime(61)!.seek).toBe(61);
	});
});

describe('parsePlayerState — repeatMode migration (D-11)', () => {
	function parseWithRepeat(repeatMode: unknown) {
		return parsePlayerState(
			JSON.stringify({ v: 1, current: { uid: 'x-1' }, repeatMode })
		);
	}

	it("'one' → 'one'", () => {
		expect(parseWithRepeat('one')!.repeatMode).toBe('one');
	});

	it("'all' → 'off'", () => {
		expect(parseWithRepeat('all')!.repeatMode).toBe('off');
	});

	it("missing → 'off'", () => {
		expect(parseWithRepeat(undefined)!.repeatMode).toBe('off');
	});

	it("garbage → 'off'", () => {
		expect(parseWithRepeat('garbage')!.repeatMode).toBe('off');
	});
});
