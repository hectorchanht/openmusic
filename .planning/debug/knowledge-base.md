# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## stall-kills-healthy-tracks — foreground `stalled` media event executes healthy-but-slow tracks (retry → skip, no ✗)
- **Date:** 2026-09-12
- **Error patterns:** stalled, media.stalled, stall.retry, stall.skip, skipped, no cross, no ✗, couldn't play, rs:0, readyState 0, HAVE_NOTHING, buf:0, first-byte, reresolveCurrent, strike.clear-all, healthy track skipped, 3.2s, 3240ms
- **Root cause:** The `stalled` listener in `Player.attach()` called `recoverLoadStall()` on the first `stalled` in the FOREGROUND; it was only ever needed as the background (throttled-timer) trigger. Chrome fires `stalled` once per load ~3s after src.set with no bytes, overlapping this device's normal 1.8–2.9s first-byte, so healthy tracks were retried (re-attach kills the in-flight load) then skipped by the retried src's own `stalled`. One strike vs STRIKE_CAP=3 → invisible skip.
- **Fix:** Gate the `stalled` listener on `document.hidden` (foreground defers to the un-throttled 15s STALL_TIMEOUT_MS watchdog + `error`); re-arm `armStall()` in the retry branch since `reresolveCurrent` arms nothing (D-14). ✗ stays reserved for STRIKE_CAP confirmed failures (31-D-16); live-skip visibility is emitSkipNotice (31-D-18).
- **Files changed:** src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts
---

## media-card-shows-app-icon — Chrome OS media card shows the PWA icon while the in-app hero shows the real cover (QQ tracks)
- **Date:** 2026-09-14
- **Error patterns:** media card, media panel, mediaSession, MediaMetadata, artwork, /favicon.svg, app icon, PWA icon, purple icon, cover, album art, album_pic, singer_pic, http://y.gtimg.cn, http scheme, mixed content, hasHttpsScheme, buildArtwork, resolvedCover, qq, hero correct card wrong
- **Root cause:** QQ detail returns `album_pic`/`singer_pic` as `http://y.gtimg.cn/...` and `qq.ts` committed it raw as `track.cover` (its 32-D-05 `https()` helper only upgraded the stream url). play() adopted the http url into `resolvedCover`, where it is truthy (so `resolveCoverAsync`, `upgradeCoverAsync`, `healCover` all skip) but fails `buildArtwork`'s https gate, so every MediaMetadata write carried `/favicon.svg`. The hero painted the same url because Chrome auto-upgrades mixed-content images. `library.adoptCover` also cached the http url in the name layer ungated, so replays re-seeded it. Hypothesis "Chrome can't fetch CN covers (hotlink 403)" was disproven: y.gtimg.cn serves https 200 with no referer.
- **Fix:** `qq.ts` https-upgrades the cover via the existing `https()` helper; `library.adoptCover` gates `setCachedCover` on `hasHttpsScheme`; `player.svelte.ts` post-resolve adopt prefers an https resolve over a non-https seed; regression test in `qq.test.ts`. Commit e17ce39.
- **Files changed:** src/lib/sources/qq.ts, src/lib/stores/library.svelte.ts, src/lib/stores/player.svelte.ts, src/lib/sources/qq.test.ts
---

