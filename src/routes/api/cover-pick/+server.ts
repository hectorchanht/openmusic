// /api/cover-pick — crowd-shared cover picks (Phase 40 D-13 / D-16 / D-17 / D-18 / D-18a / D-19).
// GET reads the consensus for a song's uid key and/or name key in ONE request; POST records one
// listener's pick against either or both.
//
// Storage: the existing DIAG R2 bucket under `cover-pick/` + `cover-pick-throttle/` (no new binding —
// a new one needs a human Cloudflare re-auth). The same bucket holds PRIVATE listening logs, so every
// key is built by `pickObjectKey` / `pickThrottleKey` from a value that already passed a hex screen,
// and this route never lists.
//
// Fails CLOSED like /api/lyric-offset: an absent binding answers 503 rather than throwing, and nothing
// reaches R2 until the key / origin / size / shape screens pass.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — `GET` and `POST`. A top-level helper export makes
// SvelteKit throw "Invalid export" at REQUEST time (commit 29c1c7d); helpers live in $lib/proxy.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import {
	isPickKey,
	pickObjectKey,
	pickThrottleKey,
	pickCacheUrl,
	parseVoteBody,
	parseRecord,
	emptyRecord,
	applyVote,
	consensus,
	voterId,
	throttleVoterId,
	parseThrottle,
	checkThrottle,
	MAX_VOTE_BODY_BYTES,
	COVER_PICK_TTL
} from '$lib/proxy/cover-pick';

const MAX_PUT_ATTEMPTS = 3;

type Bucket = NonNullable<Env['DIAG']>;

async function readConsensus(bucket: Bucket, kind: 'u' | 'n', k: string): Promise<string | null> {
	const obj = await bucket.get(pickObjectKey(kind, k));
	return consensus(obj ? parseRecord(await obj.text()) : emptyRecord());
}

/**
 * Read-modify-write one key's record under R2 conditional puts (as lyric-offset). Returns the new
 * consensus, or `false` when every attempt lost the race.
 */
async function castVote(bucket: Bucket, kind: 'u' | 'n', k: string, ip: string, url: string): Promise<string | null | false> {
	const key = pickObjectKey(kind, k);
	const voter = await voterId(ip, k);
	for (let attempt = 0; attempt < MAX_PUT_ATTEMPTS; attempt++) {
		const obj = await bucket.get(key);
		const rec = obj ? parseRecord(await obj.text()) : emptyRecord();
		const next = applyVote(rec, voter, url, Date.now());
		const put = await bucket.put(key, JSON.stringify(next), {
			httpMetadata: { contentType: 'application/json' },
			onlyIf: obj ? { etagMatches: obj.etag } : { etagDoesNotMatch: '*' }
		});
		if (put) return consensus(next);
	}
	return false;
}

export const GET: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');
	const u = url.searchParams.get('u');
	const n = url.searchParams.get('n');
	// Cheapest check first, before any binding lookup or I/O. At least one key; every present key valid.
	if ((u === null && n === null) || (u !== null && !isPickKey(u)) || (n !== null && !isPickKey(n))) {
		return jsonResponse({ ok: false, err: 'invalid-key' }, origin, { status: 400 });
	}

	const bucket = (platform?.env as Env | undefined)?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	const cache = edgeCache();
	// Off the public URL (pickCacheUrl) so the adapter worker can never serve it without CORS.
	const cacheReq = ownOriginCacheKey(pickCacheUrl(url.origin, { u, n }));
	if (cache) {
		const hit = await cache.match(cacheReq);
		// Re-apply CORS for THIS origin: the stored copy is CORS-free. `no-cache` is for the BROWSER
		// (must refetch after a vote); the edge TTL lives on the stored copy's header below.
		if (hit) return jsonResponse(await hit.json(), origin, { cacheControl: 'no-cache' });
	}

	// A missing object is a cacheable null by design — the common case, and caching it keeps the
	// one-GET-per-play fan-in (D-16) cheap.
	const body = {
		ok: true,
		u: u ? await readConsensus(bucket, 'u', u) : null,
		n: n ? await readConsensus(bucket, 'n', n) : null
	};
	if (cache) {
		await cache.put(
			cacheReq,
			new Response(JSON.stringify(body), {
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${COVER_PICK_TTL}` }
			})
		);
	}
	return jsonResponse(body, origin, { cacheControl: 'no-cache' });
};

// ponytail: the D-18a per-IP throttle bounds write floods and one address's reach, but IP rotation
// (sybil votes) is NOT closed, and an allowlisted host can still carry a user-uploaded image (e.g.
// googleusercontent, Last.fm /i/u/). A local pin always beats the crowd on the client, so the blast
// radius is a wrong default one pick fixes. Upgrade path: a quorum, Turnstile, or a Cloudflare
// rate-limiting rule on POST /api/cover-pick.
export const POST: RequestHandler = async (event) => {
	const { url, request, platform } = event;
	const origin = request.headers.get('origin');

	const bucket = (platform?.env as Env | undefined)?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	// Drive-by vote guard (T-40-06-01). Stricter than lyric-offset: an ABSENT Origin is refused too —
	// a browser always sends Origin on a POST, and votes are only taken from our own clients.
	// application/json cannot be sent cross-origin without a preflight hooks.server.ts refuses.
	if (!isAllowedOrigin(origin)) {
		return jsonResponse({ ok: false, err: 'forbidden-origin' }, origin, { status: 403 });
	}
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return jsonResponse({ ok: false, err: 'unsupported-type' }, origin, { status: 415 });
	}

	// The declared length costs no read; the real length is re-checked because the header can lie.
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
	// throw. A vote with no attributable voter is refused, never accepted anonymously.
	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		ip = null;
	}
	if (!ip) return jsonResponse({ ok: false, err: 'no-address' }, origin, { status: 400 });

	// D-18a: THROTTLE FIRST, then the records (as the comments route). One conditional put of the next
	// throttle state; a lost race is two votes from one address at once, which IS too fast — no retry.
	const thKey = pickThrottleKey(await throttleVoterId(ip));
	const thObj = await bucket.get(thKey);
	const gate = checkThrottle(thObj ? parseThrottle(await thObj.text()) : null, Date.now());
	if (!gate.ok) return jsonResponse({ ok: false, err: 'slow-down' }, origin, { status: 429 });
	const thPut = await bucket.put(thKey, JSON.stringify(gate.next), {
		httpMetadata: { contentType: 'application/json' },
		onlyIf: thObj ? { etagMatches: thObj.etag } : { etagDoesNotMatch: '*' }
	});
	if (!thPut) return jsonResponse({ ok: false, err: 'slow-down' }, origin, { status: 429 });

	// D-13: each present key in fixed u-then-n order. On a 409 the throttle slot is already spent —
	// accepted, the next pick after the gap works.
	const result: { u: string | null; n: string | null } = { u: null, n: null };
	for (const kind of ['u', 'n'] as const) {
		const k = vote[kind];
		if (!k) continue;
		const c = await castVote(bucket, kind, k, ip, vote.url);
		if (c === false) return jsonResponse({ ok: false, err: 'conflict' }, origin, { status: 409 });
		result[kind] = c;
	}

	// Bust this PoP's cached GET (repair-on-encounter, not a global purge). `pickCacheUrl` is the
	// GET's own key builder, so this is byte-identical to what the GET cached.
	await edgeCache()?.delete(ownOriginCacheKey(pickCacheUrl(url.origin, { u: vote.u, n: vote.n })));
	// No cache options: a write reply is never cacheable.
	return jsonResponse({ ok: true, ...result }, origin);
};
