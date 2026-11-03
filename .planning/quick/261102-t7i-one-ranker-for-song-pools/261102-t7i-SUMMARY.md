---
quick_id: 261102-t7i
status: complete
---
# Summary — §4 ranking converged

- `song-variant.rankPool(pool, title, {expectedSec, score})`: official-plausible →
  variant-plausible → official-short → variant-short, scoreMatch within each tier. Deleted
  rankAcceptable, findOfficial, pickOfficial (three views of the same pools that disagreed on
  within-tier order). rankAutoCandidates = rankPool over isAutoAcceptable rows scored against the
  target; discovery picks rankPool(...)[0].
- dedupeBest's group head is now the ranked head (candidateTier vs the plain title, group median
  duration, then quality → preferred → PLAYBACK_ORDER) — a variant never represents its song over
  the clean cut. dedupe ↔ song-variant import cycle documented (function-body use only).
- One VARIANT_KEYWORDS list (score-match.ts, union of both); song-variant's partition imports it.
  scoreMatch takes any `Scorable` (artist/title/duration).
- Search page: rankList = rankPool with the set-context scoreMatch; the jip Deezer re-rank
  (dedupe-deezer.ts) is deleted; prewarm fires at the settle (now the terminal ranking event).
- VersionPicker lists rows in rankPool order against `target` (NowPlaying passes the track; search
  opens with the tapped row first).
- Intended behaviour changes: search lists official/full-length rows before variants/clips;
  VersionPicker order = auto-pick order; group representatives prefer the clean cut.
- Suite 245 files / 5197 tests pass; svelte-check 0 errors.
