// kuwo-health — the health gate for the kuwo upstreams (search.kuwo.cn + the musicdl resolver chain, quick-261004-n1i).
//
// WHY (measured 2026-09-12): the upstream serves an INVALID TLS CERTIFICATE, so Cloudflare returns
// **526 for every request, persistently, at ~1.0s each**:
//
//     kuwo try1: 526  1.06s
//     kuwo try2: 526  1.06s
//     curl https://kw-api.cenguigui.cn/  -> exit 60 (SSL certificate problem)
//
// kuwo sits in the resolve floor (#3 since the 2026-08-31 demotion in registry.ts — qq→netease→
// kuwo→joox), so while it is down every speculative walk that reaches it (search fan-out, name-stub
// resolve, cross-source fallback, lyric walk) spends ~1s on a source that cannot succeed, and a
// THROWN kuwo.search also marks the whole fan-out un-cacheable (catalog.searchAll stores only an
// all-`ok` result). Gating it returns `[]` instead — zero requests AND a cacheable fan-out.
//
// Unlike netease (whose failure is a valid-but-empty array), kuwo's failure is ANY response that is
// not a well-formed JSON body: a fetch reject, a non-ok status, a non-JSON body, or a body with
// code!==200. debug kuwo-upstream-dead-gate-never-trips (2026-10-04): the first version of this
// comment claimed "apiFetch throws on a 526" — it does NOT, apiFetch RESOLVES the 526 Response and
// `res.json()` on its text/plain body threw before any recordFail(). The gate therefore never
// tripped in prod. kuwo.ts now funnels both calls through one `kuwoJson()` seam that counts every
// one of those shapes. The gate is unchanged by the quick-261004-n1i upstream swap — a resolver-chain
// exhaustion is a 502 from our own route and counts exactly like the old 526 did.
//
// The gate auto-probes once per window, so kuwo returns the moment the upstream is fixed — nothing
// here needs changing when it recovers.
import { createHealthGate } from './source-health';

export const kuwoHealth = createHealthGate();
