---
phase: quick-260915-3ng
verified: 2026-09-15T08:57:05Z
status: human_needed
score: 8/8 must-haves verified (code-level)
has_blocking_gaps: false
overrides_applied: 0
human_verification:
  - test: "Build the APK (JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home pnpm apk), install on a physical/emulated Android device (adb install -r android/app/build/outputs/apk/debug/app-debug.apk), and play a YouTube Music track."
    expected: "The device's own two CapacitorHttp InnerTube POSTs return a playable itag-140 googlevideo url, and <audio> gets a 206 with real bytes (confirm 'playing' in Settings -> Activity log), not a 403/skip-to-next."
    why_human: "The core claim of this task is a network-boundary outcome — googlevideo accepting the byte fetch because it now comes from the phone's own IP instead of the Cloudflare edge's datacenter IP. That can only be observed by running the real InnerTube exchange from a real device IP; it is unverifiable from static code, from this sandboxed dev machine (no device, and CN/media upstream reachability differs from device conditions), and from unit tests (which mock CapacitorHttp by design, per must-have #7: 'no live network')."
---

# Quick Task 260915-3ng: Native-only YouTube Music playback resolve — Verification Report

**Task Goal:** On the Capacitor native build only, resolve the ytmusic googlevideo URL ON DEVICE via CapacitorHttp (both InnerTube hops from the device's own IP), falling back to the existing edge proxy path on failure. Web build `resolve()` behavior byte-identical to today. `ANDROID_VR_VERSION` pin single-sourced.

**Verified:** 2026-09-15T08:57:05Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from PLAN frontmatter `must_haves.truths`)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Native `resolve()` stamps `audioUrl` with a DIRECT googlevideo itag-140 url obtained via two device-side `CapacitorHttp` POSTs (WEB_REMIX search → ANDROID_VR player) | ✓ VERIFIED (code-level) | `src/lib/sources/ytmusic.ts:256-260` guards on `Capacitor.isNativePlatform()` and awaits `nativeResolveStreamUrl`; `ytmusic-native.ts` `getVisitorData`→`callPlayer`→`selectAudioFormat` performs exactly the two `CapacitorHttp.post` hops (`ytmusic-native.test.ts` "posts SEARCH then PLAYER and returns the itag-140 googlevideo url" passes). Actual on-device 206 is NOT verifiable here — see Human Verification. |
| 2 | Native failure (any reason) falls back to `apiUrl('/api/ytmusic/stream/<videoId>')`, never throws | ✓ VERIFIED | `ytmusic.ts:258` `.catch(() => null)` belt-and-braces around an already never-throw resolver; `track.audioUrl = direct ?? apiUrl(...)`. Tests: "native-null falls back", "native REJECTS falls back" in `ytmusic.test.ts` (describe block at line 337) pass. |
| 3 | Web `resolve()` byte-identical to today: no `CapacitorHttp` call, no new await before the stamp, same proxy url, same `quality`/`qualityLabel`, same lyrics fetch | ✓ VERIFIED | Web path: `let direct: string | null = null; if (Capacitor.isNativePlatform()) { … }` — `isNativePlatform()` is a synchronous call; when it returns false (web) there is no `await` and no call before `track.audioUrl = direct ?? apiUrl(...)` executes with `direct` still `null`, producing the identical stamp. `ytmusic.test.ts` asserts `expect(mocks.nativeResolve).not.toHaveBeenCalled()` on the web branch and all pre-existing web resolve tests pass unmodified in behavior. |
| 4 | `ANDROID_VR_VERSION` exists in exactly ONE file; edge route + native resolver both derive UA/body from it | ✓ VERIFIED | `grep -rn "ANDROID_VR_VERSION = '" src` → exactly one hit, `src/lib/proxy/ytmusic-innertube.ts:73`. Stream route (`+server.ts`) imports `ANDROID_VR_UA`/`androidVrPlayerBody` from `$lib/proxy/ytmusic` (re-export); `ytmusic-native.ts` imports the same two directly from `$lib/proxy/ytmusic-innertube`. No literal `1.65.10`/`1.60.19` duplicate outside that one `export const` line and its own comments. |
| 5 | Native resolver caches visitorData ~6h TTL, refresh-once-then-null, never loops | ✓ VERIFIED | `ytmusic-native.ts:39-44` `VISITOR_TTL_MS = 6h`; `nativeResolveStreamUrl` does exactly one refresh+retry (`ytmusic-native.test.ts` "refreshes visitorData ONCE then gives up — 4 posts, null result, never loops" passes: `[SEARCH, PLAYER, SEARCH, PLAYER]`, no 5th call). |
| 6 | `nativeResolveStreamUrl` NEVER throws on reject/non-2xx/malformed JSON/aborted signal/ciphered-only format | ✓ VERIFIED | `grep -n "throw" ytmusic-native.ts` returns 0 literal `throw` statements (only doc comments say "NEVER throws"); every hop is wrapped in try/catch returning `null`. All 6 corresponding test cases pass (reject, 403, ciphered-only, aborted, JSON-string body, malformed body). |
| 7 | Existing single-pin drift guard + all tests keep passing, `pnpm check`/`pnpm test` green, no live network | ✓ VERIFIED | Ran myself (not trusting SUMMARY): `pnpm check` → `0 ERRORS 0 WARNINGS` (4533 files). `pnpm test` → `129 files passed, 2472 tests passed` in 9.84s. `@capacitor/core` and global `fetch` are mocked in every new test file (`vi.mock('@capacitor/core', …)` in both `ytmusic-native.test.ts` and `ytmusic.test.ts`); no network calls observed. |
| 8 | "kept edge-side" `WEB_REMIX_KEY` claim in `proxy/ytmusic.ts` rewritten to not contradict the key shipping natively | ✓ VERIFIED | `grep -rn "kept edge-side" src/lib/proxy/ytmusic.ts src/lib/proxy/ytmusic-innertube.ts` → 0 hits. New wording in both files states the key is PUBLIC and now also ships in the native bundle, with the three invariants that still hold (no response echo, zero auth, one rotation point). |

