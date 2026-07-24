---
phase: 29-download-ux-folder-control
plan: 29-01
subsystem: services
tags: [download, filename, blob, anchor-download, svelte, vitest, pure-service]

# Dependency graph
requires:
  - phase: 999.1-06
    provides: blob-store native dual-write (put/get/del) + openmusic-blob-uri index this filename plumbing will extend
provides:
  - "download-filename.ts — pure buildDownloadFilename + extFromAudioUrl (the ONE shared {artist} - {title}.{ext} shape, D-08)"
  - "download-save.ts — saveBlobToDisk anchor seam replacing showSaveFilePicker + window.open (DL-BUG-01)"
  - "Node-testable seams for DL-FILE-01 and DL-BUG-01 (both mock-free, no jsdom)"
affects: [29-03 download-track, 29-05 native, 29-06 migration, TrackMenu, album-page, blob-store]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure/node-testable download services (.ts, no runes, no store import) — caller supplies names.dn* result"
    - "DOM-thin injectable seam: saveBlobToDisk(blob, filename, doc = globalThis.document) drives a fake document in node"
    - "Source-grep guardrail test: saveBlobToDisk.toString() asserts absence of window.open / showSaveFilePicker"

key-files:
  created:
    - src/lib/services/download-filename.ts
    - src/lib/services/download-filename.test.ts
    - src/lib/services/download-save.ts
    - src/lib/services/download-save.test.ts
  modified: []

key-decisions:
  - "Kept forbidden tokens (window.open / showSaveFilePicker) out of the function body entirely so the toString()-grep guardrail is robust regardless of comment content"
  - "Resolve URL object-URL API at call time from globalThis (not module load) so SSR/native degrade to false and node can stub it"

patterns-established:
  - "One shared pure filename builder (D-08) — no more per-call-site drift of the {artist} - {title}.{ext} sanitize shape"
  - "Failure = return value, never navigation — the DL-BUG-01 seam contract"

requirements-completed: [DL-FILE-01, DL-BUG-01]

# Metrics
duration: 5min
completed: 2026-07-24
---

# Phase 29 Plan 01: Download Service Seams Summary

**Two pure download services — `buildDownloadFilename`/`extFromAudioUrl` (the shared `{artist} - {title}.{ext}` builder) and `saveBlobToDisk` (an anchor-download seam that returns `false` instead of navigating on failure) — both node-tested without jsdom.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-24T03:43:14Z
- **Completed:** 2026-07-24T03:48:18Z
- **Tasks:** 2 (both TDD — 4 task commits)
- **Files created:** 4

## Accomplishments
- `download-filename.ts` consolidates the `{artist} - {title}.{ext}` + verbatim sanitize class (`/[/\\?%*:|"<>]/g`) that had drifted across TrackMenu (L204) and the album page (L395) into ONE pure, store-free helper (D-08). `extFromAudioUrl` query-strips + lowercases the container ext, defaulting to `mp3` (D-06).
- `download-save.ts` provides `saveBlobToDisk` — the anchor `<a download>` on a `blob:` object URL that REPLACES the buggy `showSaveFilePicker` prompt (D-02) and the `window.open` new-tab fallback (D-09/DL-BUG-01). A failure is a `return false`, never a navigation; the object URL is revoked on every exit.
- Both DL-FILE-01 and DL-BUG-01 now have mock-free node test seams (the Vitest project has no jsdom): the filename builder is pure, and the save seam is `doc`-injectable so a fake document drives it.

## Task Commits

Each task was committed atomically (TDD test → feat):

1. **Task 1 RED: download-filename failing test** - `00e1fd9` (test)
2. **Task 1 GREEN: download-filename helpers** - `57d7bb8` (feat)
3. **Task 2 RED: download-save failing test** - `195dbc6` (test)
4. **Task 2 GREEN: download-save anchor seam (+ test-assumption fix)** - `c9b8f69` (feat)

**Plan metadata:** _(this commit)_ `docs(29-01): complete download service seams plan`

