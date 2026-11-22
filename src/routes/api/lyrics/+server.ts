// /api/lyrics — community lyrics, one record per SONG (quick-261122-ugcb3, UGC lyrics B3, brief §3–4).
//   GET  ?k=<32hex>          public versions, CANONICAL (most-pinned) FIRST — edge-cached, hidden dropped
//   GET  ?k=<32hex>&all=1    maintainer view incl. hidden + report/pin counts (Bearer DIAG_READ_TOKEN)
//   POST {k,lrc,estimated,title,artist,duration,token}
//                            submit a version: SIGNED-IN account + Turnstile + per-account throttle,
//                            then THE CHECK (checkLyricText). The submitter's vote moves onto it.
//   POST {k,action:'pin',id} a listener's ONE vote for this song moves onto `id` (pins are the vote)
//   POST {k,action:'report',id} report; HIDE_REPORTS distinct reporters hide it
//   DELETE ?k=&id=           maintainer delete (Bearer DIAG_READ_TOKEN)
//
// Same shape, gates and read-modify-write pattern as /api/comments (its file header has the full
// rationale for every gate kept here: drive-by Origin/content-type guard, size screen before parse,
// Turnstile before any R2 op, throttle before the write, fail CLOSED on a missing binding). Storage
// is the existing DIAG R2 bucket under `lyrics/` + `lyrics-throttle/` — keys built ONLY by
// lyricsObjectKey / lyricsThrottleKey from screened values; this route never enumerates the bucket.
//
// ACCOUNT REQUIRED for submit (check layer 3; Hector-vetoable, brief §3): anonymous users still save
// a LOCAL pin in the editor — only the public write needs an account. Pins and reports stay open to
// everyone (one vote per account, else per address), like comment reports.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — helpers live in $lib/proxy/community-lyrics.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import { bearerMatches } from '$lib/proxy/diag-auth';
import { verifyTurnstile, parseHostnames } from '$lib/proxy/turnstile';
import { getUserFromRequest } from '$lib/auth/auth-core';
import { parseThrottle, checkThrottle, isCommentId } from '$lib/proxy/comments';
import {
	isThreadKey,
	lyricsObjectKey,
	lyricsThrottleKey,
	parseLyricsBody,
	parseLyricsRecord,
	emptyLyricsRecord,
	checkLyricText,
	addVersion,
	pinVersion,
	reportVersion,
	removeVersion,
	publicVersions,
	maintainerVersions,
	lyricsVoterId,
	submitterId,
	MAX_LYRICS_BODY_BYTES,
	LYRICS_TTL,
	type LyricsRecord
} from '$lib/proxy/community-lyrics';

const MAX_PUT_ATTEMPTS = 3;
// The ONE app-wide Turnstile action (TurnstileGate.svelte / the native bridge render exactly this).
const TURNSTILE_ACTION = 'comment';

type Bucket = NonNullable<Env['DIAG']>;

async function bustGet(url: URL, k: string): Promise<void> {
	const getUrl = new URL(url);
	getUrl.search = 'k=' + k;
	await edgeCache()?.delete(ownOriginCacheKey(getUrl));
}

