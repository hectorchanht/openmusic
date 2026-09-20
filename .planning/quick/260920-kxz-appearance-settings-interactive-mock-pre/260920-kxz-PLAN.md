---
phase: quick-260920-kxz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/config/defaults.ts
  - src/lib/stores/settings.svelte.ts
  - src/lib/stores/settings-persist.svelte.test.ts
  - src/app.css
  - src/lib/i18n/en.ts
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
  - src/lib/i18n/zh-Hans.ts
  - src/lib/i18n/zh-Hant.ts
  - src/lib/components/RowActionsConfig.svelte
  - src/lib/components/NpPreviewEditor.svelte
  - src/routes/(app)/settings/appearance/+page.svelte
  - "src/**/*.svelte + src/app.css (scripted px→rem font-size sweep, 36 files, Task 1)"
autonomous: true
requirements: [QUICK-260920-KXZ]
must_haves:
  truths:
    - "A fresh install shows NO like/download buttons in song rows (rowActions default is []), and a persisted [] survives load"
    - "Settings → Appearance has ONE 'App text size' slider; dragging it visibly resizes text everywhere in the app, including px-sized labels (song rows, menus, settings), not only rem-sized Now Playing text"
    - "The Song rows section shows a replica row whose title, artist and cover carry an accent-tinted 'wing'; tapping a wing selects it and the single slider under the row resizes THAT part in place, committing live (store + save on every change) — the row-buttons drag/toggle strip still works inside the same replica"
    - "The Now playing section shows a replica hero (cover, title, artist, three lyric lines) with wings on title, artist and lyrics; the slider changes the replica live but the store is NOT written until Save; Cancel restores the replica to the persisted values"
    - "Every wing is a real <button> with aria-pressed and a stateful aria-label; Enter/Space selects it; the range input has an aria-label naming the selected part"
    - "Every new user-facing string has a key in all 16 locale dictionaries (double quotes) — pnpm test i18n parity passes; pnpm check passes"
  artifacts:
    - path: "src/lib/config/defaults.ts"
      provides: "fontScaleApp: 100 in APPEARANCE_DEFAULTS; rowActions default []"
      contains: "fontScaleApp"
    - path: "src/lib/stores/settings.svelte.ts"
      provides: "fontScaleApp $state + load clamp + save + applyTheme --fs-app + resetAppearance"
      contains: "--fs-app"
    - path: "src/app.css"
      provides: "--fs-app: 1 root token and html { font-size: calc(100% * var(--fs-app, 1)) }; zero px font-size rules remain in src"
      contains: "--fs-app"
    - path: "src/lib/components/RowActionsConfig.svelte"
      provides: "wing buttons on cfg-art / cfg-title / cfg-sub with target/onselect props"
      contains: "onselect"
    - path: "src/lib/components/NpPreviewEditor.svelte"
      provides: "draft-then-commit Now Playing replica editor with Cancel/Save"
      min_lines: 120
    - path: "src/routes/(app)/settings/appearance/+page.svelte"
      provides: "App text size slider + Song rows editor + Now playing editor sections; old five-slider Text size block and cover-demo tiles removed"
      contains: "NpPreviewEditor"
    - path: "src/lib/stores/settings-persist.svelte.test.ts"
      provides: "fontScaleApp round-trip cases; rowActions default assertions updated to []"
      contains: "fontScaleApp"
  key_links:
    - from: "src/lib/stores/settings.svelte.ts applyTheme"
      to: "src/app.css html font-size"
      via: "r.style.setProperty('--fs-app', String(this.fontScaleApp / 100))"
      pattern: "--fs-app"
    - from: "src/routes/(app)/settings/appearance/+page.svelte"
      to: "src/lib/components/RowActionsConfig.svelte"
      via: "<RowActionsConfig title artist target={rowTarget} onselect=…/> + range input writing settings.fontScaleTitle / fontScaleArtist / coverScale then settings.save()"
      pattern: "onselect="
    - from: "src/lib/components/NpPreviewEditor.svelte"
      to: "src/lib/stores/settings.svelte.ts"
      via: "save(): settings.fontScaleNpTitle/NpArtist/Lyrics = draft.*; settings.save()"
      pattern: "settings\\.save\\(\\)"
    - from: "src/lib/components/NpPreviewEditor.svelte replica root"
      to: "its own scoped CSS calc(1.5rem * var(--fs-np-title, 1)) etc."
      via: "inline style:--fs-np-title / --fs-np-artist / --fs-lyrics set from the DRAFT, shadowing the :root values for the replica only"
      pattern: "style:--fs-np-title"
