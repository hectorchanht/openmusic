---
phase: quick-260920-kxz
plan: 01
subsystem: settings-appearance
tags: [settings, appearance, i18n, a11y, css]
requires:
  - src/lib/stores/settings.svelte.ts (Settings singleton, FONT_SCALE_MIN/MAX, COVER_SCALE_MIN/MAX)
  - src/lib/services/cover-gradient.ts (coverGradient)
  - src/lib/actions/tapBounce.ts
provides:
  - "fontScaleApp setting + --fs-app root text multiplier"
  - "RowScaleTarget union + wing buttons on RowActionsConfig"
  - "NpPreviewEditor (draft-then-commit Now Playing replica editor)"
  - "px-free font sizing across src/ (every rule is rem)"
affects:
  - "every text rule in the app (px -> rem, no rendered change at 100%)"
  - "song rows on a fresh install (no like/download buttons)"
tech-stack:
  added: []
  patterns:
    - "wing button: a mock's own part is the control that targets a single shared slider"
    - "draft shadows :root custom properties on a subtree so a mock previews without committing"
key-files:
  created:
    - src/lib/components/NpPreviewEditor.svelte
  modified:
    - src/lib/config/defaults.ts
    - src/lib/stores/settings.svelte.ts
    - src/lib/stores/settings-persist.svelte.test.ts
    - src/app.css
    - src/lib/components/RowActionsConfig.svelte
    - "src/routes/(app)/settings/appearance/+page.svelte"
    - "src/lib/i18n/*.ts (15 dictionaries)"
    - "36 files touched by the px->rem sweep"
decisions:
  - "Global text size is a root font-size multiplier (--fs-app), NOT zoom on body — user-approved; required the px->rem sweep to actually reach every label"
  - "BOTH editors commit LIVE. Now playing was built draft-then-commit (Cancel/Save) because its surface is invisible from Settings; the user asked mid-task for immediate apply, so the draft mirrors, dirty/touched guards, re-seed $effect, both buttons AND the local style:--fs-np-* shadowing were removed (the shadowing existed only to preview without writing the store)"
  - "rowActions default reversed to [] — the unconditional menu is what makes an empty row safe"
  - "Wing CSS is duplicated in two scoped copies rather than extracted into a third component"
metrics:
  duration: ~25 min
  completed: 2026-09-20
  tasks: 3
  commits: 3
---

# Quick 260920-kxz: Appearance settings as interactive mocks — Summary

Settings → Appearance now configures sizing **on replicas of the surfaces being sized** — a song-row mock whose cover, title and artist are tappable "wings" feeding one live slider, and a Now-Playing hero mock with a draft/Cancel/Save cycle — plus a new global **App text size** slider that really moves every label, because every `font-size` under `src/` was converted from px to rem in the same pass.

## What shipped

| Task | Commit | Content |
|------|--------|---------|
| 1 | `fd7a9da` | `fontScaleApp` plumbing, `--fs-app` root multiplier, px→rem sweep, `rowActions` default `[]`, 9 i18n keys × 15 locales, persist tests |
| 2 | `62984be` | Wings on `RowActionsConfig` + App text size slider + page restructure |
| 3 | `15ddef5` | `NpPreviewEditor` draft-then-commit editor, mounted on the page |

### The px→rem sweep (the risky part)

| | Before | After |
|---|---|---|
| `font-size: Npx` (plain) | 160 | 0 |
| `font-size: calc(Npx * var(--fs-*))` | 26 | 0 |
| **total px font-size rules in `src/`** | **186** | **0** |
| `line-height: Npx` | 1 (`Nowbar.svelte`) | 0 |
| files rewritten | — | 36 |
| total sites rewritten | — | **187** |

Distinct values found: `6, 7, 8, 10, 11, 12, 13, 14, 15, 16` px — all exact sixteenths, so `n/16` is lossless and the root is 16px at 100%: **rendering at 100% is unchanged**. Sweep ran from a throwaway script in the scratchpad (never added to the repo), restricted to the two `font-size` forms plus that one `line-height`; widths, paddings, radii, `999px` and the theme mock's px geometry were untouched (`git diff` confirms only `font-size`/`line-height` lines changed). No match was inside a comment, a string or a `.ts` file — verified before running (the only inline `style:font-size` uses in `src/` were the five `rem` demo spans on the appearance page, which this change deletes anyway).

One follow-up: the explanatory comment added at the `--fs-app` token originally contained the literal text `px font-size:`, which the plan's own grep gate counted as a violation. Reworded to "pixel text size" — the gate now reads a true `0`.

## Verification — what was actually run

