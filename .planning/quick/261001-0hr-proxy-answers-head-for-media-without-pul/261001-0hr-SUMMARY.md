---
phase: quick-261001-0hr
plan: 01
subsystem: api-proxy
tags: [proxy, head, download-probe, cloudflare-edge]
requires: []
provides:
  - "upstreamHead(url, ms) in src/lib/proxy/http.ts"
  - "HEAD verb on /api/[source]/[...path]"
affects:
  - src/lib/services/download-probe.ts (consumer, unchanged)
tech-stack:
  added: []
  patterns: ["bodiless probe ladder: HEAD → Range bytes=0-0 with body cancelled", "shared verb prologue (module-private resolveUpstream)"]
key-files:
  created: []
  modified:
    - src/lib/proxy/http.ts
    - src/routes/api/[source]/[...path]/+server.ts
    - src/routes/api/proxy.test.ts
decisions:
  - "HEAD on the source catch-all is answered explicitly by upstreamHead (upstream HEAD → cancelled Range probe), never by SvelteKit's GET fallback, which streamed the audio body"
  - "HEAD forwards an allow-list only: content-length (finite positive int), content-type, accept-ranges"
metrics:
  duration: ~15 min
  completed: 2026-10-01
  tasks: 2
  files: 3
---

# Quick 261001-0hr: Proxy answers HEAD for media without pulling the body. Summary

The `/api/[source]/[...path]` catch-all now has an explicit `HEAD` export. It answers from an upstream HEAD, or from a `Range: bytes=0-0` request whose body is cancelled unread. Before, a HEAD on `/api/netease/url` hit SvelteKit's GET fallback, which streamed the whole audio file and returned no headers within 15 s. Now it returns 200 with `content-length` in about the time the upstream takes.

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 (RED) | Five failing HEAD route tests | 88194602 |
| 1 (GREEN) | `upstreamHead()` + `HEAD` export + shared `resolveUpstream` prologue | 987203f2 |
| 2 | Dev-server verification (no code) | n/a |

## What changed
- `src/lib/proxy/http.ts`: new `upstreamHead(url, ms)`. It tries an upstream HEAD first, then a Range 0-0 request with the body cancelled. It uses plain `AbortSignal.timeout` with `retries=1`, and the doc comment explains why it does not use `fetchWithHeadDeadline`. It forwards only `content-length`, `content-type` and `accept-ranges`. A 206 is reported as 200. A private `sizeOf()` keeps only safe positive integers, so the size is never '0' or 'NaN'. `HEAD` was added to `Access-Control-Allow-Methods`.
- `+server.ts`: the GET prologue (origin, 404 for an unknown or missing source, 400 when `buildUrl` throws) moved into a module-private `resolveUpstream(event)`, which GET and HEAD both call. HEAD always returns a null body, sends `Access-Control-Expose-Headers: Content-Length, Content-Type, Accept-Ranges` for the Capacitor WebView, and returns 504 with CORS headers when the upstream throws. The route still exports only verbs: GET, HEAD, OPTIONS. The GET cache and passthrough branches are unchanged.
- `download-probe.ts`: **no change needed.** `measure()` reads `content-length` from a 200 HEAD and returns before the Range step.

## Verification (observed)
- `pnpm vitest --run src/routes/api/proxy.test.ts`: 5 new tests failed before the fix (`HEAD is not a function`) and 21/21 passed after.
- `pnpm test`: 171 files, **3895/3895 passed**.
- `pnpm check`: **0 errors**, 12 warnings. All are unused-CSS warnings in unrelated pages that were there before this change.
- Dev server on 5173: none was running, so the executor started `pnpm dev` first.

### HEAD timings, `/api/netease/url?id=65800`
| | Result | Wall time |
|--|--|--|
| **Before** (pre-change build) | `curl -I --max-time 15` returned no headers and exited 28 (timeout) | **15.01 s** (cut off by curl; the probe gave up at its own 8 s timeout) |
| **After** | 200, `content-length: 9344566`, `content-type: audio/mpeg; charset=UTF-8` | 4.02, 2.60, 1.93, 2.72, 1.58, 1.66, 6.57, 1.99, 1.83 s |
| Direct upstream, no proxy (`curl -IL` Meting → 126.net CDN) | 302 then 200 | 1.89, 1.55, 2.85, 5.09 s (Meting 302 alone ~0.85 s) |

- **Branch:** HEAD for netease. The response had no `accept-ranges`, which means the upstream HEAD supplied `content-length` and the Range step never ran.
- **<2 s target: met only when the upstream is fast.** The route's time tracks the upstream's own speed: Meting plus the CDN take 1.5 to 5 s from this machine, and the proxy adds very little. The fixed 8 s probe timeout is gone either way, so each NetEase donor lookup goes from about 8 s plus the Range request to a single round trip.
- **Range branch, live:** could not be exercised. kuwo, qq and joox have no `url` path on this route (search/detail only), and netease answers HEAD itself. It is covered by unit Test 2, which uses a never-closing stream, checks that the body is cancelled, and checks that the request does not hang.
- id 186016: 200 with `content-type: text/html` and no `content-length`. Meting returns an empty body for that id (GET is empty too), so this is the Test 3 case working as intended.
- GET did not change. `curl -r 0-0` on GET still returns 200 `audio/mpeg` and streams the full body, because GET never forwarded Range; it was cut off by curl's 10 s limit. `/api/netease/search` still returns JSON. HEAD on an unknown source returns 404.
- The browser Network-tab check was not done; only curl was used.

## Deviations from Plan
**1. [Rule 1 - Test bug] Test 5 uses joox `detail`, not `url`.** JOOX only allows `search` and `detail` (`src/lib/proxy/joox.ts`), so `url` would have returned 400 before any upstream fetch, and the no-leak check would have passed without testing anything. Found in Task 1 RED. Commit 88194602.

**2. [Rule 3] Started the dev server.** Neither 5173 nor 4321 was listening, so the executor started `pnpm dev` in the background on 5173.

## Assumption Drift (advisory)
- **Task 2:** The plan expected under 2 s every time. In practice it is only under 2 s when the upstream is fast: Meting plus the CDN alone take 1.5 to 5.1 s, so the route lands between 1.6 and 6.6 s. The fix still removes the fixed 8 s probe timeout.
- **Task 2:** The plan suggested trying a kuwo or qq `url` path to exercise the Range branch. Those sources have no `url` path on this route, so the Range branch is verified by unit test only.

## Threat Flags
None. The new HEAD surface uses the same validation and CORS seam as GET, and its forwarded headers are allow-listed (T-0hr-01 to 04 mitigated as planned).

## Self-Check: PASSED
- FOUND: src/lib/proxy/http.ts (`export async function upstreamHead`)
- FOUND: `export const HEAD` in src/routes/api/[source]/[...path]/+server.ts (count 1)
- FOUND: commit 88194602, commit 987203f2
