---
phase: 34-import-device-songs-as-native-downloads
plan: 05
subsystem: ui
tags: [i18n, svelte, typescript, localization]

# Dependency graph
requires:
  - phase: 34-import-device-songs-as-native-downloads
    provides: 34-UI-SPEC Copywriting Contract (the verbatim English source for all 42 keys)
provides:
  - "42 translation keys per locale (37 import.*, 4 toast.*, 1 menu.unavailable) across all 15 dictionaries"
  - "TranslationKey union now admits every string Plans 34-02 / 34-06 / 34-07 / 34-08 need — their t() and this.error = 'toast.fileMissing' calls now typecheck"
affects: [34-02, 34-06, 34-07, 34-08, 34-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "New namespace `import.*` for the device-import panel, kept out of the already-large settings.* namespace"

key-files:
  created: []
  modified:
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hans.ts
    - src/lib/i18n/zh-Hant.ts
    - src/lib/i18n/de.ts
    - src/lib/i18n/es.ts
    - src/lib/i18n/fr.ts
    - src/lib/i18n/it.ts
    - src/lib/i18n/pt.ts
    - src/lib/i18n/ru.ts
    - src/lib/i18n/tr.ts
    - src/lib/i18n/ar.ts
    - src/lib/i18n/hi.ts
    - src/lib/i18n/id.ts
    - src/lib/i18n/th.ts
    - src/lib/i18n/vi.ts

key-decisions:
  - "settings.groupDownloads / settings.groupDownloadsDesc already exist in all 15 locales from Phase 36 (36-D-17 retag) — reused, not duplicated. 42 new keys per locale, not 44."
  - "Phase 36's groupDownloadsDesc value (\"Tag downloaded files with metadata\") left untouched rather than overwritten with the UI-SPEC's \"Import songs from this device\"; both features share one /settings/downloads page and the desc rewrite belongs to whichever plan actually ships that page."
  - "import.* keys appended as one contiguous block at the end of each dictionary rather than interleaved, so the 15 files stay diff-comparable line-for-line."

patterns-established:
  - "Bulk locale edits applied by a single scripted inserter with a per-key/per-locale precondition check (missing key, embedded double quote, already-patched) instead of 15 hand edits"

requirements-completed: [34-D-06, 34-D-12, 34-D-14]

# Metrics
duration: 21min
completed: 2026-09-13
---

# Phase 34 Plan 05: Device-import translation keys Summary

**42 new keys (`import.*` ×37, `toast.*` ×4, `menu.unavailable`) landed in all 15 locale dictionaries with English verbatim from the UI-SPEC Copywriting Contract, unblocking every `t('import.…')` call in the rest of the phase.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-09-13T20:05:19Z
- **Completed:** 2026-09-13T20:26:11Z
- **Tasks:** 3
- **Files modified:** 15

## Accomplishments
- `en.ts` carries the full import UI vocabulary verbatim from the 34-UI-SPEC Copywriting Contract — CTA, permission states (soft + permanently blocked, including the full Android Settings path), progress, the eight post-scan summary lines, the rules panel, and the three custom-pattern rejection messages.
- 14 non-English dictionaries carry natural translations with every `{count}` / `{done}` / `{total}` / `{seconds}` placeholder and every `(?<artist>…)` / `(?<title>…)` / `(?<album>…)` / `(?<track>…)` regex fragment preserved byte-for-byte; `OpenMusic` and `Android` left untranslated; `·` `—` `…` `→` glyphs intact.
- `import.permBlocked` names the locale's own Android Settings path (zh-Hans 设置 → 应用 → 权限 → 音乐和音频, de Einstellungen → Apps → Berechtigungen, ru Настройки → Приложения → Разрешения, and so on) rather than transliterating the English one.
- Key-set parity restored across all 15 locales and verified by the real gate.

## Task Commits

1. **Task 1: en + zh-Hans + zh-Hant + de + es** - `8e0c3bb` (feat)
2. **Task 2: fr + it + pt + ru + tr** - `2ca0abf` (feat)
3. **Task 3: ar + hi + id + th + vi, then the parity gate** - `b7b1e4c` (feat)

## Files Created/Modified
- `src/lib/i18n/en.ts` - Reference locale; 42 new entries define the new `TranslationKey` members
- `src/lib/i18n/{zh-Hans,zh-Hant,de,es,fr,it,pt,ru,tr,ar,hi,id,th,vi}.ts` - Same 42 keys, same block positions, natural translations

## Decisions Made
- **`settings.groupDownloads` pair reused, not added.** Phase 36 (36-D-17, merged on main) already ships both keys in all 15 locales. Adding them again would have been a duplicate object literal key — a silent overwrite that TypeScript does not flag in this shape. The plan's count of 44 new keys is therefore 42 in practice; its acceptance criterion `grep -c '"settings.groupDownloads' == 2` was already satisfied by the pre-existing entries and still is.
- **`settings.groupDownloadsDesc` value left as Phase 36 wrote it.** Phase 34's UI-SPEC wants "Import songs from this device"; Phase 36 has "Tag downloaded files with metadata". The `/settings/downloads` page will host both features, so neither string is right alone. Rewriting it in 15 locales from a plan that ships no UI is churn with a real chance of being rewritten again by 34-07. Left for whichever plan actually builds the page.
- **Keys inserted by script, not by hand.** A 15-file × 42-key edit done by hand is where the quote-convention breaks historically happen. The inserter refuses to run on a locale whose data is incomplete, whose value contains a `"`, or that is already patched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `settings.groupDownloads` / `settings.groupDownloadsDesc` already exist**
- **Found during:** Task 1 (en + zh-Hans + zh-Hant + de + es)
- **Issue:** The plan's `<interfaces>` lists both keys as new. Phase 36 already added them to all 15 locales (`en.ts:157-158`, under `// --- downloads settings / retag (36-D-17) ---`). Adding them again would produce a duplicate key in each object literal, silently overwriting Phase 36's value and breaking its settings-index row.
- **Fix:** Omitted both keys from the inserted set; the 15 dictionaries keep Phase 36's entries. New key count per locale is 42, not 44.
- **Files modified:** none beyond the 15 dictionaries already in scope
- **Verification:** `grep -c '"settings.groupDownloads' src/lib/i18n/<f>.ts` returns 2 in all 15 files (the plan's stated criterion); `pnpm check` 0 errors; `pnpm test` 2301 passed.
- **Committed in:** `8e0c3bb` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope change. The plan's own acceptance criteria are all met; only the internal "44 new keys" count is off by the two keys a sibling phase had already landed.

## Assumption Drift (advisory)

**1. Phase 34 and Phase 36 both claim `/settings/downloads`**
- **Found during:** Task 1
- **Planned:** 34-UI-SPEC contract 1 describes `/settings/downloads` as "a new page for a new feature" with the settings-index row reading "Import songs from this device".
- **Actual:** Phase 36 already owns the `settings.groupDownloads` row and gave it a retag-focused description. The page is a shared surface for two features, not a device-import page.
- **Why it matters:** 34-07 (the page build) must merge with Phase 36's retag controls rather than assume an empty route, and must settle the shared index-row description. Advisory only — nothing here is gated on it.

## Issues Encountered
Mid-plan, `pnpm check` reported 10 errors and `i18n.test.ts` failed its parity assertion — the expected state while Tasks 1-2 had landed only 5 and then 10 of 15 locales, since `en.ts` is the `Dict` type source. Both cleared on Task 3. The quote-convention sub-suite (all 15 files, double quotes on key AND value) passed after every task, including mid-plan.

## Verification Observed

- `pnpm vitest --run src/lib/i18n/i18n.test.ts` — **1 file passed, 29/29 tests passed** (run after Task 3; parity + no-blank + quote convention across all 15 locales).
- `pnpm check` — **COMPLETED 4521 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS**.
- `pnpm test` — **123 test files passed, 2301 tests passed**, matching the stated baseline exactly (no regression).
- `grep -c '"import\.'` across all 15 locales — prints `37` fifteen times.
- `grep -c '"menu.unavailable"'` — present in 15/15 files.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Every `t('import.…')`, `t('toast.import…')`, `t('toast.fileMissing')`, `t('toast.patternFellBack')` and `t('menu.unavailable')` call in Plans 34-02 / 34-06 / 34-07 / 34-08 now typechecks. No further i18n work is needed for this phase's UI.
- Open for 34-07: the `/settings/downloads` index-row description is Phase 36's retag wording. Decide there whether the shared page's row describes retag, import, or both.

---
*Phase: 34-import-device-songs-as-native-downloads*
*Completed: 2026-09-13*

## Self-Check: PASSED

- All 4 commits present in git log (`8e0c3bb`, `2ca0abf`, `b7b1e4c`, `98f58d6`).
- `34-05-SUMMARY.md` present on disk.
- No tracked-file deletions across the plan's commits.
