// quick-260924-pgu — the home "Your Radio" shelf's two PURE functions: seed pick + merge.
// They are the only logic in radio.ts; the async builder is glue over the already-tested
// never-throw similarity helpers (fetchSimilarTracks / deezerArtistRadio) and is deliberately
// not unit-tested here. Node-only, no mocks, no network.
import { describe, it, expect } from 'vitest';
import { pickRadioSeeds, mergeRadio } from './radio';
import { matchKey } from './match-key';
import type { HistoryEntry } from '$lib/history/history-logic';
import type { Track } from '$lib/sources/types';

function entry(artist: string, title: string, i: number): HistoryEntry {
	return {
		uid: `h:${i}`,
		source: 'kuwo',
		songid: String(i),
		title,
		artist,
		album: '',
		cover: null,
		quality: null,
		qualityLabel: null,
		keyword: '',
		displayIndex: 0
	};
}

function mk(uid: string, artist: string, title: string): Track {
	return {
		uid,
		source: 'kuwo',
		songid: uid,
		title,
		artist,
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '',
		displayIndex: 0
	};
}

describe('pickRadioSeeds', () => {
	it('keeps the most recent entry per distinct artist, skips blanks, caps at n', () => {
		const a1 = entry('A', 'one', 1);
		const a2 = entry('A', 'two', 2);
		const b = entry(' b ', 'three', 3);
		const blankTitle = entry('C', '', 4);
		const d = entry('D', 'five', 5);
		expect(pickRadioSeeds([a1, a2, b, blankTitle, d], 2)).toEqual([a1, b]);
	});

	it('returns [] for an empty history', () => {
		expect(pickRadioSeeds([], 4)).toEqual([]);
	});
});

describe('mergeRadio', () => {
	const x1 = mk('x1', 'X', 'x one');
	const x2 = mk('x2', 'X', 'x two');
	const y1 = mk('y1', 'Y', 'y one');
	const y2 = mk('y2', 'Y', 'y two');

	it('round-robins across seed lists and drops already-heard songs', () => {
		const heard = new Set([matchKey(y1.artist, y1.title)]);
		expect(mergeRadio([[x1, x2], [y1, y2]], heard, 3)).toEqual([x1, x2, y2]);
	});

	it('dedupes the same uid appearing in two lists', () => {
		expect(mergeRadio([[x1], [x1]], new Set(), 10)).toEqual([x1]);
	});

	it('stops at the cap', () => {
		expect(mergeRadio([[x1, x2], [y1, y2]], new Set(), 1)).toHaveLength(1);
	});

	it('returns [] for no lists', () => {
		expect(mergeRadio([], new Set(), 5)).toEqual([]);
	});
});
