---
quick_id: 261103-hdn
slug: artist-album-audit-round2
date: 2026-11-03
---
# Quick 261103-hdn: artist + album audit round 2 (harden, optimize, document, polish)

From the 16/20 re-audit.

1. harden: artist Favourite toggle keeps one accessible name (state on aria-pressed); Last.fm bio link announces it opens a new tab (new key `common.opensNewTab`, 15 locales); album busy Download uses aria-disabled so focus and aria-busy survive.
2. optimize: new `use:lazyBg` action defers artist-page shelf cover URLs (albums + more-like-this) until the tile nears view in its scroll container.
3. document: DESIGN.md gains Body Large 0.9375rem, Body Small 0.8125rem, Caption 0.6875rem and `rounded.tile` 10px (all already in wide use).
4. polish: artist heading links (Albums, About) get a 44px hit area via padding + equal negative margin.
