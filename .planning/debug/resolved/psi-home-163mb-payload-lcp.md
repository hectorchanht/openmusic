---
status: resolved
trigger: "PSI mobile report openmusic.lol: Perf 49, LCP 237.6s, initial home load payload 163,598 KiB (~163 MB). Root-cause the payload/LCP."
created: 2026-10-02
updated: 2026-10-02
---

# Debug: psi-home-163mb-payload-lcp

## Trigger (verbatim, data only)

DATA_START
PageSpeed Insights mobile report for https://openmusic.lol (Lighthouse 13.5, Moto G Power, Slow 4G, captured 2026-10-02): Performance 49. FCP 3.5s, LCP 237.6s (!), TBT 740ms, CLS 0.002, SI 3.5s. Total network payload 163,598 KiB (~163 MB) on initial home-page load. Insights: "Improve image delivery" est savings 49,919 KiB; "Use efficient cache lifetimes" 1,355 KiB; render-blocking requests 460ms; legacy JS 21 KiB; forced reflow; main-thread work 10.2s; JS execution 3.1s; 20 long tasks. Also: robots.txt fetch failed, llms.txt fetch failed, console errors logged, missing source maps. Primary symptom to root-cause: why does an initial home load pull ~163 MB and take 237s to LCP (oversized cover images? audio/blob preload? request loop?). Report: https://pagespeed.web.dev/analysis/https-openmusic-lol/op0pipv490?form_factor=mobile
DATA_END

## Symptoms

- expected: Initial home-page load on mobile pulls a few MB at most (lazy, appropriately sized covers); LCP within a few seconds.
- actual: ~163 MB payload (desktop run ~152 MB), mobile LCP 237.6 s (desktop 36.2 s). LCP breakdown: TTFB 0 ms, element render delay 3,800 ms.
- errors: Only console errors are cloudflareinsights `/cdn-cgi/rum` ERR_BLOCKED_BY_CLIENT (benign). robots.txt + llms.txt "Failed to fetch".
- timeline: Unknown; captured 2026-10-02 against prod. Home now has chart shelves (Apple RSS / Deezer genre charts / KKBOX / YouTube charts) per spikes 009–012 + phase 40 cover work.
- reproduction: Cold-load https://openmusic.lol (home) in Lighthouse mobile. Locally: `pnpm dev` (port 4321 via launch.json, or 5173) and inspect network on `/`.

## Evidence

- timestamp: 2026-10-02 (orchestrator, from PSI DOM)
  finding: "Improve image delivery" lists 198 third-party images; "iTunes content" resource size 47,940 KiB, est savings 42,304 KiB. Every top entry is `is1-ssl.mzstatic.com/.../<name>.jpg/600x600bb.png` at 680–860 KiB each — i.e. iTunes artwork requested as **PNG** at 600x600 (iTunes serves `600x600bb.jpg` at ~50–80 KiB; `.png` is lossless and ~10x larger). Lighthouse: "Using a modern image format or increasing compression" ~93% savings per image.
- timestamp: 2026-10-02
  finding: In "Avoid enormous network payloads" every mzstatic URL appears TWICE with identical transfer size (e.g. NOPA-9290 859.5 KiB ×2) → each cover is likely downloaded twice (probe `new Image()` + `<img>`? cache-busting? two components? no-store?).
- timestamp: 2026-10-02
  finding: Other image hosts on home: yt3.googleusercontent.com `=w544-h544-l90-rj` (~2.8 MB, ~45 imgs), lh3.googleusercontent.com (~640 KiB), i.kfs.io `fit/500x500.jpg` (~1.25 MB), i.ytimg.com maxresdefault.jpg. ~198+ images fetched on initial load → lazy loading not effective (offscreen shelves loading eagerly?).
- timestamp: 2026-10-02
  finding: Critical chain max latency 11,436 ms; `/api/deezer/chart?genre=106|85|16&limit=50` each ~8.8 s, `/api/charts?src=apple&kind=songs&cc=us` on critical path.