## upnext-no-scroll-to-current — wide (>=1280px) Up Next column never scrolls to the current song on open or on song change
- **Date:** 2026-09-26
- **Error patterns:** up next, upnext, queue list, scroll to current, scroll-to-current, not scrolled, does not follow, current row off-screen, current song below the fold, played history above current, desktop, wide mode, >=1280px, three columns, NowPlaying, NpUpNext, sheetState closed, open prop, one-shot latch, track change, next, prev, auto-advance, row tap, rAF, cover backfill not running in wide
- **Root cause:** Two gates, one prop. NowPlaying.svelte passed `open={sheetState !== 'closed'}` to NpUpNext — written for the phone sheet (quick-260618-ink) before quick-260919-np3 mounted the pane as a standing column at >=1280px regardless of sheetState. In wide mode the column is fully on screen with `open === false`, so the scroll-to-current `$effect` AND the cover-backfill effect (same gate) never ran (NpLyrics got a `wide` prop for the identical desktop-closed case in npfix Fix 3; NpUpNext did not). Independently, the scroll latch was a boolean whose only tracked read was `open` (ink: preserve 260615-mnr no-scroll-on-mutation), so next/prev/auto-advance/row tap never re-scrolled in ANY layout.
- **Fix:** Pure `services/upnext-scroll.ts`: `upNextPaneOpen(wide, sheetState) = wide || sheetState !== 'closed'` feeds the NpUpNext `open` prop (fixes both gates at the source); `upNextScrollKey(open, currentUid)` keys the latch on the current uid — a song change is a new key (scroll once), a remove/reorder/regen under the same current is the same key (no scroll, mnr preserved), null re-arms. Effect also tracks `rows` and un-latches on a rAF row miss so a home-shelf fresh play (queue installed after the resolve await) scrolls when the row lands. Uniform across narrow sheet + wide column by decision. Locked by upnext-scroll.test.ts (7 tests).
- **Files changed:** src/lib/services/upnext-scroll.ts, src/lib/services/upnext-scroll.test.ts, src/lib/components/NowPlaying.svelte, src/lib/components/NpUpNext.svelte
---


## album-zip-duplicate-songs — album Download-all zip held 8 identical copies of one song (陳奕迅 明年今日) for 8 different tracks
- **Date:** 2026-10-01
- **Error patterns:** album download, zip, duplicate songs, same file, (2)…(8), identical size, 明年今日, 富士山下, joox, resolveStub, resolveAllCached, Traditional, Simplified, 繁體, MusicBrainz tracklist, wrong song resolved, same artist different title, scoreMatch, dedupeBest, foldScript
- **Root cause:** `scoreMatch` compared Traditional vs Simplified script literally while `dedupeBest`'s `key()` folds Trad→Simp (quick-260926-n0r). For a Traditional album stub the merged group's survivor is the Simplified qq/netease row (scored 0 vs the Traditional query); joox's same-artist filler rows (明年今日) scored 4 and won; `preferEligible` settles a CJK query on any candidate so the t2s retry never fired. Six stubs → one joox uid → eight identical zip entries. Intermittent: cold t2s dict = no fold = correct.
- **Fix:** `score-match.ts` `similarity()` folds both sides through dedupe's exported `foldScript` before `matchKey`; `download-album.ts` adds a `seenUids` guard (one audio identity → one entry / move). Failing-first tests in score-match, discovery (reproduces the live uid) and download-album.
- **Files changed:** src/lib/services/score-match.ts, src/lib/services/dedupe.ts, src/lib/services/download-album.ts, src/lib/services/score-match.test.ts, src/lib/services/discovery.test.ts, src/lib/services/download-album.test.ts
---

