---
status: awaiting_human_verify
trigger: "Home mobile LCP: Lighthouse simulated LCP 31.5 s on prod after cover/CSS fixes; observed LCP is text at ~0.84 s. Find what the simulated LCP depends on and cut it."
created: 2026-10-02
updated: 2026-10-02
---

# Debug: home-mobile-lcp-simulated-31s

## Trigger (verbatim, data only)

DATA_START
Home mobile LCP: Lighthouse 13.5 (mobile, simulated Slow 4G, run locally against prod https://openmusic.lol on 2026-10-02 AFTER the cover/CSS fixes) reports LCP 31.5 s, FCP 4.7 s, perf score 63, TBT 90 ms, 8.6 MB / 389 requests. Observed (unthrottled) trace: LCP is a TEXT element (breakdown: TTFB 272 ms + element render delay 567 ms, no resource-load subpart). Requests: 88 mzstatic images (4.7 MB), 62 dzcdn images (1.6 MB), 26 yt3 images, 14 kfs.io, 149 openmusic.lol JS chunks (564 KB), 14 /api fetches, 4 itunes.apple.com fetches; earlier PSI critical chain 11.4 s with /api/deezer/chart?genre=… ~8.8 s each and /api/charts?src=apple on the chain. Goal: find what the simulated LCP depends on (which element is LCP; which requests/chains Lantern counts before it) and cut it — e.g. render LCP text without waiting on chart fetches, defer/limit off-screen shelf images + chart API fan-out until after first paint, reduce JS chunk waterfall.
DATA_END

## Symptoms

- expected: Lighthouse mobile (simulated Slow 4G) LCP for home ≲ 4 s (PSI "good" is ≤ 2.5 s); simulated LCP should track the observed text paint, not the whole image/API fan-out.
- actual: simulated LCP 31.5 s, FCP 4.7 s (score 63). Observed LCP ≈ 0.84 s, text element, no resource-load subpart.
- errors: none relevant (Cloudflare beacon / challenge-platform scripts are injected by CF, out of scope).
- timeline: measured 2026-10-02 after commits 16086b8b (jpg/500px/lazy CompactRow), a873bdae (inline CSS), 262b3db9 (600px library covers) were live. PSI before those: LCP 237.6 s.
- reproduction: `npx -y lighthouse@latest https://openmusic.lol --only-categories=performance --output=json --output-path=perf.json --quiet --chrome-flags="--headless=new"` (≈1 min). Same against a local build: `pnpm build` then `pnpm exec wrangler pages dev .svelte-kit/cloudflare --port 8788` and point Lighthouse at http://localhost:8788 (inline CSS / SSR head only show on the CF build, not `pnpm dev`).

## Evidence

- timestamp: 2026-10-02 (orchestrator)
  finding: Full Lighthouse JSON of the prod run saved at /private/tmp/claude-501/-Users-laichan-code-tung-openmusic/ebac7d8f-33e5-464b-8d50-fc07faf8ef25/scratchpad/perf.json (audits: metrics, network-requests, lcp-breakdown-insight, long-tasks, bootup-time). Request mix by host listed in trigger. 149 separate first-party JS chunks.
- timestamp: 2026-10-02
  finding: Lantern simulates LCP from the dependency graph of the observed trace; with a TEXT LCP the simulated value grows with every network request/CPU task Lantern deems to precede it. Hypothesis space: (a) LCP text node is a shelf/song title that only renders after chart API fetches (/api/charts, /api/deezer/chart ×N, itunes) complete → chart fetch chain on the critical path; (b) a LATER LCP candidate (e.g. big text that appears after shelves load, or a shelf title pushed in late) replaces the early header paint; (c) image fan-out (~190 imgs) + 149 JS chunks inflate the simulated graph.

- timestamp: 2026-10-02 (debugger)
  checked: fresh prod run with `--save-assets` (scratch: prod-assets.json / prod-assets-0.trace.json / prod-assets-0.devtoolslog.json). Metrics: LCP 31.2 s, FCP 4.4 s, score 64; observed LCP = observed FCP = 220 ms, observedLoad 101 ms (!), observedTraceEnd 2.9 s.
  found: the trace holds TWO top-level navigations to https://openmusic.lol/ in the SAME frame, 3.72 s apart. Nav 1: LCP candidates `DIV.brand` (362 ms, text) then `SPAN.r-title` (668 ms, text). Nav 2 (+3724 ms): document served `fromServiceWorker: true`, initiator `script`, preceded at 3722 ms by the Cloudflare RUM unload beacon; its FCP = LCP = `SPAN.r-title` at 220 ms. All 74 `_app/immutable` URLs are requested twice; 200 of the 383 requests belong to nav 1.
  implication: the page RELOADS itself ~3.7 s after a cold load. Lighthouse keys its observed metrics to the LAST navigationStart (hence LCP 220 ms / load 101 ms, served by the just-installed SW) but builds the Lantern graph from the WHOLE devtools log, so every nav-1 request that finished before nav-2's LCP timestamp (all 14 chart/API fetches, ~190 cover images, 149 JS chunks) sits "before LCP" and is simulated on Slow 4G → 31 s. The LCP element itself is a cheap text node; the chart fan-out is not actually gating it.
- timestamp: 2026-10-02 (debugger)
  checked: src/lib/stores/swUpdate.svelte.ts + src/service-worker.ts for the reload trigger.
  found: `swUpdate.init()` registers `navigator.serviceWorker.addEventListener('controllerchange', () => location.reload())` with only a "never twice" guard. service-worker.ts `activate` calls `clients.claim()`. On a FIRST-EVER install (no prior SW, which is every Lighthouse run — it clears storage — and every brand-new visitor) the SW installs (precache of ~160 shell assets ≈ 3.5 s on prod), activates immediately (nothing to wait on, skipWaiting irrelevant), `clients.claim()` takes control of the open page → `controllerchange` fires → `location.reload()`. The code comment "only ever after applyUpdate()" is false for the first install.
  implication: ROOT CAUSE. Also a real UX bug: every first visit flashes a full reload a few seconds in (and would kill audio started in that window).

## Eliminated

- hypothesis: LCP text is a shelf title gated on the chart API fan-out (the chart fetches are on the critical path).
  evidence: nav-1 LCP candidates are `DIV.brand` at 362 ms and `SPAN.r-title` at 668 ms, both before any /api/charts or /api/deezer/chart response (first lands at ~960 ms, most at ~2 s); the 31 s is a Lantern artefact of the self-reload, not of the fetches.
  timestamp: 2026-10-02

## Current Focus

- hypothesis: CONFIRMED — first-install `clients.claim()` → `controllerchange` → unconditional `location.reload()` in swUpdate.svelte.ts causes a second navigation; Lantern's graph then counts the whole first load as pre-LCP.
- test: local BEFORE baseline (wrangler pages dev :8788 + Lighthouse) must show the same double navigation / inflated LCP; after guarding the reload on "there was a controller before", a fresh run must show a single navigation and a simulated LCP in the low seconds.
- expecting: before ≈ prod shape (double doc request, LCP ≫ FCP); after: 1 document request, LCP ≈ FCP.
- next_action: `pnpm build`; run before-local Lighthouse; patch onControllerChange to ignore the first-install claim; rebuild; after-local Lighthouse; pnpm test + pnpm check.

## Resolution

- root_cause: `src/lib/stores/swUpdate.svelte.ts` reloaded the page on EVERY `controllerchange`. On a first-ever visit (no prior service worker — every Lighthouse/PSI run, and every new user) the SW installs (precaching ~160 shell assets, ≈3.7 s on prod), activates immediately and `clients.claim()`s the open page, which fires `controllerchange` → `location.reload()`. Lighthouse keys its observed metrics to the LAST navigation (so LCP looked like a 0.2 s text paint) but builds the Lantern graph from the whole log, so every first-load request that finished before that second navigation's LCP timestamp (14 chart/API fetches, ~190 cover images, 149 JS chunks) was simulated as pre-LCP on Slow 4G → 31 s. The chart fan-out itself never gated the LCP text (`SPAN.r-title` paints at ~0.67 s on nav 1, before the chart responses).
- fix: capture `hadController = !!navigator.serviceWorker.controller` in `init()`; the first `controllerchange` with no prior controller is the install claim and is ignored (flag flips so a later real update in the same session still reloads once). Unit test `swUpdate.svelte.test.ts` covers both branches.
- verification: local build + `wrangler pages dev :8788`, Lighthouse 13.5 mobile. BEFORE: score 68, LCP 9.0 s, FCP 3.4 s, 329 requests, 2 document requests / 2 navigations, 4 LCP candidates. AFTER: score 73, LCP 6.1 s, FCP 2.8 s, 200 requests, 1 document request / 1 navigation, 2 LCP candidates (brand → r-title). Prod will drop further than local because its install precache took 3.7 s (vs ~0.5 s locally), so far more of the first load sat before the cutoff. `pnpm test` 173 files / 3928 tests green; `pnpm check` 0 errors.
- files_changed: [src/lib/stores/swUpdate.svelte.ts, src/lib/stores/swUpdate.svelte.test.ts]

## Follow-ups (not done here)

- Residual simulated LCP ≈ 6 s locally is the SPA floor: ~600 KB / 75 JS chunks must download + evaluate (4x CPU) before the first shelf text; the LCP element is the first CompactRow title (`SPAN.r-title`, size 4743 > brand 2990), which additionally waits on one `/api/charts` round-trip. Cutting it means shrinking the initial JS graph (player god object, 149 chunks on the route) — a separate effort, not a one-line fix.
- `static.cloudflareinsights.com/beacon.min.js` + its `/cdn-cgi/rum` XHR/preflights land before LCP in every run; product decision whether to keep it.