- timestamp: 2026-10-02
  finding: Render-blocking: 7 small CSS chunks (17.9 KiB, 1,230 ms). Cache-insight: yt3/lh3 images 1d TTL (third-party, not ours).

- timestamp: 2026-10-02 (debugger)
  checked: grep for the mzstatic size rewrite
  found: ONE site — `resizeMzstatic()` in `src/lib/services/chart-parse.ts` rewrites `/NxNbb.` → `/600x600bb.` and KEEPS the extension. Apple RSS v2 (edge, `/api/charts`) sends `artworkUrl100` = `…/100x100bb.jpg` → `600x600bb.jpg` (fine). The legacy iTunes genre feed (CLIENT-side, `itunesGenreChart` → `parseItunesGenreFeed`, genres cantopop/mandopop/kpop/jpop) sends `im:image` = `…/170x170bb.png` → `600x600bb.png` — a lossless PNG. Confirmed live: `curl https://itunes.apple.com/hk/rss/topsongs/limit=100/genre=1251/json` → all `im:image` labels end `bb.png`.
  implication: the PNGs are the genre shelves; the extension is Apple's OUTPUT format selector, so the rewrite must also force `.jpg`.
- timestamp: 2026-10-02
  checked: HEAD on one real asset, all variants
  found: `600x600bb.png` = 339,970 B (image/png) · `600x600bb.jpg` = 44,834 B · `400x400bb.jpg` = 23,224 B · `300x300bb.jpg` = 14,960 B · `300x300bb.webp` = 6,934 B. Same asset, ~7.6x from the extension alone.
- timestamp: 2026-10-02
  checked: headless Chrome (412x915, DPR 2.625, mobile, fresh profile) cold home load on the dev server via CDP (scratchpad `cdp-measure.mjs`)
  found: TOTAL 970 requests / 84.4 MB. `is1-ssl.mzstatic.com` 142 URLs: 90 PNG = 46.0 MB (~523 KB each), 52 JPG = 5.1 MB (~100 KB each). `cdn-images.dzcdn.net` 149 URLs = 18.4 MB (Deezer genre charts emit `cover_xl` 1000px, ~124 KB each). yt3 38 = 1.06 MB, i.kfs.io 20 = 0.87 MB. 358 cross-origin images for ONE mobile viewport.
  implication: two byte root causes (PNG format; Deezer xl) and one count root cause (nothing is lazy).
- timestamp: 2026-10-02
  checked: why 358 images load for one viewport (screenshot `home-before.png` + templates)
  found: the default chart shelves render at `list` density → `CompactPager` mounts ALL 24 rows (6 columns × 4) per shelf, and `CompactRow.svelte` paints every cover as a CSS `style:background-image: url(...)` on `.art`. CSS background images are never lazy-loaded by the browser, so every row in every off-screen column of every shelf fetches on mount. The `pile`/`grid` tiles on the same page already use the gradient-bg + `<img loading="lazy">` overlay pattern (`.al-cover` + `.al-cover-img`).
  implication: CompactRow needs the same lazy `<img>` overlay; no new mechanism.
- timestamp: 2026-10-02
  checked: does the chart image size matter beyond the tile? `player.svelte.ts` 3650 + 3899 + 4052
  found: `play()` seeds `resolvedCover` from `track.cover` (the chart image); a renderable https seed is KEPT over the source's resolved cover and the async cover chain is skipped. So the chart URL is ALSO the now-playing hero.
  implication: keep 600px (every other tier is 500–600: kuwo /600/, KKBOX 500, YT 544, Apple RSS 600); fix the FORMAT. Deezer chart `cover_xl` (1000px, ~208 KB) → `cover_big` (500px, ~72 KB) is the matching size. 300/400px would soften the hero for a saving the lazy fix already captures.

## Eliminated

