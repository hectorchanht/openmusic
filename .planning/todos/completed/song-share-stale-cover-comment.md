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

---

## Resolution (Phase 38, plan 05)

**Closed 2026-09-20.** Both parts verified against the live file, not assumed:

- **Part 1 (mandatory) — already correct.** `src/routes/(app)/song/[slug]/+page.svelte:18-22` now
  reads *"quick-260723-r4p: the cover IS carried, via the readable `?c=` carrier — the comment that
  used to claim otherwise here was stale from the moment that carrier landed"*, i.e. the stale
  "the cover is never carried" claim this todo was filed against is gone and the ref is preserved.
  No further edit was needed; the comment states the real invariant.
- **Part 2 (optional follow-on) — done.** The placeholder `<div>` is now the *fallback*: the page
  renders `<img class="cover" src={data.og.image} referrerpolicy="no-referrer">` (`:83-92` before
  this plan's edits), so the crawler card and the landing page show the same art. The gradient is
  the null/error branch only.

Absorbed as predicted, by Phase 38 rather than Phase 30 — that phase edited the data contract, this
one rewrote the page's mount behaviour. Plan 38-05 additionally rewrote the page's mount comments to
the new resolve-on-mount invariant (38-D-13/D-06/D-15), keeping every existing decision ref
(`quick-260809-38i`, `quick-260723-r4p`) intact — the same CLAUDE.md rule this todo invoked.
