# quick-261120-mediacard — SUMMARY

## What was wrong

Shared song links showed NO media card image in WhatsApp. Root cause (live-verified
2026-11-20): the song loader echoed only the `ci` cover-id carrier into og:image and
dropped `u`; `ci` tokenizes only Deezer/Last.fm/kuwo/iTunes covers, so netease/qq-sourced
songs emitted no carrier → `/api/og` re-resolved from bare text via its own tier chain
(Last.fm→Deezer→iTunes→kuwo, limit=1), missed obscure songs, and returned the branded
fallback after ~2.5–5 s → WhatsApp timed out / showed no card. The reported JP song
(茉ひる/Billy-Choi/ロストライン， netease 3396263335) returned `x-og-fallback: 1` live,
while one direct netease detail call yields the true original album cover (album
"Cinema", picId 109951173434200505).

## Hector's rulings implemented

1. **Resolving a media card ≡ resolving a song** — one resolver seam, fixed at the same
   route; no parallel resolver.
2. **Keyword-only URLs** — share URL is `/song/{artist}/{title}` only; no query, no
   parameters, no extras. OpenMusic resolves the best version from the keywords.
3. **GOLD dead-code rule** — stale/outdated code removed in the same change; reception
   handlers for links already in the wild kept only as clearly-commented legacy-compat.

## The seam reused

The system's single song-resolver seam is share-arrival's: `ensureTrackDetails(stub)`
(catalog.ts) → `resolveStub(artist, title)` (discovery.ts), with the resolved
`Track.cover` coming through the shared cover chain. That client graph cannot be imported
into a `+server.ts` route (every adapter fetch rides `apiFetch`, which returns relative
`/api/...` URLs on the web build and workerd's fetch rejects relative URLs; the graph
also drags in runes stores + the localStorage cover cache, forbidden by the repo's SSR
contract). So `/api/og` drives THE SAME seam through the existing server-side proxy
dispatch layer — `resolveCoverViaSeam` in `src/lib/proxy/og-cover.ts`:

- Stage 1: crowd pick (`/api/cover-pick`) — the cover chain's crowd layer.
- Stage 2: the seam's CN search fan-out replayed via the dispatch builders (netease
  Meting template, qqProxy, kuwo search builders) on the cover chain's folded search
  terms (`coverSearchTerms`).
- Identity gate: the seam's own `isCoverOf`-family predicate (`ogIdentityMatches`) +
  `scoreMatch` re-rank; selection in the cover chain's `COVER_ORDER`.
- Stage 3b: qq detail hop for the gated qq winner (album_pic), itself identity-gated.
- The old text tier chain is demoted to fallback-only, after the seam.

## Changes

- `songShareUrl` emits ONLY `${origin}/song/{artist}/{title}`. `coverToken` +
  `uidCarrier` DELETED from share.ts.
- `ogImageUrl` emits the PATH form `${origin}/api/og/{type}/{artist}/{title}` (artist
  form omits the title segment).
- New route `src/routes/api/og/[type]/[artist]/[[title]]/+server.ts`; BOTH spellings are
  verb-only shells delegating to ONE handler core, `src/lib/proxy/og-handler.ts`.
  Resolution order: bytes cache → legacy `ci` carrier (query form only) → THE SEAM →
  keyword-keyed resolve cache → tier chain (fallback) → branded card. The handler no
  longer reads `?u=` at all — old og:image URLs carrying it resolve by keywords.
- Song loader: og:image built purely from path segments (no carrier echo); `u`/`ci`
  field echoes kept as reception compat for the page's arrival resolve.
- `safe-image-url.ts`: QQ (`y.gtimg.cn`) + Netease (`.music.126.net`) allowlists for the
  seam's identity-path covers.

## Dead code removed (GOLD cleanup, same change)

- share.ts: `coverToken`, `uidCarrier`, `usableToken`.
- TrackMenu.svelte: `resolveShareCover` prewarm `$effect` + share-cover state.
- cover-backfill.ts: `resolveShareCover` + the session share-cover memo.
- itunes-cover.ts: `rememberItunesId` / `recallItunesId` / `itunesArtworkKey`.
- cover-cache.ts: the `itunes:` retained-id key family.
- og-cover.ts: the first (superseded) design's `resolveCoverByUid` + per-source detail
  templates; kuwo.ts's temporary `fetchKuwoSonginfo` export.
- Tests for the deleted functions removed with the code.

## Kept as legacy-compat (commented as such)

- Legacy query-form `/api/og` incl. its `ci` reception (`coverUrlFromToken`) — og:image
  URLs already rendered into pages and chats keep working byte-identically.
- share-arrival's `?u=` arrival resolve; the song loader's `u`/`ci` field echoes.

## Verification (this tree, 2026-11-20)

- Targeted: 317/317 passed (og-endpoint 112, share 80, song/album/artist loaders 46,
  cover-backfill 55, itunes-cover 24).
- Full suite: **278 files, 5720 tests, all passed**.
- `svelte-check`: **0 errors** (18 pre-existing warnings). One stale 2-arg
  `songShareUrl` call in share.test.ts was found by check and fixed to the keyword-only
  signature.
- Production `vite build`: green; both OG route spellings present in the server output.

## Notes for the reader

- Messages Hector sent BEFORE this fix (e.g. the 2026-11-19 02:42 BIGBANG links, sent
  before the 11-19 SSR fix) will never retroactively gain cards — WhatsApp does not
  re-scrape sent messages. Re-send the link after deploy to get the card.
