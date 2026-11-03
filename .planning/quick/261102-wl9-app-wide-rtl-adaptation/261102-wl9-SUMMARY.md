---
quick_id: 261102-wl9
status: complete
commit: 974dd0f6
---

# Quick 261102-wl9 — app-wide RTL adaptation

- 58 physical declarations in 34 files converted to logical properties (style blocks only).
- Reading-direction positioning moved to `inset-inline-*`: desktop rail (+ Nowbar / NowPlaying
  inset past it), home tile menu + quality badge, TrackMenu caret + candidate tick, search clear
  button, VideoStage waiting badge + quality menu.
- ShelfChevrons: prev/next on logical sides, icons `.dir-flip`, RTL `scrollLeft` (0 → -max)
  sign-normalised in the component; `shelf-scroll.ts` pure maths unchanged.
- Marquee keyframe travels `var(--marquee-sign)` (-1 LTR, +1 RTL).
- `.dir-flip` on SettingRow, settings support card, home subhead, songs-of-year chevrons.
- Deliberately physical: swipe reveals (finger direction), NowPlaying cover strip, scrubber, switch
  thumbs, centred toasts, progress fills.
- settings-ui.test.ts string assertions updated (border-inline-start-color, `chev dir-flip`).

Verify: `pnpm check` 0 errors; `pnpm test` 249 files / 5210 tests pass (one earlier run timed out
in names.test.ts under CPU load from another session's vitest; rerun clean).
Not verified on a render: no RTL browser pass was possible here (SSR dev server 500 on CF remote
binding auth; root SPA routes would work but no browser tool in this session).
