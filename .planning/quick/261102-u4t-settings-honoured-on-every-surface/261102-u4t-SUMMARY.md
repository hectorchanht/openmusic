---
quick_id: 261102-u4t
status: complete
---
# Summary — §14 settings (first pass)

- New `src/lib/motion.ts`: `reducedMotion()` (settings.reduceMotion OR the OS query),
  `scrollBehavior()`, and reduce-motion-aware `fly` / `fade`. All 12 `svelte/transition` importers
  (sheets, modals, toasts, NowPlaying, Nowbar, layout, library, album) now import from it — the CSS
  `data-reduce-motion` kill never reached Svelte's WAAPI transitions. NpLyrics / NpUpNext /
  ShelfChevrons scrolls use scrollBehavior (ShelfChevrons read the OS query only).
- Quality setting: catalog hands every adapter the resolved `tier` (was the raw pref, so gdnetease
  always streamed 320).
- Enabled sources: `registry.isSourceEnabled`; the QQ cover tier and the cover picker's QQ tier
  honour it (onlySource('qq') force-enabled qq).
- showQualityTag on the home tile: done in §7.
- Not done (open): tapBounce deliberately reads only the app flag (documented rationale); NowPlaying
  / Nowbar keep local `osReduceMotion` formulas (same rule, not yet the helper); Nowbar lyric line
  never applies the machine translation (lyricsLang); lastfmSkip has no settings UI.
- Suite 248 files / 5196 tests pass; svelte-check 0 errors.
