---
phase: 34-import-device-songs-as-native-downloads
plan: 06
subsystem: services
tags: [device-import, re-sync, merge-lane, redos, pure-module, data-loss-guard]

requires:
  - phase: 34.01
    provides: "ScanRow / rowToTrack / deviceUid / isDeviceUid — the device: uid contract"
  - phase: 34.03
    provides: "ImportRules / DEFAULT_IMPORT_RULES / parseFilename / extOf, and the ReDoS layer-1 handoff"
  - phase: 8
    provides: "match-key.ts matchKey — the only same-song bridge the merge lane is allowed to use"
provides:
  - "device-import.ts — classifyRow (one row → one verdict) and syncDevice (rows + rules + library → SyncPlan)"
  - "ImportSummary, the count set UI-SPEC Contract 4's summary lines map onto 1:1"
  - "ReDoS layer 2: PATTERN_SCAN_BUDGET_MS cumulative abort with preset fallback and a patternFellBack flag"
  - "SCAN_PAGE_SIZE and OPENMUSIC_RELATIVE_PATH as the shared constants 34-07's store drives the walk with"
affects: [34-07 import store, 34-08 settings rules panel]

tech-stack:
  added: []
  patterns:
    - "Plan-not-effects: the brain returns the NEXT downloads array plus a relink list; the store applies it. No mutation, no I/O, no runes."
    - "Cumulative untrusted-work budget: measure only the calls that can run the untrusted regex, and demote the pattern for the rest of the run rather than aborting the run."
    - "Same-reference passthrough as a churn proof: an untouched entry comes back as the identical object, so a test can assert zero churn with toBe."

key-files:
  created:
    - src/lib/services/device-import.ts
    - src/lib/services/device-import.test.ts
  modified: []

key-decisions:
  - "The empty match key '|' can never relink — a file whose artist and title both normalise away would otherwise link every nameless file onto the same stored entry (T-34-16)"
  - "The refresh carries the stored cover across but nothing else: the file's tags are the truth for a device entry, while an adopted cover is the app's own and the row never brings one"
  - "The relink list is de-duped by uid, so two public copies of one song relink it once instead of emitting a duplicate write"
  - "existingByKey keeps the FIRST real-source entry per key, so the merge target cannot depend on library list order"
  - "syncDevice takes and returns arrays only — it never calls setDownloads/clearUnavailable, which stay 34-07's to call (34-02's stated handoff)"

patterns-established:
  - "A never-throw pure module states its purity contract WITHOUT naming the forbidden module paths, so the plan's own no-import grep stays truthful"

requirements-completed: [34-D-03, 34-D-07, 34-D-08, 34-D-09, 34-D-10, 34-D-11, 34-D-12, 34-D-14, 34-D-15, 34-D-16]

duration: 7min
completed: 2026-09-13
---

# Phase 34 Plan 06: The pure device-import brain Summary

**A completed scan now diffs a whole library in one pure call — new files added, seen files rebuilt from their rows, confirmed-gone entries dropped — while a cancelled scan can only ever add, a `Music/OpenMusic/` file relinks its stored entry by writing one URI and nothing else, and a runaway custom regex is demoted mid-run instead of hanging the WebView.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-09-13T20:36:30Z
- **Completed:** 2026-09-13T20:43:30Z
- **Tasks:** 2 of 2
- **Files modified:** 2 (2 created, 0 modified)

## Accomplishments

### Task 1 — `classifyRow` (RED `c6ab45d` → GREEN `855f910`)

`src/lib/services/device-import.ts`, pure and store-free. Its only imports are `type Track`, the 34-01 mapper, the 34-03 parser and `matchKey` — no runes, no i18n, no store, no Capacitor.

- **Filter order is `outside → ext → short → rule`, and a row failing several is counted ONCE.** A summary whose categories add to more than the file count is worse than no summary, so the test pins all four orderings by peeling one failure off at a time.
- **`isInside` is a belt, not the filter.** Kotlin's SQL selection is the primary D-11 control; this catches OEM MediaProvider quirks and is counted under `skippedOutside` — logged, not rendered, because a file outside `Music/`/`Download/` is out of scope by decision rather than a silent skip of something the user expected.
- **Unknown duration is never penalised.** `durationMs: 0` means MediaStore could not measure the file, which is exactly the neutrality `rowToTrack` already applies when it omits `Track.duration`.
- **The merge lane is the narrowest thing that works (D-09/D-10).** Only rows under `Music/OpenMusic/`, only against real-source entries, and it emits `{ uid, uri }` — no Track is produced, so no stored field can be churned. The comment states the reason in plain terms: the stored entry has the resolved cover, proper album and translated names; the file's tags are whatever our own filename builder gave it. D-09 buys playability, not metadata.
- **A malformed/null row is total, not throwing** — it has no folder, so it falls out as `'outside'` like any other unscanned row.

