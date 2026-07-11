import { describe, it, expect } from 'vitest';
import {
	recordQuery,
	removeQuery,
	parseSearchHistory,
	SEARCH_HISTORY_CAP,
	SEARCH_HISTORY_KEY,
	type SearchHistoryEntry
} from './search-history-logic';

describe('recordQuery (D-05)', () => {
	it('prepends a new query, most-recent-first', () => {
		const a = recordQuery([], 'jay');
		const b = recordQuery(a, 'eason');
		expect(b.map((e) => e.query)).toEqual(['eason', 'jay']);
	});

	it('de-dupes case-insensitively, moving the re-searched query to the top (single entry)', () => {
		let list: SearchHistoryEntry[] = [];
		list = recordQuery(list, 'Jay');
		list = recordQuery(list, 'eason');
		list = recordQuery(list, 'jay '); // same as 'Jay' after trim + lowercase
		expect(list.map((e) => e.query)).toEqual(['jay', 'eason']);
		// exactly one entry for the jay query
		expect(list.filter((e) => e.query.toLowerCase() === 'jay').length).toBe(1);
	});

	it('ignores empty / whitespace-only queries (returns the list unchanged)', () => {
		const start: SearchHistoryEntry[] = [{ query: 'jay', ts: 1 }];
		expect(recordQuery(start, '')).toBe(start);
		expect(recordQuery(start, '   ')).toBe(start);
	});

	it(`caps at ${SEARCH_HISTORY_CAP}, dropping the oldest`, () => {
		let list: SearchHistoryEntry[] = [];
		for (let i = 0; i < SEARCH_HISTORY_CAP + 5; i++) {
			list = recordQuery(list, `q${i}`);
		}
		expect(list.length).toBe(SEARCH_HISTORY_CAP);
		// newest first, oldest dropped
		expect(list[0].query).toBe(`q${SEARCH_HISTORY_CAP + 4}`);
		expect(list.some((e) => e.query === 'q0')).toBe(false);
	});

	it('never mutates the input list', () => {
		const input: SearchHistoryEntry[] = [{ query: 'jay', ts: 1 }];
		const snapshot = JSON.parse(JSON.stringify(input));
		recordQuery(input, 'eason');
		expect(input).toEqual(snapshot);
	});

	it('trims the stored query but preserves its display casing', () => {
		const list = recordQuery([], '  Jay Chou  ');
		expect(list[0].query).toBe('Jay Chou');
	});
});

describe('removeQuery (quick-260711-sm7 — per-keyword bin)', () => {
	it('removes the matching entry case-insensitively', () => {
		const list: SearchHistoryEntry[] = [
			{ query: 'Jay', ts: 2 },
			{ query: 'eason', ts: 1 }
		];
		expect(removeQuery(list, 'JAY ').map((e) => e.query)).toEqual(['eason']);
	});

	it('returns the list unchanged for an empty / whitespace query', () => {
		const start: SearchHistoryEntry[] = [{ query: 'jay', ts: 1 }];
		expect(removeQuery(start, '')).toBe(start);
		expect(removeQuery(start, '   ')).toBe(start);
	});

	it('is a no-op when nothing matches (new list, same contents)', () => {
		const start: SearchHistoryEntry[] = [{ query: 'jay', ts: 1 }];
		expect(removeQuery(start, 'nope')).toEqual(start);
	});

	it('never mutates the input list', () => {
		const input: SearchHistoryEntry[] = [
			{ query: 'jay', ts: 1 },
			{ query: 'eason', ts: 2 }
		];
		const snapshot = JSON.parse(JSON.stringify(input));
		removeQuery(input, 'jay');
		expect(input).toEqual(snapshot);
	});
});

describe('parseSearchHistory (D-05)', () => {
	it('returns [] on null', () => {
		expect(parseSearchHistory(null)).toEqual([]);
	});

	it('returns [] on corrupt JSON', () => {
		expect(parseSearchHistory('{not json')).toEqual([]);
	});

	it('returns [] on a non-array JSON value', () => {
		expect(parseSearchHistory('{"query":"jay"}')).toEqual([]);
		expect(parseSearchHistory('42')).toEqual([]);
	});

	it('returns the typed entries for a valid array', () => {
		const raw = JSON.stringify([{ query: 'jay', ts: 1 }]);
		expect(parseSearchHistory(raw)).toEqual([{ query: 'jay', ts: 1 }]);
	});
});

describe('D-05 key invariant', () => {
	it('uses a DISTINCT key from the play-history store', () => {
		expect(SEARCH_HISTORY_KEY).toBe('openmusic:search-history:v1');
		expect(SEARCH_HISTORY_KEY).not.toBe('openmusic:history:v1');
	});
});
