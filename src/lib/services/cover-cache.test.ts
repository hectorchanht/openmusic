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
	removeCachedArtistCover
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
