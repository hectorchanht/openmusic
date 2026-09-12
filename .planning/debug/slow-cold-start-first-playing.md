---
gsd_debug_version: 1.0
slug: slow-cold-start-first-playing
status: investigating
trigger: "撳落去要等幾秒先開聲 — slow time from tap to first audible sound. Goal: cut tap → first `playing` event latency. Platform: Android Chrome / PWA. Companion symptom (mid-song stop, background/locked only) deferred to a separate session by user decision."
created: 2026-09-12
updated: 2026-09-12T00:50
---

# Debug: slow tap → first `playing` (cold path 34.7s, warm path bimodal 220ms vs 3.4s)

## Symptoms

- **Expected:** Tap a song → audio starts within a few hundred ms. Core project value is "tap it and have it play instantly".
- **Actual:** Several seconds of silence before sound. Worst observed case 34.7 s.
- **Platform:** Android Chrome / PWA against `openmusic.lol`.
- **Timeline:** Persists after Phase 31 (cut click-to-play latency) and Phase 32 (QQ-lossless-first resolve) both shipped. Phase 32's real-device RTT measurement (32-03) was DEFERRED, so no tap→sound number was ever captured until this session.
- **Reproduction:** Tap a track whose first-choice source is dead (region-locked / stale url). Warm QQ tracks in an established queue are fast.

## HARD EVIDENCE — user-supplied on-device action log (2026-09-12)

Ground truth, not theory. All timings derived from the pasted `logAction` export.

### Cold case — 34,697 ms from tap to first sound

| Δ from tap | t (ms) | event | note |
|---|---|---|---|
| 0 | 149215912 | `play` kuwo:75684778 fresh:true | THE TAP |
| +38 | 149215950 | `resolve.ok` kuwo hasUrl:true | **resolve was FAST — 38 ms** |
| +3663 | 149219575 | `stall.retry` kuwo | stall watchdog fires ~3.6 s after a *successful* resolve |
| +3664 | 149219576 | `resolve.midless` kuwo | |
| +8449 | 149224361 | `audio.error` kuwo hasPlayed:**false** | strike 1 — url resolved but never produced audio |
| +8454 | 149224366 | `pause` deliberate:false | |
| +13706 | 149229618 | `advance` → qq:similar-jacechan\|隔離 | |
| +15795 | 149231707 | `play` kuwo:75684778 **AGAIN** fresh:false | **STRIKE_CAP=2 → re-attempts the same dead track** |
| +18636 | 149234548 | `audio.error` kuwo hasPlayed:false | strike 2 → finally promoted to unplayableUids |
| +20259 | 149236171 | `advance` → qq:similar-jacechan\|隔離 (2nd time) | |
| +22328 | 149238240 | `resolve.fail` qq:similar-jacechan\|隔離 | lazy `similar-` stub (similar.ts:154, D-10) fails to resolve |
| +22350 | 149238262 | `advance` → qq:0003ysON0L5Kky | |
| +25582 | 149241494 | `resolve.ok` qq hasUrl:true | |
| **+34697** | 149250609 | **`playing`** | **FIRST SOUND — 9,115 ms AFTER a good url was in hand** |

### Warm case — same session, later, steady-state auto-advance

| play → resolve.ok | resolve.ok → playing | total |
|---|---|---|
| 101 ms | 117 ms | **218 ms** |
| 97 ms | 133 ms | **230 ms** |
| 107 ms | 107 ms | **214 ms** |
| 125 ms | 2,987 ms | **3,112 ms** |
| 108 ms | 3,325 ms | **3,433 ms** |

## Initial reading (to be confirmed/falsified by investigation — NOT yet a conclusion)

**The resolve layer is not the bottleneck.** `resolve.ok` lands in 38–125 ms on every single sample, cold and warm alike. Phase 31 and Phase 32 both targeted resolve latency. That is consistent with the user's report that the speed work never helped: it optimized a step that already cost ~100 ms.

Three candidate cost centres, all *after* resolve:

1. **`resolve.ok` → `playing` gap is bimodal: ~120 ms or ~3.0–3.3 s, with an identical ~100 ms resolve either way.** Same source (qq), same code path, 25x spread. This gap is `<audio>` src-attach → buffer → first frame, not network resolution. On the cold case this same gap was 9.1 s. This is the largest single unexplained cost and the most likely answer to "等幾秒先開聲".

