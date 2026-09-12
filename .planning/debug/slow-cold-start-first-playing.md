---
gsd_debug_version: 1.0
slug: slow-cold-start-first-playing
status: investigating
trigger: "撳落去要等幾秒先開聲 — slow time from tap to first audible sound. Goal: cut tap → first `playing` event latency. Platform: Android Chrome / PWA. Companion symptom (mid-song stop, background/locked only) deferred to a separate session by user decision."
created: 2026-09-12
updated: 2026-09-12T14:20
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

## ROOT CAUSE CONFIRMED — device capture round 2 (2026-09-12, new build verified live via `src.set`)

Both symptoms are ONE cause: **`play()` bounds its first resolve with a 6 s watchdog, then hands a
failure to `runFallback` → `tryFallback`, which has NO deadline of any kind.**

`src/lib/services/fallback.ts` (122 lines) contains zero `setTimeout`, `race`, or deadline. It is a
SERIAL `for` loop over up to 7 sources, each doing `searchAll` then `ensureTrackDetails`, each
bounded only by apiFetch's 25 s `REQUEST_TIMEOUT_MS`. Theoretical worst case 7 × 50 s = 350 s.
It aborts only on a generation change (`playGen`), never on elapsed time.

`RESOLVE_WATCHDOG_MS = 6000` (player.svelte.ts:756) therefore guards ONLY the first resolve. The
expensive part is entirely unguarded — the watchdog hands off to an unbounded walk.

### Measured — cold tap, 56,369 ms to first sound

| Δ from tap | event | note |
|---|---|---|
| 0 | `play` kuwo:75684778 | TAP |
| +6,030 | `resolve.timeout` kuwo | watchdog, `ac.abort()`, → runFallback |
| +35,308 | `fallback` kuwo→netease | **29,278 ms inside the unbounded walk** |
| +37,445 | `play` netease:1440014557 | |
| +43,457 | `resolve.timeout` netease | another 6 s watchdog |
| +48,837 | `fallback` netease→qq | |
| +53,445 | `resolve.ok` qq | 4,608 ms |
| **+56,369** | **`playing`** | |

### Measured — THE BACKGROUND STOP (matches the user's narrative exactly)

| t | event | user-visible |
|---|---|---|
| 785714 | `visibility hidden:true` | switches to WhatsApp |
| 997976 | `ended` qq:0003ysON0L5Kky | song A finishes |
| 997978 | `play` qq:003MvIJf28Emkj | song B starts resolving |
| 1004009 | `resolve.timeout` song B | +6,031 ms |
| — | **26,016 ms of TOTAL SILENCE** | **"then it stop"** — runFallback walking, nothing to hear |
| 1030025 | `visibility hidden:false` | switches back to OpenMusic |
| 1034593 | `advance` → song C | **"song b is skipped"**, **"song c is being played without me clicking"** |
| 1040596 | `resolve.timeout` song C | +6,002 ms |
| 1049508 | `resolve.ok` | |
| 1052002 | `playing` | **"song e take a few sec to load and play by itself"** |

The player never stopped. It was blocked inside an unbounded fallback walk. From the seat of a user
with the screen off, a 26 s silent gap IS a stop.

## H1 / H2 / H3 — RESOLVED by the `media.*` instrumentation

- **H1 (Chrome `stalled` → re-resolve) — ELIMINATED.** No `stall.retry` in any slow case.
- **H2 (cold FLAC stream too big) — ELIMINATED.** Bandwidth is fine: slow case `qq:001rBvxx2sEvf9`
  buffered **46.2 s of audio by ms:5199**. FLAC size is not the problem.
- **H3 (first-byte delay) — CONFIRMED.** In both slow cases there is NO `media.progress` before
  `loadedmetadata`, with `buf:0 rs:0 ns:2` — the element is connected and waiting on the FIRST BYTE
  for 2,173–2,888 ms. Once bytes arrive, `canplay` follows in 15–307 ms.

| case | loadstart | first progress | loadedmetadata | playing |
|---|---|---|---|---|
| fast `qq:0003ysON0L5Kky` | ms:26 | **ms:68** | ms:74 | **ms:78** |
| slow `qq:001rBvxx2sEvf9` | ms:8 | ms:3247 (AFTER playing) | **ms:2888** | ms:2904 |
| slow `qq:000mQkBo42a7r4` | ms:20 | ms:2175 | **ms:2173** | ms:2480 |

Both slow cases occur immediately after fallback churn; the fast case follows a quiet ~19 s. That
correlation points at connection contention during the walk, but is NOT yet nailed — it is a
SECONDARY ~2.5 s cost, an order of magnitude smaller than the 26–29 s walk, so it is not the
priority.

## Confirmed working — the stale-url age check (commit 3382300)

No `resolve.ok` (~38 ms) → `stall.retry` → `audio.error hasPlayed:false` sequence anywhere in this
capture. That failure shape is gone. The remaining slowness is a different, larger mechanism.

## Current Focus

- hypothesis: CONFIRMED — `tryFallback` (fallback.ts) is an unbounded serial walk over up to 7
  sources with no elapsed-time deadline; `RESOLVE_WATCHDOG_MS` guards only `play()`'s first resolve,
  so a failed track costs 6 s + an unbounded 19–29 s walk. Backgrounded, that gap is heard as a stop.
- next_action: bound the failure episode end-to-end, then re-capture on device.

## Fixes applied + DEPLOYED (2026-09-12, commits acf96c0 + 0971a00, live on openmusic.lol)

