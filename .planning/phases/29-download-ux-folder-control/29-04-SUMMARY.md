---
phase: 29-download-ux-folder-control
plan: 04
subsystem: ui
tags: [svelte5, runes, download, tri-state, i18n, tapBounce]

# Dependency graph
requires:
  - phase: 29-03
    provides: downloadTrack service (shared, never-throws, never-navigates save path) + download-save/download-filename
  - phase: 29-02
    provides: library.downloading Set + begin/endDownload, isDownloaded; menu.downloaded + toast.downloadFailedKeptInLibrary i18n keys
provides:
  - Shared DownloadControl.svelte tri-state control (idle → downloading → downloaded), keyed per uid
  - Every download-initiation surface (⋮ menu, library rows, album rows) routes through downloadTrack
  - window.open + showSaveFilePicker fully removed from TrackMenu + album (DL-BUG-01 closed)
  - CompactRow (home/search) passive "Downloaded" badge; initiation stays in the ⋮ menu there
affects: [29-05, download-ux, native-download]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared per-song tri-state control reads library.downloading/isDownloaded (uid-keyed isolation)"
    - ".row-line flex wrapper: swipe-wrap (flex 1) + trailing control as its own tap target (mirrors CompactRow .crow-wrap)"
    - "Album stubs: resolve-on-tap via a `resolve` closure passed to DownloadControl (lazy, per Pitfall 11)"

key-files:
  created:
    - src/lib/components/DownloadControl.svelte
  modified:
    - src/lib/components/TrackMenu.svelte
    - src/routes/(app)/album/[name]/+page.svelte
    - src/routes/(app)/library/+page.svelte
    - src/lib/components/CompactRow.svelte

key-decisions:
  - "TrackMenu keeps a thin doDownload that delegates to downloadTrack (satisfies the import-downloadTrack contract) rather than embedding DownloadControl; the menu row is tri-state inline via library.downloading/isDownloaded (D-12)."
  - "Album rows are {artist,title} stubs: DownloadControl takes track={null} + a resolve closure; per-uid state only surfaces after a resolve (idle until first tap) — acceptable for stubs."
  - "Album downloads pass persist:false (no offline blob / native public-folder copy this phase — RESEARCH Open Q2); only the human filename + the bug-fix apply."
  - "CompactRow gets a PASSIVE badge only (no tap target); initiation stays in the ⋮ menu (D-11 / RESEARCH Open Q1)."

patterns-established:
  - "DownloadControl.svelte is the ONE shared per-song download affordance across library + album rows."
  - ".row-line wrapper keeps the trailing control OUTSIDE the overflow:hidden swipe-wrap so the swipe reveal never clips it."

requirements-completed: [DL-FILE-01, DL-BUG-01, DL-STATE-01]

# Metrics
duration: 8min
completed: 2026-07-23
---

# Phase 29 Plan 04: Download UX rollout (tri-state control + bug-path removal) Summary

**Shared `DownloadControl.svelte` tri-state (idle → spinner → greyed Downloaded) wired into the ⋮ menu, library rows and album rows over the shared `downloadTrack` path; the `window.open` + `showSaveFilePicker` "opened a media page" bug paths are deleted, and home/search rows show a passive Downloaded badge.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-23T21:57:16-07:00
- **Completed:** 2026-07-23T22:05:30-07:00
- **Tasks:** 3
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- Created `DownloadControl.svelte`: a single tri-state control keyed on `track.uid`, reading `library.downloading.has(uid)` + `library.isDownloaded(uid)` so one song's spinner never touches another's (T-29-04-02). Reuses the TrackMenu `.row-spinner` idiom + reduced-motion rules + `use:tapBounce`.
- TrackMenu `doDownload` reduced to a thin delegate to `downloadTrack`; the bespoke fetch → offline-blob → save-picker → anchor → new-tab-stream fallback is gone. The Download menu row is tri-state (idle / busy via `inFlight` OR `library.downloading` / greyed "Downloaded"), reflecting state whether or not the menu stays open (D-12). No `onclose()` before the download runs.
- Album `downloadAlbum` rewritten to loop `downloadTrack(tr, { persist: false })`; inline fetch/anchor + the `window.open` fallback deleted (DL-BUG-01). Each album track row mounts a `DownloadControl` (resolve-on-tap for the stub; `persist:false`).
- Library rows (liked / playlists / downloads / history) each mount `DownloadControl` in a `.row-line` wrapper beside the existing swipe/longpress/play row; the downloads tab correctly renders the greyed "Downloaded" state.
- CompactRow (home/search) shows a passive greyed Check badge when `library.isDownloaded(uid)` — no new tap target; initiation stays in the ⋮ menu.

## Task Commits

Each task was committed atomically:

1. **Task 1: DownloadControl.svelte + TrackMenu rewire (delete bug paths)** - `2928a8a` (feat)
2. **Task 2: Album downloadAlbum + per-row control via downloadTrack(persist:false)** - `ae83376` (feat)
3. **Task 3: Library rows tri-state + CompactRow passive badge** - `1bbad42` (feat)