21 `it()` cases in the `classifyRow` describe (plan asked for ≥ 14), plus 2 pinning the constants — including one that pins `OPENMUSIC_RELATIVE_PATH` against the Kotlin writer's literal, so a drift there fails a test rather than silently breaking the merge.

### Task 2 — `syncDevice` (RED `83c89b4` → GREEN `0a984fc`)

- **The drop lane is gated on `opts.complete` and nothing else** (T-34-15). The two tests are the same inputs run twice: complete drops `device:2` and counts `removed: 1`; cancelled keeps it, reports `removed: 0` and `complete: false`. Real-source entries are never dropped even by an empty complete scan.
- **Refresh-in-place answers RESEARCH Pitfall 5 without `getVersion()`.** Every device entry present in the scan is rebuilt from its current row, so after a MediaStore rebuild `device:<id>` always shows the song that IS row `<id>` — never a stale title over different bytes. The only field carried across is the cover (the app's own, and a row never brings one). The residual cost is exactly D-02's accepted cost, recorded in the header with a `ponytail:` upgrade path.
- **Zero churn is asserted by reference, not by value.** Untouched entries are pushed through as the identical object, so the merge-lane test can write `expect(plan.downloads[0]).toBe(realA)` — a stronger claim than `toEqual`, and the one that actually matters for re-render behaviour.
- **ReDoS layer 2 is measured, not assumed.** The budget wraps only the `classifyRow` calls that can run the untrusted pattern; on overrun the pattern is set to `null` for the rest of the run and `patternFellBack` is raised. The test subclasses `RegExp` with an `exec` that busy-waits ~600 ms and then fails to match: the run demotes the pattern after four rows, all five rows still import via the D-13 presets, and the whole case completes in ~2.4 s.
- **Paging overlap is de-duplicated by `_ID`** before any counting, so a file inserted mid-walk cannot be counted twice.

12 `it()` cases in the `syncDevice` + `emptySummary` describes (plan asked for ≥ 11).

## Verification Results

All commands were run; these are observed outputs, not restatements of the plan.

| Check | Result |
|---|---|
| `pnpm vitest --run src/lib/services/device-import.test.ts` (Task 1) | 23 passed |
| `pnpm vitest --run src/lib/services/device-import.test.ts` (Task 2) | **35 passed in 2.62 s** (budget was 10 s) |
| `pnpm test` (full suite) | **124 files, 2353 tests passed** (baseline 123 / 2318 — no regression) |
| `pnpm check` | 4523 files, 0 errors, 0 warnings |
| `grep -n "export const OPENMUSIC_RELATIVE_PATH = 'Music/OpenMusic/'"` | 1 line (41) |
| `grep -n '\$lib/i18n\|\$lib/stores\|\$app/'` | **nothing** — purity grep clean |
| `grep -n "toLowerCase().replace\|\p{L}"` | nothing — no re-inlined normalisation |
| `grep -c "matchKey("` | 1 |
| `grep -n "opts.complete"` | 3 lines (164 comment, 169, 268) |
| `grep -n "PATTERN_SCAN_BUDGET_MS"` | 2 lines (37 constant, 214 use) |
| `grep -n "getVersion"` | 2 lines, both comments (16, 21) — documented as superseded, not implemented |
| `grep -n "export function syncDevice(existing: Track[], rows: ScanRow[], …): SyncPlan"` | 1 line (167) |
| `git diff --diff-filter=D --name-only HEAD~1 HEAD` | empty — no deletions |

TDD gates observed for both tasks: RED run first and seen failing (Task 1: module-not-found; Task 2: 11 failed / 24 passed), committed as `test(...)`, then implemented to green as `feat(...)`. No REFACTOR gate was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected a wrong assertion in my own Task 2 RED test**
- **Found during:** Task 2 GREEN
- **Issue:** the ReDoS test asserted `plan.downloads[0].title === 'Song 5'`, i.e. that the last row would land first. New device tracks are prepended **as a block, in row order** (the plan's own `[...freshNew (in row order), ...]`), which the separate ordering test already pins — so `downloads[0]` is `Song 1`.
- **Fix:** assert `plan.downloads[4].title === 'Song 5'` instead, with a comment naming why row 5 is the interesting one (it is the row parsed *after* the fallback). The implementation was correct; the expectation was not.
- **Files modified:** `src/lib/services/device-import.test.ts`
- **Commit:** `0a984fc`

### Added beyond the plan (T-34-16 hardening)

**`matchKey` result `'|'` can never relink.** The plan's step (6) looks the key up unconditionally. A file whose artist and title both normalise to empty (`'...'`, punctuation-only) produces the key `'|'`; if any stored entry also keyed to `'|'`, every nameless imported file would relink onto it. One guard, one line, with the reason inline. This is the "wrong link" half of T-34-16 and falls under the deviation rules' correctness carve-out rather than being a feature.

### Acceptance-criterion note (not a code change)

The plan's `<action>` asks the header to state the purity contract "(no runes, no `$lib/i18n`, no `$lib/stores/*` …)" while an acceptance criterion requires `grep -n "\$lib/i18n\|\$lib/stores\|\$app/"` to return **nothing**. Those two cannot both hold literally — which is precisely the comment-blind-grep note 34-01 and 34-03 each had to record after the fact.

Resolved here by wording rather than by dodging: the contract says "MUST NOT import the i18n layer, any runes store, or a SvelteKit app module". Both the intent (no such import) and the criterion (grep clean) hold, and the load-bearing sentence survives intact.

## Assumption Drift (advisory)

**The plan cites `MediaStoreSaverPlugin.kt line 51` for the `relativePath` literal; it is line 68**
- **Found during:** Task 1
- **Planned:** "`android/…/MediaStoreSaverPlugin.kt` line 51 (`relativePath = "${Environment.DIRECTORY_MUSIC}/OpenMusic/"`)".
- **Actual:** line 51 is inside the `@CapacitorPlugin` permission block; the literal is at line **68**. The value is exactly as the plan states.
- **Why it matters:** only for a future reader chasing the reference. The constant is additionally pinned by a test that asserts the literal string, so the coupling is enforced by a check rather than by a line number that will drift again.

**`relinked` counts stored entries, not files**
- **Planned:** the `<action>` says "push to `relink` (de-dupe by uid), `relinked++`" — ambiguous about which side of the de-dupe the counter sits on.
- **Actual:** the increment is *inside* the de-dupe, so two public copies of one song count as one relink.
- **Why it matters:** UI-SPEC Contract 4 renders `import.summaryRelinked` as "songs relinked to files already on this device". Counting the second copy would render a number larger than the number of library entries that changed, and the relink list it describes would be shorter than the count. One of the two readings makes the sentence true; this is it.

## Known Stubs

None. Every export is implemented and exercised by a test. `SCAN_PAGE_SIZE` has no runtime consumer yet — Plan 34-07's paging loop is its sole intended caller — but it is a finished value pinned by a test, not a placeholder.

## Threat Flags

None new. This plan closes the three mitigations the register assigned to it:

- **T-34-14 (ReDoS)** — layer 2 delivered: cumulative budget, mid-run demotion to the audited presets, `patternFellBack` surfaced for the toast. With layer 1 (34-03) and layer 3 (fixed preset patterns) the Pitfall 8 design is complete.
- **T-34-15 (data-loss)** — the drop lane is gated on `opts.complete`; real-source entries are structurally exempt from the drop branch. Both are pinned by tests.
- **T-34-16 (churn / wrong link)** — relink emits a URI only, only for `Music/OpenMusic/` rows, only onto real-source uids, and the empty-key case is refused. Zero churn is proven by a same-reference assertion.

No new network endpoint, auth path or schema. MediaStore strings stay untrusted text throughout — nothing here interpolates a `displayName` into a path or a URI.

## Notes for Future Phases

- **34-07** is the thin driver: page `scanAudio({ offset, limit: SCAN_PAGE_SIZE })` until `offset >= total`, accumulate rows, then one `syncDevice(library.downloads, rows, rules, { complete, custom })`. Pass `complete: false` for a cancelled **or failed** walk — a bridge rejection is as uninformative about "gone" as a cancel is. It is also the sole intended caller of `setDownloads` / `clearUnavailable` (34-02's handoff) and of `blobStore.linkPublicUri` for each `plan.relink` entry.
- **`plan.relink` must be applied before `plan.downloads`** is committed, or a relinked entry is playable only after the next launch.
- **34-08**'s preview should call `classifyRow` on a handful of real rows rather than re-deriving verdicts, so the panel can never disagree with what the import will actually do.
- `SCAN_PAGE_SIZE = 500` is the `[ASSUMED A8]` figure from RESEARCH Pitfall 9 and is exported precisely so the device checkpoint can tune it in one place.

## Self-Check: PASSED

- `src/lib/services/device-import.ts` — FOUND
- `src/lib/services/device-import.test.ts` — FOUND
- Commit `c6ab45d` (test, Task 1 RED) — FOUND
- Commit `855f910` (feat, Task 1 GREEN) — FOUND
- Commit `83c89b4` (test, Task 2 RED) — FOUND
- Commit `0a984fc` (feat, Task 2 GREEN) — FOUND
