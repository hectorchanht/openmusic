---
phase: quick-260910-qwt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/row-cover.ts
  - src/lib/services/row-cover.test.ts
  - src/lib/services/upnext-covers.ts
  - src/lib/services/upnext-covers.test.ts
  - src/lib/actions/lazyCover.ts
  - src/lib/actions/lazyCover.test.ts
  - src/lib/stores/cover-version.svelte.ts
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/CompactRow.svelte
  - src/routes/(app)/search/+page.svelte
  - src/routes/(app)/library/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
autonomous: false
requirements: [quick-260910-qwt]

must_haves:
  truths:
    - "A cover resolved on ANY surface (search/library/artist row via lazyCover, home/Up Next/Related via backfillCovers, now-playing) is written to the shared cache AND bumps coverVersion, so every mounted cover surface repaints it live"
    - "Every track-row cover surface (search, library x4, artist hit-songs, CompactRow, Up Next tile, Related row) paints from the shared reactive cache on FIRST render when the cache has the song — no intersection, no network needed"
    - "The Related list shows album art per row, filled by ONE capped backfillCovers pass (<=20 tier-1 Deezer calls per fill, <=6 in flight, ~0 on re-open), never per-row use:lazyCover"
    - "Read order everywhere is resolved -> track.cover -> shared cache -> gradient: a D-15 repaired URL still wins over a broken track.cover, and a quick-260910-piz album seed still wins over a per-track cache entry"
    - "An empty-uid stub never reads the shared 'uid:' slot through readCoverByUidOrName (charts-tags-same-cover guard holds on the read side too)"
    - "Home page behaviour is unchanged (its lines are not edited)"
  artifacts:
    - path: "src/lib/services/row-cover.ts"
      provides: "pickRowCover(resolved, seeded, cached) — the ONE shared pure read-order helper (generalised from upNextTileCover)"
      exports: ["pickRowCover"]
    - path: "src/lib/services/row-cover.test.ts"
      provides: "node tests for the read order + empty-string miss + piz album-seed precedence"
    - path: "src/lib/actions/lazyCover.ts"
      provides: "bumpCoverVersion() after a SOLID chain resolve so a lazyCover-resolved cover repaints every other surface"
      contains: "bumpCoverVersion"
    - path: "src/lib/stores/cover-version.svelte.ts"
      provides: "readCoverByUidOrName skips the uid layer for an empty uid"
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "Related row .q-art element + fill effect covering the related tab"
  key_links:
    - from: "src/lib/actions/lazyCover.ts"
      to: "src/lib/stores/cover-version.svelte.ts"
      via: "bumpCoverVersion() after resolveCoverForTrack returns https"
      pattern: "bumpCoverVersion\\(\\)"
    - from: "src/routes/(app)/search/+page.svelte"
      to: "src/lib/stores/cover-version.svelte.ts"
      via: "readCoverByUidOrName inside pickRowCover third arg"
      pattern: "pickRowCover\\(resolvedCovers\\[t\\.uid\\], t\\.cover, readCoverByUidOrName"
    - from: "src/lib/components/NowPlaying.svelte"
      to: "src/lib/services/cover-backfill.ts"
      via: "the single gated $effect now selects upNextList OR related by tab"
      pattern: "tab === 'related' \\? related"
---

<objective>
Make cover art a single shared pipeline on the READ side as well as the resolve side: every row surface paints from the shared reactive cover cache (resolved -> track.cover -> cache), and every writer bumps the reactive version so a cover landing anywhere repaints everywhere. Add album art to the Related list, filled through the same bounded backfillCovers pass Up Next already uses.

Purpose: user request (A) "resolved in one place -> instantly reused everywhere from cache"; (B) the Related list has no art at all today.
Output: one shared pure helper (`pickRowCover`), a one-line bump in lazyCover (the missing writer-side signal), a one-line empty-uid guard in the reactive read, four row surfaces + CompactRow rebound to the cache, Related rows with a `.q-art` tile fed by the existing q5a effect.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@src/lib/stores/cover-version.svelte.ts
@src/lib/services/upnext-covers.ts
@src/lib/services/upnext-covers.test.ts
@src/lib/actions/lazyCover.ts
@src/lib/actions/lazyCover.test.ts
@src/lib/services/cover-backfill.ts
@src/lib/components/NowPlaying.svelte
@src/lib/components/CompactRow.svelte
@src/routes/(app)/search/+page.svelte
@src/routes/(app)/library/+page.svelte
@src/routes/(app)/artist/[name]/+page.svelte
@src/routes/(app)/+page.svelte

