// Unit tests for the /api/resolve edge-cache primitives (phase 31 D-06/D-07/D-09, rebuilt around
// the permanent qq `song_mid` in 32-D-10 / 32-D-10a).
//
// NOTE: `edgeCache()` returns null under vitest/`vite dev` by design, so REAL Cache API
// semantics (PoP scoping, put throwing on Vary:*, whether workerd HONOURS a 1-year max-age) are
// NOT provable here — they are deferred to the manual verification in 32-VALIDATION.md (gate #3).
// What IS provable, and what this file proves, is the LOGIC against an in-memory shim: which
// Cache-Control string each payload shape gets written with.
import { describe, it, expect, vi } from 'vitest';
import {
	RESOLVE_CACHE_VERSION,
	RESOLVE_TTL_S,
	RESOLVE_MID_TTL_S,
	RESOLVE_URL_TTL_S,
	MAX_TERM_CHARS,
	resolveCacheKey,
	capTerm,
	readResolveEntry,
	writeResolveEntry,
	bustResolveEntry,
	urlIsFresh,
	type ResolveEntry
} from './resolve-cache';
import type { EdgeCache } from './edge-cache';

/** In-memory caches.default (the og-endpoint.test.ts:746-762 harness + a `delete` spy for D-09). */
function stubCache() {
	const store = new Map<string, Response>();
	const putKeys: string[] = [];
	const cacheStub = {
		match: vi.fn(async (req: Request) => {
			const hit = store.get(req.url);
			return hit ? hit.clone() : undefined;
		}),
		put: vi.fn(async (req: Request, res: Response) => {
			putKeys.push(req.url);
			store.set(req.url, res.clone());
		}),
		delete: vi.fn(async (req: Request) => store.delete(req.url))
	};
	return { store, putKeys, cacheStub: cacheStub satisfies EdgeCache };
}

/**
 * 32-D-20: the payload is a PERMANENT qq song_mid PLUS an optional short-lived `url` beside it.
 * The mid half is what 32-D-10 made permanent; the url half carries its own `urlExp` and is what
 * restores the Phase-31 0.44s path. A url-less positive is the shape the SEARCH fill writes.
 */
const HIT: ResolveEntry = {
	source: 'qq',
	songid: '003OUlho2gk0Ny',
	avail: { qq: 'ok' },
	url: null,
	urlExp: null,
	urlQuality: null
};
/** The same positive AFTER the edge-side refresh-on-read filled its url (32-D-20). */
const HIT_WITH_URL: ResolveEntry = {
	...HIT,
	url: 'https://isure6.stream.qqmusic.qq.com/sq.flac',
	urlExp: Date.now() + 900_000,
	urlQuality: 'lossless'
};
const DRY: ResolveEntry = {
	source: null,
	songid: null,
	avail: { qq: 'dry' },
	url: null,
	urlExp: null,
	urlQuality: null
};

const ORIGIN = 'https://openmusic.lol';

describe('resolveCacheKey — normalized, versioned, own-origin', () => {
	it('collapses casing/spacing/punctuation variants onto ONE key', () => {
		const a = resolveCacheKey(ORIGIN, 'Nirvana', 'Come As You Are');
		const b = resolveCacheKey(ORIGIN, '  nirvana ', 'come-as-you-are!');
		expect(b.url).toBe(a.url);
	});

	it('keeps DIFFERENT songs on different keys', () => {
		const a = resolveCacheKey(ORIGIN, 'Nirvana', 'Come As You Are');
		const b = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		expect(b.url).not.toBe(a.url);
	});

	// 32-D-10 / VALIDATION gate #4: the entry SHAPE changed (url dropped, songid re-meaning), and
	// `cache.delete` is PoP-local, so a stored old-shape entry can NEVER be purged globally. The
	// version in the key is the entire migration — if this assertion is loosened, real users get
	// served v1 url-less-reading garbage with no remediation path.
	it('carries the entry-shape version and stays on the own origin', () => {
		const key = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		expect(key.url).toContain(`v=${RESOLVE_CACHE_VERSION}`);
		// 32-D-20 bumped '2' → '3': the stored payload GAINED url/urlExp/urlQuality, and this file's
		// own rule is categorical — a shape change is a KEY change, never an in-place migration.
		expect(RESOLVE_CACHE_VERSION).toBe('3');
		expect(key.url).toContain('v=3');
		expect(key.url.startsWith(`${ORIGIN}/api/resolve/_k?`)).toBe(true);
	});
});

describe('capTerm — ingress cap (T-31-03-07)', () => {
	it('trims and caps at MAX_TERM_CHARS; null/blank become empty', () => {
		expect(capTerm('  hi  ')).toBe('hi');
		expect(capTerm(null)).toBe('');
		expect(capTerm('  ')).toBe('');
		expect(capTerm('a'.repeat(5000))).toHaveLength(MAX_TERM_CHARS);
	});
});

