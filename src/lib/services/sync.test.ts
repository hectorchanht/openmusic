// sync engine pure-helper tests (quick-261020-acct) — the change hash covers EXACTLY the
// synced key set (a cover-cache write must never look like a settings change), and the
// meta round-trips / degrades on corrupt data. The engine itself is browser/DOM-bound and
// is exercised live; these pin the decision inputs it reads.

import { describe, expect, it } from 'vitest';
import { BACKUP_EXACT_KEYS } from '$lib/backup/backup-logic';
import {
	SYNC_META_KEY,
	diffSyncKeys,
	hashEachKey,
	hashSyncedKeys,
	readSyncMeta,
	writeSyncMeta
} from './sync';

function mapStore(initial: Record<string, string> = {}) {
	const m = new Map(Object.entries(initial));
	return {
		m,
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v)
	};
}

const read =
	(store: ReturnType<typeof mapStore>) =>
	(k: string): string | null =>
		store.m.get(k) ?? null;

describe('hashSyncedKeys', () => {
	it('is stable for identical state and changes when a synced key changes', () => {
		const a = mapStore({ 'openmusic:settings:v1': '{"theme":"dark"}' });
		const b = mapStore({ 'openmusic:settings:v1': '{"theme":"dark"}' });
		const keys = [...a.m.keys()];
		expect(hashSyncedKeys(read(a), keys)).toBe(hashSyncedKeys(read(b), keys));
		b.m.set('openmusic:settings:v1', '{"theme":"light"}');
		expect(hashSyncedKeys(read(b), keys)).not.toBe(hashSyncedKeys(read(a), keys));
	});

	it('ignores keys outside the synced set (cover cache, player queue)', () => {
		const a = mapStore({ 'openmusic:cover-cache:v1': '{"x":1}', 'openmusic:player:v1': '{"q":[]}' });
		const before = hashSyncedKeys(read(a), [...a.m.keys()]);
		a.m.set('openmusic:cover-cache:v1', '{"x":2}');
		a.m.set('openmusic:player:v1', '{"q":[1]}');
		expect(hashSyncedKeys(read(a), [...a.m.keys()])).toBe(before);
	});

	it('covers the name-tr prefix family and every exact key', () => {
		const base: Record<string, string> = { 'openmusic:name-tr:1:zh-Hant': '{"A":"甲"}' };
		for (const k of BACKUP_EXACT_KEYS) base[k] = k.includes('settings') ? '{}' : '[]';
		const a = mapStore({ ...base });
		const before = hashSyncedKeys(read(a), [...a.m.keys()]);
		a.m.set('openmusic:name-tr:1:zh-Hant', '{"A":"乙"}');
		expect(hashSyncedKeys(read(a), [...a.m.keys()])).not.toBe(before);
	});
});

describe('sync meta', () => {
	it('round-trips through the store under SYNC_META_KEY', () => {
		const store = mapStore();
		writeSyncMeta(store, { updatedAt: 123, hashes: { a: 'x', b: 'y' } });
		expect(store.m.has(SYNC_META_KEY)).toBe(true);
		expect(readSyncMeta(store)).toEqual({ updatedAt: 123, hashes: { a: 'x', b: 'y' } });
	});

	it('absent or corrupt meta → null (treated as never synced)', () => {
		expect(readSyncMeta(mapStore())).toBeNull();
		expect(readSyncMeta(mapStore({ [SYNC_META_KEY]: 'not json' }))).toBeNull();
		expect(readSyncMeta(mapStore({ [SYNC_META_KEY]: '{"updatedAt":"x","hashes":1}' }))).toBeNull();
	});

	it('migrates the old aggregate-hash meta to empty per-key hashes (one full re-push)', () => {
		const store = mapStore({ [SYNC_META_KEY]: '{"updatedAt":123,"hash":"abc"}' });
		expect(readSyncMeta(store)).toEqual({ updatedAt: 123, hashes: {} });
	});
});

describe('diffSyncKeys (quick-261020-incsync)', () => {
	const keys = { s: { theme: 'dark' }, h: [1, 2] };
	const hashes = hashEachKey(keys);
	it('returns null when nothing changed (zero network)', () => {
		expect(diffSyncKeys(keys, hashes, { updatedAt: 1, hashes })).toBeNull();
	});
	it('returns only the changed key', () => {
		const k2 = { ...keys, h: [1, 2, 3] };
		const h2 = hashEachKey(k2);
		expect(diffSyncKeys(k2, h2, { updatedAt: 1, hashes })).toEqual({ h: [1, 2, 3] });
	});
	it('returns null tombstone for a key the client no longer carries', () => {
		const k2 = { s: keys.s };
		const h2 = hashEachKey(k2);
		expect(diffSyncKeys(k2, h2, { updatedAt: 1, hashes })).toEqual({ h: null });
	});
	it('treats an unknown key as changed', () => {
		const k2 = { ...keys, n: {} };
		const h2 = hashEachKey(k2);
		expect(diffSyncKeys(k2, h2, { updatedAt: 1, hashes })).toEqual({ n: {} });
	});
});
