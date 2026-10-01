---
status: resolved
trigger: "Album page rows for already-downloaded/liked songs show no tick / unfilled heart on load; appear only after toggling like"
created: 2026-10-01T00:00:00Z
updated: 2026-10-01T12:40:00Z
---

## Symptoms

- **Expected:** opening an album page (e.g. 陳奕迅 - C'mon in~, already fully downloaded on desktop web) shows each row's download tick and filled heart for songs that are downloaded / liked, immediately on load.
- **Actual:** on load every row shows the plain download icon and an empty heart. Tapping like on a row toggles correctly (a liked song un-likes, i.e. the like state exists), and only AFTER a like/unlike does that row's download tick appear (screenshot: row 3 海膽 shows tick + filled heart after the user toggled it twice).
- **Errors:** none reported.
- **Reproduction:** desktop web dev server, album C'mon in~ (陳奕迅), after downloading it via album Download; reload / revisit the album page.

## Orchestrator lead (unverified)

- Album rows are tracklist NAME STUBS (synthetic `${source}:similar-…` uid). Real liked/downloaded entries live under the resolved uid (`qq:…`).
- debug download-state-lost-on-page-return (773c46fd) added `library.resolvedStubs` / `stubTrack(artist,title)` memory — but it is TRANSIENT (not persisted), so on a fresh page load rows fall back to the stub uid → `isDownloaded` / `isLiked` false.
- Tapping like makes SongRow `runResolve` resolve the stub → `rememberStub` → row now keys on the real uid → tick appears.
- Likely fix direction: on load, map a stub row to an existing library entry by song identity (`sameSongKey` / matchKey over library.downloads + liked) without any network, so rows show real state immediately; same for other stub surfaces (home shelves, charts) that render SongRow with stubs.

## Current Focus

- hypothesis: H1 — a stub row's identity rung is `library.stubTrack(artist,title)` = a read of `resolvedStubs`, a SESSION-ONLY map filled only by a resolve (`rememberStub` in SongRow.runResolve / album resolveAll). On a fresh page load the map is empty, so `real` = null → `actUid` = nameStub uid `${src}:similar-…` → `isLiked`/`isDownloaded` false → plain icon + empty heart even though `library.downloads`/`liked` (persisted) hold the song under its real `qq:…` uid. A like tap resolves (network) → rememberStub → the row re-keys → tick + heart appear (exactly the reported "tick only after like/unlike").
- test: CDP E2E on dev 5173 (scratchpad/init-e2e.mjs): fresh profile, seed the library via the app's own `library.svelte.ts` module URL with a downloaded+liked Track for one album row, reload the album page, read each row's `.dc` state class + like `aria-pressed` on first render (no taps). Then confirm `library.resolvedStubs` is `{}` at that moment.
- expecting: seeded row reads idle + aria-pressed=false while `library.isDownloaded(realUid)` is true and `resolvedStubs` is empty → H1 confirmed. Seeded row reads TICK + pressed → H1 wrong.
- next_action: none — resolved (fix committed 759dbbe6, see Resolution). If a row still misses: re-run scratchpad/init-e2e.mjs (TAG=x) and compare `stubTrack(artist,title)` to the entry's songKey — an English-only artist alias (Eason Chan vs 陳奕迅) is the known unmatched ceiling.

reasoning_checkpoint:
  hypothesis: "Stub rows (album/shelf/chart) key like+download state on `library.stubTrack`, which only reads the session-only `resolvedStubs` map; on a fresh load that map is empty, so a song the persisted library holds under its real uid renders idle + unliked until a like tap resolves the stub (network) and `rememberStub` re-keys the row."
  confirming_evidence:
    - "init-e2e TAG=before: after seeding downloads [qq:seed…1, qq:seed…2] + liked (3) and a full reload, FIRST RENDER read all 10 rows dl=idle / liked=false while the store held the entries and `resolvedStubs` = [] and `stubTrack('陳奕迅','娛樂天空')` = null."
    - "Code: library.svelte.ts stubTrack = `resolvedStubs[matchKey] ?? null`, never consults downloads/liked; SongRow `real` ends at stubTrack; runResolve is the only rememberStub writer in the row."
  falsification_test: "If the seeded rows had read TICK / aria-pressed=true on first render with resolvedStubs empty, the keying would not be the cause."
  fix_rationale: "Give stubTrack a second rung at the seam every stub surface already reads: match the stub by song identity (songKey fold + sameSongKey artist alias) against a title-half index of downloads (first) + liked, no network. Root cause (no stub→uid mapping on a fresh session) is addressed where ALL rows converge, and tick + heart key on one resolved uid."
  blind_spots: "t2s dict cold at first render for a Latin-favourites library — covered by extending warmFold's gate to CJK downloads/liked + foldRev re-keying the index; a liked entry's Track may be stale (download path re-resolves via ensureTrackDetails); 'Eason Chan' vs '陳奕迅' English-only alias still unmatched (known sameSongKey ceiling)."

## Evidence

- 2026-10-01 — checked: `library.svelte.ts` L315-345 (`resolvedStubs`, `rememberStub`, `stubTrack`) + L116-123 (`isLiked`) + L347 (`isDownloaded`). found: `stubTrack` is a pure map read keyed by `matchKey`; nothing falls back to `downloads`/`liked`; `resolvedStubs` is `$state({})` and never persisted/hydrated in `load()`. implication: the 773c46fd memory only survives client navigation, not a reload — the first render of a fresh session has NO stub→uid mapping.
- 2026-10-01 — checked: `SongRow.svelte` L183-187 (`real`/`actUid`/`liked`) + L271-282 (`runResolve`) + L381-385 (DownloadControl gets `track={real ?? null}`). found: for a stub row `real = resolvedTrack ?? resolved ?? library.stubTrack(...)`; the like/tick reads key on `real?.uid ?? track.uid`; `runResolve` is the only writer of `rememberStub` in the row. implication: a like tap is what mints the mapping → matches the user's "tick only shows after like/unlike" exactly.
- 2026-10-01 — checked: album `+page.svelte` L337 (`resolvedRows = tracks.map(s => library.stubTrack(...))`), L745/L763-770 (SongRow gets `nameStub(...)` + `resolve` + `resolved={resolvedRows[i]}`), L168-192 (tracklist from MusicBrainz → Deezer → Last.fm, `{artist,title}` only). found: every row identity on the page funnels through `library.stubTrack`. implication: fixing the fallback INSIDE `stubTrack` fixes the album page, home shelves and charts (all SongRow stub surfaces) at once, with zero network.
- 2026-10-01 — checked: identity helpers. `match-key.ts` `matchKey` folds case/space/punct only (NO 繁/简); `dedupe.ts` `songKey` folds script per char via t2s (cold dict → unfolded + `warmT2S()`), `sameSongKey` adds the artist-alias rule (G.E.M. vs G.E.M.邓紫棋, quick-260927-2wt). `library` already has a `foldRev`/`warmFold` repaint latch (quick-260926-hze) but gated on favArtists only. implication: the library-entry match must use songKey + alias (an MB tracklist row says 陳奕迅 while a qq entry may say 陈奕迅), and must repaint once t2s lands.

- 2026-10-01 — checked: CDP E2E baseline scratchpad/init-e2e.mjs TAG=before (fresh profile, dev 5173, album rice & shine / 陳奕迅 via MB). found: seeded `downloads` [qq:seed…1 (artist 陳奕迅), qq:seed…2 (artist 陈奕迅)] + `liked` (those two + netease:seed3 'Eason Chan 陳奕迅'); SAME SESSION after seeding and FIRST RENDER after a full reload both read all 10 rows dl=idle / aria-pressed=false, while the store held the entries, `resolvedStubs` = [] and `stubTrack('陳奕迅','娛樂天空')` = null. implication: H1 CONFIRMED — the data is persisted; the rows simply have no stub→uid mapping until something resolves.
- 2026-10-01 — checked: CDP E2E TAG=after (fixed tree, init-after.log). found: FIRST RENDER after reload: row 0 TICK + liked (exact strings), row 1 TICK + liked (entry stored as 陈奕迅, page row 陳奕迅 — the fold), row 2 liked + idle (liked-only alias entry, correctly no tick), rows 3–9 idle/unliked; `resolvedStubs` still [] and `stubTrack(row0)` = qq:seed…1; same-session seeding now repaints live too. init-like.mjs: after reload the row-0 Like tap acted on the REAL entry (qq:seed…1 left `liked`, toast "Removed from liked", tick stayed), a second tap re-liked the same uid, window.fetch recorded ZERO calls across both taps. implication: fix verified against every symptom with no per-row network.

## Eliminated

## Resolution

- root_cause: Every stub row (album tracklist `nameStub`, home-shelf / charts DiscoveryTrack stubs) keys its like + download state on `real?.uid`, whose last rung is `library.stubTrack(artist,title)` — and that was a plain read of `resolvedStubs`, a SESSION-ONLY map written only by a resolve (`SongRow.runResolve` → `rememberStub`, album `resolveAll`). On a fresh page load the map is empty, so `actUid` fell back to the synthetic `${src}:similar-…` uid: `isDownloaded` / `isLiked` false → idle icon + empty heart for a song the persisted `library.downloads` / `liked` already held under its real `qq:…` uid. A like tap resolved the stub (network) → `rememberStub` → the row re-keyed → tick + filled heart appeared — exactly "the download tick only shows after like/unlike". The 773c46fd memory only ever covered client navigation, not a reload.
- fix: `library.stubTrack` gains a second rung at the ONE seam every stub surface reads: match the {artist,title} stub by song identity against the persisted lists with no network — `songIndex` ($derived, title-half of `songKey` → Track[], downloads FIRST then liked, skipping uid-less / `resolveByName` entries, re-keyed on `foldRev`), lookup = exact `songKey` match then the `sameSongKey` artist alias (`sameSongStrings`, new raw-string export in dedupe.ts that `sameSongKey` now delegates to). `warmFold`'s gate extended to CJK liked / downloaded entries and called from `save()` so a cold t2s dict warms and the index re-keys when it lands. No component changed: SongRow `real`, album `resolvedRows` / `resolveAll` / `albumLiked`, DownloadControl and RowBadges all inherit it. Tick rule (92b954f3 unavailable glyph) and the album header buttons (5d71055a) untouched. Tagged `debug album-rows-miss-liked-downloaded-on-load`. Commit 759dbbe6.
- verification: 6 failing-first vitest tests in library.svelte.test.ts (downloaded found with no rememberStub; liked-only + miss; 繁/简 + artist alias; downloads win over liked → one uid; memory still wins; removed download stops matching) + 1 in dedupe.test.ts (sameSongStrings) — 5+1 RED before / all GREEN after; `pnpm test` 172 files / 3925 passed; `pnpm check` 0 errors. CDP E2E on dev 5173 (fresh profile): before = all rows idle + unliked on first render with the entries in the store; after = seeded rows TICK + filled heart on first render (incl. a 陈奕迅-stored entry on a 陳奕迅 row), liked-only row heart-only, Like tap un-likes / re-likes the real uid with zero fetches.
- files_changed: [src/lib/stores/library.svelte.ts, src/lib/stores/library.svelte.test.ts, src/lib/services/dedupe.ts, src/lib/services/dedupe.test.ts]