// Read-modify-write one record under R2 conditional puts (the /api/comments editThread).
async function editRecord<T>(
	bucket: Bucket,
	k: string,
	edit: (rec: LyricsRecord) => { rec: LyricsRecord; out: T } | null
): Promise<{ rec: LyricsRecord; out: T } | 'not-found' | 'conflict'> {
	const key = lyricsObjectKey(k);
	for (let attempt = 0; attempt < MAX_PUT_ATTEMPTS; attempt++) {
		const obj = await bucket.get(key);
		const next = edit(obj ? parseLyricsRecord(await obj.text()) : emptyLyricsRecord());
		if (!next) return 'not-found';
		const put = await bucket.put(key, JSON.stringify(next.rec), {
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
	if (!isThreadKey(k)) return jsonResponse({ ok: false, err: 'invalid-key' }, origin, { status: 400 });
	const env = platform?.env as Env | undefined;

	if (url.searchParams.get('all') === '1') {
		if (!(await bearerMatches(request.headers.get('authorization'), env?.DIAG_READ_TOKEN))) {
			return jsonResponse({ ok: false, err: 'unauthorized' }, origin, { status: 401 });
		}
		const bucket = env?.DIAG;
		if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });
		const obj = await bucket.get(lyricsObjectKey(k));
		const rec = obj ? parseLyricsRecord(await obj.text()) : emptyLyricsRecord();
		return jsonResponse({ ok: true, versions: maintainerVersions(rec) }, origin);
	}

	const bucket = env?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	const cache = edgeCache();
	const cacheReq = ownOriginCacheKey(url);
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) return jsonResponse(await hit.json(), origin, { cacheControl: 'no-cache' });
	}
	const obj = await bucket.get(lyricsObjectKey(k));
	const rec = obj ? parseLyricsRecord(await obj.text()) : emptyLyricsRecord();
	const body = { ok: true, versions: publicVersions(rec) };
	if (cache) {
		await cache.put(
			cacheReq,
			new Response(JSON.stringify(body), {
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${LYRICS_TTL}` }
			})
		);
	}
	return jsonResponse(body, origin, { cacheControl: 'no-cache' });
};

export const POST: RequestHandler = async (event) => {
	const { url, request, platform } = event;
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;

	const bucket = env?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	if (origin !== null && !isAllowedOrigin(origin)) {
		return jsonResponse({ ok: false, err: 'forbidden-origin' }, origin, { status: 403 });
	}
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return jsonResponse({ ok: false, err: 'unsupported-type' }, origin, { status: 415 });
	}
	if (Number(request.headers.get('content-length') ?? '0') > MAX_LYRICS_BODY_BYTES) {
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
	}
	const text = await request.text();
	if (new TextEncoder().encode(text).length > MAX_LYRICS_BODY_BYTES) {
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
	}
	const body = parseLyricsBody(text);
	if (!body) return jsonResponse({ ok: false, err: 'invalid' }, origin, { status: 400 });

	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		ip = null;
	}
	if (!ip) return jsonResponse({ ok: false, err: 'no-address' }, origin, { status: 400 });

	// Session lookup is optional for pin/report (a vote identity upgrade) and REQUIRED for submit.
	const db = env?.ACCOUNTS_DB;
	const user = db ? await getUserFromRequest(request, db) : null;
	const voter = await lyricsVoterId({ userId: user?.id ?? null, ip });

	if (body.action === 'pin' || body.action === 'report') {
		const id = body.id;
		const next = await editRecord(bucket, body.k, (rec) => {
			const r = body.action === 'pin' ? pinVersion(rec, id, voter) : reportVersion(rec, id, voter);
			return r ? { rec: r, out: null } : null;
		});
		if (next === 'not-found') return jsonResponse({ ok: false, err: 'not-found' }, origin, { status: 404 });
		if (next === 'conflict') return jsonResponse({ ok: false, err: 'conflict' }, origin, { status: 409 });
		await bustGet(url, body.k);
		return jsonResponse({ ok: true, versions: publicVersions(next.rec) }, origin);
	}

	// SUBMIT. Layer 3 order: account, then Turnstile (before ANY R2 op), then the throttle.
	if (!db) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });
	if (!user) return jsonResponse({ ok: false, err: 'signin' }, origin, { status: 401 });

	const verdict = await verifyTurnstile({
		token: body.token,
		ip,
		secret: env?.TurnstileSecret,
		hostnames: parseHostnames(env?.TURNSTILE_HOSTNAMES),
		expectedAction: TURNSTILE_ACTION
	});
	if (verdict === 'unconfigured') return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });
	if (verdict !== 'ok') return jsonResponse({ ok: false, err: 'turnstile' }, origin, { status: 403 });

	// Layers 1 + 2 (text). Pure and free — but AFTER Turnstile so a bot cannot use this route as a
	// free validator oracle. The reason is returned so the editor can say what to fix.
	const checked = checkLyricText(body.lrc, {
		durationSec: body.duration,
		title: body.title,
		artist: body.artist,
		estimated: body.estimated
	});
	if (!checked.ok) return jsonResponse({ ok: false, err: 'check', reason: checked.err }, origin, { status: 422 });

	const by = await submitterId(user.id);
	const now = Date.now();
	const thKey = lyricsThrottleKey(by);
	const thObj = await bucket.get(thKey);
	const gate = checkThrottle(thObj ? parseThrottle(await thObj.text()) : null, now);
	if (!gate.ok) return jsonResponse({ ok: false, err: 'slow-down' }, origin, { status: 429 });
	const thPut = await bucket.put(thKey, JSON.stringify(gate.next), {
		httpMetadata: { contentType: 'application/json' },
		onlyIf: thObj ? { etagMatches: thObj.etag } : { etagDoesNotMatch: '*' }
	});
	if (!thPut) return jsonResponse({ ok: false, err: 'slow-down' }, origin, { status: 429 });

	const next = await editRecord(bucket, body.k, (rec) => {
		const r = addVersion(rec, { id: crypto.randomUUID(), lrc: checked.lrc, cls: checked.cls, t: now, by }, voter);
		return { rec: r.rec, out: { id: r.id, duplicate: r.duplicate } };
	});
	if (next === 'conflict' || next === 'not-found') {
		return jsonResponse({ ok: false, err: 'conflict' }, origin, { status: 409 });
	}
	await bustGet(url, body.k);
	return jsonResponse(
		{ ok: true, id: next.out.id, duplicate: next.out.duplicate, lrc: checked.lrc, versions: publicVersions(next.rec) },
		origin
	);
};

export const DELETE: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;
	if (!(await bearerMatches(request.headers.get('authorization'), env?.DIAG_READ_TOKEN))) {
		return jsonResponse({ ok: false, err: 'unauthorized' }, origin, { status: 401 });
	}
	const k = url.searchParams.get('k');
	const id = url.searchParams.get('id');
	if (!isThreadKey(k)) return jsonResponse({ ok: false, err: 'invalid-key' }, origin, { status: 400 });
	if (!isCommentId(id)) return jsonResponse({ ok: false, err: 'invalid' }, origin, { status: 400 });
	const bucket = env?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });
	const next = await editRecord(bucket, k, (rec) => {
		const r = removeVersion(rec, id);
		return r ? { rec: r, out: null } : null;
	});
	if (next === 'not-found') return jsonResponse({ ok: false, err: 'not-found' }, origin, { status: 404 });
	if (next === 'conflict') return jsonResponse({ ok: false, err: 'conflict' }, origin, { status: 409 });
	await bustGet(url, k);
	return jsonResponse({ ok: true }, origin);
};
