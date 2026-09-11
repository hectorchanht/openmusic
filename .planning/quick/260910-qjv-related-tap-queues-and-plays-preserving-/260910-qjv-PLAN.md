---
phase: quick-260910-qjv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
  - src/lib/stores/player.svelte.test.ts
  - src/routes/(app)/search/+page.svelte
  - src/routes/(app)/+page.svelte
  - src/lib/components/CompactRow.svelte
autonomous: false
requirements: [QUICK-260910-qjv]
must_haves:
  truths:
    - "With a multi-song Up Next installed, tapping a Related row starts that song immediately AND every pre-existing Up Next entry survives in its original relative order; the tapped song sits immediately after the previously-playing track"
    - "The Up-Next list does not collapse or regenerate on a Related tap: upNextAnchorUid is unchanged, buildSimilarQueue is not invoked, queueContext is unchanged"
    - "Tapping a Related row that is ALREADY in the queue moves it to right-after-current (no duplicate) and plays it"
    - "Nothing playing (no current): a Related tap plays the song exactly once (no double play())"
    - "Swipe-right (add to queue), swipe-left (play next) and long-press menu on the same Related rows behave exactly as before"
    - "Every artist-representing tap target (search artist tile, home Top-artists / Favourite-artists grid tile + round row tile + compact row, Now Playing inline artist name) visibly shrinks on tap like song rows; no non-artist control gains the action"
  artifacts:
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "relatedTapPlay(track) helper composing player.playNext + player.play(track, { fresh: false }); rel-row onclick swapped to it; use:tapBounce on .artist-link"
      contains: "quick-260910-qjv"
    - path: "src/lib/stores/player.svelte.test.ts"
      provides: "Node test: playNext + non-fresh play preserves queue order, anchor, context; no regenerate; dedupe of an already-queued track"
      contains: "quick-260910-qjv"
    - path: "src/routes/(app)/search/+page.svelte"
      provides: "use:tapBounce on .artist-tile"
    - path: "src/routes/(app)/+page.svelte"
      provides: "use:tapBounce on artistGridTile snippet + the two round .album artist rows"
    - path: "src/lib/components/CompactRow.svelte"
      provides: "use:tapBounce on the artist-variant .crow"
  key_links:
    - from: "src/lib/components/NowPlaying.svelte (.rel-row onclick)"
      to: "src/lib/stores/player.svelte.ts playNext + play"
      via: "relatedTapPlay(track)"
      pattern: "onclick=\\{\\(\\) => relatedTapPlay\\(track\\)\\}"
    - from: "src/lib/components/NowPlaying.svelte relatedTapPlay"
      to: "player.play non-fresh branch (no regenerate / no anchor reset)"
      via: "player.play(track, { fresh: false })"
      pattern: "player\\.play\\(track, \\{ fresh: false \\}\\)"
---

<objective>
(A) A tap on a Now Playing "Related" row currently runs `player.play(track, { fresh: true })`, which weaves history + re-anchors + regenerates the tail — i.e. it throws the user's Up Next away. Change the tap to INSERT the song right after the current one and SWITCH to it, preserving everything else in Up Next. Composition of two existing store methods, zero store edits: `playNext(track)` (already the swipe-left affordance on this very list — de-dupes, splices after current, pins in manualUids, persists) followed by the NON-fresh `play(track, { fresh: false })` (the path next()/prev()/auto-advance use: it never touches queue, queueContext, upNextAnchorUid, removedUids, and never calls regenerate). The anchored Up-Next slice (`upNextList = queue.slice(anchorIdx)`) therefore keeps every row; only the `.playing` highlight moves to the inserted row.

(B) Song rows shrink on tap via `use:tapBounce`; artist items do not. Add the action to every artist-representing tap target that lacks it — six sites — and nothing else.

Purpose: Related becomes "queue at the top and play" instead of "nuke my queue"; artist taps get the same tactile feedback as songs.
Output: a helper + one onclick swap + one `use:` in NowPlaying.svelte; one node test; five one-token `use:tapBounce` additions across three files.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@src/lib/components/NowPlaying.svelte
@src/lib/stores/player.svelte.ts
@src/lib/stores/player.svelte.test.ts
@src/lib/actions/tapBounce.ts
@src/routes/(app)/search/+page.svelte
@src/routes/(app)/+page.svelte
@src/lib/components/CompactRow.svelte

