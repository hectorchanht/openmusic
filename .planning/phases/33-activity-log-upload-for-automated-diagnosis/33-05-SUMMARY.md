---
phase: 33-activity-log-upload-for-automated-diagnosis
plan: 05
subsystem: ui
tags: [svelte, settings, diagnostics, ui]

# Dependency graph
requires:
  - phase: "33-03"
    provides: "settings.activityUpload / activityUploadPrompt / activityUploaded / activityUploadFailed / activityUploadEmpty in all 15 locales"
  - phase: "33-04"
    provides: "POST /api/diag response contract — 200/401/413/503/400"
provides:
  - "Settings → Activity log 'Upload log' button — the phone-side half of the phase success criterion"
  - "Device-local upload token under localStorage key openmusic:diag:v1"
affects: [33-06, 33-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Explicit-action-only network call: onclick binding + re-entrancy guard, no timer / no reactive trigger / no retry (D-04)"
    - "Runtime-entered credential (prompt + localStorage) instead of any build-time env var, so nothing lands in the public bundle"

key-files:
  created: []
  modified:
    - "src/routes/(app)/settings/activity/+page.svelte"

key-decisions:
  - "Re-entrancy guard is `if (uploading) return` at the top of the handler AND `disabled={uploading}` on the button — the disabled attribute alone is not sufficient on a touch device where a double-tap can fire before the re-render lands"
  - "The empty-log early-out compares against the literal '[]' because serializeActionLog is exactly JSON.stringify(entries); no separate length check is needed and the two call sites stay byte-identical"
  - "The 401 branch removes the stored token but does NOT re-prompt in the same handler — re-prompting would turn one tap into two requests, which is the retry D-04 forbids. The next tap re-prompts naturally because the key is gone"
  - "Comments avoid the literal strings the plan's own acceptance greps forbid (a build-time env prefix, the bare platform fetch call) — worded around them rather than weakening the gates; the fourth occurrence of this pattern in this phase"

requirements-completed: [D-03, D-04, D-06]

# Metrics
duration: 5min
completed: 2026-09-13
---

# Phase 33 Plan 05: Upload-Log Control on the Activity-Log Screen Summary

**One `Upload log` button and one `uploadLog()` handler on Settings → Activity log: it serializes the log with the same call `copyLog()` uses, prompts once for a device-local token, POSTs it through the governed `apiFetch` to `/api/diag`, flashes the result, and stops — no timer, no retry, no store change, no new styles.**

## Performance

- **Duration:** ~5 min
- **Tasks:** 1
- **Files modified:** 1 modified, 0 created

## Accomplishments

- `uploadLog()` (activity `+page.svelte`) runs a fixed sequence: re-entrancy guard → serialize → empty check → token (read or prompt-and-persist) → single `apiFetch` POST → on-device audit line → 401 token eviction → flash. Every branch terminates; no path schedules another attempt.
- The payload is produced by the **same expression** as Copy log — `serializeActionLog(actionLog.entries)`, now appearing exactly twice in the file — so what the maintainer pastes into a chat and what lands in R2 are byte-identical.
- The request goes through `apiFetch`, not the bare platform call, so a bodied POST still carries the 8-way concurrency cap, the 25 s timeout and the circuit breaker added after the three recorded fetch-flood freezes. The handler header comment records that lineage.
- The token is user-entered at runtime and stored under `openmusic:diag:v1` (try/catch on both read and write, per the house localStorage convention). There is no build-time credential in the file — the `VITE_` grep is 0 (T-33-03).
- A 401 evicts the stored token so a mistyped secret cannot wedge the button permanently; the *next* tap re-prompts. `actionLog.log('diag.upload', { status })` means the log viewer itself distinguishes 401 vs 413 vs 200 without a laptop.
- UI cost: one `<button class="item" … use:tapBounce>` inserted between Copy and Clear in the existing `.actions` row. No new component, no new page, no new CSS selector — `.item { flex: 1 }` already makes three buttons share the row. All five labels read through `t()`; zero English literals.

## Task Commits

1. **Task 1** — `eab047c` `feat(33-05): add tap-only Upload log control to Settings → Activity log`

## Verification (observed, not assumed)

| Check | Command | Observed |
|---|---|---|
| Typecheck | `pnpm check` | **4435 FILES 0 ERRORS 0 WARNINGS** (all five new `TranslationKey`s resolve) |
| Full suite | `pnpm test` | **113 files, 2072 passed** — baseline after 33-04 held exactly, no regression |
| Governed call present | `grep -c "apiFetch('/api/diag'"` | **1** |
| No raw platform fetch | `grep -cE '[^a-zA-Z]fetch\('` | **0** |
| D-04 prohibitions | `grep -cE 'setInterval\|\$effect\|onMount\(uploadLog\|import\.meta\.env\.VITE_DIAG\|fetch\('` | **0** |
| Tap-only binding | `grep -c 'onclick={uploadLog}'` | **1** |
| Shared serializer | `grep -c 'serializeActionLog(actionLog.entries)'` | **2** (copyLog + uploadLog) |
| Tap feedback on every control | `grep -c 'use:tapBounce'` | **4** (back + copy + upload + clear) |
| Token key | `grep -c 'openmusic:diag:v1'` | **1** |
| No build-time credential | `grep -c 'VITE_'` | **0** |
| 401 eviction | `grep -c 'removeItem(DIAG_TOKEN_KEY)'` | **1** |
| Style block untouched | `grep -c '<style>'` = **1**; the 4 added lines matching `{ … }` inspected individually | all four are `<script>` lines (two imports, the `headers` object, the audit call) — **zero** CSS lines added |
| Store untouched | `git status --porcelain src/lib/stores/actionLog.svelte.ts` | empty |
| No accidental deletions | `git diff --diff-filter=D --name-only HEAD~1 HEAD` | empty |

## Decisions Made

See `key-decisions` in the frontmatter. Nothing in the plan was overridden.

## Deviations from Plan

None to the code — the handler and markup are as specified.

One acceptance-gate note, same class as Plans 01/02/04 (now four-for-four in this phase): the plan's `<action>` asks for comments naming the build-time env prefix and contrasting with the raw platform call, while its own `<verify>` greps for those exact tokens and requires 0. The comments say both things in words that do not contain the forbidden literals ("a build-time env var: Vite inlines those into the public client bundle", "never the raw platform call") rather than weakening the gate. Worth knowing when authoring acceptance greps against a comment-dense house style.

## Assumption Drift (advisory)

None. `apiFetch`'s signature, `serializeActionLog`'s body (`JSON.stringify(entries)` — so an empty log really is `'[]'`), the `.actions`/`.item` markup and the bare-`confirm()` precedent on the data page all matched the plan's `<interfaces>` block exactly.

## Issues Encountered

None blocking. Carried forward from Plan 04: the R2 bucket and both secrets do not exist yet, so a real tap currently gets 401 from the deployed route and — by design — the handler evicts the just-entered token and flashes the failure string. That is the correct locked state, not a fault; provisioning is Plan 06's human checkpoint.

## Known Stubs

None. The handler is complete; only the bucket behind it is not yet real.

## Threat Flags

None — no security surface outside the plan's `<threat_model>`. T-33-03 is mitigated as specified (`VITE_` count 0, token entered at runtime); T-33-12 is mitigated by the onclick-only binding plus the re-entrancy guard plus the `apiFetch` governor; T-33-11 is the accepted device-local-storage risk with a write-only token.

## Next Phase Readiness

Plan 06 (provision bucket + secrets) and Plan 07 (deploy, then device-verify) are unblocked. Two things for Plan 07's Tier 3 device pass:

1. Confirm `prompt()` actually presents a dialog in the Capacitor Android WebView. If it does not, the fallback is an inline text input in the same `.actions` area — handler logic is unchanged, only the token-acquisition lines move.
2. On the APK the POST is cross-origin, so it exercises Plan 02's `Authorization` Allow-Headers fix (T-33-06) for the first time on a real device.

Nothing was pushed — `git push` on `main` auto-deploys production and that approval lives in Plan 07.

---
*Phase: 33-activity-log-upload-for-automated-diagnosis*
*Completed: 2026-09-13*

## Self-Check: PASSED

The modified page and this SUMMARY both exist on disk; task commit `eab047c` is present in `git log`.
