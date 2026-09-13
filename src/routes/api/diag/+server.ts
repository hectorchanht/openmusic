// /api/diag — the maintainer's activity-log drop box. POST uploads one log, GET lists them.
//
// TWO TOKENS, DELIBERATELY ASYMMETRIC (D-01 / D-02 / D-03):
//   DIAG_UPLOAD_TOKEN gates POST. It ships ON the device, so assume it can leak; the blast radius
//     is bounded at "a stranger can push junk logs into the bucket" because it grants WRITE ONLY.
//   DIAG_READ_TOKEN gates both GETs. It never leaves the maintainer's laptop — it is the credential
//     that reads listening history, so the upload token must never be accepted here (T-33-07).
// Collapsing them into one token would hand every device a read key. Do not.
//
// Every gate FAILS CLOSED: an unset secret rejects rather than waves through (`bearerMatches`), an
// absent binding answers 503 rather than throwing, and nothing reaches `bucket.put` until auth,
// size and shape have all passed (T-33-05).
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — `POST` and `GET`, nothing else, ever. A top-level
// `export function helper()` in a `+server.ts` makes SvelteKit throw "Invalid export" at REQUEST
// time (it shipped once, commit 29c1c7d), and unit tests cannot catch it because they import this
// module directly. Every helper below is imported from `$lib/proxy/*` (T-33-13).

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse } from '$lib/proxy/http';
import { bearerMatches } from '$lib/proxy/diag-auth';
import { screenLogPayload, diagKey, isDiagKey, MAX_UPLOAD_BYTES } from '$lib/proxy/diag-payload';

export const POST: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');
	// platform?.env is the verified Cloudflare-adapter binding path (parity with /api/translate).
	const env = platform?.env as Env | undefined;

	// 1. AUTH — before the body is read, so an unauthenticated flood costs one digest, not a parse
	// (T-33-01). Fail CLOSED: a missing DIAG_UPLOAD_TOKEN rejects everything, the opposite of the
	// optional-key routes in $lib/proxy that degrade gracefully when their key is absent.
	if (!(await bearerMatches(request.headers.get('authorization'), env?.DIAG_UPLOAD_TOKEN))) {
		return jsonResponse({ ok: false, err: 'unauthorized' }, origin, { status: 401 });
	}

	// 2. BINDING — absent under `vite dev` and in tests. A SUPPORTED state, not an error: say so
	// with a 503 rather than letting `undefined.put` throw a 500 (D-07).
	const bucket = env?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	// 3. SCREEN — the declared length costs zero CPU and no body read. Workers Free gives 10 ms per
	// request; a half-megabyte parse would blow it and turn a clean 413 into an opaque 5xx (T-33-04).
	if (Number(request.headers.get('content-length') ?? '0') > MAX_UPLOAD_BYTES) {
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
	}

	// 4. READ — I/O, not CPU. Re-check the real size: the header is client-supplied and can lie or
	// be absent entirely.
	const text = await request.text();
	if (text.length > MAX_UPLOAD_BYTES) {
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
	}

	// 5. VALIDATE — one never-throw screen returning the valid entry count or null (D-05).
	const entries = screenLogPayload(text);
	if (entries == null) return jsonResponse({ ok: false, err: 'invalid' }, origin, { status: 400 });

	// 6. STORE the RAW validated text. Never re-serialize the parsed entries: that would double the
	// CPU cost and silently drop every field `parseActionLog` does not name, which is precisely the
	// unknown detail a diagnostic upload exists to preserve.
	const key = diagKey(Date.now(), crypto.randomUUID());
	await bucket.put(key, text, { httpMetadata: { contentType: 'application/json' } });

	// No ttl / cacheControl => no Cache-Control header. A diagnostics reply is never cacheable.
	return jsonResponse({ ok: true, key, entries }, origin);
};

export const GET: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;

	// AUTH against the READ token ONLY (D-02 / D-03). The upload token lives on a device and must
	// not open this door — write capability does not grant read (T-33-07).
	if (!(await bearerMatches(request.headers.get('authorization'), env?.DIAG_READ_TOKEN))) {
		return jsonResponse({ ok: false, err: 'unauthorized' }, origin, { status: 401 });
	}

	const bucket = env?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	const key = url.searchParams.get('key');

	// LIST. `list()` IS the index — no manifest object to keep in sync, so no read-modify-write race
	// between two concurrent uploads. `diagKey`'s ISO prefix makes R2's lexicographic key order
	// chronological for free. `uploaded` is a Date; serializing the reply renders it as ISO.
	if (key === null) {
		const { objects } = await bucket.list({ prefix: 'log/' });
		const logs = objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded }));
		return jsonResponse({ ok: true, logs }, origin);
	}

	// FETCH ONE. Screen the untrusted key BEFORE any storage call (T-33-09), so this endpoint can
	// only ever return objects the upload endpoint could have written.
	if (!isDiagKey(key)) {
		return jsonResponse({ ok: false, err: 'invalid-key' }, origin, { status: 400 });
	}
	const obj = await bucket.get(key);
	if (!obj) return jsonResponse({ ok: false, err: 'not-found' }, origin, { status: 404 });

	// The ONLY hand-built Response in this file, and the reason is CPU, not style: the stored object
	// is ALREADY serialized JSON, so jsonResponse would encode it a second time into a JSON string,
	// and parse-then-re-encode would spend the 10 ms budget we do not have. Streaming `obj.body`
	// straight through is zero-CPU passthrough — the same posture as the audio stream routes.
	// CORS is still applied: hooks.server.ts merges it onto every /api/* response.
	return new Response(obj.body, {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
};
