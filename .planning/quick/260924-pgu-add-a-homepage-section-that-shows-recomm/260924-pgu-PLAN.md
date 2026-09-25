---
phase: quick-260924-pgu-add-a-homepage-section-that-shows-recomm
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/similar.ts
  - src/lib/services/radio.ts
  - src/lib/services/radio.test.ts
  - src/lib/services/home-layout.ts
  - src/lib/services/home-layout.test.ts
  - src/routes/(app)/settings/home/+page.svelte
  - src/lib/i18n/en.ts
  - src/lib/i18n/ar.ts
  - src/lib/i18n/de.ts
  - src/lib/i18n/es.ts
  - src/lib/i18n/fr.ts
  - src/lib/i18n/hi.ts
  - src/lib/i18n/id.ts
  - src/lib/i18n/it.ts
  - src/lib/i18n/pt.ts
  - src/lib/i18n/ru.ts
  - src/lib/i18n/th.ts
  - src/lib/i18n/tr.ts
  - src/lib/i18n/vi.ts
  - src/lib/i18n/zh-Hans.ts
  - src/lib/i18n/zh-Hant.ts
  - src/routes/(app)/+page.svelte
autonomous: true
requirements: [QUICK-260924-pgu]

must_haves:
  truths:
    - "A user with play history sees a 'Your Radio' shelf on Home containing songs similar to what they recently played, none of which they have already played"
    - "A user with EMPTY play history sees no 'Your Radio' header and no row, and the home page issues zero radio requests"
    - "Tapping a radio tile plays that song and the REST of the radio shelf becomes Up Next (the shelf is the queue, not a regenerated tail)"
    - "'Your Radio' appears in Settings -> Home -> Sections & order as a reorderable / hideable / per-density entry, and an existing user's saved order gains it automatically"
    - "Building the shelf costs at most 4 seeds x (1 Last.fm call, +1 Deezer call only on a dry seed), at most 2 in flight, all through apiFetch; audio URLs are NOT resolved for tiles"
    - "When Last.fm is unreachable the shelf still fills from Deezer artist radio; when both are dry the section hides instead of erroring"
  artifacts:
    - path: "src/lib/services/radio.ts"
      provides: "pickRadioSeeds (pure) + mergeRadio (pure) + buildRadio (async, never-throws)"
      exports: ["pickRadioSeeds", "mergeRadio", "buildRadio"]
    - path: "src/lib/services/radio.test.ts"
      provides: "node-only tests for the two pure functions"
      contains: "quick-260924-pgu"
    - path: "src/lib/services/home-layout.ts"
      provides: "'radio' registered in HOME_SECTIONS"
      contains: "'radio'"
    - path: "src/routes/(app)/+page.svelte"
      provides: "radioShelf state, radioBlock snippet, playRadioTrack tap handler"
      contains: "radioBlock"
    - path: "src/lib/i18n/en.ts"
      provides: "settings.homeSectionRadio label"
      contains: "settings.homeSectionRadio"
  key_links:
    - from: "src/routes/(app)/+page.svelte onMount"
      to: "radio.ts buildRadio"
      via: "void buildRadio(playHistory.entries, cap).then(...)"
      pattern: "buildRadio\\(playHistory\\.entries"
    - from: "src/lib/services/radio.ts"
      to: "similar.ts fetchSimilarTracks / nameStub"
      via: "per-seed track.getSimilar, Deezer artist radio fallback mapped through nameStub"
      pattern: "fetchSimilarTracks\\(s\\.artist, s\\.title\\)"
    - from: "src/routes/(app)/+page.svelte playRadioTrack"
      to: "player.playStub + player.setListQueue"
      via: "album hero Play precedent (quick-260919-alb): playStub sameList then setListQueue(radioShelf)"
      pattern: "setListQueue\\(radioShelf, 'home-discovery'\\)"
    - from: "src/routes/(app)/settings/home/+page.svelte sectionLabel"
      to: "i18n settings.homeSectionRadio"
      via: "Record<HomeSectionId, TranslationKey> entry"
      pattern: "radio: 'settings.homeSectionRadio'"
---

