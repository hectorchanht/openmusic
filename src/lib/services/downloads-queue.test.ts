import { describe, it, expect } from 'vitest';
import { buildOfflineQueue } from './downloads-queue';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

function mk(source: SourceId, songid: string): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title: `${source}-${songid}`,
		artist: 'A',
		album: '',
		cover: null,
		audioUrl: 'https://cdn/x.mp3',
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1
	};
}

describe('buildOfflineQueue (PLAY-09 / D-07)', () => {
	it('returns the downloads in registry order (most-recent-first preserved)', () => {
		const a = mk('netease', '1');
		const b = mk('qq', '2');
		const out = buildOfflineQueue([a, b]);
		expect(out.map((t) => t.uid)).toEqual([a.uid, b.uid]);
	});

	it('excludes uids already accounted for (current + queue)', () => {
		const a = mk('netease', '1');
		const b = mk('qq', '2');
		const out = buildOfflineQueue([a, b], new Set([a.uid]));
		expect(out.map((t) => t.uid)).toEqual([b.uid]);
	});

	it('dedupes a duplicated registry entry', () => {
		const a = mk('netease', '1');
		const out = buildOfflineQueue([a, a]);
		expect(out).toHaveLength(1);
	});

	it('returns empty for an empty / non-array input (never throws)', () => {
		expect(buildOfflineQueue([])).toEqual([]);
		expect(buildOfflineQueue(undefined as unknown as Track[])).toEqual([]);
	});

	it('skips entries with a falsy uid', () => {
		const a = mk('netease', '1');
		const bad = { ...mk('qq', '2'), uid: '' };
		const out = buildOfflineQueue([bad, a]);
		expect(out.map((t) => t.uid)).toEqual([a.uid]);
	});
});
