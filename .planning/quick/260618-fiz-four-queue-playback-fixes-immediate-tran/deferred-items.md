# Deferred Items — quick-260618-fiz

Out-of-scope discoveries logged during execution (not caused by this task's changes; left untouched per the scope boundary).

## Pre-existing test failures (full `npx vitest run`)

These 6 failures exist at the base commit (8eb6d14) and are in modules this task never touched
(`src/lib/services/home-layout.ts`, `src/lib/services/catalog.ts`). Verified failing against the
base source for `home-layout.test.ts` (3 failed / 27 passed). Not addressed here.

- `home-layout.test.ts > clampShelfSize > clamps a too-small value up to SHELF_MIN`
- `home-layout.test.ts > clampShelfSize > passes a valid value through`
- `home-layout.test.ts > clampShelfSize > non-number / NaN / undefined → SHELF_DEFAULT`
  (expects `SHELF_DEFAULT === 18`, actual `16` — a stale test constant vs. the source default)
- `catalog.test.ts > searchAll (D-06 progressive onPartial) > omitting onPartial leaves the final SearchResult shape unchanged`
- `catalog.test.ts > searchAllUncached inter-source stagger (GAPLESS-PREFETCH) > staggers adapter launches`
- `catalog.test.ts > searchAllUncached inter-source stagger (GAPLESS-PREFETCH) > aborting during the stagger window stops later adapters`
  (the two stagger tests time out at 5003ms — fake-timer/stagger mismatch, unrelated to queue/lyrics)

The task-relevant suites are green: `player.svelte.test.ts` (121) + `library.svelte.test.ts` (3) = 124 passed.
`npx svelte-check` is clean (0 errors / 0 warnings).
