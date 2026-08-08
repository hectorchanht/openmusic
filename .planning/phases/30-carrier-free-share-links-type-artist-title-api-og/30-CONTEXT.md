# Phase 30: Carrier-Free Share Links (`/{type}/{artist}/{title}` + `/api/og`) - Context

**Gathered:** 2026-08-07
**Status:** Ready for planning
**Source:** Synthesized from `/gsd:explore` session (`.planning/notes/share-link-cover-carrier-tradeoff.md`, commit `d52ec0e`)

<domain>
## Phase Boundary

**Delivers:** A shared link with **zero query carriers** on every share surface, while the OG card
still shows real album art.

```
/song/Nirvana/Come-As-You-Are      ← was /song/come-as-you-are-nirvana?n=&a=&c=  (~172 chars)
/album/Nirvana/Nevermind           ← was /album/{name}?artist=&c=&dn=&da=
/artist/Nirvana                    ← was /artist/{name}?c=&dn=
```

Two independent halves, both required:

1. **Identity moves into path segments.** Two segments per entity, so `/` is the separator and the
   authoritative title+artist ride the path instead of `?n=`/`?a=`/`?artist=`.
2. **Cover moves into a new own-origin `/api/og` image endpoint.** It resolves the cover
   server-side through our existing allowlisted proxy chain and streams the bytes, so `og:image`
   becomes `${SITE}/api/og?type=…&artist=…&title=…` — long, but invisible inside a meta tag.

**Out of scope:** the `?play=` base64 queue-restore token and `shareUrl()`/`entityShareUrl()`
(the "share current queue" path) — untouched. Charts routes — untouched. Any change to how tracks
resolve or play beyond re-keying off decoded path segments.

**Why now:** 64% of a shared song link is the URL-encoded `?c=` cover carrier. `buildOg` may only
emit `og:image` from query params because threat T-24-08 forbids an arbitrary server-side fetch
from a share link — so the cover had nowhere to live except the URL itself.
</domain>

<decisions>
## Implementation Decisions

### Path shape (LOCKED)

- **Two path segments, artist first:** `/song/{artist}/{title}`, `/album/{artist}/{name}`.
  `/artist/{name}` stays one segment (an artist page has no secondary name).
- **Raw text, NOT `slugify` output.** The path carries the authoritative title/artist. This is the
  reversal that unlocked the phase: `slugify` ASCII-strips, but a **path segment is not
  ASCII-limited** — `/song/周杰倫/稻香` is a valid URL, percent-encoded on the wire and rendered
  decoded by browsers and messenger link previews. CJK needs no special handling.
- **Original case PRESERVED** — `/song/Nirvana/Come-As-You-Are`, not `come-as-you-are`. Rationale:
  the OG card title is read straight from the path, so lowercasing forces a title-case
  reconstruction that renders `DNA` as `Dna` and `iPhone` as `Iphone`. Explicitly chosen over the
  prettier all-lowercase form.
- **Spaces encode as `-`.** Known lossy edge, accepted: a title containing a literal hyphen decodes
  with a space (`Spider-Man` → `Spider Man`). `playStub`'s fuzzy `scoreMatch` absorbs it; the card
  reads `Spider Man`. **Rejected:** `+`-for-space (Last.fm style, fully lossless) — uglier for a
  marginal gain.
- Both new routes are per-route `ssr = true` / `prerender = false` opt-ins, exactly like the current
  entity routes.

### `/api/og` cover endpoint (LOCKED)

- `GET /api/og?type=song|album|artist&artist=&title=`.
- **Tiered, bounded resolve chain:** Deezer → iTunes → **kuwo only** → stream `/og.svg`.
- **kuwo only, NOT `searchAll` fan-out.** Per `spike-findings-openmusic` (kuwo-first resolution).
  This caps the route at ≤3 subrequests so a cold crawl stays inside every crawler's fetch budget —
  a full fan-out at the edge would risk the very timeout the endpoint exists to avoid.
- **Stream, do NOT 302.** `new Response(upstream.body, { headers })` — pass-through streaming is
  ≈0 CPU on Workers (the body is never buffered) and sidesteps per-crawler redirect-follow variance
  (WhatsApp and iMessage are the fussy ones). A plain `200 image/jpeg` is universally accepted.
- Per-tier `AbortSignal.timeout` under **one overall ~2.5s deadline**. A miss or timeout falls
  through to the branded `/og.svg`. The route **never** 500s and never exceeds the crawl budget.
- **Two `caches.default` layers**, both keyed own-origin via `ownOriginCacheKey()`: the
  `artist+title → coverUrl` resolve, and the image bytes
  (`Cache-Control: public, max-age=86400, immutable`).

### Shared code extraction (LOCKED)

