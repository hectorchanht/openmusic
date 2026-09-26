---
phase: quick-260926-hl9
plan: 01
status: complete
subsystem: names / library / artist routing
tags: [i18n, zh-script-lock, routing, favourites]
requires: [quick-260919-2jo zhLock, quick-260926-bxg idempotent zh-Hant lock + warmScript builds both dicts]
provides: [names.artistHref, script-blind library.favKey]
affects: [TrackMenu, NowPlaying, home, charts/top, album, search, library, artist pages]
tech-stack:
  added: []
  patterns: [one shared route builder on the names store; script-fold compare key]
key-files:
  created: []
  modified:
    - src/lib/stores/names.svelte.ts
    - src/lib/stores/names.test.ts
    - src/lib/stores/library.svelte.ts
    - src/lib/stores/library.svelte.test.ts
    - src/lib/components/TrackMenu.svelte
    - src/lib/components/NowPlaying.svelte
    - src/routes/(app)/+page.svelte
    - src/routes/(app)/charts/top/+page.svelte
    - src/routes/(app)/album/[name]/+page.svelte
    - src/routes/(app)/search/+page.svelte
    - src/routes/(app)/library/+page.svelte
    - src/routes/(app)/artist/[name]/+page.svelte
decisions:
  - "Artist URLs use the script lock only (names.zhLock), never translation (dnArtist), so what the artist page resolves stays the same"
  - "library.favKey folds Chinese to Simplified via t2sConvertLineSync; if t2s is cold it falls back to the raw key (the old behaviour)"
metrics:
  completed: 2026-09-26
  tasks: 2
  commits: 2
---

# Quick 260926-hl9: artist URLs follow the Chinese script lock

`names.artistHref(name)` is now the only in-app artist route builder. It runs `'/artist/' + encodeURIComponent(names.zhLock(name))`. All 14 navigation sites call it. Favourite artists now match across scripts, so 周杰伦 and 周杰倫 count as one favourite whenever the t2s dict is warm.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | d616b254 | feat(quick-260926-hl9): names.artistHref + script-blind favourite artists |
| 2 | fa1cd726 | feat(quick-260926-hl9): artist URLs follow the Chinese script lock |

## What changed

- **names.svelte.ts**: new public `artistHref(name)` right after `zhLock`. It applies the script lock only and encodes once. Its reactivity comes from zhLock's `rev` / `zhScript` reads. The doc comment covers OG-COMPAT-01 and explains why share.ts is excluded.
- **library.svelte.ts**: `favKey` = trim + lowercase, then `t2sConvertLineSync` when `isChineseLine`. It imports only zh-convert, so there is no names import and no cycle. `toggleFavArtist` is untouched, so the saved spelling is kept.
- **14 call sites** swept: TrackMenu `gotoArtist`, NowPlaying `openArtistName`, home ×5, charts/top ×1, album back button, search ×2 (suggestion + tile), library favourites, artist page ×2 (see-all albums + related artists). The guards and `overlays.navigateAway` wrappers are unchanged. PageHeader.svelte:16 is a comment and was left alone.
- **Artist page heart**: `$derived(library.isFavArtist(names.zhLock(name)))`. When the lock dict finishes loading on a cold deep link, the heart re-derives.
- **Comments**: both TrackMenu comments now say "RAW name through the script lock only, never dnArtist". The search suggestion comment and the NowPlaying T-pzs-04 comment were updated too. All existing decision refs are kept.

## Verification (observed)

- RED: 6 new tests failed before the implementation (5 names `artistHref` tests because the method was missing, 1 library Chinese-fav test because 周杰倫 and 周杰伦 gave different keys). The Latin fav test passed on RED, as expected: it pins behaviour that must not change.
- Targeted: `names.test.ts` + `library.svelte.test.ts`: 2 files, 82 tests passed.
- Task 1 gates: `pnpm test`: 152 files / 3366 tests passed; `pnpm check`: 4604 files, 0 errors, 0 warnings; `pnpm build`: adapter-cloudflare done.
- Task 2 plan grep gates: the only non-comment `/artist/` builder left is in names.svelte.ts; there are exactly 14 `names.artistHref(` sites in .svelte files; `isFavArtist(names.zhLock(name))` is present.
- Task 2 gates: `pnpm test`: 152 files / 3366 tests passed; `pnpm check`: 0 errors, 0 warnings; `pnpm build`: done.
- NOT done: the optional browser spot check (address bar showing /artist/周杰倫 under the Traditional lock, heart surviving a lock flip). No browser automation was available to this executor, so live UI behaviour is covered by unit tests only.

## Out of scope (deliberately untouched)

- **share.ts**: share links already carry the display-language name (quick-260808-urx). Not touched.
- **Chart-album hrefs from `home-charts.ts`** (pure service) stay raw.
- **Album TITLES in `/album/` URLs are not locked.** Only the artist segment follows the lock. `discography.ts` `albumHref(entry, name)` needed no change, because on the artist and albums pages `name` is the route param and is already locked.
- **Deep links and received share links in the other script are not rewritten.** A visitor opening /artist/周杰伦 with the Traditional lock stays on that URL. The page resolves the same way either way, and the heart still matches.

## Known ceiling

The `ponytail:` comment on `favKey` covers this: with the lock OFF and t2s never warmed, a favourite saved in the other script is not matched. Upgrade path: call `warmScript('zh-Hans')` in `load()` when `favArtists` contains a Chinese name.

## Deviations from Plan

None. The plan was executed as written. The only extra was a one-line NowPlaying T-pzs-04 comment addendum saying the encode now happens in names.artistHref.

## Threat Flags

None. T-hl9-01 (single encode, `AC/DC` → `/artist/AC%2FDC`) and T-hl9-02 (translateMock never called) are pinned by the new tests.

## Self-Check: PASSED

- d616b254 and fa1cd726 are present in git log on claude/festive-kapitsa-dac746.
- All 12 modified files are present. Neither commit deleted any files.

## Orchestrator E2E (browser, worktree dev server :4321, real upstreams)

- Lock 繁體: search 周杰伦 → artist tile → address bar `/artist/周杰倫` (correct 杰, not 周傑倫), h1 周杰倫, 30 hit songs load.
- Favourited there (stored `周杰倫`), switched lock to 简体, hard-loaded /library?tab=fav-artists → entry shows 周杰伦 → `/artist/周杰伦`, heart **Favourited** (script-blind favKey), 30 rows.
- Cold deep link (hard load straight onto `/artist/周杰伦` under 简体) → heart repaints **Favourited**.
- Only failing /api calls were kuwo 500 / joox 400 on the SIMPLIFIED query too — the worktree has no `.dev.vars` (no JOOX token); unrelated to this change.