2. **`STRIKE_CAP = 2` doubles the dead-track penalty.** player.svelte.ts:970 `strikeUnplayable`; cap at :932. A track that resolves-but-cannot-play costs ~8.4 s per strike, and the cap deliberately spends a second strike on it (~16 s total) before routing past. The cap exists on purpose — it was added to fix over-aggressive false-positive skipping (`playback-skip-and-autoplay`). So this is a real tradeoff to re-price with measurement, not an obvious bug.

3. **The stall watchdog waits ~3.6 s after `resolve.ok`, then `audio.error` takes a further ~4.8 s.** ~8.4 s to conclude one dead url. Worth checking whether a dead url can be detected faster than the watchdog's window.

4. **Lazy `similar-` stubs enter the queue unresolved and can `resolve.fail` at play time** (similar.ts:154 — synthetic `similar-${key}` songid, D-10, by design). Cost here ~2.1 s, and it was attempted twice. Secondary.

## Prior art — read before hypothesizing

Seven sessions on the *companion* symptom (mid-song stop), all still unverified on device: `midplay-stall-background`, `autoadvance-pauses-after-1s`, `bg-resolve-gap-stall`, `reresolve-loop-stops-playback`, `background-autoadvance-stall`, `bg-no-pill-split-play-stop`, `bg-lockscreen-stall-noskip`. Their applied fixes are live in `player.svelte.ts` today. Note two of them applied **contradictory** fixes to the external-pause path (one added a mid-playback resume, one removed the forced-resume machinery) — do not assume either is still intact.

Repo-known loop classes, check for regression rather than rediscovery: audio.error re-resolve storm; `/api/*` fetch flood saturating the ~6-connection pool (apiFetch governor + circuit breaker); `+layout` mount `$effect` self-invalidation via `player.restore()`.

## Constraints

- Sandbox CANNOT run Android. netease + qq Meting proxies are BLOCKED here; **kuwo and Deezer DO work**. Dev server is 4321 (launch.json) or 5173 (bare `pnpm dev`) — probe, don't assume.
- Browser pane rAF is frozen (pane permanently hidden) — verify timing in vitest, not via transitions.
- User CAN export the action log again. Ask for a targeted capture rather than guessing.
- Do NOT push to main — Cloudflare Pages auto-deploys to production on push.

## Current Focus

- hypothesis: The `resolve.ok` → `playing` gap is spent INSIDE the browser's media load (src-set → first byte → decode), not in player.svelte.ts. Competing mechanisms for the ~3 s mode: (H1) Chrome `stalled` (3 s no-progress) → `stall.retry` → re-resolve → new src; (H2) cold stream start of a 1.7 Mbps FLAC on the device network; (H3) media byte request queued behind low-priority image/cover fetches in Chrome's ResourceScheduler.
- test: the existing log cannot separate H1/H2/H3 — it has no media-element events between `resolve.ok` and `playing`. Add one-shot per-src media event instrumentation (loadstart / first progress / loadedmetadata / canplay / stalled / suspend / waiting with Δms from src-set + readyState/networkState/bufferedEnd) and ask for a device capture.
- expecting: H1 → `stall.retry` line present in the 3 s cases; H2 → first `progress` quick but `canplay` late (bytes trickling); H3 → `loadstart` immediate but first `progress` ~2.5–3 s late while the CDN TTFB is ~0.35 s.
- next_action: DONE — instrumentation committed locally (player.svelte.ts driveSrc `src.set` + attach() `media.*` one-shot lines + `playing.ms`; vitest green, `pnpm check` clean). NOT pushed (auto-deploy). CHECKPOINT (human-action): user pushes/deploys, reproduces one fast + one slow start on device, exports the Activity log. On resume: read the `src.set` → `media.*` → `playing` lines for the slow cases and pick H1/H2/H3 per `expecting` above.
- known_pattern_candidate: none in knowledge-base (file absent).

## Candidate fixes — NOT applied (each needs the capture to justify)

- If H2 (cold FLAC stream): stream start could be hidden by making `prebufferNext` cover SQ too — or cheaper, by NOT streaming lossless on the first play of a track (start at HQ m4a, prebuffer lossless for the *next* track only). Re-prices 32-D-15/32-D-20.
- If H1 (`stalled` → retry): the 3 s `stalled` retry re-attaches the SAME edge-cached url (reresolveCurrent → ensureTrackDetails hits the /api/resolve url again); fix = bust/skip the cache on the retry path. Also the stale in-memory url case (cold log, kuwo 38 ms): `ensureTrackDetails` short-circuits on `detailsLoaded && audioUrl` with no age check — a `resolvedAt` stamp + max-age would force a fresh resolve for a url older than N minutes (kuwo/qq signed urls expire).
- If H3 (scheduler queue behind images): defer non-critical image/cover fetches until `playing` (or set `fetchpriority`), i.e. give the media request the pool.

