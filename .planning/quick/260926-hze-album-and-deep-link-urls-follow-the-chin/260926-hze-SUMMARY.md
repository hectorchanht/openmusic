---
phase: quick-260926-hze
plan: 01
status: complete
subsystem: routing / i18n script lock
tags: [zh-script-lock, urls, lastfm, favourites, history-api]
requires: [quick-260926-hl9, quick-260926-bxg]
provides:
  - lockEntityHref (pure same-app /artist|/album|/song href script locker)
  - names.lockUrl(href)
  - getAlbumTracklist Chinese-title script rescue
  - self-warming favourite-artist fold (library.foldRev)
  - (app) layout afterNavigate address-bar rewrite
  - syncTabUrl(param, value, defaultValue) from the live address bar
affects:
  - src/routes/(app)/+page.svelte (3 chart-album taps)
  - src/routes/(app)/artist/[name]/+page.svelte (album tap, favourite heart)
  - src/routes/(app)/artist/[name]/albums/+page.svelte (album tap, tab sync)
  - src/routes/(app)/album/[artist]/[name]/+page.svelte (legacy share forward)
  - src/routes/(app)/charts/top/+page.svelte (tab sync)
tech-stack:
  added: []
  patterns: [injected-lock pure module, raw history.replaceState address-bar rewrite, runes rev counter + plain-field latch]
key-files:
  created:
    - src/lib/services/entity-href.ts
    - src/lib/services/entity-href.test.ts
  modified:
    - src/lib/stores/names.svelte.ts
    - src/lib/stores/names.test.ts
    - src/lib/services/lastfm.ts
    - src/lib/services/lastfm.test.ts
    - src/lib/stores/library.svelte.ts
    - src/lib/stores/library.svelte.test.ts
    - src/lib/services/url-tab.ts
    - src/lib/services/url-tab.test.ts
    - src/routes/(app)/+layout.svelte
    - src/routes/(app)/+page.svelte
    - src/routes/(app)/artist/[name]/+page.svelte
    - src/routes/(app)/artist/[name]/albums/+page.svelte
    - src/routes/(app)/album/[artist]/[name]/+page.svelte
    - src/routes/(app)/charts/top/+page.svelte
decisions:
  - Only the `artist` query param is locked; ids and control params pass through as written
  - Unchanged path segments keep their original raw text (no URL-parser re-encoding)
  - getAlbumTracklist tries the other script(s) sequentially, only on a Chinese-title miss
  - enrichAlbum deliberately not rescued (Deezer supplies the hero cover in both scripts)
  - Any Chinese favourite warms the ~22 KB t2s dict even with the lock off
metrics:
  duration: ~8 min
  completed: 2026-09-26
  tasks: 3
  commits: 5
---

# Quick 260926-hze: Album and deep-link URLs follow the Chinese script lock

Album titles, chart-album links, and typed or received entity URLs now follow the script lock. A pure injected-lock `lockEntityHref` sits under `names.lockUrl`, a raw-`replaceState` rewrite in `afterNavigate` fixes the address bar, and Last.fm album-title lookups retry in the other script so a reloaded locked URL still gets its tracklist. Favourite-artist hearts now match across scripts with the lock off.

## Commits

| Task | Gate | Commit | Message |
|------|------|--------|---------|
| 1 | RED | 4a93f632 | test(quick-260926-hze): add failing tests for lockEntityHref, names.lockUrl, Last.fm title rescue |
| 1 | GREEN | 6be59a31 | feat(quick-260926-hze): lockEntityHref + names.lockUrl + Last.fm album-title script rescue |
| 2 | RED | 0c8faefb | test(quick-260926-hze): add failing tests for the self-warming favourite fold |
| 2 | GREEN | c653a5eb | feat(quick-260926-hze): album links follow the script lock + self-warming favourite fold |
| 3 | — | 815ebbdf | feat(quick-260926-hze): typed and received links follow the script lock |

## Verification (observed)

