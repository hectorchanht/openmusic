# Spike Manifest

## Idea
Cut wasteful API calls on click-to-play. Today, secondary paths fan out full multi-source
`searchAll` calls: `crossSourceLyric` (on a lyric miss), the cover-resolution chain
(Deezer→iTunes→CN search per tile), and `buildSimilarQueue` (Last.fm returns similar
*artists*, then one `searchAll` per artist ×8). The target flow: click → resolve ONE
highest-quality source that returns everything in one shot (mp3 + cover + lyrics + a
downloadable link) → fall back to the next source only on failure → carry EXACT
name+artist into Up-Next so only a cover needs resolving (no re-search). Downstream
design item (out of scope unless trivial to probe): same name+artist yields many
versions → a version-picker modal before play.

## Idea — Session 2 (2026-07-14): YouTube Music as a source
Integrate YouTube Music into OpenMusic as a first-class source (search · play · lyrics · download)
that fits the existing adapter model (client adapter + edge proxy + one registry line), running on
the Cloudflare Workers edge (workerd, `nodejs_compat`, no yt-dlp/native binaries). Stretch goal:
connect a Google/YT account to inherit the user's library (liked songs, recent history, taste/genre).
Reference clients (Android/Kotlin, InnerTune lineage): Metrolist, OuterTune, ArchiveTune — studied
for their InnerTube client + auth approach, NOT reused. Spikes 005–008 answer go/no-go per pillar;
the make-or-break is 006 (a stream URL that plays in a plain `<audio>` from the edge).

## Idea — Session 3 (2026-09-24): fresh home-page charts
Replace the home page's stale discovery shelves (Deezer `/chart` Top Hits/Artists + Last.fm tag/geo rows)
with sources that reflect what is actually hot per region: Apple Music RSS (songs + albums), KKBOX
(HK/TW songs + new releases), YouTube Charts (tracks + artists). Spike 011 answers whether each is
reachable from the Cloudflare Workers edge, which is where the proxy runs.

## Requirements
Design decisions that emerged; non-negotiable for the real build. Updated as spikes progress.

- **[001] Reorder the resolve/fallback chain to `kuwo → qq → netease → joox → (fivesing/audius/jamendo)`.**
  Today netease is the registry-default primary but is empirically the least reliable of the CN-4
  (intermittent upstream). kuwo is the only source both reliable (20/20) and rich (audio+cover+lyrics ~19–20/20).
- **[010] MusicBrainz is the canonical ARTIST IDENTITY layer for CJK.** A name in any script
  (Traditional / Simplified / romanized) resolves to ONE mbid at score 100, so 周傑倫 · Jay Chou ·
  周杰倫 collapse to a single artist page with no heuristic merge. Display name = canonical `name`
  + locale-tagged aliases, switched on the existing artist-locale setting.
- **[010] Deezer is NOT replaced.** It keeps artwork, non-CJK artists, and the fallback slot; MB
  supplies CJK albums/tracklists in the original script. MB is curated, so it can miss very new
  releases Deezer has.
- **[001] Use the source-embedded cover on the hot path; upgrade to Deezer HQ lazily.** kuwo/qq/netease
  return a usable cover WITH the resolve — removes the Deezer→iTunes→CN cover chain from ~19/20 plays.
  Only joox + fivesing need cover backfill. (User hypothesis (a) validated.)
- **[001] One single-source resolve already yields the downloadable link** (every audioUrl is a direct
  progressive file or own-origin stream) — no separate download resolve.
- **[001] PRODUCTION BUG surfaced: netease is currently returning 0 results** — its qijieya Meting
  upstream (`api.qijieya.cn/meting/`) is intermittently dry. A dead default-primary silently degrades
  search live. Needs its own fix (retry/health-gate or a second netease upstream). NOT part of the spike.
- **[002] Similar-songs PRIMARY = Last.fm `track.getSimilar`** — returns exact `{artist,title}` pairs
  (pre-ranked by `match`) in ONE call, 5/5 resolvable in kuwo. Replaces `buildSimilarQueue`'s 8× `searchAll`
  fan-out (≈33–57 calls → 1). Needs a NEW edge route (`/api/lastfm/similar-tracks`) — existing `/api/similar`
  is artist-only and `/api/lastfm/info` whitelists `*.getinfo`.
- **[002] Similar FALLBACK (newer CN songs where track.getSimilar is dry) = `artist.getSimilar`**, but resolve
  each candidate's top track via the SINGLE primary source (kuwo), NOT an 8-source `searchAll` per artist.
- **[002] Up-Next items carry exact name+artist** → tap = single-source resolve only (no re-search) + free/1 cover.
  Order the list by Last.fm `match` score.
- **[003] MEASURED BASELINE: one single-song play = ~59 `/api/*` calls; 56 of them are `buildSimilarQueue`
  (8 similar artists × 7 sources).** Idle app = 0 calls (no polling loop — all floods are per-event). Home
  mount = ~80 Deezer cover-backfill calls (separate, same root cause). Redesign (001+002) projects **~59 → ~3**
  for a single-song play. Rewriting `buildSimilarQueue` (56→1) is the single highest-impact change.