- The Deezer cover upstream call moves out of `api/deezer/search/+server.ts` into
  `$lib/proxy/deezer-cover.ts` so `/api/og` and `/api/deezer/search` share one implementation.
  **Required, not cosmetic:** a `+server.ts` cannot export non-verb helpers — it 500s at request
  time and unit tests miss it (they import the module directly).
- `safeImageUrl` extends to `*.mzstatic.com` (iTunes) + the kuwo cover host, applied per tier.

### Backward compatibility (LOCKED)

- The old routes stay as **legacy handlers**: `/song/[slug]?n=&a=&c=` plus the query-carrier
  album/artist forms keep resolving *and* keep their card (legacy `c` still https-gated exactly as
  today). Path depth differs, so `/song/[slug]` and `/song/[artist]/[title]` coexist with no
  route-matching conflict.
- Tests must assert both the new carrier-free path and every legacy query shape.

### OPEN — decide during planning, do NOT default to yes

- **OG-ZH-01: retire `dn`/`da` by converting zhs→zht server-side?** `dn`/`da` exist only because the
  Traditional display name had no server-side equivalent. But `$lib/services/zh-convert.ts` is pure
  `.ts` (no browser globals, node-testable) and `tongwen-core` / `tongwen-dict` are real runtime
  `dependencies`, so the SSR loader *can* convert. **Cost:** the ~72KB s2t dict dynamic-imports into
  the edge SSR path — fine against the 3MB compressed Worker limit, but real per-request weight on a
  cold isolate. This is the only part of the phase that adds edge cost. Weigh it explicitly; if the
  answer is no, `dn`/`da` survive as the sole remaining carriers and that is an acceptable outcome.

### Claude's Discretion

- Route file layout for the two-segment routes (nested `[artist]/[title]` dirs vs a rest param),
  and how much of the existing `[slug]` loader is shared vs duplicated for the legacy handler.
- Encode/decode helper placement in `$lib/services/share.ts` and its exact signature.
- Tier ordering internals, timeout values per tier under the 2.5s ceiling, and how the resolve-layer
  cache key is composed.
- Test file organization (extend `share.test.ts` vs add a sibling for the endpoint).
- Whether OG-PAGE-01's `<img>` gets a loading/error fallback to the gradient.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The exploration decision record
- `.planning/notes/share-link-cover-carrier-tradeoff.md` — full option comparison, the
  path-segment reversal, rejected alternatives (md5-only carrier, KV short links), budget/posture
  notes. This is the authority for *why* each decision above was made.

### Share URL construction + OG building (the code being changed)
- `src/lib/services/share.ts` — `songShareUrl` (line ~180), `entityCardUrl` (line ~205),
  `buildOg` (line ~291), `isHttpsUrl` (line ~307), `slugify`. Also holds the untouched
  `shareUrl`/`entityShareUrl`/`encodeShare` queue-token path.
- `src/lib/services/share.test.ts` — existing assertions on the current URL shapes; must be updated.

### The SSR share surfaces
- `src/routes/(app)/song/[slug]/+page.ts` — the reference per-route SSR opt-in. Documents D-01/D-03
  (universal load, `ssr = true`, **never** a `+page.server.ts` — that breaks the `adapter-static`
  native build, Pitfall 5 / T-24-09), DQ-1/DQ-2 carrier semantics, T-24-08 SSRF constraint,
  `titleFromSlug`.
- `src/routes/(app)/song/[slug]/+page.svelte` — SSR-safety-by-construction pattern (lazy store
  imports under `browser`), `resolveAndPlay` → `player.playStub`, and the `cover--placeholder`
  gradient that OG-PAGE-01 replaces.
- `src/routes/(app)/album/[name]/+page.ts` — `?artist=` resolution key + `c`/`dn`/`da` carriers.
- `src/routes/(app)/artist/[name]/+page.ts` — `c`/`dn` carriers.
- `src/lib/components/PageOg.svelte` — emits `og:*`/`twitter:*`; hardcodes
  `SITE = "https://openmusic.lol"` and `og:type = music.song` for every route (both fixed here per
  OG-PAGE-01).

### Edge proxy patterns to mirror
- `src/routes/api/deezer/search/+server.ts` — the posture to copy verbatim: own-origin CORS,
  OPTIONS 204 preflight, `caches.default` keyed on the own-origin Request, `fetchWithRetry` +
  `AbortSignal.timeout`, `safeImageUrl` host allowlist (line ~74). Its upstream call is what
  OG-EP-03 extracts.
- `src/lib/proxy/edge-cache.ts` — `edgeCache()` (the single `typeof caches` guard in the repo) and
  `ownOriginCacheKey()` (cache key MUST be own-origin, never a secret-bearing upstream URL).
