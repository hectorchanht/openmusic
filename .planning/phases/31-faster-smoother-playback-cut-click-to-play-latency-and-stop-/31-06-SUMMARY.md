---
phase: 31-faster-smoother-playback-cut-click-to-play-latency-and-stop
plan: 06
status: complete
completed: 2026-08-09
autonomous_run: true
---

# Phase 31 · Plan 06 — Phase Gate & Verification Record

Executed unattended (the user was asleep and authorised auto-continue). Everything below was
**run and observed**, not inferred. Rows that could not be executed are marked NOT TESTED with a
reason — never as passed.

---

## Task 1 — Automated phase gate

| # | Command | Observed |
|---|---------|----------|
| 1 | `pnpm test` | **95 files / 1731 passed** (pre-phase base: 90 / 1629) |
| 2 | `pnpm check` | **4380 files, 0 errors, 0 warnings** |
| 3a | `npx vitest --run src/lib/stores/player.svelte.test.ts -t "SYSTEMIC"` | **2 passed**, 224 skipped |
| 3b | `npx vitest --run src/lib/stores/player.svelte.test.ts` | **226 passed** |
| 3c | `npx vitest --run src/lib/services/api-base.test.ts` | **12 passed** |

> Final counts after the two defect fixes below: `pnpm test` **1734 passed**, `pnpm check` 0/0.

### Two defects in this plan's own gate, corrected

1. **`-t "systemic"` (lowercase) matches NOTHING.** vitest's `-t` is case-sensitive and the suite is
   `SYSTEMIC STOP …`. The lowercase form reports "218 skipped" — which reads green while asserting
   **nothing**. Found by the 31-02 executor. `31-VALIDATION.md` corrected in `0e64a67`; the uppercase
   form is used throughout above and genuinely matches 2 tests.
2. **`git diff --stat main -- …` is vacuous** — `branching_strategy: none`, so the phase ran *on*
   `main` and that diff compares main to itself. Audited against the pre-phase commit `ed73ea5` instead.

### Forbidden-change audit (vs pre-phase base `ed73ea5`)

| Check | Expected | Observed |
|---|---|---|
| `git diff --stat ed73ea5 -- wrangler.jsonc package.json pnpm-lock.yaml` | empty | **empty** — no binding, no secret, no package |
| `git diff --stat ed73ea5 -- src/lib/services/api-base.ts` | empty | **empty** — no second throttle, governor untouched |
| `git diff --stat ed73ea5 -- src/lib/services/api-base.test.ts` | empty | **empty** |
| Raw `fetch(` in `resolve-cache-client.ts` / `prewarm.ts` | none | **none** — all traffic via `apiFetch` |

### Locked constants

| Constant | Before | After |
|---|---|---|
| `STRIKE_CAP` | 2 | **3** ← the only intended change (D-16) |
| `FAILURE_CAP` | 5 | 5 |
| `SYSTEMIC_SKIP_CAP` | 5 | 5 |
| `RAPID_ERROR_CAP` | 3 | 3 |
| `RESOLVE_WATCHDOG_MS` | 6000 | 6000 (D-01 — deliberately untouched) |
| `PREFETCH_MAX_CANDIDATES` | 4 | 4 |
| `SRC_REDRIVE_CAP` | 4 | 4 |
| `RETRY_RESOLVE_MAX` | 2 | 2 |

**Test-suite deletions accounted for.** `git diff ed73ea5 -- player.svelte.test.ts` shows 26 deleted
lines. All 26 inspected: hardcoded `2` / `badCalls <= 2` literals and hand-unrolled `await prefetch()`
pairs replaced by loops bounded by the new mirrored `Player_STRIKE_CAP`. **All inside the strike and
delayed-re-resolve suites; none in any D-17 regression suite.** The 31-02 executor additionally
extracted all three regression suites from `HEAD~3` and `HEAD` and diffed them as text — byte-identical.

---

## Task 2A — Real Cloudflare Cache API cycle (workerd / Miniflare)

`pnpm build` → `pnpm preview` (wrangler **4.98.0**, Miniflare, port 4173). Not `vite dev` — `edgeCache()`
is `null` there by design and every cache path is inert.

### 🔴 FINDING — a production-breaking defect, found here and fixed

The first run of the five-step cycle **failed at step 4**:

```
1) cold GET                   -> {"hit":false}
2) warm GET (+8s)             -> {"hit":true,"entry":{...kuwo url...}}
3) POST bust                  -> {"busted":true}
4) GET immediately after bust -> {"hit":true,...}   <-- WRONG
5) GET +2s                    -> {"hit":true,...}   <-- WRONG
6) GET +10s                   -> {"hit":true,...}   <-- WRONG
```

