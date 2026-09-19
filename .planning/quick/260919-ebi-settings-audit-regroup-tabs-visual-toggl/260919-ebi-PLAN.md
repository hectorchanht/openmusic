---
phase: quick-260919-ebi
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [F1, F2, F3]
files_modified:
  - src/routes/(app)/settings/general/+page.svelte
  - src/routes/(app)/settings/appearance/+page.svelte
  - src/routes/(app)/settings/home/+page.svelte
  - src/routes/(app)/settings/playback/+page.svelte
  - src/routes/(app)/settings/translation/+page.svelte
  - src/routes/(app)/settings/data/+page.svelte
  - src/routes/(app)/settings/+page.svelte
  - src/lib/stores/settings.svelte.ts
  - src/lib/stores/settings.svelte.test.ts
  - src/lib/components/SettingToggle.svelte
  - src/lib/components/SettingRow.svelte
  - src/lib/components/SettingPicker.svelte
  - src/lib/components/settings-ui.test.ts
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
  - src/lib/i18n/i18n.test.ts

must_haves:
  truths:
    - "Theme, accent colour and reduce-motion are found on Settings → Appearance, not Settings → General"
    - "Home grid columns is found on Settings → Home, not Settings → Appearance"
    - "'Reset this group' on a settings page resets exactly the settings that page displays — no more, no less"
    - "A boolean toggle row and a row that opens a sub-page or picker are distinguishable at a glance without reading the label"
    - "Toggle rows and navigation rows come from one shared component pair; no settings page declares its own .row-toggle / .sw / .item CSS"
    - "Theme, auto-expand, quality tag, Nowbar lyrics, lyrics translate mode, Home search pill, Home randomize and Home tile density are each picked by tapping one of two or three live mini previews rendered by the app"
    - "Every preview is CSS/SVG only — no image file, no network request, correct in both dark and light theme"
    - "Every preview option is a real <button> with an accessible name and aria-pressed state"
    - "Reduce motion, share-title, quality, source, up-next and landing-tab settings keep prose — no preview claims to show a difference it cannot show"
    - "No i18n key orphaned by this task survives in any of the 15 dictionaries"
    - "No setting's behaviour changed — only where it lives, how the row looks, and how it is picked"
  artifacts:
    - path: "src/lib/components/SettingToggle.svelte"
      provides: "The one boolean-toggle settings row (role=switch)"
    - path: "src/lib/components/SettingRow.svelte"
      provides: "The one navigation/action settings row (chevron + optional value badge)"
    - path: "src/lib/components/SettingPicker.svelte"
      provides: "The one N-option settings picker — seg variant (labels) and preview variant (live mini mockups)"
    - path: "src/lib/components/settings-ui.test.ts"
      provides: "Structural gate: no page re-declares the shared row CSS; every settings page uses the shared components"
  key_links:
    - from: "src/routes/(app)/settings/appearance/+page.svelte"
      to: "src/lib/components/SettingPicker.svelte"
      via: "import + preview snippets for theme"
      pattern: "SettingPicker"
    - from: "src/lib/stores/settings.svelte.ts"
      to: "resetAppearance/resetGeneral/resetHome"
      via: "reset-group membership follows the moved rows"
      pattern: "this\\.theme = d\\.theme"
---

<objective>
Audit every setting the app exposes, move the four that are filed under the wrong heading, replace
per-page row boilerplate with one shared component pair that makes a toggle and a config row look
different at a glance, and turn eight visually-consequential settings into live side-by-side mini
previews the user taps to pick.

Purpose: settings have accumulated across ~37 phases. Dark mode lives on a page called "General"
while a page called "Appearance" holds only font sizes; a toggle row and a navigate-to-sub-page row
are byte-identical boxes; and the difference a toggle makes is explained in a paragraph the user has
to read and believe. All three are findability problems, not feature gaps.

Output: 4 row moves, 3 shared components, 8 live previews, ~7 dead prose keys deleted from all 15
dictionaries, and duplicated row CSS removed from 6 pages.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md

Pages in scope (read before editing — each carries load-bearing decision comments):
@src/routes/(app)/settings/+page.svelte
@src/routes/(app)/settings/general/+page.svelte
@src/routes/(app)/settings/appearance/+page.svelte
@src/routes/(app)/settings/home/+page.svelte
@src/routes/(app)/settings/playback/+page.svelte
@src/routes/(app)/settings/translation/+page.svelte
@src/routes/(app)/settings/data/+page.svelte
@src/lib/stores/settings.svelte.ts

