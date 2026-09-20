---
status: diagnosed
trigger: "in now playing page, when ytmusic cover is selected, it now shows blank black block, after change cover and click the same cover again, cover shows up."
created: 2026-09-20
updated: 2026-09-20
---

## Current Focus

hypothesis: CONFIRMED — a YouTube Music cover URL that fails to LOAD paints the NowPlaying hero as a
  transparent element over the black sheet ("blank black block"), because the hero paints the cover as
  a CSS `background-image`, which has NO error event and NO placeholder underneath it. `effectiveCover`
  is a truthy string, so D-12's gradient fallback (which only covers a NULL cover) never applies, and
  `healCover` — the only repair path — has already spent its one-shot `${uid}|${url}` guard on the
  auto-chain paint that happened before the user ever opened the picker. Re-picking the same cover
  works once the picker's own `<img>` tiles have warmed the browser image cache.
test: full CDP repro against the live dev server (localhost:5173) with `Network.setBlockedURLs` on
  `*googleusercontent.com*` / `*ytimg.com*` + `Network.clearBrowserCache`
expecting: black hero on the first pick; the same cover painting on a later pick once cached — BOTH SEEN
next_action: report; do not patch. Fix options in Resolution.

## Symptoms

expected: tapping a YouTube Music cover candidate in TrackMenu -> Change cover paints that cover in the
  NowPlaying hero
actual: the hero is a blank black square (drop shadow + rounded corners visible, no art, no gradient).
  Picking again later renders it correctly.
errors: none — a CSS background-image failure is silent by construction
reproduction: NowPlaying -> ⋮ -> Change cover -> tap a ytmusic candidate -> hero is black. Re-open
  Change cover, tap the same candidate -> renders.
started: regression. quick-260919-0mw (a48dbdd, 2026-09-19) "rank YouTube Music first in the cover
  chain" is the first commit that lets a Google-hosted image reach the hero at all.

## Eliminated

- hypothesis: the YTM candidate URL is not https / is a relative /api path, so `hasHttpsScheme` fails
  and `adoptCover` early-returns while `pinCover` already pinned (orchestrator H2)
  evidence: `collectCoverCandidates` gates every candidate on `hasHttpsScheme` before it can reach the
  grid; runtime capture shows candidates are absolute `https://yt3.googleusercontent.com/...` and
  `https://i.ytimg.com/vi/<id>/hqdefault.jpg?sqp=...`. Pin lands in `openmusic:cover-pins:v1` verbatim.

- hypothesis: the pin / adopt / guard-ladder ordering is wrong (orchestrator H3)
  evidence: driven end to end in a real browser. `pinCover` persists, `adoptCover` commits
  `resolvedCover`, the `{#key effectiveCover}` crossfade runs (both layers observed mid-fade at
  op=0.17/0.83), and reopening NowPlaying shows the pinned cover. Every store-side cover seed
  (`play()`, `restore()`, `armTrack`, `enrichFromLocalFile`) is already pin-aware.

- hypothesis: the URL is dead / hot-link-blocked / referer-gated / signature-expired
  evidence: `curl` — 200, `cache-control: public, max-age=86400`, `access-control-allow-origin: *`,
  `cross-origin-resource-policy: cross-origin`, identical with and without a `Referer: openmusic.lol`.
  The `?sqp=/&rs=` params on i.ytimg URLs are NOT enforced (tampered signature still 200), so they do
  not expire.

- hypothesis: `url(...)` is an invalid CSS value for these URLs
  evidence: the DOM shows `background-image: url("https://yt3.googleusercontent.com/...=w120-h120-s-l90-rj")`
  correctly parsed and painting, in the same session where an identical-shape URL went black.

- hypothesis: `healCover` unpins the user's choice on a failed probe (orchestrator H1, the pin-loss half)
  evidence: with the host blocked, the pin SURVIVED 12+ s of observation. `healProbed` was already
  spent on the same `${uid}|${url}` by the auto-chain paint, so healCover no-ops. The one-shot guard is
  part of the bug, but it removes the REPAIR, not the pin.

