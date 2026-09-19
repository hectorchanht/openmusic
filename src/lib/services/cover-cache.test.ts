import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	coverCacheKey,
	getCachedCover,
	setCachedCover,
	artistCoverCacheKey,
	getCachedArtistCover,
	setCachedArtistCover,
	uidCoverCacheKey,
	getCachedCoverByUid,
	setCachedCoverByUid,
	removeCachedCoverByUid,
	removeCachedCover,
	removeCachedArtistCover,
	coverAgeByUidOrName,
	clearCoverCache,
	getPinnedCover,
	setPinnedCover,
	removePinnedCover
} from './cover-cache';
import { matchKey } from './match-key';

// cover-cache is the pure localStorage-backed store of lazily-resolved CN-source covers
// (quick-260606-rvy FIX-A). Keyed by matchKey(artist,title) so a normalized {artist,title}
// pair maps to one cover URL; the stored value is a flat
// Record<string, { u: string; t: number } | string> (quick-260704-2xq — u=url, t=write-time;
// the bare-string arm is legacy grandfathering). These tests pin the get/set round-trip, the
// matchKey-folding key, the no-op/empty guards, the corrupt/absent-storage graceful-null
// contract, and (2xq) TTL expiry, the write-time-LRU cap, and legacy grandfather + lazy
// upgrade — all node-runnable via an in-memory localStorage stub (no jsdom), mirroring
// match-key.test.ts.

// Minimal in-memory localStorage stub (getItem/setItem on a Map) assigned to globalThis.
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
	// Direct write used to plant corrupt JSON for the corrupt-read test.
	__raw(k: string, v: string): void {
		this.m.set(k, v);
	}
}

const CACHE_KEY = 'openmusic:cover-cache:v1';

describe('cover-cache — pure localStorage cover store (FIX-A)', () => {
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

	it('coverCacheKey delegates to matchKey (artist-first, reused normalization)', () => {
		expect(coverCacheKey('Jay Chou', 'Dao Xiang')).toBe(matchKey('Jay Chou', 'Dao Xiang'));
	});

	it('set → get round-trips a URL', () => {
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/cover.jpg');
		expect(getCachedCover('Jay Chou', 'Dao Xiang')).toBe('https://cdn.example/cover.jpg');
	});

	it('get returns null for an unknown key', () => {
		expect(getCachedCover('Nobody', 'Nothing')).toBeNull();
	});

	it('folds case/whitespace/brackets via the matchKey identity', () => {
		setCachedCover('A', 'B (Live)', 'https://cdn.example/b.jpg');
		// 'a','b' keys identically to 'A','B (Live)' (matchKey folding).
		expect(getCachedCover('a', 'b')).toBe('https://cdn.example/b.jpg');
	});

	it('setCachedCover with an empty / whitespace url is a no-op (get still null)', () => {
		setCachedCover('A', 'B', '');
		expect(getCachedCover('A', 'B')).toBeNull();
		setCachedCover('A', 'B', '   ');
		expect(getCachedCover('A', 'B')).toBeNull();
	});

	it('corrupt JSON in storage → get returns null (no throw)', () => {
		store.__raw(CACHE_KEY, '{not valid json');
		expect(getCachedCover('A', 'B')).toBeNull();
	});

	it('two different songs coexist in one record', () => {
		setCachedCover('Artist One', 'Song One', 'https://cdn.example/one.jpg');
		setCachedCover('Artist Two', 'Song Two', 'https://cdn.example/two.jpg');
		expect(getCachedCover('Artist One', 'Song One')).toBe('https://cdn.example/one.jpg');
		expect(getCachedCover('Artist Two', 'Song Two')).toBe('https://cdn.example/two.jpg');
	});

	it('returns null gracefully when storage is unavailable (no throw)', () => {
		// Simulate a privacy-mode / disabled-storage environment.
		Object.defineProperty(globalThis, 'localStorage', {
			value: undefined,
			configurable: true,
			writable: true
		});
		expect(getCachedCover('A', 'B')).toBeNull();
		expect(() => setCachedCover('A', 'B', 'https://x')).not.toThrow();
	});
});

