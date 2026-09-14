---
phase: 35-one-click-export-and-import-of-all-app-data
plan: 01
subsystem: backup
tags: [backup, restore, localstorage, pure-logic, validator]
requires: []
provides:
  - "$lib/backup/backup-logic: BACKUP_MAGIC, BACKUP_FORMAT, LIBRARY_KEY, SETTINGS_KEY, NAME_TR_PREFIX, UNDO_KEY, BACKUP_EXACT_KEYS, MIGRATIONS, backupFilename, storageKeys, buildEnvelope, serializeEnvelope, validateEnvelope, applyEnvelope, undoImport, hasUndoSnapshot"
  - "types: BackupEnvelope, BackupReject, ValidateResult, ApplyResult"
affects:
  - "plan 03 (backup-io, sweep) and plan 04 (settings/data page) import this contract by name"
tech-stack:
  added: []
  patterns:
    - "pure .ts logic module beside history-logic.ts / search-history-logic.ts, co-located tests"
    - "never-throw service returning a typed discriminated union instead of a bare sentinel"
    - "dependency injection (read closure, Storage objects) instead of vi.stubGlobal"
key-files:
  created:
    - src/lib/backup/backup-logic.ts
    - src/lib/backup/backup-logic.test.ts
    - src/lib/backup/backup-roundtrip.svelte.test.ts
  modified: []
decisions:
  - "Rollback snapshot goes to the per-tab Storage passed as `undo`, never to the persistent store (quota: 5 live keys already ~740 KB of a ~5 MB origin budget, and library.save()'s quota catch is silent)"
  - "A snapshot that cannot be stored ABORTS the import before any write — refuse rather than proceed without a safety net (35-D-09)"
  - "Library wipe is a plain removeItem, not library.clearAll(), so no runes singleton mutates before the 35-D-13 reload"
  - "BACKUP_FORMAT is a hardcoded integer — there is no client-visible app version to inject (package.json is a never-bumped 0.0.1)"
  - "name-tr is enumerated as a PREFIX FAMILY via Storage.key(i)/length; a single getItem would silently ship an empty cache"
  - "MIGRATIONS ships empty; an unknown version of a known domain is refused per-key and named in `skipped`"
metrics:
  duration: ~25 min
  completed: 2026-09-13
---

# Phase 35 Plan 01: Backup Codec Core Summary

Pure, node-testable backup/restore core: a synchronous envelope builder over the four exact keys plus the `openmusic:name-tr:` prefix family, a never-throw validator with three distinguishable reject reasons in a fixed precedence, and an all-or-nothing apply that snapshots to an injected Storage before wiping and rolls back on a mid-write failure.

## What Was Built

`src/lib/backup/backup-logic.ts` (~330 lines) — no runes, no app-environment import, no i18n import, no storage globals. Every entry point takes its inputs as parameters (a `read` closure, a key list, `Storage` objects), so both test files drive it from plain `Map`s.

- `buildEnvelope` — four exact keys (`library:v1`, `history:v1`, `search-history:v1`, `settings:v1`) plus every `openmusic:name-tr:*` key found in the supplied key list. Synchronous (iOS gesture rule). A corrupt local value is skipped, never an abort.
- `validateEnvelope` — parse → is-an-object → magic → format → keys map → per-key shape. The magic is checked before the format so a foreign `{"format":99}` reads "not an OpenMusic backup", not "newer version". Any shape failure rejects the WHOLE file (35-D-10), which is the documented divergence from `parseSearchHistory`'s filter-and-continue.
- `applyEnvelope` / `undoImport` / `hasUndoSnapshot` — snapshot → wipe → write, with the snapshot built by the same `buildEnvelope` (no second serializer) and a best-effort rollback through the same validator.

The library array guard is load-bearing rather than belt-and-braces: `library.load()` casts `liked`/`playlists`/`downloads` with only a `?? []` fallback, so a hostile `{"liked": 5}` would reach the store and the home shelves would `.map()` over a number (Pitfall 7 / T-35-02).

