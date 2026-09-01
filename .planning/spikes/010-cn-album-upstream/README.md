---
spike: 010
name: cn-album-upstream
type: standard
validates: "Given a CJK artist name in any script, when we query a keyless upstream, then we get ONE canonical artist identity plus an exhaustive album list and ordered tracklists in the ORIGINAL script"
verdict: VALIDATED
related: []
tags: [musicbrainz, cjk, albums, artist-identity, deezer, upstream]
---

# Spike 010: CN / original-script album upstream

## What This Validates

**Given** a CJK artist name in any script (Traditional, Simplified, or romanized),
**when** we resolve it against a keyless upstream,
**then** we get a single canonical artist identity, an exhaustive album list, and ordered
tracklists — all in the original script.

## Why

Two user-reported defects that Deezer cannot fix, measured 2026-09-01:

- **Missing albums.** Deezer fragments 陳奕迅 across three profiles — 陳奕迅 id 15781 (5 albums),
  Eason Chan id 75172 (82), 陈奕迅 id 4092598 (2). We render whichever one the picker selects, so
  the shelf showed 5.
- **English titles.** For 周杰倫 the only populated Deezer profile is "Jay Chou" id 69175 (46
  albums) and its titles are English — `Greatest Works Of Art`, `Jay Chou's Bedtime Stories`,
  `Children of the Sun`. The Simplified profile id 6005548 has **0** albums. No Deezer profile
  carries the Chinese titles.

Plus a third, related question the user raised mid-spike: the app shows **three separate artist
pages** for 周傑倫 / Jay Chou / 周杰倫 and should show one, with the display name following the
artist-locale setting.

Existing CN proxies cannot help (established before this spike, not re-investigated): Meting has
no `album` type, our qq proxy allows only `search|detail`, and neither search response carries an
album field at all.

## Research

| Approach | Keyless | Original script | Artist→albums | Album→tracks | Status |
|---|---|---|---|---|---|
| **MusicBrainz ws/2** | yes | **yes** | yes (release-groups) | yes (release + `inc=recordings`) | **CHOSEN** |
| Deezer | yes | no (romanized, fragmented) | yes | yes | current, insufficient for CJK |
| Meting (netease) | yes | yes | **no** — `type=album` → `{"error":"unknown type"}` | n/a | ruled out |
| qq (tang.api) | yes | yes | **no** — `search\|detail` only, no album field | n/a | ruled out |
| kuwo (kw-api) | — | — | — | — | DEAD, TLS cert expired 2026-04-14 |

**Chosen: MusicBrainz**, with Cover Art Archive for images (MusicBrainz stores no artwork itself).

## How to Run

```bash
UA='openmusic-spike/1.0 ( <contact> )'
# 1. name → canonical artist mbid  (works from ANY script)
curl -s -H "User-Agent: $UA" 'https://musicbrainz.org/ws/2/artist/?query=<name>&fmt=json&limit=1'
# 2. artist → albums (original-script titles)
curl -s -H "User-Agent: $UA" 'https://musicbrainz.org/ws/2/release-group?artist=<mbid>&type=album&fmt=json&limit=100'
# 3. release-group → ordered tracklist
curl -s -H "User-Agent: $UA} 'https://musicbrainz.org/ws/2/release?release-group=<rgid>&inc=recordings&fmt=json&limit=1'
# 4. cover
curl -sL 'https://coverartarchive.org/release-group/<rgid>/front-500'
```

Sleep ~1.1s between calls — see the rate-limit finding below.

## Investigation Trail

**1. Does MusicBrainz know these artists?** Yes, immediately and with high confidence.
`query=周杰倫` → `name: 周杰倫`, `sort-name: "Chou, Jay"`, `country: TW`, score 100, in 0.7s.

**2. Are the album titles actually Chinese?** Yes, and they map exactly onto the English ones we
were showing:

| MusicBrainz | Deezer (what users saw) |
|---|---|
| 最偉大的作品 | Greatest Works of Art |
| 周杰倫的床邊故事 | Jay Chou's Bedtime Stories |
| 太陽之子 | Children of the Sun |
| 哎呦，不錯哦 | — |
| 12新作 | — |

**3. Does it fix the identity fragmentation?** This was the surprise, and it is the most valuable
finding in the spike. Every script variant AND the romanized name collapse to one mbid at score
100:

| Query | Resolves to | Country |
|---|---|---|
| 陳奕迅 | 陳奕迅 `86119d30-…` | HK |
| 陈奕迅 | 陳奕迅 `86119d30-…` | HK |
| Eason Chan | 陳奕迅 `86119d30-…` | HK |
| 周傑倫 | 周杰倫 `a223958d-…` | TW |
| 周杰伦 | 周杰倫 `a223958d-…` | TW |

