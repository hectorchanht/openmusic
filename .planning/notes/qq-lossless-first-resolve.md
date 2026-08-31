---
title: QQ-lossless-first resolve — measurements from re-examining upstream musicsquare
date: 2026-08-31
context: "/gsd:explore triggered by the observation that upstream CharlesPikachu/musicsquare plays songs in under 1s AND lossless, while openmusic (post-Phase-31) shows a spinner first and streams 98kbps. Diffed upstream/main:index.html against our resolve path and measured every hop. Outcome: decided to make QQ-lossless the PRIMARY resolve and rebuild the speed path around it (Phase 32)."
---

# QQ-lossless-first resolve — why upstream beats us on both axes

Upstream is still one `index.html` (3417 lines). We are a fork of it, so its resolve path is
the direct ancestor of ours — the differences below are all ours, added deliberately.

## Measured (2026-08-31, from a dev sandbox; CN hosts so absolute values are inflated, ratios hold)

| Path | Time | Note |
|---|---|---|
| direct `tang.api.s01s.cn` detail (what musicsquare does) | 2.0–3.8s | one hop |
| our `/api/qq/detail` (same upstream, via CF Pages worker) | 3.9–4.7s | **+~1s for the proxy hop** |
| our `/api/resolve` (Phase-31 edge cache), `周杰伦 / 稻香` | 0.44s | returned `{"hit":false}` |
| `GET` first 1KB of the SQ FLAC over **https** | 0.31s | `206`, `audio/x-flac` |

## Finding 1 — the post-resolve tail is NOT the bottleneck

`player.svelte.ts:2892-3033`: between the resolve landing and `driveSrc()` + `audio.play()` there
is only synchronous work (`persist()`, `library.adoptCover`, `writeCoverBoth`, MediaSession
metadata). `backfillLyrics` is fire-and-forget. The single `await` (`blobStore.get`) sits behind
`library.isDownloaded()`. Cover chain, prefetch and `ensureAhead` all run after playback starts.

**So "play the instant it resolves, parallelize the rest" is already the implemented behavior.**
The spinner the user sees IS `ensureTrackDetails`. Any latency win has to come out of resolve.

## Finding 2 — the CF proxy hop is pure overhead for qq + kuwo

Both upstreams are CORS-open:

```
tang.api.s01s.cn    → access-control-allow-origin: *
oiapi.net/api/Kuwo  → access-control-allow-origin: *
```

Neither needs an edge-injected secret (unlike JOOX's `JOOX_TOKEN`). `sources/qq.ts:6` documents
the same-origin proxy as an intentional divergence from the monolith — but for these two sources
it buys nothing CORS-wise and costs a full extra RTT. Compare `hooks.server.ts`'s allowlisted CORS
seam: that exists for OUR routes, not because the upstream demands it.

## Finding 3 — `msg` is ignored on the QQ detail call; `mid` alone resolves

```
detail with mid ONLY, no msg   → 稻香, kbps_sq=933, 1.73s
detail with WRONG msg + mid    → 稻香, sq present,  1.46s
```

Both `sources/qq.ts` and the monolith's `fetchQQDetails` thread `qqSearchKey`/`keyword` into the
detail URL "to keep the ordering consistent". It is dead weight. Consequences:

- QQ resolve is **exactly one call** given a mid.
- `song_mid` is already present on every row of QQ **search** — so for QQ-sourced results we hold
  the mid *before* the user clicks. Click→play needs one direct CORS fetch and nothing else.
- **`song_mid` is permanent**, unlike the signed audio URLs. That makes it cacheable indefinitely —
  something `/api/resolve` (which stores an expiring URL, hence `resolve-cache.ts`'s TTL and bust
  machinery) structurally cannot be.

## Finding 4 — `defaultQuality: '128'` actually selects 98kbps, and blocks lossless

Real tiers from one detail body:

```
kbps_sq:       933   song_play_url_sq        (FLAC)
kbps_pq:       922
kbps_accom:    700
kbps_hq:       194
kbps:          194   song_play_url           (the bare default)
kbps_standard:  98   ← what defaultQuality:'128' picks
kbps_fq:        49
```

`defaults.ts:82` says `defaultQuality: '128' // D-03 — 128–160k band for fast resolve`.
`sources/qq.ts:103` short-circuits on `pref === '128'` and returns `song_play_url_standard`, which
is **98kbps** — below the band D-03 claims. `downloadQuality: 'lossless'` proves the whole ladder
already works; only the streaming default withholds it.

The SQ URL is `http:`, i.e. mixed-content-blocked on our https origin — but the host answers https
fine (`206`, `audio/x-flac`, 0.31s to first bytes). A scheme upgrade is sufficient.

## Finding 5 — the Phase-31 edge cache is kuwo-only, so it can never serve lossless

`proxy/resolve-edge.ts:11` states the constraint plainly: kuwo only, because it is auth-free and
edge-reachable. Kuwo tops out at 320k mp3. The Phase-31 fast path and lossless are therefore
mutually exclusive as currently built — which is the fork in the road this exploration hit.

**Decision (2026-08-31):** QQ-lossless becomes the primary resolve; speed gets rebuilt around it
(direct CORS fetch, permanent mid cache, https upgrade) rather than around kuwo. See Phase 32.

## Open risks carried into Phase 32

1. **Cross-source stubs** — a kuwo/netease search hit has no QQ mid, so it needs a QQ search first
   (2 calls). Needs a `matchKey` → mid cache to collapse back to 1.
2. **Single provider** — `tang.api.s01s.cn` is one unmaintained free API. Upstream's own latest
   commit is `fix kuwo music api as kw-api.cenguigui.cn is not maintained now` — the exact failure
   mode. Tracked separately as a spike (see `.planning/research/questions.md`).
3. **FLAC weight** — 933kbps ≈ 7MB/min. Prefetch/prebuffer of the next track gets much heavier on
   mobile than 98kbps m4a. Directly threatens the "seamless next song" half of the goal.
