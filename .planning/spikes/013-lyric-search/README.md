---
spike: 013
name: lyric-search
type: comparison
validates: "Given a lyric line pulled at runtime from 17 songs (Cantonese, Mandarin, English, J-pop, K-pop), when it is sent to Netease cloudsearch type=1006 / QQ musicu search_type=7 / YouTube Music free text / Genius search/lyric / today's /api keyword proxies, then the right song (title + original artist) is in the top 5"
verdict: VALIDATED
related: [001, 004, 005, 014]
tags: [search, lyrics, netease, qq, genius, ytmusic, ranking, scorematch]
---

# Spike 013: Lyric Search

## What This Validates
Given a lyric fragment a user remembers (full line, a partial line, or the line in the other Chinese script),
when it is searched, then the song is found: right title + original artist in the top 5.

## Research
No public docs exist for any of these; each was verified by probe (2026-10-04, from this Mac).

| Approach | Endpoint | Auth | Pros | Cons | Status |
|---|---|---|---|---|---|
| 013a Netease lyric mode | `music.163.com/api/cloudsearch/pc?s=&type=1006` | none | Lyric-indexed, 88% at rank 1 | No Jay Chou (catalogue licensing); `search/get/web` returns nothing abroad (`abroad:true`); **blocked from Workers egress (-462), see 014** | probed |
| 013b QQ lyric mode | `u.y.qq.com/cgi-bin/musicu.fcg` POST, `search_type:7` | none | Lyric-indexed, broad CN catalogue incl. Jay Chou | Throttle answers HTTP 200 + `req.code 2001` + empty list at ~2 req/s | probed |
| 013c YouTube Music free text | InnerTube `search` (our `/api/ytmusic/search`, and unfiltered) | none | Already shipped (Phase 27) | Partial lines collapse (35–41%); top results are lyric-video uploads | probed |
| 013d Genius | `genius.com/api/search/lyric?q=` | none | Best overall (94%), strong on CJK too | Metadata only (title + artist), so audio needs a second resolve (kuwo-first policy) | probed |
| 013e Today's keyword proxies | `/api/{qq,netease,joox,kuwo}/search` | none | **Already match lyric text** — union = 100% | kuwo upstream dead (expired TLS cert, prod 526) | probed |
| LRCLIB `/api/search?q=` | — | — | — | Matches title/artist/album only, not lyric text → used here as the NEUTRAL lyric-line source instead | ruled out as a search target |

**Chosen approach:** head-to-head harness over all of them on identical runtime-derived queries.

## How to Run
```bash
# dev server on :4321 (preview_start name=dev) for the c/e targets
node .planning/spikes/013-lyric-search/harness.mjs      # scored run → results.json
node .planning/spikes/013-lyric-search/server.mjs       # paste-a-lyric page → http://localhost:4399
```

## What to Expect
`harness.mjs` prints one line per query (target letter + exact-hit rank, `·` = miss) and a summary table;
`server.mjs` serves `report.html`: paste any lyric line, see every upstream's top 5 side by side, plus the
scored matrix from `results.json`.

## Investigation Trail
1. **Shape probes (title query, never lyrics).** All five upstream families answer anonymously from this Mac.
   Netease lyric mode works only via `cloudsearch/pc` — the older `search/get/web` returns 0 songs with
   `abroad: true`. QQ lyric mode (`search_type: 7`) and Genius `search/lyric` return clean title/artist rows.
2. **Lyric-line source pivot.** The plan was to pull lines from each song's kuwo LRC through our proxy. kuwo
   is DOWN: `kw-api.cenguigui.cn` serves a cert that expired 2026-04-14; prod `/api/kuwo/search` → **526**,
   dev → 500. Flagged as a separate task. Switched to **LRCLIB** `plainLyrics` — a neutral community DB, which
   also removes any home-index bias (a Netease-sourced line would favour Netease's own transcription).
3. **Copyright-safe method.** Lines are picked at runtime (35% and 65% through the deduped line list, credit
   lines and lines containing the title dropped — a title-bearing line is a free keyword hit, not a lyric
   test). Variants: `full`, `frag` (middle 60% of chars / drop first+last word), `alt-script` (Traditional ⇄
   Simplified via the repo's `tongwen-dict` char maps — `tongwen-core`'s ESM only resolves under a bundler, so
   the JSON maps are applied directly). `results.json` stores song / line / variant / length / ranks only.
4. **First full run crashed** on LRCLIB answering an error object instead of an array → retry once + guard.
5. **Head-to-head (84 queries × 9 targets).** See Results. Surprise #1: today's keyword proxies already match
   lyric text — the union of qq-tang + netease-Meting + joox finds **100%** of queries.
6. **QQ empties investigated** (`probe-qq-empty.mjs`). The 9 QQ "no rows" answers are a **soft throttle**:
   HTTP 200, `code 0`, inner `req.code 2001`, empty list — in a streak at ~2 req/s from one IP, then it clears.
   Surprise #2: QQ's GENERAL search (`search_type: 0`) returns the same lyric hits as lyric mode (7) —
   QQ's ordinary search already indexes lyrics.
7. **Netease misses explained.** Every 稻香 query misses: Jay Chou's catalogue is not on Netease (Tencent
   licensing). Netease returns same-title covers instead (title@5 = 99%).
