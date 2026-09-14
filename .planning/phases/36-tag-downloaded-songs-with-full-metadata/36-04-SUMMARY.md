---
phase: 36-tag-downloaded-songs-with-full-metadata
plan: 04
subsystem: services + settings-ui
tags: [retag, blob-store, mediastore-idempotency, i18n, settings-route, verify-before-write]

# Dependency graph
requires: [36-02]
provides:
  - "src/lib/services/retag.ts — pure sequential retag batch (RetagEntry / RetagItemResult / RetagReport / retagDownloads)"
  - "blobStore.put is now IDEMPOTENT per uid on native — a re-put replaces the public Music/OpenMusic/ file instead of adding `name (1).m4a`"
  - "Settings → Downloads route (/settings/downloads) — the home Phase 34's device-import button joins"
  - "8 settings.* i18n keys across all 15 dictionaries"
affects: [36-05, 34]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Verify-before-write: parse the replacement bytes back and compare a known field BEFORE overwriting a file the user already has"
    - "Scope-by-intersection: the UI computes `library.downloads ∩ blobStore.has` and hands the service explicit entries — the service never enumerates anything itself"

key-files:
  created:
    - src/lib/services/retag.ts
    - src/lib/services/retag.test.ts
    - src/routes/(app)/settings/downloads/+page.svelte
  modified:
    - src/lib/services/blob-store.ts
    - src/lib/services/blob-store.test.ts
    - src/routes/(app)/settings/+page.svelte
    - src/lib/i18n/{en,zh-Hans,zh-Hant,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi}.ts
    - .gitignore

key-decisions:
  - "New route `settings/downloads` (plural), nothing moved. `settings/playback` keeps download QUALITY; this page owns the FILES. Phase 34's import button + rules panel join here later."
  - "NO tagged-marker / no `retaggedAt` flag. A marker records what the app BELIEVES about a file, and the file can change underneath it (user deletes it, re-downloads it, a future codec change makes a re-run worthwhile). Re-running is idempotent, cheap, and the user's call — a drifting marker would lie in exactly the case the phase exists to fix."
  - "Album-bulk downloads (`persist:false`) are OUT of retag scope, structurally, not by rule: the app never kept a copy, so `blobStore.has` is false and they never enter the eligible list. The page's hint tells the user what cannot be reached rather than pretending."
  - "Verify-before-write compares the read-back TITLE only (when non-empty), not every field. It is a corruption probe, not an equality assertion — the codec's own 29 tests own field fidelity, and a stricter compare would fail on legitimate codec normalisation and block a good write."
  - "The `.gitignore` `downloads/` → `/downloads/` anchor is a root-cause fix, not a workaround: the unanchored Python-template pattern silently excludes ANY `downloads/` dir in the tree, so Phase 34's later files under this route would have vanished too."

requirements-completed: [D-06, D-17, D-18, D-19]

# Metrics
duration: 9min
completed: 2026-09-13
---

# Phase 36 Plan 04: Opt-In Retag of Existing Downloads Summary

**A Settings → Downloads page lets a user retro-tag the offline copies the app still holds — one file at a time, each one verified to parse back before it overwrites anything, each failure isolated to that file and reported honestly — on top of a `blobStore.put` that now replaces the public Android file instead of duplicating it.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-14T01:38:46Z
- **Completed:** 2026-09-14T01:47Z
- **Tasks:** 3
- **Files created:** 3 · **modified:** 20

## Accomplishments

