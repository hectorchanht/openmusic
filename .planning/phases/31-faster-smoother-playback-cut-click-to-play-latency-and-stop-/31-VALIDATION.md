---
phase: 31
slug: faster-smoother-playback-cut-click-to-play-latency-and-stop
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-09
---

# Phase 31 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `31-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.3` (resolves 4.1.8) |
| **Config file** | `vite.config.ts` — a SINGLE project named `server`, `environment: 'node'`. **No jsdom project exists.** |
| **Include glob** | `src/**/*.{test,spec}.{js,ts}` (covers `*.svelte.test.ts` — the SvelteKit Vite plugin transforms runes for node) |
| **Quick run command** | `npx vitest --run src/lib/stores/player.svelte.test.ts` |
| **Full suite command** | `pnpm test` |
| **Type gate** | `pnpm check` (`svelte-kit sync && svelte-check`) — the only lint |
| **Estimated runtime** | ~1.8s quick (197 tests) · ~full suite 90 files |

**Harness trap:** `expect: { requireAssertions: true }` — a test with zero assertions FAILS.

---

## Sampling Rate

- **After every task commit:** `npx vitest --run src/lib/stores/player.svelte.test.ts` (~1.8s) — the file owning ~90% of this phase's blast radius.
- **After every plan wave:** `pnpm test && pnpm check`
- **Before `/gsd:verify-work`:** full suite green + `pnpm check` clean + the manual checks below
- **Max feedback latency:** ~2 seconds (quick), well inside the Nyquist bound

---

## Per-Task Verification Map

