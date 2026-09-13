---
phase: 33-activity-log-upload-for-automated-diagnosis
plan: 07
subsystem: deploy
tags: [deploy, verification, cloudflare, r2, cors, android]

# Dependency graph
requires:
  - phase: "33-04"
    provides: "/api/diag — the route whose live status codes this plan measures"
  - phase: "33-05"
    provides: "Settings → Activity log Upload-log button — the Tier-3 device surface"
  - phase: "33-06"
    provides: "R2 bucket openmusic-diag + both Pages secrets — without these every authenticated call is 503/401"
provides:
  - "Production /api/diag on openmusic.lol, Tier-2 verified end to end (D-01/D-02/D-05/D-07)"
  - "Proof that the route module has no illegal export (a 200 is the only proof — T-33-13)"
  - "Proof the CORS Authorization Allow-Header is live at the edge (T-33-06)"
  - "The recorded failure mode: an r2_buckets binding declared before the bucket exists breaks the Pages build"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Provision the R2 bucket BEFORE pushing a wrangler.jsonc that declares its binding — Pages validates bindings at build time"
    - "Tier-2 curls must send `content-type: application/json`; without it Cloudflare rejects with 403 upstream of the app and masks the real status"

key-files:
  created:
    - .planning/phases/33-activity-log-upload-for-automated-diagnosis/33-07-SUMMARY.md
  modified: []

key-decisions:
  - "Task 1's push approval was given by the user in-session; origin/main is at 40b1cab with every Phase 33 commit deployed"
  - "The Tier-2 matrix was run ONCE against production by the orchestrator and the three synthetic objects deleted afterwards, so the bucket is empty and the user's device upload will be the first real object"
  - "Task 3 (Tier-3 device round trip) is human-only and remains open — the phase's actual success criterion is not yet observed"

requirements-completed: [D-01, D-02, D-05]
requirements-pending: [D-04, D-06]

# Metrics
duration: ~20min (incl. deploy wait + human approval)
completed: 2026-09-13
---

# Phase 33 Plan 07: Deploy + Tier-2 Verification Summary

**`/api/diag` is live on openmusic.lol and passed all eleven Tier-2 checks against the real edge — the R2 binding resolves, both secrets reached `platform.env`, the two-token read/write asymmetry holds, oversize returns a clean 413 inside the CPU budget, and the `Authorization` preflight header is live; the Tier-3 phone→laptop round trip is the one thing left and it is human-only.**

## Performance

- **Duration:** ~20 min wall clock, mostly the Pages build + the deploy-failure diagnosis
- **Tasks:** 3 (1 approval checkpoint ✅, 1 auto ✅, 1 human checkpoint ⏸ PENDING)
- **Files modified:** 0 source files — this plan ships and measures, it does not build

## Task Status

| Task | Name | Status | Evidence |
|---|---|---|---|
| 1 | Approve the push to main | ✅ **DONE** | User approved in-session; `origin/main` == `HEAD` == `40b1cab` |
| 2 | Push, deploy, Tier-2 curl matrix | ✅ **DONE** | Eleven observed status codes below |
| 3 | Tier 3 — phone upload, laptop fetch | ⏸ **PENDING HUMAN** | Device-only; checkpoint instructions returned to the orchestrator |

**No task commits.** This plan touches no source file; the only artifact is this SUMMARY.

## Task 1 — Push approved and deployed

`git rev-parse origin/main` and `git rev-parse HEAD` both return **`40b1cab`** — every Phase 33
commit (`33-01` through `33-06`) is on the production branch. Cloudflare Pages' native Git
integration built and deployed it. Nothing is held back.

## Task 2 — Deploy history and the build failure that mattered

`wrangler pages deployment list --project-name openmusic`:

| Deployment | Commit | Result |
|---|---|---|
| `c70c76d6` | `9dba501` | **Failure** |
| `2b9e232d` | `a172f59` | **Active** — current production |

**Root cause of the failed build, confirmed by timing — this is the phase's most transferable
lesson.** The `9dba501` build started at **12:15:53** local. The R2 bucket `openmusic-diag` was not
created until **12:19:38** (creation timestamp recorded in 33-06-SUMMARY.md). The Pages build
validated `wrangler.jsonc`'s `r2_buckets` declaration against a bucket that did not yet exist and
failed. The *identical source* built green as `a172f59` once the bucket was real.

`pnpm build` locally always succeeded, at every point. **This was never a code defect** — it is a
build-time binding-validation gate that only exists on Pages. Declaring an `r2_buckets` binding in
`wrangler.jsonc` before creating the bucket breaks the Pages build, and the local build will not
warn you. Plan 02 declared the binding; Plan 06 created the bucket; the ordering between them was
the whole failure.

### Tier-2 matrix — all observed against production

`https://openmusic.lol` and the deployment URL `https://2b9e232d.openmusic.pages.dev` behave
identically on every row.

