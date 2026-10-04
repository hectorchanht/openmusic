---
spike: 014
name: lyric-search-edge-reach
type: standard
validates: "Given the 013 lyric-search candidates, when they are called from Cloudflare Workers egress (wrangler dev --remote), then they return the same hits as locally, survive a 15-call burst, and — separately — whether the browser could call them directly (CORS)"
verdict: VALIDATED
related: [011, 013]
tags: [search, lyrics, edge, workers, qq, genius, netease, cors, rate-limit]
---

# Spike 014: Lyric Search From the Edge

## What This Validates
Given Cloudflare Workers egress (where `/api/*` runs in production), when the 013 lyric-search upstreams are
called with the same runtime-derived lyric lines, then each one's accuracy, block behavior and burst
tolerance are known — plus whether a browser-direct call (the qq-detail precedent, 32-D-12) is possible.

## Research
- Pattern: spike 011's throwaway Worker run via `wrangler dev --remote` (code executes on the Cloudflare
  network, subrequests leave from real Workers IPs with the `CF-Worker` header; nothing deployed).
- `worker.js` imports 013's `targets.mjs` unchanged (wrangler bundles it), so edge and local issue the exact
  same request + parse; only the egress IP differs. `targets.mjs` reads `globalThis.process?.env` so it
  loads in workerd without `nodejs_compat`.
- **Account:** local wrangler is now logged into `F147259@gmail.com's Account` (`f1868a07…`), not 011's
  `0b9e5c70…` (that login returns `Authentication error [code: 10000]` on `edge-preview`). User approved
  using the logged-in account on 2026-10-04.

## How to Run
```bash
# terminal 1 (or preview_start name=spike014-edge, a temporary launch.json entry)
npx wrangler dev --remote -c .planning/spikes/014-lyric-search-edge-reach/wrangler.jsonc --port 8798 --ip 127.0.0.1
# terminal 2
node .planning/spikes/014-lyric-search-edge-reach/harness.mjs
```

## What to Expect
One line per query with each target's exact-hit rank and upstream status, then `burst` lines (15
back-to-back calls per target from the edge), `cors` lines, and an edge-vs-local table. Writes `results.json`.

## Investigation Trail
1. **Account.** `wrangler dev --remote` on 011's account `0b9e5c70…` → `Authentication error [code: 10000]`
   on `/workers/subdomain/edge-preview`: local wrangler is now logged into `F147259@gmail.com's Account`
   (`f1868a07…`, token has `workers_scripts (write)`). User approved using it.
2. **Worker = 013's `targets.mjs` unchanged.** Only change to the shared module: `globalThis.process?.env` so it
   evaluates in workerd. The two dev-proxy targets are skipped at the edge (no :4321 there).
3. **Egress confirmed:** `cdn-cgi/trace` → `2a06:98c0:3600::103`, colo **SEA** (nearest to this machine — HKG
   cannot be observed this way, same caveat as 011). A title smoke query returned rows from all four.
4. **Accuracy at the edge (34 queries, full-line variant).** Netease answers its first 4 queries, then every
   call returns HTTP 200 + `code: -462` (Netease's "verification required" anti-bot) with no rows — 12%.
   QQ type 7: **100% @5, 97% @1, zero throttling** (it throttled the Mac, not the edge). Genius 94% @5,
   85% @1. YTMusic unfiltered 79%.
5. **Burst (15 back-to-back calls per target, from the edge):** QQ 15/15, Genius 15/15, YTMusic 15/15,
   Netease 0/15 (all `-462`).
6. **Browser-direct (CORS, `Origin: https://openmusic.lol`):** NONE of them send
   `access-control-allow-origin` (netease, qq GET+POST, genius); YTMusic preflight → 403. So the qq-detail
   direct-call precedent (32-D-12) does NOT extend to search — lyric search must go through our edge proxy.

## Results
**Verdict: ✅ VALIDATED — QQ lyric mode + Genius both work from Workers egress; Netease official does not.**

| Target @ edge | ex@5 edge | ex@5 local (full) | ex@1 edge | burst 15× | CORS |
|---|---|---|---|---|---|
| b qq-type7 | **100** | 88 | **97** | 15/15 | ✗ |
| d genius | 94 | 94 | 85 | 15/15 | ✗ |
| c ytm-top | 79 | 79 | — | 15/15 | ✗ (preflight 403) |
| a netease-1006 | **12** | 94 | — | **0/15 (-462)** | ✗ |

Union qq-type7 + genius at the edge = **100%**.

**Signal for the build:**
- New edge route for QQ `musicu` `search_type: 7` (POST, no auth). Map `req.code 2001` → a retryable
  throttle error (429), never "no results". Rows → `qq:<mid>` stubs that the existing qq adapter resolves.
- Genius `search/lyric` edge route as the fallback (returns title + artist → resolve by name like Up-Next items).
- Never Netease official from the edge (`-462` after ~4 calls); never browser-direct (no CORS).
- Only one colo (SEA) observed; HKG/Asia egress unverified — re-check on the deployed route.
