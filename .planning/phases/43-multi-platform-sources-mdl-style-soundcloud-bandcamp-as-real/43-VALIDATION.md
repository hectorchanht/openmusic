---
phase: 43
slug: multi-platform-sources-mdl-style-soundcloud-bandcamp-as-real
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-11-04
---

# Phase 43 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 43-RESEARCH.md "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.3 (node project, no jsdom), co-located `*.test.ts` |
| **Config file** | `vite.config.ts` (existing) |
| **Quick run command** | `PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH pnpm exec vitest --run src/lib/sources/soundcloud.test.ts src/lib/sources/bandcamp.test.ts src/lib/proxy/soundcloud.test.ts src/lib/proxy/bandcamp.test.ts src/lib/sources/registry.test.ts src/lib/sources/source-order.test.ts` |
| **Full suite command** | `PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH pnpm test && pnpm check` |
| **Estimated runtime** | quick < 5 s; full ~60 s |

---

## Sampling Rate

- **After every task commit:** quick run command
- **After every plan wave:** full suite command
- **Before `/gsd:verify-work`:** full suite green + local route smoke curls
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled by the planner per task. Must-have → test map:

| Must-have | Test Type | Automated Command / File | File Exists | Plan / Task | Status |
|-----------|-----------|--------------------------|-------------|-------------|--------|
| D-05 enabledByDefault + labels + defaults | unit | `src/lib/sources/registry.test.ts` | ✅ extend | 05-T2, 07-T2 | ✅ green (05-T2; SC half 07-T2 deferred D-10) |
| D-06 seat after suyin (`suyin, bandcamp, soundcloud, archive`), eligible, fallbackOrder tail | unit | `src/lib/sources/source-order.test.ts`, `registry.test.ts` | ✅ extend | 05-T2, 07-T2 | ✅ green (05-T2: `suyin, bandcamp, archive`; SC seat deferred D-10) |
| D-07 TIER_1 unchanged | unit | `src/lib/sources/source-order.test.ts` line 38 (pin untouched) | ✅ | 05-T2, 07-T2 | ✅ green (05-T2) |
| Search mapping, superset pagination, health gate, drift throw, 503 → recordFail | unit | `src/lib/sources/{bandcamp,soundcloud}.test.ts` | ❌ W0 | 05-T1, 07-T1 | ✅ green BC (05-T1); SC 07-T1 deferred (D-10) |
| Resolve (audioUrl https, quality 128k, SC urlExpiresAt, BC proxyUrl stream route) | unit | same | ❌ W0 | 05-T1, 07-T1 | ✅ green BC (05-T1); SC 07-T1 deferred (D-10) |
| Edge helpers BC (parseBandcampSearch, streamFromTralbum `{error:true}`, isBcbitsMediaUrl, id regex) | unit | `src/lib/proxy/bandcamp.test.ts` | ❌ W0 | 02-T1 | ✅ green (02-T1) |
| Edge helpers SC (pickTranscoding order + exclusions, extractClientId, parseSearchRows, id regex, 401 rescrape-once) | unit | `src/lib/proxy/soundcloud.test.ts` | ❌ W0 | 03-T1, 03-T2 | ➖ deferred (D-10) |
| Routes verb-only + live 200 JSON (search/resolve/stream) | smoke | curls in 02-T2/T3, 03-T3 verify blocks | n/a | 02-T2, 02-T3, 03-T3, 08-T1 | ✅ green BC (08-T1 live curls: search rows, resolve bcbits, stream Range 206); SC deferred (D-10) |
| Cover allowlist (.sndcdn.com, .bcbits.com) | unit | `src/lib/proxy/safe-image-url.test.ts` | ✅ extend | 01-T1 | ✅ green (01-T1) |
| Freshness honours urlExpiresAt | unit | `src/lib/services/track-ready.test.ts` | ✅ extend | 01-T1 | ✅ green (01-T1) |
| Lyricless (both ids) | unit | `src/lib/services/catalog.test.ts` | ✅ extend | 05-T2, 07-T2 | ✅ green bandcamp (05-T2); soundcloud deferred (D-10) |
| D-08 predicate `isNotableVersionMismatch` | unit | `src/lib/services/song-variant.test.ts` | ✅ extend | 01-T2 | ✅ green (01-T2) |
| D-08 marker (walkSource + noticeOnAutoPick flag) | unit | `src/lib/services/fallback.test.ts` | ✅ extend | 01-T3 | ✅ green (01-T3) |
| D-08 notice (`kind:'version'`, once per uid, auto-clear) | unit | `src/lib/stores/player.svelte.test.ts` | ✅ extend | 06-T1 | ✅ green (06-T1) |
| i18n parity (`toast.mayNotBeOriginal`, 15 locales, double quotes) | unit | `src/lib/i18n/i18n.test.ts` | ✅ | 06-T2 | ✅ green (06-T2) |
| D-09 HLS module (isHlsUrl, canPlayNativeHls, parseHlsMedia, stitchHls order + MIME) | unit | `src/lib/services/hls.test.ts` | ❌ W0 | 04-T1 | ✅ green (04-T1) |
| D-09 `.m3u8` download stitched to `.m4a`, failure → 'failed' | unit | `src/lib/services/download-track.test.ts` | ✅ extend | 04-T2 | ✅ green (04-T2) |
| D-09 client gate (HLS rows dropped / resolve throws without native HLS) | unit | `src/lib/sources/soundcloud.test.ts` | ❌ W0 | 07-T1 | ➖ deferred (D-10) |
| D-09 CLAUDE.md relaxed ("no HLS in JS"), README/About copy, page=8 todo filed | grep | 04-T3 verify block | n/a | 04-T3 | ✅ green (04-T3) |
| D-02/D-03/D-04 scope by absence (no DRM/Deezer adapters, ytmusic untouched) | grep | 08-T1 verify block | n/a | 08-T1 | ✅ green (08-T1: no spotify/apple/amazon/tidal/qobuz/deezer/soundcloud adapter, no soundcloud SourceId or /api/soundcloud route, ytmusic.ts untouched since dae18cf8) |
| D-09 A2 Android Chrome + APK WebView HLS; Firefox lists no HLS rows; prod egress probe | manual | 08-T2 checkpoint | n/a | 08-T2 | ⏳ human checkpoint 08-T2 (HLS device items deferred D-10; BC browser play/download, fallback toast, prod BC egress remain) |

