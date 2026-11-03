---
quick_id: 261102-to0
status: complete
---
# Summary — §7 quality truth converged

- `sources/quality.ts qualityRank(label)` (edge-safe) + `wantedQualityRank(pref)`: the one tier
  ranker. Deleted download-upgrade's qualityRank, dedupe's private qualityRank and donorRank's tag
  regexes; currentQualityMeets = rank(cur) ≥ wanted (was 'auto' always met + string equality, so a
  FLAC stream never met a lossless want).
- player.applyDownloadQuality uses display-quality withDownloadQuality (was a hand copy).
- Home fallback tile pill: displayQualityLabel (download record > stamps) gated by
  settings.showQualityTag (was raw stamps, ungated).
- TrackMenu detail "Source": the adapter label via trackSourceLabel + zhLock (was the raw id).
- Not done (open): reresolve/fallback blob swaps keep the stream stamps on player.current (the pill
  corrects live via the record); per-source label vocabulary (FLAC vs LOSSLESS vs HQ) is unchanged.
- Suite 247 files / 5203 tests pass; svelte-check 0 errors.
