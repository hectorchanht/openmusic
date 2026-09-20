---
phase: quick-260920-nyq-one-cover-chain
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/Nowbar.svelte
  - src/lib/services/cover-backfill.ts
  - src/lib/services/cover-backfill.test.ts
  - src/lib/stores/player.svelte.ts
  - src/lib/stores/player.svelte.test.ts
autonomous: true
requirements: [QUICK-260920-nyq]

must_haves:
  truths:
    - "A cover URL that fails to load on the NowPlaying hero, the carousel neighbour cells or the Nowbar shows the per-song placeholder gradient, never a blank black block"
    - "The auto cover chain is ranked on fetch speed + picture size: iTunes -> Deezer -> CN/qq -> YouTube Music LAST; each tier fires only when every faster/larger tier above it missed"
    - "The per-play HQ upgrade is iTunes -> Deezer and never issues the YouTube Music tier, so it cannot replace album art with a 120px avatar"
    - "The cover picker grid is mixed: no single network tier fills more than 4 of the 12 tiles, and YouTube Music tiles come last"
    - "The hero, the Nowbar and the OS media-card artwork read the SAME shared reactive cover cache (pin -> uid -> name) every list row reads, so one cache write repaints all of them together"
    - "A user pin still outranks every resolver, an embedded local-file data: cover still outranks the cache, and the share-card ?ci= carrier chain (resolveShareCover) is byte-for-byte unchanged"
  artifacts:
    - path: "src/lib/services/cover-backfill.ts"
      provides: "iTunes -> Deezer -> CN -> YTM resolveTrackChain; iTunes -> Deezer resolveHqCover; per-tier-capped collectCoverCandidates"
      contains: "PER_TIER_CAP"
    - path: "src/lib/stores/player.svelte.ts"
      provides: "displayCover getter — the ONE now-playing cover reader"
      contains: "get displayCover()"
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "layered background (image over gradient) + displayCover-driven hero"
      contains: "player.displayCover"
    - path: "src/lib/components/Nowbar.svelte"
      provides: "layered background + displayCover-driven mini-player art"
      contains: "player.displayCover"
    - path: "src/lib/services/cover-backfill.test.ts"
      provides: "tier-order, HQ-no-YTM, per-tier-cap and share-chain regression tests (mocked tiers)"
      contains: "quick-260920-nyq"
  key_links:
    - from: "src/lib/components/NowPlaying.svelte"
      to: "player.displayCover"
      via: "effectiveCover $derived"
      pattern: "\\$derived\\(player\\.displayCover\\)"
    - from: "src/lib/stores/player.svelte.ts displayCover"
      to: "cover-version.svelte readCoverByUidOrName"
      via: "getter body"
      pattern: "readCoverByUidOrName\\(cur\\.uid, cur\\.artist, cur\\.title\\) \\?\\? rc"
    - from: "src/lib/stores/player.svelte.ts buildArtwork call sites"
      to: "displayCover"
      via: "buildArtwork(this.displayCover)"
      pattern: "buildArtwork\\(this\\.displayCover\\)"
    - from: "cover-backfill.ts resolveTrackChain tier 1"
      to: "itunes-cover.ts itunesSongCover"
      via: "tier(() => itunesSongCover(...)) as the FIRST tier"
      pattern: "itunesSongCover\\(artist, title, signal\\)"
---

<objective>
One cover resolver everywhere. Same song -> same cover on the hero, the Nowbar, the OS media card and every list tile; tier order ranked on fetch speed + picture size (iTunes -> Deezer -> CN/qq -> YouTube Music LAST); a DEAD cover URL degrades to the placeholder gradient instead of a blank black block.

Purpose: fixes the reported "YTMusic cover paints a black block" bug at its root (a truthy-but-dead CSS background-image has nothing underneath it) AND the "same song, different cover in different places" asymmetry (now-playing surfaces led with `player.resolvedCover`; rows led with the shared cache). The user delegated the tier RANK to us; the user's own observation ("qq art is often best but sometimes absent") is honoured by keeping CN/qq as the fall-through that wins exactly on the CJK catalog iTunes and Deezer do not carry.

