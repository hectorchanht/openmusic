---
phase: quick-260809-3uo
plan: 01
subsystem: share-card
tags: [share, og, cover, security, allowlist, token, itunes]
requires: [readCoverByUidOrName, player.resolvedCover, safeDeezerImageUrl, safeLastfmImageUrl, safeKuwoImageUrl, safeItunesImageUrl, upgradeArtwork]
provides: [coverToken, coverUrlFromToken, recallItunesId, itunesArtworkKey, getCachedItunesId, setCachedItunesId]
affects: [/api/og, songShareUrl, ogImageUrl, song/[artist]/[title] loader, TrackMenu doShare, itunes-cover, cover-cache]
tech-stack:
  added: []
  patterns:
    - closed-tag token -> fixed template (structural allow-list, not a probeable check)
    - both-directions round-trip test as the anti-drift mechanism
    - disjoint key family reusing an existing store (TTL/LRU/clear inherited)
    - mutation-verified source guards
key-files:
  created: []
  modified:
    - src/lib/proxy/og-cover.ts
    - src/routes/api/og/+server.ts
    - src/routes/api/og/og-endpoint.test.ts
    - src/lib/services/share.ts
    - src/lib/services/share.test.ts
    - src/lib/services/itunes-cover.ts
    - src/lib/services/itunes-cover.test.ts
    - src/lib/services/cover-cache.ts
    - src/routes/(app)/song/[artist]/[title]/+page.ts
    - src/routes/(app)/song/[artist]/[title]/loader.test.ts
    - src/lib/components/TrackMenu.svelte
decisions:
  - "iTunes IS covered (binding amendment overriding the plan) — by NUMERIC ID, never by path; the reported song's in-app cover is proven iTunes-sourced, so without it the reported case would not have been fixed"
  - "The iTunes id is retained in a disjoint `itunes:` key family inside the EXISTING cover cache, not a new store — it inherits the TTL, the LRU cap and the clear button"
  - "coverToken stays pure: the component recalls the iTunes id and passes it in (a store/storage never flows into a pure service)"
  - "coverUrlFromToken is async ONLY because of the `i` tag's one lookup; d/l/k never touch the network"
metrics:
  duration: 62 min
  completed: 2026-08-09
---

# Quick Task 260809-3uo: Share Card Reads the Client-Resolved Cover Summary

A share link now carries a short closed-grammar cover ID (`?ci=d|l|k|i:<id>`) and `/api/og` rebuilds
the image URL from a template it owns — so the messenger card shows the cover the app was showing,
in one subrequest, with zero resolve work.

## Which tier the reported song's cover comes from — ANSWERED, with evidence

**iTunes.** This is the load-bearing finding of the task, and it is why the plan's original
"iTunes NOT COVERED, deliberately" would have shipped without fixing the reported case.

Evidence chain, all live-probed 2026-08-09 from this sandbox:

| Step | Probe | Result |
|------|-------|--------|
| The catalog metadata for 你瞞我瞞 / 陳柏宇 | `kw-api.cenguigui.cn/?name=陳柏宇 你瞞我瞞&limit=3` | `rid 626298`, name `你瞒我瞒`, artist `陈柏宇` — **Simplified** |
| Client tier 1 (Deezer) on that raw metadata | `api.deezer.com/search?q=陈柏宇 你瞒我瞒` | `{"total":0}` — **MISS** |
| Client tier 2 (iTunes) on that raw metadata | `itunes.apple.com/search?term=陈柏宇 你瞒我瞒&entity=song` | **HIT** — top result `trackId 446760995`, `collectionId 446760418`, collection `五年新曲加精選`, `is1-ssl.mzstatic.com/.../886443102378.jpg/100x100bb.jpg` |
| Is that the reported art? | fetched + **viewed** the 600x600bb render | the sleeve literally reads **`Quin.Quen.nium.`** / 陳柏宇 JASON CHAN / 新曲.精選 — the exact "Quinquennium art" the report names |