8. **Live-app baseline (013e-live).** If the proxies already return the song, does the app show it? Drove the
   real `/search` page: the page fetches LRCLIB itself, submits the line, and reports ranks + category codes
   only (`live-results.json`). The original recording was **never #1, top-5 in 5/14, median rank 33.5** of
   51–95 rows. Top slots go to same-title covers and YouTube lyric-video uploads (long titles embedding lyrics).
9. **Root cause of the live ranking.** `scoreMatch` (search/+page.svelte `rankList`) never filters, it
   re-orders. For a lyric query `similarity()` ≈ 0 for every row, so `shortTitleBoost` (D-06) decides the
   order: it rewards titles whose LENGTH is close to the query length. A pasted lyric is long, so long titles
   win (lyric videos, `富士山下（深情版）`) and the 4-char original sinks.
10. **Playability of a QQ lyric hit.** musicu row `mid` == tang `song_mid` (`003aAYrm3GE0Ac` for 稻香), and
    `/api/qq/detail?msg=<title artist>&mid=<mid>` resolves audio + lyrics. musicu rows also carry album name,
    `interval` (duration) and album mid → `y.gtimg.cn/music/photo_new/T002R300x300M000{albumMid}.jpg` serves
    (200, image/jpeg) — a free cover tang's search lacks.
11. **Gotcha found on the way:** another session's worktree under `.claude/worktrees/` regenerating its
    `.svelte-kit/tsconfig.json` makes the :4321 Vite server force-reload every page — live in-page runs must
    persist progress in `sessionStorage` and resume.

## Results
**Verdict: ✅ VALIDATED — lyric search is feasible today, and the blocker is RANKING, not upstream.**

| Target | ex@1 | ex@5 | ti@5 | canto | mando | en | jp | kr | p50 ms | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| a netease-1006 (official) | 88 | 90 | 99 | 100 | 76 | 100 | 100 | 88 | 417 | no Jay Chou; **edge-blocked (014)** |
| b qq-type7 (official) | 87 | 89 | 89 | 87 | 90 | 94 | 75 | 100 | 425 | all misses = 2001 throttle, not true misses |
| c ytm-songs (our proxy) | 55 | 58 | 58 | 83 | 66 | 19 | 50 | 50 | 572 | frag 35% |
| c ytm-top (unfiltered) | 40 | 65 | 82 | 74 | 69 | 56 | 63 | 50 | 594 | lyric-video uploads |
| d genius | 83 | **94** | 96 | 91 | 90 | 100 | 100 | 100 | 535 | metadata only |
| e base-qq (tang, today) | 82 | 87 | 87 | 96 | 76 | 94 | 100 | 75 | 913 | already lyric-aware |
| e base-netease (Meting, today) | 77 | 80 | 89 | 100 | 62 | 88 | 88 | 63 | 632 | already lyric-aware |
| e base-joox (today) | 80 | 86 | 94 | 100 | 97 | 38 | 100 | 88 | 585 | weak on English |
| e base-kuwo (today) | 0 | 0 | 0 | — | — | — | — | — | — | **upstream cert expired** |

By variant (ex@5): netease full 94 / frag 91 / alt-script 81 · qq 88 / 88 / 94 · genius 94 / 94 / 94 ·
ytm-songs 71 / **35** / 81. Union of any two of {qq, netease, genius} = 100%.

**Live app today (013e-live, 14 queries):** original song at #1 **0/14**, top-5 **5/14**, median rank **33.5**.

**Surprises:** (1) the keyword proxies we already call match lyrics; (2) QQ general search = lyric search;
(3) the app's `shortTitleBoost` actively buries the answer for long queries; (4) QQ throttles with a 200 +
`req.code 2001`; (5) kuwo — the primary resolver — is down in prod (expired upstream TLS cert).

**Signal for the build:** a lyric search needs (a) an upstream ordering kept as-is — never `scoreMatch` — and
(b) one lyric-ranked source. QQ `search_type: 7` from the edge is the primary (014: 97% @1 at the edge),
Genius the fallback (metadata → name+artist resolve). YTMusic and Netease-official are out.
