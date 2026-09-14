## Deferred: pnpm check red from Phase 35's TDD-RED file (found during 36-01 Task 2)

`pnpm check` reports 2 errors, both in `src/lib/backup/backup-logic.test.ts`:
- 24:8 `Cannot find module './backup-logic' or its corresponding type declarations.`
- 87:48 `Parameter 'i' implicitly has an 'any' type.`

Not caused by 36-01. That file is a committed TDD RED test from the concurrently-executing
Phase 35 (one-click export/import); its `backup-logic.ts` implementation does not exist yet.
It landed on `main` between 36-01 Task 1 (`pnpm check` = 4439 files / 0 errors) and Task 2
(4440 files / 2 errors). Zero errors are reported in any file 36-01 touched.

Owner: Phase 35 GREEN plan. Do not fix here.
