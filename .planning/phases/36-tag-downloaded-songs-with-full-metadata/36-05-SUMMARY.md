---
phase: 36-tag-downloaded-songs-with-full-metadata
plan: 05
status: paused-at-checkpoint
subsystem: native-build + device-verification
tags: [apk, capacitor, wasm-asset, d-15, device-verification, checkpoint-blocking]

# Dependency graph
requires: [36-03, 36-04]
provides:
  - "android/app/build/outputs/apk/debug/app-debug.apk — debug build carrying taglib-web.bIFBWRq2.wasm (686,505 B) through adapter-static → cap sync → APK, byte-identical at every hop"
  - "Proof that the .wasm survives the FIRST adapter-static + cap sync pass in this repo (no prior analog)"
  - "Proof the native-target service worker also excludes the wasm from precache (36-03 proved it only for adapter-cloudflare)"
affects: [34]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Re-running 36-03's node-vm service-worker precache proof against the adapter-static build — the same claim needs re-proving per adapter, the SW is regenerated"

key-files:
  created: []
  modified: []

key-decisions:
  - "Task 1 produced ZERO committable changes and therefore has no task commit. All three of its artifacts are gitignored by design (android/.gitignore:24 `build/`, .gitignore:216 `/build`, android/.gitignore:96 `app/src/main/assets/public`). The plan's own files_modified lists only 36-VALIDATION.md, which Task 3 owns. An empty marker commit would have been noise."
  - "The plan's wasm glob `taglib-web-*.wasm` (dash) matches nothing — Vite emits `<name>.<hash>.wasm` with a DOT. Corrected to `taglib-web*.wasm` for every hop check rather than declaring a build failure. 36-03-SUMMARY used the correct form; the dash was a transcription slip when the pattern moved into 36-05's frontmatter key_links."
  - "The APK deflates the wasm rather than storing it: 686,505 B → 271,972 B (60%). The plan predicted ≈0.7 MB of APK growth on a stored-not-gzipped assumption; the real delta is +273,104 B."

requirements-completed: []

# Metrics
duration: 4min
completed: 2026-09-13
---

# Phase 36 Plan 05: On-Device D-15 Verification Summary — PAUSED AT BLOCKING CHECKPOINT

**Task 1 is done and green: a debug APK exists carrying the 686,505-byte taglib wasm byte-identically through `adapter-static` → `cap sync` → `app-debug.apk`, lazily loaded (zero `taglib` references in either entry chunk) and out of the service-worker precache (140 entries, 0 `.wasm`), with `MediaStoreSaverPlugin.kt` untouched. Task 2 is a blocking human gate requiring a physical Android phone and has NOT been executed — no device was available to this executor, and it was not faked, simulated, or skipped.**

## Status

| Task | State |
|---|---|
| 1 — Build the APK, prove the wasm at every hop | ✅ **COMPLETE** (verify command exits 0) |
| 2 — On-device D-15 checklist | ⏸️ **BLOCKED — awaiting human with a physical Android device** |
| 3 — Record device results, flip the sign-off | ⛔ **NOT STARTED** — cannot run before Task 2 reports outcomes |

`36-VALIDATION.md` is therefore UNCHANGED: `nyquist_compliant: false`, `wave_0_complete: false`, `status: draft`. Flipping any of them now would be a lie about evidence that does not exist yet.

## Performance

