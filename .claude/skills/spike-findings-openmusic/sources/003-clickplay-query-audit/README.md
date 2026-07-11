---
spike: 003
name: clickplay-query-audit
type: standard
validates: "Given a real click-to-play in the running app, when instrumented, then count + attribute every /api call so the redesign has a concrete baseline to beat"
verdict: VALIDATED
related: [001, 002]
tags: [audit, perf, baseline]
---

# Spike 003: clickplay-query-audit

## What This Validates
Given a real click-to-play in the running app (not a replica), instrument `window.fetch`,
reset the counter at click time, and **count + attribute** every request fired from
click → playing → up-next-filled. Confirms the user's premise ("click to play still
introduces a lot of search queries") and gives the redesign a concrete number to beat.

## How to Run
Live, in the in-app browser (dev server on :4321):
1. Wrap `window.fetch` to push `{url, t}` into `window.__net` (debug inspection only).
2. Search a song, let results settle, **reset `window.__net = []`**, click a result.
3. After ~14s, categorize `__net` by URL, attributing each source `/search` fan-out by its query string.

## Investigation Trail
1. **Idle app fires ZERO background calls** — measured 0 requests over 17s with no interaction.
   So every flood is triggered by a page-load or playback *event*, not a polling loop. Good news:
   the fix is per-event, not "kill a background timer."
2. **Home page mount fires ~80 `/api/deezer/search` cover-backfill calls** in one burst — the
   discovery grid resolving covers for every imageless tile. (Bonus finding, separate from click-to-play.)
3. **Play from a SEARCH LIST** (up-next = the list remainder) ≈ **15 calls**: resolve (2–3) +
   cover tiers (Deezer + iTunes) + a 7-source cover-CN-tier `searchAll` for coverless tiles + media.
4. **Play where UP-NEXT MUST GENERATE = the headline. 59 calls for ONE click.** Attributed:

## Results

### One click-to-play (單曲, up-next generated) = **59 `/api/*` calls**
| calls | path | what it is |
|:---:|------|------------|
| **56** | `/api/{7 sources}/search` × **8 queries** | **`buildSimilarQueue`: 8 similar ARTISTS × 7 sources each.** The queries were literally 張學友·古巨基·楊千嬅·周杰倫·林俊傑·孫燕姿·王力宏·李克勤 — similar artists of 陈奕迅. |
| 1 | `/api/similar` | up-next seed: Last.fm `artist.getsimilar` → those 8 artist names |
| 1 | `/api/kuwo/detail` | resolve the played track (kuwo — cover came inline, spike 001) |
| 1 | `/api/qq/detail` | prefetch-next resolve |

The **56-call block is exactly the user's complaint**: "similar is returning similar artist,
then we have to search what songs that artist has — kinda waste api query." Confirmed to the number:
**8 artists × 7 sources = 56 searches to build one Up-Next list.**

### Verdict: VALIDATED — premise confirmed, baseline quantified

Clicking one song can fire **~59 API calls**, ~95% of which (56/59) is `buildSimilarQueue`'s
artist-hop fan-out. The single resolve of the played track is cheap (1 call) and already
carries its cover (kuwo, spike 001) — the waste is entirely in the SECONDARY paths.

### Projected redesign cost (applying spikes 001 + 002)
| path | today | redesign | source |
|------|:---:|:---:|--------|
| up-next build | **56** (`artist.getsimilar` + 8×7 `searchAll`) | **1** (`track.getSimilar`) | spike 002 |
| played-track resolve | 1 | 1 (kuwo-first) | spike 001 |
| played-track cover | 0–9 (Deezer→iTunes→CN chain) | **0** (inline from kuwo) → 1 lazy HQ | spike 001 |
| up-next tile covers | 7 × coverless tile (CN searchAll) | **0** (kuwo stubs carry `pic`) | spike 001 |
| **total for a single-song play** | **~59** | **~3** | — |

### Signal for the build
1. **Rewrite `buildSimilarQueue`** to use `track.getSimilar` (spike 002): 56 → 1. Highest-impact single change.
2. **Up-next items carry exact name+artist** → resolve lazily on play via kuwo-first (spike 001); no re-search.
3. **Kuwo-primary resolve returns the cover inline** → drop the Deezer→iTunes→CN cover chain from the
   hot path; keep it only as a lazy HQ upgrade + for the coverless sources (joox/fivesing).
4. **Home page cover-backfill (~80 calls) is a separate, worthwhile optimization** — same root cause
   (cover chain per imageless tile); the same "prefer source-inline cover, cap the fan-out" fix applies.
5. Because idle = 0 calls, the redesign is purely about trimming per-event cascades — no lurking loop to hunt.
