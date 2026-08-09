---
phase: 31
plan: 01
subsystem: playback
tags: [offline-blob, error-recovery, i18n, never-stop]
requires: []
provides:
  - "blobStore.get size/type gate (MIN_BLOB_BYTES) at the single read boundary"
  - "Player.lastSrcKind blob provenance flag at all four audio.src attach sites"
  - "PlayerNotice kind 'corrupt-download' + toast.downloadCorrupted in 15 dictionaries"
  - "downloadTrack(track, { save: false }) silent background repair mode"
affects:
  - src/lib/services/blob-store.ts
  - src/lib/services/download-track.ts
  - src/lib/stores/player.svelte.ts
  - src/routes/(app)/+layout.svelte
tech-stack:
  added: []
  patterns: [never-throw-service, plain-field-guards, one-shot-uid-dedupe, dynamic-import-cycle-break]
key-files:
  created: []
  modified:
    - src/lib/services/blob-store.ts
    - src/lib/services/blob-store.test.ts
    - src/lib/services/download-track.ts
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/routes/(app)/+layout.svelte
    - src/lib/i18n/{ar,de,en,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "31-D-13 gate lives inside blobStore.get + nativeGet (root-cause placement), read-only — never mutates"
  - "31-D-12 provenance is a recorded flag, not a blob: prefix sniff — a sniff cannot tell a library download from a prebuffer blob"
  - "driveSrc carries the SrcKind with the url rather than callers setting the flag separately"
  - "the background re-download is reached via a dynamic import to avoid a player↔download-track module cycle"
metrics:
  duration: ~35 min
  completed: 2026-08-09
  tasks: 3
  commits: 3
---

# Phase 31 Plan 01: Corrupt-download self-repair Summary

A downloaded blob that exists but is bad now evicts itself, toasts once, keeps playing over the network and silently re-downloads — instead of looping `audio.error` → re-read the same corrupt bytes → strike → skip, forever.

## What Changed

**Task 1 — D-13 size gate at the blob read boundary** (`20cdd03`)
`MIN_BLOB_BYTES = 8192` + a private `isUsableBlob()` predicate in `blob-store.ts`, applied at BOTH read paths (the IDB branch inside `get`, and `nativeGet`'s `res.blob()` result). A rejected blob resolves `null`, i.e. it is indistinguishable from a cache miss, so all three player read sites (`restore`, `reresolveCurrent`, `play`) inherit the gate at zero call-site cost. Deliberately read-only — it does not delete the entry, because `restore()` reads this on boot before the user has tapped anything.

**Task 2 — notice channel + silent download mode** (`5368988`)
- `"toast.downloadCorrupted"` added to all 15 dictionaries (double-quoted key AND value), placed after `"toast.downloadFailedKeptInLibrary"`. No key added for D-18 — `toast.skipped` already carries that copy.
- `PlayerNotice.kind` widened with `'corrupt-download'`; `(app)/+layout.svelte` renders it inside the SAME `untrack()` block as the `'skip'` branch, reusing the auto-dismissing host shape (informational — playback did not stop, so no sticky Retry).
- `downloadTrack` gained `opts.save`; `save: false` returns before `saveBlobToDisk`, so the blob and library record are refreshed with no save dialog.

**Task 3 — provenance flag + recovery branch** (`b9e5b88`)
- New `SrcKind = 'url' | 'download-blob' | 'prebuffer-blob'`; plain (non-`$state`) `lastSrcKind`, `corruptNotified`, `redownloadQueued` fields beside `driveBurst`.
- Provenance recorded at all four attach sites: `restore()` (direct assign), `play()`'s offline-blob branch (direct assign), and `driveSrc()` — which now takes the kind as a third argument, so `reresolveCurrent` and `play()`'s post-resolve attach thread `download-blob` / `prebuffer-blob` / `url` through the one authority. `restore()` and the offline-`play()` branch were NOT migrated to `driveSrc()` (that would newly subject a boot restore to the redrive brake).
- The recovery branch sits immediately AFTER the rapid-fire/absolute ceiling block and BEFORE the seek branch. For `download-blob`: `logAction('blob.corrupt')` → `blobStore.del` + `library.removeDownload` → one notice per uid (with a `SKIP_BURST_WINDOW_MS` self-clearing timer mirroring `emitSkipNotice`'s WR-04 discipline) → one background `downloadTrack({ save: false })` per uid → `reresolveCurrent()`, which now re-resolves over the network because the `isDownloaded` gate went false. No strike, no `next()`, no STOP.
- For `prebuffer-blob`: revoke + clear the prebuffer slot and fall through to the pre-existing handling. No eviction, no toast, no library write.
- Both one-shot Sets clear in the `playing` listener's reset block and in `recoverFromStop`.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 3 - Blocking] `downloadTrack` reached via dynamic import**
- **Found during:** Task 3
- **Issue:** `download-track.ts` statically imports the `player` singleton. A static `import { downloadTrack }` in `player.svelte.ts` would close a module cycle, which CLAUDE.md names as an explicit discipline to avoid.
- **Fix:** `void import('$lib/services/download-track').then((m) => m.downloadTrack(...))`. Fire-and-forget already, so no ergonomic cost; `vi.mock` intercepts the dynamic import so the test asserts it normally.
- **Files:** `src/lib/stores/player.svelte.ts`
- **Commit:** `b9e5b88`

**2. [Design detail] `driveSrc` takes the kind as a parameter**
- **Found during:** Task 3
- **Issue:** The plan left the exact form open ("set 'url' inside driveSrc itself unless a caller has already declared otherwise"). Setting the field at the call site *before* calling `driveSrc` would be silently clobbered if `driveSrc` also wrote it, and a caller could forget it entirely.
- **Fix:** `private driveSrc(uid, url, kind: SrcKind = 'url')` writes `this.lastSrcKind = kind` on the same line group as `this.audio.src = url`. A braked bail (which never touches `audio.src`) correctly leaves the previous provenance intact. Both existing callers thread an explicit kind; any future caller defaults to `'url'`. Still four assign sites, still explicit at each.
- **Files:** `src/lib/stores/player.svelte.ts`
- **Commit:** `b9e5b88`

**3. [Rule 1 - Test correctness] Existing native-get test payload grown past the floor**
- **Found during:** Task 1
- **Issue:** `blob-store.test.ts`'s native hit test streamed an 11-byte `'audio-bytes'` payload — after D-13 that is a rejected blob, so the test failed on the new (correct) behavior.
- **Fix:** Payload grown to 9000 bytes; the assertion shape is unchanged (still "returns the Blob, streamed via `convertFileSrc` + `fetch`, no base64").
- **Files:** `src/lib/services/blob-store.test.ts`
- **Commit:** `20cdd03`

**4. [Rule 3 - Test harness] `$app/environment` mocked in `blob-store.test.ts`**
- **Found during:** Task 1
- **Issue:** The IDB read path is the primary (web) platform, but `browser` is false under node so `openDb()` short-circuits and the gate was untestable there. Testing only the native path would have left the web wiring unverified.
- **Fix:** `vi.mock('$app/environment', () => ({ browser: true }))` plus a ~30-line in-memory `indexedDB` shim in a describe placed LAST in the file (`openDb` memoizes its open promise, so the fake must not leak backwards). Existing expectations are unaffected — `typeof indexedDB === 'undefined'` still short-circuits everywhere else. Two stale comments ("browser false in node") were corrected to match; no assertion was changed.
- **Files:** `src/lib/services/blob-store.test.ts`
- **Commit:** `20cdd03`

### Assumption Drift (advisory)

**1. "there are four `audio.src` sites" — only three literal assignments exist**
- **Planned:** four distinct `audio.src` attach sites needing the flag.
- **Actual:** `grep 'audio.src ='` finds three (`restore():525`, `driveSrc():1191`, `play()`'s offline branch `:2568`). The "fourth" is the prebuffer *consume*, which is not its own assignment — it swaps the src string and then flows into the SAME `driveSrc` call as the post-resolve network path.
- **Why it matters:** provenance could not be recorded "at four sites"; it had to be threaded as a value through `driveSrc`, which is what deviation 2 above implements. Behaviourally identical to the plan's intent — all four *provenance cases* are covered.

## Verification

| Check | Result |
|---|---|
| `npx vitest --run src/lib/services/blob-store.test.ts` | 26 passed |
| `npx vitest --run src/lib/stores/player.svelte.test.ts -t "corrupt blob"` | 7 passed (all seven behaviors) |
| `npx vitest --run src/lib/stores/player.svelte.test.ts -t "SYSTEMIC"` | 2 passed, unmodified (D-17) |
| `npx vitest --run src/lib/stores/player.svelte.test.ts` | 204 passed (was 197 — +7 additions only) |
| `npx vitest --run src/lib/services/api-base.test.ts` | 12 passed, unmodified (D-17) |
| `npx vitest --run src/lib/i18n/i18n.test.ts` | passed (key-set parity across 15) |
| `pnpm test` | **90 files, 1629 tests passed** |
| `pnpm check` | **0 errors, 0 warnings** (4369 files) — 0 before, 0 after |
| `git diff --stat src/lib/stores/player.svelte.test.ts` | 177 insertions, **0 deletions** |
| `git diff wrangler.jsonc package.json pnpm-lock.yaml` | **empty** |
| `grep -c lastSrcKind src/lib/stores/player.svelte.ts` | 6 |
| Freeze-guard constants | `FAILURE_CAP=5`, `SYSTEMIC_SKIP_CAP=5`, `RAPID_ERROR_CAP=3`, `SRC_REDRIVE_CAP=4`, `RESOLVE_WATCHDOG_MS=6000` — all unchanged |
| `grep -l 'toast.downloadCorrupted' src/lib/i18n/*.ts \| wc -l` | 15 |

**Not verified (manual-only, per 31-VALIDATION.md):** real on-device corrupt-download behaviour (Android/iOS), the toast's visual batching feel, and actual native `nativeGet` streaming — the node suite exercises the mocked Capacitor bridge, not a device.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path, or schema surface. The two destructive local writes (`blobStore.del`, `library.removeDownload`) are the mitigations recorded as T-31-01-01/02 and are gated on `lastSrcKind === 'download-blob'` plus a per-uid one-shot.

## Self-Check: PASSED

- `src/lib/services/blob-store.ts` — FOUND
- `src/lib/services/download-track.ts` — FOUND
- `src/lib/stores/player.svelte.ts` — FOUND
- `src/routes/(app)/+layout.svelte` — FOUND
- `src/lib/i18n/en.ts` (+14 locales) — FOUND
- commit `20cdd03` — FOUND
- commit `5368988` — FOUND
- commit `b9e5b88` — FOUND
