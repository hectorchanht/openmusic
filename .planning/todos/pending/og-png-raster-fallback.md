---
title: /api/og fallback is an SVG — no major platform renders SVG as og:image; ship a static/og.png raster
date: 2026-08-07
priority: medium
source: 30-RESEARCH.md §C.11 (+ §D.15 per-platform og:image constraints)
---

# The branded OG fallback is an SVG, which most crawlers will not render

When `/api/og`'s resolve chain misses every tier (Deezer → iTunes → kuwo), it streams the branded
1200×630 card as `image/svg+xml` (1,493 bytes, inlined as a module constant in
[`src/lib/proxy/og-fallback.ts`](../../../src/lib/proxy/og-fallback.ts) per RESEARCH §C.11's
recommended zero-subrequest delivery).

**`static/og.svg` has known this since it was written** — its own first line says so:

```
<!-- 1200×630 share card. NOTE: many social crawlers (Slack, iMessage, some Twitter
     paths) don't render SVG og:image — a PNG export is the production-correct follow-up
     (needs an image-render toolchain, out of scope for this pass). -->
```

RESEARCH §C.11 corroborates it more strongly: *"SVG is not supported as an OG image by any
platform"* [CITED: previewog.com/og-image-guide, ogimagen.com/guides/og-image-sizes-2026 — MEDIUM
confidence, SEO-blog sources, but unanimous and consistent with the file's own note].

## This is the pre-existing status quo, NOT a Phase 30 regression

Before Phase 30, every cover-less share already emitted `og:image = ${SITE}/og.svg`
(`PageOg.svelte:18`, `+layout.svelte:77`). `/api/og`'s SVG fallback is therefore **byte-for-byte the
current behavior**. Phase 30 strictly improved the common case (a real cover now streams where a
dropped `?c=` carrier used to leave nothing); it did not make the miss case worse.

## Fix — one asset + one constant swap

1. Render `static/og.png` at 1200×630 from `static/og.svg` and **commit it** (a one-time asset — no
   build toolchain enters CI). On macOS: `qlmanage -t -s 1200 -o . static/og.svg`, then confirm the
   output is 1200×630 and crop/pad if `qlmanage` letterboxes it. `sips` cannot read SVG and
   `rsvg-convert` is not installed here (RESEARCH §C.11).
2. Swap the fallback constant in `src/lib/proxy/og-fallback.ts` to serve the PNG bytes with
   `Content-Type: image/png`. Keep the zero-subrequest posture — do **not** `fetch()` the asset and
   do **not** 302 to it (WhatsApp's crawler does not reliably follow redirects on image URLs,
   RESEARCH §D.15 / the LOCKED "stream, do not 302" decision).
3. Update the `content-type: image/svg+xml` assertions in
   `src/routes/api/og/og-endpoint.test.ts` to `image/png`.

**Why it was deferred:** in-phase it would have needed a `checkpoint:human-verify` of its own (the
raster has to be eyeballed), and it improves only the all-tier-miss path while the phase's actual
goal was the carrier-free URL + the real-cover common case. Deferred to preserve Phase 30 scope, per
RESEARCH §C.11's explicit recommendation ("keep the SVG in this phase to preserve scope, and log a
follow-up todo for the raster").

**Assumption to check when doing it:** RESEARCH risk A9 — *"`qlmanage -t` produces an acceptable
1200×630 PNG from `og.svg`"* is rated Low confidence and has not been tried. If it renders badly,
any one-off local rasterizer is fine; the deliverable is a committed PNG, not a pipeline.