## album-row-tick-before-file-done — album Download-all rows showed the tick after a quick spin while the file was not downloaded (or never would be)
- **Date:** 2026-10-01
- **Error patterns:** album download, download icon, tick, check mark, spinner, progress ring, shows downloaded too early, not fully downloaded, file not saved, rate-limited, 请求过于频繁, backoff, downloadFromDonor, library.downloading, isDownloaded, endDownload, finally, DownloadControl, RowBadges, download-state, unavailable, Saved 8 of 10
- **Root cause:** Row tick = `isDownloaded && !library.downloading.has(uid)`; `downloadOne` calls `addDownload` PRE-fetch (DL-BUG-01) and `endDownload` in its `finally` after EVERY attempt, and `downloading` was a plain Set (no nesting). The album loop's qq backoff sleeps and the hop into the donor walk left a limited song "downloaded, not downloading" (tick, no file); a song ending 'failed'/'no-audio'/'rate-limited' stayed in `downloads` unmarked (permanent tick). `downloadFromDonor` had a local per-attempt re-arm patch for the same gap.
- **Fix:** `library.beginDownload/endDownload` refcount per uid (private depth Map, Set stays the reactive readable); `download-album.ts` holds ONE outer bracket per song start → final outcome; `downloadOne` wraps `runDownload` and in its finally marks a non-saved outcome `unavailable` (34-D-06 alert glyph) / clears it on 'saved', before `endDownload`; donor re-arm removed. 8 failing-first tests; CDP E2E (IDB put hook) 9 BAD rows → 0.
- **Files changed:** src/lib/stores/library.svelte.ts, src/lib/services/download-track.ts, src/lib/services/download-album.ts, src/lib/components/DownloadControl.svelte, src/lib/components/download-state.ts, src/lib/stores/library.svelte.test.ts, src/lib/services/download-track.test.ts, src/lib/services/download-album.test.ts
---
## download-state-lost-on-page-return — leaving the album page mid-download and coming back showed idle download buttons (no ring, header re-enabled) while the downloads kept running; a second tap started a duplicate album job
- **Date:** 2026-10-01
- **Error patterns:** download button not spinning, after navigating back, leave page and return, remount, download still going, progress ring gone, header Download button enabled, duplicate album download, busyAction, resolvedRows, resolvedCache, localBusy, page-local state, nameStub uid, similar- uid, library.downloading, DownloadControl, SongRow resolved, album page
- **Root cause:** The album page keyed every download affordance on component `$state` (`busyAction === 'download'` for the header, `resolvedRows[i]` for each row's uid, DownloadControl `resolved` / SongRow `resolvedTrack`) while the download ran on the singleton `library.downloading` under the RESOLVED uid. A remount reset that state, so rows fell back to the nameStub uid (`${source}:similar-…`, never in the Set), the header lost its busy flag, and nothing guarded a second job. The shared store itself was correct throughout.
- **Fix:** `library.albumJobs` (claim-once Set: `beginAlbumJob(key): boolean` / `endAlbumJob`) and `library.resolvedStubs` (stub {artist,title} → Track by `matchKey`: `rememberStub` / `stubTrack`), both transient. Album page: `resolvedRows` is a DERIVED read of `stubTrack` per row, `resolveAll` reuses/remembers, `downloadAlbum` claims the job in the store, header `disabled`/ring = `albumJobs.has(albumKey)`, `'download'` removed from `AlbumAction`. SongRow `real` falls back to `stubTrack` and `runResolve` remembers. 4 failing-first tests; CDP leave/return E2E: idle+enabled+duplicate → live % rings + disabled header + 2nd tap refused.
- **Files changed:** src/lib/stores/library.svelte.ts, src/lib/stores/library.svelte.test.ts, src/lib/components/SongRow.svelte, src/lib/components/DownloadControl.svelte, src/routes/(app)/album/[name]/+page.svelte
---


## album-rows-miss-liked-downloaded-on-load — stub rows show idle icon + empty heart on first load for an already downloaded/liked song
- **Date:** 2026-10-01
- **Error patterns:** album row, download tick missing on load, like button not filled, filled heart only after like/unlike, stub row, nameStub, resolvedStubs, stubTrack, isDownloaded false, isLiked false, fresh load, reload, home shelf, charts
- **Root cause:** Every stub row (album `nameStub`, home-shelf / charts stubs) keys like + download state on `real?.uid`, whose last rung is `library.stubTrack` — a plain read of `resolvedStubs`, a SESSION-ONLY map written only by a resolve. On a fresh load it is empty, so `actUid` fell back to the synthetic `${src}:similar-…` uid → `isDownloaded`/`isLiked` false although `library.downloads`/`liked` held the song under its real uid. A like tap resolved (network) → `rememberStub` → the row re-keyed → tick + heart appeared.
- **Fix:** `library.stubTrack` gains a second rung: match the stub by song identity against the persisted lists with no network — `songIndex` ($derived, `songKey` title half → Track[], downloads first then liked, re-keyed on `foldRev`), exact `songKey` then the `sameSongKey` artist alias via the new `sameSongStrings` raw-string export in dedupe.ts. `warmFold` also warms on CJK liked/downloaded entries (called from `save()`). No component changed — SongRow / album page / DownloadControl / RowBadges inherit it. 7 failing-first tests; CDP E2E: idle+unliked → TICK + filled heart on first render (incl. 繁/简), Like acts on the real uid with zero fetches.
- **Files changed:** src/lib/stores/library.svelte.ts, src/lib/stores/library.svelte.test.ts, src/lib/services/dedupe.ts, src/lib/services/dedupe.test.ts
---
