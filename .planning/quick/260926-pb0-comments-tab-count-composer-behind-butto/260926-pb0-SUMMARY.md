---
phase: quick-260926-pb0
plan: 01
status: complete
subsystem: comments / now-playing
tags: [comments, runes-store, i18n, turnstile, now-playing]
requires: [quick-260926-nsz, quick-260926-ot5]
provides: [comments store (current-track thread + count), Comments tab count badge, composer-behind-button]
affects: [src/lib/components/NpComments.svelte, src/lib/components/NowPlaying.svelte]
tech-stack:
  added: []
  patterns: [leaf runes-singleton store, plain-field generation guard, untrack()-wrapped store call in a trigger $effect]
key-files:
  created:
    - src/lib/stores/comments.svelte.ts
    - src/lib/stores/comments.svelte.test.ts
  modified:
    - src/lib/components/NpComments.svelte
    - src/lib/components/NowPlaying.svelte
    - src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "Comment thread lives in a leaf runes store (comments.svelte.ts) loaded by NowPlaying only while the pane is on screen; NpComments is a pure view + composer"
  - "Composer (and the Turnstile script/widget + native bridge iframe) exists only between 'Write a comment' and Cancel/successful post"
  - "Cancel keeps the typed draft text; reopening shows it"
metrics:
  duration: ~6 min
  completed: 2026-09-26
  tasks: 2
  files: 19
---

# Quick 260926-pb0: Comments tab count + composer behind a button — Summary

The current track's comment thread now lives in a leaf runes store, so the Comments tab shows a muted count badge ("Comments 12", "99+" cap) even while the pane is unmounted. The pane opens as the list, newest first, with a "Write a comment" pill above it. Name, textarea, Turnstile or bridge, Cancel and Post only exist after that tap. A successful post collapses the composer, puts the new comment on top and bumps the count straight away.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 | comments store: current-track thread with count (TDD) | `24240dd1` test (RED), `6726b112` feat (GREEN) |
| 2 | pane over the store, composer behind a button, tab badge, i18n x15 | `0b5d45eb` feat |

## What changed

- `src/lib/stores/comments.svelte.ts`: a `Comments` singleton with `uid/key/items/loading/unavailable/reported` as `$state`, a plain `private gen` supersede guard, `visible`/`badge` getters, `load(track)` (deduped per uid), `replace`, `report` and `__reset`. It also exports a pure `commentBadge(n)`. It imports only `services/comments` and the `Track` type, never player.
- `NpComments.svelte`: the local thread state and the track-change fetch effect are gone, so the pane no longer calls `fetchComments(`/`commentThreadKey(`. It reads `comments.*`. The composer sits in the composing block, and Cancel (`close()`) sits before Post. On success it calls `comments.replace(r.items)`, clears the text and sets `composing = false`. On failure it sets `err` and the composer stays open. Report still takes two taps and then calls `comments.report(id)`. All of these are unchanged: plain interpolation, name persistence, token reset after every attempt, the bridge origin+source gate, `hello()` and `errKey`.
- `NowPlaying.svelte`: one trigger `$effect` reads `player.current`, `wide` and `sheetState`, then runs `untrack(() => comments.load(cur))` when `upNextPaneOpen(wide, sheetState)` is true. `commentBadge` is derived with a uid stale-guard, and a `.count` span sits on both `data-tab="comments"` buttons (the wide pair and the narrow tab).
- i18n: `comments.write` and `comments.cancel` added after `comments.errVerify` in all 15 locales, with double quotes.

## Verification (observed)

- `pnpm vitest run src/lib/stores/comments.svelte.test.ts`: 7/7 passed. The leaf and `private gen = 0` grep gates passed.
- Mutation check: I deleted the post-`fetchComments` generation check and the supersede test failed (1 failed, 6 passed). I then restored the file, which the `git diff --stat` output confirmed.
- Task 2 grep gates: all passed (no fetch/key calls in NpComments, `{#if composing}` = 1, `@html` = 0, `comments.replace(` = 1, `untrack(() => comments.load(` = 1, `data-tab="comments"` = 2, `{#if commentBadge}` = 2, 15/15 locales for each key).
- `pnpm check`: 4635 files, 0 errors, 0 warnings.
- `pnpm test`: 164 files, 3629 tests, all passed.
- Browser E2E was NOT run here (the orchestrator owns it). Still unverified: the narrow and wide badge render, that Turnstile is absent from the DOM until tapped, and that a background track change with the sheet closed makes no GET.

## Deviations from Plan

**1. [Rule 2 - preserve existing behavior] Per-track reset of `err` / `armed` kept**
- **Found during:** Task 2
- **Issue:** The deleted track-change effect in NpComments also cleared the error line and the armed Report button on each new song. Deleting it outright would carry a stale "slow down" error or an armed Report over to the next song.
- **Fix:** A tiny `$effect` reads only `comments.uid` and clears `err` and `armed`. It writes state it never reads, so it cannot self-invalidate.
- **Files:** `src/lib/components/NpComments.svelte`. **Commit:** `0b5d45eb`

**2. [Placement] Trigger effect placed right after the `sheetState` declaration**
- The plan said "~after the `wide` media-query setup". I put the effect directly after `let sheetState` instead, so it never references a binding declared later in the file. Behavior is identical.

**3. [Grep gate] Comment reworded**
- A header comment originally contained the literal `{#if composing}`, which pushed the gate count to 2. I reworded it to "the composing block".

## Known Stubs

None.

## Threat Flags

None. No new endpoints or trust boundaries. T-pb0-01, 02 and 03 hold: there is no `@html`, the bridge gate is unchanged, and the Turnstile script and bridge iframe are created only while composing.

## Self-Check: PASSED

- FOUND: src/lib/stores/comments.svelte.ts
- FOUND: src/lib/stores/comments.svelte.test.ts
- FOUND: 24240dd1, 6726b112, 0b5d45eb

## Orchestrator follow-up (post-execution)

- **Bug caught in E2E, fixed in `50d52a22`:** the thread load was gated on `upNextPaneOpen(wide, sheetState)`, but Now Playing opens with the tab sheet in the closed peek where the tab bar IS visible, so the badge stayed blank until the sheet was dragged up. The gate is now just `player.current` — NowPlaying only mounts while `player.expanded`, so background track changes with Now Playing closed still cost nothing.
- **Browser E2E (dev server, /api/comments GET stubbed in-page with 3 and 100 items):** 0 GETs while Now Playing closed, 1 on open; narrow tab reads "Comments 3" with the sheet collapsed; wide pair reads "Comments 99+" for 100 items; pane opens list-first with "Write a comment" and NO Turnstile script; the button mounts name/textarea/Cancel + loads the Turnstile script + widget with the list intact; Cancel removes composer and widget. A real post was not made (Turnstile does not complete in the hidden pane; the post path was proven in 260926-nsz/ot5).