`resolveTrackChain` (`src/lib/services/cover-backfill.ts:146`) runs Deezer → iTunes → CN on
`track.artist` / `track.title`, i.e. the RAW catalog metadata. Deezer misses on the Simplified form,
so the iTunes tier is what produced the hero cover. The counter-check confirms it: Deezer on the
**Traditional** form does hit — with `Close Up` / Jason Chan / `Lies Between Us`, a *different*
album. The observed art is Quinquennium, not Close Up, so the Deezer tier demonstrably did not win.

**Therefore this task fixes the reported case** — `i:446760418` is emitted, and the rebuilt
600x600bb URL was fetched live at 200 image/jpeg 54,671 B.

A secondary finding worth recording: the server chain also runs Deezer *before* iTunes, but on the
**t2s-converted** terms, and `api.deezer.com/search?q=陈柏宇 你瞒我瞒` returns `total: 0` — so the
server would fall through to its own iTunes tier for this song. That means the blank card is most
plausibly a **budget** failure, not a coverage one: the CJK path is the ~4.1 s query class measured
in quick-260807-vl1, and `OG_RESOLVE_MS` is 5000 across four tiers plus a dictionary load. The
carrier removes that risk entirely — the `ci` path costs one subrequest (two for `i`) and never
enters the chain. This is stated as a hypothesis, **not verified**: reproducing the live card needs a
deploy (`LASTFM_KEY` is edge-only and `edgeCache()` is null under `vite dev`).

## Tier coverage

| Tag | Tier | Variable part | Rebuilt template (every other character is a literal in `og-cover.ts`) |
|-----|------|---------------|------------------------------------|
| `d` | Deezer album cover | `^[0-9a-f]{32}$` | `https://cdn-images.dzcdn.net/images/cover/<hash>/500x500-000000-80-0-0.jpg` |
| `l` | Last.fm | `^[0-9a-f]{32}\.(jpg\|png)$` | `https://lastfm.freetls.fastly.net/i/u/300x300/<hash>.<ext>` |
| `k` | kuwo album cover | `^[a-z0-9]{1,8}-[0-9]{1,4}-[0-9]{4,12}$` | `https://img4.kuwo.cn/star/albumcover/600/<d1>/<d2>/<id>.jpg` |
| `i` | iTunes | `^[0-9]{1,12}$` | `itunes.apple.com/lookup?id=<id>` → `artworkUrl100` → `600x600bb` |

**Not covered, by construction:** netease / qq / joox cover hosts. They are on no existing per-tier
allow-list, so carrying one would WIDEN the set of hosts `/api/og` fetches. The carrier may change
WHICH allow-listed host is picked, never the SET (T-3uo-02). Deezer `/images/artist/` and kuwo
`/star/starheads/` are likewise out of grammar. Album/artist entity links stay out of scope (D4).

## LIVE PROBE GATE: PASSED — every template, and the full chain end-to-end

Each template was rebuilt and fetched. The last run went through the **real code path**
(`coverToken(realUrl, id)` → `coverUrlFromToken(token)` → `fetch(HEAD)`), not a hand-typed URL:

```
d:fe1082c5ef54876802146897e76b592e
  -> https://cdn-images.dzcdn.net/images/cover/fe1082c5ef54876802146897e76b592e/500x500-000000-80-0-0.jpg
  -> 200 image/jpeg 72650 B
l:95f31bcdc1e942d3c24daa08dbf0e654.png
  -> https://lastfm.freetls.fastly.net/i/u/300x300/95f31bcdc1e942d3c24daa08dbf0e654.png
  -> 200 image/png 112810 B
k:s4s27-11-1502064321
  -> https://img4.kuwo.cn/star/albumcover/600/s4s27/11/1502064321.jpg
  -> 200 image/jpeg 97759 B
i:446760418
  -> https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/44/ab/f4/44abf48c-.../886443102378.jpg/600x600bb.jpg
  -> 200 image/jpeg 54671 B
SHARE: /song/陳柏宇/你瞞我瞞?ci=i%3A446760418
```

Supporting probes that shaped the templates rather than merely confirming them:

