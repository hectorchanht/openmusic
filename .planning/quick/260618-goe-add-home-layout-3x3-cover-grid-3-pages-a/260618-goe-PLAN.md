---
phase: quick-260618-goe
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/home-layout.ts
  - src/lib/services/home-layout.test.ts
  - src/lib/config/defaults.ts
  - src/lib/stores/settings.svelte.ts
  - src/lib/stores/settings.svelte.test.ts
  - src/lib/components/CompactRow.svelte
  - src/lib/components/HomeGridPager.svelte
  - src/routes/(app)/+page.svelte
  - src/routes/(app)/settings/home/+page.svelte
  - src/routes/(app)/settings/appearance/+page.svelte
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
autonomous: true
requirements: []

must_haves:
  truths:
    - "A returning user whose persisted homeDensity was 'compact' / 'comfortable' sees the SAME layout after the rename (migrated to 'list' / 'pile')"
    - "The Settings → Home tile-density toggle offers THREE modes (list, pile, grid) per-section and globally, with the Grid3x3 lucide icon for grid"
    - "A section set to 'grid' renders a 3×3 paginated cover grid: 9 tiles/page, max 3 pages (27 tiles), title+artist overlaid on each cover bottom, with a dot page indicator"
    - "Adjusting the Cover Size slider visibly resizes the compact (.crow) cover-tile art on the home page"
    - "Both the Cover Size slider and the Home Grid Columns control show a live preview that reflects the current value as the user drags"
  artifacts:
    - path: "src/lib/services/home-layout.ts"
      provides: "HomeDensity union renamed to 'list' | 'pile' | 'grid'; resolveSectionDensity accepts the 3 values"
      contains: "type HomeDensity"
    - path: "src/lib/components/HomeGridPager.svelte"
      provides: "3x3 paginated cover grid with dot indicator (max 27 tiles)"
    - path: "src/lib/components/CompactRow.svelte"
      provides: ".crow .art sized via --cover-scale"
  key_links:
    - from: "src/lib/stores/settings.svelte.ts load()"
      to: "homeDensity / homeSectionDensity migration"
      via: "old-value → new-value remap"
      pattern: "compact.*list|comfortable.*pile"
    - from: "src/routes/(app)/+page.svelte densityOf"
      to: "HomeGridPager"
      via: "density === 'grid' render branch"
      pattern: "grid"
    - from: "src/lib/components/CompactRow.svelte .art"
      to: "--cover-scale"
      via: "calc(40px * var(--cover-scale, 1))"
      pattern: "cover-scale"
---

<objective>
Add a THIRD home layout mode — a YouTube-Music "Speed dial" 3×3 paginated cover grid (9 tiles/page, max 3 pages / 27 tiles, title+artist overlaid on each cover) — selectable per-section and globally via the existing density toggle, AND fix the cover-tile ("crow") art size so it actually responds to the Cover Size setting, with live demo previews under the Cover Size and Home Grid Columns controls.

Purpose: Give users a denser, more visual home browsing mode (matching the YT-Music reference) and make the existing cover-size control actually work on compact tiles, with immediate visual feedback in settings.

Output: Renamed `HomeDensity` union (`list` | `pile` | `grid`) with non-destructive localStorage migration; a reusable `HomeGridPager` component; the `.crow` art wired to `--cover-scale`; live previews in Appearance settings.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260618-goe-add-home-layout-3x3-cover-grid-3-pages-a/260618-goe-CONTEXT.md

NOTE: CLAUDE.md is stale. The live app is SvelteKit + Svelte 5 runes under `src/`, NOT `index.html`. This is a runes codebase: use `$state`, `$derived`, `$props`, snippets, and the home-layout pure-helper + load-guard robustness posture (every persisted value is type-guarded on load; render-time resolvers clamp garbage to a never-blank fallback).

<interfaces>
Current density type (src/lib/services/home-layout.ts:205):
```typescript
export type HomeDensity = 'comfortable' | 'compact';
export function resolveSectionDensity(
  sectionId: HomeSectionId,
  perSection: Partial<Record<HomeSectionId, HomeDensity>> | undefined,
  globalDefault: HomeDensity
): HomeDensity
```
Rename target (LOCKED): `'compact' → 'list'`, `'comfortable' → 'pile'`, NEW `'grid'`.

Home render density resolver (src/routes/(app)/+page.svelte:573):
```typescript
function densityOf(id: HomeSectionId): 'comfortable' | 'compact' {
  return resolveSectionDensity(id, settings.homeSectionDensity, 'compact');
}
```
`compactSlice` caps items to `Math.ceil(clampShelfSize(homeShelfSize)/4)*4`.

