---
title: Carrier-free /artist/{name} looks up the HYPHENATED name upstream ("Post-Malone"), while the card shows the decoded one
date: 2026-08-07
priority: medium
source: .planning/phases/30-carrier-free-share-links-type-artist-title-api-og/deferred-items.md (30-05)
needs: a live upstream probe BEFORE any code change
---

# The artist page's card and its upstream lookup key disagree

After 30-05 made `artist/[name]/+page.ts` the dual-shape handler:

- the **loader** uses `decodePathSegment(params.name)`, so `/artist/Post-Malone` renders a card
  reading **"Post Malone"**;
- [`src/routes/(app)/artist/[name]/+page.svelte`](<../../../src/routes/(app)/artist/[name]/+page.svelte>)
  (~line 45) still uses the **raw** `params.name` as the Last.fm / Deezer **resolution** key — i.e. it
  looks up `"Post-Malone"`.

`entityCardUrl` has emitted the hyphen form since 30-01, so **every carrier-free artist share is
affected.** The `og:image` (`/api/og?type=artist&artist=…`) is built from the loader's value, so the
card art and the page's own artist data can resolve off two different strings.

## Impact: unknown, probably low

Upstream artist lookup may or may not be hyphen-insensitive. RESEARCH §B.8's justification for
accepting the hyphen↔space loss rests on `matchKey`'s punctuation-and-whitespace-stripping `norm()`
(`match-key.ts:29`) — but **that is a TRACK-matching path and does not apply to the artist page's
entity lookup.** So the loss is unproven here, not absorbed.

## Do NOT just switch it to `decodePathSegment` — probe first

Switching the page to `decodePathSegment` would also change resolution for **legacy** links whose
artist name genuinely contains a hyphen: `Jay-Z` → `Jay Z`. That is the risk case. CONTEXT locks the
hyphen↔space loss for the **card** only; it does not settle it for the **resolution path**, so this is
a compatibility judgment, not a bug fix.

### Required probe (live, both hosts)

For each of `Post Malone` / `Post-Malone` and `Jay-Z` / `Jay Z`, compare the top hit from:

1. Last.fm — `/api/lastfm/…` artist lookup
2. Deezer — `/api/deezer/search`

Then decide by what the probe shows:

- **both hosts hyphen-insensitive** → switch `+page.svelte` to `decodePathSegment` (card and lookup
  agree, one line, done);
- **hyphen is significant** → do **not** decode for lookup. Instead try the decoded form and fall back
  to the raw form (or vice-versa), which keeps `Jay-Z` working while fixing `Post-Malone`.

Add the probe's verdict as a comment with a decision ref (house style) so the next reader does not
re-derive it, and pin the chosen behavior with a unit assertion for both a spaced and a genuinely
hyphenated artist name.