describe('readResolveEntry — three-valued read', () => {
	it('undefined = MISS when nothing is stored', async () => {
		const { cacheStub } = stubCache();
		const key = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		expect(await readResolveEntry(cacheStub, key)).toBeUndefined();
	});

	it('an entry = HIT after a write', async () => {
		const { cacheStub } = stubCache();
		const key = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		await writeResolveEntry(cacheStub, key, HIT);
		expect(await readResolveEntry(cacheStub, key)).toEqual(HIT);
	});

	it('a stored clean negative round-trips as a KNOWN-NONE entry, not a miss', async () => {
		const { cacheStub } = stubCache();
		const key = resolveCacheKey(ORIGIN, 'Nobody', 'Nothing');
		await writeResolveEntry(cacheStub, key, DRY);
		const got = await readResolveEntry(cacheStub, key);
		expect(got).not.toBeUndefined();
		expect(got).toEqual(DRY);
	});

	it('a stored literal JSON null reads as `null` (KNOWN-NONE), never as a miss', async () => {
		const { store, cacheStub } = stubCache();
		const key = resolveCacheKey(ORIGIN, 'Nobody', 'Nothing');
		store.set(key.url, new Response('null', { status: 200 }));
		expect(await readResolveEntry(cacheStub, key)).toBeNull();
	});

	it('a broken Cache API degrades to a MISS, never to a throw (T-31-03-09)', async () => {
		const broken = {
			match: vi.fn(async () => {
				throw new Error('cache exploded');
			}),
			put: vi.fn(async () => {}),
			delete: vi.fn(async () => false)
		} satisfies EdgeCache;
		const key = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		await expect(readResolveEntry(broken, key)).resolves.toBeUndefined();
	});

	it('a null cache (the `vite dev` runtime) is a MISS', async () => {
		const key = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		expect(await readResolveEntry(null, key)).toBeUndefined();
	});
});

// 32-D-10a — THE highest-value assertions in this phase. Permanence is a property of the PAYLOAD,
// not of the entry. A positive entry holds a song_mid, which genuinely never expires, so it gets a
// 1-year immutable max-age. A NEGATIVE entry holds "qq has no version of this song", which qq
// search reports FALSELY under load (Skill spike-findings-openmusic: 0 rows intermittently, no
// throw) — byte-indistinguishable from a genuine miss. Making that permanent would pin the song to
// a lossy source for every user in the PoP forever, the exact inverse of the phase goal. If a
// future edit unifies these two TTLs, these tests are the thing that must stop it.
describe('writeResolveEntry — 32-D-10a positive/negative TTL split (VALIDATION gate #5)', () => {
	it('a POSITIVE entry (a song_mid) is written PERMANENT + immutable', async () => {
		const { store, cacheStub } = stubCache();
		const key = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		await writeResolveEntry(cacheStub, key, HIT);

		expect(store.get(key.url)?.headers.get('cache-control')).toBe(
			'public, max-age=31536000, immutable'
		);
		expect(RESOLVE_MID_TTL_S).toBe(31_536_000);
	});

	it('a NEGATIVE/DRY entry keeps the SHORT 900s TTL and is NOT immutable', async () => {
		const { store, cacheStub } = stubCache();
		const key = resolveCacheKey(ORIGIN, 'Nobody', 'Nothing');
		await writeResolveEntry(cacheStub, key, DRY);

		const cc = store.get(key.url)?.headers.get('cache-control');
		expect(cc).toBe('public, max-age=900');
		expect(RESOLVE_TTL_S).toBe(900);
		expect(cc).not.toContain('immutable');
	});

	// 32-D-20: the url rides INSIDE the payload with its own `urlExp`, so it must never influence
	// the stored Cache-Control. If a future edit shortens the entry's max-age "because it now holds
	// a url", the permanent-mid win of 32-D-10 is silently lost — these two cases are the guard.
	it('a positive entry WITH a fresh url is written with the SAME permanent+immutable header', async () => {
		const { store, cacheStub } = stubCache();
		const key = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		await writeResolveEntry(cacheStub, key, HIT_WITH_URL);

		expect(store.get(key.url)?.headers.get('cache-control')).toBe(
			'public, max-age=31536000, immutable'
		);
	});

	it('an entry with a source but NO songid is still treated as negative (the payload decides)', async () => {
		// Defensive: the split reads `entry.songid`, not `entry.source` — a half-filled entry can
		// never sneak into the permanent namespace.
		const { store, cacheStub } = stubCache();
		const key = resolveCacheKey(ORIGIN, 'Half', 'Filled');
		await writeResolveEntry(cacheStub, key, {
			source: 'qq',
			songid: null,
			avail: { qq: 'dry' },
			url: null,
			urlExp: null,
			urlQuality: null
		});

		expect(store.get(key.url)?.headers.get('cache-control')).toBe('public, max-age=900');
	});
});

