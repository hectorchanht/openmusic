---
phase: quick-260920-n6j
plan: 01
subsystem: now-playing-lyrics
tags: [lyrics, scroll-anchor, layout, pure-helper]
requires:
  - "NpLyrics.svelte anchorActiveLine() (quick-260919-npfix Fix 3)"
provides:
  - "lyricAnchorMetrics() pure anchor + head/tail padding helper"
  - "head/tail scroll padding on .lyrics so edge lines reach the anchor"
affects:
  - "NowPlaying lyrics pane auto-scroll in closed/half/full + desktop column"
tech-stack:
  added: []
  patterns:
    - "pure DOM-free layout maths extracted to a .ts service, node-tested"
    - "change-gated style write (string compare) to avoid layout invalidation"
key-files:
  created: []
  modified:
    - src/lib/services/lrc.ts
    - src/lib/services/lrc.test.ts
    - src/lib/components/NpLyrics.svelte
decisions:
  - "padBottom clamps against container.clientHeight, not the visible band height — clientHeight is what the browser clamps scrollTop against; visHeight is only the viewport-intersecting slice (HALF sheet), and padding against it would under-pad the tail"
  - "padding guards are instance-scoped plain `let`s, not module-scoped like trCache — a remount yields a fresh unpadded element, and a surviving guard would skip re-applying padding"
metrics:
  duration: ~5 min
  completed: 2026-09-20
---

# Quick 260920-n6j: Lyrics Always Centred Summary

Head/tail scroll padding derived from the live anchor now lets the first and last lyric lines reach the auto-scroll anchor, closing the clamp gap the previous `ponytail:` ceiling comment documented.

## What Was Built

**Task 1 — `lyricAnchorMetrics()` (TDD).** New pure export in `src/lib/services/lrc.ts` taking `{ visTopWithin, visHeight, clientHeight, lineHeight, topPin, topPad }` and returning `{ anchorWithin, padTop, padBottom }`. The `anchorWithin` expression moved verbatim out of `NpLyrics`' inlined ternary (an identity test pins this — mid-list anchoring is unchanged). `padTop = max(0, anchorWithin)` lets line 1 sit on the anchor at `scrollTop 0`; `padBottom = max(0, clientHeight - anchorWithin - lineHeight)` lets the last line sit on it at max scroll. All numeric inputs pass through a local `fin()` clamping non-finite and negative measurements to `0`, so a mid-transition read can never emit `NaNpx` or negative padding.

**Task 2 — `anchorActiveLine()` rewire.** `src/lib/components/NpLyrics.svelte` now measures the container and visible band first, calls the helper, writes `paddingTop`/`paddingBottom` on `lyricsEl` only when the formatted string changed, and *then* measures the line (padding shifts `offsetWithin`, so the line rect must be read after the write). Every early return stays above the write. The stale `ponytail:` ceiling comment ("Not taken here…") was replaced with a `quick-260920-n6j` decision record; `quick-260618-t7p`, `quick-260919-npfix`, `quick-260919-np3` comments left intact. The translation effect, suspend/resume logic, `seekToLine`, the `REFLOW_SETTLE_MS` settle pass and the `.lyrics` CSS rule were not touched.

## Verification (observed output)

| Gate | Command | Result |
|------|---------|--------|
| TDD RED | `pnpm vitest --run src/lib/services/lrc.test.ts` | **5 failed / 41 passed** — `TypeError: lyricAnchorMetrics is not a function` (correct red) |
| TDD GREEN | same | **46 passed (46)** |
| Typecheck | `pnpm check` | **4577 FILES 0 ERRORS 0 WARNINGS** |
| Full suite | `pnpm test` | **145 files passed, 2997 tests passed** |
| Static order | `awk` over `anchorActiveLine` | `if (!el \|\| !container) return;` @34 → `style.paddingTop` @77 → `el.getBoundingClientRect()` @86 — correct order |
| Stale comment | `grep -q "Not taken"` | absent |
| Helper wired | `grep -c "lyricAnchorMetrics("` in NpLyrics | `1` |

**Not verified here:** the on-screen smooth-scroll result. The browser pane's rAF is frozen in this environment (known memory), so scroll behaviour is not E2E-observable; the vitest identity + padding cases are the behavioural check, as the plan anticipated.

## Deviations from Plan

**1. [Rule 1 - Bug] Padding guards placed at instance scope, not module scope**
- **Found during:** Task 2
- **Issue:** The plan specified "module-level `let lastPadTop/lastPadBottom`". `NpLyrics` genuinely has a `<script module>` block (`trCache`), so module-level is a real, distinct option here — and the wrong one. The component is unmounted outright on mobile tab switches (`quick-260919-np3`); a remount yields a fresh `.lyrics` element with no inline padding, while a module-scoped guard would still hold the previous string and skip re-applying it, leaving the pane unpadded until the padding value happened to change.
- **Fix:** Declared both as plain (non-`$state`) `let`s in the instance `<script>` next to `lyricsEl`, with a comment naming the reason. The plan's actual constraint — plain field, not a rune — is satisfied.
- **Files modified:** `src/lib/components/NpLyrics.svelte`
- **Commit:** `dc5dcbd`

## Assumption Drift (advisory)

None material.

## Known Stubs

None.

## Threat Flags

None — no new trust boundary. T-n6j-01 (layout-thrash DoS on the ~4 Hz anchor pass) is mitigated as planned: change-gated string compare plus the helper's `fin()` clamp.

## Commits

| Commit | Gate | Message |
|--------|------|---------|
| `af4c9fc` | RED | `test(quick-260920-n6j): add failing tests for lyricAnchorMetrics` |
| `241d4d2` | GREEN | `feat(quick-260920-n6j): lyricAnchorMetrics pure anchor + padding helper` |
| `dc5dcbd` | — | `fix(quick-260920-n6j): first and last lyric lines reach the scroll anchor` |

No REFACTOR commit — the GREEN implementation needed no cleanup.

## Self-Check: PASSED

- `src/lib/services/lrc.ts` — FOUND, exports `lyricAnchorMetrics`
- `src/lib/services/lrc.test.ts` — FOUND, contains `describe('lyricAnchorMetrics'`
- `src/lib/components/NpLyrics.svelte` — FOUND, contains `lyricAnchorMetrics(`
- Commits `af4c9fc`, `241d4d2`, `dc5dcbd` — all FOUND in `git log`