<interfaces>
<!-- Verified from the codebase during planning. Use directly — no exploration needed. -->

From src/lib/stores/player.svelte.ts:
```ts
// Insert right after current (de-duped by uid), pins uid in manualUids, persists.
// If NO current: calls this.play(t) itself (non-fresh) — so a follow-up play() would be a DOUBLE play.
playNext(t: Track): void                                   // ~line 2277
addToQueue(t: Track): void                                 // ~line 2288
// opts.fresh === true  → weaveFreshHistory + upNextAnchorUid = resolved.uid + removedUids.clear() + regenerate (generated mode)
// opts.fresh falsy     → NONE of the above; only pendingHistory/pendingManual nulled, then primeNext()
async play(track: Track, opts?: { fresh?: boolean; fromFallback?: boolean; context?: QueueContext }): Promise<void>  // ~line 2885
current: Track | null            // $state
queue: Track[]                   // $state
upNextAnchorUid: string | null   // $state — set ONLY by fresh play / setQueue / setListQueue / clearQueue / restore
queueContext: QueueContext       // $state
```

From src/lib/components/NowPlaying.svelte:
```ts
// ~line 428-449: `related` = searchAll(current.artist) deduped, .filter((x) => x.uid !== t.uid).slice(0, 20)
//   → the CURRENT track is never in the list; the $effect reloads the list whenever player.current changes
//     while tab === 'related' (relatedFor race guard).
// ~line 701-710 (quick-260625-pzs-02):
function relatedSwipeQueue(track: Track)   // player.addToQueue + toast + hapticTick
function relatedSwipeNext(track: Track)    // player.playNext   + toast + hapticTick
// ~line 575-590: ci / anchorIdx / upNextStart / upNextList = player.queue.slice(upNextStart)
// line 1406: <button class="artist-link" onclick={() => openArtistName(name)}>  — NO use:tapBounce
// line 1624: <button class="row rel-row" use:longpress onlongpress={…} onclick={() => player.play(track, { fresh: true })} use:swipeAction={{ onSwipeRight: () => relatedSwipeQueue(track), onSwipeLeft: () => relatedSwipeNext(track) }}>
// tapBounce is ALREADY imported in NowPlaying.svelte (used on header/transport buttons).
```

From src/lib/stores/player.svelte.test.ts (existing harness, reuse — do NOT add new mocks):
```ts
// module-level: vi.mock('$lib/services/similar', () => ({ buildSimilarQueue: vi.fn(async () => []) }))
const mockSimilar = vi.mocked(buildSimilarQueue);
const mockEnsure = vi.mocked(ensureTrackDetails);
// helpers defined in-file: mk(source, id, artist, title): Track · makeFakeAudio() · flush()
// idiom (piz suite, ~line 512-521): (player.play as unknown as { mockRestore(): void }).mockRestore?.();
//   mockEnsure.mockReset(); player.current = null; player.queue = [];
//   player.attach(makeFakeAudio() as unknown as HTMLAudioElement);
//   mockEnsure.mockImplementation(async (t: Track) => t);
```

