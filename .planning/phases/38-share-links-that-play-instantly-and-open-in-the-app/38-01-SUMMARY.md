---
phase: 38
plan: 01
subsystem: share
tags: [share-link, deep-link, input-validation, pure-service]
requires: []
provides:
  - "songShareUrl 4th positional `id` arg emitting the `?u={source}{songid}` carrier"
  - "exported Stub type + stubToTrack from share.ts"
  - "ENTITY_SOURCE_RE / ENTITY_SOURCE_ONLY_RE aligned with the live SourceId union"
  - "share-arrival.ts: arrivalMode, stubFromUidParam, deepLinkPath, APP_LINK_HOST"
affects:
  - "plan 02/04/05/07 build against these fixed signatures"
  - "plan 06 wires TrackMenu's call site to pass the track identity"
tech-stack:
  added: []
  patterns:
    - "never-throw-return-null safe parse (parseEntityParam / safe-image-url discipline)"
    - "pure .ts service + co-located node test (no jsdom, zero mocks)"
key-files:
  created:
    - src/lib/services/share-arrival.ts
    - src/lib/services/share-arrival.test.ts
  modified:
    - src/lib/services/share.ts
    - src/lib/services/share.test.ts
decisions:
  - "38-D-08/D-09: carrier is the separator-less `{source}{songid}` form so the recipient reuses parseEntityParam verbatim — zero new validation code"
  - "38-D-30: source enum now includes audius|ytmusic and is the V5 allowlist for the `u` carrier"
  - "The identity is an OPTIONAL 4th argument, which is what keeps every pinned carrier-free assertion green by construction"
  - "A `device:` uid emits no carrier — its `source` is a placeholder (34-D-01) that would resolve a foreign song"
metrics:
  duration: ~20m
  completed: 2026-09-20
---

# Phase 38 Plan 01: The pure share-arrival seam Summary

Share URLs now carry a decodable `?u={source}{songid}` song identity, and the three pure
decisions a share arrival makes (cold vs warm, carrier → Track stub, deep-link host gate) live in
one node-tested `share-arrival.ts` with no store import.

## What Was Built

**Task 1 — the `?u=` carrier + the D-30 enum fix** (`share.ts`, `share.test.ts`)

- `songShareUrl` takes an optional 4th positional `id?: { uid, source, songid }`. A `Track`
  satisfies it structurally, so plan 06's TrackMenu change is a single appended argument.
- A private `uidCarrier()` decides the value: nothing for no identity, nothing for a `device:` uid,
  and nothing unless `parseEntityParam` decodes the value back. Emit-only-if-it-decodes is the
  `quick-260809-3uo` "never a junk param" rule applied to `u`.
- `ci` stays first and `u` second, preserving the pinned `/song/{artist}/{title}?ci=` prefix.
- `Stub` and `stubToTrack` are now exported so the arrival seam reuses the exact field set rather
  than re-inlining it.
- `ENTITY_SOURCE_RE` / `ENTITY_SOURCE_ONLY_RE` gained `audius|ytmusic`, with the comment block
  extended to say why it now matters more: the alternation is the input-validation allowlist
  standing between an attacker-controllable query param and a `SOURCES[source].resolve` dispatch.

**Task 2 — `share-arrival.ts` + `share-arrival.test.ts`**

- `arrivalMode({ playing, loading })` → `'warm'` when either is true. The JSDoc records why the
  private `hasPlayedSinceSrc` must not be used (it stays true across a pause, which would
  misclassify a paused track as warm — the opposite of D-01).
- `stubFromUidParam(u, artist, title)` routes through `parseEntityParam` and `stubToTrack`; the
  `as SourceId` narrowing is commented as safe precisely because the regex the value just matched
  IS the union.
- `deepLinkPath(raw)` requires `https:` plus exact lowercased host equality with `APP_LINK_HOST`,
  returns `pathname + search` (never an absolute URL, so it cannot become an open redirect), and
  `null` on anything else including an unparseable input.