- **[004] MINIMAL RESOLUTION POLICY (fewest calls, still fully functional): resolve every play through
  `kuwo` ONLY (1 call → audio + cover), fallback `qq → netease → joox`, and query `fivesing/audius/jamendo`
  only when all mainstream miss.** kuwo is empirically 100% playable+cover across all 14 language/region×genre
  segments; jamendo/audius add zero mainstream coverage and stay OFF the hot path. NEVER fan out all sources
  on click (that's a search-page concern). Full policy: [004 POLICY.md](004-source-coverage-by-segment/POLICY.md).

### YouTube Music source (Session 2, spikes 005–008)
- **[005] YTMusic `search()` = InnerTube `WEB_REMIX` + songs-filter param, public key, no auth.** `songid =
  videoId`, `uid = ytmusic:${videoId}`. Parse `musicResponsiveListItemRenderer` rows; disambiguate
  artist/album via each run's `pageType`. Cover URL is resizable (`=w{n}-h{n}`) → free HQ, no backfill.
- **[006] YTMusic playback = `ANDROID_VR` player client + a cached `visitorData` token → itag 140 (AAC/mp4).**
  Formats are DIRECT urls (NO signature cipher, NO `n` throttle) → no base.js engine needed. iOS Safari needs
  AAC (itag 140), not Opus (251).
- **[006] Stream URLs are IP-locked + expire ~6 h → MUST proxy bytes through the edge**, never set
  `<audio>.src` to a raw googlevideo URL. Reuse the `audius` proxy pattern: `/api/ytmusic/stream/{videoId}`
  → Worker calls player + streams the body (own-origin src, CORS/Capacitor-safe). `resolve()` re-fetches per
  play (no long URL caching).
- **[006] OPEN (verify on a deployed Worker): player + googlevideo subrequests must egress the same
  Cloudflare IP**, and bot-challenge rate under load must be acceptable. This path is adversarial and will
  need ongoing maintenance (YouTube fights extractors). ToS/legal risk flagged for a human call.

### Fresh home charts (Session 3, spike 011)
- **[011] Home chart shelves source from Apple Music RSS + KKBOX kma + YouTube Charts, all fetched
  edge-side.** All three verified from Workers egress (two colos, zero blocks). Last.fm geo/tag and
  Deezer `/chart` are NOT fresh-regional: Last.fm geo HK is Western, Last.fm tags rank all-time.
- **[011] Own the caching.** Apple sends `max-age=0, private`; charts change daily/weekly → edge-cache
  each (source, territory, type) ~6 h with serve-stale on upstream failure. Apple hangs ~2% of calls →
  5 s timeout, never block a shelf on it.
- **[011] Per-source limits are hard:** Apple `limit` ≤ 100 and never the `cn` storefront (22-year-old
  catalogue); KKBOX territories hk/tw/sg only, 50 rows max; YouTube per-country only (no global) and a
  pinned real `clientVersion`.
- **[011] The undocumented two (KKBOX kma, YouTube Charts) degrade to an empty shelf, never an error**
  (never-throw boundary, like `deezer.ts`). KKBOX Open API (client credentials) is the documented fallback.

- **[012] Genre shelves split by region.** Regional pop genres (Cantopop 1251 @hk, Mandopop 1253 @tw,
  K-Pop 51 @hk, J-Pop 27 @jp) come from the **legacy iTunes RSS genre feed, fetched CLIENT-SIDE** —
  itunes.apple.com rate-limits the shared Workers egress IP (403/429) but sends `access-control-allow-origin: *`.
  Western genres (Rap 116, Rock 152, Dance 113, R&B 165, Electro 106, Alternative 85, Asian 16) come from
  **Deezer `/chart/{id}/tracks` at the edge**. HK language rows from KKBOX categories 320/297/390.
- **[012] Verify every legacy iTunes row's genre id** (`category.attributes['im:id']`) — a bogus id returns
  the overall chart with a 200. Never use the HK storefront for J-Pop / Mandopop / Western genres (stale
  purchase charts — the legacy feed ranks iTunes Store sales, not streams).
- **[user 2026-09-24] Existing Last.fm/Deezer shelves stay, hidden by default.** The new chart homepage is the
  default layout; Top Hits (Deezer), Top Artists (Deezer), Last.fm tag + country shelves remain in
  /settings/home and can be re-enabled.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | source-resolve-richness | standard | 20 songs × 7 sources: resolve success + payload richness (mp3 · inline cover+loads · lrc · duration · download) → rank primary + fallback | ✅ VALIDATED — kuwo primary; source-cover free; netease upstream intermittent | sources, resolve, cover, benchmark |
| 002 | similar-songs-api | comparison | Last.fm `track.getSimilar` vs Deezer vs current artist-hop baseline → exact artist+title pairs, fewest API calls | ✅ WINNER: track.getSimilar (1 call, exact pairs, 5/5 resolvable) vs 8× searchAll baseline | similar, upnext, lastfm, deezer |
| 003 | clickplay-query-audit | standard | Instrument real click-to-play → count + attribute `/api/*` calls (crossSourceLyric / cover / up-next) → baseline to beat | ✅ VALIDATED — single-song play = **59 calls**, 56 of them buildSimilarQueue's 8 artists × 7 sources; redesign → ~3 | audit, perf, baseline |
| 004 | source-coverage-by-segment | standard | 38 songs × 14 language/region×genre segments → per-segment winner + minimal-API policy | ✅ VALIDATED — **kuwo 100% playable+cover in EVERY segment**; jamendo/audius earn no hot-path slot; policy = "kuwo first, done" ([POLICY.md](004-source-coverage-by-segment/POLICY.md)) | sources, coverage, segments, policy, minimal-api |
| 005 | ytmusic-innertube-search | standard | Given InnerTube WEB_REMIX search from the edge, when a query is sent, then ≥1 playable track parses into an OpenMusic `Track` stub (videoId/title/artist/album/cover) | ✅ VALIDATED — 100% videoId/cover/artist/album across EN/JP/CJK/indie; richer than CN at search time; search is the easy pillar | ytmusic, innertube, search, source |
| 006 | ytmusic-playable-stream | standard | Given a videoId, when the player endpoint is queried + the audio stream URL extracted (cipher / n-param / PoToken as needed), then the URL plays in a plain `<audio>` AND stays playable (no mid-stream 403) | ✅ VALIDATED (w/ caveat) — `ANDROID_VR`+`visitorData` → play=OK, **DIRECT url, no cipher, no throttle**, itag 140 AAC (iOS-safe), 206+ranges; **IP-locked → must proxy bytes edge-side (audius pattern)**; durability is a maintenance cost | ytmusic, stream, cipher, potoken, the-wall |
| 007 | ytmusic-lyrics | standard | Given a videoId, when timed/plain lyrics are requested (InnerTube next→browse, else external fallback), then lyrics are returned | ⚠ PARTIAL — **plain lyrics broad + multilingual** (next→browse, no auth); **timed/synced NOT via YT** → reuse existing `crossSourceLyric` by name+artist for LRC. Net: GO | ytmusic, lyrics, innertube |
| 008 | ytmusic-account-library | standard | Given a Google/YT auth (OAuth or cookie), when the user library is queried, then liked songs + recent history + a taste/genre signal are readable — ToS/legal risk flagged, not assumed | ⚠ PARTIAL — liked+history readable via InnerTube-as-user; **cookie auth native-only (web can't)**, only OAuth device-flow works (grey-area TV client); **genre not a field → infer**; adds per-user token storage (new threat model). **SPLIT to a later, legal-gated milestone** | ytmusic, auth, oauth, library, legal |
| 010 | cn-album-upstream | standard | Given a CJK artist name in ANY script, when resolved against a keyless upstream, then ONE canonical artist identity + exhaustive original-script albums + ordered tracklists | ✅ VALIDATED — **MusicBrainz**. 陳奕迅 **72 albums vs Deezer's 5**; 周杰倫 titles in Chinese (最偉大的作品, not "Greatest Works Of Art"). Surprise: 陳奕迅/陈奕迅/Eason Chan AND 周傑倫/周杰伦 each collapse to ONE mbid at score 100 → the "3 artist pages" merge needs NO heuristic. Constraint: ~1 req/s → 503 (detectable, retryable); edge-cache 24h. Cover Art Archive fills MB's artwork gap | musicbrainz, cjk, albums, artist-identity, deezer, upstream |
| 011 | edge-chart-sources | comparison | Given Cloudflare Workers egress, when Apple Music RSS / KKBOX kma / YouTube Charts are fetched for HK/TW/JP/US/KR, then each returns a current parseable chart with serving covers and survives a 15× burst | ✅ VALIDATED — **all three GO** (011a Apple ✓, 011b KKBOX ✓, 011c YouTube ✓): 2 colos (YVR/PDX), ~250 subrequests, zero blocks/WAF/429. Apple ~2% 15 s hangs → timeout + serve-stale; KKBOX freshest (median top-20 age 25 d) but hk/tw/sg only; YT 100 tracks + 100 artists w/ videoIds, weekly. Surprise: the "lag" is Last.fm audience skew + all-time ranking, not just staleness | charts, home, edge, apple-rss, kkbox, youtube-charts, freshness |
| 012 | genre-charts | comparison | Given 011's sources lack genre, when legacy iTunes RSS genre feeds / Deezer genre charts / KKBOX categories are probed (Mac, edge, browser), then each genre shelf has a current, genre-correct source reachable where the app fetches it | ✅ VALIDATED — regional genres = **legacy iTunes RSS, client-side only** (edge 403/429: itunes.apple.com rate-limits the shared Workers IP; CORS `*` in browser, 84–100% on-genre, median age 18–85 d); Western genres = **Deezer `/chart/{id}`** at the edge (8/8, distinct, current); HK language rows = KKBOX 320/297/390. Landmine: bogus iTunes genre id returns the overall chart with 200; HK storefront Western/J-Pop genres are stale purchase charts | charts, home, genre, itunes-rss, deezer, kkbox, cors |
