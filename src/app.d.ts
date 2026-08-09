// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces.
//
// App.Platform.env is the Cloudflare-adapter runtime path for bindings/secrets
// (svelte.dev/docs/kit/adapter-cloudflare). The JOOX token lives ONLY here —
// it is injected into the upstream URL on the edge and never reaches the client
// bundle (Phase 1 success criterion #2 / threat T-01-04).
declare global {
	namespace App {
		interface Platform {
			env: {
				JOOX_TOKEN: string;
				// OPTIONAL Last.fm key for /api/similar — server-side only, never on the
				// client bundle (threat T-5ug-01, parity with JOOX_TOKEN / T-01-04).
				LASTFM_KEY?: string;
				// OPTIONAL Last.fm shared secret for SIGNED calls (auth.getSession,
				// track.love, track.scrobble). Server-side only — used to compute the
				// md5 api_sig on the edge, never on the client bundle.
				LASTFM_SECRET?: string;
			};
			// 31-D-06: the Cloudflare ExecutionContext. `waitUntil()` keeps the Worker alive for a
			// background job AFTER the response has already been sent — the /api/resolve edge-cache
			// fill uses it so a cache MISS never delays the client (awaiting the fill on the hot
			// path is the anti-pattern that design exists to avoid). OPTIONAL: absent under
			// `vite dev` and in unit tests, so every call site must be `platform?.ctx?.waitUntil`.
			// `ctx` is the live field name — adapter-cloudflare's `context` alias is @deprecated.
			ctx?: ExecutionContext;
		}

		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
