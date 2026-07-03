# Deferred / out-of-scope items — quick-260704-4fr

## Pre-existing NUL byte in lazyCover.ts `inFlightKey`

- **File:** `src/lib/actions/lazyCover.ts`, function `inFlightKey` (the empty-uid de-dupe key).
- **Discovered during:** Task 2 GREEN self-check (git reported the file as binary; `file` reported "data").
- **What:** The template literal contains a literal NUL byte instead of a space:
  `` `name:${track.artist}\x00${track.title}` `` (renders as `name:<artist>[NUL]<title>`).
- **Pre-existing:** Present in the file BEFORE this plan (verified at `d85f6d7^` / `HEAD^`, at the
  original line 53). NOT introduced by this task; the `inFlightKey` line is OUTSIDE this plan's diff
  (my change only touched `resolveCoverForRow` step 1, the import, and `FRESH_MS`).
- **Impact:** Cosmetic/robustness only. The NUL is a de-dupe MAP KEY, never rendered or networked, so
  it does not affect covers, playback, or the fast-path change. It does cause git/grep to treat the
  file as binary (no line diffs, `grep` misses matches). Distinct-song stub rows still de-dupe
  correctly because the artist+title still differ around the delimiter.
- **Why deferred (not auto-fixed):** Out of scope — the hard guardrail restricts this plan to the
  warm-fresh fast path; the NUL is in an unrelated pre-existing line. Fixing it (replace `\x00` with a
  space) is a one-character change but belongs in its own quick task so the fix is intentional and
  reviewable, not smuggled into an optimization plan.
- **Suggested fix (future task):** Replace the NUL with a normal space in the `inFlightKey` template
  literal so the file is plain UTF-8 text again.