Output: four edits, one test file extended, `pnpm check` + `pnpm test` green.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@.planning/debug/ytmusic-cover-blank-hero.md
@./CLAUDE.md
@src/lib/services/cover-backfill.ts
@src/lib/services/cover-backfill.test.ts
@src/lib/stores/cover-version.svelte.ts
@src/lib/components/NowPlaying.svelte
@src/lib/components/Nowbar.svelte
@src/lib/stores/player.svelte.ts

<interfaces>
<!-- Already in the codebase. Use directly — no exploration, no new modules (CLAUDE.md "Shared Primitives"). -->

From src/lib/services/url-safety.ts:
  export function hasHttpsScheme(url): url is string      // CACHEABLE / probe-able
  export function isRenderableCover(url): url is string   // https OR data:image/...;base64 (37-D-02)

From src/lib/stores/cover-version.svelte.ts:
  export function readCoverByUidOrName(uid, artist, title): string | null   // PIN -> uid -> name; depends on coverVersion()
  export function readPinnedCover(uid): string | null
  export function bumpCoverVersion(): void

From src/lib/services/cover-backfill.ts (private, reuse as-is — no renames needed):
  async function tier(fn: () => Promise<string | null>): Promise<string | null>   // never-throw + https guard
  async function ytmusicSongCover(artist, title, signal)  // searchAll(term, 1, onlySource('ytmusic')) -> dedupeBest[0].cover
  const MAX_CANDIDATES = 12
  Tier calls already present in resolveTrackChain: itunesSongCover(artist, title, signal), deezerSongCover(artist, title, signal),
  the CN fan-out `searchAll(\`${artist} ${title}\`, 1, {}, signal)` (WR-01 signal threading), ytmusicSongCover(...).

From src/lib/services/media-session.ts:
  export function buildArtwork(cover: string | null): MediaImage[]

Test harness in cover-backfill.test.ts (lines ~72-90): `mockSearch({ ytm?, cn? })` answers `catalog.searchAll` BY PREFS
(`prefs?.ytmusic ? ytm : cn`); `ytmCalls()` / `cnCalls()` count by prefs. This harness is SUFFICIENT for the new order —
no qq-specific mocking is needed because the CN tier is the existing fan-out.

Current now-playing readers (the asymmetry T3 removes):
  NowPlaying.svelte:287  effectiveCover = $derived(player.resolvedCover ?? readCoverByUidOrName(...))
  NowPlaying.svelte:965  style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackCover(player.current)}
  NowPlaying.svelte:376  cellBg: `u ? \`url(${u})\` : fallbackCover(tk)`
  Nowbar.svelte:270      (player.resolvedCover ?? np?.cover) ? `url(...)` : fallbackCover()
  player.svelte.ts:1643  buildArtwork(this.resolvedCover ?? readCoverByUidOrName(cur.uid, cur.artist, cur.title))
  player.svelte.ts       buildArtwork(this.resolvedCover) at ~3610, ~3803, ~4026, ~4080 and inside adoptCover (~4155)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Dead cover degrades to the gradient — layer the placeholder UNDER the image</name>
  <files>src/lib/components/NowPlaying.svelte, src/lib/components/Nowbar.svelte</files>
  <action>
Three CSS-background painters share one defect: `background-image` has no error event and nothing underneath, and the D-12 gradient only fires on a NULL cover, so a truthy-but-DEAD url paints the void (debug session, hypothesis CONFIRMED). Put the gradient under the image as a second background layer at every site — `background-size: cover` / `background-position: center` are single values so they already apply to both layers, and `fallbackCover` is already in scope at each site.

