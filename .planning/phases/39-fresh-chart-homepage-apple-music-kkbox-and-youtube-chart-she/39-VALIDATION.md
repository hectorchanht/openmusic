---
phase: 39
slug: fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-25
---

# Phase 39 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 39-RESEARCH.md
> §Validation Architecture (+ P39-13 for the KKBOX+Apple Top Songs blend decided after research).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.3 — single `server` node project (no jsdom); `expect.requireAssertions: true` |
| **Config file** | `vite.config.ts` (`test.projects[0]`, include `src/**/*.{test,spec}.{js,ts}`) |
| **Quick run command** | `pnpm vitest --run src/lib/services/chart-parse.test.ts src/lib/services/home-layout.test.ts src/lib/services/home-charts.test.ts` |
| **Full suite command** | `pnpm test && pnpm check` |
| **Estimated runtime** | ~2 s quick (baseline home-layout + discovery + settings-persist = 83 tests in 0.9 s); full suite ~60 s |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the files touched
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** `pnpm test && pnpm check` green, then the manual E2E below
- **Max feedback latency:** 5 seconds (quick run)

---

## Per-Requirement Verification Map

Task IDs are assigned by the planner; each task's `<automated>` verify must point at one of these rows.

| Req | Behavior | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|------------|-----------------|-----------|-------------------|-------------|--------|
| P39-01 | Apple/KKBOX/YT parsers on trimmed real fixtures; `stripLatinAlias`, `stripReleaseSuffix`, `resizeMzstatic`, YT thumb rewrite; YT echo mismatch → `[]` | T-39 upstream-JSON | untrusted JSON never throws into render | unit | `pnpm vitest --run src/lib/services/chart-parse.test.ts` | ❌ W0 | ⬜ pending |
| P39-01 | Route param allowlist: bad src/kind/cc → `{items:[]}` + 0 upstream fetches | T-39 SSRF/param-injection | only allowlisted params reach upstream URLs | unit (route) | `pnpm vitest --run src/routes/api/charts/charts-endpoint.test.ts` | ❌ W0 | ⬜ pending |
| P39-02 | miss → fetch + put; fresh hit → 0 fetch; stale hit → stale body + `waitUntil` refill; empty parse not cached; upstream throw → `[]` | T-39 cache-poisoning | own-origin cache key; empty/failed never cached | unit (route, stubbed `caches`/`fetch`/ctx) | same file | ❌ W0 | ⬜ pending |
| P39-03 | `?genre=116` → `/chart/116/tracks`; unknown genre → plain `/chart`; distinct cache key | T-39 param-injection | genre ∈ allowlist | unit (route) | `pnpm vitest --run src/routes/api/deezer/chart/deezer-chart-endpoint.test.ts` | ❌ W0 | ⬜ pending |
| P39-04 | iTunes: single-entry object, off-genre rows dropped, bogus id → `[]`, never throws, goes through `apiFetch` | — | N/A | unit | `pnpm vitest --run src/lib/services/charts.test.ts` | ❌ W0 | ⬜ pending |
| P39-05 | `resolveChartRegion` covers all 15 AppLangs, never `cn`, garbage → default; `resolveExtraRegions` drops main/dupes/unknown; `resolveChartGenres` allowlist | T-39 poisoned-localStorage | persisted config clamps, never blanks | unit | `pnpm vitest --run src/lib/services/home-layout.test.ts` | ✅ extend | ⬜ pending |
| P39-06 | `migrateHomeLayout`: old default, custom order (insert at first classic), garbage order, idempotent; `load()` migrates once + persists version; un-hide survives reload; fresh defaults; `resetHome()` = new layout | T-39 poisoned-localStorage | migration never throws / never loops | unit + store round-trip | `pnpm vitest --run src/lib/services/home-layout.test.ts src/lib/stores/settings-persist.svelte.test.ts` | ✅ extend | ⬜ pending |
| P39-07 | `planChartShelves`: hidden ⇒ no task (new AND classic); new-releases outside hk/tw/sg ⇒ no task; YT tasks only for YT regions; fallback grid only when every visible shelf is empty | T-39 request-flood | hidden = 0 requests; fan-out capped | unit | `pnpm vitest --run src/lib/services/home-charts.test.ts` | ❌ W0 | ⬜ pending |
| P39-08 | album tap → `albumHref` with ` - EP`/` - Single` stripped | — | N/A | unit | `pnpm vitest --run src/lib/services/home-charts.test.ts` | ❌ W0 | ⬜ pending |
| P39-09 | allowlists accept mzstatic / i.kfs.io / googleusercontent / i.ytimg / yt3.ggpht, reject look-alikes (`evil-mzstatic.com`) | T-39 image-host-spoof | https + exact-suffix host match | unit | `pnpm vitest --run src/lib/proxy/safe-image-url.test.ts` | ✅ extend | ⬜ pending |
| P39-11 | key parity + double quotes across all 15 locales | — | N/A | unit | `pnpm vitest --run src/lib/i18n/i18n.test.ts` | ✅ auto | ⬜ pending |
| P39-12 | Randomize redraws picks with 0 fetches; persisted arrangement survives reload; stale refresh does not swap on screen | — | N/A | unit (pure sampler + fetch spy) | `pnpm vitest --run src/lib/services/home-charts.test.ts` | ❌ W0 | ⬜ pending |
| P39-13 | `fuseCharts`: RRF order, cross-chart song ranks above single-chart peers, matchKey dedupe after `stripLatinAlias`, Apple name wins on overlap, one source empty → the other alone | — | N/A | unit | `pnpm vitest --run src/lib/services/chart-parse.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/services/__fixtures__/charts/` — trimmed real responses: `apple-hk-songs.json`, `apple-hk-albums.json`, `kkbox-hk-song.json`, `yt-hk-tracks.json` + `yt-cn-global.json` (keep the `perspectiveMetadata` echo path), `itunes-hk-1251.json` + single-entry variant + `itunes-bogus.json`, `deezer-116.json`
- [ ] `src/lib/services/chart-parse.test.ts`
- [ ] `src/lib/services/home-charts.test.ts`
- [ ] `src/lib/services/charts.test.ts` (stub `fetch`, reset `__resetGovernor` + `__clearSearchCache`)
- [ ] `src/routes/api/charts/charts-endpoint.test.ts` (copy the `stubCache`/`stubUpstream` harness from `resolve-endpoint.test.ts`)
- [ ] `src/routes/api/deezer/chart/deezer-chart-endpoint.test.ts`
- Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cold home request count ≈ 13 (hk) / 12 (us), 0 classic calls | P39-07 | needs the real network log of a fresh profile | Dev server, fresh localStorage, in-app browser `read_network_requests` filtered to `/api/` + `itunes.apple.com` |
| First shelves render with covers; settings/home shows Charts / Library / Classic groups; un-hiding a classic section makes it fetch + render | P39-07, P39-10 | visual + interaction | In-app browser; rAF is frozen in the pane, so use back/forward (`popstate` → `revealed = Infinity`) to mount all shelves |
| Existing-user one-time switch on a real old settings blob | P39-06 | needs a pre-update localStorage snapshot | Seed `openmusic:settings:v1` with an old blob, load, confirm classic hidden + new shown + order/density kept, reload → no second migration |
| Tapping a chart song plays (resolve-by-name) | P39-08 | CN upstream availability varies | Tap a Top Songs tile, confirm Now Playing seats and audio starts |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
