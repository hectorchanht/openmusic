---
phase: 38-share-links-that-play-instantly-and-open-in-the-app
plan: 05
subsystem: routes
tags: [share, deep-links, ssr, player, arrival, i18n]

# Dependency graph
requires:
  - phase: 38-01
    provides: "the pure seam — parseEntityParam / stubToTrack, the ?u= carrier contract"
  - phase: 38-02
    provides: "player.armTrack (arm, never play) and player.spliceAndPlay (queue-preserving warm play)"
  - phase: 38-04
    provides: "share-arrival's arriveTrack / arriveShared — the single cold-vs-warm dispatcher"
  - phase: 38-06
    provides: "the toast.sharedPlaying key in all 15 locales and the ?u= emit side"
provides:
  - "All three web arrival surfaces (/song/[artist]/[title], /song/[slug], legacy /?play=) route through the ONE arrival path"
  - "A shared link resolves on mount and seats the song armed + paused; the CTA starts the already-armed element"
  - "The legacy ?play= token no longer replaces the recipient's queue"
affects: [38-07, 38-09, share-arrival, player-queue]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Landing-page arrival shape: plain (non-$state) `inflight` promise + AbortController, bound in onMount, adopted by the CTA"
    - "`import type` from a store-pulling module is SSR-safe (erased at compile time) where the value import is not"

key-files:
  created: []
  modified:
    - src/routes/(app)/song/[artist]/[title]/+page.ts
    - src/routes/(app)/song/[artist]/[title]/+page.svelte
    - src/routes/(app)/song/[slug]/+page.svelte
    - src/routes/(app)/+page.svelte
    - src/routes/(app)/song/[artist]/[title]/loader.test.ts
    - src/routes/(app)/song/[slug]/loader.test.ts
    - .planning/phases/38-share-links-that-play-instantly-and-open-in-the-app/38-VALIDATION.md
    - .planning/todos/completed/song-share-stale-cover-comment.md

key-decisions:
  - "OPEN QUESTION CLOSED: /song/[slug] is NOT deprecated — it gets identical treatment through the shared module (with `u: null`), which is a net deletion of the duplicated resolve-and-play body. Same reasoning as D-11 for ?play=: old links are in the wild."
  - "The CTA is no longer disabled during 'resolving' (D-16) — being tappable mid-flight is what lets the tap adopt the in-flight resolve instead of firing a second one."
  - "player.toggle() guarded on `!player.playing` so a warm/no-op arrival's CTA tap cannot PAUSE the song it just started."
  - "The two pinned mount source-guards were re-pointed, not deleted: they now assert `inflight = arrive()` runs on mount AND that neither the onMount body nor the arrive() body contains a `.play(` / `.toggle(` call."
  - "Decision-ref comments could not contain the literal tokens `playStub` / `$effect` — the plan's own audit greps count raw occurrences, so a comment naming them would defeat the tripwire. Reworded to describe, not quote."

requirements-completed: [38-A]

# Metrics
duration: 13min
completed: 2026-09-20
---

# Phase 38 Plan 05: Wire the arrival surfaces Summary

The three web surfaces a shared link can land on now share one behaviour: resolve on mount, arm the
song paused in the nowbar, and let the user's tap start an element that is already loaded — with the
recipient's queue left intact on every path.

## What Changed

**`/song/[artist]/[title]`** — the loader echoes `?u=` into page data (opaque, no parse, still
synchronous and fetch-free). The page's `onMount` now fires `arriveShared({ artist, title, u })`
through a lazy `await import('$lib/services/share-arrival')`, holds the promise in a plain
`inflight` field, and binds the CTA to `playNow()`. `playNow()` awaits `inflight` (adopting it, never
re-firing), re-runs once on a `notfound`, then calls `player.toggle()` guarded on `!player.playing`.
An `armed`/`noop` outcome maps to `'idle'` — the nowbar is the armed indicator, so no new status line
and no auto-expand. A `played` outcome shows the D-20 toast through lazy `toast` + `t` imports in a
try/catch.

