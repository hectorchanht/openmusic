---
spike: 001
name: source-resolve-richness
type: standard
validates: "Given 20 real songs, when resolved through each source, then one high-quality source returns everything (mp3+cover+lrc) reliably enough to be the single primary, with a clear fallback order"
verdict: VALIDATED
related: [002, 003]
tags: [sources, resolve, cover, benchmark]
---

# Spike 001: source-resolve-richness

## What This Validates
Given 20 real songs, when each is searched + resolved through every source
(netease · qq · kuwo · joox · fivesing · jamendo · audius) via the live `/api/*` proxy,
then measure **success rate** + **payload richness** (mp3 plays · cover loads · lyrics ·
duration) per source and produce a **primary + fallback ranking** for the "one-shot
single-source resolve" redesign.

## Research
- Static read of all 7 adapters (`src/lib/sources/*.ts`) + proxies. What each returns:
  - **netease**: audio(`url`) + cover(`pic`) + `lrcUrl` at SEARCH; lyrics fetched in resolve. Upstream = qijieya Meting proxy.
  - **qq**: NOTHING at search; resolve detail → audio + cover(`album_pic`) + lyrics(`song_lyric`) + **duration**(`song_play_time`, the ONLY source with it).
  - **kuwo**: cover(`pic`) at search; resolve → audio(`url`) + cover + lyrics(`lyric`).
  - **joox**: lyrics(`歌词内容`) at search; resolve → audio (per-URL HEAD/GET probe, slow) + lyrics. **No cover field anywhere.**
  - **fivesing**: audio-only UGC; no cover, no lyrics.
  - **jamendo**: audio + cover at search (CC/Western catalog); resolve is a no-op.
  - **audius**: cover(`artwork`) + duration at search; audio = deterministic `/api/audius/stream/{id}` (302→GCS mp3).
- Tokens: `.dev.vars` has JOOX_TOKEN + LASTFM_KEY; `wrangler.jsonc` has JAMENDO_CLIENT_ID. **Confirmed `vite dev` injects `platform.env`** — JOOX (code:200 + songs) and Jamendo (code:0 + results) both returned live data, so no source was under-represented for a missing token.

## How to Run
```bash
# dev server must be up on :4321  (preview_start name=dev)
cd .planning/spikes/001-source-resolve-richness && node harness.mjs
# → prints per-song matrix + aggregate; writes results.json + report.html
```
`harness.mjs` replicates each adapter's exact search+resolve request/parse against the
real proxy, then ranged-probes every audio + cover URL (bytes=0-1) for real playability.

## What to Expect
A 20×7 matrix + aggregate counts, and `report.html` (green=playable, hover for probe codes).

## Investigation Trail
1. **First smoke test surfaced a live production bug.** netease returned `[]` for EVERY
   query. Traced past our proxy to the upstream: `api.qijieya.cn/meting/?server=netease&type=search&id=…`
   returned `[]` directly — **the Meting upstream was dry**. netease is the registry-default
   *primary* source and the richest-at-search, so this is a real production regression, not a harness bug.
2. **netease then RECOVERED mid-run** — dead for songs 1–7 (`search=false`), fully rich from
   song 8 onward (audio 206 · cover 206 · lyrics). So the qijieya upstream is **intermittent**,
   not permanently dead. That intermittency is the disqualifier for keeping it primary.
3. **qq is flaky at search, not at resolve.** qq missed 4/20 (稻香/十年/光年之外/演员) with
   NO thrown error — the tang search endpoint just returned 0 rows those times (isolated
   re-runs DO find them). Every time qq DID return a row it resolved to a perfect 4/4
   (audio+cover+lyrics+duration). So qq's weakness is search recall/stability, not payload.
4. **audius stream 403s.** Several audius `/stream/{id}` probes returned 403 (region/auth),
   e.g. 稻香. Its covers load fine (200) but audio is unreliable and it has no lyrics.
5. **kuwo never missed.** 20/20 search, 19/20 audio playable, 20/20 cover, 19/20 lyrics —
   across Chinese mainstream AND English mainstream. Cover is present on the SEARCH stub too.

## Results

### Aggregate (of 20)
| source | search | resolve | audio▶ | cover | lrc | dur | one-shot (a+c+l) |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **kuwo** | 20 | 20 | **19** | **20** | **19** | 0 | **~19/20** ✅ |
| **qq** | 16 | 16 | 16 | 16 | 16 | **16** | 16/16 when hit (flaky search) |
| joox | 20 | 20 | 18 | **0** | 19 | 0 | audio+lrc, no cover |
| netease | 13 | 12 | 13 | 13 | 12 | 0 | rich but **upstream intermittent** |
| fivesing | 19 | 19 | 19 | 0 | 0 | 0 | audio-only |
| audius | 10 | 10 | 9 | 7 | 0 | 10 | mainstream-weak, 403s |
| jamendo | 5 | 5 | 5 | 5 | 0 | 0 | CC/Western only |

### Verdict: VALIDATED — with a source reorder

The "click → resolve ONE source that returns mp3+cover+lyrics in one shot → fall back on
failure" flow is **feasible**, but the primary must NOT be today's registry-default
(netease). Empirically:

- **PRIMARY = kuwo.** Only source that is BOTH reliable (20/20) AND rich (audio+cover+lyrics
  ~19–20/20). Cover is on the search stub, so even Up-Next tiles seeded from kuwo get a cover
  with zero extra calls. Its one gap is duration (cosmetic).
- **FALLBACK 1 = qq.** Richest single payload (audio+cover+lyrics+**duration**) — the only
  source with duration — but search recall is flaky (16/20). Perfect as the #2 when kuwo misses.
- **FALLBACK 2 = netease.** Rich when its upstream is up, but qijieya is intermittently dry.
  Cannot be primary until the upstream is fixed or a second netease upstream is added.
- **FALLBACK 3 = joox** for audio+lyrics (pair with cover backfill — it has no cover).
- **SUPPLY-ONLY = fivesing / audius / jamendo** — audio-only UGC or niche/Western catalogs;
  last-resort for songs the CN-4 miss (audius also 403s and jamendo covers only CC/Western).

### Signal for the build (feeds spike 003 + the redesign)
1. **Reorder the resolve/fallback chain to kuwo → qq → netease → joox → (fivesing/audius/jamendo).**
   Today netease is first; it's the least reliable of the CN-4 right now.
2. **Source-embedded cover is real and free (user hypothesis (a) VALIDATED).** kuwo/qq/netease
   return a usable cover with the resolve; audius/jamendo at search. Use it immediately, upgrade
   to Deezer HQ lazily. This removes the Deezer→iTunes→CN cover chain from the hot path for
   ~19/20 plays. Only joox + fivesing need cover backfill.
3. **One resolve already yields the "downloadable link"** — every audio URL is a direct
   progressive file (mp3/flac) or an own-origin streaming proxy; no separate download resolve.
4. **netease production regression is worth its own fix** (see requirement in MANIFEST) — a
   dead default-primary silently degrades search today.
5. Duration only from qq — accept "unknown" for kuwo-primary plays (D-03 already treats
   unknown duration as neutral).
