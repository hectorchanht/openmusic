---
phase: 27-youtube-music-source
plan: 03
subsystem: api-proxy
tags: [ytmusic, stream, innertube, android-vr, byte-proxy, range, visitor-data, itag-140]
requires:
  - "src/lib/proxy/ytmusic.ts (getVisitorData / innerTubePost / PLAYER_URL — Plan 27-02 shared module)"
  - "src/lib/proxy/http.ts (fetchWithRetry raw edge fetch + corsHeaders own-origin CORS)"
  - "src/hooks.server.ts (the single CORS seam / OPTIONS 204 preflight; corsHeaders lists Range)"
provides:
  - "GET /api/ytmusic/stream/:videoId — ANDROID_VR player + cached visitorData -> itag-140 AAC selection -> googlevideo byte-proxy with Range passthrough (206 seek + 200 download) + refresh-on-bot-gate-then-502"
  - "pure exported helpers selectAudioFormat(playerJson) + isPlayable(playerJson) (fixture-tested)"
  - "__fixtures__/player-response.json — faithful ANDROID_VR player-response shapes (OK/itag-140+251+139, LOGIN_REQUIRED, ciphered-only, fallback-no-140)"
affects:
  - "src/lib/sources/ytmusic.ts resolve() (27-01) — its stamped audioUrl /api/ytmusic/stream/:videoId now has a real byte backend, so ytmusic tracks are playable + downloadable"
  - "the single app-wide <audio> (src/routes/+layout.svelte) — plays an own-origin /api/ytmusic/stream/:videoId path (CORS/Capacitor-safe like audius/netease)"
tech-stack:
  added: []
  patterns:
    - "audius byte-proxy posture (RAW edge fetch via fetchWithRetry retries=1 + AbortSignal.timeout, redirect:follow, stream res.body back, propagate Accept-Ranges/Content-Range/Content-Length) PLUS a 'call the InnerTube player first' step"
    - "ANDROID_VR anonymous player context (clientVersion 1.60.19 + Quest 3 + VR user-agent + cached visitorData) — clears the datacenter-IP bot gate with NO account/PoToken/cookie (spike 006)"
    - "refresh-once-then-502: !isPlayable -> getVisitorData(true) + retry the player POST once -> still-not-OK -> 502 (client cross-source fallback engages, never hang)"
    - "IP-lock same-invocation proxy: player POST + googlevideo byte-fetch in ONE Worker invocation; the signed URL is never returned to the client, only proxied bytes"
key-files:
  created:
    - src/routes/api/ytmusic/stream/[videoId]/+server.ts
    - src/routes/api/ytmusic/stream/[videoId]/stream.test.ts
    - src/routes/api/ytmusic/stream/[videoId]/__fixtures__/player-response.json
  modified: []
decisions:
  - "Media byte-fetch uses fetchWithRetry(url, init, 1) — the RAW edge fetch (never the client api-base governor), matching the audius posture AND threat T-27-03-03 (retries=1); 'raw fetch' in the plan = not-the-governor, and fetchWithRetry is http.ts's raw edge fetch helper (drains + retries only on 429/5xx, returns a 206/200 immediately)"
  - "Content-Type is FORCED to audio/mp4 on the response (itag 140 is always AAC/mp4) rather than propagating the googlevideo content-type — the download flow + <audio> rely on a correct type and the extension-less proxy path can't imply it"
  - "visitorData is OMITTED from the player body when getVisitorData() returns null (never send \"visitorData\":null, which the upstream would reject) — a null token just yields a bot gate that the refresh-once path then handles"
  - "The 'no apiFetch on the media path' acceptance criterion is a LITERAL grep (returns nothing), so the doc comments say 'the client fetch governor (api-base)' instead of the literal token — and a source-scan unit test locks it in (differs from http.ts's 'not apiFetch' audit-comment convention, but honors this plan's testable criterion)"
metrics:
  duration: 12min
  tasks: 2
  files: 3
  completed: 2026-07-15
---

