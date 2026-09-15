---
phase: quick-260914-to2
plan: 01
subsystem: downloads / artwork / og
tags: [cover-cache, download-tags, media-session, api-og, cors]
requires:
  - src/lib/stores/cover-version.svelte.ts (readCoverByUidOrName)
  - src/lib/proxy/og-fallback.ts (OG_FALLBACK_BYTES / OG_FALLBACK_TYPE)
provides:
  - display-cover ladder in downloadTrack (hero -> shared cover cache -> r.cover)
  - x-og-fallback marker on the /api/og branded fallback, exposed cross-origin
  - fetchAsDataUrl null-guard on the marked fallback
affects:
  - every download (web + native APK) that embeds FrontCover art
  - OS media-session artwork on a total cover miss
tech-stack:
  added: []
  patterns:
    - TrackMenu share-ladder precedence reused verbatim at a third call site
    - additive response header as a machine discriminant on a never-non-200 endpoint
key-files:
  created: []
  modified:
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
    - src/routes/api/og/+server.ts
    - src/routes/api/og/og-endpoint.test.ts
    - src/lib/services/media-artwork.ts
    - src/lib/services/media-artwork.test.ts
decisions:
  - "The cover cache is queried with RAW catalog artist/title; dn* display names keep feeding the /api/og TEXT query (different consumer)."
  - "Only ogFallback() carries and exposes x-og-fallback — corsHeaders() in $lib/proxy/http.ts stays untouched, so no other response gains an Expose-Headers surface."
  - "The marker is additive only: body, status, content-type, Content-Length and Cache-Control are byte-identical for social crawlers."
metrics:
  duration: ~8 min
  completed: 2026-09-14
---

# Quick 260914-to2: Embed no cover when /api/og returns the brand card — Summary

Downloads now embed the cover the app actually displays (hero cover for the playing song, else the shared reactive cover cache, else the stub's `cover`), and a total cover miss embeds nothing instead of the branded openmusic share card — `/api/og` marks its fallback response with `x-og-fallback: 1` (exposed cross-origin for the APK) and `fetchAsDataUrl` treats that marker as "no cover".

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 | Display-cover ladder in `download-track.ts` | `8a8ed24` |
| 2 | `x-og-fallback` marker on the `/api/og` fallback | `f6d4d31` |
| 3 | `fetchAsDataUrl` null-guard on the marker | `0bf64b4` |

All three are TDD: tests written first, observed RED, then implemented to GREEN.

### Task 1 — `src/lib/services/download-track.ts`

`resolveArtworkDataUrl` was fed `r.cover` alone. A CN `Track.cover` is frequently null / non-https / CORS-dead, so the resolver's direct tier was skipped or failed and its `/api/og` tier answered with the branded card — while the app itself showed correct art (板斧 / Novel Flash). Replaced with TrackMenu's share ladder verbatim:

```ts
const displayCover =
	(player.current?.uid === r.uid ? player.resolvedCover : null) ??
	readCoverByUidOrName(r.uid, r.artist, r.title) ??
	r.cover ??
	null;
```

`player.current` / `player.resolvedCover` are READ-ONLY here — the D-18 DOWNLOAD ISOLATION test (throwing setters on `current` / `playGen`) still passes untouched, and the comment block says so explicitly so a future reader does not revert it. The cache lookup uses RAW `r.artist` / `r.title`; `dnArtist` / `dnTitle` still go to `resolveArtworkDataUrl` because they drive the `/api/og` TEXT query.

RED evidence: 5 new tests failed, 28 pre-existing passed. GREEN: 33/33.

New tests: cache beats a dead `r.cover`; cache used when `r.cover` is null; hero cover wins for the playing uid; hero cover ignored for a different uid; cache queried with RAW names while the resolver keeps the display names.

`$lib/stores/cover-version.svelte` is a runes store, so it is `vi.mock`ed in the node test (defaulting to `null`) — that is what keeps every pre-existing artwork assertion (`cover: 'https://cdn-images.dzcdn.net/c.jpg'`) passing through the ladder unchanged.

### Task 2 — `src/routes/api/og/+server.ts`

`ogFallback()` gains two headers after the `corsHeaders(origin)` spread: `x-og-fallback: 1` and `Access-Control-Expose-Headers: x-og-fallback`. All 6 call sites route through that one function. Nothing else changed — body, status, `content-type`, `Content-Length`, `Cache-Control` are byte-identical, and `withCors()` / `streamImage()` (real covers) are untouched, so a relayed cover and a bytes-layer cache hit stay unmarked.

RED evidence: 2 tests failed, 85 passed. GREEN: 87/87.

### Task 3 — `src/lib/services/media-artwork.ts`

One line inside the existing `try` (never-throws preserved), immediately after the `!res.ok` guard:

```ts
if (res.headers.get('x-og-fallback')) return null;
```

RED evidence: 2 tests failed, 13 passed. GREEN after the guard. The module header's `/api/og` paragraph now states that a total miss is a 200 carrying the marker, so the null return is not "fixed" away later.

## Verification gates (real output)

`pnpm test`:

```
 Test Files  125 passed (125)
      Tests  2380 passed (2380)
   Duration  9.13s
```

`pnpm check`:

```
1789443095020 START "/Users/laichan/code/tung/openmusic"
1789443095032 COMPLETED 4525 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

Both clean. No pre-existing failures to report.

Seam greps (observed):

```
src/lib/services/download-track.ts:33:import { readCoverByUidOrName } from '$lib/stores/cover-version.svelte';
src/lib/services/download-track.ts:178:  readCoverByUidOrName(r.uid, r.artist, r.title) ??
src/routes/api/og/+server.ts:109:   'x-og-fallback': '1',
src/routes/api/og/+server.ts:110:   'Access-Control-Expose-Headers': 'x-og-fallback'
src/lib/services/media-artwork.ts:92:  if (res.headers.get('x-og-fallback')) return null;
```

No file deletions in any of the three commits.

## Not verified here (needs a human / a running surface)

- **Live curl** `curl -sI 'http://localhost:4321/api/og?type=song' | grep -i x-og-fallback` — the optional live check in the plan was NOT run; no dev server was started. The behaviour is unit-proven against the real `GET` handler (`og-endpoint.test.ts` calls the route directly), not against a running edge.
- **On-device APK** — the cross-origin path (`https://localhost` → `https://openmusic.lol`) is covered by construction (`Access-Control-Expose-Headers`), not by an observed device run.
- **A real downloaded file's embedded art** — the seam is asserted at the `resolveArtworkDataUrl` / `tagAudioBlob` boundary, not by inspecting a saved file's ID3/MP4 atoms.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None. No new network surface, no new host, no new dependency. `Access-Control-Expose-Headers` carries only a boolean marker and only on the fallback response; ACAO is still gated by `isAllowedOrigin` (T-to2-01, accepted in the plan). `/api/og`'s text-only input contract is unchanged (T-24-08 / T-wv8-01).

## Self-Check: PASSED

- `src/lib/services/download-track.ts` — FOUND (ladder at L178, import at L33)
- `src/routes/api/og/+server.ts` — FOUND (marker at L109-110)
- `src/lib/services/media-artwork.ts` — FOUND (guard at L92)
- `8a8ed24`, `f6d4d31`, `0bf64b4` — all FOUND in `git log`
