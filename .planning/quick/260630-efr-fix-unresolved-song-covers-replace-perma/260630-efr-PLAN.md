---
phase: quick-260630-efr
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
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
autonomous: true
requirements: [EFR-01]

must_haves:
  truths:
    - "A muted helper line is visible directly beneath the 'Clear cover cache' button in Settings → Data"
    - "The helper text describes the MANUAL behavior (covers re-fetched next time viewed) and does NOT claim covers refresh 'automatically'"
    - "The new key settings.clearCoverCacheHint exists in all 15 locale dictionaries with a non-blank, locale-appropriate value"
    - "i18n key-parity test still passes (every locale key set identical to en)"
  artifacts:
    - path: "src/lib/i18n/en.ts"
      provides: "settings.clearCoverCacheHint EN source-of-truth string"
      contains: "settings.clearCoverCacheHint"
    - path: "src/routes/(app)/settings/data/+page.svelte"
      provides: "Rendered hint line under the clearCovers button"
      contains: "settings.clearCoverCacheHint"
  key_links:
    - from: "src/routes/(app)/settings/data/+page.svelte"
      to: "settings.clearCoverCacheHint"
      via: "t() lookup in template"
      pattern: "t\\('settings.clearCoverCacheHint'\\)"
---

<objective>
Make the existing (already-wired) "Clear cover cache" button discoverable as the remedy for missing/outdated song covers by adding ONE muted helper line beneath it, plus the backing i18n key in all 15 locales.

Purpose: Users report "some song cover is still not resolved." Discovery (CONTEXT.md) found the button already exists and works (wipe-all → next view re-resolves). The only gap is discoverability — users don't know this button is the fix. This plan closes that gap with copy that is ACCURATE to the manual-only behavior.

Output: New i18n key `settings.clearCoverCacheHint` in all 15 locale files + a rendered muted hint line under the `clearCovers` button.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260630-efr-fix-unresolved-song-covers-replace-perma/260630-efr-CONTEXT.md

# The button this plan adds a hint to (no behavior change). The hint sits directly under line 54.
@src/routes/(app)/settings/data/+page.svelte

# Key-parity test that MUST stay green. It iterates ALL 15 locales and asserts every
# locale's key set is identical to en, and that no value is blank.
@src/lib/i18n/i18n.test.ts

<interfaces>
<!-- The existing key this hint pairs with, and the two QUOTE STYLES in the codebase. -->
<!-- en/zh-Hans/zh-Hant use SINGLE quotes; the other 12 locales use DOUBLE quotes. -->
<!-- Match each file's existing style when adding the new line. -->

en.ts (single-quote style, key at line 145):
  'settings.clearCoverCache': 'Clear cover cache',
  'settings.clearSearchHistory': 'Clear search history',

zh-Hans.ts / zh-Hant.ts (single-quote style, key at line 139):
  'settings.clearCoverCache': '清除封面缓存',   // zh-Hans
  'settings.clearCoverCache': '清除封面快取',   // zh-Hant

ar/de/es/fr/hi/id/it/pt/ru/th/tr/vi (double-quote style, key at line 126):
  "settings.clearCoverCache": "<existing translation>",

Settings page t() usage pattern (data/+page.svelte):
  {t('settings.clearCoverCache')}   // existing
  .muted style already defined: color: var(--color-text-muted); font-size: 12px;
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add settings.clearCoverCacheHint to all 15 locale dictionaries</name>
  <files>src/lib/i18n/en.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts</files>
  <action>
Add a new entry `settings.clearCoverCacheHint` directly AFTER the existing `settings.clearCoverCache` line in EVERY one of the 15 locale files (per CONTEXT.md decision — key name suggested in `## Claude's Discretion`). Match each file's existing quote style: SINGLE quotes for en.ts / zh-Hans.ts / zh-Hant.ts, DOUBLE quotes for the other 12 locales. Keep the trailing comma consistent with neighboring lines.

The EN value MUST be exactly (per CONTEXT.md LOCKED decision — accurate to MANUAL behavior, must NOT claim "automatic"):
"Removes saved cover art so missing or outdated covers are fetched again next time."

For the other 14 locales, write a faithful translation of that EN sentence in that language (do NOT copy the EN string verbatim — the parity test allows duplicates but a real translation is the requirement here; the no-blank test forbids empty strings). Keep the manual-behavior framing in every translation: clearing removes saved cover art so missing/outdated covers are fetched again on next view. Do NOT use any wording that implies covers refresh "automatically."

Do NOT touch any other key, the existing `settings.clearCoverCache` / `settings.coverCacheCleared` values, or cover-cache.ts / lazyCover.ts. This task only ADDS one key per file.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm exec vitest --run src/lib/i18n/i18n.test.ts</automated>
  </verify>
  <done>`settings.clearCoverCacheHint` exists in all 15 locale files with a non-blank, locale-appropriate value; the i18n key-parity and no-blank tests pass (every locale key set identical to en).</done>
</task>

<task type="auto">
  <name>Task 2: Render the muted hint line under the Clear cover cache button</name>
  <files>src/routes/(app)/settings/data/+page.svelte</files>
  <action>
Insert a muted hint line directly BENEATH the existing `clearCovers` button (the `<button class="item" onclick={clearCovers}>` at line 54) so it reads as a caption for that button — visually subordinate, NOT another `.item` button (per CONTEXT.md decision).

Render `{t('settings.clearCoverCacheHint')}` inside a small muted element. Prefer reusing the existing `.muted` style; if its default bottom margin pushes the next button too far, add a tight `.hint` class (e.g. `color: var(--color-text-muted); font-size: 12px; margin: -2px 0 10px 4px;`) instead — Claude's discretion on the exact element (`<p>` or `<small>`) and spacing. Keep it tight to the cover button and clearly subordinate.

Do NOT change the button's behavior, the `clearCovers()` handler, or any other button/markup. This is a pure additive render.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -q "settings.clearCoverCacheHint" "src/routes/(app)/settings/data/+page.svelte" && pnpm check</automated>
  </verify>
  <done>A muted caption rendering `t('settings.clearCoverCacheHint')` appears directly under the Clear cover cache button; `pnpm check` reports 0 errors; the existing button behavior is unchanged.</done>
</task>

</tasks>

<verification>
- `pnpm exec vitest --run src/lib/i18n/i18n.test.ts` passes (key parity across all 15 locales + no blank values).
- `pnpm check` reports 0 errors.
- The hint renders under the Clear cover cache button (visual confirm at Settings → Data).
- No changes to cover-cache.ts, lazyCover.ts, the clearCovers handler, or any unrelated i18n key.
</verification>

<success_criteria>
- `settings.clearCoverCacheHint` present in all 15 locales with accurate, manual-behavior copy (EN exactly as specified; others translated, none blank, none implying "automatic").
- One muted, visually-subordinate hint line rendered beneath the existing Clear cover cache button.
- i18n key-parity test + `pnpm check` both green.
- Zero behavior changes to caching/eviction/probing (scope guard honored).
</success_criteria>

<output>
Create `.planning/quick/260630-efr-fix-unresolved-song-covers-replace-perma/260630-efr-SUMMARY.md` when done.
</output>
