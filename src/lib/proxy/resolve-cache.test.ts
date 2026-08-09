// Unit tests for the /api/resolve edge-cache primitives (phase 31, D-06/D-07/D-09).
//
// NOTE: `edgeCache()` returns null under vitest/`vite dev` by design, so REAL Cache API
// semantics (PoP scoping, put throwing on Vary:*) are NOT provable here — they are deferred to
// the manual verification in 31-VALIDATION.md. What IS provable, and what this file proves, is
// the LOGIC against an in-memory shim.
import { describe, it, expect, vi } from 'vitest';
import {
	RESOLVE_CACHE_VERSION,
	RESOLVE_TTL_S,
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

const HIT: ResolveEntry = {
	source: 'kuwo',
	songid: '123',
	url: 'https://cdn.example/a.mp3',
	avail: { kuwo: 'ok' }
};
const DRY: ResolveEntry = { source: null, songid: null, url: null, avail: { kuwo: 'dry' } };

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

	it('carries the entry-shape version and stays on the own origin', () => {
		const key = resolveCacheKey(ORIGIN, 'Nirvana', 'Lithium');
		expect(key.url).toContain(`v=${RESOLVE_CACHE_VERSION}`);
		expect(RESOLVE_CACHE_VERSION).toBe('1');
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
		expect(stored?.headers.get('Cache-Control')).toBe(`public, max-age=${RESOLVE_TTL_S}`);
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

describe('bustResolveEntry — delete-only (31-D-09)', () => {
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
