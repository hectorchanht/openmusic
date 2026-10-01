---
phase: 40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a
plan: 08
subsystem: cover-pick
tags: [cover-pick, player, trackmenu, edge-cache, cors]
requires: ["40-05", "40-06", "40-07"]
provides:
  - "player.svelte.ts: crowd cover in every seed (pin > crowd > attached > inline > cache), crowdCoverAsync (one gen-guarded GET per played song per session), adoptCover chosen-url guard, healCover local crowd eviction"
  - "TrackMenu.svelte: pickCover is the only voter (fire-and-forget submitCoverPick); activeCover leads with readChosenCover"
  - "cover-pick.ts pickCacheUrl: off-path /api/cover-pick/__edge edge-cache key so hits always carry CORS"
  - "match-key.ts versionedMatchKey: crowd cover name key that keeps (Live)/Remix/etc. distinct"
affects: [40-09]
tech-stack:
  added: []
  patterns: ["edge-cache key kept off the public URL because adapter-cloudflare serves matching caches.default entries before the route/hooks run"]
key-files:
  created: []
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/components/TrackMenu.svelte
    - src/lib/services/share.test.ts
    - src/lib/proxy/cover-pick.ts
    - src/routes/api/cover-pick/+server.ts
    - src/routes/api/cover-pick/cover-pick-endpoint.test.ts
    - src/lib/services/match-key.ts
    - src/lib/services/cover-pick-shared.ts
    - src/lib/services/cover-pick-shared.test.ts
    - src/lib/services/cover-cache.ts
    - src/lib/services/cover-cache.test.ts
decisions:
  - "The crowd pick is adopted via getCrowdCover read-back (same uid → name order as adoptCover's chosen check), so adopt and guard always agree"
  - "/api/cover-pick edge-caches under /api/cover-pick/__edge?…, never the public GET URL (adapter worker would serve it CORS-less, breaking the APK)"
  - "The crowd cover name key keeps version markers (versionedMatchKey); matchKey and the auto name layer keep their folding"
  - "Traditional/Simplified folding of the crowd name key is deferred (follow-up)"
metrics:
  duration: ~35min
  completed: 2026-09-30
  tasks: 3
  files: 12
---

# Phase 40 Plan 08: Crowd cover pick in the player and picker Summary

The crowd-shared cover pick is now live for users. Playing a song issues one generation-guarded GET `/api/cover-pick` per song per session. A winner is cached in the `crowd:` family and adopted through `adoptCover`, which repaints the hero, the Nowbar and the OS media card. Precedence is pin > crowd > album-attached > inline > auto cache. The only voter is an explicit Change-cover tap. Two changes were made at the checkpoint. Edge-cache hits now always carry CORS, so the APK can read them. Live/remix versions keep their own crowd pick.

## What was built

- **player.svelte.ts** (D-14 / D-14a / D-16 / D-19):
  - `getCrowdCover` sits right after the pin in the `play()`, `armTrack()` and `restore()` seeds. `armTrack()` and `restore()` only read the cache and never fetch.
  - Site A skips `writeCoverBoth` for a crowd-chosen seed.
  - `crowdCoverAsync` uses a plain `crowdRequested` Set and bails on device: uids, pinned uids and repeats. It also bails when the keys are null or the generation has gone stale.
  - `adoptCover` accepts only `chosen = pin ?? crowd` when one exists, and never writes chosen art to the auto layers.
  - `healCover` calls `removeCrowdCover` (local only) when the dead url is the crowd entry.
  - The player never votes.
- **TrackMenu.svelte** (D-15):
  - `pickCover` sends `void coverPickKeys(...).then(k => k && submitCoverPick(k, url))` with the raw artist/title.
  - `activeCover` leads with `readChosenCover`. The unused `readPinnedCover` import was dropped.
