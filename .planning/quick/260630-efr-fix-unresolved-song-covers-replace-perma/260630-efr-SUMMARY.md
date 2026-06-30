---
phase: quick-260630-efr
plan: 01
subsystem: settings / i18n
tags: [i18n, settings, ux, covers]
requires: []
provides:
  - "settings.clearCoverCacheHint i18n key (15 locales)"
  - "Muted hint caption under Clear cover cache button (Settings → Data)"
affects:
  - src/lib/i18n/*.ts
  - src/routes/(app)/settings/data/+page.svelte
tech-stack:
  added: []
  patterns:
    - "i18n key-parity enforced across all 15 locales via i18n.test.ts"
    - "Reuse existing muted-caption styling; tight .hint variant for button-subordinate text"
key-files:
  created: []
  modified:
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hans.ts
    - src/lib/i18n/zh-Hant.ts
    - src/lib/i18n/ar.ts
    - src/lib/i18n/de.ts
    - src/lib/i18n/es.ts
    - src/lib/i18n/fr.ts
    - src/lib/i18n/hi.ts
    - src/lib/i18n/id.ts
    - src/lib/i18n/it.ts
    - src/lib/i18n/pt.ts
    - src/lib/i18n/ru.ts
    - src/lib/i18n/th.ts
    - src/lib/i18n/tr.ts
    - src/lib/i18n/vi.ts
    - src/routes/(app)/settings/data/+page.svelte
decisions:
  - "Manual-only framing: hint copy never claims covers refresh 'automatically' (CONTEXT.md LOCKED)"
  - "Added a tight .hint CSS class instead of reusing .muted, so the caption hugs its button without the .muted bottom margin pushing the next button away"
  - "Key name settings.clearCoverCacheHint (Claude's-discretion suggestion in CONTEXT.md)"
metrics:
  duration: ~2 min
  completed: 2026-06-30
---

# Phase quick-260630-efr Plan 01: Clearer manual clear-cover-cache path Summary

Added a discoverable, accurate helper line beneath the already-wired "Clear cover cache" button in Settings → Data, backed by a new `settings.clearCoverCacheHint` i18n key translated across all 15 locales — closing the discoverability gap behind "some song cover is still not resolved" with copy that is true to the manual-only behavior.

## What Was Built

- **Task 1 — i18n key (15 locales):** Added `settings.clearCoverCacheHint` immediately after the existing `settings.clearCoverCache` entry in every locale dictionary. EN is the verbatim LOCKED source-of-truth string; the other 14 are faithful per-locale translations, all keeping the manual-behavior framing (clearing removes saved cover art so missing/outdated covers are fetched again next view). Single-quote style preserved in en/zh-Hans/zh-Hant; double-quote style preserved in the other 12.
- **Task 2 — rendered hint:** Inserted `<p class="hint">{t('settings.clearCoverCacheHint')}</p>` directly under the `clearCovers` button and added a tight `.hint` style (`color: var(--color-text-muted); font-size: 12px; margin: -2px 0 10px 4px;`) so the caption reads as subordinate to that button. No behavior change to `clearCovers()` or any other markup.

## EN copy (verbatim, LOCKED)

> Removes saved cover art so missing or outdated covers are fetched again next time.

## Verification

- `pnpm exec vitest --run src/lib/i18n/i18n.test.ts` → **12 passed** (key parity across all 15 locales + no-blank values).
- `pnpm check` → **0 errors, 0 warnings** (4291 files).
- `grep settings.clearCoverCacheHint` in the settings page → present.

## Deviations from Plan

None — plan executed exactly as written. The plan offered discretion to use `.muted` or a tight `.hint`; chose `.hint` per the plan's stated fallback to avoid the `.muted` bottom margin spacing the next button too far.

## Commits

- `4415204` feat(quick-260630-efr-01): add settings.clearCoverCacheHint to all 15 locales
- `2036d9b` feat(quick-260630-efr-02): render muted hint under Clear cover cache button

## Scope Guard Honored

No changes to `cover-cache.ts`, `lazyCover.ts`, the `clearCovers()` handler, TTL/migration, probing, or `<img onerror>` eviction — all explicitly declined in CONTEXT.md.

## Self-Check: PASSED

- Commits `4415204`, `2036d9b` present in git log.
- `src/lib/i18n/en.ts` and `src/routes/(app)/settings/data/+page.svelte` exist and contain `settings.clearCoverCacheHint`.
