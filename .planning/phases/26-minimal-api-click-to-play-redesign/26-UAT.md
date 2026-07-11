---
status: diagnosed
phase: 26-minimal-api-click-to-play-redesign
source: [26-01-SUMMARY.md, 26-02-SUMMARY.md, 26-03-SUMMARY.md, 26-04-SUMMARY.md, 26-05-SUMMARY.md]
started: 2026-07-11T12:15:00Z
updated: 2026-07-11T12:40:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Click-to-play resolve: cross-source fallback + skip
expected: |
  Tapping a song whose source cannot resolve (slow/dead upstream) should quickly try the
  OTHER sources (kuwo-first / high-quality order) for the same song, and if ALL sources
  fail, auto-skip to the next song. It must never hang in a loading state.
result: issue
reported: "click a song, then it fail to resolve with qq, it got stuck, the proper way should be try with other resolver, if all resolvers fail, skip to next song. [activity log: play qq:003taMev0TxjCY fresh at 659 → no resolve.ok/error/fallback/skip → user manually played netease 23s later; retry of same qq song at 728 resolved ok]"
severity: blocker

### 2. Up-Next formation: single track.getSimilar call, never empty
expected: |
  Up-Next is formed by ONE `track.getSimilar` call on the current song (artist+title list),
  NOT `artist.getSimilar` + per-artist searchAll. The list must not come back empty when
  valid similar songs exist (CR-01: fallback gated on pre-filter count can wrongly return []).
result: issue
reported: "next up list still using similar by artist then search artist to form the list instead of single api that form similar next up songs from current playing song"
severity: major

### 3. Up-Next list cover cost
expected: |
  Rendering the Up-Next list should NOT fire a per-song Deezer->iTunes->CN cover chain.
  Covers should come from the similar API's own artwork (Last.fm image URLs) or be deferred.
result: issue
reported: "so only song cover may need to be fetched additionally (perhaps the similar api contain song cover too)"
severity: major

### 4. Version selector placement (menu + up-next), lazy/opt-in
expected: |
  A version/source selector is reachable from the long-press track menu AND the Up-Next
  list, not only the search row. Because non-search contexts carry only the played song's
  single source, populating variants there must be lazy/opt-in (fetch only when the picker
  is opened, or reuse cached search variants) so it does not reintroduce a fan-out.
result: issue
reported: "where can i select song version? such version selector modal should be in long press menu and next up list ... basically everywhere a song can be played. is it heavy loading for api tho, i think the version are already there when fetch that song?"
severity: major

### 5. Version picker shows distinct, de-duplicated versions
expected: |
  The version picker lists DISTINCT versions with a distinguishing label (album, or a
  version tag like Live/Demo/Acoustic/Cover when present) — not N identical rows. Multiple
  hits from the SAME source for the same song collapse; the user can tell the versions apart.
result: issue
reported: "the title in the Version selector placement modal are all the same, a distinct version name like concert or demo or cover (if exist) from that source should be displayed. [screenshot: ~10 JOOX rows all 'That Should Be Me / Justin Bieber / unknown quality']"
severity: major

### 6. Picking a version plays it; unverifiable resolve falls back/skips (not a stuck error)
expected: |
  Tapping a version in the picker plays that exact song. If a picked variant cannot be
  identity-verified at resolve (e.g. JOOX n-index no longer maps to its songmid), it should
  fall back to another source / skip with a clear toast — never leave a stuck error in the
  nowbar or play the wrong song.
result: issue
reported: "click any song in the Version selector placement throw error. [nowbar: 'joox identity mismatch: expected songmid=Z50146167B1778 (歌曲ID=501083668) but upstream n=23 returned songmid=Z7B83FC142DFCF (歌曲ID=454129518, 歌曲名稱=That Should Be Me) — refusing to play the wrong song']"
severity: major

## Summary