1. NowPlaying.svelte hero (~line 965): `style:background-image={effectiveCover ? \`url(${effectiveCover}), ${fallbackCover(player.current)}\` : fallbackCover(player.current)}`.
2. NowPlaying.svelte `cellBg` (~line 379): `return u ? \`url(${u}), ${fallbackCover(tk)}\` : fallbackCover(tk);`.
3. Nowbar.svelte `.np-art` (~line 270): same shape — `\`url(${cover}), ${fallbackCover()}\`` when a cover exists, else `fallbackCover()`. Compute `player.resolvedCover ?? np?.cover` once into a local const (or a `$derived`) instead of restating it twice (T3 will swap that expression to `player.displayCover`; keep the layering independent of it).

Add ONE `quick-260920-nyq` comment at the hero site explaining dead != missing: a failed load now reveals the gradient instead of black; the placeholder is a layer, not a branch. Do not touch the `{#key effectiveCover}` crossfade or the heal `$effect`. Do not delete the existing D-12 / quick-260915-w4f / quick-260629-nyl comments.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -c 'url(\${effectiveCover}), \${fallbackCover' src/lib/components/NowPlaying.svelte && grep -c 'url(\${u}), \${fallbackCover(tk)}' src/lib/components/NowPlaying.svelte && grep -c ', \${fallbackCover()}' src/lib/components/Nowbar.svelte && pnpm check</automated>
  </verify>
  <done>All three greps return 1; `pnpm check` passes; a cover that fails to load shows the per-uid gradient (verified by reasoning + T4's untouched heal tests — the Browser pane's rAF is frozen so no E2E repaint check is planned).</done>
</task>

<task type="auto">
  <name>Task 2: Tier order ranked on speed + size — iTunes -> Deezer -> CN/qq -> YTM last; HQ upgrade iTunes -> Deezer; picker per-tier cap</name>
  <files>src/lib/services/cover-backfill.ts</files>
  <action>