**Score:** 8/8 truths verified at the code level. One outcome (real-device 206 from googlevideo) is genuinely unverifiable from this environment — see Human Verification below. This is not a failed truth; the PLAN itself scopes it as a human follow-up step (`success_criteria`: "Follow-up (out of this plan, human): pnpm apk … confirm playing … THEN decide on push"), not as an automated must-have.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/proxy/ytmusic-innertube.ts` | pure, dependency-free, client-importable InnerTube primitives, single `ANDROID_VR_VERSION` | ✓ VERIFIED | Read in full: zero import statements at all (not just zero of the forbidden ones). Exports `WEB_REMIX_KEY`, `InnerTubeContext`, `WEB_REMIX_CONTEXT`, `SEARCH_URL`, `PLAYER_URL`, `INNERTUBE_HEADERS`, `ANDROID_VR_VERSION`, `ANDROID_VR_UA`, `androidVrPlayerBody`, `extractVisitorData`, `YtAdaptiveFormat`, `YtPlayerJson`, `isPlayable`, `selectAudioFormat` — matches the artifact's `provides` list exactly. |
| `src/lib/proxy/ytmusic.ts` | re-exports the primitives, existing importers unchanged | ✓ VERIFIED | `export * from './ytmusic-innertube';` present; edge-only helpers (`innerTubePost`, `searchInnerTube`, `getVisitorData`, `findLyricsTab`, `extractLyrics`) remain, importing `fetchWithRetry`/`edgeCache` — correctly NOT moved. |
| `src/routes/api/ytmusic/stream/[videoId]/+server.ts` | imports `androidVrPlayerBody` from the shared module, local pin deleted | ✓ VERIFIED | Local `ANDROID_VR_VERSION`/`ANDROID_VR_UA`/`playerBody` are gone; imports `androidVrPlayerBody`, `ANDROID_VR_UA` from `$lib/proxy/ytmusic`; `callPlayer` calls `androidVrPlayerBody(videoId, visitorData)`. |
| `src/lib/services/ytmusic-native.ts` | `nativeResolveStreamUrl`, `__resetNativeVisitorCache`, never-throws, ≥60 lines | ✓ VERIFIED | 141 lines. Both exports present and match the described contract. |
| `src/lib/services/ytmusic-native.test.ts` | node-only vitest, mocked `@capacitor/core`, ≥80 lines | ✓ VERIFIED | 180 lines, 11 `it(...)` cases covering every behavior bullet in the plan (OK-first-try, UA/body agreement, cache reuse, refresh-once-then-null, refresh-succeeds, reject, non-2xx, ciphered-only, aborted-signal, JSON-string body, malformed body). |
| `src/lib/sources/ytmusic.ts` | native branch, web path untouched | ✓ VERIFIED | `Capacitor.isNativePlatform()` guard + `nativeResolveStreamUrl` call present; web path has no added await (see Truth #3). |
| `src/lib/sources/ytmusic.test.ts` | native-success/native-null/web-untouched cases | ✓ VERIFIED | `describe('ytmusic.resolve — native on-device googlevideo url with proxy fallback (quick-260915-3ng)')` at line 337 covers the 4 behavior cases from the plan. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `ytmusic-native.ts` | `ytmusic-innertube.ts` | named import of `ANDROID_VR_UA`, `androidVrPlayerBody`, `PLAYER_URL`, `SEARCH_URL`, `INNERTUBE_HEADERS`, `WEB_REMIX_CONTEXT`, `isPlayable`, `selectAudioFormat`, `extractVisitorData` | ✓ WIRED | All 8 names imported and used (verified by reading the file's import block and body). |
| `+server.ts` (stream route) | `ANDROID_VR_UA`/`androidVrPlayerBody` (re-exported) | named import from `$lib/proxy/ytmusic` | ✓ WIRED | Confirmed in file read. |
| `ytmusic.ts resolve()` | `nativeResolveStreamUrl` | `Capacitor.isNativePlatform()` guard, `result ?? apiUrl(...)` | ✓ WIRED | Confirmed in file read, lines 256-260. |
| `ytmusic-native.ts` | `@capacitor/core CapacitorHttp.post` | explicit call-site usage (not global patch) | ✓ WIRED | `post()` helper calls `CapacitorHttp.post({...})` explicitly; `capacitor.config.ts` has no `CapacitorHttp.enabled`/http-plugin patch block (confirmed by reading the full file — only `appId`/`appName`/`webDir`/`android.allowMixedContent`). |

### Client-Bundle Safety Trace (must-have #2 from the verification brief)

- `src/lib/proxy/ytmusic-innertube.ts` — zero import statements (confirmed by reading the full file). Cannot transitively pull `fetchWithRetry`/`edgeCache`/`@capacitor/*` because it imports nothing.
- `src/lib/services/ytmusic-native.ts` — imports only `@capacitor/core` (`CapacitorHttp`) and `$lib/proxy/ytmusic-innertube`. `grep -c "proxy/ytmusic'" ytmusic-native.ts` → 0 (does not import the edge module `$lib/proxy/ytmusic`, only the innertube primitives module).
- `src/lib/sources/ytmusic.ts` imports `nativeResolveStreamUrl` from `../services/ytmusic-native` (not from the edge proxy) and `Capacitor` from `@capacitor/core` — consistent with existing client-code patterns (e.g. `blob-store.ts`).

### Behavioral Spot-Checks / Test Run (run myself, not trusted from SUMMARY)

| Command | Result | Status |
|---------|--------|--------|
| `pnpm check` | `COMPLETED 4533 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` | ✓ PASS |
| `pnpm test` (full) | `129 files passed (129)`, `2472 tests passed (2472)`, 9.84s | ✓ PASS |
| `grep -rn "ANDROID_VR_VERSION = '" src` | 1 hit, `ytmusic-innertube.ts:73` | ✓ PASS |
| `grep -n "throw" ytmusic-native.ts` | 0 literal `throw` statements (2 doc-comment mentions only) | ✓ PASS |
| `git log origin/main..HEAD --oneline` | Lists `64a68eb`, `54bc5eb`, `7417537` (this task) plus 8 unrelated Phase-37 commits — all unpushed | ✓ PASS (not pushed, per plan instruction) |

Note: on the first `pnpm check` run of this verification, a transient 2-error result appeared referencing `src/lib/services/local-tags.ts` (missing module for `local-tags.test.ts`) — that file belongs to an unrelated, concurrently-in-progress Phase 37 task in the same working tree (per git status: `local-tags.ts` untracked, `local-tags.test.ts` committed at `b821433`), not to this quick task. A re-run seconds later showed `0 ERRORS`, confirming it was a transient write-race unrelated to quick-260915-3ng's own files. Not counted as a gap here.

### Out-of-Scope Guard (must-have #8 from the verification brief)

| Guard | Status | Evidence |
|-------|--------|----------|
| `capacitor.config.ts` NOT given a global `CapacitorHttp` patch | ✓ VERIFIED | Full file read — only `appId`, `appName`, `webDir`, `android.allowMixedContent`. No `CapacitorHttp`/`plugins` block. |
| `/api/ytmusic/stream` route still exists and still works | ✓ VERIFIED | File present, unmodified logic apart from the shared-import swap; `stream.test.ts` (part of the 30-test `src/routes/api/ytmusic` suite) passes. |
| No auth/OAuth/cookie/PoToken code added | ✓ VERIFIED | `grep -rniE "oauth|potoken|cookie"` across the new/touched files returns only pre-existing "ZERO auth: no OAuth/cookie/PoToken" doc-comment lines, no actual auth code. |
| Download blob fetch NOT switched to `CapacitorHttp` | ✓ VERIFIED | `download-track.ts` diff is a comment-only addition above the existing raw `fetch(r.audioUrl)` call; no code change, as the plan required. |

### Requirements Coverage

Single requirement `quick-260915-3ng` declared in the PLAN frontmatter — covered by all 8 truths above. No REQUIREMENTS.md entry exists for quick tasks (not phase work); not applicable.

### Anti-Patterns Found

None. No `TODO`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER` markers in any of the 6 modified/created source files. No empty-return stubs, no hardcoded-empty state feeding a render path (this is a service/adapter change, no UI).

### Human Verification Required

### 1. On-device APK confirmation that the device's own IP satisfies googlevideo's IP lock

**Test:** `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home pnpm apk`, then `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, open the app, search and play a YouTube Music track, and check Settings → Activity log for a `playing` event (not `audio.error`/skip-to-next).
**Expected:** The device performs the two InnerTube hops itself, `selectAudioFormat` returns an itag-140 googlevideo url signed for the phone's own IP, and `<audio>` receives a 206 with real bytes — i.e., YouTube Music tracks that were previously silently skipped on native now play.
**Why human:** This is the entire reason the task exists — a network trust-boundary outcome (googlevideo accepting a byte fetch because the requester IP now matches the IP that signed the url) that by definition cannot be reproduced by mocked unit tests (which intentionally never touch the network, per must-have #7) or by static code reading. It also cannot be run from this sandboxed dev machine, which has no Android device/emulator attached and would not present the same public IP characteristics as a real handset even if it could reach googlevideo.

### Gaps Summary

No code-level gaps. All 8 must-have truths from the PLAN frontmatter are verified by direct reading of the actual source (not the SUMMARY's claims) and by running `pnpm check`/`pnpm test` myself with matching output. The task explicitly and correctly scoped the real-world proof (device gets 206 from googlevideo) as an out-of-band human/device step, and the SUMMARY correctly flags it as "NOT verified by this work." Status is `human_needed` rather than `passed` because that step is still outstanding and is the actual success signal for the stated goal ("resolve the ytmusic googlevideo URL ON DEVICE … satisfying googlevideo's full-IP lock") — code enabling the behavior is necessary but not sufficient evidence that the IP lock is actually satisfied for a real device.

---

_Verified: 2026-09-15T08:57:05Z_
_Verifier: Claude (gsd-verifier)_
