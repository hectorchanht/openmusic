---
phase: quick-260915-3ng
plan: 01
subsystem: sources/ytmusic
tags: [ytmusic, capacitor, native, innertube, googlevideo, ip-lock]
requires: ["@capacitor/core 8.4.0 (already a dependency — CapacitorHttp exported)"]
provides:
  - "src/lib/proxy/ytmusic-innertube.ts — pure, import-free, client-importable InnerTube primitives (single ANDROID_VR_VERSION pin)"
  - "src/lib/services/ytmusic-native.ts — nativeResolveStreamUrl(videoId, signal), never-throws"
  - "ytmusic.resolve() native branch with proxy fallback"
affects:
  - "src/lib/proxy/ytmusic.ts (now re-exports the primitives)"
  - "src/routes/api/ytmusic/stream/[videoId]/+server.ts (imports the shared UA + player body)"
tech-stack:
  added: []
  patterns: ["explicit CapacitorHttp at one call site (global fetch/XHR patch stays OFF)", "refresh-once-then-null", "signal checked between hops (HttpOptions has no AbortSignal)"]
key-files:
  created:
    - src/lib/proxy/ytmusic-innertube.ts
    - src/lib/services/ytmusic-native.ts
    - src/lib/services/ytmusic-native.test.ts
  modified:
    - src/lib/proxy/ytmusic.ts
    - src/routes/api/ytmusic/stream/[videoId]/+server.ts
    - src/lib/sources/ytmusic.ts
    - src/lib/sources/ytmusic.test.ts
    - src/lib/services/download-track.ts
decisions:
  - "On native the DEVICE performs both InnerTube hops via CapacitorHttp, so the itag-140 googlevideo URL is IP-signed for the phone; the web build keeps today's edge-proxy path byte-identical"
  - "ANDROID_VR_VERSION lives in exactly one file; the edge route and the native resolver both derive UA + body clientVersion from it"
  - "A native resolve failure falls back to the proxy path — degrades to today's behaviour, never throws"
metrics:
  duration: ~20 min
  completed: 2026-09-15
---

# quick-260915-3ng: Native-only YouTube Music playback resolve Summary

On the Capacitor APK, `ytmusic.resolve()` now obtains the direct itag-140 googlevideo URL on-device via two `CapacitorHttp` InnerTube POSTs, so the URL is IP-signed for the phone instead of for the Cloudflare edge that the CDN refuses with 403; the web build's resolve path is unchanged and is also the native fallback.

## What Was Built

