// diag-payload — the server-side screen for an uploaded activity log, plus the R2 key helpers.
//
// Same shape as `safe-image-url`: screen on the cheapest signal FIRST, parse inside the existing
// never-throw helper, validate, and return a sentinel (`null`) rather than throwing. The route
// turns `null` into a 4xx; nothing here knows what an HTTP status is.
//
// D-05: the parse+validate step is `parseActionLog`, imported, NOT reimplemented. A second
// validator would start identical and drift the first time the entry shape changes — and the
// client already trusts `parseActionLog` with exactly this decision.

import { parseActionLog, ACTION_LOG_CAP } from '$lib/diagnostics/action-log-logic';

/**
 * 512 KiB. Sized from the MEASURED full-cap payload (a full ring buffer of 2000 entries is roughly
 * 82 B each, ~160 KB) with 3x headroom for name-heavy logs, and kept deliberately LOW: parsing the
 * body has to fit inside the Workers FREE plan's 10 ms CPU budget per request. Raising this
 * to be "generous" does not buy generosity — it trades a clean 413 for an opaque CPU-limit 5xx
 * that looks like a broken endpoint (Pitfall 4, T-33-04).
 */
export const MAX_UPLOAD_BYTES = 512 * 1024;

/**
 * Screen an untrusted request body. Returns the number of VALID entries, or `null` if the body is
 * not a plausible activity log.
 *
 * Order is load-bearing: the length screen runs before any parse, so an oversize body costs one
 * property read rather than a half-megabyte parse.
 *
 * `text.length` counts UTF-16 code units, so it UNDER-counts a CJK-heavy log by up to 3x versus
 * real bytes. Accepted deliberately — this is a safety bound, not an accounting figure, and running
 * `TextEncoder` over a several-hundred-KB string spends the exact CPU the bound exists to protect.
 */
export function screenLogPayload(text: string): number | null {
	if (!text || text.length > MAX_UPLOAD_BYTES) return null;
	// parseActionLog is already try/catch + per-entry filtered: junk rows are dropped, not fatal.
	const entries = parseActionLog(text);
	if (entries.length === 0) return null;
	// More entries than the client's ring buffer can physically hold means this did not come from
	// our own log. No second literal here — the ceiling has one owner.
	if (entries.length > ACTION_LOG_CAP) return null;
	return entries.length;
}

/**
 * The R2 object key for an upload. `now` and `rand` are PARAMETERS, not ambient calls, so this is
 * deterministic and testable; the route passes `Date.now()` and `crypto.randomUUID()`.
 *
 * R2 lists keys in lexicographic UTF-8 order with no "sort by time" option, so putting the ISO
 * stamp first makes list order == chronological order for free. `:` and `.` are replaced because a
 * key littered with them is awkward in URLs and in shell round-trips.
 */
export function diagKey(now: number, rand: string): string {
	return `log/${new Date(now).toISOString().replace(/[:.]/g, '-')}-${rand.slice(0, 8)}.json`;
}

/**
 * Screen an untrusted `?key=` before any `bucket.get`. R2 keys are a flat namespace, so `..` has no
 * traversal meaning there and this is defence-in-depth (T-33-09) — but it also means the read
 * endpoint can only ever return objects the upload endpoint could have written.
 */
export function isDiagKey(key: string | null): key is string {
	return !!key && /^log\/[A-Za-z0-9._-]+\.json$/.test(key);
}