Artist tap targets — audit result (planning-time grep + read):
```text
MISSING use:tapBounce (add):
  src/routes/(app)/search/+page.svelte:732   <button class="artist-tile" onclick={() => goto('/artist/' + …tile.name)}>
  src/routes/(app)/+page.svelte:745          {#snippet artistGridTile} <button class="tile artist-tile" onclick={…}>
  src/routes/(app)/+page.svelte:803          top-artists .albumrow  <button class="album" onclick={() => goto('/artist/' + …a.name)}>
  src/routes/(app)/+page.svelte:977          fav-artists .albumrow  <button class="album" onclick={() => goto('/artist/' + …a.name)}>
  src/lib/components/CompactRow.svelte:81    {#if variant === 'artist'} <button class="crow" onclick={() => onopen?.()}>
  src/lib/components/NowPlaying.svelte:1406  <button class="artist-link" onclick={() => openArtistName(name)}>
ALREADY HAVE IT (leave alone):
  library/+page.svelte:298 .fav-tile · artist/[name]/+page.svelte:638 "More like this" .album ·
  TrackMenu.svelte:401 Go to artist .mi · search/+page.svelte:666-674 .suggest-row (artist kind)
tapBounce import: already present in +page.svelte, search/+page.svelte, CompactRow.svelte, NowPlaying.svelte.
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Related tap = playNext + non-fresh play (queue-preserving), with a store-level node test</name>
  <files>src/lib/components/NowPlaying.svelte, src/lib/stores/player.svelte.test.ts</files>
  <behavior>
    Add ONE new `describe('Related tap — playNext + non-fresh play preserves Up Next (quick-260910-qjv)')` block to player.svelte.test.ts, using the piz-suite beforeEach restore idiom (real play(), mockEnsure identity, fake audio, current/queue reset, `mockSimilar.mockClear()`). Setup for each test: queue = [q1,q2,q3,q4] via `player.setQueue(...)`, then `await player.play(q2); await flush()` (non-fresh → current = q2, nothing regenerated), then `player.upNextAnchorUid = q1.uid; player.queueContext = 'search'`.
    - Test 1 (new track R not in queue): `player.playNext(R); await player.play(R, { fresh: false }); await flush()` → `queue.map(uid)` equals `[q1,q2,R,q3,q4]`; `current.uid === R.uid`; `upNextAnchorUid === q1.uid`; `queueContext === 'search'`; `mockSimilar` not called (no regenerate).
    - Test 2 (already queued q4): same sequence with q4 → `queue.map(uid)` equals `[q1,q2,q4,q3]` (moved, not duplicated); `current.uid === q4.uid`; anchor still q1.
    - Test 3 (cold start): `player.current = null; player.queue = []` → `player.playNext(R)` alone leaves `current.uid === R.uid` and `queue` = [R] — the component MUST NOT call play() again in this case (assert via `vi.spyOn(player, 'play')` count === 1 after running the same guard logic the component uses: `if (player.current?.uid !== R.uid) play(...)` — i.e. assert the condition is false after playNext).
    Tests run under the single node Vitest project (no jsdom); use only helpers already in the file.
  </behavior>
  <action>
    In `src/lib/components/NowPlaying.svelte`, directly below `relatedSwipeNext` (~line 710), add a `relatedTapPlay(track: Track)` helper with a `// quick-260910-qjv:` decision comment explaining: tap = "queue at the top and play" — insert via the EXISTING `player.playNext` (same surgery the swipe-left affordance on this list already uses: de-dupe, splice after current, pin in manualUids, persist) then switch via the NON-fresh `player.play(track, { fresh: false })`, which never weaves history, never re-anchors `upNextAnchorUid`, never clears `removedUids` and never regenerates — so `upNextList` (anchored slice) keeps every row and only the `.playing` highlight moves down one. Body, three statements:
    1. `if (player.current?.uid === track.uid) return;` — tapping the now-playing song is a no-op. Comment WHY: the related list already excludes current and reloads on current change, so this only covers the async reload window; a no-op (rather than a restart) avoids `playNext` mis-splicing the current track to index 0 (playNext filters the uid out THEN looks for current — it would be gone).
    2. `player.playNext(track);` — when there is NO current, playNext calls `this.play(t)` itself and sets `current` synchronously.
    3. `if (player.current?.uid !== track.uid) void player.play(track, { fresh: false });` — the guard is exactly what prevents a double play() on the cold-start path. No toast/haptic: the row becoming the playing track is the feedback (the swipe helpers keep theirs).
    Swap the `onclick` at line ~1624 from `() => player.play(track, { fresh: true })` to `() => relatedTapPlay(track)`. Leave `use:longpress`, `onlongpress`, `use:swipeAction` and both swipe helpers byte-identical; leave the VersionPicker `onpick` at ~1651 (`play(v, { fresh: true })`) alone — a version switch IS a fresh play. Do not add `use:tapBounce` to `.rel-row` in this task (out of scope for (B); flag in the SUMMARY that rel-row lacks it while other song rows have it).
    Do NOT edit `player.svelte.ts` — no new method, no `$effect`, no store diff.
    Add the tests described in `<behavior>` to `src/lib/stores/player.svelte.test.ts` (new describe block appended near the piz suite so the same helpers are in scope).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm test -- src/lib/stores/player.svelte.test.ts 2>&1 | tail -15 && grep -n "relatedTapPlay(track)" src/lib/components/NowPlaying.svelte | grep -c "onclick" && grep -v '^\s*//' src/lib/components/NowPlaying.svelte | grep -c "fresh: false" && git diff --stat -- src/lib/stores/player.svelte.ts | wc -l</automated>
  </verify>
  <done>New describe block passes (3 tests) with the whole player suite green; `.rel-row` onclick calls `relatedTapPlay(track)`; `player.svelte.ts` has zero diff; swipe helpers + longpress markup unchanged (`git diff` on NowPlaying.svelte shows only the helper block, the onclick token, and — after Task 2 — the artist-link `use:`).</done>
