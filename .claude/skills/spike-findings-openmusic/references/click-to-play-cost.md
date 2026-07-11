# Click-to-Play API Cost (baseline + reduction target)

Measured live in the running app (spike 003): `window.fetch` wrapped, counter reset at click time,
every request categorized + attributed by query string.

## Requirements
- **Target: a single-song play costs ~3 API calls, not ~59.** Fully functional across every segment.
- The redesign is purely about trimming per-event cascades — there is NO background polling loop to hunt.

## The measured baseline (what a click costs TODAY)
- **Idle app = 0 calls** over 17s with no interaction. All floods are per-event (page-load / playback).
- **One single-song play (up-next generated) = ~59 `/api/*` calls**, attributed:
  | calls | what |
  |:---:|------|
  | **56** | `buildSimilarQueue`: **8 similar artists × 7 sources** each (`artist.getsimilar` → 8× `searchAll`) |
  | 1 | `/api/similar` (the artist-hop seed) |
  | 1 | `/api/kuwo/detail` (resolve played track — cover came inline) |
  | 1 | `/api/qq/detail` (prefetch-next resolve) |
- **Play from a search LIST (up-next = list remainder) ≈ 15 calls**: resolve + cover tiers (Deezer+iTunes)
  + a 7-source cover-CN-tier `searchAll` for each coverless tile + media.
- **Home page mount ≈ 80 `/api/deezer/search`** cover-backfill calls (separate flood, same root cause:
  cover chain per imageless tile).

## How to Build It (apply the other two references)
| path | today | redesign | how |
|------|:---:|:---:|-----|
| up-next build | **56** | **1** | `track.getSimilar` (similar-upnext.md) |
| played-track resolve | 1 | 1 | kuwo-first (source-resolution.md) |
| played-track cover | 0–9 | **0** + lazy 1 | inline kuwo `pic`; Deezer HQ lazy (source-resolution.md) |
| up-next tile covers | 7 × coverless tile | **0** | kuwo search stubs carry `pic` |
| **single-song play total** | **~59** | **~3** | — |

Highest-impact single change: rewrite `buildSimilarQueue` (56 → 1).

## What to Avoid
- Do NOT re-introduce a per-tile cover fan-out for up-next — seed up-next from kuwo-resolvable stubs so tiles
  carry `pic`.
- The home-page ~80-call cover backfill is worth a follow-up (prefer source-inline cover, cap the fan-out),
  but it is SEPARATE from the click-to-play fix — don't conflate.
- Watch the player's generation guards (`playGen`/`queueGen`/`pendingGen`) when reworking resolve/up-next —
  the async supersedence contract must be preserved.

## Constraints
- Measurement method: wrap `window.fetch` via the browser `javascript_tool` (no top-level await); reset
  `window.__net = []` at the action boundary; categorize by URL, attribute source-`/search` calls by query string.
- Numbers vary with source reliability that session (netease was up during this audit); the ~56-call
  buildSimilarQueue block is structural, not session-dependent.

## Origin
Synthesized from spikes: 003 (baseline + reduction math; applies 001, 002, 004)
Source files: sources/003-clickplay-query-audit/
