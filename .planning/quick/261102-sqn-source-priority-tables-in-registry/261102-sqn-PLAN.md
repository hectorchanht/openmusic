---
quick_id: 261102-sqn
mode: quick
---
# DECISIONS §5 — one source priority table per purpose

1. Characterize (commit 1): SOURCES order, tier-1 set, fallback floor, dedupe SOURCE_RANK winner.
2. Converge (commit 2): src/lib/sources/source-order.ts (pure, edge-safe) declares PLAYBACK_ORDER,
   playbackRank, TIER_1_SIZE, COVER_ORDER, COVER_SKIP, COVER_RACE_TIERS, PRIORITY_WINDOW_MS;
   registry builds SOURCES from PLAYBACK_ORDER and derives TIER_1_SOURCES; fallback drops
   PASS_RATE_RANK, dedupe drops SOURCE_RANK/COVER_PREF, cover race drops its literals; the qq-only
   edge cache obeys PLAYBACK_ORDER (product call 2026-11-03).
