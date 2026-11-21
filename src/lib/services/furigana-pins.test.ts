import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getReadingPin, setReadingPin } from './furigana-pins';

// quick-261120-furi — the reading-pin store: the user's pick for one word in
// one line of one song. Node-runnable via an in-memory localStorage stub
// (the lyric-pins.test.ts pattern, no jsdom).

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
	__raw(k: string, v: string): void {
		this.m.set(k, v);
	}
}

const PIN_KEY = 'openmusic:furigana-pins:v1';

describe('furigana-pins — the per-(song, line, word) reading pin store', () => {
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

	it('round-trips a pin', () => {
		setReadingPin('uid1', '明日はきっと晴れる', '明日', 'あす');
		expect(getReadingPin('uid1', '明日はきっと晴れる', '明日')).toBe('あす');
	});

	it('a pin is scoped to its song, its line, and its word', () => {
		setReadingPin('uid1', '明日はきっと晴れる', '明日', 'あす');
		expect(getReadingPin('uid2', '明日はきっと晴れる', '明日')).toBeNull();
		expect(getReadingPin('uid1', '明日の天気', '明日')).toBeNull();
		expect(getReadingPin('uid1', '明日はきっと晴れる', '今日')).toBeNull();
	});

	it('re-pinning replaces the reading', () => {
		setReadingPin('uid1', 'line', '明日', 'あす');
		setReadingPin('uid1', 'line', '明日', 'みょうにち');
		expect(getReadingPin('uid1', 'line', '明日')).toBe('みょうにち');
	});

	it('an empty uid never reads or writes a shared slot', () => {
		setReadingPin('', 'line', '明日', 'あす');
		expect(getReadingPin('', 'line', '明日')).toBeNull();
		expect(store.getItem(PIN_KEY)).toBeNull();
	});

	it('corrupt storage reads as no pin and never throws', () => {
		store.__raw(PIN_KEY, '{not json');
		expect(getReadingPin('uid1', 'line', '明日')).toBeNull();
	});
});
