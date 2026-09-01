---
phase: 32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p
plan: 06
subsystem: player / next-track prebuffer
tags: [prebuffer, content-length, memory-ceiling, bg-lockscreen-stall-noskip, flac, lookahead]
requires:
  - "32-02's direct-resolve work only in the sense that it lands the lossless URLs this ceiling now measures — no code dependency"
provides:
  - "PREBUFFER_MAX_BYTES (24 MB) + overPrebufferCeiling() — a pure, node-tested size predicate"
  - "prebufferNext skips the Blob above the ceiling and streams from the CDN instead, uid still claimed"
  - "unknown/absent Content-Length falls through to the blob — byte-identical to pre-ceiling behaviour"
affects:
  - "every lossless (sq/pq) advance — it now streams at src-swap instead of playing local bytes"
  - "no lossy advance — hq/standard/fq are all admitted, so the cellular/'320' path is unchanged"
  - "plan 32-08's Android lock-screen sweep: the over-ceiling advance is the device-only case"
tech-stack:
  added: []
  patterns:
    - "pure predicate extracted out of a private async method so the DECISION is unit-testable without the fetch"
    - "threshold constant + one paragraph of arithmetic (the blob-store MIN_BLOB_BYTES house form, inverted)"
    - "early-return that deliberately LEAVES state claimed, matching the sibling !resp.ok branch verbatim"
key-files:
  created:
    - src/lib/services/prebuffer-ceiling.ts
    - src/lib/services/prebuffer-ceiling.test.ts
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
decisions:
  - "32-D-15: ceiling read from Content-Length at prebuffer time, NOT from the tang body's song_size_*_str — the header covers all four sources with zero new Track plumbing, and the head has already arrived when it is read"
  - "32-D-15: 24 MB, sitting in the empty gap between the measured lossy ceiling (6.5 MB hq) and the lossless floor (~30 MB pq) — the widest possible margin on both sides"
  - "the guard reads `resp.headers?.get(...) ?? null` — an optional chain, so a Response-shaped test double or a non-standard response can never throw into the outer catch and silently disable the whole prebuffer"
  - "32-D-17 honoured by omission: prewarmNextAssets and the lookahead walk were not touched at all"
metrics:
  duration: ~9 min
  completed: 2026-08-31
requirements: [D-15, D-17]
---

# Phase 32 Plan 06: Prebuffer size ceiling Summary

The next-track prebuffer now reads `Content-Length` off the response head and, above 24 MB, cancels
the stream instead of downloading it — so a FLAC advance streams from the CDN and a low-end phone
never holds a ~53 MB Blob, while every lossy tier still prebuffers exactly as before.

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~9 min |
| Tasks | 2 (3 commits: RED / GREEN / wire) |
| Files created | 2 |
| Files modified | 2 |

## What Was Built

### Task 1 — `src/lib/services/prebuffer-ceiling.ts` (pure, TDD)

`PREBUFFER_MAX_BYTES = 24 * 1024 * 1024` plus
`overPrebufferCeiling(headerValue: string | null): boolean`.

The constant is justified in-file against the live-probed tang ladder rather than an estimate. The
number that matters: FLAC measures **959–1647 kbps ≈ 12 MB/min** (晴天 sq = 55,397,039 B for 4:29 =
52.8 MB), **not** the 7 MB/min the original phase note assumed — the correction is why the ceiling
is 24 MB and not 8. 24 MB sits in the empty gap between the two halves of the ladder:

| Tier | Measured bytes | Verdict |
|------|----------------|---------|
| sq (FLAC) | 55,397,039 (52.8 MB) | skip → stream |
| pq (FLAC) | 31,168,013 (29.7 MB) | skip → stream |
| **ceiling** | **25,165,824 (24 MB)** | — |
| hq | 6,519,764 (6.2 MB) | prebuffer |
| standard | 3,283,546 (3.1 MB) | prebuffer |
| fq | 1,642,440 (1.6 MB) | prebuffer |

The parse is an explicit `Number.isFinite`, never a truthiness check, so `null` / `''` /
`'not-a-number'` / `'Infinity'` all land on the same fall-through branch by construction. 10 unit
tests, one assertion minimum each (`requireAssertions`).

**Why the header and not `song_size_*_str`:** research offered both. The tang detail body carries
exact per-tier byte counts and is free/earlier, but it is **qq-only** and needs a new `Track` field
threaded from `pickBestPlayUrl`. The header covers netease/kuwo/joox too, needs no plumbing, and by
the time it is read the response head has already arrived — the only cost is a connection setup that
would have happened anyway had the file been under the ceiling. Research's own recommendation was
"header primary, body as an optional refinement if the setup cost ever shows up in a measurement";
it has not, so the refinement was skipped.

### Task 2 — the guard in `prebufferNext`

Inserted exactly between `if (!resp.ok) return;` and `const blob = await resp.blob();`: read the
header, and if over-ceiling `await resp.body?.cancel()` (best-effort) and return.

The `return` leaves `prebufferedUid` **claimed** — the same f7c2580 at-most-once contract as the
sibling `!resp.ok` branch — so churn never re-fetches an over-ceiling URL, and `play()` simply finds
no blob and uses the CDN URL. The `'prebuffer-blob'` consumer at the src-swap site needs no change:
that branch just does not fire (31-D-12 provenance tagging untouched).

