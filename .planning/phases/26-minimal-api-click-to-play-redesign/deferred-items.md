# Deferred Items — Phase 26

Out-of-scope discoveries logged during execution. NOT fixed here (SCOPE BOUNDARY: only
auto-fix issues directly caused by the current task's changes).

## From Plan 26-05 (netease health-gate)

### Pre-existing test failure: `searchHistory.svelte.test.ts` SSR-guard case

- **File:** `src/lib/stores/searchHistory.svelte.test.ts:37`
- **Failing assertion:** `expect(typeof globalThis.localStorage).toBe('undefined')`
- **Root cause:** ENVIRONMENTAL / pre-existing — the local runtime is Node **v25.9.0**, which
  ships a built-in Web Storage API (`globalThis.localStorage` is defined, stable since Node 22.4).
  The test was authored (Phase 14, commit `188b495`) under an older Node where `localStorage` was
  absent in the vitest node/server project. It now fails purely because the runtime provides
  `localStorage`.
- **Why out of scope for 26-05:** the file is untouched by this plan and imports nothing this plan
  changed (verified: fails identically in isolation, `netease-health` is not in its import graph).
- **Fix direction (future):** either pin the node/server vitest project to disable Web Storage
  (`--no-experimental-webstorage` is not applicable at 25.x; use a vitest `env` / setup that deletes
  `globalThis.localStorage`), or rewrite the SSR-guard assertion to feature-detect rather than assert
  `localStorage` is `undefined`. CLAUDE.md pins Node `>=22`; CI Node version should be confirmed.

## From Plan 26-08 (gaps 4 & 5 — version-picker lazy fetch + dedup + label)

### Pre-existing `pnpm check` error: `album/[name]/+page.svelte` `swipeLike`

- **File:** `src/routes/(app)/album/[name]/+page.svelte:590` — "Cannot find name 'swipeLike'."
- **Root cause:** Introduced by the concurrent UI session, committed to `main` at `dce0af0`
  ("feat(album): song-row swipe-left = play next (was like)") — the swipe-left handler was renamed
  but a stale `swipeLike(track)` reference remains in the row's `use:swipeAction`.
- **Why out of scope for 26-08:** this plan touches only `variants.ts`, `dedupe.ts`,
  `VersionPicker.svelte`, and the 15 i18n dictionaries; the album route is not in its file set.
  `variants.ts` / `dedupe.ts` / `VersionPicker.svelte` introduce ZERO new typecheck errors.
- **Fix direction:** owned by the concurrent album-swipe session (wire the renamed handler).

### Pre-existing `pnpm check` warning: `search/+page.svelte` unused `.warn` selector

- **File:** `src/routes/(app)/search/+page.svelte:776` — unused CSS selector `.warn`.
- Pre-existing, unrelated to 26-08. Left as-is.
