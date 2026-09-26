---
slug: upnext-no-scroll-to-current
status: resolved
trigger: "in desktop wide mode now playing page, up next list is not scroll to current song at beginning and on change"
created: 2026-09-26
updated: 2026-09-26
---

# Debug: Up Next list doesn't scroll to current song (desktop wide NowPlaying)

## Symptoms

**Expected:** In the desktop wide-layout NowPlaying page, the Up Next list scrolls so the currently playing song is in view (a) when the page first opens and (b) whenever the current song changes (next/prev/auto-advance/tap a row).

**Actual:** The Up Next list does not scroll to the current song — neither on open nor on track change. Current row can be off-screen (played-history rows sit above it in the anchor/history-weave model, so a list starting at scrollTop=0 hides the current row below the fold).

**Error messages:** none reported.

**Timeline:** unknown (not stated by user).

**Reproduction:**
1. Desktop-width viewport (wide mode — NowPlaying renders the side-by-side / wide layout with Up Next visible).
2. Play a list with played history so current song is not first row.
3. Open NowPlaying → Up Next not scrolled to current.
4. Skip to next / previous → list does not follow current.

**Environment:** desktop wide layout. Mobile/narrow behaviour not reported as broken (compare: narrow Up Next tab may have its own scroll-to-current logic that wide mode lacks or that is gated on a tab/visibility state wide mode never enters).

**Hints (from project memory):**
- Up Next uses `upNextAnchorUid` slice + history weave — played songs stay in list above current.
- Browser pane rAF is frozen (pane `hidden`): rAF-deferred scrolls never fire there — verify timing in vitest or force render; don't mistake a pane artefact for the bug.
- NowPlaying.svelte is ~2000 lines; wide vs narrow layouts likely branch on a media query / `wide` flag.

## Current Focus

