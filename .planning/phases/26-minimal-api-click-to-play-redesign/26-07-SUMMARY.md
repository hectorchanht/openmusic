---
phase: 26-minimal-api-click-to-play-redesign
plan: 07
subsystem: services/similar + api/lastfm
tags: [up-next, similar-tracks, lastfm, cover-seed, cr-01, post-filter-gate, report-callback, gap-closure, edge-proxy, vitest, tdd]

# Dependency graph
requires:
  - src/routes/api/lastfm/similar-tracks/+server.ts reshape/SimilarTrack — the track.getSimilar proxy this plan extends with an image field
  - src/lib/services/similar.ts buildSimilarQueue/nameStub/fetchSimilarTracks — the up-next builder this plan hardens (CR-01) and seeds with covers
provides:
  - src/routes/api/lastfm/similar-tracks/+server.ts SimilarTrack.image — largest SOLID https Last.fm cover per track (placeholder-star + non-https dropped)
  - src/lib/services/similar.ts buildSimilarQueue(track, excludeUids, report?) — CR-01 post-filter fallback gate + additive report(via) formation-source callback
  - src/lib/services/similar.ts nameStub(...,image?) — up-next name stub cover seeded from the Last.fm https image
affects: [up-next-formation, up-next-tile-cover-cost, never-empty-queue, click-to-play]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Endpoint largest-https image pick: extralarge>large>medium>small preference then any-https fallback; placeholder-star hash (2a96cbd8...) + non-https/empty filtered → field OMITTED (never a placeholder), preserving the https-only render gate (T-26-07-01)"
    - "CR-01 post-filter gate: short-circuit the primary track.getSimilar path on out.length (usable candidates) not stubs.length (raw response) — a fully seed/excluded-filtered primary falls through to the artist.getSimilar fallback instead of a silent empty Up-Next"
    - "Same post-filter discipline applied to the artist branch: an empty similar-artists result falls through to the same-artist last resort so the 'empty' terminal genuinely means every path dry"
    - "Additive optional report(via: 'similar'|'artist'|'lastresort'|'empty') callback: a plain caller-supplied function (NO *.svelte.ts import) so similar.ts stays a pure node-testable .ts; trailing/optional so existing callers (ensureAhead/regenerate) are unaffected until plan 26-09 opts in"
    - "Inline isHttps guard in similar.ts (non-empty string startsWith 'https:') mirrors player.svelte.ts httpsOnly / share.ts isHttpsUrl without importing a store — keeps the pure-module boundary"

key-files:
  created:
    - .planning/phases/26-minimal-api-click-to-play-redesign/26-07-SUMMARY.md
  modified:
    - src/routes/api/lastfm/similar-tracks/+server.ts
    - src/routes/api/lastfm/similar-tracks/similar-tracks-endpoint.test.ts
    - src/lib/services/similar.ts
    - src/lib/services/similar.test.ts

key-decisions:
  - "CR-01 fix is minimal + surgical: only the primary short-circuit changes from `return out` to `if (out.length) { report?.('similar'); return out; }`. The artist branch got the SAME post-filter discipline (empty → fall through to last resort) so the report discriminators are coherent and 'empty' truly means all-dry — a small, in-spirit hardening (Rule 2), single-source and bounded, not a control-flow rewrite"
  - "image pick prefers the LARGEST variant (extralarge first) since the up-next tile benefits from the biggest art; falls back to any-https for unsized/mega payloads; the placeholder-star + non-https filter is applied BOTH edge-side (endpoint) and client-side (nameStub isHttps guard) as defense-in-depth"
  - "report(via) is a plain callback, not an event/store, so similar.ts stays node-testable under the single Vitest server project (no jsdom); the player wiring to actually LOG the via lands in plan 26-09"
  - "nameStub image param typed image?: string | null (accepts the endpoint's optional string and a client null) — cover = isHttps(image) ? image : null keeps today's coverless-similar behavior for missing/non-https values"

requirements-completed: [UPNEXT-01, COVER-01]

# Metrics
duration: 7min
completed: 2026-07-11
---

# Phase 26 Plan 07: Up-Next Formation & Cover Gap-Closure (Gaps 2, 3 + CR-01) Summary

**Closes two Phase-26 UAT gaps and code-review CR-01 at the service/edge-proxy seam (node-testable, no UI). Gap 2 / CR-01: `buildSimilarQueue` gated its `artist.getSimilar` fallback on the PRE-filter `stubs.length`, so a thin/collision-heavy `track.getSimilar` response whose every pair is the seed or already-excluded returned a silent empty Up-Next while a working fallback sat unused — now gated on the POST-filter `out.length`, and an additive `report(via)` callback surfaces which path formed the queue. Gap 3: `/api/lastfm/similar-tracks` now passes through the largest SOLID https Last.fm image per track (placeholder-star + non-https dropped), and up-next name stubs are SEEDED with it as their cover, so the Up-Next list can paint without a per-tile Deezer→iTunes→CN chain (the tile-side consumption lands in 26-10). Full suite green except the pre-existing deferred `searchHistory` SSR-guard failure.**