**Task 1 — `src/lib/proxy/ytmusic-innertube.ts` (commit `64a68eb`)**
Pure, import-free, client-importable primitives carved out of `proxy/ytmusic.ts` and the stream route:
`WEB_REMIX_KEY`, `InnerTubeContext`, `WEB_REMIX_CONTEXT`, `SEARCH_URL`, `PLAYER_URL`, `INNERTUBE_HEADERS`
(now exported), `ANDROID_VR_VERSION`, `ANDROID_VR_UA`, `androidVrPlayerBody`, `extractVisitorData`,
`YtAdaptiveFormat`, `YtPlayerJson`, `isPlayable`, `selectAudioFormat`.
`proxy/ytmusic.ts` keeps the edge-only helpers and adds `export * from './ytmusic-innertube'`, so all
five existing `$lib/proxy/ytmusic` importers needed zero edits. The stream route's local
`ANDROID_VR_VERSION` / `ANDROID_VR_UA` / `playerBody` are gone; it imports the shared ones.
`getVisitorData` now calls `extractVisitorData` instead of inlining the same walk.
The "kept edge-side" claims about `WEB_REMIX_KEY` (module header + the constant's doc) are rewritten:
the key is public, it now also ships in the native bundle, and what still holds is (a) no
`/api/ytmusic` response echoes the key or a visitorData token, (b) ZERO auth, (c) one rotation point.

**Task 2 — `src/lib/services/ytmusic-native.ts` + tests (commit `54bc5eb`, TDD)**
`nativeResolveStreamUrl(videoId, signal): Promise<string | null>` over `CapacitorHttp.post`:
visitorData grab (WEB_REMIX search) → ANDROID_VR `player` → `selectAudioFormat`. Module-scope
visitorData cache with a ~6h TTL mirroring the edge; on a non-playable response it refreshes the token
ONCE, retries the player ONCE, then returns null. `HOP_TIMEOUT_MS = 15000` as both `connectTimeout`
and `readTimeout` — `HttpOptions` has no `AbortSignal`, so the timeout is the hard stop and the caller's
signal is checked between hops only. Never throws: bridge rejection, non-2xx, unparseable body,
ciphered-only formats and aborted signals all return null. `__resetNativeVisitorCache()` is the test
hook (house precedent `__resetGovernor`). Imports only `@capacitor/core` and
`$lib/proxy/ytmusic-innertube` — never `$lib/proxy/ytmusic`, which would drag `fetchWithRetry` /
`edgeCache` into the client bundle.

**Task 3 — adapter wiring (commit `7417537`, TDD)**
`ytmusic.resolve()` sets `let direct: string | null = null;` and only under
`Capacitor.isNativePlatform()` awaits `nativeResolveStreamUrl(track.songid, signal).catch(() => null)`,
then stamps `direct ?? apiUrl('/api/ytmusic/stream/<videoId>')`. The web branch therefore has no added
await and no new call before the stamp. `quality` / `qualityLabel` / `detailsLoaded` and the entire
best-effort lyrics block are untouched. `download-track.ts` got a comment only (no code change)
recording that a native ytmusic `audioUrl` is a direct googlevideo URL with no ACAO, so that `fetch()`
CORS-fails — no regression (the proxy route already 403s), and deliberately not routed through
`CapacitorHttp` because it returns binary as base64.

## Verification (actually run, real output)

| Check | Result |
|---|---|
| `grep -rl "ANDROID_VR_VERSION = '" src \| wc -l` | **1** |
| forbidden imports in `ytmusic-innertube.ts` | none (grep for `fetchWithRetry\|edgeCache\|@capacitor` → clean) |
| `ytmusic-native.ts` imports `$lib/proxy/ytmusic'` | no (boundary clean) |
| `pnpm check` | **0 ERRORS 0 WARNINGS**, 4531 files |
| `pnpm test` (full) | **128 files passed, 2458 tests passed**, 9.47s |
| `pnpm test -- src/routes/api/ytmusic` | 2 files / 30 tests passed — includes the quick-260915-30m rotting-pin drift guard |
| `pnpm test -- src/lib/services/ytmusic-native` | 11 tests passed |
| `pnpm test -- src/lib/sources/ytmusic` | 19 tests passed (16 pre-existing + 3 new native cases) |
| live network during tests | none — `@capacitor/core` and global `fetch` are mocked in every new test |
| pushed? | **NO** — `git log origin/main..HEAD` lists all three commits as unpushed |

TDD gates observed: Task 2 RED (module absent → suite failed to import), then GREEN (11/11).
Task 3 RED (`expect(out.audioUrl).toBe(DIRECT)` received `/api/ytmusic/stream/vidN1`), then GREEN (19/19).
No refactor commit was needed for either.

## Deviations from Plan

**1. [Rule 3 - Blocking] Reworded the `ytmusic-innertube.ts` header so the plan's own grep guard passes**
- **Found during:** Task 1 verification
- **Issue:** The plan required the header to state the module imports nothing from `./http` /
  `./edge-cache` / `@capacitor/*`, but its automated check is
  `! grep -q "fetchWithRetry\|edgeCache\|@capacitor" ytmusic-innertube.ts` — the explanatory comment
  itself tripped the guard.
- **Fix:** Same statement, phrased without those literal symbol names ("no edge fetch/cache helper, no
  SvelteKit app module, no native bridge").
- **Files modified:** `src/lib/proxy/ytmusic-innertube.ts`
- **Commit:** `64a68eb`

**2. [Rule 3 - Blocking] Static import instead of `await import()` in the native test**
- **Found during:** Task 2 RED
- **Issue:** Top-level `await import('./ytmusic-native')` failed to parse under the node test project.
- **Fix:** Plain static import — `vi.mock` is hoisted above it anyway, so the mock still applies.
- **Files modified:** `src/lib/services/ytmusic-native.test.ts`
- **Commit:** `54bc5eb`

**3. [cosmetic] `SONGS_FILTER`'s section banner in `proxy/ytmusic.ts`**
- The old "Verified InnerTube constants … one rotation point" banner now sits above the two search
  filter params only, so it was retitled to say so and to point at `./ytmusic-innertube.ts`. No
  behaviour change.

No architectural (Rule 4) decisions arose. No packages were installed.

## Known Stubs

None.

## Threat Flags

None beyond the plan's own register. `nativeResolveStreamUrl` plays only a URL that came out of
InnerTube's own `adaptiveFormats` (T-3ng-02 holds); `videoId` goes only into the fixed
`androidVrPlayerBody`; the global `CapacitorHttp` fetch/XHR patch in `capacitor.config.ts` remains OFF
(T-3ng-04); no new dependency (T-3ng-SC).

## What Is NOT Verified

Everything here is static + unit-level. The actual claim — that a phone's own IP gets a 206 from
googlevideo for the URL it resolved itself — is **unverified by this work** and cannot be verified from
this machine. It needs the device run:

```
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home pnpm apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

then play a YouTube Music track and confirm `playing` in Settings → Activity log. **Do not push until
that passes** — pushing `main` auto-deploys production.

## Self-Check: PASSED

- `src/lib/proxy/ytmusic-innertube.ts` — FOUND
- `src/lib/services/ytmusic-native.ts` — FOUND (141 lines)
- `src/lib/services/ytmusic-native.test.ts` — FOUND (180 lines)
- commits `64a68eb`, `54bc5eb`, `7417537` — all FOUND in `git log`
