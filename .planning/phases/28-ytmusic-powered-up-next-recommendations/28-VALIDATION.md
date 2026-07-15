---
phase: 28
slug: ytmusic-powered-up-next-recommendations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-15
---

# Phase 28 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `28-RESEARCH.md` → Validation Architecture (live-fixture-backed).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.3` (single node/server project, no jsdom) |
| **Config file** | `vite.config.ts` (test project) — run via `pnpm test` |
| **Quick run command** | `pnpm test -- src/lib/proxy/ytmusic.test.ts src/lib/services/similar.test.ts` |
| **Full suite command** | `pnpm test` (`vitest --run`) then `pnpm check` (svelte-check) |
| **Estimated runtime** | ~30–90 seconds full suite (~1320 tests) |

---

## Sampling Rate

- **After every task commit:** Run the quick run command (proxy + similar).
- **After every plan wave:** Run the full suite command (`pnpm test`).
- **Before `/gsd:verify-work`:** Full suite green + `pnpm check` clean.
- **Max feedback latency:** ~90 seconds.

---

## Per-Task Verification Map

> Task IDs assigned by the planner; rows are requirement-level until PLAN.md is written.

| Requirement | Wave | Secure/Expected Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|------|--------------------------|-----------|-------------------|-------------|--------|
| UPNEXT-YT-01 | 0/1 | `parseWatchNextQueue` strips seed row, dedupes, maps videoId/title/artist/thumb; returns `[]` on bogus/empty | unit (fixture) | `pnpm test -- src/lib/proxy/ytmusic.test.ts` | ✅ file / ❌ test (W0) | ⬜ pending |
| UPNEXT-YT-01 | 1 | `/api/ytmusic/related?videoId=` GET → `{tracks}`; `{tracks:[]}` on empty/error; OPTIONS 204; never 500 | unit | new `src/routes/api/ytmusic/related/*.test.ts` (or in ytmusic.test) | ❌ (W0) | ⬜ pending |
| UPNEXT-YT-02 | 1 | `buildSimilarQueue` YT-seed branch → real `ytmusic` stubs + `report('ytmusic-related')`; CN seed path unchanged | unit | `pnpm test -- src/lib/services/similar.test.ts` | ✅ file / ❌ test (W0) | ⬜ pending |
| UPNEXT-YT-02 | 1 | YT stub resolves via `SOURCES['ytmusic'].resolve` (→ `/api/ytmusic/stream`), NOT resolveNameStub | unit | `pnpm test -- src/lib/sources/ytmusic.test.ts` | ✅ (add stub-origin case) | ⬜ pending |
| UPNEXT-FB-01 | 0/1 | `buildTopHitsQueue` = one chart call → kuwo-first name-stubs, excludes current uids | unit | new `src/lib/services/picks.test.ts` | ❌ (W0) | ⬜ pending |
| UPNEXT-FB-01 | 1 | `regenerate()`/`ensureAhead()` empty branch → `buildTopHitsQueue`, logs `via:'top-hits'` (was `'diverse'`) | unit | `pnpm test -- src/lib/stores/player.svelte.test.ts` | ✅ (update mocks + assertions) | ⬜ pending |
| UPNEXT-YT-03 | all | never-throw at every new boundary; full suite green + typecheck clean | suite | `pnpm test && pnpm check` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/proxy/__fixtures__/ytmusic-next.json` — seed from the captured `28-ytmusic-related.fixture.json` (covers UPNEXT-YT-01 parse).
- [ ] `parseWatchNextQueue` tests in `src/lib/proxy/ytmusic.test.ts` (row path, seed-strip, dedupe, bogus→`[]`).
- [ ] YT-seed branch test in `src/lib/services/similar.test.ts` (mock `/api/ytmusic/related`; assert CN seed untouched).
- [ ] `src/lib/services/picks.test.ts` — new file for `buildTopHitsQueue` (one chart call, uid-exclude).
- [ ] Update `player.svelte.test.ts` — mock the top-hits path (~line 33) + flip `via` assertions `'diverse'`→`'top-hits'`.
- Framework already installed — no install step.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-device YT `<audio>` playback of a related stub (background/lock-screen) | UPNEXT-YT-02 | Sandbox has no real device; iOS/Android background-audio quirks not reproducible in Vitest | On device: play 摩四老年《港耆》 with up-next mode = similar → confirm up-next fills with related HK-indie tracks and advances/plays (carry-over Phase-27 device UAT) |
| End-to-end related-queue for 港耆 against LIVE YouTube | UPNEXT-YT-01 | Depends on live InnerTube (fixture covers parse; live call is env-dependent) | Dev server: GET `/api/ytmusic/related?videoId=dUlAfTZkjpE` → 50 related rows |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
