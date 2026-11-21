import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createForeverStore, ensurePersistentStorage, __resetPersistLatchForTest } from './record-persist';

// record-persist (quick-261121-canon) is the FOREVER persistence under the canonical
// records: no TTL, no size cap — quota-only eviction that NEVER touches a protected
// (pinned / downloaded) record, plus the one-shot navigator.storage.persist() request.
// Hector 2026-11-21: "these will cache forever and offline ok."

class QuotaStorage {
	private m = new Map<string, string>();
	constructor(private limit: number) {}
	getItem(k: string): string | null {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string): void {
		const total = [...this.m.entries()].reduce((n, [ek, ev]) => n + (ek === k ? 0 : ev.length), 0) + v.length;
		if (total > this.limit) {
			const err = new Error('quota') as Error & { code?: number };
			err.name = 'QuotaExceededError';
			throw err;
		}
		this.m.set(k, String(v));
	}
	removeItem(k: string): void {
		this.m.delete(k);
	}
	clear(): void {
		this.m.clear();
	}
}

type Rec = { at: number; prot: boolean; blob: string };
const makeStore = () =>
	createForeverStore<Rec>('test:forever:v1', { isProtected: (r) => r.prot, stampOf: (r) => r.at });

beforeEach(() => {
	(globalThis as { localStorage?: unknown }).localStorage = new QuotaStorage(1_000_000);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	__resetPersistLatchForTest();
});

describe('createForeverStore', () => {
	it('round-trips with NO expiry — a year later the value reads back identically', () => {
		const store = makeStore();
		const rec = { a: { at: 1, prot: false, blob: 'x' } };
		expect(store.write(rec)).toBe(true);
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 365 * 24 * 60 * 60 * 1000);
		expect(store.read()).toEqual(rec);
	});

	it('quota eviction drops the OLDEST unprotected record and never a protected one', () => {
		(globalThis as { localStorage?: unknown }).localStorage = new QuotaStorage(400);
		const store = makeStore();
		const big = 'y'.repeat(120);
		const all: Record<string, Rec> = {
			old: { at: 1, prot: false, blob: big },
			pinned: { at: 2, prot: true, blob: big },
			fresh: { at: 3, prot: false, blob: big }
		};
		expect(store.write(all)).toBe(true);
		const back = store.read();
		expect(back.pinned).toBeDefined(); // protected survives
		expect(back.fresh).toBeDefined(); // newest survives
		expect(back.old).toBeUndefined(); // oldest unprotected was the victim
	});

	it('when only protected records remain and it still does not fit, the write drops silently', () => {
		(globalThis as { localStorage?: unknown }).localStorage = new QuotaStorage(50);
		const store = makeStore();
		const all: Record<string, Rec> = { pinned: { at: 1, prot: true, blob: 'z'.repeat(200) } };
		expect(store.write(all)).toBe(false); // no throw, nothing evicted
		expect(store.read()).toEqual({});
	});

	it('corrupt storage reads as {} and never throws', () => {
		const s = new QuotaStorage(1_000_000);
		s.setItem('test:forever:v1', '{not json');
		(globalThis as { localStorage?: unknown }).localStorage = s;
		expect(makeStore().read()).toEqual({});
	});
});

describe('ensurePersistentStorage', () => {
	it('requests navigator.storage.persist() exactly once per session', () => {
		const persist = vi.fn(async () => true);
		vi.stubGlobal('navigator', { storage: { persist } });
		ensurePersistentStorage();
		ensurePersistentStorage();
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it('is a silent no-op where the platform has no StorageManager', () => {
		vi.stubGlobal('navigator', {});
		expect(() => ensurePersistentStorage()).not.toThrow();
	});
});