describe('cover-cache — artist-only cover key (quick-260606-v7k)', () => {
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

	it('artistCoverCacheKey is the pinned `artist:` + matchKey(name, "") form', () => {
		// Pinned so it can NEVER silently change shape / collide with the track key.
		expect(artistCoverCacheKey('Drake')).toBe('artist:' + matchKey('Drake', ''));
	});

	it('the artist key is provably DISTINCT from the track key for the same name', () => {
		// 'Drake' the ARTIST must never collide with a 'Drake'|'<title>' track row.
		expect(artistCoverCacheKey('Drake')).not.toBe(coverCacheKey('Drake', 'Drake'));
		expect(artistCoverCacheKey('Drake')).not.toBe(coverCacheKey('Drake', ''));
	});

	it('set → get round-trips an artist cover URL', () => {
		setCachedArtistCover('Taylor Swift', 'https://cdn.example/ts.jpg');
		expect(getCachedArtistCover('Taylor Swift')).toBe('https://cdn.example/ts.jpg');
	});

	it('get returns null for an unknown artist', () => {
		expect(getCachedArtistCover('Nobody')).toBeNull();
	});

	it('folds case/whitespace via the matchKey identity', () => {
		setCachedArtistCover('Lady Gaga', 'https://cdn.example/lg.jpg');
		expect(getCachedArtistCover('  lady   gaga ')).toBe('https://cdn.example/lg.jpg');
	});

	it('an artist cover does NOT leak into the track lookup for the same name', () => {
		setCachedArtistCover('Drake', 'https://cdn.example/artist.jpg');
		// The track getter (artist+title) must NOT return the artist cover.
		expect(getCachedCover('Drake', 'Drake')).toBeNull();
		expect(getCachedArtistCover('Drake')).toBe('https://cdn.example/artist.jpg');
	});

	it('artist + track entries coexist in the same flat record', () => {
		setCachedArtistCover('Drake', 'https://cdn.example/artist.jpg');
		setCachedCover('Drake', 'Hotline Bling', 'https://cdn.example/track.jpg');
		expect(getCachedArtistCover('Drake')).toBe('https://cdn.example/artist.jpg');
		expect(getCachedCover('Drake', 'Hotline Bling')).toBe('https://cdn.example/track.jpg');
	});

	it('setCachedArtistCover with an empty / whitespace url is a no-op', () => {
		setCachedArtistCover('A', '');
		expect(getCachedArtistCover('A')).toBeNull();
		setCachedArtistCover('A', '   ');
		expect(getCachedArtistCover('A')).toBeNull();
	});

	it('returns null gracefully when storage is unavailable (no throw)', () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: undefined,
			configurable: true,
			writable: true
		});
		expect(getCachedArtistCover('A')).toBeNull();
		expect(() => setCachedArtistCover('A', 'https://x')).not.toThrow();
	});
});

describe('cover-cache — uid cover key (D-13 two-layer, Pitfall 7 colon form)', () => {
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

	it('uidCoverCacheKey is the pinned `uid:` + raw COLON uid form (no hyphen mangling)', () => {
		// Pitfall 7: the key embeds the raw colon-delimited uid exactly as makeUid emitted it.
		expect(uidCoverCacheKey('netease:12345')).toBe('uid:netease:12345');
	});

	it('set → get round-trips a URL by uid (D-13)', () => {
		setCachedCoverByUid('netease:12345', 'https://cdn.example/uid.jpg');
		expect(getCachedCoverByUid('netease:12345')).toBe('https://cdn.example/uid.jpg');
	});

	it('reading with the hyphen form MISSES (colon-delimited uid is stored verbatim — Pitfall 7)', () => {
		setCachedCoverByUid('netease:12345', 'https://cdn.example/uid.jpg');
		// The hyphen form is a different key entirely — no silent delimiter coercion.
		expect(getCachedCoverByUid('netease-12345')).toBeNull();
	});

	it('get returns null for an unknown uid', () => {
		expect(getCachedCoverByUid('netease:99999')).toBeNull();
	});

	it('D-13 read order: uid-first hit wins; falls back to the name entry when uid is absent', () => {
		// uid present → uid hit
		setCachedCoverByUid('netease:12345', 'https://cdn.example/by-uid.jpg');
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/by-name.jpg');
		const readOrder = (uid: string, artist: string, title: string) =>
			getCachedCoverByUid(uid) ?? getCachedCover(artist, title);
		expect(readOrder('netease:12345', 'Jay Chou', 'Dao Xiang')).toBe(
			'https://cdn.example/by-uid.jpg'
		);
		// uid absent → name fallback
		expect(readOrder('netease:00000', 'Jay Chou', 'Dao Xiang')).toBe(
			'https://cdn.example/by-name.jpg'
		);
		// both absent → null
		expect(readOrder('netease:00000', 'Nobody', 'Nothing')).toBeNull();
	});

	it('setCachedCoverByUid with an empty / whitespace url is a no-op (get still null)', () => {
		setCachedCoverByUid('netease:12345', '');
		expect(getCachedCoverByUid('netease:12345')).toBeNull();
		setCachedCoverByUid('netease:12345', '   ');
		expect(getCachedCoverByUid('netease:12345')).toBeNull();
	});

	it('uid + name + artist entries coexist disjointly in the same flat record', () => {
		setCachedCoverByUid('netease:12345', 'https://cdn.example/uid.jpg');
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/name.jpg');
		setCachedArtistCover('Jay Chou', 'https://cdn.example/artist.jpg');
		expect(getCachedCoverByUid('netease:12345')).toBe('https://cdn.example/uid.jpg');
		expect(getCachedCover('Jay Chou', 'Dao Xiang')).toBe('https://cdn.example/name.jpg');
		expect(getCachedArtistCover('Jay Chou')).toBe('https://cdn.example/artist.jpg');
	});

	it('returns null gracefully when storage is unavailable (no throw)', () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: undefined,
			configurable: true,
			writable: true
		});
		expect(getCachedCoverByUid('netease:1')).toBeNull();
		expect(() => setCachedCoverByUid('netease:1', 'https://x')).not.toThrow();
	});
});