<inventory>
<!-- The F1 audit. Every setting the app exposes, where it lives today, where it belongs.
     Compiled 2026-09-19 by reading all 11 settings routes + settings.svelte.ts. -->

| Setting (store field) | Current home | Proposed home | Verdict |
|---|---|---|---|
| `appLang` | General | General | stays |
| `theme` | General | **Appearance** | **MOVE** — a page literally named Appearance does not contain dark/light |
| `accent` | General | **Appearance** | **MOVE** — same reason; it is the app's highlight colour |
| `reduceMotion` | General | **Appearance** | **MOVE** — visual/motion, not "general" |
| `shareIncludeTitle` | General | General | stays — no Sharing page exists and one row does not justify inventing a section |
| `fontScaleTitle/Artist/Lyrics/NpTitle/NpArtist` | Appearance | Appearance | stays (already have live demos, quick-260618-goe) |
| `coverScale` | Appearance | Appearance | stays (already has a live demo) |
| `homeGridCols` | Appearance | **Home** | **MOVE** — the label is literally "Home grid columns" and Home already owns shelf size + tile density |
| `homeSectionOrder` / `homeHidden` / `homeSectionDensity` | Home | Home | stays |
| `homeTags` / `homeCountries` / `homeShelfSize` | Home | Home | stays |
| `homeLandingTab` / `homeDensity` | Home | Home | stays |
| `homeShowSearchPill` / `homeShowRandomize` | Home | Home | stays |
| `zhScript` | Translation | Translation | stays |
| `translateMode` | Translation | Translation | stays |
| `lyricsHideParenTranslation` / `lyricsHideParenLines` | Translation | Translation | stays |
| `lyricsLang`+`lyricsSkip` / `artistLang`+`artistSkip` / `titleLang`+`titleSkip` / `bioLang` | Translation | Translation | stays |
| `defaultQuality` | Playback | Playback | stays |
| `downloadQuality` | Playback | Playback | **considered, kept** — it reads as a Downloads setting, but its whole value is sitting beside `defaultQuality` as an identical control so a user can compare stream-vs-download quality. Splitting them across pages is worse than the misfiling |
| `defaultSource` / `enabledSources` | Playback | Playback | stays |
| `autoExpandOnPlay` / `showQualityTag` / `nowbarLyrics` | Playback | Playback | stays |
| `upnextMode` / `upnextPerContext` | Playback | Playback | stays |
| device-import rules (`deviceImport` store) / retag / excluded list | Downloads | Downloads | stays |
| library counts, clear-cache actions, `resetAppearance` action, clear library | Data | Data | stays |
| activity log copy/upload/clear | Activity | Activity | stays |
| `lastfmLang` / `lastfmSkip` (store fields) | **nowhere** | nowhere | **FINDING, no action** — both fields exist in the store and in `resetTranslation()` but no page renders a control for them. Not dead (`bioLang` superseded them), not removable without touching persistence. Reported, not fixed |
| `/settings/lastfm` route | orphan | orphan | **FINDING, no action** — the index row is commented out so the page is unreachable except by URL. It is a documented placeholder for the scheduled v1.1 Last.fm phase; deleting the route + its 5 `lastfm.*` keys ×15 only to re-add them is churn. Left as-is deliberately |

**Net: four row moves. No new top-level section.** Everything else is already where it belongs —
the accumulation problem turned out to be concentrated in one place: General and Appearance were
never separated when Appearance was added.
</inventory>

<preview_decisions>
<!-- The F3 call, made not asked. Conservative: a preview that does not actually show the
     difference is worse than the sentence it replaces. -->

**Gets a live preview — and the preview IS the control (the old switch/segment is removed):**

| Setting | Page | Why the preview is honest |
|---|---|---|
| `theme` | Appearance | Two mini app-chrome cards painted in the two real palettes. As exact as it gets |
| `autoExpandOnPlay` | Playback | Phone-frame mock: docked mini bar vs full-screen now-playing sheet |
| `showQualityTag` | Playback | A title line with and without the FLAC badge. Literally the difference |
| `nowbarLyrics` | Playback | Mini bar showing the artist name vs showing a lyric line |
| `translateMode` | Translation | One lyric line replaced by its translation vs two stacked lines |
| `homeShowSearchPill` | Home | Home header mock with and without the pill |
| `homeShowRandomize` | Home | Same header mock, Randomize button present and absent |
| `homeDensity` | Home | Three tiny layout mockups — the setting *is* a layout shape |