hypothesis: CONFIRMED (H1). See Resolution.root_cause.
test: TDD RED — write src/lib/services/upnext-scroll.test.ts against a not-yet-existing pure module `upnext-scroll.ts` (`upNextPaneOpen(wide, sheetState)` + `upNextScrollKey(open, currentUid)`); run vitest; expect failure.
expecting: test file fails (module missing) — RED confirms the decision does not exist as testable logic today. Green phase creates the module and wires NowPlaying.svelte:1134 + NpUpNext.svelte:162-188 to it.
next_action: DONE — fix applied, tests + typecheck green, session archived. Human verification still owed in a real >=1280px window (see Resolution.verification); if the list still does not follow, reopen with the actionLog + a note of which step (open / next / prev / tap) failed.
green_plan_was: 1) create src/lib/services/upnext-scroll.ts with the two pure exports; 2) NowPlaying.svelte:1134 `open={upNextPaneOpen(wide, sheetState)}`; 3) NpUpNext.svelte replace the boolean `upNextScrollDone` latch with a `scrolledKey: string | null` latch keyed on `upNextScrollKey(open, player.current?.uid ?? null)`, read `rows` (tracked) so a late queue weave re-runs it, and clear the latch inside the rAF when `.q-row.playing` is not rendered yet; 4) pnpm test + pnpm check; 5) human-verify at >=1280px.
scope_decision (checkpoint response, 2026-09-26): the uid-keyed latch is applied UNIFORMLY — the narrow sheet (half/full) and the wide column both follow the current song once per song change. NO `wide` gate is added to NpUpNext. Rationale from the user: smaller diff, one coherent model; the 260615-mnr no-scroll-on-mutation property is preserved because a same-uid mutation is a no-op on the key compare. The phone-side behaviour change flagged in blind_spots is accepted.
reasoning_checkpoint:
  hypothesis: "The Up Next column never scrolls to the current row in wide mode because NpUpNext's scroll-to-current (and its cover backfill) are gated on the prop `open={sheetState !== 'closed'}` (NowPlaying.svelte:1134), and in wide mode the column is mounted and fully on screen while sheetState stays at its default 'closed' — so `open` is false and the one-shot effect never fires. It also never follows a track change in either layout because the effect's only tracked read is `open` (latched by a boolean), never the current uid — by the quick-260618-ink design that pre-dates the wide layout."
  confirming_evidence:
    - "NowPlaying.svelte:577 `let sheetState = $state<SheetState>('closed')`; no code path sets it on `wide`; the wide `.cols` block (1152-1164) renders all three `.panel`s with no sheetState/tab gate."
    - "Commit 6f670a35 (quick-260919-npfix Fix 3) states in its own text: 'At >=1280px the closed peek is the whole lyrics column (305px at 1440x900)' — i.e. the columns are fully visible while sheetState === 'closed'. NpLyrics had to be handed `wide` for exactly this reason; NpUpNext was not."
    - "NpUpNext.svelte:165-188: `if (!open) { upNextScrollDone = false; return; }` — with open===false the effect is a no-op. Line 77-78: the cover-backfill effect has the identical `if (!open) return;` gate, so the wide column also never fills covers until the sheet is dragged open."
    - "NpUpNext.svelte:166-167 comment: '`open` is the only TRACKED read … a queue mutation alone never re-fires this' — the current uid is deliberately not a dependency, so 'on change' cannot scroll in any layout. Commit 4d096e28 / 260618-ink-01-SUMMARY decision: 'Scroll is ONE-SHOT on open … only tab+sheetState are tracked reads'."
    - "260615-mnr (ff2f3518) disabled CSS overflow-anchor because the browser re-pinned on EVERY keyed mutation (remove/reorder/retry) — a narrower follow-on-song-CHANGE trigger was never the thing it removed."
  falsification_test: "If `open` were true in wide mode (e.g. wide forced sheetState to 'half'), the one-shot would fire on mount and symptom (a) could not exist; grep shows no such assignment. If a track-change follow already existed, `player.current`/uid would appear as a tracked read in the NpUpNext scroll effect; it does not."
  fix_rationale: "Compute `open` from the SAME `wide` flag the layout uses to mount the column (`wide || sheetState !== 'closed'`) — one shared prop fixes both the scroll gate and the cover-backfill gate at their single source. Key the scroll latch on the current uid instead of a boolean so a song change re-scrolls once, while a queue mutation with the same current (remove/reorder/regen) still yields the same key → no scroll, preserving the 260615-mnr no-continuous-scroll property. Both decisions live in a pure `.ts` so they are node-testable."
  blind_spots: "Follow-on-change will also apply on the phone (sheet half/full) — a behaviour change there, once per song, not per mutation; flagged for the user. rAF timing cannot be observed in the hidden browser pane (memory: pane rAF is frozen) — needs a real >=1280px window for human verify. Home-shelf fresh plays install the queue only after the resolve await (player.svelte.ts:3555 vs 4028), so the row may be absent at the first rAF — handled by tracking `rows` and re-arming the latch on a miss."
tdd_checkpoint:
  test_file: "src/lib/services/upnext-scroll.test.ts"
  test_name: "upNextPaneOpen / upNextScrollKey (see file)"
  status: "green"
  green_output: "Test Files 1 passed (1), Tests 7 passed (7) — 2026-09-26 15:21; full pnpm test 154 files / 3402 tests passed; pnpm check 0 errors"
  failure_output: |
    FAIL |server| src/lib/services/upnext-scroll.test.ts
    Error: Cannot find module '$lib/services/upnext-scroll' imported from src/lib/services/upnext-scroll.test.ts
      ❯ src/lib/services/upnext-scroll.test.ts:5:1
    Test Files  1 failed (1)   Tests  no tests
    (cmd: pnpm exec vitest --run src/lib/services/upnext-scroll.test.ts — 2026-09-26 15:17)

## Evidence