total: 6
passed: 0
issues: 6
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "A tapped song whose source fails/stalls to resolve tries other sources, then skips if all fail — never hangs"
  status: failed
  reason: "User reported: click a qq song, it stuck on resolve — no fallback, no skip. Activity log: play qq fresh at t=659 with no subsequent resolve.ok/error/fallback/skip; user manually switched 23s later; a later retry of the same song resolved fine (transient qq upstream stall)."
  severity: blocker
  test: 1
  root_cause: "The never-stop cross-source failover (runFallback in player.svelte.ts) triggers on playback `error` events (a dead/expired audio URL after src is set), NOT on a stalled or failed INITIAL RESOLVE of a user-tapped sourced track. play() -> ensureTrackDetails(track) resolves ONLY the track's own source (catalog.ts:283; single-source for a sourced track — resolveNameStub's kuwo-first walk only applies to name-only up-next stubs). When that single source's /api resolve hangs (qijieya/qq flake) it sits in `loading` up to the ~25s apiFetch timeout; on null/failed resolve there is no cross-source resolve fallback and no auto-skip on the click hot path. armStall() watches the audio LOAD phase, not the resolve phase."
  artifacts:
    - path: "src/lib/stores/player.svelte.ts"
      issue: "play()/resolve path: no cross-source fallback or skip when the initial resolve returns null or stalls; runFallback is bound to audio error, not resolve failure; armStall covers load not resolve"
    - path: "src/lib/services/catalog.ts"
      issue: "ensureTrackDetails resolves a sourced track from its own source only; no kuwo-first multi-source resolve fallback for a tapped song that fails"
  missing:
    - "On click-to-play, if the tapped source's resolve returns null or exceeds a bounded resolve watchdog, walk the remaining sources (kuwo-first / quality order) for the SAME song (name+artist), first playable wins"
    - "If every source fails to resolve, auto-skip to the next queue item (strikeUnplayable + next), never hang in loading"
    - "A resolve-phase watchdog (short, e.g. a few seconds) so a stalled upstream fails fast into fallback rather than waiting the full apiFetch timeout"
  debug_session: ""

- truth: "Up-Next is one track.getSimilar call and never wrongly empty"
  status: failed
  reason: "User asserts up-next still uses artist-similar+search. Code shows track.getSimilar IS the primary path (similar.ts:57,144) with artist.getSimilar only as a dry fallback — but code review CR-01 found buildSimilarQueue can return [] when all candidates are the seed/excluded (fallback gated on pre-filter stubs.length instead of post-filter out.length), and regenerate() on every click-to-play has no safety net. An empty primary result silently falls to (or skips) the fan-out fallback."
  severity: major
  test: 2
  root_cause: "similar.ts buildSimilarQueue gates the artist.getSimilar fallback on pre-filter `stubs.length` rather than post-filter `out.length` (CR-01); regenerate() in player.svelte.ts lacks the safety net ensureAhead() has, so an empty generated queue is not recovered."
  artifacts:
    - path: "src/lib/services/similar.ts"
      issue: "CR-01: fallback decision uses pre-filter count; can return [] when similars are all seed/excluded (line ~164)"
    - path: "src/lib/stores/player.svelte.ts"
      issue: "regenerate() has no empty-result safety net (unlike ensureAhead)"
  missing:
    - "Gate the artist.getSimilar fallback on post-filter out.length so a fully-filtered primary result still triggers the fallback"
    - "Add a regenerate() safety net for an empty generated queue"
    - "Confirm via activity log that a fresh play forms up-next from ONE /api/lastfm/similar-tracks call (add an up-next-source log event if absent)"
  debug_session: ""

- truth: "Up-Next list tiles do not each fire a Deezer->iTunes->CN cover chain"
  status: failed
  reason: "User: only song cover should be fetched additionally, similar API may contain covers. Network panel showed a flood of /api/deezer/search?q=<artist>+<title> — per-song cover resolution for the up-next list. Phase 26-02 took covers off the now-playing HOT PATH only, not the up-next LIST tiles."
  severity: major
  test: 3
  root_cause: "Up-Next tile art resolves per song via resolveCoverForTrack (Deezer->iTunes->CN), and /api/lastfm/similar-tracks currently returns only {artist,title,match} — it discards the Last.fm image URLs that track.getSimilar provides."
  artifacts:
    - path: "src/routes/api/lastfm/similar-tracks/+server.ts"
      issue: "Reshapes track.getSimilar to {artist,title,match} only; drops the `image` array Last.fm returns"
    - path: "src/lib/services/similar.ts"
      issue: "Name stubs carry no cover; up-next tiles then resolve covers individually"
    - path: "src/lib/components/NowPlaying.svelte"
      issue: "Up-Next tile cover binding triggers per-tile cover resolution"
  missing:
    - "Extend /api/lastfm/similar-tracks to pass through the Last.fm image URL per track"
    - "Seed up-next name stubs with that image as their cover so tiles paint without a per-song cover chain"
    - "Defer/skip the Deezer->iTunes->CN cover chain for up-next tiles (only the now-playing track gets the optional HQ upgrade)"
  debug_session: ""

