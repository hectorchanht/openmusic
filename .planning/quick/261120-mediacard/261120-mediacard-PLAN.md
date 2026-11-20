# quick-261120-mediacard — resolving a media card is the same as resolving a song

Hector (2026-11-20, screenshots): shared song links in WhatsApp again show NO media card IMG —
notably https://openmusic.lol/song/茉ひる%2FBilly-Choi/ロストライン?u=netease3396263335
(sent 12:36 AM) and the BIGBANG/LOSER links from the day before.
His doctrine, verbatim in intent: "Resolving a media card is same as song" — the card must be
resolved through the app-side best source / best cover path: the original singer, the original
version, the true original album cover.

## Root cause (live-verified before this fix)

- Share links carried `?u={source}{songid}` — the exact song identity share-arrival.ts uses
  client-side for ONE direct detail resolve (38-D-08). But the song loader
  (src/routes/(app)/song/[artist]/[title]/+page.ts) echoed only `ci` into og:image via
  ogImageUrl(); `u` never reached /api/og.
- `ci` tokenizes only Deezer/Last.fm/kuwo/iTunes covers (coverToken in
  src/lib/services/share.ts). A netease/qq/joox-resolved song emits NO ci → og:image is
  text-only → og-cover.ts's tier chain (Last.fm→Deezer→iTunes→kuwo keyword searches) misses
  obscure songs → branded fallback after ~2.5–5 s → WhatsApp preview generation times out /
  shows no card.
- Live proof: the reported link's og:image has no u; /api/og for it returns x-og-fallback:1
  (48 KB branded JPEG) in ~2.9 s. Direct netease detail for id 3396263335 returns name
  ロストライン, artists 茉ひる + Billy Choi, album "Cinema", album picId 109951173434200505 —
  the true original album cover, resolvable in ONE call.

## Design history (two supersessions, same morning — the final spec is §Final)

1. FIRST DESIGN (superseded): carry `u` into og:image; /api/og resolves by uid through a new
   per-source detail resolver (resolveCoverByUid) in og-cover.ts. Implemented, then replaced.
2. CORRECTION 1 (Hector): "Media card resolver must reuse the same single resolver seam of
   the system. It has to be fixed at the same route." A bespoke per-source resolver is a
   SECOND resolver (GOLD one-path violation). The seam is share-arrival's:
   ensureTrackDetails(stub) → resolveStub(artist, title); the resolved Track.cover via the
   shared cover chain is the card cover.
3. CORRECTION 2 (Hector, BINDING): "URL should only show the important keywords — artist
   name, album name, song name. Then OpenMusic naturally resolves the best version from
   those keywords. No query, no parameters, no extras." Plus the standing GOLD cleanup rule:
   auto-remove stale code in the same change; reception for links already in the wild is
   live compat, kept and commented as such.

## Final spec (as built)

- SHARE URL CLEAN: songShareUrl emits ONLY `${origin}/song/{artist}/{title}`. The `?ci=`
  (quick-260809-3uo) and `?u=` (38-D-08) emissions are retired; decision refs stay as history
  in comments. coverToken + uidCarrier DELETED (no caller left).
- OG:IMAGE PATH FORM: ogImageUrl emits `${origin}/api/og/{type}/{artist}/{title}` (segments
  via encodePathSegment; artist form omits the title segment). Loaders build OG purely from
  path segments. New route src/routes/api/og/[type]/[artist]/[[title]]/+server.ts; BOTH
  spellings delegate to ONE handler core in $lib/proxy/og-handler.ts (verb-only shells).
  The legacy query form keeps working byte-identically (compat for already-sent links).
- SEAM RESOLUTION FROM KEYWORDS ONLY: the handler resolves a SONG card through
  resolveCoverViaSeam ($lib/proxy/og-cover) BEFORE the tier chain (demoted to fallback).
  Edge-viability finding: catalog/discovery/cover-backfill CANNOT be imported into the
  server route — every adapter fetch rides apiFetch, which returns RELATIVE /api/... URLs
  on the web build and workerd's fetch rejects relative URLs; the import graph also drags
  in runes stores + the localStorage cover cache, which the repo's SSR contract forbids in
  +server.ts. So the seam is DRIVEN through the existing proxy dispatch layer (qqProxy,
  buildKuwoSearchUrl/mapSearch, the netease adapter's Meting template, the /api/cover-pick
  endpoint) and selection uses the seam's own shared helpers (isCoverOf gate, COVER_ORDER,
  scoreMatch). Stages: crowd pick → tier-1 CN fan-out (netease/kuwo covers, qq rows) →
  qq detail hop for the gated qq winner. Joox excluded (search rows carry cover:null; its
  detail is positional). Seam hits write the keyword-keyed resolve cache; the seam runs
  after bytes cache + legacy ci carrier, before the resolve-cache read (a stale negative
  entry must not shadow it).
- RECEPTION COMPAT (kept, commented legacy-compat): share-arrival's `?u=` arrival resolve,
  the song loader's `u`/`ci` field echoes, coverUrlFromToken + the legacy query-form /api/og
  (incl. its `ci` path). The handler no longer reads `?u=` at all — old og:image URLs with
  `&u=` resolve by their keywords through the seam.
- DEAD CODE REMOVED (GOLD cleanup): TrackMenu's resolveShareCover prewarm + shareCover
  state, cover-backfill's resolveShareCover + session memo, itunes-cover's
  rememberItunesId/recallItunesId/itunesArtworkKey + cover-cache's `itunes:` id family,
  share.ts's coverToken/uidCarrier/usableToken, the first design's resolveCoverByUid +
  per-source detail templates + kuwo.ts's temporary fetchKuwoSonginfo export.
- Legacy song/[slug] loader deliberately untouched: it builds its og image via buildOg
  with an https-gated cover (no ogImageUrl, no /api/og URL) — outside this emission family.

## Tests

- share.test.ts: clean-URL pins (incl. the reported netease song), ogImageUrl path-form
  pins, coverUrlFromToken legacy-reception template pins, TrackMenu call-site guard updated.
- Loader tests (song/album/artist): path-form og:image; ci/u og:image non-echo pins; the
  loader `u`/`ci` FIELD echoes pinned as reception compat.
- og-endpoint.test.ts: seam unit describes (crowd-first, netease hit + redirector shape,
  qq detail hop, kuwo row, mismatch → null, detail mismatch → null, faults → null), seam
  route describes (hit streams with zero tier calls, miss falls through, resolve-cache
  write, stale &u= ignored, album skips the seam), path-form describes (same seam, spelling
  parity, artist no-title form, hyphen decode, type coercion). All pre-existing tier/ci/
  cache describes keep passing byte-exact (the stub classifies seam calls separately).
- cover-backfill / itunes-cover tests: deleted-function describes removed with the code.
- Full suite + `pnpm check` + production `pnpm build` (see SUMMARY for numbers).

DO NOT push, do NOT deploy (parent agent handles deploy + purge + live verify).