- **`retag.ts`** — 127 lines, pure, store-free, never throws. Sequential `for…of` (no parallel fan-out: each entry is a wasm pass over a whole audio file plus a possible artwork fetch). Per entry: `blobStore.get` → `resolveArtworkDataUrl` → `tagAudioBlob` → **`readAudioTags` verify** → `blobStore.put`. Every step of every entry is inside one try/catch, so a throw is that entry's `'error'` bucket and nothing else.
- **The write the plan cares most about is the one that does not happen.** A retag OVERWRITES a file the user already has, so tagged bytes that do not parse back (`readAudioTags` → null, or a title that disagrees) are dropped and the original is left byte-identical. Two tests pin exactly that, plus a call-order test proving `readAudioTags` precedes `put`.
- **`nativePut` is now idempotent per uid** (36-D-19). Before `saveToMusic` it deletes the previously recorded content URI. Without this, retagging N downloads would have doubled the user's `Music/OpenMusic/` folder, every song appearing twice with one copy stale — retag is the first feature that re-puts the same uid at scale, which is why the latent bug surfaces now. Ordering is the safety argument: the app-private *playable* copy (step 1) has already landed, so a crash between delete and save costs only the visibility copy.
- **Settings → Downloads** with a consent gate: `confirm()` naming the count, a live `Tagging {done} of {total}…` line, a truthful `Tagged {tagged} of {total}. Skipped {skipped}.` flash, and a hint that states plainly what web retag *cannot* reach (files saved through the browser's download folder). `retagDownloads(` appears exactly once in the file — inside the click handler — so it can never run on mount, on an effect, or in the background.
- **8 keys × 15 dictionaries in one pass**, real (not English-fallback) translations for every locale including the two primary Chinese ones, double-quoted keys and values, both CI guards green.

## Verification Evidence (observed, not assumed)

| Command | Exit | Observed output |
|---|---|---|
| `pnpm vitest --run src/lib/services/retag.test.ts src/lib/services/blob-store.test.ts` | 0 | `Test Files 2 passed (2)` · `Tests 57 passed (57)` · 266 ms |
| Task 1 static guards (`deleteFromMusic({ uri: prev })` present; comment-stripped `retag.ts` free of store/i18n/allSettled/displayIndex; `export async function retagDownloads`) | 0 | `GUARD-OK` `PURITY-OK` `EXPORT-OK` |
| `git diff --stat src/lib/services/blob-store.ts` | 0 | `1 file changed, 15 insertions(+)`, single hunk `@@ -122,0 +123,15 @@ async function nativePut` — nothing else in the file touched |
| i18n count loop (8 keys × 15 files) | 0 | `COUNT-OK` |
| `pnpm vitest --run src/lib/i18n/i18n.test.ts` | 0 | `Test Files 1 passed (1)` · `Tests 29 passed (29)` (key-set parity + double-quote convention) |
| `pnpm check` (after each task) | 0 | `COMPLETED 4517 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| `pnpm test` (full suite) | 0 | `Test Files 121 passed (121)` · `Tests 2233 passed (2233)` · 9.06s |
| Task 3 page-contains checks (12 required substrings incl. `36-D-17/18/19`) + index row | 0 | no `MISSING:` lines; `INDEX-ROW-OK` |
| `grep -c 'retagDownloads(' <page>` | — | `1`, at line 58 inside the `retag()` click handler — never automatic |
| Dev server (port 4321, already running) `GET /settings/downloads` | 0 | **HTTP 200** |
| Vite transform of the new component (`GET /src/routes/(app)/settings/downloads/+page.svelte`) | 0 | compiles clean; 5 lines in the compiled output reference `retagDownloads` / `settings.retagConfirm` |

New test counts: retag 17 tests (plan minimum 8), blob-store +3 for the delete-before-save order. Whole-suite delta since 36-03: 118 → 121 files, 2184 → 2233 tests.

### What was NOT verified here

- **No device / APK run.** `pnpm apk` was deliberately not run (36-05 owns the device pass). Everything above is CI + a dev-server route/compile smoke.
- **No end-to-end browser tap.** The dev server confirms the route serves and the component compiles; it does not prove the tap → confirm → flash path with a real IndexedDB download present. That interaction, and the entire native `deleteFromMusic`-before-`saveToMusic` behaviour, is **construction + unit-test evidence only**. The device checkpoint that matters: after retagging, `Music/OpenMusic/` must contain exactly one file per song — no `… (1).m4a` twins.

## Task Commits

1. **Task 1: retag service + nativePut duplicate guard** — `44a8cbd` (feat)
2. **Task 2: 8 keys × 15 dictionaries** — `4ffad7d` (feat)
3. **Task 3: Settings → Downloads page + index row** — `55d1a66` (feat)

## Decisions Made

See `key-decisions` in the frontmatter. The three the plan explicitly asked to be recorded:

> **The `settings/downloads` route.** Created new, plural, matching the tab name; nothing was moved. `settings/playback` keeps download *quality* (a playback preference); this page owns the *files*. Phase 34's "import songs from this device" button and its rules panel land here, which is why the page is deliberately thin — one section, one control, room to grow.

> **No tagged-marker.** No `retaggedAt` flag, no per-uid "already done" set. A marker records what the app believes about a file while the file itself can change underneath it — deleted outside the app, re-downloaded untagged, or made worth re-tagging by a future codec improvement. Re-running is idempotent (36-D-19 now guarantees that on native too) and costs the user one tap. A marker would be a second source of truth that can only drift, and it would drift in exactly the "my downloads are untitled" case this phase exists to fix.

> **Album-bulk downloads are out of scope structurally.** The album download loop passes `persist:false`, so the app never kept a copy — `blobStore.has` is false and those tracks simply never enter the eligible list. Nothing special-cases them; 36-D-18's scope rule already excludes them. The page's hint says so in the user's terms rather than silently under-counting.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `.gitignore`'s unanchored `downloads/` silently excluded the entire new route**

- **Found during:** Task 3, at `git add` (`The following paths are ignored by one of your .gitignore files: src/routes/(app)/settings/downloads`)
- **Issue:** `.gitignore:16` carried `downloads/` from the inherited Python template. Unanchored, it matches *any* directory named `downloads` anywhere in the tree — including `src/routes/(app)/settings/downloads/`. The route would have worked locally and been absent from the repo (and from production, which deploys from `main`). The same file already documents this exact failure at lines 10-11, where `lib/` and `lib64/` were anchored to `/lib/` and `/lib64/` so they would stop matching `src/lib/`.
- **Fix:** `downloads/` → `/downloads/`, with the existing NOTE extended to cover it. Root cause, not a workaround: `git add -f` would have hidden the trap for Phase 34's later files under the same directory.
- **Files modified:** `.gitignore`
- **Commit:** `55d1a66`

### Deliberate deviations from the plan text

- **`retag.test.ts` has 17 tests, not the 8 cases the plan enumerated.** Every enumerated case is present; the extras are the `readAudioTags`-returns-null verify case, the `blobStore.get`-rejects isolation case, the throwing-`onProgress` case, the invalid-input case, and the explicit `readAudioTags`-before-`put` call-order assertion.
- **`retagDownloads` filters falsy/uid-less entries before counting**, so `report.total` is the number of entries actually attempted. A malformed entry cannot inflate the denominator the user is shown.
- **`onProgress` is called inside its own try/catch.** A UI callback that throws must not abort a batch that is rewriting the user's files (36-D-19's spirit applied to the caller, not just the codec).

## Assumption Drift (advisory)

**1. `settings/data/+page.svelte` — the file the plan named as the skeleton to copy — changed under us mid-plan**

- **Found during:** Task 2 → Task 3 boundary
- **Planned:** copy the 79-line data page (`onMount` / `flash()` / `.item` + `.hint` / `confirm()` before a bulk action / the `<style>` block verbatim).
- **Actual:** Phase 35 landed its export/import/undo UI into that page during this run; it is now ~180 lines with `backup-logic` imports, a hidden file input and a `canUndo` affordance.
- **Why it matters:** the patterns the plan pointed at are all still there and were copied from the current version, so nothing was lost — but a later reader diffing the two pages will find the data page much larger than the plan implies. The new page copied the CSS block plus one addition (`.item:disabled`, needed because this page has a disabled state the data page never had).

**2. `pnpm check` was briefed as red from Phase 35's TDD-RED file; it is green**

- **Planned:** judge only by zero new errors in files this plan touched.
- **Actual:** `0 ERRORS` across all 4517 files at every checkpoint — Phase 35's implementation is in. The evidence above is a genuine whole-repo zero.

## Known Stubs

None. Every export is implemented and exercised.

## Issues Encountered

No `.git/index.lock` contention. Every `git add` named explicit paths; `src/routes/(app)/settings/data/+page.svelte` remains modified-uncommitted in the working tree as Phase 35's in-flight work and was deliberately left untouched.

## User Setup Required

None. No new dependency, no secret, no dashboard action.

## Next Phase Readiness

- **36-05 (device verification) is unblocked** and now has two things to check on hardware, not one: (1) Settings → Downloads → retag rewrites the files and the device music app shows real titles/artists/covers; (2) **`Music/OpenMusic/` holds exactly one file per song afterwards** — the `… (1).m4a` duplicate is the regression signature if the `deleteFromMusic` guard misbehaves on a real MediaStore.
- **Phase 34 inherits a live route.** `src/routes/(app)/settings/downloads/+page.svelte` exists, is committed (the `.gitignore` anchor made that possible), and has room for the import button + rules panel under a second `<section>`. The `.item` / `.hint` / `.flash` CSS is already there.
- **Carry forward (Pitfall 5, user-visible):** a retagged file with no album still shows under a pseudo-album named after the folder ("OpenMusic") on Android — OS scanner behaviour, not a placeholder the app wrote. Worth saying out loud before someone files it as a retag bug.
- **Watch item:** `blobStore.put`'s new delete step now runs on **every** native put, not just retag — including the normal download path and the 31-D-12 background repair. It is best-effort and cannot fail a put, but it is the one behavioural change outside this plan's own surface.

---
*Phase: 36-tag-downloaded-songs-with-full-metadata*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 4 claimed files exist on disk (`retag.ts` 130 lines, `retag.test.ts` 196 lines — both above the plan's minimums); all three task commits (`44a8cbd`, `4ffad7d`, `55d1a66`) exist in git.