- **Checkpoint change 1, APK CORS:**
  - `pickCacheUrl(origin, keys)` builds `${origin}/api/cover-pick/__edge?${pickQuery(keys)}`.
  - The GET cache and the post-vote bust both use it, so the bust key stays exact.
  - No other route changed.
- **Checkpoint change 2, live versions:**
  - `versionedMatchKey` folds only case, whitespace and punctuation.
  - `coverPickKeys`' `n` hash and `crowdNameKey` use it.
  - `matchKey`, `coverCacheKey` and the auto name layer are untouched.

## Verification (observed)

- Unit tests:
  - player: 340/340, 10 new crowd tests. On the RED commit they failed, but in `beforeEach` (`crowdRequested` was undefined), not on their individual asserts.
  - cover-pick endpoint and proxy: 53/53.
  - Full `pnpm test`: 171 files, 3832 tests. `pnpm check`: 0 errors, 12 pre-existing warnings.
- **RED → GREEN for the checkpoint changes:**
  - Edge key: 5 endpoint rows failed before the fix (miss key, off-path key, hit key, two bust keys) and pass after.
  - Version key: 2 rows failed before (`coverPickKeys` 晴天 vs 晴天 (Live) / （Live） / - Live / (Remix) / [Acoustic], and the `crowd:name:` live/remix isolation) and pass after.
- **`wrangler pages dev` two-voter E2E** (headless Chrome over CDP, separate profiles, curl-spoofed `cf-connecting-ip`; no production writes). This ran before the checkpoint changes:
  - Profile 1 played QQ 晴天 and got one GET (200). Change cover offered 12 tiles. Tapping the iTunes tile sent one POST `{u,n,url}` (200) and saved the pin.
  - A curl GET then returned the chosen URL under both `u` and `n`.
  - Profile 2 (fresh) got exactly one GET. `crowd:uid` and `crowd:name` were written, and `.np-art` showed the voted cover instead of the inline `y.gtimg.cn` cover. A replay sent no second GET.
  - A different uid with the same name (`qq:004Fs2FP1EvZYc`, 晴天 (Live)) showed the voted cover through the name key. That merge is now intentionally changed (checkpoint change 2).
  - Spoofed voters:
    - 1–1 ties go to the most recent vote.
    - An immediate re-vote gets 429 `slow-down`.
    - 2–1 wins.
    - No Origin gets 403; a host off the allowlist gets 400.
  - Profile 1 replay: no cover-pick traffic, and the pin still beat the crowd winner.
  - Profile 2 in a new session, with its HTTP cache cleared: the stale local crowd X was replaced by the server's Y and adopted.
- **After change 1** (rebuilt, `wrangler pages dev` again):
  - Three repeat GETs with `Origin: https://localhost` (the APK origin, allowlisted in `http.ts`) all returned 200 with `Access-Control-Allow-Origin: https://localhost` and `Cache-Control: no-cache`. None came back as `CF-Cache-Status: HIT` raw copies.
  - The OPTIONS preflight returned 204 with ACAO.
  - The miniflare cache store holds the entry under `/api/cover-pick/__edge?u=…&n=…` only. A vote deleted that key, and the next GET returned the new winner with ACAO.
- **APK emulator: not verified.**
  - I built a debug APK with `VITE_API_BASE=http://localhost:8799`, used `adb reverse`, and ran it on Pixel_3a_API_34. The WebView refused every request to the local server (`TypeError: Failed to fetch`), because `allowMixedContent: false` plus cleartext blocks http from `https://localhost`.
  - Production does not have this code (unpushed) and votes must not hit production, so an in-APK crowd load could not be shown.
  - The emulator was then shut down, and `pnpm apk` was re-run so `build/` and the APK point at `https://openmusic.lol` again.
  - What remains: install the next deployed build's APK and confirm a crowd cover paints.