**Keeps prose — a preview would lie or add nothing:**

| Setting | Why not |
|---|---|
| `reduceMotion` | The difference is motion over time. A still preview cannot show it; an animated one must disable itself under `prefers-reduced-motion`, i.e. go blank for exactly the users who need this setting |
| `shareIncludeTitle` | The difference is the content of a shared string, not app UI. A mock chat bubble is a drawing of someone else's app |
| `defaultQuality` / `downloadQuality` / `defaultSource` / `enabledSources` | Network and behaviour. Nothing to see |
| `upnextPerContext` | Behaviour — where the next song comes from. The two existing icons already carry it |
| `homeLandingTab` | Three tab labels with one ringed adds nothing over the three tab labels |
| `appLang` / `zhScript` / per-part target languages | The option label is the endonym — the pill already *is* the preview |
| `accent` | The swatches are already the preview |
| font scales / `coverScale` / `homeGridCols` | Already have live demos (quick-260618-goe). Reused verbatim, not rebuilt |
| `homeSectionDensity` (per-row) | Same enum as `homeDensity`, but rendered inside a 44px drag row — no space for three mockups. Icons stay; the global preview above teaches the vocabulary |
| `lyricsHideParenTranslation` / `lyricsHideParenLines` | Borderline. A before/after lyric pair would work, but it needs a representative bilingual sample line, and choosing that line is itself a translation problem. Prose stays this pass |
| import `stripTrackNo` / `stripBrackets` | Filename transforms — previewable in principle, but they sit inside a collapsed `<details>` on a native-only page. Out of scope |

**Prose vs label:** the row/section LABEL always stays (it is the accessible name); only the
`<p class="muted">` description is deleted. For a previewed boolean the two options carry
`aria-label` "Off" / "On" and `aria-pressed`.
</preview_decisions>

<interfaces>
<!-- Contracts the executor must build against. Do not go exploring for these. -->

Existing settings store (`src/lib/stores/settings.svelte.ts`) — LEAF, imports nothing from
player/library. Relevant reset groups today:
- `resetGeneral()` restores `appLang, accent, reduceMotion, shareIncludeTitle, theme`
- `resetAppearance()` restores the five `fontScale*`, `coverScale`, `homeGridCols`
- `resetHome()` restores the ten `home*` fields
- `resetPlayback()`, `resetTranslation()` — untouched by this plan

Existing per-page CSS idiom, duplicated across general / playback / home / translation / downloads
(this is what the shared components replace):
- `.row-toggle` — flex row, `var(--color-surface-2)`, 1px `var(--color-border)`, radius 12, padding 13/14
- `.sw` — 40x22 pill, `::after` 18px knob, `.on` fills `var(--color-primary)` and translates 18px
- `.seg` — inline-flex pill group, radius 999, 3px padding; `.seg button.on` fills `var(--color-primary)`
- `.item` — used on `/settings` index and `/settings/data`, visually IDENTICAL to `.row-toggle`. This
  identity is the F2 defect
- `.density-seg` / `.dseg-btn` on `/settings/home` is the app's existing `role="group"` +
  `aria-pressed` picker pattern. Copy its a11y vocabulary — do not invent a radiogroup

