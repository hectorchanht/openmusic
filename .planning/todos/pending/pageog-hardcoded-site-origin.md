---
title: PageOg hardcodes openmusic.lol — og:url is cross-origin on pages.dev shares
date: 2026-08-07
priority: low
---

# PageOg hardcodes `openmusic.lol` as the OG origin

[`src/lib/components/PageOg.svelte`](../../../src/lib/components/PageOg.svelte) pins:

```ts
const SITE = "https://openmusic.lol";
const FALLBACK_IMG = `${SITE}/og.svg`;
const url = $derived(`${SITE}${page.url.pathname}`);
```

A link shared from `https://openmusic.pages.dev/song/…` therefore emits
`og:url = https://openmusic.lol/song/…` — a different origin than the page the crawler fetched.
Some crawlers canonicalize to `og:url` and re-fetch it, so the preview may describe the `.lol`
deployment rather than the one that was shared.

**Fix:** derive the origin from `page.url.origin` instead of the constant, with `openmusic.lol` as
the SSR/empty fallback. Keep `og:image`'s absolute-URL requirement intact (crawlers reject relative
`og:image`).

**Also check:** `og:type` is hardcoded `music.song`, so the album and artist routes both emit
`music.song`. Correct values are `music.album` and `profile`. Worth folding into the same change —
pass the type through the `og` object from each `+page.ts`.

**Why low priority:** the primary domain is `openmusic.lol` and the card still renders. Only affects
previews of `pages.dev` / preview-deployment links.

**Not** part of Phase 30 (share-link slimming) — independent, though both touch `PageOg`. If Phase 30
runs first, rebase this on top of it.
