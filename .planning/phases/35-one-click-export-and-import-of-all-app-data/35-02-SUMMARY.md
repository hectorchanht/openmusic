---
phase: 35-one-click-export-and-import-of-all-app-data
plan: 02
subsystem: i18n
tags: [i18n, locales, backup, strings, parity]
requires: []
provides:
  - "TranslationKey: 22 new backup.* keys — backup.export, exportDesc, exported, exportFailed, import, importDesc, importConfirm, imported, importedSkipped, errNotOurs, errNewer, errDamaged, errNoSnapshot, errWriteFailed, undo, undoDesc, undoConfirm, undone, redownload, redownloadDesc, stop, sweepDone"
affects:
  - "plan 03 (backup-io / sweep) and plan 04 (settings/data page) can call t('backup.*') with no type error"
tech-stack:
  added: []
  patterns:
    - "one // --- backup (Settings → Data, phase 35) --- block appended to every dictionary in identical key order"
    - "double-quoted key AND value (the i18n-only exception to the project's single-quote rule)"
    - "{n} / {saved} / {failed} interpolation tokens preserved verbatim in all 15 languages"
key-files:
  created: []
  modified:
    - src/lib/i18n/en.ts
    - src/lib/i18n/de.ts
    - src/lib/i18n/es.ts
    - src/lib/i18n/fr.ts
    - src/lib/i18n/it.ts
    - src/lib/i18n/pt.ts
    - src/lib/i18n/ru.ts
    - src/lib/i18n/ar.ts
    - src/lib/i18n/hi.ts
    - src/lib/i18n/id.ts
    - src/lib/i18n/th.ts
    - src/lib/i18n/tr.ts
    - src/lib/i18n/vi.ts
    - src/lib/i18n/zh-Hans.ts
    - src/lib/i18n/zh-Hant.ts
decisions:
  - "15 dictionaries, not the 16 that CONTEXT D-11 and CLAUDE.md both claim — the plan already carried the correction and `ls src/lib/i18n/` confirms it; no 16th file was created"
  - "The block is APPENDED at the end of each dict (immediately after settings.clearLibraryDesc, which is the last entry in all 15 files) — same relative position everywhere, so a future diff of any two dictionaries stays aligned"
  - "Inserted mechanically by one throwaway script driven by a per-locale JSON table, asserting identical key ORDER and rejecting any ASCII double quote or blank value before writing — the parity failure this plan exists to prevent is exactly the kind 15 hand-edits produce"
  - "The three D-11 messages are distinct SENTENCES, not three shades of one: 'not an OpenMusic backup' / 'made by a newer version, update and retry' / 'damaged, cannot be imported' — a user reading a toast must know which of the three happened"
  - "Terminology was lifted from each dictionary's existing settings.clearLibraryDesc / clearSearchHistoryDesc / history.clear strings rather than invented (e.g. de 'gemochte Songs', pt 'músicas curtidas', zh-Hant '收藏歌曲' vs zh-Hans '喜欢歌曲', th 'เพลงที่คุณถูกใจ')"
  - "Locale-native quotation marks («» ru/ar, 「」 zh-Hant, “” zh-Hans) inside values — they are non-ASCII, so they cannot collide with the TS string delimiter"
metrics:
  duration: ~20 min
  completed: 2026-09-13
---

# Phase 35 Plan 02: Backup i18n Strings Summary

All 22 `backup.*` UI strings — buttons, descriptions, both confirm dialogs, result toasts and the five failure messages — added to every one of the 15 locale dictionaries with an identical key set, double-quoted per the i18n-only convention, so plan 04 can call `t('backup.*')` against a compile-checked `TranslationKey`.

## What Was Built

Two commits, seven dictionaries then eight, each block identical in key set and order:

| Task | Locales | Commit |
|------|---------|--------|
| 1 | en (reference) + de es fr it pt ru | `6a7ed03` |
| 2 | ar hi id th tr vi zh-Hans zh-Hant | `24cabc1` |

