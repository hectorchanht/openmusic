// /api/lyrics endpoint tests (quick-261122-ugcb3) — the GET/POST/DELETE status matrix through the
// exported verb handlers, over the in-memory R2 stand-in WITH etag + conditional-put semantics
// (harness from comments-endpoint.test.ts), a stubbed siteverify fetch and a fake D1 session lookup.
//
// Every reject path before the write asserts the record was not touched; public responses are
// checked for the absence of voter / submitter hashes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST, DELETE } from './+server';
import { HIDE_REPORTS } from '$lib/proxy/community-lyrics';

const K = 'cd'.repeat(16);
const OBJ_KEY = `lyrics/${K}.json`;
const TOKEN = 'READ-TOKEN';
const SESSION = 'a'.repeat(64);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type PutOpts = { httpMetadata?: unknown; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } };

function fakeBucket() {
	const store = new Map<string, { text: string; etag: string }>();
	let n = 0;
	return {
		store,
		get: vi.fn(async (key: string) => {
			const e = store.get(key);
			return e ? { etag: e.etag, text: async () => e.text } : null;
		}),
		put: vi.fn(async (key: string, value: string, opts: PutOpts) => {
			const cur = store.get(key);
			if (opts?.onlyIf?.etagDoesNotMatch === '*' && cur) return null;
			if (opts?.onlyIf?.etagMatches !== undefined && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
			const etag = 'e' + ++n;
			store.set(key, { text: value, etag });
			return { etag };
		})
	};
}
type Bucket = ReturnType<typeof fakeBucket>;

/** D1 stand-in for getUserFromRequest: any well-formed session resolves to `user` (or null). */
function fakeDb(user: { id: string; email: string } | null) {
	return { prepare: () => ({ bind: () => ({ first: async () => user }) }) };
}

interface EventOpts {
	body?: string;
	headers?: Record<string, string>;
	env?: Record<string, unknown>;
	search?: Record<string, string>;
	ip?: string | null;
	signedIn?: boolean;
}

function fakeEvent(method: 'GET' | 'POST' | 'DELETE', opts: EventOpts = {}) {
	const url = new URL('https://openmusic.lol/api/lyrics');
	for (const [k, v] of Object.entries(opts.search ?? {})) url.searchParams.set(k, v);
	const headers: Record<string, string> = {
		origin: 'https://openmusic.lol',
		...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
		...(opts.signedIn ? { cookie: `openmusic_session=${SESSION}` } : {}),
		...(opts.headers ?? {})
	};
	for (const [h, v] of Object.entries(headers)) if (v === '') delete headers[h];
	const ip = opts.ip === undefined ? '1.2.3.4' : opts.ip;
	return {
		url,
		platform: opts.env ? { env: opts.env } : undefined,
		request: new Request(url, { method, headers, body: opts.body }),
		getClientAddress: () => ip
	};
}

// Test-only response view: the JSON bodies are asserted field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Res = { status: number; json(): Promise<any> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callGET = (e: ReturnType<typeof fakeEvent>) => GET(e as any) as Promise<Res>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callPOST = (e: ReturnType<typeof fakeEvent>) => POST(e as any) as Promise<Res>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callDELETE = (e: ReturnType<typeof fakeEvent>) => DELETE(e as any) as Promise<Res>;

const USER = { id: 'user-1', email: 'u@example.com' };
const env = (bucket: Bucket, user: typeof USER | null = USER) => ({
	DIAG: bucket,
	DIAG_READ_TOKEN: TOKEN,
	TurnstileSecret: 'ts-secret',
	TURNSTILE_HOSTNAMES: 'openmusic.lol',
	ACCOUNTS_DB: fakeDb(user)
});
const bearer = () => ({ authorization: `Bearer ${TOKEN}` });

const LRC = ['[00:01.00][00:04.00]one', '[00:04.00]two', '[00:08.00]three', '[00:12.00]four', '[00:16.00]five'].join('\n');
const submitBody = (o: Record<string, unknown> = {}) =>
	JSON.stringify({ k: K, lrc: LRC, estimated: true, title: 'Song', artist: 'Jack Choo', duration: 269, token: 'cf-token', ...o });

function stubCaches() {
	const store = new Map<string, string>();
	const put = vi.fn(async (req: Request, res: Response) => {
		store.set(req.url, await res.text());
	});
	const match = vi.fn(async (req: Request) => {
		const text = store.get(req.url);
		return text === undefined ? undefined : new Response(text, { headers: { 'content-type': 'application/json' } });
	});
	const del = vi.fn(async (req: Request) => store.delete(req.url));
	vi.stubGlobal('caches', { default: { match, put, delete: del } });
	return { store, put, match, delete: del };
}
function stubSiteverify(body: Record<string, unknown> = { success: true, hostname: 'openmusic.lol', action: 'comment' }) {
	const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
	vi.stubGlobal('fetch', f);
	return f;
}

beforeEach(() => {
	stubCaches();
	stubSiteverify();
});
afterEach(() => {
	vi.unstubAllGlobals();
});

async function submit(bucket: Bucket, o: Record<string, unknown> = {}, ev: Partial<EventOpts> = {}) {
	return callPOST(fakeEvent('POST', { body: submitBody(o), env: env(bucket), signedIn: true, ...ev }));
}

describe('GET /api/lyrics', () => {
	it('rejects a malformed key before any I/O', async () => {
		const b = fakeBucket();
		const res = await callGET(fakeEvent('GET', { search: { k: 'nope' }, env: env(b) }));
		expect(res.status).toBe(400);
		expect(b.get).not.toHaveBeenCalled();
	});
	it('fails closed without the bucket', async () => {
		const res = await callGET(fakeEvent('GET', { search: { k: K }, env: {} }));
		expect(res.status).toBe(503);
	});
	it('an unknown song is an empty, cacheable list', async () => {
		const b = fakeBucket();
		const res = await callGET(fakeEvent('GET', { search: { k: K }, env: env(b) }));
		expect(await res.json()).toEqual({ ok: true, versions: [] });
	});
	it('maintainer view needs the read token', async () => {
		const b = fakeBucket();
		const res = await callGET(fakeEvent('GET', { search: { k: K, all: '1' }, env: env(b) }));
		expect(res.status).toBe(401);
		const ok = await callGET(fakeEvent('GET', { search: { k: K, all: '1' }, env: env(b), headers: bearer() }));
		expect(ok.status).toBe(200);
	});
});

describe('POST submit — check layer 3 (account + Turnstile + throttle)', () => {
	it('requires a signed-in account (401 signin) and touches nothing', async () => {
		const b = fakeBucket();
		const res = await callPOST(fakeEvent('POST', { body: submitBody(), env: env(b, null), signedIn: true }));
		expect(res.status).toBe(401);
		expect((await res.json()).err).toBe('signin');
		expect(b.get).not.toHaveBeenCalled();
		expect(b.put).not.toHaveBeenCalled();
	});
	it('no session cookie at all → 401', async () => {
		const b = fakeBucket();
		const res = await callPOST(fakeEvent('POST', { body: submitBody(), env: env(b) }));
		expect(res.status).toBe(401);
	});
	it('a failed Turnstile verdict → 403 before any R2 op', async () => {
		stubSiteverify({ success: false });
		const b = fakeBucket();
		const res = await submit(b);
		expect(res.status).toBe(403);
		expect(b.get).not.toHaveBeenCalled();
	});
	it('refuses a foreign origin and a non-JSON body', async () => {
		const b = fakeBucket();
		expect((await submit(b, {}, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
		expect((await submit(b, {}, { headers: { 'content-type': 'text/plain' } })).status).toBe(415);
		expect(b.put).not.toHaveBeenCalled();
	});
	it('throttles a second submit from the same account within the gap', async () => {
		const b = fakeBucket();
		expect((await submit(b)).status).toBe(200);
		const res = await submit(b, { lrc: LRC.replace('five', 'FIVE') });
		expect(res.status).toBe(429);
	});
});

describe('POST submit — check layers 1 + 2 and the stored record', () => {
	it('stores a passing version, pinned by its submitter, canonical first', async () => {
		const b = fakeBucket();
		const res = await submit(b);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.id).toMatch(UUID_RE);
		expect(body.duplicate).toBe(false);
		expect(body.versions).toHaveLength(1);
		expect(body.versions[0]).toMatchObject({ id: body.id, cls: 'estimated', pins: 1 });
		// public shape: never voter / submitter hashes
		expect(JSON.stringify(body)).not.toMatch(/reporters|"by"/);
		expect(b.store.has(OBJ_KEY)).toBe(true);
	});
	it('a check failure returns 422 + the reason and stores nothing', async () => {
		const b = fakeBucket();
		const res = await submit(b, { lrc: '[00:01.00]only\n[00:02.00]two lines' });
		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({ err: 'check', reason: 'too-few-lines' });
		expect(b.store.has(OBJ_KEY)).toBe(false);
	});
	it('a URL in the lyric is rejected', async () => {
		const b = fakeBucket();
		const res = await submit(b, { lrc: LRC + '\n[00:20.00]visit https://spam.example' });
		expect((await res.json()).reason).toBe('url');
	});
	it('a stamp far past the song end is rejected', async () => {
		const b = fakeBucket();
		const res = await submit(b, { duration: 0.5 });
		expect((await res.json()).reason).toBe('past-end');
	});
});

describe('POST pin / report — pins are the vote; reports hide', () => {
	async function seedTwo(b: Bucket) {
		const r1 = await (await submit(b)).json();
		// second version from a different account (no throttle clash)
		const e2 = { ...env(b, { id: 'user-2', email: 'v@example.com' }) };
		const r2 = await (
			await callPOST(fakeEvent('POST', { body: submitBody({ lrc: LRC.replace('five', 'FIVE!') }), env: e2, signedIn: true }))
		).json();
		return { a: r1.id as string, b: r2.id as string };
	}

	it('most-pinned wins canonical; a listener holds ONE pin per song', async () => {
		const b = fakeBucket();
		const { a, b: bId } = await seedTwo(b);
		// 1–1 (the tie → newer rule is pinned in community-lyrics.test.ts with distinct times)
		let list = (await (await callGET(fakeEvent('GET', { search: { k: K }, env: env(b) }))).json()).versions;
		expect(list).toHaveLength(2);
		// an anonymous listener pins a → a leads 2–1
		const pin = (id: string, ip: string) =>
			callPOST(fakeEvent('POST', { body: JSON.stringify({ k: K, action: 'pin', id }), env: env(b, null), ip }));
		list = (await (await pin(a, '9.9.9.9')).json()).versions;
		expect(list[0]).toMatchObject({ id: a, pins: 2 });
		// the same listener moves their vote to b → 1–2
		list = (await (await pin(bId, '9.9.9.9')).json()).versions;
		expect(list[0]).toMatchObject({ id: bId, pins: 2 });
		expect(list[1]).toMatchObject({ id: a, pins: 1 });
	});

	it(`${HIDE_REPORTS} distinct reporters hide a version; the next-best becomes canonical`, async () => {
		const b = fakeBucket();
		const { a, b: bId } = await seedTwo(b);
		let last: { versions: { id: string }[] } = { versions: [] };
		for (let i = 0; i < HIDE_REPORTS; i++) {
			last = await (
				await callPOST(
					fakeEvent('POST', { body: JSON.stringify({ k: K, action: 'report', id: bId }), env: env(b, null), ip: `5.5.5.${i}` })
				)
			).json();
		}
		expect(last.versions.map((v) => v.id)).toEqual([a]);
	});

	it('an unknown id → 404', async () => {
		const b = fakeBucket();
		await submit(b);
		const res = await callPOST(
			fakeEvent('POST', {
				body: JSON.stringify({ k: K, action: 'pin', id: '00000000-0000-4000-8000-000000000099' }),
				env: env(b, null)
			})
		);
		expect(res.status).toBe(404);
	});

	it('an exact duplicate is not stored twice — it becomes a pin', async () => {
		const b = fakeBucket();
		const first = await (await submit(b)).json();
		const e2 = env(b, { id: 'user-3', email: 'w@example.com' });
		const dup = await (await callPOST(fakeEvent('POST', { body: submitBody(), env: e2, signedIn: true }))).json();
		expect(dup.duplicate).toBe(true);
		expect(dup.id).toBe(first.id);
		expect(dup.versions).toHaveLength(1);
		expect(dup.versions[0].pins).toBe(2);
	});
});

describe('DELETE (maintainer)', () => {
	it('token first; then removes the version', async () => {
		const b = fakeBucket();
		const { id } = await (await submit(b)).json();
		expect((await callDELETE(fakeEvent('DELETE', { search: { k: K, id }, env: env(b) }))).status).toBe(401);
		const res = await callDELETE(fakeEvent('DELETE', { search: { k: K, id }, env: env(b), headers: bearer() }));
		expect(res.status).toBe(200);
		const list = (await (await callGET(fakeEvent('GET', { search: { k: K }, env: env(b) }))).json()).versions;
		expect(list).toEqual([]);
	});
});