## Task Commits

| Task | Gate | Commit | Files |
|---|---|---|---|
| 1 | RED | `28d85a8` | `backup-logic.test.ts` |
| 1 | GREEN | `36523a4` | `backup-logic.ts` + test |
| 2 | RED | `3f6c743` | `backup-logic.test.ts` (atomic/undo) |
| 2 | GREEN | `f803d17` | `backup-logic.ts` (apply/undo half) |
| 3 | — | `282ba63` | `backup-roundtrip.svelte.test.ts` |

## Verification — observed output

All commands run from the repo root; output is quoted, not paraphrased.

`npx vitest run src/lib/backup/`
```
 Test Files  2 passed (2)
      Tests  38 passed (38)
```

`npx vitest run src/lib/backup/backup-logic.test.ts -t "atomic"` → `Tests  4 passed | 32 skipped (36)`
`npx vitest run src/lib/backup/backup-logic.test.ts -t "undo"` → `Tests  4 passed | 32 skipped (36)`
`npx vitest run src/lib/backup/backup-roundtrip.svelte.test.ts` → `Tests  2 passed (2)`

`pnpm check`
```
COMPLETED 4442 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

`pnpm test` (full suite, after the last commit)
```
 Test Files  117 passed (117)
      Tests  2155 passed (2155)
```

Acceptance greps on `src/lib/backup/backup-logic.ts`, observed counts:

| Grep | Required | Observed |
|---|---|---|
| `from '$lib/stores/` | 0 | 0 |
| `$lib/i18n` / `$app/environment` / runes marker | 0 | 0 |
| `async` | 0 | 0 |
| `as any` | 0 | 0 |
| `localStorage` / `sessionStorage` / `location.` | 0 | 0 |
| `export const BACKUP_FORMAT = 1` | match | line 30 |
| `export const NAME_TR_PREFIX = 'openmusic:name-tr:'` | match | line 50 |
| `export const MIGRATIONS … = {}` | match | line 68 |
| `clearAll` | comment only | line 280, inside the 35-D-08 explanation |
| `applyEnvelope` / `undoImport` / `hasUndoSnapshot` exports | 3 | 3 |

On `backup-roundtrip.svelte.test.ts`: `vi.stubGlobal('sessionStorage'` → 1, `vi.resetModules()` → 1, `names.svelte` → 0, and `await import('$lib/stores/library.svelte')` present at line 108.

Describe blocks, all selectable by the `35-VALIDATION.md` `-t` filters: `envelope`, `never exports`, `envelope shape`, `filename`, `reject reason`, `migration`, `array guard`, `atomic`, `undo`.

## must_haves — status

| Truth | Status |
|---|---|
| Envelope over all 14 keys yields exactly the 4 exact keys + every name-tr key, never player/diag | verified — `envelope` + `never exports` |
| Validator returns not-ours / newer / damaged in precedence order and never throws | verified — `reject reason` (11 cases) |
| applyEnvelope writes nothing when the snapshot cannot be stored; restores on a mid-write failure | verified — `atomic` cases 1 and 3, both assert the live Map deep-equals its pre-call contents |
| After apply + resetModules, the four stores' `load()` reproduce the exported state | verified — round-trip test 1 |
| undoImport restores the live store byte-for-byte and removes the snapshot | verified — `undo` + round-trip test 2 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `svelte-check` rejected an inline throwing `length` getter in the test**

- **Found during:** Task 1
- **Issue:** `storageKeys({ get length() { throw … } })` infers `void`, which is not assignable to `Pick<Storage,'length'>`.
- **Fix:** Hoisted the hostile store to a typed `const hostile: Pick<Storage, 'length' | 'key'>` with an explicit `: number` getter return type. No `as any` (the project bans it outside tests, and it was avoidable here anyway).
- **Files modified:** `src/lib/backup/backup-logic.test.ts`
- **Commit:** `36523a4`

**2. [Rule 3 - Blocking] Plan wording collided with its own acceptance greps**