| Decision | Behavior | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|
| D-03 | Pre-warm fires ONCE per top-result uid, routes through `apiFetch`, never fires on scroll | unit | `npx vitest --run src/lib/stores/player.svelte.test.ts -t "pre-warm"` | ❌ W0 | ⬜ pending |
| D-03 | Pre-warm on longpress/menu-open dedupes against an in-flight resolve | unit | same | ❌ W0 | ⬜ pending |
| D-06/D-07 | Cache MISS → resolve → `cache.put` on own-origin key; identical 2nd request = HIT, ZERO upstream calls | unit | `npx vitest --run src/routes/api/resolve/resolve-endpoint.test.ts` | ❌ W0 | ⬜ pending |
| D-06(c) | A clean "source is dry" negative IS cached; an upstream ERROR writes nothing | unit | same | ❌ W0 | ⬜ pending |
| D-08 | Cache read returns `null` on 404 / 500 / malformed JSON / abort / breaker-open; `ensureTrackDetails` still resolves | unit | `npx vitest --run src/lib/services/catalog.test.ts` | ⚠️ exists | ⬜ pending |
| D-09 | POST report → `cache.delete(key)` with the SAME key the GET wrote | unit | resolve-endpoint.test.ts | ❌ W0 | ⬜ pending |
| D-09 | Client reports ONLY when the failing src came from a cache hit | unit | `-t "cache bust"` | ❌ W0 | ⬜ pending |
| D-11 | Cache-hit URL 403s → report + fall through to client resolver + keep playing (**primary path**) | unit | same | ❌ W0 | ⬜ pending |
| D-12 | Corrupt blob → `blobStore.del` AND `library.removeDownload`, network re-resolve, ONE background re-download | unit | `-t "corrupt blob"` | ❌ W0 | ⬜ pending |
| D-12 | A **prebuffer** blob error does NOT evict a download record | unit | same | ❌ W0 | ⬜ pending |
| D-13 | A 0-byte blob is rejected at read time on ALL THREE read sites (`restore`, `reresolveCurrent`, `play`) | unit | same + `blob-store.test.ts` | ⚠️ exists | ⬜ pending |
| D-14 | Exactly ONE toast + one `logAction` entry per corruption event | unit | `-t "corrupt blob"` | ❌ W0 | ⬜ pending |
| D-15 | A next-track definitive failure calls `tryFallback` BEFORE `strikeUnplayable` promotes to dead | unit | `-t "cross-source"` | ❌ W0 | ⬜ pending |
| D-16 | Raised `STRIKE_CAP`: a uid survives N-1 strikes without entering `unplayableUids` | unit | `-t "strike"` | ⚠️ exists | ⬜ pending |
| D-16 | An `online` / foreground return clears strikes WITHOUT issuing `play()` | unit | `-t "strike"` | ❌ W0 | ⬜ pending |
| **D-17** | **REGRESSION:** `SYSTEMIC_SKIP_CAP` still trips `haltRunawayRecovery` at 5 consecutive no-`playing` skips | unit | `-t "SYSTEMIC"` | ⚠️ exists — **must pass UNMODIFIED** | ⬜ pending |
| **D-17** | **REGRESSION:** rapid-error storm suite + redrive-brake suite pass unmodified | unit | `npx vitest --run src/lib/stores/player.svelte.test.ts` | ✅ exists | ⬜ pending |
| **D-17** | **REGRESSION:** `api-base` governor + circuit-breaker suite passes; new callers do not bypass it | unit | `npx vitest --run src/lib/services/api-base.test.ts` | ✅ exists | ⬜ pending |
| D-18 | Every skip path emits a batched notice; N skips in 2500ms = ONE notice with `count: N` | unit | `-t "skip"` | ⚠️ partial | ⬜ pending |
| C-05 | All 15 i18n dictionaries expose the new toast keys | unit | `npx vitest --run src/lib/i18n/i18n.test.ts` | ✅ parity guard | ⬜ pending |
| — | Type gate | typecheck | `pnpm check` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/routes/api/resolve/resolve-endpoint.test.ts` — NEW file. Copy `stubCache()` + `fakeEvent()` from `src/routes/api/og/og-endpoint.test.ts:746-778`; **add a `delete` spy** to `stubCache` and `ctx: { waitUntil }` to `fakeEvent`. Covers D-06, D-07, D-09.
- [ ] New describe blocks in `src/lib/stores/player.svelte.test.ts`: corrupt-blob recovery (D-12/13/14), cross-source retry-before-skip (D-15), strike clearing on recovery (D-16), cache-bust reporting (D-09/D-11), pre-warm dedupe (D-03).
- [ ] **Update the hand-mirrored `Player_*` constants** in `player.svelte.test.ts` when D-16 changes `STRIKE_CAP`. There is **no compiler check** that the mirror agrees with the source — silent drift is the trap.
- [ ] New cases in `src/lib/services/catalog.test.ts` for the cache-first read's never-throw sentinel (D-08).
- [ ] Framework install: **none needed.**

---

## Manual-Only Verifications

| Behavior | Decision | Why Manual | Test Instructions |
|---|---|---|---|
| Real Cache API hit/miss/`delete`, PoP scoping, `put` throwing on `Vary: *` / 206 | D-07, D-09 | `edgeCache()` is `null` under `vite dev`; unit tests exercise an in-memory Map, not workerd | `pnpm preview` (Miniflare 3) for hit/miss; production `curl` warm-vs-cold timing on byte-identical responses (the `/api/og` method — `cf-cache-status` is a DEFECTIVE criterion for a Worker-level `caches.default` hit, it always reads DYNAMIC) |
| Actual click-to-play latency improvement — **the phase's whole point** | D-01…D-05 | No timing harness; `apiFetch` is mocked in every unit test | Spike-003 method: wrap `window.fetch`, reset `window.__net = []` at the click boundary, count + categorize. Cross-check with Activity log timestamps `play` → `resolve.ok` → `playing`. |
| iOS Safari / Android Chrome background playback, lock screen, autoplay policy | D-12, D-15, D-16 | No jsdom, no device runner | On-device only. Project history is explicit that background-audio bugs are device-only reproducible and the Activity log is the diagnostic channel. |
| Whether the raised `STRIKE_CAP` feels better on a flaky connection | D-16 | Subjective + network-dependent | Manual on a real degraded network |
| That a globally-shared audio URL 403s for another user (D-11's premise) | D-11 | Needs two clients in different regions | Manual, or accept — the *handling* is unit-testable even though the *trigger* is not |
| Toast visual behaviour / batching feel | D-14, D-18 | No component test project | Manual |

---

## Validation Sign-Off

- [ ] All tasks have an automated verify command or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all ❌ references above
- [ ] No watch-mode flags (`--run` everywhere)
- [ ] Feedback latency < 5s
- [ ] The three D-17 regression suites pass **unmodified** — editing them to accommodate D-15/D-16 is a phase failure, not a fix
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
