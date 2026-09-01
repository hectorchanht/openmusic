---
status: resolved
trigger: "Up-Next fell back to via:\"diverse\" for a mainstream track — every similar-song path went dry. Tapped 'Janice STFU (Explicit)' by Drake from Home top-hits on openmusic.lol; Up Next filled with 8 unrelated songs."
created: 2026-08-31
updated: 2026-08-31
---

# Up-Next degrades to the diverse grab-bag — kuwo upstream TLS cert expired

## Symptoms

- **Expected:** tapping a mainstream track fills Up Next with similar songs.
- **Actual:** Up Next filled with an unrelated grab-bag (江南/林俊傑, BIRDS OF A FEATHER/Billie
  Eilish, Rolling in the Deep/Adele, 葡萄成熟時/陳奕迅, Shape of You/Ed Sheeran, 如願/王菲,
  Training Season/Dua Lipa).
- **Log:** `upnext.source {"via":"diverse","count":8}` — the never-empty safety net
  (`buildDiversePicks`), reached only when `buildSimilarQueue` returns `[]`.
- **Environment:** deployed origin openmusic.lol (not dev). Playback itself worked
  (`resolve.ok` + `playing` on `qq:003qDcy34VXU0C`).

## Root cause

**The kuwo upstream's TLS certificate expired on 2026-04-14 — 4.5 months ago.**

```
host:      kw-api.cenguigui.cn        (src/lib/proxy/kuwo.ts:10, KUWO_BASE)
subject:   CN=*.cenguigui.cn
issuer:    C=US, O=Google Trust Services, CN=WR1
notBefore: Jan 14 12:37:33 2026 GMT
notAfter:  Apr 14 12:37:32 2026 GMT     ← expired; today is 2026-08-31
curl:      status=000  ssl_verify_result=10   (X509_V_ERR_CERT_HAS_EXPIRED)
```

Causal chain:

1. TLS handshake to `kw-api.cenguigui.cn` fails cert validation.
2. Cloudflare returns **526** for every `/api/kuwo/*` request
   (verified: `GET https://openmusic.lol/api/kuwo/search?name=Drake…` → `error code: 526`).
3. `kuwo.search()` throws contract-drift (`src/lib/sources/kuwo.ts:68`); catalog's
   `Promise.allSettled` records a per-source error and yields no kuwo rows.