**Root cause — NOT the bust.** The GET hit response carried `Cache-Control: public, max-age=900`, so
workerd stored the whole `/api/resolve?a=…&t=…` HTTP response in the automatic response cache. Response
headers on the survivor showed **`CF-Cache-Status: HIT`**. Discriminating evidence that the entry itself
*was* correctly deleted:

- same query + a random cache-busting param (different URL ⇒ different auto-cache key) → `{"hit":false}`
- same URL with request header `Cache-Control: no-cache` → `{"hit":false}`

A minimal isolated worker independently confirmed Miniflare's Cache API is fine:
`put` → `match=V` → `delete returned true` → `match=MISS`. So `resolveCacheKey` / `bustResolveEntry`
were correct all along and were left untouched.

**Why it mattered:** D-11 states the bust-on-failure path is the LOAD-BEARING primary path, because a
globally-shared audio URL can be IP/region-bound and 403 for another user. As originally shipped, a
client reported a dead URL, the entry was correctly dropped, and **the very next play was still handed
the same dead URL from the response cache for up to 15 minutes.** The self-healing property D-08/D-09
promise did not exist.

**Fix** (`dd1ccb0`): `jsonResult` no longer accepts a TTL and unconditionally emits `Cache-Control:
no-store`. The entry TTL still lives on the *stored* response in `writeResolveEntry`, which is its
correct home — the outer response is a *view* of a mutable entry and must always be re-derived. A
comment records why this route differs from `/api/og` and `api/deezer/search`, whose responses ARE
the artifact.

**Why unit tests missed it:** the pre-existing assertion was
`expect(res.headers.get('Cache-Control')).toBe('public, max-age=900')` — the suite had encoded the
defect as correct behaviour. Replaced with a regression block asserting the response is never storable.

### Re-verified after the fix (independent run, fresh term)

| Step | Observed |
|---|---|
| A1 cold GET | `{"hit":false}` · header `Cache-Control: no-store` · no `CF-Cache-Status` emitted |
| A2 warm GET (+9s) | `{"hit":true,"entry":{"source":"kuwo","songid":"3238144","url":"…7d5f78f9…","avail":{"kuwo":"ok"}}}` |
| A3 POST bust | `{"busted":true}` |
| A4 GET immediately after | **`{"hit":false}`** ✅ |
| A5 GET +9s | `{"hit":true,…"url":"…9b34957e…"}` — **a DIFFERENT signed URL**, i.e. a genuine fresh fill, not a resurrected entry ✅ |

**Latency proof of the cache itself:** first (miss) GET `time_total` **0.554s**; the identical warm GET
**0.0064s** — **~86× faster**, and the miss returned immediately without waiting for the edge-side fill,
exactly as D-08 requires.

### Security — verified, not assumed

| Attempt | Result |
|---|---|
| POST with `"url":"https://evil.example/pwn.mp3"` and a nested `entry.url` | `busted` only; **0 occurrences of `evil.example`** in the subsequent entry |
| Structural | The route has no `cache.put` in POST and never reads a payload field — a client can only express "drop this artist+title" |

No cache-poisoning path. Confirmed twice, on two different terms.

---

## Task 2B — Measured click-to-play latency

Spike-003 method: `window.fetch` wrapped, `window.__net` reset at the click boundary, plus `<audio>`
event marks. Run against the **workerd production build** on :4173, mobile viewport (375×812).

| Case | click → `loadstart` (src attached) | Calls before audio | Notes |
|---|---|---|---|
| **A — pre-warmed top result** (Fleetwood Mac · Dreams) | **23 ms** | 2 (`/api/resolve` @10ms, `kuwo/detail` @21ms) | click → `playing` 6348 ms, dominated by FLAC byte delivery from the CN CDN |
| **B — cold track** (Radiohead · Fake Plastic Trees) | **1658 ms** | 1 (`/api/resolve` @16ms, then the full resolver walk) | click → `playing` 9658 ms |

**≈72× faster to src attach when pre-warmed (1658 ms → 23 ms).** That is the phase's core claim, measured.

Honest caveats on these numbers:
- `playing` is dominated by **CDN byte delivery**, which this phase does not target and cannot fix. The
  metric this phase moves is *time to a working src*, and that is what the table reports.
- n=1 per case, one machine, one network, from a location where CN CDNs are slow. Directionally strong,
  not a benchmark.
- Case A logged a `stalled` at 3262 ms followed by an automatic re-resolve, and still reached `playing`
  and ran to `currentTime` 12.21 s (`readyState` 4). Never-stop held.

### Never-stop observed live under a real upstream failure

Case B's Activity-log trace: `ytmusic:6gDhsUWCHrg` resolved and produced audio, then errored mid-play
(`hasPlayed:true`), took one re-resolve, transitioned to `qq:000ybVWz3FP6fu` and continued playing
(final src `isure6.stream.qqmusic.qq.com`, `currentTime` 10.73 s). Audio never stopped.

