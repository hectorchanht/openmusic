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
	MAX_TERM_CHARS,
	resolveCacheKey,
	capTerm,
	readResolveEntry,
	writeResolveEntry,
	bustResolveEntry,
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

/** 32-D-10: the payload is a PERMANENT qq song_mid, never an expiring signed audio URL. */
const HIT: ResolveEntry = {
	source: 'qq',
	songid: '003OUlho2gk0Ny',
	avail: { qq: 'ok' }
};
const DRY: ResolveEntry = { source: null, songid: null, avail: { qq: 'dry' } };

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
		expect(RESOLVE_CACHE_VERSION).toBe('2');
		expect(key.url).toContain('v=2');
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

	it('an entry with a source but NO songid is still treated as negative (the payload decides)', async () => {
		// Defensive: the split reads `entry.songid`, not `entry.source` — a half-filled entry can
		// never sneak into the permanent namespace.
		const { store, cacheStub } = stubCache();
		const key = resolveCacheKey(ORIGIN, 'Half', 'Filled');
		await writeResolveEntry(cacheStub, key, { source: 'qq', songid: null, avail: { qq: 'dry' } });

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
