# Phase 30 — Deferred Items

Out-of-scope discoveries logged during execution (scope-boundary rule). Not fixed in-phase.

## 30-03 — the Deezer ARTIST tier serves `picture_xl` (~200 KB), not a 500 px variant

**Found:** live curl during 30-03 Task 2 — `GET /api/og?type=artist&artist=Nirvana` streams
199,741 bytes, while the song/album cards stream 70–73 KB.

**Cause:** `reshapeDeezerSearch` (`src/lib/proxy/deezer-cover.ts:171`) builds `artistPicture` as
`picture_xl ?? picture_big` unconditionally — the `prefer: 'xl' | 'big'` selector added in 30-02
reaches `pickAlbumCover` only, never the artist picture. `/api/og` passes `'big'` but has no way to
influence the artist branch.

**Impact:** low. 200 KB is under the `CACHE_BYTES_CAP` and under the 332 KB figure Pitfall 6 warns
about; the artist card streams correctly today. It is simply ~3× larger than it needs to be on the
slowest crawler.

**Why deferred:** `src/lib/proxy/deezer-cover.ts` is outside 30-03's scope fence (30-02 owns it and
its extraction proof is a pinned harness). The fix is one line — thread `prefer` into the
`picture_*` order the same way `pickAlbumCover` does — plus one assertion in
`deezer-cover.test.ts`.

## 30-05 — carrier-free `/artist/{name}` resolves against the HYPHENATED name, not the decoded one

**Found:** while making `artist/[name]/+page.ts` the dual-shape handler (30-05 Task 1).

**Cause:** the loader now uses `decodePathSegment(params.name)` for the CARD (so `/artist/Post-Malone`
shows "Post Malone"), but `artist/[name]/+page.svelte:45` still uses the raw `params.name` as the
Last.fm / Deezer RESOLUTION key — i.e. it looks up `"Post-Malone"`. `entityCardUrl` has emitted the
hyphen form since 30-01, so every carrier-free artist share is affected.

**Impact:** unknown, probably low — upstream artist lookup may or may not be hyphen-insensitive
(`matchKey`'s punctuation-stripping norm, which RESEARCH §B.8 relies on, is a TRACK-matching path and
does not apply to the artist page's entity lookup).

**Why deferred:** this is 30-01's encoder interacting with the artist page's resolution key, not the
double-decode bug 30-05 owns. Switching the page to `decodePathSegment` would change resolution for
LEGACY links whose artist name genuinely contains a hyphen (`Jay-Z` → `Jay Z`), which is a
compatibility judgment CONTEXT does not settle for the resolution path (it only locks the loss for
the CARD). Needs a live probe of the upstream artist lookup first — a good 30-06 UAT item.