<objective>
Add a "Your Radio" home section: songs recommended from the user's recent listening history. Section id `radio`, label key `settings.homeSectionRadio` (the same key family that labels BOTH the home shelf header and the Settings toggle for liked/downloads/history — one key, no separate `home.radio`). The user offered "DJ" or "Radio"; "Your Radio" is chosen because the existing personal shelves are named for what they contain ("Liked songs", "Recently played") and because the tap behaviour below literally is a radio: tap one, the rest keeps playing.

Design (decided here, not re-argued by the executor):
- SEEDS: the 4 most recent history entries with DISTINCT artists (pure `pickRadioSeeds`).
- DATA: per seed, `track.getSimilar` via the already-existing private `fetchSimilarTracks` in similar.ts (exported), falling back to `deezerArtistRadio` mapped through `nameStub` when Last.fm is dry/unreachable. Both are already `cached()` 6h in memory and go through `apiFetch`. Concurrency 2 via `mapWithConcurrency`.
- MERGE: pure `mergeRadio` round-robins across seed lists (diversity), drops every song already in history by `matchKey`, dedupes by stub uid, caps at `clampShelfSize(settings.homeShelfSize)`.
- TILES: lazy `nameStub` Tracks (`resolveByName`, cover seeded from the Last.fm/Deezer https image) rendered by the EXISTING `libraryShelf` snippet — no audio URL is resolved until a tap.
- TAP: `player.playStub(..., 'home-discovery', { sameList: true })` then `player.setListQueue(radioShelf, 'home-discovery')` — the album hero Play precedent. NOT `player.play(stub)`: `play()` calls `history.record(track)` with the PRE-resolve object (player.svelte.ts ~3592), so a raw stub tap would write a synthetic `similar-` uid into history; `playStub` resolves to a real Track first.
- EMPTY HISTORY: shelf hidden, zero requests. No buildDiversePicks fallback (Top hits already covers the cold user).
- NOT cached in localStorage (ponytail: SPA navigations hit the in-memory `cached()`; a hard reload costs <= 4 edge-cached calls). No new QueueContext token: the shelf is a home discovery surface, so it reuses `'home-discovery'`.

Purpose: the home page is currently charts + the user's own library; nothing on it is personalised discovery. This is the smallest slice of that: history in, similar-but-unheard songs out, reusing the Up-Next similarity machinery that already exists.

Output: one new pure service + one test, one export flip, section registration (layout + settings + 15 locales), home page wiring. `pnpm check` + `pnpm test` green.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/lib/services/similar.ts
@src/lib/services/home-layout.ts
@src/lib/history/history-logic.ts
@src/routes/(app)/+page.svelte
@src/routes/(app)/settings/home/+page.svelte

<interfaces>
<!-- Already in the codebase. Use directly — no exploration, no new abstractions. -->

From src/lib/history/history-logic.ts:
  export interface HistoryEntry { uid; source; songid; title; artist; album; cover; quality; qualityLabel; keyword; displayIndex }
  // most-recent-first, uid-deduped, capped at 50. `playHistory.entries` (stores/history.svelte.ts) is HistoryEntry[].

From src/lib/services/similar.ts:
  async function fetchSimilarTracks(artist: string, title: string): Promise<Track[]>   // PRIVATE today — Task 1 exports it. cached() 6h, apiFetch, never-throws (-> []), returns nameStub Tracks with cover seeded
  export function nameStub(artist: string, title: string, image?: string | null): Track | null   // lazy resolveByName stub, uid `${source}:similar-${matchKey}`, https-guarded cover

From src/lib/services/deezer.ts:
  export interface DeezerRadioPair { artist: string; title: string; image?: string }
  export async function deezerArtistRadio(artist: string, limit = 20, signal?: AbortSignal): Promise<DeezerRadioPair[]>   // cached, never-throws (-> [])

From src/lib/services/discovery.ts:
  export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>   // never rejects; a thrown slot is `undefined`
  export function shuffle<T>(arr: T[]): T[]

From src/lib/services/match-key.ts:
  export function matchKey(artist: string, title: string): string   // `${norm(artist)}|${norm(title)}`