## Performance

- **Duration:** ~7 min
- **Completed:** 2026-07-11
- **Tasks:** 3 of 3, each TDD RED→GREEN (no REFACTOR needed)
- **Files:** 1 created (this SUMMARY), 4 modified

## Accomplishments

- **Task 1 (Gap 3 — endpoint image passthrough), TDD `f61d0b0`:**
  - Extended `SimilarTrack` with `image?: string` and added the `LfmImage` (`{ '#text'?, size? }`) sub-shape to `LfmSimilarTrack`.
  - Added `pickImage()`: prefers `extralarge → large → medium → small`, then falls back to any https entry; drops the Last.fm placeholder-star hash `2a96cbd8b46e442fc41c2b86b821562f` and any non-https/empty value → the field is OMITTED (never a placeholder). Wired into `reshape` (attach `image` only when a solid https URL survives).
  - Everything else byte-for-byte: `{artist,title,match}` shape, match-descending order, match coercion, incomplete-pair drop, cap-to-limit, absent-key no-fetch, own-origin CORS, never-log-key.
  - **RED→GREEN:** 4 new endpoint tests (largest extralarge https passed through; next-largest fallback when extralarge absent; placeholder-star + non-https all dropped → no image; no-image-array returns cleanly). The 2 image-presence tests failed RED; after the impl all 11 endpoint tests pass.

- **Task 2 (Gap 2 / CR-01 — post-filter fallback gate + report callback), TDD `656af50`:**
  - CR-01: changed the primary `track.getSimilar` short-circuit from `return out` (inside `if (stubs.length)`) to `if (out.length) { report?.('similar'); return out; }` so a fully-filtered primary falls through to the artist fallback.
  - Applied the same post-filter discipline to the artist branch (empty similar-artists result falls through to the same-artist last resort) so the report discriminators are coherent.
  - Added the trailing optional `report?: (via: 'similar'|'artist'|'lastresort'|'empty') => void` param, fired once on each terminal path. Backward-compatible: existing callers (ensureAhead/regenerate) untouched.
  - **RED→GREEN:** 4 new tests — CR-01 regression (a lone stub in `excludeUids` now REACHES the artist fallback, `searchAll` invoked, usable queue returned, not `[]`); report emits `'similar'`/`'artist'`/`'empty'` on the respective paths. All 4 failed RED; green after the impl.

- **Task 3 (Gap 3 — seed name-stub covers), TDD `d42679d`:**
  - Widened `fetchSimilarTracks`'s `data.tracks` type to include `image?: string` and threaded `p.image` into `nameStub`.
  - Added the optional `image?: string | null` param to `nameStub`; `cover = isHttps(image) ? image : null` via a small inline `isHttps` guard (keeps `similar.ts` a pure node-testable `.ts`, no store import). Synthetic uid / `resolveByName` / `detailsLoaded:false` / match order all unchanged.
  - **RED→GREEN:** 3 new tests — seeded https cover on a stub (still a lazy `resolveByName` stub); `cover:null` on absent image; `cover:null` on a non-https value. The seeded-cover test failed RED; green after the impl.

## Verification

- `pnpm test -- src/routes/api/lastfm/similar-tracks/similar-tracks-endpoint.test.ts` — 11 passed (7 existing + 4 new).
- `pnpm test -- src/lib/services/similar.test.ts` — 16 passed (9 existing + 7 new: 4 CR-01/report + 3 cover-seed).
- Full `pnpm test` — 1176 passed, 1 failed (ONLY the pre-existing deferred `searchHistory.svelte.test.ts` SSR-guard failure; see Out of Scope).
- `pnpm check` — 0 errors, 1 warning (pre-existing unused `.warn` CSS selector in `search/+page.svelte`; unrelated to this plan).
- Call-budget preserved: the existing `buildSimilarQueue — call cost (spike-003)` test (up-next BUILD path = exactly 1 `/api/*` call, 0 all-enabled `searchAll` fan-outs) still passes — the CR-01 gate only adds a fallback when the primary is genuinely dry.

## TDD Gate Compliance

