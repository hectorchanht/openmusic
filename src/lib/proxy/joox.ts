// JOOX proxy adapter — real upstream URL build with server-side token injection
// (Task 2, plan 01-03). This is the ONLY proxy that reads `env`: it relocates the
// formerly-hardcoded client token (legacy/index.html:2165) into platform.env.JOOX_TOKEN
// and injects it into the upstream URL on the Cloudflare edge (success criterion #2 /
// DATA-02 / threat T-01-04). The token therefore never appears in the client bundle nor
// in any /api/* request the browser makes.
//
// Upstream (legacy/index.html:2170 search, 2426 detail):
//   search: apicx.asia/api/joox_music?msg={kw}&token={JOOX_TOKEN}&br={JOOX_BR}
//   detail: apicx.asia/api/joox_music?msg={kw}&n={n}&token={JOOX_TOKEN}&br={JOOX_BR}
//
// Security note (V7 / threat T-01-07): this module NEVER logs the token or the signed
// upstream URL. Do not add console.log of `env`, the token, or the built URL here.
import type { ProxyAdapter, Env } from './proxy-types';

const JOOX_BASE = 'https://apicx.asia/api/joox_music';

// JOOX_BR is a non-secret tuning constant (bitrate tier), kept server-side per
// PATTERNS lines 302-303. 4 maps to the Atmos/lossless-priority tier set the client's
// pickJooxPlayUrl expects (legacy/index.html:2166).
const JOOX_BR = 4;

// The /api/joox/<path> segments this proxy understands.
const ALLOWED_PATHS = new Set(['search', 'detail']);

export const jooxProxy: ProxyAdapter = {
	id: 'joox',
	buildUrl(path: string, searchParams: URLSearchParams, env: Env | undefined): string {
		// Relocated secret: the token comes ONLY from platform.env, never a constant.
		// A missing token is a typed config error — we refuse to emit `token=undefined`,
		// which would silently 401 upstream and could mask a misconfiguration.
		const token = env?.JOOX_TOKEN;
		if (!token) {
			throw new Error('joox: missing JOOX_TOKEN in platform.env (server config error)');
		}

		const type = (path || 'search').replace(/^\/+|\/+$/g, '');
		if (!ALLOWED_PATHS.has(type)) {
			throw new Error(`joox: unsupported path "${type}"`);
		}

		const upstream = new URL(JOOX_BASE);

		// Forward the client-supplied keyword. The client never sends token/br.
		const msg = searchParams.get('msg');
		if (msg !== null) upstream.searchParams.set('msg', msg);

		// Detail is keyed by the positional `n` upstream (the client re-validates the
		// returned identity — see src/lib/sources/joox.ts). Forward it when present.
		if (type === 'detail') {
			const n = searchParams.get('n');
			if (n !== null) upstream.searchParams.set('n', n);
		}

		// Inject the secret + non-secret bitrate tier server-side.
		upstream.searchParams.set('token', token);
		upstream.searchParams.set('br', String(JOOX_BR));

		return upstream.toString();
	}
};