Theme tokens available (already used by every page above): `--color-bg`, `--color-surface`,
`--color-surface-2`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-primary`,
`--radius-md`, `--radius-sm`.

i18n: flat string keys, 15 dictionaries in `src/lib/i18n/*.ts`, DOUBLE quotes for key AND value.
`src/lib/i18n/i18n.test.ts` enforces identical key sets across all 15 via `readFileSync`/`dicts`.
Existing reusable keys: `settings.preview` ("Preview"), `settings.optOff` ("Off"). There is NO
`settings.optOn` — it must be added.

Vitest: ONE node/server project, NO jsdom. Svelte components cannot be rendered in a test. Structural
assertions must read source files with `readFileSync` (the pattern `i18n.test.ts` already uses).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Regroup the four misfiled settings, and make reset groups follow their rows</name>
  <files>
    src/routes/(app)/settings/general/+page.svelte,
    src/routes/(app)/settings/appearance/+page.svelte,
    src/routes/(app)/settings/home/+page.svelte,
    src/routes/(app)/settings/data/+page.svelte,
    src/lib/stores/settings.svelte.ts,
    src/lib/stores/settings.svelte.test.ts,
    src/lib/i18n/*.ts (all 15)
  </files>
  <action>
Move exactly four rows, per the `<inventory>` table. Move markup, handler function, icon import and
any section `<h2>` together; do not restyle anything in this task.

1. `theme` segmented control + `accent` swatch row + `reduceMotion` toggle row: General → Appearance.
   Place them ABOVE the existing "Text size" section — theme and accent frame everything below them.
   `reduceMotion` needs a heading: General currently borrows `settings.playbackMotion`
   ("Playback & motion"), which is wrong on Appearance. Add ONE new key `settings.appearanceMotion`
   ("Motion") to all 15 dictionaries.
2. `homeGridCols` slider + its live grid demo + `settings.gridColumns`/`gridColumnsDesc` copy:
   Appearance → Home. Place it directly after the "Items per shelf" slider — both are shelf/grid
   sizing. Carry the `GRID_COLS_MIN`/`GRID_COLS_MAX` imports across.
3. Reset-group membership follows the rows, so "Reset this group" keeps meaning "reset what this
   page shows". In `settings.svelte.ts`: move `theme`, `accent`, `reduceMotion` assignments from
   `resetGeneral()` into `resetAppearance()`; move `homeGridCols` from `resetAppearance()` into
   `resetHome()`. The fields stay in their existing `GENERAL_DEFAULTS` / `APPEARANCE_DEFAULTS`
   constants — do NOT rename or move anything in `src/lib/config/defaults.ts`, and do not touch
   `load()`/`save()`. Only which reset() touches which field changes.
4. Consequence to follow through: `/settings/data` has a "Reset appearance sizes" button calling
   `settings.resetAppearance()`, which now also restores theme/accent/reduce-motion. Update
   `settings.resetAppearance` and `settings.resetAppearanceDesc` in all 15 dictionaries to say so.
5. Update the two now-wrong index subtitles in all 15 dictionaries: `settings.groupGeneralDesc`
   (currently "Language, accent, motion") and `settings.groupAppearanceDesc` (currently "Text size,
   cover size & layout"). `settings.groupHomeDesc` still reads true — leave it.

Tag each moved block with a `quick-260919-ebi` comment naming WHY it moved (one line, e.g.
"quick-260919-ebi: theme/accent/motion moved General → Appearance — a page named Appearance that
did not contain dark mode was the single worst findability bug in Settings").

Do not change what any setting does. No new sections, no renamed routes.

NOTE for the executor: `appearance/+page.svelte` is formatted with SPACES and double quotes (it was
prettier'd at some point) while every other settings page uses TABS and single quotes. Match the
file you are editing — do not reformat either file in this task.
  </action>
  <verify>
    <automated>pnpm vitest run src/lib/stores/settings.svelte.test.ts src/lib/i18n/i18n.test.ts && pnpm check</automated>
  </verify>
  <done>
`/settings/appearance` shows Theme, Accent colour, Motion, Text size, Covers & layout.
`/settings/general` shows App language and Share title only.
`/settings/home` shows Home grid columns after Items per shelf.
New assertions in `settings.svelte.test.ts`: `resetAppearance()` restores theme/accent/reduceMotion
and does NOT touch homeGridCols; `resetGeneral()` does NOT touch theme/accent/reduceMotion;
`resetHome()` restores homeGridCols. `settings.appearanceMotion` present in all 15 dicts.
  </done>
</task>

<task type="auto">
  <name>Task 2: One shared row pair — SettingToggle vs SettingRow — and delete the per-page copies</name>
  <files>
    src/lib/components/SettingToggle.svelte,
    src/lib/components/SettingRow.svelte,
    src/lib/components/settings-ui.test.ts,
    src/routes/(app)/settings/+page.svelte,
    src/routes/(app)/settings/general/+page.svelte,
    src/routes/(app)/settings/home/+page.svelte,
    src/routes/(app)/settings/playback/+page.svelte,
    src/routes/(app)/settings/translation/+page.svelte,
    src/routes/(app)/settings/data/+page.svelte
  </files>
  <action>
Today `.row-toggle` (a boolean) and `.item` (navigates to a sub-page / runs an action) are the same
box: surface-2 fill, 1px border, radius 12, same padding. That identity is the bug. Build the pair
that separates them, once.

`SettingToggle.svelte` — props `{ label, icon?, checked, onchange, disabled? }`.
  - Renders a `<button role="switch" aria-checked={checked}>` (most current call sites expose NO
    state to assistive tech at all — this is a free correctness fix, not a nicety).
  - Visual identity of the TOGGLE kind: flat/inset surface (`var(--color-bg)` inside a
    `var(--color-border)` hairline), NO chevron, the 40x22 switch pill on the right, and a 3px
    left edge in `var(--color-primary)` when on. Carry the existing `.sw` geometry verbatim so
    nothing visibly jumps.
  - `use:tapBounce`.

`SettingRow.svelte` — props `{ label, icon?, desc?, value?, onclick, danger?, disabled? }`.
  - Renders a `<button>` with: icon, label (+ optional second-line `desc`), an optional right-aligned
    `value` badge in `var(--color-primary)` showing the current choice, and ALWAYS a `ChevronRight`.
  - Visual identity of the CONFIG kind: raised surface (`var(--color-surface-2)`), no left edge,
    chevron always present. `danger` tints the label with the existing danger colour used on
    `/settings/data`.
  - `use:tapBounce`.

The at-a-glance rule to hold: **inset + switch + accent edge = a boolean you flip here. Raised +
chevron + value badge = something that leads somewhere.** State that rule as a comment at the top of
both components, tagged `quick-260919-ebi`.

Adopt them and DELETE the now-dead local `.row-toggle` / `.sw` / `.item` CSS from every page listed
in `<files>`. Specifically: `/settings` index rows and `/settings/data` action rows become
`SettingRow`; `settings.shareIncludeTitle` (General), `homeShowSearchPill`/`homeShowRandomize` (Home
— see below), `autoExpandOnPlay`/`showQualityTag`/`nowbarLyrics` (Playback — see below),
`lyricsHideParenTranslation`/`lyricsHideParenLines` (Translation) become `SettingToggle`.

**Deliberately NOT adopted here:** the eight rows listed in `<preview_decisions>` as getting a live
preview. Tasks 3-5 replace those controls entirely, so converting them to `SettingToggle` first is
churn. Convert `reduceMotion`, `shareIncludeTitle` and the two `lyricsHideParen*` toggles (which keep
prose) and leave the preview-bound eight alone until their task.

**Out of scope, deliberately:** `/settings/downloads` and the `.chip` idiom. Downloads' toggles drive
the `deviceImport` store inside a collapsed `<details>` on a native-only page, and chips are
multi-select in half their call sites. Both are a separate pass — note this in the summary rather
than half-converting them.

Write `src/lib/components/settings-ui.test.ts`: read each settings route file with `readFileSync`
and assert (a) no file in `src/routes/(app)/settings/**` except downloads declares a `.row-toggle {`
or `.sw {` or `.item {` CSS rule, (b) each converted page imports the component it uses. Strip
comment lines before counting (`grep -v '^\s*//'`-equivalent) so a comment mentioning `.row-toggle`
cannot self-invalidate the gate.
  </action>
  <verify>
    <automated>pnpm vitest run src/lib/components/settings-ui.test.ts && pnpm check</automated>
  </verify>
  <done>
