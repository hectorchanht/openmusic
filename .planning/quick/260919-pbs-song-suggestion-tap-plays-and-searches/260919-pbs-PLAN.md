---
phase: quick-260919-pbs
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/search/autocomplete-logic.ts
  - src/lib/search/autocomplete-logic.test.ts
  - src/routes/(app)/search/+page.svelte
autonomous: true
requirements: [QUICK-260919-PBS]

must_haves:
  truths:
    - "Tapping a song (♫) suggestion still locks the stub into the now-bar synchronously and plays it exactly as before"
    - "Tapping a song suggestion ALSO fills the input with '<title> <artist>' and the content area shows search results for that keyword"
    - "When the suggestion's artist is empty/undefined/whitespace, the committed keyword is the title alone"
    - "Artist (♪) and album (◎) suggestion taps behave exactly as before"
    - "The unplayable toast still fires only on a genuine miss (playStub null AND pendingTrack null), never on a supersede"
  artifacts:
    - path: "src/lib/search/autocomplete-logic.ts"
      provides: "pure suggestionKeyword() helper"
      exports: ["suggestionKeyword"]
    - path: "src/lib/search/autocomplete-logic.test.ts"
      provides: "co-located tests for suggestionKeyword"
      contains: "suggestionKeyword"
    - path: "src/routes/(app)/search/+page.svelte"
      provides: "song branch of pickSuggestion plays AND commits a search; decision block updated"
      contains: "quick-260919-pbs"
  key_links:
    - from: "src/routes/(app)/search/+page.svelte"
      to: "src/lib/search/autocomplete-logic.ts"
      via: "import suggestionKeyword"
      pattern: "suggestionKeyword"
    - from: "pickSuggestion song branch"
      to: "run()"
      via: "q = suggestionKeyword(s); run();"
      pattern: "q = suggestionKeyword\\(s\\)"
---

<objective>
Make a song-suggestion tap in the search typeahead do BOTH things: play the song (unchanged, via `player.playStub`) and commit a search for `"<title> <artist>"` through the existing `run()`, so the content area fills with results for the tapped song.

Purpose: today the tap plays but leaves the content area untouched; the user wants the results list to match the song they just tapped.
Output: one pure helper + test, a two-line change to the `song` branch of `pickSuggestion`, and an updated decision-record comment.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/routes/(app)/search/+page.svelte
@src/lib/search/autocomplete-logic.ts
@src/lib/search/autocomplete-logic.test.ts

<interfaces>
<!-- Extracted from the codebase. Use directly; no exploration needed. -->

From src/lib/search/autocomplete-logic.ts:
```typescript
export interface Suggestion {
	kind: 'song' | 'artist' | 'album';
	title: string;
	/** Present for `kind:'song'` and `kind:'album'` — the performing/album artist. */
	artist?: string;
	key: string;
}
// deriveSuggestions() already .trim()s artist, so a song suggestion CAN carry artist: ''.
```

From src/lib/stores/player.svelte.ts (line ~3183):
```typescript
async playStub(
	artist: string,
	title: string,
	cover?: string | null,          // 3rd arg is COVER, not a signal — nothing to abort from outside
	context: QueueContext = null,
	opts: { sameList?: boolean } = {}
): Promise<Track | null>          // null on miss OR supersede; pendingTrack stays non-null on supersede
```
Its only supersedence is the private `pendingGen`, bumped ONLY by another `playStub` call. The synchronous prologue (before its first `await`) sets `pendingTrack`, `loading = true`, `error = null`.

From src/routes/(app)/search/+page.svelte `run()` (line ~341): aborts `ac` / `moreAc` / `suggestAc`, cancels the debounced suggestion fetch, clears `suggestions`, blurs the input, calls `searchHistory.add(kw)`, resets page-local result state, then `searchAll(...)`. It never imports or mutates `player`; `prewarmTrack` only calls `ensureTrackDetails`.
</interfaces>

## Ordering analysis (established by reading, not assuming)

