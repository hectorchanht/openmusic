---
phase: quick-260930-x3q
plan: 01
subsystem: downloads
tags: [download, album, qq, rate-limit, proxy, ytmusic]
requires: [quick-260930-vjp, quick-260930-uia]
provides:
  - fetchWithHeadDeadline (media head-only deadline)
  - QqRateLimitedError / isQqRateLimited
  - "'rate-limited' DownloadResult"
  - donorProbes / downloadFromDonor / probeForDownload
affects: [album Download all, TrackMenu Download label, DownloadControl label, /api/[source] passthrough]
tech-stack:
  added: []
  patterns: [async generator donor walk shared by download + label, content-type-driven deadline]
key-files:
  created:
    - .planning/quick/260930-x3q-download-reliability-adaptive-qq-rate-li/deferred-items.md
  modified:
    - src/lib/proxy/http.ts
    - src/lib/proxy/http.test.ts
    - src/routes/api/[source]/[...path]/+server.ts
    - src/lib/sources/qq.ts
    - src/lib/sources/qq.test.ts
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
    - src/lib/services/download-album.ts
    - src/lib/services/download-album.test.ts
    - src/lib/components/TrackMenu.svelte
    - src/lib/components/DownloadControl.svelte
decisions:
  - "The proxy deadline covers only the headers for a media content-type (audio/video/octet-stream). JSON bodies keep the 8 s whole-response bound. Media is detected by response content-type, not by path."
  - "The qq adapter adds no sleep-and-retry and no health gate for 请求过于频繁. Playback's runFallback stays unchanged. The limit is per-IP and comes in bursts; it is not an outage."
  - "Album: a rate-limited or no-audio song gets one donor pass at the download tier, excluding its own source. Only a song that is still rate-limited then backs off 3/6/12 s and retries. A no-audio song is never retried."
  - "The ytmusic Download label comes from the same donorProbes walk downloadTrack uses (probeForDownload)."
metrics:
  duration: ~15 min
  completed: 2026-10-01
---

# Quick 260930-x3q: download reliability (head-only media deadline, adaptive qq rate limit, donor label) Summary

The media passthrough deadline now covers headers only, so netease bodies stream whole. Tang's `请求过于频繁` reply now surfaces as a typed `QqRateLimitedError`. When a song hits it, the album download tries an equal-tier donor first and then backs off, which replaces the fixed 3.5 s resolve spacing. For a ytmusic song, the Download label now describes the donor file the tap will actually save.

## Tasks

| Task | Name | Commits |
|------|------|---------|
| A | Media passthrough deadline covers headers only | `56084443` test (RED), `16dc6f66` fix |
| B | qq rate-limited outcome + adaptive album pipeline | `2154a6a2` test (RED), `73eae0bb` feat (qq), `d77111a1` feat (download-track + album) |
| C | ytmusic Download label from the donor + gates + E2E | `5e021053` test (RED), `e348a180` feat |

## Verification (observed)

- `pnpm test`: **171 files, 3890 tests passed**.
- `pnpm check`: **0 errors**, 12 warnings. All 12 are the known unused-CSS warnings.
- Task A verify: `http.test.ts` + `proxy.test.ts` 27/27 passed. The route contains `fetchWithHeadDeadline(upstream` and no longer contains `AbortSignal.timeout(8000)`.
- Task B verify: qq + download-track + album tests 128/128 passed. `RESOLVE_SPACING_MS` is gone. `downloadFromDonor(` appears once in album code (outside comments). `请求过于频繁` is matched in qq.ts code.
- Task C verify: both components call `probeForDownload(target` once, and neither contains `probeDownload(target`.
- Every RED commit failed before its implementation, with one exception. The qq case "a limited direct hop still takes the proxy hop" passed in RED because the old code already took the proxy hop on a null. It is kept as a regression guard.

### Task A curl (dev server :5173, netease id 65800 最佳损友)

| Request | HTTP | size_download | time_total | curl exit |
|---------|------|---------------|------------|-----------|
| `/api/netease/url?id=65800` (through proxy) | 200 `audio/mpeg` | **9,344,566** | **15.42 s** | 0 (no error 18) |
| upstream `api.qijieya.cn/meting/?…type=url&id=65800` direct | 200 | 9,344,566 | 14.76 s | 0 |

The whole file arrived, byte-identical in size to upstream, and well past 8 s. Before this fix, runs were cut at about 3-4.5 MB at exactly 8.00 s.

### Album E2E: `/album/rice & shine` (陳奕迅), headless Chrome over CDP, 400x860, one attempt

Last tang traffic before the run was the vjp E2E at about 23:38 local. The run started at 00:09, so the cooldown was about 30 min (the plan asked for at least 5). This was one attempt, not re-run. The script is `<scratchpad>/x3q-e2e.mjs` and the log is `<scratchpad>/x3q-e2e.log`.

