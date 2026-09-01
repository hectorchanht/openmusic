---
phase: quick-260831-rjo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/routes/(app)/search/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
autonomous: true
requirements: [QUICK-260831-RJO]

must_haves:
  truths:
    - "Tapping an artist typeahead suggestion (♪ row) navigates to that artist's page instead of running a search"
    - "Tapping a song typeahead suggestion (♫ row) starts playback instantly via the optimistic playStub path — no search commit, no intermediate step"
    - "Tapping an album typeahead suggestion (◎ row) still fills the input and runs a search (unchanged)"
    - "Tapping an artist tile in search results still navigates to the artist page (already works — unchanged)"
    - "Tapping a song RESULT ROW still starts playback immediately (already works — unchanged)"
    - "The artist page hit-songs list can reveal more than 30 songs via a Show more control, fetching deeper searchAll pages when the loaded set is exhausted"
  artifacts:
    - path: "src/routes/(app)/search/+page.svelte"
      provides: "kind-branched pickSuggestion — artist→goto, song→player.playStub, album→fill+search"
      contains: "quick-260831-rjo"
    - path: "src/routes/(app)/artist/[name]/+page.svelte"
      provides: "shown-count pagination + cumulative-superset page fetch for hit songs"
      contains: "quick-260831-rjo"
  key_links:
    - from: "src/routes/(app)/search/+page.svelte"
      to: "/artist/[name]"
      via: "goto in pickSuggestion for kind:'artist'"
      pattern: "kind === 'artist'"
    - from: "src/routes/(app)/search/+page.svelte"
      to: "player.playStub"
      via: "pickSuggestion for kind:'song' (optimistic resolve-on-tap)"
      pattern: "player\\.playStub\\("
    - from: "src/routes/(app)/artist/[name]/+page.svelte"
      to: "searchAll"
      via: "loadMoreSongs page fetch"
      pattern: "searchAll\\(n?a?m?e?.*, (page|next)"
---

<objective>
Search-page typeahead click routing + artist-page hit-songs pagination (quick-260831-rjo).

USER CLARIFICATION (authoritative scope): requirements (1) and (2) BOTH refer to the typeahead
autocomplete dropdown, not the result rows/tiles.

INVESTIGATION VERDICT (verified against source — do NOT re-implement what already works):

1. **Artist suggestion click → artist page**: Artist TILES in the results area ALREADY navigate
   (`onclick={() => goto('/artist/' + encodeURIComponent(tile.name))}`, search/+page.svelte ~line 702).
   The GAP is the typeahead suggestion dropdown: `pickSuggestion(s)` treats ALL kinds (song/artist/album)
   identically — fills the input and runs a full search. An artist suggestion (♪) should navigate to
   `/artist/{name}` instead.

2. **Song suggestion click → instant play**: The song RESULT ROW needs no change — its onclick is
   `player.setListQueue(results, 'search'); player.play(t, { fresh: true })` (~line 741), already
   instant. But the song SUGGESTION (♫ dropdown row) DOES need a change: today it fills the input and
   commits a search instead of playing. A `Suggestion` is Deezer-derived and carries NO uid/source/Track,
   so the existing optimistic resolve-on-tap primitive `player.playStub(artist, title, cover?, context?)`
   is exactly right — it locks the tapped stub into `pendingTrack` and swaps the UI synchronously while
   `resolveStub` runs, with `pendingGen` supersedence and same-key dedupe already handled. Copy the call
   idiom from `src/routes/(app)/+page.svelte` ~line 528.

3. **Artist page hit-songs capped at 30**: The cap is the RENDER slice `{#each songs.slice(0, 30) …}`
   (artist/[name]/+page.svelte ~line 558) AND the load effect only ever fetches page 1
   (`searchAll(n, 1)` ~line 262). `searchAll(keyword, page)` already supports paging — each page returns
   a CUMULATIVE SUPERSET (cache key includes page; see search page `loadMore()` which REPLACES results
   with the merged superset and flips `hasMore` off when a page stops growing). Pagination here is:
   a shown-count over the already-loaded deduped set + a deeper-page fetch when that set is exhausted.