From src/lib/services/home-layout.ts:
  export const HOME_SECTIONS = ['liked','downloads','top-hits','top-artists','fav-artists','tags','countries','playlists','history'] as const
  export type HomeSectionId = (typeof HOME_SECTIONS)[number]
  export function resolveSectionOrder(saved): HomeSectionId[]   // appends any known id missing from a saved order -> existing users get 'radio' for free
  export function clampShelfSize(n: unknown): number             // [8, 24]

From src/lib/stores/player.svelte.ts:
  async playStub(artist, title, cover?, context: QueueContext = null, opts: { sameList?: boolean } = {}): Promise<Track | null>   // null = miss OR supersede; gate the toast on player.pendingTrack == null
  setListQueue(tracks: Track[], context: QueueContext = null, cover: string | null = null): void   // anchors `current` into the list by uid then sameSongKey
  // precedent — src/routes/(app)/album/[name]/+page.svelte ~401: `await player.playStub(a, t, heroImg, 'album', { sameList: true })` then setListQueue
  // precedent — src/routes/(app)/library/+page.svelte ~335: `player.setListQueue(list, ctx); player.play(t, { fresh: true, sameList: opts?.wholeList });`

From src/lib/config/defaults.ts:
  export type QueueContext = 'liked' | 'search' | 'downloads' | 'playlist' | 'album' | 'artist' | 'home-discovery' | 'history' | 'remix' | null