- timestamp: 2026-09-26
  checked: src/lib/components/NowPlaying.svelte lines 1111-1171 (pane mounting) + src/lib/components/NpUpNext.svelte lines 162-188 (scroll effect)
  found: Up Next pane lives in child NpUpNext.svelte. Scroll-to-current is `$effect` gated on prop `open` — one-shot latch `upNextScrollDone` (plain let), reset when `open` goes false, rAF-deferred, scrolls `queueListEl.closest('.panel')` to the `.q-row.playing` li top. Parent passes `open={sheetState !== 'closed'}` (NowPlaying.svelte:1134). In wide mode the `.cols` block (line 1152-1164) renders all three `.panel` columns unconditionally — no `open`/tab gate on the mount.
  implication: (a) if wide mode holds `sheetState === 'closed'` while the columns are visible, `open` is false and the scroll effect is a no-op — nothing else scrolls the list. (b) Track change is NOT a tracked dependency of the effect by design (comment: "a queue mutation alone never re-fires this"), so "on change" can't scroll in either layout — the wide column needs its own follow-current behaviour.

- timestamp: 2026-09-26
  checked: NowPlaying.svelte sheetState (line 577 default 'closed'; every assignment is a grip/tap/flick transition, none reads `wide`); `.cols` CSS (1430-1449); commit 6f670a35 (quick-260919-npfix Fix 3) message + NpLyrics.svelte:219-233
  found: sheetState defaults to 'closed' and wide mode never changes it. Fix 3's commit text: "At >=1280px the closed peek is the whole lyrics column (305px at 1440x900)". NpLyrics received a `wide` prop specifically to stop treating desktop-closed as a phone peek; NpUpNext received nothing — its `open` prop still means "sheet not closed".
  implication: H1(a) CONFIRMED — in wide mode the Up Next column is on screen with `open === false`, so the scroll effect (and the cover-backfill effect on the same gate) never run until the user drags the sheet to half/full.

- timestamp: 2026-09-26
  checked: commits 4d096e28 + 500f3da5 (quick-260618-ink one-shot scroll), ff2f3518 (quick-260615-mnr overflow-anchor)
  found: ink decision: "Scroll is ONE-SHOT on open … only tab+sheetState are tracked reads, so queue mutations never re-fire it". mnr's problem was CSS scroll-anchoring re-pinning on EVERY keyed mutation (advance, remove, retry, reorder) so the user could not scroll freely. Neither commit considered a wide layout (np3 came 3 months later).
  implication: H1(b) CONFIRMED — "on change" never scrolled by design; the mnr property to preserve is "no scroll on a mutation that keeps the same current song", which a uid-keyed latch preserves while still following an actual song change.

- timestamp: 2026-09-26
  checked: NpUpNext.svelte:222 row markup; player.svelte.ts play() lines 3555 (`this.current = track`) and 4028 (`weaveFreshHistory` after the resolve await); NowPlaying.svelte:344-345 upNextStart/upNextList
  found: the playing row is `class:playing={track.uid === player.current?.uid}` — the same uid the effect should key on. `current` flips synchronously at the top of play() but a home-shelf fresh play (no prior setQueue) only installs the track into the queue after the resolve await, so at the first rAF the `.q-row.playing` row can be absent.
  implication: the fix must (1) key the latch on `player.current?.uid`, (2) track `rows` so the late weave re-runs the effect, and (3) clear the latch on a row miss so that re-run actually scrolls. A queue mutation with the same current returns early on the key compare — no continuous scroll.

- timestamp: 2026-09-26
  checked: vite.config.ts test project (node, `src/**/*.{test,spec}.{js,ts}`); `pnpm exec vitest --run src/lib/services/upnext-covers.test.ts` (5 passed)
  found: pure `$lib/services/*.ts` modules are node-testable with the `$lib` alias; upnext-covers.ts/.test.ts is the sibling to mirror for a new upnext-scroll.ts.
  implication: the two decisions (pane open? / scroll key) can be extracted to `src/lib/services/upnext-scroll.ts` and locked by a vitest file per house convention.

