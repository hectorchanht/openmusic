---
title: walkSource passes page=8 to searchAll — true-page adapters can never be a failover hit
date: 2026-11-04
priority: medium
source: .planning/phases/43-multi-platform-sources-mdl-style-soundcloud-bandcamp-as-real/43-RESEARCH.md (Pitfall 2 / Open Question 3)
needs: a per-adapter page-vs-limit audit BEFORE any code change
---

# walkSource asks for page 8, not 8 results

`fallback.ts:330` calls `searchAll(query, 8, onlySource(src), signal)`. The second argument of
`searchAll` is `page`, not a fetch count.

- Limit-multiplying adapters (netease / qq / kuwo / suyin / gdnetease) treat `page` as a multiplier
  and return ~80 rows, so they happen to work.
- True-page adapters (kugou, migu, fivesing, jamendo, audius — audius returns `[]` for `page > 1`)
  return page 8 or nothing on EVERY fallback / name-stub walk, so they can never be a failover hit.

## Scope

Out of scope for Phase 43: the new SoundCloud / Bandcamp adapters use superset semantics by design,
so they are unaffected. Fixing the call site changes which rows every existing adapter returns, so it
needs its own quick task with a per-adapter page-vs-limit audit first (what does `page` mean to each
adapter, what does walkSource actually want — probably page 1 with a limit).
