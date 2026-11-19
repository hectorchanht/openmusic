# quick-261119-sharecard — SUMMARY

Shipped: TrackMenu SSR browser guards (mArmWindow/mDisarmWindow) + og-cover i-token
lookup budget 900→2500ms + track-menu-ssr source-pin test. Root cause was
quick-261102-menudrag's unguarded window touch in an onDestroy callback (Svelte 5 runs
onDestroy during SSR), which 500'd every /song /artist /album share route since
2026-11-03 — no WhatsApp media card for any shared song. Live verification recorded in
the session log (~/memory/2026-11-19.md) after deploy + cache purge.
