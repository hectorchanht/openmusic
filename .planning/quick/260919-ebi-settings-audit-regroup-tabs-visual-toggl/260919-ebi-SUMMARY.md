---
phase: quick-260919-ebi
plan: 01
subsystem: settings-ui
tags: [settings, i18n, a11y, components, svelte5]
requires: []
provides:
  - SettingToggle.svelte — the one boolean settings row (role=switch)
  - SettingRow.svelte — the one navigation/action settings row (chevron + value badge)
  - SettingPicker.svelte — the one N-option picker (seg + live-preview variants) + .mock-* primitives
  - SettingHint.svelte — the one description disclosure (tap / hover / focus, clipped not removed)
affects:
  - all 7 in-scope settings routes
  - all 15 i18n dictionaries
tech-stack:
  added: []
  patterns:
    - "preview-as-control: the mockup IS the radio option, not an illustration beside it"
    - ":global() mock primitives under a component-owned wrapper, so a caller's snippet needs no CSS"
    - "structural source-reading gates (no jsdom in this project)"
key-files:
  created:
    - src/lib/components/SettingToggle.svelte
    - src/lib/components/SettingRow.svelte
    - src/lib/components/SettingPicker.svelte
    - src/lib/components/SettingHint.svelte
    - src/lib/components/settings-ui.test.ts
  modified:
    - src/routes/(app)/settings/{,general/,appearance/,home/,playback/,translation/,data/}+page.svelte
    - src/lib/stores/settings.svelte.ts
    - src/lib/stores/settings.svelte.test.ts
    - src/lib/i18n/*.ts (15 dictionaries) + i18n.test.ts
metrics:
  tasks: 6
  commits: 7
  completed: 2026-09-19
---

# quick-260919-ebi: Settings audit, regroup, shared rows, live previews — Summary

Four misfiled settings moved to the page their name promises, the two settings-row kinds stopped
looking identical, eight visually-consequential settings became live mini mockups you tap, and every
remaining explanation moved off-screen behind a tap/hover/focus disclosure.

## Commits

| Commit | What |
|---|---|
| `d1b4e6d` | F1 — four row moves; reset groups follow them |
| `ff751bf` | F2 — `SettingToggle` vs `SettingRow`; six pages lose their copies |
| `bd6635c` | F3 — `SettingPicker` (seg + preview); Theme is the first consumer |
| `b2d16c2` | F3 — Playback previews; `SettingHint` introduced |
| `cf1c456` | F3 — Home + Translation previews; prose moves behind the (i) |
| `e35aabf` | Dead-string assertions across all 15 dictionaries |
| `1 fix` | Anchor the collapsed hint so it cannot add a stray scrollbar |

Nothing pushed. 58 commits sit unpushed on `main`, as they did before this task.

---

## 1. The settings inventory — what moved, what stayed

### Moved (4 rows, no new top-level section)

| Setting | From | To | Why |
|---|---|---|---|
| `theme` | General | **Appearance** | A page literally named Appearance did not contain dark mode |
| `accent` | General | **Appearance** | Same — it is the app's highlight colour |
| `reduceMotion` | General | **Appearance** | Visual/motion, not "general" |
| `homeGridCols` | Appearance | **Home** | The label is "Home grid columns"; Home already owns shelf size + density |

`/settings/general` is now App language + Share title only. `/settings/appearance` opens with Theme,
Accent colour, Motion, then Text size and Covers & layout. `/settings/home` has Home grid columns
directly after Items per shelf, with its `quick-260618-goe` live grid demo carried across intact.

### Stayed, and the one that was argued about

Everything else was already filed correctly. `downloadQuality` was **considered and deliberately
kept** on Playback: it reads like a Downloads setting, but its whole value is sitting beside
`defaultQuality` as an identical control so stream-vs-download quality can be compared in one glance.
Splitting them across two pages is worse than the misfiling. The two now literally are the same
control — both are `SettingPicker variant='seg'` with the same options array.

### The two findings the plan flagged as NO ACTION — both re-confirmed, both untouched

1. **`lastfmLang` / `lastfmSkip` have no UI anywhere.** Both fields exist in the store, in
   `save()`/`load()`, and in `resetTranslation()`, but no page renders a control for them —
   re-verified this session: `grep -rn "lastfmLang\|lastfmSkip" src/routes/` returns **nothing**.
   They are not dead (`bioLang` superseded them) and not removable without touching persistence.
   **Reported, not fixed.**
2. **`/settings/lastfm` is an orphan route.** The index row is still commented out at
   `settings/+page.svelte:29`, so the page is unreachable except by typing the URL. It is a
   documented placeholder for the scheduled v1.1 Last.fm phase; deleting the route plus its five
   `lastfm.*` keys ×15 only to re-add them is churn. **Left as-is, deliberately.**

### Reset groups follow the moved rows — confirmed by assertion, not by eye

`resetAppearance()` now restores `theme`, `accent` and `reduceMotion` in addition to the five font
scales and cover size, so Appearance's "Reset this group" **does** reset theme/accent/motion.
`resetGeneral()` no longer touches them. `resetHome()` picked up `homeGridCols`.

`src/lib/config/defaults.ts` was **not** touched — the field values still live in
`GENERAL_DEFAULTS` / `APPEARANCE_DEFAULTS`. Only *which `reset()` touches which field* changed.

Five assertions in `settings.svelte.test.ts` pin this (T-ebi-02), including the negative ones —
`resetAppearance()` must NOT touch `homeGridCols`, `resetGeneral()` must NOT touch theme/accent/
motion. That is the exact failure `resetGeneral`'s own comment already records for
`shareIncludeTitle`: a field silently dropped from a group leaves a setting unresettable, and now
that fails CI.

Follow-through: `/settings/data`'s "Reset appearance sizes" button calls `resetAppearance()`, so it
now also restores theme/accent/motion. Its label and description were rewritten in all 15
dictionaries to say so — `settings.resetAppearance` is now "Reset appearance", not "Reset appearance
sizes".

---

## 2. F2 — a toggle row and a config row stop looking identical

The defect was that `.row-toggle` (a boolean) and `.item` (navigates somewhere) were byte-identical
boxes: same `surface-2` fill, same 1px border, same radius 12, same padding. You had to read the
label to learn what a tap would do.

**The rule, now stated as a comment at the top of both components:**

> inset + switch + accent edge = a boolean you flip HERE.
> raised + chevron + value badge = something that LEADS SOMEWHERE.

`SettingToggle` renders a real `<button role="switch" aria-checked>`. **Most of the call sites it
replaced exposed no state to assistive tech at all** — the switch pill was a decorative `<span>`
inside a plain button. That is a free correctness fix, not a nicety. The `.sw` geometry (40×22 pill,
18px knob, 18px travel) was carried over verbatim so nothing visibly jumps.

Adopted on: settings index, data, general, appearance, translation. The local `.row-toggle` / `.sw` /
`.item` / `.seg` CSS is gone from every settings page.

**Out of scope, deliberately:** `/settings/downloads` and the `.chip` idiom. Downloads' toggles drive
the `deviceImport` store inside a collapsed `<details>` on a native-only page, and chips are
multi-select in half their call sites. **I did not open `/settings/downloads` or
`src/lib/services/retag.ts` at any point**, per the brief — a concurrent agent owns them.

One deliberate exception is recorded in the gate rather than silently tolerated: `/settings/home`
keeps a single `.sw` rule for the bare section-visibility switch inside the 44px drag-reorder rows.
That is not a settings *row* — it has no label of its own and no room for one — so `SettingToggle`
does not fit.

---

## 3. F3 — which settings got a live preview, and which kept prose

`SettingPicker` covers **both** the existing labelled pill row and the new preview cards. The `seg`
CSS was lifted verbatim from `translation/+page.svelte`, so the `quick-260919-2jo` Chinese-script
control is pixel-identical after adopting it. A second segmented-control implementation would have
been the very defect this task exists to remove; a gate now asserts `.seg` has exactly one
definition in the repo.

### Got a live preview — and the preview IS the control

| Setting | Page | What the two/three cards show |
|---|---|---|
| `theme` | Appearance | Two mini app-chrome cards in the two **real** palettes |
| `autoExpandOnPlay` | Playback | Docked mini bar vs the full-screen now-playing sheet |
| `showQualityTag` | Playback | The same title line with and without the `FLAC` badge |
| `nowbarLyrics` | Playback | Mini bar: `Myles Smith` vs a `♪ ————` lyric stand-in |
| `translateMode` | Translation | One translated line vs original + translation stacked |
| `homeShowSearchPill` | Home | Home header mock, pill absent vs present |
| `homeShowRandomize` | Home | Same header mock, Randomize chip absent vs present |
| `homeDensity` | Home | Three layout mockups — list / pile (one tile half-cut) / 3×2 grid |

Two details worth keeping:

- **The Home header mock is one snippet rendered four times**, and it reads the *other* setting's
  live value. So on the search-pill picker both cards show your actual Randomize state, and only the
  pill differs. The card pair never shows you two changes at once.
- **Repeat taps are a no-op.** The preview picker hands back the *picked* state, so the handlers are
  `v === 'on'`, not `!x`. A bare flip would have turned the already-selected card straight back off —
  a real bug that the old switch shape could not have.

### Kept prose — with the reason for each call

| Setting | Why no preview |
|---|---|
| `reduceMotion` | The difference is motion over time. A still preview cannot show it, and an animated one must disable itself under `prefers-reduced-motion` — going blank for exactly the users who need this setting |
| `shareIncludeTitle` | The difference is the content of a shared string, not app UI. A mock chat bubble is a drawing of someone else's app |
| `defaultQuality` / `downloadQuality` / `defaultSource` / `enabledSources` | Network and behaviour. There is nothing to see |
| `upnextPerContext` | Behaviour — where the *next* song comes from. The two existing icons already carry it |
| `homeLandingTab` | Three tab labels with one ringed adds nothing over three tab labels |
| `appLang` / `zhScript` / per-part target languages | The option label is the endonym — the pill already *is* the preview |
| `accent` | The swatches are already the preview |
| font scales / `coverScale` / `homeGridCols` | Already have live demos (`quick-260618-goe`). Reused verbatim, not rebuilt |
| `homeSectionDensity` (per-row) | Same enum as `homeDensity`, but inside a 44px drag row — no space for three mockups. The global preview directly above teaches the vocabulary, so the icons read as shorthand for something just shown |
| `lyricsHideParenTranslation` / `lyricsHideParenLines` | A before/after lyric pair needs a representative bilingual sample line, and choosing that line is itself a translation problem |
| import `stripTrackNo` / `stripBrackets` | Filename transforms, inside a collapsed `<details>` on a native-only page. Out of scope |

### Preview constraints, all held

- **No image asset added.** No PNG, no JPG, no screenshot. Every mock is CSS plus a handful of
  inline Lucide SVG icons.
- A gate asserts `SettingPicker` contains no `<img` and no `url(` **in its code** (comments are
  stripped first — the component documents these rules, so a naive text match would have matched its
  own prose). That is T-ebi-01: a preview that fetched a remote asset would leak a request and break
  offline, for cosmetics.
- Every mock colour is a theme token, so dark and light are both correct with no per-theme branch.
  **The single exception is the Theme preview**, and it is the point: the dark card must look dark
  while the light theme is active. Those literals are the real `app.css` values
  (`:root` / `:root[data-theme='light']`), sourced from the blocks `applyTheme()` drives, and four of
  them are pinned by a test so the preview cannot quietly start lying.
- Previews are **static by default**; the only transition is the selection ring, behind
  `@media (prefers-reduced-motion: no-preference)`. A reduce-motion user gets a correct still
  preview, never a blank card (T-ebi-03).
- Every option is a real `<button>` with `aria-label` and `aria-pressed`, inside a `role="group"`
  with `aria-label`. No `<div onclick>`. Mocks are `aria-hidden`. Real buttons are Tab-reachable and
  Enter/Space-operable, which is the keyboard requirement — the a11y vocabulary was copied from the
  existing `.density-seg` on `/settings/home`, not invented.

**A11y fix picked up along the way:** the 16 per-context up-next buttons on Playback were icon-only
with **no accessible name at all**. Routing them through `SettingPicker` gives each one a real name.

---

## 4. The mid-run refinement — descriptions into a disclosure

Partway through, the instruction arrived that descriptions should be *shorter and hidden*, with the
screen captures doing the talking, so the page is clearer.

**I did not build a hover tooltip.** This app is mobile-first and hover does not exist on touch — a
hover-only tooltip puts the explanation permanently out of reach on the primary device. I looked for
an existing disclosure idiom first: there is none (the closest are native `<details>` on Playback and
Downloads, and a single `aria-describedby` on Downloads), so `SettingHint` is one new shared
component, in the same spirit as the `SettingPicker` consolidation.

- **Tap toggles it** — works everywhere. Hover and keyboard focus reveal it too, with hover gated
  behind `@media (hover: hover)` so a touch browser's emulated `:hover` cannot leave the line stuck
  open after a tap.
- **The description is in the DOM at all times.** Collapsed, it is hidden by *clipping*
  (`clip-path: inset(50%)`), never `display: none` / `visibility: hidden` / `hidden`, any of which
  would drop it out of the accessibility tree. A gate asserts all three of those are absent.
- The `(i)` button is a real `<button>` with `aria-expanded` + `aria-controls`, and its accessible
  name includes the setting's own label — otherwise a screen-reader user hears "About this setting"
  six times on one page.
- Inline reveal, not a floating bubble: a positioned overlay needs collision math and clips inside
  scrolling sections on a narrow screen.

**This changed the delete/keep call, as instructed.** The rule I applied: *delete only where the
preview is a literal depiction of the sentence; shorten and move into the tooltip where the sentence
carries something the mock cannot show* (a trigger condition, a caveat, a distinction).

| Key | Call | Reason |
|---|---|---|
| `settings.themeDesc` | **deleted** | Two cards in the two real palettes. The rest was "pick whichever is easier on your eyes" |
| `settings.nowbarLyricsDesc` | **deleted** | The sentence was "shows the current lyric line instead of the artist name" — the two mini bars say that word for word |
| `settings.showSearchPillDesc` | **deleted** | The header mock with and without the pill; the rest was advice about when to turn it off |
| `settings.autoExpandDesc` | **kept, shortened** | The mock shows the two screens; it cannot say the trigger is *every* track start |
| `settings.showQualityTagDesc` | **kept, shortened** | Carries the caveat: hidden when the source reports no quality |
| `settings.showRandomizeDesc` | **kept, shortened** | The mock shows the button appearing; it cannot show what tapping it *does* |
| `settings.tileDensityDesc` | **kept, shortened** | Carries the distinction from Items per shelf, which is only a count |
| `settings.translateModeOnNote` | **kept, shortened** | Carries the "lyrics only" caveat |

So **3 keys deleted, 5 shortened and relocated** — where the plan had said delete 8. The plan's
original wording is superseded by the user's instruction; the SUMMARY, the tests and the
dictionaries all agree on the new numbers.

`settings.translateModeOffNote` is **retained and stays visible on screen**, not behind the (i). It
explains why the control above is *disabled*, which no mockup of the enabled states can do — and a
disabled control with no visible reason is the confusing case.

Beyond the eight, every other description on the five pages this task rewrote (general, appearance,
home, playback, translation) also moved into `SettingHint` — **unchanged in wording**. Rewriting
another ~20 keys across 15 languages would be a large volume of machine translation I cannot verify;
getting them off the screen is the win, and shortening them is a safe follow-up. `/settings/data`'s
`.hint` lines were left as visible paragraphs: they sit under action rows, and folding a
paragraph-sized string into a row's second line would make each destructive action a block of text.

---

## 5. Proof the 8 keys landed correctly in all 15 dictionaries, not just `en`

The existing parity test only proves the 15 dictionaries **agree** — it stays perfectly green while
all 15 carry the same dead string. That is exactly the failure mode a settings sweep produces, so the
new `describe('quick-260919-ebi dead strings')` block in `i18n.test.ts` closes it with four
assertions:

1. the 3 deleted keys are **absent from every locale** (`hasOwnProperty`, per dictionary);
2. the 9 added/kept keys are **present and non-blank in every locale**;
3. **no production source file still references a deleted key** — a full recursive walk of `src/`
   over `.ts` + `.svelte`, excluding `*.test.ts` (this file and `settings-ui.test.ts` name the
   deleted keys on purpose). This matters because `lookupKey` returns the raw key rather than blank,
   so a stale `t('settings.themeDesc')` would render the literal string `settings.themeDesc` on
   screen;
4. the kept descriptions are **actually short now** (< 90 chars in `en`) — a 250-character paragraph
   behind an (i) is still a paragraph.

Verified independently of the test, by reading the 15 files directly:

```
dictionaries: 15
ABSENT settings.themeDesc          -> 0 dicts still carry it
ABSENT settings.nowbarLyricsDesc   -> 0 dicts still carry it
ABSENT settings.showSearchPillDesc -> 0 dicts still carry it
PRESENT settings.optOn / appearanceMotion / aboutSetting / autoExpandDesc /
        showQualityTagDesc / showRandomizeDesc / tileDensityDesc /
        translateModeOnNote / translateModeOffNote  -> 15/15 each
```

New keys added across all 15: `settings.appearanceMotion` ("Motion" — General's borrowed
"Playback & motion" heading would have read as a lie on a page with no playback on it),
`settings.optOn`, `settings.aboutSetting`.

---

## Verification — what was actually run

| Gate | Result |
|---|---|
| `pnpm check` | **0 errors, 0 warnings, 4549 files** |
| `pnpm test` | **135 files, 2751 tests, all passing** |
| `pnpm build` | **succeeds** (adapter-cloudflare, built in 5.79s) |
| `settings-ui.test.ts` | 16 tests — row/picker/hint structure, `.seg` single definition, T-ebi-01 |
| `settings.svelte.test.ts` | 5 new reset-group assertions (T-ebi-02) |
| `i18n.test.ts` | 33 tests, including the new dead-string block |

Two gate-design notes, because a gate that cannot fail is worse than no gate:

- The `.row-toggle` / `.sw` / `.item` detector is **itself pinned** by a test proving it sees a real
  rule, ignores a comment that merely mentions the class, and does not confuse `.sw` with `.swatch`.
- I verified that `pnpm check` **genuinely reports unused CSS selectors** by temporarily inserting a
  dead rule and watching it warn. That makes the clean runs real evidence that no orphaned CSS was
  left behind on any of the seven edited pages — otherwise "0 warnings" would have proved nothing.

---

## What I could NOT verify — read this before shipping

**No browser tool was available to me in this session, and no preview server was started.** Nothing
below is broken as far as static analysis can tell; it is simply unobserved.

1. **How the previews actually look. Nobody has seen them.** Every mock was written blind, from the
   theme tokens and the `.mock-*` geometry. The build compiles and the structure is asserted, but
   proportions, spacing, and whether each card *reads* as the thing it depicts are unverified. The
   ones I would look at first:
   - the `pile` density card, where the fourth tile is meant to be **half-cut at the edge** to say
     "this scrolls sideways" — it relies on `.mock` clipping a `nowrap` row that overflows;
   - the `autoExpandOnPlay` "On" card — a 30px cover plus two lines plus a transport row inside a
     74px frame is tight;
   - the `nowbarLyrics` and `showQualityTag` cards, which are the only mocks using **real 7px text**
     (`Stargazing` / `Myles Smith` / `FLAC`). 7px may be too small to read on a phone.
2. **The Theme cards in both themes.** The literals are the real `app.css` values and are
   test-pinned, but "the dark card looks dark while the light theme is active" has not been seen. The
   light card sits inside `.mock`'s `var(--color-bg)` frame, so in dark theme it renders as a light
   panel in a dark bezel — intended, but a judgement call worth a glance.
3. **Every preview in light theme.** No white-on-white, no invisible border — reasoned from tokens,
   not observed.
4. **Reduce Motion.** Only the selection ring animates, behind `no-preference`, so nothing should
   move and nothing should go blank. Not observed with the OS flag set.
5. **The `SettingHint` disclosure on a real phone.** The clip/reveal, the 28px tap target, and the
   `@media (hover: hover)` gate are all static-analysis-clean but have not been tapped. The specific
   thing to check: after tapping (i) on Android Chrome, does the line stay open and then close on a
   second tap, with no stuck hover state.
6. **Keyboard tab order through a preview group.** Real `<button>`s, so it should be correct by
   construction; not exercised.
7. **`$props.id()`** in `SettingHint` compiles and builds on Svelte 5.56, but the generated
   `aria-controls` pairing was not inspected in a live DOM.

The task-6 human-check list in the PLAN is the right walkthrough for all of the above.

## Boundaries respected

- `src/lib/services/retag.ts` — **not opened, not edited.**
- `/settings/downloads` — **not opened, not edited.** It is the one settings page excluded from the
  structural gate, with the reason recorded in the test.
- `.planning/ROADMAP.md` and `.planning/STATE.md` — not touched; the orchestrator owns them.
- `PLAN.md` / `SUMMARY.md` — not committed; the orchestrator owns that commit.
- **Nothing pushed to origin.**

## Follow-ups worth a separate pass

1. `/settings/downloads` + the `.chip` idiom — the remaining un-converted rows.
2. Shorten the ~20 descriptions that moved into `SettingHint` unchanged.
3. `lastfmLang` / `lastfmSkip`: decide whether to surface a control or retire the fields with a
   persistence migration.
4. `/settings/lastfm`: un-comment the index row when the v1.1 Last.fm phase lands, or delete both.
