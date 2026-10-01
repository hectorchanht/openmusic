---
phase: quick-260930-vjp
plan: 01
subsystem: downloads
tags: [album-download, concurrency, pipeline, rate-limit]
requires: [quick-260930-uia]
provides: ["DownloadOpts.stages gate contract", "two-stage album download (3 resolve, paced 3.5 s / 8 transfer)"]
affects: [src/lib/services/download-track.ts, src/lib/services/download-album.ts]
tech-stack:
  added: []
  patterns: ["acquire/release StageGate threaded through opts; FIFO semaphore with optional grant spacing"]
key-files:
  created: []
  modified:
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
    - src/lib/services/download-album.ts
    - src/lib/services/download-album.test.ts
decisions:
  - "Album resolve grants start RESOLVE_SPACING_MS=3500 apart (on top of RESOLVE_POOL=3): tang (qq detail host) rate-limits like a token bucket (burst ~7, ~1 call / 3 s) and the unpaced pipeline burst 11 calls in 4 s"
  - "Resolve slot is released before a transfer slot is requested (no hold-and-wait between the two gates)"
metrics:
  duration: ~60 min
  completed: 2026-09-30
  tasks: 3
  files: 4
---

# Quick 260930-vjp: Album download two-stage pipeline Summary

Album download is now a pipeline. Every song enters at once. Up to 3 can be resolving a link at a
time, and those resolves start at least 3.5 s apart. As soon as a song's link resolves, it moves
into an 8-wide transfer stage (body, tag, persist). The gates reach `downloadTrack` through a new
opt-in `stages` option. When `stages` is not passed, the function behaves exactly as before.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 | `stages` gate option on downloadTrack | `03551696` test (RED: 5 failing) → `945d679d` feat (68/68) |
| 2 | downloadAlbum two-stage pipeline | `e9e8d522` test (RED: 4 failing) → `e0d15fb2` feat (91/91) |
| 3 | Full suite + E2E; defect fix | `d2c4ea09` fix (resolve pacing + regression test, 92/92) |

- **download-track.ts.** Exports `type StageGate = () => Promise<() => void>` and adds `stages?: { resolve, transfer }`.
  - In `downloadOne`, the re-resolve `ensureTrackDetails` call runs inside a resolve slot, and that slot is released straight away.
  - `release = await stages.transfer()` runs right before `fetch(r.audioUrl)`.
  - The existing `finally` calls `release?.()` before `endDownload`.
  - The reuse and `audioFrom` branches never take the resolve gate, but they do take the transfer gate.
  - In the ytmusic donor path, `fetchVariants` and each `probeDownload` run inside `withGate(stages.resolve, …)`, which is released before `downloadOne` takes its transfer slot.
- **download-album.ts.** `POOL` is replaced by `RESOLVE_POOL=3`, `RESOLVE_SPACING_MS=3500` and `TRANSFER_POOL=8`.
  - A local `gate(n, spacingMs)` provides a FIFO semaphore whose release is idempotent and whose grants can be spaced out.
  - `tracks.map(one)` takes the place of the worker pool. Index order still claims `seenUids`, so the first occurrence of a song wins.
  - Untouched: held-single move/reuse, `slots[i]` assembly, zip build, counting progress by completions, and never-throw.

## Verification

- `pnpm test`: **171 files, 3867 tests passed.**
- `pnpm check`: **0 errors**, 12 warnings. The warnings are pre-existing unused CSS in the artist page.
- `pnpm test -- download-track.test.ts download-album.test.ts`: 92 passed, including the import-contract greps.
- I set `RESOLVE_SPACING_MS=0` temporarily to confirm the pacing test fails without pacing. It did fail, and I restored the value.
- `grep -c "stages?.resolve\|stages?.transfer" download-track.ts` = 4. `TRANSFER_POOL` appears in 2 non-comment lines. download-album.ts imports neither `fetchVariants` nor `probeDownload`.

### E2E (headless Chrome over CDP, dev server :5173, 400x860 mobile, script `<scratchpad>/vjp-e2e.mjs`)

Page: `/album/rice & shine?artist=陳奕迅`. In every run the tap on row 8 (可以了) happened once the
first `Downloading 1 of` toast appeared.

| Run | Code | Wall (vs 155.0 s) | Saved | Time-to-playing (row 8) | Why songs were lost |
|-----|------|-------------------|-------|-------------------------|---------------------|
| 1 | pipeline, unpaced | 142.1 s | 5/10 | 2.9 s | tang rate limit / netease truncation |
| 2 | pipeline, unpaced | 75.9 s | 3/10 | 5.8 s | 4 netease truncated, 3 qq tang-limited |
| 6 | pipeline, unpaced, 35 s pre-click wait | 115.3 s | 4/10 | 5.6 s | 6 resolved to netease, all truncated; 0 tang-limited |
| 7 | pipeline, unpaced, 35 s pre-click wait | **117.9 s** | 7/10 | 4.5 s | 11 tang calls in 4.3 s: the last 4 were limited, so songs 8-10 came back `no-audio` |
| baseline | old 3-worker pool (`f6a4c6de` album file), same conditions | **179.9 s** | **10/10** | 3.6 s | none. Tang calls were spaced 10.5…159.2 s, 0 limited |
| 8 | pipeline + 3.5 s pacing | 44.6 s | 1/10 | 3.2 s (qq resolved directly) | limiter hot from my probes: 8/10 tang calls limited, 4 netease truncated |
| 9 | pipeline + 3.5 s pacing, after a 5-min cooldown | 51.1 s | 0/10 | 2.8 s | limiter still hot: all 10 resolved to netease and all were truncated |

