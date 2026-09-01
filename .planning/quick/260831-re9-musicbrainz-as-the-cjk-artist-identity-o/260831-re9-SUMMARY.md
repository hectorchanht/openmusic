---
quick_id: 260831-re9
title: MusicBrainz as the CJK artist identity + original-script album source
date: 2026-09-01
status: complete
commit: a292e74
spike: 010-cn-album-upstream
---

# What shipped

MusicBrainz is now the album source and identity layer for CJK artists. Three reported
problems, one root cause, one upstream.

# Results

| | Before | After |
|---|---|---|
| 陳奕迅 shelf | **5** albums | **58** albums/EPs, Chinese titles, dated |
| 陳奕迅 discography | — | preset 58 · Singles 44 · **All 102** (exact complement) |
| 周杰倫 shelf | Children of the Sun · Greatest Works Of Art · Jay Chou's Bedtime Stories | 太陽之子 · 最偉大的作品 · 周杰倫的床邊故事 · 哎呦，不錯哦 · 12新作 |
| 最偉大的作品 tracks | English | 最伟大的作品 / 说好不哭 / 不爱我就拉倒 / Mojito / 等你下课 / 我是如此相信 |
| `artistLang=en` | three separate pages | same URL, hero renders **Jay Chou** |
| Coldplay | 22 cards | 22 cards, unchanged, **zero** MusicBrainz calls |

# Why MusicBrainz

Deezer fragments CJK artists across profiles and romanizes their catalogue: 陳奕迅 is split
over three ids (5 / 82 / 2 albums) and 周杰倫's only populated profile is the English-titled
"Jay Chou" (the Simplified one has zero albums).

MusicBrainz resolves **every** script variant and the romanized name to ONE id at score 100 —
陳奕迅 / 陈奕迅 / "Eason Chan" → `86119d30-…`, 周傑倫 / 周杰伦 → `a223958d-…`. That makes the
"three artist pages" merge authoritative instead of heuristic, and avoids the tribute-act
mis-merges a name heuristic would have risked ("Coldplay Metal Tribute" into Coldplay).

# Changes

**`src/lib/proxy/musicbrainz-shared.ts`** (new) — required identifying User-Agent (MB blocks
generic ones), 503-aware retry with 1.1s linear backoff matched to MB's ~1 req/s window (not
exponential — the limiter is a fixed 1s window), UUID validation, Cover Art Archive URL builder,
MB→app locale normalization.

**`src/routes/api/musicbrainz/{artist,albums,tracks}/+server.ts`** (new) — 24h edge cache on
success only, never negative-caching a 503. Albums pages to 200 (陳奕迅 has 102 release-groups;
one page truncates). Cover URLs are *built* from the release-group id, so listing an artist is
one request regardless of album count.

**`src/lib/services/musicbrainz.ts`** (new) — cached never-throw clients, plus pure
`pickLocaleName`, which is what makes the merged identity respect the artist-language setting.

**`src/lib/services/discography-source.ts`** (new) — one `loadDiscography` replacing the
duplicated source-selection effect both album surfaces carried. **CJK-gated**: CJK →
MusicBrainz → Deezer → Last.fm; everything else keeps today's Deezer → Last.fm path untouched,
so Western artists cannot regress and MB's rate budget is spent only where it helps.

**Album page** — prefers a carried `mbid` over `dzid` over the Last.fm name lookup.

**Covers** — painted as two layers (art over gradient), so a Cover Art Archive miss reveals the
gradient rather than a blank tile. No probe request needed to know whether art exists.

# Two bugs caught during live verification

1. **Empty tracklists.** `inc=recordings` alone makes MusicBrainz omit artist-credit entirely,
   so every row failed the artist guard and the endpoint returned zero tracks. Fixed with
   `inc=recordings+artist-credits`.
2. **102 releases collapsing to 58.** The `{#each}` key was `id ?? name`; MusicBrainz entries
   have a null Deezer `id`, and a discography legitimately repeats titles (reissues, a single
   and an album of the same name). Keys are now `mbid ?? id ?? name`, with the reason recorded
   on the `DiscographyEntry` type so the next renderer does not repeat it.

Also worth noting: an intermittent `artist.showMore` type error during this task was
svelte-check racing my own file write, **not** a real defect — and my first attempt to confirm
that used `grep` on `git show`, which returned a false negative (a known failure mode in this
repo). Re-checked with Python; both files were correct all along.

# Verification

`pnpm test` 98 files / **1829 tests** (+18); `pnpm check` 4400 files, 0 errors 0 warnings.
All the table rows above were measured live on the dev server.

# Deferred (stated, not dropped)

- **Merging the three artist rows in SEARCH results.** This task lands the identity layer they
  would merge on; collapsing the search rows is a separate change to result grouping.
- **Union of MusicBrainz and Deezer album lists.** MB is curated and can miss very new releases
  Deezer carries; 周杰倫 is 35 on MB vs 46 on Deezer (Deezer inflates with singles).
- **Watch item:** musicbrainz.org's TLS certificate expires **2026-10-10**. The kuwo outage
  earlier today was exactly this failure mode gone unnoticed for 4.5 months.
