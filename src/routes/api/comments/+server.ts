// /api/comments — per-song public comments, moderated MVP (quick-260926-nsz).
//   GET  ?k=<32hex>          public thread (edge-cached, hidden items dropped)
//   GET  ?k=<32hex>&all=1    maintainer view incl. hidden items + report counts (Bearer DIAG_READ_TOKEN)
//   POST {k,name,text,token} post a comment (Turnstile-verified, per-IP throttled)
//   POST {k,action:'report',id} report a comment; HIDE_REPORTS distinct reporters hide it
//   DELETE ?k=&id=           maintainer delete (Bearer DIAG_READ_TOKEN)
//
// Storage: the existing DIAG R2 bucket under `comments/` (threads) and `comments-throttle/` (per-IP
// post throttle). The same bucket holds PRIVATE listening logs under `log/`, so every key is built
// by threadObjectKey / throttleObjectKey from a screened value, and this route never enumerates the
// bucket (T-nsz-02). Same shape, gates and read-modify-write pattern as /api/lyric-offset.
//
// The read token doubles as the moderation token on purpose: it is already the "maintainer's laptop
// only" credential (never on a device), and a second secret is one more thing to provision by hand.
// DELETE is deliberately NOT in corsHeaders' Allow-Methods — it is curl-only, no browser needs it.
//
// Fails CLOSED like /api/diag: an absent binding (tests, a misconfigured deploy) answers 503 rather
// than throwing, and nothing reaches R2 until the key / token / size / shape / Turnstile screens pass.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — `GET`, `POST`, `DELETE`. A top-level helper export
// makes SvelteKit throw "Invalid export" at REQUEST time (commit 29c1c7d); helpers live in $lib/proxy.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import { bearerMatches } from '$lib/proxy/diag-auth';
import { verifyTurnstile, parseHostnames } from '$lib/proxy/turnstile';
import {
	isThreadKey,
	isCommentId,
	threadObjectKey,
	throttleObjectKey,
	parseCommentBody,
	parseThread,
	emptyThread,
	addComment,
	addReport,
	removeComment,
	publicItems,
	maintainerItems,
	parseThrottle,
	checkThrottle,
	voterId,
	MAX_COMMENT_BODY_BYTES,
	COMMENTS_TTL,
	type ThreadRecord
} from '$lib/proxy/comments';

const MAX_PUT_ATTEMPTS = 3;
// Must equal the widget's `action` in NpComments.svelte; siteverify echoes it back.
const TURNSTILE_ACTION = 'comment';

type Bucket = NonNullable<Env['DIAG']>;

// Bust this PoP's cached public GET for `k` (repair-on-encounter, not a global purge). Must equal
// the GET's own cache key, so the client requests exactly `?k=<k>` and nothing else.
async function bustGet(url: URL, k: string): Promise<void> {
	const getUrl = new URL(url);
	getUrl.search = 'k=' + k;
	await edgeCache()?.delete(ownOriginCacheKey(getUrl));
}

// Read-modify-write one thread under R2 conditional puts (T-nsz-12). `edit` returning null means
// "nothing to change" (unknown id) and short-circuits with no put. `etagMatches` on update is
// documented; the create branch's `etagDoesNotMatch: '*'` wildcard is not — if the runtime ignores
// it, the worst case is last-writer-wins on the very FIRST write to a thread.
async function editThread(
	bucket: Bucket,
	k: string,
	edit: (rec: ThreadRecord) => ThreadRecord | null
): Promise<ThreadRecord | 'not-found' | 'conflict'> {
	const key = threadObjectKey(k);
	for (let attempt = 0; attempt < MAX_PUT_ATTEMPTS; attempt++) {
		const obj = await bucket.get(key);
		const next = edit(obj ? parseThread(await obj.text()) : emptyThread());
		if (!next) return 'not-found';
		const put = await bucket.put(key, JSON.stringify(next), {
			httpMetadata: { contentType: 'application/json' },
			onlyIf: obj ? { etagMatches: obj.etag } : { etagDoesNotMatch: '*' }
		});
		if (put) return next;
	}
	return 'conflict';
}