1. **`run()` cannot supersede the in-flight `playStub`.** `run()` aborts three controllers (`ac`, `moreAc`, `suggestAc`); none is passed to `playStub` — `playStub` has no signal parameter, and the current call passes `undefined` as the 3rd arg which is `cover`. `pendingGen` is private to the player and only `playStub` bumps it.
2. **A search commit never touches player state.** `run()` writes page-local `$state`, `searchHistory`, `searchSession`; no `setQueue`/`setListQueue`/`play`/gen bump anywhere in the commit or its boost/prewarm tail. The now-bar cannot be stranded.
3. **Order: PLAY FIRST, then `q = keyword; run()`.** The `void (async () => …)()` IIFE runs synchronously up to `playStub`'s first `await`, so the optimistic stub lands in the now-bar in the same tick as the click regardless of what follows. Putting play first also keeps playback independent of `run()`'s early returns (`if (!kw) return`, `if (!online.isOnline) return`) — a search that short-circuits must not silently swallow the play. Because neither call can affect the other (points 1-2), search-first would also work, but play-first is the order whose safety does not depend on `run()`'s internals staying as they are.
4. **No duplicated teardown.** `pickSuggestion` already does `inputFocused = false; suggestions = []; fetchSuggestions.cancel(); suggestAc?.abort()` at the top (needed by the artist branch, which never reaches `run()`). `run()` repeats the suggestion teardown itself; the song branch simply falls into `q = …; run()` like the album branch and adds nothing.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add pure `suggestionKeyword()` helper with co-located tests</name>
  <files>src/lib/search/autocomplete-logic.ts, src/lib/search/autocomplete-logic.test.ts</files>
  <behavior>
    - suggestionKeyword({ title: '有人', artist: '周杰倫' }) → '有人 周杰倫'
    - suggestionKeyword({ title: 'Song', artist: '' }) → 'Song'
    - suggestionKeyword({ title: 'Song' }) (artist undefined) → 'Song'
    - suggestionKeyword({ title: 'Song', artist: '   ' }) (whitespace-only artist) → 'Song'
    - suggestionKeyword({ title: '  Song  ', artist: ' Artist ' }) → 'Song Artist' (both sides trimmed, single space)
  </behavior>
  <action>
    In `src/lib/search/autocomplete-logic.ts`, below `deriveSuggestions`, export a pure function `suggestionKeyword(s: Pick<Suggestion, 'title' | 'artist'>): string` that returns the trimmed title, followed by a single space and the trimmed artist ONLY when the trimmed artist is non-empty; otherwise the trimmed title alone. Keyword form `"<title> <artist>"` is the user's locked decision (quick-260919-pbs) — do not add alternatives or options. Add a JSDoc block in the house comment style tagged `quick-260919-pbs` explaining: this is the query committed when a SONG suggestion is tapped; the falsy/whitespace-artist fallback exists because `deriveSuggestions` emits `artist: ''` for hits without an artist. Accept `Pick<Suggestion, 'title' | 'artist'>` (not the full `Suggestion`) so the test can pass minimal literals without fabricating `kind`/`key`.

    In `src/lib/search/autocomplete-logic.test.ts`, add `suggestionKeyword` to the existing import list and append a new `describe('suggestionKeyword', …)` block with the five cases in `<behavior>`. Follow the file's existing style: tabs, single quotes, `it(...)` names as plain sentences.

    Write the failing tests FIRST (RED), run them, then implement (GREEN).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run src/lib/search/autocomplete-logic.test.ts</automated>
  </verify>
  <done>`suggestionKeyword` is exported from autocomplete-logic.ts, all five new cases pass, and the pre-existing tests in the file still pass.</done>
</task>