| Metric | x3q (this build) | vjp baseline (old 3-worker pool) |
|--------|------------------|----------------------------------|
| Wall, tap → `Saved N of 10` | **196.9 s** | 179.9 s |
| Saved | **10/10** (toast `Saved 10 of 10`, one `陳奕迅 - rice & shine.zip`) | 10/10 |
| tang / `/api/qq/detail` responses containing `请求过于频繁` | **6 of 13** (3 songs × direct + proxy hop) | 0 |
| Backoff retries used | 0 | n/a |
| ytmusic / googlevideo requests | 0 | 0 |

Per-song audio source. Attribution comes from `download.tag` raw bytes matched to body size. The netease encoded length is about 5.4 KB of headers larger than the raw blob.

| # | Song | qq mid | tang detail | Saved audio from | Path |
|---|------|--------|-------------|------------------|------|
| 1 | 娛樂天空 | 000jDQWP4JiB3y | ok @15.7 s | qq `isure6.stream.qqmusic.qq.com` (8,796,528 B) | direct resolve |
| 2 | 四季圈 | 000YQFzr03pFXX | ok @15.7 s | qq (7,702,988 B) | direct resolve |
| 3 | 愚人快樂 | 000oU5vE16lruA | ok @15.7 s | qq (6,117,555 B) | direct resolve |
| 4 | 不如承諾來的簡單 | 003jSzMh0nLyiB | ok @18.2 s | qq (7,568,996 B) | direct resolve |
| 5 | 對面 | 0044bIrr3cRi4D | ok @18.2 s | qq (7,017,036 B) | direct resolve |
| 6 | 放棄治療 | 003tD0Rx1mU142 | ok @18.4 s | qq (6,183,671 B) | direct resolve |
| 7 | 時光隧道 | 00088D7e1xAUJH | ok @19.4 s | qq (6,241,431 B) | direct resolve |
| 8 | 可以了 | 004ec8yZ02bRYx | **LIMITED** direct + proxy @20.1 s | netease `/api/netease/url?id=28563317` (10,427,288 B mp3) | **donor pass** |
| 9 | 陰天快樂 | 002KvLx4425LV7 | **LIMITED** direct + proxy @19.4 s | netease `id=28481818` (11,686,969 B mp3) | **donor pass** |
| 10 | 你給我聽好 | 00169sFo3JQRLo | **LIMITED** direct + proxy @20.6 s | netease `id=28481103` (11,543,828 B mp3) | **donor pass** |

Reading the numbers:
- Resolves ran at full speed. 10 tang detail calls fired in 4.9 s (15.7 → 20.6 s). The limiter cut in after 7, matching the measured burst of about 7.
  - vjp run 7 lost exactly these 3 songs as `no-audio`. Here the donor pass saved all 3 from netease, and those netease bodies now stream whole (60.8-85.8 s each).
- Wall time was bound by transfer, not resolve. All 10 links were resolved about 34 s in.
  - The 7 qq CDN bodies took 101-142 s each, about 50-85 KB/s per stream with 8 in parallel in this environment.
  - Two netease donor bodies could only start at about 121 s, when transfer slots freed up (TRANSFER_POOL=8).
  - So the 196.9 s against the baseline's 179.9 s reflects CDN throughput that day, not resolve pacing. The old pool's baseline had no limited songs and no slower donor bodies.
- Max in-flight `/api/*` + tang was 10, which is the search fan-out, consistent with the vjp note. Max in-flight audio bodies was 11 by CDP count. That count includes 3 aborted 8 s HEAD probes of `/api/netease/url` that overlapped the transfers (see Deferred Issues). Actual transfer bodies stayed at 8 or fewer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed the now-unused `probeDownload` import from DownloadControl.svelte**
- **Found during:** Task C
- **Issue:** After the swap, the import was dead.
- **Fix:** Dropped it from the import line. `formatDownloadMeta` and `DownloadProbe` are kept.
- **Commit:** `e348a180`

**2. [Rule 2 - Robustness] The rate-limit marker also matches the JSON `\u` escaped form**
- **Found during:** Task B
- **Issue:** The plan matches the raw text substring. The shape of the limited reply is not pinned down, and a JSON body with escaped non-ASCII would slip past a literal substring match.
- **Fix:** One extra regex, `RATE_LIMIT_MARK_ESCAPED`, beside the literal match. In the live E2E, tang sent the literal `请求过于频繁`.
- **Commit:** `73eae0bb`

Otherwise the plan was executed as written. The album donor call passes `exclude: [tr.source]`, as in the plan's action text. That is `['qq']` for these songs, matching the behaviour spec.

## Deferred Issues

See `deferred-items.md`. A HEAD probe of `/api/netease/url` runs into the 8 s `PROBE_TIMEOUT_MS`, probably because SvelteKit runs GET for HEAD and pulls the full upstream body. This is pre-existing and costs about 8 s per netease donor probe.

## Known Stubs

None. `probeForDownload`'s all-null probe is the intended "no donor → plain Download" sentinel.

## Self-Check: PASSED

- All 11 modified source/test files exist and are committed (`git status` shows no tracked changes).
- Commits `56084443`, `16dc6f66`, `2154a6a2`, `73eae0bb`, `d77111a1`, `5e021053`, `e348a180` are in `git log`.
- Headless Chrome was stopped (`pgrep` on port 9353 is empty). The dev server on :5173 was left running; I did not start it. Nothing was pushed.
