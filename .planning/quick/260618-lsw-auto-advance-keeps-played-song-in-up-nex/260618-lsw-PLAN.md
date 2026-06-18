---
phase: quick-260618-lsw
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/stores/player.svelte.ts
  - src/lib/components/NowPlaying.svelte
  - src/lib/stores/player.svelte.test.ts
autonomous: true
requirements: [LSW-01, LSW-02, LSW-03]
must_haves:
  truths:
    - "On auto-advance (track ended → next()), the just-played song STAYS visible in the Up-Next list; only the now-playing highlight moves down a row."
    - "On a fresh explicit click-to-play, the clicked song is the FIRST row of the Up-Next list (260618-ink behavior preserved)."
    - "Installing a brand-new list (setQueue / setListQueue) re-anchors the list to the new current — old played songs do not bleed into the new Up-Next."
    - "prev() keeps the played song visible (highlight moves up, list start unchanged)."
    - "Drag-reorder, the cover carousel (prev/next neighbors), and the 260618-ink one-shot scroll-to-current still work; 260615-mnr continuous auto-scroll does NOT return."
  artifacts:
    - path: "src/lib/stores/player.svelte.ts"
      provides: "upNextAnchorUid $state field + set-on-fresh / set-on-new-list logic + reset on clearQueue"
      contains: "upNextAnchorUid"
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "upNextStart derived from the anchor's live queue index (not ci)"
      contains: "upNextAnchorUid"
    - path: "src/lib/stores/player.svelte.test.ts"
      provides: "anchor tests: auto-advance keeps anchor, fresh resets anchor, anchor resolves after reorder/removal"
      contains: "upNextAnchorUid"
  key_links:
    - from: "src/lib/components/NowPlaying.svelte"
      to: "player.upNextAnchorUid"
      via: "$derived anchor-index lookup feeding upNextStart"
      pattern: "upNextAnchorUid"
    - from: "src/lib/stores/player.svelte.ts play({fresh:true})"
      to: "this.upNextAnchorUid"
      via: "set anchor to the new current on fresh play"
      pattern: "upNextAnchorUid"
---

<objective>
Follow-up to quick-260618-ink. Today the Up-Next list renders `player.queue.slice(upNextStart)` where `upNextStart` is `$derived` from the LIVE current index (`ci`) in NowPlaying.svelte (lines 396-402). On auto-advance, `next()` advances `current`, `ci` increments, and the just-played song falls BEFORE the slice start → it disappears from Up-Next. The user does not want that.

Desired reconciliation:
- FRESH play (explicit click): the clicked song is the FIRST Up-Next row (keep ink).
- AUTO-ADVANCE (track ended → `next()`): the just-played song REMAINS in Up-Next; only the now-playing highlight moves down. The slice start must NOT advance on auto-advance — it stays anchored where the list started at the last FRESH play.

Approach (store-level anchor by uid — Option (a) from the task brief): the STORE knows whether a play is fresh (the `opts.fresh` flag in `play()`, line 1702) whereas the view cannot distinguish auto-advance from a click. Add a `upNextAnchorUid` `$state` field set to the new current's uid ONLY on a fresh play and on new-list installs (`setQueue`/`setListQueue`), left UNTOUCHED by `next()`/auto-advance/`prev()`. NowPlaying derives `upNextStart` from that anchor's LIVE index in `player.queue` (resolve by uid each render so reorders/removals stay correct), clamped to `ci` if the anchor uid is gone.

Purpose: auto-advance keeps the played song in Up-Next while every ink/i9u/mnr behavior is preserved.
Output: a store anchor field + set-on-fresh/new-list logic, the `upNextStart` derivation switch in NowPlaying, and 3 anchor tests.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

<interfaces>
<!-- Grounded in the real post-ink code. Executor uses these directly — no further exploration needed. -->

NowPlaying.svelte (current, post-ink — lines 396-411). upNextStart is derived from the LIVE current index `ci`; THIS is what makes the played song disappear on auto-advance:
```
const ci = $derived(player.queue.findIndex((tk) => tk.uid === player.current?.uid));
const upNextStart = $derived(ci >= 0 ? ci : 0);
const upNextList = $derived(player.queue.slice(upNextStart)); // [current, ...manual, ...tail]
const prevCover = $derived(ci > 0 ? player.queue[ci - 1] : null);
const nextCover = $derived(ci >= 0 && ci + 1 < player.queue.length ? player.queue[ci + 1] : null);
```
Consumers of upNextStart that MUST keep working:
- reorder offset (line 909-911): `player.reorderQueue(dragFrom + upNextStart, dragOver + upNextStart)`
- one-shot scroll effect (lines 920-945): scrolls to `.q-row.playing` (the CURRENT row), keyed on `tab`/`sheetState`, latched by `upNextScrollDone`. It targets the playing row, NOT the first row, so it keeps working when current is no longer first.
- carousel prevCover/nextCover read `ci` directly (UNCHANGED — they track the live current, not the anchor).

