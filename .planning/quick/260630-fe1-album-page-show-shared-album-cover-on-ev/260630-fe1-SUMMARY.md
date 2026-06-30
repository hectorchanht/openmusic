---
phase: quick-260630-fe1
plan: 01
subsystem: album-page
tags: [presentation, album, cover, cleanup]
requires:
  - heroImg ($derived merged.cover) — the single shared album cover already resolved by the page
provides:
  - Album track rows painting the shared album hero cover instead of per-row lazyCover resolves
affects:
  - src/routes/(app)/album/[name]/+page.svelte
tech-stack:
  added: []
  patterns:
    - "One album = one cover resolve: rows reuse the page-level reactive heroImg"
key-files:
  created: []
  modified:
    - src/routes/(app)/album/[name]/+page.svelte
decisions:
  - "Kept the Track type import — still referenced by resolvedCache/menuTrack/resolveAll, not just the removed stubAsTrack"
  - "Kept stubUid (swipe in-flight guard keys) and fallbackCover (null-cover gradient fallback)"
metrics:
  duration: ~4m
  completed: 2026-06-30
  tasks: 1
  files: 1
---

# Phase quick-260630-fe1 Plan 01: Album page — show shared album cover on every row Summary

One-liner: Album track rows now paint the single shared `heroImg` album cover (reactive `$derived` of `merged.cover`) via `style:background-image`, eliminating the per-row `use:lazyCover` Deezer→iTunes→CN network storm; falls back to the existing gradient when the album has no resolvable cover.

## What Changed

The `.art` span in each track row previously ran its own `use:lazyCover` resolve and painted the result over the gradient via a `resolvedCovers` uid→url map. Since all tracks share one album cover that the page already resolves once into `heroImg`, every row now reads that shared value directly:

```svelte
<span class="art" style:background-image={heroImg ? `url(${heroImg})` : fallbackCover(track.artist + track.title)}></span>
```

Rows repaint the moment `heroImg` lands (it is a reactive `$derived`), and show the gradient fallback when the album has no cover.

Removed (all page-local; nothing else imports them):
- `import { lazyCover } from '$lib/actions/lazyCover';`
- `let resolvedCovers = $state<Record<string, string>>({});` + `function onCoverResolved(...)`
- `function stubAsTrack(stub): Track { ... }`
- The stale COVER-02 D-14 comment block describing the removed lazyCover→resolvedCovers wiring

Retained:
- `stubUid(stub)` — still used by `swipeQueue`/`swipeLike` in-flight guard keys (trimmed its doc comment to stay accurate)
- `fallbackCover(seed)` — now the row's null-cover fallback
- `import type { Track }` — still referenced by `resolvedCache`, `menuTrack`, and `resolveAll`

No change to tap-to-play, swipe, long-press, album-level actions (play/download/like/share/addToPlaylist), enrichment / Deezer / tracklist `$effect`s, or cover-cache behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `pnpm check` → `0 ERRORS 0 WARNINGS` (4291 files) — confirms no unused imports/vars left by the removals.
- `npx vitest --run` → 66 files passed, 960 tests passed (12.36s) — full suite green; the removed symbols were page-local so no other module broke.
- `grep` for `lazyCover|stubAsTrack|resolvedCovers|onCoverResolved` → none (REMOVED_OK).
- `grep` for the new `heroImg ? url(...)` row binding → present (line 588); `stubUid` + `fallbackCover` retained.

## Commits

- `dd2e29e` feat(quick-260630-fe1-01): album rows reuse shared album hero cover (1 file, +3 / -33)

## Self-Check: PASSED

- FOUND: src/routes/(app)/album/[name]/+page.svelte
- FOUND: commit dd2e29e