- **Duration:** 4 min (Task 1 only)
- **Started:** 2026-09-14T01:48:20Z
- **Paused at checkpoint:** 2026-09-14T01:52Z
- **Tasks completed:** 1 of 3
- **Files modified:** 0 (Task 1's outputs are all gitignored build artifacts)

## Verification Evidence (observed, not assumed)

| Command | Exit | Observed output |
|---|---|---|
| `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home pnpm apk` | 0 | `BUILD SUCCESSFUL in 14s` · `306 actionable tasks: 64 executed, 242 up-to-date` |
| `find build -name 'taglib-web*.wasm'` | 0 | **1** file — `build/_app/immutable/assets/taglib-web.bIFBWRq2.wasm`, **686,505 B** |
| `find android/app/src/main/assets/public -name 'taglib-web*.wasm'` | 0 | **1** file, **686,505 B** — byte-size identical to `build/` (T-36-17 mitigation) |
| `unzip -l …/app-debug.apk \| grep -c 'taglib-web.*\.wasm'` | 0 | **1** entry — `assets/public/_app/immutable/assets/taglib-web.bIFBWRq2.wasm`, 686,505 B uncompressed |
| `unzip -v …/app-debug.apk \| grep taglib-web` | 0 | `686505  Defl:N  271972  60%` — the APK **deflates** it (see Deviations) |
| `grep -l taglib build/_app/immutable/entry/*.js` | 1 (no match) | **0** of 2 entry chunks reference taglib — still lazy under `adapter-static` |
| Built static SW executed in a node `vm` (36-03's method), capture `cache.addAll` | 0 | `precache entries: 140` · `wasm entries in precache: 0 []` · `PASS` |
| `git diff --quiet android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt` | 0 | `KOTLIN-CLEAN` — D-15 held |
| `git status --short -- src android` | 0 | empty — this plan changed no source |
| Full Task 1 `<automated>` chain (corrected glob) | 0 | `TASK1-VERIFY-PASS` |
| `pnpm test` | 0 | `Test Files 121 passed (121)` · `Tests 2233 passed (2233)` · 9.11s |
| `pnpm check` | 0 | `COMPLETED 4517 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |

### APK size

| | Bytes | |
|---|---:|---|
| Previous `app-debug.apk` (Sep 13 13:38, pre-Phase-36) | 5,857,494 | baseline on disk |
| New `app-debug.apk` | 6,130,598 | |
| **Delta** | **+273,104** | +0.26 MiB |
| wasm raw | 686,505 | identical in `build/`, `assets/public/`, and the APK entry |
| wasm deflated inside the APK | 271,972 | accounts for essentially the whole delta |

## Task Commits

**None.** Task 1 changed no tracked file — `build/`, `android/app/src/main/assets/public/`, and `android/app/build/` are all gitignored (verified with `git check-ignore -v`). Its evidence is the table above. The only tracked file this plan will ever modify is `36-VALIDATION.md`, which belongs to Task 3.

## Deviations from Plan

### 1. [Rule 3 — Blocking] The plan's wasm glob cannot match; corrected the check, not the build

- **Found during:** Task 1, hop 1
- **Issue:** the plan's `<verify>` and `key_links.pattern` both use `taglib-web-*.wasm` / `taglib-web-.*\.wasm` (a **dash**). Vite emits `taglib-web.bIFBWRq2.wasm` — name, **dot**, hash. Run verbatim, the plan's automated verify fails on a green build and would have read as a native build failure.
- **Fix:** used `taglib-web*.wasm` at all three hops (the form 36-03-SUMMARY itself used: `find .svelte-kit/cloudflare -name 'taglib-web*.wasm'`). No source, config, or build change.
- **Commit:** n/a — verification-command correction only.

### 2. Replaced the service-worker check with 36-03's functional proof (again)

The plan's step 1 asks that `build/service-worker.js` "contains no `.wasm` in its precache list". As 36-03 established, that literal grep is unsatisfiable by construction: SvelteKit inlines the asset list as a string literal and the `.filter((p) => !p.endsWith('.wasm'))` runs at SW startup, so the path is necessarily still in the file text. Confirmed here: the minified static SW contains both `taglib-web.bIFBWRq2.wasm` in the literal **and** `.filter(e=>!e.endsWith('.wasm'))`. Substituted the functional proof — run the built worker in a node `vm` with stubbed `caches`/`self`, fire `install`, read what `cache.addAll` actually received. **140 entries, 0 `.wasm`.**

Worth stating plainly: 36-03 proved this for the **adapter-cloudflare** build only. The service worker is re-emitted per adapter, so the native/static target needed its own proof. It passed.

### 3. Task 1 has no commit (see Task Commits above)

### 4. Not a deviation, an observation the plan asked for: APK growth is 0.27 MB, not 0.7 MB

The plan expected ≈0.7 MB "(the wasm is stored, not gzip-served, inside the APK)". `unzip -v` shows `Defl:N` — the APK **does** deflate it, 686,505 → 271,972 B at 60%, almost exactly the 229,650 B gzip figure's neighbourhood. Recorded because the number will be re-checked when Phase 34 adds more to the same bundle.

## Assumption Drift (advisory)

**1. The APK was assumed to store the wasm uncompressed; it deflates it**
- **Found during:** Task 1
- **Planned:** "expected growth is ≈ 0.7 MB (the wasm is stored, not gzip-served, inside the APK)".
- **Actual:** the zip entry is `Defl:N` at 60%, so the user's download grows by 0.27 MB, not 0.7 MB.
- **Why it matters:** the APK-size budget for the native shell has ~0.4 MB more headroom than the phase assumed.

**2. The wasm's lazy-loading proof had to be re-established for a second adapter**
- **Found during:** Task 1
- **Planned:** the plan treats "still lazy under the native adapter" as one grep among several.
- **Actual:** it is a genuinely separate claim — a different adapter, a different bundle, a different service worker — and the SW half needed 36-03's whole vm harness re-run, not a grep.
- **Why it matters:** any future adapter or build-target change re-opens both claims; neither is settled globally.

## Assumptions Settled So Far

| ID | Assumption | Status |
|---|---|---|
| A5 | The Capacitor WebView loads the emitted `.wasm` | ⏸️ **PARTIAL** — the wasm is *present and intact* in the APK at `assets/public/_app/immutable/assets/`. Whether the WebView *instantiates* it is device-only, and is exactly what checklist step 2's `download.tag → tagged` line settles. |
| A1 | OEM/ID3v2.4 readability | ⏸️ device-only (checklist step 7) |
| A2 | OEM scanner reads in-file tags | ⏸️ device-only (checklist steps 4-6) |
| A3 | `IS_PENDING → 0` triggers the scan | ⏸️ device-only (checklist steps 4-6) |
| A6 | `TAG_MAX_BYTES` ceiling on-device | ⏸️ device-only (checklist step 9) |
| A4 | SvelteKit's `build` array includes the wasm | ✅ settled in 36-03; **re-confirmed here for the static target** and filtered out (140/0) |

## Phase-Level Notes (written now, they do not depend on the device run)

### 1. User-facing surprise: album-less downloads will show under an album called "OpenMusic"

D-10 is correct — when `Track.album` is empty the app writes **no** ALBUM tag rather than a placeholder. But on Android that does **not** surface as "Unknown album" as 36-CONTEXT D-10 anticipated. AOSP's `ModernMediaScanner.scanItemAudio` pre-sets `ALBUM = file.getParentFile().getName()` before consulting `MediaMetadataRetriever`, so an album-less file in `Music/OpenMusic/` groups under a pseudo-album literally named **"OpenMusic"**. This is the OS's default, not a string OpenMusic wrote, and it is expected behaviour — `PARENT-FOLDER-ALBUM` in the checklist, not a bug. Say it before the user's phone does.

### 2. Roadmap backlog (pre-existing, NOT fixed in Phase 36): album bulk download writes no native public file

`album/[name]/+page.svelte` `downloadAlbum` passes `persist: false` (Phase 29 behaviour), which skips `blobStore.put` — and the native `Music/OpenMusic/` write hangs off that same call. So album downloads are correctly tagged with track number and album artist (36-03 D-11/D-12), and the device music player **never sees them** — for exactly the album case that motivated those two fields. They are also outside 36-04's retag scope structurally, because `blobStore.has` is false when the app kept no copy. Flipping `persist` for the album loop is a scope decision (offline blobs for a whole album, storage implications), not a research finding. **Roadmap item, not a Phase 36 fix.**

This is also why Task 2's checklist deliberately says "download at least one m4a and one FLAC **individually** from the album page rows" instead of using the album's bulk Download button.

### 3. D-15's named fallback is REFUTED and must never be attempted

If the device run comes back `SCANNER-BLIND`, the remedy named in 36-CONTEXT D-15 — writing TITLE/ARTIST/ALBUM into MediaStore `ContentValues` from `MediaStoreSaverPlugin.kt` — **does not durably work**, refuted at AOSP source level: `ModernMediaScanner.scanItemAudio` (lines 1456-1498) pre-sets `ARTIST = "<unknown>"` and `ALBUM = <parent folder>` and its upsert **overwrites app-supplied columns** on any later scan. A failure is a **re-research trigger**, not a patch. The honest candidate remedies (decisions for the user, not tasks for an executor) are: a hand-written ID3v2.3 post-pass on the **mp3 branch only** if `ID3V24-UNREAD`; an explicit `MediaStore.scanFile` after the `IS_PENDING` flip if A3 is what failed; `TAG_MAX_BYTES` tuning if `OOM`. T-36-19 exists specifically to stop the wrong fix.

## Known Stubs

None. This plan wrote no code.

## Threat Flags

None. No source, no new endpoint, no new dependency — `pnpm apk` ran against the frozen lockfile (T-36-SC), and T-36-17 is mitigated by the three-hop byte-size equality recorded above.

## Issues Encountered

No `.git/index.lock` contention with the concurrent Phase 34 / Phase 35 sessions. The working tree was clean at start and stayed clean through Task 1 (the build touches only gitignored paths).

## User Setup Required — THIS IS THE BLOCKER

A physical Android device is required. See the checkpoint report returned to the orchestrator, or Task 2's `<how-to-verify>` in `36-05-PLAN.md`, for the 9-step checklist and the outcome tokens. The emulator (`Pixel_3a_API_34`) is explicitly **not** a substitute: it is stock AOSP and RESEARCH A2 is about OEM skins.

## Next Steps

1. Human installs `android/app/build/outputs/apk/debug/app-debug.apk` and runs the 9-step checklist.
2. Human replies `approved`, or with outcome tokens + device model + Android version.
3. A continuation executor runs Task 3: record the run in `36-VALIDATION.md`, flip `wave_0_complete: true`, and set `nyquist_compliant` to the **actual** outcome (true only on `approved`).

---
*Phase: 36-tag-downloaded-songs-with-full-metadata*
*Paused: 2026-09-13*

## Self-Check: PASSED

`36-05-SUMMARY.md`, `app-debug.apk`, and the cap-synced `taglib-web.bIFBWRq2.wasm` all exist on disk; commit `5269965` exists in git; `36-VALIDATION.md` still reads `nyquist_compliant: false`, which is the correct state for a plan paused before its device run.