- **Last.fm card size is 300x300 on purpose.** Same hash at 500x500 = 274,823 B and 600x600 =
  342,273 B — both past the WhatsApp budget Pitfall 6 records. 300x300 = 112,810 B.
- **The Last.fm extension really is load-bearing.** `.jpg` on that hash serves a *different*,
  visibly worse asset (16,716 B vs 112,810 B), so the closed two-value ext set is not cosmetic.
- **Pinning `img4.kuwo.cn` as a literal is safe.** `img1.kuwo.cn` served the identical 97,759 B for
  the same path, so the host is interchangeable and the literal loses nothing.
- **Both iTunes ids resolve to the same artwork.** `lookup?id=446760418` (collection) and
  `lookup?id=446760995` (track) both return the same `artworkUrl100`; collection is preferred.

Nothing was reported as verified without being run. No probe was blocked — netease/qq were never
needed (they are out of grammar by construction).

## What shipped

### Task 1 — closed-tag token → fixed template → existing allow-list → fetch (`18a46aa`)

`coverUrlFromToken(token)` in `src/lib/proxy/og-cover.ts`. Order: reject falsy → reject over the
64-char cap (**rejected whole, never truncated**) → split ONCE on the first `:` → closed tag lookup
→ anchored per-tag pattern → fixed template → **re-assert through that tier's OWN existing
`safe*ImageUrl`**. That last step is redundant by construction and kept on purpose: it is the
assertion that the token path and the tier path can never drift, and it inherits the Last.fm
grey-star reject for free. Never throws; async only because of `i`.

`/api/og` reads `ci` beside the other params, keeps the `!artist && !title` short-circuit ahead of
any token work, and uses the carrier **after** the bytes layer and **instead of** the resolve layer.
`ownOriginCacheKey(url)` stays the only key builder and already includes `ci`, so each token variant
is its own bytes entry and shares nothing (D2). A token whose image fetch fails lands on the branded
card via the existing `streamImage` path, never a second chain — the arithmetic (2500 + 5000 + 2500
≈ 10 s vs the 3–10 s crawler budget) is in the code comment (D1).

### Task 2 — client tokenizer + the carrier through the link (`3f8a662`)

`coverToken(url, itunesId?)` in `share.ts`: pure, `new URL()` in a try/catch, one anchored path
regex per tier, size accepted-then-discarded, grey star rejected. `songShareUrl` and `ogImageUrl`
take optional carriers and are byte-identical without them (`names.test.ts` needed no edit). The
song loader echoes `ci` opaquely and stays synchronous + fetch-free.

