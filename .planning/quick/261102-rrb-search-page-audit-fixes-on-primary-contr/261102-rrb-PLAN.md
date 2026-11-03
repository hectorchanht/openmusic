---
phase: quick-261102-rrb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/color.ts
  - src/lib/services/color.test.ts
  - src/lib/stores/settings.svelte.ts
  - src/app.css
  - src/routes/(app)/search/+page.svelte
  - src/lib/components/Nowbar.svelte
  - (plus any other .svelte file the T1 sweep confirms is white-on-primary in the SAME rule)
autonomous: true
requirements: [AUDIT-SEARCH-261102]

must_haves:
  truths:
    - "Text/icons on a --color-primary fill use var(--color-on-primary), which applyTheme() sets to whichever of #0b0b0f / #ffffff has higher WCAG contrast against the effective primary (tiffany #0abab5 -> dark)"
    - "Skeleton shimmer and input borders are visible in the light theme (light --color-border >= 3:1 vs #ececf2)"
    - "The search input has an accessible name, is type=search, shows a visible :focus-visible ring, and the native WebKit cancel button is hidden"
    - "The typeahead is an ARIA combobox: ArrowUp/ArrowDown move aria-activedescendant through role=option items, Enter picks the active one, Escape closes; each option announces its kind"
    - "Searching / no results / end-of-results are announced via a polite live region"
    - "Artist avatars load lazily (offscreen tiles in the horizontal scroller do not fetch) and keep the gradient fallback"
    - "Search skeleton rows use the global .sk and match real row height; no local shimmer keyframes remain"
    - "pnpm check and pnpm test are green"
  artifacts:
    - path: "src/lib/services/color.ts"
      provides: "pure onColor(hex) WCAG pick"
      contains: "export function onColor"
    - path: "src/app.css"
      provides: "--color-on-primary default token; theme-safe .sk; darker light border"
      contains: "--color-on-primary"
  key_links:
    - from: "src/lib/stores/settings.svelte.ts applyTheme()"
      to: "src/lib/services/color.ts onColor"
      via: "r.style.setProperty('--color-on-primary', onColor(primary))"
      pattern: "color-on-primary"
    - from: "search/+page.svelte input"
      to: "suggestions <ul>"
      via: "aria-controls + aria-activedescendant ids"
      pattern: "aria-activedescendant"
---

<objective>
Fix every finding from the /impeccable audit of the search page (user: "DO ALL"): on-primary
contrast token, light-theme breakage, search input a11y, combobox semantics + keyboard nav, live
status region, lazy artist avatars, skeleton de-duplication, focus ring, 44px clear-history target.

Out of scope (do NOT touch): the off-ramp font sizes 0.9375rem / 0.8125rem and radii 10px / 5px the
detector flagged. Do not push.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@./DESIGN.md
@/Users/laichan/.claude/skills/impeccable/reference/craft-floor.md  (READ before any UI edit)
@src/app.css
@src/routes/(app)/search/+page.svelte
@src/lib/services/color.ts

House rules that apply: tabs; runes only; every changed site gets a `quick-261102-rrb` comment and
existing decision-ref comments stay; i18n stays untouched (no new keys — see T3); no `as any`.
Node 24 for tooling: prefix commands with `PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH`.

<interfaces>
src/lib/services/color.ts (pure, dependency-free, already imported by settings.svelte.ts):
  export function darken(hex: string, amount: number): string   // malformed input passes through
src/lib/stores/settings.svelte.ts applyTheme() (~L667):
  const primary = THEME_PRIMARY[this.theme] ?? this.accent;
  r.style.setProperty('--color-primary', primary);
  r.style.setProperty('--color-primary-hover', darken(primary, 0.12));
