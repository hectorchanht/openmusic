---
phase: 36-tag-downloaded-songs-with-full-metadata
plan: 02
subsystem: services
tags: [audio-tags, taglib-wasm, id3v2, mp4-ilst, flac-vorbis, binary-fixtures, round-trip, purity]

# Dependency graph
requires: [36-01]
provides:
  - "src/lib/services/audio-tags.ts — the ONE tag codec: writeAudioTags / readAudioTags / tagAudioBlob / dataUrlToBytes / TAG_MAX_BYTES"
  - "Byte-sniffed container dispatch (mp3 / m4a / flac) that never trusts a URL extension"
  - "Never-throw contract: any failure returns the caller's original bytes with a loggable discriminant"
  - "Four committed synthetic audio fixtures + regeneration recipe (the repo's first binary test fixtures)"
affects: [36-03, 36-04, 36-05, 34]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Memoised dynamic import() for a heavy optional dependency, with the memo cleared on a failed load"
    - "Co-located binary fixtures under src/**/__fixtures__/ addressed via new URL(..., import.meta.url)"
    - "Result discriminant returned to the caller instead of importing a runes-store logger (purity)"

key-files:
  created:
    - src/lib/services/audio-tags.ts
    - src/lib/services/audio-tags.test.ts
    - src/lib/services/__fixtures__/README.md
    - src/lib/services/__fixtures__/tiny.mp3
    - src/lib/services/__fixtures__/tiny.m4a
    - src/lib/services/__fixtures__/tiny-nonfaststart.m4a
    - src/lib/services/__fixtures__/tiny.flac
  modified: []

key-decisions:
  - "Fixtures live at src/lib/services/__fixtures__/, NOT tests/fixtures/: this repo has no tests/ directory and every test is co-located with its source, so a top-level tests/ would be the only exception. Vitest's include glob only collects *.test.ts, so the binaries are inert and no app code imports them — they never enter a bundle."
  - "NO `browser` guard from the $app environment module. The module only runs from user-initiated download/retag in the client, the app is ssr=false everywhere, and the SSR/bundle protection comes entirely from the dynamic import. Dropping the $app dependency is also what lets the tests call tagAudioBlob directly under node."
  - "tagAudioBlob awaits the codec load BEFORE reading the blob, so a wasm/import failure is reported as 'error' while unrecognised bytes are 'unknown-container'. Two failure classes a caller will want to tell apart, and it also avoids pulling a 40 MB blob into memory only to find the codec unavailable."
  - "A failed dynamic import un-memoises itself. A rejected promise cached in module scope would poison every later download for the rest of the session."
  - "writeAudioTags copies out of the wasm heap (`new Uint8Array(file.getFileBuffer())`) because dispose() runs before the caller touches the bytes — handing back a live heap view would be a use-after-free."

patterns-established:
  - "Round-trip proof over real container bytes replaces device testing for byte-layout correctness: write tags, parse them back, and assert the omit rules on the RAW bytes."
  - "The mdat-first MP4 fixture is the canonical trap case — its failure mode is silent corruption, not an error, so it gets its own fixture and its own test."

requirements-completed: [D-02, D-03, D-06, D-07, D-08, D-09, D-10]

# Metrics
duration: 11min
completed: 2026-09-13
---

# Phase 36 Plan 02: Audio Tag Codec + Round-Trip Fixtures Summary

**One pure, store-free `audio-tags.ts` writes and reads ID3v2 / MP4 `ilst` / FLAC Vorbis+PICTURE through a lazily-imported taglib-wasm, never throws, and is proven by 29 tests that round-trip real mp3, m4a (both layouts) and flac bytes in 139 ms.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-09-13T19:15:40Z
- **Completed:** 2026-09-13T19:26:30Z
- **Tasks:** 3
- **Files created:** 7 (3 text, 4 binary)

## Accomplishments

