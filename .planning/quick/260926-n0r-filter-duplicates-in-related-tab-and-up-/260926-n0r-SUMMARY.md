---
phase: quick-260926-n0r
plan: 01
status: complete
subsystem: dedupe / NowPlaying Related / Up Next
tags: [dedupe, identity, zh-convert, ytmusic, related, up-next]
requires: [src/lib/services/zh-convert.ts t2sConvertLineSync + warmT2S]
provides: [cross-script + ytmusic-suffix + bilingual + own-artist-prefix song identity in dedupe key()]
affects: [dedupeBest, sameSongKey, groupVariants — every caller incl. Up Next queueWithAnchor, NpRelated, fallback WR-06 gate 1, catalog, version picker]
tech-stack:
  added: []
  patterns: [per-character t2s fold for identity (not per-line), qualifier-tail guard]
key-files:
  created: []
  modified:
    - src/lib/services/dedupe.ts
    - src/lib/services/dedupe.test.ts
    - src/lib/components/NpRelated.svelte
    - src/lib/stores/player.svelte.test.ts
decisions:
  - "dedupe key() folds Traditional to Simplified ONE CHARACTER AT A TIME. The t2s phrase table swaps regional vocabulary (緊急聯絡人 → 紧急联系人), so a whole-line fold gives the same title two different keys"
  - "dedupe key() drops a leading '<artist> - ' from the title only when that prefix normalizes to the row's own artist (ytmusic official-video uploads)"
  - "An arrangement tail after a CJK title ('用背脊唱情歌 canon in d') stays a distinct row: it is not a translation"
metrics:
  duration: ~13 min
  completed: 2026-09-26
  tasks: 3
  files: 4
---

# Quick 260926-n0r: Filter duplicates in Related tab and Up Next — Summary

**One-liner:** dedupe's private `key()` now treats five kinds of copy as the same song: Simplified/Traditional twins (folded one character at a time), ytmusic `<CJK> - <english>` titles, bilingual `<Han> <Latin>` titles, and own-artist `<artist> - <title> (official video)` uploads. NpRelated also drops cross-source copies of the playing song. As a result, Related and every Up-Next growth path collapse the live Gareth.T duplicates without any edit to `player.svelte.ts`.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 RED | f6c417f7 | test(quick-260926-n0r): add failing tests for cross-script + bilingual dedupe identity |
| 1 GREEN | 3ec1ca12 | feat(quick-260926-n0r): dedupe key() folds script, ytmusic english suffix and bilingual Latin tail |
| 2 | afecade9 | fix(quick-260926-n0r): Related drops cross-source copies of the playing song |
| 3 RED | c61a09d5 | test(quick-260926-n0r): add failing case for own-artist title prefix from live Gareth.T rows |
| 3 GREEN | e4ee7ab0 | fix(quick-260926-n0r): dedupe key() drops an own-artist '<artist> - ' title prefix |

## What changed

- **`dedupe.ts` `key()`**: title and artist are each folded (only if they contain a Han character) → lowercased → bracket groups dropped → the existing suffix dropped. The title then gets up to three more steps:
  - an own-artist prefix strip;
  - a ytmusic ` - <english>` head, which takes the last ` - `;
  - otherwise, a bilingual Latin tail of at least 2 words.

  Tails made only of qualifier words (`remix`, `live`, `part 2`, …) are never stripped. No new exports. The regexes are linear: the character classes are disjoint and anchored.
- **Cold dict**: while the Traditional→Simplified dictionary hasn't loaded yet, `key()` works exactly as before (no fold, no throw) and calls `warmT2S()` so a later call does fold. This is tested with a fresh module via `vi.resetModules()`.
- **`NpRelated.svelte`**: the filter is now `x.uid !== cur.uid && !sameSongKey(x, cur)`.
- **`player.svelte.test.ts`** "Test 2 — WITHOUT that substitution": the fixture now uses a Latin-vs-CJK artist mismatch (`Jay Chou` vs `周杰伦`) and keeps its purpose and all its expects. The fold now bridges the old Traditional-vs-Simplified mismatch, so the old fixture could no longer demonstrate a mismatch.
- **Up Next audit (Task 2 grep)**: the only raw `this.queue = [...this.queue` is `addToQueue` at L2938, a manual insert. Every growth path goes through `dedupeBest`/`queueWithAnchor`: setQueue L2790, setListQueue L2846, ensureAhead L3028/L3064, weaveFreshHistory L4398, weaveManualAfterSeed L4432, regenerate L4481, and the offline queue L5076. The remaining writers are spliceAfterCurrent, restoreToQueue, remove, toggleShuffle, reorderQueue and the persisted restore: all manual or reorder.

