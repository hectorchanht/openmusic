---
phase: quick-260629-nyl
plan: 01
subsystem: player / now-playing / source-adapters
tags: [cover-art, playback-resilience, lyrics, netease, qq, catalog]
requires:
  - lazyCover / resolveCoverForTrack shared cover chain (Phase 21)
  - player.svelte.ts prefetchNext / scheduleRetryResolve / ensureAhead (quick-260627-huo)
  - catalog ensureTrackDetails + searchAll + matchKey/scoreMatch
provides:
  - Up-Next list + carousel neighbor cover resolution via the shared chain
  - prefetchNext timeout-retry re-arm + walk-exhaustion eager ensureAhead
  - shape-tolerant netease/qq lyric extraction + bounded cross-source lyric fallback
affects:
  - src/lib/components/NowPlaying.svelte
  - src/lib/stores/player.svelte.ts
  - src/lib/sources/netease.ts
  - src/lib/sources/qq.ts
  - src/lib/services/catalog.ts
tech-stack:
  added: []
  patterns:
    - use:lazyCover background-image row idiom (search/library/artist/album parity)
    - content-type-independent body parse (read text -> try JSON -> fall back to text)
    - bounded best-effort cross-source backfill reusing TTL-cached searchAll + matchKey/scoreMatch
key-files:
  created: []
  modified:
    - src/lib/components/NowPlaying.svelte
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/sources/netease.ts
    - src/lib/sources/netease.test.ts
    - src/lib/sources/qq.ts
    - src/lib/sources/qq.test.ts
    - src/lib/services/catalog.ts
    - src/lib/services/catalog.test.ts
decisions:
  - "Cross-source lyric fallback placed in catalog.ensureTrackDetails (NOT player.fillLyricsOffline) — it is the ONE seam every caller funnels through, so the fix is universal; the netease/qq extractor fix makes a genuine miss rare so the added latency only applies to the uncommon no-lrc case."
  - "netease resolve() made content-type-independent rather than trusting the (intermittent/proxy-defaulted) Content-Type header — the actual root cause of the No-lyrics regression."
  - "kuwo.ts left untouched — live diagnosis showed no kuwo lyric regression (its d.lyric field is intact); the plan made the kuwo edit conditional on a diagnosed regression."
metrics:
  duration: ~30 min
  completed: 2026-06-29
  tasks_completed: 3 (of 4; Task 4 is a blocking human-verify checkpoint)
---

# Phase quick-260629-nyl Plan 01: Fix song cover art (Up-Next/carousel), up-next never-stop, and the No-lyrics regression — Summary

Wired the existing shared cover chain into the two surfaces that never resolved (Up-Next rows + carousel neighbors), extended `prefetchNext` so transient probe timeouts re-resolve and an exhausted walk eagerly grows the queue, and fixed the broad "No lyrics" regression at its root (a content-type-fragile netease lyric parser) plus a bounded cross-source lyric fallback.

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Resolve covers on Up-Next list + carousel neighbors | `2140519` | src/lib/components/NowPlaying.svelte |
| 2 | Up-next never-stop — retry probe timeouts + eager queue extend | `822dd99` | src/lib/stores/player.svelte.ts, player.svelte.test.ts |
| 3 | Fix No-lyrics regression — shape-tolerant extractor + cross-source fallback | `06ef89e` | netease.ts/.test, qq.ts/.test, catalog.ts/.test |

## What Changed

### Task 1 — Covers on Up-Next + carousel neighbors
- Imported `use:lazyCover` into `NowPlaying.svelte`, added a reactive `resolvedCovers` uid→url map + `onCoverResolved`, mirroring the established search/library/artist/album row idiom exactly (https-only `background-image`, never-throw → gradient).
- Up-Next rows: added a `.q-art` thumbnail + a `.q-text` min-width:0 column so the title/artist still stack/ellipsis; `.q-row` switched to row-direction layout (the generic `.row` / related skeleton untouched).
- Carousel: `cellBg` reads the resolved map first; `use:lazyCover` attached to the prev/next neighbor cells (only when non-null). The CURRENT cell is untouched (keeps `player.resolvedCover` + the Last.fm swap).

### Task 2 — Up-next never-stop (player.svelte.ts prefetchNext)
- **2a:** the probe-TIMEOUT branch (`!probe.ok && !probe.errored`) now arms the existing `scheduleRetryResolve(cand.uid)` instead of a bare `continue` — a transient "playable later on click" Next-up song is re-resolved after a bounded, backed-off delay; still never added to `unplayableUids` (no ✗ row). The hard-error path (`handleDefinitiveFailure`) is unchanged.
- **2b:** a `landed` flag is set on a probe-verified hit; after the loop, if nothing landed and the seedUid/abort stale-guard still holds, `void this.ensureAhead()` grows the queue so `next()`/track-end always has somewhere to advance. ensureAhead is idempotent (single growPromise), queueGen-guarded, and only grows on a short tail.
- No new unbounded loop, no playGen bump, no `playing`-event dependency (iOS-freeze memory honored).