describe('cover-cache — per-entry removers (quick-260630-ey2)', () => {
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

	it('removeCachedCoverByUid deletes ONLY the uid key — coexisting name + artist keys untouched', () => {
		setCachedCoverByUid('netease:12345', 'https://cdn.example/uid.jpg');
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/name.jpg');
		setCachedArtistCover('Jay Chou', 'https://cdn.example/artist.jpg');

		removeCachedCoverByUid('netease:12345');

		expect(getCachedCoverByUid('netease:12345')).toBeNull();
		expect(getCachedCover('Jay Chou', 'Dao Xiang')).toBe('https://cdn.example/name.jpg');
		expect(getCachedArtistCover('Jay Chou')).toBe('https://cdn.example/artist.jpg');
	});

	it('removeCachedCover deletes ONLY the name key — coexisting uid + artist keys untouched', () => {
		setCachedCoverByUid('netease:12345', 'https://cdn.example/uid.jpg');
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/name.jpg');
		setCachedArtistCover('Jay Chou', 'https://cdn.example/artist.jpg');

		removeCachedCover('Jay Chou', 'Dao Xiang');

		expect(getCachedCover('Jay Chou', 'Dao Xiang')).toBeNull();
		expect(getCachedCoverByUid('netease:12345')).toBe('https://cdn.example/uid.jpg');
		expect(getCachedArtistCover('Jay Chou')).toBe('https://cdn.example/artist.jpg');
	});

	it('removeCachedArtistCover deletes ONLY the artist key — coexisting track keys untouched', () => {
		setCachedArtistCover('Drake', 'https://cdn.example/artist.jpg');
		setCachedCover('Drake', 'Hotline Bling', 'https://cdn.example/track.jpg');

		removeCachedArtistCover('Drake');

		expect(getCachedArtistCover('Drake')).toBeNull();
		expect(getCachedCover('Drake', 'Hotline Bling')).toBe('https://cdn.example/track.jpg');
	});

	it('removing a MISSING key is a no-op (no throw, other entries unchanged)', () => {
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/name.jpg');
		expect(() => removeCachedCoverByUid('netease:never-set')).not.toThrow();
		expect(() => removeCachedCover('Nobody', 'Nothing')).not.toThrow();
		expect(() => removeCachedArtistCover('Nobody')).not.toThrow();
		// The pre-existing entry is untouched.
		expect(getCachedCover('Jay Chou', 'Dao Xiang')).toBe('https://cdn.example/name.jpg');
	});

	it('matchKey folding parity — removeCachedCover via folded key removes what a folded set wrote', () => {
		// 'A','B (Live)' keys identically to 'a','b' (matchKey folding) — the remover keys the SAME way.
		setCachedCover('A', 'B (Live)', 'https://cdn.example/b.jpg');
		removeCachedCover('a', 'b');
		expect(getCachedCover('A', 'B (Live)')).toBeNull();
	});

	it('removeCachedCoverByUid keys by the RAW colon uid (no hyphen folding — Pitfall 7)', () => {
		setCachedCoverByUid('netease:12345', 'https://cdn.example/uid.jpg');
		// The hyphen form is a DIFFERENT key — removing it must NOT evict the colon entry.
		removeCachedCoverByUid('netease-12345');
		expect(getCachedCoverByUid('netease:12345')).toBe('https://cdn.example/uid.jpg');
		// The verbatim colon form evicts it.
		removeCachedCoverByUid('netease:12345');
		expect(getCachedCoverByUid('netease:12345')).toBeNull();
	});

	it('never throws when storage is unavailable (privacy mode)', () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: undefined,
			configurable: true,
			writable: true
		});
		expect(() => removeCachedCoverByUid('netease:1')).not.toThrow();
		expect(() => removeCachedCover('A', 'B')).not.toThrow();
		expect(() => removeCachedArtistCover('A')).not.toThrow();
	});

	it('never throws when stored JSON is corrupt', () => {
		store.__raw(CACHE_KEY, '{not valid json');
		expect(() => removeCachedCoverByUid('netease:1')).not.toThrow();
		expect(() => removeCachedCover('A', 'B')).not.toThrow();
		expect(() => removeCachedArtistCover('A')).not.toThrow();
	});
});

