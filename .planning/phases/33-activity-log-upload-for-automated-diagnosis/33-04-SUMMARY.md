---
phase: 33-activity-log-upload-for-automated-diagnosis
plan: 04
subsystem: api
tags: [cloudflare, r2, api, security, proxy, vitest]

# Dependency graph
requires:
  - phase: "33-01"
    provides: "bearerMatches, MAX_UPLOAD_BYTES, screenLogPayload, diagKey, isDiagKey"
  - phase: "33-02"
    provides: "Env.DIAG / DIAG_UPLOAD_TOKEN / DIAG_READ_TOKEN typing, Authorization in the CORS Allow-Headers, wrangler r2_buckets binding"
provides:
  - "POST /api/diag — bearer-gated activity-log upload storing the raw text in R2 (D-01)"
  - "GET /api/diag — read-token-gated list `{ ok, logs: [{ key, size, uploaded }] }` (D-02)"
  - "GET /api/diag?key=<key> — read-token-gated raw passthrough of one stored log (D-02)"
  - "The response contract Plan 07's deployed curls assert against: 200/400/401/404/413/503 with short `err` codes"
affects: [33-05, 33-06, 33-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route handler as a pure gate sequence: auth -> binding -> size screen -> read -> validate -> store, each step a numbered comment"
    - "Endpoint tests assert the NEGATIVE side effect (bucket.put / bucket.get not called), not just the status code"
    - "Zero-CPU passthrough of an already-serialized stored object instead of decode-then-re-encode"

key-files:
  created:
    - src/routes/api/diag/+server.ts
    - src/routes/api/diag/diag-endpoint.test.ts
  modified: []

key-decisions:
  - "ONE route file with `?key=` rather than a `[key]/+server.ts` param route — a diag key contains a `/` (`log/…`), which a path param would force callers to URL-encode; one file, two verbs, no encoding rules to remember"
  - "The fetch-one reply is the only hand-built Response in the file, and deliberately NOT jsonResponse: the stored object is already serialized JSON, so jsonResponse would encode it a second time into a JSON string. Streaming obj.body is zero-CPU under the 10 ms Workers Free budget"
  - "bucket.list() IS the index — no manifest object, so no read-modify-write race between two concurrent uploads; diagKey's ISO prefix makes R2's lexicographic order chronological"
  - "The content-length screen runs BEFORE the body read and text.length is re-checked after it — the client-supplied header is a free early-out, never the authority"
  - "Both GET shapes are gated on DIAG_READ_TOKEN only; the upload token that ships on the device gets 401 on read (T-33-07), which is the whole point of the two-token split"

patterns-established:
  - "Diagnostic endpoints answer 503 `unconfigured` for an absent binding — a SUPPORTED local/dev state, never a 500"
  - "A token-confidentiality `it` iterates EVERY status the route can produce and asserts the serialized body contains no token (T-33-02, the T-25c-01 shape)"

requirements-completed: [D-01, D-02, D-03, D-05, D-07]

# Metrics
duration: 7min
completed: 2026-09-13
---

# Phase 33 Plan 04: /api/diag Upload + Read Endpoint Summary

**One route file exposing a bearer-gated POST that stores an activity log verbatim in R2 and a read-token-gated GET that lists or streams one back, with 20 endpoint tests covering the full status matrix, the no-write-on-reject property, and token confidentiality.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-09-13T00:32Z
- **Completed:** 2026-09-13T00:39Z
- **Tasks:** 3 (2 TDD, 1 live smoke)
- **Files modified:** 2 created, 0 modified

## Accomplishments

- `POST /api/diag` runs a fixed gate sequence — auth → binding → content-length screen → read + real-size re-check → `screenLogPayload` → `bucket.put` — and every gate fails closed: an unset `DIAG_UPLOAD_TOKEN` rejects (401), an absent `DIAG` binding answers 503 rather than throwing on `undefined.put`.
- The accepted path stores the **byte-identical** uploaded text. `grep -c 'JSON.stringify'` on the route is 0: nothing on the path re-serializes, so no field `parseActionLog` does not name is silently dropped, and the 10 ms Workers Free CPU budget is not spent twice.
- `GET /api/diag` lists via `bucket.list({ prefix: 'log/' })` and `GET ?key=` streams `obj.body` through untouched. The upload token is refused on both (T-33-07) — tested with BOTH tokens configured in the env, so the 401 proves refusal rather than absence.
- An untrusted `?key=` hits `isDiagKey` (route line 95) before `bucket.get` (line 98); `../secrets` and `other/not-a-log.json` both get 400 with the mock asserting `get` was never called (T-33-09).
- Every reject path asserts the *side effect*, not just the status: `bucket.put` is proven un-called on 401 (×3), 503, 413 (×2) and 400 (×3) (T-33-05).
- The route exports exactly two names, both verb handlers. This is the landmine that shipped once as `29c1c7d`, and unit tests structurally cannot catch it — so Task 3 drove a real SvelteKit request pipeline instead.

## Task Commits

1. **Task 1 (RED)** — `dfdbc13` `test(33-04): add failing endpoint matrix for POST /api/diag`
2. **Task 1 (GREEN)** — `331d4e8` `feat(33-04): add POST /api/diag — authenticated activity-log upload to R2`
3. **Task 2 (RED)** — `95d91ad` `test(33-04): add failing GET /api/diag list + fetch-one cases`
4. **Task 2 (GREEN)** — `d5b2f28` `feat(33-04): add GET /api/diag list and ?key= fetch-one behind the read token`
5. **Task 3** — no commit: the smoke passed on the first try, and the plan specifies the task creates no code change unless a 500 surfaces.

Neither TDD task needed a REFACTOR commit — both GREEN implementations were the final shape.

## Files Created/Modified

- `src/routes/api/diag/+server.ts` (110 lines) — `POST` + `GET`, nothing else. Header comment records the asymmetric two-token posture (upload token ships on the device and is write-only; read token never leaves the laptop) and the verb-exports-only rule with its commit ref.
- `src/routes/api/diag/diag-endpoint.test.ts` (~380 lines, 20 tests) — `stubBucket()` (a `Map` plus `vi.fn` `put`/`get`/`list`, with a `Response` standing in for `R2ObjectBody` since it has both `.body` and `.text()`), `fakeEvent(method, {body, headers, env, search})` adapted from `og-endpoint.test.ts`, and `callPOST` / `callGET` shims using the tests-only `as any`.

## Verification (observed, not assumed)

| Check | Command | Observed |
|---|---|---|
| Task 1 RED | `pnpm test -- diag-endpoint` | FAIL — `Cannot find module './+server'` |
| Task 1 GREEN | `pnpm test -- diag-endpoint` | **11 passed** (≥ 10 POST cases required) |
| Task 2 RED | `pnpm test -- diag-endpoint` | FAIL — **9 failed / 11 passed**, exactly the 9 new GET cases |
| Task 2 GREEN | `pnpm test -- diag-endpoint` | **20 passed** (≥ 18 required) |
| Typecheck | `pnpm check` | **4435 files, 0 errors, 0 warnings** |
| Full suite | `pnpm test` | **113 files, 2072 passed** (baseline 2052 + 20 new — no regression) |
| Live smoke | three curls, below | **401 401 401** |

**Task 3 live dev-server smoke (the check unit tests cannot do).** No server was listening on 4321 or 5173, so `pnpm dev` was started in the background; **bare `pnpm dev` answered on 5173** (4321 is the launch.json port — the plan's `<verify>` hardcodes 4321, so the curls were re-pointed at the port that actually answered, matching the known project gotcha). Observed:

| Request | Status |
|---|---|
| `POST /api/diag -H 'content-type: application/json' -d '[]'` (no token) | **401** |
| `POST /api/diag -H 'Authorization: Bearer anything' -d '[]'` | **401** (no secret configured locally → fail closed, D-01) |
| `GET /api/diag` | **401** |
| `POST /api/diag -d '[]'` body | `{"ok":false,"err":"unauthorized"}` — exact match |

`grep -ic 'invalid export\|error'` over the captured `pnpm dev` output returned **0**. The server started for this check was stopped afterwards (post-kill probe: connection refused).

Acceptance greps on `+server.ts` — `^export const (GET|POST): RequestHandler` **2** and `^export ` **2** (no non-verb export, T-33-13); `new Response(JSON.stringify` **0**; `JSON.stringify` **0**; `corsHeaders` **0**; `waitUntil` **0**; `as any` **0**; `list({ prefix: 'log/' })` **1**; `isDiagKey(key)` **1** at line 95, earlier than `bucket.get(` at line 98; `new Response(obj.body` **1**.

## Decisions Made

None beyond the plan — the five key decisions above were all specified in the plan/CONTEXT and implemented as written.

## Deviations from Plan

None to the code. Two execution-environment notes:

1. **Dev-server port.** The plan's Task 3 `<verify>` hardcodes `localhost:4321`. Nothing was listening on 4321 or 5173, and the `pnpm dev` started here bound **5173** (bare `pnpm dev`; 4321 comes from `launch.json`). The three curls were run against 5173 — the plan's own `<action>` text says to probe rather than assume, so this is the specified behaviour, not a deviation from intent.
2. **A comment token tripped an acceptance grep.** The store step's comment originally read ``Never `JSON.stringify(parsed)` `` while explaining why the raw text is stored, which made `grep -c 'JSON.stringify' == 0` fail even though nothing called it. Reworded to "Never re-serialize the parsed entries" before the commit — same meaning, and the grep now genuinely proves there is no re-encode on the path. Same class as Plan 01's and Plan 02's identical adjustments; the pattern is now three-for-three, worth knowing when writing acceptance greps against a comment-dense house style.

## Assumption Drift (advisory)

None. Every Plan 01/02 signature in the `<interfaces>` block matched the files on disk exactly, and the plan's prediction about the harness held: undici did **not** synthesize a `content-length` for the string body, so the oversize-without-header case genuinely exercises the `text.length` re-check rather than the header screen.

## Issues Encountered

None. The one thing worth flagging for Plan 05/07: `platform` is `undefined` under both Vitest and `vite dev`, so the only coverage of the 200 paths is against the in-memory stub. The first real R2 write happens after Plan 06 provisions the bucket.

## Known Stubs

None. Both handlers are complete; the bucket they talk to is the only thing not yet real, and that is Plan 06's human checkpoint by design.

## Threat Flags

None — the route introduces no security surface outside the plan's `<threat_model>`. T-33-01, T-33-02, T-33-04, T-33-05, T-33-07, T-33-09 and T-33-13 each map to a named test or a recorded observation above.

## User Setup Required

Unchanged from Plan 02, and now blocking end-to-end use: the R2 bucket `openmusic-diag` does not exist and neither secret is set. Until Plan 06's checkpoint runs `wrangler r2 bucket create openmusic-diag` and `wrangler pages secret put DIAG_UPLOAD_TOKEN` / `DIAG_READ_TOKEN`, the deployed route answers 401 for every request (unset token → fail closed) — which is the correct locked state, not a fault.

## Next Phase Readiness

Plan 05 (the client uploader) can code against the exact response contract verified here: POST 200 `{ ok, key, entries }`, 401 `unauthorized`, 503 `unconfigured`, 413 `too-large`, 400 `invalid`. Plan 07's deployed curls have a local baseline to compare against.

No blockers. Standing phase reminder: nothing was pushed — `git push` on `main` auto-deploys production and that approval lives in Plan 07.

---
*Phase: 33-activity-log-upload-for-automated-diagnosis*
*Completed: 2026-09-13*

## Self-Check: PASSED

Both created source files and the SUMMARY exist on disk; all four task commits (`dfdbc13`, `331d4e8`, `95d91ad`, `d5b2f28`) are present in `git log`.