| # | Case | Expected | Observed |
|---|---|---|---|
| 1 | POST, no token | 401 | **401** `{"ok":false,"err":"unauthorized"}` |
| 2 | POST, wrong token | 401 | **401** `{"ok":false,"err":"unauthorized"}` |
| 3 | POST, valid upload token | 200 + key | **200** `{"ok":true,"key":"log/2026-09-13T18-26-15-465Z-57fc03b7.json","entries":3}` |
| 4 | GET list, read token | 200 + keys | **200** `{"ok":true,"logs":[{…,"size":187,…}]}` |
| 5 | GET list, **upload** token | 401 (asymmetry) | **401** |
| 6 | GET list, no token | 401 | **401** |
| 7 | POST oversize (~800 KB) | 413, NOT a 5xx | **413** `{"ok":false,"err":"too-large"}` |
| 8 | POST malformed body | 400 | **400** `{"ok":false,"err":"invalid"}` |
| 9 | GET `?key=<real key>` | 200 + exact bytes | **200**, the uploaded log returned byte-for-byte |
| 10 | GET `?key=../etc/passwd` | 400 invalid-key | **400** |
| 11 | OPTIONS preflight w/ `Authorization` | header advertised | `access-control-allow-headers: Content-Type, Range, Authorization` |

**What each row proves** (the Manual-Only table in 33-VALIDATION.md, now discharged):

- Row 3's **200** is the only possible proof that `+server.ts` has **no illegal export** (T-33-13) — the failure mode that 500'd production once at `29c1c7d`. Unit tests import the module directly and structurally cannot catch it.
- Row 3 also proves `env.DIAG` resolves at the edge (`platform` is `undefined` under both Vitest and `vite dev`) and that `wrangler pages secret put` values reached `platform.env`.
- Rows 3→4→9 prove R2 **list-after-write and read-after-write** consistency on the real store, not a test harness's in-memory Map.
- Row 5 proves the **two-token asymmetry** (T-33-07): the token that lives on the phone cannot read anything back.
- Row 7 proves the Workers Free **10 ms CPU budget holds** for a full oversize payload (T-33-04) — a 5xx here would have forced lowering `MAX_UPLOAD_BYTES`.
- Row 11 proves the Plan 02 CORS `Allow-Headers` fix is live on the deployed seam (T-33-06) — the header the APK's cross-origin preflight depends on.

### Independently re-confirmed at SUMMARY time

The two non-writing checks from the plan's `<verify>` were re-run in this executor's own shell
(deliberately not the writing ones — see Cleanup):

```
POST no-token:            401
OPTIONS preflight:        HTTP/2 204
                          access-control-allow-origin: https://localhost
                          access-control-allow-headers: Content-Type, Range, Authorization
```

Note `access-control-allow-origin: https://localhost` — the allowlisted origin echoed back, never
`*` (T-33-10 holds).

### Test-harness artifact — do NOT chase this as a WAF bug

Three curls initially returned **403** instead of 401/413/400. The cause was the orchestrator's
curl **omitting `content-type: application/json`**, which Cloudflare rejects upstream of the
application. Adding the header produced the correct codes every time. **Our route never emits 403 on
any path.** Recorded because a future reader seeing a 403 in a transcript would reasonably suspect a
WAF rule or a binding problem, and would be wrong.

### Cleanup

The three synthetic test objects written during the matrix were deleted
(`wrangler r2 object delete` ×3, all reporting "Delete complete."). **The bucket is empty.** The
first real object will be the user's own device upload — which makes the Task 3 verification
unambiguous: whatever is listed is what the phone just sent.

The Tier-2 matrix was **not** re-run while writing this SUMMARY, precisely to keep that true.

## Task 3 — Tier 3, pending human (device-only)

Not automatable from here. `prompt()` behaviour in the Capacitor Android WebView and a real
cross-origin preflight from the APK have no node/Vitest analogue. The checkpoint instructions
(APK build with the `JAVA_HOME` gotcha, which token goes on the device, the laptop-side fetch) were
returned to the orchestrator.

**Two unknowns the device test exists to settle:**

1. **Does `prompt()` work in the Capacitor Android WebView?** If no prompt appears, assumption A1 failed and the pre-planned fallback is an inline text input on the Activity-log screen.
2. **Does the cross-origin preflight carrying `Authorization` succeed from the APK?** The APK's WebView origin is `https://localhost` while the API is `https://openmusic.lol`. Row 11 proves the server advertises the header; only the device proves the browser accepts the round trip. A CORS failure shows **no** `diag.upload {status}` row in the Activity log — that absence is the diagnostic signal.

**Standing token rule, restated because it is a security control:** the **UPLOAD** token goes on the
phone. The **READ** token never touches a device (T-33-07) — it lives in the gitignored `.dev.vars`
on the laptop and is used only from `curl`. Row 5 above is the server-side enforcement of exactly
this.

## Decisions Made

- **Do not re-run the Tier-2 matrix for SUMMARY-time verification.** Re-running writes junk objects into a bucket whose emptiness is itself part of the Task 3 verification design. The two non-writing checks were re-run instead; the nine writing/reading rows are recorded as observed by the orchestrator.
- **Do not pre-build the APK in this executor.** Task 3's instructions hand the user a `pnpm apk` invocation they run on their own machine anyway; building it here would burn several minutes of gradle for an artifact the user's own command regenerates.

