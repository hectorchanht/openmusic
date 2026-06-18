---
phase: quick-260618-ink
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
  - src/lib/stores/player.svelte.test.ts
autonomous: true
requirements: [INK-01, INK-02]
must_haves:
  truths:
    - "On a fresh click-to-play, the Up-Next LIST's first visible row is the new current song (woven history no longer precedes it in the list)."
    - "Manual play-next / add-to-queue entries (manualUids) still appear in the Up-Next list immediately after the new current."
    - "prev()/history navigation and the cover carousel (prev neighbor) still work — history remains in player.queue, only the LIST view is sliced."
    - "Opening the Up-Next tab scrolls the current row to the TOP of the panel scroller, ONE-SHOT (not on every queue mutation)."
    - "The continuous auto-scroll-into-view removed by 260615-mnr is NOT reintroduced (overflow-anchor:none stays; no scroll on queue mutation)."
  artifacts:
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "Up-Next list sliced from current index forward + one-shot scroll-to-current on tab open"
    - path: "src/lib/stores/player.svelte.test.ts"
      provides: "Regression coverage that the store queue shape (history-before-current) is unchanged"
  key_links:
    - from: "src/lib/components/NowPlaying.svelte upNextList $derived"
      to: "player.queue + ci"
      via: "slice(Math.max(0, ci))"
      pattern: "player\\.queue\\.slice"
    - from: "src/lib/components/NowPlaying.svelte scroll $effect"
      to: ".panel scroller + .q-row.playing"
      via: "scrollTop = row.offsetTop on tab==='queue' open transition"
      pattern: "scrollTop|scrollIntoView"
---

<objective>
Two queue/now-playing UX tweaks in the SvelteKit player (code under src/, NOT index.html).

