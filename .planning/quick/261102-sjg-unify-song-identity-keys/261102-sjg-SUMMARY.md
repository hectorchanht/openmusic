---
quick_id: 261102-sjg
status: complete
---
# Summary — §1 song identity converged

- dedupe.ts owns the identity: `preNorm`/`normField` (fold, lowercase, brackets, dash tail,
  NEW bare `feat.`/`ft.` tail), `songKey` (title|artist), `matchKey` (= songKey halves,
  artist-first — the persisted-format spelling), `versionedMatchKey` (moved verbatim: crowd vote
  key is server-persisted, deliberately not folded).
- Deleted: match-key.ts (+ test, moved into identity.test.ts), dedupe-deezer's drifted local key
  and normField, score-match's double fold, jbsou foldedKey, cover-cache's covsync alias layer
  (the key itself folds now; old alias entries sit under exactly the new key), player's
  lowercase episode/pending keys, home fav-artist lowercase filter, discovery's local fold.
- Edge: /api/resolve, /api/og resolve key and resolve-edge await ensureFoldReady before keying.
- Intended behaviour changes: matchKey now folds 繁/簡 and drops translation tails / own-artist
  prefix (cover art survives 繁/简 swaps; fallback episode no longer splits on script); bare
  "feat. X" titles are the same song. Persisted keys that shift: cover cache (Traditional entries
  re-resolve once unless an alias entry existed), name-rescue cache, edge resolve cache entries
  for Traditional/feat titles (orphans expire), comment threads for bare-feat titles.
- Deferred to their domains: downloadUidFor (§11), SongRow album==title + artist-display
  nameRuns (§8). Not identity: autocomplete suggestion dedupe, name-rescue cleanTitle (query builder).
- Suite 242 files / 5179 tests pass; svelte-check 0 errors.