## Evidence

- timestamp: 2026-09-20 — checked: `git log` on the cover path
  found: `a48dbdd feat(quick-260919-0mw): rank YouTube Music first in the cover chain` — YTM inserted at
  the FRONT of `resolveTrackChain` (auto), of `resolveHqCover` (the per-play "HQ upgrade") and of
  `collectCoverCandidates` (the picker grid).
  implication: before 2026-09-19 no cover in this app ever came from a Google host. Every other tier
  is on a host a CN-facing app can reach (y.gtimg.cn, cdn-images.dzcdn.net, mzstatic, lastfm/fastly).

- timestamp: 2026-09-20 — checked: live cover picker for 知己知彼 / 王菲 (CDP, localhost:5173)
  found: 12 of 12 candidate tiles were `ytmusic`. For Dracula / Tame Impala: 11 of 12.
  implication: post-0mw the YTM tier fills MAX_CANDIDATES and pushes iTunes / Deezer / CN tiles out of
  the grid entirely. Whatever the user picks is almost certainly a Google-hosted URL.

- timestamp: 2026-09-20 — checked: `resolveCoverForTrack` called directly through a Vite module import
  found: chain returns `https://yt3.googleusercontent.com/<id>=w120-h120[-s]-l90-rj`.
  implication: the YTM tier's art is the search-shelf thumbnail at **120x120** (`bestThumb` takes the
  largest LISTED size, and the `-s-` variants are YouTube CHANNEL AVATARS, not album art). The
  "HQ upgrade" path now downgrades a 500-1000px album cover to a 120px avatar and writes it into the
  SHARED name cache layer. Observed live on the hero: lastfm-300 -> yt3-120 -> lastfm-300.

- timestamp: 2026-09-20 — checked: NowPlaying hero render seam
  found: `NowPlaying.svelte:965` `style:background-image={effectiveCover ? \`url(${effectiveCover})\` : fallbackCover(player.current)}`
  and CSS `.cover-cell.cur` / `.cover` carry NO background-image of their own; `.cover-img` is the only
  painter, `position:absolute; inset:0`.
  implication: a truthy-but-DEAD cover paints nothing, and nothing is underneath it. The D-12 gradient
  fallback covers only a NULL cover. Dead != missing, and only "missing" degrades gracefully.
  `cellBg` (prev/next carousel cells) has the identical shape.

- timestamp: 2026-09-20 — checked: `player.healCover` (player.svelte.ts:4221) — the only hero repair path
  found: (a) one-shot `healProbed` keyed `${uid}|${url}`, added BEFORE the probe; (b) `probeCover` is a
  bare `new Image()` with no timeout.
  implication: the auto chain paints the YTM url and burns the one-shot before the user opens the
  picker, so a pin of that same url can never be healed. And on a HANGING host (as opposed to a fast
  RST) the probe never settles, so no verdict is ever reached.

- timestamp: 2026-09-20 — checked: REPRODUCTION, headless Chrome + CDP, `Network.clearBrowserCache` +
  `Network.setBlockedURLs(['*googleusercontent.com*','*ytimg.com*'])`
  found: all 12 picker tiles rendered with `naturalWidth: 0` (black squares); after picking one, the
  NowPlaying hero was an EMPTY BLACK SQUARE — screenshot `t24-hero.png`, exactly "blank black block".
  Then with the block lifted (tiles now `naturalWidth: 120`), re-picking the SAME candidate painted the
  cover — screenshot `t25-second-pick.png`.
  implication: both halves of the user's report reproduce from a single cause — the YTM image host being
  unreachable at first-pick time, and reachable (or cached) later.

- timestamp: 2026-09-20 — checked: the same flow with the hosts REACHABLE
  found: pin persists, hero repaints live through the crossfade, reopening NowPlaying shows the pin,
  `healCover` leaves it alone.
  implication: there is no state-machine defect in the pick -> pin -> adopt -> paint path. The defect is
  that the path has no answer for a cover URL that does not load.

