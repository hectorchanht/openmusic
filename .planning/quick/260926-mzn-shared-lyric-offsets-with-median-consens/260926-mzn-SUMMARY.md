---
phase: quick-260926-mzn
plan: 01
status: complete
subsystem: lyrics
tags: [lyrics, lrc, offset, r2, edge, consensus, i18n]
requires:
  - quick-260926-mis (per-uid local lyric offset store + NpLyrics hold/nudge UI)
  - quick-260926-m72 (lyricsAnchor; anchor $effect left untouched)
provides:
  - /api/lyric-offset GET (consensus) + POST (vote) over the DIAG R2 bucket, lyric-offset/ prefix
  - store shared layer: getEffectiveLyricOffset / isSharedLyricOffset / ensureSharedLyricOffset / scheduleLyricOffsetVote / resetLyricOffset / clearLyricOffset / hasLocalLyricOffset
affects:
  - src/lib/components/NpLyrics.svelte
  - src/lib/components/Nowbar.svelte
tech-stack:
  added: []
  patterns:
    - median + >=3-agree-within-1s consensus, 50 newest votes, per-key salted IP hash voter id
    - R2 conditional put read-modify-write (etagMatches / etagDoesNotMatch '*'), 3 tries then 409
    - edge-cache GET 300s with CORS re-applied on hit; POST busts the PoP-local GET key
key-files:
  created:
    - src/lib/proxy/lyric-offset.ts
    - src/lib/proxy/lyric-offset.test.ts
    - src/routes/api/lyric-offset/+server.ts
    - src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts
    - src/lib/services/lyric-offset-shared.ts
    - src/lib/services/lyric-offset-shared.test.ts
  modified:
    - src/lib/stores/lyric-offset.svelte.ts
    - src/lib/stores/lyric-offset.svelte.test.ts
    - src/lib/components/NpLyrics.svelte
    - src/lib/components/Nowbar.svelte
    - src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "Explicit local 0 is now STORED (opt-out from a shared consensus); only clearLyricOffset deletes"
  - "Readout tap = resetLyricOffset: local -> back to shared (or 0); shared-only -> explicit 0; never votes, cancels a pending vote"
  - "Shared offset key = first 32 hex of SHA-256(uid + newline + raw readLyrics() string), so a different lyrics pick never inherits an alignment"
  - "ensureSharedLyricOffset returns its Promise (callers ignore it) so tests can await settlement deterministically"
metrics:
  duration: ~10 min
  completed: 2026-09-26
  tasks: 3
  files: 25
---

# Quick 260926-mzn: Shared lyric offsets with median consensus Summary

When a listener realigns a song's lyrics (hold a line, or nudge by ±0.5s), their final offset is sent as a vote to `/api/lyric-offset`. The route stores votes in the existing DIAG R2 bucket under a `lyric-offset/` prefix, keyed by a SHA-256 fingerprint of the uid plus the raw LRC. A listener with no local offset for that song gets the median of the votes, but only once at least 3 votes sit within ±1.0s of it. The lyrics pane then labels the offset "Synced by listeners". A listener's own offset always wins, and a stored explicit 0 lets them opt out.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 | Pure consensus helpers + `/api/lyric-offset` GET/POST, tested against a fake R2 bucket with etags and conditional puts | `3c2ab7ba` (test), `fcec078b` (feat) |
| 2 | Never-throw client service + the store's shared layer (unset vs explicit 0, local > shared > 0, ensure/vote/reset) | `8e4bbf15` (test), `46bc882d` (feat) |
| 3 | NpLyrics + Nowbar read the effective offset, "Synced by listeners" label, `lyrics.offsetShared` in all 15 locales | `bd4dd2ab` |

## Verification (observed)