## Files Created/Modified
- `src/lib/services/download-filename.ts` - Pure `buildDownloadFilename(artist, title, ext)` + `extFromAudioUrl(audioUrl)`; no store/DOM coupling.
- `src/lib/services/download-filename.test.ts` - 7 tests: each ext / query-strip / case-insensitive / unknown→mp3 / translated-CJK / raw / full-reserved-class sanitize.
- `src/lib/services/download-save.ts` - `saveBlobToDisk(blob, filename, doc?)` anchor seam; call-time URL resolution; revoke-in-finally; provably no navigation fallback.
- `src/lib/services/download-save.test.ts` - 6 tests: module shape / happy path (createElement/download/href/click-once/revoke) / three failure paths / source-grep guarantee.

## Decisions Made
- **Forbidden tokens kept out of the function body:** the DL-BUG-01 guardrail test greps `saveBlobToDisk.toString()`; to make that robust the function body describes the dropped paths in prose only, so a future edit re-adding `window.open`/`showSaveFilePicker` fails the test loudly.
- **Call-time object-URL resolution:** `globalThis.URL` is read inside the function (not at module load) so SSR/native contexts without `createObjectURL` degrade to `false` and the node test can stub it.
- Verbatim reuse of TrackMenu's sanitize char class rather than inventing a new one (per plan action + T-29-01-01 mitigation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected a node-environment assumption in the download-save test**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** The "object-URL API absent" test assumed Node's global `URL` lacks `createObjectURL`. Node 22 (this repo's runtime) DOES ship `URL.createObjectURL`, so the guard was not exercised and the test failed (it saved a real blob and returned `true`). The `download-save.ts` implementation was correct — the test's premise was wrong.
- **Fix:** Stubbed `URL` as an empty object (`vi.stubGlobal('URL', {})`) so the missing-API guard is genuinely exercised; also asserted `createElement` is never called on that path.
- **Files modified:** src/lib/services/download-save.test.ts
- **Verification:** `pnpm test -- download-save` → 6/6 green.
- **Committed in:** `c9b8f69` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug — test assumption)
**Impact on plan:** No implementation change; the fix corrected a faulty test premise about the Node 22 runtime. No scope creep.

## Issues Encountered
- A concurrent commit (`914ab3e feat(player): show playing Song • Artist in the browser tab`) from another session landed on `main` after this plan's task commits. All four 29-01 task commits are intact below it; no interference (separate files). Noted, no action needed.

## TDD Gate Compliance
Plan `type: tdd`. Both tasks followed RED → GREEN:
- Task 1: `test(29-01)` `00e1fd9` (RED, module-not-found) → `feat(29-01)` `57d7bb8` (GREEN, 7/7).
- Task 2: `test(29-01)` `195dbc6` (RED, module-not-found) → `feat(29-01)` `c9b8f69` (GREEN, 6/6).
No REFACTOR commit needed (helpers were minimal by construction). No test passed unexpectedly during RED.

## Verification
- `pnpm test -- download-filename download-save` → 2 files, 13 tests passed.
- `pnpm check` → 4342 files, 0 errors, 0 warnings.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The two shared seams are ready for the downstream plans to import directly (no exploration needed):
  - `buildDownloadFilename` / `extFromAudioUrl` → 29-03 (TrackMenu/album rewire), 29-05 (native `nativeFileName`), 29-06 (migration filename rebuild).
  - `saveBlobToDisk` → 29-03 (replace the TrackMenu/album save flow; delete the `showSaveFilePicker` + `window.open` halves).
- No blockers. DL-FOLDER-01 / DL-MIGRATE-01 (native Kotlin + device UAT) remain in later waves as planned.

## Self-Check: PASSED
All 4 created source files present on disk; all 4 task commits (`00e1fd9`, `57d7bb8`, `195dbc6`, `c9b8f69`) found in git history.

---
*Phase: 29-download-ux-folder-control*
*Completed: 2026-07-24*
