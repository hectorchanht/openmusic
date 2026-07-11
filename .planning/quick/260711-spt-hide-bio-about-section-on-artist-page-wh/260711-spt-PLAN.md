---
quick_id: 260711-spt
title: Hide bio/About section on artist page when empty
date: 2026-07-11
status: planned
---

# Quick Task 260711-spt: Hide bio/About section when empty

## Problem

On the artist page, the "About" section renders even when Last.fm has **no real bio**.
Last.fm returns a boilerplate-only `bio.summary` for artists with no wiki:

```html
<a href="https://www.last.fm/music/Artist">Read more on Last.fm</a>.
```

`pickBio()` (`src/routes/api/lastfm/info/+server.ts`) HTML-strips this to the string
`"Read more on Last.fm."` and returns it as a real `bio`. The artist-page gate
(`src/routes/(app)/artist/[name]/+page.svelte:419`) then sees a truthy `bio` + `bioUrl`
and renders `<p>Read more on Last.fm.</p>` followed by the real "Read more on Last.fm"
attribution link — the duplicated line the user reported (screenshot).

## Root cause

The empty-bio detection is missing. A boilerplate summary contains ONLY the
attribution `<a>` element (plus trailing punctuation), no prose. `stripHtml`
collapses the anchor text into the bio, so "no bio" is indistinguishable from
a one-line bio downstream.

## Fix (single site, at the source)

In `pickBio()`, before accepting the stripped text as a bio: remove the anchor
element from the raw summary and check whether any real prose remains. If not,
return `{ bio: null, bioUrl }` (or null/null) so `enrich.bio` is null and the
existing artist-page gate hides the whole About section. No Svelte change needed —
the gate already requires a truthy `bio`.

This fixes both artist-page enrichment AND track enrichment (same `pickBio`),
and every future consumer.

## Tasks

### Task 1 — boilerplate-only bio → null in pickBio
- **files:** `src/routes/api/lastfm/info/+server.ts`
- **action:** In `pickBio`, strip the `<a>…</a>` element(s) from `raw`, HTML-strip the
  remainder, and if it contains no letter/number (`\p{L}\p{N}`, unicode-aware for CJK),
  return `{ bio: null, bioUrl }`. Otherwise keep existing behavior
  (`firstSentences(stripHtml(raw))`).
- **verify:** existing "extracts bio summary" + "rejects non-https href" tests still pass
  (real bios have prose before the anchor, so they are unaffected).
- **done:** boilerplate-only summary yields `bio: null`.

### Task 2 — regression test for boilerplate-only summary
- **files:** `src/routes/api/lastfm/info/lastfm-info-endpoint.test.ts`
- **action:** Add a test: `artist.getinfo` with `bio.summary` = boilerplate-only
  (`<a href="https://www.last.fm/music/X">Read more on Last.fm</a>.`) → `parsed.bio` is null.
- **verify:** `pnpm test` (endpoint test file) passes.
- **done:** new test green, no existing test regresses.

## Out of scope
- No Svelte markup change (existing gate already hides on null bio).
- No i18n change.
