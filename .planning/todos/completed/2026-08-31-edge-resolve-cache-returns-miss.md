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

---

## RESOLVED — 2026-08-31, phase 32 plan 32-07 (the phase gate)

**Two independent findings. The first is the root cause of the report; the second retires the worry.**

### 1. The original probe could not have hit — it used the wrong parameter names

The curl above reads `?artist=…&title=…`. `/api/resolve` has **only ever** read `a` and `t`
(`src/routes/api/resolve/+server.ts`; unchanged since `a3d40ea`, phase 31-03):

```ts
const a = capTerm(url.searchParams.get('a'));
const t = capTerm(url.searchParams.get('t'));
if (!a && !t) return jsonResult({ hit: false }, origin);   // zero cache touches, zero subrequests
```

`artist`/`title` fall straight into that short-circuit, so the response was a **constant
`{"hit":false}` with the cache never consulted at all** — not a cold entry, not a failed fill, not
PoP locality. `13 bytes` in the original transcript is exactly `{"hit":false}`. The "not yet ruled
out" list was investigating a mechanism the request never reached.

### 2. With the correct parameters, the entry fills and hits — verified live on the deployed edge

Probed against `https://openmusic.lol` (real workerd `caches.default`, NOT `pnpm dev`), for the
exact song in this report:

```
稻香 #1  cf-ray a341985a5e912384-YVR  -> {"hit":true,"entry":{"source":"qq","songid":"003aAYrm3GE0Ac","avail":{"qq":"ok"}}}
稻香 #2  cf-ray a34198706f143c29-SEA  -> {"hit":true, ... same songid ...}
稻香 #3..#6 (YVR and SEA interleaved)  -> hit, hit, hit, hit
```

6/6 hits across **two** PoPs, and the earlier cold walk in the same session showed the designed
sequence — first GET `{"hit":false}`, ~4s later `{"hit":true}` with the mid — so the out-of-band
`waitUntil` fill demonstrably lands in workerd. The PoP-locality hypothesis is real but was not the
cause here.

### Caveat on comparability

The entry shape has changed twice since this was filed, so the numbers are **not** directly
comparable to the original: phase 32 replaced the phase-31 URL entry with a permanent
`matchKey → song_mid` entry (32-D-10/D-10a, key `v=2`) and then added a short-TTL `url` beside it
(32-D-20, key **`v=3`**). The transcripts above are against the **v2** shape, which is what is
deployed today; `RESOLVE_CACHE_VERSION` is `'3'` on `main` and rolls the key over on next deploy.
That rollover is by design and is why these warm entries will miss once, then re-fill.

**The report's underlying worry — "the cache is effectively always cold, so phase 31's win came from
somewhere else" — is answered: the mechanism fills and serves.**
