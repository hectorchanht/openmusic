---
spike: 011
name: edge-chart-sources
type: comparison
validates: "Given a Cloudflare Workers egress IP, when Apple Music RSS / KKBOX kma / YouTube Charts are fetched for HK/TW/JP/US/KR, then each returns a parseable, current chart (≥50 rows, covers that serve) with no block, WAF page, or rate limit under a 15× burst"
verdict: VALIDATED
related: [005, 010]
tags: [charts, home, edge, cloudflare, apple-rss, kkbox, youtube-charts, freshness, discovery]
---

# Spike 011: Fresh chart sources from the Cloudflare edge

## What This Validates

**Given** the Cloudflare Workers egress (the trust position the Pages Functions proxy has in prod),
**when** we fetch Apple Music RSS, KKBOX kma, and YouTube Charts for several territories,
**then** each returns a current, parseable chart with covers that serve, and survives a 15× burst
without a block, WAF page, or rate limit.

## Why

The home shelves (Deezer `/chart` for Top Hits/Artists, Last.fm `tag.gettoptracks` / `geo.gettoptracks`
for tag/country rows) feel behind the real hits. All three candidates already worked from the dev Mac
on 2026-09-24; the open question was whether Cloudflare's datacenter egress gets blocked, geo-varied,
or rate-limited — the same failure class as the googlevideo 403 found after spike 006.

**Root cause of the "lag", measured here** (same day, top 10):

| # | Last.fm geo HK | Last.fm tag cantopop | Deezer /chart/0 | KKBOX HK daily |
|---|---|---|---|---|
| 1 | stupid song — Olivia Rodrigo | 知己知彼 — 王菲 | Dracula — Tame Impala | 半糖去冰 — Tr33 |
| 2 | the cure — Olivia Rodrigo | 夢中人 — 王菲 | Boston — STELLA LEFTY | 甲乙丙丁Strangers — 李佳薇 |
| 3 | Ain't In LA — ADÉLA | 最佳損友 — 陳奕迅 | Choosin' Texas — Ella Langley | 追愛狂想 — 姜濤 |

It is not only lag. **Last.fm geo HK is Western** (its HK scrobblers listen to English pop), **Last.fm
tags rank all-time** (王菲 夢中人 is from 1994), and **Deezer's chart is global/Western**. None of them
can show what is hot in HK/TW right now. KKBOX can.

## Research

| Approach | Endpoint | Pros | Cons | Status |
|---|---|---|---|---|
| Apple Music RSS | `rss.marketingtools.apple.com/api/v2/{cc}/music/most-played/{n}/songs\|albums\|music-videos.json` | Public, keyless JSON; any storefront; native-script titles; songs **and albums**; resizable mzstatic art | No new-releases feed (404); no upstream cache headers | Chosen |
| KKBOX kma | `kma.kkbox.com/charts/api/v1/{daily\|weekly}?type=song\|newrelease&terr=&lang=tc&category=&limit=` | Freshest HK/TW charts; **new releases**; Chinese names; 500px covers | Undocumented internal API; HK/TW/SG only | Chosen |
| KKBOX Open API | `api.kkbox.com/v1.1/charts`, `/new-release-categories` | Documented, stable | Needs a client id/secret (free signup) | Fallback if kma breaks |
| YouTube Charts | `charts.youtube.com/youtubei/v1/browse` (`WEB_MUSIC_ANALYTICS`, `FEmusic_analytics_charts_home`) | 100 tracks + **100 artists**; every track carries a `videoId` | Undocumented; weekly (period end ~1 week back) | Chosen |
| Billboard / Melon | HTML scrape | — | Romanized titles (Billboard), no covers, KR-only (Melon), fragile | Rejected before spike |
| Spotify | Web API | — | Editorial/Top-50 playlists blocked for new apps since 2024-11; charts.spotify.com needs login | Rejected before spike |

**Chosen approach:** a throwaway Worker run with `wrangler dev --remote` — code executes ON the
Cloudflare network, so every subrequest egresses from a real Workers IP with the `CF-Worker` header,
without deploying anything public. Personal Cloudflare account (not the Flow account, not the
openmusic prod account, which local wrangler cannot reach anyway).

## How to Run

```bash
npx wrangler dev --remote -c .planning/spikes/011-edge-chart-sources/wrangler.jsonc --port 8799 --ip 127.0.0.1
```

Then open `http://127.0.0.1:8799/` for the live matrix, or record a run:

```bash
node .planning/spikes/011-edge-chart-sources/harness.mjs <label>
```

## What to Expect