// TTL + write-time-LRU cap + legacy grandfathering over the {u,t} entry shape (quick-260704-2xq).
// These cases scope fake timers to THIS block only (real clock elsewhere) so the pure suites above
// keep their real-clock behavior. TTL_MS / MAX_ENTRIES are pinned LOCALLY (the module constants are
// private) with a comment so a future value change forces a conscious test update.
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — MUST mirror cover-cache.ts TTL_MS
const MAX_ENTRIES = 2000; // MUST mirror cover-cache.ts MAX_ENTRIES

describe('cover-cache — TTL expiry, LRU cap, legacy grandfathering (quick-260704-2xq)', () => {
	let store: MemStorage;
	const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
	const T0 = 1_700_000_000_000; // a fixed base time (ms)

	beforeEach(() => {
		store = new MemStorage();
		Object.defineProperty(globalThis, 'localStorage', {
			value: store,
			configurable: true,
			writable: true
		});
		vi.useFakeTimers();
		vi.setSystemTime(T0);
	});
	afterEach(() => {
		vi.useRealTimers();
		Object.defineProperty(globalThis, 'localStorage', {
			value: originalLocalStorage,
			configurable: true,
			writable: true
		});
	});

	// (a) Fresh write is readable NOW — anchors the TTL block; round-trips through the {u,t} shape.
	it('a cover written now is readable now (fresh write → hit)', () => {
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/fresh.jpg');
		expect(getCachedCover('Jay Chou', 'Dao Xiang')).toBe('https://cdn.example/fresh.jpg');
	});

	// (b) TTL expiry: strictly older than TTL reads as a MISS.
	it('an entry older than TTL_MS reads as a MISS (proactive expiry)', () => {
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/old.jpg');
		vi.setSystemTime(T0 + TTL_MS + 1); // strictly past TTL
		expect(getCachedCover('Jay Chou', 'Dao Xiang')).toBeNull();
	});

	// (b) Boundary: at EXACTLY T0 + TTL_MS the entry is still a HIT (pins the strict `>` comparison).
	it('an entry read at exactly T0 + TTL_MS is still a HIT (strict `>` boundary)', () => {
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/edge.jpg');
		vi.setSystemTime(T0 + TTL_MS); // exactly at the boundary — not yet strictly greater
		expect(getCachedCover('Jay Chou', 'Dao Xiang')).toBe('https://cdn.example/edge.jpg');
	});

	// (b) Pure-read contract: an expired read returns null WITHOUT deleting the entry from disk.
	it('reading an expired entry does NOT delete it (pure read — no write side-effect)', () => {
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/pure.jpg');
		vi.setSystemTime(T0 + TTL_MS + 1);
		expect(getCachedCover('Jay Chou', 'Dao Xiang')).toBeNull(); // expired MISS
		// Inspect the raw record: the expired entry MUST still be present (readKey never wrote).
		const rec = JSON.parse(store.getItem(CACHE_KEY) as string) as Record<string, unknown>;
		const key = coverCacheKey('Jay Chou', 'Dao Xiang');
		expect(rec[key]).toEqual({ u: 'https://cdn.example/pure.jpg', t: T0 });
	});

	// (c) Cap eviction (oldest-write-first): write past the real cap, assert newest survive + oldest gone.
	it('writing past MAX_ENTRIES evicts oldest-write entries first and keeps the newest', () => {
		// Pins the REAL cap (2000) and asserts the eviction ORDER (oldest-t evicted, newest-t kept)
		// rather than an arbitrary small cap — write MAX_ENTRIES + 5 uid keys at strictly increasing t.
		const overflow = 5;
		for (let i = 0; i < MAX_ENTRIES + overflow; i++) {
			vi.setSystemTime(T0 + i); // strictly increasing write-time so `t` orders deterministically
			setCachedCoverByUid(`netease:${i}`, `https://cdn.example/${i}.jpg`);
		}
		vi.setSystemTime(T0 + MAX_ENTRIES + overflow); // read within TTL (writes were only ms apart)
		// The very oldest-written keys (0..overflow-1) were evicted first.
		for (let i = 0; i < overflow; i++) {
			expect(getCachedCoverByUid(`netease:${i}`)).toBeNull();
		}
		// The newest keys survive.
		expect(getCachedCoverByUid(`netease:${MAX_ENTRIES + overflow - 1}`)).toBe(
			`https://cdn.example/${MAX_ENTRIES + overflow - 1}.jpg`
		);
		expect(getCachedCoverByUid(`netease:${overflow}`)).toBe(`https://cdn.example/${overflow}.jpg`);
		// The record is trimmed at/under the cap.
		const rec = JSON.parse(store.getItem(CACHE_KEY) as string) as Record<string, unknown>;
		expect(Object.keys(rec).length).toBeLessThanOrEqual(MAX_ENTRIES);
	});

	// (d) Legacy grandfathering: a bare-string value is a valid, TTL-EXEMPT hit even far past TTL.
	it('a legacy bare-string entry reads as a HIT (grandfathered, never expired)', () => {
		const key = coverCacheKey('A', 'B');
		store.__raw(CACHE_KEY, JSON.stringify({ [key]: 'https://legacy/cover.jpg' }));
		// Advance far past TTL — a legacy entry has no `t`, so it is TTL-exempt.
		vi.setSystemTime(T0 + TTL_MS * 10);
		expect(getCachedCover('A', 'B')).toBe('https://legacy/cover.jpg');
	});

	// (d) Lazy upgrade: the next write for a legacy key rewrites it as an {u,t} object.
	it('a legacy bare-string entry is rewritten to {u,t} on its next write (lazy upgrade)', () => {
		const key = coverCacheKey('A', 'B');
		store.__raw(CACHE_KEY, JSON.stringify({ [key]: 'https://legacy/cover.jpg' }));
		vi.setSystemTime(T0 + 5);
		setCachedCover('A', 'B', 'https://new/cover.jpg');
		// (i) read now returns the new URL
		expect(getCachedCover('A', 'B')).toBe('https://new/cover.jpg');
		// (ii) the raw entry is now an OBJECT with u + numeric t (upgraded shape)
		const rec = JSON.parse(store.getItem(CACHE_KEY) as string) as Record<
			string,
			{ u: string; t: number }
		>;
		expect(rec[key]).toEqual({ u: 'https://new/cover.jpg', t: T0 + 5 });
	});

	// (d) Cap ordering: a legacy entry evicts FIRST (treated as the oldest, t = -Infinity).
	it('a legacy entry is evicted FIRST when writing past the cap (sorts as oldest)', () => {
		const legacyKey = coverCacheKey('Legacy', 'One');
		// Seed a full record: one legacy bare string + (MAX_ENTRIES - 1) fresh {u,t} entries, all
		// at strictly increasing t so only the legacy (t = -Infinity) is the eviction candidate.
		const seed: Record<string, unknown> = { [legacyKey]: 'https://legacy/evict-me.jpg' };
		for (let i = 0; i < MAX_ENTRIES - 1; i++) {
			seed[uidCoverCacheKey(`netease:${i}`)] = { u: `https://cdn.example/${i}.jpg`, t: T0 + i };
		}
		store.__raw(CACHE_KEY, JSON.stringify(seed)); // exactly at the cap now
		vi.setSystemTime(T0 + MAX_ENTRIES); // one more, newest — pushes size to cap + 1
		setCachedCoverByUid('netease:newest', 'https://cdn.example/newest.jpg');
		// The legacy (oldest) entry was evicted; the newest survives.
		expect(getCachedCover('Legacy', 'One')).toBeNull();
		expect(getCachedCoverByUid('netease:newest')).toBe('https://cdn.example/newest.jpg');
		const rec = JSON.parse(store.getItem(CACHE_KEY) as string) as Record<string, unknown>;
		expect(Object.keys(rec).length).toBeLessThanOrEqual(MAX_ENTRIES);
	});

	// (e) Three key families coexist under the timestamped shape (no cross-family collision).
	it('uid / name / artist families coexist under the {u,t} shape (no collision)', () => {
		setCachedCoverByUid('netease:12345', 'https://cdn.example/uid.jpg');
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/name.jpg');
		setCachedArtistCover('Jay Chou', 'https://cdn.example/artist.jpg');
		vi.setSystemTime(T0 + 60_000); // advance a little, still well within TTL
		expect(getCachedCoverByUid('netease:12345')).toBe('https://cdn.example/uid.jpg');
		expect(getCachedCover('Jay Chou', 'Dao Xiang')).toBe('https://cdn.example/name.jpg');
		expect(getCachedArtistCover('Jay Chou')).toBe('https://cdn.example/artist.jpg');
	});

	// (f) Corrupt / unavailable storage still returns null / no-ops through the new cap-eviction path.
	it('a write into corrupt storage does not throw and a subsequent read is null', () => {
		store.__raw(CACHE_KEY, '{not valid json'); // corrupt — readRecord returns {}
		expect(() => setCachedCover('A', 'B', 'https://x')).not.toThrow();
		// The write recovered from {} and stored a valid entry.
		expect(getCachedCover('A', 'B')).toBe('https://x');
	});

	it('a setItem that throws mid-cap-eviction is swallowed (never throws)', () => {
		// Force setItem to throw (quota-style) so the try/catch around the cap-eviction path is exercised.
		const throwing = new MemStorage();
		throwing.setItem = () => {
			throw new Error('QuotaExceededError');
		};
		Object.defineProperty(globalThis, 'localStorage', {
			value: throwing,
			configurable: true,
			writable: true
		});
		expect(() => setCachedCover('A', 'B', 'https://x')).not.toThrow();
	});
});