Partial revert of quick-260919-0mw (a48dbdd), which made a 120x120 YouTube search-shelf thumbnail (often a channel avatar) tier-1 of every cover path and let the "HQ upgrade" downgrade 500-1000px album art into the SHARED name cache. The user delegated the RANK to us, to be decided on fetch speed and picture quality. Record this rationale verbatim (tagged `quick-260920-nyq`) in the module header where the chain is described:
  - iTunes FIRST: CORS-open direct GET (no proxy hop), 1200px artwork — fastest AND largest.
  - Deezer SECOND: edge-proxied `/api/deezer/search`, cover_xl 1000px, reliable.
  - CN/qq THIRD: genuinely high quality when present (the user's observation), but the SLOWEST tier (~2.7s upstream qq detail, measured in project memory) and the one that misses most often, so it must not sit in front of two faster, larger tiers. It still wins exactly where the user saw it winning: CJK tracks that iTunes and Deezer do not carry fall through to it.
  - YTM LAST: 120x120 search-shelf thumbnails, frequently a channel avatar, on a host CN-facing users often cannot load (.planning/debug/ytmusic-cover-blank-hero.md).
All edits in this one file; no new module, no new helper, no new fetch path — this is a pure REORDER of tiers that already exist.

1. `resolveTrackChain`: move the `tier(() => ytmusicSongCover(artist, title, signal))` block from tier 1 to tier 4 (after the CN fan-out). Resulting order, stop at first SOLID:
   Tier 1 iTunes -> Tier 2 Deezer -> Tier 3 CN fan-out (`searchAll(term, 1, {}, signal)`, WR-01 signal threading unchanged) -> Tier 4 YTM.
   Keep the `if (signal?.aborted) return null` after every tier and the final `hasHttpsScheme(cover) ? cover : null`. Do NOT add a qq-only tier: the CN fan-out already contains qq and `dedupeBest(..., settings.preferredSource)` already picks it when present.

2. `resolveHqCover` (the per-play upgrade): Tier 1 `itunesSongCover`, Tier 2 `deezerSongCover` on a miss. YTM is REMOVED from the upgrade entirely: a YTM thumbnail's pixel size is not knowable from its URL contract, so the lazier correct answer to "never replace a larger cover with a smaller one" is to not offer it as an upgrade at all. T-26-02-01 stays honoured: still bounded to the now-playing track, still at most 2 calls, still NEVER the CN fan-out — the one change to that guard's wording is that iTunes (a direct CORS GET, cheaper than the YTM InnerTube POST it replaces) is now allowed; update the docblock and the "no iTunes" phrasing accordingly. Cache-write posture unchanged (uid layer only for a real uid + name layer).

3. `collectCoverCandidates`: reorder the `all` array to `own -> iTunes -> Deezer -> CN -> YTM` (mirrors the chain; CN rows stay self-labelled by source, so qq tiles show as `qq`). Add `const PER_TIER_CAP = 4;` beside `MAX_CANDIDATES` (comment: 12 tiles / 3 multi-hit tiers — keeps the grid mixed; before this, 11-12 of 12 tiles were YTM). Apply it uniformly to each network tier list: `filter(c => hasHttpsScheme(c.url)).slice(0, PER_TIER_CAP)` BEFORE the existing dedupe loop (own is never capped). Keep the existing https + dedupe + MAX_CANDIDATES loop as the final gate.

4. `resolveShareCover`: NO code change. Add one sentence to its docblock: "quick-260920-nyq: the nyq reorder deliberately does NOT reach this function — `coverToken` (share.ts) is a CLOSED `?ci=` host grammar and reordering the display chain silently killed share-card art once already (YTM-first)." (Its iTunes -> Deezer subset now happens to match the head of the display chain; that is coincidence, not coupling — say so, so nobody "deduplicates" it later.)

5. Comments (house style — decision records, never deleted): update every stated order in the module header (lines ~11-24 chain description, ~36-42 rate-limit reasoning, ~60-62), and the `resolveTrackChain` / `resolveCoverForTrack` / `resolveHqCover` / `backfillCovers` / `collectCoverCandidates` docblocks, tagged `quick-260920-nyq`, keeping the `quick-260919-0mw` lines as history ("was YTM-first per 0mw; nyq demoted it to last — see rationale above"). Rate-limit note: tier 1 is again a direct CORS-open iTunes GET that never touches our edge; Deezer/CN/YTM fire only on a miss, so the deep chain runs rarely. Do NOT add a limiter.

SANDBOX NOTE for the executor: CN upstreams (netease/qq Meting proxies) are blocked in this environment; the CN tier cannot be proven live here. Correctness is pinned by T4's mocked-tier tests.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && HQ=$(sed -n '/export async function resolveHqCover/,/^}/p' src/lib/services/cover-backfill.ts) && ! grep -q "ytmusicSongCover" <<<"$HQ" && grep -q "itunesSongCover" <<<"$HQ" && CH=$(sed -n '/^async function resolveTrackChain/,/^}/p' src/lib/services/cover-backfill.ts) && test "$(grep -n 'itunesSongCover' <<<"$CH" | head -1 | cut -d: -f1)" -lt "$(grep -n 'ytmusicSongCover' <<<"$CH" | head -1 | cut -d: -f1)" && grep -c "PER_TIER_CAP" src/lib/services/cover-backfill.ts && pnpm check</automated>
  </verify>
  <done>`pnpm check` passes; `resolveTrackChain` is iTunes -> Deezer -> CN -> YTM; `resolveHqCover` is iTunes -> Deezer with no YTM call; `collectCoverCandidates` caps every network tier at 4 and orders YTM last; `resolveShareCover` body is unchanged (git diff shows only its docblock touched). Existing cover-backfill tests are EXPECTED to fail on the old order until T4 — that is T4's job, not a T2 defect.</done>
</task>

<task type="auto">
  <name>Task 3: One reader everywhere — `player.displayCover` drives hero, Nowbar and OS media card</name>
  <files>src/lib/stores/player.svelte.ts, src/lib/components/NowPlaying.svelte, src/lib/components/Nowbar.svelte</files>
  <action>
