---
phase: quick-260926-vdp
plan: 01
status: complete
subsystem: lyrics picker / now-playing / artist / library UI
tags: [lyrics, track-menu, icons, a11y, i18n]
requires: []
provides: [menu.changeLyrics, menu.useTheseLyrics, menu.currentLyrics]
affects: [TrackMenu, NowPlaying, artist page, library page]
tech-stack:
  added: []
  patterns: [inner scroll box stops pointerdown so dragClose never arms, icon-only buttons with aria-label + title]
key-files:
  created: []
  modified:
    - src/lib/components/TrackMenu.svelte
    - src/lib/components/NowPlaying.svelte
    - src/routes/(app)/artist/[name]/+page.svelte
    - src/routes/(app)/library/+page.svelte
    - src/lib/i18n/i18n.test.ts
    - src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "Lyrics picker: only the card's footer button picks; the scroll box stops pointerdown so it neither picks nor drags the sheet"
  - "Artist round look scoped to .actions so the Show more .act pill stays a text pill"
metrics:
  duration: ~6min
  completed: 2026-09-26
---

# Quick 260926-vdp: Change lyrics picker cards + icon-only tabs/action bars Summary

"Fix lyrics" is now "Change lyrics" in all 15 locales. The picker shows one card per source with the full plain-text lyrics in a scroll box about 9 lines tall, plus a "Use these lyrics" button. The Now Playing tabs, the artist action bar and the library action bar are now icon-only buttons, each labelled with aria-label and title.

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 | Renamed `menu.fixLyrics` to `menu.changeLyrics` and added `menu.useTheseLyrics` / `menu.currentLyrics` in 15 locales. Added the ABSENT guard for the old key. TrackMenu now uses the new key. | f42c6ea5 |
| 2 | Lyrics picker cards: source label, "Current lyrics" check, full `parseLyrics` text in a 12rem `pre-line` box (the box stops `pointerdown` from bubbling), footer pick button. Removed `.lyr-prev`. | 5dad998f |
| 3 | NowPlaying: ListMusic/MicVocal/MessageCircle/Sparkles icons with aria-label + title (title only on the inert headings); the count is now an absolute pill on the Comments icon. Artist page: Heart · Play(56px) · Share circles, `aria-pressed` on Favourite, `.act.primary` removed. Library: four 34px labelled circles. | 8bebd666 |

## Verification (observed)

- Task 1 verify chain: all grep gates passed; `vitest run src/lib/i18n/i18n.test.ts`: 33/33 passed.
- Task 2 verify chain: grep gates passed (no `lyr-prev`, one `useTheseLyrics`, one `currentLyrics`, no `{@html` in the picker block, explicit `pickLyrics(c.lrc)` onclick); `pnpm check`: `0 ERRORS 0 WARNINGS`.
- Task 3 verify chain: grep gates passed (6 data-tab buttons have aria-label, no text-label tab buttons, no artist text spans, `act play`, `aria-pressed={favArtist}`, no `act.primary`, library labels present); `pnpm check`: `4635 FILES 0 ERRORS 0 WARNINGS`; `pnpm test`: 164 files, 3635 tests passed.
- `grep -rn fixLyrics src/`: only the ABSENT entry in `i18n.test.ts`.
- Not verified here: browser E2E (the orchestrator runs it). That covers the card scroll not closing the sheet, the icon hover titles, the count pill position, and the round buttons.

## Deviations from Plan

None. The plan was executed as written.

## Known Stubs

None.

## Self-Check: PASSED

- Commits f42c6ea5, 5dad998f, 8bebd666 present in `git log`.
- All modified files exist; SUMMARY written at the planned path.

## Orchestrator follow-up (post-execution)

- **Bug caught in E2E, fixed in `eeade19d`:** the picker's `.lyr-body` stopped `pointerdown` with a child `onpointerdown`, but Svelte 5 delegates that to the app root, so it ran after dragClose's native listener had armed — a pull inside the lyrics box still dragged the sheet. dragClose now skips a pointerdown starting inside any `[data-no-drag]` descendant; the box carries it. Verified in the browser (with a setPointerCapture shim for synthetic pointers): pull inside `[data-no-drag]` → sheet stays at translateY(0), pull on the header → translateY(80px).
- **Browser E2E (375x812):** Now Playing tabs are icon-only (ListMusic / MicVocal / MessageCircle / Sparkles) with aria-label + title; comment badge top-right of the Comments icon. Track menu reads "Change lyrics"; picker header "Change lyrics"; a QQ card showed the full 63-line lyrics in a 192px scroll box with "✓ Current lyrics" and "Use these lyrics" (a later retry returned "No lyrics found" — upstream flake, unrelated). Artist page: Favourite 34px circle (aria-pressed), Play 56px primary circle, Share 34px circle, no text; "Show more" keeps its text. Library bar verified in code (lists empty in the test browser).
