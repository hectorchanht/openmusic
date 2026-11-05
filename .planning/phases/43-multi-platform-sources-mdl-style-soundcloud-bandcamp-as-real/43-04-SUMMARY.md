---
phase: 43-multi-platform-sources-mdl-style-soundcloud-bandcamp-as-real
plan: 04
subsystem: downloads / media
tags: [hls, download, docs]
requires: []
provides:
  - "services/hls.ts: isHlsUrl, canPlayNativeHls, parseHlsMedia, stitchHls"
  - "download-track: .m3u8 downloads stitched to .m4a"
affects: [download-track, CLAUDE.md, README.md, settings/about]
tech-stack:
  added: []
  patterns: ["URL-shape detection (no source named)", "bounded-concurrency fetch assembled in order"]
key-files:
  created:
    - src/lib/services/hls.ts
    - src/lib/services/hls.test.ts
    - .planning/todos/pending/walksource-page-8-true-page-adapters.md
  modified:
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
    - CLAUDE.md
    - README.md
    - src/routes/(app)/settings/about/+page.svelte
decisions:
  - "canPlayNativeHls memo reset via exported _resetHlsSupportForTests() (not a doc parameter)"
  - "parseHlsMedia rejects non-https parts (T-43-14) and master playlists"
metrics:
  duration: ~10 min
  completed: 2026-11-04
  tasks: 3
  files: 8
---

# Phase 43 Plan 04: HLS download stitch + D-09 docs Summary

Pure `services/hls.ts` (URL-shape detect, memoized native-HLS feature test, https-only media-playlist parser, init+segment browser stitch into one `audio/mp4` Blob) wired into `downloadTrack` so an `.m3u8` download saves as `.m4a` instead of a playlist text file; CLAUDE.md "No HLS" relaxed to native-`<audio>`-only, SoundCloud/Bandcamp listed in README + About, and the walkSource page=8 bug filed as a todo.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 | hls.ts (TDD) | 8a227a8e (RED), 2b16aedc (GREEN) |
| 2 | download-track HLS branch (TDD) | 3ec9a93c (RED), dcb89ff2 (GREEN) |
| 3 | CLAUDE.md / README / About / todo | 8935448a |

## Verification (observed)

- `vitest --run hls.test.ts download-track.test.ts`: 134 passed (15 hls, 3 new download-track cases).
- `pnpm check`: 0 errors (18 pre-existing warnings).
- Task 3 grep chain: `VERIFY_OK`.
- Acceptance greps: 4 exported functions; 0 `MediaSource|hls.js` outside comments; `stitchHls|isHlsUrl` in download-track = 4; `soundcloud` in download-track = 0.

## Deviations from Plan

- **[Rule 2 - Security] non-https part rejection** in `parseHlsMedia` per threat T-43-14 (plan threat model required it; behavior list didn't). Test added.
- **[Rule 1 - Hygiene] Non-HLS download block re-indented** one tab inside the new `else` — whitespace-only, logic untouched.
- `stitchHls` also throws on a non-ok playlist fetch and an empty playlist (no parts) — never yields an empty Blob.

## TDD Gate Compliance

RED (`test(43-04)`) then GREEN (`feat(43-04)`) commits exist for both TDD tasks.

## Known Stubs

None.

## Self-Check: PASSED
