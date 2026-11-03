---
quick_id: 261102-sdm
status: complete
---
# Summary — §2 script handling converged

- One identity fold: `zh-convert.ts foldScript` (per character, kana/hangul lines untouched),
  plus `ensureFoldReady()` / `foldScriptReady()`. Deleted from dedupe.ts; the phrase-level t2s
  identity folds in cover-cache, merge-logic, discovery, cover-backfill, og-cover are gone.
- Search: `searchAll` folds the keyword to Simplified once — 周杰倫/周杰伦 and 陳奕迅/陈奕迅 are
  one query and one cache entry (probed prod: qq/joox/kuwo/kugou/migu return the same pools for
  both scripts, and the 2026-09-26 probe had QQ return [] for Traditional).
- Deleted: discovery's urx on-miss Simplified re-search (redundant now).
- Warm contract: discovery attempt, sync merges, jbsou edge await the dict before matching.
- Cold tombstones (`f:周杰倫` written before the dict loaded) re-fold on merge.
- Behaviour changes (intended): alias keys fold by char not phrase (緊急聯絡人→紧急联络人, old
  alias entries just miss and re-write); kanji inside kana lines no longer fold in song keys.
- Suite 242 files / 5174 tests pass; svelte-check 0 errors.