**The iTunes id retention** (the amendment's real cost, traced not assumed):
`src/lib/services/itunes-cover.ts:103` read only `artworkUrl100` off the search response and
discarded the ids beside it, so the client could not emit `i:<id>`. The mzstatic path is no help —
its trailing number (`886443102378`) is the release UPC, not an Apple id. The smallest retention:

- `itunesArtworkKey(url)` — the size-independent identity of an mzstatic URL (drop the trailing
  `/<size>.<ext>`), so `100x100bb` / `600x600bb` / `1200x1200bb` all key to one entry.
- `getCachedItunesId` / `setCachedItunesId` in `cover-cache.ts` — a **disjoint `itunes:` key
  family in the EXISTING flat record**, so it inherits the 14-day TTL, the 2000-entry LRU cap and
  the Data-tab clear button rather than adding a second store. `writeKey`/`readKey` are
  value-agnostic, so this is ~15 lines.
- `rememberItunesId` fires at the single point both values are in hand (`fetchTopArtwork`);
  `recallItunesId` is the single read, called by the component.

Cost came out comparable to the other three tags, not "more than all three combined", so the tier
was implemented rather than escalated.

**Degrades cleanly, and it is tested:** a cover cached before this change (or after its entry
expires) has no retained id → `coverToken` returns null on the iTunes URL → no carrier → today's
tier chain. Covered by `recallItunesId is null for an unseen cover` and
`emits i:<digits> ONLY when the caller supplies the retained iTunes id`.

### Task 3 — share the cover the user is looking at (`48a479e`)

`doShare()` resolves the cover ONCE: `player.resolvedCover` when `player.current?.uid === track.uid`
→ `readCoverByUidOrName(track.uid, track.artist, track.title)` → `track.cover` → nothing. The cache
lookup uses the **RAW** catalog names, not `dArtist`/`dTitle` — the name layer is matchKey'd on
catalog metadata, so display strings would miss the cache for exactly the users quick-260808-urx's
conversion exists for. The `nav.share` / `shareIncludeTitle` block is untouched.

## Security posture (T-3uo register)

Every `mitigate` disposition was implemented and tested.

- **T-3uo-01 (SSRF).** Attacker input is an ID, never a URL. Scheme, host and path shape are
  literals in `og-cover.ts`, so the allow-list is **structural** — there is no host string in the
  request to smuggle into, no parser to bypass, no `@` / `\` / unicode-host trick to try. `/` and `.`
  cannot appear where a path segment could be forged, so traversal is *ungrammatical*, not filtered.
  Tested: `../../etc/passwd`, `ab/cd`, `%2e%2e%2f…`, `a-1-1/../x`, `…?x=1`, `…#f`,
  `…@evil.example`, `…\evil`, `446760418/../9`, `44676041 8` — all null.
- **T-3uo-02 (allow-list widening).** Closed tag set over hosts existing tiers already fetch.
  netease / qq / joox / a `.dzcdn.net.evil.example` look-alike are all inexpressible; tested both
  directions (client tokenizer *and* server rebuilder).
- **T-3uo-03 (cache poisoning).** Asserted the carrier path touches no key containing `_resolve`, on
  **both** `cache.match` and `cache.put`, and that two requests differing only in `ci` get distinct
  bytes keys. Mutation-verified.
- **T-3uo-04 (DoS).** 64-char cap, rejected not truncated; a test pins that the longest legal token
  (38 chars) is inside the cap, so the cap can never reject a real token. `IMAGE_MS`,
  `CACHE_BYTES_CAP` unchanged. `i` gets a 900 ms `TIER_MS`-style budget with `retries=0`.
- **T-3uo-05 (content injection).** Untouched: the token path enters the identical `streamImage`
  (`normalizeImageType` allow-list, fresh header object, size-capped clone). Tested that
  `text/html`, non-ok and a thrown fetch all yield the branded 200.
- **T-3uo-06 (XSS via meta).** Loader echoes an opaque capped token, `encodeURIComponent`'d into an
  own-origin URL; asserted synchronous and fetch-free.
- **T-3uo-07 (regression).** Six invalid tokens each produce a tier call sequence **deep-equal** to
  the no-carrier baseline, and no fragment of the rejected token appears in any outbound URL.
- **T-3uo-08 (drift).** The both-directions round-trip test imports `coverToken` AND
  `coverUrlFromToken` and asserts every client-emitted token is server-accepted.
- **T-3uo-SC.** No package installs.

## Comment amendments (amended, never deleted)

No decision ref was removed. Four headers now record why the carrier came back and what makes it
safe, tagged `quick-260809-3uo`, each sitting directly under the claim it corrects:

| File | Stale claim | Amendment |
|------|-------------|-----------|
| `src/routes/api/og/+server.ts` | "no URL parameter is accepted at all — input is TEXT (T-24-08…)" | one optional `ci` is accepted and it is NOT a URL; the sentence stays *true* — there is still no URL to smuggle a host into, which is the property T-24-08 protected; names the 你瞞我瞞 case |
| `src/lib/proxy/og-cover.ts` | "a share link now carries NO cover (`?c=` is gone — the whole point of phase 30)" | same, plus the full posture paragraph on `coverUrlFromToken` |
| `src/lib/services/share.ts` (`songShareUrl`) | "the cover no longer rides a `?c=` carrier"; "`cover` has left this signature entirely" | a carrier is back for the song surface as a short cover ID; OPTIONAL and ADVISORY; `dn`/`da` stay dead, not a reopening of OG-ZH-01 |
| `src/routes/(app)/song/[artist]/[title]/+page.ts` | the T-24-08 / SSRF paragraph | the loader echoes an opaque `ci`, still no fetch, still synchronous; the real gate is `coverUrlFromToken` |

## Test quality — every structural assertion mutation-verified

Task 1 and 2 were TDD (RED observed before implementation: 17 and 19 failures respectively). On top
of that, each non-behavioural or template assertion was proven falsifiable by making the edit that
should turn it RED, observing RED, reverting, observing GREEN:

| Mutation applied | Result |
|------------------|--------|
| kuwo host literal `img4` → `img3` | 2 failed / 85 passed |
| Deezer size segment `500x500` → `1000x1000` | 3 failed / 84 passed |
| `DEEZER_HASH_RE` anchors dropped (`/^…$/` → `/…/`) | 3 failed / 84 passed |
| carrier path made to write the resolve layer | 1 failed (the T-3uo-03 anti-poisoning test, by name) |
| `readCoverByUidOrName(track.uid, dArtist, dTitle)` | 2 failed / 81 passed |
| second `songShareUrl` argument dropped | 1 failed / 82 passed |
| uid identity guard dropped from the hero-cover branch | 1 failed / 82 passed |
| revert | 83 / 87 passed, green |

## Verification performed

All commands were RUN and the output observed:

| Check | Result |
|-------|--------|
| `pnpm check` | 4369 files, **0 errors**, 0 warnings |
| `pnpm test` | 90 files, **1616 tests, all pass** (was 1561) |
| `pnpm test src/routes/api/og/og-endpoint.test.ts` | 87 pass (was 67) |
| `pnpm test src/lib/services/share.test.ts` | 83 pass |
| `pnpm test …/loader.test.ts` + `names.test.ts` | pass, **neither needed editing** |
| Live probe gate, all four tiers, through the real code path | 200 + `image/*`, sizes above |
| Manual sanity | `/song/陳柏宇/你瞞我瞞?ci=i%3A446760418` — raw CJK path, one query param |

## Test coverage added

- **`og-endpoint.test.ts`** +20: the closed tag set, the anchored patterns (length / case / partial
  match / merely-contains), the traversal-and-smuggling battery, the over-cap reject, the `i`
  lookup (URL exactness, fault → null, non-mzstatic artwork rejected), and eleven route-level cases
  covering zero-resolve short-circuit, per-tag template exactness, resolve-layer isolation, distinct
  bytes keys, bytes-hit reuse, D1 fetch-failure, the invalid-token baseline equality, and the
  empty-card short-circuit winning over a carrier.
- **`share.test.ts`** +23: `coverToken` per tier and per rejection class (artist picture, starheads,
  grey star, non-allow-listed hosts, look-alike hosts, non-https / relative / garbage / null), the
  iTunes id negative battery, the three-test both-directions round-trip, the carrier composition on
  `songShareUrl` / `ogImageUrl`, and four mutation-verified TrackMenu source guards.
- **`itunes-cover.test.ts`** +7: size-independent artwork key, id retention preferring
  `collectionId`, `trackId` fallback, non-numeric id retains nothing, unseen-cover null (the
  pre-change degrade path), and no-throw when storage is unavailable.
- **`loader.test.ts`** +3: verbatim echo, the three no-carrier equivalences, synchronous/fetch-free.

## Deviations from Plan

### Binding amendment implemented (not a deviation — recorded for traceability)

**iTunes is covered, by numeric id.** The plan listed iTunes as "NOT COVERED, deliberately". The
amendment overrode that and the probe evidence vindicates it: the reported song's in-app cover is
iTunes-sourced, so the original plan would have shipped a fix that did not fix the reported case.
The plan's two objections were honoured, not overruled — both were objections to carrying the
*path*, and the path is not carried. `i:<digits>` is the shortest of the four tokens and its
structural property is the strongest.

### Auto-fixed issues

**1. [Rule 3 - Blocking] `coverUrlFromToken` had to become async**

- **Found during:** Task 1, designing the `i` tag.
- **Issue:** The plan's signature is `coverUrlFromToken(token): string | null`. The `i` tag resolves
  by lookup, not by template, so it cannot be synchronous.
- **Fix:** ONE async entry point that parses the tag once — `d`/`l`/`k` return without ever touching
  the network, `i` awaits its single lookup. Splitting into a sync + an async function was rejected:
  it would put the closed tag set in two places, which is precisely the drift the round-trip test
  exists to prevent.
- **Files modified:** `src/lib/proxy/og-cover.ts`, `src/routes/api/og/+server.ts`
- **Commit:** `18a46aa`

**2. [Rule 2 - Missing critical] `coverToken` needed a look-alike-host battery the plan did not list**

- **Found during:** Task 2.
- **Issue:** The client tokenizer matches hosts by suffix. The plan's negative list covered
  netease/qq/joox but not `cdn-images.dzcdn.net.evil.example` or
  `evil.example/cdn-images.dzcdn.net/…` — the classic suffix/substring confusions.
- **Fix:** Parse with `new URL()` and check `u.hostname`, never the raw string; added four
  look-alike cases. (The server side was already immune — its host is a literal.)
- **Commit:** `3f8a662`

**3. [Rule 3 - Blocking] The plan's third TrackMenu guard was the weaker half of a pair**

- **Found during:** Task 3.
- **Issue:** The plan specified three assertions, of which #3 was purely negative
  (`not.toMatch(readCoverByUidOrName\(track\.uid, dArtist)`). A negative-only guard passes on a file
  where the call was deleted outright.
- **Fix:** Kept it, extended it to the `dTitle` ordering too, and added a fourth positive guard on
  the uid identity check (`player.current?.uid === track.uid ? player.resolvedCover : null`) — whose
  loss would stamp the now-playing art onto a share of some other row. All four mutation-verified.
- **Commit:** `48a479e`

### Assumption Drift (advisory)

**The plan assumed the server chain already reproduced an iTunes-sourced client cover on its own**
("the server runs the SAME iTunes text search the client ran"), which is why it excluded the tier.
Probed: the two searches are *not* the same. The client queries the raw catalog metadata; the server
queries the **t2s-converted** terms and runs Deezer first. For this song both happen to reach the
same iTunes result, but only because Deezer misses on the Simplified form — which is luck, not
structure. The general statement "an iTunes-sourced client cover is the case the server chain most
likely already reproduces" is not safe to rely on. Advisory, non-blocking; recorded because it
constrains reasoning about any future tier's coverage claim.

**The blank card is more likely a budget failure than a coverage failure.** The plan framed the bug
as the server chain lacking the client's tier. The probes suggest the server chain *would* find the
cover but has to spend four tiers plus a dictionary load inside `OG_RESOLVE_MS = 5000` on the ~4.1 s
CJK query class. The carrier fixes both framings, so nothing changed in the implementation.

## Deferred / not verified

1. **The messenger card itself.** Requires a DEPLOY: `edgeCache()` returns null under `vite dev` and
   `LASTFM_KEY` lives only in Cloudflare (pre-existing Pitfall 8). Both `/api/og` cache layers stay
   unit-provable only. After deploy: share 你瞞我瞞 / 陳柏宇 from the app and confirm the WhatsApp
   card shows the Quinquennium sleeve.
2. **On-device share sheet.** That the emitted link reaches the recipient with the carrier intact
   rides `ShareData.text` (quick-260808-vkd), which is unchanged, but was not re-checked on a device.
3. **The blank-card root cause** is stated as a hypothesis (budget, not coverage) and is NOT claimed
   as verified — it needs the deployed origin to confirm.

## Self-Check: PASSED

- `src/lib/proxy/og-cover.ts` contains `coverUrlFromToken` — FOUND
- `src/lib/services/share.ts` contains `coverToken` — FOUND
- `src/routes/api/og/+server.ts` contains `coverUrlFromToken` — FOUND
- `src/lib/components/TrackMenu.svelte` contains `readCoverByUidOrName(track.uid, track.artist, track.title)` — FOUND
- `src/lib/services/itunes-cover.ts` contains `recallItunesId` — FOUND
- Commits `18a46aa`, `3f8a662`, `48a479e` — all FOUND in `git log`
