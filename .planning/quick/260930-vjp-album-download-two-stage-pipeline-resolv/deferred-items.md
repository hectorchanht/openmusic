# Deferred items — quick-260930-vjp

Found during the Task 3 E2E. Out of scope for this task (pre-existing, not caused by the stage gates).

## 1. Netease audio downloads truncate at 8 s (pre-existing since ee8e2026, 2026-06-05)

- `netease` sets `audioUrl = /api/netease/url?id=…`, which STREAMS the audio through the catch-all
  proxy (`content-type: audio/mpeg`, chunked).
- `src/routes/api/[source]/[...path]/+server.ts:91` wraps the upstream fetch in
  `AbortSignal.timeout(8000)`, and that deadline covers the whole streamed BODY, not just the head.
- Any netease body that takes > 8 s ends `net::ERR_INCOMPLETE_CHUNKED_ENCODING` → `downloadTrack`
  returns `'failed'`. Reproduced with a single `curl` (no app involved): 200, ~3-4.5 MB, exactly 8.00 s.
- Playback is unaffected (`<audio>` range-requests and resumes); single-song and album downloads of a
  netease-resolved song fail whenever the dev/edge→upstream link cannot move the whole file in 8 s.
- In this session's album E2E runs, 4-6 of the 10 songs resolved to netease in some runs (resolver
  variance — kuwo search 500s in this env), and every one of them failed this way.
- Fix direction: give media passthrough (`/url`) its own longer/no body deadline (head timeout only).

## 2. tang (qq detail host) rate limit maps to 'no-audio'

- Direct qq detail calls (`tang.api.s01s.cn`) answer `请求过于频繁` when the listener's IP calls too
  often. `tryQqDetail` parses that as "no body" → one fallback hop via `/api/qq/detail` (same IP in
  dev, edge IP in prod) → if that is limited too, the song resolves with no url → `'no-audio'`.
- Measured from this machine: 16 sequential calls (~1.8 s apart) clean, 17th limited, recovered ~23 s
  later; 3-parallel limited after ~4 calls; an unpaced album pipeline fired 11 calls in 4 s → last 4
  limited. After heavy probing the limiter stayed hot for minutes (even 1 call / 3.5 s was limited).
- Album download now paces resolve grants (see SUMMARY); a qq adapter retry/backoff on the
  rate-limit body would fix it for playback/prefetch callers too.