Output: two edited files, both changes comment-tagged `quick-260831-rjo`.
</objective>

<context>
@/Users/laichan/code/tung/openmusic/CLAUDE.md
@src/routes/(app)/search/+page.svelte
@src/routes/(app)/artist/[name]/+page.svelte
@src/lib/services/catalog.ts

<interfaces>
From src/lib/search/autocomplete-logic.ts (already imported by search page):
```typescript
export interface Suggestion { kind: 'song' | 'artist' | 'album'; title: string; artist?: string; key: string; }
// kind:'artist' → the artist NAME is `title`. kind:'song'/'album' → `artist` is populated by
// deriveSuggestions (empty-artist hits are dropped), but the TYPE keeps it optional.
```

From src/lib/stores/player.svelte.ts (~line 2708 — verified signature):
```typescript
async playStub(artist: string, title: string, cover?: string | null, context: QueueContext = null): Promise<Track | null>
// Synchronously locks {artist,title,cover} into pendingTrack + loading (now-bar renders instantly),
// then resolveStub → setQueue([tr], context) + play(tr, {fresh:true}). Returns null on miss OR
// supersede — gate any miss toast on `player.pendingTrack == null` (supersede leaves it non-null).
// Never throws. QueueContext union (src/lib/config/defaults.ts) includes 'search'.
```

Proven miss-toast idiom (src/routes/(app)/+page.svelte ~line 528):
```typescript
const tr = await player.playStub(item.artist, item.title, item.image, 'home-discovery');
if (tr === null && player.pendingTrack == null) toast.show(t('home.unplayable'));
```
`toast` and `t` are ALREADY imported in search/+page.svelte (lines 33 and neighbors); reuse the
existing `home.unplayable` key — no new i18n key for this.

From src/lib/services/catalog.ts:
```typescript
export async function searchAll(keyword: string, page = 1, prefs?, signal?, onPartial?): Promise<{ interleaved: Track[]; … }>
// page N returns a CUMULATIVE SUPERSET of page N-1 (cache key includes page).
```

Proven load-more idiom (search/+page.svelte loadMore(), ~line 429): fetch next page →
`rankList/dedupeBest(interleaved)` → if `merged.length <= current.length` set `hasMore = false`
(sources exhausted), else REPLACE the list with the superset and `page = next`. Never concatenate.

