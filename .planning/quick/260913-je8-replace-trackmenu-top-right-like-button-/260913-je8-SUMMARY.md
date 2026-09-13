---
id: 260913-je8
mode: quick
status: complete
date: 2026-09-13
commit: ffc2e6a
files_changed:
  - src/lib/components/TrackMenu.svelte
tasks:
  T1: complete
  T2: complete
---

# Quick 260913-je8 — Download in the TrackMenu header, Like as a list row — Summary

Swapped the long-press TrackMenu's top-right accent slot from Like to a tri-state Download,
and restored the mid-list Like row. One file, one atomic commit, no new services / i18n keys / CSS
classes — exactly as planned.

## What changed

**T1 — Header: Heart → Download (tri-state)** (`src/lib/components/TrackMenu.svelte`)

The header cluster is now `[Download] [X]`. The slot mirrors the list row's tri-state from the
SAME sources, so the two can never disagree:

- `library.isDownloaded(track.uid)` → `<Check size={20} />`, `disabled`, `aria-label={t('menu.downloaded')}`
- `inFlight.has('download') || library.downloading.has(track.uid)` → `.row-spinner motion-always`,
  `disabled`, `aria-busy`, `aria-label={t('menu.preparing')}`
- otherwise → `<Download size={20} />`, `onclick={() => gated('download', doDownload)}`,
  `aria-label={t('menu.download')}`

`class="hd-btn"`, `use:tapBounce` and the X close button are untouched; the stale `class:liked` /
`aria-pressed` are gone from this slot. The D-09 comment was AMENDED (not deleted) to record that
only the "Like is the sole header accent / no mid-list Like row" clause is reversed — the two-row
marquee header and the explicit Close affordance still stand — and tagged `quick-260913-je8`.

**T2 — List: Like row restored**

Added directly after the Download `{#if}/{:else}` block so the two track-level actions sit together:

```svelte
<button class="mi" class:accent={liked} aria-pressed={liked} onclick={like} use:tapBounce>
	<Heart size={18} fill={liked ? 'currentColor' : 'none'} /> {liked ? t('menu.liked') : t('menu.like')}
</button>
```

Same `like()` + `liked` derived as before (so `library.toggleLike` + the liked/unliked toast are
unchanged); `.mi.accent` supplies the liked tint. The `Heart` import stays, now used here.

## Deviations from plan

**1. [Rule 3 - Blocking] Removed the now-unused `.hd-btn.liked` CSS rule**

- **Found during:** T1
- **Issue:** With the header Heart gone, `.hd-btn.liked` had no remaining consumer. `svelte-check`
  reports unused CSS selectors, which would have made `pnpm check` non-clean — the plan's own
  verify gate for both tasks.
- **Fix:** Deleted the rule, replaced with a `quick-260913-je8` comment recording that the liked
  tint now rides the shared `.mi.accent`. Also added `.hd-btn:disabled { opacity: 0.4; cursor: default; }`
  so the header's downloaded/busy states read as disabled, matching the existing `.mi:disabled`.
  Amended the header CSS block comment ("Like/Close cluster" → "action/Close cluster").
- **Files modified:** `src/lib/components/TrackMenu.svelte`
- **Commit:** ffc2e6a

No other deviations. No architectural changes, no new dependencies.

## Verification (observed, not assumed)

- `pnpm check` — **clean**: `COMPLETED 4437 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.
- `pnpm test` — **114 test files passed, 2087 tests passed** (full suite, no regressions).
- `git show --stat HEAD` — 1 file changed, 30 insertions(+), 6 deletions(-); no file deletions.

**NOT verified in a live browser.** The plan's per-task verify lines also call for on-screen checks
(header renders the Download icon; tap starts resolve-then-download and shows the header spinner;
the row label flips Like ⇄ Liked and the toast fires). Those were not executed: no browser-driving
tool was available in this execution context, and TrackMenu is mounted entirely behind a
`transition:fly`, which does not complete in the frozen-rAF preview pane. The change is
markup-only and re-uses handlers (`like`, `gated`, `doDownload`) and state (`inFlight`,
`library.downloading`, `isDownloaded`, `liked`) that were already wired and are unmodified, so
runtime risk is low — but the visual/interaction check is genuinely outstanding and worth a
30-second manual pass on a long-press menu.

## Known stubs

None.

## Self-Check: PASSED

- `src/lib/components/TrackMenu.svelte` — FOUND
- commit `ffc2e6a` — FOUND in `git log`