- Not browser-verified, unit-tested only: OS media-card artwork after a crowd adopt, and D-19 dead-crowd eviction. My CDP script did not detect the "Cover updated" toast; I did not look into why. The user approved the checkpoint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The `share.test.ts` source-ladder row pinned the old rung name**
- **Found during:** Task 2
- **Fix:** It now looks for `readChosenCover(` as the leading rung.
- **Commit:** 034af2b8

**2. [Rule 1] The winner is adopted by reading it back with `getCrowdCover`, instead of `pick.u ?? pick.n`**
- **Found during:** Task 1
- **Issue:** The plan's form could pick a url that `adoptCover`'s chosen check then refuses, for example when an old local uid entry exists and the server returns only `n`.
- **Fix:** Read the winner back after `writeCrowdCover`, so adopt and guard use the same lookup order.
- **Commit:** bd612b12

**3. [Scope] The crowd read was added to all three seeds**
- **Found during:** Task 1
- **Detail:** The `armTrack()` seed (the plan's "~L777") and the `restore()` seed (`target.*`) both got the crowd read, in addition to `play()`.
- **Commit:** bd612b12

### Checkpoint-directed changes (user, at approval)

**4. APK CORS on edge-cache hits** (commits 55f92243 RED, 526d7d3e)
- adapter-cloudflare's worker (`files/worker.js` ~L74) returns any `caches.default` entry that matches the request URL before the route and `hooks.server.ts` run. The stored `public, max-age=300`, CORS-less copy therefore went straight to clients.
- Fixed by keeping the cache key off-path.

**5. Live/remix versions keep their own crowd pick** (commits 7f1dc06c RED, ae9e70c0)
- `versionedMatchKey` replaces `matchKey` for the crowd name key only.
- One RED test line had a wrong input (`'a b'` folds to `ab`). It was corrected in the GREEN commit; the version-marker assertions themselves failed on RED as intended.

## Findings / follow-ups

- **繁/简 folding (follow-up, not in this plan):** JOOX tags 周杰倫|晴天, QQ tags 周杰伦|晴天. The crowd name key does not fold Traditional and Simplified script, so those copies do not share a pick. The auto name layer has the same limit.
- **Edge-cache bypass in other routes:** every other edge-cached `/api/*` route that keys `caches.default` on its own public URL has the same adapter fast path: CORS-less hits and browser `max-age` instead of the route's own headers. Left unchanged as directed. Worth an audit.
- **Old crowd data:** client votes cast under the old `n` hash (`matchKey`) no longer match. Locally, the old `crowd:name:` entries are orphaned until their TTL expires. The feature has not shipped, so the impact is nil.
- **Old public-URL edge entries:** these expire within 300 s of a deploy.

## Assumption Drift (advisory)

- **Found during:** Task 3
- **Planned:** the route's own edge cache serves a CORS-reapplied, browser-`no-cache` hit.
- **Actual:** the SvelteKit Cloudflare adapter serves the stored copy first.
- **Why it matters:** this was a hidden platform behaviour. Fixed under checkpoint change 1.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: cache-key | src/lib/proxy/cover-pick.ts | `/api/cover-pick/__edge?…` is reachable as a GET URL. The adapter serves the cached public consensus there (same data as the public GET, no CORS). It never touches R2 and leaks nothing new. |

## Known Stubs

None.

## Commits

- 4bbfda8e test(40-08): add failing tests for player crowd cover wiring
- bd612b12 feat(40-08): player seeds, fetches once and adopts the crowd cover pick
- 034af2b8 feat(40-08): cover picker tap votes and pre-selects the chosen cover
- 55f92243 test(40-08): failing tests for an off-path cover-pick edge-cache key
- 526d7d3e fix(40-08): keep cover-pick edge cache off the public URL so hits carry CORS
- 7f1dc06c test(40-08): failing tests for a version-keeping crowd cover name key
- ae9e70c0 feat(40-08): crowd cover name key keeps version markers

## Self-Check: PASSED

- FOUND all 7 commits and all modified files