# Phase 27 Plan 03: YouTube Music Stream Byte-Proxy Summary

Built the money route — `GET /api/ytmusic/stream/:videoId` — the highest-risk plan (spike 006, "the
wall, cleared"). It POSTs the InnerTube **ANDROID_VR** `player` endpoint (clientVersion 1.60.19 + a
cached anonymous `visitorData` token) edge-side, selects **itag 140** (AAC-LC/mp4, the codec iOS
Safari `<audio>` plays — never Opus/webm itag 251), then fetches the IP-locked googlevideo URL **in
the same Worker invocation** with the RAW edge fetch and streams the bytes back with Range
passthrough — exactly the audius byte-proxy pattern plus the "call player first" step. On a bot gate
it refreshes `visitorData` once and retries; still-not-OK → 502 so the client's cross-source fallback
engages. Zero auth: anonymous ANDROID_VR + visitorData only — no account / PoToken / cookie.

## What Was Built

### Task 1 (TDD) — pure itag-140 selection + playability gate (`2110fff` RED, `9bd7e29` GREEN)
- **`__fixtures__/player-response.json`**: hand-authored, faithful ANDROID_VR player-response shapes
  (from the spike-006 documented capture) with four keyed variants: `ok` (an itag-140 AAC/mp4 direct
  url + an itag-251 Opus entry to prove it is NOT chosen + a lower itag-139), `loginRequired` (bot
  gate), `cipheredOnly` (an itag-140 with `signatureCipher` and NO `url`), and `fallbackNoAac140`
  (Opus + a lone mp4 itag-139 to exercise the fallback). Fake-but-https googlevideo urls carry an
  `ip=` param to model the IP-lock; never a real signed URL.
- **`selectAudioFormat(playerJson)`** (pure, exported): itag-140 direct `url` → else highest-bitrate
  `audio/mp4` direct `url` → else null. Ignores ciphered formats (no `url`) and never picks Opus/webm
  (itag 251). Typed over optional-chained `YtPlayerJson`/`YtAdaptiveFormat` interfaces — zero `as any`.
- **`isPlayable(playerJson)`** (pure, exported): true only when `playabilityStatus.status === 'OK'`.
- **`stream.test.ts`** (9 assertions): itag-140 url for OK; never itag-251; fallback to audio/mp4
  when 140 absent; null for ciphered-only / LOGIN_REQUIRED / malformed; isPlayable true only for OK.

### Task 2 — the byte-proxy route (`be51037`)
- **`GET` in `+server.ts`** (182 lines): reads `params.videoId` (trim; empty → 400). Calls
  `getVisitorData()`, POSTs the ANDROID_VR player via `innerTubePost(PLAYER_URL, { context: { client:
  { clientName:'ANDROID_VR', clientVersion:'1.60.19', androidSdkVersion:32, deviceModel:'Quest 3',
  hl:'en', gl:'US', visitorData } }, videoId, contentCheckOk:true, racyCheckOk:true }, { headers: {
  'user-agent': <VR UA> }, signal })`. `!isPlayable` → `getVisitorData(true)` (refresh ONCE) + retry
  once; still-not-OK → 502. `selectAudioFormat` null → 502. Then `fetchWithRetry(streamUrl, {
  redirect:'follow', signal: AbortSignal.timeout(15000), headers }, 1)` — RAW edge fetch, forwarding
  the client `Range` header — and streams `res.body` back propagating Accept-Ranges / Content-Range /
  Content-Length with a forced `Content-Type: audio/mp4`. Only ever fetches the adaptiveFormats url
  (no open relay). `OPTIONS` → 204 corsHeaders.
- **`stream.test.ts` +8** (mocks global fetch, routing SEARCH_URL/PLAYER_URL/googlevideo): ranged
  request → 206 with Accept-Ranges/Content-Range + audio/mp4 (Range forwarded upstream, only the
  itag-140 adaptiveFormats url fetched); non-ranged GET → 200 full body (download path); first-call
  LOGIN_REQUIRED → exactly one `getVisitorData(true)` refresh (SEARCH_URL between the two player
  POSTs) + retry → streams; persistent non-OK → 502 with no media fetch; OK-but-no-format
  (ciphered-only) → 502; empty videoId → 400 no fetch; OPTIONS → 204; a source-scan asserting the
  media path never references `apiFetch`.