`en.ts` carries the plan's reference English verbatim. The other 14 are real translations, not English left in place and not a machine gloss — each one reuses the vocabulary already present in that dictionary's Settings → Data strings (`settings.clearLibraryDesc`, `settings.clearSearchHistoryDesc`, `settings.clearNameCacheDesc`, `history.clear`) so "liked songs" / "downloads list" / "play history" read the same way as everywhere else in the app.

The D-08 confirm (`backup.importConfirm`) names all seven things being replaced in every locale: liked songs, playlists, downloads list, play history, search history, settings, name translations. The D-11 trio stays three clearly separate statements in every language.

## How to Verify

```
$ for f in ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant; do grep -c '"backup\.' src/lib/i18n/$f.ts; done
22 22 22 22 22 22 22 22 22 22 22 22 22 22 22

$ grep -c "'backup\." src/lib/i18n/*.ts | grep -v ':0$'
(no output — no single-quoted key or value crept in)

$ diff <(grep -o '"backup\.[a-zA-Z]*"' src/lib/i18n/en.ts | sort) \
       <(grep -o '"backup\.[a-zA-Z]*"' src/lib/i18n/zh-Hant.ts | sort)
(no output, exit 0)

$ npx vitest run src/lib/i18n/i18n.test.ts
 Test Files  1 passed (1)
      Tests  29 passed (29)
   Duration  748ms

$ pnpm check
1789349369002 START "/Users/laichan/code/tung/openmusic"
1789349369014 COMPLETED 4507 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

All five outputs above are real, observed after Task 2. The 29 passing tests include the all-15-locale key-set parity assertion, the no-blank-value assertion, and the per-file IN-01 double-quote scan.

## Deviations from Plan

None — the plan executed exactly as written.

Two things worth recording that were *not* deviations:

- **The intermediate `pnpm check` failure was expected and is documented in the plan.** After Task 1, `pnpm check` reported exactly 8 errors, one per not-yet-edited locale, all of the form *"is missing the following properties from type 'Dict': backup.export, backup.exportDesc, … and 18 more"*. No unrelated error appeared, which is itself the useful signal: the only thing broken mid-plan was the thing Task 2 fixes. Task 2's run is clean at 0 errors.
- **The `phase 35` string in the section comment does not violate the no-GSD-metadata rule here.** CLAUDE.md's own §Comments makes decision refs and phase tags load-bearing house style, and `en.ts` already carries `// --- settings: up-next sourcing (Phase 17, QUEUE-03) ---` while `i18n.test.ts` opens with a "Phase 19 (Pitfall 5 / Wave 0)" rationale comment. Project convention wins; the comment matches its neighbours.

## Concurrency Note

A second Claude session is executing **phase 36** in this same working tree. Consequences for this plan:

- `src/lib/services/download-track.ts` was modified by that session and is **not** in this plan's `files_modified`. It was left untouched and unstaged; it is still dirty in the working tree. Only the 15 declared i18n paths were staged, by explicit path, in both commits.
- Commit `fae58da docs(36-02): complete the audio tag codec plan` landed between this plan's two commits. That is the other session; the interleave is expected and harmless.
- **`state.advance-plan` was deliberately NOT called.** STATE.md carries a single shared position cursor which currently reads `Phase: 36 … Plan: 3 of 5` — that belongs to the other session. Advancing it would have silently moved phase 36's pointer (the failure the 35-01 executor already hit). Only additive STATE.md updates were made.

## Threat Flags

None. Static string dictionaries; no new trust boundary, no untrusted input. T-35-07 holds — the D-11 messages name the failure class and never echo file contents.

## Self-Check: PASSED

All 15 modified files present on disk with 22 `backup.*` keys each; both commits (`6a7ed03`, `24cabc1`) found in `git log`; no file deletions in either commit.