| Check | Result |
|---|---|
| `grep -rhE 'font-size:[^;]*px' src ... \| wc -l` | **0** |
| `pnpm test` (full suite) | **145 files / 2987 tests passed** |
| `pnpm test -- src/lib/i18n src/lib/stores/settings` | 4 files / 114 passed (parity, quote-style, persist round-trips) |
| `pnpm check` after Task 1 | `4576 FILES 0 ERRORS 0 WARNINGS` |
| `pnpm check` after Task 2 | `4576 FILES 0 ERRORS 0 WARNINGS` |
| `pnpm check` after Task 3 | `4577 FILES 3 ERRORS` — all 3 in `TrackMenu.svelte`, a concurrent session's then-uncommitted file; zero in any file this task touched |
| `pnpm check` final (after that session landed `c7f2c27`) | **`4577 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`** |
| 9 new keys present in each of 15 dictionaries | 9/9 in all 15 |
| `NpPreviewEditor.svelte` + `RowActionsConfig.svelte` compile through the live Vite dev server (`:5173`) | both transform cleanly; `--fs-app` root rule present in the served `app.css` |
| `onInput` contains no `settings.save()` | confirmed at source: it writes `touched` and `draft` only |

### A concurrent session briefly reddened `pnpm check` — resolved

Between my Task 2 and Task 3 checks, `src/lib/components/TrackMenu.svelte` went mid-edit in this **shared working tree** under a concurrent session (quick-260920-l82, a `resolveShareCover` / `shareItunesMemo` refactor): 3 errors, all in that one file, none in anything I touched. Per the scope boundary I did not touch, stage or "fix" it. That session then committed `3697f93` + `c7f2c27` and the tree went green again — **final `pnpm check` is `0 ERRORS 0 WARNINGS`**. Recorded here because it is the same shared-worktree collision MEMORY already warns about, and because `pnpm check` output from the middle of this run would otherwise look like a failure of this task.

### `[UNVERIFIED-SANDBOX]` — needs a real browser

No browser automation is installed in this repo and the Browser pane's rAF is frozen here, so the following are **structurally** correct (right CSS var, right handler, right ARIA attribute) but were **not** observed rendering:

- Dragging **App text size** visibly resizing px-formerly-sized labels across Home / menus / Settings.
- Tapping a wing and watching the replica row resize **in place** as the slider moves.
- The NP mock resizing live while the rest of the app stays put until **Save**; **Cancel** snapping it back.
- Keyboard: Enter/Space on a wing (every wing is a real `<button>` with no `preventDefault` on click, so this is native behaviour, but unobserved).
- `outline` + `color-mix()` wing rendering in both light and dark themes.

The plan's manual checklist (dev server 4321/5173, reload persistence, fresh profile showing no like/download buttons) is the right script for a human pass.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 3 - Blocking] The plan's own px gate matched my new comment**
- **Found during:** Task 1 verification
- **Issue:** the `--fs-app` token comment read "`re-introduce a px font-size: a px rule is immune…`", which the gate regex `font-size:[^;]*px` counts as a rule. The plan's gate filters `//` line comments, but this is a CSS `/* */` block.
- **Fix:** reworded to "re-introduce a pixel text size anywhere". Gate reads 0.
- **Files:** `src/app.css` · **Commit:** `fd7a9da`

**2. [Rule 1 - Bug] The `resetAppearance()` rowActions test would have passed trivially**
- **Found during:** Task 1, step 6
- **Issue:** the existing case sets `rowActions = []`, saves, resets, then asserts the default. With the default now `[]` the assertion holds even if `resetAppearance()` never touched the field — the case would have silently stopped testing anything.
- **Fix:** start from `['download','like']` so the reset has to do real work. (The plan only asked to flip the expected value.)
- **Files:** `src/lib/stores/settings-persist.svelte.test.ts` · **Commit:** `fd7a9da`

**3. Wing tint uses `background-color`, not the `background` shorthand**
- **Found during:** Task 2
- **Issue:** `.cfg-art` is now a wing AND keeps its `linear-gradient` cover fill. A `background:` shorthand in `.wing.sel` (specificity 0,2,0) would have beaten `.cfg-art` (0,1,0) and erased the gradient when the cover wing was selected.
- **Fix:** wing rules set `background-color` only, so the gradient image always paints over the tint. Commented at the rule.
- **Files:** `RowActionsConfig.svelte`, `NpPreviewEditor.svelte` · **Commits:** `62984be`, `15ddef5`

**4. Two spacing bumps the plan did not specify**
- `.cfg-row` padding `6px → 10px` and `.cfg-meta` gap `2px → 8px`. `outline-offset: 3px` paints outside the box, so at the old values the art wing's outline sat flush against the card edge and the two stacked text wings drew overlapping outlines that read as one target. Both commented in place.
- **Files:** `RowActionsConfig.svelte` · **Commit:** `62984be`

