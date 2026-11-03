// POST /api/sponsored/verify — verify a tip-jar license key against Gumroad.
// Body: { license_key: string, public_wall?: boolean, display_name?: string,
//         message?: string }.
//
// On success (key valid, purchase not refunded/chargebacked) the client sets
// localStorage dawn_supporter=1 (the strip hide stays a separate user choice).
// The Gumroad license-verify endpoint needs NO access token — just the product
// permalink + the key from the buyer's receipt. Keys are generated per purchase
// on the tip-jar product (Hector 2026-10-10).
//
// SUPPORTERS WALL (2026-10-24): a successful verify ALSO syncs the public wall
// when the client sends the wall fields — the feature the SupporterSheet's
// opt-in checkbox drives:
//   public_wall === true  + a non-empty display_name → upsert the wall row
//   public_wall === false                            → delete the wall row
//   fields absent (older clients)                    → wall untouched
// The wall lives in the SUPPORTERS_DB D1 binding (database
// `openmusic-supporters`) keyed by the SHA-256 of the license key — the raw
// key and any email are NEVER stored. The write is best-effort: a missing
// binding or a D1 error never changes the verify answer (supporter status is
// the client's localStorage flag; the wall is a bonus). The response gains
// `wall: true` when a row was actually upserted so the sheet can confirm.
//
// Fails closed: any transport/upstream/shape problem answers { ok:false } and
// the strip stays visible — never hide on an unverified key.
//
// THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — `GET` and `POST`. A top-level
// helper export makes SvelteKit throw "Invalid export" at REQUEST time
// (same rule as /api/lyric-offset); helpers would live in $lib/proxy.

import type { RequestHandler } from './$types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { GUMROAD_PRODUCT_PERMALINK, ADMIN_KEY_SHA256 } from '$lib/config/sponsored';

const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';
// 2048 (was 1024): the wall fields add a name (≤40 chars) + message (≤80
// chars) beside the key — CJK/emoji are multi-byte, so leave real headroom.
const MAX_BODY_BYTES = 2048;
const MAX_WALL_NAME = 40;
const MAX_WALL_MESSAGE = 80;

type GumroadVerify = {
	success: boolean;
	uses?: number;
	purchase?: {
		refunded?: boolean;
		chargebacked?: boolean;
	};
};

type WallBody = { public_wall?: unknown; display_name?: unknown; message?: unknown };

/** SHA-256 hex of the license key — the admin-key check AND the wall row key. */
async function keyHash(licenseKey: string): Promise<string | null> {
	try {
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(licenseKey));
		return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	} catch {
		return null; /* subtle-crypto unavailable — wall write skips, admin check fails closed */
	}
}

/**
 * Plain-text screen for wall fields: angle brackets and control characters
 * are stripped (the wall page renders names as escaped text anyway — this is
 * belt-and-braces against stored markup), whitespace collapses, hard length
 * caps apply. Not a sanitizer for HTML contexts; the data is never rendered
 * as HTML.
 */
function wallText(v: unknown, max: number): string {
	if (typeof v !== 'string') return '';
	return v
		.replace(/[<>\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);
}

/**
 * Best-effort wall sync after a successful verify. Returns true when a wall
 * row was upserted. Never throws: the caller answers the verify result either
 * way.
 */
async function syncWall(
	db: D1Database | undefined,
	hash: string | null,
	body: WallBody
): Promise<boolean> {
	if (!db || !hash) return false;
	try {
		if (body.public_wall === true) {
			const name = wallText(body.display_name, MAX_WALL_NAME);
			if (!name) return false;
			const message = wallText(body.message, MAX_WALL_MESSAGE);
			const now = new Date().toISOString();
			await db
				.prepare(
					'INSERT INTO supporters (key_hash, display_name, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ' +
						'ON CONFLICT(key_hash) DO UPDATE SET display_name = excluded.display_name, message = excluded.message, updated_at = excluded.updated_at'
				)
				.bind(hash, name, message, now, now)
				.run();
			return true;
		}
		if (body.public_wall === false) {
			// Explicit opt-out on a later verify removes the row — the removal path.
			await db.prepare('DELETE FROM supporters WHERE key_hash = ?').bind(hash).run();
		}
	} catch {
		/* wall is a bonus — a D1 hiccup must not fail a verified tip */
	}
	return false;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');

	// Same drive-by guards as /api/lyric-offset: a browser always sends Origin
	// on a POST (refuse non-allow-listed), and require application/json, which a
	// cross-origin page cannot send without a preflight.
	if (origin !== null && !isAllowedOrigin(origin)) {
		return jsonResponse({ ok: false, reason: 'forbidden-origin' }, origin, { status: 403 });
	}
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return jsonResponse({ ok: false, reason: 'unsupported-type' }, origin, { status: 415 });
	}

	// Size screen before the read (the declared length costs no read).
	if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
		return jsonResponse({ ok: false, reason: 'too-large' }, origin, { status: 413 });
	}
	let licenseKey = '';
	let wallBody: WallBody = {};
	try {
		const text = await request.text();
		if (text.length > MAX_BODY_BYTES) {
			return jsonResponse({ ok: false, reason: 'too-large' }, origin, { status: 413 });
		}
		const body = JSON.parse(text) as { license_key?: unknown } & WallBody;
		if (typeof body.license_key === 'string') licenseKey = body.license_key.trim();
		wallBody = body;
	} catch {
		return jsonResponse({ ok: false, reason: 'invalid' }, origin, { status: 400 });
	}
	if (!licenseKey) return jsonResponse({ ok: false, reason: 'invalid' }, origin, { status: 400 });

	const db = platform?.env?.SUPPORTERS_DB;
	const hash = await keyHash(licenseKey);

	// ADMIN UNLOCK: a master key whose SHA-256 matches the hash in
	// $lib/config/sponsored.ts verifies without touching Gumroad (Hector's own
	// key, delivered to him in chat; plaintext never stored). Checked first so
	// his unlock never depends on Gumroad's availability.
	if (hash !== null && hash === ADMIN_KEY_SHA256) {
		const wall = await syncWall(db, hash, wallBody);
		return jsonResponse({ ok: true, admin: true, ...(wall ? { wall: true } : {}) }, origin);
	}

	// NOTE: upstream/transport failures answer HTTP 200 (not 502/503) with
	// { ok:false } — Cloudflare's edge rewrites 502/503 bodies from Pages into
	// its own bare error page, which would hide our JSON reason. The client only
	// reads data.ok, so 200 + ok:false is the honest, observable shape.
	let gv: GumroadVerify;
	try {
		const res = await fetch(GUMROAD_VERIFY_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				product_permalink: GUMROAD_PRODUCT_PERMALINK,
				license_key: licenseKey
			}),
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) return jsonResponse({ ok: false, reason: 'error' }, origin);
		gv = (await res.json()) as GumroadVerify;
	} catch {
		return jsonResponse({ ok: false, reason: 'error' }, origin);
	}

	// Shape guard: never treat a weird upstream reply as a verified key.
	if (!gv || gv.success !== true) return jsonResponse({ ok: false, reason: 'invalid' }, origin);
	// A refunded / chargebacked purchase must NOT hide the strip.
	if (gv.purchase?.refunded || gv.purchase?.chargebacked) {
		return jsonResponse({ ok: false, reason: 'refunded' }, origin);
	}
	const wall = await syncWall(db, hash, wallBody);
	return jsonResponse({ ok: true, ...(wall ? { wall: true } : {}) }, origin);
};
