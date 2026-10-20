// /api/me/sync — the signed-in user's cross-device backup envelope (quick-261020-acct).
//   GET  → 200 { ok:true, envelope, updatedAt } — envelope is the parsed backup envelope
//          (or null when the user has never synced), updatedAt its epoch-ms write time.
//   PUT { envelope } → validates, upserts, 200 { ok:true, updatedAt }.
//
// The payload is EXACTLY the Settings → Data backup envelope ($lib/backup/backup-logic.ts):
// the server stores one envelope per user in `user_sync` and the client applies it with the
// same validateEnvelope / applyEnvelope pair the file import uses — one format, one
// validator, both directions. The PUT re-validates server-side (serialize → validateEnvelope)
// because a client-supplied envelope is untrusted input even from a signed-in user: a shape
// the validator refuses must never reach another device's localStorage via sync.
//
// Auth: cookie OR bearer (getUserFromRequest). No session → 401 on both verbs. No
// ACCOUNTS_DB binding → 503 (fail closed, like /api/comments).
// Body cap 2 MB — a measured worst-case envelope is ~1.4 MB (backup-logic 35-D-03).
// Last-write-wins by `updated_at`: the conflict rule lives client-side in
// $lib/services/sync.ts; this route just stores what it is given.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { getUserFromRequest } from '$lib/auth/auth-core';
import { validateEnvelope } from '$lib/backup/backup-logic';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const GET: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;
	const db = env?.ACCOUNTS_DB;
	if (!db) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	const user = await getUserFromRequest(request, db);
	if (!user) return jsonResponse({ ok: false, err: 'unauthorized' }, origin, { status: 401 });

	const row = await db
		.prepare('SELECT data, updated_at FROM user_sync WHERE user_id = ?')
		.bind(user.id)
		.first<{ data: string; updated_at: number }>();
	if (!row) return jsonResponse({ ok: true, envelope: null, updatedAt: null }, origin);

	// A corrupt stored payload reads as "nothing synced" rather than a 500: the client's
	// next push overwrites it, and no device ever receives bytes validateEnvelope refused.
	let envelope: unknown = null;
	try {
		envelope = JSON.parse(row.data);
	} catch {
		envelope = null;
	}
	return jsonResponse({ ok: true, envelope, updatedAt: row.updated_at }, origin);
};

export const PUT: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;

	// Drive-by guards first (quick-260926-mzn), same as the other write routes.
	if (origin !== null && !isAllowedOrigin(origin)) {
		return jsonResponse({ ok: false, err: 'forbidden-origin' }, origin, { status: 403 });
	}
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return jsonResponse({ ok: false, err: 'unsupported-type' }, origin, { status: 415 });
	}
	const db = env?.ACCOUNTS_DB;
	if (!db) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	const user = await getUserFromRequest(request, db);
	if (!user) return jsonResponse({ ok: false, err: 'unauthorized' }, origin, { status: 401 });

	if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
	}
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) {
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
	}
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return jsonResponse({ ok: false, err: 'invalid' }, origin, { status: 400 });
	}
	const candidate = (body as { envelope?: unknown })?.envelope;
	if (candidate === undefined) {
		return jsonResponse({ ok: false, err: 'invalid' }, origin, { status: 400 });
	}
	// Serialize → validate through the ONE envelope validator (see header). Only the
	// validator's cleaned envelope is stored, never the raw client object.
	const verdict = validateEnvelope(JSON.stringify(candidate));
	if (!verdict.ok) {
		return jsonResponse({ ok: false, err: 'invalid-envelope' }, origin, { status: 400 });
	}

	const updatedAt = Date.now();
	const data = JSON.stringify(verdict.envelope);
	await db
		.prepare(
			'INSERT INTO user_sync (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
		)
		.bind(user.id, data, updatedAt)
		.run();
	return jsonResponse({ ok: true, updatedAt }, origin);
};
