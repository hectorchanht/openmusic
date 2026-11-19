# quick-261119-sharecard — every shared song must show its media card

Hector (2026-11-19, screenshot): a shared song link in WhatsApp showed NO media card.
Standing rule: every song shared must show a media card (per-song OG: title, artist, cover).

## Root causes (both live-verified before this fix)

1. SSR 500 on ALL entity routes (/song/*, /artist/*, /album/*) since commit 486495a2
   (quick-261102-menudrag, 2026-11-03): TrackMenu.svelte registers onDestroy(mAbortDrag);
   Svelte 5 runs onDestroy at the end of SSR; mAbortDrag → mDisarmWindow touched
   window.removeEventListener unguarded → ReferenceError → SvelteKit aborted the render →
   crawlers got HTTP 500 + the generic app.html fallback head only. The poison came from
   the shared (app) shell (Nowbar mounts TrackMenu), not the SSR-safe-by-construction
   share pages. Reproduced locally (dev + production build on workerd) with the exact stack.
2. /api/og `i:` cover-token lookup budget TOKEN_LOOKUP_MS=900 sat on the measured median
   iTunes lookup latency (0.79–1.33s probed 2026-11-19), so the token routinely timed out
   in production and fell through to the tier chain — which misses exactly the obscure
   songs the ci carrier exists for (live: PetPetShawn/夜行 + valid i: token → branded
   fallback card; a d: token → real cover).

## Changes

- src/lib/components/TrackMenu.svelte: `if (!browser) return;` as first statement of
  mArmWindow + mDisarmWindow (browser already imported). Covers every call path.
- src/lib/proxy/og-cover.ts: TOKEN_LOOKUP_MS 900 → 2500 (IMAGE_MS precedent), with the
  measurement recorded in the comment.
- src/lib/components/track-menu-ssr.test.ts (new): source pin — both helpers must open
  with the browser guard and the onDestroy registration must stay, so this bug class
  cannot silently return (the unit suite was green while every share route 500'd).

## Verify

- Targeted vitest: track-menu-ssr, og-endpoint, share, loader tests.
- Local production build + wrangler pages dev: /song /artist /album all 200 with
  per-entity og:title (done pre-push in the repro tree for the TrackMenu half).
- After push + Pages deploy: purge zone cache; live curl — song URL 200 +
  og:title "夜行 • PetPetShawn"; /api/og?ci=i:1863323575 returns the real cover
  (no x-og-fallback header).