## Evidence

- timestamp: 2026-09-12 — On-device action log supplied by user (Android Chrome/PWA). Cold tap→playing 34,697 ms; warm tap→playing 214–3,433 ms. `resolve.ok` never exceeded 125 ms in any sample. Full table above.
- timestamp: 2026-09-12 — checked: deployed vs local. `origin/main == HEAD == fb04471`, so the device ran the code in the worktree. `STALL_TIMEOUT_MS = 15000` (player.svelte.ts:734) — the `stall.retry` at +3.6 s in the cold case therefore did NOT come from `armStall`; it came from the media `stalled` event listener (attach(), :1789 → `recoverLoadStall`). Chrome fires `stalled` when no `progress` for ~3 s after load start. The July capture (`bg-stall-burndown-log-1.json`) shows the same 3.26 s resolve.ok→stall.retry. implication: the first byte-load of that src produced NO bytes for 3 s.
- timestamp: 2026-09-12 — checked: code between `resolve.ok` and `audio.src` in play() (:3112–3238). All synchronous except `await blobStore.get()` which only runs when `library.isDownloaded(uid)`. Path: attachedCoverFor → `this.current = resolved` (reactive) → persist() (localStorage) → adoptCover/writeCoverBoth → ms.metadata → driveSrc (`audio.src = url`) → armStall → `audio.play()`. No load(), no cover await, no prefetch await. implication: `audio.src` is set within ms of `resolve.ok`; the gap is in the browser's load, not in player code.
- timestamp: 2026-09-12 — checked: `<audio>` element (src/routes/+layout.svelte:92) has NO `preload` attribute (Chrome default = metadata; play() is called immediately after src so this is moot) and NO crossorigin.
- timestamp: 2026-09-12 — checked: kuwo `resolve.ok` in 38 ms hasUrl:true. Detail responses are NOT edge-cached (`cf-cache-status: DYNAMIC`, only `search` segment caches; /api/resolve url-hits are qq-only). 38 ms is below one edge RTT + upstream call, so it is the in-memory short-circuit `track.detailsLoaded && track.audioUrl` (catalog.ts:354) — the tapped kuwo Track object already carried a url pre-resolved earlier in the session (prefetchNext writes `this.queue[i] = resolved`, :2573). Kuwo proxy currently returns HTTP 526 (`/api/kuwo/detail?id=75684778` — upstream TLS failure). implication: the cold case's first 20 s was a STALE in-memory kuwo url (resolve.ok, but the CDN never served bytes) — a dead url served as "resolved" with zero network validation.
- timestamp: 2026-09-12 — checked: live QQ resolve for the cold-case track qq:0003ysON0L5Kky via production proxy. `effectiveQuality('auto')` = `lossless` on wifi (quality.ts:81) → `song_play_url_sq` = 45.17 MB FLAC, 1699 kbps (`audio/x-flac`), `http://isure6.stream.qqmusic.qq.com/...`. CDN from sandbox: 206 range supported, TTFB 0.36 s over both http and https (Chrome auto-upgrades the http src). HQ tier = 5.17 MB m4a 194 kbps. Proxy detail (uncached) TTFB 1.4–3.3 s — but the device saw 100 ms, so warm plays hit the edge resolve cache (/api/resolve url hit, 32-D-20). implication: on wifi every warm QQ play streams a 1.7 Mbps FLAC cold from the CDN unless the ≤24 MB prebuffer (32-D-15) captured it as a blob: — SQ files (~45 MB) are ALWAYS over the ceiling and always stream; PQ (~23 MB) prebuffers. That is a mechanism for a bimodal start: blob: (~120 ms) vs cold FLAC stream.
- timestamp: 2026-09-12 — checked: STRIKE_CAP is 3 in code (:946), not 2 as the initial reading said; `mark-dead` fires at the 3rd strike. The cold log shows the same dead kuwo track attempted twice (2 strikes: audio.error + audio.error) before `advance` moved past it via nextAdvanceIndex — the second attempt cost ~5 s.

## Eliminated

- hypothesis: "Resolve/network latency is the main cause of slow start" — CONTRADICTED by the log: `resolve.ok` is 38–125 ms in every observed sample, cold and warm. The latency lives after a good url is already in hand.