Artist page current load effect (~line 259):
```typescript
if (n && loadedFor !== n) { loadedFor = n; loading = true; songs = [];
  searchAll(n, 1).then((r) => (songs = dedupeBest(r.interleaved, settings.preferredSource))) … }
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Kind-branched typeahead suggestion handling — artist navigates, song plays, album searches</name>
  <files>src/routes/(app)/search/+page.svelte</files>
  <action>
	Rewrite `pickSuggestion(s: Suggestion)` (~line 158) to branch on `s.kind`. In ALL branches first
	clear the typeahead state exactly as the existing body does
	(`inputFocused = false; suggestions = []; fetchSuggestions.cancel(); suggestAc?.abort();`):

	- `kind === 'artist'` → `goto('/artist/' + encodeURIComponent(s.title))` — same nav idiom as the
	  artist-tile handler at ~line 702 — then return WITHOUT calling `run()` and without touching `q`.
	- `kind === 'song'` → start playback instantly via the optimistic resolve-on-tap primitive:
	  `void`-call `player.playStub(s.artist ?? '', s.title, undefined, 'search')` wrapped so the miss
	  toast fires (copy the home-page idiom: await inside an async IIFE or a small async helper —
	  `if (tr === null && player.pendingTrack == null) toast.show(t('home.unplayable'))`; reuse the
	  existing `home.unplayable` key, do NOT add a new i18n key). Pass NO cover (suggestions carry
	  none) and `'search'` as the QueueContext (valid union member, verified in defaults.ts). Do NOT
	  block the click handler on the await and do NOT call `run()` — the tap plays, it does not commit
	  a query. Do NOT set `q` either: the tap is a play action, not a query commit; leaving the user's
	  typed text untouched is the least surprising behavior (setting `q` to the song title would show
	  committed-looking text over a content area that never searched for it).
	- `kind === 'album'` → today's fill-input-and-search behavior verbatim (`q = s.title; run();`).

	Add a `quick-260831-rjo` comment on the branch explaining: artist suggestions navigate (the artist
	page derives its own hit-song list), song suggestions play via playStub (Deezer-derived stub, no
	uid/Track — pendingGen supersedence + dedupe live in the store), album suggestions still commit a
	search.
	Do NOT touch the artist-tile handler or the song RESULT-ROW onclick — investigation confirmed both
	already behave correctly; the dropdown is the only surface that changes.
	Tabs, `$lib` aliases, no new imports needed (`goto`, `player`, `toast`, `t` are all already imported).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -n "kind === 'artist'" "src/routes/(app)/search/+page.svelte" && grep -n "player.playStub" "src/routes/(app)/search/+page.svelte" && pnpm check</automated>
  </verify>
  <done>Clicking a ♪ artist suggestion navigates to /artist/{encoded name}; clicking a ♫ song suggestion starts optimistic playback (now-bar appears instantly, no search runs, q unchanged, miss toasts); ◎ album suggestions still fill + search; `pnpm check` clean.</done>
</task>

<task type="auto">
  <name>Task 2: Paginate the artist page hit-songs list past 30</name>
  <files>src/routes/(app)/artist/[name]/+page.svelte</files>
  <action>
	Mirror the search page's proven cumulative-superset load-more idiom, but as a simple "Show more"
	button (no IntersectionObserver sentinel — a tap control is the smallest correct diff for a
	below-the-fold list). All additions comment-tagged `quick-260831-rjo`.

	State (runes, near the existing `songs`/`loading` declarations):
	- `let shown = $state(30);` — render window over the deduped `songs`.
	- `let songsPage = $state(1);` `let hasMoreSongs = $state(true);` `let loadingMoreSongs = $state(false);`
	- Reset ALL of these (`shown = 30; songsPage = 1; hasMoreSongs = true;`) inside the existing
	  `$effect` load branch when a new `name` loads (the `loadedFor !== n` block), so navigating
	  artist→artist doesn't leak the prior artist's pagination state.

	Render: change `songs.slice(0, 30)` to `songs.slice(0, shown)`. After the `</ul>`, render a
	"Show more" button when `!loadingMoreSongs && (songs.length > shown || hasMoreSongs)`; show a
	small loading row (reuse the existing skeleton row snippet style or a muted "loading" line) while
	`loadingMoreSongs`. Use `use:tapBounce` like sibling buttons. Label via i18n if a suitable key
	exists (grep `src/lib/i18n/en.ts` for an existing "more"/"showMore" key); if none exists, add
	`"artist.showMore"` to ALL 16 locale dictionaries (DOUBLE QUOTES, identical key set —
	i18n.test.ts guards parity; give non-English locales real translations, zh dictionaries exist
	as reference for tone).

	Handler `loadMoreSongs()`:
	1. If `songs.length > shown` — just `shown += 30` (reveal already-loaded rows, zero network) and return
	   UNLESS revealing still leaves `shown >= songs.length` with `hasMoreSongs` true.
	2. Else, if `hasMoreSongs && !loadingMoreSongs`: capture `const n = name;`, set `loadingMoreSongs = true`,
	   `const next = songsPage + 1;` then `searchAll(n, next)` → `dedupeBest(r.interleaved, settings.preferredSource)`.
	   Race guard the assignment on `loadedFor === n` (same idiom as the enrich effect). If
	   `merged.length <= songs.length` → `hasMoreSongs = false` (sources exhausted); else REPLACE
	   `songs = merged` (cumulative superset — never concatenate, uids would collide in the keyed
	   `{#each}`), `songsPage = next`, and `shown += 30`. `.catch(() => (hasMoreSongs = false))`,
	   `.finally` clears `loadingMoreSongs` (still under the `loadedFor === n` guard).
	3. Gate on `online.isOnline` (short-circuit like the existing load effect — OFFL-03 discipline).

	Note in a comment that `player.setListQueue(songs, 'artist')` on row tap already queues the FULL
	loaded set, so pagination is render+fetch depth only — playback semantics unchanged.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -n "songs.slice(0, shown)" "src/routes/(app)/artist/[name]/+page.svelte" && grep -cn "quick-260831-rjo" "src/routes/(app)/artist/[name]/+page.svelte" && pnpm check && pnpm test</automated>
    <human-check>pnpm dev → search a prolific artist (e.g. 周杰倫 or Coldplay) → tap the artist tile or ♪ suggestion → artist page → tap "Show more" repeatedly: list grows past 30, deeper taps fetch page 2+ (network tab shows searchAll page param), button disappears when sources exhaust. Also type a song name → tap a ♫ suggestion → now-bar appears instantly with the stub and playback starts (kuwo + Deezer ARE reachable in this sandbox). Kuwo + Deezer are reachable in this sandbox.</human-check>
  </verify>
  <done>Hit-songs list renders `shown` rows (initial 30), Show more reveals loaded rows first then fetches cumulative-superset pages via searchAll(n, next), hasMore flips off on a non-growing page, state resets on artist change; `pnpm check` + `pnpm test` (incl. i18n key-parity test) pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries
| Boundary | Description |
|----------|-------------|
| suggestion text → URL path | Deezer-derived artist name enters goto() |
| suggestion text → resolveStub search | Deezer-derived artist/title enters searchAll via playStub |

## STRIDE Threat Register
| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-rjo-01 | Tampering | pickSuggestion goto | mitigate | encodeURIComponent(s.title) — identical to the existing artist-tile handler; SvelteKit decodes once (OG-COMPAT-01, never double-decode) |
| T-rjo-02 | DoS | loadMoreSongs page fetch | mitigate | tap-gated (no auto-loop), `loadingMoreSongs` re-entry guard, hasMore flips off on non-growing page, searchAll routes through the apiFetch governor |
| T-rjo-03 | DoS | song-suggestion playStub | mitigate | playStub's built-in same-key dedupe + pendingGen supersedence cap concurrent resolves at one; resolveStub routes through the apiFetch governor |
</threat_model>

<verification>
- `pnpm check` clean (svelte-check is the only quality gate).
- `pnpm test` clean — i18n key-parity test passes if a new key was added (Task 2 only; Task 1 reuses `home.unplayable`).
- The song RESULT ROW and artist TILE handlers require NO code change — confirm by diff that both are untouched; only `pickSuggestion` changes on the search page.
</verification>

<success_criteria>
- Artist typeahead suggestion tap → `/artist/{name}` (no search run).
- Song typeahead suggestion tap → instant optimistic playback via `player.playStub(s.artist ?? '', s.title, undefined, 'search')` — no search run, `q` untouched, miss toasts `home.unplayable` gated on `pendingTrack == null`.
- Album suggestions unchanged (fill + search); artist tiles and song result rows behave exactly as before (zero diff on those handlers).
- Artist page shows >30 hit songs via Show more, fetching searchAll page 2+ when needed, with per-artist state reset.
- All new code tab-indented, `$lib` aliases, comments tagged `quick-260831-rjo`.
</success_criteria>

<output>
Create `.planning/quick/260831-rjo-in-search-page-artist-click-goes-to-arti/260831-rjo-SUMMARY.md` when done.
</output>