## Verification (observed)

- `pnpm exec vitest --run src/lib/services/dedupe.test.ts src/lib/services/zh-convert.test.ts` → **2 files, 79 tests passed**. This includes every existing dedupe case and the blank-key guard.
- RED was confirmed before each GREEN: 16 of 16 new cases failed before the first `key()` change, and the prefix case failed before its fix.
- `pnpm test` → **exit 0, 158 files / 3535 tests passed**.
- `pnpm check` → **exit 0, 0 errors**, 1 existing warning (`NowPlaying.svelte` unused `.subnav.heads span`).
- Task 2 grep: `sameSongKey(x, cur)` appears once in non-comment code.
- Note: an earlier `pnpm test` / `pnpm check` run in this session failed. Both failures were in files from the concurrent quick-260926-mzn session: its RED test imported `./lyric-offset-shared` before that session had written it. Both went green once that session committed. None of those files were touched or staged here.

### Task 3 — live E2E (Gareth.T)

- **How it ran:** I had no browser tools here. Instead, a throwaway vitest script (deleted afterwards) called the real `searchAll('Gareth.T', 1)`, with `VITE_API_BASE` stubbed to the already-running dev server `http://localhost:5173`, so the dev server's `/api/*` edge routes hit live upstreams. It called `dedupeBest` once (the dictionary was possibly cold), waited 2s, then took `out = dedupeBest(r.interleaved)`.
- **Headline numbers:** 115 raw rows; 79 after the first (possibly cold) pass; 75 after the warm pass.
- **First pass found a gap:** it showed pale pink and baby pink still at 2 rows each, because of a `gareth.t - 淺粉紅 … (official video)` row by Gareth.T. I added that row verbatim as a failing test and fixed it (commits c61a09d5 / e4ee7ab0). The table below is the rerun after that fix.

"Gareth" = rows whose artist is Gareth.T. `key()` includes the artist, so other artists' karaoke, cover and fan rows are different recordings and are listed only for completeness.

| Group | raw | out | raw Gareth | out Gareth | Other-artist rows remaining (correctly distinct) |
|---|---|---|---|---|---|
| pale pink (浅粉红/淺粉紅 + plain) | 5 | 1 | 5 | **1** | — |
| baby pink (淺粉紅/浅粉红 + plain) | 5 | 1 | 5 | **1** | — |
| 紧急联络人/緊急聯絡人 | 5 | 1 | 5 | **1** | — |
| 颜色/顏色 | 4 | 1 | 4 | **1** | — |
| 去北极忘记你/去北極忘記你 | 5 | 2 | 4 | **1** | ytmusic lyric video [WCY Collection] |
| 泥菩萨/泥菩薩 | 4 | 3 | 2 | **1** | fivesing 伴奏 [伴奏交给我]; ytmusic lyrics video [Suga Cooky] |
| 玻璃 (no demo) | 13 | 6 | 7 | **1** | 3× fivesing 伴奏; KLAI piano BGM; 玻璃-Gareth T [Jaren NggJj] |
| 用背脊唱情歌 | 8 | 3 | 7 | **2** | live concert [The Show Must Go On] |
| 國際孤獨等級/国际孤独等级 | 3 | 1 | 3 | **1** | — |
| 早到的U | 3 | 2 | 2 | **1** | fivesing 伴奏 [伴奏交给我] |
| 跟悲傷結了帳/跟悲伤结了帐 | 2 | 2 | 1 | **1** | fivesing 垫音伴奏 [伴奏交给我] |

- pale pink and baby pink each end as exactly one row, and they are two different rows: `qq:浅粉红 pale pink` and `qq:浅粉红 baby pink`.
- **One group is still at 2 Gareth.T rows, on purpose:** 用背脊唱情歌 keeps `qq:用背脊唱情歌` and `ytmusic:gareth.t - 用背脊唱情歌 canon in d (lyric video)`. "canon in d" names an arrangement, not a translation of the title, so the row stays distinct; a test (dedupe.test.ts) pins this. If it is actually the same recording, that needs a decision. Merging it would mean stripping arbitrary Latin tails, which would also merge real renditions.
- **Not live-verified:** qq 跟悲伤结了帐 was not in this page-1 search, so the "Related never lists the playing song" case (ytmusic `跟悲傷結了帳 - No More` vs qq) is covered by a unit test (`sameSongKey` === true) and not live. The NpRelated UI filter was not exercised in a browser.