- The module imports only `$lib/services/share` and a type — no store, plain `.ts`.

## Verification (observed, not assumed)

| Check | Command | Observed |
|---|---|---|
| Task 1 suites | `pnpm test -- src/lib/services/share.test.ts src/lib/stores/names.test.ts` | 2 files passed, **119 tests passed** |
| Task 2 suite | `pnpm test -- src/lib/services/share-arrival.test.ts` | 1 file passed, **13 tests passed** (≥12 required) |
| Full suite | `pnpm test` | **145 files passed, 2943 tests passed**, 0 failed |
| Typecheck | `pnpm check` | `4574 FILES 0 ERRORS 0 WARNINGS` |
| Pinned tests untouched | `git diff --stat src/lib/stores/names.test.ts` | empty output |
| D-30 enum | `grep -c 'audius|ytmusic' src/lib/services/share.ts` | `2` |
| Exports | `grep -c '^export type Stub\b\|^export function stubToTrack'` | `2` |
| Carrier arg | `grep -n 'id?: { uid: string; source: string; songid: string } \| null'` | matches at `:421` (signature) and `:453` (helper) |
| No store import | `grep -c 'stores/' src/lib/services/share-arrival.ts` | `0` |
| Exact host match | `grep -c 'endsWith' src/lib/services/share-arrival.ts` | `0` |
| `hasPlayedSinceSrc` in a comment only | `grep -n` | one hit, line 32, inside the JSDoc |
| No casts | `grep -c 'as any'` on both prod files | `0`, `0` |

**TDD gates:** both tasks ran RED first (4 failing carrier assertions; an unresolved-import failure
for the arrival module) and each RED was committed before its GREEN.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Contradictory acceptance criterion on `endsWith`**

- **Found during:** Task 2
- **Issue:** The plan's `<action>` asked the host-check JSDoc to "cite safe-image-url.ts's
  dot-anchored note … so no `endsWith`", while the acceptance criterion required
  `grep -c "endsWith" == 0`. Writing the required citation with the literal token made the grep
  return `1`. Both cannot hold literally.
- **Fix:** Reworded the comment to state the same decision without the literal identifier ("NOT a
  trailing/suffix match: an un-anchored suffix test would accept `evil-openmusic.lol`, the exact
  dot-anchoring mistake the allowlist in `safe-image-url.ts` documents"). The decision record and
  the grep both hold; the test `rejects a look-alike host — the match is EXACT, never a suffix test`
  is the enforcing check either way.
- **Files modified:** `src/lib/services/share-arrival.ts`
- **Commit:** `596fb6b`

No other deviations — the two tasks executed as written.

## Assumption Drift (advisory)

None material. The plan's prediction that an optional 4th argument keeps all eight pinned
assertions green was verified rather than assumed: `names.test.ts` has an empty diff and the full
suite is green.

## Known Stubs

None. Both exports are fully implemented; `share-arrival.ts` is deliberately only the PURE half —
plan 04 appends `arriveShared()` (the store-facing orchestration), which is scope, not a stub.

## Commits

| Task | Gate | Commit | Files |
|---|---|---|---|
| 1 | RED | `2a9dc77` | `share.test.ts` |
| 1 | GREEN | `096bb2d` | `share.ts` |
| 2 | RED | `c7e89c5` | `share-arrival.test.ts` |
| 2 | GREEN | `596fb6b` | `share-arrival.ts` |

## Self-Check: PASSED

- `src/lib/services/share-arrival.ts` — FOUND
- `src/lib/services/share-arrival.test.ts` — FOUND (99 lines, min 60)
- `src/lib/services/share.ts` — FOUND (modified)
- `src/lib/services/share.test.ts` — FOUND (modified)
- Commits `2a9dc77`, `096bb2d`, `c7e89c5`, `596fb6b` — all FOUND in `git log`
