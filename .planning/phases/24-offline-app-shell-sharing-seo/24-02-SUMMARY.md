---
phase: 24-offline-app-shell-sharing-seo
plan: 02
subsystem: api
tags: [share-links, slugify, seo, ssr, cjk, pure-functions]

# Dependency graph
requires:
  - phase: prior (share.ts v2 base64url payload)
    provides: slugify, shareUrl, encodeShare/decodeShare, buildOg, isHttpsUrl
provides:
  - "slugify reversed to ASCII-only output (D-05) — CJK/non-ASCII stripped, slug is cosmetic"
  - "entityShareUrl(type, t) building the readable /{type}/{slug}-{source}{id} path (D-04)"
  - "parseEntityParam(param) decoding the authoritative {source}{id} key, null-on-no-match (T-24-03)"
affects: [24-04 (SSR song entity route, imports parseEntityParam + buildOg), 24-05 (share buttons, import entityShareUrl)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Readable share path = cosmetic ASCII slug + authoritative {source}{id} key (D-04)"
    - "parseEntityParam is the input-validation gate: anchored on the fixed source enum, null-on-no-match, never throws (T-24-03)"
    - "All share.ts primitives stay pure/SSR-importable (typeof location guard, no DOM)"

key-files:
  created: []
  modified:
    - src/lib/services/share.ts
    - src/lib/services/share.test.ts

key-decisions:
  - "Reversed slugify with the zero-dep strip-to-ASCII pipeline (NFKD + non-[a-z0-9] collapse), not pinyin-pro — D-05 locks ASCII-readable, RESEARCH-recommended default, no new deps"
  - "Anchored parseEntityParam on the literal source enum netease|qq|kuwo|joox|kugou|migu per the plan/D-04 (note: differs from the live SourceId type) plus an empty-slug fallback regex"
  - "buildOg reused unchanged (D-07)"

patterns-established:
  - "Cosmetic slug + authoritative {source}{id}: an all-CJK title legitimately yields an empty slug; the path drops the leading hyphen to /{type}/{source}{id}"
  - "Dual-regex decode: slug-prefixed (-source id$) and bare (^source id$) forms both round-trip"

requirements-completed: [SHARE-02]

# Metrics
duration: ~12min
completed: 2026-06-14
---

# Phase 24 Plan 02: Readable Share-Link Primitives Summary

**Reversed `slugify` to ASCII-only (D-05) and added `entityShareUrl` + `parseEntityParam` so the readable `/{type}/{slug}-{source}{id}` share path round-trips on the authoritative `{source}{id}` key — all pure/SSR-importable, zero new deps.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-14T00:30:00Z (approx)
- **Completed:** 2026-06-14T00:34:00Z (approx)
- **Tasks:** 2 (both TDD)
- **Files modified:** 2

## Accomplishments
- `slugify` reversed from CJK-preserving to ASCII-only: NFKD normalise → strip combining marks → collapse every non-`[a-z0-9]` run (drops CJK) → trim → cap 60. The doc-comment is inverted to state the slug is cosmetic and `{source}{id}` is authoritative.
- `entityShareUrl(type, t)` builds `/{type}/{slug}-{source}{id}`, dropping the leading hyphen when the slug is empty (all-CJK title → `/{type}/{source}{id}`). Reuses the `shareUrl` SSR `location` guard verbatim.
- `parseEntityParam(param)` decodes the authoritative `{source}{id}` key, anchored on the fixed source enum, handling both slug-prefixed and empty-slug forms; returns `null` on no-match and never throws (T-24-03 validation gate).
- `buildOg` reused unchanged (D-07). No new dependencies. Full suite (817 tests, 60 files) and `pnpm check` (0 errors) green.

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1: Reverse slugify to ASCII-only + update its tests**
   - `3dcd827` (test — RED: reversed CJK assertion)
   - `9e2bca3` (feat — GREEN: strip-to-ASCII pipeline)
2. **Task 2: Add entityShareUrl + parseEntityParam with round-trip tests**
   - `dfe723d` (test — RED: entity build/parse round-trip)
   - `6994640` (feat — GREEN: entityShareUrl + parseEntityParam)

## Files Created/Modified
- `src/lib/services/share.ts` - Reversed `slugify` (ASCII-only, D-05); added `entityShareUrl` + `parseEntityParam` and the fixed-source-enum regexes; `buildOg` untouched.
- `src/lib/services/share.test.ts` - Replaced the "preserves CJK" test with an ASCII-output assertion; added a new `describe('entityShareUrl / parseEntityParam', ...)` block covering build, empty-slug, parse, null-on-no-match, and the build→parse round-trip.

## Decisions Made
- **Strip-to-ASCII over pinyin-pro:** D-05 locks ASCII-readable, not a specific library. The zero-dep strip pipeline is the RESEARCH-recommended default and adds no install gate (T-24-SC: zero new packages).
- **Source-enum anchor `netease|qq|kuwo|joox|kugou|migu`:** Used the literal enum specified in the plan's `<action>` and acceptance criteria (and D-04). This differs from the live `SourceId` type (`netease|qq|kuwo|joox|fivesing|jamendo`) — see Issues below. The plan's explicit grep acceptance criterion mandated this literal anchor, so the plan text was followed as written.
- **Empty-slug handling:** When the slug is empty (all-CJK title with no ASCII artist), the path is `/{type}/{source}{id}` with no leading hyphen, and `parseEntityParam` matches it via a bare `^{source}{id}$` fallback regex.

## Deviations from Plan

None - plan executed exactly as written. Rules 1-4 were not triggered.

(One environment setup step was required before execution: the fresh worktree had no `node_modules`, so `pnpm install --frozen-lockfile` was run to restore the existing lockfile-pinned dependencies. This is a setup restore — no packages were added or changed — and is not a plan deviation.)

## Issues Encountered
- **Source-enum mismatch (documented, not fixed):** The plan, D-04, and RESEARCH all specify the share-decode source anchor as `netease|qq|kuwo|joox|kugou|migu`, but the live `SourceId` type in `src/lib/sources/types.ts` is `netease|qq|kuwo|joox|fivesing|jamendo`. The plan's action and a grep acceptance criterion explicitly require the former literal, so it was used verbatim. This means `parseEntityParam` will currently return `null` for `fivesing`/`jamendo` share params and will accept `kugou`/`migu` (sources not in the live enum). This is within plan scope as written; the downstream consumer (Plan 04) should reconcile the anchor with the live `SourceId` enum if those sources need shareable entity links. Flagged here for the verifier/next plan rather than auto-fixed, since changing the anchor would contradict the plan's explicit acceptance criterion (would be a Rule 4 architectural reconciliation, deferred to Plan 04's integration).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `entityShareUrl`, `parseEntityParam`, and the ASCII `slugify` are exported, tested, and SSR-importable — ready for Plan 04 (`(app)/song/[slug]/+page.ts` importing `parseEntityParam` + `buildOg`) and Plan 05 (share buttons importing `entityShareUrl`).
- D-06 `?play=` queue carrier (`shareUrl`/`encodeShare`/`decodeShare`) is intact — no regression.
- Reconcile the `parseEntityParam` source-enum anchor with the live `SourceId` type during Plan 04 integration (see Issues).

## Self-Check: PASSED

- Files verified present: `src/lib/services/share.ts`, `src/lib/services/share.test.ts`, `24-02-SUMMARY.md`
- Commits verified in git log: `3dcd827`, `9e2bca3`, `dfe723d`, `6994640`

---
*Phase: 24-offline-app-shell-sharing-seo*
*Completed: 2026-06-14*