export const GET: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');
	const k = url.searchParams.get('k');
	// Cheapest check first, before any binding lookup or I/O.
	if (!isThreadKey(k)) return jsonResponse({ ok: false, err: 'invalid-key' }, origin, { status: 400 });
	const env = platform?.env as Env | undefined;

	if (url.searchParams.get('all') === '1') {
		// Maintainer view. Token BEFORE the binding lookup, the cache and R2 (the /api/diag GET order),
		// and never cached: it must be fresh, and must never land where a public GET could hit it.
		if (!(await bearerMatches(request.headers.get('authorization'), env?.DIAG_READ_TOKEN))) {
			return jsonResponse({ ok: false, err: 'unauthorized' }, origin, { status: 401 });
		}
		const bucket = env?.DIAG;
		if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });
		const obj = await bucket.get(threadObjectKey(k));
		const rec = obj ? parseThread(await obj.text()) : emptyThread();
		return jsonResponse({ ok: true, items: maintainerItems(rec) }, origin);
	}

	const bucket = env?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	const cache = edgeCache();
	const cacheReq = ownOriginCacheKey(url);
	if (cache) {
		const hit = await cache.match(cacheReq);
		// Re-apply CORS for THIS origin (WR-01): the stored copy is CORS-free.
		// quick-260926-vur: `no-cache` is for the BROWSER cache — it must revalidate (no validator, so a
		// refetch), or a post -> song change -> return re-serves the pre-post reply for the whole TTL.
		// The edge TTL lives on the stored copy's own header in the cache.put below.
		if (hit) return jsonResponse(await hit.json(), origin, { cacheControl: 'no-cache' });
	}

	const obj = await bucket.get(threadObjectKey(k));
	const rec = obj ? parseThread(await obj.text()) : emptyThread();
	// A missing object is a cacheable {ok, items:[]} by design — it is the common case.
	const body = { ok: true, items: publicItems(rec) };
	if (cache) {
		await cache.put(
			cacheReq,
			new Response(JSON.stringify(body), {
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${COMMENTS_TTL}` }
			})
		);
	}
	return jsonResponse(body, origin, { cacheControl: 'no-cache' });
};

// ponytail: residual risks, accepted for the MVP. Turnstile stops scripted posting, not human
// farms or solver services; IP rotation defeats the per-IP throttle; there is no profanity/word
// filter; illegal or defamatory content stays up until HIDE_REPORTS reports or a maintainer DELETE;
// reports are NOT Turnstile-gated, so 3 coordinated addresses can hide any comment (accepted:
// hiding is reversible — the maintainer view still lists it — and it errs toward less exposure).
// Upgrade path: a Cloudflare rate-limiting rule on POST /api/comments, a word list in cleanText,
// Turnstile on reports, and HMAC-peppered voter ids.
export const POST: RequestHandler = async (event) => {
	const { url, request, platform } = event;
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;

	const bucket = env?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	// quick-260926-mzn drive-by guard, same as /api/lyric-offset. CORS only hides the RESPONSE: a
	// foreign page can still fire a no-preflight `text/plain` POST from every visitor's browser, and
	// each visitor's IP is a fresh reporter/poster. Two cheap gates close that:
	//   1. a browser always sends Origin on a POST — refuse any origin not on the CORS allow-list
	//      (absent Origin = a non-browser client, which a web page cannot drive);
	//   2. require application/json, which a cross-origin page cannot send without a preflight, and
	//      hooks.server.ts answers that preflight with no Allow-Origin for a foreign origin.
	if (origin !== null && !isAllowedOrigin(origin)) {
		return jsonResponse({ ok: false, err: 'forbidden-origin' }, origin, { status: 403 });
	}
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return jsonResponse({ ok: false, err: 'unsupported-type' }, origin, { status: 415 });
	}

	// Size screen exactly as /api/diag: the declared length costs no read; the real length is
	// re-checked because the header can lie or be absent.
	if (Number(request.headers.get('content-length') ?? '0') > MAX_COMMENT_BODY_BYTES) {
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
	}
	const text = await request.text();
	if (text.length > MAX_COMMENT_BODY_BYTES) {
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
	}

	const body = parseCommentBody(text);
	if (!body) return jsonResponse({ ok: false, err: 'invalid' }, origin, { status: 400 });

	// adapter-cloudflare returns cf-connecting-ip (may be null despite the type); other adapters
	// throw. A write with no attributable address is refused, never accepted anonymously.
	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		ip = null;
	}
	if (!ip) return jsonResponse({ ok: false, err: 'no-address' }, origin, { status: 400 });

	const voter = await voterId(ip);

	if (body.action === 'report') {
		// Reports never touch the throttle: one report per voter per comment is already enforced by
		// the voter dedupe in addReport.
		const next = await editThread(bucket, body.k, (rec) => addReport(rec, body.id, voter));
		if (next === 'not-found') return jsonResponse({ ok: false, err: 'not-found' }, origin, { status: 404 });
		if (next === 'conflict') return jsonResponse({ ok: false, err: 'conflict' }, origin, { status: 409 });
		await bustGet(url, body.k);
		return jsonResponse({ ok: true, items: publicItems(next) }, origin);
	}

	// Turnstile BEFORE the throttle and ANY R2 access: a tokenless bot costs zero R2 ops and cannot
	// burn a real user's throttle slot from a shared address.
	const verdict = await verifyTurnstile({
		token: body.token,
		ip,
		secret: env?.TurnstileSecret,
		hostnames: parseHostnames(env?.TURNSTILE_HOSTNAMES),
		expectedAction: TURNSTILE_ACTION
	});
	if (verdict === 'unconfigured') return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });
	if (verdict !== 'ok') return jsonResponse({ ok: false, err: 'turnstile' }, origin, { status: 403 });

	// THROTTLE FIRST, then the thread write. One conditional put of the next throttle state; a lost
	// race is two posts from the same address at once, which IS "too fast" — no retry loop.
	const now = Date.now();
	const thKey = throttleObjectKey(voter);
	const thObj = await bucket.get(thKey);
	const gate = checkThrottle(thObj ? parseThrottle(await thObj.text()) : null, now);
	if (!gate.ok) return jsonResponse({ ok: false, err: 'slow-down' }, origin, { status: 429 });
	const thPut = await bucket.put(thKey, JSON.stringify(gate.next), {
		httpMetadata: { contentType: 'application/json' },
		onlyIf: thObj ? { etagMatches: thObj.etag } : { etagDoesNotMatch: '*' }
	});
	if (!thPut) return jsonResponse({ ok: false, err: 'slow-down' }, origin, { status: 429 });

	// On a 409 below the throttle slot is already consumed — accepted: the client shows "unavailable"
	// and the next attempt 30 s later works. Sequencing the throttle AFTER the thread write would let
	// a racing pair from one address double-post.
	const next = await editThread(bucket, body.k, (rec) =>
		addComment(rec, { id: crypto.randomUUID(), name: body.name, text: body.text, t: now })
	);
	if (next === 'conflict' || next === 'not-found') {
		return jsonResponse({ ok: false, err: 'conflict' }, origin, { status: 409 });
	}
	await bustGet(url, body.k);
	// No cache options: a write reply is never cacheable.
	return jsonResponse({ ok: true, items: publicItems(next) }, origin);
};

export const DELETE: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;
	// Token FIRST: nothing about the request is inspected, and no binding or R2 is touched, until it
	// passes. bearerMatches fails CLOSED when DIAG_READ_TOKEN is unset.
	if (!(await bearerMatches(request.headers.get('authorization'), env?.DIAG_READ_TOKEN))) {
		return jsonResponse({ ok: false, err: 'unauthorized' }, origin, { status: 401 });
	}
	const k = url.searchParams.get('k');
	const id = url.searchParams.get('id');
	if (!isThreadKey(k)) return jsonResponse({ ok: false, err: 'invalid-key' }, origin, { status: 400 });
	if (!isCommentId(id)) return jsonResponse({ ok: false, err: 'invalid' }, origin, { status: 400 });
	const bucket = env?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	const next = await editThread(bucket, k, (rec) => removeComment(rec, id));
	if (next === 'not-found') return jsonResponse({ ok: false, err: 'not-found' }, origin, { status: 404 });
	if (next === 'conflict') return jsonResponse({ ok: false, err: 'conflict' }, origin, { status: 409 });
	await bustGet(url, k);
	return jsonResponse({ ok: true }, origin);
};
