---
phase: quick-260630-fce
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/i18n/en.ts
  - src/lib/i18n/zh-Hant.ts
  - src/lib/i18n/zh-Hans.ts
  - src/lib/i18n/es.ts
  - src/lib/i18n/fr.ts
  - src/lib/i18n/de.ts
  - src/lib/i18n/pt.ts
  - src/lib/i18n/it.ts
  - src/lib/i18n/ru.ts
  - src/lib/i18n/tr.ts
  - src/lib/i18n/ar.ts
  - src/lib/i18n/hi.ts
  - src/lib/i18n/id.ts
  - src/lib/i18n/vi.ts
  - src/lib/i18n/th.ts
  - src/routes/(app)/settings/general/+page.svelte
  - src/routes/(app)/settings/appearance/+page.svelte
  - src/routes/(app)/settings/home/+page.svelte
  - src/routes/(app)/settings/playback/+page.svelte
  - src/routes/(app)/settings/data/+page.svelte
autonomous: true
requirements: [HELP-01]

must_haves:
  truths:
    - "Every settings control that previously lacked an explanation now shows a detailed helper line beneath it"
    - "All 22 new keys exist in ALL 15 locales (i18n key-parity test is GREEN)"
    - "i18n parity stays GREEN at EVERY commit (per-page atomic commits, never a key in only some locales)"
    - "No existing control behavior, key, or copy changed"
    - "Each page's helper line uses that page's EXISTING helper class (.muted / .note / .hint) — no new classes, no restyle"
  artifacts:
    - path: "src/lib/i18n/en.ts"
      provides: "22 new settings.*Desc keys (English source copy, single quotes)"
    - path: "src/routes/(app)/settings/general/+page.svelte"
      provides: "4 helper lines (.muted) under App Language, Theme, Accent Color, Reduce Motion"
    - path: "src/routes/(app)/settings/appearance/+page.svelte"
      provides: "7 helper lines (.note) under 5 font sliders + Cover Size + Grid Columns"
    - path: "src/routes/(app)/settings/home/+page.svelte"
      provides: "5 helper lines (.muted) under Items Per Shelf, Landing Tab, Tile Density, Search Pill, Randomize"
    - path: "src/routes/(app)/settings/playback/+page.svelte"
      provides: "1 helper line (.muted) under Auto Expand"
    - path: "src/routes/(app)/settings/data/+page.svelte"
      provides: "5 helper lines (.hint) under Clear Picks, Clear Name Cache, Clear Search History, Reset Appearance, Clear Library"
  key_links:
    - from: "each +page.svelte helper line"
      to: "src/lib/i18n/en.ts (and 14 other locales)"
      via: "t('settings.<key>Desc')"
      pattern: "t\\('settings\\.[a-zA-Z]+Desc'\\)"
---

<objective>
Add a detailed helper line beneath every settings control that currently lacks an explanation. 22 new i18n keys, each added to ALL 15 locales, and rendered on 5 settings pages.

Purpose: Several settings controls have no description, so a user cannot tell what the control does or when to change it. Detailed helper copy (a sentence that explains WHAT the control does AND WHEN/WHY to change it) fixes that.

Output: 22 new `settings.*Desc` keys present in all 15 locale dicts; one rendered helper line under each of the 22 controls; i18n key-parity test GREEN; `pnpm check` 0 errors. Five atomic commits, one per page.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260630-fce-add-detailed-helper-text-under-unexplain/

Live app is SvelteKit under `src/` (CLAUDE.md is stale — do NOT touch index.html).

## Authoritative facts gathered during planning (do not re-derive)

**Quote style per locale (MUST match the file you edit):**
- SINGLE quotes: `en.ts`, `zh-Hans.ts`, `zh-Hant.ts`
- DOUBLE quotes: `es, fr, de, pt, it, ru, tr, ar, hi, id, vi, th` (12 files)

