---
phase: quick-260926-kvz
plan: 01
status: complete
subsystem: i18n / zh script conversion
tags: [zh-hant, tongwen, s2t, names-cache, share-page, script-lock]
requires: [quick-260926-bxg, quick-260926-hze]
provides:
  - one idempotent Simplified→Traditional (private s2tMerge) behind every exported s2t entry point
  - self-healing zh-Hant name-translation cache (no STORE_VER bump)
  - script-locked visible text on /song/{artist}/{title}, legacy /song/{slug}, /album/{artist}/{name}
  - self-healing zh-Hant lyrics-tr batch cache (no CACHE_VER bump)
affects: [names.dnArtist/dnTitle surfaces, translate.ts resolveZhHant, share landing pages]
tech-stack:
  added: []
  patterns: [lazy-import-in-onMount lock $state + $derived display fields]
key-files:
  modified:
    - src/lib/services/zh-convert.ts
    - src/lib/services/zh-convert.test.ts
    - src/lib/services/translate.ts
    - src/lib/services/translate.test.ts
    - src/lib/stores/names.svelte.ts
    - src/lib/stores/names.test.ts
    - src/routes/(app)/song/[artist]/[title]/+page.svelte
    - src/routes/(app)/song/[artist]/[title]/loader.test.ts
    - src/routes/(app)/song/[slug]/+page.svelte
    - src/routes/(app)/song/[slug]/loader.test.ts
    - src/routes/(app)/album/[artist]/[name]/+page.svelte
    - src/routes/(app)/album/[artist]/[name]/loader.test.ts
decisions:
  - s2tConvertLineSync / s2tConvertLines / lockScriptSync zh-Hant share one private s2tMerge on the raw handles; warmS2T and s2tConvertLines load both dicts
  - zh-Hant name fast path runs before the cache hit and overwrites/deletes stale Chinese keys; STORE_VER stays v2 so paid API translations survive
  - the cold zh-Hant translation path reuses the existing warmLock('zh-Hant') latch (one rev bump), no second latch
  - zh-Hant lyrics-tr localStorage hits re-derive their Chinese positions offline; API lines are kept and CACHE_VER stays v3
metrics:
  duration: ~13 min
  completed: 2026-09-26
  tasks: 4
  files: 12
---

# Quick 260926-kvz: zh-Hant translation path idempotent + share page lock Summary

Every Simplified→Traditional entry point now runs the bxg s2t↔t2s merge, so a JOOX/HK 周杰倫 and a CN 周杰伦 both render 周杰倫 on every dnArtist surface. Poisoned 周杰倫→周傑倫 entries already in `openmusic:name-tr:v2:zh-Hant` get fixed on the first warm render with no network. The share landing pages now script-lock their visible title and artist on the client only.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 5fa3ddb7 | fix(quick-260926-kvz): make every Simplified→Traditional entry point idempotent on already-Traditional text |
| 2 | 293be821 | fix(quick-260926-kvz): zh-Hant translation cache heals raw-s2t entries on the next warm render |
| 3 | acd8bfc0 | fix(quick-260926-kvz): song share page title and artist follow the script lock |
| 4 | caa3beb7 | fix(quick-260926-kvz): zh-Hant lyrics translation cache heals pre-merge batches offline |

## What changed

- **zh-convert.ts:** `hantLockSync` is renamed to `s2tMerge` and rebuilt on the RAW `convertLineSync` / `t2sLineSync` handles, so it cannot recurse. It has two try/catches, so it still never throws. `s2tConvertLineSync` is now just `s2tMerge`. `s2tConvertLines` awaits `allSettled([s2t, t2s])` and runs each line through the merge, falling back to identity per line if s2t is cold. `warmS2T()` now calls `warmScript('zh-Hant')`, which warms both dicts. The COST block notes that a zh-Hant translation user now also downloads the ~22 KB gzip t2s dict. `hantLockSync` no longer appears anywhere in src/ (cross-checked with grep and sed).
- **translate.ts:** comment changes only (the t2s dict cost, and the T-25b-04 parenthetical that is now true).
- **names.svelte.ts:** the zh-Hant fast path now runs BEFORE `m.get(text)`:
  - when it converts to something different and the cached value differs, it overwrites the value and persists;
  - when the input is already Traditional and a cached entry exists, it deletes the entry and persists;
  - it persists only when the map actually changed.
  - If the dicts are cold, it calls `warmLock('zh-Hant')` (the same shared latch, one `rev++`) and falls through to the existing cache and queue code.
  - `warm()` now uses `this.warmLock('zh-Hant')` too, and the `warmS2T` import is removed. `STORE_VER` is still `'v2'`.
- **Share pages:** each page has a `lock` `$state` that is bound by a lazy `import('$lib/stores/names.svelte')` inside onMount (a single line, so the loader.test.ts onMount regex still matches). The display fields `shownTitle` / `shownName` / `shownArtist` are `$derived` from it. Resolution still uses the raw values in the /api/og coverSrc, arriveShared / replayShared and the album forward target. The album landing binds `lock` in the same `.then` that runs the hze `lockUrl` forward, so there is only one import.