4. `similar.ts` `onlyPrimarySource()` pins the two fallback paths to
   `getEnabledAdapters({})[0]` — which is **kuwo**, because `SOURCES` is declared
   kuwo-first in `src/lib/sources/registry.ts:29` (deliberate, D-08: "kuwo is FIRST
   because it is empirically 100% playable + cover-inline"). That premise is now false.
5. Therefore `buildSimilarQueue` paths 2 and 3 return empty **for every track**, not just
   this one — they are pinned to a source that cannot answer.
6. Path 1 (`track.getSimilar`) is legitimately dry for a track with no Last.fm scrobble
   data. Verified: `GET /api/lastfm/similar-tracks?artist=Drake&track=Janice STFU (Explicit)`
   → `{"tracks":[]}`. This is correct behaviour for a brand-new release.
7. All three paths empty → `buildSimilarQueue` returns `[]` → `regenerate()`'s never-empty
   net fires `buildDiversePicks(8)` → `via:"diverse"`.

**This is not a Drake bug.** Any seed whose Last.fm `track.getSimilar` is dry currently
degrades to the grab-bag, because both fallbacks route exclusively through a dead source.

## Evidence

- timestamp: 2026-08-31 — `/api/lastfm/similar-tracks?artist=Drake&track=Janice%20STFU%20(Explicit)&limit=20`
  → `{"tracks":[]}`. Path 1 genuinely dry (expected for a new release).
- timestamp: 2026-08-31 — `/api/similar?artist=Drake&limit=8` → `{"artists":["PARTYNEXTDOOR",
  "DJ Khaled","Future","Drake & Future","Tory Lanez","Bryson Tiller","Lil Baby","Travi$ Scott"]}`.
  **Path 2 DID get 8 usable artist names** — so it entered the `if (names.length)` branch and
  still produced nothing. This eliminated "Last.fm has no data for Drake".
- timestamp: 2026-08-31 — `/api/kuwo/search?name=<X>&page=1&limit=20` → `error code: 526`
  for Drake, PARTYNEXTDOOR, Future, Lil Baby. Every artist, not query-specific.
- timestamp: 2026-08-31 — same origin, other sources respond (qq → `参数错误`, netease →
  Meting HTML, deezer → valid JSON). Only kuwo returns a hard edge error. Isolates the
  failure to the kuwo upstream, not the proxy layer or the deployment.
- timestamp: 2026-08-31 — direct `openssl s_client` to `kw-api.cenguigui.cn:443` shows
  `notAfter=Apr 14 12:37:32 2026 GMT`; `curl` reports `ssl_verify_result=10`.
- `src/lib/proxy/kuwo.ts:10` — single hard-coded `KUWO_BASE`, no alternate host, no retry.

## Eliminated

- hypothesis: the `(Explicit)` title suffix breaks the Last.fm lookup.
  → Not the cause. Path 1 being dry is expected for a new release, and path 2 (artist-keyed,
  title-independent) succeeded at the Last.fm layer yet still produced nothing.
- hypothesis: `track.artist` is not the string `"Drake"` (joint credit / localized form).
  → Not the cause. `/api/similar?artist=Drake` returning 8 correct rap artists shows the
  artist string reaching the API is fine.
- hypothesis: the `keep` / `dedupeBest` post-filters discard otherwise-valid rows.
  → Not the cause. There were no rows to filter — the kuwo searches never returned any.
- hypothesis: deployment or proxy-layer regression.
  → Not the cause. Sibling source proxies on the same origin respond normally.

## Blast radius (wider than Up-Next)

`registry.ts:29` makes kuwo the resolve floor inherited by `fallbackOrder` (fallback.ts),
`resolveNameStub` / `crossSourceLyric` (catalog.ts), and `interleave`. Consistent with this
session's own earlier log: `resolve.midless {"source":"kuwo",…}` followed by
`fallback {"fromSource":"ytmusic","toSource":"qq"}` — the failover chain is absorbing a dead
primary on every name-stub resolve, so every such resolve pays a wasted 526 round trip first.

## Fix — APPLIED (commit 032b6c2)

The expired cert belongs to a third party and cannot be renewed by us, so the fix addresses
the fragility that turned one dead upstream into a dead feature. User chose "reorder +
resilience", then widened the resilience to all enabled adapters.

1. **`registry.ts` — kuwo off the primary seat.** Order is now qq → netease → kuwo → joox →
   fivesing → jamendo → audius → ytmusic. kuwo stays IN the registry, so restoring it is a
   one-literal move if the cert is renewed.
2. **`similar.ts` — `sourceLadder()` replaces the single-source pin.** Both fallback paths
   walk every enabled adapter, each rung still strictly single-source, short-circuiting on
   the first hit. Not a return of the deleted 56-call fan-out (that was concurrent,
   per-build and unconditional); these rungs are sequential and only reached after the
   cheaper paths are dry.
3. **`similar.ts` — NEW Deezer artist-radio path** between the Last.fm primary and the
   per-artist search fallback. ONE call returns a ready-made taste feed as {artist,title,image}
   pairs, mapped through the same `nameStub`, so entries stay lazy. Strictly cheaper AND
   better than spending one search per similar artist to surface only that artist's single
   most-popular song.
4. **`proxy/deezer-pick.ts` — shared `pickBestArtistId`** (exact-name group first, then
   `nb_fan`), used by `/api/deezer/related`, `/api/deezer/artist` and the new `/api/deezer/radio`.
   One fix at the point all three callers route through, rather than three copies.

### Verification

Local dev (Deezer reachable from the sandbox; the CN proxies are not):

| Endpoint | Before | After |
|---|---|---|
| `/api/deezer/radio?artist=Drake` | (did not exist) | 8 tracks: Metro Boomin, Bryson Tiller, J. Cole, Future… all with covers |
| `/api/deezer/related?artist=Drake` | `{"artists":[]}` | Future, Travis Scott, 21 Savage, Big Sean, Don Toliver, Young Thug, Metro Boomin, Gunna |
| `/api/deezer/artist?artist=Coldplay` | `{fans:91, albums:0}`, blank picture | `{fans:18367521, albums:123}`, real picture |

`pnpm test` 96 files / 1790 tests (+13 new); `pnpm check` 4384 files, 0 errors 0 warnings.

New tests: `deezer-pick.test.ts` (9 cases, built on the real measured Drake/Coldplay hit
lists) and 4 cases in `similar.test.ts` covering the radio path, its seed/exclude post-filter,
its cover seeding, and the ladder advancing past a dead first source.

Seven pre-existing tests asserted the kuwo-first order (registry enumeration, interleave,
stagger indices, resolve-floor head, crossSourceLyric head). All were order expectations, not
behaviour regressions; each was updated to the new floor with the reason recorded inline.

### Not verified

The full click → `upnext.source {"via":"radio"}` round trip needs a working CN resolve to get
a seed playing, which this sandbox blocks (only kuwo + Deezer are reachable here, and kuwo is
the dead upstream). Endpoint level and unit level are both covered; confirming the log line
itself needs the deployed origin.

### Follow-up worth tracking

kuwo remains dead. If the cert is not renewed it should eventually be removed rather than left
at #3, where every fallback ladder walk still pays it a 526 round trip.