Today the hero (`resolvedCover ?? cache`), `syncMetadata` (`resolvedCover ?? cache`), Nowbar (`resolvedCover ?? np.cover`) and five other `buildArtwork(this.resolvedCover)` writes all let the store field LEAD, so a cache write from a sibling surface (up-next lazyCover, home backfill, another tile) never reaches them — the "same song, different cover in different places" the user reports. Rows read the shared cache first. Invert the now-playing side ONCE, at the READ seam, and leave `adoptCover` / `upgradeCoverAsync` / `healCover` (the promotion/write seams) untouched.

1. player.svelte.ts — add a reactive getter next to `resolvedCover` (~line 372), tagged `quick-260920-nyq`:
   `get displayCover(): string | null` —
     `const rc = this.resolvedCover; const cur = this.current; if (!cur) return rc;`
     37-D-02 guard: `if (rc && !hasHttpsScheme(rc) && isRenderableCover(rc)) return rc;` — an embedded local-file `data:` cover is the file's own truth and is never written to the https-only cache, so cache-first would otherwise let a streaming version's NAME-layer art displace it ("embedded first" is a locked decision). Both predicates are already imported (line 101).
     `return readCoverByUidOrName(cur.uid, cur.artist, cur.title) ?? rc;` — PIN -> uid -> name -> resolvedCover. `readCoverByUidOrName` (already imported, line 58) calls `coverVersion()`, so any template/`$derived` reading this getter repaints on every cover write, pin and eviction.
   Docblock: this is THE reader for the now-playing surfaces; `resolvedCover` stays the synchronous seed + the last resort (optimistic stub before the cache has anything, `pendingTrack` with `current === null`). The pin precedence is inherited from `readCoverByUidOrName` (quick-260915-w4f), not re-implemented.

2. player.svelte.ts — replace every `buildArtwork(this.resolvedCover)` (approx. lines 3610, 3803, 4026, 4080, and inside `adoptCover` ~4155) and the `syncMetadata` expression at ~1643 (`this.resolvedCover ?? readCoverByUidOrName(...)`) with `buildArtwork(this.displayCover)`. Use grep to find them all: `grep -n "buildArtwork(this.resolvedCover" src/lib/stores/player.svelte.ts` must return zero afterwards. Update the `syncMetadata` docblock (~1615-1622, "resolvedCover wins when set; else the shared cache") to say the shared cache now leads via `displayCover`. Also update `upgradeCoverAsync`'s docblock (~4034-4040: "issues the YTM tier and, only on a YTM miss, Deezer") to the T2 order (iTunes -> Deezer, no YTM). Leave `if (url === this.resolvedCover) return;` guards alone — they compare against the write seam, correctly.

