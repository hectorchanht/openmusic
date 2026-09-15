---
status: resolved
trigger: "Chrome's OS media panel shows the openmusic PWA icon instead of the song cover, while the in-app NowPlaying hero shows the correct cover for the same track"
created: 2026-09-14
updated: 2026-09-14
---

# Debug: media card shows app icon instead of cover

## Symptoms

**Expected:** Chrome's media-control panel row for openmusic.lol shows the playing song's album art — the same cover the in-app NowPlaying hero displays.

**Actual:** The panel shows the purple openmusic app icon. The app's own hero, visible right behind the panel in the user's screenshot, shows the real album art for the same track at the same moment.

**Reproduction (user, desktop Chrome, https://openmusic.lol):** play 搶 (feat. Polar G) (Explicit) / RIVA.852, open Chrome's media-control panel. Not yet reproduced in this environment — see Constraints.

**Errors:** none reported.

**Timeline:** reported 2026-09-14. Related media-card artwork work landed 2026-07-08 (cover-hero-mediacard-missing) — whether this is a regression of that fix or an uncovered path is part of the investigation.

## Established before this session (do NOT re-derive)

- `buildArtwork` (src/lib/services/media-session.ts:61) emits the `FALLBACK_ART` `/favicon.svg` entry whenever the cover handed to it is not an https URL. The purple icon is either that fallback or Chrome's own page-icon fallback — **discriminating those two is the first job.**
- `syncMetadata` (src/lib/stores/player.svelte.ts:1289) is the ONLY artwork write that consults the shared reactive cover cache (`readCoverByUidOrName`). It is called at exactly two sites: `play()` entry (~line 3102) and `restore()` (~line 573). Nothing re-runs it when a cover lands LATER.
- `resolveCoverAsync` (~line 3500) writes a fresh MediaMetadata, but fires ONLY when `resolvedCover` started null and only on its own resolve-chain hit. The Deezer HQ upgrade path (~line 3540+) re-writes only when the track ALREADY had a solid inline cover. So a cover landing in the shared cache via a DIFFERENT surface (a row's `use:lazyCover`, cover-backfill, a sibling tile) after `play()`'s window repaints the hero (reactive via `coverVersion()`) and never reaches the media card.
- Third instance of a documented bug class: 2026-07-08 `cover-hero-mediacard-missing` fixed the hero and the play()-time media card; quick-260914-to2 (2026-09-14, commits 8a8ed24 / f6d4d31 / 0bf64b4) fixed the DOWNLOAD path reading `track.cover` instead of the shared cache.
- Verified live on prod in the in-app Browser pane this session: playing a Deezer-covered track (Dracula / Tame Impala) yields `navigator.mediaSession.metadata.artwork` = a real `https://cdn-images.dzcdn.net/...` URL. **The happy path works** — the failure is specific to some other cover provenance or timing.

## Constraints

- CN search upstreams (netease / qq Meting proxies) are BLOCKED in this sandbox; only Deezer typeahead and kuwo answer. The user's exact song could not be searched here.
- Prod IS reachable and playable via the Browser pane (`mcp__Claude_Browser__*`), and `navigator.mediaSession.metadata` is readable with `javascript_tool`. Use that to test hypotheses on whatever tracks DO resolve here.
- Gates: `pnpm test` + `pnpm check`. House style: tabs, single quotes, high comment density with decision refs (tag new work `media-card-shows-app-icon`).
- Commit on main, **DO NOT PUSH** — pushing auto-deploys production.

## Competing hypotheses (discriminate BEFORE changing code)

**A — never re-synced.** Metadata artwork is the `/favicon.svg` fallback because no write happened after the cover landed (the missing re-sync above).
Test: find or force a track whose cover arrives from the shared cache after `play()`'s window, then read `navigator.mediaSession.metadata.artwork[0].src`. `/favicon.svg` proves A.

**B — Chrome cannot fetch the artwork.** Metadata holds a REAL https cover URL that Chrome's own artwork fetch is refused (a CN-hosted cover — y.gtimg.cn, kuwo — with hotlink/referrer protection returning 403). The app hides this in-app because its `<img>` tags carry `referrerpolicy=no-referrer`, which Chrome's media-session fetch does not.
Test: play a track whose cover is CN-hosted, read `metadata.artwork[0].src`, then fetch that exact URL without a referer / from another origin and check the status.

Both may be true at once, and they need different fixes. State plainly which was PROVEN.

## Likely fix shapes (do NOT implement before the diagnosis is proven)

- **For A:** expose a public re-sync on the player store and drive it reactively from `coverVersion()` in the app layout (`src/routes/(app)/+layout.svelte`) — `cover-version.svelte.ts` cannot import player without a cycle (player already imports cover-version).
- **For B:** hand the media session a `data:` URL instead of a remote URL. `src/lib/services/media-artwork.ts` `resolveArtworkDataUrl` already does exactly this for the NATIVE plugin. Confirm Chrome accepts a `data:` URL for MediaSession artwork before relying on it, and keep the existing never-throws / size-cap contracts.

## Current Focus

hypothesis: PROVEN — A (variant: QQ's non-https `album_pic` adopted into `resolvedCover`, starving every re-sync path). B DISPROVEN.
test: complete
expecting: n/a
next_action: none — session resolved (fix e17ce39 on main, unpushed; live post-deploy check is a pending UAT step, see Resolution.verification)

reasoning_checkpoint:
  hypothesis: "QQ's http:// album_pic reaches resolvedCover, where it is truthy enough to starve every cover-resolve path but not https enough for buildArtwork — media card = favicon while the hero paints the same URL via Chrome's mixed-content autoupgrade"
  confirming_evidence:
    - "prod /api/qq/detail for mid 003BSgJw3nd6ew (the user's song) returns album_pic = http://y.gtimg.cn/music/photo_new/T002R500x500M0000037lGPa24IpCz_1.jpg (http, not https); /api/qq/search returns no cover"
    - "qq.ts:350 `track.cover = d.album_pic || d.singer_pic || track.cover` is raw; the https() helper (32-D-05) is applied ONLY to the stream url"
    - "player.svelte.ts:3309 `if (!this.resolvedCover) this.resolvedCover = resolved.cover` adopts the http url; :3433 `if (!this.resolvedCover)` then skips resolveCoverAsync; :3446 hasHttpsScheme() skips upgradeCoverAsync; healCover returns on !hasHttpsScheme; buildArtwork returns /favicon.svg for non-https"
    - "curl https://y.gtimg.cn/...003RMaRI1iFoYd.jpg → 200 image/jpeg with and without a Referer — host serves https and does not hotlink-block (disproves B for QQ covers)"
  falsification_test: "if navigator.mediaSession.metadata.artwork[0].src on prod for this song were a real https URL rather than /favicon.svg, the hypothesis is wrong (Browser MCP tools were not available in this agent, so this was proven by trace + measured inputs instead)"
  fix_rationale: "upgrade http→https at the adapter where the http url originates (same placement rationale as 32-D-05: the client adapter is the only place that fires on the direct-to-tang path); the cover then passes every existing https gate (buildArtwork, writeCoverBoth, upgradeCoverAsync, healCover) with no new branches. Two one-line hardening guards close the cache-poisoning leak (library.adoptCover wrote raw covers into the name layer with no https gate) and let a play whose seed came from an already-poisoned cache/persisted state pick up the https resolve on the FIRST replay"
  blind_spots: "kuwo `pic` scheme not measured (prod kuwo search returned no pic for this query); a poisoned cover-cache name-layer entry from before the fix self-corrects only when the song is re-resolved (writeCoverBoth overwrites it); native Android path unchanged (media-artwork.ts already resolves to data: URLs)"

## Evidence

- timestamp: 2026-09-14
  checked: prod `https://openmusic.lol/api/qq/search?msg=搶 RIVA.852&type=json` and `/api/qq/detail?type=json&mid=003BSgJw3nd6ew` (the user's exact song — QQ is the source that resolved it; search rows carry no cover, `qq.ts:291 cover: null`)
  found: detail returns `album_pic: "http://y.gtimg.cn/music/photo_new/T002R500x500M0000037lGPa24IpCz_1.jpg"` and `singer_pic: "http://y.gtimg.cn/..."` — HTTP scheme
  implication: the cover that reaches `track.cover` for this song is non-https; `buildArtwork` maps any non-https cover to `/favicon.svg`

- timestamp: 2026-09-14
  checked: `src/lib/sources/qq.ts:350` vs `:93-131`
  found: `track.cover = d.album_pic || d.singer_pic || track.cover;` is written RAW. The adapter's own `https()` helper (32-D-05) upgrades only `pickBestPlayUrl`'s stream url
  implication: the http cover is an adapter-boundary omission, not a player timing bug

- timestamp: 2026-09-14
  checked: player.svelte.ts cover flow for a track whose search stub has no cover and whose resolve returns an http cover
  found: `:3086` seed → null (no cache) → `syncMetadata` → favicon. `:3309 if (!this.resolvedCover) this.resolvedCover = resolved.cover` → resolvedCover = http url; `writeCoverBoth` skipped (https gate). `:3342` post-resolve metadata write → `buildArtwork(http)` → favicon. `:3433 if (!this.resolvedCover)` → FALSE → resolveCoverAsync (Deezer→iTunes→CN chain) never fires. `:3446 hasHttpsScheme(http)` → FALSE → upgradeCoverAsync never fires. `healCover` → `if (!hasHttpsScheme(url)) return` → no heal. No other artwork writer exists
  implication: for this track the media card is `/favicon.svg` permanently — nothing can ever re-sync it. Hypothesis A ("never re-synced → /favicon.svg") is PROVEN, but the mechanism is the http scheme starving every resolve path, not a cover landing late from another surface

- timestamp: 2026-09-14
  checked: NowPlaying.svelte `effectiveCover = player.resolvedCover ?? readCoverByUidOrName(...)` (:537) and Nowbar `:127` — both render the same http url as an image/CSS background
  found: desktop Chrome auto-upgrades mixed-content images (`http:` → `https:`) and y.gtimg.cn serves https (see next entry), so the hero paints the real art from the very url the media card refuses
  implication: explains the user's screenshot — same track, same moment, hero correct + card favicon — with a single value

- timestamp: 2026-09-14
  checked: `curl -o /dev/null -w '%{http_code} %{content_type}' https://y.gtimg.cn/music/photo_new/T002R300x300M000003RMaRI1iFoYd.jpg` with no Referer and with `Referer: https://openmusic.lol/`
  found: `200 image/jpeg 66463` in both cases; `http://` variant also 200
  implication: y.gtimg.cn neither hotlink-blocks nor requires a referer, and serves https byte-identical — hypothesis B is DISPROVEN for QQ covers, and an http→https upgrade of the cover is safe

- timestamp: 2026-09-14
  checked: `library.adoptCover` (library.svelte.ts:114-135) and `cover-cache.ts writeKey`
  found: `setCachedCover(src.artist, src.title, cover)` writes the RAW resolved cover into the name layer with no https gate (writeKey only rejects empty strings). Every other writer (writeCoverBoth call sites, resolveCoverForTrack, resolveDeezerHQ) is `hasHttpsScheme`-gated (T-0bb-01)
  implication: a played QQ song poisons the shared name-layer cache with an http url; the NEXT play of that song seeds `resolvedCover` from `getCachedCover(...)` (:3086) with the http url, reproducing the starvation even after the adapter fix until the entry is overwritten — hence the one-line gate + the :3309 "prefer an https resolve over a non-https seed" tweak

- timestamp: 2026-09-14
  checked: prod `/api/netease/search` pic scheme for the same query
  found: `https://api.qijieya.cn/meting/?server=netease&type=pic&id=...` — already https
  implication: netease is not affected; QQ is the (measured) offender

## Eliminated

- hypothesis: B — Chrome cannot fetch a real https CN cover url (hotlink/referer 403)
  evidence: y.gtimg.cn answers 200 image/jpeg with no Referer; and for this track the metadata artwork is not a CN url at all — it is `/favicon.svg` by trace (buildArtwork on an http cover)
  timestamp: 2026-09-14

- hypothesis: A as sketched — the cover lands in the shared cache via ANOTHER surface after play()'s window and nothing re-syncs
  evidence: no other surface is needed: the hero's art is `player.resolvedCover` itself (the http url, auto-upgraded by Chrome). The "no re-sync" half is true but the cause is the http scheme suppressing every resolve path, so the sketched fix (drive syncMetadata from coverVersion()) would NOT have fixed this — resolvedCover (http) still wins the `??` and buildArtwork still emits the favicon
  timestamp: 2026-09-14

## Resolution

root_cause: QQ detail returns `album_pic`/`singer_pic` as `http://y.gtimg.cn/...`; `qq.ts:350` commits it raw as `track.cover` (its 32-D-05 `https()` upgrade covers only the stream url). play() adopts the http url into `resolvedCover` (`:3309`), where it is truthy — so `resolveCoverAsync` (`if (!resolvedCover)`), `upgradeCoverAsync` and `healCover` (`hasHttpsScheme`-gated) all skip — yet fails `buildArtwork`'s https gate, so every MediaMetadata write for the track carries `/favicon.svg`. The hero paints the same http url because Chrome auto-upgrades mixed-content images and y.gtimg.cn serves https. Secondary: `library.adoptCover` cached the http url in the name layer ungated, so replays re-seeded the same value.
fix: (1) `src/lib/sources/qq.ts` resolve — `track.cover = https(d.album_pic || d.singer_pic || null) || track.cover` (the adapter's existing 32-D-05 `https()` helper now covers art as well as the stream url). (2) `src/lib/stores/library.svelte.ts adoptCover` — `setCachedCover` gated on `hasHttpsScheme(cover)` so the shared name-layer cache can no longer be poisoned with an http url. (3) `src/lib/stores/player.svelte.ts` post-resolve adopt — `if (!hasHttpsScheme(this.resolvedCover)) this.resolvedCover = resolved.cover` so a non-https seed from a pre-fix cache entry / persisted current yields to the https resolve on the first replay (an attached/https seed still wins as before). (4) Regression test `qq.test.ts` "https-upgrades an http album_pic / singer_pic cover" — http album_pic → https, singer_pic fallback → https, neither → null.
verification: |
  pnpm test →  Test Files  125 passed (125) / Tests  2381 passed (2381) / Duration 8.99s
  pnpm check → COMPLETED 4525 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
  Trace after fix for the user's song (qq:003BSgJw3nd6ew): resolve → track.cover = https://y.gtimg.cn/... → :3309 adopts it → post-resolve MediaMetadata write buildArtwork(https) emits the 6-entry ladder pointing at the cover (not /favicon.svg) → writeCoverBoth caches it → :3446 upgradeCoverAsync fires the Deezer HQ tier as designed. y.gtimg.cn over https measured 200 image/jpeg without a referer, so Chrome's artwork fetch succeeds.
  Session-manager check: commit e17ce39 exists on main, unpushed (origin/main..main = 1 commit), touching qq.ts, qq.test.ts, library.svelte.ts, player.svelte.ts.
  Human-verify checkpoint: NOT performable this session — the live check needs the fix deployed to https://openmusic.lol, and pushing main (auto-deploys prod) was forbidden; no user reachable. Resolved on the self-verified basis above (curl-measured http album_pic from prod /api/qq/detail, code trace, tests, typecheck).
  PENDING UAT (post-deploy): on desktop Chrome at https://openmusic.lol play 搶 (feat. Polar G) / RIVA.852, open Chrome's media-control panel — it should show the album art; in DevTools `navigator.mediaSession.metadata.artwork[0].src` should be `https://y.gtimg.cn/...`, NOT `/favicon.svg`.
files_changed: [src/lib/sources/qq.ts, src/lib/stores/library.svelte.ts, src/lib/stores/player.svelte.ts, src/lib/sources/qq.test.ts]
commit: e17ce39 fix(media-card-shows-app-icon): https-upgrade QQ covers so the OS media card gets real art (main, unpushed)
