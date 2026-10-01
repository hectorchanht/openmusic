---
phase: quick-261001-grb
plan: 01
subsystem: downloads / toasts / i18n
tags: [download, toast, i18n, ux]
requires: []
provides:
  - "downloadLabel(artist, title) pure helper (src/lib/services/download-label.ts)"
  - "toast.downloading / toast.noAudioFor keys; {label} in albumProgress, albumSaved, downloaded, downloadFailedKeptInLibrary (15 locales)"
affects:
  - src/routes/(app)/album/[name]/+page.svelte
  - src/lib/components/TrackMenu.svelte
  - src/lib/components/DownloadControl.svelte
  - src/lib/components/ToastHost.svelte
tech-stack:
  added: []
  patterns: ["label built in the UI from names.dnArtist/dnTitle, passed as a {label} param — stores/services stay i18n-free"]
key-files:
  created:
    - src/lib/services/download-label.ts
    - src/lib/services/download-label.test.ts
  modified:
    - src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
    - src/lib/i18n/i18n.test.ts
    - src/routes/(app)/album/[name]/+page.svelte
    - src/lib/components/TrackMenu.svelte
    - src/lib/components/DownloadControl.svelte
    - src/lib/components/ToastHost.svelte
decisions:
  - "Download toasts name what is downloading: album `artist - album n/total`, song `artist - song`, display-language names"
  - "ToastHost .msg is single-line + ellipsis for ALL toasts (not only download ones)"
metrics:
  duration: ~12min
  completed: 2026-10-01
  tasks: 2
  files: 22
---

# Quick 261001-grb: Download toast shows artist - album n/N Summary

Every download toast now names its subject: album jobs read `Downloading · 周杰倫 - 七里香 3/10` → `Saved · 周杰倫 - 七里香 10/10`, single songs read `Downloading · 陳奕迅 - 葡萄成熟時` → `Downloaded · 陳奕迅 - 葡萄成熟時`, via one pure `downloadLabel` helper and a `{label}` param in all 15 locales.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (RED) | ffdef349 | test(quick-261001-grb): add failing tests for labelled download toasts |
| 1 (GREEN) | 3a122562 | feat(quick-261001-grb): label helper + {label} download toast keys in all locales |
| 2 | e4e61559 | feat(quick-261001-grb): download toasts name the artist and album/song |

## Verification (observed)

- `pnpm vitest --run src/lib/i18n/i18n.test.ts src/lib/services/download-label.test.ts`: RED run failed as expected (1 failed / 33 passed, both files failing); after implementation 36/36 passed. The grep that checks all 15 locales have `toast.downloading` passed.
- `pnpm check`: 0 errors, 12 warnings in 2 files (unused CSS selectors in `artist/[name]/+page.svelte` and one other file; these were already there and this change did not touch them).
- `pnpm vitest --run` (full suite): 172 files, 3918 tests passed.
- Grep gate: every `toast.(downloading|albumProgress|albumSaved|downloaded|downloadFailedKeptInLibrary|noAudioFor)` call outside `src/lib/i18n/` passes `label`.
- `download-album.ts` / `download-track.ts`: 0 lines changed.
- E2E on the already-running dev server (5173). I drove headless Chrome over CDP at 375x812 mobile (DPR 2):
  - Album download (`/album/七里香?artist=周杰倫`, 10 tracks): `Downloading · 周杰倫 - 七里香` → `… 1/10` … `… 10/10` → `Saved · 周杰倫 - 七里香 10/10`. The pill was one line (height 36px) and stayed inside the viewport (x 64–311).
  - TrackMenu startDownload (U87 row 6, options → Download): `Downloading · 陳奕迅 - 葡萄成熟時` → `Downloaded · 陳奕迅 - 葡萄成熟時`.
  - DownloadControl album-stub row (resolve closure): `Preparing download…` (generic, as planned, because the song is not known before resolve) → `Downloaded · 陳奕迅 - 阿牛`.
  - Ellipsis: I pushed a long mixed CJK/Latin label through the real toast store. The pill was x 15–360 of 375, one line (36px). scrollWidth 663 vs clientWidth 313, so the text was truncated with an ellipsis.
  - Screenshots: `/private/tmp/claude-501/-Users-laichan-code-tung-openmusic/b3813084-0071-47c0-b3df-530ff9268cf2/scratchpad/grb-toast-375.png` (album progress 1/10) and `.../scratchpad/grb-toast-375-ellipsis.png` (ellipsis).
- NOT E2E-verified: TrackMenu `pickDownload` ("Download from…" sheet). It has the same code shape as startDownload and passes the type check. The failure and no-audio variants were also not seen live, because every attempt saved.

## Deviations from Plan

None. The plan was executed as written. One small addition: DownloadControl has a local `labelFor(track)` so the start and result toasts build the label the same way.

## Known ceiling

- Ellipsis truncates from the end, so on a very long album label the `n/total` counter is hidden. Fix if needed: put the counter in its own non-shrinking span.
- The ellipsis rule applies to every toast, so long toasts that used to wrap onto two lines are now cut to one line.

## Threat Flags

None. The toast still renders as text interpolation (`{toast.msg}`), with no `{@html}`.

## Self-Check: PASSED

- FOUND: src/lib/services/download-label.ts, src/lib/services/download-label.test.ts
- FOUND commits: ffdef349, 3a122562, e4e61559