- hypothesis: each cover is fetched twice on the wire (probe `new Image()` + `<img>`, cache-busting, or two components)
  evidence: dev-server home load, Chrome net-log: 136/136 mzstatic URLs requested exactly once. CDP page session: 142/142 distinct, 0 image URLs with >1 request (only same-origin SW-handled scripts show the usual 2 records, the SW copy at 0 bytes). Chart tiles have no `lazyCover` probe (DiscoveryTrack has no uid; comment at +page.svelte 1370), CompactRow uses one CSS url per row, and the SW bypasses every cross-origin request (`shouldBypass`: `url.origin !== selfOrigin`).
  timestamp: 2026-10-02
- hypothesis: the PSI "every mzstatic URL twice" is the service-worker target's view of the bypassed fetch
  evidence: CDP with `Target.setAutoAttach(flatten)` on page + 3 service_worker sessions: SW sessions report 299 requests (their own same-origin `fetch(event.request)` passes), zero mzstatic; 0 of 122 mzstatic URLs multi-reported across sessions.
  timestamp: 2026-10-02
  note: most likely the PSI page DOM holds BOTH the mobile and desktop reports (the trigger evidence quotes a desktop run of ~152 MB from the same capture), so a DOM scrape lists each URL once per report with the same transfer size. Not reproducible as a code bug; re-check with a fresh PSI run after deploy.

## Current Focus

- hypothesis: CONFIRMED — (a) `resizeMzstatic` keeps the legacy feed's `.png` extension → 90 lossless 600px PNGs (~46 MB); (b) `/api/deezer/chart` emits `cover_xl` 1000px (~18 MB); (c) CompactRow CSS `background-image` covers are never lazy, so all 24 rows × every shelf load on mount (358 images / viewport). LCP 237 s is the Lantern-simulated consequence of that payload on Slow 4G (observed load was unthrottled).
- reasoning_checkpoint:
    hypothesis: "The 163 MB home payload is 90+ lossless 600px PNG chart covers (because resizeMzstatic preserves the iTunes feed's .png extension) plus 149 Deezer 1000px covers, ALL fetched on mount because CompactRow paints covers as CSS background-image (never lazy)."
    confirming_evidence:
      - "chart-parse.ts resizeMzstatic regex `/\\/\\d+x\\d+bb\\./` leaves the extension; live feed labels end bb.png; HEAD: png 339,970 B vs jpg 44,834 B"
      - "CDP census: 90 PNG = 46.0 MB of 84.4 MB total; 149 dzcdn = 18.4 MB; 358 images for a 412x915 viewport; CompactRow.svelte paints `.art` via style:background-image"
    falsification_test: "After forcing .jpg + lazy <img> in CompactRow + cover_big, a cold CDP census must show 0 bb.png URLs, far fewer image requests (only near-viewport rows), and mzstatic bytes down ~7x"
    fix_rationale: "Format is Apple's output selector in the URL — fixing it at the single rewrite site fixes both feeds. Lazy <img> is the native mechanism the page's other tiles already use. cover_big is the size every other tier already ships."
    blind_spots: "Chrome's lazy-load distance threshold (1250–2500px) still loads some off-screen columns; PSI's 'twice' is unexplained locally (likely report scrape); 1200x1200bb iTunes covers from upgradeArtwork (D-11) on library shelves for returning users are NOT touched."
- test: apply the three edits, `pnpm test` + `pnpm check`, re-run the CDP census and compare.
- next_action: edit chart-parse.ts resizeMzstatic (force .jpg), CompactRow.svelte (lazy img overlay), deezer chart route (cover_big first), chart-parse.test.ts expectations.

- timestamp: 2026-10-02
  checked: after-fix CDP census (same script, fresh profile) + route curls + screenshot
  found: TOTAL 792 requests / 18.2 MB, of which 14.06 MB is unbundled dev-server JS (localhost). Cross-origin images: 53 (was 358). mzstatic 31 URLs, 0 PNG, 3.07 MB (was 142 / 90 PNG / 51.1 MB). dzcdn 0 on the cold viewport (was 149 / 18.4 MB) — the Deezer genre shelves now wait below the lazy threshold. `/api/deezer/chart?genre=106` emits `…/500x500-000000-80-0-0.jpg` (13,477 B vs 41,673 B at 1000x1000). `home-after.png`: CompactRow covers paint (square + round) over the gradient.
  implication: falsification test passed on every count.