<diagnosis>
Already unified (do NOT rebuild): one resolver chain (`resolveCoverForTrack`, Deezer -> iTunes -> CN), one cache (three disjoint key families, read uid -> name -> null), `lazyCover` reads cache-first and de-dupes in flight, `backfillCovers` skips cached + 5-min miss memo.

The two real gaps, confirmed by reading the code:
1. WRITE-SIDE SIGNAL: `resolveCoverForTrack` (cover-backfill.ts:202) writes both cache layers via `setCachedCoverByUid`/`setCachedCover` but does NOT bump — by design, it is a pure `.ts` (LOCKED: cover-cache/cover-backfill stay node-testable, the bump is the CALLER's job — see the resolveDeezerHQ doc comment). `lazyCover` is that caller for search/library/artist/CompactRow/charts and it never bumps, so a cover resolved by a search row is cached but no other mounted surface repaints. Home only works because it passes `onResolved: () => bumpCoverVersion()` itself. `lazyCover` ALREADY imports from `cover-version.svelte` (`removeCoverBoth`), so bumping there is one line and fixes every consumer at once.
2. READ-SIDE BINDING: search (1 site), library (4 sites), artist (1 site) and CompactRow paint from `resolvedCovers[uid] ?? track.cover` — a component-local map fed only when lazyCover fires on intersection. They never read the shared cache reactively. NowPlaying's Up Next tile was fixed by q5a with `upNextTileCover(resolvedCovers[uid], track.cover, readCoverByUidOrName(...))`; that exact three-rung read is what every row surface needs.
3. `getCachedCoverByUid('')` (cover-cache.ts:248) has NO empty-uid guard, so `readCoverByUidOrName('', ...)` would read the shared `'uid:'` slot. Today only real-uid callers use it; before generalising the read, add the same guard `writeCoverBoth`/`removeCoverBoth` already apply.
4. Related row (NowPlaying.svelte:1646) has no art element at all. `related` is `dedupeBest(searchAll(artist))` sliced to 20 — real uids, many rows carry inline source covers (skipped by `upNextCoverNeeds`'s https guard), the rest need a bounded fill.
</diagnosis>

<interfaces>
From src/lib/stores/cover-version.svelte.ts (reactive wrapper; the ONLY place that bumps):
```ts
export function coverVersion(): number;
export function bumpCoverVersion(): void;              // rAF-coalesced; sync fallback in node/SSR
export function readCoverByUidOrName(uid: string, artist: string, title: string): string | null;
export function writeCoverBoth(uid: string, artist: string, title: string, url: string): void;
export function removeCoverBoth(uid: string, artist: string, title: string): void;
```

From src/lib/services/upnext-covers.ts (pure, q5a):
```ts
export const UPNEXT_COVER_MAX = 20;
export function upNextCoverNeeds(list: ReadonlyArray<Pick<Track,'artist'|'title'|'cover'>>, max?: number): CoverNeed[];
export function upNextTileCover(resolved: string|undefined, seeded: string|null|undefined, cached: string|null): string|null; // MOVES to row-cover.ts as pickRowCover
```

From src/lib/services/cover-backfill.ts (pure):
```ts
export interface CoverNeed { artist: string; title: string }
export interface BackfillOpts { signal?: AbortSignal; onResolved?: (key: string, url: string) => void; max?: number }
export async function backfillCovers(items: CoverNeed[], opts?: BackfillOpts): Promise<void>; // CAP=6 pool, skip-cached, 5-min miss memo
export async function resolveCoverForTrack(track: Track, signal?: AbortSignal): Promise<string|null>; // writes cache, does NOT bump
```

NowPlaying.svelte anchors (line numbers at plan time):
- 42: `import { upNextCoverNeeds, upNextTileCover, UPNEXT_COVER_MAX } from '$lib/services/upnext-covers';`
- 85-88: `resolvedCovers` map + `onCoverResolved`
- 428-450: `related` $state + its fetch $effect
- 619-634: the q5a fill $effect (`if (sheetState === 'closed' || tab !== 'queue') return;`)
- 1538: `{@const qArt = upNextTileCover(resolvedCovers[track.uid], track.cover, readCoverByUidOrName(track.uid, track.artist, track.title))}`
- 1584: `<span class="q-art" style:background-image={qArt ? \`url(${qArt})\` : fallbackCover(track)}></span>`
- 1639-1647: `{#each related as track (track.uid)}` ... `<button class="row rel-row" ...><span class="r-meta">...`
- 1927: `.q-art { width: 36px; height: 36px; ... margin-right: 8px; }`
- 1941: `.row.rel-row { flex-direction: row; align-items: center; gap: 8px; }`

Consumer paint sites (all currently `(resolvedCovers[uid] ?? track.cover) ? url(...) : fallbackCover(...)`):
- search/+page.svelte:777-778 (`t`), library/+page.svelte:224, 258, 281, 318 (`track`), artist/[name]/+page.svelte:597 (`track`)
- CompactRow.svelte:63-64: `let resolvedCover = $state<string|null>(null); const effectiveCover = $derived(resolvedCover ?? cover);` — `track` prop may be null.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Shared read-order helper + the missing write-side bump + empty-uid read guard</name>
  <files>src/lib/services/row-cover.ts, src/lib/services/row-cover.test.ts, src/lib/services/upnext-covers.ts, src/lib/services/upnext-covers.test.ts, src/lib/actions/lazyCover.ts, src/lib/actions/lazyCover.test.ts, src/lib/stores/cover-version.svelte.ts</files>
  <behavior>
    - row-cover.test.ts: `pickRowCover('https://r','https://s','https://c')` -> 'https://r'; `(undefined,'https://s','https://c')` -> 'https://s'; `(undefined,null,'https://c')` -> 'https://c'; `(undefined,null,null)` -> null
    - row-cover.test.ts: empty string is a miss at every rung: `('', 'https://a', null)` -> 'https://a'; `('', '', 'https://c')` -> 'https://c'; `('', '', '')` -> null
    - row-cover.test.ts: seeded album cover beats cache (quick-260910-piz): `(undefined,'https://album','https://deezer')` -> 'https://album'
    - lazyCover.test.ts (new case): "chain resolve of a SOLID cover calls bumpCoverVersion once" — cache miss, empty `track.cover`, mocked `resolveCoverForTrack` returns 'https://cdn/x.jpg' -> `bumpCoverVersion` mock called exactly once AND `onResolved(uid, url)` called
    - lazyCover.test.ts (new case): "chain resolve returning null does NOT bump" -> `bumpCoverVersion` not called
    - lazyCover.test.ts: existing cache-hit cases still do NOT call `bumpCoverVersion` (a hit is already in cache; no signal needed) — assert `not.toHaveBeenCalled()` in the existing 'reads the cache uid-first and skips the network' case
    - upnext-covers.test.ts: the three `upNextTileCover` cases are REMOVED (they move to row-cover.test.ts); `upNextCoverNeeds` cases unchanged and still pass
  </behavior>
  <action>
1. Create `src/lib/services/row-cover.ts` (pure `.ts`, no runes, no store/cache import — exactly like upnext-covers.ts) exporting `pickRowCover(resolved: string | undefined, seeded: string | null | undefined, cached: string | null): string | null` returning `resolved || seeded || cached || null`. This is `upNextTileCover` MOVED and generalised (quick-260910-qwt); carry over its doc comment and extend it: rung 1 `resolved` = the surface's component-local lazyCover/carousel map (kept FIRST so a D-15 repaired URL beats a broken `track.cover`); rung 2 `seeded` = `track.cover` (source cover or quick-260910-piz album seed — MUST stay ahead of the cache); rung 3 `cached` = the caller passes `readCoverByUidOrName(uid, artist, title)` so the call site takes the `coverVersion()` dependency and the helper stays pure; `''` is a miss at every rung. Header comment: why the cache read is passed IN (node-testable, no runes import), and that this is the read-order authority for search, library, artist, CompactRow, Up Next and Related.
2. Create `src/lib/services/row-cover.test.ts` with the three behaviors above (move the `describe('upNextTileCover')` block verbatim, renamed). Run it RED first (module missing), then GREEN.
3. In `src/lib/services/upnext-covers.ts`: delete `upNextTileCover` and its doc comment; in the header comment replace the `upNextTileCover()` bullet with a pointer "tile read order now lives in row-cover.ts `pickRowCover` (quick-260910-qwt)". Keep `UPNEXT_COVER_MAX` and `upNextCoverNeeds` untouched. In `upnext-covers.test.ts` remove the `upNextTileCover` describe block and its import.
4. In `src/lib/actions/lazyCover.ts`: extend the existing import from `$lib/stores/cover-version.svelte` to `{ removeCoverBoth, bumpCoverVersion }`. In `resolveCoverForRow` step (3), after `const url = await resolveCoverForTrack(track);` change the SOLID branch to: `if (isHttps(url)) { bumpCoverVersion(); onResolved(track.uid, url); }`. Add a comment tagged quick-260910-qwt: `resolveCoverForTrack` writes both cache layers but by LOCKED design never bumps (pure `.ts`); the bump is the caller's job, and lazyCover is the caller for search/library/artist/CompactRow/charts — without it a cover resolved by one row was cached silently and no other mounted surface (home, Up Next, Related, now-playing hero) repainted until its next fresh render. Home's own `onResolved: () => bumpCoverVersion()` now double-bumps; that coalesces into one increment via the rAF latch (quick-260704-45c), so it is harmless — do NOT edit the home page. Do NOT bump on the cache-hit / probe-kept paths (nothing new landed). Preserve every existing comment (COVER-02, D-13, D-15, T-21-05, T-0bb-01, quick-260630-ey2, quick-260704-4fr, charts-tags fix).
5. In `src/lib/actions/lazyCover.test.ts`: extend the `vi.mock('$lib/stores/cover-version.svelte', ...)` factory (line ~31) to also export `bumpCoverVersion` backed by a new `vi.fn()` spy (declare it next to `removeCoverBoth` at ~line 20; reset it wherever `removeCoverBoth` is reset in beforeEach). Add the two new cases and the one extra assertion listed in behavior, mirroring the existing case style (fake IntersectionObserver + Image).
6. In `src/lib/stores/cover-version.svelte.ts` `readCoverByUidOrName`: change the body to `return (uid ? getCachedCoverByUid(uid) : null) ?? getCachedCover(artist, title);` with a comment (quick-260910-qwt): an empty stub uid must not read the shared `'uid:'` slot — the same charts-tags-same-cover guard `writeCoverBoth`/`removeCoverBoth`/lazyCover already apply on their side; now that this read is the rung-3 authority on every row surface, the guard must hold on the read side too. Leave `readCoverByName`/`readArtistCover`/`writeCoverBoth`/`removeCoverBoth` untouched.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run src/lib/services/row-cover.test.ts src/lib/services/upnext-covers.test.ts src/lib/actions/lazyCover.test.ts && grep -v '^\s*//' src/lib/actions/lazyCover.ts | grep -c 'bumpCoverVersion()' | grep -qx 1 && ! grep -q 'export function upNextTileCover' src/lib/services/upnext-covers.ts</automated>
  </verify>
  <done>row-cover.test.ts green (3 cases), upnext-covers.test.ts green without the tile cases, lazyCover.test.ts green including the two new bump cases; `bumpCoverVersion()` appears exactly once in lazyCover.ts code (the chain-SOLID branch); `readCoverByUidOrName` skips the uid layer for `''`.</done>
</task>

<task type="auto">
  <name>Task 2: Bind every row surface to the shared cache; add Related art fed by the q5a effect</name>
  <files>src/lib/components/NowPlaying.svelte, src/lib/components/CompactRow.svelte, src/routes/(app)/search/+page.svelte, src/routes/(app)/library/+page.svelte, src/routes/(app)/artist/[name]/+page.svelte</files>
  <action>
All paint sites switch to the three-rung read `pickRowCover(resolvedCovers[uid], track.cover, readCoverByUidOrName(uid, artist, title))`. Keep every component-local `resolvedCovers` map and its `onResolved` writer EXACTLY as is (rung 1 — preserves the D-15 repair precedence and the existing per-surface behaviour); the change is purely ADDING rung 3. Do NOT touch `src/routes/(app)/+page.svelte` (home already reads the cache) and do NOT touch the charts pages (empty-uid stubs keyed by `rowKey(it)`; out of scope and guarded separately). Do NOT add `use:lazyCover` anywhere it is not already. No `player.svelte.ts` edits.

1. `search/+page.svelte`: import `{ pickRowCover } from '$lib/services/row-cover'` and `{ readCoverByUidOrName } from '$lib/stores/cover-version.svelte'`. At the row (~777), replace the two-rung background expression with `{@const art = pickRowCover(resolvedCovers[t.uid], t.cover, readCoverByUidOrName(t.uid, t.artist, t.title))}` placed as a direct child of the enclosing `{#each}` (Svelte requires `@const` directly under each/if/snippet — same placement as NowPlaying:1538), then `style:background-image={art ? \`url(${art})\` : fallbackCover(t)}`. Extend the existing SRCH-02/COVER-02 comment at ~83 with a quick-260910-qwt line: the row now also reads the shared reactive cache, so a cover resolved on ANY other surface paints here on first render and repaints live via coverVersion().
2. `library/+page.svelte`: same imports; apply the identical `{@const art = pickRowCover(resolvedCovers[track.uid], track.cover, readCoverByUidOrName(track.uid, track.artist, track.title))}` + `style:background-image={art ? ... : fallbackCover(track)}` at ALL FOUR sites (~224, 258, 281, 318), each `@const` directly under its own `{#each}`. Extend the COVER-02 D-14 comment at ~127 with the qwt note.
3. `artist/[name]/+page.svelte`: same at the hit-song row (~597); extend the comment at ~152. Do NOT touch the `al-cover` album/related rows on this page (the comment says they are not lazyCover'd; leave them).
4. `CompactRow.svelte`: import both; change `const effectiveCover = $derived(resolvedCover ?? cover);` to `$derived(pickRowCover(resolvedCover ?? undefined, cover, track ? readCoverByUidOrName(track.uid, track.artist, track.title) : null))`. Comment (quick-260910-qwt): discovery stubs (`track == null`) keep the host-provided `cover` only; track rows gain the shared cache rung. The WR-01 seed-reset effect is untouched.
5. `NowPlaying.svelte`:
   a. Line 42: import becomes `{ upNextCoverNeeds, UPNEXT_COVER_MAX } from '$lib/services/upnext-covers'` plus `import { pickRowCover } from '$lib/services/row-cover';`. Line 1538: `upNextTileCover(` -> `pickRowCover(`; update the nearby comment block (~1570-1584) wherever it names `upNextTileCover`.
   b. Related art: directly under `{#each related as track (track.uid)}` (~1639) add `{@const rArt = pickRowCover(resolvedCovers[track.uid], track.cover, readCoverByUidOrName(track.uid, track.artist, track.title))}`; inside the `<button class="row rel-row" ...>` insert, BEFORE `<span class="r-meta">`, `<span class="q-art" style:background-image={rArt ? \`url(${rArt})\` : fallbackCover(track)}></span>` (reuse the existing `.q-art` 36px tile class — no new CSS block). Add `.rel-row .q-art { margin-right: 0; }` next to the `.row.rel-row` rule (~1941) so the row's `gap: 8px` is the only spacing. Add an HTML comment (quick-260910-qwt) stating: this is a reactive READ, not a fetch — no `use:lazyCover` on Related rows (T-26-10-01 holds); the fill is the single capped effect below.
   c. Extend the q5a fill effect (~619): replace `if (sheetState === 'closed' || tab !== 'queue') return; const needs = upNextCoverNeeds(upNextList);` with `if (sheetState === 'closed') return; const rows = tab === 'queue' ? upNextList : tab === 'related' ? related : null; if (!rows) return; const needs = upNextCoverNeeds(rows);`. Everything else in the effect (AbortController, `untrack`, `max: UPNEXT_COVER_MAX`, `onResolved: () => bumpCoverVersion()`, abort on re-run) stays byte-identical. Update the effect's comment block: add a quick-260910-qwt paragraph — the Related tab reuses the SAME single pool. Cost: `related` is at most 20 rows and `upNextCoverNeeds` skips every row already carrying an https source cover (most CN search hits carry an inline pic), so a Related fill is <=20 tier-1 `/api/deezer/search`, typically far fewer, <=6 in flight, ~0 on re-open (skip-cached + 5-min miss memo); switching tab aborts the other pool. Self-invalidation guard: the effect reads `related`/`upNextList`/`tab`/`sheetState` only — never `coverVersion()` — so `onResolved -> bump` cannot re-trigger it; `related` is reassigned only by its own fetch effect. Preserve all existing comments (Gap 3 26-07/26-10, T-26-10-01, piz guard, q5a, k45/qjv/omt/nx6 related-row comments).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm check 2>&1 | tail -3 && pnpm test 2>&1 | tail -6 && grep -c 'pickRowCover(' "src/routes/(app)/library/+page.svelte" | grep -qx 4 && grep -q "tab === 'related' ? related" src/lib/components/NowPlaying.svelte && grep -q 'class="q-art"' src/lib/components/NowPlaying.svelte && [ "$(grep -c 'use:lazyCover' src/lib/components/NowPlaying.svelte)" = "$(git show HEAD:src/lib/components/NowPlaying.svelte | grep -c 'use:lazyCover')" ] && git diff --quiet HEAD -- "src/routes/(app)/+page.svelte" src/lib/stores/player.svelte.ts</automated>
  </verify>
  <done>`pnpm check` 0 errors; `pnpm test` all green; library has 4 `pickRowCover(` sites, search 1, artist 1, CompactRow 1, NowPlaying 2 (Up Next + Related); Related row renders a `.q-art` span; the fill effect branches on `tab`; `use:lazyCover` count in NowPlaying unchanged vs HEAD; home page and player.svelte.ts have zero diff.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Behavioural verification — Related art, bounded requests, cross-surface cache reuse, no regressions</name>
  <files>none — verification only</files>
  <action>Human runs the numbered steps in how-to-verify against the dev server and reports request counts + observed paint behaviour. No code changes in this task.</action>
  <what-built>Shared three-rung cover read on every row surface, lazyCover now bumps the reactive version after a chain resolve, Related rows have album art filled by the single capped backfill effect.</what-built>
  <how-to-verify>
Dev server: `pnpm dev` (port 4321 or 5173 — probe). Sandbox note: netease/qq upstreams are blocked here; kuwo and Deezer work, so search via kuwo results. NOTE ON rAF: this browser pane has `requestAnimationFrame` frozen, so a `bumpCoverVersion`-driven LIVE repaint cannot be observed here; every check below is a FRESH RENDER (navigation / tab toggle), which reads the cache directly on first paint and is observable. The live-repaint path is covered by the unit tests in Task 1 (lazyCover bumps once per chain resolve).

Start clean: DevTools console `localStorage.removeItem('openmusic:cover-cache:v1')`, reload. Open DevTools Network, filter `deezer/search`.

1. Related rows show art (B): search an artist (e.g. "Coldplay"), tap a song to play, expand Now Playing, tap the Related tab. Expect: each Related row now has a 36px art tile left of the title (inline source covers paint immediately; coverless rows fill in within a few seconds). Note the number of `/api/deezer/search` requests issued by the fill: must be <= 20 and <= the number of Related rows that lacked an https cover. Toggle to Up Next and back to Related: expect 0 new `/api/deezer/search` (skip-cached + miss memo).
2. Cross-surface reuse, X = Up Next, Y = Library (A): play a search result so a similarity-generated Up Next appears (rows are coverless Last.fm stubs, per q5a). Open the Up Next tab and wait for the fill to paint a row S (confirm in console: `Object.keys(JSON.parse(localStorage['openmusic:cover-cache:v1'])).filter(k => !k.startsWith('uid:') && !k.startsWith('artist:'))` contains S's name key). Long-press S -> add it to Library (favourite). Clear the Network log. Navigate to /library (bottom nav). Expect: S's row paints its cover ON FIRST RENDER (no gradient flash while scrolling to it) and the Network log shows ZERO `/api/deezer/search` for S — it was resolved on Up Next and reused from cache. Then open /search and search S's title: the matching row paints immediately as well, again with zero deezer request for S.
3. Cross-surface reverse, X = search row, Y = Related: on /search, find a row that painted via the chain (a row whose gradient became art after scrolling into view, i.e. its source had no https cover — if none appear in this sandbox, skip this step and say so). Play a DIFFERENT song by the same artist, open Related: the same song's row paints from cache on first render with no new deezer request for it.
4. No regressions: /album/<any album> -> play a track -> Up Next tiles all show the ALBUM art (piz precedence, not per-track Deezer art) and the Network log shows no deezer requests for those rows (upNextCoverNeeds skipped them). Home page tiles/rows behave as before (covers appear, no request burst on revisit). Sheet CLOSED: play a song without expanding Now Playing -> 0 `/api/deezer/search` from the fill effect (gate holds). Charts -> tags -> any tag: rows show DISTINCT covers (empty-uid guard intact).
  </how-to-verify>
  <resume-signal>Type "approved" or describe the failing step (number + what you saw, incl. request counts)</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| cache -> CSS `background-image` | cached/resolved URL strings are interpolated into `url(...)` on 8 surfaces |
| client -> `/api/deezer/search` (+ iTunes, CN searchAll) | the fill effect and lazyCover issue upstream cover searches |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-qwt-01 | Tampering | `pickRowCover` -> `background-image` on search/library/artist/CompactRow/Related | mitigate | No new writer: every value reaching rung 3 was written by `resolveCoverForTrack`/`backfillCovers`/`writeCoverBoth`, all gated `isSolidCover` (https only, T-0bb-01). Rung 1/2 are the pre-existing paths, unchanged. |
| T-qwt-02 | DoS | Related fill / any surface | mitigate | Related reuses the ONE q5a pool: `max: UPNEXT_COVER_MAX` (20), CAP=6, skip-cached, 5-min miss memo, abort-on-rerun, sheet+tab gated, behind the apiFetch governor. No `use:lazyCover` added anywhere; NowPlaying `use:lazyCover` count asserted unchanged vs HEAD in Task 2 verify. No new throttle layered on the governor (api-fetch-flood-freeze lesson). |
| T-qwt-03 | DoS (self-invalidation loop) | NowPlaying fill `$effect` | mitigate | Effect reads `sheetState`/`tab`/`upNextList`/`related` only; never `coverVersion()`; `backfillCovers` under `untrack`. `related` is reassigned only by its own fetch effect (one set per track change). Template `readCoverByUidOrName` reads live in the template, not the effect. |
| T-qwt-04 | Information disclosure / wrong data | `readCoverByUidOrName('')` shared `'uid:'` slot | mitigate | Empty uid skips the uid layer (Task 1 step 6), matching the write/evict-side guards; charts pages are not changed. |
| T-qwt-05 | DoS (repaint storm) | `bumpCoverVersion` from lazyCover | accept | Bumps coalesce per animation frame via the existing rAF latch (quick-260704-45c); the home page's double bump collapses into the same frame. Bump only on a SOLID chain result, not on cache hits. |
| T-qwt-SC | Tampering | npm installs | accept | No new dependencies in this plan. |
</threat_model>

<verification>
- `pnpm check` -> 0 errors, 0 warnings.
- `pnpm test` -> full suite green including `row-cover.test.ts` (3), the trimmed `upnext-covers.test.ts`, and `lazyCover.test.ts` with the two new bump cases.
- Grep gates: `bumpCoverVersion()` exactly once in lazyCover.ts code lines; `export function upNextTileCover` absent; `pickRowCover(` present in search (1), library (4), artist (1), CompactRow (1), NowPlaying (2); `class="q-art"` inside the `rel-row` button; `use:lazyCover` count in NowPlaying unchanged vs HEAD; zero diff on `(app)/+page.svelte` and `player.svelte.ts`.
- Browser checkpoint (Task 3): Related art present; fill request count bounded (<=20, 0 on re-open); cross-surface first-render paint with zero new deezer request for the reused song; album-art precedence, home, closed-sheet gate, charts distinct covers all intact.
- Do NOT `git push`, deploy, or build an APK (pushes to main auto-deploy production).
</verification>

<success_criteria>
- A cover resolved by lazyCover on any row surface bumps the shared version (unit-tested) and is written to the shared cache (pre-existing), so every mounted cover surface repaints it.
- Search, library (4 lists), artist hit-songs, CompactRow, Up Next and Related all paint via `pickRowCover(resolved, track.cover, readCoverByUidOrName(...))` — cache-present covers appear on first render without intersection or network.
- Related rows display album art, filled by the single gated, capped backfill effect; no per-row lazyCover; observed request count bounded.
- piz album precedence, D-15 repair precedence, empty-uid stub guard, home page, and the q5a/nx6/omt/qjv/k45 Related/Up Next behaviours are unchanged.
- All work tagged `quick-260910-qwt`; existing decision comments preserved.
</success_criteria>

<output>
Create `.planning/quick/260910-qwt-unify-cover-resolution-app-wide-via-the-/260910-qwt-SUMMARY.md` when done.
</output>
