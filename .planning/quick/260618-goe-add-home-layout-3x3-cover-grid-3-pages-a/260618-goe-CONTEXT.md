# Quick Task 260618-goe: Home grid layout mode + crow art size settings — Context

**Gathered:** 2026-06-18
**Status:** Ready for planning (decisions locked via user Q&A)

<domain>
## Task Boundary

Two related home/settings features for the SvelteKit app (`src/`, NOT index.html):

1. **New 3×3 grid layout mode** for home sections — a YouTube-Music "Speed dial"
   style block: 9 covers per page (3 cols × 3 rows), paginated horizontally,
   capped at **3 pages total** (27 tiles), with **song title + artist name
   overlaid on the bottom of each cover**. Selected via the existing per-section
   + global density toggle in Settings → Home, using the **grid-3x3 lucide icon**.

2. **Cover-tile ("crow") art size** — currently the `coverScale` setting does
   NOT change the cover-tile size; make tile art size actually configurable, and
   add live **demo previews** in settings.
</domain>

<decisions>
## Implementation Decisions (LOCKED — do not revisit)

### Grid layout selection model
- Add a **THIRD layout mode** to the existing density system (alongside today's
  compact/comfortable). It is selectable **per-section AND as the global default**
  in Settings → Home — same mechanism as the current density toggle.
- End users see **only icons** for each mode; the new grid mode's icon is
  **`Grid3x3` from `@lucide/svelte`**.

### Rename density values to coder-clear names
- The current `HomeDensity` union values `'comfortable' | 'compact'` should be
  **renamed to self-explanatory, developer-readable names** (user's suggestion:
  `list` / `pile` — pick names a coder understands by reading them; the new mode
  is `grid`). Proposed mapping (planner may refine but keep it self-evident):
  - `compact`  → `list`  (stacked text rows — the CompactPager columns-of-4)
  - `comfortable` → `pile` (the larger horizontal cover shelf / discoveryShelf)
  - NEW → `grid` (the 3×3 paginated cover grid)
- **CRITICAL — persisted-value migration:** `homeDensity` and the
  `homeSectionDensity` map are persisted to localStorage (`openmusic:settings:v1`)
  and seeded in `src/lib/config/defaults.ts`. Renaming the enum WILL break
  returning users unless the `load()` guards in `settings.svelte.ts` **migrate old
  values** (`'compact'`→`'list'`, `'comfortable'`→`'pile'`). Update defaults.ts,
  the load/validate guards, `resolveSectionDensity`, `resolveX` helpers, the
  settings/home toggle, and the +page.svelte `densityOf` render switch together.
  Non-destructive: a returning user must see their previous layout unchanged.

### 3×3 grid sizing
- The 3×3 grid **tile size is determined by device width** (3 columns fill the
  available width responsively) — there is **NO size slider for the grid**.
- Reuse the existing fallback-grid `.tile`/`.scrim`/`.label`/`.t-title`/`.t-artist`
  markup + styling in `(app)/+page.svelte` for the title/artist-on-cover look.
- Paging: 9 tiles/page, **max 3 pages (27 tiles)**, horizontal scroll-snap with a
  dot/page indicator like the existing CompactPager (the screenshot shows 3 dots).

### Crow / cover-tile art size
- The existing `coverScale` (70–150%, in Settings → Appearance and Settings → Home)
  currently does NOT affect the cover-tile size — **fix this so cover-tile ("crow")
  art size actually responds** to the size control. (Investigate why the
  `--cover-scale` CSS var / coverScale doesn't reach the `.crow` tiles in
  CompactRow.svelte and wire it through.)
- This sizing applies to the LIST/compact cover-tiles. The grid mode stays
  device-width-sized (above).

### Demo previews in settings
- Add a small **live visual demo/preview** directly **under the Cover Size slider**
  AND **under the Home Grid Columns control** so the user sees how the change looks
  as they adjust it. The demo should reflect the current setting value live.
</decisions>

<specifics>
## Specific References

- Reference screenshot: YouTube Music "Speed dial" — 3×3 covers, dotted pager,
  title+artist text on the bottom of each cover tile.
- Existing analog already in code: the `useFallback` `.grid > .tile` block in
  `src/routes/(app)/+page.svelte` (~line 686) renders cover + scrim + title/artist
  overlay. Reuse its look for grid mode.
- Density toggle UI: `src/routes/(app)/settings/home/+page.svelte` (`densities`
  array, `setDensity`, `sectionDensity`/`setSectionDensity`, lucide icons).
- Size controls: `coverScale` + `homeGridCols` in
  `src/routes/(app)/settings/appearance/+page.svelte` and `.../settings/home/+page.svelte`.
- Tile component (the "crow"): `src/lib/components/CompactRow.svelte`.
- Pager: `src/lib/components/CompactPager.svelte` (columns-of-4 scroll-snap).
- Layout service + types: `src/lib/services/home-layout.ts`
  (`HomeDensity`, `resolveSectionDensity`, `clampShelfSize`, section ids).
- CSS vars applied in `settings.svelte.ts` `applyTheme()`: `--cover-scale`,
  `--home-grid-cols`.
</specifics>

<canonical_refs>
## Canonical References

- `src/lib/config/defaults.ts` — single source of truth for defaults; every
  default literal must live here (header in the file promises this).
- localStorage key `openmusic:settings:v1` — persisted settings; migration must
  keep returning users' layout unchanged.
- i18n: density mode labels go through `t(...)` (`settings.densityComfortable`,
  `settings.densityCompact`, `settings.tileDensity`); add a grid key + keep
  end-user-facing strings translated even though the toggle shows icons.
</canonical_refs>
