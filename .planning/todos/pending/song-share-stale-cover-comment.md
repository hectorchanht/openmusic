---
title: Song share page — stale "cover is never carried" comment + unused placeholder
date: 2026-08-07
priority: low
---

# Stale cover comment on the song share page

[`src/routes/(app)/song/[slug]/+page.svelte`](../../../src/routes/(app)/song/[slug]/+page.svelte)
line ~19 says:

> Display fields from the SSR load: data.name/data.artist are the authoritative readable carriers
> (DQ-1). **The cover is never carried, so the card always shows the placeholder block (no `<img>`).**

That has been wrong since `quick-260723-r4p` added the `?c=` cover carrier — the cover *is* carried,
the page just never reads it (`data.og.image` holds it; the markup renders
`<div class="cover cover--placeholder">`).

Per CLAUDE.md, comments are load-bearing decision records, so a comment that contradicts the code is
worse than none — it is what made the "does dropping `c` regress the in-app cover?" question look
risky during the Phase 30 exploration when the answer was plainly no.

**Two parts:**

1. Correct the comment to state the real invariant: the cover reaches the page as `data.og.image`
   and is deliberately *not* rendered — the landing surface shows a gradient placeholder while
   `resolveAndPlay` hands off to the player.
2. Optional follow-on: actually render it. Once `/api/og` exists (Phase 30), the placeholder can
   become `<img src={data.og.image}>` so the crawler card and the landing page show the same art.

**Likely absorbed by Phase 30** — that phase edits this file's data contract anyway. Keep this as a
standalone only if Phase 30 slips or its scope narrows to the endpoint alone.
