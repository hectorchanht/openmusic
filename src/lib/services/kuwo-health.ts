// kuwo-health — the health gate for the kuwo upstream (`kw-api.cenguigui.cn`).
//
// WHY (measured 2026-09-12): the upstream serves an INVALID TLS CERTIFICATE, so Cloudflare returns
// **526 for every request, persistently, at ~1.0s each**:
//
//     kuwo try1: 526  1.06s
//     kuwo try2: 526  1.06s
//     curl https://kw-api.cenguigui.cn/  -> exit 60 (SSL certificate problem)
//
// kuwo is FIRST in the resolve floor (kuwo-first, RESOLVE-01), so while it is down EVERY cold
// resolve and EVERY cross-source fallback walk spends its first second on a source that cannot
// succeed. Gating it removes that second outright — this ADDS no requests, it removes them.
//
// Unlike netease (whose failure is a valid-but-empty array), kuwo signals failure by THROWING —
// both `search` and `resolve` already throw on a non-200 body, and apiFetch throws on a 526. So the
// adapter records a failure from its catch path and an ok from the success path.
//
// The gate auto-probes once per window, so kuwo returns the moment the cert is fixed — nothing here
// needs changing when it recovers.
import { createHealthGate } from './source-health';

export const kuwoHealth = createHealthGate();