</task>

<task type="auto">
  <name>Task 2: use:tapBounce on every artist tap target that lacks it (six sites), then typecheck + full suite</name>
  <files>src/routes/(app)/search/+page.svelte, src/routes/(app)/+page.svelte, src/lib/components/CompactRow.svelte, src/lib/components/NowPlaying.svelte</files>
  <action>
    Add the `use:tapBounce` directive (pure additive action — no preventDefault/stopPropagation, composes with onclick/longpress/swipeAction per tapBounce.ts header) to exactly these six buttons, each with a short `<!-- quick-260910-qjv: artist tap feedback, parity with song rows -->` comment on the FIRST site in each file (one comment per file, not per line, to keep the diff small):
    1. `src/routes/(app)/search/+page.svelte` ~line 732 `<button class="artist-tile" …>` (search Artists shelf).
    2. `src/routes/(app)/+page.svelte` ~line 745 `{#snippet artistGridTile}` `<button class="tile artist-tile" …>` (covers BOTH the Top-artists and Favourite-artists 3×3 grid modes — the snippet is rendered at ~795 and ~969).
    3. `src/routes/(app)/+page.svelte` ~line 803 Top-artists row-mode `<button class="album" onclick={() => goto('/artist/' + …a.name)}>`.
    4. `src/routes/(app)/+page.svelte` ~line 977 Favourite-artists row-mode `<button class="album" onclick={() => goto('/artist/' + …a.name)}>`.
    5. `src/lib/components/CompactRow.svelte` ~line 81 `{#if variant === 'artist'}` `<button class="crow" onclick={() => onopen?.()}>` (covers the compact-density Top-artists / Favourite-artists shelves on Home; tapBounce is already imported at line 18 for the track variant).
    6. `src/lib/components/NowPlaying.svelte` ~line 1406 the inline `<button class="artist-link" onclick={() => openArtistName(name)}>` under the title (one per artist name, rendered inside the marquee).
    All four files already import `tapBounce` — add no imports. Do NOT touch: non-artist `.album`/`.tile` song/album tiles (they already have it), `.artist-sep`, the search `.suggest-row`, library `.fav-tile`, artist-page "More like this" `.album`, TrackMenu `.mi` (all already have it), and any control that is not an artist item. Then run `pnpm check` and the full `pnpm test`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -c 'class="artist-tile" onclick.*use:tapBounce\|class="artist-tile" use:tapBounce' "src/routes/(app)/search/+page.svelte" && grep -c 'artist-tile.*use:tapBounce\|use:tapBounce.*artist-tile' "src/routes/(app)/+page.svelte" && grep -n "goto('/artist/'" "src/routes/(app)/+page.svelte" | grep -c "use:tapBounce" && sed -n 80,82p src/lib/components/CompactRow.svelte | grep -c "use:tapBounce" && grep -c 'class="artist-link"[^>]*use:tapBounce' src/lib/components/NowPlaying.svelte && pnpm check 2>&1 | tail -3 && pnpm test 2>&1 | tail -6</automated>
  </verify>
  <done>Six artist tap targets carry `use:tapBounce` (search tile: 1; home: snippet + 2 round rows = 3 `goto('/artist/'` buttons with the action + the snippet; CompactRow artist variant: 1; NowPlaying artist-link: 1); `pnpm check` reports 0 errors; `pnpm test` fully green; `git diff --stat` touches only the five files listed in `files_modified`.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Behavioural verification — Up Next preserved on Related tap; artist items bounce</name>
  <what-built>(A) Related-row tap now inserts the song right after the current one and switches to it, preserving the rest of Up Next (no fresh-play rebuild). (B) Artist items (search artist tiles, home Top-artists / Favourite-artists in all three densities, Now Playing inline artist name) shrink on tap like song rows.</what-built>
  <how-to-verify>
    Dev server: `pnpm dev` (port 4321 if launched via launch.json, else 5173 — probe, don't assume). Use a kuwo-heavy search (kuwo + Deezer reach the sandbox; netease/qq proxies do not).
    1. Search an artist with many songs (e.g. "Coldplay"), tap the FIRST result → it plays with a multi-song Up Next. Open Now Playing → Up Next tab. Write down the first 5-6 rows in order (current first) — call the current song C and the next rows N1, N2, N3….
    2. Switch to the Related tab. TAP (do not swipe) a row R that is NOT already in your Up Next list.
       Expected: (1) R starts playing (Nowbar/hero title = R within a couple of seconds); (2) switch to Up Next: the list still starts at the same anchor row, C is now a played row directly ABOVE R, R carries the playing highlight, and N1, N2, N3… ALL still follow R in their original relative order — nothing dropped, nothing re-generated, no list flash/collapse.
    3. Related tab again → TAP a row that IS already in Up Next (scroll Up Next first to pick one, e.g. N3). Expected: it plays, appears exactly once (moved to right after the previously-playing row), the other rows keep their order.
    4. Regression on the same Related list: swipe RIGHT a row → "Added to queue" toast, appended at the end of Up Next, playback unaffected; swipe LEFT a row → "Playing next" toast, inserted after current, playback unaffected; LONG-PRESS a row → track menu opens.
    5. Cold start: Settings → Data → clear queue (or use a fresh incognito window), open the Now Playing sheet via any song row, pause, Related tab, tap a row: it plays once (no stutter/double-start in the Activity log: one `play` entry for that uid).
    6. Tap feedback (B): search "Coldplay" → tap an artist tile in the Artists shelf; Home → Top artists shelf in each density (row / grid / compact via the shelf density toggle) → tap an artist; Favourite artists shelf likewise; Now Playing → tap the artist name under the title. Each visibly shrinks-and-springs on press before navigating. Spot-check a NON-artist control you did not touch still behaves the same (e.g. the Up Next tab button).
  </how-to-verify>
  <resume-signal>Type "approved" or describe what differed (which step, what you saw).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| none new | Both changes are client-only UI wiring over existing store methods and an existing pure-DOM action; no new network call, storage key, or input surface. Artist names still flow through the existing `encodeURIComponent` nav idiom (T-pzs-04 / OG-COMPAT-01) unchanged. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-qjv-01 | Denial of Service | relatedTapPlay → play() | mitigate | Reuses play()'s existing generation guards (playGen) and the non-fresh path; no new `$effect`, no new store fields, so none of the three documented loop classes (reresolve storm / fetch flood / restore self-invalidation) gain a new trigger. Guard prevents a double play() on cold start. |
| T-qjv-02 | Tampering | queue order | mitigate | Only `playNext` mutates the queue (already in production via swipe-left); node test asserts order + anchor + context invariants. |
| T-qjv-SC | Tampering | npm installs | accept | No package installs in this plan. |
</threat_model>

<verification>
- `pnpm test` green, including the new `quick-260910-qjv` describe block in `player.svelte.test.ts`.
- `pnpm check` 0 errors.
- `git diff --stat -- src/lib/stores/player.svelte.ts` is empty (no store change).
- Human checkpoint: behavioural Up Next preservation (steps 1-3), sibling affordances intact (step 4), no double play on cold start (step 5), artist shrink-on-tap across all listed surfaces (step 6).
- No `git push`, deploy, or APK build in this task (pushes to main auto-deploy production).
</verification>

<success_criteria>
- Tapping a Related row plays it and it sits immediately after the previously-playing track; every other Up Next entry survives in original relative order; anchor/context unchanged; no regenerate.
- Already-queued Related tap moves (no duplicate); cold-start tap plays exactly once; now-playing tap is a no-op.
- Swipe-right / swipe-left / long-press on Related rows unchanged.
- Six artist tap targets bounce on tap; no non-artist control gained the action.
- SUMMARY flags plainly: (i) tap and swipe-left now overlap — both insert after current; tap additionally switches. Distinct but adjacent; user may want to keep or retire swipe-left. (ii) `.rel-row` itself still lacks `use:tapBounce` unlike other song rows (deliberately untouched under the artist-only scope of (B)). (iii) Edge: tapping a Related song that is currently the list ANCHOR (a played row above current) moves it after current, so the rows above it drop out of the visible slice — acceptable, anchor uid still present so the list never blanks.
</success_criteria>

<output>
Create `.planning/quick/260910-qjv-related-tap-queues-and-plays-preserving-/260910-qjv-SUMMARY.md` when done. List every file/line changed for (B) explicitly.
</output>