// coverAgeByUidOrName — the pure freshness reader lazyCover uses to decide whether a WARM cache HIT
// is fresh enough to paint WITHOUT the new Image() self-heal probe (quick-260704-4fr, backlog #8).
// It mirrors the URL readers' uid-first → name read order + the SAME 14-day TTL guard, honors the
// empty-uid guard (an empty uid never reads the shared 'uid:' slot), and returns the RAW age in ms
// (Date.now() - t) for the first fresh {u,t} hit — null for miss / legacy-bare-string / expired. Like
// the 2xq block, fake timers are scoped HERE only; TTL_MS is pinned locally with the "MUST mirror"
// comment (the module constant is private).
const TTL_MS_4FR = 14 * 24 * 60 * 60 * 1000; // 14 days — MUST mirror cover-cache.ts TTL_MS

describe('cover-cache — coverAgeByUidOrName freshness reader (quick-260704-4fr)', () => {
	let store: MemStorage;
	const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
	const T0 = 1_700_000_000_000; // a fixed base time (ms)

	beforeEach(() => {
		store = new MemStorage();
		Object.defineProperty(globalThis, 'localStorage', {
			value: store,
			configurable: true,
			writable: true
		});
		vi.useFakeTimers();
		vi.setSystemTime(T0);
	});
	afterEach(() => {
		vi.useRealTimers();
		Object.defineProperty(globalThis, 'localStorage', {
			value: originalLocalStorage,
			configurable: true,
			writable: true
		});
	});

	// (A) A fresh {u,t} write, read a small delta later, returns exactly that delta (raw age in ms).
	it('returns the raw age (ms since write) for a fresh {u,t} uid hit', () => {
		setCachedCoverByUid('netease:12345', 'https://cdn.example/fresh.jpg');
		vi.setSystemTime(T0 + 60_000); // 60s later
		expect(coverAgeByUidOrName('netease:12345', 'x', 'y')).toBe(60_000);
	});

	// (B) No entry anywhere (unknown uid + unknown name) → null.
	it('returns null on a total miss (unknown uid + unknown name)', () => {
		expect(coverAgeByUidOrName('netease:99999', 'Nobody', 'Nothing')).toBeNull();
	});

	// (C) Expired → null; boundary at exactly T0 + TTL_MS is still a HIT (mirrors the URL reader's `>`).
	it('an entry strictly older than TTL_MS reads as null (expired)', () => {
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/old.jpg');
		vi.setSystemTime(T0 + TTL_MS_4FR + 1); // strictly past TTL
		expect(coverAgeByUidOrName('', 'Jay Chou', 'Dao Xiang')).toBeNull();
	});

	it('at exactly T0 + TTL_MS the age IS returned (strict `>` boundary, mirrors the URL reader)', () => {
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/edge.jpg');
		vi.setSystemTime(T0 + TTL_MS_4FR); // exactly at the boundary — not yet strictly greater
		expect(coverAgeByUidOrName('', 'Jay Chou', 'Dao Xiang')).toBe(TTL_MS_4FR);
	});

	// (D) Legacy bare-string entry → null (no timestamp, freshness unknowable) even though the URL
	// reader would HIT it.
	it('a legacy bare-string entry returns null (freshness unknowable) even though getCachedCover hits it', () => {
		const key = coverCacheKey('A', 'B');
		store.__raw(CACHE_KEY, JSON.stringify({ [key]: 'https://legacy/cover.jpg' }));
		vi.setSystemTime(T0 + 5);
		// The URL reader still HITS the legacy value (TTL-exempt grandfathered)...
		expect(getCachedCover('A', 'B')).toBe('https://legacy/cover.jpg');
		// ...but the freshness reader cannot know its age → null (so lazyCover keeps the probe path).
		expect(coverAgeByUidOrName('', 'A', 'B')).toBeNull();
	});

	// (E-i) uid-first → name order: with BOTH a fresh uid entry and a fresh name entry at different
	// write-times, the UID age wins.
	it('uid-first order: the uid age wins when both a uid and a name entry are fresh', () => {
		setCachedCoverByUid('netease:12345', 'https://cdn.example/by-uid.jpg'); // written at T0
		vi.setSystemTime(T0 + 10_000);
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/by-name.jpg'); // written at T0+10s
		vi.setSystemTime(T0 + 30_000);
		// uid age = 30_000 (T0), name age = 20_000 (T0+10s) — the uid layer is consulted FIRST and wins.
		expect(coverAgeByUidOrName('netease:12345', 'Jay Chou', 'Dao Xiang')).toBe(30_000);
	});

	// (E-ii) uid absent → the name age is returned (name-layer fallback).
	it('falls back to the name age when the uid layer is absent', () => {
		setCachedCover('Jay Chou', 'Dao Xiang', 'https://cdn.example/by-name.jpg');
		vi.setSystemTime(T0 + 45_000);
		expect(coverAgeByUidOrName('netease:00000', 'Jay Chou', 'Dao Xiang')).toBe(45_000);
	});

	// (E-iii) empty-uid guard: with uid '' the uid layer is NOT consulted — a poisoned 'uid:' slot is
	// IGNORED and the NAME age is returned (proves the empty uid reads only the name layer).
	it('empty-uid guard: a poisoned bare "uid:" slot is ignored; the name age is returned', () => {
		const nameKey = coverCacheKey('Foo Fighters', 'Everlong');
		// Plant a poisoned shared 'uid:' slot AND a fresh name entry (both {u,t} at T0).
		store.__raw(
			CACHE_KEY,
			JSON.stringify({
				'uid:': { u: 'https://poison.example/uid-slot.jpg', t: T0 },
				[nameKey]: { u: 'https://cdn.example/by-name.jpg', t: T0 }
			})
		);
		vi.setSystemTime(T0 + 5_000);
		// Empty uid → the 'uid:' slot is NEVER read; the name layer is consulted → age 5_000.
		expect(coverAgeByUidOrName('', 'Foo Fighters', 'Everlong')).toBe(5_000);
	});

	// Pure / never-throw: a corrupt / unavailable store returns null without throwing.
	it('returns null on corrupt storage and never throws on unavailable storage', () => {
		store.__raw(CACHE_KEY, '{not valid json');
		expect(coverAgeByUidOrName('netease:1', 'A', 'B')).toBeNull();
		Object.defineProperty(globalThis, 'localStorage', {
			value: undefined,
			configurable: true,
			writable: true
		});
		expect(() => coverAgeByUidOrName('netease:1', 'A', 'B')).not.toThrow();
		expect(coverAgeByUidOrName('netease:1', 'A', 'B')).toBeNull();
	});
});

