---
phase: 35-one-click-export-and-import-of-all-app-data
plan: 04
subsystem: settings-ui
tags: [backup, settings, import-export, file-input, sweep, runes]
requires:
  - "$lib/backup/backup-logic: buildEnvelope / serializeEnvelope / storageKeys / backupFilename / validateEnvelope / applyEnvelope / undoImport / hasUndoSnapshot (plan 01)"
  - "$lib/services/backup-io: exportBackup (plan 03)"
  - "$lib/backup/sweep: findMissing / sweepMissing (plan 03)"
  - "22 backup.* i18n keys in all 15 dictionaries (plan 02)"
  - "$lib/services/blob-store: blobStore.has; $lib/services/download-track: downloadTrack"
provides:
  - "Settings → Data: Export, Import (+ hidden file input), Undo last import (conditional), Re-download missing (N) / Stop"
  - "The user-facing surface for every 35-D-05..D-18 behaviour"
affects:
  - "plan 05 device checkpoint (native picker + share sheet + Undo-after-reload on the APK)"
  - "plan 06 device checkpoint (iOS export inside the tap gesture)"
tech-stack:
  added: []
  patterns:
    - "thin caller: page holds zero validation and zero platform branching"
    - "hidden <input type=file> + bind:this, value reset on every pick so the same file re-fires change"
    - "plain (non-$state) AbortController field for a guard the UI never reads reactively"
    - "destructive action behind the page's existing confirm() idiom"
key-files:
  created: []
  modified:
    - src/routes/(app)/settings/data/+page.svelte
decisions:
  - "The D-09 comment says 'survives the full 35-D-13 reload' rather than naming location.reload() — the plan's prose asked for the literal while its own acceptance grep required exactly 2 occurrences (the two real call sites). Third instance of the known plan defect; grep honoured, intent preserved."
  - "The D-06 comment says 'the album bulk mode that skips blobStore.put' instead of naming that option literally, and does not repeat the silent-repair option literally either — the acceptance greps require exactly 1 and exactly 0 occurrences of those two literals. Same defect class."
  - "onPicked reads the File off the bound `fileInput` instead of casting `e.currentTarget` — same behaviour, zero casts (CLAUDE.md prefers no casts; no acceptance criterion mandated the cast)."
  - "`sweepDone` is rendered as `(done/total)` beside the Stop label rather than left write-only — an unread $state field would be dead weight, and a minutes-long sequential job needs feedback. Numeric only, so no new i18n key."
  - "`counts` is also refreshed in the sweep's finally block (downloadTrack calls library.addDownload), so the header line cannot go stale after a run."
metrics:
  duration: ~25 min
  completed: 2026-09-13
  tasks: 2
  files-modified: 1
---

# Phase 35 Plan 04: Settings → Data wiring Summary

Settings → Data now exports, imports, undoes and repairs: four new controls on the existing page, each a thin call into the wave-1 modules, with no validation, no platform branch and no hardcoded English added at the page layer.

## What was built

**Task 1 — Export / Import / Undo** (commit `efab2e5`)

- `exportNow()` builds the envelope synchronously in the click handler (`serializeEnvelope(buildEnvelope(…))` + `backupFilename(new Date())` inside one try/catch) and hands it straight to `exportBackup()`. There is no `await` anywhere in the function body, so the iOS gesture task cannot be lost to a later edit (D-14).
- `pickImport()` clicks a hidden `<input type="file" accept="application/json,.json" … hidden />`. The MIME leads the list deliberately; the comment above it explains the unguarded `validTypes[0]` index in `BridgeWebChromeClient.showFilePicker:379` without containing the dangerous literal.
- `onPicked()` reads the file text, resets the input value first so the same file re-fires `change`, then `validateEnvelope()`. A refusal flashes the matching D-11 message and returns having written nothing. An accepted file goes through `confirm(t('backup.importConfirm'))` (D-08), then `applyEnvelope(res.envelope, localStorage, sessionStorage)`; `no-snapshot` and `write-failed` get their own toasts, `ok` sets `canUndo`, flashes the plain or `{n}`-skipped variant, and schedules `location.reload()` at 600 ms (D-13).
- `undoNow()` confirms, calls `undoImport(localStorage, sessionStorage)`, reloads on `ok`, and drops the affordance otherwise.
- `canUndo` is read from `hasUndoSnapshot(sessionStorage)` in `onMount`, inside its own try/catch.

**Task 2 — Re-download missing (N) / Stop** (commit `55da03c`)

- `refreshMissing()` = `missing = await findMissing(library.downloads, blobStore.has)`; called at the end of `onMount` and in the sweep's `finally`.
- `redownloadMissing()` is the same button in both directions: while `sweeping` it aborts the controller and returns; otherwise it creates one `AbortController`, runs `sweepMissing(missing ?? library.downloads, { has, download: (tr) => downloadTrack(tr, { save: false }), signal, onProgress })`, flashes one `backup.sweepDone` summary, and in `finally` clears the flags, refreshes `counts` and re-probes `missing`.
- `sweepCtl` is a plain class-scope `let`, not `$state` — the house convention for a guard the UI never reads reactively.
- Button is `disabled` when not sweeping and the count is 0; label swaps to `Stop (done/total)` with `CircleStop` while running. One new CSS rule: `.item:disabled`.

