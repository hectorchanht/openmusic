---
phase: 38-share-links-that-play-instantly-and-open-in-the-app
plan: 06
subsystem: ui
tags: [share, i18n, svelte, trackmenu, deep-links]

# Dependency graph
requires:
  - phase: 38-01
    provides: "songShareUrl's 4th positional `id` argument and the `?u={source}{songid}` carrier emitter"
provides:
  - "Every new song share link emitted by the app carries `?u={source}{songid}` (D-08) — the emit side is now wired end-to-end"
  - "`toast.sharedPlaying` TranslationKey present in all 15 locale dictionaries (D-20)"
affects: [38-05, share-arrival, warm-arrival-toast]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pinned source-text assertions: a call site's literal text is the contract — append arguments, never reformat"

key-files:
  created: []
  modified:
    - src/lib/components/TrackMenu.svelte
    - src/lib/i18n/en.ts (+ 14 sibling dictionaries)

key-decisions:
  - "Toast key named `toast.sharedPlaying`, inserted directly after `toast.addedToQueue` in every dictionary so the toasts block stays grouped"
  - "Each locale's value reuses that locale's OWN existing noun for 'queue' (taken from its `toast.addedToQueue` line) rather than a fresh translation"
  - "The `·` separator matches the existing `toast.skipped` house style"

patterns-established:
  - "Call-site contract pinning: TrackMenu:783-785 stays single-line with args 1-2 byte-identical; share.test.ts and names.test.ts assert the raw source text"

requirements-completed: [38-A]

# Metrics
duration: 6min
completed: 2026-09-20
---

# Phase 38 Plan 06: Wire the emit side + the D-20 toast key Summary

**TrackMenu now passes the `Track` as `songShareUrl`'s 4th positional argument, so every share link emitted in the wild carries `?u={source}{songid}`; `toast.sharedPlaying` added to all 15 locale dictionaries so plan 05's warm-arrival toast compiles as a `TranslationKey`.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-09-20T13:57Z
- **Completed:** 2026-09-20T14:01Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments
- The single live song-share emitter (`TrackMenu.svelte:785`) passes the track identity, closing the D-08 loop plan 01 opened on the `share.ts` side.
- Both pinned source-text regex suites (`share.test.ts:834` positive, `names.test.ts:219` negative) stay green with **zero test edits** — the call is still one line and args 1-2 are byte-identical.
- `toast.sharedPlaying` exists in all 15 dictionaries (`ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant`), double-quoted key and value, key-set parity intact.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pass the track identity from TrackMenu's share call (D-08)** - `5262ea8` (feat)
2. **Task 2: Add `toast.sharedPlaying` to all 15 locale dictionaries (D-20)** - `8a18b4e` (feat)

## Files Created/Modified
- `src/lib/components/TrackMenu.svelte` - the share call gains `, track` as the 4th positional arg plus a 2-line `38-D-08` decision comment (3 added / 1 deleted, matching the plan's diff budget)
- `src/lib/i18n/en.ts` - `toast.sharedPlaying` + a 2-line `38-D-20` rationale comment (`en` defines the `TranslationKey` union)
- `src/lib/i18n/{ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts` - one line each, inserted directly after `toast.addedToQueue`

## Verification (observed, not assumed)
- `pnpm test -- src/lib/services/share.test.ts src/lib/stores/names.test.ts` → **2 files, 119 tests passed**
- `pnpm test -- src/lib/i18n/i18n.test.ts` → **1 file, 33 tests passed**
- `pnpm test` (full suite) → **145 files, 2969 tests passed**
- `pnpm check` → **4574 FILES 0 ERRORS 0 WARNINGS** (run after each task)
- `grep -c "songShareUrl({ title: dTitle, artist: dArtist }, shareCover, recallItunesId(shareCover), track);"` → `1`
- `grep -c "songShareUrl("` in TrackMenu → `1` (still the only call site)
- `grep -l '"toast.sharedPlaying": "' src/lib/i18n/*.ts | grep -v test | wc -l` → `15`; single-quoted variants → `0`; empty values → `0`

## Decisions Made
- **Queue noun per locale sourced from the file itself.** Before writing, each dictionary's existing `toast.addedToQueue` value was read; every plan-supplied translation already matched its locale's established noun (zh-Hant 待播清單, zh-Hans 待播列表, de Warteschlange, fr file d'attente, id antrean, vi hàng đợi, …), so the plan's values were used verbatim.
- **Decision comments wrapped to 2 lines each** rather than one ~240-char line, matching the file's ~100-char comment wrap. This keeps the TrackMenu diff inside the plan's "at most 3 added / 1 deleted" budget while preserving the full rationale text.

## Deviations from Plan

None - plan executed exactly as written.

## Assumption Drift (advisory)

None - the `songShareUrl` 4th-arg signature, the pinned regexes, and the `toast.addedToQueue` anchor were all exactly as the plan described.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The emit side is live: links produced from the track menu now carry the uid carrier that plan 05's arrival path consumes.
- `t('toast.sharedPlaying')` is a valid `TranslationKey` and resolves in every locale — plan 05 can call it without a further i18n change.
- Nothing pushed. Push to `main` auto-deploys production, so the phase should ship as a whole.

---
*Phase: 38-share-links-that-play-instantly-and-open-in-the-app*
*Completed: 2026-09-20*

## Self-Check: PASSED

- All 16 modified files present on disk; both task commits found in git log.
