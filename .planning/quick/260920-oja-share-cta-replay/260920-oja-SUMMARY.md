---
task: 260920-oja
title: Share CTA replays the shared song on every tap
status: complete
date: 2026-09-20
commits:
  - 6164dd9 feat(quick-260920-oja): a later CTA tap re-seats the shared song
  - c85b93a fix(quick-260920-oja): tapping play on a shared song works every time
key-files:
  created: []
  modified:
    - src/lib/services/share-arrival.ts
    - src/lib/services/share-arrival.test.ts
    - src/routes/(app)/song/[artist]/[title]/+page.svelte
    - src/routes/(app)/song/[slug]/+page.svelte
    - src/routes/(app)/song/[artist]/[title]/loader.test.ts
    - src/routes/(app)/song/[slug]/loader.test.ts
    - src/lib/stores/player.svelte.test.ts
---

# Quick 260920-oja: Share CTA replay Summary

`replayShared()` in the shared `share-arrival` service now answers the question the CTA handler never had a notion of — "is the shared song still current?" — so a second tap on "Play on openmusic" re-seats and plays the shared song instead of toggling whatever happens to be current.

## Root cause (verified, as briefed)

Confirmed in both page copies. `inflight` memoised the mount arrival and never expired, so a LATER tap resolved instantly from the cached outcome and fell through to `if (!player.playing) player.toggle();`. That starts whatever is current NOW:

- something else playing → `player.playing` true → branch skipped → the tap did literally nothing (the report);
- something else paused → it started THAT song.

The shared song was never re-seated in either case.

## What changed

**`share-arrival.ts` — one new exported function, `replayShared(input, seatedUid, signal)`.**

- Shared song still seated (`seatedUid` is current, or the carrier names the current song) → 38-D-19 unchanged: `toggle()` guarded on `!player.playing`, so a tap on an already-playing song never pauses it.
- Not seated any more → re-resolve (carrier fast path first, name resolve on a miss — same D-08/D-10 ordering as the arrival) and re-seat through `player.spliceAndPlay(track)`. No hand-rolled queue mutation. This one MAY start sound: the tap is a real user gesture, unlike the mount path.
- Keeps the T-38-01 closed-enum carrier gate and the T-38-04 abort check; returns `notfound`, so the tap is still the retry affordance.

**Both page copies — identical thin call.** `inflight` keeps its 38-D-16 job (a tap DURING the resolve adopts the promise, never a second request) and is then set to `null`, so once settled it stops being the source of truth. Each page records `seatedUid = player.current?.uid` after a non-`notfound` arrival — the carrier's uid, or the name resolve's after a D-10 fall-through, which is not re-derivable from the carrier alone. The `notfound` presentation was pulled into a local `showNotFound()` since both the arrival and the tap can now reach it.

**Preserved:** no autoplay on mount (`arrive()` still never plays — `arriveShared` is untouched), the notfound retry, the unmount abort, and the lazy `import('$lib/stores/player.svelte')` SSR contract (every new import is inside an already-client-only function).

**Page drift:** the two copies are near-identical as documented; the only differences are their headers, the cover block, and the `u` carrier (`data.u` vs the legacy `u: null`). Their `playNow` bodies were character-identical and the replacements are identical modulo that `u` argument. Nothing beyond this handler was unified.

## Tests

`share-arrival.test.ts` gained an 11-case `replayShared` describe (mocked player, node-only), covering the four briefed cases plus the D-10 fall-through, `notfound`, T-38-04 and T-38-01 legs.

**RED proof for (c).** With `replayShared` temporarily reduced to the old body (`if (!player.playing) player.toggle(); return 'played';`), the suite reported `Tests 7 failed | 30 passed (37)`, failing exactly:

- `(c) a DIFFERENT song is current and playing → the shared song is re-seated and played`
- `(c2) a different song is current and PAUSED → still the shared song, not the paused one`
- `(d) re-seating goes through spliceAndPlay, which de-dupes — a queued song MOVES, never doubles`
- the D-10 fall-through, `notfound`, T-38-04 and T-38-01 cases

With the real implementation restored: `Tests 37 passed (37)`.

Case (d) with a mocked player can only pin that the service reaches for `spliceAndPlay` and mutates no queue of its own, so the MOVE itself got one real test in `player.svelte.test.ts`: a track already sitting in Up Next relocates to just after current (`[t1, t2, t4, t3]`, exactly one copy of t4) rather than duplicating. That case was not previously covered — the existing `spliceAndPlay` tests only spliced a new track.

**Loader source guards (changed, not weakened).** Both loader tests asserted the literal `if (!player.playing) player.toggle();` in the page source. That line was the entire buggy CTA and now lives in `replayShared`, so the assertion moved with it: the page guard is now `playNowBody` must contain `replayShared(` and must NOT match `/\.play\(|\.toggle\(/` (i.e. the page must delegate and must not re-grow a local transport call), while the behaviour is pinned properly by `share-arrival.test.ts` cases (a)/(b) — a real behavioural test instead of a source grep. The no-autoplay-on-mount assertions (`arriveBody`/`onMountBody` contain no `.play(`/`.toggle(`, `playNow` named exactly once in `onMount`) are untouched and still pass.

## Verification (actual output)

```
pnpm check → COMPLETED 4577 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
pnpm test  → Test Files 145 passed (145) / Tests 3014 passed (3014)
```

Not verified: the fix was not exercised in a real browser. The CN-source resolve path is partly unreachable from this sandbox, and the reported flow needs a device tap sequence (open link → play other songs → tap the CTA again). Device check worth doing: open a share link, play two other songs, return and tap "Play on openmusic" — the shared song should start and the queue should keep its shape.

## Deviations from Plan

**1. [Rule 2 - Missing coverage] Added a MOVE/no-duplicate test to `player.svelte.test.ts`**
- **Found during:** writing case (d)
- **Issue:** (d) was specified against a mocked player, which cannot observe the de-dupe. The "already in Up Next MOVES rather than duplicates" claim the fix rests on had no test anywhere.
- **Fix:** one real test in the existing `spliceAndPlay` describe. Test file only — no production `player.svelte.ts` change, and nothing near the cover code the constraints fence off.
- **Commit:** c85b93a

**2. [Rule 3 - Blocking] Loader-test assertion relocated**
- **Found during:** Task 2
- **Issue:** `expect(src).toContain('if (!player.playing) player.toggle();')` could not hold once the control moved into the service, which was the required approach.
- **Fix:** replaced with a stronger page-level guard (delegates to `replayShared`, no local transport call) plus the behavioural service tests. Documented inline with the `quick-260920-oja` ref.
- **Commit:** c85b93a

## Self-Check: PASSED

- `src/lib/services/share-arrival.ts` — FOUND, exports `replayShared`
- `src/lib/services/share-arrival.test.ts` — FOUND, 37 tests passing
- both `+page.svelte` copies — FOUND, both call `replayShared(`
- commits `6164dd9`, `c85b93a` — FOUND in `git log`
