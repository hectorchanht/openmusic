// POST /api/sponsored/verify — verify a tip-jar license key against Gumroad.
// Body: { license_key: string }.
//
// On success (key valid, purchase not refunded/chargebacked) the client sets
// localStorage dawn_sponsored_hidden=1 and the home-page sponsored strip hides.
// The Gumroad license-verify endpoint needs NO access token — just the product
// permalink + the key from the buyer's receipt. Keys are generated per purchase
// on the tip-jar product (Hector 2026-10-10).
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
const MAX_BODY_BYTES = 1024;

type GumroadVerify = {
	success: boolean;
	uses?: number;
	purchase?: {
		refunded?: boolean;
		chargebacked?: boolean;
	};
};

export const POST: RequestHandler = async ({ request }) => {
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
	try {
		const text = await request.text();
		if (text.length > MAX_BODY_BYTES) {
			return jsonResponse({ ok: false, reason: 'too-large' }, origin, { status: 413 });
		}
		const body = JSON.parse(text) as { license_key?: unknown };
		if (typeof body.license_key === 'string') licenseKey = body.license_key.trim();
	} catch {
		return jsonResponse({ ok: false, reason: 'invalid' }, origin, { status: 400 });
	}
	if (!licenseKey) return jsonResponse({ ok: false, reason: 'invalid' }, origin, { status: 400 });

	// ADMIN UNLOCK: a master key whose SHA-256 matches the hash in
	// $lib/config/sponsored.ts verifies without touching Gumroad (Hector's own
	// key, delivered to him in chat; plaintext never stored). Checked first so
	// his unlock never depends on Gumroad's availability.
	try {
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(licenseKey));
		const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
		if (hex === ADMIN_KEY_SHA256) return jsonResponse({ ok: true, admin: true }, origin);
	} catch {
		/* subtle-crypto unavailable — fall through to the Gumroad check */
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
	return jsonResponse({ ok: true }, origin);
};