Home page (src/routes/(app)/+page.svelte) — existing pieces the wiring hangs on:
  ~129  let historyShelf = $state<Track[]>([]);                              // sibling local shelves live here
  ~157  function buildLibraryShelves(randomize: boolean) { ... }              // called on every refresh(); Randomize passes true
  ~547  async function playStub(item: DiscoveryTrack) { ... }               // existing discovery-tile tap (toast pattern to mirror)
  ~646  function playLibraryTrack(track: Track, ctx: QueueContext) { player.play(track, { fresh: true, context: ctx }); }
  ~660  onMount(() => { settings.load(); library.load(); playHistory.load(); ...libCache hydrate...; ...token...; cached/refresh; requestAnimationFrame(revealShelves); })
  ~778  {#each resolveSectionOrder(settings.homeSectionOrder) as id (id)} ... {:else if id === 'history'}{@render historyBlock()} {/if}
  ~798  {#snippet titleNav(label: string, dest: string)}                     // always navigates to dest on tap
  ~964  {#snippet libraryShelf(tracks: Track[], density: HomeDensity, ctx: QueueContext)}   // list/grid/pile; rows call playLibraryTrack(track, ctx) + openTrackMenu(track); covers via libraryRowCover + use:lazyCover
  ~1017 {#snippet historyBlock()} {#if historyShelf.length} {@render titleNav(t('settings.homeSectionHistory'), '/library?tab=history')} {@render libraryShelf(historyShelf, densityOf('history'), 'history')} {/if} {/snippet}
  imports already present: shuffle, clampShelfSize, settings, player, playHistory, toast, t, type Track, type QueueContext

Settings page (src/routes/(app)/settings/home/+page.svelte) ~42:
  const sectionLabel: Record<HomeSectionId, TranslationKey> = { ..., history: 'settings.homeSectionHistory' };   // exhaustive Record — svelte-check fails until 'radio' is added

i18n: 15 dictionaries contain "settings.homeSectionHistory" (ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant); i18n.test.ts enforces identical key sets; DOUBLE QUOTES for keys and values in these files.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: radio.ts — pure seed pick + merge, async builder over the existing similarity primitives, one test</name>
  <files>src/lib/services/similar.ts, src/lib/services/radio.ts, src/lib/services/radio.test.ts</files>
  <behavior>
    - pickRadioSeeds([a1(artist "A"), a2(artist "A"), b(artist "b"), blankTitle(artist "C", title ""), d(artist "D")], 2) -> [a1, b]  (most-recent-first, distinct artist case-insensitive/trimmed, blank artist or title skipped, capped)
    - pickRadioSeeds([], 4) -> []
    - mergeRadio([[x1, x2], [y1, y2]], heard = {matchKey(y1)}, 3) -> [x1, x2, y2]  (round-robin by index across lists: i=0 gives x1 then y1-dropped-as-heard; i=1 gives x2, y2)
    - mergeRadio([[x1], [x1]], {}, 10) -> [x1]  (same uid in two lists appears once)
    - mergeRadio(lists, {}, 1) -> length 1  (cap)
    - mergeRadio([], {}, 5) -> []
  </behavior>
  <action>
1. similar.ts: add `export` to `async function fetchSimilarTracks(...)` (one keyword). Extend its docblock with one line: "quick-260924-pgu: EXPORTED for the home Radio shelf (radio.ts), which seeds from history instead of the current track. Contract unchanged." Nothing else in the file changes.

2. Create src/lib/services/radio.ts (pure `.ts`, no runes; header comment tagged `quick-260924-pgu` stating: seeds from play history, similar-but-unheard songs out, reuses the Up-Next similarity primitives — never a searchAll fan-out, never resolves audio for tiles). Imports: `type HistoryEntry` from `$lib/history/history-logic`, `type Track` from `$lib/sources/types`, `matchKey` from `$lib/services/match-key`, `mapWithConcurrency` from `$lib/services/discovery`, `fetchSimilarTracks` + `nameStub` from `$lib/services/similar`, `deezerArtistRadio` from `$lib/services/deezer`. Module constants: `export const RADIO_SEEDS = 4;` and `const SEED_CONCURRENCY = 2;` (comment: 4 seeds x at most 2 calls each = the whole cost of the shelf; 2 in flight so a cold home mount's tag/country fan-out is not starved — Pitfall 11 / apiFetch MAX_CONCURRENT_REQUESTS=8).

   `export function pickRadioSeeds(entries: HistoryEntry[], n = RADIO_SEEDS): HistoryEntry[]` — walk `entries` in order (already most-recent-first), skip an entry whose trimmed artist or title is empty, key distinctness on `artist.trim().toLowerCase()`, stop at `n`. Never mutates input.

   `export function mergeRadio(lists: Track[][], heardKeys: Set<string>, cap: number): Track[]` — round-robin: for `i` from 0 to the longest list length, for each list take `list[i]`; skip when `heardKeys.has(matchKey(t.artist, t.title))` or the uid was already pushed; stop once `out.length >= cap`. Return `out`. (Round-robin, not concat, so one seed with a long list cannot crowd out the others.)

   `export async function buildRadio(entries: HistoryEntry[], cap: number): Promise<Track[]>` — `const seeds = pickRadioSeeds(entries); if (!seeds.length) return [];` then `heard = new Set(entries.map((e) => matchKey(e.artist, e.title)))` (drops every song the user has already played, seeds included). `const lists = await mapWithConcurrency(seeds, SEED_CONCURRENCY, async (s) => { const lf = await fetchSimilarTracks(s.artist, s.title); if (lf.length) return lf; const pairs = await deezerArtistRadio(s.artist, cap); return pairs.map((p) => nameStub((p.artist ?? '').trim(), (p.title ?? '').trim(), p.image)).filter((t): t is Track => t !== null); });` then `return mergeRadio(lists.map((l) => l ?? []), heard, cap);`. Both upstream helpers never throw and mapWithConcurrency never rejects, so buildRadio never throws; add a `ponytail:` comment on the builder: "no localStorage cache — fetchSimilarTracks/deezerArtistRadio are cached() 6h in memory, so SPA navs are free and a hard reload costs <= RADIO_SEEDS x 2 edge-cached calls; persist a uid set like LibraryShelfCache if cold-mount latency ever shows".

3. Create src/lib/services/radio.test.ts (vitest, node-only, NO mocks, NO network): import `pickRadioSeeds`, `mergeRadio` from './radio' and `matchKey` from './match-key'. Local helpers: `entry(artist, title, i)` building a minimal HistoryEntry (uid `h:${i}`, source 'kuwo', the rest empty/null/0) and `mk(uid, artist, title)` building a minimal Track (mirror discovery.test.ts's `mk`: audioUrl/lrc/lrcUrl/cover null, detailsLoaded false, quality/qualityLabel null, keyword '', displayIndex 0, album ''). Encode exactly the `<behavior>` cases above as `it()` blocks under two `describe`s. Header comment tagged `quick-260924-pgu` (the two pure functions are the only logic here; the async builder is glue over already-tested never-throw helpers and is deliberately not unit-tested). Do NOT import buildRadio in the test.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -c "^export async function fetchSimilarTracks" src/lib/services/similar.ts && grep -c "quick-260924-pgu" src/lib/services/radio.test.ts && pnpm test -- radio && pnpm test -- similar</automated>
  </verify>
  <done>`fetchSimilarTracks` is exported; radio.ts exports `pickRadioSeeds`, `mergeRadio`, `buildRadio`, `RADIO_SEEDS`; `pnpm test -- radio` passes all behavior cases; the existing similar.test.ts still passes.</done>
</task>

<task type="auto">
  <name>Task 2: Register the `radio` section — layout constant + its test, settings label map, 15 locale dictionaries</name>
  <files>src/lib/services/home-layout.ts, src/lib/services/home-layout.test.ts, src/routes/(app)/settings/home/+page.svelte, src/lib/i18n/en.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts</files>
  <action>
1. home-layout.ts: `HOME_SECTIONS` becomes `['liked', 'downloads', 'radio', 'top-hits', 'top-artists', 'fav-artists', 'tags', 'countries', 'playlists', 'history'] as const` — 'radio' sits in the personal group at the top so a fresh (or reset) user sees personalised content before 22 genre shelves. Existing users keep their saved order; `resolveSectionOrder` APPENDS the unknown-to-them id at the end (already documented behaviour — say so in a one-line `quick-260924-pgu` comment on the constant; do not change the resolver). `DEFAULT_SECTION_ORDER` is a spread of the constant and needs no edit.

2. home-layout.test.ts: update the canonical-order assertion (`it('is the nine home group ids ...')`) to the new ten-id array with 'radio' third, and reword the test name to "ten" (mention `quick-260924-pgu`). Nothing else in the file should need to change; if `resolveSectionOrder` tests hard-code a full expected order, add 'radio' at the position the canonical order dictates.

3. settings/home/+page.svelte `sectionLabel`: add `radio: 'settings.homeSectionRadio',` between `downloads` and `'fav-artists'` (order inside the Record is cosmetic; the exhaustive `Record<HomeSectionId, TranslationKey>` is what svelte-check enforces). The reorder / show-hide / per-section density UI iterates `resolveSectionOrder(...)` and reads `sectionLabel[id]`, so no other edit on this page.

4. i18n — in EACH of the 15 dictionaries that contain `"settings.homeSectionHistory"`, insert the new key on the line directly AFTER it, double quotes for key AND value (house convention; nothing enforces it — check by eye):
   en "Your Radio" · ar "الراديو الخاص بك" · de "Dein Radio" · es "Tu radio" · fr "Ta radio" · hi "आपका रेडियो" · id "Radio Anda" · it "La tua radio" · pt "Sua rádio" · ru "Ваше радио" · th "วิทยุของคุณ" · tr "Senin Radyon" · vi "Radio của bạn" · zh-Hans "你的电台" · zh-Hant "你的電台".
   `en` defines `TranslationKey`, so a missing locale fails `i18n.test.ts` key parity — run it.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && test "$(grep -l '"settings.homeSectionRadio"' src/lib/i18n/*.ts | wc -l | tr -d ' ')" = "15" && grep -c "radio: 'settings.homeSectionRadio'" "src/routes/(app)/settings/home/+page.svelte" && grep -c "'radio'," src/lib/services/home-layout.ts && pnpm test -- home-layout && pnpm test -- i18n && pnpm check</automated>
  </verify>
  <done>'radio' is a `HomeSectionId`; `resolveSectionOrder(oldSavedOrder)` returns it appended (existing home-layout tests cover the append rule); all 15 dictionaries carry `settings.homeSectionRadio`; `pnpm test -- i18n`, `pnpm test -- home-layout`, `pnpm check` pass.</done>
</task>

<task type="auto">
  <name>Task 3: Wire the shelf into Home — build on mount, render via libraryShelf, tap = shelf becomes Up Next</name>
  <files>src/routes/(app)/+page.svelte</files>
  <action>
All edits in src/routes/(app)/+page.svelte, each tagged `quick-260924-pgu`. Reuse the existing snippets and helpers; add NO new component, NO new QueueContext, NO cache.

1. Import: `import { buildRadio } from '$lib/services/radio';`.

2. State: next to `historyShelf` add `let radioShelf = $state<Track[]>([]);` with a comment: lazy `nameStub` Tracks (resolveByName) — similar-but-unheard songs seeded from play history; built ONCE per mount (see onMount), not on every refresh(), because unlike the other local shelves it costs network.

3. onMount: immediately after the library-cache hydrate (`if (libCache) applyLibraryCache(libCache); else buildLibraryShelves(false);`) and BEFORE the `?play=` token block, add:
   `if (!settings.homeHidden.includes('radio')) { void buildRadio(playHistory.entries, clampShelfSize(settings.homeShelfSize)).then((r) => { radioShelf = r; }); }`
   Comment: fires in the first request burst (ahead of the tag/country fan-out) so the shelf lands early; a hidden section spends nothing; `buildRadio` never throws and returns [] on empty history, so there is no error path. Empty history -> the block below renders nothing.

4. buildLibraryShelves(randomize): add one line `if (randomize) radioShelf = shuffle(radioShelf);` beside the other shelves (Randomize reshuffles the tiles it already has — it does NOT refetch; comment that).

5. Tap routing. Change `playLibraryTrack` to:
   `if (track.resolveByName) { void playRadioTrack(track); return; }` before the existing `player.play(track, { fresh: true, context: ctx });`. Comment (decision record): a radio row is a lazy name stub; `play()` records history with the PRE-resolve object (player.svelte.ts `history.record(track)` ~3592), so a raw stub play would write a synthetic `similar-` uid into history whose replay cannot resolve (toEntry drops `resolveByName`). Real library tracks keep the direct fresh play. Keying on the TRACK's `resolveByName`, not on ctx, so the rule reads as "stubs play via playStub" wherever a stub shows up.

   Add:
   `async function playRadioTrack(track: Track) { const tr = await player.playStub(track.artist, track.title, track.cover, 'home-discovery', { sameList: true }); if (!tr) { if (player.pendingTrack == null) toast.show(t('home.unplayable')); return; } player.setListQueue(radioShelf, 'home-discovery'); }`
   Comment: mirrors the album hero Play (quick-260919-alb / quick-260915-vb9) — `sameList` pins the same-list branch so the fresh-play tail does not regenerate over the install; `setListQueue` after the resolve anchors the now-real `current` into the shelf by uid-then-sameSongKey, so the remaining radio tiles are the Up Next. Toast gate copied from the existing `playStub(item)` (null = miss OR supersede; only a miss clears pendingTrack).

6. Render branch: in the section `{#each ...}` chain add `{:else if id === 'radio'}{@render radioBlock()}` (next to the `history` branch).

7. Snippet, next to `historyBlock`:
   `{#snippet radioBlock()} {#if radioShelf.length} {@render titleNav(t('settings.homeSectionRadio'), '/library?tab=history')} {@render libraryShelf(radioShelf, densityOf('radio'), 'home-discovery')} {/if} {/snippet}`
   Comment: header deep-links to the history the radio is seeded from (titleNav always navigates; there is no radio page and none is wanted). `libraryShelf` gives list/grid/pile density, long-press TrackMenu (TrackMenu already resolves `resolveByName` stubs on demand via ensureTrackDetails — same as album rows), and `use:lazyCover` on-view cover resolution for the few stubs whose Last.fm/Deezer image was missing.

8. No change to `scheduleBackfill` (radio rows are Track-shaped and self-resolve covers on view), no change to `shelfCount` (default 1 shelf), no change to LibraryShelfCache.

Then `pnpm check` and `pnpm test` (full).

E2E (dev server on port 4321 via .claude/launch.json; kuwo + Deezer reachable in this sandbox, netease/qq blocked, Last.fm may or may not be): (a) fresh profile, open `/` -> no "Your Radio" header; (b) search a song, tap it (plays via kuwo), return to `/` -> "Your Radio" shelf appears with tiles that are NOT the song just played; (c) tap a radio tile -> it plays (now-bar shows it immediately, audio follows), open Now Playing -> Up Next lists the remaining radio tiles; (d) Settings -> Home -> Sections & order shows "Your Radio" with reorder + toggle + density; hiding it removes the shelf and a reload issues no `/api/lastfm/similar-tracks` or `/api/deezer/radio` request (Network tab). If Last.fm is unreachable, (b) must still fill via Deezer artist radio; if the shelf is empty because both are dry, that is the designed degrade, not a bug. Do NOT push — the remote auto-deploys production.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -c "buildRadio(playHistory.entries" "src/routes/(app)/+page.svelte" && grep -c "setListQueue(radioShelf, 'home-discovery')" "src/routes/(app)/+page.svelte" && grep -c "{@render radioBlock()}" "src/routes/(app)/+page.svelte" && grep -c "if (track.resolveByName)" "src/routes/(app)/+page.svelte" && pnpm check && pnpm test</automated>
  </verify>
  <done>`pnpm check` + full `pnpm test` green; with history the shelf renders, with none it does not; a radio tap plays through `playStub` and installs the shelf as Up Next; hidden section = zero radio requests; E2E steps (a)-(d) observed on :4321 (or the Last.fm/Deezer degrade noted).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| localStorage `openmusic:history:v1` -> radio seeds -> `/api/lastfm/similar-tracks` + `/api/deezer/radio` query params | user-writable storage becomes upstream query input |
| upstream {artist,title,image} -> `nameStub` -> tile / `<img src>` / queue | remote strings reach render + playback seams |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-pgu-01 | Tampering | seed artist/title from localStorage | mitigate | only ever passed to the EXISTING `fetchSimilarTracks` / `deezerArtistRadio`, which `encodeURIComponent` every param and go through `apiFetch`; blank fields are skipped in `pickRadioSeeds`; the edge routes already validate |
| T-pgu-02 | Tampering | upstream image URL -> tile cover | mitigate | `nameStub` keeps only `hasHttpsScheme` images; rows render via `libraryRowCover` + `use:lazyCover`, the same gated readers every list row uses |
| T-pgu-03 | Denial of Service | home-mount fan-out | mitigate | hard-capped at RADIO_SEEDS=4 seeds x <= 2 calls, SEED_CONCURRENCY=2, both helpers `cached()` 6h, all through the apiFetch governor (dedupe + MAX_CONCURRENT_REQUESTS=8 + circuit breaker); hidden section issues nothing; no searchAll on any path |
| T-pgu-04 | Tampering | synthetic `similar-` uid reaching history | mitigate | radio taps route through `playStub` (resolves to a real Track before `play()` records history); `playLibraryTrack` guards on `track.resolveByName` |
| T-pgu-SC | Tampering | package installs | n/a | no dependencies added or changed |
</threat_model>

<verification>
- `pnpm check` green after Task 2 and Task 3 (Task 1 alone leaves the exhaustive `sectionLabel` Record untouched, so it is green too).
- `pnpm test` green after Task 3 (radio, home-layout, i18n, similar suites all touched or exercised).
- `git diff src/lib/services/similar.ts` shows exactly one `export` keyword + one docblock line.
- E2E on :4321 per Task 3 (a)-(d); Last.fm reachability may vary — Deezer artist radio is the designed fallback, an empty shelf when both are dry is the designed degrade.
- Do NOT push (remote auto-deploys production).
</verification>

<success_criteria>
- Home shows "Your Radio" (id `radio`, key `settings.homeSectionRadio`) only when play history exists, filled with similar-but-unheard songs seeded from up to 4 recent distinct-artist plays.
- Tap = playStub resolve + the rest of the shelf as Up Next (`sameList` + `setListQueue`); long-press = TrackMenu; covers paint from the seeded https image or resolve on view.
- Section is reorderable / hideable / density-configurable in Settings -> Home; existing users receive it appended.
- Cost bounded and governed; zero requests when hidden or history-less; no new dependency, component, QueueContext, or cache.
- Every non-obvious edit carries a `quick-260924-pgu` comment; no existing decision-ref comment removed.
</success_criteria>

<output>
Create `.planning/quick/260924-pgu-add-a-homepage-section-that-shows-recomm/260924-pgu-SUMMARY.md` when done.
</output>