Reusable shelf snippets (src/routes/(app)/+page.svelte): `discoveryShelf(items, compact)`, `libraryShelf(tracks, compact)`, plus the top-artists / fav-artists inline branches. Each currently branches `compact ? <CompactPager> : <albumrow>`.

CompactRow `.art` (src/lib/components/CompactRow.svelte:154) is fixed `width:40px; height:40px` — it does NOT reference `--cover-scale`. By contrast `.album`/`.al-cover` in +page.svelte DO use `calc(130px * var(--cover-scale, 1))`. THIS is the root cause of decision #3: the crow art ignores cover size.

Existing fallback-grid markup to reuse for grid tiles (+page.svelte:686-698): `.grid > .tile > (.art + .scrim + .label > .t-title + .t-artist)`. CSS at +page.svelte:1009-1022.

applyTheme() (settings.svelte.ts:391-392) already sets `--cover-scale` and `--home-grid-cols` on `<html>`.

i18n: `en` is the source dictionary; its keys define `TranslationKey` so a missing key is a compile error. 15 locale files carry `settings.densityComfortable` / `settings.densityCompact`. `t()` is reactive.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Rename HomeDensity to list/pile/grid with non-destructive migration</name>
  <files>src/lib/services/home-layout.ts, src/lib/services/home-layout.test.ts, src/lib/config/defaults.ts, src/lib/stores/settings.svelte.ts, src/lib/stores/settings.svelte.test.ts</files>
  <behavior>
    - resolveSectionDensity returns a valid per-section value when it is exactly 'list', 'pile', or 'grid'; any other input (missing key, undefined map, garbage) falls back to globalDefault.
    - A persisted homeDensity of legacy 'compact' migrates to 'list'; legacy 'comfortable' migrates to 'pile'; an already-new value or 'grid' passes through; garbage falls back to the default.
    - A persisted homeSectionDensity map with legacy values { tags: 'comfortable', countries: 'compact' } migrates per-entry to { tags: 'pile', countries: 'list' }; entries with garbage values are dropped (object-not-array guard still applies to the map itself).
  </behavior>
  <action>
    In home-layout.ts: change `export type HomeDensity = 'comfortable' | 'compact'` to `'list' | 'pile' | 'grid'`. Update the resolveSectionDensity guard so the override wins only when the value is one of the three new values (replace the `v === 'comfortable' || v === 'compact'` check with a check against the three new literals — prefer a `const DENSITY_VALUES = ['list','pile','grid'] as const` set + `.includes` so it stays self-documenting). Update the doc comment to drop the obsolete 'compact'/'comfortable' references and describe list/pile/grid. Export a pure migration helper `migrateDensity(v: unknown): HomeDensity | undefined` that maps legacy 'compact'→'list', 'comfortable'→'comfortable'... NO: map 'compact'→'list', 'comfortable'→'pile', passes through 'list'/'pile'/'grid', returns undefined for anything else (callers decide the fallback). Keep this helper PURE (home-layout imports nothing) so the node Vitest project can drive it.

    In defaults.ts: change `homeDensity: 'comfortable' as HomeDensity` to `homeDensity: 'pile' as HomeDensity` (preserves today's default look — 'comfortable' was the legacy default). homeSectionDensity stays `{}`.

    In settings.svelte.ts load(): replace the bare `this.homeDensity = (v.homeDensity as HomeDensity) ?? HOME_DEFAULTS.homeDensity` with `this.homeDensity = migrateDensity(v.homeDensity) ?? HOME_DEFAULTS.homeDensity` (import migrateDensity). For homeSectionDensity: after the existing object-not-array guard, map each entry through migrateDensity, dropping entries whose value migrates to undefined (build a fresh object). Import migrateDensity from home-layout. Do NOT change the save() shape (it persists the live, already-migrated values).

    In settings.svelte.test.ts: update the homeSectionDensity describe block's literals from 'comfortable'/'compact' to the new values where they assert the STORED-value outcome, and add migration assertions: a stored homeDensity 'compact' → 'list' and 'comfortable' → 'pile'; a stored homeSectionDensity { tags: 'comfortable' } → { tags: 'pile' }. Drive migrateDensity directly (it is pure) since load() is a no-op in the node project — mirror the existing pattern of replicating the load-guard logic in the test.

    In home-layout.test.ts: update the resolveSectionDensity describe block to use the new values ('pile' wins over 'list' default, garbage falls back, etc.) and add a `migrateDensity` describe block covering the four cases (legacy compact→list, legacy comfortable→pile, passthrough grid/list/pile, garbage→undefined).
  </action>
  <verify>
    <automated>npx vitest --run src/lib/services/home-layout.test.ts src/lib/stores/settings.svelte.test.ts</automated>
  </verify>
  <done>HomeDensity is 'list' | 'pile' | 'grid'; migrateDensity maps legacy values; load() migrates both homeDensity and homeSectionDensity; tests pass. A returning user's old 'compact'/'comfortable' values resolve to 'list'/'pile'.</done>
</task>

<task type="auto">
  <name>Task 2: Build HomeGridPager (3×3 paginated cover grid) and fix the crow art size</name>
  <files>src/lib/components/HomeGridPager.svelte, src/lib/components/CompactRow.svelte</files>
  <action>
    CROW FIX (decision #3): In CompactRow.svelte `.art` CSS, replace the fixed `width: 40px; height: 40px` with `width: calc(40px * var(--cover-scale, 1)); height: calc(40px * var(--cover-scale, 1))`. This mirrors how `.album`/`.al-cover` already scale in +page.svelte, so the compact-mode cover tiles now respond to the Cover Size setting (applyTheme already sets `--cover-scale` on `<html>`). Leave the `.art.round` radius and all other rules unchanged.

    Create HomeGridPager.svelte — a generic `<script lang="ts" generics="T">` component mirroring CompactPager's prop shape so the host reuses its existing row-snippet idiom:
      - Props: `items: T[]`, `key: (item: T) => string`, `row: Snippet<[T]>`.
      - Cap to MAX 27 tiles (3 pages × 9): `const capped = $derived(items.slice(0, 27))`.
      - Chunk into PAGES of 9: `$derived.by` producing `T[][]`, 9 per page (last page may be short).
      - Render a horizontal scroll-snap track (`scroll-snap-type: x mandatory`, hidden scrollbar — copy CompactPager's `.pager` posture) where each PAGE is a flex item `flex: 0 0 100%` (full content width, device-width-sized per decision: the grid fills available width, NO size slider) with `scroll-snap-align: start`. Inside each page, a `display: grid; grid-template-columns: repeat(3, 1fr); gap` block renders the page's items via `{@render row(item)}` keyed by `key(item)`.
      - Below the track, render a dot page indicator (one dot per page) ONLY when pages > 1 — like the screenshot's 3 dots. Track the active page reactively: bind a local `let activePage = $state(0)` updated from the scroll track's `onscroll` (compute `Math.round(scrollLeft / clientWidth)`). Highlight the active dot with the accent color. Dots are presentational (aria-hidden) — the scroll track itself is the control.
      - Match the project CSS-var/token conventions (`var(--color-primary)`, `var(--radius-*)`, etc.) and the reduce-motion-safe, scrollbar-hidden posture of CompactPager.
    Do NOT render the tile internals here — the host supplies the `row` snippet (the reused .tile markup) in Task 3, keeping HomeGridPager layout-only.
  </action>
  <verify>
    <automated>npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "HomeGridPager|CompactRow" || echo "no errors in new/edited components"</automated>
  </verify>
  <done>HomeGridPager.svelte exists: caps at 27 items, chunks into pages of 9, renders a 3-col grid per page with scroll-snap + a dot indicator for >1 page. CompactRow `.art` uses `calc(40px * var(--cover-scale, 1))`. svelte-check reports no errors for these files.</done>
</task>

<task type="auto">
  <name>Task 3: Wire grid mode into the home render and the Settings → Home toggle</name>
  <files>src/routes/(app)/+page.svelte, src/routes/(app)/settings/home/+page.svelte</files>
  <action>
    HOME RENDER (+page.svelte):
      - Import HomeGridPager and the `Grid3x3` lucide icon (the icon is only needed in settings, but import HomeGridPager here).
      - Change `densityOf` return type from `'comfortable' | 'compact'` to `HomeDensity` (import the type) and update its globalDefault: it currently passes `'compact'` — change to `'list'` (the migrated equivalent of today's compact-by-default). It returns whatever resolveSectionDensity yields ('list' | 'pile' | 'grid').
      - Update the `section.compact` class binding on the top-level `<section>`: it currently does `class:compact={settings.homeDensity === 'compact'}`. Change the literal to `'list'`. (The `.section.compact` CSS still keys off `.compact`; keep the class name OR rename to `.list` consistently — simplest: keep the `compact` class name, just compare against `'list'`.)
      - Add a reusable grid snippet `gridShelf(items, kind)` OR extend `discoveryShelf`/`libraryShelf` to take the density value instead of a boolean. Cleanest with least churn: change `discoveryShelf(items, compact)` and `libraryShelf(tracks, compact)` to accept `density: HomeDensity` (rename the param), and inside branch: `{#if density === 'list'}<CompactPager .../>{:else if density === 'grid'}<HomeGridPager .../>{:else}<albumrow .../>{/if}`. Update every caller (`densityOf('top-hits') === 'compact'` → `densityOf('top-hits')`, etc.) to pass the density value, NOT a boolean.
      - For the GRID branch in discoveryShelf: render HomeGridPager with `items={items.slice(0,27)}` (the component also caps, belt-and-braces), `key={(item) => item.artist + ' ' + item.title}`, and a `row` snippet using the REUSED `.tile` markup (decision: reuse `.tile/.scrim/.label/.t-title/.t-artist`). The tile button calls `playStub(item)` on click and `tileMenu(item)` on long-press (mirror the existing fallback `.tile` handlers and the existing `discoveryShelf` tap behavior), shows `tileCover(item)` as a lazy `<img>` over the `fallbackCover(...)` gradient (mirror the fallback grid's cover render so a 404 degrades), and `names.dnTitle` / `names.dnArtist` in `.t-title` / `.t-artist`.
      - For the GRID branch in libraryShelf: same .tile markup but keyed by `track.uid`, click → `playLibraryTrack(track)`, long-press → `openTrackMenu(track)`, cover via `libraryRowCover(track)` (with `use:lazyCover` like librarySongRow). Use the existing fallbackCover/marquee patterns.
      - For the top-artists and fav-artists inline branches (which currently do `if densityOf(..) === 'compact' { CompactPager } else { albumrow }`): add a `grid` arm. Reuse the ROUND-cover `.tile`-style grid via HomeGridPager with a round-avatar tile (artist tiles are name-only, round). Keep it simple: render the artist name centered under/over a round cover tile. If reusing the square `.tile` look is cleaner, the artist grid tile may use the existing round `.al-cover.round` treatment inside a grid cell — pick the approach that reuses the most existing CSS and document the choice in the SUMMARY.
      - The `.tile` / `.scrim` / `.label` / `.t-title` / `.t-artist` CSS already exists in +page.svelte; the grid tiles reuse it. If HomeGridPager needs the tile to fill the cell, ensure the `.tile` aspect-ratio:1/1 + the grid's `1fr` columns size it to device width (no per-tile size var — grid is device-width-sized per decision).

    SETTINGS → HOME (settings/home/+page.svelte):
      - Add `Grid3x3` to the `@lucide/svelte` import.
      - Extend the `densities` array to three entries: `{ v: 'list', key: 'settings.densityList' }`, `{ v: 'pile', key: 'settings.densityPile' }`, `{ v: 'grid', key: 'settings.densityGrid' }` (new i18n keys added in Task 4). Update the `HomeDensity` type usage (already imported).
      - Update `sectionDensity(id)`: the absent-key fallback is now 'list' (was 'compact'); validate against the three new values.
      - Update the per-section density segment icon map: list → `TableOfContents` (today's compact icon), pile → `DiscAlbum` (today's comfortable icon), grid → `Grid3x3`. Replace the `if d.v === 'comfortable' / 'compact'` icon branches accordingly and remove the dead fallback comment.
      - Update the GLOBAL "Tile density" segmented control (section 6): it iterates `densities` and shows `{t(d.key)}` text — now three buttons. `setDensity(v)` already takes a HomeDensity; no signature change.
      - Keep aria-labels meaningful (`${section} · ${mode}`) using the new keys.
  </action>
  <verify>
    <automated>npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "\(app\)/\+page|settings/home" || echo "no errors in home/settings-home"</automated>
  </verify>
  <done>densityOf returns 'list'|'pile'|'grid'; discoveryShelf/libraryShelf and the artist branches render HomeGridPager for 'grid'; the Settings → Home toggle offers all three modes per-section and globally with the Grid3x3 icon for grid; svelte-check clean for these files.</done>
</task>

<task type="auto">
  <name>Task 4: Add i18n keys + live demo previews under Cover Size and Home Grid Columns</name>
  <files>src/routes/(app)/settings/appearance/+page.svelte, src/lib/i18n/en.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/de.ts, src/lib/i18n/pt.ts, src/lib/i18n/it.ts, src/lib/i18n/ru.ts, src/lib/i18n/tr.ts, src/lib/i18n/ar.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/vi.ts, src/lib/i18n/th.ts</files>
  <action>
    I18N (decision #2, canonical_refs): add three keys to EVERY locale dict (en is the source — its keys define TranslationKey, so all 15 dicts must carry them or `t()` falls back to en). Add, next to the existing `settings.densityComfortable` / `settings.densityCompact` entries:
      - `settings.densityList` — English "List" (the stacked compact rows; was Compact).
      - `settings.densityPile` — English "Pile" (the larger cover shelf; was Comfortable).
      - `settings.densityGrid` — English "Grid" (the new 3×3 cover grid).
    Translate appropriately per locale (use the existing density translations as a guide: densityList ≈ the old Compact translation, densityPile ≈ the old Comfortable translation; densityGrid = the locale word for "Grid"). Keep the OLD `densityComfortable`/`densityCompact` keys in place if anything still references them; remove them only if grep confirms NO remaining references after Task 3 — prefer leaving them to avoid breaking other call sites, but the new toggle uses the new keys.

    LIVE DEMOS (decision #4) — appearance/+page.svelte. The existing Appearance Layout section has the Cover Size slider and the Home Grid Columns slider with NO preview. Add a small live demo under EACH, mirroring the `.prev` pattern already used by the font sliders:
      - Under Cover Size: render 3 small mock cover tiles in a row whose box size is `calc(56px * var(--cover-scale, 1))` (or read settings.coverScale/100 inline) so they grow/shrink live as the slider moves — exactly the relationship the crow fix now uses (`--cover-scale`). Use fallback gradient backgrounds (reuse a simple inline `linear-gradient`) — no network covers needed. This demonstrates the crow-size effect the user just enabled.
      - Under Home Grid Columns: render a mock grid `display: grid; grid-template-columns: repeat(N, 1fr)` where N = `settings.homeGridCols`, with ~6 small square placeholder cells, so the column count visibly changes live as the slider moves (matches the `.grid` `--home-grid-cols` behavior on home).
      - Keep both demos compact, token-styled (`var(--color-surface-2)`, `var(--radius-*)`), and aria-hidden (they are visual aids). Add a tiny muted caption above each demo via existing `.note`/`.prev` styling or a new minimal style block.
    Do not add new settings — these are pure visual previews of existing `coverScale` / `homeGridCols`.
  </action>
  <verify>
    <automated>npx vitest --run src/lib/i18n/i18n.test.ts && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "appearance|i18n" || echo "i18n + appearance clean"</automated>
  </verify>
  <done>All 15 locales carry densityList/densityPile/densityGrid; the i18n parity test passes; the Appearance page shows a live cover-size demo (tiles scale with the slider) and a live grid-columns demo (column count changes with the slider). svelte-check clean.</done>
</task>

</tasks>

<verification>
- `npm test` (full vitest run) passes — no regressions in home-layout, settings, or i18n suites.
- `npx svelte-check --tsconfig ./tsconfig.json` reports no NEW errors.
- Manual smoke (dev server, strictPort 4321): Settings → Home shows three density modes per-section + global with the Grid3x3 icon; setting a section to Grid renders a 3×3 paginated grid (dots appear for >9 items, capped at 27); Cover Size slider visibly resizes compact home tiles; Appearance page shows both live demos.
- Migration: a localStorage `openmusic:settings:v1` blob with `homeDensity:'comfortable'` loads as 'pile'; `'compact'` loads as 'list'; `homeSectionDensity` legacy values migrate per-entry.
</verification>

<success_criteria>
- HomeDensity union is `'list' | 'pile' | 'grid'` with a pure, tested `migrateDensity` helper and non-destructive load() migration for both `homeDensity` and `homeSectionDensity`.
- A reusable `HomeGridPager` renders 9 tiles/page, max 3 pages (27 tiles), with a dot indicator, reusing the existing `.tile/.scrim/.label` look.
- The compact-mode `.crow` cover art responds to the Cover Size setting via `--cover-scale`.
- Settings → Home offers all three modes per-section and globally (Grid3x3 icon for grid).
- Live demos under Cover Size and Home Grid Columns reflect the current value as the user drags.
- All locked CONTEXT.md decisions (#1 grid mode, #2 rename+migration, #3 crow size, #4 demos) are implemented exactly.
</success_criteria>

<output>
Create `.planning/quick/260618-goe-add-home-layout-3x3-cover-grid-3-pages-a/260618-goe-SUMMARY.md` when done.
</output>
