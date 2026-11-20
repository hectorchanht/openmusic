// /api/diag endpoint tests — the D-01/D-03/D-05 status matrix driven through the exported verb
// handlers, with an in-memory stand-in for the R2 binding.
//
// Two things these tests exist to prove that a reading of the route cannot:
//  - NOTHING is written to the bucket on any reject path (T-33-05) — every 401/503/413/400 case
//    asserts `bucket.put` was never called, not merely that the status was right.
//  - NO response body ever contains a token (T-33-02) — same assertion shape as the translate
//    route's T-25c-01 provider-key test, run over every status this route can produce.
//
// What they CANNOT prove: that SvelteKit will load the module at all. A non-verb `export` here 500s
// at request time (commit 29c1c7d) and these tests import `./+server` directly, bypassing the route
// validation entirely. That check is a live dev-server curl — Task 3.

import { describe, expect, it, vi } from 'vitest';
import { serializeActionLog } from '$lib/diagnostics/action-log-logic';
import { MAX_UPLOAD_BYTES } from '$lib/proxy/diag-payload';
import { GET, POST } from './+server';

const UPLOAD_TOKEN = 'up-secret';
const READ_TOKEN = 'read-secret';

/**
 * In-memory R2Bucket stand-in. A `Response` stands in for `R2ObjectBody` because it has both the
 * `.body` stream the route passes through and the `.text()` the assertions read.
 */
function stubBucket() {
	const store = new Map<string, string>();
	return {
		store,
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
		get: vi.fn(async (key: string) => (store.has(key) ? new Response(store.get(key)) : null)),
		list: vi.fn(async ({ prefix }: { prefix?: string } = {}) => ({
			objects: [...store.keys()]
				.filter((k) => !prefix || k.startsWith(prefix))
				.map((key) => ({ key, size: store.get(key)!.length, uploaded: new Date(0) }))
		}))
	};
}

type StubBucket = ReturnType<typeof stubBucket>;

interface EventOpts {
	body?: string;
	headers?: Record<string, string>;
	env?: Record<string, unknown>;
	search?: Record<string, string>;
}

/** The og-endpoint.test.ts harness shape: `platform` stays undefined unless an `env` is supplied. */
function fakeEvent(method: 'GET' | 'POST', opts: EventOpts = {}) {
	const url = new URL('https://openmusic.lol/api/diag');
	for (const [k, v] of Object.entries(opts.search ?? {})) url.searchParams.set(k, v);
	const headers: Record<string, string> = {
		origin: 'https://openmusic.lol',
		...(opts.headers ?? {})
	};
	return {
		url,
		platform: opts.env ? { env: opts.env } : undefined,
		request: new Request(url, { method, headers, body: opts.body })
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callPOST = (event: ReturnType<typeof fakeEvent>) => POST(event as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callGET = (event: ReturnType<typeof fakeEvent>) => GET(event as any);

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const LOG = serializeActionLog([
	{ t: 1, ev: 'a' },
	{ t: 2, ev: 'b', d: { ms: 3 }, n: 2, tl: 4 }
]);

/** Full env: a configured upload token AND a live binding. */
const fullEnv = (bucket: StubBucket) => ({ DIAG_UPLOAD_TOKEN: UPLOAD_TOKEN, DIAG: bucket });

describe('POST /api/diag — auth (D-01, T-33-01)', () => {
	it('no Authorization header → 401 and writes nothing', async () => {
		const bucket = stubBucket();
		const res = await callPOST(fakeEvent('POST', { body: LOG, env: fullEnv(bucket) }));
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ok: false, err: 'unauthorized' });
		expect(bucket.put).not.toHaveBeenCalled();
	});

	it('wrong token → 401 and writes nothing', async () => {
		const bucket = stubBucket();
		const res = await callPOST(
			fakeEvent('POST', { body: LOG, headers: bearer('wrong'), env: fullEnv(bucket) })
		);
		expect(res.status).toBe(401);
		expect(bucket.put).not.toHaveBeenCalled();
	});

	it('no platform/env at all → 401, NOT a pass-through (fail closed)', async () => {
		const res = await callPOST(fakeEvent('POST', { body: LOG, headers: bearer('anything') }));
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ok: false, err: 'unauthorized' });
	});
});

describe('POST /api/diag — binding (D-07)', () => {
	it('correct token but no DIAG binding → 503 unconfigured, never a thrown TypeError', async () => {
		const res = await callPOST(
			fakeEvent('POST', {
				body: LOG,
				headers: bearer(UPLOAD_TOKEN),
				env: { DIAG_UPLOAD_TOKEN: UPLOAD_TOKEN }
			})
		);
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ ok: false, err: 'unconfigured' });
	});
});

