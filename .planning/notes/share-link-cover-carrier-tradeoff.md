---
title: Share-link slimming — kill every query carrier via path segments + an /api/og endpoint
date: 2026-08-07
context: Exploration triggered by a shared song link whose URL-encoded `?c=` cover carrier (~110 chars) dominated its length. Landed on a two-segment path shape that removes ALL carriers. Decided the direction for Phase 30.
---

# Share-link slimming — path segments + `/api/og`

## Final shape (2026-08-07)

```
/song/Nirvana/Come-As-You-Are      ← was /song/come-as-you-are-nirvana?n=&a=&c=
/album/Nirvana/Nevermind           ← was /album/{name}?artist=&c=&dn=&da=
/artist/Nirvana                    ← was /artist/{name}?c=&dn=
```

**Every query carrier is gone.** The rest of this note is the reasoning that got here, including a
verdict I reached and then had to reverse.

## The link in question

```
https://openmusic.pages.dev/song/come-as-you-are-nirvana
  ?n=Come%20As%20You%20Are
  &a=Nirvana
  &c=https%3A%2F%2Fcdn-images.dzcdn.net%2Fimages%2Fcover%2Ffe1082c5ef54876802146897e76b592e%2F1000x1000-000000-80-0-0.jpg
```

`n` + slug + `a` ≈ 62 chars. `c` alone ≈ 110 chars — **64% of the URL is the cover carrier.**

## Why `?c=` exists at all

Added by `quick-260723-r4p`. The song share route is a **crawler landing surface**: it is the one
per-route SSR opt-in (`ssr = true` in [`song/[slug]/+page.ts`](../../src/routes/(app)/song/[slug]/+page.ts))
while the root layout stays `ssr = false`. `buildOg` emits `og:image` into a meta tag from query
params **only** — threat T-24-08 forbids an arbitrary server-side fetch from a share link, so the
cover had nowhere to come from except the URL itself.

## Key insight 1 — the page never renders the carried cover

[`song/[slug]/+page.svelte`](../../src/routes/(app)/song/[slug]/+page.svelte) renders
`<div class="cover cover--placeholder">` — a gradient, no `<img>`. Its own comment still claims
"The cover is never carried", stale since `c` landed. The client cover comes from
`player.playStub` → the shared cover cache, not from `data`.

**Consequence: dropping `?c=` regresses zero in-app behavior.** `c` feeds `og:image` and nothing else.

## Key insight 2 — `og:image` URL length is free

Only the **shared** URL is user-visible. `og:image` lives inside a meta tag nobody reads. So
`og:image = /api/og?n=Come%20As%20You%20Are&a=Nirvana` costs nothing in perceived link length,
even though it repeats the same params. The carrier can move from the link into the meta tag.

## The real tradeoff — exactness vs length

`c` carries the cover **the sharer was actually looking at**, resolved through the client chain
(uid cache → name cache → Deezer → iTunes → CN `searchAll`/`dedupeBest`). A server-side re-resolve
from `n + a` alone is **blind** — it can return a different pressing's art, or nothing (→ `/og.svg`).
Weakest exactly on CJK titles, which is this catalog's strength.

That is the only cost of removing `c`. Everything else favors removal.

## Options compared

| Option | Shared link | Fidelity | Verdict |
|---|---|---|---|
| **Path segments `/song/{artist}/{title}` + `/api/og`** | **`/song/Nirvana/Come-As-You-Are` — every carrier gone** | Blind re-resolve | **CHOSEN** |
| `/api/og` endpoint, keep `?n=&a=` | ~62 chars (−110) | Blind re-resolve | Superseded by the row above — same endpoint, but the carriers were never necessary |
| Carry only the Deezer md5 (`c=fe1082c5…`) | −78 chars | Exact | Fallback if `/api/og` fidelity disappoints. Deezer-CDN-shaped only; iTunes/CN covers need tagged prefixes → creeping complexity |
| Drop `n`/`a`, derive from the existing cosmetic slug | −20 more | — | **Dead as posed** — see the reversal below. `slugify` returns `''` for an all-CJK title → slug `s`, `titleFromSlug` → `''` → title `openmusic`, and `resolveAndPlay` bails to `notfound` with no `data.name` |
| KV/D1 short links `/s/{id}` | shortest | Exact | **Dead.** Needs a KV binding + a write path + write auth; links die if KV is cleared; an opaque id is *less* meaningful, not more — the opposite of the goal |

## Key insight 3 — the reversal: path segments are not ASCII-limited

The "drop `n`/`a`" row above was first judged dead outright. **That verdict was wrong**, and the
reason it was wrong is worth recording because it is easy to re-make:

`slugify` ASCII-strips, so a CJK title collapses to the placeholder segment `s`. That is a limit of
**`slugify`**, not of the **URL**. A path segment carries raw UTF-8 perfectly well —
`/song/周杰倫/稻香` is valid, percent-encoded on the wire, and rendered decoded by browsers and by
every messenger's link preview. So the path can carry the **authoritative** title + artist instead of
a lossy cosmetic slug, which makes `n` and `a` redundant rather than load-bearing.