Deduped `out` (source | title), Gareth.T rows only: qq 浅粉红 pale pink · qq 浅粉红 baby pink · qq 玻璃 · qq 用背脊唱情歌 · qq 颜色 · qq 去北极忘记你 · qq 紧急联络人 · qq 泥菩萨 · qq 早到的u · qq 遇上你之前的我 · netease tunnel vision · joox 國際孤獨等級 · joox ⁠我很小朋友 · ytmusic 勁浪漫 超溫馨 - hyperromantic · ytmusic 跟悲傷結了帳 - No More · ytmusic 玻璃 demo - glass demo · ytmusic 你都不知道 自己有多好 - more than you know · ytmusic French Girl in Tokyo · ytmusic Bloom (feat. Kelsey Kuan) · ytmusic 笑住喊 - happy tears · ytmusic gareth.t - 用背脊唱情歌 canon in d (lyric video). The full 75-row list is in the session scratchpad; the rest are other artists (fivesing / jamendo / audius / fan ytmusic uploads).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Whole-line t2s fold changed vocabulary, not just script**
- **Found during:** Task 1 GREEN
- **Issue:** `t2sConvertLineSync('緊急聯絡人')` returns `紧急联系人` and `國際孤獨等級` returns `国际孤独级别`: the phrase table swaps Taiwan vocabulary for Mainland vocabulary, so Traditional and Simplified copies of the same title still keyed differently. 3 of the planned cases failed.
- **Fix:** `foldScript` calls `t2sConvertLineSync` once per Han character. A single character can only hit the character table, so only the script changes. Measured cost: 500 rows in 3.9 ms.
- **Files:** src/lib/services/dedupe.ts · **Commit:** 3ec1ca12

**2. [Plan-directed E2E fix] Own-artist `<artist> - ` title prefix**
- **Found during:** Task 3 (the plan says: a listed group with 2+ rows → failing case → fix key())
- **Issue:** after the planned fix, pale pink and baby pink each still had a Gareth.T row titled `gareth.t - 淺粉紅 pale pink (official video)` / `… baby pink (official video)`.
- **Fix:** strip the leading `<x> - ` from the title only when `x` normalizes to the row's own artist, and only if something is left after it. Negatives pinned in the test: another uploader naming the artist (KLAI) stays distinct, and so does an arrangement tail (`canon in d`).
- **Files:** src/lib/services/dedupe.ts, src/lib/services/dedupe.test.ts · **Commits:** c61a09d5, e4ee7ab0

**3. [Rule 3 - Blocking] Cold-dict test timeout**
- The test's `vi.waitFor(…, { timeout: 5000 })` equalled vitest's default 5s test timeout, so the test gets an explicit `10_000` timeout.

## Assumption Drift (advisory)

- **Found during:** Task 1 GREEN. **Planned:** `t2sConvertLineSync(s)` on the whole string performs a pure script fold. **Actual:** the t2s phrase converter also rewrites regional vocabulary (聯絡→联系, 等級→级别). **Why it matters:** a whole-line fold would have left the plan's own must-have cases (緊急聯絡人, 國際孤獨等級) unmerged. Folding one character at a time is the correct identity fold.
- **Found during:** Task 3. **Planned:** three identity classes cover the listed groups. **Actual:** a fourth class (own-artist-prefixed ytmusic video titles) was needed for pale pink and baby pink to reach 1 row.

## Known Stubs

None.

## Threat Flags

None. There are no new endpoints or trust-boundary surfaces. For T-n0r-01, the looser key only widens WR-06 gate 1; `isAcceptableSubstitute` (gate 2) is unchanged, and ytmusic stays off the resolve floor. For T-n0r-02, all new regexes are anchored or use disjoint character classes, and plain `lastIndexOf`/`indexOf` splits are used.

## Self-Check: PASSED

- FOUND: src/lib/services/dedupe.ts (contains `t2sConvertLineSync`), src/lib/services/dedupe.test.ts (contains `quick-260926-n0r`), src/lib/components/NpRelated.svelte (contains `sameSongKey(x, cur)`), src/lib/stores/player.svelte.test.ts
- FOUND commits: f6c417f7, 3ec1ca12, afecade9, c61a09d5, e4ee7ab0