## Verification — actually run

```
$ pnpm check
1789350244645 START "/Users/laichan/code/tung/openmusic"
1789350244657 COMPLETED 4517 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ pnpm test
 Test Files  121 passed (121)
      Tests  2233 passed (2233)
   Duration  9.00s

$ pnpm build
✓ built in 6.30s
> Using @sveltejs/adapter-cloudflare
  ✔ done
```

Acceptance greps, all observed:

```
accept-good: 1     accept-bad: 0      reload: 2
importConfirm: 1   notOurs: 1  newer: 1  damaged: 2
capacitor: 0       export-await: 0    clearAll: 1
save-false: 1      persist-false: 0   findMissing: 1
abortctl: 1        sweepCtl-state: 0  onPicked-sweep: 0
file lines: 225 (min_lines 140)
```

`damaged: 2` is the `>= 1 per key` criterion met twice on purpose — once for an unreadable `file.text()`, once for the validator's reason mapping.

## What was NOT verified here

- **No browser render check was performed.** The page typechecks and the production build succeeds, but nothing in this plan exercised the UI at runtime. `pnpm test` covers the wave-1 modules the page calls, not the page itself (no jsdom project exists).
- Everything device-shaped stays with plans 05/06 by design: the native document picker (D-15), the share sheet (D-16), whether `sessionStorage` survives the reload in the Capacitor WebView (D-09 / A4), the 600 ms pre-reload toast window, and the iOS gesture behaviour of `<a download>` (D-14). The `accept` value and the synchronous export exist precisely so those checkpoints have something correct to confirm.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Plan defect] Two comments rephrased to satisfy their own acceptance greps**

- **Found during:** Tasks 1 and 2.
- **Issue:** The third and fourth instances of the pattern already recorded in 35-01 and 35-03 — the plan's `<action>` prose asks for a comment containing a literal that its own `<acceptance_criteria>` grep requires to appear zero (or exactly N) times. Specifically: the D-09 comment was told to say "survives `location.reload()`" while `grep -c "location.reload()"` must print 2 (it printed 3 on first write, caught by the grep), and the D-06 comment was told to name both `{ save: false }` and `{ persist: false }` while the greps require exactly 1 and exactly 0 occurrences.
- **Fix:** Kept the greps authoritative and rewrote the prose to carry the same meaning without the literal — "survives the full 35-D-13 reload", "the album bulk mode that skips `blobStore.put`". No behaviour changed.
- **Files modified:** `src/routes/(app)/settings/data/+page.svelte`
- **Commits:** `efab2e5`, `55da03c`

**2. [Rule 2 - Correctness] `f.text()` wrapped in a catch**

- **Found during:** Task 1.
- **Issue:** The plan wrote a bare `await f.text()`. `File.text()` rejects on a `NotReadableError` (file moved or permission revoked between pick and read), which on this page would be an unhandled rejection in the render tree.
- **Fix:** `await f.text().catch(() => null)`, null flashes `backup.errDamaged`. Matches the never-throw posture of the modules below.
- **Commit:** `efab2e5`

### Simplifications

- `onPicked` takes no event argument and reads `fileInput?.files?.[0]` directly, avoiding the plan's `e.currentTarget as HTMLInputElement` cast. Behaviour is identical; the `bind:this` element is the same node that fired the event.
- `sweepDone` is displayed rather than left unread (see decisions above).

## Assumption Drift (advisory)

- **Planned:** the page would need `{#if sweeping}` only for the icon, with a static `t('backup.stop')` label. **Actual:** the Stop label also carries `(done/total)`. **Why:** `sweepDone` was specified as `$state` but never given a reader, which would be a dead reactive field; a sequential sweep over a few hundred songs runs for minutes and needs progress. Numeric only, so no dictionary change and no i18n parity risk.

## Concurrency notes

A second Claude session was executing phase 36 in this repository throughout this run. It committed `55d1a66 feat(36-04): Settings → Downloads page with the opt-in retag control` between this plan's two commits, and it edited `src/lib/i18n/en.ts` (adding `settings.retagDownloads` and siblings) while task 1 was being written. None of those files were staged, reverted or touched here: both commits stage exactly `src/routes/(app)/settings/data/+page.svelte`. Per the orchestrator's instruction, `state.advance-plan` was NOT called — STATE.md's shared position cursor belongs to the other session this run.

## Known Stubs

None. Every control is wired to a real module; nothing renders placeholder data.

## Self-Check: PASSED

- `src/routes/(app)/settings/data/+page.svelte` — FOUND (225 lines)
- `.planning/phases/35-one-click-export-and-import-of-all-app-data/35-04-SUMMARY.md` — FOUND
- commit `efab2e5` — FOUND
- commit `55da03c` — FOUND