- **Found during:** Task 1
- **Issue:** The plan asks for a header declaring the module imports no `$app/environment` / `$lib/i18n`, and for a comment saying "the page passes `localStorage` as `live`" — but the acceptance criteria require those exact substrings to appear **zero** times in the file.
- **Fix:** Same meaning, different words: "no app-environment import, no i18n import", "the page passes a getItem closure over the live store", "the persistent store" / "the per-tab store". The prohibition is enforced, the decision record is intact.
- **Files modified:** `src/lib/backup/backup-logic.ts`
- **Commit:** `36523a4`

### Assumption Drift (advisory)

**1. Task 3's TDD RED gate degenerates**

- **Found during:** Task 3
- **Planned:** the task carries `tdd="true"`.
- **Actual:** Task 3 creates a test file only — there is no implementation to add, so the test passed on its first run against the Tasks 1-2 code. It is committed as a single `test(...)` commit, not a RED/GREEN pair.
- **Why it is fine:** the test is not vacuous — `exportWipeImport()` asserts `applyEnvelope(...) === 'ok'` before any store loads, and the store assertions are full deep-equals over two `Track` objects (including the `songMid`/`duration` extras) plus a byte-for-byte Map comparison for undo.

### Notes on the concurrent session

The dispatch warning listed untracked phase-34/36 planning files and `docs/agents/`. Those were committed by the other session before my first commit; `git status --short` was empty at every commit point in this plan, and only the three files in `files_modified` were ever staged.

## TDD Gate Compliance

Tasks 1 and 2 each have a `test(...)` RED commit followed by a `feat(...)` GREEN commit (`28d85a8` → `36523a4`, `3f6c743` → `f803d17`). No REFACTOR commit was needed. Task 3 is test-only — see the drift note above.

## Known Stubs

None. `MIGRATIONS` is deliberately an empty `Record` with a comment, not a stub: no exported key has ever bumped its version segment, and 35-RESEARCH Answer 2 explicitly warns against building a framework for an empty table.

## Threat Flags

None. Every file touched is inside the plan's declared threat model: `validateEnvelope` mitigates T-35-01/T-35-02, `buildEnvelope`'s key set mitigates T-35-04 (pinned by the "never exports" tests), `applyEnvelope`'s refuse-then-rollback mitigates T-35-05, and `backupFilename` is app-generated (T-35-06). No new network, auth, or file-access surface — this plan adds no I/O at all.

## Follow-ups for later plans

- Plan 03/04 must pass the **per-tab** Storage as `undo`. Passing the persistent store would reintroduce the quota hazard this plan's storage split exists to avoid.
- 35-VALIDATION.md's open risk stands: that the per-tab store survives `location.reload()` in the Capacitor WebView is a standards expectation, unverified on this stack. Probe it before shipping the Undo affordance (plan 04).
- `validateEnvelope` treats `openmusic:library:tab` (a machine-local UI key) as an unknown version of the `openmusic:library:` domain, so a hand-edited file containing it would list it in `skipped`. Harmless — it is never exported — but worth knowing if a skipped-key message ever looks odd.

## Self-Check: PASSED

All three source artifacts and this SUMMARY exist on disk; all six commits (`28d85a8`, `36523a4`, `3f6c743`, `f803d17`, `282ba63`, `f46613c`) resolve in `git log`.

## STATE.md concurrency note

`.planning/STATE.md` carries a SINGLE position cursor, and at execution time it read `Phase: 36 … Plan: 2 of 5` — the other session's phase. Running `state.advance-plan` therefore moved **Phase 36's** pointer to `3 of 5`. That line was reverted by hand immediately; phase 35 did not claim the cursor. Everything else recorded here is additive and non-colliding: the `Phase 35 P01` metrics row, the Phase 35 decision entry, the global `completed_plans` 53 → 54, and the ROADMAP Phase 35 row (`1/6 plans executed`, `35-01` checked).

Worth fixing upstream: with two sessions executing different phases in one working tree, `state.advance-plan` mutates whichever phase the cursor happens to point at, with no phase argument to guard it.