**Locale file list (all 15):** en, zh-Hant, zh-Hans, es, fr, de, pt, it, ru, tr, ar, hi, id, vi, th — under `src/lib/i18n/<lang>.ts`.

**i18n dict shape:** each file exports a record of `'key': 'value',` entries (single-quote files) or `"key": "value",` entries (double-quote files), one per line. Insert new entries near the related existing `settings.*` keys; exact line position does not matter (object is order-independent), but keep them grouped logically and match surrounding TAB indentation.

**Parity test (`src/lib/i18n/i18n.test.ts`):** asserts every locale's key set is IDENTICAL to `en`, and that no value is blank. A key present in only some locales FAILS the test → every commit MUST add the page's keys to ALL 15 locales together.

**Existing helper class per page (REUSE — do not invent classes):**
- General → `.muted` (`<p class="muted">…</p>`)
- Appearance → `.note` (`<p class="note">…</p>`)
- Home → `.muted` (`<p class="muted">…</p>`)
- Playback → `.muted` (`<p class="muted">…</p>`)
- Data → `.hint` (`<p class="hint">…</p>`)

All five classes already exist in each page's `<style>` block — no CSS changes needed.

**Markup quote style inside each .svelte file (MATCH THE EXISTING CALLS in that file):**
- general, home, playback, data → `t('settings.x')` (SINGLE quotes)
- appearance → `t("settings.x")` (DOUBLE quotes)

**Existing helper-line patterns to clone (verbatim style references):**
- Home already uses `<p class="muted">{t('settings.dragToReorder')}</p>` after section content.
- Appearance already ends its Layout section with `<p class="note">{t("settings.appearanceNote")}</p>` (double quotes).
- Data already has `<p class="hint">{t('settings.clearCoverCacheHint')}</p>` right after the Clear Cover Cache button — clone that exact pattern.

## The 22 keys (grouped by page) — author DETAILED English copy for each

General (4): appLanguageDesc, themeDesc, accentColorDesc, reduceMotionDesc
Appearance (7): fontSizeTitleDesc, fontSizeArtistDesc, fontSizeLyricsDesc, fontSizeNpTitleDesc, fontSizeNpArtistDesc, coverScaleDesc, gridColumnsDesc
Home (5): itemsPerShelfDesc, defaultLandingTabDesc, tileDensityDesc, showSearchPillDesc, showRandomizeDesc
Playback (1): autoExpandDesc
Data (5): clearPicksDesc, clearNameCacheDesc, clearSearchHistoryDesc, resetAppearanceDesc, clearLibraryDesc

Copy tone: DETAILED — each line is a sentence explaining what the control does AND when/why you'd change it. NOT 3 words. Author idiomatic EN first, then faithful per-locale translations for the other 14. Special-cases:
- `tileDensityDesc`: clarify it controls LAYOUT density (list / pile / grid presentation), distinct from "Items per shelf" which is a COUNT.
- `clearLibraryDesc`: DESTRUCTIVE — explicitly say it deletes favorites/playlists/downloads and cannot be undone.

## Controls that are ALREADY explained — DO NOT TOUCH
Translation page, Last.fm page, About page, settings index, and any control with an existing `*Note`/`*Hint` key (e.g. defaultQualityNote, downloadQualityNote, defaultSourceNote, sourcesAdvancedNote, appearanceNote, clearCoverCacheHint). Add ONLY the 22 new keys; render ONLY the 22 new lines.
</context>

<tasks>

