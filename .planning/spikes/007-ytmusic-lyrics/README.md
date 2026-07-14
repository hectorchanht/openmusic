---
spike: 007
name: ytmusic-lyrics
type: standard
validates: "Given a videoId, when timed/plain lyrics are requested (InnerTube next→browse, else external fallback), then lyrics are returned"
verdict: PARTIAL
related: [005-ytmusic-innertube-search, 006-ytmusic-playable-stream]
tags: [ytmusic, lyrics, innertube]
---

# Spike 007: YouTube Music Lyrics

## What This Validates
Given a `videoId`, when we request lyrics via InnerTube (`next` → find the Lyrics tab → `browse`),
then usable lyrics come back — and we learn whether they're **plain** or **timed/synced** (OpenMusic's
karaoke view wants timed LRC).

## Research
- YTMusic lyrics path: `next(videoId)` returns a tabbed watch-next; one tab is "Lyrics" carrying a
  `browseEndpoint.browseId`. `browse(browseId)` returns `musicDescriptionShelfRenderer` with the lyric
  text in `description.runs[]` and an attribution in `footer` (licensor: Musixmatch / LyricFind).
- Metadata endpoints (`next`/`browse`) are **not** bot-gated — only `player`/stream is (spike 006) —
  so `WEB_REMIX` works here with the public key, no auth, no visitorData.
- OpenMusic already has a cross-source lyric fetch (`crossSourceLyric`: netease/qq/joox by name+artist)
  that returns **timed LRC**, used today on a lyric miss.

## How to Run
```
node .planning/spikes/007-ytmusic-lyrics/harness.mjs
```

## Investigation Trail
1. `next` → Lyrics tab present and enabled for all test tracks (`disabled=false`, real `browseId`).
2. `browse` → `musicDescriptionShelfRenderer.description.runs[0].text` = full plain lyrics + a
   `footer` attribution. Walked the whole response for any timed/synced container
   (`timedLyricsData` / `musicSyncedLyricsData` / `cueRange`) — **none present**.
3. Ran EN, CJK (周杰倫), and JP (Utada) to confirm multilingual coverage + encoding.

## Results
**VERDICT: PARTIAL ⚠ — plain lyrics fully available; timed/synced NOT via YT (covered by existing fallback).**

| Track | Lyrics tab | Plain | Chars | Timed | Source |
|-------|-----------|-------|-------|-------|--------|
| Clairo — Bags (EN) | ✓ | ✓ | 1513 | ✗ | LyricFind |
| Taylor — Blank Space (EN) | ✓ | ✓ | 2627 | ✗ | Musixmatch |
| 周杰倫 — 稻香 (CJK) | ✓ | ✓ | 575 | ✗ | Musixmatch |
| Hikaru Utada — First Love (JP) | ✓ | ✓ | 696 | ✗ | Musixmatch |

- **Plain lyrics: broad, multilingual, correctly encoded.** Displays fine in a non-synced lyrics pane.
- **Timed/synced LRC: not exposed** by the public InnerTube path (YTM's synced lyrics are a
  premium/licensed surface not returned here).
- **Attribution required:** the `footer` licensor string (Musixmatch/LyricFind) should be shown with
  the lyrics — cheap to carry.

**Signal for the build:** lyrics is a GO. Two-tier plan, reusing what exists:
1. **Plain (default):** YT `next→browse` gives displayable lyrics for most tracks in one metadata hop
   (no auth) — store in the `Track.lrc`/plain field; OpenMusic's lyric pane renders untimed lines.
2. **Timed (karaoke view):** on demand, fall back to the existing `crossSourceLyric(name, artist)` —
   the exact name+artist are already known from YT search (005), so it's a single targeted fetch, not
   a fan-out. This is the same lyric-miss path the app already ships. Verify `parseLRC` degrades
   gracefully on plain (timestamp-less) text during the build.