1. **Up-Next list starts at the new song.** On a fresh click-to-play, the Up-Next LIST's first
   row must be the clicked/new current song. Today `player.queue` is `[...history(capped 50),
   priorCurrent, clicked(new current), ...manual, ...tail]` (260615-i9u wove history before current
   so `prev()` + the cover carousel work), and NowPlaying renders the WHOLE `player.queue`, so the
   history prefix shows above current. Fix the VIEW (render the Up-Next list from the current
   track's index forward) — NOT the store — so `prev()`/history (260615-i9u) and the cover-carousel
   `prevCover` (which both read the unsliced `player.queue`) keep working untouched.

2. **Open Up-Next → scroll current to top.** When the Up-Next tab becomes visible, scroll the
   `.panel` scroller so the current row sits at the TOP of the visible area — ONE-SHOT, on open
   only. Must NOT reintroduce the continuous auto-scroll-into-view that 260615-mnr deliberately
   removed (it set `overflow-anchor:none` and stopped yanking the current song into view on every
   queue mutation).

Purpose: the clicked song reads as "now playing, queue follows" and opening the queue lands the
user on the current song without manual scrolling.
Output: edits to NowPlaying.svelte (+ test regression guard); zero store-shape change.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

<!-- SCOUTING FINDINGS — ground truth (do NOT re-derive; trust these line refs). -->

STORE — src/lib/stores/player.svelte.ts (DO NOT EDIT in this plan; reference only):
- `queue = $state<Track[]>([])` (line 212) is the PUBLIC up-next array. Fresh-play shape after
  `weaveFreshHistory` (line 1992) + `weaveManualAfterSeed` (line 2022) is:
  `[...history(capped HISTORY_CAP=50), priorCurrent, clicked(new current), ...manual, ...generatedOrListTail]`.
- History is INTENTIONALLY kept in `queue` ahead of current so `prev()` (line ~2150) back-walks it
  and the cover carousel derives `prevCover` from it. The "history appears before current" symptom
  is purely a VIEW artifact of rendering the whole array.
- `manualUids` (Set, line 609) entries are spliced right AFTER current by `weaveManualAfterSeed`;
  the prior auto/context tail is already dropped on a fresh play (260618-fiz Fix 4). So a
  forward-from-current slice naturally yields `[current, ...manual, ...tail]`.
- `play(track, { fresh })` (line 1702): fresh branch at line 1912 calls `weaveFreshHistory`.

COMPONENT — src/lib/components/NowPlaying.svelte (THE file to edit):
- `let tab = $state<Tab>('lyrics')` (line 33). Tabs: 'queue' | 'lyrics' | 'related' (line 32).
- `selectTab(next)` (line 815) sets `tab` and, from closed, opens the sheet to half.
- `sheetState = $state<SheetState>('closed')` (line 602): 'closed' | 'half' | 'full'.
- Cover carousel reads the UNSLICED queue (line 396-398):
  `ci = $derived(player.queue.findIndex((tk) => tk.uid === player.current?.uid))`,
  `prevCover = ci>0 ? player.queue[ci-1] : null`, `nextCover = ...player.queue[ci+1]`.
  **`ci` is exactly the current-track index in the full queue — reuse it for the slice.**
- Up-Next reorder state: `queueListEl = $state<HTMLElement | null>(null)` (line 868); the reorder
  drag handlers (`gripDragDown(e, index)` line 885, `rowIndexAt` line 875, `gripDragUp` line 898 →
  `player.reorderQueue(dragFrom, dragOver)`) pass ROW indices that index into whatever the `{#each}`
  iterates. So the each-block, `dragFrom`/`dragOver`, and `reorderQueue` MUST all agree on the same
  list. **reorderQueue takes queue-absolute indices** — see Task 1 for the offset handling.
- Up-Next MARKUP (lines 1110-1142): `<div class="panel">` → `{#if tab === 'queue'}` →
  `{#if player.queue.length}` → `<ul class="list" bind:this={queueListEl}>` →
  `{#each player.queue as track, i (track.uid)}` ... `{@const skipped = player.isUnplayable(track.uid)}`
  ... `<button class="row q-row" class:playing={track.uid === player.current?.uid} class:skipped ...>`.
- `.panel { flex:1; overflow-y:auto; overscroll-behavior-y:contain; overflow-anchor:none; }` (line 1381).
  The `overflow-anchor:none` + NO mutation-scroll is the 260615-mnr fix — KEEP it; do not add any
  scroll that fires on queue mutation.
- Lyrics anchor scroll (line 189-224) is the EXISTING idiom for scrolling inside `.panel`: it grabs
  `lyricsEl.closest('.panel')`, computes an offset via rect deltas, and `container.scrollTo(...)`.
  Mirror this container-scoped scroll (NOT ancestor-walking scrollIntoView, which yanks the sheet).

TESTS — src/lib/stores/player.svelte.test.ts:
- `describe('player.play — history-preserving fresh-play queue model (quick-260615-i9u Feature B)')`
  (line 2584) seeds prior queue + current via `seedPriorAndCapture` (line 2628) and asserts the
  EXACT queue shape, e.g. `expect(player.queue.map(t=>t.uid)).toEqual([h0,h1,pc,X])` (line 2648).
  These MUST stay green — the store shape is unchanged by this plan. The new test (Task 2) asserts
  the VIEW-slice contract at the store level (slice-from-current yields [current,...manual,...tail]).
</context>

<tasks>

<task type="auto">
  <name>Task 1: Render Up-Next from the current index forward (view-level fix for tweak 1)</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
Introduce a derived sliced list and render the Up-Next `{#each}` from it, so the LIST starts at the
current song while `player.queue` (and thus prev()/history + the cover carousel) is untouched.

1. Near the cover-carousel derivations (after line 398, where `ci` is already defined as
   `player.queue.findIndex((tk) => tk.uid === player.current?.uid)`), add a derived for the Up-Next
   view list and its base offset. Reuse the EXISTING `ci` (do not recompute):
   - `const upNextStart = $derived(ci >= 0 ? ci : 0);` — start at the current track; if current is
     not in the queue (cold/edge), start at 0 so the whole queue still renders (no regression).
   - `const upNextList = $derived(player.queue.slice(upNextStart));` — the rows the LIST shows:
     `[current, ...manual, ...tail]`. History (everything before current) is excluded from the LIST
     only; it stays in `player.queue` for prev()/carousel.

2. In the Up-Next markup (lines 1112-1141):
   - Change the emptiness guard `{#if player.queue.length}` → `{#if upNextList.length}`.
   - Change `{#each player.queue as track, i (track.uid)}` → `{#each upNextList as track, i (track.uid)}`.
   - Keep the keyed `(track.uid)` key, `{@const skipped = player.isUnplayable(track.uid)}`, the
     `class:playing`, `class:skipped`, swipeRemove, longpress, retry/play onclick, and the title — all
     byte-unchanged EXCEPT index plumbing below.

3. Fix the reorder index offset. `player.reorderQueue(dragFrom, dragOver)` (called in `gripDragUp`,
   line 898-904) expects QUEUE-ABSOLUTE indices, but the `{#each}` now yields LIST-relative `i`.
   `rowIndexAt(y)` (line 875) returns a LIST-relative index too (it measures the rendered `<li>`s).
   Convert at the single commit site: in `gripDragUp`, map both to absolute by adding `upNextStart`
   before calling `reorderQueue` — i.e. `player.reorderQueue(dragFrom + upNextStart, dragOver + upNextStart)`.
   `dragFrom`/`dragOver`/`rowDragY`/the `class:lifted`/`class:over`/`style:transform` row-state
   comparisons all stay LIST-relative (they compare against the each-block `i`), so leave them as-is —
   ONLY the `reorderQueue` call args get the `+ upNextStart` offset. Add a one-line comment at the
   call site: "list is sliced from current (upNextStart); reorderQueue needs queue-absolute indices."

4. Do NOT touch `.panel`'s `overflow-anchor:none` (line 1381) or add any mutation-driven scroll.
This is INK-01.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm exec svelte-check --threshold error src/lib/components/NowPlaying.svelte 2>&1 | tail -5</automated>
  </verify>
  <done>
The Up-Next list iterates `upNextList` (= `player.queue` sliced from the current index); its first
row is the current song; manual entries after current still render; `player.queue` is unchanged so
prev()/carousel work; reorder commits use queue-absolute indices. svelte-check reports no NEW errors.
  </done>
</task>

<task type="auto">
  <name>Task 2: One-shot scroll-to-current when the Up-Next tab opens (tweak 2)</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
Add a guarded `$effect` that, ONCE per open, scrolls the `.panel` scroller so the current row sits at
the TOP of the visible list area. Fire on the OPEN transition only — never on queue mutation.

1. Add a one-shot guard flag near the Up-Next reorder state (around line 868, alongside
   `queueListEl`): `let upNextScrollDone = false;` (plain let — internal latch, NOT $state; reading it
   reactively would defeat the one-shot intent).

2. Add an `$effect` (place it after the existing Up-Next reorder block, ~line 905, OUTSIDE the lyrics
   anchor effect so the two never interfere). Track ONLY the open signals as dependencies:
   - Read `tab` and `sheetState` (these are the open/visibility transitions).
   - The list is OPEN/visible when `tab === 'queue' && sheetState !== 'closed'`.
   - When NOT open: reset the latch (`upNextScrollDone = false`) and return — so the NEXT open re-fires.
   - When open AND `!upNextScrollDone`: set `upNextScrollDone = true` (latch immediately so a reactive
     re-tick from anything else does not re-scroll), then scroll once.
   - Scroll target = the current row. With Task 1, current is the FIRST row of `upNextList`, but scroll
     to it EXPLICITLY (robust if any row precedes it). Mirror the lyrics anchor idiom (line 200-223):
     grab `queueListEl?.closest('.panel')` as the scroller; find the current row element via
     `queueListEl?.querySelector('.q-row.playing')?.closest('li')` (the `<li>` wrapping the
     `.row.playing` button). If both exist, compute the row's offset within the container using rect
     deltas — `const offsetWithin = liRect.top - cRect.top + container.scrollTop;` — and
     `container.scrollTo({ top: offsetWithin, behavior: 'smooth' })` so the current row pins to the
     container TOP (`block:'start'` semantics). Do NOT use `Element.scrollIntoView()` ancestor-walking
     (it yanks the sheet to full, per the lyrics-effect comment at line 196-199).
   - Guard SSR / missing refs: bail if `typeof window === 'undefined'` or refs are null. The DOM may
     not be laid out the same tick the tab flips, so wrap the measure+scroll in a single
     `requestAnimationFrame(() => { ... })` so layout has flushed (mirrors the half-inset double-rAF
     idiom at line 852); store no extra timer (one rAF is enough for a one-shot top-scroll).

3. Add a comment block above the effect: "quick-260618-ink (tweak 2): ONE-SHOT scroll-to-current on
   Up-Next OPEN only. Latched by upNextScrollDone, reset when the list closes. Deliberately NOT a
   mutation-driven scroll — 260615-mnr removed continuous auto-scroll (overflow-anchor:none) and that
   must not return."

4. Confirm no dependency on `player.queue` length / contents inside the effect body in a way that
   re-runs it on mutation: only `tab` + `sheetState` are tracked reads; the row lookup happens inside
   the rAF callback (untracked DOM read), so a queue mutation alone never re-fires the scroll.
This is INK-02.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm exec svelte-check --threshold error src/lib/components/NowPlaying.svelte 2>&1 | tail -5</automated>
  </verify>
  <done>
Opening the Up-Next tab (tab→'queue' with the sheet open) scrolls the current row to the panel top
once; closing/reopening re-fires; queue mutations alone do NOT scroll; `overflow-anchor:none` and the
no-mutation-scroll behavior from 260615-mnr are intact. svelte-check reports no NEW errors.
  </done>
</task>

<task type="auto">
  <name>Task 3: Regression test — store queue shape unchanged; view-slice contract holds</name>
  <files>src/lib/stores/player.svelte.test.ts</files>
  <action>
Add a focused test that locks the contract the view relies on, WITHOUT changing any existing test
(the store shape is intentionally unchanged by this plan).

In the existing `describe('player.play — history-preserving fresh-play queue model
(quick-260615-i9u Feature B)')` block (line 2584), add ONE new `it(...)` after the
"a fresh play preserves capped history + prior current" test (after line 2651). It must:
- Reuse the existing `resolved()` helper + `seedPriorAndCapture()` (line 2628) and `mk`/`flush`.
- Seed prior `[h0, h1, pc]`, current `pc`, click `X`; `mockEnsure.mockResolvedValue(X)`;
  `await player.play(X, { fresh: true }); await flush();`.
- Assert the FULL store queue is UNCHANGED-shape (history still BEFORE current — proves prev()/carousel
  inputs survive): `expect(player.queue.map(t=>t.uid)).toEqual([h0.uid, h1.uid, pc.uid, X.uid])`.
- Assert the VIEW-SLICE contract the component uses: slicing from the current index forward yields
  `[current, ...tail]` with the new current first:
  `const ci = player.queue.findIndex(t => t.uid === player.current?.uid);`
  `expect(player.queue.slice(ci).map(t=>t.uid)).toEqual([X.uid]);`  // X is current; tail empty (mockSimilar→[])
  `expect(player.queue.slice(ci)[0].uid).toBe(player.current?.uid);` // first visible row IS current.
- Add a second `it(...)` proving a MANUAL entry survives in the slice after current: before the fresh
  play, add a manual uid via `player.playNext(...)` semantics is heavy to set up headless — instead
  directly seed manual provenance the way 260618-fiz tests do: push a manual track `M` into the prior
  queue and register it in `manualUids`, then assert after the fresh play that `player.queue.slice(ci)`
  contains `M` immediately after current. Inspect lines ~1680-1805 (the
  `describe('quick-260618-fiz Fix 4 ...')` block) for the exact pattern used to register manualUids in
  these tests and copy that registration idiom verbatim so the test is consistent with existing setup.
Add a comment: "quick-260618-ink: the LIST is rendered as player.queue.slice(currentIndex); the store
keeps history BEFORE current (for prev()/carousel) so this view-slice is what the user actually sees."
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm exec vitest run src/lib/stores/player.svelte.test.ts 2>&1 | tail -15</automated>
  </verify>
  <done>
The new it() cases pass; ALL pre-existing tests in player.svelte.test.ts stay green (store shape
unchanged). The view-slice-from-current contract (first row = current, manual after current) is
locked by tests.
  </done>
</task>

</tasks>

<verification>
- `pnpm exec svelte-check --threshold error` reports no NEW errors in NowPlaying.svelte.
- `pnpm exec vitest run src/lib/stores/player.svelte.test.ts` is fully green (existing + new).
- Manual (executor self-check): grep NowPlaying.svelte confirms `{#each upNextList` (not
  `{#each player.queue`) in the Up-Next block, `overflow-anchor: none` still present on `.panel`, and
  no scroll call is wired to a queue-length/contents dependency.
</verification>

<success_criteria>
- INK-01: The Up-Next list's first row is the new/current song on a fresh click-to-play; woven
  history no longer appears in the LIST; manual entries still follow current; prev()/history and the
  cover carousel still work (player.queue untouched).
- INK-02: Opening the Up-Next tab scrolls the current row to the panel top, one-shot; no continuous
  auto-scroll reintroduced; 260615-mnr's `overflow-anchor:none` + no-mutation-scroll preserved.
- All existing player tests remain green; new view-slice contract tests added.
</success_criteria>

<output>
Create `.planning/quick/260618-ink-click-to-play-puts-new-song-at-top-of-up/260618-ink-01-SUMMARY.md` when done.
</output>