---

<objective>
Rework Settings → Appearance so sizing is configured ON mock UIs instead of on a flat list of sliders:
a song-row replica editor (title / artist / cover, live-commit), a Now Playing replica editor
(title / artist / lyrics, draft + Cancel/Save), a NEW global "App text size" slider that scales all
app text, and the song-row like/download buttons default OFF.

Purpose: the current "Text size" section mixes list-row scales with Now-Playing-only scales, so
users cannot tell which surface a slider touches. Showing the surface itself as the control ends
the guessing (the RowActionsConfig precedent: "the preview is not a picture of the effect, it is
the effect").

Output: extended `RowActionsConfig.svelte` (wings), new `NpPreviewEditor.svelte`, rewired
appearance page, `fontScaleApp` setting across all five store touch points, px→rem font-size sweep
so the root multiplier really reaches every text rule, 9 new i18n keys × 16 locales, persist tests.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/routes/(app)/settings/appearance/+page.svelte
@src/lib/components/RowActionsConfig.svelte
@src/lib/config/defaults.ts
@src/lib/stores/settings.svelte.ts
@src/lib/stores/settings-persist.svelte.test.ts
@src/app.css
@src/lib/i18n/en.ts

<verified_facts>
Orchestrator-verified — do NOT re-derive:
- CSS vars are already split correctly: `--fs-title`/`--fs-artist` (+ `--cover-scale`) are the
  song-row scales (SongRow, CompactRow, NpUpNext, NpRelated, TrackMenu, pages…); `--fs-np-title`/
  `--fs-np-artist` are consumed ONLY by NowPlaying.svelte (`.title` = `calc(1.5rem * var(--fs-np-title,1))`
  weight 800 lh 1.2 nowrap-ellipsis; `.artist` = `calc(1rem * var(--fs-np-artist,1))`); `--fs-lyrics`
  ONLY by NpLyrics.svelte (`.lyrics p` = `calc(1rem * var(--fs-lyrics,1))` muted; `p.active` = color
  text + weight 700). NowPlaying's cover does NOT use `--cover-scale` → NP editor has no cover wing.
- `settings.svelte.ts`: fields L168-187, load clamps L306-323 (`clampInt(v.x, MIN, MAX, default)`;
  rowActions already honours a persisted EMPTY array — no change needed there), save L441-448,
  applyTheme L492-498 (`r.style.setProperty('--fs-…', String(this.x / 100))`), resetAppearance
  L516-530. Exported bounds: `FONT_SCALE_MIN = 50`, `FONT_SCALE_MAX = 200`, `COVER_SCALE_MIN = 70`,
  `COVER_SCALE_MAX = 150`.
- `defaults.ts:63` `rowActions: ['like', 'download']` with a comment block (L56-62) arguing BOTH ON.
- `app.css`: `:root` token block L36-47 holds the `--fs-*` defaults; L80 `html, body { margin: 0; padding: 0; }`;
  body sets no font-size (root = browser default 16px). Font-size rules in `src`: 160 plain `Npx`,
  26 `calc(Npx * var(--fs-…))`, 0 other px forms, 36 files; 1 px line-height (Nowbar.svelte:580).
  All px values are exact sixteenths (12/13/14/11/15/16/10px…), so px→rem is lossless at 100%.
- i18n: `t(key, params)` interpolates `{name}`; generic Cancel/Save strings already exist as
  `tags.cancel` / `tags.save` (TrackMenu already reuses `tags.cancel` for a non-tag dialog — precedent).
  Existing names to reuse as wing labels: `settings.fontSizeTitle` ("Song title"),
  `settings.fontSizeArtist`, `settings.coverSize`, `settings.fontSizeNpTitle`, `settings.fontSizeNpArtist`,
  `settings.fontSizeLyrics`. `settings.appearanceNote` ("Sizes apply across the whole app. 100% is
  the default.") becomes TRUE for the app slider — reuse it there.
- `i18n.test.ts` enforces: identical key set across all locales, no blank values, DOUBLE quotes on
  every entry line. `settings-persist.svelte.test.ts` has the browser=true harness (`freshSettings()`,
  `memStore`, `KEY = 'openmusic:settings:v1'`) and pins the rowActions default at L92 and L145-146.
- Demo text convention D-12 (already on the page): `demoTitle = player.current?.title ?? "Stargazing"`,
  `demoArtist = player.current?.artist ?? "Myles Smith"`. The PAGE imports player; the STORE stays a leaf.
- `RowActionsConfig` has exactly one caller (the appearance page) → its props can change freely.
- Shared helper: `coverGradient(seed: string): string` from `$lib/services/cover-gradient` (do not
  re-inline a gradient in the new component).
</verified_facts>

<interfaces>
New/changed contracts (define exactly these; downstream tasks build against them):

```ts
// src/lib/components/RowActionsConfig.svelte — ADDED props (Task 2)
export type RowScaleTarget = 'title' | 'artist' | 'cover';   // export from the component's <script module> or declare in +page and pass as string union
let { title, artist, target, onselect }: {
	title: string; artist: string;
	target: RowScaleTarget | null;            // which wing is selected (null = none)
	onselect: (t: RowScaleTarget) => void;    // wing tap/Enter
} = $props();

// src/lib/components/NpPreviewEditor.svelte (Task 3)
let { title, artist }: { title: string; artist: string } = $props();  // demo text from the page (D-12)
type NpTarget = 'npTitle' | 'npArtist' | 'lyrics';
// internal: draft = $state({ npTitle, npArtist, lyrics }) seeded from settings; touched flag; dirty = $derived(...)

// settings store additions (Task 1)
fontScaleApp = $state<number>(APPEARANCE_DEFAULTS.fontScaleApp);      // percent, clamp FONT_SCALE_MIN..MAX
// applyTheme: r.style.setProperty('--fs-app', String(this.fontScaleApp / 100));
```

New i18n keys (en values — add to ALL 16 dictionaries, translated, DOUBLE quotes):
```
"settings.fontSizeApp": "App text size",
"settings.fontSizeAppDesc": "Scales every piece of text in the app at once. The Song rows and Now playing sizes below multiply on top of this.",
"settings.songRowEditor": "Song rows",
"settings.songRowEditorDesc": "Tap a highlighted part of the example row to pick it, then drag the slider — the row resizes as you drag. Drag a button to move it, tap it to switch it off; the ⋮ menu is always there.",
"settings.npEditor": "Now playing",
"settings.npEditorDesc": "These sizes change only the full-screen Now playing view. Tap a highlighted part, drag the slider, then Save — or Cancel to keep what you had.",
"settings.wingPick": "{name}, {value}%. Press to resize this part.",
"settings.wingPicked": "{name}, {value}%, selected. Use the slider below to resize it.",
"settings.editorSlider": "Size of {name}",
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: fontScaleApp plumbing, rowActions default off, px→rem sweep, i18n keys, persist tests</name>
  <files>src/lib/config/defaults.ts, src/lib/stores/settings.svelte.ts, src/app.css, src/lib/i18n/*.ts (16 dictionaries), src/lib/stores/settings-persist.svelte.test.ts, plus the 36 files touched by the scripted sweep (src/**/*.svelte, src/app.css)</files>
  <action>
1. `defaults.ts`: in APPEARANCE_DEFAULTS add `fontScaleApp: 100` with a doc comment (quick-260920-kxz: global root multiplier; composes with, never replaces, the per-part scales). Change `rowActions` to `[] as readonly RowAction[]` and REWRITE the L56-62 comment: the "BOTH ON: the user explicitly asked" rationale is reversed by quick-260920-kxz — the user now asked for rows to default to neither Like nor Download; the ⋮ menu stays unconditional so [] is safe. Keep the WR-10 "this literal lives HERE" sentence.

2. `settings.svelte.ts` — all five touch points, mirroring the sibling `fontScaleNpTitle` line-for-line: (a) field `fontScaleApp = $state<number>(APPEARANCE_DEFAULTS.fontScaleApp)` with a comment next to the other scales; (b) load: `this.fontScaleApp = clampInt(v.fontScaleApp, FONT_SCALE_MIN, FONT_SCALE_MAX, APPEARANCE_DEFAULTS.fontScaleApp)`; (c) save blob: `fontScaleApp: this.fontScaleApp`; (d) applyTheme: `r.style.setProperty('--fs-app', String(this.fontScaleApp / 100))`; (e) resetAppearance: `this.fontScaleApp = d.fontScaleApp`. Do not touch the rowActions load branch (it already keeps a persisted []).

3. `app.css`: add `--fs-app: 1;` to the `:root` appearance-scales block (L36-47) with a one-line comment; change L80 to `html { font-size: calc(100% * var(--fs-app, 1)); } html, body { margin: 0; padding: 0; }`. Comment (quick-260920-kxz): root multiplier — only reaches rem text, which is why the sweep below exists.

4. px→rem sweep (this is what makes the "whole app" claim true — a root multiplier cannot move `font-size: 14px`). Write a throwaway node script in the scratchpad (NOT the repo) that walks `src/**/*.svelte` and `src/app.css` (skip `*.test.*`) and rewrites, in-place: `font-size:\s*(\d+(?:\.\d+)?)px` → `font-size: <n/16>rem`; `font-size:\s*calc\((\d+(?:\.\d+)?)px \*` → `font-size: calc(<n/16>rem *`; and the single `line-height:\s*(\d+)px` (Nowbar.svelte:580) → `<n/16>rem` so that line box grows with its text. Format `n/16` via `String(+(n / 16).toFixed(5))` (12→0.75, 13→0.8125, 14→0.875, 11→0.6875, 15→0.9375, 10→0.625, 16→1). Do NOT touch widths, paddings, radii, borders, `999px`, or the theme mock's px geometry — only the two `font-size` forms and that one line-height. Rendering at 100% is byte-for-byte identical (root is 16px), so this is a no-op until `--fs-app` moves. Add ONE comment at the app.css `--fs-app` token explaining the sweep so nobody re-introduces px text sizes; no per-file comments (186 sites).

5. i18n: append the 9 keys from `<interfaces>` to `en.ts` next to the existing `settings.fontSize*` block (L191-199) and to ALL 15 other dictionaries with translated values. DOUBLE quotes for every key AND value (the quote-style test fails on a single quote). `{name}` / `{value}` placeholders must be preserved verbatim in every language.

6. `settings-persist.svelte.test.ts`: (a) update ONLY the assertions that check the DEFAULT / reset value of rowActions (L92 "defaults to …" → `[]`, L145-146 resetAppearance → `[]`; rename the `it` titles accordingly) — assertions about a PERSISTED list (subset, order, dedupe at ~L123/L130) stay `['like','download']`; (b) add `describe('settings persistence round-trip — fontScaleApp (quick-260920-kxz)')` with three cases using the existing harness: defaults to 100 when nothing persisted; a persisted 130 loads and `save()` writes it into the blob; an out-of-range 250 clamps to FONT_SCALE_MAX (200) and `resetAppearance()` returns it to 100 in both the field and the blob. Then `grep -rn "like', 'download'\]" src --include='*.test.ts'` and fix any OTHER test file that pinned the old default (settings.svelte.test.ts may). If any test asserts a `Npx` font-size string that the sweep converted, update it to the rem equivalent.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && test "$(grep -rhE 'font-size:[^;]*px' src --include='*.svelte' --include='*.css' | grep -v '^\s*//' | wc -l | tr -d ' ')" = "0" && grep -q -- '--fs-app' src/app.css src/lib/stores/settings.svelte.ts && grep -q 'fontScaleApp' src/lib/config/defaults.ts && pnpm test -- --run src/lib/i18n src/lib/stores/settings 2>&1 | tail -5 && pnpm check 2>&1 | tail -3</automated>
  </verify>
  <done>fontScaleApp exists in defaults + all five store paths; `--fs-app` drives `html { font-size }`; zero px font-size rules remain under src; rowActions default is []; 9 keys present in all 16 dictionaries; i18n + settings tests green; pnpm check clean.</done>
</task>

<task type="auto">
  <name>Task 2: Song-row editor — wings on RowActionsConfig + App text size slider + page rewire</name>
  <files>src/lib/components/RowActionsConfig.svelte, src/routes/(app)/settings/appearance/+page.svelte</files>
  <action>
1. `RowActionsConfig.svelte`: add the `target` / `onselect` props from `<interfaces>` (declare `export type RowScaleTarget = 'title' | 'artist' | 'cover'` in a `<script module lang="ts">` block so the page imports it from the component). Convert the three inert spans into WING buttons: `.cfg-art` → `<button type="button" class="wing wing-art" …>` (keep the gradient + `calc(44px * var(--cover-scale,1))` sizing on the button itself); wrap `.cfg-title` and `.cfg-sub` text each in its own `<button type="button" class="wing">` inside `.cfg-meta` (remove the `aria-hidden` on `.cfg-meta`; the text is now the label). Each wing: `class:sel={target === key}`, `aria-pressed={target === key}`, `aria-label` = `t(target === key ? 'settings.wingPicked' : 'settings.wingPick', { name, value })` where name = `t('settings.fontSizeTitle' | 'settings.fontSizeArtist' | 'settings.coverSize')` and value = the matching `settings.fontScaleTitle | fontScaleArtist | coverScale`; `onclick={() => onselect(key)}` (Enter/Space come free with a real button). Reset button styles (`background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer`) so the replica geometry is unchanged. Extend the header comment with a quick-260920-kxz paragraph: the row's PARTS are now controls too (tap a wing → the page's single slider targets it) — same "the preview is the effect" rule, and keyboard parity holds because every wing is a real button with a stateful aria-label. The title/artist rules already read `--fs-title` / `--fs-artist` from :root, so live commits from the page resize the replica with no extra wiring.

   Wing styling (the "light accent-tinted" affordance — reuse the accent token, invent no colour): `.wing { position: relative; border-radius: 6px; outline: 1.5px dashed color-mix(in srgb, var(--color-primary) 55%, transparent); outline-offset: 3px; background: color-mix(in srgb, var(--color-primary) 10%, transparent); }`, `.wing.sel { outline-style: solid; outline-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 18%, transparent); }`, `.wing:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }`. Text wings keep `min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; max-width:100%`. Put the wing CSS in RowActionsConfig (Task 3 duplicates the same ~10 lines in NpPreviewEditor — two scoped copies of a 10-line rule beat a third component; note that in a comment).

2. `+page.svelte` — restructure the sizing sections (keep Theme / Accent / Motion untouched):
   a. Replace the whole `settings.appearanceText` section (the five `.ctl` sliders, L248-355) with ONE `.ctl`: label `t("settings.fontSizeApp")` + `SettingHint` with `settings.fontSizeAppDesc`, `.val` `{settings.fontScaleApp}%`, `<input type="range" min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step="5" value={settings.fontScaleApp} oninput={(e) => setApp(num(e))} aria-label={t("settings.fontSizeApp")}>` with `setApp(v) { settings.fontScaleApp = v; settings.save(); }`, then the existing `<p class="note">{t("settings.appearanceNote")}</p>` moved here (it is now literally true). No demo `.prev` span — the settings page itself is the preview (comment that). Keep the `Type` icon for this h2.
   b. Replace the `settings.appearanceLayout` section (cover slider + cover-demo tiles + rowButtons ctl, L357-410) with a `settings.songRowEditor` section (icon `ListMusic` from lucide; drop the `LayoutGrid` import): h2 + `SettingHint` (`settings.songRowEditorDesc`), then `<RowActionsConfig title={demoTitle} artist={demoArtist} target={rowTarget} onselect={(t) => (rowTarget = t)} />`, then one `.lab` row showing `t(nameKeyOf(rowTarget))` + `.val` `{rowValue}%`, then ONE `<input type="range">` whose `min/max` are `COVER_SCALE_MIN/MAX` when `rowTarget === 'cover'` else `FONT_SCALE_MIN/MAX`, `step="5"`, `value={rowValue}`, `aria-label={t("settings.editorSlider", { name: t(nameKeyOf(rowTarget)) })}`, `oninput` → write the targeted field (`fontScaleTitle` / `fontScaleArtist` / `coverScale`) and `settings.save()` (LIVE commit — locked decision; applyTheme inside save() repaints the replica via :root vars). `let rowTarget = $state<RowScaleTarget>('title')` — default a selected wing so the slider is never orphaned; `rowValue` is a `$derived` switch on rowTarget. Delete the now-unused `setTitle/setArtist/setLyrics/setNpTitle/setNpArtist/setCover` functions, the `.prev`, `.demo-cap`, `.cover-demo*` CSS and the reduced-motion block for `.cover-demo-tile`. Remove the `<p class="note">` from this section (moved to a).
   c. Leave a placeholder comment where Task 3 mounts `<NpPreviewEditor>` (a new section after Song rows).
   Tag the restructure with quick-260920-kxz comments explaining the grouping: the OLD block put list-row and Now-Playing-only scales under one "Text size" heading, so a user could not tell which surface a slider touched; the CSS wiring was already split, only the page lied.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -c 'onselect' src/lib/components/RowActionsConfig.svelte | xargs test 1 -le && grep -q 'settings.fontSizeApp' 'src/routes/(app)/settings/appearance/+page.svelte' && ! grep -q 'setNpTitle\|cover-demo-tile' 'src/routes/(app)/settings/appearance/+page.svelte' && pnpm check 2>&1 | tail -3</automated>
  </verify>
  <done>Appearance page shows App text size slider, then a Song rows section whose replica row has three accent-outlined wing buttons (title/artist/cover); tapping one retargets the single slider and dragging resizes that part in place while still persisting on every change; like/download drag-strip unchanged; old five-slider block and cover tiles gone; pnpm check clean.</done>
</task>

<task type="auto">
  <name>Task 3: NpPreviewEditor — draft-then-commit Now Playing replica with wings, Cancel/Save</name>
  <files>src/lib/components/NpPreviewEditor.svelte, src/routes/(app)/settings/appearance/+page.svelte</files>
  <action>
1. Create `src/lib/components/NpPreviewEditor.svelte` (runes, tabs, single quotes). Props `{ title, artist }` (D-12 demo text). Imports: `settings, FONT_SCALE_MIN, FONT_SCALE_MAX` from `$lib/stores/settings.svelte`, `t` from `$lib/i18n`, `coverGradient` from `$lib/services/cover-gradient`, `tapBounce` from `$lib/actions/tapBounce`.

   State: `type NpTarget = 'npTitle' | 'npArtist' | 'lyrics'`; `const persisted = () => ({ npTitle: settings.fontScaleNpTitle, npArtist: settings.fontScaleNpArtist, lyrics: settings.fontScaleLyrics })`; `let draft = $state(persisted())`; `let target = $state<NpTarget>('npTitle')`; `let touched = false` (PLAIN field — nothing reads it reactively, house convention); `const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(persisted()))`. Re-seed effect: `$effect(() => { const p = persisted(); if (!touched) draft = p; })` — so the header's Reset-to-default (which writes the store) refreshes an UNTOUCHED draft, while a touched draft is never clobbered (comment why). `onInput(v)`: `touched = true; draft = { ...draft, [target]: v }`. `cancel()`: `draft = persisted(); touched = false`. `save()`: write the three store fields from draft, `settings.save()`, `touched = false`. Both buttons `disabled={!dirty}`.

   Markup — a REPLICA of the NP hero, not `<NowPlaying>` (header comment: same "replica, not instance" rule as RowActionsConfig; NowPlaying wants the live player and would resolve/seek). Root `<div class="np-mock" style:--fs-np-title={draft.npTitle / 100} style:--fs-np-artist={draft.npArtist / 100} style:--fs-lyrics={draft.lyrics / 100}>` — the DRAFT shadows the :root vars for this subtree only, so the scoped CSS below can copy NowPlaying's/NpLyrics' exact formulas and the real app is untouched until Save (comment this; it is the whole trick). Children: `<span class="np-art" aria-hidden="true" style:background={coverGradient(title)}></span>` (no wing — NP cover is not scaled by any setting); title wing `<button type="button" class="wing np-title">{title}</button>`; artist wing `<button … class="wing np-artist">{artist}</button>`; lyrics wing `<button … class="wing np-lyrics"><span class="ly">{artist}</span><span class="ly active">{title}</span><span class="ly">{artist}</span></button>` (three lines, middle one active, demo text per D-12 — no new lyric strings). Each wing: `class:sel`, `aria-pressed`, `aria-label` via `settings.wingPick`/`wingPicked` with name = `t('settings.fontSizeNpTitle' | 'settings.fontSizeNpArtist' | 'settings.fontSizeLyrics')` and value = `draft[key]`, `onclick={() => (target = key)}`. Below the mock: `.lab` (name + `.val` `{draft[target]}%`), `<input type="range" min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step="5" value={draft[target]} aria-label={t('settings.editorSlider', { name })} oninput={(e) => onInput(Number((e.currentTarget as HTMLInputElement).value))}>`, then `.actions` row: `<button class="mi" onclick={cancel} disabled={!dirty} use:tapBounce>{t('tags.cancel')}</button> <button class="mi primary" onclick={save} disabled={!dirty} use:tapBounce>{t('tags.save')}</button>` (reusing the generic Cancel/Save strings — TrackMenu precedent; comment it).

   CSS (scoped): `.np-mock { display:flex; flex-direction:column; align-items:flex-start; gap:8px; padding:12px; border-radius:12px; background: var(--color-surface); }`; `.np-art { width: min(40%, 140px); aspect-ratio: 1/1; border-radius: 12px; align-self:center; }`; `.np-title { font-size: calc(1.5rem * var(--fs-np-title, 1)); font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }` (NowPlaying.svelte:1323 formula); `.np-artist { font-size: calc(1rem * var(--fs-np-artist, 1)); }` (L1324); `.np-lyrics { display:flex; flex-direction:column; gap:6px; align-items:flex-start; }` `.ly { font-size: calc(1rem * var(--fs-lyrics, 1)); color: var(--color-text-muted); }` `.ly.active { color: var(--color-text); font-weight: 700; }` (NpLyrics.svelte:402-403). Wing rules: the same ~10 lines as RowActionsConfig (dashed accent color-mix outline, tinted fill, `.sel` solid, `:focus-visible`), button resets (`background:none;border:0;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer`). `.actions { display:flex; gap:8px; justify-content:flex-end; margin-top:8px; }`, `.mi { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--color-border); background: var(--color-surface-2); color: var(--color-text); cursor:pointer; }`, `.mi.primary { background: var(--color-primary); border-color: transparent; color: #fff; }`, `.mi:disabled { opacity: .45; cursor: default; }`, range `width:100%; accent-color: var(--color-primary)`. Nothing here may be `Npx` font-size (Task 1's gate stays at zero) — use rem.

2. `+page.svelte`: import `NpPreviewEditor` and `Disc3` (lucide); add a section after Song rows: `<h2><Disc3 size={15}/> {t("settings.npEditor")}<SettingHint label={t("settings.npEditor")} text={t("settings.npEditorDesc")}/></h2>` + `<NpPreviewEditor title={demoTitle} artist={demoArtist} />`. Comment (quick-260920-kxz): draft-then-commit HERE only, because Now Playing is a full-screen surface the user cannot see while on this page — the mock is the only feedback, so a wrong drag must be cancellable; the row editor above commits live because its replica IS what every list shows.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -q 'style:--fs-np-title' src/lib/components/NpPreviewEditor.svelte && grep -q 'tags.cancel' src/lib/components/NpPreviewEditor.svelte && grep -q 'NpPreviewEditor' 'src/routes/(app)/settings/appearance/+page.svelte' && test "$(grep -rhE 'font-size:[^;]*px' src --include='*.svelte' --include='*.css' | wc -l | tr -d ' ')" = "0" && pnpm check 2>&1 | tail -3 && pnpm test 2>&1 | tail -6</automated>
  </verify>
  <done>Now playing section renders the replica with three wings; dragging changes ONLY the replica (settings store untouched, verified by no `settings.save` call in oninput path); Save writes fontScaleNpTitle/NpArtist/Lyrics + save(); Cancel restores; Reset-to-default refreshes an untouched draft; pnpm check + full pnpm test green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| localStorage → settings.load() | user/extension-writable blob feeds `fontScaleApp` |
| range input → store | numeric UI input written to CSS custom properties on `<html>` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-kxz-01 | Tampering | settings.load() fontScaleApp | mitigate | `clampInt(v.fontScaleApp, FONT_SCALE_MIN, FONT_SCALE_MAX, default)` — a tampered 0 or 10000 cannot make the app unreadable; covered by the new persist test |
| T-kxz-02 | Denial of Service | `html { font-size }` root multiplier | mitigate | bounds 50–200% are the existing FONT_SCALE constants; `--fs-app` is a bare number pushed via `setProperty`, never interpolated into a selector |
| T-kxz-03 | Tampering | NpPreviewEditor draft | accept | draft is component-local and flows only into the same clamped store fields on Save |
| T-kxz-SC | Tampering | npm installs | accept | no new dependencies in this plan |
</threat_model>

<verification>
- `pnpm check` clean; `pnpm test` green (i18n parity + quote style, settings persist round-trips incl. fontScaleApp and the new [] rowActions default).
- `grep -rhE 'font-size:[^;]*px' src --include='*.svelte' --include='*.css' | wc -l` → 0.
- Manual (dev server 4321/5173): Settings → Appearance: App text size drag grows settings labels AND a song row on Home; Song rows: tap cover/title/artist wing → slider retargets, drag resizes in place and persists across reload; Now playing: drag changes only the mock, Cancel reverts, Save then opening Now Playing shows the new sizes; header Reset-to-default refreshes both editors; fresh profile shows no like/download buttons in rows.
</verification>

<success_criteria>
- All six `must_haves.truths` observable.
- No `checkpoint` tasks; plan fully autonomous.
- Every new string keyed in 16 dictionaries; no deferred/"v1" language anywhere in the diff.
</success_criteria>

<output>
Create `.planning/quick/260920-kxz-appearance-settings-interactive-mock-pre/260920-kxz-SUMMARY.md` when done.
</output>
