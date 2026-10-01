import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { __resetGovernor } from '$lib/services/api-base';
import { matchKey } from '$lib/services/match-key';
import { coverPickKeys, fetchCoverPick, submitCoverPick } from './cover-pick-shared';

// Phase 40 D-13 / D-16 — the never-throw client side of the shared cover pick.

const U = 'ab'.repeat(16);
const N = 'cd'.repeat(16);
const GOOD = 'https://y.gtimg.cn/music/photo_new/x.jpg';
const OTHER = 'https://e-cdns-images.dzcdn.net/images/cover/y.jpg';

const hex32 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
	__resetGovernor();
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe('coverPickKeys', () => {
	it('hashes u from "u\\n"+uid and n from "n\\n"+matchKey', async () => {
		const k = await coverPickKeys('qq:1', 'A', 'T');
		expect(k).toEqual({ u: hex32('u\nqq:1'), n: hex32(`n\n${matchKey('A', 'T')}`) });
		expect(k?.u).toMatch(/^[0-9a-f]{32}$/);
		expect(k?.n).toMatch(/^[0-9a-f]{32}$/);
	});
	it('keeps a version marker distinguishing: "晴天 (Live)" never shares the studio n key', async () => {
		const studio = await coverPickKeys('qq:1', '周杰伦', '晴天');
		for (const t of ['晴天 (Live)', '晴天（Live）', '晴天 - Live', '晴天 (Remix)', '晴天 [Acoustic]']) {
			expect((await coverPickKeys('qq:2', '周杰伦', t))?.n).not.toBe(studio?.n);
		}
		// …while case / space / punctuation still fold, as before
		expect((await coverPickKeys('qq:2', ' a ', 'T!'))?.n).toBe((await coverPickKeys('qq:1', 'A', 'T'))?.n);
	});
	it('is deterministic', async () => {
		expect(await coverPickKeys('qq:1', 'A', 'T')).toEqual(await coverPickKeys('qq:1', 'A', 'T'));
	});
	it('domain-separates u and n for the same string content', async () => {
		const k = await coverPickKeys('a|t', 'A', 'T');
		expect(matchKey('A', 'T')).toBe('a|t');
		expect(k?.u).not.toBe(k?.n);
	});
	it('skips u for an empty uid', async () => {
		const k = await coverPickKeys('', 'A', 'T');
		expect(k?.u).toBeNull();
		expect(k?.n).toMatch(/^[0-9a-f]{32}$/);
	});
	it('skips u for a device: uid', async () => {
		expect((await coverPickKeys('device:5', 'A', 'T'))?.u).toBeNull();
	});
	it('skips n when the match key is "|"', async () => {
		const k = await coverPickKeys('qq:1', '', '');
		expect(k?.n).toBeNull();
		expect(k?.u).toMatch(/^[0-9a-f]{32}$/);
	});
	it('returns null when both keys are skipped', async () => {
		expect(await coverPickKeys('device:5', '', '')).toBeNull();
	});
	it('resolves null without crypto.subtle (non-secure origin)', async () => {
		vi.stubGlobal('crypto', { subtle: undefined });
		await expect(coverPickKeys('qq:1', 'A', 'T')).resolves.toBeNull();
	});
});

describe('fetchCoverPick', () => {
	it('GETs /api/cover-pick?u=..&n=.. and returns both urls', async () => {
		const fetchMock = vi.fn(async (..._a: unknown[]) => json({ ok: true, u: GOOD, n: OTHER }));
		vi.stubGlobal('fetch', fetchMock);
		expect(await fetchCoverPick({ u: U, n: N })).toEqual({ u: GOOD, n: OTHER });
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
		expect(url.endsWith(`/api/cover-pick?u=${U}&n=${N}`)).toBe(true);
		expect(init?.method ?? 'GET').toBe('GET');
	});
	it('sends only the present key', async () => {
		const fetchMock = vi.fn(async (..._a: unknown[]) => json({ ok: true, u: null, n: GOOD }));
		vi.stubGlobal('fetch', fetchMock);
		expect(await fetchCoverPick({ u: null, n: N })).toEqual({ u: null, n: GOOD });
		expect((fetchMock.mock.calls[0][0] as string).endsWith(`/api/cover-pick?n=${N}`)).toBe(true);
	});
	it('re-screens every url: a non-allowlisted or non-https url becomes null', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, u: 'https://evil.example/x.jpg', n: 'http://y.gtimg.cn/x.jpg' })));
		expect(await fetchCoverPick({ u: U, n: N })).toEqual({ u: null, n: null });
		__resetGovernor();
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, u: 42, n: GOOD })));
		expect(await fetchCoverPick({ u: U, n: N })).toEqual({ u: null, n: GOOD });
	});
	it('a non-ok response, a rejecting fetch, or an aborted signal resolve null', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false, err: 'unconfigured' }, 503)));
		expect(await fetchCoverPick({ u: U, n: N })).toBeNull();
		__resetGovernor();
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))));
		expect(await fetchCoverPick({ u: U, n: N })).toBeNull();
		__resetGovernor();
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, u: GOOD, n: null })));
		const ac = new AbortController();
		ac.abort();
		expect(await fetchCoverPick({ u: U, n: N }, ac.signal)).toBeNull();
	});
	it('a non-JSON body resolves null', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
		expect(await fetchCoverPick({ u: U, n: N })).toBeNull();
	});
});

describe('submitCoverPick', () => {
	it('POSTs JSON {u, n, url} with a JSON content-type, once', async () => {
		const fetchMock = vi.fn(async (..._a: unknown[]) => json({ ok: true, u: GOOD, n: GOOD }));
		vi.stubGlobal('fetch', fetchMock);
		await submitCoverPick({ u: U, n: N }, GOOD);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url.endsWith('/api/cover-pick')).toBe(true);
		expect(init.method).toBe('POST');
		expect(new Headers(init.headers).get('content-type')).toBe('application/json');
		expect(JSON.parse(init.body as string)).toEqual({ u: U, n: N, url: GOOD });
	});
	it('omits null keys from the body', async () => {
		const fetchMock = vi.fn(async (..._a: unknown[]) => json({ ok: true }));
		vi.stubGlobal('fetch', fetchMock);
		await submitCoverPick({ u: null, n: N }, GOOD);
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(JSON.parse(init.body as string)).toEqual({ n: N, url: GOOD });
	});
	it('never throws on 429 / 503 / network failure', async () => {
		for (const f of [
			async () => json({ ok: false, err: 'slow-down' }, 429),
			async () => json({ ok: false, err: 'unconfigured' }, 503),
			async () => Promise.reject(new TypeError('network'))
		]) {
			__resetGovernor();
			vi.stubGlobal('fetch', vi.fn(f));
			await expect(submitCoverPick({ u: U, n: N }, GOOD)).resolves.toBeUndefined();
		}
	});
});