- Task 1 verify command: 2 files, 35 tests passed. The route file exports only `GET`/`POST`, builds every key through `offsetObjectKey(`, and has no `bucket.list`. Result: `VERIFY-OK`.
- Task 2: service + store + lrc tests, 3 files, 82 tests passed. The shared/store pair ran 5 times in a row with 25/25 each time (checking the fake-timer + digest flush for flakiness).
- Task 3 grep block: `GREPS-OK`. All 15 locales have exactly one `"lyrics.offsetShared"`. NpLyrics and Nowbar each have exactly one `getEffectiveLyricOffset(player.current?.uid)` and one `ensureSharedLyricOffset(`. NpLyrics has 2 `scheduleLyricOffsetVote(` and 1 `resetLyricOffset(`. There are 0 non-comment `getLyricOffset(` calls.
- Final `pnpm test`: **158 files, 3535 tests passed**.
- Final `pnpm check`: **0 errors, 1 warning**. The warning is the existing unused `.subnav.heads span` selector in NowPlaying.svelte, not ours.
- Live dev-server probe with curl (this proves SvelteKit loads the route module, which unit tests cannot): on port 4321, `GET ?k=<32hex>` returned 200 `{"ok":true,"offset":null,"n":0}`, `GET ?k=bad` returned 400 `invalid-key`, and a POST vote returned 200 `{"ok":true,"offset":null,"n":1}`. The same vote from port 5173 replaced the first (n stayed 1), because the same local socket address hashes to the same voter id.
- **Not verified here:** the 3-distinct-IP consensus end to end, and the "Synced by listeners" label on a device. Under `vite dev`, `getClientAddress` is the local socket address, so you can't spoof 3 voters, and I had no browser pane. The orchestrator E2E and the human-check in the plan cover this.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test typing for the bad-key matrix**
- **Found during:** Task 1 (`pnpm check`)
- **Issue:** `[{}, { k: ... }]` inferred a union that is not assignable to `Record<string, string>`.
- **Fix:** Annotated the first element `{} as Record<string, string>`.
- **Files modified:** `src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts`
- **Commit:** `fcec078b`

**2. [Verify-command bug] Task 2's `grep -c 'fetch(' | grep -qvx 0` was inverted**
- **Found during:** Task 2 verify
- **Issue:** As written, the check requires at least one raw lowercase `fetch(` in the service. `apiFetch(` doesn't match it (capital F). A raw fetch would contradict the plan's own key_link (all traffic goes through the `apiFetch` governor).
- **Fix:** Left the implementation alone (zero raw `fetch(`) and ran the intended assertion (count == 0), which passed. The other two Task 2 greps passed as written.

## Assumption Drift (advisory)

- **Found during:** Task 3 live probe
- **Planned:** "Under vite dev (no DIAG binding) both verbs answer 503 and the client silently shows no shared offset."
- **Actual:** In this repo, `vite dev` exposes a DIAG binding through adapter-cloudflare's platform proxy. It is local miniflare R2 persisted in the gitignored `.wrangler/state/v3/r2/openmusic-diag`, and `wrangler.jsonc` has no `remote` flag. So the route answers 200 locally and actually stores votes. The 503 path still exists and is pinned by tests for when no binding is present.
- **Why it matters:** local dev exercises the real read-modify-write path, including miniflare accepting both the `etagDoesNotMatch: '*'` create and the `etagMatches` update. The orchestrator can run most of the E2E on the plain dev server instead of `wrangler pages dev`, except the multi-IP part.
- **Side effect:** my probe left one local-only vote under key `abab…ab` (`'ab'.repeat(16)`) in the local miniflare R2. Pick a different key for E2E, or expect `n:1` on that one. Nothing was written to the remote Cloudflare bucket.

## Known Stubs

None. `_shared = $state({})` is the in-memory shared layer, filled by `ensureSharedLyricOffset`.

## Threat Flags

None beyond the plan's register. The new unauthenticated POST surface is T-mzn-04/05 (accepted, with a `ponytail:` comment naming the rate-limit / Turnstile upgrade path).

## Self-Check: PASSED

- FOUND: src/lib/proxy/lyric-offset.ts, src/lib/proxy/lyric-offset.test.ts, src/routes/api/lyric-offset/+server.ts, src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts, src/lib/services/lyric-offset-shared.ts, src/lib/services/lyric-offset-shared.test.ts
- FOUND commits: 3c2ab7ba, fcec078b, 8e4bbf15, 46bc882d, bd4dd2ab
