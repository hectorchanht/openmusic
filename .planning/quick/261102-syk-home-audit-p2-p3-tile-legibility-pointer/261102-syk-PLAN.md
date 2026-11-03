---
phase: quick-261102-syk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/shelf-scroll.ts
  - src/lib/components/shelf-scroll.test.ts
  - src/lib/components/HomeGridPager.svelte
  - src/routes/(app)/+page.svelte
autonomous: true
requirements: [HOME-AUDIT-P2, HOME-AUDIT-P3]
must_haves:
  truths:
    - "Grid tile title/artist text reads at ~4.5:1 over a white cover (scrim plateau ~0.8 through the label band + text-shadow)"
    - "On a mouse, hovering a grid or pile SONG tile shows a dark circular ⋮ button; clicking it opens the same TrackMenu as long-press; tabbing to the tile then Tab reaches the ⋮; album and artist tiles get no ⋮; touch-only devices never see it"
    - "At a 1280px window a grid shelf shows 2 rows (cols > 3); any phone width still shows 3 rows x 3 cols with byte-identical page size 9"
    - "The grid shelf placeholder renders the same column count and row count as the real HomeGridPager would, so a loaded shelf does not jump in height"
    - "The Songs-of-the-Year card rail starts flush with the shelf headings (no second 16px inset)"
    - "Pile covers and placeholder covers use 8px radius; skeleton bars use --radius-sm; Randomize/Retry hit area is a true 48x48"
  artifacts:
    - path: "src/lib/components/shelf-scroll.ts"
      provides: "gridRowsPerPage(cols) pure helper"
      exports: ["gridRowsPerPage"]
    - path: "src/lib/components/shelf-scroll.test.ts"
      provides: "gridRowsPerPage cases + updated honest-page-size test"
      contains: "gridRowsPerPage"
    - path: "src/lib/components/HomeGridPager.svelte"
      provides: "tilesPerPage = cols * gridRowsPerPage(cols)"
      contains: "gridRowsPerPage(cols)"
    - path: "src/routes/(app)/+page.svelte"
      provides: "tilewrap + tileMenuBtn snippet on 5 song-tile sites, stronger scrim, placeholder column maths, D/E/G CSS polish"
      contains: "tileMenuBtn"
  key_links:
    - from: "src/lib/components/HomeGridPager.svelte"
      to: "src/lib/components/shelf-scroll.ts"
      via: "import { gridColumns, gridRowsPerPage }"
      pattern: "gridRowsPerPage"
    - from: "src/routes/(app)/+page.svelte"
      to: "TrackMenu open handlers (tileMenu / openTrackMenu / menuTrack+menuOpen)"
      via: "{@render tileMenuBtn(() => ...)} sibling of each song tile button"
      pattern: "@render tileMenuBtn"
    - from: "src/routes/(app)/+page.svelte shelfPlaceholder"
      to: "src/lib/components/shelf-scroll.ts"
      via: "gridColumns(phWidth) * gridRowsPerPage(cols) cells, bind:clientWidth"
      pattern: "gridColumns\\(phWidth\\)"
---

<objective>
Close the remaining P2/P3 findings of the Home page audit (quick 261102-sfc shipped the P1s): grid tile text legibility over bright art, a pointer/keyboard ⋮ affordance on grid + pile SONG tiles, 2-row grid shelves on desktop, a placeholder that matches the real grid shape, and small alignment / radius / hit-area polish.

Purpose: Home tiles must stay readable over any cover, mouse + keyboard users must be able to reach the track menu without knowing the long-press gesture, and a 1280px window must not spend a whole viewport on one shelf.
Output: three commits on `main` touching only the four files above.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@./DESIGN.md
@/Users/laichan/.claude/skills/impeccable/reference/craft-floor.md
@.planning/quick/261102-sfc-home-audit-p1-fixes-tile-size-rename-laz/261102-sfc-SUMMARY.md
@src/lib/components/shelf-scroll.ts
@src/lib/components/shelf-scroll.test.ts
@src/lib/components/HomeGridPager.svelte
@src/lib/components/CompactRow.svelte

