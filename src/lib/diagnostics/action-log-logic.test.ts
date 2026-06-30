import { describe, it, expect } from 'vitest';
import {
	ACTION_LOG_CAP,
	ACTION_LOG_KEY,
	appendEntry,
	parseActionLog,
	serializeActionLog,
	type ActionLogEntry
} from './action-log-logic';

describe('action-log constants', () => {
	it('uses the versioned openmusic key + 2000-entry cap', () => {
		expect(ACTION_LOG_KEY).toBe('openmusic:action-log:v1');
		expect(ACTION_LOG_CAP).toBe(2000);
	});
});

describe('parseActionLog', () => {
	it('returns [] for null', () => {
		expect(parseActionLog(null)).toEqual([]);
	});

	it('returns [] for corrupt JSON', () => {
		expect(parseActionLog('{not json')).toEqual([]);
		expect(parseActionLog('not-an-array')).toEqual([]);
	});

	it('returns [] for a non-array JSON value', () => {
		expect(parseActionLog('{"t":1,"ev":"play"}')).toEqual([]);
		expect(parseActionLog('42')).toEqual([]);
	});

	it('drops malformed entries but keeps well-shaped ones', () => {
		const raw = JSON.stringify([
			{ t: 1, ev: 'play' },
			null,
			42,
			{ t: 'nope', ev: 'play' },
			{ t: 2, ev: 'ended', d: { uid: 'x' } }
		]);
		expect(parseActionLog(raw)).toEqual([
			{ t: 1, ev: 'play' },
			{ t: 2, ev: 'ended', d: { uid: 'x' } }
		]);
	});
});

describe('appendEntry', () => {
	it('appends without mutating the input array', () => {
		const before: ActionLogEntry[] = [{ t: 1, ev: 'a' }];
		const after = appendEntry(before, { t: 2, ev: 'b' });
		expect(after).toEqual([
			{ t: 1, ev: 'a' },
			{ t: 2, ev: 'b' }
		]);
		expect(before).toEqual([{ t: 1, ev: 'a' }]); // input untouched
	});

	it('caps at `cap`, dropping the oldest and keeping the newest', () => {
		let entries: ActionLogEntry[] = [];
		for (let i = 0; i < 5; i++) entries = appendEntry(entries, { t: i, ev: `e${i}` }, 3);
		expect(entries).toEqual([
			{ t: 2, ev: 'e2' },
			{ t: 3, ev: 'e3' },
			{ t: 4, ev: 'e4' }
		]);
		expect(entries.length).toBe(3);
	});

	it('defaults to ACTION_LOG_CAP', () => {
		let entries: ActionLogEntry[] = [];
		for (let i = 0; i < ACTION_LOG_CAP + 10; i++) entries = appendEntry(entries, { t: i, ev: 'x' });
		expect(entries.length).toBe(ACTION_LOG_CAP);
		expect(entries[0].t).toBe(10); // first 10 dropped
		expect(entries[entries.length - 1].t).toBe(ACTION_LOG_CAP + 9);
	});
});

describe('serialize round-trip', () => {
	it('serialize → parse is an identity for well-shaped entries', () => {
		const entries: ActionLogEntry[] = [
			{ t: 1, ev: 'play', d: { uid: 'netease-1', source: 'netease', fresh: true } },
			{ t: 2, ev: 'ended', d: { uid: 'netease-1' } },
			{ t: 3, ev: 'advance' }
		];
		expect(parseActionLog(serializeActionLog(entries))).toEqual(entries);
	});
});
