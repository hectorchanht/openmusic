// /api/me/sync — the signed-in user's cross-device backup envelope (quick-261020-acct).
//   GET  → 200 { ok:true, envelope, updatedAt } — envelope is the parsed backup envelope
//          (or null when the user has never synced), updatedAt its epoch-ms write time.
//   PUT { keys } → per-key upsert (quick-261020-incsync), 200 { ok:true, updatedAt }.
//   PUT { envelope } → legacy full-envelope push (old clients); split into per-key rows.
//
// Storage is per-key rows in `user_sync_keys` (one row per sync key): a partial push
// upserts only its keys with NO read-modify-write, so concurrent pushes from two devices
// can never clobber each other's keys. GET assembles the envelope from the rows (falling
// back to the legacy `user_sync` single-row table for pre-migration data) — the client
// GET path is unchanged.
//
// Each pushed key is validated on its own (validateSyncKey mirrors validateEnvelope's
// accept set): a shape the validator refuses must never reach another device's
// localStorage via sync. `null` values delete the key (library cleared, history wiped).
//
// Auth: cookie OR bearer (getUserFromRequest). No session → 401 on both verbs. No
// ACCOUNTS_DB binding → 503 (fail closed, like /api/comments).
// Body cap 2 MB — a full legacy envelope is ~1.4 MB worst case (backup-logic 35-D-03);
// incremental pushes are typically tens of KB.
// Last-write-wins per key by `updated_at`: the conflict rule lives client-side in
// $lib/services/sync.ts; this route just stores what it is given.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS.

import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { getUserFromRequest } from '$lib/auth/auth-core';
import { validateEnvelope, validateSyncKey, BACKUP_MAGIC, BACKUP_FORMAT } from '$lib/backup/backup-logic';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return v != null && typeof v === 'object' && !Array.isArray(v);
}

export const GET: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;
	const db = env?.ACCOUNTS_DB;
	if (!db) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	const user = await getUserFromRequest(request, db);
	if (!user) return jsonResponse({ ok: false, err: 'unauthorized' }, origin, { status: 401 });

	const rows = await db
		.prepare('SELECT key AS k, data, updated_at FROM user_sync_keys WHERE user_id = ?')
		.bind(user.id)
		.all<{ k: string; data: string; updated_at: number }>();
	if (rows.results.length > 0) {
		const keys: Record<string, unknown> = {};
		let updatedAt = 0;
		let corrupt = false;
		for (const r of rows.results) {
			try {
				keys[r.k] = JSON.parse(r.data);
			} catch {
				corrupt = true;
				break;
			}
			if (r.updated_at > updatedAt) updatedAt = r.updated_at;
		}
		if (!corrupt) {
			const envelope = {
				app: BACKUP_MAGIC,
				format: BACKUP_FORMAT,
				exportedAt: new Date(updatedAt).toISOString(),
				keys
			};
			return jsonResponse({ ok: true, envelope, updatedAt }, origin);
		}
		// Corrupt row reads as "nothing synced" (same posture as the legacy path below).
		return jsonResponse({ ok: true, envelope: null, updatedAt: null }, origin);
	}

	// Legacy fallback: pre-migration single-row envelope.
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
	const partial = (body as { keys?: unknown })?.keys;

	// Legacy full-envelope push (old clients): validate the whole envelope, then split
	// into per-key rows. New clients send { keys } with only what changed.
	let keys: Record<string, unknown>;
	if (candidate !== undefined) {
		// Serialize → validate through the ONE envelope validator (see header). Only the
		// validator's cleaned envelope is stored, never the raw client object.
		const verdict = validateEnvelope(JSON.stringify(candidate));
		if (!verdict.ok) {
			return jsonResponse({ ok: false, err: 'invalid-envelope' }, origin, { status: 400 });
		}
		keys = verdict.envelope.keys as Record<string, unknown>;
	} else if (isPlainObject(partial)) {
		keys = partial;
		// Per-key validation: each pushed key must be an allowed sync key with a valid
		// shape, or null (tombstone — the client cleared that family locally).
		for (const [k, v] of Object.entries(keys)) {
			if (v === null) continue;
			if (!validateSyncKey(k, v)) {
				return jsonResponse({ ok: false, err: 'invalid-key' }, origin, { status: 400 });
			}
		}
	} else {
		return jsonResponse({ ok: false, err: 'invalid' }, origin, { status: 400 });
	}

	const updatedAt = Date.now();
	const stmts = [];
	for (const [k, v] of Object.entries(keys)) {
		if (v === null) {
			stmts.push(
				db.prepare('DELETE FROM user_sync_keys WHERE user_id = ? AND key = ?').bind(user.id, k)
			);
		} else {
			stmts.push(
				db
					.prepare(
						'INSERT INTO user_sync_keys (user_id, key, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
					)
					.bind(user.id, k, JSON.stringify(v), updatedAt)
			);
		}
	}
	// One atomic batch: concurrent partial pushes from two devices upsert disjoint keys
	// without a read-modify-write race.
	if (stmts.length > 0) await db.batch(stmts);
	return jsonResponse({ ok: true, updatedAt }, origin);
};