describe('writeResolveEntry — CORS-free, explicit header allow-list (T-31-03-04)', () => {
	it('stores exactly content-type + Cache-Control — no Vary, no ACAO', async () => {
		const { store, cacheStub } = stubCache();
		const key = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		await writeResolveEntry(cacheStub, key, HIT);

		const stored = store.get(key.url);
		expect(stored).toBeDefined();
		expect(stored?.headers.get('Vary')).toBeNull();
		expect(stored?.headers.get('Access-Control-Allow-Origin')).toBeNull();
		expect(stored?.headers.get('content-type')).toBe('application/json');
		expect([...(stored?.headers.keys() ?? [])].sort()).toEqual(['cache-control', 'content-type']);
	});

	it('a null cache is a no-op and a failing put never throws (best-effort)', async () => {
		const key = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		await expect(writeResolveEntry(null, key, HIT)).resolves.toBeUndefined();
		const broken = {
			match: vi.fn(async () => undefined),
			put: vi.fn(async () => {
				throw new Error('nope');
			}),
			delete: vi.fn(async () => false)
		} satisfies EdgeCache;
		await expect(writeResolveEntry(broken, key, HIT)).resolves.toBeUndefined();
	});
});

// KEPT by 32-D-10a, deliberately: a permanent POSITIVE entry can still be WRONG (a matchKey
// collision serving another song's mid), and there is no client write path, so the bust is the
// only repair mechanism the whole design has. D-11 requires repair to be possible.
describe('bustResolveEntry — delete-only, KEPT under 32-D-10a (31-D-09)', () => {
	it('deletes the entry a write created, and the next read is a MISS again', async () => {
		const { cacheStub } = stubCache();
		const key = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		await writeResolveEntry(cacheStub, key, HIT);
		expect(await bustResolveEntry(cacheStub, key)).toBe(true);
		expect(cacheStub.delete).toHaveBeenCalledTimes(1);
		expect(await readResolveEntry(cacheStub, key)).toBeUndefined();
	});

	it('returns false for an unknown key, a null cache, and a throwing delete', async () => {
		const { cacheStub } = stubCache();
		const key = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		expect(await bustResolveEntry(cacheStub, key)).toBe(false);
		expect(await bustResolveEntry(null, key)).toBe(false);
		const broken = {
			match: vi.fn(async () => undefined),
			put: vi.fn(async () => {}),
			delete: vi.fn(async () => {
				throw new Error('nope');
			})
		} satisfies EdgeCache;
		expect(await bustResolveEntry(broken, key)).toBe(false);
	});
});


// 32-D-20 — the url's lifetime lives in the PAYLOAD (`urlExp`), not in a second Cache-Control: the
// Cache API stores ONE Response per key with ONE max-age, so a mixed-lifetime entry is only
// expressible this way. The EDGE is the single freshness authority (one clock, the same one that
// wrote `urlExp`); the client never reads this field, it only ever sees a url that is already
// fresh or a url that has been nulled out for it.
describe('urlIsFresh — the in-payload url lifetime (32-D-20)', () => {
	const base: ResolveEntry = { source: 'qq', songid: 'm', avail: { qq: 'ok' }, url: null, urlExp: null, urlQuality: null };
	const NOW = 1_700_000_000_000;

	it('true only when a url AND a future urlExp are both present', () => {
		expect(urlIsFresh({ ...base, url: 'https://x/a.flac', urlExp: NOW + 1 }, NOW)).toBe(true);
	});

	it('false for an expired urlExp, a missing url, and a missing urlExp', () => {
		expect(urlIsFresh({ ...base, url: 'https://x/a.flac', urlExp: NOW - 1 }, NOW)).toBe(false);
		expect(urlIsFresh({ ...base, url: null, urlExp: NOW + 900_000 }, NOW)).toBe(false);
		expect(urlIsFresh({ ...base, url: 'https://x/a.flac', urlExp: null }, NOW)).toBe(false);
		expect(urlIsFresh(base, NOW)).toBe(false);
	});

	it('RESOLVE_URL_TTL_S is the Phase-31-proven 900s, tunable INDEPENDENTLY of the negative TTL', () => {
		// Same value, different concept: RESOLVE_TTL_S now means "how long a NEGATIVE is pinned",
		// RESOLVE_URL_TTL_S means "how long a signed CN url is trusted". Never collapse them.
		expect(RESOLVE_URL_TTL_S).toBe(900);
	});
});
