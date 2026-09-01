// 32-D-15: maximum byte size the next-track prebuffer will hold as a Blob.
//
// 24 MB sits in the gap between the two halves of the measured tang ladder (live probe, 32-RESEARCH
// § Q1), so it admits every LOSSY tier unconditionally — qq hq 6.2MB, standard 3.1MB, fq 1.6MB —
// and rejects every LOSSLESS one — sq 34-53MB, pq ~30MB. That split is deliberate on both sides:
//   - Admitting the whole lossy ladder keeps `bg-lockscreen-stall-noskip` FULLY intact on the
//     cellular/'320' path, which is the path most likely to be backgrounded — i.e. the exact
//     scenario the prebuffer exists for. The ceiling costs that protection NOTHING there.
//   - Rejecting FLAC is an accepted TRADE, not an oversight: an over-ceiling advance goes back to
//     the network-load-at-src-swap path the prebuffer was written to avoid, but holding a ~50MB
//     Blob per advance on a low-end phone is the worse failure. Measured worst case is ~12 MB/min
//     (kbps_sq 959-1647; 晴天 = 52.8MB for 4:29), NOT the 7 MB/min the phase note estimated — the
//     correction is the whole reason this number is 24 and not 8.
// The honest reading: "prebuffer lossy tiers, stream lossless tiers".
export const PREBUFFER_MAX_BYTES = 24 * 1024 * 1024;

/**
 * 32-D-15: does a `Content-Length` header value exceed the prebuffer ceiling?
 *
 * Extracted as a pure predicate because its only caller (`prebufferNext`) is private and does a
 * real media fetch — this is the testable seam, per the house "pure functions extracted for
 * testability" convention.
 *
 * A missing or unparseable value returns FALSE (fall through to the blob) so an unknown size
 * behaves exactly as it does today. That matters: `Content-Length` is not CORS-safelisted, so it
 * is readable only because the QQ CDN sends `access-control-expose-headers:
 * Content-Length,Content-Range` (verified live) — a second provider may not, and a header-less CDN
 * must not silently lose the bg-lockscreen protection. The gate is an explicit `Number.isFinite`
 * PARSE rather than a truthiness check, so every non-numeric shape lands on the same fall-through
 * branch by construction: `null`/`''` parse to 0, `'not-a-number'` to NaN, and a hostile
 * `'Infinity'` is rejected as not-finite instead of being treated as an over-ceiling skip.
 */
export function overPrebufferCeiling(headerValue: string | null): boolean {
	const n = Number(headerValue);
	return Number.isFinite(n) && n > PREBUFFER_MAX_BYTES;
}
