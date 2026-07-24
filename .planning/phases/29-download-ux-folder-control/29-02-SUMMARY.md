---
phase: 29-download-ux-folder-control
plan: 29-02
subsystem: ui
tags: [svelte5-runes, library-store, i18n, downloads, reactive-set]

# Dependency graph
requires:
  - phase: 29-01
    provides: phase context + research (D-10 reactive downloading Set, D-13/D-09/D-15 i18n keys)
provides:
  - "library.downloading — reactive per-uid Set (source of truth for per-song download spinners, D-10)"
  - "library.beginDownload/endDownload — new-Set-reassign helpers (TrackMenu inFlight idiom, isolated, non-persisted)"
  - "menu.downloaded i18n key (passive 'Downloaded' badge, D-13) in all 15 locales"
  - "toast.downloadFailedKeptInLibrary i18n key (save-failed toast replacing the window.open bug, D-09)"
  - "settings.migrateDownloads/+Desc/+Result i18n keys (native migration button, D-14/D-15)"
affects: [29-04 per-song download UI rollout, 29-06 native migration button, 29-03 filename helper]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Store-level per-uid transient in-flight Set (reassign new Set to stay reactive) lifted from TrackMenu component to the library singleton"
    - "i18n key added sibling-grouped (menu.* / toast.* / settings.*) across all 15 locale dicts, self-enforced by i18n.test.ts parity + quote-convention gates"

key-files:
  created: []
  modified:
    - src/lib/stores/library.svelte.ts
    - src/lib/stores/library.svelte.test.ts
    - src/lib/i18n/en.ts (+ 14 sibling locales)

key-decisions:
  - "downloading Set deliberately excluded from save()/LibShape — transient runtime state so a corrupt store can never wedge a stuck spinner (T-29-02-01 accept)"
  - "No player import in library — download state kept off the player (D-18 DOWNLOAD ISOLATION)"
  - "Folder path literal 'Download/openmusic' and {moved}/{total} tokens kept verbatim in every locale value"

patterns-established:
  - "Per-uid isolated in-flight state at the store layer: beginDownload/endDownload reassign a new Set; one uid's transition never touches another's"
  - "New TranslationKey added to en (source) then mirrored to all locales, double-quoted key AND value; parity is a compile error + test failure until complete"

requirements-completed: [DL-STATE-01, DL-MIGRATE-01]

# Metrics
duration: 10min
completed: 2026-07-23
---

# Phase 29 Plan 02: Download State Foundation + i18n Summary

**Reactive per-uid `library.downloading` Set (isolated, non-persisted, begin/end helpers) plus the 5 download/migration i18n keys across all 15 locales — the two leaf foundations 29-04 (UI) and 29-06 (migration) build on.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-07-23
- **Tasks:** 2
- **Files modified:** 17 (library store + test, 15 locale dicts)

## Accomplishments
- Added `library.downloading = $state(new Set<string>())` — the single reactive source of truth every download affordance will read (D-10 / DL-STATE-01), with `beginDownload`/`endDownload` helpers that reassign a new Set (TrackMenu `inFlight` idiom) so runes re-render and one uid's transition never touches another's.
- Kept the Set OFF the player (D-18 DOWNLOAD ISOLATION — no player import) and OUT of the persisted payload (transient; a corrupt store can't wedge a stuck spinner).
- Extended `library.svelte.test.ts` with 4 TDD cases: begin→has→end, new-Set-reference reactivity, multi-uid isolation, absent-uid no-op, and transient-never-persisted (asserted against a real save() via browser+localStorage mock).
- Added 5 new i18n keys (`menu.downloaded`, `toast.downloadFailedKeptInLibrary`, `settings.migrateDownloads`, `settings.migrateDownloadsDesc`, `settings.migrateDownloadsResult`) to all 15 locale dicts with faithful translations, double-quoted key AND value, `{moved}`/`{total}` tokens verbatim.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing tests for library.downloading** - `61412c1` (test)
2. **Task 1 (GREEN): library.downloading Set + begin/end helpers** - `7ac6ccd` (feat)
3. **Task 2: download UX + migration i18n keys across 15 locales** - `149dbe5` (feat)

**Plan metadata:** _(this commit)_ (docs: complete plan)

_TDD Task 1 = test → feat (no refactor needed; implementation was minimal)._

## Files Created/Modified
- `src/lib/stores/library.svelte.ts` - Added `downloading` reactive Set field + `beginDownload`/`endDownload` helpers (D-10).
- `src/lib/stores/library.svelte.test.ts` - Added `library.downloading` describe (4 cases) + browser/localStorage mock for the transient-persistence assertion.
- `src/lib/i18n/en.ts` - Defined the 5 new TranslationKeys (source locale).
- `src/lib/i18n/{zh-Hant,zh-Hans,es,fr,de,pt,it,ru,tr,ar,hi,id,vi,th}.ts` - Mirrored all 5 keys, translated, double-quoted, tokens preserved.

## Decisions Made
- `downloading` is transient (not in `save()` / `LibShape`) — deliberate per threat register T-29-02-01 (accept): in-memory only so a corrupt localStorage store can never wedge a stuck spinner.
- No `player` import added to the library store — download state stays off the player (D-18).
- `settings.migrateDownloadsResult` keeps both `{moved}` and `{total}` tokens; in `hi` and `tr` the tokens appear in reversed order (natural word order for those languages) — both literals still present, verified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The "transient — never persisted" test needed a real `save()` path, but the library store's `save()` is `browser`-guarded and the node Vitest project runs with `browser=false`. Resolved by adopting the established `vi.mock('$app/environment', { browser: true })` + in-memory localStorage stub pattern (from `player.svelte.test.ts`) at the top of the test file — the existing cover-chain tests are unaffected (they never assert on localStorage). Verified: all 7 library tests green.

## Known Stubs
None. The `downloading` Set and the 5 i18n keys are intentional leaf foundations — not yet consumed by any UI. Downstream consumption is planned and scoped: `menu.downloaded` + the `downloading` Set are wired by **29-04** (per-song download UI rollout), and the `settings.migrate*` keys by **29-06** (native migration button). No hardcoded empty UI values or placeholder render paths were introduced.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `library.downloading` + `beginDownload`/`endDownload` are ready for 29-04 to drive CompactRow / library / album / TrackMenu per-song spinners.
- All 5 i18n keys exist in every locale (parity + quote-convention gates green), ready for 29-04 (`menu.downloaded`, `toast.downloadFailedKeptInLibrary`) and 29-06 (`settings.migrate*`).
- `pnpm test -- library i18n` (53 tests) and `pnpm check` (0 errors / 0 warnings) both green.

## Self-Check: PASSED

- Files verified on disk: `library.svelte.ts`, `library.svelte.test.ts`, `en.ts`, `29-02-SUMMARY.md` — all FOUND.
- Commits verified in git: `61412c1` (test), `7ac6ccd` (feat), `149dbe5` (feat) — all FOUND.

---
*Phase: 29-download-ux-folder-control*
*Completed: 2026-07-23*