describe('POST /api/diag — size screen (D-05, T-33-04)', () => {
	it('declared content-length over the cap → 413 before the body is read', async () => {
		const bucket = stubBucket();
		const res = await callPOST(
			fakeEvent('POST', {
				body: 'x',
				headers: { ...bearer(UPLOAD_TOKEN), 'content-length': '600000' },
				env: fullEnv(bucket)
			})
		);
		expect(res.status).toBe(413);
		expect(await res.json()).toEqual({ ok: false, err: 'too-large' });
		expect(bucket.put).not.toHaveBeenCalled();
	});

	it('oversize body with NO content-length header → still 413 (the header can lie)', async () => {
		const bucket = stubBucket();
		const res = await callPOST(
			fakeEvent('POST', {
				body: 'x'.repeat(MAX_UPLOAD_BYTES + 1),
				headers: bearer(UPLOAD_TOKEN),
				env: fullEnv(bucket)
			})
		);
		expect(res.status).toBe(413);
		expect(bucket.put).not.toHaveBeenCalled();
	});
});

describe('POST /api/diag — payload screen (D-05)', () => {
	const reject = async (body: string) => {
		const bucket = stubBucket();
		const res = await callPOST(
			fakeEvent('POST', { body, headers: bearer(UPLOAD_TOKEN), env: fullEnv(bucket) })
		);
		return { res, bucket };
	};

	it('a JSON object (not an array) → 400 invalid, writes nothing', async () => {
		const { res, bucket } = await reject('{"a":1}');
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, err: 'invalid' });
		expect(bucket.put).not.toHaveBeenCalled();
	});

	it('an empty array → 400 invalid, writes nothing', async () => {
		const { res, bucket } = await reject('[]');
		expect(res.status).toBe(400);
		expect(bucket.put).not.toHaveBeenCalled();
	});

	it('non-JSON text → 400 invalid, writes nothing (never throws)', async () => {
		const { res, bucket } = await reject('not json');
		expect(res.status).toBe(400);
		expect(bucket.put).not.toHaveBeenCalled();
	});
});

describe('POST /api/diag — accepted upload (D-01, D-07)', () => {
	it('valid log + correct token → 200, stores the BYTE-IDENTICAL raw text once, no Cache-Control', async () => {
		const bucket = stubBucket();
		const res = await callPOST(
			fakeEvent('POST', { body: LOG, headers: bearer(UPLOAD_TOKEN), env: fullEnv(bucket) })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; key: string; entries: number };
		expect(body.ok).toBe(true);
		expect(body.entries).toBe(2);
		expect(body.key).toMatch(/^log\/.+\.json$/);
		expect(bucket.put).toHaveBeenCalledTimes(1);
		expect(bucket.put).toHaveBeenCalledWith(body.key, LOG, {
			httpMetadata: { contentType: 'application/json' }
		});
		// The stored bytes are the uploaded bytes — no re-serialization anywhere on the path.
		expect(bucket.store.get(body.key)).toBe(LOG);
		// A diagnostics reply must never be cached by anything in front of the Worker.
		expect(res.headers.get('Cache-Control')).toBeNull();
	});
});

describe('POST /api/diag — token confidentiality (T-33-02)', () => {
	it('no POST response body of any status contains the upload token', async () => {
		const bodies = await Promise.all(
			[
				fakeEvent('POST', { body: LOG, env: fullEnv(stubBucket()) }), // 401
				fakeEvent('POST', { body: LOG, headers: bearer('wrong'), env: fullEnv(stubBucket()) }), // 401
				fakeEvent('POST', {
					body: LOG,
					headers: bearer(UPLOAD_TOKEN),
					env: { DIAG_UPLOAD_TOKEN: UPLOAD_TOKEN }
				}), // 503
				fakeEvent('POST', {
					body: 'x',
					headers: { ...bearer(UPLOAD_TOKEN), 'content-length': '600000' },
					env: fullEnv(stubBucket())
				}), // 413
				fakeEvent('POST', {
					body: 'not json',
					headers: bearer(UPLOAD_TOKEN),
					env: fullEnv(stubBucket())
				}), // 400
				fakeEvent('POST', {
					body: LOG,
					headers: bearer(UPLOAD_TOKEN),
					env: fullEnv(stubBucket())
				}) // 200
			].map(async (event) => (await callPOST(event)).text())
		);
		expect(bodies).toHaveLength(6);
		for (const text of bodies) expect(text).not.toContain(UPLOAD_TOKEN);
	});
});

/** Read env: BOTH tokens configured, so "the upload token gets 401 on GET" is a real assertion. */
const readEnv = (bucket: StubBucket) => ({
	DIAG_READ_TOKEN: READ_TOKEN,
	DIAG_UPLOAD_TOKEN: UPLOAD_TOKEN,
	DIAG: bucket
});

const KEY_A = 'log/2026-09-13T00-00-00-000Z-aaaaaaaa.json';
const KEY_B = 'log/2026-09-13T00-00-01-000Z-bbbbbbbb.json';

/** A bucket already holding two logs plus one object OUTSIDE the log/ prefix. */
function seededBucket() {
	const bucket = stubBucket();
	bucket.store.set(KEY_A, LOG);
	bucket.store.set(KEY_B, LOG);
	bucket.store.set('other/not-a-log.json', 'nope');
	return bucket;
}

