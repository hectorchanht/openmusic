---
phase: 34
slug: import-device-songs-as-native-downloads
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-13
---

# Phase 34 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `34-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.3 — single `server` project, `environment: 'node'`, **no jsdom** |
| **Config file** | `vite.config.ts:6-22` (`expect.requireAssertions: true` — every test MUST assert) |
| **Quick run command** | `pnpm vitest --run <file>` |
| **Full suite command** | `pnpm test` (≈1320 tests) |
| **Type gate** | `pnpm check` (`svelte-kit sync && svelte-check`) — the only linter in the project |
| **Estimated runtime** | quick ~2-5s per file; full suite ~60s |
| **New dependencies** | **none** — existing infrastructure covers the whole phase |

---

## Sampling Rate

- **After every task commit:** the relevant single-file `pnpm vitest --run <file>` + `pnpm check`
- **After every plan wave:** `pnpm test`
- **Before `/gsd:verify-work`:** `pnpm test` green + `pnpm check` clean + the device UAT matrix below
- **Max feedback latency:** ~5 seconds (single-file run)

---

## Per-Task Verification Map

| Decision | Behaviour | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|
| D-12/D-13/D-16 | `{artist} - {title}` preset parses; other presets; strip-track-number; strip-brackets; untagged → filename title | unit (pure) | `pnpm vitest --run src/lib/services/device-filename.test.ts` | ❌ W0 | ⬜ pending |
| D-12 regex hatch | invalid pattern rejected; missing named group rejected; slow pattern rejected within budget | unit (pure) | `pnpm vitest --run src/lib/services/device-filename.test.ts` | ❌ W0 | ⬜ pending |
| D-15 | MediaStore tag wins over a filename that would parse differently; empty tag falls back to filename | unit (pure) | `pnpm vitest --run src/lib/services/device-track.test.ts` | ❌ W0 | ⬜ pending |
| D-01/D-02 | uid shape `device:<volume>-<id>`; `isDeviceUid` round-trip; content-URI reconstruction | unit (pure) | `pnpm vitest --run src/lib/services/device-track.test.ts` | ❌ W0 | ⬜ pending |
| D-07/D-08 | re-sync diff: new added, missing dropped, **transient failure NOT treated as gone** | unit (pure) | `pnpm vitest --run src/lib/services/device-import.test.ts` | ❌ W0 | ⬜ pending |
| D-09/D-10 | `Music/OpenMusic/` row merges onto an existing real-source uid, does NOT create a 2nd entry, does NOT churn cover/album | unit (pure) | `pnpm vitest --run src/lib/services/device-import.test.ts` | ❌ W0 | ⬜ pending |
| D-11 | rows outside Music/Download are filtered out | unit (pure) | `pnpm vitest --run src/lib/services/device-import.test.ts` | ❌ W0 | ⬜ pending |
| D-12 filters | min-duration floor and extension allowlist honoured | unit (pure) | `pnpm vitest --run src/lib/services/device-import.test.ts` | ❌ W0 | ⬜ pending |
| D-14 | defaults produce a working import with zero configuration | unit (pure) | `pnpm vitest --run src/lib/services/device-import.test.ts` | ❌ W0 | ⬜ pending |
| D-05 | `blobStore.get('device:…')` reads via `convertFileSrc` + fetch, returns a re-typed Blob; fetch failure → `null` (never throws) | unit (mocked Capacitor) | `pnpm vitest --run src/lib/services/blob-store.test.ts` | ✅ extend | ⬜ pending |
| **Pitfall 1 (data loss)** | `blobStore.del('device:…')` **never** calls `deleteFromMusic` | unit (mocked) | `pnpm vitest --run src/lib/services/blob-store.test.ts` | ✅ extend | ⬜ pending |
| Bite #4 | `blobStore.has('device:…')` is truthful (true when readable, false when gone) | unit (mocked) | `pnpm vitest --run src/lib/services/blob-store.test.ts` | ✅ extend | ⬜ pending |
| Bite #1 | `ensureTrackDetails` on a device track returns it untouched and never touches `SOURCES` | unit | `pnpm vitest --run src/lib/services/catalog.test.ts` | ✅ extend | ⬜ pending |
| D-06 | `library.removeDownload` on a device uid keeps the entry listed and marks it unavailable | unit | `pnpm vitest --run src/lib/stores/library.svelte.test.ts` | ✅ exists | ⬜ pending |
| i18n | new keys present and identical across all 16 locales | unit | `pnpm vitest --run src/lib/i18n/i18n.test.ts` | ✅ exists | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `src/lib/services/device-filename.test.ts` — filename parsing presets + regex-hatch guards
- [ ] `src/lib/services/device-track.test.ts` — uid shape, tag-vs-filename precedence, content-URI reconstruction
- [ ] `src/lib/services/device-import.test.ts` — scan filtering, re-sync diff, merge rule, defaults
- [ ] Extend `src/lib/services/blob-store.test.ts` mock: `convertFileSrc` must handle `content://` (`content:/` → `/_capacitor_content_`); add a `scanAudio` mock to the `./media-store` factory
- [ ] Framework install: **none needed**