// quick-260915-w4f — the USER PIN store. A pin is the cover the user explicitly chose in the
// TrackMenu picker, so it deliberately lives on its OWN localStorage key with no TTL, no LRU cap and
// no clearCoverCache reach. These tests pin exactly those separations (plus the empty-uid / non-https
// refusals) because every one of them is a way a deliberate choice could otherwise be silently wiped.
describe('cover-cache — user pin store (quick-260915-w4f)', () => {
	let store: MemStorage;
	const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
	const PIN_KEY = 'openmusic:cover-pins:v1';

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

	it('set → get round-trips a pinned url; an unknown uid is null', () => {
		setPinnedCover('netease:1', 'https://a/x.jpg');
		expect(getPinnedCover('netease:1')).toBe('https://a/x.jpg');
		expect(getPinnedCover('netease:unknown')).toBeNull();
	});

	it('refuses an empty uid and a non-https url (T-w4f-02 / T-w4f-05)', () => {
		setPinnedCover('', 'https://a/x.jpg');
		expect(getPinnedCover('')).toBeNull();
		setPinnedCover('netease:2', 'http://insecure/x.jpg');
		expect(getPinnedCover('netease:2')).toBeNull();
	});

	it('getPinnedCover("") is null even when a "" key exists on disk (the shared-slot trap)', () => {
		store.__raw(PIN_KEY, JSON.stringify({ '': 'https://leaked/x.jpg' }));
		expect(getPinnedCover('')).toBeNull();
	});

	it('remove drops the pin; removing a missing uid does not throw', () => {
		setPinnedCover('kuwo:9', 'https://a/x.jpg');
		removePinnedCover('kuwo:9');
		expect(getPinnedCover('kuwo:9')).toBeNull();
		expect(() => removePinnedCover('kuwo:nope')).not.toThrow();
	});

	it('clearCoverCache leaves the pin intact (separate key — the whole point of Q3)', () => {
		setCachedCover('A', 'B', 'https://cache/x.jpg');
		setPinnedCover('qq:7', 'https://pin/x.jpg');
		clearCoverCache();
		expect(getCachedCover('A', 'B')).toBeNull();
		expect(getPinnedCover('qq:7')).toBe('https://pin/x.jpg');
	});

	it('a pin is NOT written into the cover cache (no name-layer leak onto same-named uids)', () => {
		setPinnedCover('qq:7', 'https://pin/x.jpg');
		expect(store.getItem('openmusic:cover-cache:v1')).toBeNull();
	});

	it('corrupt JSON under the pin key reads as null and does not block a later write', () => {
		store.__raw(PIN_KEY, '{not json');
		expect(getPinnedCover('netease:1')).toBeNull();
		setPinnedCover('netease:1', 'https://a/x.jpg');
		expect(getPinnedCover('netease:1')).toBe('https://a/x.jpg');
	});
});