- **translate.ts, Task 4 (orchestrator follow-up):** a zh-Hant `localStorage` hit in `translateLinesEx` now goes through a private `healZhHantBatch` before `mem.set`:
  - it recomputes every non-blank Chinese position offline and leaves API-translated positions untouched;
  - it writes storage back only when something changed, and still returns all flags true with `complete: true`;
  - the mem-hit branch is unchanged, and `CACHE_VER` is still `'v3'`.

## Verification (observed)

- Task 1 RED: 3 new tests failed before the change (s2tConvertLineSync idempotence, s2tConvertLines batch, warmS2T warming both dicts). The s2t-cold test passed as expected because it is a regression guard. Targeted suite (zh-convert, translate, lyric-script, entity-href, names): 139/139 passed.
- Task 2 RED: the heal test and the cold→warm heal test failed before the change. The idempotence test and the warm()-both-dicts test already passed, because Task 1's converter covers them; they stay as regression guards. names.test.ts: 53/53 after the change.
- Task 3: the three loader tests passed 47/47, including the existing onMount checks (playNow appears exactly once, no `.play(` / `.toggle(`).
- Task 4 RED: the heal test failed before the change (served 周傑倫). The clean-batch, non-zh-Hant and s2t-failure tests passed as guards. translate + names: 73/73 after the change.
- Full gate before each commit:
  - `pnpm test`: 153 files, 3399 → 3403 → 3412 → 3416 tests passed
  - `pnpm check`: 0 errors, 0 warnings, 4606 files
  - `pnpm build`: exit 0 (adapter-cloudflare done)
- No browser spot check was run (the orchestrator runs E2E).

## Deviations from Plan

- **[Scope addition, orchestrator addendum]** Applied the same lock pattern to the legacy `/song/[slug]` page and the `/album/[artist]/[name]` landing, and added source guards to both loader tests. The album test had no source guard before, so this adds one along with a `readFileSync` import. Both are in commit acd8bfc0.
- **[Rule 1, Task 4]** The heal uses `warmScript('zh-Hant')` plus per-line `s2tConvertLineSync`, not `s2tConvertLines` as the follow-up message specified.
  - `s2tConvertLines` returns identity when the s2t dict fails to load, so a chunk failure would have overwritten a good cached Traditional value with the untranslated Simplified original, and persisted it.
  - The sync call returns null in that case, and null keeps the cached value. A dedicated test pins this.
  - When the dicts are warm, the output is identical to what `s2tConvertLines` would give.
  - I also added a guard: a stored value that is not an array, or whose length differs from the batch, is served as-is. localStorage is user-writable.
- Otherwise the plan was executed as written.

## Known ceilings

- **lyrics-tr batch cache: HEALED (Task 4, caa3beb7).** Pre-merge zh-Hant batches under `openmusic:lyrics-tr:v3:zh-Hant:<hash>` are fixed offline the first time each one is read in a session. This needs no `CACHE_VER` bump and no network, and API-translated lines are kept. As a result, the names cold-flush re-poison path is gone too. Remaining edge: if the s2t dict fails to load, the stale value is served for that session (never downgraded), and the next load heals it.
- **One cold render:** with the dicts cold, the first render of a poisoned name can still show the stale cached value. The `warmLock` rev bump repaints it.
- **Per-render merge cost:** the fast path runs 3 tongwen passes per Chinese name per render instead of a Map hit. This is the same cost class as `applyLock`. It is marked with a `ponytail:` note: a verified-key Set can restore the Map hit if profiling ever shows this is hot.
- **Album landing `!data.name`:** this early-return path never binds the lock. That page is unreachable-in-practice and would sit on "Opening album…" anyway.

## Threat Flags

None. There is no new network, auth or storage surface. The share-page text still renders through Svelte interpolation, with no `{@html}`.

## Self-Check: PASSED

- All 11 modified files exist. Commits 5fa3ddb7, 293be821 and acd8bfc0 are present on claude/festive-kapitsa-dac746, and nothing was pushed.

## Orchestrator E2E (worktree dev server :4321, rebased onto main 847a8aeb) — hashes above are post-rebase

- Seeded the real-user poison `openmusic:name-tr:v2:zh-Hant` = {"周杰倫":"周傑倫","Coral Sea":"珊瑚海"}, artistLang 繁體 + lock 繁體, fresh load → dnArtist('周杰倫') = 周杰倫, dnArtist('周杰伦') = 周杰倫; persisted cache now {"Coral Sea":"珊瑚海","周杰伦":"周杰倫"} (poison deleted, API entry kept).
- Song share page `/song/周杰伦/晴天` under 繁體 → bar `/song/周杰倫/晴天`, tab `晴天 • 周杰倫`, body artist 周杰倫 (0× 周傑倫, 0× 周杰伦).
- Search 周杰伦 with artistLang 繁體 → 87× 周杰倫; the only 2× 周傑倫 are a fivesing upload whose RAW artist is literally `周傑倫` (+ the tile derived from it) — source spelling kept by design (傑 is a real Traditional char, e.g. 林俊傑).
- Gate on the rebased tree: 153 files / 3416 tests; check 0 errors, 1 warning = `.subnav.heads span` unused selector in NowPlaying.svelte from main's 847a8aeb (not this task); build exit 0.