<task type="auto">
  <name>Task 1: General page — 4 helper lines + 4 keys × 15 locales (atomic commit)</name>
  <files>
    src/lib/i18n/en.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/de.ts, src/lib/i18n/pt.ts, src/lib/i18n/it.ts, src/lib/i18n/ru.ts, src/lib/i18n/tr.ts, src/lib/i18n/ar.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/vi.ts, src/lib/i18n/th.ts, src/routes/(app)/settings/general/+page.svelte
  </files>
  <action>
    Add 4 new keys to ALL 15 locale files: settings.appLanguageDesc, settings.themeDesc, settings.accentColorDesc, settings.reduceMotionDesc. In each file insert them next to the related existing key (e.g. after settings.appLanguage, settings.theme/themeLight, settings.accentColor, settings.reduceMotion) using that file's quote style (single for en/zh-Hans/zh-Hant; double for the other 12) and TAB indentation matching siblings.

    Author DETAILED English copy first in en.ts (a full sentence each: what the control does AND when/why to change it). Then write faithful, idiomatic translations into each of the other 14 locales — do not leave English placeholders, do not leave any value blank (blank fails the parity test). Suggested EN intent: appLanguage = "Sets the language for the app interface; song and artist names follow the Translation settings, not this."; theme = "Switches between dark and light appearance; pick whichever is easier on your eyes."; accentColor = "The highlight color used for active controls, toggles and the playing track; choose one that suits your taste."; reduceMotion = "Turns off non-essential animations and transitions; enable it if motion bothers you or to save battery." (Author final wording yourself; keep it detailed.)

    Render 4 helper lines in general/+page.svelte using the page's existing `.muted` class and SINGLE-quote `t(...)` calls. Place each `<p class="muted">{t('settings.<key>Desc')}</p>` at the END of its matching `<section>` (after the chips/seg/swatches/row-toggle content, before `</section>`): App Language section → appLanguageDesc; Theme section → themeDesc; Accent Color section → accentColorDesc; Reduce Motion (playbackMotion) section → reduceMotionDesc. Do NOT change any control, handler, existing key, or existing copy. `.muted` already exists in this page's style block — no CSS changes.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && npx vitest --run src/lib/i18n/i18n.test.ts && for k in appLanguageDesc themeDesc accentColorDesc reduceMotionDesc; do test "$(grep -rl "settings.$k" src/lib/i18n/*.ts | grep -v test | wc -l | tr -d ' ')" = "15" || { echo "FAIL $k not in 15 locales"; exit 1; }; done && test "$(grep -c "Desc')}" "src/routes/(app)/settings/general/+page.svelte")" = "4"</automated>
  </verify>
  <done>Parity test GREEN; each of the 4 keys appears in exactly 15 locale files; general/+page.svelte renders 4 new `.muted` helper lines; committed atomically as `feat(quick-260630-fce-01): general settings helper text`.</done>
</task>

