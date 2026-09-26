---
phase: quick-260925-wa7
plan: 01
subsystem: resolution
tags: [resolveStub, name-rescue, ytmusic, itunes, t2s, cache]
requires:
  - src/lib/services/discovery.ts resolveStub (t2s rescue-on-miss precedent, quick-260808-urx)
  - /api/ytmusic/search edge route
  - apiFetch governor (32-D-13 absolute-URL passthrough)
provides:
  - innerTubeLocale(hl) allowlist + 4-arg searchInnerTube (hl=en|zh-TW on /api/ytmusic/search)
  - src/lib/services/name-rescue.ts (pure predicates, pairing, cache, lookupChineseName)
  - resolveStub Latin weak/miss rescue
affects:
  - every resolveStub caller (playStub, radio, share pages, long-press menus, album batch resolve, DownloadControl, fallback)
tech-stack:
  added: []
  patterns: [never-throw service, read-side TTL + write-side cap localStorage cache, call-count-pinned tests]
key-files:
  created:
    - src/lib/services/name-rescue.ts
    - src/lib/services/name-rescue.test.ts
  modified:
    - src/lib/proxy/ytmusic-innertube.ts
    - src/lib/proxy/ytmusic.ts
    - src/lib/proxy/ytmusic.test.ts
    - src/routes/api/ytmusic/search/+server.ts
    - src/lib/services/match-key.ts
    - src/lib/sources/ytmusic.ts
    - src/lib/services/discovery.ts
    - src/lib/services/discovery.test.ts
decisions:
  - "YTM pass 2 accepts only a zh artist that YTM itself localized from the query artist in the same response (live probe: a title-only pass 2 accepted uploader covers and blocked the iTunes stage)"
  - "The rescue re-search ranks only rows that strongly match the Chinese names (live probe: with QQ absent a piano cover tied a strong row on scoreMatch and won the stable max)"
  - "A thrown rescue re-search returns the original weak hit, not null (never worse)"
metrics:
  duration: ~16 min
  completed: 2026-09-25
  tasks: 3
  files: 10
---

# Quick 260925-wa7: Rescue English / romanized Chinese-song names in resolveStub

`resolveStub` now rescues a CJK-free query whose first search finds nothing or only a weak match. It looks up the Chinese names (YouTube Music hl=en and hl=zh-TW joined by videoId, then client-side iTunes HK and US stores joined by trackId), re-searches once with the Simplified names, and keeps the result only if it strongly matches. The lookup outcome is cached in localStorage. A strong first hit and every CJK query still cost exactly one search and zero lookups.

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 | Allowlisted `hl` locale on the ytmusic edge search (`innerTubeLocale`, 4-arg `searchInnerTube`, route forwards to both filter POSTs) | 9715af4 |
| 2 | Pure name-rescue module: `isStrongMatch` / `cleanTitle` / `pairYtmRows` / `pairItunes` + bounded cache `openmusic:name-rescue:v1`; `norm` and `parseSearchEnvelope` exported unchanged | 8b3b81a |
| 3 | `lookupChineseName` orchestrator + `resolveStub` wiring (`rescueLatin`), call-count-pinned tests | f907f02 |

Each commit was made only after `pnpm test && pnpm check && pnpm build` passed. Final run: 152 test files, 3301 tests passed; svelte-check 0 errors, 0 warnings; the cloudflare build finished. Nothing was pushed.

## Live smoke (observed 2026-09-25, dev server :5173, real upstreams)

I ran the real code in vitest with `VITE_API_BASE=http://localhost:5173`, so `/api/*` went through the running dev server and iTunes was fetched directly. The localStorage stub started empty.

`lookupChineseName` results (after the fixes below):
- `Jay Chou / Coral Sea` → `{周杰倫, 珊瑚海}` (YTM stage rejected, iTunes HK↔US accepted; 5 fetches)
- `Eric Chou / Zai Ai Ni` → `{周興哲, 再愛你}` (YTM stage)
- `Eric Chou / Graduation ("Mom, Don't Do That!" TV Series Theme Song)` → `{周興哲, 最後一堂課}` (YTM stage)
- `lullaboy / someone like u` → `null`
- `Jay Chou / Mojito` → `{周杰倫, Mojito}`; `Joker Xue / The Actor` → `{薛之謙, 阿蘭, 劉宇寧, 白舉綱 & 袁成傑, 演員}`

`resolveStub` end to end (lookup fetches counted through an apiFetch passthrough spy):
- `Jay Chou / Coral Sea` → **qq 珊瑚海 / 周杰伦** (lookup fetches 5). Before this change it returned `Coral Sea (Chillout Mix) / Black Pearl`. A re-tap made **0** lookup fetches, served from the cache.
- `lullaboy / someone like u` → netease `someone like u / lullaboy`, lookup fetches **0** (no rescue)
- `Bones & The Boy / Good In Me` → ytmusic `Good In Me / Bones & The Boy`, lookup fetches **0**
- `Eric Chou / Zai Ai Ni` → ytmusic `再愛你 - Zai Ai Ni / Eric Chou`, lookup fetches 0. The first search is already strong (see Assumption Drift).
- `Eric Chou / Graduation (…)` → ytmusic `最後一堂課 (…) - Graduation (…) / Eric Chou`, lookup fetches 0. Also already strong.
- `Joker Xue / The Actor` → netease `演员 (Live) / 薛之谦/阿兰/刘宇宁/白举纲/袁成杰` (rescued, 6 lookup fetches)