`SettingToggle.svelte` and `SettingRow.svelte` exist and are the only definitions of the two row
kinds. Zero `.row-toggle`/`.sw`/`.item` CSS rules remain in the six edited pages. Every toggle
exposes `role="switch"` + `aria-checked`. `settings-ui.test.ts` passes. `pnpm check` clean.
  </done>
</task>

<task type="auto">
  <name>Task 3: SettingPicker — one picker for segments AND live previews; first consumer is Theme</name>
  <files>
    src/lib/components/SettingPicker.svelte,
    src/routes/(app)/settings/appearance/+page.svelte,
    src/lib/components/settings-ui.test.ts,
    src/lib/i18n/*.ts (all 15)
  </files>
  <action>
One component covers both the existing labelled segmented control and the new preview picker — a
second segmented-control implementation would be a defect.

`SettingPicker.svelte` — props `{ options, value, onpick, label, variant?: 'seg' | 'preview' }`
where `options: { v: string; label: string; preview?: Snippet }[]`.
  - `variant='seg'` (default): renders exactly today's `.seg` pill row — inline-flex, radius 999,
    3px padding, active option filled `var(--color-primary)`. Lift the CSS verbatim from
    `translation/+page.svelte` so the Chinese-script control (quick-260919-2jo) is pixel-identical
    when it later adopts this.
  - `variant='preview'`: renders each option as a card in a responsive row — the option's `preview`
    snippet on top, a short caption below, the whole card a `<button>`. The selected card carries a
    2px `var(--color-primary)` ring.
  - A11y in BOTH variants: wrapper `role="group"` with `aria-label={label}`; each option a real
    `<button>` with `aria-pressed={value === v}` and `aria-label={option.label}`. Copy this exact
    vocabulary from the existing `.density-seg`/`.dseg-btn` on `/settings/home` — do not invent a
    roving-tabindex radiogroup. Real buttons are Tab-reachable and Enter/Space-operable, which is
    the keyboard requirement.
  - `use:tapBounce` per option.

Mini-mock primitives live INSIDE `SettingPicker.svelte` as exported CSS classes on a wrapper
(`.mock`, `.mock-bar`, `.mock-line`, `.mock-tile`, `.mock-badge`, `.mock-chrome`) so every preview in
tasks 4-5 draws from the same box of parts. Rules, stated as a comment tagged `quick-260919-ebi`:
  - CSS/SVG only. No `<img>`, no `background-image: url(...)`, no network.
  - Every colour is a theme token (`--color-bg`, `--color-surface`, `--color-surface-2`,
    `--color-border`, `--color-text`, `--color-text-muted`, `--color-primary`) so dark and light are
    both correct with no per-theme branch. The ONE exception is the Theme preview below.
  - Any transition is wrapped in `@media (prefers-reduced-motion: no-preference)`.
  - Mocks are `aria-hidden="true"`; the option button's `aria-label` is the accessible name.

First consumer: **Theme** on `/settings/appearance`. Replace the `.seg` Dark/Light control with
`variant='preview'` and two cards. Each card is a mini app-chrome mock — header bar, two content
lines, a mini now-bar — painted in LITERAL palette values, not tokens: the dark card must look dark
while the light theme is active and vice versa, which is the entire point. Source those literals from
the real theme definitions rather than eyeballing them (look at `applyTheme()` in
`settings.svelte.ts` and the `:root`/`[data-theme]` blocks it drives). Comment the literal-colour
exception with `quick-260919-ebi`.

Delete `settings.themeDesc` from all 15 dictionaries — the two cards replace that paragraph. Keep the
`settings.theme` heading (it is the group's accessible name). Captions reuse the existing
`settings.themeDark` / `settings.themeLight` keys.

Extend `settings-ui.test.ts`: assert `SettingPicker.svelte` contains no `<img` and no
`url(` in its styles, and that `settings.themeDesc` is absent from all 15 dictionaries.
  </action>
  <verify>
    <automated>pnpm vitest run src/lib/components/settings-ui.test.ts src/lib/i18n/i18n.test.ts && pnpm check</automated>
  </verify>
  <done>
Settings → Appearance picks the theme by tapping one of two mini app mockups; the dark card renders
dark and the light card renders light regardless of the active theme; the prose under it is gone; the
selected card is ringed and announces its label + pressed state. `settings.themeDesc` gone from all 15.
  </done>
</task>

<task type="auto">
  <name>Task 4: Playback previews — auto-expand, quality tag, Nowbar lyrics</name>
  <files>
    src/routes/(app)/settings/playback/+page.svelte,
    src/lib/i18n/*.ts (all 15)
  </files>
  <action>
Replace three `SettingToggle`-shaped rows on `/settings/playback` with `SettingPicker`
`variant='preview'`, two options each (Off / On), built from the task-3 mock primitives:

- `autoExpandOnPlay` — two phone-frame mocks. Off: a content page with the docked mini bar at the
  bottom. On: the full-screen now-playing sheet (cover block + title lines + transport row).
- `showQualityTag` — two title lines, identical except the On one carries a `FLAC` badge
  (`.mock-badge`). Use the literal token `FLAC` — it is a format name, not chrome, so no i18n key.
- `nowbarLyrics` — two mini-bar mocks: Off shows a title line + a muted artist line, On shows a title
  line + a muted lyric line. Use short LITERAL placeholder text drawn from the same static fallback
  the Appearance demos already use (`Stargazing` / `Myles Smith`) so nothing needs translating; add a
  generic `♪ ————` style lyric stand-in rather than inventing a lyric string.

Option captions reuse `settings.optOff` and a new `settings.optOn` ("On") — add `settings.optOn` to
all 15 dictionaries. Each picker's `label` prop is the existing row label key
(`settings.autoExpand`, `settings.showQualityTag`, `settings.nowbarLyrics`), which stays as the
group's accessible name and visible label.

Delete from all 15 dictionaries: `settings.autoExpandDesc`, `settings.showQualityTagDesc`,
`settings.nowbarLyricsDesc`.

While in this file, convert the remaining labelled `.seg` controls (`defaultQuality`,
`downloadQuality`) and the `upnext` per-context two-icon segments to `SettingPicker variant='seg'`,
and delete the local `.seg` / `.upnext-row .seg` CSS. Leave `.chip` (defaultSource, advanced sources)
alone. Do NOT add previews to quality, source or up-next — see `<preview_decisions>`; those are
network and behaviour settings and a mockup would be a lie.

Tag each preview with a `quick-260919-ebi` comment naming what the two states show.
  </action>
  <verify>
    <automated>pnpm vitest run src/lib/i18n/i18n.test.ts src/lib/components/settings-ui.test.ts && pnpm check</automated>
  </verify>
  <done>
Settings → Playback picks auto-expand, quality tag and Nowbar lyrics by tapping a mockup. Their three
description paragraphs are gone from all 15 dictionaries. `settings.optOn` present in all 15. No
local `.seg` CSS remains in the file. Quality/source/up-next still use labels and prose.
  </done>
</task>

<task type="auto">
  <name>Task 5: Home + Translation previews — search pill, randomize, tile density, translate mode</name>
  <files>
    src/routes/(app)/settings/home/+page.svelte,
    src/routes/(app)/settings/translation/+page.svelte,
    src/lib/i18n/*.ts (all 15)
  </files>
  <action>
`/settings/home` — three preview pickers from the task-3 mock primitives:
- `homeShowSearchPill` — one Home-header mock, rendered twice: without and with the rounded search
  pill. Off/On captions.
- `homeShowRandomize` — the same header mock without and with a Randomize button chip.
- `homeDensity` — THREE options, the first `variant='preview'` picker with more than two: `list`
  (three stacked rows with a small leading square), `pile` (a horizontal cover shelf, one tile
  half-cut at the edge), `grid` (a 3x2 tile grid). Captions reuse the existing `settings.densityList`
  / `densityPile` / `densityGrid` keys.

Leave the per-section `.density-seg` inside the drag-reorder rows exactly as it is — a 44px row has
no space for three mockups, and the global preview directly teaches the same three-icon vocabulary.
Say so in a `quick-260919-ebi` comment there.

`/settings/translation` — one preview picker:
- `translateMode` replace/below — Replace: a single lyric line shown as its translation. Below: the
  original line with the translated line stacked under it in muted text. Use LITERAL neutral sample
  text (e.g. an original line rendered as `••• •••` blocks and the translation as `— — —` blocks)
  rather than a real bilingual pair — picking the sample language is itself a translation problem and
  would need 15 versions. Comment that choice with `quick-260919-ebi`.
- Keep the existing disabled state: when `lyricsLang === 'off'` the picker is disabled and
  `settings.translateModeOffNote` still renders. That note explains a DISABLED control, which a
  preview cannot do — it is not the prose being replaced.
- Convert the `zhScript` control to `SettingPicker variant='seg'` (no preview — the endonym labels
  繁體中文/简体中文 already are the difference) and delete the local `.seg` CSS.

Delete from all 15 dictionaries: `settings.showSearchPillDesc`, `settings.showRandomizeDesc`,
`settings.tileDensityDesc`, `settings.translateModeOnNote`. **Keep** `settings.translateModeOffNote`.

Also delete the local `.seg` / `.row-toggle` / `.sw` CSS left in both pages.
  </action>
  <verify>
    <automated>pnpm vitest run src/lib/i18n/i18n.test.ts src/lib/components/settings-ui.test.ts && pnpm check</automated>
  </verify>
  <done>
Settings → Home picks search pill, randomize and tile density by tapping mockups; Settings →
Translation picks replace-vs-below by tapping mockups. Four description keys gone from all 15
dictionaries, `translateModeOffNote` retained. No local `.seg`/`.row-toggle`/`.sw` CSS remains in
either page.
  </done>
</task>

<task type="auto">
  <name>Task 6: Dead-string sweep, full gates, and the eyes-on check</name>
  <files>
    src/lib/i18n/i18n.test.ts,
    src/lib/i18n/*.ts (all 15)
  </files>
  <action>
The i18n parity test only proves the 15 dictionaries AGREE — it stays green while all 15 carry the
same dead string. Close that hole for the strings this task orphaned.

Add one `describe('quick-260919-ebi dead strings')` block to `i18n.test.ts` asserting, for every one
of the 15 dicts:
- ABSENT: `settings.themeDesc`, `settings.autoExpandDesc`, `settings.showQualityTagDesc`,
  `settings.nowbarLyricsDesc`, `settings.showSearchPillDesc`, `settings.showRandomizeDesc`,
  `settings.tileDensityDesc`, `settings.translateModeOnNote`
- PRESENT and non-blank: `settings.optOn`, `settings.appearanceMotion`,
  `settings.translateModeOffNote`

Then sweep for anything tasks 1-5 missed: for each `settings.*` key deleted or added, confirm no
source file still references it (`grep -rn "settings.themeDesc" src` and friends must return
nothing), and confirm no dictionary gained a key the others lack.

Run the full gates: `pnpm check` and `pnpm test`. Both must be green. Do not push to origin.
  </action>
  <verify>
    <automated>pnpm check && pnpm test</automated>
    <human-check>
On a phone (or a narrow browser window), walk Settings top to bottom:
1. Toggle rows and chevron rows are tellable apart without reading — inset + switch vs raised + chevron.
2. Appearance → Theme: the Dark card looks dark and the Light card looks light, in BOTH themes. Tap
   each; the app switches.
3. With the OS set to Reduce Motion, no preview animates and none is blank.
4. Every preview reads correctly in light theme — no white-on-white, no invisible border.
5. Tab through one preview group with a keyboard: each option is focusable and Enter picks it.
Report anything that looks wrong; nothing here blocks the commit.
    </human-check>
  </verify>
  <done>
`pnpm check` and `pnpm test` both green. The dead-string block in `i18n.test.ts` passes. No source
file references a deleted key. Nothing pushed to origin.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| none new | This task moves, restyles and re-presents existing client-side settings. No new input crosses a boundary, no new route, no new network call, no secret touched |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ebi-01 | Information disclosure | `SettingPicker` preview mocks | mitigate | Previews are CSS/SVG only. Task 3 adds a test asserting the component contains no `<img` and no `url(` — a preview that fetched a remote asset would leak a request (and break offline + the CSP posture) for cosmetics |
| T-ebi-02 | Tampering | `settings.svelte.ts` reset groups | mitigate | Reset-group membership changes in task 1 are pinned by explicit assertions in `settings.svelte.test.ts` — a later edit that drops a field from a reset group fails CI instead of silently leaving a setting unresettable (the exact failure `resetGeneral`'s own comment records for `shareIncludeTitle`) |
| T-ebi-03 | Denial of service | `prefers-reduced-motion` users | accept | Previews are static by default; any transition is opt-in behind `@media (prefers-reduced-motion: no-preference)`. Verified by eye in task 6 rather than automated — no jsdom exists to assert rendered CSS |
| T-ebi-SC | Tampering | npm/pip/cargo installs | n/a | No new dependencies. No package-manager install task exists in this plan |
</threat_model>

<verification>
- `pnpm check` clean (svelte-check is the project's only quality gate).
- `pnpm test` green, including the 15-locale key-set parity test and the new dead-string block.
- `src/lib/components/settings-ui.test.ts` proves no settings page re-declares the shared row CSS.
- `src/lib/stores/settings.svelte.test.ts` proves each reset group matches the rows its page shows.
- Four rows moved, zero settings changed in behaviour, zero new top-level sections.
</verification>

<success_criteria>
- Theme / accent / reduce-motion live on Appearance; Home grid columns lives on Home.
- Each settings page's "Reset this group" resets exactly what that page displays.
- One `SettingToggle` + one `SettingRow` definition in the repo; six pages lost their copies.
- One `SettingPicker` serves both labelled segments and preview pickers — no second segmented control.
- Eight settings are picked by tapping a live mini preview; the settings named in
  `<preview_decisions>` as non-visual still explain themselves in prose.
- No image asset added. No npm dependency added. Nothing pushed to origin.
- Every key orphaned by this task is gone from all 15 dictionaries, proven by a test.
</success_criteria>

<output>
Create `.planning/quick/260919-ebi-settings-audit-regroup-tabs-visual-toggl/260919-ebi-SUMMARY.md` when done.
</output>
