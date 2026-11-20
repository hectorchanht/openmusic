import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	readExclusions,
	excludedUids,
	isExcluded,
	excludeUid,
	unexcludeUid
} from './import-exclusions';

// quick-260919-30x — "don't import again", per device: uid. Structurally the lyric-pins store with
// one deliberate divergence (an over-long LABEL truncates where an over-long LRC is rejected), and
// the caps are as load-bearing here as they are there: localStorage is a SHARED origin quota whose
// cover-cache writer swallows QuotaExceededError, so an unbounded record surfaces as "covers
// silently stopped caching", miles from the cause.
//
// Every assertion below is either a way the user's explicit choice could be silently lost, or a way
// this feature could break something unrelated. Node-runnable via an in-memory localStorage stub
// (no jsdom), the harness copied from lyric-pins.test.ts.

class MemStorage {
	private m = new Map<string, string>();
	getItem(k: string): string | null {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string): void {
		this.m.set(k, String(v));
	}
	removeItem(k: string): void {
		this.m.delete(k);
	}
	clear(): void {
		this.m.clear();
	}
	/** Direct write used to plant corrupt JSON / a shared-slot entry. */
	__raw(k: string, v: string): void {
		this.m.set(k, v);
	}
}

const EXCL_KEY = 'openmusic:import-exclusions:v1';

describe('import-exclusions — the bounded "do not import" record (quick-260919-30x)', () => {
	let store: MemStorage;
	const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

	beforeEach(() => {
		store = new MemStorage();
		Object.defineProperty(globalThis, 'localStorage', {
			value: store,
			configurable: true,
			writable: true
		});
	});
	afterEach(() => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: originalLocalStorage,
			configurable: true,
			writable: true
		});
	});

	it('reads {} for absent, non-JSON, array and scalar storage', () => {
		expect(readExclusions()).toEqual({});
		store.__raw(EXCL_KEY, '{not json');
		expect(readExclusions()).toEqual({});
		store.__raw(EXCL_KEY, JSON.stringify(['device:1']));
		expect(readExclusions()).toEqual({});
		store.__raw(EXCL_KEY, JSON.stringify(7));
		expect(readExclusions()).toEqual({});
		store.__raw(EXCL_KEY, JSON.stringify('device:1'));
		expect(readExclusions()).toEqual({});
		store.__raw(EXCL_KEY, JSON.stringify(null));
		expect(readExclusions()).toEqual({});
	});

	it('mark → read round-trips uid and label', () => {
		excludeUid('device:1', 'Adele - Hello');
		expect(readExclusions()).toEqual({ 'device:1': 'Adele - Hello' });
		expect(isExcluded('device:1')).toBe(true);
		expect(isExcluded('device:nope')).toBe(false);
	});

	it('an empty uid has no identity — never marked, never a hit', () => {
		excludeUid('', 'x');
		expect(readExclusions()).toEqual({});
		expect(isExcluded('')).toBe(false);
		// even with a '' key planted on disk (the getPinnedLyrics guard)
		store.__raw(EXCL_KEY, JSON.stringify({ '': 'leaked' }));
		expect(isExcluded('')).toBe(false);
	});

	it('excludedUids() is the key set; {} is the empty set', () => {
		expect(excludedUids()).toEqual(new Set());
		excludeUid('device:1', 'a');
		excludeUid('device:2', 'b');
		const set = excludedUids();
		expect(set).toBeInstanceOf(Set);
		expect(set.has('device:1')).toBe(true);
		expect(set.has('device:2')).toBe(true);
		expect(set.size).toBe(2);
	});

	it('D-2: an over-long label is TRUNCATED, never rejected — the exclusion is the payload', () => {
		const long = 'x'.repeat(500);
		excludeUid('device:3', long);
		const rec = readExclusions();
		expect(rec['device:3']).toHaveLength(120);
		expect(rec['device:3']).toBe('x'.repeat(120));
		expect(isExcluded('device:3')).toBe(true);
		// exactly at the cap is untouched
		const atCap = 'y'.repeat(120);
		excludeUid('device:4', atCap);
		expect(readExclusions()['device:4']).toBe(atCap);
	});

	it('a blank / whitespace-only / non-string label still records the exclusion, with ""', () => {
		excludeUid('device:5', '');
		expect(isExcluded('device:5')).toBe(true);
		expect(readExclusions()['device:5']).toBe('');

		excludeUid('device:6', '   \n\t ');
		expect(isExcluded('device:6')).toBe(true);
		expect(readExclusions()['device:6']).toBe('');

		excludeUid('device:7', undefined as unknown as string);
		expect(isExcluded('device:7')).toBe(true);
		expect(readExclusions()['device:7']).toBe('');
	});

	it('D-2: the 501st entry evicts the FIRST-inserted key and keeps the just-written one', () => {
		for (let i = 0; i < 500; i++) excludeUid(`device:${i}`, `label ${i}`);
		expect(Object.keys(readExclusions())).toHaveLength(500);
		expect(isExcluded('device:0')).toBe(true);

		excludeUid('device:500', 'label 500');
		const rec = readExclusions();
		expect(Object.keys(rec)).toHaveLength(500);
		expect(isExcluded('device:0')).toBe(false); // the oldest MARK went
		expect(isExcluded('device:1')).toBe(true);
		expect(isExcluded('device:500')).toBe(true);
	});

	it('re-marking an existing uid is an update, not a 501st entry', () => {
		for (let i = 0; i < 500; i++) excludeUid(`device:${i}`, `label ${i}`);
		excludeUid('device:250', 'renamed');
		expect(Object.keys(readExclusions())).toHaveLength(500);
		expect(isExcluded('device:0')).toBe(true);
		expect(readExclusions()['device:250']).toBe('renamed');
	});

	it('unexclude removes a present key; an absent key is a true no-op that does not write', () => {
		excludeUid('device:9', 'x');
		unexcludeUid('device:9');
		expect(isExcluded('device:9')).toBe(false);

		store.clear();
		unexcludeUid('device:nope');
		expect(store.getItem(EXCL_KEY)).toBeNull(); // nothing written for a miss
		expect(() => unexcludeUid('')).not.toThrow();
	});

	it('a throwing localStorage never escapes — reads are {}, writes silently do not persist', () => {
		const thrower = {
			getItem() {
				throw new Error('nope');
			},
			setItem() {
				throw new Error('quota');
			},
			removeItem() {
				throw new Error('nope');
			},
			clear() {
				throw new Error('nope');
			}
		};
		Object.defineProperty(globalThis, 'localStorage', {
			value: thrower,
			configurable: true,
			writable: true
		});
		expect(readExclusions()).toEqual({});
		expect(excludedUids()).toEqual(new Set());
		expect(isExcluded('device:1')).toBe(false);
		expect(() => excludeUid('device:1', 'x')).not.toThrow();
		expect(() => unexcludeUid('device:1')).not.toThrow();
	});

	it('a corrupt record does not block a later mark', () => {
		store.__raw(EXCL_KEY, '{not json');
		excludeUid('device:1', 'x');
		expect(isExcluded('device:1')).toBe(true);
	});
});