**`/song/[slug]`** — the same body with `u: null`. The open question from CONTEXT (`deprecate
[slug]?`) is answered: identical treatment, because the shared module makes "identical" free. Both
pages lost their duplicated `resolveAndPlay`.

**`(app)/+page.svelte`** — the legacy `?play=` decoder is kept (D-11) but now destructures only
`current` and calls `arriveTrack(current)`, toasting only on `'played'`. The `setQueue(...)` +
fresh-play pair that nuked the recipient's queue is gone; the `token` binding and the
`replaceState` cleanup are untouched.

## Task Commits

| Task | Commit | What |
|---|---|---|
| 1 | `dfc896f` | loader `u` echo + mount resolve + CTA adoption on the current landing page |
| 2 | `62f6099` | `[slug]` page, `?play=` re-point, folded todo closed |
| 3 | `fa65275` | mount source-guards re-pointed (deviation fix) |
| 3 | `0b05b41` | 38-VALIDATION.md web rows flipped green |

## Verification — observed output, not assumed

`pnpm test` — **145 files / 2973 tests passed**, 0 failed (`Duration 9.48s`).
`pnpm check` — `COMPLETED 4576 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.
`pnpm build` — `✓ built in 6.78s`, `Using @sveltejs/adapter-cloudflare ✔ done`.
Targeted: `pnpm test -- share-arrival.test.ts share.test.ts player.svelte.test.ts i18n.test.ts` →
**4 files / 482 tests passed**.

### Static audit (Task 3)

| Check | Command | Output |
|---|---|---|
| no new raw fetch in `src` | `git diff d19a3da..HEAD -- src \| grep -c '^+.*[^a-zA-Z]fetch('` | `0` |
| no rune effect on either song page | `grep -c '[$]effect' <both pages>` | `0`, `0` |
| root layout effects unchanged | `grep -c '[$]effect(' src/routes/+layout.svelte` | `2` |
| `armTrack` body clean | `grep -c` over lines 688-784 for `driveSrc(`, `\.play(`, `audio\.load()`, `pendingSeek` | `0 0 0 0` |
| `hasPlayedSinceSrc` not reached for | `grep -rn hasPlayedSinceSrc src/lib/services/share-arrival.ts src/routes` | 2 hits, both COMMENT lines (`:41`, `:150`) |
| one related-tap composition | `grep -c 'playNext(track, { pin: false })' NpRelated.svelte` | `0` |
| no `as any` | `grep -c 'as any'` over share-arrival.ts, share.ts, player.svelte.ts | `0 0 0` |
| i18n quote convention | `'toast.sharedPlaying'` single-quoted across `src/lib/i18n/*.ts` | sum `0`; `15` files with the double-quoted key |

### Success-criteria greps the orchestrator asked me to state

- **Zero top-level store imports on both `/song/*` pages:**
  `sed -n '1,25p' <page> | grep -c '^\timport .*stores/'` → `0` on both. The only added module-top
  line is `import type { ArrivalOutcome } from '$lib/services/share-arrival'`, which is erased at
  compile time; the value import is `await import(...)` inside `onMount` (count `1` per page).
- **Neither `+page.ts` loader fetches:** `grep -c 'fetch('` →
  `[artist]/[title]/+page.ts: 0`. `[slug]/+page.ts` was not modified by this plan and remains
  fetch-free. `grep -c '^export const ssr = true'` → `1`; `load` is still a non-async arrow.
- **Legacy `?play=` no longer nukes the queue:** `grep -c 'player.setQueue(queue.length > 1'` → `0`;
  `grep -c 'play(current, { fresh: true })'` → `0`; `grep -c 'arriveTrack(current)'` → `1`;
  `decodeShare(token)` → `1`; `replaceState(null, '', location.pathname)` → `1`; the later
  `!token && cached.useFallback` read → still present.
- **Folded todo:** present at `.planning/todos/completed/song-share-stale-cover-comment.md` with a
  `## Resolution (Phase 38, plan 05)` section; absent from `pending/`.

### Not verified here

The device-side rows (`assetlinks.json` in prod, `adb pm get-app-links`, cold-start deep link,
felt latency) stay ⬜ in 38-VALIDATION.md — they need a deploy and a signed APK, which is plan 09.
`nyquist_compliant` stays `false` for that reason. The optional in-browser spot-check of a live
`?u=kuwo…` arrival was **not run**; the evidence above is suite + typecheck + build + source audit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two pinned mount source-guards asserted the behaviour this plan replaces**
- **Found during:** Task 3 (first full `pnpm test`)
- **Issue:** `song/[artist]/[title]/loader.test.ts` and `song/[slug]/loader.test.ts` each carried a
  `quick-260809-38i` source guard asserting `onMountBody` mentions `resolveAndPlay` exactly once and
  contains `retry = () => void resolveAndPlay();`. Both functions are gone, so 4 tests failed. The
  plan's task list did not mention these files.
- **Fix:** re-pointed both guards at the new invariant rather than deleting them — they now assert
  (a) `onMountBody` contains `inflight = arrive();` (the D-13 resolve DOES fire), (b) `playNow`
  appears exactly once in the mount body (bound, never called), (c) neither the mount body nor the
  extracted `arrive()` body matches `/\.play\(|\.toggle\(/` (the real D-06 tripwire, and strictly
  stronger than what was there before), and (d) the CTA control still exists and is not disabled
  mid-resolve. The `quick-260809-38i` ref is preserved in both.
- **Files modified:** `src/routes/(app)/song/[artist]/[title]/loader.test.ts`,
  `src/routes/(app)/song/[slug]/loader.test.ts`
- **Commit:** `fa65275`
- **Note:** commits `dfc896f` and `62f6099` were therefore red on these two files until `fa65275`.

**2. [Rule 3 - Blocking] Plan-mandated comment wording defeated the plan's own audit greps**
- **Found during:** Tasks 1 and 2
- **Issue:** the plan's `<action>` asked for comments containing the literals `playStub` and
  ``$effect``, while its `<acceptance_criteria>` requires `grep -c "playStub"` and
  `grep -c "\$effect"` to print `0` in the same files. A comment quoting the token makes the
  tripwire unable to tell a comment from a call.
- **Fix:** kept the decision content, dropped the literals — "the old resolve-and-play-a-stub call is
  gone: it did setQueue + play(fresh:true)…" and "onMount, NEVER a tracked rune effect:…". Same for
  the `?play=` block, which quoted `play(current, { fresh: true })` verbatim against its own `0`
  criterion.
- **Files modified:** the three route components.
- **Commits:** `dfc896f`, `62f6099`

### Tooling note (no code impact)

The plan's audit greps of the form `grep -c "await import('\$lib/…')"` return **0 on macOS BSD
grep** even though the line exists — BSD BRE treats a mid-pattern `$` as an anchor. Confirmed by
`od -c` on the line plus `grep -cF` returning `1`. Every `$`-bearing audit in this summary was run
with `grep -cF` or a `[$]` bracket class. This is the `grep-false-empty-trust-read-sed` failure mode
in its most specific form; the plan's literal verify command would have produced a false red.

## Assumption Drift (advisory)

**Warm-arrival CTA semantics.** The plan assumed the CTA always "starts the armed element" via
`player.toggle()`. In the warm case `arriveShared` has already STARTED playback, so an unguarded
`toggle()` on the CTA would pause it. The `!player.playing` guard the plan specified handles this —
what drifted is the framing: on a warm arrival the CTA is a no-op confirmation, not a starter. Also
advisory: `status = 'playing'` is set unconditionally at the end of `playNow()`, so a tap on an
already-playing arrival renders "Now playing on openmusic." without changing audio state, which is
the honest label.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path, file access or schema change. The one new trust-boundary
input (`?u=`) is echoed opaquely by a loader that stays synchronous and fetch-free (T-38-04 holds)
and is consumed only by `stubFromUidParam`'s closed source enum (T-38-01, plan 01). No `fetch(` was
added anywhere under `src` in the whole phase to date (audit line 1).

## Self-Check: PASSED

All four claimed files exist on disk; all five claimed commits resolve in `git log`.