- `src/lib/proxy/http.ts` — `fetchWithRetry`, `corsHeaders`.
- `src/hooks.server.ts` — the single CORS seam for every `/api/*`; allowlisted origin, never `*`.

### Cover resolution services (the chain `/api/og` mirrors server-side)
- `src/lib/services/deezer.ts` — never-throws client posture, TTLs, why the edge proxy is required.
- `src/lib/services/itunes-cover.ts` — iTunes Search URL building (`buildItunesSearchUrl`), no key,
  CORS-open, `artworkUrl100` token-swap for higher resolution.
- `src/lib/services/cover-cache.ts` + `src/lib/stores/cover-version.svelte.ts` — the three key
  families and the read order (uid → name → null) the client uses; context for what "the cover the
  sharer saw" means.

### For the OG-ZH-01 decision
- `src/lib/services/zh-convert.ts` — `s2tConvertLineSync` / `s2tConvertLines` / `isChineseLine`;
  pure `.ts`, lazy ~72KB dict via dynamic `import()` (D-03).

### Project rules
- `CLAUDE.md` — tabs, single quotes (double in `src/lib/i18n/*`), runes conventions, never-throw
  service boundary, high comment density with decision refs, `pnpm check` as the only quality gate.
- `.claude/skills/spike-findings-openmusic/SKILL.md` — kuwo-first resolution rationale behind the
  CN-tier decision.

</canonical_refs>

<specifics>
## Specific Ideas

- Concrete before/after the user asked for:
  `https://openmusic.pages.dev/song/come-as-you-are-nirvana?n=Come%20As%20You%20Are&a=Nirvana&c=https%3A%2F%2Fcdn-images.dzcdn.net%2Fimages%2Fcover%2Ffe1082c5ef54876802146897e76b592e%2F1000x1000-000000-80-0-0.jpg`
  → `https://openmusic.pages.dev/song/Nirvana/Come-As-You-Are`
- Deezer cover URL shape (from the live probe recorded in the deezer route):
  `https://cdn-images.dzcdn.net/images/cover/{md5}/1000x1000-000000-80-0-0.jpg`; search returns
  `data[0].album.cover_xl|cover_big|cover_medium`, and a no-match is a clean `200 { data: [], total: 0 }`.
- Shape follows the web convention for this exact thing — Last.fm `/music/{artist}/_/{track}`,
  Genius `/{artist}-{title}-lyrics`.
- Three de-risking findings from the exploration: path segments aren't ASCII-limited; two segments
  dissolve the separator-ambiguity problem entirely; and the song page **never renders the carried
  cover** (`cover--placeholder`), so dropping `c` regresses zero in-app behavior.
- SSRF posture gets **tighter**, not looser: input becomes path text instead of an arbitrary https
  URL supplied by the sharer's client, and output still passes the `safeImageUrl` host allowlist.
- Cloudflare free-tier budget: 50 subrequests + 10ms CPU per request. This design uses ≤3
  subrequests and one small JSON parse. Cold crawl ~400–900ms against crawler budgets of 3–10s.

</specifics>

<deferred>
## Deferred Ideas

- **md5-only cover carrier** (`c=fe1082c5…`, ~32 chars, exact fidelity, zero network) — kept as the
  fallback if `/api/og`'s blind re-resolve produces visibly wrong covers in practice. Rejected as
  the primary because it is Deezer-CDN-shaped only; iTunes and CN covers would need tagged prefixes
  (`d:`/`i:`), which creeps.
- **KV/D1-backed short links** (`/s/{id}`) — needs a KV binding, a write path, and write auth; links
  die if KV is cleared; an opaque id is *less* meaningful, not more. Rejected outright.
- **`/api/og` reuse for in-app cover rendering beyond OG-PAGE-01** — the endpoint could feed other
  surfaces, but the client already has a richer cover cache. Not this phase.
- **`PageOg` origin fix as a standalone change** — tracked at
  `.planning/todos/pending/pageog-hardcoded-site-origin.md`; folded into OG-PAGE-01 here since both
  touch the same component.

</deferred>

<scope_fence>
## Scope Fence

**In:** the two new route shapes; `/api/og`; the `deezer-cover.ts` extraction; `songShareUrl` +
`entityCardUrl` emitting carrier-free URLs; the three loaders building `og.image` from `/api/og`;
legacy-route compat; `PageOg` origin + `og:type` fix; the song-page `<img>` swap; tests.

**Out:** `?play=` queue-restore token, `shareUrl`/`entityShareUrl`, charts routes, the client cover
cache/chain itself, any playback or resolution behavior change beyond re-keying off decoded segments,
and native/Capacitor work (`/api/og` is web-only by construction).

</scope_fence>

---

*Phase: 30-carrier-free-share-links-type-artist-title-api-og*
*Context synthesized 2026-08-07 from the /gsd:explore decision record (commit d52ec0e)*
