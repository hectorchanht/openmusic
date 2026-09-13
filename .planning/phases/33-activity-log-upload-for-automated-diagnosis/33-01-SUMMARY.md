---
phase: 33-activity-log-upload-for-automated-diagnosis
plan: 01
subsystem: api
tags: [cloudflare, workers, security, validation, proxy, webcrypto, r2, vitest]

# Dependency graph
requires:
  - phase: "pre-existing (quick-260630-sgw)"
    provides: "src/lib/diagnostics/action-log-logic.ts — parseActionLog + ACTION_LOG_CAP + serializeActionLog"
provides:
  - "bearerMatches(header, expected): Promise<boolean> — fail-closed, constant-time bearer gate for the diagnostic endpoints"
  - "MAX_UPLOAD_BYTES (512 KiB) — the pre-parse body cap"
  - "screenLogPayload(text): number | null — server-side upload screen returning the valid entry count"
  - "diagKey(now, rand) / isDiagKey(key) — R2 key mint and untrusted ?key= screen"
affects: [33-02, 33-03, 33-04, 33-05, 33-06, 33-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "WebCrypto digest-then-XOR constant-time compare (portable across workerd + Node 22)"
    - "Fail-closed auth posture, explicitly contrasted in-comment with the fail-open optional-key routes"
    - "screen -> delegate parse -> validate -> never-throw sentinel (the safe-image-url shape)"

key-files:
  created:
    - src/lib/proxy/diag-auth.ts
    - src/lib/proxy/diag-auth.test.ts
    - src/lib/proxy/diag-payload.ts
    - src/lib/proxy/diag-payload.test.ts
  modified: []

key-decisions:
  - "bearerMatches compares SHA-256 digests, not raw strings — both operands are always 32 bytes so no length-mismatch branch exists to leak token length (T-33-08)"
  - "crypto.subtle.timingSafeEqual deliberately NOT used: Cloudflare-only, absent from Node 22, would make the production path untestable under the single node Vitest project"
  - "screenLogPayload delegates parse+validate to the already-tested parseActionLog rather than adding a second validator that would drift (D-05)"
  - "512 KiB cap screened on text.length BEFORE parsing; UTF-16 under-count for CJK accepted because this is a safety bound, not an accounting figure, and TextEncoder over a 500 KB string spends the CPU the bound protects"
  - "diagKey takes now/rand as parameters so it is deterministic and testable; the ISO prefix makes R2 lexicographic list order equal chronological order"

patterns-established:
  - "Diagnostic proxy helpers live in $lib/proxy/*.ts, never in +server.ts (a non-verb export there 500s at request time — commit 29c1c7d)"
  - "Security-control helpers get adversarial tests: every it() names the bypass it exists to block"

requirements-completed: [D-01, D-03, D-05]

# Metrics
duration: 5min
completed: 2026-09-13
---

# Phase 33 Plan 01: Diagnostic Auth + Payload Helpers Summary

**Fail-closed WebCrypto bearer gate plus a 512 KiB pre-parse upload screen and R2 key helpers, all pure `$lib/proxy/*.ts` with 28 adversarial node tests.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-09-13T06:18:47Z
- **Completed:** 2026-09-13T06:23:30Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4 created, 0 modified

## Accomplishments

- `bearerMatches` gates the diagnostic endpoints and **fails closed**: an absent or blank `DIAG_UPLOAD_TOKEN` / `DIAG_READ_TOKEN` rejects every header, so a forgotten `wrangler secret put` locks the door rather than removing it (T-33-01, explicit named test).
- The compare is SHA-256 digest-then-XOR with no early exit and no length branch (T-33-08), built only on `crypto.subtle.digest` + `TextEncoder` — globals on both workerd and Node 22, so the node-tested path IS the deployed path.
- `screenLogPayload` screens size before parsing (512 KiB, T-33-04) and reuses `parseActionLog` + `ACTION_LOG_CAP` instead of introducing a second validator (D-05).
- `diagKey` / `isDiagKey` mint a chronologically-sortable R2 key and screen an untrusted `?key=` down to exactly the shape the upload path can write (T-33-09).

## Task Commits

1. **Task 1: bearerMatches (RED)** — `fbf35f6` (test)
2. **Task 1: bearerMatches (GREEN)** — `86ed6ab` (feat)
3. **Task 2: screenLogPayload + key helpers (RED)** — `8971f00` (test)
4. **Task 2: screenLogPayload + key helpers (GREEN)** — `8c46094` (feat)

Both tasks followed RED→GREEN; neither needed a REFACTOR commit (the GREEN implementation was already the final shape — ~15 and ~25 lines of logic respectively).

## Files Created/Modified

- `src/lib/proxy/diag-auth.ts` — single export `bearerMatches`; module-private `sha256`. Header comment records the fail-closed posture, the contrast with fail-open optional-key routes, and why `timingSafeEqual` is not used.
- `src/lib/proxy/diag-auth.test.ts` — 11 tests across three describes: fail-closed, scheme screening, exact-match-only (prefix, suffix-extended, one-char-diff, trailing whitespace, realistic uuid).
- `src/lib/proxy/diag-payload.ts` — four exports: `MAX_UPLOAD_BYTES`, `screenLogPayload`, `diagKey`, `isDiagKey`.
- `src/lib/proxy/diag-payload.test.ts` — 17 tests: empty/non-JSON/non-array/all-malformed, oversize, cap-boundary, real `serializeActionLog` payloads, over-`ACTION_LOG_CAP`, key format + ordering + collision, traversal/off-shape key rejection.

## Verification (observed, not assumed)

| Check | Command | Observed |
|---|---|---|
| Task 1 RED | `pnpm test -- diag-auth` | FAIL — `Cannot find module './diag-auth'` |
| Task 1 GREEN | `pnpm test -- diag-auth` | **11 passed** (≥ 7 required) |
| Task 2 RED | `pnpm test -- diag-payload` | FAIL — module not found |
| Task 2 GREEN | `pnpm test -- diag-payload` | **17 passed** (≥ 12 required) |
| Both | `pnpm test -- diag-` | 2 files, **28 passed** |
| Full suite | `pnpm test` | **112 files, 2051 passed** (baseline 2023 + 28 new — no regression) |
| Typecheck | `pnpm check` | **4432 files, 0 errors, 0 warnings** |
| Purity | `grep -E '\$lib/stores\|\$app/' <both .ts>` | no matches — store-free, node-testable |

Acceptance greps: `diag-auth.ts` — `timingSafeEqual` 1 (comment only), `subtle.timingSafeEqual(` 0, `subtle.digest('SHA-256'` 1, `^export ` 1, `as any` 0. `diag-payload.ts` — action-log-logic import 1 (names both `parseActionLog` and `ACTION_LOG_CAP`), four named exports and `^export ` 4, `512 * 1024` 1, `JSON.parse` 0, `2000` outside comments 0.

## Decisions Made

None beyond the plan — all five key decisions above were specified in the plan and CONTEXT and were implemented as written.

## Deviations from Plan

None — plan executed exactly as written.

One cosmetic adjustment inside Task 2's GREEN step, noted for completeness rather than as a deviation: the `MAX_UPLOAD_BYTES` doc comment initially wrote the token `JSON.parse` while explaining the CPU budget, which tripped the plan's `grep -c "JSON.parse" == 0` acceptance check even though nothing called it. Reworded to "parsing the body" before the commit; same meaning, and the grep now proves there is genuinely no second parser.

## Assumption Drift (advisory)

None — the interfaces block matched the existing `action-log-logic.ts` exports exactly, and no upstream behaviour differed from what the plan assumed.

## Issues Encountered

A `grep -c "from '$lib/diagnostics/action-log-logic'"` returned 0 under double-quoted shell interpolation while `grep -F` on the same pattern returned 1 — a shell-escaping false negative, not a missing import (matches the known "grep false-empty, trust Read/sed" gotcha). Cross-checked with `grep -n` and `grep -F` before concluding.

## User Setup Required

None from this plan. The two secrets these helpers gate (`DIAG_UPLOAD_TOKEN`, `DIAG_READ_TOKEN`) and the R2 bucket binding are Plan 02/03 concerns; nothing here reads `platform.env`.

## Next Phase Readiness

Plan 04 can import `bearerMatches`, `MAX_UPLOAD_BYTES`, `screenLogPayload`, `diagKey`, `isDiagKey` from `$lib/proxy/diag-auth` / `$lib/proxy/diag-payload` with no exploration — the signatures are exactly as declared in the plan's `<interfaces>`. Both modules are plain `.ts` (no runes, no `$app`, no stores), so they compile identically for the Cloudflare and static builds.

No blockers. Reminder for the phase, not this plan: do not `git push` — pushing `main` auto-deploys production, and that approval lives in plan 33-07.

---
*Phase: 33-activity-log-upload-for-automated-diagnosis*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 4 created source files and the SUMMARY exist on disk; all 4 task commits (`fbf35f6`, `86ed6ab`, `8971f00`, `8c46094`) are present in `git log`.
