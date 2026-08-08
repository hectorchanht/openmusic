---
title: /api/og artist tier streams Deezer picture_xl (~200 KB) — the `prefer` selector never reaches the artist branch
date: 2026-08-07
priority: low
source: .planning/phases/30-carrier-free-share-links-type-artist-title-api-og/deferred-items.md (30-03)
---

# The `/api/og` ARTIST tier is ~3× larger than it needs to be

**Observed live** (30-03 Task 2, re-confirmed in the 30-06 phase gate against `pnpm dev`):

| Request | Bytes |
|---|---|
| `GET /api/og?type=song&artist=Nirvana&title=Come+As+You+Are` | 72,650 |
| `GET /api/og?type=album&artist=Nirvana&title=Nevermind` | 70,313 |
| `GET /api/og?type=artist&artist=Nirvana` | **199,741** |

## Cause

`reshapeDeezerSearch` ([`src/lib/proxy/deezer-cover.ts`](../../../src/lib/proxy/deezer-cover.ts),
~line 171) builds `artistPicture` as `picture_xl ?? picture_big` **unconditionally**. The
`prefer: 'xl' | 'big'` selector added in 30-02 is threaded into `pickAlbumCover` only — it never
reaches the artist-picture branch. `/api/og` passes `'big'` and it is silently ignored for
`type=artist`.

## Impact: low

199 KB is under `CACHE_BYTES_CAP` and under the 332 KB figure RESEARCH Pitfall 6 warns about, so the
artist card streams correctly today. It is simply ~3× more bytes than needed on the slowest crawler,
and RESEARCH §C.13 measured Deezer `picture_big`/`cover_big` at ~73 KB vs `_xl` at ~208 KB.

## Fix — one line + one assertion

Thread `prefer` into the `picture_*` order exactly the way `pickAlbumCover` already does, then assert
in `src/lib/proxy/deezer-cover.test.ts` that `prefer: 'big'` yields `picture_big` for an artist hit.

**Why it was deferred:** `deezer-cover.ts` is 30-02's file and sits outside 30-03's scope fence; its
extraction proof is the pinned, must-not-be-edited harness
`src/routes/api/deezer/search/deezer-endpoint.test.ts` (OG-EP-03). The one-line fix was deferred
rather than smuggled across a scope boundary. Verify that harness still passes **unmodified** after
the change — the artist branch feeds `/api/deezer/search` too, so confirm the client tile behavior is
unaffected (the client wants the large picture; only `/api/og` wants the small one, which is exactly
what `prefer` is for).
