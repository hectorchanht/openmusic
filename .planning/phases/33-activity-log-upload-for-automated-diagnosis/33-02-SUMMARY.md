---
phase: 33-activity-log-upload-for-automated-diagnosis
plan: 02
subsystem: api
tags: [cloudflare, cors, config, proxy, r2, security]

# Dependency graph
requires:
  - phase: "pre-existing (Phase 1 / D-02)"
    provides: "src/lib/proxy/http.ts corsHeaders — the single CORS seam, applied by src/hooks.server.ts"
provides:
  - "Access-Control-Allow-Headers: 'Content-Type, Range, Authorization' — the cross-origin APK preflight for a bearer POST now succeeds (T-33-06)"
  - "Env.DIAG?: R2Bucket / Env.DIAG_UPLOAD_TOKEN?: string / Env.DIAG_READ_TOKEN?: string — the only place the diagnostic tokens are typed (D-03)"
  - "App.Platform.env mirror of the same three members"
  - "wrangler.jsonc r2_buckets: DIAG -> openmusic-diag (D-07)"
affects: [33-03, 33-04, 33-05, 33-06, 33-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional edge-only binding typed in BOTH proxy-types.ts Env (functional contract) and app.d.ts App.Platform.env (SvelteKit mirror)"
    - "Absent binding/secret is a SUPPORTED state documented at the type — same posture as LASTFM_KEY"

key-files:
  created: []
  modified:
    - src/lib/proxy/http.ts
    - src/lib/proxy/http.test.ts
    - src/lib/proxy/proxy-types.ts
    - src/app.d.ts
    - wrangler.jsonc

key-decisions:
  - "Allow-Headers was WIDENED, Allow-Origin was not touched — advertising a header grants nothing to a non-allowlisted origin, so the fix carries no T-33-10 cost; the new test re-asserts a foreign origin still gets no Access-Control-Allow-Origin"
  - "The new assertion uses https://localhost (the real Capacitor WebView origin) rather than the deployed origin, so the test exercises the case the fix exists for"
  - "R2 binding is DECLARED only — bucket creation and `wrangler pages secret put` stay in Plan 06's human checkpoint (wrangler on this machine authenticates to the wrong Cloudflare account)"

requirements-completed: [D-03, D-07]

# Metrics
duration: 3min
completed: 2026-09-13
---

# Phase 33 Plan 02: CORS Allow-Headers Fix + R2 Binding Wiring Summary

**One-word widening of the shared CORS Allow-Headers so the cross-origin APK can send a bearer token, plus the `DIAG` R2 binding typed in both env declarations and declared in `wrangler.jsonc`.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-09-13T06:24:12Z
- **Completed:** 2026-09-13T06:26:40Z
- **Tasks:** 2
- **Files modified:** 5 modified, 0 created

## Accomplishments

- `corsHeaders` now emits `Access-Control-Allow-Headers: 'Content-Type, Range, Authorization'`. Web is same-origin and never noticed; the APK (`https://localhost` → `https://openmusic.lol`) preflights every bearer POST and would have failed it — the single most likely way this phase ships "working" and is broken on the device (T-33-06).
- Because this is a shared security seam, the change carries its own named test. It splits the header on `,`, asserts all three values are present (the fix must ADD — `Range` carries audio seeking), and in the same `it` re-asserts that `https://evil.example.com` still receives **no** `Access-Control-Allow-Origin` — proof the header addition did not widen origin trust (T-33-10). `ALLOWED_ORIGIN_PATTERNS` is byte-identical to before.
- `Env` gains `DIAG?: R2Bucket`, `DIAG_UPLOAD_TOKEN?: string`, `DIAG_READ_TOKEN?: string`, all optional, each documenting what "absent" means (503 / fail-closed, never fail-open). `R2Bucket` resolves as a global — no import added.
- `wrangler.jsonc` declares `r2_buckets: [{ binding: 'DIAG', bucket_name: 'openmusic-diag' }]` with the non-inheritable-keys warning: a future `env.preview` block must re-declare BOTH `vars` and `r2_buckets` or `JAMENDO_CLIENT_ID` silently vanishes from previews.
- No token value appears anywhere in source or config; `grep -r VITE_DIAG src/ wrangler.jsonc` is empty (T-33-03).

## Task Commits

1. **Task 1: Authorization in the shared Allow-Headers + seam assertion** — `de08b44` (fix)
2. **Task 2: Env / App.Platform.env typing + wrangler r2_buckets binding** — `ca6aff5` (feat)

## Verification (observed, not assumed)

| Check | Command | Observed |
|---|---|---|
| Task 1 | `pnpm test -- http` | **7 passed** (baseline 6 → 7, the new `it`) |
| Task 2 | `pnpm check` | **4432 files, 0 errors, 0 warnings** |
| Task 2 | wrangler.jsonc parse one-liner from `<verify>` | exit 0 — `r2_buckets[0]` is `{binding:'DIAG', bucket_name:'openmusic-diag'}` and `vars.JAMENDO_CLIENT_ID` still `1df0a42f` |
| Full suite | `pnpm test` | **112 files, 2052 passed** (baseline 2051 + 1 new — no regression) |

Acceptance greps — `http.ts`: `'Content-Type, Range, Authorization'` 1, `'Content-Type, Range'` 0, `T-33-06` 1 (and 1 in `http.test.ts`). `proxy-types.ts`: `DIAG?: R2Bucket` 1, `DIAG_UPLOAD_TOKEN?: string` 1, `DIAG_READ_TOKEN?: string` 1, `workers-types` 0. `app.d.ts`: `DIAG` 3. `wrangler.jsonc`: `DIAG_*_TOKEN` outside comment lines 0. `VITE_DIAG` across `src/` + `wrangler.jsonc` 0.

**Not verified here, by design:** the live cross-origin `OPTIONS` curl against the deployed edge. That evidence belongs to Plan 07 — nothing in this plan is deployed, and pushing `main` auto-deploys production.

## Decisions Made

None beyond the plan — the three key decisions above were all specified in the plan and CONTEXT and implemented as written.

## Deviations from Plan

None — plan executed exactly as written.

Two acceptance-criteria notes, recorded for accuracy rather than as deviations:

1. The plan's wildcard-origin grep, `grep -c "Access-Control-Allow-Origin.*\*\|'\*'" src/lib/proxy/http.ts`, expects `0` but returns `2` — on the **unmodified** file too (`git show HEAD:…` returns the same 2). Both matches are pre-existing comment text: the header line "NEVER emits Access-Control-Allow-Origin: \*" and a `*/` comment terminator. The criterion's *intent* — no wildcard origin introduced — holds and is verified by the count being identical to baseline plus the two existing never-`*` tests still passing.
2. The `grep -c "workers-types" proxy-types.ts == 0` criterion (meaning "no import added") initially tripped on a doc comment that merely *named* `@cloudflare/workers-types` while explaining why no import is needed. Reworded to "the Cloudflare Workers types already listed in tsconfig `types`" before the commit — same meaning, and the grep now genuinely proves the file still has exactly one import. Same class as Plan 01's `JSON.parse` comment-token adjustment.

## Assumption Drift (advisory)

None — `corsHeaders`, `Env` and `wrangler.jsonc` matched the plan's `<interfaces>` exactly.

## Issues Encountered

None.

## User Setup Required

The R2 bucket is **declared but does not exist yet**. Before anything can write to `env.DIAG`, Plan 06's human checkpoint must create the bucket named exactly `openmusic-diag` and set `DIAG_UPLOAD_TOKEN` / `DIAG_READ_TOKEN` via `wrangler pages secret put`. Not attempted here: wrangler on this machine authenticates to the wrong Cloudflare account and fails with `Authentication error [code: 10000]`.

## Next Phase Readiness

Plans 03-05 can write `const env = platform?.env as Env | undefined;` and reach `env?.DIAG`, `env?.DIAG_UPLOAD_TOKEN`, `env?.DIAG_READ_TOKEN` with a clean typecheck, and must add **no CORS code of their own** — `hooks.server.ts` already answers every `/api/*` preflight with `corsHeaders(origin)`.

No blockers. Standing phase reminder: do not `git push` — pushing `main` auto-deploys production, and that approval lives in Plan 07.

---
*Phase: 33-activity-log-upload-for-automated-diagnosis*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 5 modified source/config files and the SUMMARY exist on disk; both task commits (`de08b44`, `ca6aff5`) are present in `git log`, plus this SUMMARY's own docs commit.