### Task 3 — No-lyrics regression
- **Diagnosis (live upstreams):** `netease /lrc` now returns **plain LRC text** with an intermittent/**absent** Content-Type. Our `/api/[source]` proxy defaults an absent upstream content-type to `application/json`, so the old header-sniff called `lr.json()` on plain text → threw → the catch swallowed it → a true lyric HIT surfaced as "No lyrics for this track". QQ `detail` still carries `song_lyric` (timestamped) + `lyric` (plain) for popular tracks (no QQ shape break observed); kuwo `d.lyric` intact.
- **netease.ts:** `resolve()` is now **content-type-independent** — read the body as text once, try a JSON parse (→ `extractLrcFromJson`), else treat the text as the LRC. Exported + widened `extractLrcFromJson` (nested `data.lyric.lyric`, `{lyric:{lyric}}`/`{lrc:{lrc}}`, and `lines[]`/`lrclist[]` arrays joined back to LRC text) without dropping any existing key; added exported `extractLrcFromBody`. Never-throw, null only on a true miss.
- **qq.ts:** widened the `song_lyric || lyric` read via a defensive `pickQqLyric` helper that also tolerates a nested `{lyric}`/`{lrc}` object, keeping the string path primary.
- **catalog.ts `ensureTrackDetails`:** bounded, never-throw cross-source lyric fallback — when a lyric-capable source resolves playable but lyric-less, ONE `searchAll` + `matchKey`/`scoreMatch` lookup copies a matched *different*-source `lrc` across (primary `audioUrl`/quality untouched). Skips `jamendo`/`audius`/`fivesing`; AbortSignal-threaded; at most one fallback candidate resolved.

## Deviations from Plan

### Auto-fixed / scope adjustments

**1. [Rule 3 - Blocking] Live diagnosis done via direct upstream curl, not the dev server.**
- **Found during:** Task 3 STEP 1.
- **Issue:** The execution constraints forbid starting the long-running dev server (that is the human verification step), and the auto-mode sandbox blocked `npm run dev`.
- **Fix:** Probed the SAME upstreams the proxy routes forward to (`api.qijieya.cn/meting`, `tang.api.s01s.cn`) directly with `curl`, reading the exact upstream URLs from `src/lib/proxy/{netease,qq}.ts`. This produced the authoritative shape/content-type diagnosis without the server.
- **Files modified:** none (diagnosis only).

**2. [Plan-sanctioned choice] kuwo.ts left untouched.**
- The plan made the kuwo edit conditional on a diagnosed regression; none was found, so kuwo was not modified.

**3. [Test isolation] Stubbed empty searches in two pre-existing `ensureTrackDetails` tests.**
- The new cross-source fallback fires when a lyric-capable track resolves with no `lrc`. Two existing dispatch/quality tests resolve exactly that shape, so they now arm a `searchAll`. Added a `stubEmptySearches()` helper in those tests so the fallback finds no candidate instantly (no real network), preserving their original PRIMARY-resolve intent. No existing expectation was weakened.

## Lyric shape: OLD vs NEW (auditable)

| Source | Endpoint | OLD shape (what the extractor read) | NEW shape (live 2026-06-29) | Fix |
| --- | --- | --- | --- | --- |
| netease | `/api/netease/lrc?id=` | json-wrapped `{lrc}`/`{lyric}`/`{data:...}`, sniffed by Content-Type | **plain LRC text**, Content-Type `text/plain;…` OR **absent** (proxy defaults absent → `application/json`) | content-type-independent body parse; widened extractor |
| qq | `/api/qq/detail?…&mid=` | `song_lyric` (LRC) ‖ `lyric` (plain) string | still present for popular tracks; widened to tolerate a future nested `{lyric}`/`{lrc}` object | defensive `pickQqLyric` |
| kuwo | `/api/kuwo/detail` | `d.lyric` string | intact (no regression) | untouched |

## Verification

- `npx vitest run src/lib/stores/player.svelte.test.ts src/lib/services/cover-backfill.test.ts src/lib/services/itunes-cover.test.ts src/lib/actions/lazyCover.test.ts src/lib/sources/netease.test.ts src/lib/sources/qq.test.ts src/lib/sources/kuwo.test.ts src/lib/services/catalog.test.ts` → **248 passed (8 files)**.
- Per-commit: Task 1 → 54 cover tests green; Task 2 → 136 player tests green (+2 new); Task 3 → 58 source/catalog tests green (+new shape + fallback tests).
- `npm run check` (svelte-check) → **0 errors / 0 warnings**.

## Known Stubs

None — no hardcoded empty values, placeholders, or unwired data sources were introduced. Covers resolve through the live shared chain; lyric fallback resolves a real cross-source candidate.

## Invariants preserved

playGen/queueGen/uid generation guards · FAILURE_CAP / loop-guard / strike machinery · skip-burst toast batching · no-premature-skip-of-an-already-started-track · iOS background audio (no `playing`-event dependency) · DATA-03 per-source isolation. No new npm dep, env var, `/api` route, or parallel cover/resolve/lyric system.

## Remaining — Task 4 (BLOCKING human-verify checkpoint)

Task 4 (`autonomous: false`, `gate="blocking"`) is a human verification step and was NOT self-approved. See the checkpoint section returned to the orchestrator.

## Self-Check: PASSED

- All modified source files present (NowPlaying.svelte, player.svelte.ts, netease.ts, qq.ts, catalog.ts).
- All three task commits present in git log: `2140519`, `822dd99`, `06ef89e`.
- SUMMARY.md present at the plan path.
