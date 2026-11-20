import { describe, it, expect } from 'vitest';
// Import ONLY the PURE module — NO runes, so the node Vitest project compiles it.
import {
	HISTORY_CAP,
	HISTORY_KEY,
	toEntry,
	recordEntry,
	parseHistory,
	type HistoryEntry
} from './history-logic';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// Tiny fixture builder mirroring catalog.test.ts mk(): a full Track with overridable bits.
function mk(source: SourceId, songid: string, extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title: `${source}-${songid}`,
		artist: 'a',
		album: 'alb',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1,
		...extra
	};
}

describe('constants', () => {
	it('caps at ~50 and uses the versioned localStorage key', () => {
		expect(HISTORY_CAP).toBe(50);
		expect(HISTORY_KEY).toBe('openmusic:history:v1');
	});
});

describe('recordEntry', () => {
	it('prepends a new track so it is first; originals follow in order', () => {
		const a = toEntry(mk('netease', 'a'));
		const b = toEntry(mk('qq', 'b'));
		const c = toEntry(mk('kuwo', 'c'));
		const list = recordEntry(recordEntry([a], b), c);
		expect(list.map((e) => e.uid)).toEqual(['kuwo:c', 'qq:b', 'netease:a']);
	});

	it('returns a NEW array (does not mutate the input)', () => {
		const a = toEntry(mk('netease', 'a'));
		const start = [a];
		const next = recordEntry(start, toEntry(mk('qq', 'b')));
		expect(next).not.toBe(start);
		expect(start.map((e) => e.uid)).toEqual(['netease:a']); // input untouched
	});

	it('de-dupes by uid: replaying an existing uid MOVES it to the top, length unchanged', () => {
		const a = toEntry(mk('netease', 'a'));
		const b = toEntry(mk('qq', 'b'));
		const c = toEntry(mk('kuwo', 'c'));
		const list = recordEntry(recordEntry(recordEntry([], a), b), c); // [c, b, a]
		const replayed = recordEntry(list, toEntry(mk('netease', 'a'))); // replay a
		expect(replayed.map((e) => e.uid)).toEqual(['netease:a', 'kuwo:c', 'qq:b']);
		expect(replayed.length).toBe(3); // no duplicate, length unchanged for a known uid
		expect(replayed.filter((e) => e.uid === 'netease:a').length).toBe(1);
	});

	it('caps at HISTORY_CAP: adding the 51st distinct track drops the oldest', () => {
		let list: HistoryEntry[] = [];
		for (let i = 0; i < HISTORY_CAP; i++) list = recordEntry(list, toEntry(mk('netease', `t${i}`)));
		expect(list.length).toBe(HISTORY_CAP);
		// add one more distinct track → still capped, newest first, oldest (t0) dropped
		list = recordEntry(list, toEntry(mk('netease', 'overflow')));
		expect(list.length).toBe(HISTORY_CAP);
		expect(list[0].uid).toBe('netease:overflow');
		expect(list.some((e) => e.uid === 'netease:t0')).toBe(false);
	});

	it('honours an explicit cap argument', () => {
		let list: HistoryEntry[] = [];
		for (let i = 0; i < 5; i++) list = recordEntry(list, toEntry(mk('netease', `t${i}`)), 3);
		expect(list.length).toBe(3);
		expect(list.map((e) => e.uid)).toEqual(['netease:t4', 'netease:t3', 'netease:t2']);
	});
});

describe('toEntry (serialize whitelist)', () => {
	it('keeps the minimal replay slice and OMITS volatile fields', () => {
		const track = mk('joox', 'j1', {
			cover: 'https://cdn/c.jpg',
			quality: 'lossless',
			qualityLabel: 'FLAC',
			keyword: 'kw',
			displayIndex: 7,
			// volatile — must be dropped:
			audioUrl: 'https://cdn/x.mp3',
			lrc: '[00:01]hi',
			lrcUrl: 'https://cdn/x.lrc',
			detailsLoaded: true
		});
		const e = toEntry(track) as unknown as Record<string, unknown>;
		// kept whitelist fields
		expect(e).toEqual({
			uid: 'joox:j1',
			source: 'joox',
			songid: 'j1',
			title: 'joox-j1',
			artist: 'a',
			album: 'alb',
			cover: 'https://cdn/c.jpg',
			quality: 'lossless',
			qualityLabel: 'FLAC',
			keyword: 'kw',
			displayIndex: 7
		});
		// volatile fields omitted
		expect('audioUrl' in e).toBe(false);
		expect('lrc' in e).toBe(false);
		expect('lrcUrl' in e).toBe(false);
		expect('detailsLoaded' in e).toBe(false);
	});
});

describe('parseHistory (round-trip + corrupt input)', () => {
	it('serialize then parse yields the same uids in the same order', () => {
		const list = recordEntry(recordEntry([], toEntry(mk('netease', 'a'))), toEntry(mk('qq', 'b')));
		const raw = JSON.stringify(list);
		const parsed = parseHistory(raw);
		expect(parsed.map((e) => e.uid)).toEqual(list.map((e) => e.uid));
		expect(parsed).toEqual(list);
	});

	it('returns [] for null', () => {
		expect(parseHistory(null)).toEqual([]);
	});

	it('returns [] for malformed JSON', () => {
		expect(parseHistory('{not valid json')).toEqual([]);
	});

	it('returns [] for non-array JSON', () => {
		expect(parseHistory('{"uid":"x"}')).toEqual([]);
		expect(parseHistory('42')).toEqual([]);
		expect(parseHistory('"a string"')).toEqual([]);
	});
});