<task type="auto">
  <name>Task 2: Appearance page — 7 helper lines + 7 keys × 15 locales (atomic commit)</name>
  <files>
    src/lib/i18n/en.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/de.ts, src/lib/i18n/pt.ts, src/lib/i18n/it.ts, src/lib/i18n/ru.ts, src/lib/i18n/tr.ts, src/lib/i18n/ar.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/vi.ts, src/lib/i18n/th.ts, src/routes/(app)/settings/appearance/+page.svelte
  </files>
  <action>
    Add 7 keys to ALL 15 locales: settings.fontSizeTitleDesc, fontSizeArtistDesc, fontSizeLyricsDesc, fontSizeNpTitleDesc, fontSizeNpArtistDesc, coverScaleDesc, gridColumnsDesc. Insert near the matching existing keys (settings.fontSizeTitle, fontSizeArtist, fontSizeLyrics, fontSizeNpTitle, fontSizeNpArtist, coverSize, gridColumns). Match each file's quote style and TAB indentation. Author DETAILED EN copy, then faithful translations for the other 14 (no blanks, no English placeholders).

    Suggested EN intent (author final wording yourself, detailed): the five font sizes scale the corresponding text app-wide (song title in lists, artist name in lists, lyric lines, the now-playing song title, the now-playing artist) where 100% is default — raise for readability, lower to fit more on screen. coverScaleDesc = scales album-cover artwork size across grids and lists; bigger covers = fewer per row. gridColumnsDesc = sets how many columns the Home grid uses; more columns = smaller tiles, fewer = larger tiles.

    Render 7 helper lines in appearance/+page.svelte. IMPORTANT: this file uses DOUBLE-quote `t("...")` calls in markup — match that. Each font slider lives in a `<div class="ctl">`; add `<p class="note">{t("settings.<key>Desc")}</p>` at the end of the corresponding `.ctl` block (after the `.prev`/preview span, before `</div>`). For Cover Size and Grid Columns, place the `.note` line at the end of their `.ctl` blocks (after the demo block). The Layout section already ends with `<p class="note">{t("settings.appearanceNote")}</p>` — leave that line untouched; the 7 new lines are per-control and distinct. `.note` already exists — no CSS changes. Do not change any slider, handler, demo, existing key, or existing copy.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && npx vitest --run src/lib/i18n/i18n.test.ts && for k in fontSizeTitleDesc fontSizeArtistDesc fontSizeLyricsDesc fontSizeNpTitleDesc fontSizeNpArtistDesc coverScaleDesc gridColumnsDesc; do test "$(grep -rl "settings.$k" src/lib/i18n/*.ts | grep -v test | wc -l | tr -d ' ')" = "15" || { echo "FAIL $k not in 15 locales"; exit 1; }; done && test "$(grep -c 'Desc")}' "src/routes/(app)/settings/appearance/+page.svelte")" = "7"</automated>
  </verify>
  <done>Parity test GREEN; each of the 7 keys appears in exactly 15 locale files; appearance/+page.svelte renders 7 new `.note` helper lines (appearanceNote untouched); committed atomically as `feat(quick-260630-fce-02): appearance settings helper text`.</done>
</task>

<task type="auto">
  <name>Task 3: Home page — 5 helper lines + 5 keys × 15 locales (atomic commit)</name>
  <files>
    src/lib/i18n/en.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/de.ts, src/lib/i18n/pt.ts, src/lib/i18n/it.ts, src/lib/i18n/ru.ts, src/lib/i18n/tr.ts, src/lib/i18n/ar.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/vi.ts, src/lib/i18n/th.ts, src/routes/(app)/settings/home/+page.svelte
  </files>
  <action>
    Add 5 keys to ALL 15 locales: settings.itemsPerShelfDesc, defaultLandingTabDesc, tileDensityDesc, showSearchPillDesc, showRandomizeDesc. Insert near the matching existing keys (settings.itemsPerShelf, defaultLandingTab, tileDensity, showSearchPill, showRandomize). Match each file's quote style and TAB indentation. Author DETAILED EN copy, then faithful translations for the other 14 (no blanks, no English placeholders).

    Suggested EN intent (author final wording yourself, detailed): itemsPerShelfDesc = how many items each Home shelf shows before you scroll for more. defaultLandingTabDesc = which tab opens when you launch the app (Home, Search, or Library). tileDensityDesc = MUST clarify it controls the LAYOUT/presentation density of Home shelves (list, pile, or grid), distinct from Items per shelf which is a count — change it to make shelves more compact or more visual. showSearchPillDesc = toggles the search bar/pill at the top of Home. showRandomizeDesc = toggles the Randomize button on Home for shuffling a random mix.

    Render 5 helper lines in home/+page.svelte using `.muted` and SINGLE-quote `t('...')` calls. Place each `<p class="muted">{t('settings.<key>Desc')}</p>` at the end of its matching `<section>` before `</section>`: Items Per Shelf section (the SlidersHorizontal one, after the range input) → itemsPerShelfDesc; Default Landing Tab section → defaultLandingTabDesc; Tile Density section → tileDensityDesc; Home Chrome section (after the two row-toggle buttons) → add showSearchPillDesc AND showRandomizeDesc as two separate `.muted` lines. The existing `<p class="muted">{t('settings.dragToReorder')}</p>` / `homeShowingAll` lines stay untouched. Do not change any control, handler, existing key, or existing copy. `.muted` already exists — no CSS changes.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && npx vitest --run src/lib/i18n/i18n.test.ts && for k in itemsPerShelfDesc defaultLandingTabDesc tileDensityDesc showSearchPillDesc showRandomizeDesc; do test "$(grep -rl "settings.$k" src/lib/i18n/*.ts | grep -v test | wc -l | tr -d ' ')" = "15" || { echo "FAIL $k not in 15 locales"; exit 1; }; done && test "$(grep -c "Desc')}" "src/routes/(app)/settings/home/+page.svelte")" = "5"</automated>
  </verify>
  <done>Parity test GREEN; each of the 5 keys appears in exactly 15 locale files; home/+page.svelte renders 5 new `.muted` helper lines; committed atomically as `feat(quick-260630-fce-03): home settings helper text`.</done>