3. NowPlaying.svelte — `const effectiveCover = $derived(player.displayCover);` replacing the two-branch expression at ~287. Keep the name `effectiveCover` (the `{#key effectiveCover}` crossfade, the heal `$effect` and T1's layering all consume it). Trim the docblock above it: keep the cover-hero-mediacard-missing history, add `quick-260920-nyq: precedence inverted — the shared cache (pin -> uid -> name) now leads and resolvedCover is the last resort, so the hero repaints in lockstep with every tile; the data: exception lives in the getter.` `readCoverByUidOrName` may now be unused in this file — remove it from the import ONLY if `pnpm check` reports it unused (readPinnedCover stays for `cellBg`).

4. Nowbar.svelte — the local const from T1 becomes `player.displayCover ?? np?.cover`; extend the COVER-01 comment with one `quick-260920-nyq` line.

5. Run `pnpm test -- player` after the swap. `player.svelte.test.ts` has ~93 `resolvedCover`/`artwork` references; because `play()` writes `resolvedCover` into the uid cache synchronously (Site A) the two normally agree, so most assertions hold. Where a test seeded the cache with a DIFFERENT https cover for the current uid and asserted the media-card artwork equals `resolvedCover`, the new precedence is the intended behaviour: update THAT expectation to the cached value with a `quick-260920-nyq` comment. Do not weaken unrelated assertions; if a failure is not explained by the precedence swap, stop and report it instead of patching the test.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && test "$(grep -c 'buildArtwork(this.resolvedCover' src/lib/stores/player.svelte.ts)" = "0" && grep -c 'get displayCover()' src/lib/stores/player.svelte.ts && grep -c '\$derived(player.displayCover)' src/lib/components/NowPlaying.svelte && grep -c 'player.displayCover' src/lib/components/Nowbar.svelte && pnpm check && pnpm test -- player</automated>
  </verify>
  <done>Zero `buildArtwork(this.resolvedCover` sites remain; hero, Nowbar and every media-card write read `displayCover`; pin still outranks everything (via readCoverByUidOrName), `data:` embedded covers still outrank the cache; `pnpm check` and the player test suite pass.</done>
</task>

<task type="auto">
  <name>Task 4: Tests — tier order, HQ-no-YTM, share-chain guard, picker cap (mocked tiers, node-only)</name>
  <files>src/lib/services/cover-backfill.test.ts</files>
  <action>
Extend the existing file (do not add a new one). Vitest is node-only, no jsdom, no network — every tier is mocked. The CN tier cannot be proven live in this sandbox (CN proxies blocked), which is exactly why the order is pinned here. The existing `mockSearch({ ytm, cn })` / `ytmCalls()` / `cnCalls()` harness is sufficient — keep it; update the file header comment to the new order and the speed+size rationale (one line, tagged `quick-260920-nyq`).

1. `backfillCovers` describe: rename to `iTunes -> Deezer -> CN -> YTM track chain (quick-260920-nyq)`; rewrite the tier tests to the new order: iTunes hit short-circuits (0 Deezer, `searchAll` NOT called at all — neither CN nor YTM); iTunes miss -> Deezer (still 0 `searchAll`); iTunes+Deezer miss -> CN (`cnCalls()` = 1, `ytmCalls()` = 0); three-miss -> YTM hit caches + notifies (`ytmCalls()` = 1); all four miss -> gradient (no cache, no notify); per-tier THROW fall-through for iTunes, Deezer and CN; non-https fall-through; negative-miss, skip-cached and `max` cap tests keep their intent (adjust expected call counts).

2. `resolveCoverForTrack`: update the order test to "falls through to Deezer on an iTunes miss, no searchAll issued" and add an assertion that `ytmCalls()` is empty on any path that resolves before tier 4.

3. `resolveHqCover` describe: rename to `iTunes -> Deezer HQ upgrade (no YTM, no CN) (quick-260920-nyq)`. Tests: iTunes hit short-circuits (0 Deezer, 0 `searchAll`); iTunes miss -> Deezer (worst case 2 calls, still 0 `searchAll`); `ytmCalls()` and `cnCalls()` are EMPTY in every case even when YTM would have a cover — feed `mockSearch({ ytm: [track-with-yt3-120-cover] })` with iTunes+Deezer missing and assert the result is null, not the YTM URL (the "never a smaller/avatar cover" guard). Keep the cache-posture, abort and never-throw tests.

4. Fan-out proof describe: the hot path becomes "0 `searchAll` (no CN, no YTM) + at most 2 upgrade calls (iTunes, Deezer)"; the coverless path asserts the four-tier walk ending at YTM.

5. `collectCoverCandidates`: order test becomes `own -> itunes -> deezer -> CN -> ytmusic`; add "caps EVERY network tier at PER_TIER_CAP (4) so 12 YTM hits + 3 CN hits yield <= 4 ytmusic tiles AND all 3 CN tiles present, CN before ytmusic"; keep the 12-cap, abort, no-cache-write and one-tier-rejects tests.

6. `resolveShareCover` (the `?ci=` carrier regression guard): its tests must stay GREEN UNTOUCHED apart from tightening the first test's assertion to `expect(catalog.searchAll).not.toHaveBeenCalled()` with the comment "quick-260920-nyq: the nyq reorder must never reach this chain — no CN, no YTM searchAll; the iTunes -> Deezer subset matching the display chain's head is coincidence, not coupling" (it already asserts iTunes-first, Deezer-second, tokenizes via `coverToken`, no cache write).

Then run the FULL suite: `pnpm test` (cover-backfill + player + everything else) and `pnpm check`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -c "quick-260920-nyq" src/lib/services/cover-backfill.test.ts && pnpm test -- cover-backfill && pnpm test && pnpm check</automated>
  </verify>
  <done>`pnpm test` and `pnpm check` are green; the test file pins: iTunes-first short-circuit, full fall-through iTunes -> Deezer -> CN -> YTM, HQ upgrade never calls `searchAll` (no CN, no YTM), picker per-tier cap of 4 with YTM last, resolveShareCover issues zero `searchAll` and still tokenizes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| upstream cover URL -> CSS `url()` / `<img src>` / MediaMetadata artwork | remote, untrusted strings reach render seams |
| localStorage pin / cover cache -> render | user-writable storage feeds the same seams |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-nyq-01 | Tampering | layered `background-image` (T1) | mitigate | no new value reaches `url()`: the cover string is the same one painted today and every producer (`tier()`, pin writer, cache writers, `adoptCover`) is `hasHttpsScheme`-gated (T-0bb-01); the gradient layer is `coverGradient(uid)` — computed, not upstream data |
| T-nyq-02 | Tampering | `displayCover` -> `buildArtwork` (T3) | mitigate | `buildArtwork` already routes non-https to `/favicon.svg`; `data:` is allowed only via `isRenderableCover`'s `image/` base64 allowlist (T-37-01) |
| T-nyq-03 | Information Disclosure | share `?ci=` carrier | mitigate | `resolveShareCover` untouched by design; T4 asserts zero `searchAll` + tokenizable output so a Google-host URL can never leak into the closed grammar |
| T-nyq-04 | Denial of Service | tier-1 iTunes GET on cold home backfill | accept | direct CORS-open GET that never touches our edge (cheaper than the YTM InnerTube POST it replaces); Deezer/CN/YTM fire only on a miss; bounded by CAP=6 pool + negative-miss cache + apiFetch governor; no new limiter |
| T-nyq-SC | Tampering | package installs | n/a | no dependencies added or changed |
</threat_model>

<verification>
- `pnpm check` green after every task.
- `pnpm test` green after T4 (T2 intentionally leaves the old-order tests red until T4 rewrites them).
- `git diff src/lib/services/cover-backfill.ts` shows `resolveShareCover`'s BODY unchanged (docblock only).
- `grep -c 'buildArtwork(this.resolvedCover' src/lib/stores/player.svelte.ts` = 0.
- No E2E repaint check (Browser pane rAF is frozen); no live CN/qq check (CN proxies blocked in sandbox). Do NOT push — the remote auto-deploys production.
</verification>

<success_criteria>
- A dead cover URL on hero / carousel cells / Nowbar shows the gradient, not a black block.
- Auto chain: iTunes -> Deezer -> CN/qq -> YTM (ranked on speed + size, rationale recorded in code); HQ upgrade: iTunes -> Deezer, never YTM, never the CN fan-out.
- Picker grid: YTM last, no tier > 4 of 12 tiles.
- Hero, Nowbar, OS media card and list rows all read the shared reactive cache; pin and embedded `data:` precedence preserved; `?ci=` share chain unchanged.
- Every non-obvious edit carries a `quick-260920-nyq` comment; no existing decision-ref comment deleted.
</success_criteria>

<output>
Create `.planning/quick/260920-nyq-one-cover-chain/260920-nyq-SUMMARY.md` when done.
</output>