- truth: "Version selector is reachable from the long-press menu and Up-Next, lazily (no fan-out)"
  status: failed
  reason: "User: version selector should be everywhere a song can be played (long-press menu + up-next), and asks if it is heavy on the API. VersionPicker is currently mounted only on the search row."
  severity: major
  test: 4
  root_cause: "VersionPicker is mounted only in search/+page.svelte (line ~652); TrackMenu.svelte and NowPlaying.svelte up-next have no version control. groupVariants consumes the pre-dedupe search variant set, which only exists on the search page — a played/queued song carries a single source, so a menu/up-next picker needs variants fetched on demand."
  artifacts:
    - path: "src/routes/(app)/search/+page.svelte"
      issue: "Sole VersionPicker mount"
    - path: "src/lib/components/TrackMenu.svelte"
      issue: "No version control in the long-press menu"
    - path: "src/lib/components/NowPlaying.svelte"
      issue: "No version control in the Up-Next list"
    - path: "src/lib/services/dedupe.ts"
      issue: "groupVariants needs a variant source for non-search contexts"
  missing:
    - "Add a version control to TrackMenu (long-press) and Up-Next rows"
    - "LAZY/OPT-IN variant fetch: only when the user opens the picker, do an on-demand cross-source search for same name+artist (single deliberate fan-out, gated behind the tap) — or reuse cached search variants when the track came from search"
    - "Show the control only where >1 variant is (or can be) available; keep the default tap single-source/fast"
  debug_session: ""

- truth: "The version picker shows distinct, de-duplicated versions with a distinguishing label — not N identical rows"
  status: failed
  reason: "User reported the picker shows ~10 identical JOOX rows ('That Should Be Me / Justin Bieber / unknown quality') and wants a distinct version name (concert/demo/cover/live) shown when it exists."
  severity: major
  test: 5
  root_cause: "groupVariants (dedupe.ts:79) buckets variants by normalized name+artist ONLY — JOOX returned ~10 search hits for one song that all normalize to the same key, so all 10 land in one group. VersionPicker renders each row as title·artist·qualityLabel (VersionPicker.svelte:72); pre-resolve quality is 'unknown quality', so the 10 rows are visually identical. No intra-source dedup and no distinguishing version label (album / (Live)/(Demo)/(Acoustic)/(Cover) tag)."
  artifacts:
    - path: "src/lib/services/dedupe.ts"
      issue: "groupVariants has no intra-source dedup; one source's many same-name hits become many identical rows"
    - path: "src/lib/components/VersionPicker.svelte"
      issue: "Row shows only title·artist·quality (all 'unknown quality' pre-resolve) — no distinguishing label"
  missing:
    - "De-dup variants within the same source (by songid/songmid) so one source contributes at most one row per genuinely-distinct version"
    - "Derive and show a distinguishing label per row: album name, and/or a version tag parsed from the title parens ((Live)/(Demo)/(Acoustic)/(Cover)/(Remix)) when present"
    - "When two variants are truly indistinguishable, collapse them rather than listing duplicates"
  debug_session: ""

- truth: "Picking a version plays that exact song; an unverifiable resolve falls back/skips with a toast, never a stuck error"
  status: failed
  reason: "User: clicking any song in the version picker throws an error. Nowbar shows 'joox identity mismatch: expected songmid=Z50146167B1778 (歌曲ID=501083668) but n=23 returned songmid=Z7B83FC142DFCF (歌曲ID=454129518, That Should Be Me) — refusing to play the wrong song'."
  severity: major
  test: 6
  root_cause: "JOOX resolve fetches detail by fragile n=jooxIndex position and re-validates the returned songmid/歌曲ID against the expected pair (the cross-field guard from the known joox-swaps-songmid-songid issue; joox.ts:249-271). A picked mid-list JOOX variant's n=23 no longer maps to its songmid (JOOX's n-indexed detail is position/session-fragile), so resolve pulls a different song → neither returned token matches expected → the guard correctly THROWS. But the throw surfaces as a STUCK nowbar error with no cross-source fallback/skip. Compounded by gap 5 (10 fragile JOOX indices offered)."
  artifacts:
    - path: "src/lib/sources/joox.ts"
      issue: "Resolve by fragile n=index; identity guard throws (line ~271) when the index maps to a different song"
    - path: "src/lib/components/VersionPicker.svelte"
      issue: "onpick -> player.play; a resolve throw is not handled into fallback/skip"
    - path: "src/lib/stores/player.svelte.ts"
      issue: "A picked-variant resolve failure should route into the same resolve-fallback/skip path as gap 1 (26-06), not a stuck error"
  missing:
    - "Prefer resolving a picked JOOX variant by its stable songmid over the fragile n-index (or verify n maps to the expected songmid before offering/using it)"
    - "Route a version-pick resolve failure (identity mismatch / null) into the gap-1 resolve-fallback + skip path, with a clear 'couldn't play this version' toast — never a stuck nowbar error"
    - "Only offer variants that can be reliably resolved (drop indices that cannot be identity-verified)"
  debug_session: ""
