---
quick_id: 260711-spt
title: Hide bio/About section on artist page when empty
date: 2026-07-11
status: complete
---

# Quick Task 260711-spt — Summary

## What shipped

Artist-page "About" section no longer renders when Last.fm has no real bio.

## Root cause

`pickBio()` in `src/routes/api/lastfm/info/+server.ts` HTML-stripped Last.fm's
**boilerplate-only** summary — for artists with no wiki, `bio.summary` is just
`<a href="…">Read more on Last.fm</a>.` with no prose. `stripHtml` collapsed the
anchor text into a bogus one-line bio (`"Read more on Last.fm."`), which the
artist-page gate (`src/routes/(app)/artist/[name]/+page.svelte:419`) accepted as
a real bio and rendered as `<p>Read more on Last.fm.</p>` **above** the genuine
"Read more on Last.fm" attribution link — the duplicated line in the user's screenshot.

## Fix (single site, at the source)

In `pickBio`: strip the `<a>…</a>` element from the raw summary, HTML-strip the
remainder, and if no letter/number text remains (unicode-aware `\p{L}\p{N}`,
correct for the CJK catalog) return `{ bio: null, bioUrl }`. `enrich.bio` is then
null and the **existing, unchanged** artist-page gate hides the whole section.

- Fixes both artist enrichment AND track enrichment (shared `pickBio`).
- No Svelte markup change, no i18n change.
- Real bios have prose before the anchor → unaffected (existing behavior preserved,
  including that a real bio may still end with a trailing "Read more on Last.fm" sentence).

## Files changed

- `src/routes/api/lastfm/info/+server.ts` — boilerplate-only detection in `pickBio`.
- `src/routes/api/lastfm/info/lastfm-info-endpoint.test.ts` — +1 regression test
  (boilerplate-only summary → `bio: null`).

## Verification

- `pnpm test lastfm-info-endpoint` → **14/14 pass** (13 existing + 1 new).
- Touched files typecheck clean.
- `pnpm check` reports **5 PRE-EXISTING errors** in `src/lib/i18n/{ar,hi,id,vi,th}.ts`
  (missing `search.clearInput` / `search.removeRecent` / `search.confirmRemoveRecent` /
  `search.confirmClearAll`). These come from the **uncommitted sibling `sm7` search-input
  task** (modified `search/+page.svelte` + `searchHistory` + `en.ts`, not yet propagated to
  all locales) — NOT this change.

## Not verified in-browser

The About-hide is observable, but reliable browser verification needs a live Last.fm
boilerplate response for a real artist + CN upstream network the sandbox can't reach
(memory: "sandbox no CN upstream network"), and another chat's dev server holds port 4321.
Behavior is proven by the unit test (server → `bio: null`) plus the unchanged null-bio gate.
→ Confirm on device UAT with an artist that has no Last.fm bio (e.g. "Edan 呂爵安" in the screenshot).