src/app.css: :root tokens L5-10 (--color-primary #0abab5), light theme block ~L79-81
  (--color-surface-2 #ececf2, --color-border #c5c5cf), global .sk at ~L173-198
  (rgba(255,255,255,0.11) base / 0.22 sweep, reduce-motion re-assert `.sk.sk::after`).
search/+page.svelte:
  input ~L671 (data-search-input, bind:value={q}, oninput={onSuggestInput}, onfocus/onblur inputFocused)
  suggestions: `let suggestions = $state<Suggestion[]>([])` L124; Suggestion has key, kind
    ('song'|'artist'|'album'), title, artist; pickSuggestion(s) L177; typeahead block ~L767-796
  skeleton snippet skeletonRows ~L812-826; status texts L831-832 (search.empty), L903 (search.noMore)
  artist avatar L841: style:background-image={tile.image ? `url(${tile.image})` : fallbackArtistCover(tile.name)}
  CSS: .bar input ~L947, .bar input:focus ~L952, .bar button ~L963 (color:#fff),
    .offline-cta ~L989 (color:#fff), .suggest-clear ~L1003 (40px), local skeleton ~L1071-1098
  Existing i18n keys to reuse: search.placeholder, search.searching, search.empty, search.noMore,
    tags.fieldTitle ("Song title"), menu.detailArtist ("Artist"), menu.detailAlbum ("Album").
Nowbar.svelte ~L644-646: `.np-btn` background var(--color-primary) + color #fff.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: --color-on-primary token (pure onColor + test + applyTheme + call-site sweep)</name>
  <files>src/lib/services/color.ts, src/lib/services/color.test.ts, src/lib/stores/settings.svelte.ts, src/app.css, src/routes/(app)/search/+page.svelte, src/lib/components/Nowbar.svelte, other confirmed white-on-primary sites</files>
  <behavior>
    - onColor('#0abab5') === '#0b0b0f' (white is 2.41:1, dark is ~8.7:1)
    - onColor('#ff8a00') and onColor('#1db954') === '#0b0b0f'
    - onColor('#7c5cff') === '#ffffff' and onColor('#ff0033') === '#ffffff' (whichever ratio is higher — assert against the computed ratios, adjust expectation only if the math says otherwise)
    - onColor('#000000') === '#ffffff'; onColor('#ffffff') === '#0b0b0f'
    - malformed input ('red', '#abc', '') returns '#ffffff' (today's behaviour, never throws)
    - export contrastRatio(a, b) too (used by the test and by T2 to verify the light border), e.g. contrastRatio('#ffffff', '#000000') ≈ 21
  </behavior>
  <action>
    Add to the EXISTING src/lib/services/color.ts (no new module — it is already the pure colour
    home imported by settings): `relativeLuminance(hex)` (WCAG sRGB linearisation), exported
    `contrastRatio(a, b)`, and exported `onColor(hex)` returning '#0b0b0f' or '#ffffff' by higher
    contrast; malformed hex -> '#ffffff'. Add the behaviour cases to the existing color.test.ts.
    In settings.applyTheme() right after the --color-primary-hover line, set
    `--color-on-primary` to onColor(primary) with a quick-261102-rrb comment. In app.css :root add
    `--color-on-primary: #0b0b0f;` next to --color-primary (comment: default for tiffany; applyTheme
    overrides). Then sweep: replace white text/icon/fill/stroke with var(--color-on-primary) ONLY
    where the SAME rule/element has background var(--color-primary) (or primary-hover). Known:
    search `.bar button`, `.offline-cta`, Nowbar `.np-btn`. Then run
    `grep -rln "color-primary" src --include=*.svelte | xargs grep -ln "#fff"` and inspect each hit
    (ToastHost, TrackMenu, SoyYearStrip, SupporterSheet, SettingPicker, YearSelector, NpComments,
    SyncReviewModal, (app)/+layout.svelte, settings/*, supporters, charts/*, library, album, artist,
    auth/magic): change only genuine white-on-primary pairs; skip white on danger/black/image/scrim
    backgrounds. Memory note: grep has false-emptied before — confirm with sed/Read. Record the
    changed and skipped sites in SUMMARY.
  </action>
  <verify>
    <automated>PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH pnpm vitest --run src/lib/services/color.test.ts && grep -n "color-on-primary" src/lib/stores/settings.svelte.ts src/app.css "src/routes/(app)/search/+page.svelte" src/lib/components/Nowbar.svelte</automated>
  </verify>
  <done>Tests pass; token defined in :root and set at runtime; search submit, offline CTA, Nowbar play button and every confirmed white-on-primary site use var(--color-on-primary).</done>
</task>

<task type="auto">
  <name>Task 2: Light-theme skeleton/border, skeleton de-dup, focus ring, 44px clear</name>
  <files>src/app.css, src/routes/(app)/search/+page.svelte</files>
  <action>
    app.css: global `.sk` base -> `color-mix(in srgb, var(--color-text) 11%, transparent)`, sweep
    stop -> `color-mix(in srgb, var(--color-text) 22%, transparent)` (works on dark AND light);
    update its comment (quick-261102-rrb). Light theme `--color-border` #c5c5cf -> #80808a (≈3.3:1
    vs #ececf2; confirm with contrastRatio from T1 via a one-off `node -e`/vitest assertion, pick a
    darker grey if < 3:1). Accepted: light borders change app-wide.
    search/+page.svelte skeleton snippet: put the global `sk` class on the art span and the two
    line spans, drop `motion-always` there (global .sk already re-asserts under reduce-motion),
    rename `bar bar-title` / `bar bar-artist` -> `sk-line sk-title` / `sk-line sk-artist` (the old
    `.bar` collided with form `.bar` flex + margin-bottom, making skeleton rows taller). CSS: keep
    `.skel { pointer-events:none }`, `.skel .meta { gap:7px }`, sizing rules for `.sk-line`
    (display:block; height 9px; widths 62% / 40%; existing radius); DELETE the local rgba
    backgrounds, the ::after shimmer, `@keyframes skel-shimmer`, and the orphan "Disable shimmer
    for users who prefer reduced motion." comment. Keep `.vh`.
    Focus: keep `.bar input:focus { border-color }`, add `.bar input:focus-visible { box-shadow:
    0 0 0 2px var(--color-primary); }`. Change `.suggest-clear` width/height 40px -> 44px and
    update its quick-261006-ico comment text ("44px").
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && ! grep -n "skel-shimmer\|rgba(255, 255, 255, 0.11)" src/app.css "src/routes/(app)/search/+page.svelte" && grep -n "focus-visible" "src/routes/(app)/search/+page.svelte" && grep -A3 "\.suggest-clear {" "src/routes/(app)/search/+page.svelte" | grep -c "44px"</automated>
  </verify>
  <done>No local shimmer remains; skeleton spans use .sk; light border ≥3:1 vs surface-2; focus-visible ring present; clear-history is 44px.</done>
</task>

<task type="auto">
  <name>Task 3: Search a11y — label, combobox + keyboard nav, live region, lazy avatars</name>
  <files>src/routes/(app)/search/+page.svelte</files>
  <action>
    Input: add `type="search"`, `aria-label={t('search.placeholder')}`, `role="combobox"`,
    `aria-autocomplete="list"`, `aria-controls="search-suggest"`, `aria-expanded={typeaheadOpen}`,
    `aria-activedescendant={activeIdx >= 0 ? 'search-opt-' + activeIdx : undefined}`, and an
    `onkeydown`. Hide the native clear: `.bar input::-webkit-search-cancel-button,
    ::-webkit-search-decoration { -webkit-appearance:none; appearance:none; }` (custom X exists).
    Derive `typeaheadOpen = $derived(q.trim().length >= MIN_QUERY_LEN && suggestions.length > 0)`
    and use it as the existing {#if} gate (same condition — do NOT add inputFocused; memory:
    Android drops focus mid-type). Add `let activeIdx = $state(-1)`, reset to -1 wherever
    `suggestions` is reassigned (L139, L149, L179, L235, L425) or via an $effect on suggestions.
    onkeydown, only when typeaheadOpen: ArrowDown/ArrowUp wrap activeIdx and preventDefault;
    Enter with activeIdx >= 0 -> preventDefault (stops form submit) + pickSuggestion(suggestions[activeIdx]);
    Escape -> suggestions = [] . Enter with activeIdx -1 keeps today's submit.
    Typeahead markup: `<ul class="list" id="search-suggest" role="listbox"
    aria-label={t('search.suggestions')}>`; `<li role="none">`; the button gets `role="option"`,
    `id="search-opt-{i}"`, `aria-selected={i === activeIdx}`, `tabindex="-1"`, plus an
    `.active` style matching the existing hover background. Kind cue: keep the glyph aria-hidden
    and add `<span class="vh">` with t('tags.fieldTitle') / t('menu.detailArtist') /
    t('menu.detailAlbum') for song/artist/album — existing keys, so no locale edits. Recent
    list stays a plain list.
    Live region: one always-mounted `<p class="vh" role="status" aria-live="polite">` near the
    results, text = showFirstSkeleton||loading ? t('search.searching') : (searched && results.length
    === 0 ? t('search.empty') : (searched && !hasMore && results.length > 0 ? t('search.noMore') : '')).
    Avatars: lazyCover is Track-shaped (resolves song covers) so it does not fit artist tiles —
    use the native rung instead: keep the gradient as the span background
    (style:background-image={fallbackArtistCover(tile.name)}) and render
    `{#if tile.image}<img src={tile.image} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">{/if}`
    inside it (also satisfies lazyCover's SECURITY note: <img src>, not CSS url()). CSS:
    `.artist-avatar { overflow:hidden; display:block }` and `.artist-avatar img { width:100%;
    height:100%; object-fit:cover; display:block; border-radius:50% }`. Comment each site with
    quick-261102-rrb.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && export PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH && pnpm check && pnpm test</automated>
  </verify>
  <done>Combobox/listbox/option roles + aria-activedescendant wired, arrow/Enter/Escape work, live region announces status, avatars are lazy <img> over gradient; pnpm check and pnpm test green.</done>
</task>

</tasks>

<threat_model>
| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-rrb-01 | Tampering | artist avatar <img src> | mitigate | tile.image comes from the existing Last.fm/Deezer pipeline (safeImageUrl-gated server side); render as an <img src> attribute (not CSS url()) with referrerpolicy=no-referrer |
| T-rrb-02 | Tampering | onColor(hex) from settings | accept | malformed input returns '#ffffff', never throws; value only reaches a CSS custom property |
</threat_model>

<verification>
- `pnpm check` and `pnpm test` green (Node 24 PATH).
- Optional browser check on the dev server (4321/5173): light theme skeleton visible; Tab into search shows ring; arrow keys move highlight in typeahead.
</verification>

<success_criteria>
All 9 audit findings fixed as specified; out-of-scope size/radius advisories untouched; no new i18n keys; nothing pushed.
</success_criteria>

<output>
Create `.planning/quick/261102-rrb-search-page-audit-fixes-on-primary-contr/261102-rrb-SUMMARY.md` (list on-primary sites changed vs skipped, and the final light border hex + ratio).
</output>