## Deviations from Plan

### Plan steps already satisfied before this executor started

**1. Task 1 (push approval) was granted and executed in-session, outside this executor.** The plan
scripts a blocking `checkpoint:human-verify` before any `git push`. The user gave that approval
directly to the orchestrator and the push happened. Re-running the checkpoint would have asked for
an approval already given. Recorded as complete-with-evidence (`origin/main == HEAD == 40b1cab`)
rather than re-executed.

**2. Task 2 (the Tier-2 matrix) was run by the orchestrator against production.** Its eleven results
are transcribed above. This executor re-ran only the two non-writing checks. The plan's intent —
"every status code observed against the live edge and recorded" — is satisfied; the actor differs.

### Plan-vs-reality gaps worth recording

**3. The plan's failure playbook anticipated the wrong failure.** Task 2 step 5 scripted responses
for a **503 on curl (c)** ("the R2 binding was not applied to the Git deploy → add it in the Pages
dashboard") and a **500** ("illegal export"). Neither occurred. The actual failure landed one stage
earlier and was invisible to that playbook: the **build itself failed** on the deploy before the
one that went live, because the binding was declared before the bucket existed. Had the bucket never
been created, the symptom would have been a stale production bundle with no `/api/diag` at all —
not a 503 from a fresh one. A build-failure check belongs alongside the runtime-status checks in any
future "declare a binding, then deploy" plan.

**4. The sample payload was not the planned 1500-entry / ~130 KB log.** The plan's step 3 builds a
realistic full-session log; the observed row 3 reports `"entries":3`. The size cap was still
exercised independently by row 7's ~800 KB body returning 413, so the CPU-budget claim (T-33-04)
holds. What is *not* directly observed is a realistic mid-size (~130 KB) upload — though it sits
comfortably between a proven-accepted 3-entry body and a proven-rejected 800 KB one.

## Assumption Drift (advisory)

**1. Which layer the "unobservable locally" risk actually lives in.** Planned (the objective, and
33-VALIDATION's Manual-Only table): the R2 binding, the secrets, the CPU budget, the CORS preflight
and the verb-exports rule are unobservable locally **at request time** — hence a Tier-2 curl matrix
against a running deploy. Actual: the first real bite came at **build time**, from Pages validating
the `r2_buckets` declaration against a nonexistent bucket. `pnpm build` locally never gates on
binding existence, so the local build is green in a state where the deploy cannot exist at all.
Why it matters: "verify against the deployed edge" implicitly assumes there *is* a deployed edge —
the deployment list is evidence in its own right and should be read before any curl.

**2. What the Tier-2 matrix would need to defend against.** Planned: the sharp edge is our own code
(an illegal export 500, a CPU-limit 5xx, a missing Allow-Header). Actual: our code was clean on
every row; the only wrong status codes in the whole exercise (three 403s) came from the **test
harness** — a curl missing `content-type`. Advisory: a verification transcript needs its own
harness sanity check, or the harness's bugs get attributed to the system under test.

## Issues Encountered

- One failed Pages build (`c70c76d6` / `9dba501`) — diagnosed by timestamp comparison against the bucket's creation time, not by log-reading guesswork. Self-resolved on the next deploy; no code change was needed or made.
- Three transient 403s from a malformed curl. Resolved by adding `content-type: application/json`.

## User Setup Required

**Task 3 remains.** Full instructions are in the checkpoint returned with this plan. In short: build
and install the APK (`JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home pnpm
apk`), play a couple of tracks, then Settings → Activity log → **Upload log**, paste the
`DIAG_UPLOAD_TOKEN` from `.dev.vars` (never the read token), and fetch the result from the laptop
with the `DIAG_READ_TOKEN`.

## Next Phase Readiness

Production-side, the phase is done: `/api/diag` enforces D-01/D-02/D-05 on the real edge and stores
and serves via R2 (D-07). **D-04 and D-06 — one tap on the phone, in the user's language — are
construction-complete but not device-observed.** The phase's stated success criterion ("phone tap,
laptop read, zero copy-paste") is not yet met until Task 3 runs. Treat Phase 33 as 6.5/7 until the
device round trip is confirmed or a failure is classified against A1 / T-33-06 / binding / token.

---
*Phase: 33-activity-log-upload-for-automated-diagnosis*
*Completed (Tasks 1–2): 2026-09-13 — Task 3 pending human*

## Self-Check: PASSED

- `33-07-SUMMARY.md` exists on disk.
- No task commits to verify — this plan modifies no source file, by design.
- `git rev-parse origin/main` == `git rev-parse HEAD` == `40b1cab` (Task 1 evidence re-verified in this executor's shell).
- Re-ran in this executor's shell: `POST /api/diag` with no token → **401**; `OPTIONS` preflight → **204** with `access-control-allow-headers: Content-Type, Range, Authorization` and `access-control-allow-origin: https://localhost`.
- Secret-safety gate: `grep -cE '[0-9a-f]{64}' 33-07-SUMMARY.md` → **0**. No token value appears anywhere in this file.
