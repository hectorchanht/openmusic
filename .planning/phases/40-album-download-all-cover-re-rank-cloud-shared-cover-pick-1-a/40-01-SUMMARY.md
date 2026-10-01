---
phase: 40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a
plan: 01
subsystem: download
tags: [download, zip, filename, pure]
requires: []
provides:
  - "zip-store.ts: crc32, buildZip, ZipEntry (store-only ZIP, no Zip64)"
  - "download-filename.ts: sanitizePathSegment, albumDir, albumFolder"
affects: [40-02, 40-03]
tech-stack:
  added: []
  patterns: ["Blob composition (parts referenced, not copied) + streamed CRC"]
key-files:
  created:
    - src/lib/services/zip-store.ts
    - src/lib/services/zip-store.test.ts
  modified:
    - src/lib/services/download-filename.ts
    - src/lib/services/download-filename.test.ts
decisions:
  - "Zip64 guard = one up-front total-archive-size check (> 0xFFFFFFFF -> null) plus entry count > 0xFFFF, both before any blob is streamed"
  - "Path segment byte cap MAX_PATH_SEGMENT_BYTES = 180, code-point-safe truncation; trailing dots/spaces re-stripped after a cut"
metrics:
  duration: ~4min
  completed: 2026-09-30
  tasks: 2
  files: 4
---

# Phase 40 Plan 01: ZIP writer + album path segments Summary

Hand-written store-only ZIP writer (UTF-8 names, streamed CRC-32, blobs composed not copied, null instead of Zip64) plus byte-capped `<Artist>/<Album>` path-segment helpers that wrap the one `sanitizeFilename`.

## What was built

- `src/lib/services/zip-store.ts`: `crc32(bytes, crc?)` (chainable), private `blobCrc` reading `blob.stream()` chunk by chunk, `buildZip(entries)` that writes 30 B local headers, 46 B central headers and a 22 B EOCD (flags 0x0800, method 0, DOS time/date). It returns `Blob` type `application/zip`, or `null` above 0xFFFF entries or 0xFFFFFFFF archive bytes. Both guards run before any blob is read.
- `src/lib/services/download-filename.ts`: `sanitizePathSegment` (sanitizeFilename, then strip control chars, collapse whitespace, trim, strip edge dots/spaces, 180-byte UTF-8 cap), `albumDir` (native subPath, `A/B` / `B` / `''`), `albumFolder` (`A - B` / `A|B` / `OpenMusic`). Fixed the wrong `MAX_FILENAME_BASE` comment (120 CJK chars = 360 bytes).

## Verification (observed)

- `pnpm exec vitest --run src/lib/services/zip-store.test.ts src/lib/services/download-filename.test.ts`: 31 passed (6 zip, 25 filename, 7 of them in the new describe block with 20 assertions). The `0xcbf43926` check value is asserted.
- RED observed before each GREEN: the zip test file failed (module missing), and 7 path-segment tests failed.
- Manual cross-check: a 2-entry zip (ASCII + `周杰倫 - 葉惠美/七里香.m4a`, 100 KB body) was written from the module via `node --experimental-strip-types` to the scratchpad. `unzip -t` printed "No errors detected", and `python3 -m zipfile -l` listed the CJK name correctly.
- `pnpm check`: 0 errors (12 pre-existing warnings, all in unrelated `.svelte` files).
- Acceptance greps: 3 zip exports, 0 `$lib/stores`/`$app/` imports, `ponytail:` and `D-03` present. 3 new filename exports, exactly 1 `replace(/[` (the sanitizer's char class), and a single `MAX_PATH_SEGMENT_BYTES = 180` line.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] BlobPart typing error under TS 5.9**
- **Found during:** plan verification (`pnpm check`)
- **Issue:** `central: Uint8Array[]` is `Uint8Array<ArrayBufferLike>`, which is not assignable to `BlobPart`.
- **Fix:** typed it as `Uint8Array<ArrayBuffer>[]`.
- **Files modified:** src/lib/services/zip-store.ts
- **Commit:** e2db492f

**2. [Convention] Decision-ref form.** Comments use the house `40-D-03` / `40-D-01` form (same as the existing `34-D-12`) rather than "Phase 40 D-03". The test describe title keeps the plan's literal text.

**3. [Acceptance-driven] Edge dot/space regex as a module constant** (`EDGE_DOTS_SPACES`). It is reused for the post-truncation re-strip, which keeps the `replace(/[` count at exactly 1.

## Known Stubs

None. Nothing imports these modules yet (by design; Plans 02/03 consume them).

## Self-Check: PASSED

- FOUND: src/lib/services/zip-store.ts, src/lib/services/zip-store.test.ts, src/lib/services/download-filename.ts, src/lib/services/download-filename.test.ts
- FOUND commits: dc475337, 1c16db1b, 1f812885, e2db492f, 783f3523