## Resolution

root_cause: |
  quick-260919-0mw (a48dbdd) made YouTube Music tier-1 of the cover chain AND the head of the cover
  picker grid. YTM art is hosted on yt3/lh3.googleusercontent.com and i.ytimg.com — the only tier in
  the chain on a Google host, and the one host class this app's (CN-facing) users routinely cannot
  load: GFW, carrier/DNS filtering, or an ad-blocker blocklist (i.ytimg.com and googleusercontent are
  on several).

  When that image fails to load, the NowPlaying hero shows a blank black block, because the hero paints
  the cover as a CSS `background-image` (NowPlaying.svelte:965) — which has no `error` event and nothing
  painted underneath it. `effectiveCover` is a truthy string, so the D-12 placeholder gradient (which
  only fires on a NULL cover) never applies. Dead and missing are not the same case, and only missing
  degrades gracefully.

  The self-heal cannot rescue it: `healCover`'s one-shot `healProbed` key (`${uid}|${url}`) is already
  spent by the auto-chain paint that happens before the user ever opens the picker, and `probeCover`
  has no timeout, so a hanging host never yields a verdict.

  "Click the same cover again and it shows up" is the browser image cache: the picker's own `<img>`
  tiles keep retrying the host in the background, and once one fetch succeeds the next paint of that
  URL is served from cache.

fix: |
  NOT APPLIED — reported for a decision. Three separable changes, smallest first:

  1. DEAD COVER MUST DEGRADE TO THE GRADIENT (1 line, 2 call sites, fixes the reported symptom for
     every dead cover, not just YTM). Put the placeholder UNDER the image as a second CSS background
     layer, so a failed load reveals the gradient instead of the void:
       NowPlaying.svelte:965  `url(${effectiveCover}), ${fallbackCover(player.current)}`
       NowPlaying.svelte:379  cellBg: `url(${u}), ${fallbackCover(tk)}`
     `background-size: cover` already applies to both layers. Uses the helper that is already imported.
     This turns "blank black block" into the normal placeholder — it does NOT make the chosen cover appear.

  2. STOP RANKING AN UNREACHABLE HOST FIRST (partial revert of a48dbdd; one function each, and the
     module header states that editing `resolveTrackChain` moves every consumer):
       - demote the YTM tier below iTunes/Deezer in `resolveTrackChain` + `resolveHqCover`
       - cap the YTM contribution in `collectCoverCandidates` so the grid keeps iTunes/Deezer/CN tiles
     Independent of reachability this tier is a bad tier-1 anyway: it returns the search-shelf
     thumbnail at 120x120, frequently a CHANNEL AVATAR rather than album art, and `resolveHqCover`
     (the "HQ upgrade") currently downgrades 500-1000px album art to it and writes it into the SHARED
     name cache layer.
     Counter-argument to weigh: YTM-first was an explicit user ranking request. If it must stay first,
     the covers have to be made loadable — i.e. route them through the edge (the Cloudflare worker is
     not behind the same filters), which is a feature, not a fix.

  3. LET THE SELF-HEAL ACTUALLY FIRE (only if the heal is expected to rescue this):
       - drop the `${uid}|${url}` entry from `healProbed` when `pinCover` writes that url — an explicit
         user pick is a legitimate reason to re-probe
       - give `probeCover` a timeout so a hanging host produces a verdict instead of never settling

verification: repro + fix verification pending a decision on which fix to take
files_changed: []

## Repro assets

Headless-Chrome CDP driver and screenshots (session scratchpad):
`/private/tmp/claude-501/-Users-laichan-code-tung-openmusic/4bc31252-0b30-4596-8937-6f2faa656c34/scratchpad/`
— `cdp.mjs` (driver), `t24.mjs` (blocked-host repro -> `t24-hero.png`, the black block),
`t25.mjs` (host recovered, same cover re-picked -> `t25-second-pick.png`, cover shows).
