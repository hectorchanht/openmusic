---
quick_id: 261102-sdm
mode: quick
---
# DECISIONS §2 — one script fold, search in Simplified

1. Characterize (commit 1): searchAll raw keyword, phrase-level alias fold, kanji-in-kana fold.
2. Converge (commit 2): foldScript moves to zh-convert.ts (per char, isChineseLine gate) +
   ensureFoldReady/foldScriptReady; every whole-line t2s identity site (cover-cache alias,
   merge-logic tombstone fold, discovery, cover-backfill, og-cover search terms, jbsou) uses it;
   searchAll folds the keyword to Simplified (product call 2026-11-03); discovery's on-miss t2s
   re-search deleted; persisted/sent folds await the dict first (sync merges, jbsou, discovery).