`env` shows a Cloudflare egress (`ip=2a06:98c0:…`, a colo code). Every `apple`/`kkbox`/`yt` row is green
with 50–100 items and today's date, except the deliberate edge cases (Apple `200`/`xx`, KKBOX `my`,
YT `ZZ` / bogus clientVersion). Bursts: 15/15 for KKBOX and YT; Apple ~14/15 (see Results).

## Investigation Trail

1. **Run 1 (harness, colo YVR).** Egress confirmed: `ip=2a06:98c0:3600::103` (Cloudflare Workers IPv6
   range), `colo=YVR`. All three sources green across territories. Surprises: Apple 15× burst had one
   15 s timeout; Apple `limit=200` hung 11 s then 500; YT `ZZ` (global) → 400; KKBOX `my` → 404 `{"code":"101"}`;
   KKBOX `limit=100` silently caps at 50; the old Apple host (`rss.applemarketingtools.com`) works on GET
   (it 301s to the new host — the earlier "dead" read from the Mac was a HEAD → 405, not a real failure).
2. **Follow-up: Apple tail latency.** 30 more sequential calls alternating new/old host: **30/30 OK,
   300–1456 ms**, no timeouts. Apple returns `cache-control: max-age=0, private` → upstream gives us no
   cacheability; we must cache at our edge ourselves.
3. **Follow-up: YT global.** `global`, `GLOBAL`, `""` all → 400. There is no global chart via this
   endpoint with these codes; per-country only. Not needed for the home page.
4. **Follow-up: freshness.** Median release age of each chart's top 20: **KKBOX HK 25 d** (newest 2 d),
   Apple TW 91 d, **YT HK 120 d** (weekly, period end 2026-09-17 → ~1 week lag), Apple HK 354 d
   (HK Apple Music listeners replay older catalogue), **Apple CN 7938 d** (~22 years — the CN storefront
   is dead catalogue; never use it). KKBOX `weekly` endpoint also works.
5. **Run 2 (browser report, colo PDX).** Second colo, same results: all green, KKBOX/YT bursts 15/15
   (YT p50 218 ms, KKBOX p50 290 ms), Apple burst again **exactly one 15 s hang** (p50 867 ms).
   Across ~86 Apple calls: 2 hangs, both inside a burst of the identical URL; 0 in the alternating 30.
6. **Head-to-head vs current shelves** (table in Why) — run from the Mac since it is a content question,
   not a reachability one.

## Results

**VALIDATED — all three are GO from the Cloudflare edge.** Two colos (YVR, PDX), ~250 subrequests,
zero blocks, zero WAF pages, zero rate-limit statuses.

| Source | Verdict | Evidence | Build constraints |
|---|---|---|---|
| **011a Apple Music RSS** | ✅ GO | hk/tw/jp/us/kr/sg songs + hk/tw albums, 50/100 rows, updated today; art 100→600 resize serves 206 | `limit` ≤ 100 (200 → 500 after a hang); bad storefront → 500; ~2% of calls hang to the 15 s timeout → **5 s timeout + serve stale**; no upstream caching → **own edge cache**; **skip `cn`** |
| **011b KKBOX kma** | ✅ GO | hk/tw/sg song + newrelease, 50 rows, date 2026-09-24; 15/15 burst; UA not required; covers serve | Territories **hk/tw/sg only** (`my` → 404; `jp` returns a Mandarin chart, not J-pop); `limit` caps at 50; category 297 = overall; 320 and 390 are unlabeled on the page — 320's top is all Cantonese (陳卓賢, 容祖兒), 390's top is English-language singles (Anson Lo's English tracks, JENNIE); map the full category list before exposing a picker; undocumented → never-throw + KKBOX Open API as fallback |
| **011c YouTube Charts** | ✅ GO | TRACKS hk/tw/jp/us/kr + ARTISTS hk/tw, 100 rows each; 15/15 burst; origin/referer/UA not required; thumbnails serve | `clientVersion` must be a real value (`2.0` works, `0.1` → 404) — pin it like the ANDROID_VR constant; no global chart; weekly, ~1 week behind |

**Surprise worth keeping:** the "lag" was mostly **audience skew** (Last.fm HK = Western scrobblers)
and **all-time ranking** (Last.fm tags), not just staleness. Swapping the data source fixes it; tuning
Last.fm cannot.

**Residual risk (not closable from here):** `wrangler dev --remote` runs at the colo nearest this
machine (North America). Prod HK users hit HKG. Every API takes an explicit territory parameter and
all worked from a non-local (CA) egress, so an HK egress is, if anything, more native — but HKG itself
was not observed.
