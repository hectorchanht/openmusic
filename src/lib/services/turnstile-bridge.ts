// turnstile-bridge — the parent (app) half of the native comment Turnstile bridge (quick-260926-ot5).
//
// WHY A BRIDGE: the Capacitor WebView's origin is https://localhost, so a Turnstile widget rendered
// in-app yields siteverify hostname "localhost", which the production allowlist
// (TURNSTILE_HOSTNAMES=openmusic.lol) correctly rejects. Instead the app frames
// https://openmusic.lol/turnstile-bridge, which renders the widget on the real hostname and
// hands the token back over postMessage, gated on origin + source at both ends.
//
// Rejected alternatives:
//  - localhost in the prod allowlist: anyone could farm tokens from a local page with our sitekey.
//  - a real Capacitor server.hostname: new WebView origin = every user's localStorage/IndexedDB wiped.
//
// The bridge page ($lib/proxy/turnstile-bridge-page.ts) is BUILT from these constants, so the two
// halves cannot drift. Pure, zero imports.

// quick-260926-ot5: a SvelteKit route, NOT a static .html — Pages 308s `/x.html` to `/x`, which 404'd.
export const BRIDGE_PATH = '/turnstile-bridge';

export const BRIDGE_MSG = {
	hello: 'om-ts-hello',
	token: 'om-ts-token',
	clear: 'om-ts-clear',
	reset: 'om-ts-reset'
} as const;

export type BridgeMessage = { type: 'om-ts-token'; token: string } | { type: 'om-ts-clear' };

/** `new URL(base).origin`, or null when base is empty/unparseable (a web build, or a native build without VITE_API_BASE). */
export function bridgeOrigin(base: string): string | null {
	if (!base) return null;
	try {
		return new URL(base).origin;
	} catch {
		return null;
	}
}

/** Screens `event.data`: token must be a non-empty string ≤ 2048 chars; anything else (hello/reset echoes, junk, null) → null. */
export function parseBridgeMessage(data: unknown): BridgeMessage | null {
	if (!data || typeof data !== 'object') return null;
	const d = data as { type?: unknown; token?: unknown };
	if (d.type === BRIDGE_MSG.token) {
		// 2048 = TOKEN_MAX in $lib/proxy/comments — not imported so no proxy code enters the client
		// bundle; the test asserts parity.
		const tok = d.token;
		return typeof tok === 'string' && tok.length >= 1 && tok.length <= 2048 ? { type: BRIDGE_MSG.token, token: tok } : null;
	}
	return d.type === BRIDGE_MSG.clear ? { type: BRIDGE_MSG.clear } : null;
}