## Eliminated

## Resolution

root_cause: |
  Two gates, one prop. (a) NowPlaying.svelte:1134 passes `open={sheetState !== 'closed'}` to NpUpNext. That expression was written for the phone sheet (quick-260618-ink), where the pane is only on screen while the sheet is half/full. quick-260919-np3 later mounted NpUpNext as a standing column at >=1280px regardless of sheetState — but `open` was never taught about `wide`, so in wide mode the column sits fully visible with `open === false`, and the scroll-to-current `$effect` (NpUpNext.svelte:165) returns on its first line. The cover-backfill effect (line 77) shares the gate and is equally dead there. NpLyrics got a `wide` prop for the same desktop-closed case in quick-260919-npfix Fix 3; NpUpNext did not. (b) The scroll effect is a one-shot latched on a boolean whose only tracked read is `open` — the current song's uid is deliberately not a dependency (ink: preserve 260615-mnr's no-scroll-on-mutation) — so a next/prev/auto-advance/row-tap never re-scrolls in either layout.
fix: |
  New pure `src/lib/services/upnext-scroll.ts` (no runes, no store, no DOM): `upNextPaneOpen(wide, sheetState) = wide || sheetState !== 'closed'` and `upNextScrollKey(open, currentUid) = open && currentUid ? currentUid : null`.
  NowPlaying.svelte: the NpUpNext prop is now `open={upNextPaneOpen(wide, sheetState)}` — the same quick-260919-np3 `wide` flag that mounts the column (and that NpLyrics already receives) folded into the one prop both NpUpNext gates read, so the cover-backfill effect is fixed at the same source.
  NpUpNext.svelte: the boolean `upNextScrollDone` latch became `scrolledKey: string | null`, keyed on `upNextScrollKey(open, player.current?.uid ?? null)`. The effect tracks `open`, the current uid and `rows`; `key === null || !rows.length` re-arms (null), `scrolledKey === key` returns (same song → a queue mutation / re-tick scrolls nothing, the 260615-mnr property), else it latches and rAF-scrolls `.q-row.playing`'s li to the `.panel` top via the existing rect-delta + `behavior: 'smooth'`. Inside the rAF a stale key (newer song latched) returns, and a missing container/li un-latches so the late fresh-play weave's `rows` re-run actually scrolls. Applied UNIFORMLY to the narrow sheet and the wide column (scope decision above) — no `wide` gate in NpUpNext.
verification: |
  TDD: `pnpm exec vitest --run src/lib/services/upnext-scroll.test.ts` went RED (module missing, 1 file failed, no tests) → GREEN (1 file, 7/7 passed). Full `pnpm test`: 154 files, 3402 tests passed, 0 failed. `pnpm check`: 0 errors, 1 warning (`.subnav.heads span` unused CSS selector, NowPlaying.svelte:1471 — pre-existing, untouched by this fix).
  Mechanism check against Symptoms: (a) on open in wide mode, `open` is now true from mount so the effect latches the current uid and scrolls once; (b) on next/prev/auto-advance/row tap the uid changes → new key → one more scroll; a remove/reorder/regenerate keeps the uid → same key → no scroll (mnr preserved).
  NOT yet device/real-window verified: the browser pane's rAF is frozen (memory: browser-pane-raf-frozen), so the rAF-deferred scroll cannot be observed there. The human owes a check in a real >=1280px window (open NowPlaying with played history above current → list pinned to the current row; skip next/prev → follows; remove/reorder another row → no scroll) and, since the latch is uniform, a quick phone-sheet sanity pass (half/full → follows on song change, still no scroll on a swipe-remove).
files_changed:
  - src/lib/services/upnext-scroll.ts (new)
  - src/lib/services/upnext-scroll.test.ts (new)
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/NpUpNext.svelte