**Plan metadata:** _this commit_ (docs: complete plan)

## Files Created/Modified
- `src/lib/components/DownloadControl.svelte` - NEW shared tri-state control; reads library.downloading/isDownloaded, calls downloadTrack, maps the sentinel to a toast; optional `resolve` closure for album stubs + `persist` prop.
- `src/lib/components/TrackMenu.svelte` - doDownload → thin downloadTrack delegate; Download row tri-state; removed window.open/showSaveFilePicker/blobStore + currentQualityMeets; imports downloadTrack; added Check icon.
- `src/routes/(app)/album/[name]/+page.svelte` - downloadAlbum loops downloadTrack(persist:false); deleted inline fetch/anchor + window.open; per-row DownloadControl in a .row-line wrapper; removed ensureTrackDetails import.
- `src/routes/(app)/library/+page.svelte` - all four track-row tabs mount DownloadControl in a .row-line wrapper; added .row-line CSS.
- `src/lib/components/CompactRow.svelte` - passive downloaded badge (Check) gated on library.isDownloaded; imports library + Check; play/⋮/longpress wiring untouched.

## Decisions Made
- **Thin-delegate for TrackMenu, DownloadControl for rows.** The plan offered an OR (thin doDownload delegate vs. embedding DownloadControl in the menu row). Chose the thin delegate so TrackMenu imports/calls `downloadTrack` directly (matches the plan `key_links` + `must_haves.contains`), and made the menu row tri-state inline. DownloadControl is used on library + album rows.
- **Album stub state honesty.** Album rows carry no uid until resolved, so DownloadControl reads idle for a stub and only shows Downloaded/greyed after a resolve caches the Track. Documented in-component.
- **persist:false for album** — album downloads intentionally stay out of the offline blob / native public folder this phase (RESEARCH Open Q2); noted in a code comment on `downloadAlbum`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] DownloadControl needs stub-resolution + local busy state for album rows**
- **Found during:** Task 2 (album per-row control)
- **Issue:** The plan's interface listed `DownloadControl { track: Track; persist? }`, but the plan also says to mount it on album rows where `track` is a `{artist,title}` STUB (no uid/source/audioUrl). A raw stub can't key `library.downloading/isDownloaded` and can't be resolved by `downloadTrack`.
- **Fix:** Added two optional props — `track?: Track | null` and a `resolve?: () => Promise<Track|null>` closure — plus a per-instance `localBusy` flag that covers the resolve→download window (before a resolved uid enters `library.downloading`). Library/menu rows pass a real `track`; album rows pass `track={null}` + `resolve`. State keys on the resolved uid once available.
- **Files modified:** src/lib/components/DownloadControl.svelte, src/routes/(app)/album/[name]/+page.svelte
- **Verification:** `pnpm check` clean; full suite green.
- **Committed in:** `2928a8a` (control) + `ae83376` (album wiring)

**2. [Rule 3 - Blocking] Reworded comments that contained the literal `window.open` / `showSaveFilePicker` tokens**
- **Found during:** Task 1 + Task 2
- **Issue:** The acceptance-criteria greps (`grep "window.open\|showSaveFilePicker"`) must return NOTHING, but my explanatory comments describing the deleted bug paths contained those exact tokens, tripping the grep.
- **Fix:** Reworded the comments ("new-tab-stream fallback", "save-picker") so the code + comments contain no forbidden token while still documenting what was removed.
- **Files modified:** src/lib/components/TrackMenu.svelte, src/routes/(app)/album/[name]/+page.svelte
- **Verification:** `grep -rn "window.open\|showSaveFilePicker" TrackMenu album` → empty.
- **Committed in:** `2928a8a`, `ae83376`

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking).
**Impact on plan:** No scope creep. The DownloadControl prop extension is the minimal change needed to reconcile the plan's stated interface with the album-stub mount site; the comment reword satisfies the DL-BUG-01 grep contract without weakening documentation.

## Issues Encountered
- None beyond the two deviations above. `pnpm check` (0 errors/warnings) and `pnpm test` (82 files, 1373 tests) both green.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Every web download surface now flows through `downloadTrack`; the tri-state control + i18n keys are in place. The native folder placement + Settings migration button (29-05) can build on the shared `downloadTrack` / `blobStore` path unchanged.
- **Device UAT still required (29-VALIDATION):** iOS Safari + Android Chrome — download a song (file saves, no media page opens); forced save failure shows a toast and keeps the song in Library (DL-BUG-01 iOS row). Multi-source CN download E2E is not verifiable in this sandbox (no CN upstream network).

## Self-Check: PASSED
- Files: all 5 present (DownloadControl created; TrackMenu, album, library, CompactRow modified).
- Commits: `2928a8a`, `ae83376`, `1bbad42` all found in git log.
- Gates: `pnpm check` clean; `pnpm test` 1373 passed; verification grep empty.

---
*Phase: 29-download-ux-folder-control*
*Completed: 2026-07-23*