**Executor constraints (non-negotiable):**
- OTHER SESSIONS COMMIT CONCURRENTLY on this worktree (`main`, unrelated dirty files). Before touching a file run `git status --short -- <file>`; if any of the four target files already carries someone else's uncommitted edits, STOP and report. Stage and commit with `git commit -- <exact paths>` only. Never `git add -A`, `git add .`, `git commit -a`.
- Node: prefix every command with `PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH`.
- Verify with `pnpm check` (judge only errors in the four touched files; other sessions' dirty files may error) and `pnpm test -- src/lib/components src/lib/services/home-layout src/lib/i18n`.
- House style: tabs; every new rule / markup block gets a `quick-261102-syk:` comment; keep every existing decision-ref comment (`D-06`, `MENU-03 / D-12`, `WR-01`, `quick-260919-et3`, `quick-261102-sfc`, ...).
- No new i18n keys: reuse `menu.options` (exists in all 15 locales). If you must add one, add it to all 15 `src/lib/i18n/*.ts` files with DOUBLE quotes.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Do NOT push.
- Read `craft-floor.md` before the UI edits (contrast >= 4.5:1 body text, states: hover/focus, 44px hit).

<interfaces>
<!-- Extracted from the codebase. Use directly; do not re-explore. -->

From src/lib/components/shelf-scroll.ts (current):
```ts
export const GRID_ROWS_PER_PAGE = 3;
const GRID_MIN_COLS = 3; const GRID_TILE_MIN = 180; const GRID_GAP = 10;
export function gridColumns(width: number): number; // >=3; 750px track -> 4; 1684px -> 8
```

From src/lib/components/HomeGridPager.svelte (current):
```ts
import { gridColumns, GRID_ROWS_PER_PAGE } from './shelf-scroll';
let cols = $state(gridColumns(0));                // ResizeObserver on .track sets it
const tilesPerPage = $derived(cols * GRID_ROWS_PER_PAGE);
// .page { grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr)); gap: 10px; }
```

From src/lib/components/CompactRow.svelte (the ⋮ to mirror, line 192):
```svelte
<button class="opt" aria-label={t('menu.options')} onclick={() => onrequestmenu?.()}>
	<MoreVertical size={18} />
</button>
<!-- .opt: 44x44, display:grid, place-items:center, border-radius: var(--radius-full) -->
```

From src/routes/(app)/+page.svelte — the five SONG tile sites that get a ⋮ (line numbers approximate):
| # | site | element | menu handler to call |
|---|------|---------|----------------------|
| 1 | fallback grid (`{:else if useFallback}` `.grid`), ~L1249 | `<button class="tile">` | `menuTrack = track; menuOpen = true` |
| 2 | `discoveryShelf` grid branch inside `<HomeGridPager>`, ~L1455 | `<button class="tile">` | `tileMenu(item)` |
| 3 | `discoveryShelf` pile branch `.albumrow`, ~L1471 | `<button class="album">` | `tileMenu(item)` |
| 4 | `librarySongRow` snippet (pile), ~L1650 | `<button class="album">` | `menuTrack = track; menuOpen = true` |
| 5 | `libraryShelf` grid branch inside `<HomeGridPager>`, ~L1677 | `<button class="tile">` | `openTrackMenu(track)` |
NOT touched: `albumShelf` grid/pile tiles (album, no menu), `artistGridTile`, `artistShelf` pile tiles.

Relevant CSS in +page.svelte `<style>` (line numbers approximate):
- L1849 `.cs-bar { height: 11px; border-radius: 5px; }`
- L1857 `.ph-cover { ...; border-radius: 10px; }`; L1861 `.ph-cell { aspect-ratio: 1/1; border-radius: var(--radius-md); }`
- L1864-1873 `.more, .retry { ... width: 40px; height: 40px; border: 1px solid ...; position: relative; }` + `.more::after, .retry::after { content: ''; position: absolute; inset: -4px; }`
- L1885 `.albumrow { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 4px; }`
- L1891 `.album { flex: 0 0 calc(130px * var(--cover-scale, 1)); min-width: 0; max-width: calc(130px * var(--cover-scale, 1)); ... display: flex; flex-direction: column; gap: 4px; }`
- L1895 `.al-cover { ...; border-radius: 10px; ... }`
- L1916 `.grid { display: grid; grid-template-columns: repeat(var(--home-grid-cols, 3), 1fr); gap: 12px; }` (+ `@media (min-width:1024px)` auto-fill override at ~L1945)
- L1917 `.tile { position: relative; aspect-ratio: 1/1; border-radius: var(--radius-md); overflow: hidden; ... }`
- L1925 `.scrim { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 55%); }`
- L1926-1928 `.label { position:absolute; left:7px; right:7px; bottom:6px; }` `.t-title { 0.6875rem; #fff; 2-line clamp }` `.t-artist { 0.625rem; #d8d8de; opacity: .85 }`
- L1929 `.q { position: absolute; top: 6px; right: 6px; ... border-radius: 4px; }` (only the fallback grid renders `.q`)
- L1949 `.soy-regions { display: flex; gap: 12px; overflow-x: auto; padding: 4px 16px 16px; ... }`
- `src/app.css` L110: `* { box-sizing: border-box; }` (root cause of G, see Task 3)

Known pre-existing bug to fix while restructuring site 4: L1650 ends with `onclick={() => playLibraryTrack(track, ctx)}>>` — the second `>` is a literal text node inside the flex-column button (introduced in 9d75b6a2). Drop it.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Width-dependent grid rows per page (finding C)</name>
  <files>src/lib/components/shelf-scroll.ts, src/lib/components/shelf-scroll.test.ts, src/lib/components/HomeGridPager.svelte</files>
  <behavior>
    - gridRowsPerPage(3) === 3 (mobile: untouched 3x3)
    - gridRowsPerPage(4) === 2, gridRowsPerPage(8) === 2 (any track wider than the 3-column floor)
    - gridRowsPerPage(gridColumns(0)) === 3 and gridRowsPerPage(gridColumns(NaN)) === 3 (unmeasured falls back to the mobile shape)
    - page size: gridColumns(343) * gridRowsPerPage(gridColumns(343)) === 9; for 888 -> 4 * 2 = 8; for 1684 -> 8 * 2 = 16
  </behavior>
  <action>
    In `shelf-scroll.ts`, next to `gridColumns`, add and export `gridRowsPerPage(cols: number): number` returning `GRID_ROWS_PER_PAGE` (3) when `cols <= GRID_MIN_COLS`, else `2`. Add a `GRID_ROWS_PER_PAGE_WIDE = 2` module constant (not exported) and a `quick-261102-syk` comment stating the reason: at 1280px a 6x3 grid is ~580px, one shelf per viewport; phones resolve to 3 columns so they keep 3 rows by construction (same guarantee `gridColumns` already documents). Keep `GRID_ROWS_PER_PAGE` exported and unchanged.

    In `shelf-scroll.test.ts`, add a `describe('gridRowsPerPage — desktop shelves are 2 rows')` block with the behavior cases above, and update the existing "derives an honest page size" test to use `gridColumns(w) * gridRowsPerPage(gridColumns(w))` for 343 (9), 888 (8) and 1684 (16) so the dots-count invariant is still asserted against the real formula.

    In `HomeGridPager.svelte`, import `gridRowsPerPage` (keep `gridColumns`; drop the `GRID_ROWS_PER_PAGE` import if no longer used) and change `tilesPerPage` to `$derived(cols * gridRowsPerPage(cols))`. Update the header comment paragraph that says "cols × GRID_ROWS_PER_PAGE" to say rows are width-dependent too (3 on the mobile 3 columns, 2 when wider), tagged `quick-261102-syk`. Nothing else in the component changes: `.page` uses `align-content: start`, so a 2-row page simply renders shorter.

    Commit: `feat(quick-261102-syk): 2-row grid shelves on desktop, gridRowsPerPage` with `git commit -- src/lib/components/shelf-scroll.ts src/lib/components/shelf-scroll.test.ts src/lib/components/HomeGridPager.svelte`.
  </action>
  <verify>
    <automated>PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH pnpm test -- src/lib/components/shelf-scroll && grep -c "gridRowsPerPage(cols)" src/lib/components/HomeGridPager.svelte | grep -q "^1$"</automated>
  </verify>
  <done>`gridRowsPerPage` exported and covered; shelf-scroll tests pass; HomeGridPager derives tilesPerPage from `cols * gridRowsPerPage(cols)`; committed with path-limited commit.</done>
</task>

<task type="auto">
  <name>Task 2: Pointer/keyboard ⋮ on song tiles + placeholder grid shape (findings B, F)</name>
  <files>src/routes/(app)/+page.svelte</files>
  <action>
    **B — tile menu affordance.** Add `MoreVertical` to the `@lucide/svelte` import. Define one snippet near `titleNav`:

    `{#snippet tileMenuBtn(open: () => void)}` rendering `<button type="button" class="tilemenu" aria-label={t('menu.options')} title={t('menu.options')} onclick={open}><MoreVertical size={18} /></button>` with a `quick-261102-syk` comment explaining: grid/pile song tiles are themselves `<button>`s so the ⋮ cannot nest; it is an absolutely-positioned SIBLING inside a `.tilewrap` wrapper, mirrors CompactRow's `.opt` (same label/icon), and is the pointer/keyboard route to the same menu the long-press / right-click already opens (MENU-03 / D-12 keep long-press as the touch gesture).

    Wrap each of the five SONG tile sites listed in `<interfaces>` as `<div class="tilewrap"> <button class="tile|album" ...unchanged...>...</button> {@render tileMenuBtn(() => HANDLER)} </div>` where HANDLER is the site's existing long-press body WITHOUT the `.blur()` (sites 1 and 4: `{ menuTrack = track; menuOpen = true; }`; site 2 and 3: `tileMenu(item)`; site 5: `openTrackMenu(track)`). Leave `use:tapBounce`, `use:longpress`, `onlongpress`, `oncontextmenu`, `onclick`, `use:lazyCover`, `{@const}` placement and the keyed `{#each}` exactly as they are — `{@const rowCover}` must stay the immediate child of the `{#each}` / snippet, so place the `<div class="tilewrap">` AFTER it. While editing site 4 (`librarySongRow`), remove the stray second `>` after `onclick={() => playLibraryTrack(track, ctx)}>` (it is a literal text node). Do NOT wrap album or artist tiles.

    CSS for the wrapper and button (all tagged `quick-261102-syk`):
    - `.tilewrap { position: relative; min-width: 0; }`
    - grid context: `.tilewrap > .tile { display: block; width: 100%; }` — as a grid cell child the wrapper stretches to the `minmax(0,1fr)` column; the button inside must fill it (a bare button is inline-block and would shrink-wrap). `aspect-ratio: 1/1` on `.tile` still sets the height.
    - pile context: move the flex sizing to the wrapper so `.albumrow`'s direct child keeps the 130px basis: `.albumrow > .tilewrap { flex: 0 0 calc(130px * var(--cover-scale, 1)); max-width: calc(130px * var(--cover-scale, 1)); }` and `.tilewrap > .album { width: 100%; }`. Keep the existing `.album` rule (its `flex:` becomes inert inside the wrapper; keep `min-width: 0` / `max-width` and the load-bearing comment above it). `.section.compact .album` (L1903) overrides the basis to 96px, so add `.section.compact .albumrow > .tilewrap { flex-basis: calc(96px * var(--cover-scale, 1)); max-width: calc(96px * var(--cover-scale, 1)); }` right after it (the `.al-cover` 96px rule on L1904 is unaffected).
    - `.tilemenu { position: absolute; top: 2px; right: 2px; width: 44px; height: 44px; display: grid; place-items: center; padding: 0; border: none; background: none; color: #fff; cursor: pointer; opacity: 0; visibility: hidden; transition: opacity 0.15s ease; z-index: 1; }` and `.tilemenu::before { content: ''; position: absolute; width: 32px; height: 32px; border-radius: var(--radius-full); background: rgba(0, 0, 0, 0.62); }` with `.tilemenu :global(svg) { position: relative; }` so the glyph paints above the backing (same `:global(svg)` idiom as `.more.spinning`). 44px hit, 32px visual dark circle that reads over any art.
    - Reveal: `@media (hover: hover) { .tilewrap:hover .tilemenu { opacity: 1; visibility: visible; } }` and, for every input type, `.tilewrap:has(:focus-visible) .tilemenu { opacity: 1; visibility: visible; }`. `visibility: hidden` removes the ⋮ from the tab order while hidden; a keyboard user Tabs onto the tile button (`:focus-visible` matches, wrapper `:has()` reveals the ⋮), then the next Tab lands on the now-visible ⋮, which keeps itself visible via its own `:focus-visible`. A touch tap does not match `:focus-visible` on a button, so touch-only devices never see it. Comment this reasoning in the CSS.
    - `.q` collision: the fallback grid's quality badge sits top-right where the ⋮ now lives. Change `.q` to `top: 6px; left: 6px;` (drop `right`), comment why.
    - Nothing in HomeGridPager / dragScroll needs changing: the ⋮ is outside the `.tile` (so `overflow: hidden` and `:active` scale do not affect it), dragScroll's capture-phase click suppressor still eats a post-drag click on it, and `.albumrow`'s `overflow-x: auto` does not clip it because it stays inside the wrapper's box.

    **F — placeholder grid shape.** Add `import { gridColumns, gridRowsPerPage } from '$lib/components/shelf-scroll';` and a page-level `let phWidth = $state(0);`. In `shelfPlaceholder`, add `bind:clientWidth={phWidth}` to the outer `<div class="ph">` (Svelte's built-in element-size binding; every placeholder shares the same content width so one variable is enough). In the grid branch replace the fixed `Array(9)` with `{@const phCols = gridColumns(phWidth)}` placed as the first child of the `{:else if density === 'grid'}` branch, then `<div class="grid ph-grid" style:--cols={phCols}>{#each Array(phCols * gridRowsPerPage(phCols)) as _, i (i)}<span class="sk ph-cell"></span>{/each}</div>`. CSS: `.ph-grid { grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr)); gap: 10px; }` placed AFTER the `@media (min-width: 1024px) .grid` override so it wins at desktop too (same specificity, later wins — or give it `.ph .ph-grid` to be explicit). Comment: mirrors HomeGridPager's `.page` column rule + `GRID_GAP` so a loaded shelf replaces the placeholder with the same column count, row count and tile size, no jump; `phWidth` 0 before first measure falls back to the mobile 3x3 via `gridColumns(0)`.

    Commit: `feat(quick-261102-syk): ⋮ on grid/pile song tiles for pointer+keyboard, placeholder matches grid maths` with `git commit -- "src/routes/(app)/+page.svelte"`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && F="src/routes/(app)/+page.svelte" && test "$(grep -v '^\s*<!--' "$F" | grep -c '@render tileMenuBtn(')" = "5" && test "$(grep -c '}>>' "$F")" = "0" && grep -q 'bind:clientWidth={phWidth}' "$F" && grep -q 'gridColumns(phWidth)' "$F" && grep -q 'tilewrap:has(:focus-visible)' "$F" && PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH pnpm check 2>&1 | grep -c "routes/(app)/+page.svelte.*Error" | grep -q "^0$"</automated>
  </verify>
  <done>Five song-tile sites wrapped with a sibling ⋮ calling the same menu handler as long-press; album/artist tiles untouched; stray `>>` gone; placeholder grid uses `gridColumns`/`gridRowsPerPage` cells with `--cols`; `pnpm check` reports no errors in `+page.svelte`; path-limited commit made.</done>
</task>

<task type="auto">
  <name>Task 3: Scrim legibility + alignment/radius/hit-area polish (findings A, D, E, G)</name>
  <files>src/routes/(app)/+page.svelte</files>
  <action>
    CSS-only pass in `<style>`, each change tagged `quick-261102-syk`:

    **A — scrim.** The label band (2-line title + artist + 6px bottom inset) covers roughly the bottom 40% of a 111px phone tile; the old gradient is already down to ~0.35 alpha there, so white text sat on near-raw art. Replace `.scrim`'s background with a plateau that holds through the label band then eases out: `linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.78) 40%, rgba(0,0,0,0) 78%)`. Add `text-shadow: 0 1px 2px rgba(0,0,0,0.7);` on `.label`. Set `.t-artist` to `opacity: 1; color: #e4e4ea;` (drop the .85 opacity: the colour already carries the hierarchy, and the opacity was eating contrast). Comment the maths: white (#fff) over 0.78-black on a pure-white cover gives ≈0.22 relative luminance behind the text → ≈4:1 on the raw gradient alone, the shadow lifts the worst-case (white art) past 4.5:1; on anything darker than white it is comfortably above. Applies to every `.tile` with a `.scrim` (discovery grid, album grid, library grid, fallback grid); artist tiles have no scrim and stay as they are.

    **D — SOY rail inset.** `.soy-regions { padding: 4px 0 16px; }` (was `4px 16px 16px`). The page gutter already sits on the section; the extra 16px pushed the first card 16px right of every shelf heading and `.albumrow`. Comment it.

    **E — radius drift.** `.al-cover` and `.ph-cover`: `border-radius: 10px` → `8px`. Justify in the comment: DESIGN.md `rounded.row` = 8px and "covers 8px in the Nowbar"; the 130px pile cover is the mid-size cover scale, while the grid `.tile` (≥111px up to ~200px, full-bleed art + overlay) stays on `--radius-md` 12px as the large-cover scale. Keep `.al-cover.round` / `.ph-cover.round` at 50%. `.cs-bar { border-radius: var(--radius-sm); }` (6px, was 5px). `.ph-bar` is already 6px — switch it to `var(--radius-sm)` too so it stays in step. Leave `.q` (4px / 0.5rem) alone — micro badge, intentionally off-scale; say so in the SUMMARY.

    **G — 46px hit area.** Root cause: `src/app.css` sets `* { box-sizing: border-box }`, so the 40px `.more`/`.retry` box includes its 1px border and the padding box is 38px; `position: absolute; inset: -4px` on `::after` is resolved against the PADDING box → 38 + 8 = 46. Change to `inset: -5px` (38 + 10 = 48) and update the P1 comment ("40 + 2×4 = 48" is wrong under border-box; it is `38 + 2×5`). The spinning svg and the `.head` row are not involved.

    Commit: `fix(quick-261102-syk): home tile scrim legibility, SOY rail flush, 8px pile covers, 48px Randomize/Retry hit` with `git commit -- "src/routes/(app)/+page.svelte"`. Then run the full verification below and write the SUMMARY.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && F="src/routes/(app)/+page.svelte" && grep -q 'rgba(0,0,0,0.78) 40%' "$F" && grep -q 'text-shadow: 0 1px 2px' "$F" && grep -q 'soy-regions {' "$F" && grep -A1 '\.soy-regions {' "$F" | grep -q 'padding: 4px 0 16px' && test "$(grep -c 'border-radius: 10px' "$F")" = "0" && test "$(grep -c 'border-radius: 5px' "$F")" = "0" && grep -q 'inset: -5px' "$F" && PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH pnpm test -- src/lib/components src/lib/services/home-layout src/lib/i18n 2>&1 | tail -5 | grep -q "passed"</automated>
  </verify>
  <done>Scrim plateau + text-shadow + full-opacity artist line in place; SOY rail has no horizontal padding; no 10px/5px radii remain in the file; `::after` inset is -5px; the component/home-layout/i18n test run passes; three path-limited commits exist on `main`, nothing pushed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| none new | Pure UI/CSS + a pure layout helper; no new input, network, or storage paths |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-syk-01 | Tampering | `.tilemenu` click handlers | accept | Calls existing `tileMenu` / `openTrackMenu` / `menuTrack` paths with the same closure data the long-press already uses; no new data flow |
| T-syk-02 | Denial of Service | `bind:clientWidth` on every placeholder | accept | One ResizeObserver per placeholder (a handful at most, cold-load only); orders of magnitude below the 1374-observer CompactRow case already documented in the file |
| T-syk-SC | Tampering | npm installs | accept | No package installs in this plan |
</threat_model>

<verification>
- `PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH pnpm test -- src/lib/components src/lib/services/home-layout src/lib/i18n` passes.
- `pnpm check`: zero errors in the four touched files (other sessions' dirty files may error; report them as not ours).
- `git log --oneline -3` shows the three `quick-261102-syk` commits; `git show --stat` of each lists only the plan's files.
- Visual spot-check (executor, if a dev server on :4321/:5173 is reachable; otherwise state "not verified" in the SUMMARY): at 1280px a grid shelf is 2 rows; hover a grid song tile → dark ⋮ circle top-right, click opens TrackMenu; hover an album/artist tile → no ⋮; Tab onto a tile then Tab → ⋮ focused and visible; 390px (touch emulation) → no ⋮; a light cover's title/artist text is readable; the SOY cards start flush with the heading.
</verification>

<success_criteria>
- A, B, C, D, E, F, G from the audit are each addressed by a committed change with a `quick-261102-syk` comment.
- Phones: grid page size stays 9 (3x3); desktop (cols > 3): 2 rows.
- Grid/pile SONG tiles expose a ⋮ to hover + keyboard users only; album/artist tiles do not.
- Placeholder grid shape is computed from the same column/row maths as the real grid.
- Only the four listed files change; commits are path-limited; nothing pushed.
</success_criteria>

<output>
Create `.planning/quick/261102-syk-home-audit-p2-p3-tile-legibility-pointer/261102-syk-SUMMARY.md` when done. Record: the `.q` badge left off-scale and moved top-left; the stray `>>` fix; the G root cause (border-box padding box); what was and was not visually verified.
</output>