describe('GET /api/diag — auth (D-02, T-33-07)', () => {
	it('no Authorization header → 401', async () => {
		const res = await callGET(fakeEvent('GET', { env: readEnv(seededBucket()) }));
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ok: false, err: 'unauthorized' });
	});

	it('the UPLOAD token → 401: write capability must not grant read', async () => {
		const bucket = seededBucket();
		const res = await callGET(
			fakeEvent('GET', { headers: bearer(UPLOAD_TOKEN), env: readEnv(bucket) })
		);
		expect(res.status).toBe(401);
		expect(bucket.list).not.toHaveBeenCalled();
	});

	it('the read token but no DIAG binding → 503 unconfigured', async () => {
		const res = await callGET(
			fakeEvent('GET', { headers: bearer(READ_TOKEN), env: { DIAG_READ_TOKEN: READ_TOKEN } })
		);
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ ok: false, err: 'unconfigured' });
	});
});

describe('GET /api/diag — list (D-02)', () => {
	it('no ?key → 200 with one row per stored log, listed under the log/ prefix only', async () => {
		const bucket = seededBucket();
		const res = await callGET(
			fakeEvent('GET', { headers: bearer(READ_TOKEN), env: readEnv(bucket) })
		);
		expect(res.status).toBe(200);
		expect(bucket.list).toHaveBeenCalledTimes(1);
		expect(bucket.list).toHaveBeenCalledWith({ prefix: 'log/' });
		const body = (await res.json()) as {
			ok: boolean;
			logs: Array<{ key: string; size: number; uploaded: string }>;
		};
		expect(body.ok).toBe(true);
		expect(body.logs).toHaveLength(2);
		expect(body.logs.map((l) => l.key)).toEqual([KEY_A, KEY_B]);
		expect(body.logs[0].size).toBe(LOG.length);
		// A Date serialises to an ISO string on the way out — the caller never sees an epoch number.
		expect(body.logs[0].uploaded).toBe('1970-01-01T00:00:00.000Z');
	});
});

describe('GET /api/diag?key= — fetch one (D-02, T-33-09)', () => {
	it('an existing key → 200 with the stored bytes verbatim as application/json', async () => {
		const bucket = seededBucket();
		const res = await callGET(
			fakeEvent('GET', { headers: bearer(READ_TOKEN), env: readEnv(bucket), search: { key: KEY_A } })
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/json');
		expect(await res.text()).toBe(LOG);
		expect(bucket.get).toHaveBeenCalledWith(KEY_A);
	});

	it('a well-formed key that is not stored → 404 not-found', async () => {
		const res = await callGET(
			fakeEvent('GET', {
				headers: bearer(READ_TOKEN),
				env: readEnv(seededBucket()),
				search: { key: 'log/does-not-exist.json' }
			})
		);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ ok: false, err: 'not-found' });
	});

	it('a traversal key → 400 invalid-key and bucket.get is never called', async () => {
		const bucket = seededBucket();
		const res = await callGET(
			fakeEvent('GET', {
				headers: bearer(READ_TOKEN),
				env: readEnv(bucket),
				search: { key: '../secrets' }
			})
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, err: 'invalid-key' });
		expect(bucket.get).not.toHaveBeenCalled();
	});

	it('a key outside the log/ prefix → 400 invalid-key and bucket.get is never called', async () => {
		const bucket = seededBucket();
		const res = await callGET(
			fakeEvent('GET', {
				headers: bearer(READ_TOKEN),
				env: readEnv(bucket),
				search: { key: 'other/not-a-log.json' }
			})
		);
		expect(res.status).toBe(400);
		expect(bucket.get).not.toHaveBeenCalled();
	});
});

describe('GET /api/diag — token confidentiality (T-33-02)', () => {
	it('no GET response body of any status contains either token', async () => {
		const bodies = await Promise.all(
			[
				fakeEvent('GET', { env: readEnv(seededBucket()) }), // 401
				fakeEvent('GET', { headers: bearer(UPLOAD_TOKEN), env: readEnv(seededBucket()) }), // 401
				fakeEvent('GET', {
					headers: bearer(READ_TOKEN),
					env: { DIAG_READ_TOKEN: READ_TOKEN }
				}), // 503
				fakeEvent('GET', { headers: bearer(READ_TOKEN), env: readEnv(seededBucket()) }), // 200 list
				fakeEvent('GET', {
					headers: bearer(READ_TOKEN),
					env: readEnv(seededBucket()),
					search: { key: KEY_A }
				}), // 200 one
				fakeEvent('GET', {
					headers: bearer(READ_TOKEN),
					env: readEnv(seededBucket()),
					search: { key: '../secrets' }
				}), // 400
				fakeEvent('GET', {
					headers: bearer(READ_TOKEN),
					env: readEnv(seededBucket()),
					search: { key: 'log/does-not-exist.json' }
				}) // 404
			].map(async (event) => (await callGET(event)).text())
		);
		expect(bodies).toHaveLength(7);
		for (const text of bodies) {
			expect(text).not.toContain(READ_TOKEN);
			expect(text).not.toContain(UPLOAD_TOKEN);
		}
	});
});
