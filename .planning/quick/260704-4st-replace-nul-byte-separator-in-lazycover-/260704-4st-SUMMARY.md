---
quick_id: 260704-4st
slug: replace-nul-byte-separator-in-lazycover-
status: complete
completed: 2026-07-04
commits:
  - 32d3b9f
files_modified:
  - src/lib/actions/lazyCover.ts
  - src/lib/actions/lazyCover.test.ts
---

# Quick Task 260704-4st Summary: Replace NUL-byte separator in lazyCover `inFlightKey`

Fixed the deferred item from quick-260704-4fr: a literal NUL byte in `inFlightKey` made
`lazyCover.ts` register as a **binary file** to git (no line diffs / blame / `git grep`).

## What changed

- `src/lib/actions/lazyCover.ts` — `inFlightKey`'s empty-uid key went from
  `` `name:${track.artist}\x00${track.title}` `` to
  `` `name:${JSON.stringify([track.artist, track.title])}` ``. Collision-free (JSON escaping keeps
  `["a","bc"]` ≠ `["ab","c"]`) and git-text-safe (no control chars). Real-uid branch unchanged.
  `inFlightKey` is now `export`ed for a direct unit test.
- `src/lib/actions/lazyCover.test.ts` — new `describe('inFlightKey', …)`: real-uid→uid,
  same-artist/diff-title → distinct keys, boundary-shift non-alias, and a "no `[\x00-\x1f]` in the
  key" git-text-safe regression guard.

## Verification (actual results)

- `pnpm vitest run src/lib/actions/lazyCover.test.ts` → **19 passed** (existing + 4 new; the prior
  cases unaffected — the de-dupe semantics are identical).
- `pnpm check` (svelte-check) → **0 errors / 0 warnings** (4298 files).
- **git-text proof:** the committed HEAD blob has **0 NUL bytes**; `git grep inFlightKey HEAD -- …`
  matches (git grep skips binary files → confirms text); a simulated follow-up edit diffs as `2 0`
  (line-level), not `-  -`. The transition commit itself still shows "Binary" on its pre-image (the
  old blob had the NUL) — expected and unavoidable; every diff/blame from HEAD onward is textual.

## Commit

| Task | Commit | Files |
| ---- | ------ | ----- |
| 1 | see git log (`fix(quick-260704-4st): …`) | `src/lib/actions/lazyCover.ts`, `lazyCover.test.ts` |

## Notes

- Behavior unchanged — `inFlightKey` is a session-scoped in-flight de-dupe Set key, never rendered or
  sent over the network. Only the internal string format changed.
