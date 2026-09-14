---
phase: 35
slug: one-click-export-and-import-of-all-app-data
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-09-13
---

# Phase 35 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `35-RESEARCH.md` §Validation Architecture. Task IDs mapped to plans 35-01..35-06 after planning.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.3` — ONE project: `{ name: 'server', environment: 'node' }`, no jsdom |
| **Config file** | `vite.config.ts` (`test.projects[0]`); `expect.requireAssertions: true` |
| **Quick run command** | `npx vitest run src/lib/backup/ src/lib/services/backup-io` |
| **Full suite command** | `pnpm test` (`vitest --run`, ~1320 tests / ~67 files) |
| **Typecheck gate** | `pnpm check` (`svelte-kit sync && svelte-check`) — the project's only linter |
| **Estimated runtime** | quick ~2s · full ~30s |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/lib/backup/` + `pnpm check`
- **After every plan wave:** `pnpm test`
- **Before `/gsd:verify-work`:** full suite green + `pnpm check` clean + the three device checkpoints signed off
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

No `REQ-` IDs are assigned in ROADMAP.md for this phase, so behaviours map to the CONTEXT.md decision refs (`D-01`…`D-18`), which are the phase's actual requirements. Plan/Wave/Task-ID columns map to the six plans written for this phase.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 35-01-01 | 01 | 1 | D-01 | — | Envelope carries exactly the 5 key families; `name-tr` **prefix family** fully enumerated (a single `getItem` silently ships an empty cache) | unit | `npx vitest run src/lib/backup/backup-logic.test.ts -t "envelope"` | ❌ W0 | ⬜ pending |
| 35-01-01 | 01 | 1 | D-02 | — | `openmusic:player:v1` never appears in an envelope; nor does `openmusic:diag:v1` | unit | `… -t "never exports"` | ❌ W0 | ⬜ pending |
| 35-01-01 | 01 | 1 | D-03 | — | Envelope has `app` + `format` + per-key names; `JSON.stringify(env, null, 2)` round-trips | unit | `… -t "envelope shape"` | ❌ W0 | ⬜ pending |
| 35-01-01 | 01 | 1 | D-04 | — | Filename is `openmusic-backup-YYYY-MM-DD.json` | unit | `… -t "filename"` | ❌ W0 | ⬜ pending |
| 35-01-03 | 01 | 1 | D-08 / D-13 | — | Round-trip: write keys → `vi.resetModules()` → re-import stores → `load()` → identical state | integration (node) | `npx vitest run src/lib/backup/backup-roundtrip.svelte.test.ts` | ❌ W0 | ⬜ pending |
| 35-01-02 | 01 | 1 | D-10 | T-35-01 | A rejected envelope writes **nothing** — memStore byte-for-byte unchanged | unit | `… -t "atomic"` | ❌ W0 | ⬜ pending |
| 35-01-01 | 01 | 1 | D-11 | — | `not-ours` / `newer` / `damaged` each returned for the right input, in the right **precedence order** | unit | `… -t "reject reason"` | ❌ W0 | ⬜ pending |
| 35-01-01 | 01 | 1 | D-12 | — | Unknown key in a known domain → `skipped`, rest imported; unknown domain → skipped silently | unit | `… -t "migration"` | ❌ W0 | ⬜ pending |
| 35-01-01 | 01 | 1 | D-10 (Pitfall 7) | T-35-02 | `{"liked": 5}` is rejected as `damaged`, not written — shape guard, not just `typeof object` | unit | `… -t "array guard"` | ❌ W0 | ⬜ pending |
| 35-01-02 | 01 | 1 | D-09 | — | Snapshot taken before write; undo restores the pre-import state | unit (sessionStorage stub) | `… -t "undo"` | ❌ W0 | ⬜ pending |
| 35-03-03 | 03 | 1 | D-06 / D-07 | T-35-03 | Sweep skips uids where `blobStore.has()` is true; **sequential, no overlap**; stop flag honoured | unit (mock `blobStore` / `downloadTrack`) | `npx vitest run src/lib/backup/sweep.test.ts` | ❌ W0 | ⬜ pending |
| 35-02-02 | 02 | 1 | D-11 (i18n) | — | All **15** locale dictionaries expose the new keys (key-set parity) | unit | `npx vitest run src/lib/i18n/i18n.test.ts` | ✅ exists (`i18n.test.ts:52`) | ⬜ pending |
| 35-03-02 | 03 | 1 | D-14 | — | Web export calls `saveBlobToDisk` with the right filename + MIME | unit (fake `doc`) | `npx vitest run src/lib/services/backup-io` | ❌ W0 | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `src/lib/backup/backup-logic.ts` + `backup-logic.test.ts` — D-01…D-04, D-10…D-12, Pitfall 7
- [ ] `src/lib/backup/backup-roundtrip.svelte.test.ts` — D-08/D-13 round-trip. **Separate file** because it needs the `browser: true` + memStore harness (precedent: `settings-persist.svelte.test.ts:4-8`)
- [ ] `src/lib/backup/sweep.test.ts` — D-06/D-07 sequencing + stop flag
- [ ] `src/lib/services/backup-io.test.ts` — D-14 web branch with an injected fake `doc`
- [ ] A **`sessionStorage` stub** — copy the existing localStorage stub verbatim (identical `Storage` interface). New: `grep -rn "sessionStorage" src/` returns nothing today.
- [ ] No framework install needed — Vitest, the node project, and the localStorage-stub idiom all already exist.

---

## Manual-Only Verifications

Three device-only checkpoints. Recipe in `35-RESEARCH.md` §Answer 6 (emulator `Pixel_3a_API_34` + CDP). APK build needs `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| File input opens the Android document picker and `.json` is selectable | D-15 (plan 35-05, task 2, wave 3) | WebView `onShowFileChooser` behaviour cannot be asserted from node. **Use `accept="application/json,.json"`** — a bare `accept=".json"` can hit an unguarded `validTypes[0]` in `BridgeWebChromeClient:379` | Build APK → Settings → Data → Import → picker opens → a `.json` file is selectable and its contents reach the app |
| Share sheet opens on the APK; the shared file is readable JSON; dismissing is not an error | D-16 / D-17 (plan 35-05, task 3, wave 3) | `@capacitor/share` + FileProvider is native-only | Settings → Data → Export → share sheet appears → send to Files/Drive → open the result and confirm it parses. Then repeat and **dismiss** the sheet — must not surface an error |
| Export downloads on a real iPhone | D-14 (plan 35-06, task 2, wave 3) | iOS Safari `<a download>` / `URL.createObjectURL` behaviour is device-specific (research confidence LOW–MEDIUM here) | Open the PWA on a real iPhone → Settings → Data → Export → confirm the file is saved/openable |

---

## Open Risks Carried From Research

- **`sessionStorage` survival across `location.reload()` in the Capacitor WebView** is a standards expectation, unverified on this stack. Probe it (5-line recipe in research) **before** building the D-09 Undo task. Fallback: localStorage + a size pre-check.
- **Quota:** the five live keys measure ~740 KB of a ~5 MB origin budget already shared with the cover cache and the `lyrics-tr:v3:*` family, and `library.save()`'s quota catch is **silent**. This is why the rollback snapshot must not go in localStorage.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers all MISSING references — wave 1 (plans 35-01/02/03) builds every test file before wave 2 consumes it
- [x] No watch-mode flags (`vitest run`, never `vitest`)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-13 — mapped to plans 35-01..35-06