**Every pre-existing bound is intact** — verified by reading, not assumed: uid claimed before the
await, single in-flight via `prebufferController`, `library.isDownloaded` skip, fired only from the
≥5s `timeupdate` gate via `prewarmNextAssets`, raw `fetch` (never `apiFetch`). No line of any of them
was edited.

**The deliberate trade, stated plainly:** `prebufferNext` is a STABILITY mechanism, not gapless
polish — it exists because a backgrounded/locked `src`-swap with a network byte-load could silently
hang (`bg-lockscreen-stall-noskip`). Skipping it for FLAC puts large files back on the very path it
was written to avoid. That is accepted, because a 50 MB Blob per advance on a low-end phone is the
worse failure, and because the ceiling costs the protection **nothing** on the cellular/`'320'` path
— the path most likely to actually be backgrounded. Both the doc-block and the constant say so.

Two store-level tests added (the harness already reaches `prebufferNext` cheaply via the public
`prefetch()` path, so the plan's "only if cheap" condition was met): an over-ceiling FLAC asserts no
`blob()`, no `createObjectURL`, `cancel()` called, uid still claimed; a null-header response asserts
the blob is still created.

## Key Decisions

1. **Header over detail body** — all-source coverage and zero `Track` plumbing beat "free and 200 ms
   earlier". Recorded above in full because it reverses the research summary's headline preference.
2. **`resp.headers?.get(...) ?? null`** — one optional chain. Without it, any response object lacking
   `headers` (the existing prebuffer test's double, or a future non-standard shape) throws into the
   outer `catch`, which would silently disable the prebuffer entirely rather than fall through. The
   chain also meant the existing bg-lockscreen test needed **zero** edits, which is itself evidence
   the old behaviour is unchanged on the unknown-size path.
3. **32-D-17 honoured by omission** — `prewarmNextAssets` and the lookahead walk were not opened.

## Deviations from Plan

None — plan executed as written. The optional chain in decision 2 is an implementation detail the
plan left open (it specified the insertion point and the predicate, not the header access shape).

## Freeze-Class Interaction (explicitly assessed, per the plan warnings)

All three known freeze classes sit adjacent to this code. Assessment:

- **`api-fetch-flood-freeze`** — *reduces* pressure, cannot increase it. The change only ever
  **cancels** a transfer earlier; it issues no new request. Media bytes still bypass `apiFetch` by
  rule, and the request count per advance is unchanged (still exactly one, still at most once per
  uid).
- **`nowbar-freeze-reresolve-loop`** — untouched. The guard adds no `audio.src` attach, no re-resolve,
  and no `audio.error` path. A skipped prebuffer means the src-swap uses the CDN URL, which is the
  same code path a `!resp.ok` or aborted prebuffer has always taken.
- **`restore-effect-self-invalidation-loop`** — untouched. `prebufferNext` writes only plain
  (non-`$state`) class fields, so nothing here can invalidate a tracked effect. No new `$state` was
  introduced.

The one genuinely device-only question is the flip side of the accepted trade: **does a lossless
advance still start reliably from a locked Android screen now that it streams?** That is exactly
what `bg-lockscreen-stall-noskip` was written about, and it cannot be checked in a node test. It is
handed to plan 32-08's Android checkpoint (VALIDATION gate #8) as the specific case to watch.

## Verification

```
pnpm test   → 101 files, 1891 passed, 0 failed   (baseline 100/1879 → +1 file, +12 tests)
pnpm check  → 4406 FILES 0 ERRORS 0 WARNINGS
```

### 32-D-16 boundary audit (shown, not asserted)

```
$ git diff -U0 src/lib/stores/player.svelte.ts | grep '^@@'
@@ -21,0 +22 @@       import { dedupeBest, sameSongKey } from '$lib/services/dedupe';
@@ -2645,0 +2647,5 @@ class Player {
@@ -2663,0 +2670,19 @@ class Player {
```

Three hunks: the import (line 22), five doc-block lines (2647-2651), and the guard itself
(2670-2688). The highest line touched is **2688**. The protected post-resolve tail is **2892-3033**
in the pre-change numbering (**2917-3058** after the +25-line shift) — no hunk intersects it in
either numbering, and no line inside it was read or edited.

### Acceptance criteria

- `grep -c "24 \* 1024 \* 1024" src/lib/services/prebuffer-ceiling.ts` → 1
- `grep -c "Number.isFinite" src/lib/services/prebuffer-ceiling.ts` → 2 (impl + doc-block)
- `grep -n "overPrebufferCeiling" src/lib/stores/player.svelte.ts` → line 22 (import) + line 2676
  (the single call site, inside `prebufferNext`, before `resp.blob()`)
- `grep -c "body?.cancel" src/lib/stores/player.svelte.ts` → 1
- The existing next-1 lookahead and bg-lockscreen prebuffer tests pass **unmodified**

## Known Stubs

None.

## Commits

| Commit | Gate | Message |
|--------|------|---------|
| `60b85b8` | RED | `test(32-06): failing spec for the 32-D-15 prebuffer size ceiling` |
| `b868d2e` | GREEN | `feat(32-06): pure 24 MB prebuffer ceiling predicate (32-D-15)` |
| `323669a` | — | `feat(32-06): skip the prebuffer blob above the 24MB ceiling (32-D-15, 32-D-17)` |

## Self-Check: PASSED

- `src/lib/services/prebuffer-ceiling.ts` — FOUND
- `src/lib/services/prebuffer-ceiling.test.ts` — FOUND
- commits `60b85b8`, `b868d2e`, `323669a` — FOUND
