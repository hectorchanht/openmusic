---
spike: 004
name: source-coverage-by-segment
type: standard
validates: "Given a diverse corpus (language/region × genre), when resolved through all sources, then one primary + a short fallback covers EVERY segment — proving a minimal-API-but-fully-functional resolution policy"
verdict: VALIDATED
related: [001, 002, 003]
tags: [sources, coverage, segments, policy, minimal-api]
---

# Spike 004: source-coverage-by-segment

## What This Validates
Extends spike 001 with a DIVERSE 38-song corpus across 14 segments (language/region × genre) and
aggregates PER SEGMENT — to prove whether one primary source + a short fallback stays fully
functional everywhere, and whether the niche sources (jamendo/audius/fivesing) earn a hot-path slot.
Output: a minimal source-resolution POLICY (`POLICY.md`).

## Corpus (38 songs, 14 segments)
mando-pop · canto · cn-rock-indie · cn-hiphop · cn-oldies · cn-ost · japanese · korean · en-pop ·
en-rock · en-hiphop · edm · en-rnb · instrumental · latin. Real, well-known songs per segment so
search recall is fair (e.g. 周杰伦/稻香, 陈奕迅/富士山下, 米津玄師/Lemon, BTS/Dynamite, Eminem/Lose Yourself,
Avicii/Wake Me Up, Yiruma/River Flows in You, Luis Fonsi/Despacito).

## How to Run
```bash
cd .planning/spikes/004-source-coverage-by-segment && node harness.mjs
```
Same method as 001 (CONVENTIONS.md): Node ESM → live `/api/*` on :4321, replicate each adapter's
search+resolve, ranged-probe every audio + cover URL. Richness score = audio(3, gating) + cover(1) + lrc(1).
NOTE: the console "winner" table has a cosmetic `undefined` in the `/n` denominator — **`results.json`
`perSeg` holds the correct per-segment numbers** (used below).

## Results

### Global (of 38)
| source | playable | cover | lrc |
|--------|:---:|:---:|:---:|
| **kuwo** | **38/38** | **38/38** | 33/38 |
| netease | 36/38 | 36 | 36 |
| qq | 35/38 | 35 | 34 |
| joox | 31/38 | **0** | 36 |
| fivesing | 26/38 | 0 | 0 |
| audius | 22/38 | 18 | 0 |
| jamendo | 20/38 | 20 | 0 |

### Per-segment playable / cover / lrc
| segment | kuwo | qq | netease | joox (play/lrc) | jamendo | audius |
|---------|------|-----|---------|-----------------|:---:|:---:|
| mando-pop | **4/4/3** | 3/3/3 | 4/4/4 | 3/3 | 1 | 1 |
| canto | **4/4/4** | 4/4/4 | 4/4/4 | 4/4 | 0 | 0 |
| cn-rock-indie | **3/3/3** | 3/3/3 | 3/3/3 | 2/3 | 0 | 1 |
| cn-hiphop | **2/2/2** | 2/2/2 | 2/2/2 | 1/2 | 1 | 0 |
| cn-oldies | **2/2/2** | 2/2/2 | 2/2/2 | 2/2 | 2 | 0 |
| cn-ost | **2/2/2** | 2/2/2 | 2/2/2 | 2/2 | 0 | 0 |
| japanese | **3/3/3** | 3/3/3 | 3/3/3 | 3/3 | 1 | 3 |
| korean | **3/3/2** | 3/3/2 | 3/3/3 | 3/3 | 3 | 3 |
| en-pop | **3/3/3** | 3/3/3 | 1/1/1 | 2/2 | 2 | 3 |
| en-rock | **2/2/2** | 2/2/2 | 2/2/2 | 2/2 | 2 | 2 |
| en-hiphop | **2/2/2** | 2/2/2 | 2/2/2 | 2/2 | 2 | 2 |
| edm | **2/2/1** | 1/1/1 | 2/2/2 | 2/2 | 2 | 2 |
| en-rnb | **2/2/2** | 1/1/1 | 2/2/2 | 1/2 | 1 | 2 |
| instrumental | **2/2/0** | 2/2/2 | 2/2/2 | 1/2 | 2 | 1 |
| latin | **2/2/2** | 2/2/2 | 2/2/2 | 1/2 | 2 | 2 |

### Verdict: VALIDATED — kuwo is UNIVERSAL; the minimal policy is "kuwo first, done"

1. **kuwo = 100% playable + 100% cover in EVERY segment** (0 segments below 100%). No language, region,
   or genre needs a different primary. This is stronger than spike 001 implied: kuwo isn't just the best
   average — it's a clean sweep. **One kuwo call resolves any song with audio + cover.**
2. **qq and netease are equally rich (r5) when they hit** but each has holes (qq flaky search 35/38;
   netease intermittent 36/38 — this run it whiffed en-pop's Taylor Swift + Ed Sheeran entirely). They are
   the fallback, not the primary — kuwo's perfect reliability wins.
3. **jamendo + audius NEVER beat kuwo — not even on Western/EDM/Latin.** On every mainstream segment kuwo
   already scores full; audius/jamendo score ≤ kuwo. They add ZERO incremental coverage for mainstream
   search and belong OFF the hot path — last-resort only, for CC-indie / UGC / niche the CN-4 genuinely lack.
4. **joox has NO cover ever** (0/38) but strong audio+lyrics — a lyric/audio fallback, never a cover source.
5. **kuwo's only real gap is lyrics (33/38)** — and 2 of the 5 misses are instrumentals (no lyrics exist).
   For a genuine lyric miss, ONE fetch from netease/qq/joox (which hit lrc 36/34/36) fills it — bounded,
   not a fan-out.

## Signal for the build
- **The minimal-API policy is in [`POLICY.md`](./POLICY.md).** Headline: try **kuwo only** (1 call → audio+cover)
  → it works ~100% of the time → fully functional with the fewest possible API calls.
- Confirms + strengthens spike 001's requirement: kuwo primary is not a compromise, it's a clean win.
- Reinforces the search-fan-out cut: because kuwo alone covers everything, click-to-play resolve needs
  ONE source, never the 7-way fan-out. Same for Up-Next items (resolve each via kuwo).
