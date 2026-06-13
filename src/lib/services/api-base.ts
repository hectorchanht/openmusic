// api-base — the single fetch seam that lets the SAME source/service code run both as the
// deployed web app (same-origin) and inside the native Capacitor APK (cross-origin) (D-03).
//
// POSTURE (mirrors deezer.ts's posture-doc style):
//  - On WEB, VITE_API_BASE is unset → BASE = '' → apiUrl('/api/x') === '/api/x'. Every
//    /api/* request stays a same-origin RELATIVE URL, so the deployed Pages build behaves
//    byte-identically to today (no behavior change, no new env var required for web).
//  - On NATIVE, the build bakes VITE_API_BASE = the deployed Pages origin via Vite's
//    import.meta.env at build time → BASE = 'https://openmusic.lol' → apiUrl('/api/x')
//    === 'https://openmusic.lol/api/x'. The APK's WebView (origin https://localhost)
//    has NO server of its own, so without this prefix every /api/* call (and the Netease
//    <audio>.src / lrc URL — Pitfall 3) would resolve to https://localhost/api/... → 404.
//  - BASE is read LAZILY inside apiUrl on every call (not captured at module load) so a
//    test's vi.stubEnv('VITE_API_BASE', ...) flips behavior across both branches without a
//    rebuild. import.meta.env.VITE_API_BASE is a build-time-inlined string on the real
//    bundle, so there is no runtime cost difference either way.
//  - This module adds NO secret, NO npm dependency, and NEVER decides CORS — it only builds
//    the URL. CORS allow-listing lives server-side in hooks.server.ts + proxy/http.ts.

/**
 * Resolve an own-origin `/api/*` path against the configured API base.
 *
 * Returns `path` unchanged when `VITE_API_BASE` is unset/empty (web: same-origin relative),
 * and `BASE + path` when it is set (native: absolute cross-origin to the deployed proxy).
 */
export function apiUrl(path: string): string {
	const BASE = import.meta.env.VITE_API_BASE ?? '';
	return BASE + path;
}

/**
 * `fetch` through the API-base seam: resolves `path` via {@link apiUrl} then calls the global
 * `fetch` exactly once with the resolved URL and the passed `init`. The return value and
 * error contract are the native `fetch`'s — this is a thin URL-prefixing wrapper only.
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(apiUrl(path), init);
}
