---
title: "/api/resolve returned {\"hit\":false} for a mainstream song — confirm the Phase-31 edge cache actually fills"
date: 2026-08-31
priority: medium
source: .planning/notes/qq-lossless-first-resolve.md (exploration 2026-08-31)
---

# The Phase-31 edge resolve cache missed the most obvious possible query

**Observed 2026-08-31**, against the deployed app:

```bash
curl "https://openmusic.lol/api/resolve?artist=%E5%91%A8%E6%9D%B0%E4%BC%A6&title=%E7%A8%BB%E9%A6%99"
# → 0.44s, 200, 13 bytes: {"hit":false}
```

`周杰伦 / 稻香` is about as mainstream as CN catalogue gets, and Phase 31 shipped both the
edge-side fill (31-03) and pre-warm on the top search result (31-05, plus the later
`quick-260809-cyk` "pre-warm once per settled search" fixes). A miss here means the designed
fast path may not be delivering on real traffic.

## Not yet ruled out

- **PoP locality.** `caches.default` is per-data-center by design (`31-D-10`). A curl from a dev
  sandbox lands in a different PoP than the phone that did the pre-warming, so a cold miss there
  is expected and harmless. This is the most likely explanation and must be eliminated first.
- **Pre-warm never fired for this query.** The pre-warm is gated on a *settled* search.
- **Fill failed.** `resolve-edge.ts` walks kuwo with `retries=1` and at most two subrequests; a
  kuwo hiccup yields no entry, and a `DRY` negative is itself cached.

## How to check

1. From ONE device: run a search that settles, then immediately `GET /api/resolve` for the top
   result from that same device/network so the PoP matches. A miss there is a real bug.
2. Cross-check Settings → Activity log (`logAction`) for the pre-warm and `resolve.ok` entries.
3. If it is genuinely not filling, the fix likely belongs with Phase 32 anyway — that phase
   replaces the URL-keyed entry with a permanent `matchKey → song_mid` entry, which sidesteps
   both the TTL and the bust machinery.

## Why it matters

If the cache is effectively always cold, Phase 31's measured latency win was coming from
something else, and Phase 32 should not assume this mechanism as a baseline.