- Built the module every remaining Phase 36 plan and Phase 34's device import code against (36-D-03). The exported surface matches the plan's `<interfaces>` block exactly — `AudioTagFields`, `AudioContainer`, `TagOutcome`, `TAG_MAX_BYTES`, `writeAudioTags`, `readAudioTags`, `tagAudioBlob`, `dataUrlToBytes` — so 36-03 and 36-04 can be written without re-reading this file.
- Proved the write side with the read side, on real bytes, with no device: all three containers round-trip every field including a CJK title and an embedded PNG cover.
- Covered the `mdat`-first MP4 case that silently corrupts naive taggers. The fixture's layout survives a tag write (`ftyp / mdat / moov` in, `mdat` still before `moov` out) and the tags parse back.
- Asserted the omit rules on RAW bytes, not just on the parser's view: with a field absent, the output contains no `©day`/`©gen`/`©cmt`/`©too`, no `DATE=`/`GENRE=`/`COMMENT=`/`ALBUM=`/`TRACKNUMBER=`, no `TYER`/`TDRC`/`TCON`/`COMM`/`TALB`/`TRCK`, and no `trkn`. That is the difference between "the library says there is no album" and "there is genuinely no album atom in the file".
- Added the repo's first committed binary test fixtures, with a recipe that lets a contributor on another OS regenerate them and a licensing note explaining why they are clean.

## Verification Evidence (observed, not assumed)