- Task 1 RED: entity-href.test.ts failed to import (module missing); 2 names + 2 lastfm cases failed. GREEN: the 3 targeted files passed, 90/90.
- Task 2 RED: 3 new library cases failed (`foldRev` undefined). GREEN: library.svelte.test.ts passed, 38/38. All 8 grep gates passed. The three "0" gates were cross-checked with Python `str.count` (all 0), and the chart-album wrap count was 3.
- Task 3: url-tab.test.ts passed, 12/12. All 6 grep gates passed. `syncTabUrl(page.url` was cross-checked with Python and is 0 in both files.
- Full gate after each GREEN commit:
  - After Task 1: `pnpm test` 153 files / 3392 tests passed; `pnpm check` 0 errors, 0 warnings; `pnpm build` done.
  - After Task 2 and Task 3: `pnpm test` 153 files / 3395 tests passed; `pnpm check` 4606 files, 0 errors, 0 warnings; `pnpm build` (adapter-cloudflare) done.
- Browser spot checks: skipped as instructed (the orchestrator runs E2E).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Real-converter round-trip fixtures used a title tongwen does not convert**
- **Found during:** Task 1 GREEN
- **Issue:** The plan's round-trip and names.lockUrl cases expected `lockScriptSync('范特西', 'zh-Hant')` to give 範特西. Probing the real converter showed 范特西 → 范特西: 范 is a valid Traditional surname character, so tongwen s2t keeps it. The zh-Hans direction 範特西 → 范特西 does work.
- **Fix:** The zh-Hant round trip in entity-href.test.ts and names.test.ts now uses 十一月的萧邦 ↔ 十一月的蕭邦, which converts in both directions. A 範特西 → 范特西 zh-Hans assertion was added. The fake-lock cases and all lastfm rescue cases are unchanged; lastfm uses the stubbed fetch and only needs the zh-Hans fold for 範特西.
- **Files modified:** src/lib/services/entity-href.test.ts, src/lib/stores/names.test.ts
- **Commit:** 6be59a31

## Assumption Drift (advisory)

- **Found during:** Task 1
- **Planned:** with the lock on 繁體, an album href for 范特西 becomes /album/範特西.
- **Actual:** it stays /album/范特西, because the real s2t keeps 范 as a valid Traditional form. The artist param still becomes 周杰倫.
- **Why it matters:** the must-have "Lock = Traditional … Traditional title" holds for titles tongwen converts (十一月的萧邦 → 十一月的蕭邦). 范特西 is left as-is by the converter, not by this code. Reloads still resolve: 范特西 is Last.fm's canonical title, and a 範特西 URL (for example from a Traditional upstream) is rescued to 范特西 by getAlbumTracklist.

## Known Stubs

None.

## Threat Flags

None. The new surface (the address-bar rewrite and up to 2 extra Last.fm GETs) is covered by T-hze-01 to T-hze-05 in the plan.

## Self-Check: PASSED

- FOUND: src/lib/services/entity-href.ts, src/lib/services/entity-href.test.ts
- FOUND commits: 4a93f632, 6be59a31, 0c8faefb, c653a5eb, 815ebbdf

## Orchestrator follow-up + E2E (browser, worktree dev server :4321, real upstreams, LASTFM key via temporary .dev.vars symlink — removed after)

Orchestrator fix `fix(quick-260926-hze): browser-tab title follows the script lock on entity routes` — E2E found the TAB TITLE still unlocked on foreign-link landings (route `<title>` comes from `og.title`, built from the route name as navigated). Locked in the root layout's existing `document.title` effect (no-track branch), not PageOg (PageOg renders on the store-free SSR share-landing routes).

E2E, all PASS:
- 繁體 lock, typed `/artist/周杰伦` → address bar `/artist/周杰倫`, h1 周杰倫, tab 周杰倫, 30 songs.
- 简体 lock, received `/album/十一月的蕭邦?artist=周杰倫` → bar `/album/十一月的萧邦?artist=周杰伦`, 12 tracks; RELOAD of the rewritten URL (萧邦 = Last.fm miss) → title rescue → 12 tracks, rows 夜曲 / 蓝色风暴 / 发如雪.
- `see all albums` → `/artist/周杰倫/albums`; Singles tab → `/artist/周杰倫/albums?tab=single` (syncTabUrl keeps the locked name).
- Discography album tap → `/album/周杰倫的床邊故事?artist=周杰倫&mbid=…`, 10 tracks, tab locked.
- Chart album href via live modules: `/album/十一月的蕭邦?artist=周杰倫` → `names.lockUrl` → `/album/十一月的萧邦?artist=周杰伦`; 3 wrapped call sites in the home page.
- Lock OFF, favourite stored 周杰倫, cold load `/artist/周杰伦` → URL untouched (off = no-op), heart Favourited (self-warming fold).
