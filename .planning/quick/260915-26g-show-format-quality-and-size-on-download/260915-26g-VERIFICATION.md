---
phase: quick-260915-26g
verified: 2026-09-15T02:00:00Z
status: human_needed
score: 7/7 must-haves verified (code-level); 1 item requires live-CDN human verification
has_blocking_gaps: false
overrides_applied: 0
human_verification:
  - test: "Open the ⋮ menu on a live kuwo (or qq) search result on a real device/dev-server; observe the Download row skeleton resolve into a real `FORMAT · SIZE` label (e.g. `320K · 8.1 MB`); reopen the same menu and confirm no new network activity (network tab); scroll the library page and confirm zero HEAD/resolve requests fire per row."
    expected: "Skeleton renders while probing, then a real label appears; the underlying HEAD→Range→null ladder in download-probe.ts's `measure()` has only been exercised against stubbed fetch responses in download-probe.test.ts, never against real kuwo/qq CDN response headers (CORS-safelisting of Content-Length/Content-Range, actual HEAD support, actual Content-Type values)."
    why_human: "SUMMARY.md explicitly declares this leg was not run — no dev server was started in the execution session. Cannot be verified by static code inspection; needs a live network trace. Per task instructions this is a known, declared gap being checked live by the orchestrator in parallel — recorded here, not re-litigated."
---

# Quick Task 260915-26g: Show Format, Quality, and Size on Download — Verification Report

**Task Goal:** The ⋮ download row (and the shared `DownloadControl`) shows the REAL container/quality + byte size of what the tap will download, e.g. `FLAC · 38.2 MB`, probed when the affordance opens — not a guess from `settings.downloadQuality`.

**Verified:** 2026-09-15
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Opening a song's ⋮ menu shows the REAL container/quality + byte size on the Download row, probed at `settings.downloadQuality`, with a skeleton while in flight | ✓ VERIFIED (code) / ? unverifiable_runtime (live CDN) | `TrackMenu.svelte` `$effect` (lines ~253-284) calls `probeDownload(target, ac.signal)` on `open && track`; `dlMeta`/`dlProbing` render `.count.skel` then `{dlMeta}` in the Download row (~line 543-546) and in the header button title (~line 469). Ladder logic unit-tested exhaustively in `download-probe.test.ts` against stubbed responses only — never against a live kuwo/qq CDN (declared gap, see human_verification) |
| 2 | Probe failure → Download row renders exactly as today (`Download`), download still works | ✓ VERIFIED | `dlMeta` is `null` when `dlProbe` is null/all-null sentinel → `{:else if dlMeta}` branch never renders, leaving the plain `<Download/> {t('menu.download')}` markup unchanged. `startDownload()` falls back to `track` (not `dlProbe?.track`) whenever `dlProbe` is null/mismatched uid — download path unaffected by probe failure |
| 3 | List rows (library, album, RowBadges) issue ZERO extra network calls — `probe` defaults false, no list call site sets it | ✓ VERIFIED | `DownloadControl.svelte` line 44: `probe = false` in `$props()` destructure. Grepped all 5 `<DownloadControl>` call sites (`library/+page.svelte:242,278,303,342`, `album/[name]/+page.svelte:675`) — none pass `probe`. `RowBadges.svelte` does not mount `DownloadControl` at all |
| 4 | Re-opening the same menu costs no network — memoised per `uid|downloadQuality` | ✓ VERIFIED | `download-probe.ts` `memo` keyed `${track.uid}|${want}` (line 186), checked before any resolve/fetch (line 187-188). Unit-tested: "costs no network on a second call with the same key" and "treats a different downloadQuality as a different key" both pass |
| 5 | Closing the sheet mid-probe aborts the in-flight resolve/HEAD and never writes a stale label | ✓ VERIFIED | Both `TrackMenu.svelte` and `DownloadControl.svelte` effects create an `AbortController`, thread `ac.signal` into `probeDownload`, and return `() => ac.abort()` as the effect cleanup; the `.then()` callback checks `!ac.signal.aborted` before writing state. `download-probe.ts` also checks `signal?.aborted` post-ladder and skips both the state write path (via caller check) and the memo write (line 224-228) |
| 6 | Tapping Download after a successful probe reuses the probed URL (no third resolve) when fresh and tier-satisfying | ✓ VERIFIED | `TrackMenu.startDownload()` and `DownloadControl.run()` both pick `probed.track` when `probed.track.uid === target.uid`; `download-track.ts`'s new `reuseInput` branch (lines 104-111) re-checks `hasFreshAudioUrl` + `currentQualityMeets` before reusing, else re-resolves. Unit-tested in `download-track.test.ts`: "does NOT re-resolve when the passed-in track is already fresh and meets the tier" and "still re-resolves when ... a lower tier" |
| 7 | A displayed container is never the `extFromAudioUrl` 'mp3' default | ✓ VERIFIED | `containerFromUrl` in `download-probe.ts` uses the identical regex as `extFromAudioUrl` but returns `null` on no match instead of defaulting to `'mp3'` (verified by reading both functions side by side). `containerFromContentType` rejects any non-`audio/*` MIME, specifically covering qq's `application/x-www-form-urlencoded`. Both unit-tested directly |

