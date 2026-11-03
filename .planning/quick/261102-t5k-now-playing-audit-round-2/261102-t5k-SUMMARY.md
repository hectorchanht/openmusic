---
quick_id: 261102-t5k
status: complete
commit: a63a68cd
---

# Quick 261102-t5k — Summary

All P2 + P3 from the second Now Playing audit (15/20), verified rendered via headless Chrome CDP
against the 5173 dev server (390x844 dark, 1440x900 light).

## Done (measured)
- Focus: `.np :global(:focus-visible)` 2px `--color-focus` ring (computed outline `solid`, was `auto`).
- Tablist: roving tabindex `[-1,0,-1,-1]`; ArrowRight lyrics->comments->related, End/Home work;
  `.panel` is `role="tabpanel"` `aria-labelledby="np-tab-lyrics"`. Left/Right mirror under RTL.
- Tabs 44x44 (were 44x40). Transport 420px centred at >=1024 (was full width).
- Lyrics: exactly 1 tabbable line; Up/Down move between lines; timing close 44px wide.
- Artist separator padding 5.6px each side ("周杰倫 · Jay Chou").
- Removed invalid `border-radius: none` x2, `padding: -8px …`, resting `will-change` x2.
- Null-track placeholder from `--color-surface-2` -> `--color-bg`.

## Incident
Mid-task another session ran `git stash` on the shared main worktree and dropped the stash, taking
these uncommitted edits with it (reflog `reset: moving to HEAD`). Recovered from the dangling stash
commit 7795ba8d — only NowPlaying.svelte + NpLyrics.svelte restored; that stash also holds another
session's marquee.ts / (app)/+layout.svelte / library/+page.svelte WIP, left untouched.

## Verification
- `pnpm check`: 0 errors, 31 warnings (baseline).
- `pnpm test`: 241/244 files passed under load average ~180; the 3 failing files (names, translate,
  device-filename — none touched here) were timeouts and pass on re-run (109/109).