## Deviations from Plan

None — the plan executed as written. Notes on choices made within the plan's latitude:
- The plan said "RAW `fetch`" for the media bytes; I used `fetchWithRetry(url, init, 1)` (http.ts's
  raw edge fetch helper) rather than bare `fetch`, to match the audius closest-analog posture AND
  threat **T-27-03-03** ("retries=1 (audius posture)"). It is still RAW (never the client api-base
  governor) — logged as a decision above.
- The acceptance criterion "grep `apiFetch` returns NOTHING" is literal, so the doc comments reference
  "the client fetch governor (api-base)" instead of the literal token (the source-scan test caught the
  first draft where a comment contained `apiFetch`). Logged as a decision above.

## Authentication Gates

None. Fully anonymous by design (scope guard honored): the player call attaches an ANONYMOUS
`responseContext.visitorData` token (from the Plan 27-02 module), NOT a Google account, NOT a
PoToken, NOT a cookie. No account / OAuth / device-flow / user-token / library-sync code was added.

## CARRIED RISK — T-27-03-OP (Operational, UAT-gated, NOT unit-provable)

This whole path is **adversarial and WILL break periodically** (spike 006 / 27-CONTEXT deferred
risk). Two things are UNPROVABLE by node unit tests and MUST be verified on a **deployed Cloudflare
Worker** before this is trusted in production:

1. **Same-IP egress within one invocation** — the `player` subrequest and the googlevideo byte
   subrequest must egress an IP googlevideo accepts (the stream URL is signed for the caller IP, ~6 h
   expiry). If a colo splits egress IPs across subrequests → 403. Mitigation if it fails: single-fetch
   pipeline / a small validating range before handoff.
2. **Bot-challenge rate under load** — one datacenter IP (a CF colo) issuing many `player` calls may be
   re-challenged harder than a residential phone. Mitigation: the module already caches + can refresh
   `visitorData`; measure the challenge rate and rotate if needed. The route degrades safely (502 →
   client cross-source fallback) rather than hanging.

**Also UAT-gated (documented, not unit-tested):** real 206 playback in `<audio>` + seek, and a real
non-ranged download saving a complete AAC file, over the deployed proxy (the IP-locked live stream
can't be exercised by a node unit test — the test uses a captured player-response fixture + a
stand-in byte body).

## Verification

- `pnpm check` — 0 errors, 0 warnings.
- `pnpm test -- "src/routes/api/ytmusic/stream/[videoId]/stream.test.ts"` — 1 file, 17 tests passed.
- `pnpm test` (full suite) — 79 files, 1306 tests passed (+17 over 27-02's 1289; no regressions).
- `grep -n "apiFetch" "src/routes/api/ytmusic/stream/[videoId]/+server.ts"` — returns NOTHING (media
  bytes use the raw edge fetch only); also asserted by a source-scan unit test.
- The googlevideo url fetched is the one from `adaptiveFormats` (not a request param) — asserted.

## TDD Gate Compliance

- RED: `test(27-03)` commit `2110fff` — 4 behavioral assertions fail against the skeleton stubs
  (`selectAudioFormat`→null, `isPlayable`→false); 5/9 degradation/null cases pass.
- GREEN: `feat(27-03)` commit `9bd7e29` — all 9 helper assertions pass; `pnpm check` clean.
- No REFACTOR commit needed (clean on first green). Gate sequence (test → feat) satisfied.
- Task 2 is a non-TDD `type="auto"` task (feat commit `be51037`).

## Self-Check: PASSED

- Files: all 3 created files present on disk (+server.ts 182 lines > min 60; stream.test.ts;
  __fixtures__/player-response.json) + this SUMMARY.
- Commits: `2110fff`, `9bd7e29`, `be51037` all present in git history.
