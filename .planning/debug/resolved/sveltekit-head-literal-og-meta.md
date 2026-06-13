---
slug: sveltekit-head-literal-og-meta
status: resolved
trigger: "%sveltekit.head%" shown as literal text at top of app; verify OG/meta correctly implemented and single current-song share shows OG title/artist
created: 2026-06-14
updated: 2026-06-14
root_cause: app.html explanatory comment contained the literal `%sveltekit.head%` token (twice) BEFORE the real placeholder. SvelteKit injects head via first-occurrence String.replace, so it replaced the token inside the comment (head payload lost in the comment) and left the real placeholder as literal text, which the browser reparented from <head> into <body>.
fix: reworded the app.html comment to never write the literal token above the real placeholder.
verification: dev + build — literal count 0; root head correct; song-share SSR emits og:title/description "Folded — Kehlani"; pnpm build exit 0.
files_changed: src/app.html
commit: 272898e
---

# Debug: `%sveltekit.head%` literal + OG/meta correctness — RESOLVED

## Root Cause
`src/app.html` had the literal token `%sveltekit.head%` inside the D-11 explanatory
comment (lines 18–19) — placed **before** the real placeholder. SvelteKit substitutes the
head with `String.replace('%sveltekit.head%', head)`, which replaces only the **first**
occurrence. So:
1. The token inside the comment got replaced → the real head payload (dev module preloads;
   in prod the per-route SSR `<svelte:head>` incl. PageOg `og:*`) was injected inside an HTML
   comment and discarded.
2. The intended placeholder (the real one) was left as literal text `%sveltekit.head%`.
3. The browser's parser reparents stray text out of `<head>` into `<body>` → the literal
   showed as the first visible line at the top of the app.

Affected dev AND prod (the Cloudflare worker runs the same first-occurrence replace at request
time) and silently broke per-route SSR OG for song/album/artist shares.

## Fix
Reworded the comment so it never contains the literal token above the real placeholder, with
an inline NOTE warning future editors. One-file change, comment-only.

## Verification
- Dev (`vite dev`): served `/` → literal count 0, head `<title>` correct, body no longer leads
  with the placeholder.
- Song share `/song/folded-kehlani?n=Folded&a=Kehlani` (SSR, crawler-visible): HTTP 200;
  `og:type=music.song`, `og:title="Folded — Kehlani"`, `og:description="Listen to Folded —
  Kehlani on openmusic…"`, `twitter:title="Folded — Kehlani"`, image `/og.svg`; no duplicate
  og:title (static default correctly suppressed by `{#if !page.data?.og}`).
- `pnpm build` exit 0.

## Answers to the asked questions
1. **OG/meta correctly implemented?** Now yes. It was structurally correct but the first-occurrence
   replace defeated it; fixed.
2. **Single current-song share OG title/artist?** Yes — `og:title`/`og:description`/`twitter:title`
   render "{name} — {artist}", SSR so chat apps + crawlers unfurl it.

## Known follow-up (separate, minor — NOT this bug)
The song route sets `og:title` but no page-specific document `<title>`, so the `<title>` element
stays the generic site default ("openmusic — music streaming for earth") and appears twice on the
song page. OG unfurls (the actual share surface) are correct; only the SEO `<title>` tag is
generic. Optional polish: have the song `+page.ts`/PageOg set a page `<title>` and gate the
layout/app.html default title on entity routes.