Route check: `curl '/api/ytmusic/search?q=Eric%20Chou%20Zai%20Ai%20Ni&hl=zh-TW'` contained `周興哲` 74 times, and the `hl=en` variant contained `Zai Ai Ni` 27 times.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] YTM pass 2 accepted uploader covers, which blocked the iTunes stage for Coral Sea**
- **Found during:** Task 3 live smoke
- **Issue:** The plan's title-only pass 2 accepted `周杰倫 Jay Chou & 梁心頤 Lara 珊瑚海 Coral Sea 純鋼琴 #YIMUZIC / 張義 YImuzic`, a Videos-shelf upload whose bilingual title contains the query title. Because of that, stage 2 never ran, and the wrong pair would have been cached for 30 days. It also accepted `Room 68` for lullaboy.
- **Fix:** Pass 2 now requires the zh artist to be one that YTM itself localized from the query artist on some row of the same response. For example, the official video `kYhh1PpsOg4` is en `Jay Chou` and zh `周杰倫`. Uploader names never localize, so they are rejected. On live data Mojito is still rescued, and in fact pass 1 pairs its official video `-biOGdYiF-I`. The plan's single-row Mojito fixture now returns null because it has no artist evidence. A localizing row was added to the accept fixture, plus a live-derived uploader-rejection fixture.
- **Files:** src/lib/services/name-rescue.ts, name-rescue.test.ts. **Commit:** f907f02

**2. [Rule 1 - Bug] The re-search's top-row-only strong check threw away a present strong row**
- **Found during:** Task 3 live smoke (Coral Sea still resolved to the weak original)
- **Issue:** With QQ missing from a fan-out, scoreMatch tied `珊瑚海 (钢琴版) … / 纪钧瀚` with `珊瑚海 / 周杰倫, 梁心頤` at 4, and the stable max picked the cover. The plan's `attempt()` → `isStrongMatch(top)` check then rejected the rescue.
- **Fix:** `attempt()` takes an optional `accept` filter, and `rescueLatin` passes the strong-match predicate, so the one re-search ranks only acceptable rows. Existing call paths pass no filter and behave exactly as before. A new test fails under a mutation that disables the filter (verified).
- **Files:** src/lib/services/discovery.ts, discovery.test.ts. **Commit:** f907f02

**3. [Rule 2 - Correctness] A thrown re-search returns the original weak hit, not null**
- The plan allowed "null-or-original". I chose original, via `rescueLatin(...).catch(() => null) ?? hit`, because the truth "the rescue never makes a resolve worse" rules out null. The test asserts the original row.

**4. [Rule 3 - Test hygiene] File-level `lookupChineseName` stub in discovery.test.ts**
- Pre-existing Latin-miss tests (for example `Adele / Hello`) would now run the real lookup, which means real iTunes network calls from a unit test. A file-level `beforeEach` defaults the spy to `null`. The existing quick-260808-urx tests are otherwise unchanged and green. Their title "zero extra cost" still holds for `searchAll`, but a Latin miss now spends one (cached) lookup by design.

**5. [Rule 2] `lookupChineseName` returns null without fetching when `norm(title)` is empty** (no pairing could verify anything).

## Assumption Drift (advisory)

- **Found during:** Task 3 live smoke. **Planned:** `Eric Chou / Zai Ai Ni` and `Eric Chou / Graduation` resolve to junk (`左转灯/汪苏泷`, `NCT DREAM`) and need the rescue. **Actual:** the ytmusic source in the `searchAll` fan-out returns YTM's bilingual official row (`再愛你 - Zai Ai Ni / Eric Chou`), which is a strong match, so the rescue does not fire and `resolveStub` returns a **ytmusic** Track. **Why it matters:** per project memory, ytmusic playback from the web edge can be refused by googlevideo (403), so those taps may still fail to play on web and fall through to cross-source fallback. This behaviour predates this task and is out of scope. It is worth a decision on whether `resolveStub` should prefer non-ytmusic rows.
- **Found during:** Task 3. **Planned:** the pass-2 title-only rule was safe. **Actual:** the route merges Songs and Videos shelves, so uploader titles leak in (see deviation 1).

## Notes for the verifier

- As the plan specifies, a transient lookup failure (all hops erroring) is cached as a miss for 1 day. The resolve still falls back to today's result.
- iTunes stays client-side. `grep itunes.apple.com src/lib/proxy` shows only the pre-existing og-cover.ts references, none new.
- Decision-ref comments: discovery.ts 4, name-rescue.ts 9, ytmusic-innertube.ts 2.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/services/name-rescue.ts, src/lib/services/name-rescue.test.ts
- FOUND commits: 9715af4, 8b3b81a, f907f02
