import { describe, it, expect } from 'vitest';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';
import { matchKey } from '$lib/services/match-key';
import { seedCover, buildAttachment } from './attached-cover';

// quick-260910-piz: the album-scoped generalisation of quick-260831-t2g. Both helpers are pure
// data — these are node tests with no runes, no DOM, no network.

/** Minimal Track literal; the untested fields are irrelevant to these pure helpers. */
function mk(source: SourceId, songid: string, artist: string, title: string, cover: string | null): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title,
		artist,
		cover,
		audioUrl: 'https://cdn.example.com/a.mp3',
		detailsLoaded: true
	} as Track;
}

const ALBUM = 'https://cdn.dzcdn.net/a.jpg';

describe('seedCover (quick-260910-piz)', () => {
	it('OVERRIDES every cover with the album art — including a track that already had an https one', () => {
		const input = [
			mk('kuwo', 'A1', 'Coldplay', 'Yellow', null),
			mk('kuwo', 'A2', 'Coldplay', 'Trouble', 'https://kuwo/t.jpg'),
			mk('qq', 'A3', 'Coldplay', 'Spies', 'http://y.gtimg.cn/x.jpg')
		];

		const out = seedCover(input, ALBUM);

		expect(out.every((t) => t.cover === ALBUM)).toBe(true);
	});

	it('is a PASS-THROUGH for null / non-https / empty covers — never blanks an existing cover', () => {
		const input = [mk('kuwo', 'A1', 'Coldplay', 'Yellow', 'https://kuwo/t.jpg')];

		expect(seedCover(input, null)).toBe(input);
		expect(seedCover(input, undefined)).toBe(input);
		expect(seedCover(input, 'http://y.gtimg.cn/x.jpg')).toBe(input);
		expect(seedCover(input, '')).toBe(input);
		expect(input[0].cover).toBe('https://kuwo/t.jpg');
	});

	it('preserves identity/order and returns NEW element objects (no input mutation)', () => {
		const input = [
			mk('kuwo', 'A1', 'Coldplay', 'Yellow', null),
			mk('qq', 'A2', 'Coldplay', 'Trouble', null)
		];

		const out = seedCover(input, ALBUM);

		expect(out).toHaveLength(2);
		expect(out.map((t) => t.uid)).toEqual(input.map((t) => t.uid));
		expect(out[0].source).toBe('kuwo');
		expect(out[0].songid).toBe('A1');
		expect(out[0].title).toBe('Yellow');
		expect(out[0].artist).toBe('Coldplay');
		expect(out[0].audioUrl).toBe('https://cdn.example.com/a.mp3');
		expect(out[0]).not.toBe(input[0]);
		expect(input[0].cover).toBeNull(); // input untouched
	});

	it('handles the empty list', () => {
		expect(seedCover([], ALBUM)).toEqual([]);
	});
});

describe('buildAttachment (quick-260910-piz)', () => {
	it('keys EVERY track of the list by song identity, collapsing source variants to one key', () => {
		const tracks = [
			mk('kuwo', 'A1', 'Coldplay', 'Yellow', null),
			mk('qq', 'A1Q', 'Coldplay', 'Yellow', null), // same song, other source → same key
			mk('kuwo', 'A2', 'Coldplay', 'Trouble', null)
		];

		const a = buildAttachment(tracks, ALBUM);

		expect(a?.url).toBe(ALBUM);
		expect(a?.keys.size).toBe(2);
		for (const t of tracks) expect(a?.keys.has(matchKey(t.artist, t.title))).toBe(true);
	});

	it('returns null for null / non-https / empty covers', () => {
		const tracks = [mk('kuwo', 'A1', 'Coldplay', 'Yellow', null)];

		expect(buildAttachment(tracks, null)).toBeNull();
		expect(buildAttachment(tracks, undefined)).toBeNull();
		expect(buildAttachment(tracks, 'http://y.gtimg.cn/x.jpg')).toBeNull();
		expect(buildAttachment(tracks, '')).toBeNull();
	});

	it('an empty list yields an empty key set — harmless, matches nothing', () => {
		const a = buildAttachment([], ALBUM);

		expect(a?.url).toBe(ALBUM);
		expect(a?.keys.size).toBe(0);
	});
});
