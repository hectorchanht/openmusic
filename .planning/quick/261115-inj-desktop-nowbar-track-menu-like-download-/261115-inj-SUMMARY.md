---
status: complete
---
# Quick 261115-inj summary

- Nowbar (desktop only, >=1024 + hover): `oncontextmenu` + `use:longpress` on `.np-open` open a TrackMenu (mounted in Nowbar, desktop only). Mobile long-press stays inert. Like + Download buttons in `.np-acts` beside the track info; Like toasts like NowPlaying's heart.
- NowPlaying: `MID_MQ = (min-width: 768px)`; at 768–1279 the sheet renders `.cols.two` (1fr 1.4fr): Up Next left, Lyrics/Comments/Related/About tabs right. Tab taps at that width switch the column instead of opening the sheet (`split`). >=1280 three-up unchanged.
- `pnpm check`: 0 errors. `pnpm test`: 5340 pass, 5 fail — pre-existing, in `track-menu-order.test.ts` and `settings-persist.svelte.test.ts`, untouched by this task.
- Not visually verified in a browser.