1. **`FALLBACK_BUDGET_MS = 8000`** — runFallback's existing supersedence interval now also enforces
   an elapsed-time ceiling and aborts the walk. A budget expiry is deliberately NOT routed into
   `handleTotalFailure`: the walk was cut short, so remaining sources are UNKNOWN, not exhausted, and
   miscounting it would march toward the FAILURE_CAP loop-guard STOP. It strikes the uid and skips
   forward, leaving the track IN the queue. Never STOP, always SKIP.
   New log event: **`fallback.budget`**.

2. **Readiness guard extracted to `src/lib/services/track-ready.ts`** — was FIVE inline copies of
   `detailsLoaded && audioUrl && …`, four of them stale-blind. Two predicates now:
   `hasFreshAudioUrl` (pre-warm/reuse) and `isTrackReady` (resolve paths, adds the lyric clause).
   Two additional stale-blind sites found during the extraction: `download-track`'s reuse-current
   shortcut (could write a dead url to disk) and `track-menu-gate.isGatedReady` (ran gated actions on
   a dead url instead of resolving first).

**Expected effect:** worst case per dead track drops from ~35–56s to ~14s (6s watchdog + ≤8s walk).
Backgrounded, the silent gap drops from 26s+foreground-wait to ~14s. And `prefetchNext` should now
genuinely pre-validate the next track instead of rubber-stamping a stale url — which is the part
that actually delivers "keep playing", and the part that CANNOT be verified without a device.

**Known side effect (intended):** prefetch/prewarm will issue MORE re-resolves now that a stale url
no longer short-circuits them. Each costs ~100ms against ~8.4s per strike for a dead url.

**Still open:** the ~2.5s first-byte delay (H3) — an order of magnitude smaller than the walk, so
deliberately not chased yet. And the up-next stability question below.

## Up-next stability — investigated, NOT rebuilt

User spec: the list must not reshuffle unless a song is tapped from OUTSIDE up-next / related /
auto-generated up-next; an outside tap regenerates from that song using the up-next sourcing setting.

Grep of every install site says this is ALREADY the implemented behavior:
- up-next row tap (`NowPlaying.svelte:1579`) → `play(track, {fresh:false})`, no queue install
- search / artist / album / library / home → `setListQueue(...)` then `play(t, {fresh:true})`

Memory note `upnext-anchor-history-model` also warns the played-songs-stay-in-list model is already
built and must not be rebuilt. So the reported symptom is likely a specific defect elsewhere, not a
missing feature. AWAITING a precise observation from the user before touching it — deliberately not
guessing, because rebuilding this would break behavior that is currently correct.

## ROUND 3 — device capture CONFIRMS the background stop is fixed (2026-09-12)

First device-verified result in this session. Everything before was construction-level evidence.

**Background auto-advance now works while hidden:**

| t | event |
|---|---|
| 235710427 | `visibility hidden:true` |
| 235881160 | `ended` qq:004RhnIu2tnFV4 |
| 235881162 | `advance` |
| 235881287 | **`playing ms:53`** |
| 235921554 | `visibility hidden:false` — 40s LATER |

Three more consecutive hidden advances at **ms:86 / 148 / 187**. Compare the round-2 capture at the
same point: 26,016 ms of silence and no progress until the user foregrounded.

Corroborating signals in the same capture:
- `src.set kind:"prebuffer-blob"` now appears — prefetch IS running (round 2 had ZERO prefetch
  events across 224 s of playback). This is the `hasFreshAudioUrl` fix landing.
- `resolve.timeout`: **0 occurrences** (round 2 had 5).
- `fallback.budget`: absent — the walk was never needed, so the ceiling never had to fire.

**Still slow — cold foreground tap.** `qq:000mZmtn49cLt5`: `play` → `resolve.ok` 2,736 ms →
`playing ms:2733`, ≈5.5 s total. Half resolve, half H3 first-byte (`media.progress` at ms:2640).
H3 is now the LARGEST remaining cost and the next thing worth attacking.

**New, unrelated:** the netease proxy is serving broken URLs — `src.set ext:"/meting/"` then an
immediate `audio.error`; `netease:3409100018` was attempted four times. Separate from this session's
root cause; worth its own issue.

## Up-next stability — ROOT CAUSE FOUND + FIXED (commit 1a5dc14)

Reported: a1 playing (up next a2,a3,a4) → tap b1 in RELATED → play c1 from the main page → got
`c1, b1, c2` instead of `c1, c2, c3`.

`relatedTapPlay` (NowPlaying.svelte) called `player.playNext(track)` purely for its
splice-after-current positioning, and inherited its side effect: `playNext`'s first line is
`manualUids.add(t.uid)`, and pinned entries are DESIGNED to survive a context switch
(quick-260618-fiz Fix 4 re-weaves them AFTER the new seed — which is exactly the observed position).
So a plain TAP was recorded as an explicit user PIN.

Fix: `playNext(t, { pin })`, default true so all 11 existing callers are byte-identical; the related
TAP passes `{ pin: false }`. Explicit Play-next paths (swipe-left, track menu, per-page swipes — all
of which raise a toast) still pin and still survive, as designed.

**Test-harness fragility found, NOT chased:** a fuller version of the regression test
(tap → setListQueue → fresh play) corrupted an unrelated neighbouring test. State at test start
probed clean and async was fully settled, so the likely cause is catalog's module-level TTL search
cache (`__clearSearchCache` is not called in that suite's `beforeEach`) leaking memoized results
across tests. Test-harness only, not production. The committed tests were narrowed to the pin
decision itself; the surrounding quick-260618-fiz tests already cover what a pin does across a fresh
play and still pass.

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