<task type="auto">
  <name>Task 2: Song branch of pickSuggestion plays AND commits the search; update decision block</name>
  <files>src/routes/(app)/search/+page.svelte</files>
  <action>
    1. Add `suggestionKeyword` to the existing multi-line import from `'$lib/search/autocomplete-logic'` (lines 13-19), keeping alphabetical-ish placement alongside `deriveSuggestions`.

    2. In `pickSuggestion` (line ~152), change ONLY the `song` branch. Keep the `void (async () => { … })()` block and its toast gating byte-for-byte (`playStub` returns null for BOTH a miss AND a supersede, so the toast stays gated on `player.pendingTrack == null`). Directly after the IIFE, replace the bare `return;` with `q = suggestionKeyword(s); run(); return;`. Play stays FIRST: the IIFE runs synchronously up to playStub's first `await`, so the optimistic stub is locked into the now-bar in the same tick, and playback does not depend on `run()`'s early-return guards (`!kw`, `!online.isOnline`). Do NOT add any teardown (suggestions/abort/focus) — `pickSuggestion`'s top already does it and `run()` repeats its own. Do NOT touch the `artist` branch or the `album` fallthrough (`q = s.title; run();`). Do NOT modify `run()`.

    3. UPDATE the decision-record comment block at lines 143-151 (tagged `quick-260831-rjo`). Do not delete the `quick-260831-rjo` reference or the artist/album bullets. Rewrite the `song (♫)` bullet to record the `quick-260919-pbs` decision: the tap now PLAYS via playStub AND commits a search for `suggestionKeyword(s)` (`"<title> <artist>"`, title alone when artist is empty). State plainly why rjo's original concern no longer applies: the concern was "committed-looking text over a content area that never searched for it" — now the content area DOES search for exactly the text in the input, so the two are consistent. Add a short note recording the ordering finding: play first, then `run()`; safe because `run()` aborts only `ac`/`moreAc`/`suggestAc` (none threaded into playStub, whose 3rd arg is `cover`, not a signal) and never touches player state or `pendingGen`.

    Tabs for indentation, single quotes, runes mode (no new reactive constructs are needed).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm check && grep -c "quick-260919-pbs" "src/routes/(app)/search/+page.svelte" && grep -c "quick-260831-rjo" "src/routes/(app)/search/+page.svelte" && grep -c "q = suggestionKeyword(s)" "src/routes/(app)/search/+page.svelte"</automated>
  </verify>
  <done>`pnpm check` passes with zero errors; the song branch calls playStub (unchanged toast gating) then `q = suggestionKeyword(s); run();`; the decision block references BOTH `quick-260831-rjo` and `quick-260919-pbs`; artist and album branches and `run()` are unchanged in the diff.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Deezer suggestion → search keyword | Upstream-derived title/artist strings become the committed `q`; already the case for the album branch today. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-pbs-01 | Tampering | `suggestionKeyword` → `run()` → `searchAll` | accept | Keyword is a plain string bound to an `<input>` value and passed to the existing `searchAll` path exactly as the album branch already does; Svelte text binding escapes it, no HTML/URL is constructed from it. No new surface. |
| T-pbs-02 | Denial of Service | double network fan-out per tap (resolveStub + searchAll) | accept | Both requests route through the existing `apiFetch` governor (concurrency cap + GET dedupe + circuit breaker); one extra search per user tap is the same load as the album branch. |
| T-pbs-SC | Tampering | npm installs | accept | No new dependencies. |
</threat_model>

<verification>
- `pnpm vitest --run src/lib/search/autocomplete-logic.test.ts` — helper cases green, existing cases untouched.
- `pnpm check` — svelte-check clean.
- `git diff --stat` shows only the three files in `files_modified`; `git diff` of `+page.svelte` shows no change inside `run()`, the artist branch, or the album fallthrough.
</verification>

<success_criteria>
- Tapping a ♫ suggestion: now-bar shows the stub immediately (as before), audio plays (as before), the input reads `"<title> <artist>"` and the content area shows results for it.
- Suggestion with empty artist commits the title alone.
- ♪ and ◎ taps unchanged. Unplayable toast gating unchanged.
- Decision block records `quick-260919-pbs` alongside `quick-260831-rjo` with the reason the earlier objection is resolved.
</success_criteria>

<output>
Create `.planning/quick/260919-pbs-song-suggestion-tap-plays-and-searches/260919-pbs-SUMMARY.md` when done.
</output>
