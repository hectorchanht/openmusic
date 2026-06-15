# Deferred / out-of-scope items — quick-260616-0zn (Add Audius source)

These were discovered during execution but are PRE-EXISTING failures unrelated to the
Audius adapter work. Per the executor SCOPE BOUNDARY rule they are logged, NOT fixed.

## Pre-existing failing tests (red before this task started)

Confirmed by reverting all Audius source edits and re-running: these still fail.

### `src/lib/services/home-layout.test.ts` — clampShelfSize (3 failures)
- `clamps a too-small value up to SHELF_MIN`
- `passes a valid value through`
- `non-number / NaN / undefined → SHELF_DEFAULT`

**Cause:** The test hardcodes `expect(clampShelfSize(...)).toBe(18)` and `SHELF_DEFAULT`-based
assertions, but `SHELF_DEFAULT` was changed to `16` in commit `09de2d1`
("change DEFAULT_HOME_TAGS, DEFAULT_HOME_COUNTRIES, SHELF_DEFAULT") without updating the test.
Entirely independent of the source-adapter registry. NOT touched by this task.

### `src/lib/services/catalog.test.ts` (3 failures)
- `searchAll (D-06 progressive onPartial) > omitting onPartial leaves the final SearchResult shape unchanged`
- `searchAllUncached inter-source stagger (GAPLESS-PREFETCH) > staggers adapter launches ...`
- `searchAllUncached inter-source stagger (GAPLESS-PREFETCH) > aborting during the stagger window ...`

**Cause (onPartial test):** asserts the enabled-source set equals exactly
`['joox','kuwo','netease','qq']`, but `jamendo` was already flipped to
`enabledByDefault: true` (its file comment still says `false`) BEFORE this task, so the
assertion was already stale/red. Adding `audius` (also `enabledByDefault: true`) extends the
observed set but did not turn a green test red — it was already failing.

**Cause (stagger tests):** timer/`vi.useFakeTimers`-based GAPLESS-PREFETCH assertions that time
out at ~5s; unrelated to the source set. Pre-existing.

**Recommendation:** A separate cleanup task should (a) update `home-layout.test.ts` to the
current `SHELF_DEFAULT=16`, and (b) update `catalog.test.ts` expectations to reflect the
current default-enabled source set (now includes jamendo + audius), or make those tests pin an
explicit `prefs`/`sources` set rather than relying on `enabledByDefault` drift.