// debug page-switch-lag-tap-dead: the parsed-record memo. The home route does ~300 cover reads per
// mount; each used to re-parse the whole blob (~310 KB at the cap) — 1252 parses / 1.0 s on one tap.
// These pin the two halves of the contract: a hit costs no parse, and the memo can never go stale
// against what is actually on disk.
describe('cover-cache — parsed-record memo (debug page-switch-lag-tap-dead)', () => {
	let store: MemStorage;
	const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

	beforeEach(() => {
		store = new MemStorage();
		Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
	});
	afterEach(() => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: originalLocalStorage,
			configurable: true,
			writable: true
		});
	});

	it('300 reads after one write cost zero JSON.parse — the writer refreshes the memo', () => {
		setCachedCover('A', 'B', 'https://a/x.jpg');
		setPinnedCover('qq:1', 'https://pin/x.jpg');
		const spy = vi.spyOn(JSON, 'parse');
		for (let i = 0; i < 300; i++) {
			getCachedCover('A', 'B');
			getCachedCoverByUid('qq:1');
			getPinnedCover('qq:1');
		}
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('a hit does not touch localStorage — getItem copies the whole blob, ~700 rows read per bump', () => {
		setCachedCover('A', 'B', 'https://a/x.jpg');
		const spy = vi.spyOn(store, 'getItem');
		for (let i = 0; i < 300; i++) getCachedCover('A', 'B');
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('clearCoverCache drops the memo too — the next read sees the empty disk', () => {
		setCachedCover('A', 'B', 'https://a/x.jpg');
		clearCoverCache();
		expect(getCachedCover('A', 'B')).toBeNull();
	});

	it("another tab's write arrives via the `storage` event and invalidates the memo (never served stale)", async () => {
		// The listener is registered at module init, so load a fresh copy with a `window` present.
		const handlers: ((e: { key: string | null }) => void)[] = [];
		(globalThis as { window?: unknown }).window = {
			addEventListener: (_t: string, fn: (e: { key: string | null }) => void) => handlers.push(fn)
		};
		vi.resetModules();
		try {
			const fresh = await import('./cover-cache');
			fresh.setCachedCover('A', 'B', 'https://a/x.jpg');
			expect(fresh.getCachedCover('A', 'B')).toBe('https://a/x.jpg');
			store.__raw(CACHE_KEY, JSON.stringify({ [coverCacheKey('A', 'B')]: 'https://other/tab.jpg' }));
			expect(fresh.getCachedCover('A', 'B')).toBe('https://a/x.jpg'); // memo is authoritative until told otherwise
			expect(handlers.length).toBeGreaterThan(0);
			for (const h of handlers) h({ key: CACHE_KEY });
			expect(fresh.getCachedCover('A', 'B')).toBe('https://other/tab.jpg');
			store.removeItem(CACHE_KEY);
			for (const h of handlers) h({ key: null }); // the other tab called localStorage.clear()
			expect(fresh.getCachedCover('A', 'B')).toBeNull();
		} finally {
			delete (globalThis as { window?: unknown }).window;
		}
	});

	it('a setItem that throws never leaves an in-memory entry that disk does not have', () => {
		setCachedCover('A', 'B', 'https://a/x.jpg');
		const ok = store.setItem.bind(store);
		store.setItem = () => {
			throw new Error('QuotaExceededError');
		};
		setCachedCover('C', 'D', 'https://c/d.jpg'); // mutates the memoised record, then fails to persist
		store.setItem = ok;
		expect(getCachedCover('C', 'D')).toBeNull(); // disk wins
		expect(getCachedCover('A', 'B')).toBe('https://a/x.jpg');
	});
});
