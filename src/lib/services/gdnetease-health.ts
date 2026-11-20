// gdnetease-health — the health gate for the GD音乐台 upstream (music-api.gdstudio.xyz
// via the /api/gdnetease catch-all passthrough). Instance of the shared state machine
// in source-health.ts, added in the universal-gate rollout (2026-11-01).
//
// WHY: this pipe has already died once in production (2026-10-20 ~19:55: gdstudio
// answered 400 on EVERY endpoint — down or IP-blocking the edge). As the second
// Netease pipe it sits in the same search fan-out + resolve floor as netease itself,
// so a dead GD burns a slow call on every search and every fallback walk until it
// recovers.
//
// FAILURE SHAPE (from the real paths): unlike the dedicated-route sources there is NO
// empty-body fallback anywhere on this pipe — the catch-all MIRRORS the upstream
// status and body, and an edge-side fetch failure answers 504. So:
//   - search: a fetch reject / non-JSON body, or a non-array body (drift — the 400
//     outage shape parses as an error object, not an array) is recordFail. A
//     well-formed array — INCLUDING an empty one (gdstudio legitimately returns []
//     for no-hit queries; empty is NOT this pipe's outage shape) — is recordOk.
//     Deliberately NOT a dry gate, despite serving the same catalogue as netease:
//     netease's dry shape comes from ITS route-less qijieya path, not from GD.
//   - resolve: the adapter swallows url-leg failures into an unresolved track, so the
//     counting happens inside that catch: a non-ok status / fetch reject / non-JSON
//     body is recordFail; a body WITH a url is recordOk; a 200 body WITHOUT a url is
//     a per-song miss and stays NEUTRAL (counts neither way). The lyric leg is
//     best-effort everywhere and is never counted.
// Resolve is consulted-but-not-gated (the kuwo rule).
import { createHealthGate } from './source-health';

export const gdneteaseHealth = createHealthGate();
