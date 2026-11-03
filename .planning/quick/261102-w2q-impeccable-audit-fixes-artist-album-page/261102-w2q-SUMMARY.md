---
quick_id: 261102-w2q
status: complete
commit: 46118733
---

# Quick 261102-w2q — impeccable audit fixes, artist + album pages

All recommended actions from the `/impeccable audit` (11/20) applied in one commit.

- **RTL / lang:** `(app)/+layout.svelte` effect writes `<html lang>` + `dir` (rtl for `ar`) from
  `settings.appLang`. `.dir-flip` (app.css) mirrors chevrons under `[dir='rtl']` — applied to the
  PageHeader back chevron and the artist page's About / Albums chevrons. `text-align: start` and
  `margin-inline-start` on both pages.
- **Labels:** album Play uses new `album.playAlbum` (15 locales) instead of `nowplaying.playPause`; glyph filled.
- **Supporter dot:** restored on the album Download button for non-supporters (`isSupporter()` read
  in an effect — the route SSRs). Stale "free for everyone" comment replaced.
- **Hit areas:** hero action circles stay 34px, `::before` inset -5px → 44px hit.
- **Cover fallbacks:** hero + related avatars paint `url(), coverGradient/fallbackCoverSeed` — the
  hard-coded `#3a2d63→#1a1326` is gone.
- **Depth / hover:** page-level hero + play shadows removed; `:hover` gated behind `(hover: hover)`.
- **Dead code:** album playlist picker (unreachable), likeAlbum/albumLiked, numFmt, commented
  Last.fm info block, `.info`/`.note`; artist commented dzstats/readmore/see-all/sk-rank + CSS,
  duplicate `.count` declarations. Bug found on the way: the dzinfo skeleton size rule targeted the
  dead `.info` selector, so its bars never painted — now `.dzinfo .sk-info`.

Verify: `pnpm check` 0 errors (no warnings in touched files), `pnpm test` 249 files / 5210 tests pass.
Not verified in a browser: SSR dev server 500s locally (Cloudflare remote-binding auth), so RTL
layout and the hit areas were not exercised on a render.

Known gaps (out of scope): other app-wide chevrons/`text-align: left` are not RTL-flipped yet; the
marquee scrolls leftward even in RTL; `--fs-*` multipliers were not added to body-role text (no
body `--fs-*` variable exists; root rem scaling still applies).