And once artist and title occupy **separate segments**, the `/` is the separator — no ambiguity, no
escaping scheme, nothing to disambiguate. The single-segment shape
(`come-as-you-are-nirvana`) is what forced a separator problem into existence; two segments dissolve it.

Shape follows the web convention for this exact thing (Last.fm `/music/{artist}/_/{track}`,
Genius `/{artist}-{title}-lyrics`).

## Decisions (2026-08-07)

0. **Two-segment paths, all three surfaces** — `/song/{artist}/{title}`, `/album/{artist}/{name}`,
   `/artist/{name}`. Raw text (URL-encoded), **original case preserved**, spaces as `-`.
   - Case-preserving, not lowercase: the OG card title is read straight from the path, so lowercasing
     would force a title-case reconstruction and render `DNA` as `Dna`, `iPhone` as `Iphone`.
   - Only lossy edge: a title containing a literal hyphen decodes with a space (`Spider-Man` →
     `Spider Man`). `playStub`'s fuzzy `scoreMatch` absorbs it; the card reads `Spider Man`.
     Considered `+`-for-space (Last.fm style, fully lossless) and rejected it as uglier for a
     marginal gain.
   - CJK needs no special handling — `/song/周杰倫/稻香`.
1. **`/api/og` cover endpoint**, `?type=song|album|artist&artist=&title=`.
2. **Full chain server-side — Deezer → iTunes → kuwo** (not just Deezer), so CJK fidelity stays
   close to what the sharer saw.
3. **kuwo only for the CN tier, NOT `searchAll` fan-out.** Per `spike-findings-openmusic`
   (kuwo-first resolution). Bounds the endpoint at 3 subrequests and keeps a cold crawl inside
   every crawler's fetch budget — a full fan-out at the edge risks the very timeout the endpoint
   exists to avoid.
4. **Stream, don't 302.** `new Response(upstream.body, { headers })` is ~0 CPU on Workers (the body
   isn't buffered) and sidesteps per-crawler redirect-follow variance. WhatsApp and iMessage are the
   fussy ones; a plain `200 image/jpeg` with `Content-Type` is universally accepted.
5. **All three surfaces in one pass** — `songShareUrl` *and* `entityCardUrl` both set full-URL `c`,
   so one endpoint retires all three carriers.
6. **`dn`/`da` can die too — flagged, not assumed.** They exist because the zhs→zht-converted display
   name had no server-side equivalent. But [`zh-convert.ts`](../../src/lib/services/zh-convert.ts) is
   pure `.ts` (no browser globals, node-testable) and `tongwen-core` + `tongwen-dict` are real runtime
   `dependencies`, so the SSR loader **can** convert Simplified→Traditional server-side. Cost: the
   ~72KB s2t dict dynamic-imports into the edge SSR path (fine against the 3MB compressed Worker
   limit, but it is real per-request weight on a cold isolate). This is the one part of the design
   that adds edge cost — decide explicitly during planning rather than defaulting to yes.
7. **The old routes stay as legacy handlers.** `/song/[slug]?n=&a=&c=` and the query-carrier
   album/artist forms keep working, so every link already shared in the wild keeps resolving *and*
   keeps its card. Path depth differs (`/song/[slug]` vs `/song/[artist]/[title]`), so the routes
   coexist with no matching conflict.

## Budget / posture notes

- Cloudflare free tier: 50 subrequests + 10ms CPU per request. This uses ≤3 subrequests and one
  small JSON parse. Cold crawl ~400–900ms; crawler budgets are 3–10s.
- Two cache layers, both keyed own-origin via `ownOriginCacheKey`: the `n+a → coverUrl` resolve and
  the image bytes (`Cache-Control: public, max-age=86400, immutable`).
- **SSRF posture gets tighter, not looser.** Input becomes `n`/`a` text instead of an arbitrary
  https URL from the sharer's client; output passes the same `safeImageUrl` host allowlist
  (extended to `*.mzstatic.com` + the kuwo cover host).
- Infra already exists — `edgeCache()`, `ownOriginCacheKey()`, `fetchWithRetry`, `corsHeaders`,
  `safeImageUrl`. `/api/deezer/search` already runs this exact resolve at the edge with TTL 86400.
- The Deezer upstream call must be extracted to `$lib/proxy/deezer-cover.ts` for sharing — a
  `+server.ts` cannot export non-verb helpers (it 500s at request time; unit tests miss it).
- `/api/og` does not exist under `adapter-static` (native build) and does not need to — OG cards are
  web-only. `VITE_API_BASE` already points the APK at `openmusic.lol` if the app reuses it.

## Free side-win

Once `/api/og` exists, the song share page's gradient placeholder can become
`<img src="/api/og?n=…&a=…">` — the crawler card and the landing page finally show the same art.

## Verification caveat

Deezer + iTunes tiers are E2E-verifiable in-sandbox. The **kuwo tier is not** — no CN upstream
network here (see the `sandbox-no-cn-upstream-network` finding). That tier needs unit tests plus a
device/prod check.

## Side issue found in passing

[`PageOg.svelte`](../../src/lib/components/PageOg.svelte) hardcodes `SITE = "https://openmusic.lol"`,
so a link shared from `openmusic.pages.dev` emits a cross-origin `og:url`. Tracked separately in
`.planning/todos/pending/pageog-hardcoded-site-origin.md`.