**Precision:** this is the *mid-play* failure path, **not** the next-song-prefetch path D-15 targets, so
it is **not** a live D-15 observation. D-15 remains covered by unit tests only.

### 🟡 FINDING — pre-warm fires more often than intended

D-03 intends one pre-warm for the top search result. Observed **5 `/api/resolve` calls** on the
Fleetwood Mac search and **2** on the Radiohead search. Cause: the search page renders progressively and
re-ranks, so `results[0]` changes several times and the `$effect` fires per *distinct* top result, not
once per search.

Impact is bounded but real: each extra pre-warm is one own-origin round-trip for the client, and each
*miss* also schedules an edge-side kuwo fill (~2 upstream subrequests) for a track the user may never
play. D-05 accepted "1–2 extra calls"; 5 exceeds that. **Not fixed** — it is a tuning question, not a
correctness bug, and it should be a deliberate decision rather than an unattended one. Suggested fix:
debounce the effect until results settle, or gate on the search generation rather than on `results[0]`.

---

## Task 2C / 2D — NOT TESTED

| Row | Status | Reason |
|---|---|---|
| Device: background playback, lock screen, autoplay policy (D-12/15/16) | **NOT TESTED** | No physical device available in this session. Project history is explicit that these are device-only reproducible. |
| Live corrupt-download self-repair via DevTools IndexedDB (D-12/D-14) | **NOT TESTED** | Requires completing a real download first; the run was unattended and the download path can surface a file-save dialog. Fully covered by 31-01's unit tests (corrupt blob → evict + stream + one toast; prebuffer blob does NOT evict a download record). |
| Whether a shared URL genuinely 403s for a user in another region (D-11's premise) | **NOT TESTED** | Needs two clients in different regions. The *handling* is unit-tested and the bust cycle is now verified end-to-end on workerd. |
| Whether the raised `STRIKE_CAP` feels better on a flaky connection | **NOT TESTED** | Subjective + network-dependent. |

---

## Decision → evidence

| D | Evidence |
|---|---|
| D-01 | `RESOLVE_WATCHDOG_MS = 6000` unchanged (grep) |
| D-02 | No hedged/parallel racing added; cold path is one resolve walk (Case B trace) |
| D-03 | Two triggers live; `/api/resolve` observed firing on results render and menu open. **Over-fires — see finding.** |
| D-04 | Optimistic swap untouched; no gating on `playing` |
| D-05 | Extra calls accepted; measured 1–2 on the play path itself |
| D-06 | Entry carries `source` + `songid` + `url` + `avail` in one versioned entry (A2 output) |
| D-07 | `caches.default` only; config/deps diff empty vs `ed73ea5` |
| D-08 | Miss returns immediately (0.554 s) without awaiting the fill; client falls through — 1734 unit tests |
| D-09 | **Broken, found here, fixed (`dd1ccb0`), re-verified A3→A4→A5** |
| D-10 | Entry shared globally, text-keyed, no per-user scoping |
| D-11 | Bust→refill cycle verified end-to-end with a fresh signed URL; live 403 trigger NOT TESTED |
| D-12 | Unit-tested (31-01); live DevTools test NOT TESTED |
| D-13 | Size gate in both `blobStore.get` read paths incl. `nativeGet` |
| D-14 | One toast + one `logAction` per corruption event (unit) |
| D-15 | Unit-tested; the live failure observed was the mid-play path, not D-15's |
| D-16 | `STRIKE_CAP` 2→3 + eager clearing; mirrored test constant added |
| D-17 | All three regression suites byte-identical and passing; all other guards unchanged |
| D-18 | Silent skip paths wired to the existing `emitSkipNotice`, batched |
| D-19 | Lookahead unchanged at next-1 (`PREFETCH_MAX_CANDIDATES` = 4 untouched) |

---

## Two regressions this phase introduced and repaired before shipping

1. **`4c30a3f`** — a cache-hit play started with an **empty lyrics pane**. The cached entry carries no
   `lrc` and `detailsLoaded: true` made the readiness guard treat the track as complete forever, so a
   warm play was visibly worse than a cold one. Fixed by reusing the offline-blob backfill mechanism
   behind an `lrcUnresolved` marker, plus a cache bypass on re-resolve. Side effect: this **also**
   repaired the offline-blob/restore backfill, which 31-04 had silently broken the same way.
2. **`dd1ccb0`** — the response-cache defect above.

Both were caught only because the manual gate was actually executed. Neither was visible to the
unit suite; in case 2 the suite actively asserted the defect was correct.

---

## Verdict

Automated gate **green**. Real workerd cache hit → bust → refill cycle **observed**. Latency **measured**
(~72× faster to src attach when pre-warmed). Two phase-introduced regressions found and fixed. No locked
constant, guard, binding or package drifted.

**Outstanding, for a human:** the device rows (2C), the live corrupt-download walkthrough (2D), and the
decision on the pre-warm over-fire finding.