</task>

<task type="auto">
  <name>Task 4: Playback page — 1 helper line + 1 key × 15 locales (atomic commit)</name>
  <files>
    src/lib/i18n/en.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/de.ts, src/lib/i18n/pt.ts, src/lib/i18n/it.ts, src/lib/i18n/ru.ts, src/lib/i18n/tr.ts, src/lib/i18n/ar.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/vi.ts, src/lib/i18n/th.ts, src/routes/(app)/settings/playback/+page.svelte
  </files>
  <action>
    Add 1 key to ALL 15 locales: settings.autoExpandDesc. Insert near the existing settings.autoExpand key. Match each file's quote style and TAB indentation. Author DETAILED EN copy, then faithful translations for the other 14 (no blanks, no English placeholders).

    Suggested EN intent (author final wording yourself, detailed): autoExpandDesc = when on, the now-playing screen automatically expands to full-screen each time you start a track; turn off to keep the mini player at the bottom and stay on your current screen.

    Render 1 helper line in playback/+page.svelte using `.muted` and SINGLE-quote `t('...')` calls (this file uses single quotes). Place `<p class="muted">{t('settings.autoExpandDesc')}</p>` at the end of the `<section>` containing the Auto-Expand row-toggle (the playbackMotion section with the Maximize2 toggle), after the `</button>` and before `</section>`. Do NOT touch the up-next sourcing section, the Sources accordion, or the quality/source `*Note` lines — already explained. Do not change any control, handler, existing key, or existing copy. `.muted` already exists — no CSS changes.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && npx vitest --run src/lib/i18n/i18n.test.ts && test "$(grep -rl "settings.autoExpandDesc" src/lib/i18n/*.ts | grep -v test | wc -l | tr -d ' ')" = "15" && grep -q "settings.autoExpandDesc')}" "src/routes/(app)/settings/playback/+page.svelte"</automated>
  </verify>
  <done>Parity test GREEN; settings.autoExpandDesc appears in exactly 15 locale files; playback/+page.svelte renders 1 new `.muted` helper line under Auto-Expand; committed atomically as `feat(quick-260630-fce-04): playback settings helper text`.</done>
</task>