## Resolution

- root_cause: Three compounding causes, all on the home chart shelves. (1) `resizeMzstatic()` (`src/lib/services/chart-parse.ts`) rewrote only the `/NxNbb.` size segment and preserved the extension; the legacy iTunes genre feed (client-side cantopop/mandopop/kpop/jpop shelves) labels end `bb.png`, and on mzstatic the extension selects the OUTPUT format, so ~90 tiles were lossless 600px PNGs at ~340–860 KB each (~46 MB locally; `600x600bb.jpg` of the same asset is ~45 KB). (2) `/api/deezer/chart` emitted `cover_xl` (1000px, ~124–208 KB) for ~150 genre-chart tiles (~18 MB). (3) `CompactRow.svelte` painted every cover as a CSS `background-image`, which browsers never lazy-load, and `CompactPager` mounts all 24 rows (6 columns × 4) of every `list`-density shelf — so 358 cross-origin images fetched for one phone viewport on mount. PSI's 237 s LCP is the Lantern-simulated cost of that payload on Slow 4G. The "each URL twice" in the PSI capture did not reproduce at the network, page-session or service-worker-session layer and is most likely the mobile + desktop reports both being present in the scraped PSI DOM.
- fix: (1) `resizeMzstatic` now replaces `/NxNbb.<ext>` with `/{px}x{px}bb.jpg` (one guard, both feeds; 600px kept because the same URL seeds the now-playing hero and every sibling tier is 500–600px). (2) Deezer chart reshape prefers `cover_big` / `picture_big` (500px) over `_xl`; the `d:` share token keys on the 32-hex hash only, so the `?ci=` grammar is untouched. (3) CompactRow renders the cover as `<img class="art-img" loading="lazy" onerror=hide>` over the gradient `.art` box — the same `.al-cover` + `.al-cover-img` pattern the page's pile/grid tiles already use; `use:lazyCover` and `effectiveCover` are unchanged.
- verification: `pnpm test` 172 files / 3926 tests pass (incl. new `resizeMzstatic` png→jpg test and the tightened genre-feed `.jpg$` assertion); `pnpm check` 0 errors (13 pre-existing unused-CSS warnings in artist page). Cold mobile home load via CDP: cross-origin images 358 → 53; mzstatic 51.1 MB → 3.07 MB with 0 `.png`; dzcdn 18.4 MB → 0 on the initial viewport; Deezer route HEAD 41,673 B → 13,477 B per cover. Screenshot shows covers painting in CompactRow.
- files_changed: [src/lib/services/chart-parse.ts, src/lib/services/chart-parse.test.ts, src/lib/components/CompactRow.svelte, src/routes/api/deezer/chart/+server.ts]

## Follow-ups (out of scope here)

- robots.txt / llms.txt 404s, 7 render-blocking CSS chunks (460 ms–1.2 s), TBT 740 ms / 20 long tasks, legacy JS 21 KiB, missing source maps — separate PSI items, untouched.
- `upgradeArtwork()` (`itunes-cover.ts`, D-11) still emits `1200x1200bb.jpg` (~330 KB) for RESOLVED iTunes covers; a returning user's liked/history shelves can pay that per tile. Not on the cold-load path measured here.
- Chrome's native `loading="lazy"` distance threshold (1250–2500 px by connection type) still prefetches a few off-screen pager columns; an IntersectionObserver-gated `<img>` would tighten it if a re-run of PSI shows it matters.
- Re-run PSI after deploy to confirm the "URL listed twice" was the mobile+desktop DOM artifact (not reproducible locally).