Each task followed RED→GREEN with a verified failing assertion before implementation:
- Task 1: image-presence assertions failed RED (received `undefined`), green after `pickImage`.
- Task 2: all 4 tests failed RED (CR-01 returned `[]`/never called `searchAll`; `report` never fired), green after the post-filter gate + callback.
- Task 3: the seeded-cover assertion failed RED (`cover` was `null`), green after the `nameStub` image wiring.
- Fail-fast honored: the two "cover:null" Task-3 tests and the two "image absent" Task-1 tests passed at RED trivially (correct-by-current-behavior guards), and were confirmed still-correct at GREEN — no masked pass on the load-bearing assertions.
- Per-task atomic commits used instead of separate test/feat commits (extensions to existing files); the RED→GREEN sequence was verified at each step via the test runner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Consistency / never-empty] Applied the CR-01 post-filter discipline to the artist fallback branch too**
- **Found during:** Task 2, defining the `report(via)` terminal semantics.
- **Issue:** The artist branch (`if (names.length) { ... return dedupeBest(...).filter(keep); }`) returned its result unconditionally — including `[]` — never trying the same-artist last resort. That would make `report('artist')` fire on an empty result and let `'empty'` never mean "all paths dry", the exact pre-filter-vs-post-filter class of bug CR-01 fixes.
- **Fix:** Gate the artist branch on `artistOut.length` (report `'artist'` + return only when usable), else fall through to the last-resort same-artist search; report `'lastresort'` when it yields, `'empty'` only when every path is dry. Single-source and bounded (`onlyPrimarySource` unchanged) — no new fan-out.
- **Files modified:** src/lib/services/similar.ts
- **Commit:** 656af50

### Out of Scope (logged, NOT fixed)

**Pre-existing test failure: `searchHistory.svelte.test.ts` SSR guard (Node native `localStorage`)**
- Fails with zero involvement from this plan (Node 22+ / vitest `--localstorage-file` exposes `globalThis.localStorage`, so `typeof globalThis.localStorage === 'undefined'` no longer holds). Already documented in prior Phase-26 SUMMARYs. Not touched per the scope boundary.

**Pre-existing `pnpm check` warning: unused `.warn` CSS selector in `src/routes/(app)/search/+page.svelte`**
- Present before this plan; unrelated to `similar.ts` / the endpoint. Not touched per the scope boundary.

**Deferred consumers (by design, in later plans, not this plan):**
- The Up-Next TILE change to actually PAINT from the seeded stub cover (and skip the per-tile Deezer→iTunes→CN chain) lands in plan 26-10 (`NowPlaying.svelte`).
- The player wiring to LOG the `report(via)` up-next formation source lands in plan 26-09.
- CR-01's secondary suggestion — a `regenerate()` `buildDiversePicks` safety net in `player.svelte.ts` — is a player-store change out of this pure-service plan's scope (the endpoint/service CR-01 gate is the primary fix; the never-empty invariant is now honored at the `buildSimilarQueue` seam).

## Threat Model Compliance

- **T-26-07-01** (Injection — Last.fm image rendered as `<img src>`/cover) — mitigated: the endpoint attaches ONLY a SOLID https URL (placeholder-star + non-https/empty dropped); `nameStub` re-guards with `isHttps` before seeding `cover`. Preserves the existing https-only render gate (T-0bb-01 parity) both edge-side and client-side.
- **T-26-07-02** (Info Disclosure — `LASTFM_KEY` leak) — unchanged: key injected edge-side only, never logged, absent-key → 200 `{tracks:[]}`. The image passthrough added no new logging or key surface (endpoint no-leak tests still pass).
- **T-26-07-03** (DoS — empty Up-Next / silent regen loop) — mitigated: the CR-01 post-filter gate reaches the fallback instead of returning `[]`; the artist branch also falls through to last resort — no empty-queue dead end.
- **T-26-07-SC** (package installs) — n/a: no new dependency added this plan.

## Known Stubs

None. The endpoint image passthrough, the CR-01 gate, the `report(via)` callback, and the seeded-cover name stub are fully wired with tests. The seeded cover is real data (the Last.fm https image), not a placeholder; a coverless similar keeps `cover:null` (the honest "no data — resolve later" state, not a stub).

## Threat Flags

None. No new network endpoint, auth path, file access, or trust-boundary schema change beyond the already-modeled Last.fm image passthrough (T-26-07-01, in the plan's threat register).

## Notes for Next Plan

- **26-09 (player):** opt in to `buildSimilarQueue(track, excludeUids, report)` — pass a `report` callback that `logAction('upnext.via', { via })` so the Activity log verifies up-next formed from ONE `track.getSimilar` call (`'similar'`) vs a fallback (`'artist'`/`'lastresort'`/`'empty'`). Consider the CR-01 secondary `regenerate()` `buildDiversePicks` safety net here.
- **26-10 (NowPlaying up-next tiles):** the up-next name stubs now carry `cover` (the Last.fm https image) — bind the tile to `t.cover` and SKIP the per-tile `resolveCoverForTrack` (Deezer→iTunes→CN) chain when it is present; only the now-playing track gets the optional HQ upgrade.

## Self-Check: PASSED

- All 4 modified files present on disk (`+server.ts`, `similar-tracks-endpoint.test.ts`, `similar.ts`, `similar.test.ts`); `26-07-SUMMARY.md` created.
- Endpoint emits the `image` field (13 `image` references) and `similar.ts` carries the post-filter gate + report callback (6 `out.length`/`report?.` references).
- All 3 task commits present in git history: `f61d0b0` (Task 1 feat/endpoint), `656af50` (Task 2 fix/CR-01), `d42679d` (Task 3 feat/cover-seed).
