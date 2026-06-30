---
phase: quick-260630-fu2
plan: 01
subsystem: i18n
tags: [i18n, refactor, quotes, style]
requires: []
provides:
  - "en.ts / zh-Hans.ts / zh-Hant.ts use double-quote string delimiters (matches the other 12 locales)"
affects:
  - src/lib/i18n/en.ts
  - src/lib/i18n/zh-Hans.ts
  - src/lib/i18n/zh-Hant.ts
tech-stack:
  added: []
  patterns:
    - "All 15 i18n locale dictionaries now use double-quote delimiters uniformly"
key-files:
  created: []
  modified:
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hans.ts
    - src/lib/i18n/zh-Hant.ts
decisions:
  - "Used a comment/string-aware Node tokenizer (not blind sed) so `//` comments and the single backtick-in-comment per file were passed through verbatim while only real string-literal delimiters flipped."
  - "Enforced a mandatory toEqual value-equality gate against `git show HEAD:` snapshots before committing, proving zero value drift."
metrics:
  duration: "~4 min"
  completed: "2026-06-30"
  commit: fa233ac
---

# Quick 260630-fu2: Normalize i18n Locale Files to Double Quotes Summary

Converted the three remaining single-quoted i18n dictionaries (`en.ts`, `zh-Hans.ts`, `zh-Hant.ts`) to double-quote string delimiters — a pure, value-preserving delimiter swap matching the 12 already-double-quoted locales (e.g. `de.ts`).

## What Changed

- Flipped every single-quoted object KEY, string VALUE, and the `import type { Dict } from './index'` specifier (zh files) to double quotes.
- Unescaped the only two `\'` occurrences (en.ts `settings.appLanguageDesc`, `settings.accentColorDesc`) to plain `'` inside the new double-quoted form — logical value unchanged.
- Values that were ALREADY double-quoted (because they contain bare apostrophes, e.g. `"You're offline"`) were left byte-identical; only their single-quoted KEY on the same line flipped.
- `//` comments and the single backtick-in-comment per file were left untouched (verified: still exactly 2 backtick chars per file).

Each file shows symmetric `+N / -N` diff line counts (en 335/335, zh-Hans 330/330, zh-Hant 330/330); the whole commit is 995 insertions / 995 deletions across 3 files — pure delimiter swaps, no net line change.

## Method

A comment/string-aware Node tokenizer (`scratchpad/convert.mjs`, throwaway) walked each file character-by-character, passing through `//` comments, block comments, template literals, and existing double-quoted strings verbatim, and re-emitting only single-quoted literals as double-quoted (decoding `\'`→`'`, re-escaping any bare `"`→`\"`; no bare `"` cases existed).

## Verification

| Gate | Result |
| --- | --- |
| Value-equality gate (`toEqual` vs `git show HEAD:` snapshots, all 3 dicts) | GREEN — 3 passed |
| i18n parity test (`src/lib/i18n/i18n.test.ts`) | GREEN — 12 passed |
| Full suite (`npx vitest --run`) | GREEN — 66 files, 960 tests passed |
| `pnpm check` (svelte-check) | 0 errors, 0 warnings (4291 files) |
| `git diff` sanity (non-quote/non-comment changed lines) | none — "diff lines all touch quotes only" |
| Post-conversion single-quote chars remaining | en: 15 (all bare apostrophes in values + 1 comment), zh-Hans: 0, zh-Hant: 0 |
| Escaped `\'` remaining | 0 in all 3 files |

The mandatory value-preservation gate ran GREEN, then all four temp artifacts (`__before_en.ts`, `__before_zhHans.ts`, `__before_zhHant.ts`, `__quote_gate.test.ts`) were deleted and confirmed NOT committed.

## Deviations from Plan

None - plan executed exactly as written.

## Commit

- `fa233ac` refactor(quick-260630-fu2-01): normalize en/zh-Hans/zh-Hant i18n dicts to double quotes (3 files, code only)

## Self-Check: PASSED

- src/lib/i18n/en.ts — FOUND (modified, double-quoted)
- src/lib/i18n/zh-Hans.ts — FOUND (modified, double-quoted)
- src/lib/i18n/zh-Hant.ts — FOUND (modified, double-quoted)
- Commit fa233ac — FOUND in git log
- Temp artifacts (__before_*.ts, __quote_gate.test.ts) — confirmed absent, not committed
