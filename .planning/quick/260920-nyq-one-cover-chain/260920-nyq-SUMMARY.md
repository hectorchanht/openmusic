---
phase: quick-260920-nyq-one-cover-chain
plan: 01
subsystem: covers
tags: [cover-chain, now-playing, media-session, picker, regression-fix]
requires:
  - src/lib/services/url-safety.ts (hasHttpsScheme, isRenderableCover)
  - src/lib/stores/cover-version.svelte.ts (readCoverByUidOrName, readPinnedCover)
  - src/lib/services/media-session.ts (buildArtwork)
provides:
  - player.displayCover — the ONE now-playing cover reader (pin -> uid -> name -> resolvedCover)
  - resolveTrackChain ranked iTunes -> Deezer -> CN -> YouTube Music
  - resolveHqCover reduced to iTunes -> Deezer (no YouTube Music, no CN)
  - collectCoverCandidates PER_TIER_CAP = 4
affects:
  - NowPlaying hero + carousel cells, Nowbar mini-player, OS media-card artwork
  - the cover picker grid, home/discovery backfill, lazyCover, player heal/upgrade paths
tech-stack:
  added: []
  patterns:
    - layered CSS background (image over gradient) so a DEAD url degrades like a missing one
    - store getter as the single read seam, inverting precedence in one place instead of per-surface
key-files:
  created: []
  modified:
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/Nowbar.svelte
    - src/lib/services/cover-backfill.ts
    - src/lib/services/cover-backfill.test.ts
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
decisions:
  - Cover tier rank is ordered on fetch speed + picture size: iTunes (direct CORS GET, 1200px) -> Deezer (edge-proxied, 1000px) -> CN/qq (best-quality-when-present but slowest and most likely to miss) -> YouTube Music (120px search-shelf thumbnail, often a channel avatar, on a host CN-facing users often cannot load)
  - The HQ per-play upgrade drops the YouTube Music tier entirely rather than gaining a size oracle — a thumbnail's pixel size is not knowable from its URL contract
  - The shared reactive cover cache now LEADS on the now-playing surfaces and resolvedCover is the synchronous seed and last resort
  - resolveShareCover stays byte-identical: the ?ci= carrier grammar is closed and must not track the display chain
metrics:
  duration: ~12 min
  completed: 2026-09-20
  tasks: 4
  commits: 4
  files_changed: 6
---

# quick-260920-nyq: One Cover Chain Summary

One cover resolver everywhere — the shared reactive cache now drives the hero, the Nowbar and the OS
media card through a single `player.displayCover` getter; the auto chain is reranked on fetch speed
and picture size (iTunes -> Deezer -> CN/qq -> YouTube Music last); and a cover URL that fails to
load degrades to the per-song placeholder gradient instead of painting a blank black block.

## What was built

**Task 1 — dead covers degrade (commit `8e4d1f7`).** The placeholder is now a background LAYER, not a
branch. Three CSS painters (NowPlaying hero, the prev/next carousel cells, the Nowbar art) put
`fallbackCover(...)` under `url(...)`. `background-size`/`-position` are single values and already
applied to both layers, so nothing else changed. The Nowbar's cover expression, previously restated
in both the truthiness test and the `url()`, is computed once into `npCover`.

**Task 2 — tier rank (commit `671b797`).** A partial revert of quick-260919-0mw. `resolveTrackChain`
is iTunes -> Deezer -> CN -> YTM; `resolveHqCover` is iTunes -> Deezer with the YTM tier removed
outright; `collectCoverCandidates` orders the same way and caps each network tier at
`PER_TIER_CAP = 4` of 12 tiles. `resolveShareCover`'s body is untouched — only its docblock gained
the note that the `?ci=` grammar is closed and its iTunes -> Deezer subset matching the display
chain's head is coincidence, not coupling. No new module, no new fetch path, no new limiter: it is a
reorder of tiers that already existed. The rank rationale is recorded per tier in the module header.

**Task 3 — one reader (commit `ffa9665`).** `player.displayCover` is the single now-playing cover
read: PIN -> uid -> name (via `readCoverByUidOrName`, which takes the `coverVersion()` dependency) and
`resolvedCover` last. All seven `buildArtwork(...)` call sites plus `syncMetadata` route through it,
`NowPlaying`'s `effectiveCover` is `$derived(player.displayCover)`, and the Nowbar reads it too. The
37-D-02 exception is in the getter: an embedded local-file `data:` cover still outranks the cache,
because it is never written to the https-only cache and would otherwise be displaced by a streaming
version's name-layer art. The write seams (`adoptCover`, `upgradeCoverAsync`, `healCover`) are
untouched — this inverted the READ only.

**Task 4 — tests (commit `2f62047`).** The mocked-tier suite pins the new order end to end, the HQ
subset, the picker cap and the share-chain guard.

## Verification — actual output

