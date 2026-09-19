import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPinnedLyrics, setPinnedLyrics, removePinnedLyrics } from './lyric-pins';

// quick-260919-1we — the user's explicit LRC choice, per uid. Structurally the cover pin store plus
// TWO CAPS (D-3 / T-1we-01), and the caps are the whole reason this file exists: localStorage is a
// shared origin quota whose cover-cache writer swallows QuotaExceededError, so an unbounded LRC
// record would surface as "covers silently stopped caching" — miles from the cause. Every assertion
// below is a way a deliberate choice could otherwise be silently lost or a way this feature could
// break something unrelated. Node-runnable via an in-memory localStorage stub (no jsdom).

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

const PIN_KEY = 'openmusic:lyric-pins:v1';

describe('lyric-pins — the bounded user LRC pin store (quick-260919-1we)', () => {
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

	it('an empty uid has no identity — always a miss, even with a "" key on disk', () => {
		expect(getPinnedLyrics('')).toBeNull();
		store.__raw(PIN_KEY, JSON.stringify({ '': '[00:01.00]leaked' }));
		expect(getPinnedLyrics('')).toBeNull();
	});

	it('set → get round-trips the EXACT text (D-2: the value is the LRC, not a source id)', () => {
		const lrc = '[00:00.00]one\n[00:05.00]two';
		setPinnedLyrics('kuwo:1', lrc);
		expect(getPinnedLyrics('kuwo:1')).toBe(lrc);
		expect(getPinnedLyrics('kuwo:unknown')).toBeNull();
	});

	it('blank and whitespace-only picks are no-ops (a blank pick is not a choice)', () => {
		setPinnedLyrics('kuwo:2', '');
		expect(getPinnedLyrics('kuwo:2')).toBeNull();
		setPinnedLyrics('kuwo:2', '   \n\t ');
		expect(getPinnedLyrics('kuwo:2')).toBeNull();
		setPinnedLyrics('', '[00:00.00]x');
		expect(getPinnedLyrics('')).toBeNull();
	});

	it('D-3: an entry over 20 000 chars is REJECTED, and a pre-existing pin survives untouched', () => {
		setPinnedLyrics('qq:3', '[00:00.00]keep me');
		const huge = '[00:00.00]' + 'x'.repeat(20_001);
		setPinnedLyrics('qq:3', huge);
		// Not truncated, not overwritten — rejected outright.
		expect(getPinnedLyrics('qq:3')).toBe('[00:00.00]keep me');
		setPinnedLyrics('qq:4', huge);
		expect(getPinnedLyrics('qq:4')).toBeNull();
		// Exactly at the cap is still accepted (reject is > MAX, not >=).
		const atCap = 'y'.repeat(20_000);
		setPinnedLyrics('qq:5', atCap);
		expect(getPinnedLyrics('qq:5')).toBe(atCap);
	});

	it('D-3: a 101st distinct uid drops the OLDEST key and holds the record at 100', () => {
		for (let i = 0; i < 100; i++) setPinnedLyrics(`kuwo:${i}`, `[00:00.00]line ${i}`);
		expect(Object.keys(JSON.parse(store.getItem(PIN_KEY) as string))).toHaveLength(100);
		expect(getPinnedLyrics('kuwo:0')).toBe('[00:00.00]line 0');

		setPinnedLyrics('kuwo:100', '[00:00.00]line 100');
		const rec = JSON.parse(store.getItem(PIN_KEY) as string) as Record<string, string>;
		expect(Object.keys(rec)).toHaveLength(100);
		expect(getPinnedLyrics('kuwo:0')).toBeNull(); // the oldest went
		expect(getPinnedLyrics('kuwo:1')).toBe('[00:00.00]line 1');
		expect(getPinnedLyrics('kuwo:100')).toBe('[00:00.00]line 100');
	});

	it('re-pinning an EXISTING uid never evicts at the cap (it is an update, not a 101st entry)', () => {
		for (let i = 0; i < 100; i++) setPinnedLyrics(`kuwo:${i}`, `[00:00.00]line ${i}`);
		setPinnedLyrics('kuwo:50', '[00:00.00]changed');
		expect(Object.keys(JSON.parse(store.getItem(PIN_KEY) as string))).toHaveLength(100);
		expect(getPinnedLyrics('kuwo:0')).toBe('[00:00.00]line 0');
		expect(getPinnedLyrics('kuwo:50')).toBe('[00:00.00]changed');
	});

	it('remove drops the pin; removing an absent uid is a true no-op', () => {
		setPinnedLyrics('netease:9', '[00:00.00]x');
		removePinnedLyrics('netease:9');
		expect(getPinnedLyrics('netease:9')).toBeNull();
		expect(() => removePinnedLyrics('netease:nope')).not.toThrow();
		expect(() => removePinnedLyrics('')).not.toThrow();
	});

	it('corrupt JSON / an array read back as {} and do not block a later write', () => {
		store.__raw(PIN_KEY, '{not json');
		expect(getPinnedLyrics('kuwo:1')).toBeNull();
		setPinnedLyrics('kuwo:1', '[00:00.00]x');
		expect(getPinnedLyrics('kuwo:1')).toBe('[00:00.00]x');

		store.__raw(PIN_KEY, JSON.stringify(['not', 'a', 'record']));
		expect(getPinnedLyrics('kuwo:1')).toBeNull();
	});

	it('a throwing localStorage never escapes — reads are null, writes silently do not persist', () => {
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
		expect(getPinnedLyrics('kuwo:1')).toBeNull();
		expect(() => setPinnedLyrics('kuwo:1', '[00:00.00]x')).not.toThrow();
		expect(() => removePinnedLyrics('kuwo:1')).not.toThrow();
	});
});
