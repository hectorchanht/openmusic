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
