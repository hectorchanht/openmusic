---
phase: quick-260701-0aa
plan: 01
subsystem: ui
tags: [ui, press-feedback, svelte-action, css-keyframes, a11y]
requires:
  - player.current (existing currently-playing state)
  - --color-surface design token
provides:
  - use:tapBounce reusable Svelte action
  - "@keyframes tap-bounce + .tap-bouncing global class"
  - active-row highlight in search/library/CompactRow list views
affects:
  - src/routes/(app)/search/+page.svelte
  - src/routes/(app)/library/+page.svelte
  - src/lib/components/CompactRow.svelte
  - src/routes/(app)/+page.svelte
tech-stack:
  added: []
  patterns:
    - one-shot keyframe press feedback (no :active latch — MENU-03/D-12 safe)
    - reuse player.current?.uid for active-row highlight (no new selected-id)
key-files:
  created:
    - src/lib/actions/tapBounce.ts
  modified:
    - src/app.css
    - src/lib/components/CompactRow.svelte
    - src/routes/(app)/search/+page.svelte
    - src/routes/(app)/library/+page.svelte
    - src/routes/(app)/+page.svelte
decisions:
  - "Active-row highlight driven by existing player.current?.uid, not a new selected-id (per plan interpretation)"
  - "Tap feedback is a one-shot keyframe (pointerdown→animationend) so it can never latch under a held finger; the existing hover-only :active scale on tiles is left intact for mouse"
  - "edit-row keeps background precedence: .row.edit-row.is-active resets to --color-bg in library"
metrics:
  duration: ~6 min
  completed: 2026-07-01
  tasks: 3 (auto) + 1 checkpoint (pending human-verify)
  files: 6
---

# Phase quick-260701-0aa Plan 01: Add on-click press feedback in list page Summary

Native-app-like tap feedback: a reusable `use:tapBounce` Svelte action gives song rows and grid tiles a one-shot shrink-then-spring on press (touch + mouse), and list views now show a persistent light-grey `--color-surface` highlight on the currently-playing row. Pure UI — no playback, data, or persistence changes.

## What Was Built

### Task 1 — `use:tapBounce` action + shared keyframes (`8ac417e`)
- **`src/lib/actions/tapBounce.ts`** (new): `Action<HTMLElement>` mirroring `longpress.ts`. On `pointerdown` it adds a `tap-bouncing` class (restarting cleanly via remove + `void node.offsetWidth` reflow on a rapid re-press); removes it on `animationend` guarded by `animationName === 'tap-bounce'` so a descendant marquee animation can't clear it early. Reduced-motion (`matchMedia('(prefers-reduced-motion: reduce)')`) short-circuits the class-add so no scale + no dangling class. Does NOT `preventDefault`/`stopPropagation` — composes with existing `use:longpress`/`use:swipeAction`/`onclick`. `destroy()` removes both listeners.
- **`src/app.css`**: added `@keyframes tap-bounce` (scale 1 → 0.94 → 1), `.tap-bouncing { transform-origin: center; animation: tap-bounce 0.22s ease; }`, and a `@media (prefers-reduced-motion: reduce)` override setting `animation: none`. Lives in global app.css (not a component `<style>`) so the keyframe name isn't mangled and the action's class matches across call sites.

### Task 2 — list views: bounce + active-row highlight (`135bac0`)
- **search/+page.svelte**: `use:tapBounce` + `class:is-active={player.current?.uid === t.uid}` on the result `.row`; added `.row.is-active { background: var(--color-surface); }` (not hover-gated → shows on touch).
- **library/+page.svelte**: same on all four track `.row` buttons (liked, playlist, downloads, history). Added `player` import was already present. Added `.row.is-active` plus `.row.edit-row.is-active { background: var(--color-bg); }` so the red edit-mode modifier keeps background precedence. Fav-artist tiles left untouched (out of scope).
- **CompactRow.svelte**: imported `player`; `use:tapBounce` + `class:is-active={track != null && player.current?.uid === track.uid}` on the track-variant `.crow` (artist variant untouched); added `.crow.is-active`. Discovery stubs (`track == null`) never match → no highlight, as intended.

### Task 3 — home grid/album tiles bounce (`cde892d`)
- **+page.svelte**: imported `tapBounce`; added `use:tapBounce` to the 5 song `.tile`/`.album` buttons (fallback discovery grid L691, discovery grid L830, discovery albumrow L846, single album L876, library-shelf grid L908). Artist tiles (`artistGridTile` snippet, `.album` → `goto('/artist/...')` at L797/L970) and `.subhead-nav` buttons deliberately NOT touched. No CSS change here — keyframe + reduced-motion guard live in app.css; the existing hover-only `:active` scale stays as the mouse affordance (MENU-03/D-12 latch avoidance preserved).

## Verification

- `npx svelte-check --threshold error` → **0 errors, 0 warnings** after each task.
- `npx vitest run src/lib/stores/player.svelte.test.ts` → **161/161 passing** (no playback regression).
- `grep -rn "use:tapBounce" src/` → search row, all 4 library track rows, CompactRow track button, 5 home song tiles/albums.
- `grep -rn "is-active"` → `class:is-active` binding + `.is-active` CSS rule confirmed in search, library, and CompactRow.
- No edits to `player.svelte.ts`, services, or stores.

## Deviations from Plan

None — plan executed as written. One minor addition within plan guidance: added an explicit `.row.edit-row.is-active { background: var(--color-bg); }` override in library (the plan offered "place .is-active BEFORE .edit-row or use a more-specific edit-row selector"; the explicit override is the more-specific-selector option and is unambiguous).

## Checkpoint Pending

Task 4 is `type="checkpoint:human-verify"` (gate="blocking") — NOT auto-verifiable. The dev server / on-device touch verification (bounce on rows + tiles, persistent active-row highlight, one-shot under held finger, reduced-motion disables bounce but keeps highlight) is left for the user. The 3 auto tasks are complete and committed; the human-verify checkpoint is the only remaining step.

## Self-Check: PASSED

- src/lib/actions/tapBounce.ts — FOUND
- Commits 8ac417e, 135bac0, cde892d — FOUND in git log
