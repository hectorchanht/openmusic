---
quick_id: 261102-sqn
status: complete
---
# Summary — §5 source priority converged

- New `src/lib/sources/source-order.ts` (pure): PLAYBACK_ORDER (joox, kuwo, kugou, qq, netease,
  gdnetease, migu, fivesing, jamendo, audius, suyin, then search-only archive/ccmixter/bilibili/
  ytmusic), playbackRank, TIER_1_SIZE, COVER_ORDER, COVER_SKIP, COVER_RACE_TIERS, PRIORITY_WINDOW_MS.
- registry SOURCES is built from PLAYBACK_ORDER, so every getEnabledAdapters walk (search fan-out
  stagger + interleave, name-stub walk, lyric walk, fallback base) follows it; TIER_1_SOURCES is
  derived (joox, kuwo, kugou, qq, netease — was qq/joox/kuwo/netease/suyin).
- Deleted: fallback PASS_RATE_RANK + local window, dedupe SOURCE_RANK (qq-first, contradicted the
  ladder) + COVER_PREF literal, cover race joox/migu/gdnetease/suyin literals + local window.
- Edge resolve cache (product call): only leads for a track whose source does not outrank qq and
  never for a name stub — a tapped joox/kuwo/kugou row is no longer re-pointed at qq.
- Intended behaviour changes: search interleave/stagger joox-first; dedupe ties go to joox over qq;
  name stubs walk joox first and skip the qq cache shortcut (slower Up-Next resolve when joox
  misses); tier-1 drops suyin, adds kugou.
- Not moved (other domains): picker/og cover tier order (§6), similar primarySourceId placeholder (§3).
- Suite 243 files / 5185 tests pass; svelte-check 0 errors.