Runs 3-5 used variants I tried and dropped (pool=2; 1 s pacing). They hit the same tang tail.

- **Wall time.** On the same source mix and conditions, the unpaced pipeline took 117.9 s against the same-session baseline's 179.9 s (and the earlier 155.0 s run).
  - I could not get a clean 10/10 run of the paced build. The tang limiter stayed hot from my own probing, and the resolver sent songs to netease, whose downloads are truncated.
  - Pacing adds at most about 31.5 s before the 10th resolve starts. Bodies keep running 8-wide in parallel with that.
- **Playback during the download.** It started every time, in 2.8–7.2 s across 9 runs (baseline 3.6 s). No run failed the 30 s probe.
  - In the unpaced runs, the playback qq resolve was itself tang-limited and fell back to netease.
  - In the paced run 8 it resolved on qq directly in about 2 s.
- **Concurrency.** Max in-flight audio bodies (raw `Fetch` to CDN hosts plus `/api/netease/url`) peaked at 8, which is ≤ TRANSFER_POOL.
  - Max in-flight `/api/*` plus direct tang calls was 9-11.
  - This does not mean the governor leaked. `governedFetch` frees its slot when the response head arrives, while CDP counts a request until `loadingFinished`. Every peak set was the album page's search fan-out.
  - The `.dc.busy` histogram reaches 10 right from the start (a queued song counts as busy), as the plan expected.
- **Zip.** One `陳奕迅 - rice & shine.zip` per run, with entries in page-row order and no `(2)` names.
  - Baseline: 10 non-empty entries.
  - Run 7: 7 entries (songs 1-7, in order).
  - Run 6: 4 entries.
  - Runs 8 and 9 had at most 1 saved song. Run 9 saved nothing, so no zip was written.
- **ytmusic.** 0 `/api/ytmusic/stream` or `googlevideo` requests in every run.
- Headless Chrome was stopped after every run. The dev server was left running (I did not start it). Nothing was pushed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pipelined resolves tripped the qq detail host's rate limit**
- **Found during:** Task 3 E2E.
- **Issue:** Every song entered resolve at once, 3-wide. That fired about 11 direct tang calls in 4 s. Tang answers `请求过于频繁` once its burst of about 7 is used up. That body has no url, so songs 8-10 came back `no-audio`, and the user's own mid-download playback resolve was limited along with them. The old pool had stayed under the limit only because each ~50 s body spaced its worker's resolves out.
- **Measured:** 16 sequential calls about 1.8 s apart went through clean, the 17th was limited, and the limiter recovered about 23 s later. 3-parallel calls were limited after about 4. 2-parallel stayed clean for 12 cold calls but not inside the album. 1 s pacing was still limited at call 8.
- **Fix:** `gate(n, spacingMs)` spaces resolve grants `RESOLVE_SPACING_MS=3500` apart, which matches the measured refill rate. `RESOLVE_POOL` stays 3, so a slow resolve can still be bypassed. A new test checks the pacing on fake timers (grants at 0 / 3500 / 7000 / 10500 ms). The pipeline tests now run on fake timers.
- **Files:** download-album.ts, download-album.test.ts.
- **Commit:** `d2c4ea09`.
- **Not verified end-to-end:** after my probing, the limiter stayed hot even at 1 call per 3.5 s (runs 8 and 9). The fix is backed by the cold measurement and the unit test, not by a clean 10/10 run.

## Assumption Drift (advisory)

- **Found during:** Task 3.
- **Planned:** "RESOLVE_POOL=3 leaves headroom". The plan treated the apiFetch governor (8 slots) as the only resolve-side limit.
- **Actual:** the binding limit is tang's per-IP request rate, not concurrency. That is why the spacing was added.

## Deferred Issues

These are recorded in `deferred-items.md`. Neither was caused by this task.

1. **Netease audio downloads are truncated at 8 s.** This dates from ee8e2026 (2026-06-05). `/api/netease/url` streams the audio through the catch-all proxy, and that proxy's `AbortSignal.timeout(8000)` covers the whole body. A single `curl` reproduces it: 200 status, about 3-4.5 MB, ends at exactly 8.00 s. Any album song that resolves to netease fails to download. Playback is unaffected.
2. **qq adapter has no retry on the tang rate-limit body.** It affects playback and prefetch callers too. In prod the `/api/qq/detail` fallback hop leaves from the edge IP, which probably absorbs most of it. That is unverified.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/services/download-track.ts, src/lib/services/download-album.ts, both test files, deferred-items.md, `<scratchpad>/vjp-e2e.mjs`.
- FOUND commits: 03551696, 945d679d, e9e8d522, e0d15fb2, d2c4ea09.
