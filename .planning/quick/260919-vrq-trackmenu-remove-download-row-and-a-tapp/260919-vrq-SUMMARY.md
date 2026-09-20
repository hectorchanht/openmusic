---
phase: quick-260919-vrq
plan: 01
subsystem: ui
tags: [trackmenu, downloads, i18n, destructive-action]
requires:
  - src/lib/services/blob-store.ts (del)
  - src/lib/services/import-exclusions.ts (excludeUid)
  - src/lib/components/SettingToggle.svelte
provides:
  - "library.removeDownload(uid, { deleteFile }) — additive opt-out, default true"
  - "TrackMenu: tappable Download caret → Download-from picker"
  - "TrackMenu: Remove download row + in-menu confirm sheet (trackmenu-rmdl)"
affects:
  - src/lib/components/TrackMenu.svelte
  - src/lib/stores/library.svelte.ts
tech-stack:
  added: []
  patterns:
    - "sub-sheet pattern (scrim + .menu + fly + dragClose + focusTrap + distinct overlay id)"
    - "SettingToggle as the app's only boolean-control idiom"
key-files:
  created: []
  modified:
    - src/lib/components/TrackMenu.svelte
    - src/lib/stores/library.svelte.ts
    - src/lib/stores/library.svelte.test.ts
    - src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "The destructive confirm is an in-menu sheet, not window.confirm — the confirm carries a toggle whose position changes what the action does, and confirm() cannot hold a control."
  - "Toggle OFF writes NO import exclusion: the user chose to keep the file, and a mark keyed on the APP uid would not block a rescan anyway (a rescan re-imports under a new device: uid)."
  - "Danger tint is the in-system literal #ff7a90 (SettingRow .danger / RowBadges .unavailable), not the plan's #e5484d — app.css defines no --color-danger token."
metrics:
  duration: ~12 min
  completed: 2026-09-19
---

# Quick 260919-vrq: TrackMenu remove-download row and a tappable download caret — Summary

The Download row's caret is now a real sibling button that opens the "Download from…" picker on a plain tap, and an app-downloaded song gets a "Remove download" row whose confirm sheet carries one toggle deciding whether the offline copy dies with the library row.

## Tasks

| Task | Commit | What landed |
|---|---|---|
| 1 — split the Download row | `8dbb6dd` | `.mi-split` wrapper holding the main `.mi` button + a sibling `.mi-caret` button; the two dead `.hold-caret` rules deleted |
| 2 RED | `746c934` | two-direction spec for `removeDownload`; the opt-out case failed (`blobDel` called once) |
| 2 GREEN | `46e2596` | `removeDownload(uid, opts = {})` with `blobStore.del` gated on `opts.deleteFile ?? true` |
| 3 — i18n | `4515e1d` | 5 keys × 15 dictionaries, double-quoted, translated per locale |
| 4 — row + confirm sheet | `e1bb072` | `{:else if}` Remove-download row, `trackmenu-rmdl` sheet with SettingToggle, `.hint`/`.actions`/`.mi.danger` CSS |

## What the change does

**Caret.** A `<button>` cannot nest a `<button>`, so making the caret tappable forced the idle Download row to split into a flex wrapper over two siblings. The main half keeps `onclick={startDownload}`, `onlongpress={openDownloadPicker}`, `use:longpress`, its aria-label and its `.count` meta slot; the caret is a 12px/14px-padded button (~42px target, identical row height) named by the existing `menu.downloadFrom` — no new key. `longpress.ts` was not touched: its one-shot click suppressor is attached on `document` in the capture phase, so it is target-agnostic and still eats a hold's trailing click wherever it lands.

**Remove download.** The row sits in an `{:else if}` opposite `{#if isDevice}` noImport, so the two are disjoint by structure and a `device:` import can never reach the delete-file toggle (which `blobStore.del` would refuse anyway — 34 Pitfall 1). The gate is `blobPresent === true || library.isDownloaded(track.uid)` because either one alone leaves a real case unremovable: a stale downloads row with no blob, or a blob whose list entry was lost. `=== true` keeps the row from flashing in during the `null` pre-probe tick.

**The confirm.** `rmOpen` mirrors the playlist picker exactly (scrim / `.menu` / `fly` / `dragClose` / `focusTrap` / own overlay id `trackmenu-rmdl` / reset in `close()`), mounted outside `{#if open && track}` so it survives the parent menu closing. Body copy, one `SettingToggle` (default on, re-armed on every open), Cancel, and a `#ff7a90` Remove. Cancel / scrim / drag-down / Back all land on `rmOpen = false` — no dismiss route removes anything.

