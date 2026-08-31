---
phase: 32
slug: qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-31
---

# Phase 32 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> **The authoritative per-requirement test map lives in `32-RESEARCH.md` § "Validation Architecture"**
> (D-01..D-17 → behavior → command → exists/Wave-0). It is not duplicated here; this file carries the
> infrastructure contract, the sampling rate, and the gates that are specific to this phase.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.3` — single `node` project, no jsdom |
| **Config file** | `vite.config.ts` → `test.projects[0]`, `include: ['src/**/*.{test,spec}.{js,ts}']` |
| **Quick run command** | `pnpm vitest --run src/lib/sources/qq.test.ts src/lib/sources/quality.test.ts src/lib/services/api-base.test.ts` |
| **Full suite command** | `pnpm test && pnpm check` |
| **Estimated runtime** | quick ~5s, full ~40s |

`expect: { requireAssertions: true }` — every new `it()` MUST contain at least one `expect`, or the
suite fails. Second gate is `pnpm check` (`svelte-kit sync && svelte-check`): **treat a type error as a
test failure**, it is the only other quality gate in this repo (no eslint/prettier/biome).

---

## Sampling Rate

- **After every task commit:** quick run command above
- **After every plan wave:** `pnpm test && pnpm check`
- **Before `/gsd:verify-work`:** full suite green, 0/0 on `pnpm check`
- **Max feedback latency:** ~40 seconds

---

## Per-Task Verification Map

See `32-RESEARCH.md` § "Validation Architecture" → "Phase Requirements → Test Map". Every row there
carries: Req ID (D-NN) · behavior · test type · automated command · whether the test file already
exists or is a Wave-0 gap. 11 Wave-0 gaps are enumerated there with commands.

---

## Phase-Specific Gates

These are the checks that generic test/typecheck coverage does NOT catch. Each one corresponds to a
finding in `32-RESEARCH.md` where the obvious verification gives a FALSE PASS.

| # | Gate | Why generic tests miss it |
|---|------|---------------------------|
| 1 | **`D-05` needs the fixture changed FIRST.** `src/lib/sources/__fixtures__/qq.detail.json` is already `https://`, so an https-upgrade test against it passes without the upgrade existing. Wave 0 must make the fixture `http://`, or D-05 ships untested. | A green test proves nothing when the fixture already satisfies the assertion. |
| 2 | **`D-02` must be verified on kuwo and joox, not just qq.** `'auto'` is read by three adapters (`qq.ts`, `kuwo.ts`, `joox.ts`) plus `quality.ts`. Changing the default and touching only qq silently sends kuwo and joox to lossless on cellular. | qq tests pass; the regression is in the two adapters nobody edited. |
| 3 | **`D-10` cannot be verified under `pnpm dev`.** `edgeCache()` returns `null` when `caches` is undefined, so every cache path silently no-ops in the Vite dev server. Verify with `pnpm preview` (`wrangler pages dev`) or against the deployed URL. | Dev-server verification returns "works" for code that never ran. |
| 4 | **`D-10` requires `RESOLVE_CACHE_VERSION` `'1'` → `'2'`.** `cache.delete` is PoP-local, so a stored-shape change can only be handled by a key change. There is no remediation after deploy. | Nothing fails; old-shape entries are served to real users forever. |
| 5 | **`D-10` negative-entry TTL** (see Decisions At Risk #1). Assert that a `DRY`/negative entry does NOT get the 1-year `max-age` while a positive one does. Highest-value new test in the phase. | A permanent false negative pins a song to a lossy source for every user in the PoP, silently and unrepairably. |
| 6 | **`D-13` requires an APK rebuild.** A pre-guard APK `TypeError`s on the direct call — on Android, the one platform that actually reports `NetworkInformation.type`. | Web build is green; the native target is broken. |
| 7 | **`D-15` ceiling must admit every lossy tier and reject FLAC.** Measured: FLAC is 959–1647 kbps / ~12MB per minute (a 52.8MB song), NOT the 933kbps / 7MB-per-min in the original note. Research recommends a **24 MB** ceiling. | A ceiling picked from the stale 7MB/min figure would prebuffer FLAC anyway. |
| 8 | **Three freeze classes must not regress.** `nowbar-freeze-reresolve-loop`, `api-fetch-flood-freeze`, `restore-effect-self-invalidation-loop`. D-13 routes a new host through the shared circuit breaker and D-15 changes prebuffer behavior — both touch the machinery those fixes installed. | Unit tests do not exercise churn; this needs the Activity log (Settings → Activity log) on a real device. |

---

## Human-Verify Checkpoints

Cannot be automated in this sandbox — flag as `checkpoint:human-verify`:

- **Real-world tang RTT from a mobile client on the target network.** The 2.0–3.8s measurements are a US
  sandbox → CN hosts. This decides whether the ROADMAP's "tap→audio under a second" is reachable at all.
  **Measure this EARLY, not at verification** — it can invalidate the phase's headline goal.
- **iOS Safari FLAC playback.** Unverified that iOS decodes the QQ FLAC stream at all. If it does not,
  D-03's "iOS gets 320" accidentally becomes load-bearing rather than a data-cost choice.
- **`accom` = 伴奏 (instrumental/accompaniment).** Inference, not confirmed. The `.ogg`-does-not-decode-
  on-iOS half is confirmed and is sufficient justification on its own.
- **Android lock-screen advance under D-15's ceiling** — the `bg-lockscreen-stall-noskip` case the
  prebuffer exists to fix, on a real locked device.
