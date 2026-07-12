---
id: 260712-hm9
slug: preserve-play-history-in-up-next-list
kind: quick
status: complete
completed: 2026-07-12
plans: 1
commit: e620c97
---

# Quick Task 260712-hm9 — Preserve play history in the Up-Next list (Summary)

One surgical fix: persist `upNextAnchorUid` and re-seed it on `restore()` so a
resumed/restored session keeps its played songs visible in the Up-Next list. The
played-history feature itself was already built (`quick-260618-lsw`); the only defect
was the anchor being **null** in the restore/resume flows, which made NowPlaying's clamp
fall back to the current index and drop played songs on auto-advance.

## What changed (Task 1 — single atomic commit `e620c97`)

### `src/lib/stores/player-persist.ts` (pure codec)
- Added `anchorUid: string | null` to both `PlayerSnapshot` and `RestoredState` (a
  state-level VIEW field — the 11-field `serializeTrack` whitelist was NOT touched).
- `serializePlayerState`: added `upNextAnchorUid: snapshot.anchorUid ?? null` to the `v:1`
  envelope, placed after `repeatMode` (additive; legacy blobs lack the key).
- `parsePlayerState`: added `upNextAnchorUid?: string | null` to the payload type and returns
  `anchorUid: typeof payload.upNextAnchorUid === 'string' ? payload.upNextAnchorUid : null`
  — absent/garbage/null coerce to null, never throws (back-compatible with on-disk blobs).

### `src/lib/stores/player.svelte.ts` (runes store, thin wrapper)
- `persist()` now passes `anchorUid: this.upNextAnchorUid` to `serializePlayerState`.
- `restore()` sets `this.upNextAnchorUid = parsed.anchorUid ?? target.uid;` immediately after
  `this.current = target;`, with a `quick-260712-hm9` comment explaining the null-anchor →
  ci-fallback discard it fixes.
- Updated the (now-stale) `upNextAnchorUid` declaration comment that read "intentionally NOT
  persisted" to document the new persist/restore behavior (and that NowPlaying still ci-falls-back
  if the anchor is ever null).

### `src/lib/stores/player-persist.test.ts`
- Byte-shape test now includes `upNextAnchorUid` in the `v:1` envelope `toEqual`.
- New: `upNextAnchorUid: null` is emitted (key present, value null) when the snapshot anchor is null.
- Round-trip test asserts `anchorUid` survives verbatim.
- New `anchorUid back-compat` describe: string survives; legacy blob with NO key → `null` (no throw);
  non-string garbage → `null`.
- The hand-written legacy-shape blob test asserts `anchorUid` parses to `null`.
- Added `anchorUid` to all existing `serializePlayerState` snapshot literals (required by the
  now-mandatory `PlayerSnapshot.anchorUid` field — a typecheck necessity, behavior unchanged).

### `src/lib/stores/player.svelte.test.ts`
- New describe `player.restore() — persists + re-anchors the Up-Next VIEW anchor (quick-260712-hm9)`:
  - restore() from a blob with **NO** anchor → `upNextAnchorUid` = restored current's uid, and a
    subsequent auto-advance keeps the played song in `queue.slice(anchorIdx)`.
  - restore() from a blob **WITH** an anchor → restores it verbatim (played history above current stays).
- Existing LSW tests (Test 1–4) left unchanged and green.

## Deviations from Plan

- **Comment update (in-scope clarification):** Updated the `upNextAnchorUid` `$state` declaration
  comment in `player.svelte.ts` that previously asserted "intentionally NOT persisted" — that decision
  record is now false. Per the project's high-comment-density / decision-record house style, leaving a
  stale load-bearing comment would be misleading. No behavior change.
- **Existing test literals touched (required, not scope expansion):** Making `PlayerSnapshot.anchorUid`
  mandatory means every existing `serializePlayerState({...})` call in `player-persist.test.ts` had to
  gain `anchorUid` or `pnpm check` would fail. These are mechanical additions; assertions unchanged.
- Line numbers in the PLAN drifted slightly from the real code (located by symbol as instructed); intent matched exactly.

## Verification

`pnpm test` (tail):
```
 Test Files  75 passed (75)
      Tests  1242 passed (1242)
   Start at  12:56:14
   Duration  9.10s
```

`pnpm check` (tail):
```
1783832196573 COMPLETED 4321 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

Both green. The pre-existing 189 `upNextAnchorUid`/LSW + persist tests remain passing alongside the new cases.

## Out of scope (untouched, as planned)

- `NowPlaying.svelte` (slice/fallback/row handlers/scroll all correct).
- `regenerate` / `weaveFreshHistory` / `ensureAhead` / `next` / `advanceTo` / the play() fresh/non-fresh branches.

## Human verification note

The real resume/PWA-reopen flow needs device UAT on a live network — CN upstreams are unreachable
in-sandbox, so the fix is proven here via the pure queue-logic tests + typecheck only.

## Self-Check: PASSED

- Files exist: player-persist.ts, player-persist.test.ts, player.svelte.ts, player.svelte.test.ts — all modified and present.
- Commit `e620c97` exists on `main` (4 files changed, 185 insertions, 15 deletions).