- Toggle **ON** → `excludeUid` + `removeDownload(uid, { deleteFile: true })`. The mark is belt-and-braces, not dead state: `deleteFromMusic` never throws, so a silently-failed MediaStore delete leaves a copy a later scan could find.
- Toggle **OFF** → `removeDownload(uid, { deleteFile: false })` only. No `blobStore.del`, no exclusion mark. The toast and body copy promise nothing about the song not coming back, because a surviving file can be re-imported under a new `device:` uid.

## Verification — observed output

- `pnpm check` → `COMPLETED 4572 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` (run after every task).
- `pnpm test` (full suite, after Task 4) → `Test Files 144 passed (144)`, `Tests 2923 passed (2923)`.
- RED gate genuinely observed: before the store change, `library.svelte.test.ts` reported `1 failed | 32 passed` with `expect(blobDel).not.toHaveBeenCalled()` failing on `Number of calls: 1`. After the change, `33 passed (33)`.
- `i18n.test.ts` key-set parity → `33 passed (33)`; each of the 5 keys greps to exactly `15/15` dictionary files.
- `grep -c 'hold-caret'` → `0`; `grep -c "confirm(t('menu.removeDownload"` → `0`; `grep -c 'rmOpen = false'` → `7`.
- `git diff --diff-filter=D` across the five commits → no deletions.

**Not verified:** every item in the plan's Manual section. No dev server or browser was driven in this run, so the caret tap, the hold-does-not-download behaviour, the sheet's appearance, the Back/drag dismiss routes, and the on-disk outcome of each toggle direction are unconfirmed at runtime. The store-level halves of the two toggle directions ARE covered by the new unit tests; the UI wiring between them is construction-level only (typecheck + greps).

## TDD Gate Compliance

`test(...)` `746c934` → `feat(...)` `46e2596`. No refactor gate needed.

## Deviations from Plan

**1. [Rule 1 — correctness] Danger tint uses the in-system `#ff7a90`, not the plan's `var(--color-danger, #e5484d)`**
- **Found during:** Task 4
- **Issue:** The plan said to check `src/app.css` for a danger token first and use the literal only as a fallback. No token exists — but a *literal* does, used twice already (`SettingRow.danger`, `RowBadges.unavailable`), and RowBadges carries an explicit comment recording it as "the pre-existing in-system literal".
- **Fix:** `.mi.danger { color: #ff7a90; }` with a comment naming both prior call sites. Introducing a second, different red would have been the only way to follow the plan literally.
- **Files modified:** `src/lib/components/TrackMenu.svelte`
- **Commit:** `e1bb072`

**2. [Rule 3 — blocking] Rephrased one new CSS comment to drop the literal string `hold-caret`**
- **Found during:** Task 1 verification
- **Issue:** The task's own verify asserts `! grep -q 'hold-caret'`. My replacement comment said "`.hold-caret` is gone with them", which kept the string alive and failed the check.
- **Fix:** Reworded to "the caret's two old decoration-only rules went with it". Same record, zero occurrences.
- **Commit:** `8dbb6dd` (folded in before the commit)

## Assumption Drift (advisory)

**Plan's interfaces block names `pickerOpen` as "THE sub-sheet flag to mirror" for the download picker.**
- **Planned:** reads as though `pickerOpen` were the Download-from sheet's flag.
- **Actual:** `pickerOpen` is the *playlist* picker; the Download-from sheet is `dlPickOpen` / `closeDownloadPicker`.
- **Why it doesn't change the outcome:** the plan wanted the playlist picker's *shape* copied, and that is what `rmOpen` copies. `openDownloadPicker` was wired by name, so the caret is unaffected. Recorded because a reader of the plan would otherwise expect `pickerOpen` in the caret path.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path or trust-boundary schema. The one destructive surface (`confirmRemoveDownload` → `blobStore.del`) was already in the plan's threat register (T-vrq-01..06) and every listed mitigation is in place: sheet-gated destructive button, `device:` unreachable by structure, additive signature pinned by Test 1, opt-out pinned by Test 2, `longpress.ts` untouched, `rmDeleteFile` re-armed per open.

## Self-Check: PASSED

- `src/lib/components/TrackMenu.svelte` — FOUND
- `src/lib/stores/library.svelte.ts` — FOUND
- `src/lib/stores/library.svelte.test.ts` — FOUND
- all 15 `src/lib/i18n/*.ts` dictionaries — FOUND, 15/15 per key
- commits `8dbb6dd`, `746c934`, `46e2596`, `4515e1d`, `e1bb072` — FOUND in `git log`
