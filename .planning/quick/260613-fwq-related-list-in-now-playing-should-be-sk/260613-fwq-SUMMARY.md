---
quick_id: 260613-fwq
status: complete
date: 2026-06-13
---

# Quick Task 260613-fwq: Related list skeleton loading state

## What shipped

The NowPlaying **Related** tab now shows shaped skeleton placeholder rows while
fetching, instead of the plain "Loading related…" text. Also fixed a latent bug
where the loading text never cleared when a fetch returned zero results.

## Changes

- `src/lib/components/NowPlaying.svelte`
  - Added `relatedLoading` `$state` flag; set true before `searchAll`, cleared
    in both `.then`/`.catch` with a `relatedFor === t.uid` race guard so a stale
    resolve can't clear a newer load's flag.
  - Markup is now three-way: `related.length` → list; `relatedLoading` →
    skeleton `<ul.list>` of 8 `.row.skel` rows (each a `.r-title.sk` +
    `.r-artist.sk` shimmer bar) with a visually-hidden "Loading related…" SR
    label; else → empty state `nowplaying.noRelated`.
  - Added scoped CSS for `.row.skel` bar sizing (title 55%/14px, artist
    38%/12px) and a `.vh` visually-hidden helper. Bars reuse the global `.sk`
    shimmer (reduce-motion safe).
- `src/lib/i18n/*.ts` (all 15 locales) — added `nowplaying.noRelated` key.

## Verification

- `pnpm check` (svelte-check): 0 errors, 0 warnings.
- Live preview drive: played an uncached-artist track, opened Related — confirmed
  8 skeleton rows (16 shimmer bars) + SR label render during fetch, then
  transition to 33 real rows once resolved (skeleton → loaded lifecycle, no
  leftover skeleton, no false empty state). Screenshot captured the skeleton.