### Assumption Drift (advisory)

**1. "16 locale dictionaries" → there are 15**
- **Planned:** the plan (and `CLAUDE.md`) say 9 keys × **16** dictionaries.
- **Actual:** `src/lib/i18n/index.ts` registers **15**: `en, zh-Hant, zh-Hans, es, fr, de, pt, it, ru, tr, ar, hi, id, vi, th`. All 15 got all 9 keys; `i18n.test.ts` parity passes.
- **Why it matters:** only so a later reader does not go hunting for a missing sixteenth file. Nothing is unlocalised.

**2. The appearance page is 4-space indented, not tabs**
- **Planned:** house style (and the gates) say tabs.
- **Actual:** `+page.svelte` has been space-indented since before this task. I matched the file rather than reformatting it, so the diff stays reviewable. `NpPreviewEditor.svelte` and the `RowActionsConfig.svelte` edits use tabs, matching their files.

## Known Stubs

None. Every control on the page writes a real store field.

## Threat Flags

None. No new network surface, no new dependency. `T-kxz-01` (tampered `fontScaleApp`) is mitigated by the same `clampInt(…, FONT_SCALE_MIN, FONT_SCALE_MAX, …)` every sibling scale uses and is covered by a new test asserting `250 → 200`; `T-kxz-02` is satisfied because `--fs-app` is a bare number set via `setProperty`, never interpolated into a selector.

## Self-Check: PASSED

- `src/lib/components/NpPreviewEditor.svelte` — FOUND
- `src/routes/(app)/settings/appearance/+page.svelte` — FOUND
- `src/lib/components/RowActionsConfig.svelte` — FOUND
- commits `fd7a9da`, `62984be`, `15ddef5` — all FOUND in `git log`
- working tree after Task 3: only `TrackMenu.svelte` (another session) and untracked `.planning/` dirs remain

---

## Addendum — post-executor fixes (commit `4e2dc8c`)

The executor process died mid-run after the first three commits. The orchestrator
finished the work directly, per the `execute-phase-executor-death-finalize` pattern.

### 1. Scope change: the Now Playing editor applies immediately

User, mid-task: *"no need cancel or save button, it will be applied rightaway"*.
Draft-then-commit is gone — see the corrected decision above. `tags.cancel` /
`tags.save` are no longer referenced here but were NOT deleted from the
dictionaries; other call sites still use them.

### 2. Defect found by live verification: the NP mock never resized

Browser-verified, not inspected. `.wing { font: inherit }` sat **after**
`.np-title` / `.np-artist` / `.np-lyrics`. `font` is a shorthand, so it resets
`font-size`; Svelte scopes both selectors to the same `(0,2,0)` specificity, so
only source order broke the tie and the reset won — wiping all three
`calc(Nrem * var(--fs-*, 1))` formulas. Every NP wing stayed pinned at 16px at
every scale, while the draft var was being set correctly on `.np-mock` (which is
what made it look like it worked).

`RowActionsConfig` was never affected: its `.wing` already came first. Fix was to
move the reset above the size rules in `NpPreviewEditor`, making the two files
structurally identical, plus a comment in BOTH recording that the reset must stay
first and that swapping the shorthand for longhands would only move the same
override onto `font-weight: 800` / `line-height: 1.2`.

### 3. Lyrics centred

`NpLyrics.svelte` `.lyrics` is `text-align: center; line-height: 1.3`. The replica
was left-aligned, so it was wrong about the surface it mocks. The lyric wing now
stretches full width and centres.

### Verification — these are no longer `[UNVERIFIED-SANDBOX]`

Driven on the live dev server at `:5173`:

| Check | Result |
|---|---|
| NP title (`1.5rem` base) | 31.2px @130% -> 36px @150% |
| NP artist (`1rem` base) | 16px -> 22.4px @140% |
| Lyrics (`1rem` base) | 16px -> 25.6px @160% |
| Live commit | each drag writes `localStorage['openmusic:settings:v1']` with no Save press |
| Cancel/Save | absent from the DOM |
| Lyrics layout | `text-align: center`, `line-height: 20.8px` (1.3x), width 864 of 888 |
| Song-row editor (regression) | unchanged, 14px -> 19.6px @140% |
| Global App text size (re-check) | root 16px -> 24px @150%; a formerly-hardcoded-px `h2` 13.6px -> 20.4px |
| Gates | `pnpm check` 0 errors 0 warnings (4577 files); `pnpm test` 2987/2987 in 145 files |

Still genuinely unverified here: real-device rendering and the light-theme wing
tint. Nothing blocks them; they were simply not exercised.