player.svelte.ts — the store KNOWS fresh:
```
async play(track: Track, opts?: { fresh?: boolean; fromFallback?: boolean })   // line 1702
  // fresh branch at line 1912: opts?.fresh → weaveFreshHistory(resolved), regenerate/primeNext
  // non-fresh branch at line 1930: next()/prev()/auto-advance/failover
private weaveFreshHistory(seed: Track): void                                    // line 1992 (fresh-play queue install)
setQueue(tracks, context)                                                       // line 1222 (new-list install)
setListQueue(tracks, context)                                                   // line 1267 (delegates to setQueue when no current)
clearQueue()                                                                    // line 1327 (keeps only current)
next()                                                                          // line 2123 (auto-advance / skip — NON-fresh play())
prev()                                                                          // line 2143 (NON-fresh play())
private indexOf(track: Track|null): number  // line 1386 → this.queue.findIndex(uid === track.uid)
queue = $state<Track[]>([])      // line 212
current = $state<Track|null>     // line 118
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add the store-level Up-Next anchor (upNextAnchorUid), set on fresh play + new-list install only</name>
  <files>src/lib/stores/player.svelte.ts</files>
  <behavior>
    - A fresh play (`play(track, { fresh: true })`) sets `player.upNextAnchorUid === track.uid`.
    - `next()` / auto-advance (which calls `play(next)` with NO `fresh`) leaves `upNextAnchorUid` UNCHANGED.
    - `prev()` (NON-fresh play) leaves `upNextAnchorUid` UNCHANGED.
    - `setQueue(tracks)` and `setListQueue(tracks)` set `upNextAnchorUid` to the current track's uid (the new list IS a fresh start). With no current, setListQueue delegates to setQueue which sets it to `current?.uid ?? null` (→ null when cold).
    - `clearQueue()` resets `upNextAnchorUid` to the surviving current's uid (`this.current?.uid ?? null`).
  </behavior>
  <action>
    Add a public reactive field on the Player class near the existing queue/queueContext fields (around line 212-219, after `queue = $state<Track[]>([])`):
    `upNextAnchorUid = $state<string | null>(null);` — the uid of the track the Up-Next list is anchored to. The list view slices the queue from THIS uid's live index, NOT from the live current index, so an auto-advance does not slice the just-played song out. PUBLIC because NowPlaying reads it reactively. Document: set ONLY on a fresh user play (`play({fresh})`) and on a new-list install (setQueue/setListQueue); deliberately NOT touched by next()/prev()/auto-advance/failover so the slice start stays put as the highlight moves.

    In `play()` (line 1702), inside the `if (opts?.fresh)` fresh branch (line 1912, alongside `this.removedUids.clear()` / `this.weaveFreshHistory(resolved)`), set `this.upNextAnchorUid = resolved.uid;` — the clicked song becomes the list anchor (first row). Set it right after weaveFreshHistory installs the woven queue (so the anchor uid is definitely present in this.queue). Do NOT set it in the non-fresh `else` branch (line 1930) — that is the auto-advance/next/prev path that must leave the anchor put. This is LSW-02 (fresh click → first row) + LSW-01 (auto-advance keeps anchor).

    In `setQueue()` (line 1222), after `this.queue = dedupeBest(...)` / before or after `this.persist()`, set `this.upNextAnchorUid = this.current?.uid ?? null;` — a brand-new list is a fresh start, so the anchor resets to the new current (or null when cold). This is LSW-03.

    In `setListQueue()` (line 1267): the no-current branch delegates to `setQueue` (which already sets the anchor → null) — leave it. In the with-current branch, after `this.queue = this.queueWithAnchor(tracks, current)`, set `this.upNextAnchorUid = current.uid;`.

    In `clearQueue()` (line 1327), after `this.queue = this.current ? [this.current] : []`, set `this.upNextAnchorUid = this.current?.uid ?? null;` so the anchor follows the surviving current (the list collapses to [current], anchored at current).

    Do NOT persist `upNextAnchorUid` (do not add it to `persist()` at line 298 or `restore()` at line 350) — it is a session-scoped VIEW anchor; a reload re-derives it on the next play, and a stale persisted anchor would point at a song no longer first. Leaving it out keeps the persisted shape unchanged (matches the i9u/manualUids side-state discipline). On restore the anchor stays null until the first play; NowPlaying's clamp (Task 2) falls back to `ci` so the restored track still renders as the first row.

    Do NOT add any anchor write to next() (line 2123), prev() (line 2143), runFallback, retryUnplayable, playNext/addToQueue/removeFromQueue, or toggleShuffle — those must leave the anchor untouched (the whole point: the highlight moves, the list start does not).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest run src/lib/stores/player.svelte.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>player.svelte.ts compiles; `upNextAnchorUid` is set on fresh play, setQueue, setListQueue, clearQueue, and is NOT written by next()/prev(); existing player tests still pass.</done>
</task>

<task type="auto">
  <name>Task 2: Derive upNextStart from the anchor's live queue index in NowPlaying</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
    In NowPlaying.svelte replace the `upNextStart` derivation (line 401) so it resolves the ANCHOR's live index instead of the live current index `ci`.

    Keep `ci` (line 396) unchanged — the cover carousel (`prevCover`/`nextCover`, lines 403-404) and the now-playing highlight still track the LIVE current. Only the LIST slice start changes.

    Add a derived anchor index and switch upNextStart to it:
    `const anchorIdx = $derived(player.upNextAnchorUid ? player.queue.findIndex((tk) => tk.uid === player.upNextAnchorUid) : -1);`
    `const upNextStart = $derived(anchorIdx >= 0 ? anchorIdx : (ci >= 0 ? ci : 0));`

    Rationale to put in a comment (replacing/extending the existing lines 397-401 comment): the list now slices from the ANCHOR (set in the store ONLY on a fresh play / new-list install), so an auto-advance (which advances `current`/`ci` but leaves the anchor put) keeps the just-played song in the list — only the `.q-row.playing` highlight moves down. The findIndex-by-uid each render keeps the anchor correct across drag-reorder and removals (the row moves with its uid). CLAMP: if the anchor uid is gone from the queue (removed, or never set — cold/restore), fall back to the live current index `ci` (the ink behavior) so the list still renders with current first and never goes blank.

    `upNextList = $derived(player.queue.slice(upNextStart))` (line 402) stays as-is — it now slices from the anchor.

    Do NOT change: the reorder offset at line 911 (`dragFrom + upNextStart` / `dragOver + upNextStart`) — it already reads `upNextStart`, so it stays correct now that upNextStart is anchor-relative (a row dragged at visible index N maps to queue index N + upNextStart, where upNextStart is the anchor). The one-shot scroll effect (lines 920-945) targets `.q-row.playing` (the CURRENT row), which still exists in the rendered list now that the list starts at the anchor and includes current+forward — verify the playing row is still inside `upNextList` (it is: current index `ci >= anchorIdx` on auto-advance, so current is at or after the slice start). Do NOT reintroduce any continuous/mutation-driven auto-scroll (260615-mnr).

    Confirm the `.q-row.playing` class binding in the list markup keys off `player.current?.uid` (the live current), so the highlight follows the live current row even though the slice start is the anchor — grep the markup for the `class:playing`/`q-row` binding and leave it unchanged.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm exec svelte-check --threshold error --tsconfig ./tsconfig.json src/lib/components/NowPlaying.svelte 2>&1 | tail -15</automated>
  </verify>
  <done>NowPlaying type-checks; `upNextStart` derives from `anchorIdx` (anchor uid's live index) with a clamp to `ci` when the anchor is absent; `ci`, `prevCover`, `nextCover`, the reorder offset, and the one-shot scroll effect are unchanged.</done>
</task>

<task type="auto">
  <name>Task 3: Tests — auto-advance keeps the anchor, fresh resets it, anchor survives reorder/removal</name>
  <files>src/lib/stores/player.svelte.test.ts</files>
  <action>
    Add a new `describe('player.upNextAnchorUid — Up-Next list anchor (quick-260618-lsw)', ...)` block to player.svelte.test.ts. Use the existing `mk(source, songid, artist, title)` helper, the `flush` helper, and the existing mock setup (play() is the real method; `mockEnsure` resolves the resolved track; `buildSimilarQueue`/`buildDiversePicks` default to [] so no tail is generated). Follow the seeding idiom from the existing `next()` tests (lines 825-843): set `player.queue` and `player.current` directly, mock `ensureTrackDetails`, and `await flush()` after async play().

    Test 1 — auto-advance keeps the anchor (LSW-01): seed `player.queue = [a, b, c]`, set `player.upNextAnchorUid = a.uid` and `player.current = a` (simulating a fresh play landed on `a`). Make `mockEnsure.mockResolvedValue(b)` then call `player.next()` and `await flush()`. Assert `player.current.uid === b.uid` (highlight moved) AND `player.upNextAnchorUid === a.uid` (anchor UNCHANGED — the played song `a` is still at/before the slice start). Assert the slice that the view would render, `player.queue.slice(player.queue.findIndex(t => t.uid === player.upNextAnchorUid))`, still includes `a`.

    Test 2 — fresh play resets the anchor (LSW-02): seed `player.queue = [a, b]`, `player.upNextAnchorUid = a.uid`, `player.current = a`. `mockEnsure.mockResolvedValue(c)`. Call `await player.play(c, { fresh: true })` then `await flush()`. Assert `player.upNextAnchorUid === c.uid` (the new clicked song is the anchor → first row). (buildSimilarQueue mocked [] so the tail is empty; the woven queue places `c` after the history prefix — assert the anchor index equals `indexOf(c)` so `c` IS the slice start.)

    Test 3 — anchor survives reorder/removal (LSW-03): seed `player.queue = [a, b, c, d]`, `player.upNextAnchorUid = b.uid`, `player.current = b`. Call `player.reorderQueue(...)` to move `b` (or another row) and assert `player.queue.findIndex(t => t.uid === player.upNextAnchorUid)` still points at `b`'s new position (the by-uid lookup tracks the move). Then `player.removeFromQueue(d.uid)` and assert the anchor index still resolves to `b`. Finally remove the anchor's own track scenario: set anchor to a uid NOT in the queue and assert the view-side clamp behaves — replicate the NowPlaying clamp inline (`anchorIdx >= 0 ? anchorIdx : ci`) to document that a missing anchor falls back to the current index (no blank list).

    Also add a guard test: `player.prev()` does NOT change the anchor. Seed `player.queue = [a, b]`, anchor `b.uid`, current `b`, `mockEnsure.mockResolvedValue(a)`; call `player.prev()`, `await flush()`, assert `player.current.uid === a.uid` and `player.upNextAnchorUid === b.uid` (anchor put; prev just moves the highlight up — `a` is before the slice start but still in the queue, and on the real list the clamp keeps it sensible).

    Note: play() in this suite is NOT stubbed for these tests (unlike the playStub suite) — use the REAL play() so the fresh-branch anchor write executes. If a beforeEach in the surrounding file stubs play(), scope a local restore of the real method or place this describe where play() is real (mirror the `next()` describe at line 747 which calls the real next()/play()). Reset `player.upNextAnchorUid = null`, `player.queue = []`, `player.current = null` in a beforeEach for isolation.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest run src/lib/stores/player.svelte.test.ts -t "upNextAnchorUid" 2>&1 | tail -25</automated>
  </verify>
  <done>The new anchor describe block passes: auto-advance and prev() leave the anchor unchanged, fresh play resets it to the new current, the anchor resolves correctly after reorder/removal, and the full player test file still passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| none (in-process view state) | This change is a client-side reactive derivation + a session-scoped store field. No new untrusted input, no network, no persistence, no package installs. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-lsw-01 | Tampering | `upNextAnchorUid` points at a removed/absent uid → blank Up-Next list | mitigate | NowPlaying clamps `upNextStart` to `ci` (live current index, then 0) when `anchorIdx < 0`; Task 3 tests the missing-anchor clamp. |
| T-lsw-02 | Denial of Service | anchor never updates → list start frozen on a stale song across context switches | mitigate | Anchor is reset on every fresh play, setQueue, setListQueue, and clearQueue (Task 1); only auto-advance/prev intentionally leave it put. |
| T-lsw-SC | Tampering | npm/pip/cargo installs | accept | No package installs in this plan — nothing to audit. |
</threat_model>

<verification>
- `pnpm vitest run src/lib/stores/player.svelte.test.ts` — full player suite green, including the new `upNextAnchorUid` describe.
- `pnpm exec svelte-check --threshold error` clean for NowPlaying.svelte.
- Manual (executor may note for the developer): play a song from a list (it is row 1 of Up-Next), let it auto-advance to the next song — the just-played song stays in Up-Next and the highlight moves to the new song; clicking a fresh song makes it row 1 again.
</verification>

<success_criteria>
- Auto-advance (track ended → next()) keeps the just-played song in the rendered Up-Next slice; the now-playing highlight moves down (LSW-01).
- A fresh explicit click makes the clicked song the FIRST Up-Next row (LSW-02, ink preserved).
- New-list install (setQueue/setListQueue) and clearQueue re-anchor to the current; prev()/next()/auto-advance/failover do not move the anchor (LSW-03).
- Cover carousel, drag-reorder offset, and the 260618-ink one-shot scroll-to-current still work; 260615-mnr continuous auto-scroll is not reintroduced.
- Persisted player-state shape unchanged (anchor not persisted).
</success_criteria>

<output>
Create `.planning/quick/260618-lsw-auto-advance-keeps-played-song-in-up-nex/260618-lsw-SUMMARY.md` when done.
</output>