*Status: ⬜ pending · ➖ deferred (D-10, SoundCloud dropped) · ⏳ human · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] ➖ deferred (D-10): `src/lib/sources/__fixtures__/soundcloud.api-v2.search.json` (upstream; ≥1 progressive, ≥1 HLS-only, ≥1 SNIP row) — 03-T1; `soundcloud.search.json` (route rows) — 07-T1
- [x] `src/lib/sources/__fixtures__/bandcamp.autocomplete.json` + `bandcamp.tralbum.json` (+ inline `{"error":true}` sample) — 02-T1; `bandcamp.search.json` (route rows) — 05-T1
- [x] ➖ deferred (D-10): SC bundle snippet (inline string in `proxy/soundcloud.test.ts`) — 03-T1
- [x] Test files `sources/bandcamp.test.ts` (05-T1), `proxy/bandcamp.test.ts` (02-T1), `services/hls.test.ts` (04-T1) present; soundcloud test files deferred (D-10) — originally `sources/{bandcamp,soundcloud}.test.ts` (05-T1, 07-T1), `proxy/{bandcamp,soundcloud}.test.ts` (02-T1, 03-T1), `services/hls.test.ts` (04-T1)

---

## Manual-Only Verifications

| Behavior | Why Manual | Test Instructions |
|----------|------------|-------------------|
| Routes export only verbs; live 200 JSON | +server.ts invalid exports only fail at request time | `pnpm dev`; curl `/api/soundcloud/search?q=lofi`, `/api/bandcamp/search?q=lofi`, `/api/bandcamp/stream?id=…` with `Range: bytes=0-99` → 206 |
| Prod Worker egress | CF IP blocking untestable locally | post-deploy `curl https://openmusic.lol/api/soundcloud/search?q=lofi` non-empty |
| D-09 native HLS on Android Chrome + APK WebView; Firefox drops HLS rows | device behaviour | emulator + CDP recipe (memory: apk-debug-via-emulator-cdp) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-11-05 (08-T1 automated gate: 5313 pass, only the 5 known pre-existing failures in settings-persist + track-menu-order; `pnpm check` 0 errors). Device/prod items await 08-T2.
