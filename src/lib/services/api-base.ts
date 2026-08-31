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
//  - An ALREADY-ABSOLUTE url (http:// or https://) is returned UNTOUCHED on both builds (32-D-13).
//    32-D-12 sends the hot qq DETAIL call direct to the upstream instead of through our proxy, and
//    it is the first caller to hand apiUrl a full url. On web that was already harmless (BASE = ''
//    makes the concat a no-op), but on NATIVE, BASE + 'https://tang…' produces
//    'https://openmusic.lolhttps://tang…' — the authority parses as `openmusic.lolhttps:` with
//    `//tang…` as its port, which is not a parseable URL, so fetch throws a hard TypeError. The
//    guard sits HERE and not at the call site so every present and future absolute-URL caller is
//    covered by one check. Such callers still go through apiFetch, so the governor below (dedupe,
//    MAX_CONCURRENT_REQUESTS, timeout, circuit breaker) applies to a direct call exactly as it does
//    to an /api/* one — going direct loses none of the api-fetch-flood-freeze protections (32-D-13).
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
 * An already-absolute `http(s)://` url is returned unchanged on BOTH builds (32-D-13).
 */
export function apiUrl(path: string): string {
	// 32-D-13: an absolute url is already fully resolved — never prefix it. Without this the NATIVE
	// build (VITE_API_BASE set) concatenates into 'https://openmusic.lolhttps://tang…', which is not
	// a parseable URL and throws a TypeError at fetch. The direct qq detail call (32-D-12) is the
	// first caller to pass one; every /api/* caller still takes the BASE + path branch below.
	if (/^https?:\/\//i.test(path)) return path;
	const BASE = import.meta.env.VITE_API_BASE ?? '';
	return BASE + path;
}

// ── OUTBOUND REQUEST GOVERNOR (debug-nowbar-frozen-audius-spam) ──────────────────────────────
// api-base is the SINGLE client fetch seam for every /api/* call (all source adapters, cover,
// lyrics, translate). It used to be a thin `fetch` wrapper with NO governance, so when the
// never-stop recovery chain churns the queue under systemic playback failure (expired /
// region-locked source URLs), the fire-and-forget prefetch / regenerate / fallback tasks pile
// THOUSANDS of concurrent fetches into the browser's ~6-per-origin connection pool. Every
// request — including the nowbar's own cover/resolve — then queues for minutes, so the UI
// appears frozen and upstreams are spammed (observed: ~2000 identical /api/qq/detail?…mid=… and
// varying-seed /api/*/search fan-out; see the debug session). Each subsystem is only LOCALLY
// bounded (per-uid strike, per-gen guard, single in-flight prefetch); they COMPOSE into an
// unbounded fetch flood. This seam adds two STRUCTURAL bounds so a runaway loop can never spam
// or starve the pool, regardless of any caller's own guards:
//   • in-flight DEDUPE (idempotent body-less GET only): identical concurrent method+URL collapse
//     to ONE upstream fetch; each caller reads an independent clone(). This alone kills the
//     identical-request storms (the 2000× detail, repeated searches).
//   • MAX_CONCURRENT cap + FIFO queue: at most N /api/* fetches are ISSUED at once, so the
//     browser request queue can never explode and UI-critical requests are never buried behind
//     thousands of churn requests.
//   • per-request TIMEOUT: a hung upstream can never hold a concurrency slot forever (the slot is
//     reclaimed so the queue keeps draining).
// This changes apiFetch's old "one raw fetch, init by reference" contract (see api-base.test.ts).

/** Max /api/* fetches issued concurrently. Above the browser's ~6 same-origin limit so a normal
 *  search fan-out is not throttled, but bounded so a churn loop can never explode the queue. */
export const MAX_CONCURRENT_REQUESTS = 8;
/** Hard ceiling on a single governed fetch so a hung upstream cannot hold a slot forever. */
const REQUEST_TIMEOUT_MS = 25_000;

let active = 0;
const waiters: Array<() => void> = [];

// ── CIRCUIT BREAKER (debug-nowbar-frozen-audius-spam, round 2) ───────────────────────────────
// The concurrency cap PACES the flood but does not STOP it: a caller loop still issues its whole
// backlog (just 8 at a time), and when every request fails in ~2ms — net::ERR_INSUFFICIENT_RESOURCES
// once the browser pool is exhausted, or a region-blocked/down upstream — the queue drains fast and
// THOUSANDS of requests still hit the wire. The dominant driver observed was the Home cover backfill
// (`backfillCovers` with `max: rows.length`, cap lifted in quick-260607-0bb) fanning `searchAll`
// (6 sources) across ~270 uncached gradient tiles; a FAILED cover-search is never cached, so every
// refresh/randomize re-fires the whole set. No per-caller guard stops this — so bound it at the ONE
// seam every /api/* call passes through:
//   when /api/* FAILURES spike, OPEN the breaker and fast-reject every new /api/* for a cooldown.
// Hammering a failing upstream cannot help and only spams; never-throw callers (search allSettled,
// the cover tier chain, translate) already degrade to their empty/gradient sentinels on a reject, so
// an OPEN breaker simply makes the app stop flooding and try again after the cooldown. A single
// success (the half-open probe) closes it. This is the STRUCTURAL "detail/search never spam"
// guarantee, independent of any caller's own (composing, individually-bounded) loops.
//
// A "failure" is a network error, a per-request TIMEOUT, or a 5xx/429 — NOT a caller-abort
// (supersede: an expected, healthy cancel) and NOT a normal 4xx (a real answer from a live proxy).
/** Failures within the sliding window that trip the breaker. High enough that a normal fan-out with
 *  a few failing sources never trips (a search fan-out is ~6–18 requests); a runaway backfill flood
 *  of hundreds trips it within the first fraction of a second. */
export const CIRCUIT_FAILURE_THRESHOLD = 30;
const CIRCUIT_WINDOW_MS = 3_000;
/** How long the breaker stays OPEN (fast-rejecting) before a single half-open probe is allowed. */
export const CIRCUIT_COOLDOWN_MS = 10_000;

let failureTimes: number[] = []; // wall-clock ms of recent failures, pruned to the window
let circuitOpenUntil = 0; // breaker OPEN (reject) while Date.now() < this; 0 = closed
let halfOpenProbeInFlight = false; // a single trial request is threading the open breaker

/**
 * Breaker gate — called at the top of every governed fetch. Returns true to FAST-REJECT. When the
 * cooldown elapses it lets exactly ONE caller through (the half-open probe) and rejects the rest
 * until that probe settles (recordSuccess closes, recordFailure re-opens).
 */
function circuitBlocks(): boolean {
	if (circuitOpenUntil === 0) return false; // closed — normal operation
	const now = Date.now();
	if (now < circuitOpenUntil) return true; // still cooling down
	if (halfOpenProbeInFlight) return true; // a probe is already testing the upstream — reject others
	halfOpenProbeInFlight = true; // this caller becomes the single half-open probe
	return false;
}

/** A real answer arrived → the upstream is healthy: fully close the breaker and clear history. */
function recordSuccess(): void {
	failureTimes.length = 0;
	circuitOpenUntil = 0;
	halfOpenProbeInFlight = false;
}

/** A network/timeout/5xx failure → count it; trip (or re-trip a failed half-open probe) the breaker. */
function recordFailure(): void {
	const now = Date.now();
	if (halfOpenProbeInFlight) {
		// the trial request failed → upstream still bad: re-open for another cooldown
		circuitOpenUntil = now + CIRCUIT_COOLDOWN_MS;
		halfOpenProbeInFlight = false;
		failureTimes.length = 0;
		return;
	}
	failureTimes.push(now);
	const cutoff = now - CIRCUIT_WINDOW_MS;
	while (failureTimes.length && failureTimes[0] < cutoff) failureTimes.shift();
	if (failureTimes.length >= CIRCUIT_FAILURE_THRESHOLD) {
		circuitOpenUntil = now + CIRCUIT_COOLDOWN_MS;
		failureTimes.length = 0;
	}
}

/** Fast-reject error while the breaker is OPEN. Named AbortError so the supersede-aware callers treat
 *  it as a transient cancel (they already degrade gracefully) rather than a hard contract failure. */
function circuitOpenError(): DOMException {
	return new DOMException('api-base: circuit open — upstream failing, backing off', 'AbortError');
}

/** TEST-ONLY: reset all governor + breaker module state so a tripped breaker cannot leak across
 *  tests. Not part of the app runtime contract (no production caller). */
export function __resetGovernor(): void {
	active = 0;
	waiters.length = 0;
	inflight.clear();
	failureTimes.length = 0;
	circuitOpenUntil = 0;
	halfOpenProbeInFlight = false;
}

/** Acquire one concurrency slot — resolves immediately if a slot is free, else queues FIFO. */
function acquireSlot(): Promise<void> {
	if (active < MAX_CONCURRENT_REQUESTS) {
		active++;
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => waiters.push(resolve));
}

/** Release a slot: hand it straight to the next FIFO waiter, or free it if none are waiting. */
function releaseSlot(): void {
	const next = waiters.shift();
	if (next) next(); // slot ownership passes to the waiter — `active` stays the same
	else active--;
}

function abortError(): DOMException {
	return new DOMException('Aborted', 'AbortError');
}

// GET responses in flight, keyed by resolved URL, for concurrent-request dedupe.
const inflight = new Map<string, Promise<Response>>();

/**
 * One concurrency- and timeout-governed `fetch`. Waits for a slot, then races the caller's
 * signal (if any) and a hard REQUEST_TIMEOUT_MS deadline; releases the slot the moment the
 * response head arrives (the body streams on afterwards). Never dedupes — that is apiFetch's job.
 */
async function governedFetch(url: string, init: RequestInit | undefined): Promise<Response> {
	// Gate 1 — HARD-OPEN fast-reject BEFORE taking a slot: during the cooldown window a runaway loop
	// never even queues, so it stops issuing /api/* entirely (pure read, no half-open side effect).
	if (circuitOpenUntil !== 0 && Date.now() < circuitOpenUntil) throw circuitOpenError();
	await acquireSlot();
	try {
		// Gate 2 — RE-CHECK after the (possibly long) queue wait. A request that entered the queue
		// while the breaker was still closed must NOT slip through once it trips mid-flood (the bug a
		// pre-acquire-only check has: queued requests bypass the open breaker). This is also the single
		// half-open probe gate — exactly one waiter is let through per cooldown, the rest fast-reject.
		if (circuitBlocks()) throw circuitOpenError();
		const timeout = new AbortController();
		const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
		const caller = init?.signal ?? null;
		const onCallerAbort = () => timeout.abort();
		if (caller) {
			if (caller.aborted) timeout.abort();
			else caller.addEventListener('abort', onCallerAbort);
		}
		try {
			// RAW fetch (not apiFetch — fetch→apiFetch audit): this IS the seam apiFetch wraps. Routing it
			// through apiFetch would recurse infinitely. The ONE legitimate raw /api fetch on the client.
			const resp = await fetch(url, { ...(init ?? {}), signal: timeout.signal });
			// Classify for the breaker: a 5xx/429 is an upstream failure worth backing off; a 2xx/3xx/4xx
			// is a real answer (the upstream is alive) → success closes/keeps the breaker closed.
			if (resp.status >= 500 || resp.status === 429) recordFailure();
			else recordSuccess();
			return resp;
		} catch (err) {
			// A caller-abort (supersede) is an EXPECTED healthy cancel — NEUTRAL: it neither counts
			// against the breaker nor closes it. But if THIS was the single half-open probe, free the
			// probe slot so a real request can test the upstream next (an aborted probe must not wedge
			// the breaker open).
			if (caller?.aborted) {
				if (halfOpenProbeInFlight) halfOpenProbeInFlight = false;
			} else {
				// A timeout or network error (fetch reject) IS an upstream failure.
				recordFailure();
			}
			throw err;
		} finally {
			clearTimeout(timer);
			if (caller) caller.removeEventListener('abort', onCallerAbort);
		}
	} finally {
		releaseSlot();
	}
}

/**
 * `fetch` through the API-base seam: resolves `path` via {@link apiUrl}, then routes the request
 * through the outbound governor (dedupe + concurrency cap + timeout — see the block above). The
 * resolved-URL and same-origin/native-base behavior is unchanged; only the request GOVERNANCE is
 * added, so callers keep the native `fetch` return/error contract (a superseded caller's promise
 * still rejects with an AbortError when its signal fires).
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
	const url = apiUrl(path);
	const method = (init?.method ?? 'GET').toUpperCase();

	// Only idempotent, body-less GETs are deduped — a POST/PUT/bodied request is a distinct
	// side-effecting call and must always reach the server. Non-deduped requests still go through
	// the concurrency + timeout governor.
	if (method !== 'GET' || init?.body != null) {
		return governedFetch(url, init);
	}

	const caller = init?.signal ?? null;
	if (caller?.aborted) return Promise.reject(abortError());

	// COLLAPSE identical concurrent GETs to ONE upstream fetch. The shared fetch is driven by
	// governedFetch's OWN timeout signal (the caller's signal is stripped below) so one caller's
	// supersede-abort can never cancel a request another caller is still awaiting; the shared
	// fetch runs to completion and its result (or a TTL cache write downstream) benefits all.
	const shared: Promise<Response> =
		inflight.get(url) ??
		(() => {
			const rest = { ...(init ?? {}) };
			delete rest.signal;
			const p = governedFetch(url, rest);
			inflight.set(url, p);
			// Evict as soon as the head settles so a LATER identical request (whose predecessor's
			// body may already be consumed) starts its own fresh fetch.
			const evict = () => {
				if (inflight.get(url) === p) inflight.delete(url);
			};
			p.then(evict, evict);
			return p;
		})();

	return new Promise<Response>((resolve, reject) => {
		let settled = false;
		const onCallerAbort = () => {
			if (settled) return;
			settled = true;
			if (caller) caller.removeEventListener('abort', onCallerAbort);
			reject(abortError());
		};
		if (caller) caller.addEventListener('abort', onCallerAbort);
		shared.then(
			(resp) => {
				if (settled) return;
				settled = true;
				if (caller) caller.removeEventListener('abort', onCallerAbort);
				// Independent clone per caller — the shared body is never read directly, so repeated
				// clone() stays valid (the original's bodyUsed stays false).
				resolve(resp.clone());
			},
			(err) => {
				if (settled) return;
				settled = true;
				if (caller) caller.removeEventListener('abort', onCallerAbort);
				reject(err);
			}
		);
	});
}
