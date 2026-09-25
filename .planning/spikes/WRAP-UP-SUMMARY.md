# Spike Wrap-Up Summary

## Wrap-up 2 — 2026-09-25

**Spikes processed:** 7 (005, 006, 007, 008, 010, 011, 012)
**Feature areas:** YouTube Music source · Artist/album identity · Home charts
**Skill output:** `./.claude/skills/spike-findings-openmusic/` (append mode — 3 new references)

| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 005 | ytmusic-innertube-search | standard | ✅ VALIDATED | YouTube Music source |
| 006 | ytmusic-playable-stream | standard | ✅ VALIDATED (edge byte fetch later found 403) | YouTube Music source |
| 007 | ytmusic-lyrics | standard | ⚠ PARTIAL (plain yes, timed via crossSourceLyric) | YouTube Music source |
| 008 | ytmusic-account-library | standard | ⚠ PARTIAL → split to legal-gated milestone | YouTube Music source |
| 010 | cn-album-upstream | standard | ✅ VALIDATED (MusicBrainz) | Artist/album identity |
| 011 | edge-chart-sources | comparison | ✅ VALIDATED — Apple RSS, KKBOX, YouTube Charts all GO | Home charts |
| 012 | genre-charts | comparison | ✅ VALIDATED — client-side iTunes + edge Deezer | Home charts |

### Key findings
- **YouTube Music (built, Phase 27):** anonymous search/lyrics; playback direct AAC via ANDROID_VR + visitorData,
  but googlevideo 403s the Cloudflare edge's byte fetch — native resolves on-device. 502 = stale clientVersion.
- **MusicBrainz (built):** one mbid per CJK artist across scripts; original-script albums (72 vs Deezer's 5).
- **Home "lag" root cause:** Last.fm geo HK = Western scrobblers, Last.fm tags = all-time ranking, Deezer
  `/chart` = global. KKBOX HK top-20 median release age 25 days.
- **Edge reachability (2 colos):** Apple RSS v2, KKBOX kma, YouTube Charts, Deezer genre charts all reachable.
  **itunes.apple.com is NOT** — it rate-limits the shared Workers egress IP (403/429) — but is CORS `*`, so
  regional genre charts are fetched client-side.
- **User decisions for the build:** main Chart region + extra regions; one-time switch for existing users; old
  Deezer/Last.fm shelves hidden by default but re-enableable; default genres Asian pop + Western core.

---

## Wrap-up 1 — 2026-07-11

**Date:** 2026-07-11
**Spikes processed:** 4
**Feature areas:** Source resolution · Similar/Up-Next · Click-to-play cost
**Skill output:** `./.claude/skills/spike-findings-openmusic/`

## Processed Spikes
| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 001 | source-resolve-richness | standard | ✅ VALIDATED | Source resolution |
| 002 | similar-songs-api | comparison | ✅ WINNER (track.getSimilar) | Similar/Up-Next |
| 003 | clickplay-query-audit | standard | ✅ VALIDATED | Click-to-play cost |
| 004 | source-coverage-by-segment | standard | ✅ VALIDATED | Source resolution |

## Key Findings
- **kuwo is universal:** 100% playable + 100% cover across all 14 language/region×genre segments (20+38 real
  songs). One kuwo call resolves any song with audio + cover. Fallback `kuwo → qq → netease → joox → rest`.
- **Source-embedded cover is free** on kuwo/qq/netease → drop the Deezer→iTunes→CN cover chain from the hot
  path (lazy HQ upgrade only; joox/fivesing still need backfill).
- **Last.fm `track.getSimilar` wins Up-Next:** 1 call → exact `{artist,title}` pairs (ranked by `match`),
  5/5 resolvable in kuwo. Replaces `buildSimilarQueue`'s 8× `searchAll` artist-hop.
- **Measured baseline:** one single-song play = ~59 `/api/*` calls, 56 of them the buildSimilarQueue artist-hop.
  Redesign projects ~3. Idle app = 0 calls (no polling); home mount ≈ 80 Deezer cover-backfill calls (separate).
- **jamendo/audius earn no hot-path slot** — never beat kuwo, even on Western/EDM/Latin; last-resort gap-fillers only.
- **Production regression surfaced:** netease's qijieya Meting upstream is intermittently dry — a dead
  default-primary silently degrades live search. Needs its own fix.
- **Not spiked (UI):** version-picker modal — the multi-version data already exists in search results.

## Minimal-API policy (deliverable)
`.planning/spikes/004-source-coverage-by-segment/POLICY.md` — "try kuwo first, done" — 1 call plays any song.
