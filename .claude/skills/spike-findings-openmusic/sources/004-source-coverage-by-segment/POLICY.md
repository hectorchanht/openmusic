# Minimal-API Source-Resolution Policy

> Derived from spikes 001–004 (empirical, 20 + 38 real songs across 14 language/region × genre
> segments). Goal: **fewest API calls, still fully functional across every segment.**

## The one rule

**To play any song: resolve it through `kuwo` only. One call returns audio + cover.**

Empirically kuwo is **100% playable + 100% cover across all 14 segments** (Mandarin, Cantonese,
CN rock/hiphop/oldies/OST, Japanese, Korean, English pop/rock/hiphop, EDM, R&B, instrumental, Latin).
There is no segment where a different primary is needed.

## Resolution chain (stop at the first that yields a playable URL)

| step | source | when it runs | why |
|:---:|--------|--------------|-----|
| 1 | **kuwo** | always | 38/38 playable + cover inline. ~100% of plays stop here → **1 API call**. |
| 2 | **qq** | kuwo miss | 35/38, full richness (audio+cover+lyrics+**duration**) when it hits. |
| 3 | **netease** | kuwo+qq miss | rich when up, but upstream (qijieya) is intermittent — never primary. |
| 4 | **joox** | 1–3 all miss | strong audio+lyrics, **no cover** → pair with a cover backfill. |
| 5 | **fivesing → audius → jamendo** | everything above missed | niche/UGC/CC-indie only; ~never reached for mainstream. Keep enabled for the long tail, never on the hot path. |

**Do NOT fan out to all sources on click.** The current behavior (search all 7) is unnecessary:
kuwo alone is fully functional. Fan-out is a search-page concern, not a play concern.

## Cover
- Steps 1–3 return a usable cover **inline with the resolve** (kuwo `pic`, qq `album_pic`, netease `pic`).
  Use it immediately. Upgrade to a Deezer HQ cover **lazily**, off the hot path (1 optional call).
- Only steps 4–5 (joox/fivesing) lack a cover → run the existing Deezer→iTunes backfill for those alone.

## Lyrics
- kuwo returns lyrics on 33/38 (misses are mostly instrumentals, which have none). qq/netease/joox
  hit lyrics on 34–36/38.
- On a genuine lyric miss (a song that *should* have lyrics), do **ONE** cross-source lyric fetch from
  netease/qq/joox — bounded to a single source, never a fan-out. (This is today's `crossSourceLyric`,
  just capped to one candidate.)

## Up-Next (from spike 002)
- Build the list with Last.fm `track.getSimilar` → exact `{artist,title}` pairs in **1 call**
  (replaces the 8× `searchAll` artist-hop = 56 calls, spike 003).
- Resolve each queued song lazily on play through the chain above (kuwo first) — no re-search.
- Cover for each queued tile comes free from kuwo's inline `pic`; HQ upgrade is lazy.

## Net effect
| action | today | this policy |
|--------|:---:|:---:|
| resolve one song | 1 (its source) + cover chain (0–9) | **1 (kuwo, cover inline)** |
| build a 10-song Up-Next | ~56 (8 artists × 7 sources) | **1 (`track.getSimilar`)** |
| single-song play total (measured, spike 003) | **~59** | **~3** |

Fully functional across every segment tested, at the floor of API calls.
