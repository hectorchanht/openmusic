---
quick_id: 260613-fwq
status: in-progress
---

# Quick Task 260613-fwq: Related list skeleton loading state

Replace the plain "Loading related…" text in the NowPlaying **Related** tab
with skeleton placeholder rows that match the real `.row` shape (title bar +
artist bar), giving a visual loading affordance consistent with the search
page skeleton.

## Context

- `src/lib/components/NowPlaying.svelte` related tab (~line 1051) currently:
  `{#if related.length} <ul.list> … {:else} <p.empty>{loadingRelated}</p> {/if}`
- The else branch shows loading text forever — it does not distinguish
  "still loading" from "loaded, zero results" (latent bug).
- Established skeleton primitives already exist:
  - global `.sk` class in `src/app.css` (grey block + shimmer, reduce-motion safe)
  - search page snippet pattern at `src/routes/(app)/search/+page.svelte:506`
- Related rows are vertical: `.row` is `flex-direction: column` with
  `.r-title` (14px/600) and `.r-artist` (12px/muted).

## Task 1 — Add loading flag + skeleton rows

**Files:** `src/lib/components/NowPlaying.svelte`, `src/lib/i18n/en.ts` (+ other locales for parity)

**Action:**
1. Add `let relatedLoading = $state(false);`.
2. In the related `$effect`, set `relatedLoading = true` before `searchAll`,
   and clear it in both `.then` and `.catch` (guard with `relatedFor === t.uid`
   race check so a stale resolve doesn't clear a newer load's flag).
3. Markup: three-way branch —
   - `{#if related.length}` → existing list
   - `{:else if relatedLoading}` → skeleton: `<ul class="list">` of ~8 `<li>`
     each containing a `.row.skel` with `.r-title.sk` + `.r-artist.sk` bars,
     `aria-hidden`, plus a visually-hidden label using `loadingRelated`.
   - `{:else}` → empty state `nowplaying.noRelated` ("No related tracks.")
4. Add `nowplaying.noRelated` i18n key to `en.ts` and all other locale files.
5. Add scoped CSS for `.row.skel` bars (fixed widths/heights via `.sk`).

**Verify:** `pnpm build` (or `svelte-check`) passes; open Related tab — skeleton
rows show during fetch, real rows replace them, empty state shows when zero.

**Done:** Loading text replaced by shaped skeleton; empty state distinct.
