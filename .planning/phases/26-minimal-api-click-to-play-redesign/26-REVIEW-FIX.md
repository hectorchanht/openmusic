---
phase: 26-minimal-api-click-to-play-redesign
fixed_at: 2026-07-12T03:06:00Z
review_path: .planning/phases/26-minimal-api-click-to-play-redesign/26-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
deferred: 0
skipped: 0
status: all_fixed
---

# Phase 26: Code Review Fix Report

**Fixed at:** 2026-07-12T03:06:00Z
**Source review:** .planning/phases/26-minimal-api-click-to-play-redesign/26-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (WR-01, WR-02, IN-01, IN-02)
- Fixed: 4
- Deferred: 0
- Skipped: 0
- Final gate `pnpm check`: **0 errors, 0 warnings**
- Full test suite: 1223 passed; 1 pre-existing, unrelated failure (see Notes)

## Fixed Issues

### WR-01: cover-backfill tier-3 CN search dropped the AbortSignal

**Files modified:** `src/lib/services/cover-backfill.ts`, `src/lib/services/cover-backfill.test.ts`
**Commits:** `e2d9b27` (source), `d1010f0` (companion test)
**Applied fix:** Changed the tier-3 CN call from `searchAll(\`${artist} ${title}\`, 1)` to `searchAll(\`${artist} ${title}\`, 1, {}, signal)` so the CN fan-out is cancelled on supersede/unmount like tiers 1-2. Verified `searchAll(keyword, page, prefs, signal, onPartial)` accepts the signal in slot 4. The exact-args assertion in the CN-fallback test was updated to `('Jay Chou Simple Love', 1, {}, undefined)`, mirroring the existing `itunesSongCover` signal assertion (landed as a labeled companion commit because the source commit was three commits back and interactive rebase is unavailable in this environment).

### WR-02: shared overlay id `'versionpicker'` across co-mounted picker instances

**Files modified:** `src/lib/components/VersionPicker.svelte`, `src/lib/components/TrackMenu.svelte`, `src/lib/components/NowPlaying.svelte`, `src/routes/(app)/search/+page.svelte`
**Commit:** `af2bd5d`
**Applied fix:** Read the overlays store first to confirm `open(id)`/`dismiss(id)` push/pop one history state per id and that the invariant is "history depth == overlay depth". Added an `overlayId` prop to VersionPicker (default `'versionpicker'` for back-compat); the `$effect` now captures the id once (untracked, so `open` stays the sole dependency) and uses it for BOTH `overlays.open(id, ...)` and the cleanup `overlays.dismiss(id)` — keeping push/pop balanced per instance. Passed distinct ids from each host: `'versionpicker-menu'` (TrackMenu-hosted), `'versionpicker-list'` (search page), `'versionpicker-page'` (NowPlaying). This strictly improves the back-gesture invariant (distinct ids can never orphan a pushed history entry), so it was applied rather than deferred.

### IN-01: 36 i18n keys single-quoted in 12 non-CJK locales

**Files modified:** `src/lib/i18n/{ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi}.ts`, `src/lib/i18n/i18n.test.ts`
**Commit:** `8c650b3`
**Applied fix:** Converted the 36 single-quoted key/value pairs per file (432 total) to double quotes via a scripted, per-line transform that only touches object-entry lines. Scan first confirmed zero embedded backslashes and that the only lines carrying a `"` were fr.ts:72 / fr.ts:300 (values already double-quoted because they contain apostrophes — key-only conversion there, values untouched), so no escaping was needed. No key reordering, no key-set change (diff is exactly 432 insertions / 432 deletions). Added a self-enforcing guard to `i18n.test.ts` that flags any entry line whose key OR value opens with a single quote (regex verified to catch violations while not false-positiving on apostrophes inside double-quoted values). i18n parity + no-blank + new quote-convention tests all pass (46 tests).

### IN-02: dead code — write-only `someFailed`, unused `.warn`, orphaned `gotoAlbum`/`Disc`

**Files modified:** `src/routes/(app)/search/+page.svelte`, `src/lib/components/TrackMenu.svelte`
**Commit:** `5775d7d`
**Applied fix:** search page — removed the write-only `someFailed` `$state` + its four assignments, dropped the now-unused `perSource` from the `searchAll` destructure, removed the commented-out `{#if someFailed}` banner, and deleted the unused `.warn` CSS selector (the lone svelte-check warning). TrackMenu — removed the orphaned `gotoAlbum()` function, the now-unused `Disc` icon import, and the commented-out "Go to album" button. Commented-out features were left disabled (a separate product decision, per instructions); only dead code was removed. The `search.someFailed` and `menu.goToAlbum` i18n keys were intentionally kept to preserve locale key-set parity.

## Notes

- **Commit hygiene:** every finding committed atomically with explicit file paths (`git commit -o <paths>`); no `git add -A`/`.` used. `.planning/HANDOFF.json` was never staged or touched.
- **Concurrent-session interleave (no impact):** a foreground session committed two unrelated commits (`1159ba1` fix(album) → `album/[name]/+page.svelte`; `c236a31` tabbar padding → `(app)/+layout.svelte`) between the WR-01 and WR-02 commits on the shared working tree. History remained linear and those files are disjoint from every file in this fix set — no clobbering or interference. All five fix commits are intact and correctly scoped.
- **Pre-existing unrelated test failure (out of scope):** `src/lib/stores/searchHistory.svelte.test.ts` > "SSR guard … localStorage" fails (`expected 'object' to be 'undefined'`). It fails in isolation, touches none of the files in this fix set, and its last commit (`368c1c4`) predates phase 26. Cause is environmental — Node 22+ now exposes a native `globalThis.localStorage`, contradicting the test's assumption that the node/server vitest project has none. Not caused by these fixes and not in scope for the four findings; left for a separate task.

---

_Fixed: 2026-07-12T03:06:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