**Score:** 7/7 truths verified at the code level; 1 unverifiable_runtime item (live-CDN header behavior) flagged for human/orchestrator verification, not a code defect.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/services/download-probe.ts` | probeDownload + formatters, never-throws, memoised, abortable | ✓ VERIFIED | 235 lines (≥80 min); exports `probeDownload`, `formatBytes`, `formatDownloadMeta`, `containerFromUrl`, `containerFromContentType`, `__resetDownloadProbe` — all present |
| `src/lib/services/download-probe.test.ts` | Node tests: formatter, container derivation, ladder, memo, abort, never-throw | ✓ VERIFIED | 381 lines; all listed behaviors present as `describe` blocks; 42 tests, all pass |
| `src/lib/services/download-track.ts` | exported `currentQualityMeets` + `reuseInput` branch | ✓ VERIFIED | `export function currentQualityMeets` present (line 56); `reuseInput` branch present (lines 104-111) with `quick-260915-26g` comment |
| `src/lib/components/DownloadControl.svelte` | `probe` prop default false, abortable effect, `.dc-meta` label, probed-track handoff | ✓ VERIFIED | `probe = false` (line 44); `$effect` with `AbortController` (lines 80-96); `.dc-meta`/`.dc-meta.skel` CSS + markup (lines 150-155, 187-197); `run()` picks `probed?.track` when uid matches (line 117) |
| `src/lib/components/TrackMenu.svelte` | menu-open probe, `.count` label, skeleton, probed-track handoff | ✓ VERIFIED | `probeDownload` imported and called once inside the gated `$effect` (line 277); `.count`/`.count.skel` markup in Download row (lines 543-546) and header button title (line 469); `startDownload()` handoff (line 197) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `TrackMenu.svelte` | `download-probe.ts` | `$effect` on `open && track` → `probeDownload(target, ac.signal)` | ✓ WIRED | Confirmed at line 277; cleanup aborts at return |
| `DownloadControl.svelte` | `download-probe.ts` | `$effect` gated on `probe && uid` → `probeDownload`; renders `formatDownloadMeta` | ✓ WIRED | Confirmed at lines 80-97 |
| `download-probe.ts` | `catalog.ts` | `ensureTrackDetails(copy, signal, settings.downloadQuality)` | ✓ WIRED | Confirmed at lines 203-207, 3rd arg is `want` (settings.downloadQuality) |
| `download-probe.ts` | resolved audioUrl (CDN) | RAW `fetch` HEAD → Range GET (never `apiFetch`) | ✓ WIRED | Confirmed at lines 149, 163; `grep -c apiFetch` = 1 but only inside a comment, 0 actual calls/imports |
| `download-track.ts` | `track-ready.ts` | `hasFreshAudioUrl(track) && currentQualityMeets(...)` → reuse input track | ✓ WIRED | Confirmed at lines 104-105 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| download-probe + download-track unit suites | `pnpm vitest --run download-probe.test.ts download-track.test.ts` | 2 files, 63 tests passed | ✓ PASS |
| Full workspace test suite (regression check, run once) | `pnpm test` | 126 files, 2424 tests passed | ✓ PASS |
| Type check | `pnpm check` | 4527 files, 0 errors, 0 warnings | ✓ PASS |
| No list call site passes `probe` | `grep -n DownloadControl` on library/album/RowBadges | 5 call sites, none pass `probe` | ✓ PASS |
| No `apiFetch(` call in download-probe.ts | `grep -n apiFetch` | 1 hit, comment only, no call/import | ✓ PASS |
| No debt markers introduced | `grep -E "TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER"` on the 5 touched files | 0 hits | ✓ PASS |
| No `as any` in touched production files | `grep "as any"` on the 4 touched source files | 0 hits | ✓ PASS |
| Live CDN HEAD→Range ladder against real kuwo/qq hosts | (not run — no dev server started) | n/a | ? SKIP (declared gap, see human_verification) |

### Requirements Coverage

Single quick-task requirement `quick-260915-26g` — covered by the truths/artifacts table above; no REQUIREMENTS.md entry to cross-reference (quick task, not phase-tracked).

### Anti-Patterns Found

None. No debt markers, no `as any`, no placeholder/guessed-container logic in the 5 touched files.

### Threat-Model Contract Check (task-specified focus areas)

| Contract | Status | Evidence |
|----------|--------|----------|
| `probe` defaults FALSE, no list call site passes it | ✓ HELD | `DownloadControl.svelte:44`; all 5 call sites grepped prop-free |
| In-flight probe aborts on sheet close | ✓ HELD | `AbortController` + effect cleanup in both components |
| `probeDownload` never throws | ✓ HELD | try/catch around resolve and both fetches; 2 dedicated never-throw tests pass |
| `player.current` reads READ-ONLY (D-18) | ✓ HELD | Single read at `download-probe.ts:194`, spread into a copy (`{ ...cur }`), never assigned |
| Size probe uses raw `fetch`, never `apiFetch` | ✓ HELD | No `apiFetch(` call, no `$lib/services/api-base` import |
| No guessed container reaches UI | ✓ HELD | `containerFromUrl` returns null (not 'mp3') on no match; `containerFromContentType` rejects non-`audio/*` (covers qq's `x-www-form-urlencoded`) |
| Label describes the probed track handed to the download | ✓ HELD | Both `TrackMenu.startDownload` and `DownloadControl.run` hand `probed.track` to `downloadTrack` when uid matches; `download-track.ts`'s `reuseInput` re-validates freshness/tier before reuse |

### Human Verification Required

### 1. Live CDN header behavior for the size probe ladder

**Test:** Start a dev server, open the ⋮ menu on a real kuwo (or qq) search result, watch the Download row: skeleton → real `FORMAT · SIZE` label. Reopen the same menu (expect instant, no new network). Scroll the library page and check the network tab shows zero HEAD/resolve requests per row.

**Expected:** The `measure()` ladder (HEAD → `Range: bytes=0-0` → null) in `download-probe.ts` behaves as designed against real CDN response headers — `Content-Length` present on HEAD for at least some sources, `Content-Range` answered or hidden per CORS-safelisting as documented in the plan's threat model.

**Why human:** SUMMARY.md explicitly declares this leg was not run in the execution session (no dev server started). The ladder logic is only exercised against stubbed `fetch` responses in `download-probe.test.ts`. This is a known, declared gap — the orchestrator is checking it live in parallel per the verification task instructions, not re-investigated here.

## Gaps Summary

No code-level gaps. All 7 must-have truths, all 5 required artifacts, and all 5 key links are verified present, substantive, and wired, with unit-test coverage matching the plan's behavior spec and a clean full-suite regression run (2424/2424) plus a clean typecheck (0 errors). The single open item is a declared, not-yet-observed live-CDN behavior check, which routes to human/orchestrator verification rather than a code fix.

---

*Verified: 2026-09-15*
*Verifier: Claude (gsd-verifier)*
