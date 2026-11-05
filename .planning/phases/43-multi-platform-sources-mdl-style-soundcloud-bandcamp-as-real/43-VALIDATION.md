---
phase: 43
slug: multi-platform-sources-mdl-style-soundcloud-bandcamp-as-real
status: draft
nyquist_compliant: false
wave_0_complete: false
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

| Must-have | Test Type | Automated Command / File | File Exists | Status |
|-----------|-----------|--------------------------|-------------|--------|
| D-05 enabledByDefault + labels + defaults | unit | `src/lib/sources/registry.test.ts` | ✅ extend | ⬜ pending |
| D-06 seat after suyin, eligible, fallbackOrder tail | unit | `src/lib/sources/source-order.test.ts`, `registry.test.ts` | ✅ extend | ⬜ pending |
| D-07 TIER_1 unchanged | unit | `src/lib/sources/source-order.test.ts` | ✅ | ⬜ pending |
| Search mapping, superset pagination, health gate, drift throw | unit | `src/lib/sources/{soundcloud,bandcamp}.test.ts` | ❌ W0 | ⬜ pending |
| Resolve (audioUrl, quality 128k, urlExpiresAt, BC proxyUrl) | unit | same | ❌ W0 | ⬜ pending |
| Edge helpers (pickTranscoding, client_id regex, id validation, BC `{error:true}`) | unit | `src/lib/proxy/{soundcloud,bandcamp}.test.ts` | ❌ W0 | ⬜ pending |
| Cover allowlist (.sndcdn.com, .bcbits.com) | unit | `src/lib/proxy/safe-image-url.test.ts` | ✅ extend | ⬜ pending |
| Freshness honours urlExpiresAt | unit | `src/lib/services/track-ready.test.ts` | check | ⬜ pending |
| Lyricless | unit | `src/lib/services/catalog.test.ts` | ✅ extend | ⬜ pending |
| D-08 predicate / marker / notice | unit | `song-variant.test.ts`, `fallback.test.ts`, `player.svelte.test.ts` | ✅ extend | ⬜ pending |
| i18n parity | unit | `src/lib/i18n/i18n.test.ts` | ✅ | ⬜ pending |
| D-09 HLS gate (canPlayType) + browser stitch download | unit | adapter/download tests | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/sources/__fixtures__/soundcloud.search.json` (≥1 progressive, ≥1 HLS-only, ≥1 SNIP row)
- [ ] `src/lib/sources/__fixtures__/bandcamp.search.json` + `bandcamp.tralbum.json` (+ `{"error":true}` sample)
- [ ] SC bundle snippet fixture for the `client_id` regex
- [ ] Test files `sources/{soundcloud,bandcamp}.test.ts`, `proxy/{soundcloud,bandcamp}.test.ts`

---

## Manual-Only Verifications

| Behavior | Why Manual | Test Instructions |
|----------|------------|-------------------|
| Routes export only verbs; live 200 JSON | +server.ts invalid exports only fail at request time | `pnpm dev`; curl `/api/soundcloud/search?q=lofi`, `/api/bandcamp/search?q=lofi`, `/api/bandcamp/stream?id=…` with `Range: bytes=0-99` → 206 |
| Prod Worker egress | CF IP blocking untestable locally | post-deploy `curl https://openmusic.lol/api/soundcloud/search?q=lofi` non-empty |
| D-09 native HLS on Android Chrome + APK WebView; Firefox drops HLS rows | device behaviour | emulator + CDP recipe (memory: apk-debug-via-emulator-cdp) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