<task type="auto">
  <name>Task 5: Data page — 5 helper lines + 5 keys × 15 locales (atomic commit) + final full check</name>
  <files>
    src/lib/i18n/en.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/de.ts, src/lib/i18n/pt.ts, src/lib/i18n/it.ts, src/lib/i18n/ru.ts, src/lib/i18n/tr.ts, src/lib/i18n/ar.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/vi.ts, src/lib/i18n/th.ts, src/routes/(app)/settings/data/+page.svelte
  </files>
  <action>
    Add 5 keys to ALL 15 locales: settings.clearPicksDesc, clearNameCacheDesc, clearSearchHistoryDesc, resetAppearanceDesc, clearLibraryDesc. Insert near the matching existing keys (settings.clearPicks, clearNameCache, clearSearchHistory, resetAppearance, clearLibrary — note the existing clearCoverCacheHint sits right by these). Match each file's quote style and TAB indentation. Author DETAILED EN copy, then faithful translations for the other 14 (no blanks, no English placeholders).

    Suggested EN intent (author final wording yourself, detailed): clearPicksDesc = removes the cached "top picks" and Home library shelves so they regenerate fresh next time; use it if your recommendations feel stale. clearNameCacheDesc = clears stored artist/title name translations so they are re-fetched; use it after changing translation settings or if a name looks wrong. clearSearchHistoryDesc = deletes your saved past searches from this device. resetAppearanceDesc = restores all text sizes, cover size and grid columns back to their 100%/default values without touching your library. clearLibraryDesc = DESTRUCTIVE — explicitly state it permanently deletes all your favorites, playlists and downloads on this device and CANNOT be undone.

    Render 5 helper lines in data/+page.svelte using the page's `.hint` class and SINGLE-quote `t('...')` calls — clone the EXISTING pattern `<p class="hint">{t('settings.clearCoverCacheHint')}</p>` that already sits under the Clear Cover Cache button. Place each new `<p class="hint">{t('settings.<key>Desc')}</p>` immediately AFTER its corresponding button: clearPicks button → clearPicksDesc; clearNameCache button → clearNameCacheDesc; clearSearchHistory button → clearSearchHistoryDesc; resetAppearance button → resetAppearanceDesc; clearLibrary (danger) button → clearLibraryDesc. Leave the existing clearCoverCacheHint line untouched (Clear Cover Cache is already explained). Do not change any control, handler, existing key, or existing copy. `.hint` already exists — no CSS changes.

    FINAL VERIFICATION (whole feature): after this commit, run the full parity test AND `pnpm check` and confirm 0 errors across the whole project.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && npx vitest --run src/lib/i18n/i18n.test.ts && for k in clearPicksDesc clearNameCacheDesc clearSearchHistoryDesc resetAppearanceDesc clearLibraryDesc; do test "$(grep -rl "settings.$k" src/lib/i18n/*.ts | grep -v test | wc -l | tr -d ' ')" = "15" || { echo "FAIL $k not in 15 locales"; exit 1; }; done && test "$(grep -c "Desc')}" "src/routes/(app)/settings/data/+page.svelte")" = "5" && test "$(grep -c "settings\.[a-zA-Z]*Desc" src/lib/i18n/en.ts)" = "22" && pnpm check</automated>
  </verify>
  <done>Parity test GREEN; each of the 5 keys appears in exactly 15 locale files; data/+page.svelte renders 5 new `.hint` helper lines (clearCoverCacheHint untouched); all 22 `settings.*Desc` keys present in en.ts; `pnpm check` reports 0 errors; committed atomically as `feat(quick-260630-fce-05): data settings helper text`.</done>
</task>

</tasks>

<verification>
- `npx vitest --run src/lib/i18n/i18n.test.ts` GREEN after EACH task (parity never broken mid-stream).
- `pnpm check` reports 0 errors after Task 5 (final, whole project).
- All 22 `settings.*Desc` keys exist in every one of the 15 locale files (no blanks).
- Exactly 22 new helper `<p>` lines rendered (4 General + 7 Appearance + 5 Home + 1 Playback + 5 Data), each using that page's existing `.muted` / `.note` / `.hint` class.
- No existing key, control, handler, or copy changed; Translation/Last.fm/About/settings-index untouched.
- 5 atomic commits, one per page.
</verification>

<success_criteria>
- Every previously-unexplained settings control shows a detailed helper line beneath it (a sentence: what it does + when/why to change it).
- i18n key-parity test is GREEN at every commit and at the end.
- `pnpm check` passes with 0 errors.
- Quote style and helper class match each file/page's existing convention; no new CSS classes, no restyle, no behavior change.
</success_criteria>

<output>
Create `.planning/quick/260630-fce-add-detailed-helper-text-under-unexplain/260630-fce-SUMMARY.md` when done.
</output>
