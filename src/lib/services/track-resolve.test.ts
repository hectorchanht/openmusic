import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveTrackRecord } from './track-resolve';
import { getTrackRecord } from './track-record';
import { setCachedCover, setCrowdCoverByName, getCachedCover } from './cover-cache';
import { makeUid, type Track } from '$lib/sources/types';

// track-resolve (quick-261121-canon, brief §2.2) — the ONE TrackRecord resolver. Pinned
// here: the local-feeder merge (cache + crowd, crowd outranks auto), the write-through of
// the AUTO chosen value to the shared name layer (and its absence for a crowd chosen), and
// the hint path merging the instance candidate when the network chain is down.

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
}

const CACHE = 'https://cdn-images.dzcdn.net/images/cover/cache/1000x1000-000000-80-0-0.jpg';
const CROWD = 'https://cdn-images.dzcdn.net/images/cover/crowd/1000x1000-000000-80-0-0.jpg';
const INSTANCE = 'https://cdn-images.dzcdn.net/images/cover/inst/1000x1000-000000-80-0-0.jpg';

beforeEach(() => {
	(globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('resolveTrackRecord — local feeders (no hint)', () => {
	it('merges the shared cache into the record and writes the auto chosen back through', async () => {
		setCachedCover('Adele', 'Hello', CACHE);
		const rec = await resolveTrackRecord('Adele', 'Hello');
		expect(rec?.cover.chosen).toBe(CACHE);
		expect(rec?.cover.candidates.map((c) => c.source)).toContain('cache');
	});

	it('a crowd pick outranks the auto cache and is NOT written into the auto layer', async () => {
		setCachedCover('Adele', 'Hello', CACHE);
		setCrowdCoverByName('Adele', 'Hello', CROWD);
		const rec = await resolveTrackRecord('Adele', 'Hello');
		expect(rec?.cover.chosen).toBe(CROWD);
		// The auto name layer still holds the auto value — crowd art never leaks into it.
		expect(getCachedCover('Adele', 'Hello')).toBe(CACHE);
	});

	it('an empty song identity resolves to null, never a blank record', async () => {
		expect(await resolveTrackRecord('', '')).toBeNull();
		expect(getTrackRecord('', '')).toBeNull();
	});
});

describe('resolveTrackRecord — hint path with the network down', () => {
	it('still merges the instance candidate (the chain failing never blocks the record)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
		const hint = {
			uid: makeUid('netease', '1'),
			source: 'netease',
			songid: '1',
			title: 'Hello',
			artist: 'Adele',
			album: '25',
			cover: INSTANCE,
			lrc: null
		} as unknown as Track;
		const rec = await resolveTrackRecord('Adele', 'Hello', hint);
		expect(rec?.cover.candidates.map((c) => c.url)).toContain(INSTANCE);
		expect(rec?.instances).toContain('netease:1');
	}, 30_000);
});
