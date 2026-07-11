---
quick_id: 260711-sm7
slug: search-input-clear-x-icon-empty-state-sh
status: complete
date: 2026-07-11
---

# Quick Task 260711-sm7 — Summary

## What shipped

Four search-page (`src/routes/(app)/search/+page.svelte`) UX refinements:

1. **Clear (X) icon** inside the search bar, shown only when the input has text.
   Clicking it empties the input, cancels the typeahead + any in-flight
   search/load-more, resets the result set, wipes the in-memory `searchSession`
   (so a tab-return stays empty), and refocuses the input.
2. **Empty input → recent-only state.** The recent-searches block gate was
   relaxed to `q.trim() === '' && entries.length > 0` (dropped the
   `inputFocused`/`!searched` conditions), and `resetResults()` runs whenever the
   input is typed back to empty — so an empty bar collapses the content area to
   just the recent keywords (no stale results / "no results" message).
3. **Per-keyword bin (delete)** — each recent keyword now has a sibling `Trash2`
   button (its own ≥44px hit target, mirroring the `.row-line`/`.ver` layout),
   gated by a native `confirm()` that names the query.
4. **Clear-all confirm** — the "Clear" button is now behind a native `confirm()`.

## Files changed

- `src/lib/search/search-history-logic.ts` — new pure `removeQuery(list, query)`
  (case-insensitive, non-mutating; mirrors `recordQuery`).
- `src/lib/stores/searchHistory.svelte.ts` — new `remove(query)` method.
- `src/routes/(app)/search/+page.svelte` — `X`/`Trash2` imports; `clearSearch()`,
  `resetResults()`, `removeRecent()`; input-wrap + X button; empty-state gate;
  per-keyword bin; clear-all confirm; CSS.
- `src/lib/i18n/*.ts` (16 locales) — 4 new keys: `search.clearInput`,
  `search.removeRecent`, `search.confirmRemoveRecent` (`{q}` interpolation),
  `search.confirmClearAll`.
- Tests: `search-history-logic.test.ts` (+`removeQuery` block),
  `searchHistory.svelte.test.ts` (+`remove()` case).

## Verification

- `pnpm check` → **0 errors, 0 warnings** (confirms i18n key-set parity across all
  16 locales + every new `t()` call site resolves).
- `pnpm test` → new `removeQuery`/`remove()` tests pass; i18n parity test passes.
  One PRE-EXISTING failure (`searchHistory … SSR guard`) is environmental — this
  runner launches node with `--localstorage-file`, so `globalThis.localStorage`
  is defined; confirmed it fails identically with our test file stashed. Not a
  regression.
- **Live browser** (dev server, seeded recent history):
  - Empty input → "Recent searches" list with 3 bins + "Clear" all; 0 results rendered.
  - Typing → X button appears (`aria-label="Clear search"`, lucide icon); recent hidden.
  - Click X → input empties, X hides, recent list + all 3 bins restored, 0 results.
  - Bin with `confirm=false` → entry kept; `confirm=true` → that entry removed from
    UI **and** persisted to `openmusic:search-history:v1`.
  - Clear-all `confirm=false` → entries kept; `confirm=true` → list cleared, storage `[]`.

## Notes / follow-ups

- Confirms use the app-wide native `confirm(t('…'))` idiom (matches
  `settings/data`), not a custom modal — intentional, on-brand.
- Human device UAT (iOS Safari / Android Chrome) still worthwhile for the native
  confirm sheet + keyboard-retention feel; automated browser here can't reach CN
  upstreams, but none of these behaviors need a search backend.