| Command | Exit | Observed output |
|---|---|---|
| Task 1 fixture guards (magic bytes, `ftyp` at offset 4, README contains `afconvert`, combined size) | 0 | `VERIFY EXIT=0`; `du -ck` total 44 kB < 64 kB |
| `afinfo tiny.m4a` vs `afinfo tiny-nonfaststart.m4a` | 0 | Both: `estimated duration: 0.917098 sec`, `audio bytes: 4228` — the `stco` patch is correct |
| python atom list on `tiny-nonfaststart.m4a` | 0 | `['ftyp', 'mdat', 'moov']` |
| `xxd -l 4 tiny.mp3` | 0 | `fffb 9000` |
| Task 2 static guards (no static taglib import, both dynamic specifiers present, no store/i18n/`$app` reference, 4 exported functions, no year/genre/comment/duration token in non-comment lines, `type: blob.type` present) | 0 | `TASK2 VERIFY EXIT=0`; `export default` count `0` |
| `pnpm check` | 0 | `COMPLETED 4507 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| `pnpm vitest --run src/lib/services/audio-tags.test.ts` | 0 | `Test Files 1 passed (1)` · `Tests 29 passed (29)` · **355 ms wall, 139 ms in tests** |
| `pnpm test` (full) | 0 | `Test Files 118 passed (118)` · `Tests 2184 passed (2184)` · 8.96s |
| `grep -rl "from 'taglib-wasm" src/` | 1 (no match) | Still no static import anywhere — dynamic only |
| `grep -c "process.cwd()\|tests/fixtures" audio-tags.test.ts` | — | `0` (fixtures addressed only via `import.meta.url`) |

Every `-t` filter named in 36-VALIDATION.md's per-task map was run individually and selected at least one passing test:

| Filter | Result |
|---|---|
| `mp3 round-trip` / `m4a round-trip` / `flac round-trip` | 2 passed each |
| `non-faststart` | 1 passed |
| `round-trip` | 8 passed |
| `unknown container` | 2 passed |
| `omits` | 6 passed |
| `omits album` | 3 passed |
| `no track number` | 3 passed |
| `never throws` | 1 passed |
| `preserves mime` | 1 passed |
| `size ceiling` | 1 passed |
| `sniffs container` | 1 passed |

Plan minimums: `audio-tags.ts` is 269 lines (≥120 required), `audio-tags.test.ts` is 291 lines (≥150), 29 tests (≥16), 0 skipped.

## Task Commits

1. **Task 1: Four synthetic fixtures + regeneration README** — `c66f04b` (test)
2. **Task 2: The pure audio-tags.ts codec** — `a202b75` (feat)
3. **Task 3: Round-trip + guard suite** — `dc30f3a` (test)

## Files Created

- `src/lib/services/audio-tags.ts` — the codec. Header carries the purity contract, the "no `$app` guard" rationale, and the never-throws contract; `TAG_MAX_BYTES` carries the measured 6×-file-size memory figures and a `ponytail:` note pointing at emulator tuning.
- `src/lib/services/audio-tags.test.ts` — 29 tests across 6 describes: module shape/purity, per-container round-trip, omit rules, failure fall-through, `tagAudioBlob` contract, `dataUrlToBytes`.
- `src/lib/services/__fixtures__/{tiny.mp3, tiny.m4a, tiny-nonfaststart.m4a, tiny.flac}` — 44 kB total, synthetic, licensing-clean.
- `src/lib/services/__fixtures__/README.md` — the verbatim `say` / `afconvert` / python recipes, the full non-faststart rebuild script (top-level atom re-emit + `stco` delta patch), the `afinfo` equality check, and a per-file expected-size table.

No existing file was modified, so nothing this plan did can regress Phase 34's or Phase 35's concurrent work.

## Decisions Made

See `key-decisions` in the frontmatter. The two the plan explicitly asked to be recorded:

> **Fixture location.** `src/lib/services/__fixtures__/`, co-located with the code under test, because this repo has no `tests/` directory and a top-level one would be the sole exception to a consistent convention. Vitest's `include: ['src/**/*.{test,spec}.{js,ts}']` means `.mp3`/`.m4a`/`.flac` under `src/` are never collected, and no app module imports them, so they are inert and never reach a bundle. The repo has no `.gitattributes` and none was added — git auto-detects these as binary.

> **No `browser` guard.** Deliberately omitted. Nothing in the module touches `window`, `localStorage` or the DOM; it runs only from user-initiated download/retag; the app is `ssr=false` app-wide; and the entire SSR/Cloudflare-build protection is the dynamic `import()`, which pulls nothing until a call happens. Not importing the `$app` environment module is also what lets the node tests call `tagAudioBlob` directly.

**Observed suite runtime: 355 ms wall / 139 ms in tests** for all 29 tests, including four full wasm-backed write+read round trips per container. Fast enough that 36-03 and 36-04 can keep adding cases here without a feedback-latency problem.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `Uint8Array<ArrayBuffer>` instead of plain `Uint8Array` on the bytes that become a Blob**
- **Found during:** Task 2 (`pnpm check`), then again in Task 3
- **Issue:** The plan's `<interfaces>` block specifies `Promise<{ bytes: Uint8Array; format }>`. Under TS 5.9's generic `Uint8Array<TArrayBuffer>`, the bare spelling defaults to `ArrayBufferLike`, which includes `SharedArrayBuffer` and is therefore NOT assignable to `BlobPart`. `new Blob([out.bytes], …)` was a hard type error — the same friction `media-artwork.test.ts:22-24` already documents for `BodyInit`.
- **Fix:** narrowed `writeAudioTags`'s return to `Uint8Array<ArrayBuffer>` (our value is always a fresh plain-buffer copy) and typed the test's `fixture()` helper the same way. No cast, no `as any`, and `Uint8Array<ArrayBuffer>` is assignable to plain `Uint8Array`, so every consumer the plan's interface block promised still compiles.
- **Files modified:** `src/lib/services/audio-tags.ts`, `src/lib/services/audio-tags.test.ts`
- **Commits:** `a202b75`, `dc30f3a`

**2. [Rule 3 - Blocking] Purity comment reworded to survive the plan's own grep**
- **Found during:** Task 2 verification
- **Issue:** the plan's verify runs `! grep -q '\$lib/stores\|\$lib/i18n\|\$app/'` over the whole file, including comments. The purity-contract header explained the rule by naming those exact aliases, so the file failed its own guard.
- **Fix:** the header now says "anything under the lib/stores or lib/i18n aliases, or any SvelteKit `$app` module" — same meaning, no literal alias strings. The test's source-guard still asserts the real thing (`$lib/stores`, `$lib/i18n`, `$app/` absent from comment-stripped source).
- **Files modified:** `src/lib/services/audio-tags.ts`
- **Commit:** `a202b75`

**3. [Rule 1 - Bug] Test's comment-stripper missed `/**` lines**
- **Found during:** Task 3 first run (1 failing test)
- **Issue:** the `download-track.test.ts` idiom filters lines starting with `//`. A doc comment opening with `/**` survived it, so the purity guard matched `displayIndex` inside a comment that exists precisely to say `displayIndex` must never be used.
- **Fix:** filter is now `!/^\s*(\/\/|\*|\/\*)/.test(l)`, covering all three comment-line shapes.
- **Files modified:** `src/lib/services/audio-tags.test.ts`
- **Commit:** `dc30f3a`

### Design choice the plan left implicit

`tagAudioBlob` awaits `loadTagLib()` before reading the blob. The plan's Task 2 directives had `writeAudioTags → null → 'unknown-container'` while Task 3's `"never throws"` test demands `'error'` when the `taglib-wasm` import itself throws — and `writeAudioTags` swallows that failure into the same `null`. Loading first separates the two: a codec/infrastructure failure is `'error'`, unrecognised bytes are `'unknown-container'`. It also means a 40 MB blob is never copied into memory just to discover the codec is unavailable. The plan's own size-ceiling ordering is preserved (`no-fields` → size check → load → `arrayBuffer()`).

## Assumption Drift (advisory)

**1. `pnpm check` was expected to be RED on `main` and is GREEN**
- **Found during:** Task 2 verification
- **Planned:** the execution briefing said `pnpm check` is currently red from Phase 35's committed TDD RED file (`src/lib/backup/backup-logic.test.ts` importing a not-yet-written module), and that Phase 36 should judge itself only by its own files.
- **Actual:** `pnpm check` reports `4507 FILES 0 ERRORS`. Phase 35 evidently landed its GREEN implementation during this run.
- **Why it matters:** the verification evidence above is a genuine whole-repo zero, not a scoped-down one. Nothing was skipped or filtered to reach it.

## Known Stubs

None. Every exported function is fully implemented and exercised by tests.

## Issues Encountered

None beyond the deviations above. No `.git/index.lock` contention was hit; every `git add` was scoped to this plan's own files.

## User Setup Required

None. No new dependency (36-01 installed `taglib-wasm@2.2.2`), no secret, no dashboard action.

## Next Phase Readiness

- **36-03 (the `download-track.ts` seam) is unblocked.** Call `tagAudioBlob(rawBlob, fields, artDataUrl)` between `readBlobWithProgress` and the `blobStore.put` / `saveBlobToDisk` calls, write `out.blob` unconditionally, and log `out.result` — the store-free discriminant exists precisely so the caller does the logging.
- **36-04 (retag) uses the same entry point**, and `readAudioTags` is there to verify replacement bytes parse BEFORE anything touches the disk (RESEARCH Pitfall 10's ordering rule).
- **Carry forward:** the wasm stays behind the dynamic import — a static `import … from 'taglib-wasm'` anywhere in `src/` would put ~686 kB in the entry chunk; there is a `grep -rl` guard for it in the plan's verification and it currently returns nothing.
- **Carry forward (Pitfall 9):** the service worker must exclude the `.wasm` from precache, or every PWA user downloads 686 kB on every deploy. Not this plan's file; 36-03 or 36-05 owns it.
- **Carry forward (Pitfall 5, user-visible):** omitting `album` (36-D-10) does NOT give "Unknown album" on Android — the scanner substitutes the parent folder name, so an album-less download will appear under a pseudo-album called "OpenMusic", and an artist-less one as `<unknown>`. That is OS behaviour, not a placeholder the app wrote, but the user should hear it before they see it.

---
*Phase: 36-tag-downloaded-songs-with-full-metadata*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 7 claimed files exist on disk; all three task commits (`c66f04b`, `a202b75`, `dc30f3a`) exist in git.
