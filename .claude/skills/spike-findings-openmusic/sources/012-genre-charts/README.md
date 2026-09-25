---
spike: 012
name: genre-charts
type: comparison
validates: "Given the fresh-chart sources from 011 lack genre charts, when legacy iTunes RSS genre feeds / Deezer genre charts / KKBOX language categories are fetched, then at least one source yields a current, genre-correct chart per shelf, reachable from where the app would fetch it"
verdict: VALIDATED
related: [011]
tags: [charts, home, genre, itunes-rss, deezer, kkbox, edge, cors, freshness]
---

# Spike 012: Genre charts

## What This Validates

**Given** that 011's winners (Apple RSS v2, KKBOX, YouTube Charts) have no genre dimension,
**when** we probe the candidate genre sources,
**then** at least one yields a current, genre-correct chart per shelf, fetchable from where the app
would fetch it (edge proxy or browser).

## Why

The user flagged it after 011: the proposed homepage has Top Songs / New / Albums / Artists / Trending
but no genre rows — today's Last.fm tag shelves are the only genre surface, and they rank all-time
(王菲 夢中人, 1994 at #2 of `cantopop`).

## Research

| Approach | Endpoint | Pros | Cons | Status |
|---|---|---|---|---|
| Apple RSS v2 `?genre=` | `rss.marketingtools.apple.com/...songs.json?genre=14` | — | Param **ignored** (returns the overall chart) | Dead |
| Legacy iTunes RSS | `itunes.apple.com/{cc}/rss/topsongs\|topalbums/limit=100/genre={id}/json` | Keyless; per storefront **and** genre; returns genre id per row; `access-control-allow-origin: *` | **Ranks iTunes Store purchases, not streams**; bogus genre id silently returns the overall chart; edge-blocked (below) | Chosen — regional genres, **client-side** |
| Deezer genre charts | `api.deezer.com/chart/{genreId}/tracks?limit=50` | Same host + shape as the prod `/api/deezer/chart` route; covers embedded; distinct per genre | Global/Western, not regional | Chosen — Western genres, edge |
| KKBOX kma categories | `category=297\|320\|390` | Fresh daily | Only **HK** has more than one category (320 Cantonese, 297 Mandarin, 390 Western); TW/SG = 297 only. These are language charts, not genres | Chosen — HK language rows |
| YouTube Charts | — | — | No genre dimension | n/a |
| YT Music "Moods & genres" playlists | InnerTube `FEmusic_moods_and_genres` | Curated, region-aware | 3 browse calls per shelf (categories → playlists → tracks) | Not probed — revisit if the above leave a gap |

Genre ids (iTunes, from `MZStoreServices.woa/ws/genres?id=34`): Pop 14, Cantopop/HK-Pop **1251**,
Mandopop **1253**, C-Pop 1250, Tai-Pop 1254, K-Pop **51**, J-Pop **27**, Anime 29, Hip-Hop/Rap 18,
Rock 21, Electronic 7, Dance 17, R&B/Soul 15, Soundtrack 16, Jazz 11, Chinese 1232, Korean 1243.
Deezer genre ids (`api.deezer.com/genre`): Pop 132, Rap/Hip Hop 116, Rock 152, Dance 113, R&B 165,
Alternative 85, Electro 106, Asian 16, Jazz 129, Latin 197, Metal 464, Soul & Funk 169, Films/Games 173.

## How to Run

```bash
npx wrangler dev --remote -c .planning/spikes/012-genre-charts/wrangler.jsonc --port 8799 --ip 127.0.0.1
# then: GET /?suite=env | itunes | itunes403 | deezer
```

## Investigation Trail

1. **Mac, content pass.** Legacy iTunes genre filter works and labels each row with its genre. Median
   release age of the top 20: **HK Pop 18 d, HK K-Pop 37 d, HK Cantopop 57 d, HK Soundtrack 62 d,
   JP J-Pop 85 d** — fresh. But Western genres in the HK storefront are stale (**Rock 6617 d,
   Jazz 8291 d, R&B 3626 d, Hip-Hop 2542 d**) and even US Hip-Hop is only 29 rows led by Flo Rida's
   "Low" (2007). Cause: the legacy feed ranks **iTunes Store purchases**; buyers of Western genres buy
   catalogue classics, while Asian-pop buyers buy new releases. Also: HK J-Pop is stale (1568 d) —
   use the **jp** storefront for J-Pop. HK Mandopop stale (3039 d) — use **tw**, or KKBOX.
   **A bogus genre id (99999) returns 200 with the overall chart** → must verify each row's
   `category.attributes['im:id']`.
2. **Deezer genre charts** differ per genre (overlap with `/chart/0` top 10: Pop 7, Dance 1, Rap 1,
   Rock 0, R&B 0, Asian 0) and are current (Drake, Doechii, Kendrick; HUNTR/X, LISA, aespa).
3. **KKBOX categories** read from each territory page's JSON: HK `320=Cantonese, 297=Mandarin,
   390=Western`; TW and SG `297=Mandarin` only.
4. **Edge pass (colo YVR).** Deezer: 8/8 genres 200, 50 rows. **Legacy iTunes: 11/11 → 403**, empty body,
   `server: cloudflare`, `access-control-allow-origin: *`.
5. **Follow-up: why 403?** Header variants (no UA / curl UA / full browser headers) all 403. The no-genre
   overall feed also 403. The iTunes **search** API returned **429 `Rate limit has been exceeded for:
   itunes-apple-com|general|2a06:98c0:3600::103`** — itunes.apple.com is itself behind Cloudflare and
   rate-limits the **shared Workers egress IP** (every Workers customer shares it). The XML format
   returned 200 once — likely a cache hit, not a reliable path.
6. **Browser pass.** `fetch()` from a page origin (`http://localhost:8799`, this machine's IP):
   HK Cantopop 100/100 on-genre, TW Mandopop 99/99, JP J-Pop 100/100, HK K-Pop 84/95 (the 11 others are
   K-drama OST rows tagged Soundtrack/Children's). 700–1200 ms. CORS works. This matches how the app
   already calls iTunes (`itunes-cover.ts` is client-side "CORS-open").

## Results

**VALIDATED — genre shelves are feasible, from two sources split by region, and one of them must be
fetched from the client.**

| Shelf kind | Source | Where to fetch | Evidence |
|---|---|---|---|
| Regional pop genres (Cantopop hk, Mandopop tw, K-Pop hk, J-Pop jp, HK Pop, Soundtrack) | **Legacy iTunes RSS** genre feed | **Browser** (CORS `*`) — edge is rate-limited | Median age 18–85 d; 84–100% on-genre |
| Western genres (Rap/Hip Hop, Rock, Dance, R&B, Electro, Alternative, Asian) | **Deezer** `/chart/{id}/tracks` | Edge (existing `/api/deezer/chart` pattern) | 8/8 from edge, 50 rows, distinct + current |
| HK language rows (Cantonese / Mandarin / Western) | **KKBOX** `category=320\|297\|390` | Edge | From 011 |
| All-time "classics" by tag | Last.fm `tag.gettoptracks` (existing) | Edge | Kept as an opt-in shelf, off by default |

**Landmines:** never fetch itunes.apple.com from the edge (shared-IP rate limit → 403/429); never trust a
legacy iTunes genre feed without checking each row's genre id; never use the HK storefront for J-Pop,
Mandopop, or Western genres (stale purchase charts).