| Check | Result |
|---|---|
| `pnpm check` (after each of the 4 tasks) | `4577 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| `pnpm test -- player` | 353 passed (2 files) |
| `pnpm test -- cover-backfill` | 56 passed |
| `pnpm test` (full) | **145 files, 3000 tests, all passed** |
| `git diff` on `resolveShareCover` | docblock only; body byte-identical (inspected) |
| `grep -c 'buildArtwork(this.resolvedCover'` | `0` |

Not verified, and why:

- **No browser/E2E repaint check.** The Browser pane's rAF is frozen (project memory), so the
  layered-gradient repaint and the live cache-write-repaints-the-hero behaviour were reasoned
  through the code and pinned by unit tests, not observed rendering.
- **No live CN/qq tier check.** The netease/qq Meting proxies are blocked in this sandbox. The CN
  tier's position is pinned by mocked-tier tests only.
- **No live YouTube Music / iTunes / Deezer call.** All tiers are mocked in the suite.

## Tests added

| Test | What it pins |
|---|---|
| iTunes tier-1 short-circuit | an iTunes hit issues ZERO `searchAll` — not one, as under YTM-first |
| CN reached on an iTunes+Deezer miss | `ytmCalls() === 0` — the CJK case the user cares about resolves before YTM |
| YTM reached LAST on a triple miss | `ytmCalls() === 1` and the cover caches + notifies |
| per-tier THROW fall-through (iTunes, Deezer, CN) | a throw is a miss, never an escalation past the next tier |
| `resolveHqCover` never offers YTM | YTM HAS a cover and the upgrade still returns `null` — the "never downgrade to a 120px avatar" guard |
| `resolveHqCover` zero `searchAll` on every path | T-26-02-01 fan-out bound holds with the new subset |
| picker per-tier cap | 12 YTM hits + 3 CN hits yields exactly 4 ytmusic tiles, all 3 CN tiles, CN entirely before ytmusic |
| picker 12-cap | own+iTunes+4+4+4 = 14 candidates trims to 12 |
| `resolveShareCover` | `expect(catalog.searchAll).not.toHaveBeenCalled()` — the reorder can never reach the carrier chain |
| `displayCover` precedence (player suite) | the shared cache now wins over `resolvedCover` |
| `displayCover` data: exception (player suite) | an embedded `data:` cover survives a conflicting cache entry all the way to `buildArtwork` |

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Two pre-existing tests would have hit the real network after the reorder**
- **Found during:** Task 4
- **Issue:** `resolveCoverForTrack`'s "returns a SOLID https URL" test and `backfillCovers`' "caps the
  track fan-out to `max`" test mocked only `searchAll`, relying on YTM being tier 1 to short-circuit
  before the unmocked `itunesSongCover`. With iTunes promoted to tier 1 those tests would have called
  the real iTunes endpoint from the suite.
- **Fix:** mocked `itunesSongCover` in both, and changed the `max` assertion to count the tier-1
  resolver (iTunes) rather than YTM calls, which are now 0 on that path.
- **Commit:** `2f62047`

**2. [Rule 1 - Bug] Two player tests asserted the precedence T3 deliberately inverts**
- **Found during:** Task 3
- **Issue:** `pnpm test -- player` failed 2/352. Both failures are the intended swap:
  `resolvedCover still WINS over the cache` is the old rule, and a `not.toHaveBeenCalled()` on the
  uid-cache mock no longer holds because `displayCover` consults the cache on every play by design.
- **Fix:** the precedence test is inverted with a comment explaining that the old precedence WAS the
  bug; the call-count assertion is replaced by a stronger one — seed the cache with a DIFFERENT URL
  and assert play()'s synchronous seed still takes `track.cover`. A new test pins the `data:`
  exception. Both plan-anticipated ("update THAT expectation ... with a `quick-260920-nyq` comment").
- **Commit:** `ffa9665`

### Deferred (out of scope, logged not fixed)

`TrackMenu.svelte:168` (`activeCover`) and `download-track.ts:225` still lead with
`player.resolvedCover` for the playing song. Not named by the plan, and swapping them changes which
tile the picker pre-selects and which art gets embedded into downloaded files — a behaviour decision,
not a refactor. Recorded in `deferred-items.md` beside this summary with the one-line fix.

## Assumption Drift (advisory)

**1. "12 tiles / 3 multi-hit tiers" — the cap can still overflow the grid**
- **Found during:** Task 4
- **Planned:** `PER_TIER_CAP = 4` described as "12 tiles / 3 multi-hit tiers", implying the caps sum
  to exactly `MAX_CANDIDATES`.
- **Actual:** own (1) + iTunes (1) + 3 x 4 = 14, so `MAX_CANDIDATES` still trims. Both gates are
  needed and both are now tested; nothing had to change in the implementation.
- **Why it matters:** a reader could otherwise conclude `MAX_CANDIDATES` became dead code and remove
  it, at which point the grid would silently grow to 14 tiles.

## Threat surface

No new network endpoint, auth path, file access or schema change. `T-nyq-01`/`T-nyq-02` hold as
planned: the layered background paints the same cover string every producer already gates on
`hasHttpsScheme`, and the gradient layer is computed, not upstream data; `buildArtwork` still routes
non-https to `/favicon.svg` and admits `data:` only through `isRenderableCover`'s `image/` base64
allowlist. `T-nyq-03` is now asserted directly (`searchAll` never called from `resolveShareCover`).
No dependencies added or changed.

## Commits

| Task | Commit | Message |
|---|---|---|
| 1 | `8e4d1f7` | `fix(quick-260920-nyq): a dead cover url degrades to the gradient, not a black block` |
| 2 | `671b797` | `fix(quick-260920-nyq): rank the cover chain on fetch speed and picture size` |
| 3 | `ffa9665` | `fix(quick-260920-nyq): one cover reader for the hero, the Nowbar and the media card` |
| 4 | `2f62047` | `test(quick-260920-nyq): pin the cover tier order, the HQ subset and the picker cap` |

Not pushed — the remote auto-deploys production.

## Self-Check: PASSED

All 6 modified source files, the SUMMARY and `deferred-items.md` exist on disk; all 4 commit hashes
resolve in `git log`; `get displayCover()` and `PER_TIER_CAP` are present in their stated files.