**Established Capacitor-boundary mocking pattern — copy it, do not invent one.**
`src/lib/services/blob-store.test.ts:19-70` already covers everything this phase needs:
`vi.mock('$app/environment')`, `vi.mock('@capacitor/core')` with `isNativePlatform` + `convertFileSrc`,
`vi.mock('@capacitor/filesystem')`, `vi.mock('./media-store')`, plus the `installLocalStorageShim` helper
in the same file. A stubbed `global.fetch` returning a sized `Blob` completes the device-read test with
**zero** device involvement.

---

## Manual-Only Verifications (device UAT)

Every row is a `checkpoint:human-verify` task, **not** an optional follow-up. This project has a
documented sandbox-green / device-broken history.

| # | Behaviour | Why Manual | Failure mode if skipped |
|---|---|---|---|
| 1 | Permission dialog appears; grant → scan works; deny → sentinel, no crash; permanent-deny → honest message | Real Android permission subsystem | Feature does nothing on a real phone |
| 2 | Cursor returns rows from `Music/` **and** `Download/` | Real MediaProvider + real permission model | **D-11's Download half may be undeliverable** — see Open Question 1 |
| 3 | An imported track plays end to end via the `content://` path | Real WebViewLocalServer | The whole phase is non-functional |
| 4 | **Seek** works mid-track on an imported file | Real Range handling (Capacitor's is broken — Pitfall 2) | Silent corruption on scrub |
| 5 | A large (>100 MB) lossless file plays without OOM | Real device memory | Crash on a subset of users' libraries |
| 6 | Scan of a realistic library (1000+ files) completes, progress advances, UI doesn't jank | Real bridge + real row count | Import appears hung |
| 7 | **Removing an imported song does NOT delete the file** | Real MediaStore delete | **Irreversible user data loss** |
| 8 | First import does not duplicate existing downloads (D-09) | Real `Music/OpenMusic/` contents | Library doubles |
| 9 | Delete a file outside the app → entry shows unavailable, NOT removed (D-06); next import drops it (D-07/D-08) | Real filesystem | D-06 silently violated |
| 10 | Lock-screen / media-session metadata correct for a device track | Real media session | Cosmetic but visible |

**Ordering constraint: verify item 7 BEFORE item 3.** A shipped data-loss bug is not recoverable;
a playback bug is.

**Coverage:** the existing `Pixel_3a_API_34` emulator + CDP (per project memory `apk-debug-via-emulator-cdp`)
covers 1-4, 6, 8, 9. Items 5 and 10 want a real phone. Item 2's negative case may be OEM-specific.

---

## Validation Sign-Off

- [ ] All tasks have an `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`pnpm test` is `vitest --run`; never `test:unit`)
- [ ] Feedback latency < 5s for single-file runs
- [ ] Device UAT matrix items 1-10 scheduled as `checkpoint:human-verify` tasks, with 7 before 3
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
