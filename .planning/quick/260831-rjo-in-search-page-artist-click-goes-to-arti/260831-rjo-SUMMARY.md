---
phase: quick-260831-rjo
plan: 01
subsystem: search + artist page
tags: [search, typeahead, artist, pagination, i18n]
requires: [player.playStub, searchAll, dedupeBest]
provides: [kind-branched typeahead routing, artist hit-songs pagination, artist.showMore]
affects: [src/routes/(app)/search/+page.svelte, src/routes/(app)/artist/[name]/+page.svelte, src/lib/i18n/*]
tech-stack:
  added: []
  patterns: [cumulative-superset paging, optimistic resolve-on-tap, loadedFor race guard]
key-files:
  created: []
  modified:
    - src/routes/(app)/search/+page.svelte
    - src/routes/(app)/artist/[name]/+page.svelte
    - src/lib/i18n/{ar,de,en,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "Song typeahead tap plays via playStub and leaves `q` untouched — the tap is a play action, not a query commit"
  - "Show more is a tap control, not an IntersectionObserver sentinel — smallest correct diff for a below-the-fold list"
  - "New key artist.showMore added to all 15 dictionaries; loading row reuses the existing search.loadingMore"
metrics:
  duration: ~15 min
  completed: 2026-08-31
---

# Quick 260831-rjo: Typeahead click routing + artist hit-songs pagination — Summary

Typeahead suggestion taps are now kind-branched (artist navigates, song plays optimistically, album still searches), and the artist page's hit-songs list paginates past its old hard 30-row cap.

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 | Kind-branched `pickSuggestion` on the search page | `a4939b4` |
| 2 | Artist hit-songs render window + deeper-page fetch + `artist.showMore` in 15 locales | `455cd69` |

## What changed

**Task 1 — `src/routes/(app)/search/+page.svelte`**
`pickSuggestion(s)` used to fill the input and run a full search for every suggestion kind. It now clears typeahead state (unchanged) and then branches:
- `artist` → `goto('/artist/' + encodeURIComponent(s.title))`, same nav idiom as the artist tile handler (single encode — SvelteKit decodes the param itself, OG-COMPAT-01). No `run()`, `q` untouched.
- `song` → `void`-fired async IIFE calling `player.playStub(s.artist ?? '', s.title, undefined, 'search')`; the click handler does not block on the resolve. Miss toast is gated on `player.pendingTrack == null` so a supersede stays silent, reusing the existing `home.unplayable` key (no new i18n key here).
- `album` → verbatim prior behavior (`q = s.title; run();`).

The artist TILE handler and the song RESULT-ROW handler were confirmed already correct and are byte-for-byte untouched (verified in the commit diff — the only changed function on that page is `pickSuggestion`).

**Task 2 — `src/routes/(app)/artist/[name]/+page.svelte`**
- New state: `SONGS_PAGE_SIZE = 30`, `shown`, `songsPage`, `hasMoreSongs`, `loadingMoreSongs`.
- The existing load `$effect`'s `loadedFor !== n` branch resets all of them (incl. `loadingMoreSongs`, since a stale in-flight page is blocked by the `loadedFor` guard from clearing the new artist's flag).
- Render slice `songs.slice(0, 30)` → `songs.slice(0, shown)`.
- `loadMoreSongs()`: re-entry guard → reveal already-loaded rows (`shown += 30`, zero network) → else, if `hasMoreSongs && online.isOnline`, `searchAll(n, songsPage + 1)` → `dedupeBest(…, settings.preferredSource)`; `merged.length <= songs.length` flips `hasMoreSongs = false`, otherwise the cumulative superset REPLACES `songs` (never concatenated — duplicate uids would break the keyed `{#each}`), bumps `songsPage`, widens `shown`. `.catch` flips `hasMoreSongs = false`; every assignment is behind `loadedFor === n`.
- Control under the `</ul>`: `.more` slot rendering either `search.loadingMore` (existing key) or a `use:tapBounce` `.act` pill labelled `artist.showMore`, hidden once sources are exhausted and everything loaded is on screen.
- Playback semantics unchanged: the row tap still calls `player.setListQueue(songs, 'artist')`, which queues the FULL loaded set, not the render window.

`artist.showMore` was added to all 15 locale dictionaries in double-quote house style with real translations; `i18n.test.ts` key-parity passes.

## Verification (observed, not assumed)

- `pnpm check` — `4400 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` (run after each task).
- `pnpm test` — `Test Files 98 passed (98) · Tests 1829 passed (1829)`, includes the i18n key-parity test.
- `grep` gates from the plan: `kind === 'artist'` (line 171) and `player.playStub` (line 181) present in the search page; `songs.slice(0, shown)` (line 593) and 5 `quick-260831-rjo` tags present in the artist page.
- NOT verified by me: the browser/human check (tapping ♪ / ♫ suggestions, tapping Show more against a live prolific artist). No browser tooling was available in this run — the `<human-check>` in the plan is still outstanding.
- Caveat on the gates: both `pnpm check` and `pnpm test` ran against a working tree that also contained ANOTHER concurrent session's in-progress `quick-260831-re9` MusicBrainz changes (see Deviations). My commits were verified content-wise via `git show`, but the gates were not re-run against a tree containing only my commits.

## Deviations from Plan

### [Rule 3 - Blocking] Concurrent session editing the same file — surgical staging

- **Found during:** Task 2 commit.
- **Issue:** `src/routes/(app)/artist/[name]/+page.svelte` was being edited LIVE by another session (`quick-260831-re9`, MusicBrainz discography/identity), along with `src/lib/services/deezer.ts`, `src/lib/services/discography.ts`, `src/routes/(app)/album/[name]/+page.svelte` and `src/routes/(app)/artist/[name]/albums/+page.svelte`. The Edit tool reported the file changing on disk mid-task. `git add <file>` would have swept that unrelated in-progress work into my commit.
- **Fix:** Split the file's diff into hunks, kept only the 6 hunks that are mine (matched on `quick-260831-rjo` / `songs.slice(0, shown)`, with an assertion that no kept hunk also contained `re9`/`qkx` markers), and staged them with `git apply --cached --recount`. The other session's 8 hunks remain uncommitted in the working tree, untouched.
- **Files modified:** none extra — this only changed HOW the commit was staged.
- **Commit:** `455cd69`.

### [Rule 2 - Missing critical] `loadingMoreSongs` reset on artist change

- **Found during:** Task 2.
- **Issue:** The `.finally` clears `loadingMoreSongs` only under `loadedFor === n`. Navigating artist→artist mid-fetch would therefore leave the flag stuck `true` forever, permanently disabling Show more on the new artist.
- **Fix:** Added `loadingMoreSongs = false` to the load effect's per-artist reset block. The plan listed only `shown`/`songsPage`/`hasMoreSongs` there.
- **Commit:** `455cd69`.

### [Rule 1 - Bug] Loading row markup

- **Found during:** Task 2.
- **Issue:** First draft used `<p class="muted center">`; the page's `.center` rule is scoped as `.al-name.center`, so Svelte's scoped CSS would not have centered it.
- **Fix:** Both states render inside the shared `.more` flex-centered wrapper instead.
- **Commit:** `455cd69`.

## Assumption Drift (advisory)

- **Planned:** the plan said "add `artist.showMore` to ALL 16 locale dictionaries". **Actual:** there are 15 locale dictionaries (`ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant`); the other three `.ts` files in `src/lib/i18n/` are `index.ts`, `detect.ts` and tests. All 15 were updated and parity passes. **Why:** count in the plan text was off by one; no behavioral impact.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path, or trust boundary. The plan's three registered threats are all mitigated as specified: T-rjo-01 single `encodeURIComponent`, T-rjo-02 tap-gated + re-entry guard + `hasMore` termination, T-rjo-03 playStub's own dedupe/supersedence.

## Self-Check: PASSED

- `a4939b4` FOUND, `455cd69` FOUND.
- `src/routes/(app)/search/+page.svelte` FOUND; `src/routes/(app)/artist/[name]/+page.svelte` FOUND (5 `quick-260831-rjo` tags in the committed blob).
- Commit `455cd69` deletes no tracked files (`git diff --diff-filter=D` empty).
