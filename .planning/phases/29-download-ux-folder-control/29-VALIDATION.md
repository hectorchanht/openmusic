---
phase: 29
slug: download-ux-folder-control
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-23
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `29-RESEARCH.md` → Validation Architecture.
> **Load-bearing caveat:** the highest-severity requirement (DL-FOLDER-01 MediaStore collection swap) is exactly the one unit tests CANNOT catch — `blob-store.test.ts` mocks `MediaStoreSaver`, so a wrong collection still passes in Vitest. **Device UAT is mandatory, not optional, for this phase.**

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.3` (single node/server project, no jsdom) |
| **Config file** | `vite.config.ts` (test project) — run via `pnpm test` |
| **Quick run command** | `pnpm test -- download-filename library blob-store` |
| **Full suite command** | `pnpm test` (`vitest --run`) then `pnpm check` (svelte-check) |
| **Estimated runtime** | ~30–90 seconds full suite |

---

## Sampling Rate

- **After every task commit:** `pnpm test -- <scope>` for the touched service/store (< 5s).
- **After every plan wave:** `pnpm test && pnpm check` (full node suite + typecheck).
- **Phase gate:** full suite green + **device UAT sign-off** for DL-FOLDER-01 / DL-MIGRATE-01 before `/gsd:verify-work`.
- **Max feedback latency:** ~90 seconds (automated); device UAT is out-of-band.

---

## Per-Requirement Verification Map

> Task IDs assigned by the planner; rows are requirement-level until PLAN.md is written.

| Requirement | Wave | Expected Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|------|-------------------|-----------|-------------------|-------------|--------|
| DL-FILE-01 | 0/1 | `buildDownloadFilename` — translated names, raw fallback, sanitize (`/\?%*:\|"<>`), each ext, default mp3 | unit (pure) | `pnpm test -- download-filename` | ❌ new `download-filename.test.ts` (W0) | ⬜ pending |
| DL-FILE-01 | 0/1 | `extFromAudioUrl` — query-stripped, case-insensitive, unknown→mp3 | unit (pure) | `pnpm test -- download-filename` | ❌ (same file, W0) | ⬜ pending |
| DL-FILE-01 | 1 | native `put(uid, blob, filename)` passes filename to `saveToDownloads` (mocked) | unit | `pnpm test -- blob-store` | ✅ extend `blob-store.test.ts` | ⬜ pending |
| DL-STATE-01 | 0/1 | `library.downloading` begin→has→end transitions; reassign stays reactive; isolated from player | unit | `pnpm test -- library` | ✅ extend `library.svelte.test.ts` | ⬜ pending |
| DL-BUG-01 | 0/1 | download catch path calls `toast.show`, does NOT call `window.open` (extract catch decision to a spy-able seam) | unit (spy) | `pnpm test -- TrackMenu` (mock fetch reject) | ❌ testable seam (W0) | ⬜ pending |
| DL-MIGRATE-01 | 1 | migrate orchestration: idempotent skip when URI already Downloads; copy+delete+remap on Audio URI; "Moved N of M" count | unit | `pnpm test -- blob-store` (mock save/delete/localStorage) | ✅ extend `blob-store.test.ts` | ⬜ pending |
| DL-RESILIENCE-01 | all | per-uid failure → sentinel, loop continues, other uids still migrate; never rejects; download never mutates player state | unit | `pnpm test -- blob-store` (one save rejects) | ✅ extend `blob-store.test.ts` | ⬜ pending |
| i18n | 0/1 | `menu.downloaded` + migration keys present in ALL 16 locales; double quotes | unit | `pnpm test -- i18n` | ✅ `i18n.test.ts` self-enforces parity | ⬜ pending |
| DL-FOLDER-01 | — | Kotlin collection = **MediaStore.Downloads**, path = `Download/openmusic/`, filename = `{artist} - {song}.ext` | **device-only UAT** | manual: build APK → download → file manager shows `Download/openmusic/…` | N/A (no JVM test infra) | ⬜ pending |
| DL-MIGRATE-01 | — | migration relocates real files on device; old `Music/OpenMusic/` emptied; files still play; idempotent on 2nd tap; partial-failure reports N<M without crash | **device-only UAT** | manual (see checklist) | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/services/download-filename.ts` + `download-filename.test.ts` — DL-FILE-01 (translated/raw/sanitize/ext/default cases).
- [ ] Extend `src/lib/stores/library.svelte.test.ts` — `downloading` Set begin/has/end transitions (DL-STATE-01).
- [ ] Extend `src/lib/services/blob-store.test.ts` — filename plumbing to `saveToDownloads`; migration idempotency; per-uid never-throw (DL-MIGRATE-01 / DL-RESILIENCE-01).
- [ ] Testable seam for the download catch (DL-BUG-01) — extract the save-fallback decision to a spy-able unit OR a component test asserting `window.open` is not called on fetch-reject.
- [ ] Add `menu.downloaded` + migration keys to all 16 locale files (`i18n.test.ts` fails until done — self-enforcing gate).
- Framework already installed — no install step.

---

## Manual-Only Verifications (Device UAT — MANDATORY)

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| New download lands in `Download/openmusic/` with human filename | DL-FOLDER-01 | `blob-store.test.ts` mocks `MediaStoreSaver`; the `IllegalArgumentException` for a wrong collection only fires against the real Android MediaProvider | Build APK → download a song → file manager shows `Download/openmusic/{artist} - {song}.ext`. Verify on an **API 29+** device AND an **API ≤28** device/emulator. |
| Migration moves old files + still plays | DL-MIGRATE-01 | Real filesystem move, real MediaStore | Pre-migration downloads present → tap Settings→Data migrate → old `Music/OpenMusic/` emptied, files now under `Download/openmusic/`, playback still works. |
| Migration idempotent + partial-failure safe | DL-MIGRATE-01 / DL-RESILIENCE-01 | Device-only state | Tap migrate a 2nd time = no-op. Revoke a permission / delete an app-private source → no crash, reports N<M. |
| Web anchor save (no play page) on iOS Safari | DL-BUG-01 | iOS Safari `a.download` + `blob:` behavior (research A1, MEDIUM) | On iOS Safari + Android Chrome: download → file saves, no media page opens. |

---

## Validation Sign-Off

- [ ] All automatable requirements have a unit/spy test or a Wave 0 dependency.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify.
- [ ] Wave 0 covers all MISSING references.
- [ ] No watch-mode flags.
- [ ] Feedback latency < 90s (automated).
- [ ] Device UAT checklist executed + signed off (DL-FOLDER-01 / DL-MIGRATE-01).
- [ ] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