So the "merge 3 artist pages into 1" question needs **no heuristic at all** — MusicBrainz does the
alias linking authoritatively. This supersedes the CJK-only heuristic merge that was on the table
(and which risked mis-merging tribute acts like "Coldplay Metal Tribute").

**4. Coverage vs Deezer.** Not close:

| Artist | Deezer (what we showed) | MusicBrainz |
|---|---|---|
| 陳奕迅 | 5 | **72** |
| 周杰倫 | 46 (English titles) | **35** (Chinese titles) |

Note Jay Chou's raw count is lower than Deezer's 46 — Deezer inflates with singles/repackages,
while MB `type=album` release-groups are actual albums. For 陳奕迅 the direction is emphatic.

**5. Tracklists.** `release?release-group=<id>&inc=recordings` returns the ordered list in the
original script: 最伟大的作品 / 说好不哭 / 不爱我就拉倒 / Mojito / 等你下课 / 我是如此相信.

**Script caveat worth carrying into the build:** that release-group's title is Traditional
(最偉大的作品) while its release and tracks are Simplified (最伟大的作品). Script varies per
release, so the display layer must fold — `tongwen-core` is already a dependency, and the
artist-locale setting is the natural switch.

**6. Cover art.** MusicBrainz stores none. Cover Art Archive covers the gap:
`coverartarchive.org/release-group/<id>/front-500` → 200 (redirects to archive.org). Keyless.

**7. Operational.** TLS `notAfter=Oct 10 23:59:59 2026` — valid, but only ~5 weeks out at time of
spike. Given the kuwo precedent (cert expired 2026-04-14, silently 526ing for 4.5 months), this
deserves a watch, though MetaBrainz is a real organisation rather than a one-person aggregator.
Latency was consistent: 0.55s / 0.60s / 0.62s.

**8. Rate limiting — the one real constraint.** ~1 req/s. Three rapid calls with no delay returned
**503 / 200 / 503**, with an explicit body:

```json
{"error": "The MusicBrainz web server is currently busy. Please try again later."}
```

This is a **detectable** failure (a real 503 status, not a 200 masquerading as success), so a
proxy can retry on it — unlike the `/api/translate` soft-fail already documented in CLAUDE.md.
An earlier probe in this spike that appeared to return an empty 200 was in fact a swallowed 503.

## Results

**VERDICT: VALIDATED.** MusicBrainz answers all four spike questions, and additionally solves the
artist-identity merge that was going to require a heuristic.

| Question | Answer |
|---|---|
| Keyless artist→albums, original script, exhaustive? | Yes — 72 for 陳奕迅 vs Deezer's 5 |
| Album→ordered tracklist, original script? | Yes, via release-group → release `inc=recordings` |
| Reachable/stable from the edge? | Yes. Valid TLS (watch Oct 2026), ~0.6s, no IP lock |
| Name→id for Traditional AND Simplified? | Yes — plus romanized, all to ONE mbid at score 100 |

### Recommended shape for the build

1. **MusicBrainz becomes the artist-identity layer.** Resolve the name once → canonical mbid.
   That single id is what collapses 周傑倫 / Jay Chou / 周杰倫 into one page. Display name comes
   from the canonical `name` plus locale-tagged aliases (`inc=aliases`), switched on the existing
   artist-locale setting.
2. **MusicBrainz supplies albums + tracklists for CJK artists**, in the original script.
3. **Deezer stays** for artwork, for non-CJK artists, and as the fallback when MB misses — its
   coverage of Western catalogue and its cover URLs are already wired and good.
4. **Cover Art Archive** fills MB's artwork gap, keyed by release-group id.
5. **Edge-cache hard.** The 1 req/s limit is the binding constraint. An artist page costs 2–3 MB
   calls; a 24h edge cache (the pattern `/api/deezer/artist-albums` already uses) makes that a
   non-issue. Retry on 503 with backoff; never negative-cache a 503.
6. **Send a real User-Agent.** MusicBrainz requires an identifying UA and will block generic ones.

### What this does NOT solve

MB's release-groups are curated, so a very new or very obscure release may be absent where Deezer
has it — hence keeping Deezer as fallback rather than replacing it. And 周杰倫's raw album count is
lower than Deezer's, which is correct (fewer singles) but means "exhaustive" is per-source, not
absolute; the build should consider unioning the two, keyed on the MB identity.
