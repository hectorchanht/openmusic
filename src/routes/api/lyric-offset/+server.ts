// /api/lyric-offset — shared per-lyrics time offsets (quick-260926-mzn). GET reads the consensus for
// one fingerprint key; POST records one listener's vote.
//
// Storage: the existing DIAG R2 bucket under the `lyric-offset/` prefix (no new binding). The same
// bucket holds PRIVATE listening logs under `log/`, so every key is built by `offsetObjectKey` from
// a value that already passed `isOffsetKey` (32 hex), and this route never lists (T-mzn-02).
//
// Fails CLOSED like /api/diag: an absent binding (vite dev, tests) answers 503 rather than throwing,
// and nothing reaches R2 until the key / size / shape screens pass.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — `GET` and `POST`. A top-level helper export makes
// SvelteKit throw "Invalid export" at REQUEST time (commit 29c1c7d); helpers live in $lib/proxy.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import {
	isOffsetKey,
	offsetObjectKey,
	parseVoteBody,
	parseRecord,
	emptyRecord,
	applyVote,
	consensus,
	voterId,
	MAX_VOTE_BODY_BYTES,
	SHARED_OFFSET_TTL
} from '$lib/proxy/lyric-offset';

const MAX_PUT_ATTEMPTS = 3;

export const GET: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');
	const k = url.searchParams.get('k');
	// Cheapest check first, before any binding lookup or I/O.
	if (!isOffsetKey(k)) return jsonResponse({ ok: false, err: 'invalid-key' }, origin, { status: 400 });

	const bucket = (platform?.env as Env | undefined)?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	const cache = edgeCache();
	const cacheReq = ownOriginCacheKey(url);
	if (cache) {
		const hit = await cache.match(cacheReq);
		// Re-apply CORS for THIS origin (WR-01): the stored copy is CORS-free.
		if (hit) return jsonResponse(await hit.json(), origin, { ttl: SHARED_OFFSET_TTL });
	}

	const obj = await bucket.get(offsetObjectKey(k));
	const rec = obj ? parseRecord(await obj.text()) : emptyRecord();
	// A missing object is a cacheable {ok, offset:null, n:0} by design — it is the common case, and
	// caching it is what keeps the one-GET-per-track fan-in cheap.
	const body = { ok: true, ...consensus(rec) };
	if (cache) {
		await cache.put(
			cacheReq,
			new Response(JSON.stringify(body), {
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${SHARED_OFFSET_TTL}` }
			})
		);
	}
	return jsonResponse(body, origin, { ttl: SHARED_OFFSET_TTL });
};

// ponytail: no rate limit here. IP rotation (sybil votes) and write floods (R2 class-A op budget)
// are NOT closed — the median + >=3-agree window + 50-vote cap raise the bar, and a local offset
// (or an explicit 0) always beats the consensus, so the blast radius is a wrong default one tap
// fixes. Upgrade path: a Cloudflare rate-limiting rule or Turnstile on POST /api/lyric-offset. No
// new bindings or secrets by design (this account's wrangler auth needs a human re-login).
export const POST: RequestHandler = async (event) => {
	const { url, request, platform } = event;
	const origin = request.headers.get('origin');

	const bucket = (platform?.env as Env | undefined)?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	// Size screen exactly as /api/diag: the declared length costs no read; the real length is
	// re-checked because the header can lie or be absent.
	if (Number(request.headers.get('content-length') ?? '0') > MAX_VOTE_BODY_BYTES) {
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
	}
	const text = await request.text();
	if (text.length > MAX_VOTE_BODY_BYTES) {
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
	}

	const vote = parseVoteBody(text);
	if (!vote) return jsonResponse({ ok: false, err: 'invalid' }, origin, { status: 400 });

	// adapter-cloudflare returns cf-connecting-ip (may be null despite the type); other adapters
	// throw. A vote with no attributable voter is refused, never accepted anonymously (T-mzn-10).
	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		ip = null;
	}
	if (!ip) return jsonResponse({ ok: false, err: 'no-address' }, origin, { status: 400 });

	const voter = await voterId(ip, vote.k);
	const key = offsetObjectKey(vote.k);

	// Read-modify-write under R2 conditional puts (T-mzn-06). `etagMatches` on update is documented.
	// The create branch's `etagDoesNotMatch: '*'` wildcard is NOT documented by R2; if the runtime
	// ignores it the worst case is last-writer-wins on the very FIRST vote for a key (one lost vote).
	for (let attempt = 0; attempt < MAX_PUT_ATTEMPTS; attempt++) {
		const obj = await bucket.get(key);
		const rec = obj ? parseRecord(await obj.text()) : emptyRecord();
		const next = applyVote(rec, voter, vote.offset, Date.now());
		const put = await bucket.put(key, JSON.stringify(next), {
			httpMetadata: { contentType: 'application/json' },
			onlyIf: obj ? { etagMatches: obj.etag } : { etagDoesNotMatch: '*' }
		});
		if (put) {
			// Bust this PoP's cached GET for the key (repair-on-encounter, not a global purge). Must
			// equal the GET's own cache key, so the client requests exactly `?k=<k>` and nothing else.
			const getUrl = new URL(url);
			getUrl.search = 'k=' + vote.k;
			await edgeCache()?.delete(ownOriginCacheKey(getUrl));
			// No ttl: a write reply is never cacheable.
			return jsonResponse({ ok: true, ...consensus(next) }, origin);
		}
	}
	return jsonResponse({ ok: false, err: 'conflict' }, origin, { status: 409 });
};
