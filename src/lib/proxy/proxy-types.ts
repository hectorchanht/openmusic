// Server-side proxy-adapter contract (Phase 1, DATA-02 / D-09).
//
// A ProxyAdapter runs on the Cloudflare edge inside the /api/[source]/[...path]
// route. Its ONLY job (thin passthrough, D-09) is to turn an incoming /api request
// into the real upstream URL — injecting the JOOX secret from `env` where needed.
// The client SourceAdapter does all normalization.

import type { SourceId } from '../sources/types';

/** Server-only environment bindings (Cloudflare `platform.env`). Never reaches the client bundle. */
export interface Env {
	JOOX_TOKEN: string;
	// OPTIONAL Last.fm key for /api/similar (artist.getSimilar). Server-side only —
	// injected into the upstream URL on the edge, never echoed to the client
	// (threat parity with JOOX_TOKEN / T-01-04, T-5ug-01). Absent key is a SUPPORTED
	// state: /api/similar returns { artists: [] } so the service falls back to same-artist.
	LASTFM_KEY?: string;
	// OPTIONAL Last.fm shared secret for SIGNED calls (auth.getSession, track.love,
	// track.scrobble). Used ONLY to compute the md5 api_sig on the edge — never echoed
	// to the client (same threat class as LASTFM_KEY / JOOX_TOKEN). Absent = auth/scrobble
	// endpoints unavailable; read-only Last.fm features still work.
	LASTFM_SECRET?: string;
	/** OPTIONAL Jamendo public API `client_id`. Sent on every Jamendo API URL — it is a
	 * public id by design (same posture as LASTFM_KEY). Absent → the proxy returns an
	 * empty `{ results: [] }` so jamendo simply has no hits. The Jamendo `client_secret`
	 * is NOT carried here: it is only needed for OAuth flows we don't implement. */
	JAMENDO_CLIENT_ID?: string;
	// OPTIONAL Azure Translator subscription key for the /api/translate provider cascade
	// (D-05/D-06). Server-side only — injected into the upstream `Ocp-Apim-Subscription-Key`
	// header on the edge, NEVER echoed to the client (threat parity with JOOX_TOKEN /
	// LASTFM_KEY, T-25c-01). Absent key is a SUPPORTED state: the Azure tier is SKIPPED and
	// the cascade falls through to DeepL, then keyless Google.
	AZURE_TRANSLATOR_KEY?: string;
	// OPTIONAL Azure Translator resource region (e.g. `eastasia`), paired with
	// AZURE_TRANSLATOR_KEY and sent as the `Ocp-Apim-Subscription-Region` header. Edge-only,
	// never echoed to the client. Absent → the Azure request omits the region header.
	AZURE_TRANSLATOR_REGION?: string;
	// OPTIONAL DeepL Free API auth key for the /api/translate cascade (2nd tier). Server-side
	// only — injected into the `Authorization: DeepL-Auth-Key <key>` header for api-free.deepl.com,
	// NEVER echoed to the client (same threat class as AZURE_TRANSLATOR_KEY, T-25c-01). Absent
	// key is a SUPPORTED state: the DeepL tier is SKIPPED and the cascade falls through to Google.
	DEEPL_KEY?: string;
}

export interface ProxyAdapter {
	id: SourceId;
	/**
	 * Build the real upstream URL from the incoming proxy path + query.
	 * `env` is `platform?.env` and may be undefined outside the CF runtime;
	 * only the JOOX adapter reads it (to inject the token).
	 */
	buildUrl(path: string, searchParams: URLSearchParams, env: Env | undefined): string;
}
