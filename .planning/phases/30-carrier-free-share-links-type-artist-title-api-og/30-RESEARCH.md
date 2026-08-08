# Phase 30: Carrier-Free Share Links (`/{type}/{artist}/{title}` + `/api/og`) - Research

**Researched:** 2026-08-07
**Domain:** SvelteKit 2.63 routing + URL path encoding, Cloudflare Workers edge image proxying, social-crawler OG semantics
**Confidence:** HIGH on routing / encoding / repo facts (empirically verified in this session). MEDIUM on crawler byte/timeout budgets (one official source, rest SEO blogs). HIGH on the OG-ZH-01 cost measurement.

## Summary

Every LOCKED decision in `30-CONTEXT.md` is **technically sound and empirically confirmed**. I stood the two-segment routes up in this repo, ran `svelte-kit sync`, `pnpm build` (adapter-cloudflare) and `pnpm build:native` (adapter-static), and issued live requests against `pnpm dev`. `/song/[slug]` and `/song/[artist]/[title]` coexist with no route-matching conflict (proved from SvelteKit's own conflict-detection source *and* by a live 200 on both shapes), CJK segments round-trip, and both build targets are green. Nothing in the phase is blocked.

Four findings materially change the plan:

1. **SvelteKit already `decodeURIComponent`s route params** (`node_modules/@sveltejs/kit/src/utils/routing.js:304` → `decode_params`). The existing album and artist loaders decode a **second** time (`album/[name]/+page.ts:22`, `artist/[name]/+page.ts:22`, `album/[name]/+page.svelte:50`) — and I confirmed live that this makes `/album/50%25%20Off` return **HTTP 500** today. The new loaders must not decode; the legacy handlers should be fixed while they are being touched.
2. **The `~72KB` s2t dict figure in CONTEXT.md/ROADMAP is off by ~5×.** Measured from the real build: char dict 72,539 B raw / 32,939 B gzip **plus** phrase dict 284,775 B raw / **119,653 B gzip** → ~357 KB raw / ~153 KB gzip. `createConverterMap()` costs a measured **8.9 ms of pure CPU** on an M-series Mac — against a **10 ms free-tier CPU budget per request**. My OG-ZH-01 recommendation is therefore **retire `dn`/`da` with no server-side conversion at all** (see §E).
3. **The kuwo tier IS verifiable in this sandbox.** `kw-api.cenguigui.cn` answered 200 with a full result set, and its cover host `img{1,4}.kuwo.cn` served a 104 KB JPEG. This contradicts the `sandbox-no-cn-upstream-network` memory note, which is about the netease/qq Meting proxies. The plan can E2E all three tiers here. Also: kuwo's **search** response already carries `pic` — the kuwo tier is **1 subrequest**, not 2.
4. **The hyphen↔space loss is not "fuzzily absorbed" — it is exactly absorbed.** `matchKey`'s `norm()` strips *all* non-letter/number characters (`match-key.ts:29`), so `matchKey('Nirvana','Spider-Man') === matchKey('Nirvana','Spider Man')`. `scoreMatch` scores both at `SIM_EXACT`. The residual risk is only in the *upstream keyword* `searchAll(\`${artist} ${title}\`)`, which I probed live (§B.8).

**Primary recommendation:** Ship it as locked. Add three things the CONTEXT did not anticipate: a dot-only-segment guard in the encoder (WHATWG URL normalizes `.`/`..`/`%2e` away — verified 404), a **600 px** cover variant per tier rather than the max-res variant (iTunes `1200x1200bb` is 332 KB and blows past WhatsApp's comfortable range; `600x600bb` is 101 KB), and `platform.env.ASSETS` + `ctx` typing in `src/app.d.ts` if the `/og.svg` fallback and `waitUntil` are wanted. Recommend **no** server-side zh conversion (OG-ZH-01 = drop `dn`/`da`, don't replace them).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Path shape (LOCKED)**

- **Two path segments, artist first:** `/song/{artist}/{title}`, `/album/{artist}/{name}`. `/artist/{name}` stays one segment (an artist page has no secondary name).
- **Raw text, NOT `slugify` output.** The path carries the authoritative title/artist. This is the reversal that unlocked the phase: `slugify` ASCII-strips, but a **path segment is not ASCII-limited** — `/song/周杰倫/稻香` is a valid URL, percent-encoded on the wire and rendered decoded by browsers and messenger link previews. CJK needs no special handling.
- **Original case PRESERVED** — `/song/Nirvana/Come-As-You-Are`, not `come-as-you-are`. Rationale: the OG card title is read straight from the path, so lowercasing forces a title-case reconstruction that renders `DNA` as `Dna` and `iPhone` as `Iphone`. Explicitly chosen over the prettier all-lowercase form.
- **Spaces encode as `-`.** Known lossy edge, accepted: a title containing a literal hyphen decodes with a space (`Spider-Man` → `Spider Man`). `playStub`'s fuzzy `scoreMatch` absorbs it; the card reads `Spider Man`. **Rejected:** `+`-for-space (Last.fm style, fully lossless) — uglier for a marginal gain.
- Both new routes are per-route `ssr = true` / `prerender = false` opt-ins, exactly like the current entity routes.

**`/api/og` cover endpoint (LOCKED)**

- `GET /api/og?type=song|album|artist&artist=&title=`.
- **Tiered, bounded resolve chain:** Deezer → iTunes → **kuwo only** → stream `/og.svg`.
- **kuwo only, NOT `searchAll` fan-out.** Per `spike-findings-openmusic` (kuwo-first resolution). This caps the route at ≤3 subrequests so a cold crawl stays inside every crawler's fetch budget — a full fan-out at the edge would risk the very timeout the endpoint exists to avoid.
- **Stream, do NOT 302.** `new Response(upstream.body, { headers })` — pass-through streaming is ≈0 CPU on Workers (the body is never buffered) and sidesteps per-crawler redirect-follow variance (WhatsApp and iMessage are the fussy ones). A plain `200 image/jpeg` is universally accepted.
- Per-tier `AbortSignal.timeout` under **one overall ~2.5s deadline**. A miss or timeout falls through to the branded `/og.svg`. The route **never** 500s and never exceeds the crawl budget.
- **Two `caches.default` layers**, both keyed own-origin via `ownOriginCacheKey()`: the `artist+title → coverUrl` resolve, and the image bytes (`Cache-Control: public, max-age=86400, immutable`).

**Shared code extraction (LOCKED)**

- The Deezer cover upstream call moves out of `api/deezer/search/+server.ts` into `$lib/proxy/deezer-cover.ts` so `/api/og` and `/api/deezer/search` share one implementation. **Required, not cosmetic:** a `+server.ts` cannot export non-verb helpers — it 500s at request time and unit tests miss it (they import the module directly).
- `safeImageUrl` extends to `*.mzstatic.com` (iTunes) + the kuwo cover host, applied per tier.

**Backward compatibility (LOCKED)**

- The old routes stay as **legacy handlers**: `/song/[slug]?n=&a=&c=` plus the query-carrier album/artist forms keep resolving *and* keep their card (legacy `c` still https-gated exactly as today). Path depth differs, so `/song/[slug]` and `/song/[artist]/[title]` coexist with no route-matching conflict.
- Tests must assert both the new carrier-free path and every legacy query shape.

### OPEN — decide during planning, do NOT default to yes

- **OG-ZH-01: retire `dn`/`da` by converting zhs→zht server-side?** `dn`/`da` exist only because the Traditional display name had no server-side equivalent. But `$lib/services/zh-convert.ts` is pure `.ts` (no browser globals, node-testable) and `tongwen-core` / `tongwen-dict` are real runtime `dependencies`, so the SSR loader *can* convert. **Cost:** the ~72KB s2t dict dynamic-imports into the edge SSR path — fine against the 3MB compressed Worker limit, but real per-request weight on a cold isolate. This is the only part of the phase that adds edge cost. Weigh it explicitly; if the answer is no, `dn`/`da` survive as the sole remaining carriers and that is an acceptable outcome.

### Claude's Discretion

- Route file layout for the two-segment routes (nested `[artist]/[title]` dirs vs a rest param), and how much of the existing `[slug]` loader is shared vs duplicated for the legacy handler.
- Encode/decode helper placement in `$lib/services/share.ts` and its exact signature.
- Tier ordering internals, timeout values per tier under the 2.5s ceiling, and how the resolve-layer cache key is composed.
- Test file organization (extend `share.test.ts` vs add a sibling for the endpoint).
- Whether OG-PAGE-01's `<img>` gets a loading/error fallback to the gradient.

### Deferred Ideas (OUT OF SCOPE)

- **md5-only cover carrier** (`c=fe1082c5…`, ~32 chars, exact fidelity, zero network) — kept as the fallback if `/api/og`'s blind re-resolve produces visibly wrong covers in practice. Rejected as the primary because it is Deezer-CDN-shaped only; iTunes and CN covers would need tagged prefixes (`d:`/`i:`), which creeps.
- **KV/D1-backed short links** (`/s/{id}`) — needs a KV binding, a write path, and write auth; links die if KV is cleared; an opaque id is *less* meaningful, not more. Rejected outright.
- **`/api/og` reuse for in-app cover rendering beyond OG-PAGE-01** — the endpoint could feed other surfaces, but the client already has a richer cover cache. Not this phase.
- **`PageOg` origin fix as a standalone change** — tracked at `.planning/todos/pending/pageog-hardcoded-site-origin.md`; folded into OG-PAGE-01 here since both touch the same component.

**Scope fence — Out:** `?play=` queue-restore token, `shareUrl`/`entityShareUrl`, charts routes, the client cover cache/chain itself, any playback or resolution behavior change beyond re-keying off decoded segments, and native/Capacitor work (`/api/og` is web-only by construction).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OG-PATH-01 | New two-segment routes, per-route `ssr = true` / `prerender = false`, never a `+page.server.ts` | §A.1–A.5 — route layout verified by live `svelte-kit sync` + both builds; `ssr` override semantics proved from `page_nodes.js:#get_option` |
| OG-PATH-02 | `songShareUrl` / `entityCardUrl` emit the new shapes with zero query params | §B.6–B.8 — encoder/decoder design, character table, `matchKey`/`scoreMatch` tolerance measured; §F.19 call-site inventory |
| OG-EP-01 | New `src/routes/api/og/+server.ts`, tiered bounded chain under a ~2.5 s deadline | §C.9 (implementation shape + deadline composition), §C.13 (per-tier request sequences), §C.14 (CF limits) |
| OG-EP-02 | Stream, no 302; two `caches.default` layers | §C.10 (streaming + the `clone()` buffering gotcha), §C.11 (fallback delivery), §D.15 (redirect evidence) |
| OG-EP-03 | Extract the Deezer cover call to `$lib/proxy/deezer-cover.ts`; extend `safeImageUrl` | §C.12 — exact function list, signatures, rewiring, and the existing test suite as the regression harness |
| OG-ZH-01 | Decide `dn`/`da` retirement explicitly | §E.17 — measured dict cost + a firm recommendation (drop the carriers, do **not** convert server-side) |
| OG-COMPAT-01 | Legacy routes keep working; no route conflict | §A.2 (conflict source + live proof), §F.19–F.20 (compat inventory + test deltas) |
| OG-VERIFY-01 | Tests updated; new endpoint tests; real-crawler check | §D.16 (verification split), §G (validation architecture), §F.20 (exact test assertions to change) |
| OG-PAGE-01 | Song page `<img>`; `PageOg` origin + per-surface `og:type` | §F.18 — SSR-safe origin derivation, `og:type` plumbing, and the **native-build broken-image trap** |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives the plan must satisfy (same authority as locked decisions):

| Constraint | Applies to this phase |
|---|---|
| Tabs for indentation; single quotes in TS/JS (double **only** in `src/lib/i18n/*`) | All new files |
| Svelte 5 runes forced; `$state`/`$derived`/`$props` — no `export let`, no `$:` | `PageOg.svelte`, new `+page.svelte` files |
| `*.svelte.ts` **only** for runes; pure logic stays `.ts` | `share.ts` encode/decode helpers stay `.ts`; `$lib/proxy/deezer-cover.ts` stays `.ts` |
| **No new npm runtime deps** — sources/proxy/services are hand-written over platform `fetch`/`URL` | `/api/og` uses `fetch` + `URL` + `AbortSignal.timeout` only. **No image library.** |
| Never-throw service boundaries returning sentinels | `/api/og` must never 500; each tier returns `null` on any fault |
| High comment density; decision-ref tags (`OG-EP-01`, `D-xx`) on every non-obvious choice; never delete existing decision refs | Every new file; do **not** strip the existing `DQ-1`/`T-24-08`/`quick-260723-r4p` comments from the legacy loaders |
| `pnpm check` (svelte-check) + `pnpm test` (vitest) are the ONLY quality gates — no linter/formatter | Both must be green; style is convention |
| Path aliases (`$lib/…`, `$app/…`), `import type` for type-only, named exports only | All new files |
| Zero `as any` in production source (tests only); prefer `satisfies` / `as const` | `/api/og` untrusted-JSON shapes get explicit optional interfaces, mirroring `DzResult` |
| `browser`-guard anything touching `localStorage`/`window`/`document` | New `+page.svelte` must stay SSR-safe-by-construction like `song/[slug]/+page.svelte:11-14` |
| CORS: never `*`; single seam in `hooks.server.ts` | `/api/og` inherits it automatically — do not add a second CORS mechanism |
| Secrets only in `platform.env`, edge-side | `/api/og` reads **no** secret (Deezer/iTunes/kuwo are all keyless) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Share-URL construction (`songShareUrl`, `entityCardUrl`) | Browser / Client | — | Reads `location.origin` and the sharer's resolved cover; pure otherwise. Already client-only (`share.ts:182`) |
| Path segment encode/decode | Pure library (`$lib/services/share.ts`) | Both tiers | Must be importable by the SSR loader **and** the client — so it stays a pure `.ts` with no `location`/`browser` access |
| Route param decoding | **SvelteKit framework** | — | `decode_params` (`utils/routing.js:304`) owns this. Application code must NOT re-decode — see §A.3 |
| OG head derivation (`buildOg`, `og.image` URL) | Frontend Server (SSR, CF edge) | Browser (client nav) | Universal `+page.ts` `load` — runs both places; must be origin-agnostic |
| Cover resolution for the card | **API / Backend (`/api/og`, CF edge)** | — | Threat T-24-08 forbids the *loader* fetching; the crawler fetching `/api/og` is a separate, bounded request. Never the browser |
| Cover resolution for in-app rendering | Browser / Client | — | `cover-cache.ts` + `cover-version.svelte.ts` already own this and are richer. `/api/og` must not become an in-app cover source (deferred) |
| Image byte delivery + caching | API / Backend + CDN | CDN / Static (`/og.svg`) | `caches.default` + `Cache-Control: immutable`; the branded fallback is a static asset excluded from the Worker (`_routes.json`) |
| Track resolution from decoded segments | Browser / Client | — | `playStub` → `resolveStub` → `searchAll` runs client-side after hydration. Unchanged by this phase |
| zh-Hans→zh-Hant display conversion | Browser / Client | **never the edge** | §E.17 — measured CPU cost makes the edge the wrong tier |

## Standard Stack

No new dependencies. Everything this phase needs already exists in-repo or in the platform.

### Core
| Library / API | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SvelteKit | 2.63.0 (`package.json:39`) | Nested dynamic routes, universal `load`, per-route `ssr` | Already the app framework; `decode_params` handles all segment decoding [VERIFIED: `node_modules/@sveltejs/kit/src/utils/routing.js:304`] |
| `@sveltejs/adapter-cloudflare` | 7.2.8 | Web build → Pages Functions; provides `platform.env` + `env.ASSETS` | Already the default adapter (`svelte.config.js:28`) [VERIFIED: `node_modules/@sveltejs/adapter-cloudflare/files/worker.js:50`] |
| `@sveltejs/adapter-static` | 3.0.10 | Native build → SPA fallback | Verified: emits **zero** route dirs, `index.html` fallback covers any depth (§A.5) |
| Platform `fetch` / `URL` / `URLSearchParams` | workerd | Upstream calls + URL building | CLAUDE.md forbids new runtime deps; every existing proxy is hand-written over these |
| `AbortSignal.timeout` / `AbortSignal.any` | workerd | Per-tier + overall deadline | Already the repo's "don't hand-roll" pattern (`http.ts:3-4`, `itunes-cover.ts:76-81`) |
| `caches.default` via `edgeCache()` | — | Edge cache | The single `typeof caches` guard in the repo (`edge-cache.ts:26-29`) |
| Vitest | ^4.1.3 | Unit + endpoint tests | `vite.config.ts:6-22`, single `server`/node project |

### Supporting (all in-repo, reuse verbatim)
| Module | Purpose | When to Use |
|---|---|---|
| `$lib/proxy/http.ts` `fetchWithRetry`, `corsHeaders` | Bounded retry on 429/5xx; own-origin CORS | Every upstream call in `/api/og`. **Set `retries = 0`** for the OG path — the 2.5 s deadline cannot afford 150–300 ms backoffs (`http.ts:91-95`) |
| `$lib/proxy/edge-cache.ts` `edgeCache`, `ownOriginCacheKey` | Cache accessor + key invariant | Both cache layers |
| `$lib/services/itunes-cover.ts` `buildItunesSearchUrl` | iTunes search URL | Reuse **as-is**. Do **not** reuse `upgradeArtwork` — it swaps to `1200x1200bb` (332 KB); `/api/og` wants `600x600bb` (101 KB). See §C.13 |
| `$lib/proxy/kuwo.ts` `kuwoProxy.buildUrl` | kuwo upstream URL | Call `kuwoProxy.buildUrl('search', params, undefined)` directly — no HTTP hop through `/api/kuwo/*` |
| `$lib/services/share.ts` `buildOg`, `isHttpsUrl` | OG derivation | Unchanged contracts; `og.image` becomes an own-origin `/api/og?…` URL which `isHttpsUrl` accepts (it is absolute https in production) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Nested `[artist]/[title]` dirs | `[...path]` rest param | Rest param would swallow `/song/a/b/c` and collide with `/song/[slug]` in `prevent_conflicts` (both normalize toward a 1-segment match). **Use nested dirs** — verified conflict-free (§A.1–A.2) |
| `caches.default` + `cache.put` for the image bytes | `fetch(url, { cf: { cacheTtl: 86400, cacheEverything: true } })` | Simpler, no `clone()`, no memory risk. But CONTEXT LOCKS the two-`caches.default`-layer design and cover URLs bear no secrets either way. Mentioned only as a lower-risk belt if `clone()` proves troublesome |
| Streaming the max-res cover | 500–600 px variant | Max-res is 208–332 KB; 600 px is 73–104 KB. Recommend the smaller variant (§C.13, §D.15) |
| Server-side `zh-convert` for `dn`/`da` | Drop the carriers entirely | §E.17 — measured 8.9 ms CPU vs a 10 ms free-tier budget. Recommend dropping |
| `fetch('${origin}/og.svg')` for the fallback | `platform.env.ASSETS.fetch(...)` | ASSETS is a binding (no network hop, no subrequest). Needs a one-line `app.d.ts` addition (§C.11) |

**Installation:** none. `pnpm install` unchanged.

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** CLAUDE.md forbids new runtime npm dependencies for the web app, and every capability the phase needs is already present (`tongwen-core@4.1.1` / `tongwen-dict@1.0.2` are pre-existing `dependencies`, `package.json:73-74`; my OG-ZH-01 recommendation does not add a new use of them at the edge).

**Packages removed due to slopcheck [SLOP] verdict:** none — no packages proposed.
**Packages flagged as suspicious [SUS]:** none.

---

## A. SvelteKit routing mechanics (OG-PATH-01, OG-COMPAT-01)

### A.1 Exact route-file layout — nested dirs, not a rest param

```
src/routes/(app)/song/[slug]/                    ← LEGACY, unchanged (OG-COMPAT-01)
    +page.ts      +page.svelte
src/routes/(app)/song/[artist]/[title]/          ← NEW
    +page.ts      +page.svelte
src/routes/(app)/album/[name]/                   ← LEGACY, unchanged
    +page.ts      +page.svelte
src/routes/(app)/album/[artist]/[name]/          ← NEW
    +page.ts      +page.svelte
src/routes/(app)/artist/[name]/                  ← UNCHANGED shape; loader drops the carriers
    +page.ts      +page.svelte
src/routes/api/og/+server.ts                     ← NEW
```

Note `song/[artist]/` and `album/[artist]/` are **intermediate directories with no route files** — they contribute no route, only a path segment.

**Why nested dirs, not `[...path]`:** a rest param `[...rest]` compiles to `(?:/([^]*))?` — it matches **zero or more** segments (`utils/routing.js:24-32`), so `/song/[...rest]` would also match `/song/anything` and `prevent_conflicts` would collide it with `/song/[slug]`. Nested dirs compile to two required `([^/]+?)` groups (`utils/routing.js:89`), producing a strictly 2-segment matcher. A rest param would additionally accept `/song/a/b/c/d` — undesirable and untestable. [VERIFIED: SvelteKit source + live probe]

**Confidence: HIGH.** I created exactly this layout in the repo, ran `pnpm exec svelte-kit sync` (exit 0, no warnings), and `.svelte-kit/types/src/routes/(app)/song/` contained both `[artist]` and `[slug]`. Then removed it — `git status` clean.

### A.2 Route-matching conflict analysis — CONTEXT.md's assertion is CORRECT

`prevent_conflicts` (`node_modules/@sveltejs/kit/src/core/sync/create_manifest_data/conflict.js`) does exactly two relevant things:

1. **Skips non-leaf routes:** `if (!route.leaf && !route.endpoint) continue;` — so `song/[artist]` (a bare directory) is never entered into the conflict lookup at all.
2. **Normalizes each route id** by replacing every `[param]` with `<*>` (`normalize_route_id`), then throws only on an exact key collision.

Normalized keys for this phase:

| Route id | Normalized key |
|---|---|
| `/(app)/song/[slug]` | `song/<*>` |
| `/(app)/song/[artist]/[title]` | `song/<*>/<*>` |
| `/(app)/album/[name]` | `album/<*>` |
| `/(app)/album/[artist]/[name]` | `album/<*>/<*>` |
| `/(app)/artist/[name]` | `artist/<*>` |

All five distinct → **no conflict is possible**, and the differing param *names* between sibling dynamic dirs are irrelevant (params are collected per route id, never compared across routes). There is no "specificity" tie to resolve because the compiled regexes have different segment counts and cannot both match one path. [VERIFIED: SvelteKit source]

**Live confirmation** (`pnpm dev`, both route shapes present simultaneously):

```
GET /song/come-as-you-are-nirvana?n=X&a=Y   → 200  (legacy [slug])
GET /song/Nirvana/Come-As-You-Are           → 200  (new, rendered "Nirvana/Come-As-You-Are")
GET /album/Nevermind?artist=Nirvana         → 200  (legacy [name])
GET /album/Nirvana/Nevermind                → 200  (new)
GET /song/A/B/C                             → 404  (over-deep — correctly unmatched)
```

**No LOCKED decision is impossible.** OG-COMPAT-01 is safe as specified.

### A.3 `params` decoding — SvelteKit decodes; **do NOT decode again** (LATENT 500 BUG)

The server pipeline is:

1. `respond.js:266` — `resolved_path = decode_pathname(resolved_path)`. `decode_pathname` (`utils/url.js:49-51`) splits on `%25` and `decodeURI`s each part, so `%25` survives and — because `decodeURI` never touches reserved characters — `%2F`, `%3F`, `%23` survive too.
2. `respond.js:334` — `find_route(resolved_path, …)` matches the *decoded* path.
3. `utils/routing.js:304` — `params: decode_params(matched)`, which runs `decodeURIComponent` on **every** param (`utils/url.js:55-63`).

The client router does the same (`client.js:1569`).

**Therefore `params.artist` / `params.title` / `params.name` arrive fully decoded.** The existing loaders decode a second time:

- `src/routes/(app)/album/[name]/+page.ts:22` — `decodeURIComponent(params.name ?? '')`
- `src/routes/(app)/artist/[name]/+page.ts:22` — same
- `src/routes/(app)/album/[name]/+page.svelte:50` — `decodeURIComponent(page.params.name ?? '')`

For most names this is idempotent, which is why it has never been noticed. **But I confirmed live that a `%` in the name is a hard 500:**

```
GET /album/50%25%20Off   → 500     (params.name === '50% Off'; decodeURIComponent('50% Off') throws URIError)
GET /artist/50%25%20Cent → 500
```

**Plan actions:**
- New loaders: read `params.artist` / `params.title` directly. **No `decodeURIComponent`.**
- Legacy loaders (already being edited for OG-COMPAT-01): remove the redundant decode. It is a one-line deletion per site that fixes a live 500. Do the same at `album/[name]/+page.svelte:50`.
- Add a regression test asserting a `%`-bearing name does not throw.

**Verified round-trip behavior for special characters** (live, against the new 2-segment route):

| Requested path segment | `params.title` |
|---|---|
| `Come-As-You-Are` | `Come-As-You-Are` |
| `%E7%A8%BB%E9%A6%99` (encoded CJK) | `稻香` |
| `稻香` (raw UTF-8 on the wire) | `稻香` |
| `A%2FB` | `A/B` ✅ a `/` inside a segment round-trips |
| `50%25-Off` | `50%-Off` ✅ a literal `%` round-trips (single decode only) |
| `%231-Hit` | `#1-Hit` |
| `🎵Song` (percent-encoded) | `🎵Song` |
| `..` and `%2E%2E` | **404** — see §B.7 |

### A.4 Per-route `ssr = true` composes at any depth; `prerender = false` is redundant-but-keep

`PageNodes.#get_option` (`node_modules/@sveltejs/kit/src/utils/page_nodes.js`) reduces over `[...layouts, page]` in order, taking the **last** defined value:

```js
return this.data.reduce((value, node) =>
    node?.universal?.[option] ?? node?.server?.[option] ?? value, undefined);
ssr()       { return this.#get_option('ssr') ?? true; }
prerender() { return this.#get_option('prerender') ?? false; }
```

The page node is always last, so a `+page.ts` `export const ssr = true` overrides `src/routes/+layout.ts`'s `ssr = false` (`+layout.ts:8`) **regardless of nesting depth**. There is no depth term in the reduction. [VERIFIED: SvelteKit source; confirmed live — the 2-segment probe route rendered its content in the server HTML while the root layout stays `ssr=false`]

`prerender()` already defaults to `false`, and the root layout sets it explicitly, so `export const prerender = false` in the new pages is redundant. **Keep it anyway** — the existing three entity loaders all state it (`song/[slug]/+page.ts:28`, `album/[name]/+page.ts:19`, `artist/[name]/+page.ts:19`) with a comment explaining the unbounded slug space; consistency with the house comment-as-decision-record style matters more than terseness.

**The `+page.server.ts` prohibition holds and must be restated in every new loader's header comment** (Pitfall 5 / T-24-09): `adapter-static` cannot build a route with a server load, and `should_prerender_data()` keys off `node?.server?.load`.

### A.5 `adapter-static` native build — verified unaffected

`pnpm build:native` with both new route shapes present: **exit 0**, `Using @sveltejs/adapter-static`, `Wrote site to "build"`.

`build/` contents: `_app/ favicon.svg icon-maskable.svg icons/ index.html manifest.webmanifest og.svg robots.txt service-worker.js sitemap.xml` — **no `song/`, `album/`, or `artist/` directory at any depth.**

So today's `/song/[slug]` emits **nothing** under adapter-static: `fallback: 'index.html'` + `strict: false` (`svelte.config.js:24-26`) means every non-prerendered path is served by the SPA shell and routed client-side. Adding a second dynamic segment changes nothing — the fallback is depth-agnostic. `/api/og` simply does not exist in the native build, which is correct (OG cards are web-only).

**But there is a native trap in OG-PAGE-01** — see §F.18.

---

## B. Path encode/decode round-trip (OG-PATH-01, OG-PATH-02)

### B.6 The encode/decode pair

Place both in `src/lib/services/share.ts` (pure `.ts`, already imported by every loader and the client — no `location` access in these two functions so an SSR loader can call `decodePathSegment` safely).

```ts
/**
 * OG-PATH-01: encode ONE raw title/artist into a URL path segment. Original CASE is
 * PRESERVED (the OG card title is read straight back out of the path, so lowercasing
 * would force a title-case reconstruction that renders `DNA` as `Dna`). Whitespace runs
 * collapse to a single '-'; everything else goes through encodeURIComponent, which leaves
 * `- . _ ~ ! * ' ( )` literal and percent-encodes `/ ? # % & + : ;` and all non-ASCII
 * (so a CJK segment is valid on the wire and renders decoded in browsers + link previews).
 *
 * TWO guards, both load-bearing:
 *  - EMPTY: an empty segment would make the path `/song/Artist/` → the required `([^/]+?)`
 *    group cannot match → 404. Emit '-' (which decodes back to '').
 *  - DOT-ONLY: the WHATWG URL parser treats `.` / `..` AND their percent-encoded forms
 *    (`%2e`, `%2E%2E`) as dot path segments and normalizes them AWAY before the request
 *    reaches us (verified: both 404). Appending one '-' makes the segment non-dot-only and
 *    the decoder's hyphen→space+trim recovers the original exactly.
 */
export function encodePathSegment(raw: string): string {
	const collapsed = (raw ?? '').trim().replace(/\s+/g, '-');
	if (!collapsed) return '-';
	const seg = encodeURIComponent(collapsed);
	return /^\.+$/.test(seg) ? `${seg}-` : seg;
}

/**
 * OG-PATH-01 inverse. `seg` is ALREADY decodeURIComponent'd by SvelteKit
 * (decode_params, utils/routing.js) — decoding again throws URIError on a literal '%'
 * (live-verified 500 on the legacy /album/{name} route). Do NOT decode here.
 *
 * KNOWN LOSSY EDGE (accepted, CONTEXT LOCKED): every '-' becomes a space, so a title with
 * a literal hyphen decodes with a space (`Spider-Man` → `Spider Man`). matchKey strips all
 * punctuation AND whitespace, so scoreMatch is EXACTLY insensitive to this (see RESEARCH B.8).
 */
export function decodePathSegment(seg: string): string {
	return (seg ?? '').replace(/-+/g, ' ').trim();
}
```

`/-+/g → ' '` (runs, not per-character) is the right choice: `matchKey`'s `norm()` strips whitespace anyway, so collapsing is free, and it keeps `A--B` from decoding to a double space in the OG card title.

**Character table** — behavior under `encodeURIComponent` + SvelteKit's single decode:

| Char | Encoded as | Safe? | Notes |
|---|---|---|---|
| `/` | `%2F` | ✅ round-trips | `decodeURI` leaves `%2F`; the segment regex is `[^/]+?` so it stays one segment; `decode_params` yields `/`. **Live-verified.** |
| `%` | `%25` | ✅ round-trips | `decode_pathname` splits on `%25` specifically to prevent double-decoding. **Live-verified.** Any *second* decode throws |
| `#` | `%23` | ✅ | `decodeURI` leaves it. **Live-verified** |
| `?` | `%3F` | ✅ | Same |
| `&` | `%26` | ✅ | Irrelevant in a path but encoded anyway |
| `+` | `%2B` | ✅ | Important — `+` is **not** space-decoded in a path (only in a query) |
| space | → `-` first | ⚠️ lossy vs literal `-` | The single accepted loss |
| `-` | literal `-` | ⚠️ decodes as space | Accepted (CONTEXT) |
| `.` inside text | literal `.` | ✅ | `...Hello` is fine — only a *whole* dot segment normalizes |
| `.` / `..` as whole segment | literal, then `-` appended | ✅ with the guard | **Without the guard: 404. Live-verified for both `..` and `%2E%2E`.** |
| CJK / emoji / RTL | UTF-8 percent-encoded | ✅ | **Live-verified** for `周杰倫/稻香` and `🎵Song` |
| `'` `!` `*` `(` `)` `~` `_` | literal (encodeURIComponent leaves these) | ✅ | Cosmetically fine in a path |
| empty string | → `-` | ✅ with the guard | **Without the guard: 404** (SvelteKit's `([^/]+?)` needs ≥1 char) |
| leading/trailing `-` in text | literal | ⚠️ trimmed on decode | `-Hello-` → `Hello`. Accepted |
| all-hyphen title (`-`) | `-` | ⚠️ decodes to `''` | Vanishingly rare; loader falls back to the other segment |

**Equivalent of today's `|| 's'` guard:** `share.ts:183` uses `slugify(...) || 's'` because `slugify` legitimately returns `''` for an all-CJK title. Under the new scheme `slugify` is gone from the path entirely, and the equivalent guard is `encodePathSegment`'s `if (!collapsed) return '-'`. Prefer `'-'` over `'s'`: `'-'` decodes to `''` so the loader's existing "no name → fall back" logic (`song/[slug]/+page.ts:55`) works unchanged, whereas `'s'` would decode to the literal string `"s"` and become a bogus OG title.

### B.7 Stress cases

| Input (`artist` / `title`) | Encoded path | Decoded back | Round-trips? |
|---|---|---|---|
| `Nirvana` / `Come As You Are` | `/song/Nirvana/Come-As-You-Are` | `Nirvana` / `Come As You Are` | ✅ exact |
| `周杰倫` / `稻香` | `/song/%E5%91%A8%E6%9D%B0%E5%80%AB/%E7%A8%BB%E9%A6%99` (browsers display `/song/周杰倫/稻香`) | `周杰倫` / `稻香` | ✅ exact — **live-verified** |
| `Nirvana` / `A/B` | `/song/Nirvana/A%2FB` | `Nirvana` / `A/B` | ✅ exact — **live-verified** |
| `Post Malone` / `Spider-Man` | `/song/Post-Malone/Spider-Man` | `Post Malone` / `Spider Man` | ⚠️ lossy (accepted). `matchKey` identical (§B.8) |
| `X` / `-Hello-` | `/song/X/-Hello-` | `X` / `Hello` | ⚠️ hyphens lost. Accepted |
| `X` / `A  B` (double space) | `/song/X/A--B` | `X` / `A B` | ⚠️ collapsed. Harmless — `matchKey` strips whitespace |
| `X` / `.` | `/song/X/.-` | `X` / `.` | ✅ **with the guard**. Without: `/song/X/.` → normalized → 404 |
| `X` / `..` | `/song/X/..-` | `X` / `..` | ✅ with the guard. **Without: 404 — live-verified, including `%2E%2E`** |
| `X` / `...` | `/song/X/...-` | `X` / `...` | ✅ with the guard. Real titles exist |
| `X` / `50% Off` | `/song/X/50%25-Off` | `X` / `50% Off` | ✅ **live-verified** (and the reason the double-decode must go) |
| `X` / `🎵Song` | `/song/X/%F0%9F%8E%B5Song` | `X` / `🎵Song` | ✅ **live-verified** |
| `مهرجان` / `أغنية` (RTL) | UTF-8 percent-encoded | exact | ✅ — same mechanism as CJK; no bidi handling needed (percent-encoding is byte-level). Browsers may render the *displayed* path with bidi reordering, which is cosmetic only |
| `''` / `Solo` | `/song/-/Solo` | `''` / `Solo` | ✅ with the guard. Without: `/song//Solo` → 404 |

### B.8 Does the decoded (hyphen-lossy) title still resolve? — measured, not assumed

**This is the phase's biggest correctness question, and the answer is better than CONTEXT.md claims.**

Chain: `resolveAndPlay` (`song/[slug]/+page.svelte:49`) → `player.playStub(artist, title, null, 'home-discovery')` (`player.svelte.ts:2394`) → `resolveStub(artist, title)` (`discovery.ts:32`) → `searchAll(\`${artist} ${title}\`, 1)` → `dedupeBest(...)` → re-rank by `scoreMatch(query, candidate)` keeping a strict max (`discovery.ts:41-49`).

**Step 1 — the scoring layer is EXACTLY insensitive.** `scoreMatch`'s similarity term is built on `matchKey` (`score-match.ts:114-116`), and `matchKey`'s `norm()` includes:

```js
.replace(/[^\p{L}\p{N}]+/gu, '')   // match-key.ts:29 — strips ALL punctuation AND whitespace
```

So:
- `matchKey('Post Malone', 'Spider-Man')` → `postmalone|spiderman`
- `matchKey('Post Malone', 'Spider Man')` → `postmalone|spiderman`

**Byte-identical.** `similarity()` returns `SIM_EXACT` (10) in both cases (`score-match.ts:116`). Hyphens, spaces, apostrophes, ampersands, parentheses and every other punctuation mark are erased before comparison. `variantPenalty` (`score-match.ts:182-199`) reads raw titles but only looks for `VARIANT_KEYWORDS` word matches — hyphen↔space cannot introduce or remove one (`\b` fires at either boundary). `previewPenalty` reads duration only. `resolveStub` passes no `ctx`, so the set-relative boosts don't apply.

**Conclusion: the re-rank is not "fuzzy tolerance" — it is exact invariance.** [VERIFIED: `match-key.ts:23-31`, `score-match.ts:113-153`]

**Step 2 — the upstream *keyword* is mildly perturbed.** `searchAll` receives the literal `"${artist} ${title}"` string, so the CN/Deezer search engines do see `Spider Man` instead of `Spider-Man`. I probed this live against both reachable upstreams:

| Query | Deezer top-2 | kuwo top-2 |
|---|---|---|
| `Spider-Man Sunflower` | Post Malone – Sunflower (Spider-Man…) ✅ | Vibe2Vibe – Sunflower(Spider-Man…) ⚠️ cover artist |
| `Spider Man Sunflower` | Post Malone – Sunflower (Spider-Man…) ✅ **identical** | Covers Unplugged – …(slowed + reverb) ⚠️ / **Post Malone – Sunflower** at #2 |
| `Jay-Z Empire State of Mind` | JAŸ-Z – Empire State Of Mind ✅ | JAŸ-Z&Alicia Keys – Empire State of Mind ✅ |
| `Jay Z Empire State of Mind` | JAŸ-Z – Empire State Of Mind ✅ **identical** | JAŸ-Z&Alicia Keys – Empire State of Mind ✅ **identical** |

Deezer is fully insensitive across both probes. kuwo's *ordering* shifted in one of two probes — and in exactly the way the existing machinery is built for: the intruding row is a `slowed + reverb` cover, and `slowed` is already in `VARIANT_KEYWORDS` (`score-match.ts:36`) carrying a −4 `VARIANT_WEIGHT`, while the correct Post Malone row is present at #2 and scores `SIM_EXACT`. `dedupeBest` + the `scoreMatch` re-rank recovers it.

**Residual risk (honest):** the loss is in *candidate recall*, not ranking. If a hyphen is load-bearing for the upstream tokenizer to surface the track **at all** within the fetched page, no re-rank can save it. Probability is low (both engines proved substring/whitespace tolerant) and the failure mode is graceful — `playStub` returns `null`, the page shows `status = 'notfound'` with the existing retry button (`song/[slug]/+page.svelte:76-84`). This is **not a regression**: today's `?n=`/`?a=` carriers feed the same `searchAll` with the same text, and the legacy path is unaffected.

**Plan action:** add a `share.test.ts` case asserting `matchKey(artist, decodePathSegment(encodePathSegment(title)))` equals `matchKey(artist, title)` for a hyphen-bearing title — that pins the invariance the whole scheme rests on. No production change needed.

---

## C. `/api/og` endpoint (OG-EP-01, OG-EP-02, OG-EP-03)

### C.9 Full implementation shape

Mirror `api/deezer/search/+server.ts` posture exactly. Key structural points:

```
src/routes/api/og/+server.ts     ← GET (+ optional OPTIONS; hooks.server.ts already answers preflight)
src/lib/proxy/deezer-cover.ts    ← NEW (OG-EP-03): safeDeezerImageUrl, safeDeezerPreviewUrl,
                                    reshapeDeezerSearch, deezerSearchUrl, fetchDeezerCover
src/lib/proxy/og-cover.ts        ← OPTIONAL: the tier chain, kept out of +server.ts so it is
                                    unit-testable in isolation (a +server.ts may only export verbs)
```

**Deadline composition.** Two nested budgets:

```ts
const OVERALL_MS = 2500;         // OG-EP-01: one deadline for the whole resolve
const TIER_MS   = { deezer: 1200, itunes: 900, kuwo: 1200 };

const deadline = AbortSignal.timeout(OVERALL_MS);
// Each tier gets min(its own budget, whatever is left) via AbortSignal.any — the SAME idiom
// itunes-cover.ts:76-81 already uses, with its `typeof anyFn === 'function'` fallback.
function tierSignal(ms: number): AbortSignal {
	const t = AbortSignal.timeout(ms);
	const anyFn = (AbortSignal as { any?: (s: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([deadline, t]) : t;
}
```

Per-tier budgets deliberately **sum to more** than 2500 ms — the overall `deadline` is the hard ceiling and each tier only ever gets the remainder. Tiers run **sequentially** (not `Promise.any`) so the ordering preference Deezer → iTunes → kuwo is honored and a Deezer hit costs exactly one subrequest.

**Miss vs error must be distinguished** — they behave the same (fall through) but must be *logged/tested* differently, and only a **miss** is cacheable:

```ts
type TierOutcome =
	| { kind: 'hit'; url: string }
	| { kind: 'miss' }        // clean 200 with no usable/allowlisted cover → CACHEABLE (negative cache)
	| { kind: 'error' };      // non-ok, malformed JSON, abort/timeout, throw → NOT cacheable
```

Rationale mirrors the repo's established discipline: `deezer/search/+server.ts:219-222` deliberately writes **no** cache entry on error so a transient failure is never cached, and `deezer.ts`'s posture doc states the same. A clean `{ data: [], total: 0 }` from Deezer (a documented real response, `deezer/search/+server.ts:11-12`) is a genuine "this cover does not exist" and should be cached so the fallback path costs 0 subrequests on repeat crawls.

**Skeleton:**

```ts
export const GET: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');
	const type   = url.searchParams.get('type') ?? 'song';   // validate against a closed set
	const artist = (url.searchParams.get('artist') ?? '').trim();
	const title  = (url.searchParams.get('title') ?? '').trim();

	// T-og-01 short-circuit: no query terms → branded fallback, ZERO subrequests.
	if (!artist && !title) return ogFallback(platform, url, origin);

	const cache = edgeCache();

	// LAYER 2 (bytes): keyed on the own-origin /api/og request URL as-is.
	const bytesKey = ownOriginCacheKey(url);
	const cachedBytes = cache && (await cache.match(bytesKey));
	if (cachedBytes) return withCors(cachedBytes, origin);

	// LAYER 1 (resolve): a NORMALIZED synthetic own-origin key so `?title=A&artist=B` and
	// `?artist=B&title=A`, and song-vs-album for the same pair, share one resolve.
	const resolveKey = ownOriginCacheKey(
		`${url.origin}/api/og/_resolve?k=${encodeURIComponent(matchKey(artist, title))}&t=${type}`
	);
	let coverUrl = await readResolveCache(cache, resolveKey);
	if (coverUrl === undefined) {                       // undefined = cache MISS (vs null = known-none)
		coverUrl = await resolveCoverTiered(type, artist, title, deadline);   // ≤3 subrequests
		if (coverUrl !== 'ERROR') await writeResolveCache(cache, resolveKey, coverUrl);
	}
	if (!coverUrl) return ogFallback(platform, url, origin);

	// Stream the bytes. See C.10 for the clone() rules.
	return streamImage(coverUrl, cache, bytesKey, origin, platform);
};
```

**Why the normalized resolve key earns its keep** (the CONTEXT LOCKS two layers — this is how the second one becomes non-redundant): `ownOriginCacheKey(url)` is byte-sensitive to query order and to `type`, so a bytes-layer-only design re-runs all three subrequests whenever a crawler happens to serialize the params differently or when the album card and the song card reference the same artist+title. Keying layer 1 on `matchKey(artist, title)` — the repo's canonical normalization (`match-key.ts:37`) — collapses those. It also survives independently of the bytes layer, so an evicted image entry costs 1 subrequest, not 3.

**Validation posture (SSRF, tighter than today per CONTEXT):** `type` must be checked against `['song','album','artist'] as const` and anything else coerced to `'song'`; `artist`/`title` are only ever passed through `encodeURIComponent` into fixed upstream URL templates (the T-wv8-01 passthrough-only rule, `deezer/search/+server.ts:177-179`); the resolved cover URL must pass a per-tier `safeImageUrl` allowlist **before** `fetch`. Cap the input length (e.g. 200 chars each) so a hostile query can't build a pathological upstream URL.

### C.10 Streaming pass-through — correct, but `clone()` is the trap

`new Response(upstream.body, { headers })` is the right primitive and is genuinely ~0 CPU: workerd pipes the `ReadableStream` through without buffering [CITED: developers.cloudflare.com/workers/runtime-apis/streams].

**Header handling:**
- **`Content-Type`:** do **not** blindly pass through. Read it, and reject anything not matching `^image/` — an upstream that returns `text/html` (an error page from a CDN) would otherwise be emitted as the card image. Normalize to a small allowlist (`image/jpeg`, `image/png`, `image/webp`); if absent or unrecognized, either default to `image/jpeg` (all three tiers serve JPEG — measured) or fall through to the branded fallback. Prefer the latter: it is the never-throw-shaped choice.
- **`Content-Length`:** safe to pass through *if* you also pass the unmodified body. All three tiers returned a concrete `Content-Length` in my probes. If you don't set it, chunked transfer is fine and crawlers do not require it. **Do not** set a `Content-Length` you haven't verified — a mismatch truncates the image.
- Strip everything else (`Set-Cookie` in particular — `cache.put` **throws** on a response carrying `Set-Cookie`, and none of these hosts should send one, but constructing a fresh header set makes it structurally impossible).
- Set `Cache-Control: public, max-age=86400, immutable` yourself (OG-EP-02).

**The `cache.put()` gotcha — YES, `clone()` is required, and it buffers.** Cloudflare's own docs are explicit that `response.clone()` "forces the system to buffer the entire response body in memory, rather than streaming it through", and warn a Worker "may be unexpectedly terminated for going over the memory limit" [CITED: developers.cloudflare.com/workers/examples/cache-api/, developers.cloudflare.com/workers/runtime-apis/cache/]. `cache.put()` consumes the body it is given, so you cannot hand the same stream to both the cache and the client.

For this endpoint the buffering is **not** a real risk — measured payloads are 26–332 KB against a 128 MB isolate memory limit — but bound it explicitly so a pathological upstream can't be used as a memory-exhaustion vector:

```ts
const CACHE_BYTES_CAP = 3_000_000;   // T-og-02: never buffer an unbounded upstream body
const streamed = new Response(upstream.body, { headers });
const len = Number(upstream.headers.get('content-length') ?? NaN);
if (cache && Number.isFinite(len) && len > 0 && len <= CACHE_BYTES_CAP) {
	// clone() buffers `len` bytes — bounded above, and the CLONE (not the original) goes to
	// the cache so the client still gets a genuine stream.
	const forCache = streamed.clone();
	// Prefer ctx.waitUntil so the crawler is not blocked on the cache write.
	const waitUntil = platform?.ctx?.waitUntil?.bind(platform.ctx);
	if (waitUntil) waitUntil(cache.put(bytesKey, forCache));
	else await cache.put(bytesKey, forCache);
}
return streamed;
```

Note `platform.ctx` is **not currently typed** — `src/app.d.ts:21` has it commented out: `// ctx?: ExecutionContext;  // add if waitUntil() is needed for caching later`. Uncomment it (that comment was written for exactly this moment). Every existing route `await`s `cache.put` (`deezer/search/+server.ts:216`), so `await` is an acceptable fallback and keeps the change smaller.

**Lower-risk alternative worth one line in the plan:** `fetch(coverUrl, { cf: { cacheTtl: 86400, cacheEverything: true } })` makes Cloudflare cache the upstream image with **no** `cache.put`, no `clone()`, and no memory exposure. It caches keyed on the *upstream* URL, which is fine here because none of the three cover URLs bear a secret (the `ownOriginCacheKey` invariant exists to protect `LASTFM_KEY`/`JOOX_TOKEN` upstreams — `edge-cache.ts:31-36`). CONTEXT LOCKS the two-`caches.default`-layer design, so treat this as a documented fallback if `clone()` misbehaves in production, not the primary.

### C.11 Serving the `/og.svg` fallback — three options, ranked

First, what `static/og.svg` actually is: a **1200×630 SVG, 1892 bytes**, served as `image/svg+xml` (verified live). Its own first line is a comment that already knows the problem:

```
<!-- 1200×630 share card. NOTE: many social crawlers (Slack, iMessage, some Twitter
     paths) don't render SVG og:image — a PNG export is the production-correct follow-up
     (needs an image-render toolchain, out of scope for this pass). -->
```

Independent sources agree more strongly: **"SVG is not supported as an OG image by any platform"** [CITED: previewog.com/og-image-guide, ogimagen.com/guides/og-image-sizes-2026 — MEDIUM confidence, SEO-blog sources, but they are unanimous and consistent with the file's own note].

Delivery options:

| Option | Subrequests | Verdict |
|---|---|---|
| **302 → `/og.svg`** | 0 | ❌ **Rejected by CONTEXT and by the evidence** (§D.15) — WhatsApp's crawler does not reliably follow redirects on image URLs |
| **Inline the SVG as a module string constant** | **0** | ✅ **Recommended for the fallback body.** 1.9 KB in the Worker bundle, zero network, zero loop risk, zero `caches` interaction. Lazy and correct |
| `platform.env.ASSETS.fetch(new Request(new URL('/og.svg', url.origin)))` | 0 (binding, not network) | ✅ Also good, keeps one copy of the asset. Requires typing `ASSETS: { fetch: typeof fetch }` in `src/app.d.ts` (the adapter's worker already uses it — `adapter-cloudflare/files/worker.js:50`) |
| `fetch('${url.origin}/og.svg')` | 1 external subrequest | ⚠️ Works and does **not** loop — `/og.svg` is in `_routes.json`'s `exclude` list (verified in `.svelte-kit/cloudflare/_routes.json`), so the request is served by the Pages static handler and never re-enters the Worker. But it burns a subrequest on the worst-case path and adds latency to the slowest case |

**Recommendation:** inline the 1.9 KB SVG string in a `$lib/proxy/og-fallback.ts` constant. It is the shortest diff *and* the fastest path *and* removes any loop/binding/typing question.

**Should the fallback be a raster?** Yes ideally — but note carefully: **this is a pre-existing condition, not something Phase 30 introduces.** Today every cover-less share already emits `og:image = ${SITE}/og.svg` (`PageOg.svelte:18`, `+layout.svelte:77`). So an SVG fallback in `/api/og` is byte-for-byte the current behavior. Adding `static/og.png` (1200×630) would be a genuine improvement, is a one-time committed asset, and needs no build toolchain in CI (macOS `qlmanage -t` can render it locally; `sips` and `rsvg-convert` are not viable/installed here). **Recommend: keep the SVG in this phase to preserve scope, and log a follow-up todo for the raster.** If the planner wants it in-phase, it is one `static/og.png` + one constant swap and it measurably improves cards on Slack/iMessage/Twitter — a good candidate for a `checkpoint:human-verify` task since the asset must be eyeballed.

### C.12 OG-EP-03 — exact extraction plan

**The `+server.ts`-verb-only constraint is real and confirmed:** SvelteKit validates route exports at manifest/request time (`node_modules/@sveltejs/kit/src/utils/exports.js`, driven by `PageNodes.validate()`), and the project's own recorded finding is unambiguous — `svelte-server-endpoint-only-verb-exports`: *"a top-level `export function` in a route 500s at request time (Invalid export); unit tests miss it (import module directly), E2E catches it — put helpers in `$lib/*.ts`."* The extraction is therefore **required**, exactly as CONTEXT states.

**Move these out of `src/routes/api/deezer/search/+server.ts` into `src/lib/proxy/deezer-cover.ts`:**

| Current location | Current name | New export signature |
|---|---|---|
| `:28` | `const DEEZER_SEARCH` | `const DEEZER_SEARCH` (module-private) |
| `:31` | `const TTL = 86400` | `export const DEEZER_COVER_TTL = 86400` |
| `:34-42` | `interface DeezerCover` | `export interface DeezerCover` |
| `:45-53` | `interface DeezerHit` | `export interface DeezerHit` |
| `:74-86` | `function safeImageUrl` | `export function safeDeezerImageUrl(raw: string \| null \| undefined): string \| null` — **renamed** (each tier gets its own allowlist; a bare `safeImageUrl` would be ambiguous once three exist) |
| `:115-127` | `function safePreviewUrl` | `export function safeDeezerPreviewUrl(raw): string \| null` |
| `:89-112` | `DzAlbum/DzArtist/DzResult/DeezerSearchResponse` | keep module-private (untrusted-JSON shapes; nothing outside needs them) |
| `:130-141` | `function reshapeHit` | module-private |
| `:149-162` | `function reshapeSearch` | `export function reshapeDeezerSearch(data: unknown, limit: number): DeezerCover` — widen the param to `unknown` and narrow inside, since `/api/og` will hand it a raw parsed body |
| `:179` (inline) | upstream URL construction | `export function deezerSearchUrl(q: string, limit = 1): string` |
| `:207-209` (inline) | fetch + parse | `export async function fetchDeezerCover(q: string, signal: AbortSignal, retries = 2): Promise<DeezerCover \| null>` — returns `null` on any fault (never-throw), `{ cover: null, … }` on a clean no-match. That two-valued return is what lets `/api/og` distinguish miss from error (§C.9) |

**Stays in `+server.ts`:** `jsonResult` (:58-65 — it is CORS/response shaping, route-specific), `GET` (:164-223), `OPTIONS` (:226-228), and all cache orchestration. `jsonResult` must keep emitting a byte-identical payload.

**Rewiring so behavior is provably unchanged:**

1. `+server.ts` imports the extracted names and its body becomes:
   ```ts
   const dz = await fetchDeezerCover(q, AbortSignal.timeout(8000), 2);
   if (!dz) return jsonResult({ cover: null, artistPicture: null }, origin);   // was the catch branch
   const result = dz;                                                          // was reshapeSearch(...)
   ```
   Same 8000 ms timeout, same `retries = 2`, same "no cache write on error", same `TTL` on success, same CORS re-application on a hit (WR-01, `:189-201`).
2. **The proof is the existing test file.** `src/routes/api/deezer/search/deezer-endpoint.test.ts` imports only `{ GET, OPTIONS } from './+server'` (`:3`) and stubs `global.fetch` + an in-memory `caches.default` (`:26-35`). It never touches an internal helper. Its 20 `it()` blocks already assert the exact reshape fallback order, the host allowlist, the CSS-breaker reject, the own-origin cache key, "no cache write on error", and the CORS scoping. **`pnpm vitest --run src/routes/api/deezer/search/deezer-endpoint.test.ts` passing unchanged, with zero edits to that file, is the behavior-preservation proof.** Make "do not modify `deezer-endpoint.test.ts`" an explicit task constraint.
3. Add a new `src/lib/proxy/deezer-cover.test.ts` for the now-directly-reachable helpers (previously only testable through the route).

**`safeImageUrl` extension — three separate functions, not one widened allowlist.** CONTEXT says "applied per tier", and that is the security-correct reading: a Deezer response must never be able to smuggle an `mzstatic.com` URL past the check, and vice versa. Copy the existing guard shape verbatim (the `/[)\s"'\\(]/` CSS/attribute-breaker reject at `:76` and the `https:`-only check at `:79` are load-bearing — keep both in all three):

```ts
// $lib/proxy/deezer-cover.ts
safeDeezerImageUrl  → host === 'cdn-images.dzcdn.net' || host.endsWith('.dzcdn.net')
// $lib/proxy/og-cover.ts (or itunes/kuwo siblings)
safeItunesImageUrl  → host.endsWith('.mzstatic.com')      // verified live: is1-ssl.mzstatic.com
safeKuwoImageUrl    → host.endsWith('.kuwo.cn')           // verified live: img1.kuwo.cn, img4.kuwo.cn
```

### C.13 Per-tier minimum request sequences (all measured live in this session)

**Tier 1 — Deezer (1 subrequest).**
```
GET https://api.deezer.com/search?q=<artist>+<title>&limit=1
→ { data: [ { album: { cover_xl, cover_big, cover_medium }, artist: { picture_xl, picture_big } } ], total }
```
Live: `q=Nirvana Come As You Are` → `cdn-images.dzcdn.net/images/cover/fe1082c5…/1000x1000-000000-80-0-0.jpg`. No-match is a clean `200 { data: [], total: 0 }` (documented at `+server.ts:11-12`, re-confirmed). Host: `cdn-images.dzcdn.net`. Keyless.

Measured byte sizes for the same cover:

| Variant | Bytes |
|---|---|
| `1000x1000-000000-80-0-0` (`cover_xl`) | 208,487 |
| `500x500-000000-80-0-0` (`cover_big`) | **72,650** |
| `264x264-000000-80-0-0` | 26,011 |

**→ For `/api/og`, prefer `cover_big` (500 px).** `reshapeDeezerSearch`'s existing `cover_xl ?? cover_big ?? cover_medium` order is correct for the *client* tiles and must not change (backward compat); `/api/og` should select `cover_big ?? cover_xl ?? cover_medium` instead. Cleanest: give `fetchDeezerCover` an optional `prefer: 'xl' | 'big'` argument defaulting to `'xl'` so `/api/deezer/search` is byte-identical.

**Tier 2 — iTunes (1 subrequest).** Reuse `buildItunesSearchUrl` (`itunes-cover.ts:49-56`) unchanged:
```
song:   buildItunesSearchUrl(`${artist} ${title}`, 'song')
album:  buildItunesSearchUrl(`${artist} ${title}`, 'album')
artist: buildItunesSearchUrl(artist, 'album', 'artistTerm')     // musicArtist carries no artwork — itunes-cover.ts:28-31
```
→ `results[0].artworkUrl100` = `https://is1-ssl.mzstatic.com/image/thumb/.../100x100bb.jpg`. Host `*.mzstatic.com`. CORS-open, keyless.

**Do NOT reuse `upgradeArtwork` (`itunes-cover.ts:63-67`)** — it swaps `100x100bb` → `1200x1200bb`. Measured:

| Token | Bytes |
|---|---|
| `100x100bb` | 4,667 |
| `600x600bb` | **101,186** |
| `1200x1200bb` | 332,091 |

`/api/og` needs a 600 variant. Either add an optional size parameter to `upgradeArtwork` (defaulting to `1200x1200bb` so the client is unchanged) or add a sibling `ogArtworkSize(url)` in the og module. Prefer the parameter — it keeps one token-swap implementation.

**Tier 3 — kuwo (1 subrequest — NOT 2).** This is better than CONTEXT assumed. `kuwoProxy.buildUrl('search', params, undefined)` (`proxy/kuwo.ts:25-31`) yields:
```
GET https://kw-api.cenguigui.cn/?name=<artist+title>&page=1&limit=1
```
and the **search** response already carries the cover in `data[n].pic` — confirmed by the client adapter reading exactly that field (`sources/kuwo.ts:82`: `cover: it.pic || null`). Live probe for `name=稻香&limit=2`:
```json
{ "code": 200, "msg": "单曲搜索成功",
  "data": [ { "rid": 440613, "pic": "https://img4.kuwo.cn/star/albumcover/600/s4s0/93/1794217775.jpg",
              "name": "稻香", "artist": "周杰伦", "album": "魔杰座" }, … ] }
```
**No `detail` call is needed.** Cover host: `img1.kuwo.cn` / `img4.kuwo.cn` → allowlist `*.kuwo.cn`. The path already contains `/600/` — measured **103,674 bytes**, already the right size class. Drift guard: treat `code !== 200` or a non-array `data` as an **error** (matching `sources/kuwo.ts:66-68`'s deliberate throw-on-drift), and an empty `data` array as a **miss**.

Call `kuwoProxy.buildUrl` directly rather than fetching `/api/kuwo/search` — a self-origin HTTP hop would double the subrequest count and re-enter the Worker.

**Total worst case: 3 external subrequests + 1 image fetch = 4.** Well inside the free-tier 50.

### C.14 Cloudflare limits that actually bind

| Limit | Free-tier value | Binds here? |
|---|---|---|
| External subrequests per invocation | **50** [CITED: developers.cloudflare.com/changelog/2026-02-11-subrequests-limit — free plan "remains limited to 50 external subrequests"] | No. Worst case 4 |
| Subrequests to Cloudflare services | 1000 | No. `caches.default` and `env.ASSETS` are bindings, not external subrequests |
| **CPU time per invocation** | **10 ms** | **Yes — for OG-ZH-01 only.** `/api/og` itself is ~0 CPU (streaming pass-through + one small JSON parse). The s2t dict is what threatens this (§E.17) |
| Script startup time | 400 ms | Only relevant if the s2t dict were statically imported. It isn't (dynamic `import()`) |
| Worker bundle size | 3 MB compressed | Not binding — the s2t chunks (~159 KB gzip server-side) are **already** in the deployed bundle today (`.svelte-kit/output/server/chunks/s2t-*.min.js` appear in the current `pnpm build` output), so OG-ZH-01 adds **zero** bundle bytes. The CONTEXT's framing of this as a bundle-size question is the wrong axis; it is a CPU question |
| Isolate memory | 128 MB | Not binding at ≤332 KB per image, but see the `CACHE_BYTES_CAP` guard (§C.10) |

**`caches.default` semantics.** Cloudflare's Cache API is available in Pages Functions / adapter-cloudflare Workers, and the repo already depends on it across 11 proxy routes via `edgeCache()`. Three things to know:

1. **`edgeCache()` returns `null` under `vite dev`** (`edge-cache.ts:26-28` — `typeof caches === 'undefined'`), so local `pnpm dev` always hits live upstream. Confirmed by design, and it means cache behavior is **not** exercised by `pnpm dev`.
2. **`wrangler pages dev` (i.e. `pnpm preview`, `package.json:22`) runs workerd/Miniflare with a *simulated* Cache** — "locally the Cache API works (you can store and retrieve values) but you're testing the API only, not the cache", and "limits are only enforced when deployed to Cloudflare's network, not in local development" [CITED: architectingoncloudflare.com/chapter-05, blog.cloudflare.com/wrangler3]. So `pnpm preview` **can** prove `cache.match`/`cache.put`/`clone()` mechanics and the streaming pass-through, but **cannot** prove TTL/eviction/edge-hit-rate or the 10 ms CPU limit.
3. `cache.put` requirements: GET only, no `Set-Cookie`, no `Vary: *`, no `206`. Our `hooks.server.ts:34-36` sets `Vary: Origin` (not `*`) **after** the route returns, so the copy written inside the route is CORS-free and header-clean — exactly the discipline `deezer/search/+server.ts:211-217` already documents (WR-01).

**`Cache-Control: public, max-age=86400, immutable`:** `immutable` is a client/browser hint (RFC 8246); Cloudflare's edge honors `max-age` for the `caches.default` entry. Both behave as CONTEXT assumes. [CONFIDENCE: MEDIUM — standard behavior, not separately re-verified this session]

---

## D. Crawler reality (OG-VERIFY-01)

### D.15 Per-platform `og:image` constraints

**⚠️ Source-quality warning:** only WhatsApp's constraint has an official source. Everything else below is from SEO/tooling blogs that are mutually consistent but not authoritative, and none of them document per-platform fetch timeouts with a citable number. Treat the timeout column as `[ASSUMED]`.

| Platform | Max bytes | Dimensions | SVG | Follows redirects on `og:image`? | Needs `og:image:width/height`? | Re-fetches `og:url`? |
|---|---|---|---|---|---|---|
| **WhatsApp** | **< 600 KB** [CITED: developers.facebook.com/documentation/business-messaging/whatsapp/link-previews/ — "This image should be under 600KB in size"] | ≥300 px wide, aspect ≤ 4:1 (official, same source) | ❌ | **Not reliably** — "the image URL should return 200 with no redirects" [CITED: previewog.com/fix-whatsapp-link-preview-not-working, metablast.dev] | No | Unclear — official doc says previews are best-effort and "should not be relied on" |
| **Twitter / X** (`summary_large_image`) | ~5 MB | 1.91:1 preferred; crops other ratios | ❌ | Partial/unclear | No (card type implies it) | No |
| **iMessage / Apple** | not documented | 1200×630 works | ❌ (og.svg's own comment names iMessage) | **Fussy — assume no** | No | Yes-ish (Apple's fetcher is aggressive about canonical) |
| **Slack** | not documented | 1200×630 | ❌ (og.svg's comment names Slack) | Generally yes | No | Yes — Slack unfurls `og:url` |
| **Discord** | ~8 MB | 1200×630 | ❌ | Generally yes | No | No |
| **Telegram** | not documented | 1200×630 | ❌ | Generally yes | No | No |
| **Facebook** (`facebookexternalhit`) | ~8 MB | 1200×630 | ❌ | Yes, "up to a reasonable limit" | Recommended (speeds first render) | Yes — canonicalizes to `og:url` |

Sources: [previewog.com/og-image-guide](https://previewog.com/og-image-guide/), [ogimagen.com/guides/og-image-sizes-2026](https://ogimagen.com/guides/og-image-sizes-2026), [imagedimensions.com/guides/open-graph-image-size](https://imagedimensions.com/guides/open-graph-image-size), [myog.social/bots/facebookexternalhit](https://myog.social/bots/facebookexternalhit).

**Four concrete consequences for the plan:**

1. **The LOCKED "stream, don't 302" decision is independently validated.** "If your og:image returns a 301 or 302 instead of the actual bytes, you get a blank preview. Serve the image directly — 200 response, no redirect." This is the single most-corroborated crawler fact in the set.
2. **Every measured cover fits WhatsApp's official 600 KB** (max 332 KB), so no tier is disqualified. But the 500–600 px variants (73–104 KB) are 2–4× faster and buy margin against the undocumented-but-widely-reported short fetch timeout. **Use them.**
3. **SVG fallback is a known-broken card image on Slack/iMessage/Twitter, and that is the status quo, not a Phase 30 regression** (§C.11).
4. **Aspect ratio: album covers are square (1:1), not 1.91:1.** WhatsApp's official "≤4:1" is satisfied. Twitter's `summary_large_image` will center-crop a square to 1.91:1, losing the top and bottom ~24%. **This is exactly today's behavior** (`og:image` = the raw square cover URL via `?c=`), so no regression. Because the image is now square, PageOg must **not** emit `og:image:width=1200 / height=630` — those values are only correct for the `/og.svg` fallback and are (correctly) confined to the root layout's fallback block (`+layout.svelte:78-79`). PageOg emits none today; keep it that way, or emit the true square dimensions.

**Hedges for the unverifiable timeout claims:** (a) keep the 2.5 s overall deadline — it is comfortably inside even a pessimistic 3 s crawler budget; (b) make the first crawl of a hot link cheap by warming nothing and relying on `caches.default` (a second crawler for the same link pays ~0); (c) the fallback path costs 0 subrequests so the worst case is fast, not slow.

### D.16 What can be verified where — concrete split

**Sandbox network reality, re-measured this session (this corrects a stale memory note):**

| Upstream | Reachable here? | Evidence |
|---|---|---|
| Deezer (`api.deezer.com`, `cdn-images.dzcdn.net`) | ✅ | search JSON + 208 KB image, both 200 |
| iTunes (`itunes.apple.com`, `is1-ssl.mzstatic.com`) | ✅ | search JSON + all three artwork variants, 200 |
| **kuwo (`kw-api.cenguigui.cn`, `img*.kuwo.cn`)** | ✅ **YES** | full `code:200` result set + 104 KB image. **Contradicts the `sandbox-no-cn-upstream-network` memory note**, which is about the netease/qq Meting proxies (`api.qijieya.cn`, `tang.api.s01s.cn`) — kuwo uses a different host |
| netease (`api.qijieya.cn` Meting) | untested via proxy | out of scope for this phase |

**So all three `/api/og` tiers are E2E-verifiable in-sandbox.** OG-VERIFY-01's caveat can be relaxed — the kuwo tier does **not** need to be deferred to a device check for resolve correctness. Note the honest asterisk: sandbox network reachability can change, so the plan should still keep the kuwo tier's *unit* test (stubbed fetch) as the authoritative gate and treat the live probe as corroboration.

| Verification | Mechanism | Proves |
|---|---|---|
| Encode/decode round-trip, all §B.7 stress cases | `share.test.ts` (vitest, node) | OG-PATH-01/02 |
| `matchKey` invariance under hyphen loss | `share.test.ts` | §B.8's core claim |
| Legacy URL shapes still emitted/parsed | `share.test.ts` | OG-COMPAT-01 |
| Tier fallthrough, deadline, miss-vs-error, per-tier `safeImageUrl` reject, cache key, "no cache write on error", never-500 | new `src/routes/api/og/og-endpoint.test.ts` — stub `global.fetch` + in-memory `caches.default`, copy the `fakeEvent` helper from `deezer-endpoint.test.ts:26-35` | OG-EP-01/02 |
| Deezer extraction is behavior-preserving | existing `deezer-endpoint.test.ts` passing **unmodified** | OG-EP-03 |
| Route coexistence, param decoding, both builds | `pnpm check` + `pnpm build` + `pnpm build:native` (all three verified green this session with the new routes present) | OG-PATH-01, OG-COMPAT-01 |
| **Real SSR head bytes** for the new routes | `pnpm dev` + `curl -s http://localhost:5173/song/Nirvana/Come-As-You-Are \| grep 'og:'` — proves the meta tags are in the **server** HTML, which no unit test can | OG-PAGE-01, OG-PATH-01 |
| **Live tier chain, streaming, `Content-Type`** | `pnpm dev` + `curl -sI 'http://localhost:5173/api/og?type=song&artist=Nirvana&title=Come+As+You+Are'` — Deezer/iTunes/kuwo all reachable. Note `edgeCache()` is `null` here so caching is bypassed | OG-EP-01 (resolve), partially OG-EP-02 (stream) |
| **`caches.default` mechanics, `clone()`, `waitUntil`** | `pnpm preview` (= `wrangler pages dev`, real workerd + simulated Cache) | OG-EP-02 cache layers |
| **Actual crawler cards** | ❌ **Requires a deployed URL.** Facebook Sharing Debugger, Twitter Card Validator, `curl -A 'facebookexternalhit/1.1'`, then paste the real link into WhatsApp / iMessage / Slack / Discord | OG-VERIFY-01's "real-crawler check" — **human, post-deploy** |
| Edge CPU / cold-isolate cost, real TTL/eviction | ❌ deployed only (limits aren't enforced locally) | OG-ZH-01 risk if it were taken |

**Human-gated items (put them in the plan as `checkpoint:human-verify`):** the messenger card check across ≥3 platforms, and — if a raster fallback is added — eyeballing `og.png`.

---

## E. OG-ZH-01 — the one OPEN decision

### E.17 Recommendation: **retire `dn`/`da` and do NOT convert server-side.** Drop the conversion, not just the carriers.

**Can `zh-convert.ts` run under workerd?** Yes. Three sub-questions, all answered:

1. **Node-only APIs?** No — but there *is* a DOM-global landmine that the existing code already dodges. `zh-convert.ts:41-45` documents it: importing the top-level `tongwen-core` index does `export * from './walker'`, whose eval-time code references `NodeFilter` (a DOM global). The module deliberately deep-imports `tongwen-core/esm/converter` and `tongwen-core/esm/dictionary` to avoid it. **workerd has no `NodeFilter` either**, so the existing deep-import discipline is exactly what makes an edge run possible — but it is fragile: any future refactor to a top-level import would break SSR the same way it broke the node Vitest project. That fragility is itself an argument against putting it on the edge path.
2. **Does `nodejs_compat` matter?** No. `wrangler.jsonc:4-6` already sets it, and neither `tongwen-core` nor the JSON dicts touch a Node builtin. It's irrelevant either way.
3. **Does dynamic `import()` work at request time on workerd?** Yes — SvelteKit's own Cloudflare manifest lazily `import()`s every route node per request. Not a blocker.

**So the question is purely cost. I measured it.**

| Measurement | Value | Source |
|---|---|---|
| s2t **char** dict, server chunk | 87.82 KB raw / **35.58 KB gzip** | `pnpm build` output, `.svelte-kit/output/server/chunks/s2t-char.min.js` |
| s2t **phrase** dict, server chunk | 319.52 KB raw / **123.43 KB gzip** | same build |
| **Total dict weight** | **~407 KB raw / ~159 KB gzip** | ⚠️ **CONTEXT.md and ROADMAP.md both say "~72KB". That figure is the char dict alone (client chunk = 72,539 B raw). The real number is ~5× larger.** |
| Dict entry counts | 2,504 char + 7,186 phrase | Vitest probe |
| `JSON`/module import + parse | ~200 ms (Vitest, includes on-the-fly transform — an upper bound, not representative) | Vitest probe |
| **`createConverterMap()` — pure JS CPU** | **8.90 ms** | Vitest probe on an M-series Mac |
| Convert one line (warm) | 0.084 ms first, 0.015 ms after | Vitest probe |

**The binding number is `createConverterMap()` at 8.90 ms against a 10 ms free-tier CPU budget** — measured on fast local hardware, before counting the evaluation of ~407 KB of dict module code, which also lands in the triggering request's CPU accounting on workerd. On a cold isolate this request plausibly exceeds 10 ms and is terminated (CF error 1102). The cost is once-per-isolate, not once-per-request — but a crawler hit on a low-traffic share link is *precisely* the request most likely to land on a cold isolate. That is the worst possible place to put this.

**Also note: the bundle-size framing in CONTEXT is the wrong axis.** The dict chunks are **already in the deployed server bundle today** (they appear in the current `pnpm build` server output because `zh-convert` is reachable from the SSR module graph). OG-ZH-01 adds zero bytes; it adds *execution*.

**And there is a lazier answer that CONTEXT didn't consider: the conversion doesn't need to happen at all.**

`dn`/`da` exist because `entityCardUrl` is handed a *client-converted* display name (`album/[name]/+page.svelte:434-438`, `artist/[name]/+page.svelte:176-178`) while the path must keep the *literal* name as the resolution key. But ask what the carriers actually buy:

- The OG card is rendered **once, server-side, for every recipient of the link.** Baking the *sharer's* `settings.titleLang` preference into a public URL means one user's language setting decides what a card looks like for everyone who sees it. That is arguably wrong on its own terms.
- The **in-app page** converts per the *viewer's* own setting on hydration, via the `names` store (`names.svelte.ts:204`, `:215`). Dropping `dn`/`da` changes **nothing** about what either party sees inside the app.
- Only the static crawler card changes: it renders the catalog's original script instead of the sharer's converted script.

**Recommendation, stated firmly:**

> **Drop `dn` and `da`. Do not add server-side s2t. Additionally, stop converting at share time** — remove the `s2tConvertLines` calls from `entityCardUrl`'s callers (`album/[name]/+page.svelte:434-438`, `artist/[name]/+page.svelte:176-178`) and from `TrackMenu.svelte:177-180`, so all three surfaces put the **literal** (original-script) title/artist in the path.

Five reasons:

1. **Cost lands on exactly the request class the whole endpoint design exists to protect** (cold-isolate crawler fetch, 10 ms free-tier CPU). Measured 8.9 ms of pure CPU before module eval.
2. **It achieves the phase's headline goal literally** — zero query carriers on every surface. Option (a) leaves `dn`/`da` alive and makes "carrier-free" false.
3. **It deletes code instead of adding an edge dependency** — three call sites lose an `await`, and `share.ts`'s `displayName`/`displayArtist` params disappear. That is the shortest diff of any option.
4. **It removes a pre-existing resolution risk on the song surface.** Today `songShareUrl` receives the *converted* title/artist (`TrackMenu.svelte:177-180`) and those become `?n=`/`?a=`, which `resolveAndPlay` feeds straight into `playStub` (`song/[slug]/+page.svelte:49`). So the recipient's `searchAll` query is currently *Traditional* while the CN sources index mostly Simplified. Putting the literal in the path makes the path an unambiguous resolution key on all three surfaces. This is a quiet **improvement**, not just a wash.
5. **It removes the `NodeFilter` fragility from the edge path entirely** (see sub-question 1).

**Accepted regression, name it in the plan:** a Traditional-preferring sharer's *crawler card* now shows the catalog's original script (often Simplified). The in-app experience is unchanged for both parties.

**Upgrade path if that regression is ever rejected:** it is small and isolated — gate a dynamic `import('$lib/services/zh-convert')` in the loader behind `isChineseLine(name)` so the dict only ever loads for a Chinese name, and accept the cold-isolate CPU spike on that narrow slice. **Do not do it in this phase.** Log it as a todo.

**If the planner overrides me and takes option (a) (server-side convert), these are mandatory:** gate the dynamic import on `isChineseLine()` so non-Chinese links never pay; import the **char dict only** (`createConverterMap({ s2t: [charMod.default] })`) to cut ~78% of the entries and most of the 8.9 ms — losing 头发→頭髮 phrase quality, which barely matters for song/artist names; wrap in the existing never-throw identity fallback (`zh-convert.ts:143-145`); and add a deployed-URL CPU check before shipping, because local runs cannot surface a 1102.

---

## F. OG-PAGE-01 + existing-behavior risk

### F.18 `PageOg.svelte` fixes

Current state (`src/lib/components/PageOg.svelte`):
```ts
const SITE = "https://openmusic.lol";              // :17  hardcoded
const FALLBACK_IMG = `${SITE}/og.svg`;             // :18
const url = $derived(`${SITE}${page.url.pathname}`); // :19
…
<meta property="og:type" content="music.song" />    // :31  hardcoded for EVERY route
```

**Origin derivation.** `page.url.origin` is fully populated during a Cloudflare SSR render — `$app/state`'s `page` is server-provided, and the root layout already reads `page.url.pathname` inside its own `<svelte:head>` during SSR (`+layout.svelte:16`, `:62`) with no issue. So:

```ts
// OG-PAGE-01: derive the origin from the request so a link shared from openmusic.pages.dev
// (or a preview deploy) emits a same-origin og:url / og:image. Fall back to the primary
// domain if origin is somehow empty — og:image MUST stay an ABSOLUTE URL (crawlers reject
// relative), which is why we build it here rather than emitting a bare path.
const SITE_FALLBACK = 'https://openmusic.lol';
const origin = $derived(page.url.origin || SITE_FALLBACK);
const url = $derived(`${origin}${page.url.pathname}`);
const image = $derived(og.image ?? `${origin}/og.svg`);
```

**SSR gotcha to know but not fear:** none blocking. `page.url` is available in SSR (proven by the existing root-layout usage). The one thing to avoid is deriving the origin from `location`/`window` — SSR would crash. `og.image` itself should be built in the **loader** (which receives `url` in the `load` args and works identically on server and client nav), not in the component, so the component stays a pure emitter. That keeps `buildOg`'s contract intact.

**`og:type` per surface.** Thread it through the `og` object (the `pageog-hardcoded-site-origin.md` todo recommends exactly this):

```ts
// share.ts — widen buildOg's return, or add an optional input
type OgType = 'music.song' | 'music.album' | 'profile';
```
| Route | `og:type` |
|---|---|
| `song/[artist]/[title]` and `song/[slug]` | `music.song` |
| `album/[artist]/[name]` and `album/[name]` | `music.album` |
| `artist/[name]` | `profile` |

Make the prop optional with a `'music.song'` default so no caller breaks mid-refactor, then set it in all five loaders. Note the root layout's fallback block emits `og:type = website` and is gated on `{#if !page.data?.og}` (`+layout.svelte:70-85`), so exactly one `og:type` renders per route — that invariant is preserved.

**Do not emit `og:image:width` / `og:image:height` from PageOg.** The streamed cover is square (1000×1000 / 600×600 / 1200×1200), so the root layout's 1200×630 values would be wrong. They correctly live only in the fallback block. (§D.15)

**Out of scope but worth one line:** `+layout.svelte:12-16` has the *same* hardcoded-`SITE` bug for `<link rel="canonical">` and the fallback `og:*`. CONTEXT scopes OG-PAGE-01 to `PageOg`. Log a todo rather than widening the phase.

**🔴 NATIVE-BUILD TRAP in the `<img>` swap.** OG-PAGE-01 replaces `<div class="cover cover--placeholder">` (`song/[slug]/+page.svelte:66`) with `<img src={data.og.image}>`. Under the **Capacitor build** the loader runs client-side in a WebView whose origin is `https://localhost`, so `data.og.image` becomes `https://localhost/api/og?…` → **broken image in the APK**, exactly the class of bug `api-base.ts` exists to prevent (its posture doc, `api-base.ts:5-12`, describes precisely this failure). Two fixes:

- **Recommended:** build the `<img src>` client-side via `apiUrl('/api/og?…')` (`api-base.ts:26-29`), which resolves to `VITE_API_BASE` (`https://openmusic.lol`) on native and stays relative on web. Keep `data.og.image` (the absolute, origin-derived form) for the meta tag only.
- Or: gate the `<img>` behind `!Capacitor.isNativePlatform()` and keep the gradient on native.

Either way this must be an explicit task, and CONTEXT's "native/Capacitor work is out of scope" does **not** cover it — this is a web change that *breaks* native if unguarded. Also add `onerror` → fall back to the gradient (CONTEXT lists this as discretion; take it — a broken `<img>` is worse than a gradient, and the repo already has the `healCover` precedent for treating a cover error as a first-class event).

### F.19 Complete call-site inventory

**Share-URL builders (must change):**

| Site | Current | Action |
|---|---|---|
| `src/lib/services/share.ts:181-193` `songShareUrl` | `${base}/song/${slug}?n=&a=&c=` | Emit `${base}/song/${encodePathSegment(artist)}/${encodePathSegment(title)}`. Drop `cover` from the signature — it only fed `c` |
| `src/lib/services/share.ts:208-228` `entityCardUrl` | `${base}/{type}/${encodeURIComponent(name)}?artist=&c=&dn=&da=` | album → `${base}/album/${encodePathSegment(artist)}/${encodePathSegment(name)}`; artist → `${base}/artist/${encodePathSegment(name)}`. Drop `cover`, `displayName`, `displayArtist` from the signature |
| `src/lib/components/TrackMenu.svelte:159-186` `doShare` | s2t-converts, reads `readCoverByUidOrName`, passes `cover` | Drop the `cover` read and (per §E.17) the two `s2tConvertLines` calls |
| `src/routes/(app)/album/[name]/+page.svelte:415-458` `shareAlbum` | s2t-converts `name`/`albumArtist`, passes `heroImg` + `displayName`/`displayArtist` | Same simplification. Keep the `navigator.share` / clipboard branch and the `busyAction` guard verbatim |
| `src/routes/(app)/artist/[name]/+page.svelte:163-180` `shareArtist` | s2t-converts `name`, passes `heroImg` + `displayName` | Same |

**Query-carrier readers (must keep working — OG-COMPAT-01):**

| Site | Reads | Action |
|---|---|---|
| `src/routes/(app)/song/[slug]/+page.ts:48-51` | `n`, `a`, `c` | **Keep verbatim** as the legacy handler. Set `og.type = 'music.song'` |
| `src/routes/(app)/album/[name]/+page.ts:22-31` | `artist`, `c`, `dn`, `da` | Keep the query reads; **delete the double `decodeURIComponent`** (§A.3); set `og.type = 'music.album'` |
| `src/routes/(app)/artist/[name]/+page.ts:22-29` | `c`, `dn` | Same; `og.type = 'profile'`. This route's **path shape is unchanged**, so it is simultaneously the new *and* the legacy handler — it must accept both a carrier-free URL and a `?c=&dn=` URL |
| `src/routes/(app)/album/[name]/+page.svelte:50, 54` | `params.name` (double-decoded), `?artist=` | Delete the redundant decode; keep `?artist=` reading (the legacy link and the internal nav link both use it) |
| `src/routes/(app)/+page.ts:15` | `?play=` | **Do not touch** (out of scope) |
| `src/routes/(app)/library/+page.svelte:54, 70` | `?tab=`, `?playlist=` | Unrelated |

**🔴 Internal navigation links that will silently break if the legacy album route is removed** — these are *not* share links, so nothing flags them:

| Site | Emits | Risk |
|---|---|---|
| `src/routes/(app)/artist/[name]/+page.svelte:464` | `goto('/album/' + encodeURIComponent(al.name) + '?artist=' + encodeURIComponent(name))` | **The only in-app path to an album page.** It uses the 1-segment `?artist=` shape. Either keep the legacy route (LOCKED — so this is safe as-is) **or** update it to the 2-segment shape. Recommend updating it too, so in-app nav and shared links land on the same route and the 2-segment loader actually gets exercised in normal use |
| `src/routes/(app)/album/[name]/+page.svelte:499` | `goto('/artist/' + encodeURIComponent(albumArtist))` | Safe — artist shape unchanged |
| `TrackMenu.svelte:130`, `NowPlaying.svelte:633`, `library/+page.svelte:299`, `search/+page.svelte:655`, `+page.svelte:739/780/797/957/971`, `artist/[name]/+page.svelte:533` | `/artist/${encodeURIComponent(name)}` | All safe — artist shape unchanged. **But** every one of these hand-rolls `encodeURIComponent` where `encodePathSegment` is now the canonical encoder. They currently emit `%20` for spaces rather than `-`; both decode correctly *if* the loader stops re-decoding and treats `-`↔space symmetrically. **Flag:** a name with a space arriving as `%20` decodes to `A B`; arriving as `A-B` also decodes to `A B`. Consistent. No change strictly required, but routing them through `encodePathSegment` removes the divergence |

**Dead code observed (do not touch, out of scope):** `entityShareUrl` (`share.ts:250-259`) and `parseEntityParam` (`share.ts:274-283`) have **no remaining production callers** — only `share.test.ts` and explanatory comments (`album/[name]/+page.svelte:424`, `artist/[name]/+page.svelte:166`). CONTEXT explicitly keeps them. Worth a todo, not a task.

**Also silently affected:** `static/sitemap.xml` (539 B) — it does not enumerate entity routes today, so no change needed, but confirm.

### F.20 Existing test assertions that hardcode the current URL shapes

All in `src/lib/services/share.test.ts`. Every one below must change or be re-scoped to a legacy-shape test:

| Line(s) | Assertion | Fate |
|---|---|---|
| `:158-161` | `url.endsWith('/song/dao-xiang-jay-chou?n=Dao%20Xiang&a=Jay%20Chou')` | **Rewrite** → `endsWith('/song/Jay-Chou/Dao-Xiang')` |
| `:163-168` | `/song/s?` placeholder for an all-CJK title; `not.toContain('/song/?')` | **Rewrite** → CJK path segments; `'-'` guard replaces `'s'` |
| `:170-176` | no `play=`; `parseEntityParam(lastSegment)` is null | **Keep** the spirit; the last segment is now the encoded title |
| `:178-183` | `decodeURIComponent(q.get('n')) === '稻香'` | **Delete** — no query params. Replace with a path-segment round-trip assertion |
| `:185-190` | `q.get('a') === ''`, `q.get('n') === 'Solo'` | **Rewrite** → empty artist yields the `-` guard segment |
| `:192-196` | `q.get('c') === 'https://cdn/x.jpg'` | **Delete** — `c` is gone |
| `:198-202` | non-https / null / missing cover omits `c` | **Delete** — `cover` leaves the signature |
| `:206-212` | album path is `encodeURIComponent('范特西')` and decodes back | **Rewrite** → 2-segment `/album/周杰倫/范特西` |
| `:214-217` | `q.get('artist') === 'B'` | **Rewrite** → artist is now segment 1 |
| `:219-223` | artist type: `endsWith('/artist/Jay')`, no `artist=` | **Keep** (still true) — but assert no query at all |
| `:225-229` | https cover as `c`, non-https omitted | **Delete** |
| `:231-238` | `dn`/`da` carried only when they differ | **Delete** (per §E.17) |
| `:240-245` | `da` is album-only | **Delete** |
| `:247-250` | bare literal path with no query | **Keep and strengthen** — this becomes the headline "zero carriers" assertion for every surface |
| `:38-67` (`slugify` block) | ASCII-strips, CJK → `''`, 60-char cap | **Keep unchanged.** `slugify` is still exported and still used by `shareUrl` (`share.ts:158`) and `entityShareUrl` (`:255`), both out of scope. Do **not** delete it |
| `:366-392` (`buildOg` / `isHttpsUrl`) | `Song • Artist`, tagline, https gating | **Keep**; add cases if `buildOg` grows an `og:type` |
| `:253-364` (`entityShareUrl`/`parseEntityParam`) | all | **Keep unchanged** — out of scope |

**No other test file references these URL shapes** — verified: no test exists for the three entity loaders, `TrackMenu`, or the album/artist pages. That is itself a Wave 0 gap (§G).

**New tests required:** `src/routes/api/og/og-endpoint.test.ts`, `src/lib/proxy/deezer-cover.test.ts`, and loader tests for the two new routes plus the three legacy loaders (co-locating a `*.test.ts` inside a route directory is established practice — `src/routes/api/deezer/search/deezer-endpoint.test.ts` — and SvelteKit ignores non-`+`-prefixed files in route dirs).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Decoding a route param | `decodeURIComponent(params.x)` | Read `params.x` directly | SvelteKit already did it (`utils/routing.js:304`). Double-decoding is a live 500 (§A.3) |
| Percent-encoding a path segment | A custom char map | `encodeURIComponent` + the two guards in §B.6 | Handles CJK/emoji/RTL byte-correctly; only `.`-only and empty segments need help |
| Per-request timeouts | `setTimeout` + `AbortController` | `AbortSignal.timeout` / `AbortSignal.any` | Already the repo's stated rule (`http.ts:3-4`); `itunes-cover.ts:76-81` has the `AbortSignal.any` feature-detect to copy |
| Retry with backoff | A retry loop | `fetchWithRetry` (`http.ts:52-80`) — but pass `retries = 0` for `/api/og` | 150–300 ms backoffs don't fit a 2.5 s deadline |
| CORS on `/api/og` | Per-route headers | `hooks.server.ts:19-41` handles every `/api/*` | Single seam; a second mechanism would double headers |
| Cache accessor | `typeof caches !== 'undefined' && caches.default` | `edgeCache()` (`edge-cache.ts:26-29`) | The repo's one `typeof caches` guard, by design |
| Cache key | The upstream URL | `ownOriginCacheKey()` (`edge-cache.ts:37-39`) | Prevents a secret-bearing upstream URL becoming a cache key |
| Serving both cache and client from one body | Reading the body twice, or `tee()` | `clone()` **with a byte cap** (§C.10) | `tee()` has the same buffering behavior; the cap is what bounds it |
| Artist/title normalization for a cache key | A bespoke slug | `matchKey()` (`match-key.ts:37`) | Already the canonical normalization; makes layer 1 collapse param-order variants |
| An OG image renderer (`@vercel/og`, satori, resvg) | Any of them | Stream a real album cover | CLAUDE.md forbids new runtime deps; the covers already exist and are the right content |
| Reimplementing the Deezer reshape in `/api/og` | A second copy | `reshapeDeezerSearch` from `$lib/proxy/deezer-cover.ts` | The entire point of OG-EP-03 |

**Key insight:** almost every primitive this phase needs is already in-repo and already carries a decision-ref comment explaining a threat it mitigates. The lowest-risk plan is a *composition* exercise. The only genuinely new code is the tier chain, the two encode/decode helpers, and the route files.

---

## Common Pitfalls

### Pitfall 1: Double-decoding a route param
**What goes wrong:** HTTP 500 (`URIError: URI malformed`) on any title/artist containing a literal `%`.
**Why:** SvelteKit's `decode_params` already ran (`utils/routing.js:304`). The existing loaders decode again.
**Avoid:** never call `decodeURIComponent` on `params.*`. Delete the three existing calls.
**Warning sign:** `decodeURIComponent(params.` anywhere. **Live-reproduced this session:** `/album/50%25%20Off` → 500.

### Pitfall 2: A dot-only or empty path segment
**What goes wrong:** 404, silently — the link is dead and looks like a routing bug.
**Why:** WHATWG URL normalizes `.`, `..` **and their percent-encoded forms** away before the request reaches the server; SvelteKit's `([^/]+?)` requires ≥1 character.
**Avoid:** the two guards in `encodePathSegment` (§B.6).
**Warning sign:** a share test that only covers ASCII words. **Live-reproduced:** `/song/Nirvana/..` and `/song/Nirvana/%2E%2E` both 404.

### Pitfall 3: `response.clone()` buffering the whole body
**What goes wrong:** the "streaming, ~0 CPU" promise silently becomes "buffer everything"; an unbounded upstream could exhaust isolate memory.
**Why:** Cloudflare docs are explicit — `clone()` buffers rather than streams, and `cache.put` consumes the body it is given.
**Avoid:** clone only when `Content-Length` is present and under an explicit cap; hand the **clone** to the cache and the **original** to the client; prefer `ctx.waitUntil`.
**Warning sign:** `cache.put(key, response)` where `response` is also returned.

### Pitfall 4: A `+server.ts` exporting a non-verb
**What goes wrong:** 500 at request time (`Invalid export`); **unit tests do not catch it** because they import the module directly.
**Why:** SvelteKit validates route exports at request time.
**Avoid:** helpers live in `$lib/*.ts`. This is the whole reason OG-EP-03 exists.
**Warning sign:** any `export` in a `+server.ts` that isn't `GET`/`POST`/`OPTIONS`/…. Detect with a live `curl`, not a unit test. [VERIFIED: project finding `svelte-server-endpoint-only-verb-exports`]

### Pitfall 5: A `+page.server.ts` on a share route
**What goes wrong:** the `adapter-static` native build fails or silently drops the route.
**Why:** `should_prerender_data()` keys off `node?.server?.load`; adapter-static cannot fulfil a server load.
**Avoid:** universal `+page.ts` only. Restate this in every new loader's header, as the three existing loaders do (T-24-09).
**Warning sign:** `pnpm build:native` erroring where `pnpm build` passed.

### Pitfall 6: Using `upgradeArtwork` for `/api/og`
**What goes wrong:** a 332 KB card image (measured), at the edge of WhatsApp's budget and slow on a mobile crawler.
**Avoid:** parameterize the token swap; request `600x600bb` (101 KB) for `/api/og` and leave `1200x1200bb` for client tiles.

### Pitfall 7: The `<img>` swap breaking the APK
**What goes wrong:** the song share page shows a broken image on native (origin is `https://localhost`).
**Avoid:** build the `<img src>` through `apiUrl()` (`api-base.ts:26-29`), not from `data.og.image`. (§F.18)
**Warning sign:** an absolute `og:image` value reused as an in-app `<img src>`.

### Pitfall 8: Assuming `pnpm dev` exercises the cache
**What goes wrong:** cache-layer bugs ship because `edgeCache()` returns `null` under `vite dev` by design (`edge-cache.ts:26-28`).
**Avoid:** unit-test the cache with an in-memory `caches.default` stub (`deezer-endpoint.test.ts:279-347` shows exactly how), and use `pnpm preview` (real workerd) for mechanics. Neither proves TTL/eviction — that needs a deploy.

### Pitfall 9: The `tongwen-core` top-level import
**What goes wrong:** `NodeFilter is not defined` at eval time — in the node Vitest project **and** on workerd.
**Why:** `tongwen-core`'s index re-exports a walker that references a DOM global.
**Avoid:** if s2t ever runs at the edge, keep the deep submodule imports (`zh-convert.ts:47-52`). The safest avoidance is not running it at the edge at all (§E.17).

### Pitfall 10: Breaking in-app album navigation
**What goes wrong:** `artist/[name]/+page.svelte:464` is the only in-app route to an album page and it uses the 1-segment `?artist=` shape. If the legacy route is ever dropped, in-app album nav dies with no failing test.
**Avoid:** keep the legacy route (LOCKED) and update this link to the 2-segment shape so the new loader is exercised by ordinary use, not only by shared links.

---

## Code Examples

### Route file — new 2-segment song page loader
```ts
// src/routes/(app)/song/[artist]/[title]/+page.ts
// OG-PATH-01: carrier-free SONG share route. A crawler hitting /song/{artist}/{title} gets a
// per-song OG card baked into the SSR HTML, built ENTIRELY from the two decoded path segments —
// no query carriers at all (supersedes DQ-1/DQ-2's ?n=&a=&c= for the NEW shape; the legacy
// /song/[slug] handler keeps those verbatim, OG-COMPAT-01).
//
// D-01/D-03: UNIVERSAL +page.ts with ssr = true — a per-route SSR opt-in. The root +layout.ts
// stays ssr=false; NEVER a +page.server.ts (that breaks the adapter-static native build —
// Pitfall 5 / T-24-09).
//
// T-24-08 / SSRF: this loader performs NO fetch. og.image is a same-origin /api/og URL EMITTED
// into a meta tag; the crawler fetches it, and /api/og applies the per-tier host allowlist. The
// input is path TEXT, not a sharer-supplied https URL — a strictly tighter posture than ?c=.
//
// params.artist/params.title are ALREADY decodeURIComponent'd by SvelteKit (decode_params,
// utils/routing.js) — decoding again throws URIError on a literal '%' (that is a live 500 on the
// legacy /album/{name} route today). decodePathSegment only reverses the '-'-for-space transform.
import { buildOg, decodePathSegment, ogImageUrl } from '$lib/services/share';
import type { PageLoad } from './$types';

export const ssr = true;
export const prerender = false;

export const load: PageLoad = ({ params, url }) => {
	const artist = decodePathSegment(params.artist);
	const title = decodePathSegment(params.title);
	// Absolute (origin-derived) so the meta tag is crawler-valid from ANY deploy origin.
	const image = ogImageUrl(url.origin, 'song', artist, title);
	const og = { ...buildOg({ title: title || 'openmusic', artist: artist || undefined, cover: image }), type: 'music.song' as const };
	return { og, name: title, artist };
};
```

### `/api/og` tier chain (shape)
```ts
// src/lib/proxy/og-cover.ts — OG-EP-01. Lives OUTSIDE +server.ts because a route file may only
// export HTTP verbs (a non-verb export 500s at request time and unit tests miss it).
//
// Tiers run SEQUENTIALLY, not in parallel: the preference order Deezer → iTunes → kuwo is the
// point, and a Deezer hit must cost exactly ONE subrequest. Each tier is never-throw and reports
// hit / miss / error separately — only a MISS is cacheable (an error must never be cached, the
// same discipline deezer/search/+server.ts:219-222 documents).
export async function resolveCoverTiered(
	type: 'song' | 'album' | 'artist',
	artist: string,
	title: string,
	deadline: AbortSignal
): Promise<string | null | 'ERROR'> {
	let sawError = false;
	for (const tier of [deezerTier, itunesTier, kuwoTier]) {
		if (deadline.aborted) break;
		const out = await tier(type, artist, title, deadline);   // never throws
		if (out.kind === 'hit') return out.url;                  // already safeXImageUrl'd
		if (out.kind === 'error') sawError = true;
	}
	// A clean all-miss is a cacheable negative; any tier error makes the negative untrustworthy.
	return sawError ? 'ERROR' : null;
}
```

### Endpoint test scaffold (copy the proven shape)
```ts
// src/routes/api/og/og-endpoint.test.ts — mirrors deezer-endpoint.test.ts:26-35 verbatim.
function fakeEvent(search: Record<string, string>) {
	const url = new URL('https://openmusic.lol/api/og');
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
	return { url, platform: undefined, request: new Request(url, { headers: { origin: 'https://openmusic.lol' } }) };
}
// Then: vi.stubGlobal('fetch', …) per tier, and vi.stubGlobal('caches', { default: inMemory })
// for the two cache layers — exactly as deezer-endpoint.test.ts:279-347 does.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `?c=<full cover URL>` in the shared link | Own-origin `/api/og` streaming endpoint | This phase | Kills 64% of the URL length; SSRF posture tightens (path text in, allowlisted host out) |
| Cosmetic ASCII `slugify` segment + authoritative query carriers | Raw-UTF-8 path segments as the authoritative key | This phase | CJK links become meaningful; `slugify` survives only for the out-of-scope `shareUrl`/`entityShareUrl` |
| `302` to an image for `og:image` | `200` + streamed bytes | Industry convention, reconfirmed | WhatsApp/iMessage don't reliably follow image redirects |
| SVG `og:image` | Raster (PNG/JPEG) | Long-standing | **SVG is unsupported by every major platform.** Pre-existing here; the real album cover fixes the common case, the branded fallback stays SVG this phase |
| Workers subrequest limit 1000 for everyone | Free plan still 50 external / 1000 CF-service | 2026-02-11 changelog | Confirms ≤4 subrequests is comfortable |

**Deprecated / stale in-repo:**
- `entityShareUrl` + `parseEntityParam` (`share.ts:250-283`) — no production callers remain.
- The `song/[slug]/+page.svelte:19` comment "The cover is never carried" — wrong since `quick-260723-r4p`. OG-PAGE-01 fixes it (todo `song-share-stale-cover-comment.md`).
- The `~72KB` s2t figure in CONTEXT.md and ROADMAP.md — measured at ~357 KB raw / ~153 KB gzip.
- The `sandbox-no-cn-upstream-network` note as applied to kuwo — `kw-api.cenguigui.cn` is reachable here.

---

## Runtime State Inventory

Rename/migration-shaped concerns for the share-URL surface:

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | **None** — no share URL is persisted anywhere. `localStorage` keys are `openmusic:player:v1`, `openmusic:library:v1`, `openmusic:cover-cache:v1`; the cover cache stores `uid:`/`matchKey`/`artist:` keys and cover URLs, never share links. Verified by grep of the localStorage key space | none |
| **Links already shared in the wild** | **The real "runtime state."** Every `?n=&a=&c=` / `?artist=&c=&dn=&da=` URL in someone's chat history must keep working forever | This *is* OG-COMPAT-01. Legacy handlers stay. Do not "clean up" the legacy query reads |
| Live service config | **None** — no external service holds a share URL. `static/sitemap.xml` (539 B) does not enumerate entity routes; verified | none |
| OS-registered state | **None** — no deep-link intent filters for these paths. `capacitor.config.ts` has no app-link config for `/song/*` | none |
| Secrets / env vars | **None added.** Deezer, iTunes and kuwo are all keyless (`deezer/search/+server.ts:167-168` states this explicitly). `platform.env` untouched | none |
| Build artifacts | `.svelte-kit/` regenerates; `build/` regenerates. `src/app.d.ts` **does** need edits if `ctx.waitUntil` (`:21`, currently commented out) or `env.ASSETS` are used | Uncomment `ctx?: ExecutionContext`; add `ASSETS` if the fallback goes via the binding |
| **Crawler-side caches** | Facebook / Twitter / Slack cache OG data per URL for hours-to-days. Because the new URLs are *new*, there is nothing stale to purge — but a card fix after a bad first crawl needs the Facebook Sharing Debugger's "Scrape Again" | Note in the human verification checkpoint |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | tooling | ✓ | v25.9.0 (`.nvmrc` requires ≥22) | — |
| pnpm | install/scripts | ✓ | 8.15.5 pinned | — |
| Vitest | all unit tests | ✓ | ^4.1.3, node project only | — |
| `svelte-check` | `pnpm check` | ✓ | ^4.4.6 | — |
| Vite dev server | live route/SSR probes | ✓ | **BOTH ports are real — resolve, don't assume.** A bare `pnpm dev` serves **:5173** (`vite.config.ts` sets no `port`/`strictPort`), but `.claude/launch.json` — what `preview_start` and the user's own running server use — passes `--port 4321 --strictPort`, so that path serves **:4321**. The "strictPort 4321" note is correct for the launch.json path, NOT stale. Every curl criterion in the plans is written against `:5173`; resolve the live port and substitute. | — |
| `wrangler pages dev` (`pnpm preview`) | workerd cache/stream mechanics | ✓ | wrangler 4.98.0 | Unit tests with an in-memory `caches.default` |
| Deezer API + CDN | tier 1 live probe | ✓ | — | stubbed unit test |
| iTunes Search + mzstatic | tier 2 live probe | ✓ | — | stubbed unit test |
| **kuwo `kw-api.cenguigui.cn` + `img*.kuwo.cn`** | tier 3 live probe | **✓** | — | stubbed unit test (keep it as the authoritative gate) |
| SVG→PNG rasterizer | optional `og.png` fallback | ⚠️ partial | `qlmanage` ✓ (macOS only), `sips` ✓ (poor SVG), `rsvg-convert`/ImageMagick/PIL ✗ | Keep the SVG fallback this phase; generate `og.png` locally as a one-time committed asset if wanted |
| Deployed URL + real messengers | OG-VERIFY-01 crawler check | ✗ | — | **No fallback — human, post-deploy** |

**Missing dependencies with no fallback:** the real-crawler check (needs a public deploy + a human with WhatsApp/iMessage/Slack).
**Missing dependencies with fallback:** SVG rasterizer — defer the raster fallback.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.3, single `server` (node) project — **no jsdom** |
| Config file | `vite.config.ts:6-22` (`include: ['src/**/*.{test,spec}.{js,ts}']`) |
| Quick run command | `pnpm vitest --run <path>` |
| Full suite command | `pnpm test` (`vitest --run`) |
| Type gate | `pnpm check` (`svelte-kit sync && svelte-check`) — the only other gate |

### Phase Requirements → Test Map

| Req ID | Observable signal that proves it works | Sampling point | Mechanism | File exists? |
|---|---|---|---|---|
| **OG-PATH-01** | `/song/{a}/{t}` and `/album/{a}/{n}` return 200 with the OG head in the **server** HTML; `svelte-kit sync` + both builds exit 0 | per task commit (`pnpm check`), per wave (browser preview) | `pnpm check` + `curl -s $DEV/song/Nirvana/Come-As-You-Are \| grep 'og:'` against `pnpm dev` | ❌ Wave 0 — new loader test `src/routes/(app)/song/[artist]/[title]/loader.test.ts` |
| **OG-PATH-02** | `songShareUrl`/`entityCardUrl` output contains **no `?`**; every §B.7 stress case round-trips; `matchKey` invariant holds under hyphen loss | per task commit | unit — `pnpm vitest --run src/lib/services/share.test.ts` | ⚠️ exists, needs the §F.20 rewrite |
| **OG-EP-01** | tier order Deezer→iTunes→kuwo; a miss falls through; the overall deadline aborts in-flight tiers; a tier error never 500s; `type` outside the closed set coerces | per task commit | unit — `src/routes/api/og/og-endpoint.test.ts` with stubbed `fetch` per tier. **Corroborate live:** `curl -sI "$DEV/api/og?type=song&artist=Nirvana&title=Come+As+You+Are"` (all three upstreams reachable) | ❌ Wave 0 |
| **OG-EP-02** | response is `200` (never `30x`), `Content-Type: image/*`, `Cache-Control: public, max-age=86400, immutable`; 2nd identical request served from `caches.default` with **no** second upstream fetch; the cached copy is CORS-free; **no** cache write on error | per task commit (unit), per wave (`pnpm preview`) | unit with in-memory `caches.default` (copy `deezer-endpoint.test.ts:279-347`) + `pnpm preview` for real workerd `clone()`/`waitUntil` | ❌ Wave 0 |
| **OG-EP-03** | **`deezer-endpoint.test.ts` passes with ZERO edits**; new `deezer-cover.test.ts` covers the extracted helpers directly; `/api/deezer/search` response bytes unchanged | per task commit | `pnpm vitest --run src/routes/api/deezer/search/deezer-endpoint.test.ts src/lib/proxy/deezer-cover.test.ts` | ⚠️ regression harness exists (do not modify); helper test ❌ Wave 0 |
| **OG-ZH-01** | **Decision artifact, not code.** If the recommendation is taken: no `dn`/`da` in any emitted URL, and `grep -r "zh-convert" src/routes src/lib/components` shows no share-path caller | per task commit | unit assertion `expect(url).not.toContain('dn=')` in `share.test.ts` + grep | ⚠️ in the rewritten `share.test.ts` |
| **OG-COMPAT-01** | legacy `/song/{slug}?n=&a=&c=` and `/album/{name}?artist=&c=&dn=&da=` still 200 with a correct card; a `%`-bearing name no longer 500s; both route shapes coexist | per task commit + per wave | unit loader tests + `curl` matrix against `pnpm dev` (the exact matrix in §A.2 plus `/album/50%25%20Off`) | ❌ Wave 0 — no loader test exists for any of the three legacy loaders |
| **OG-VERIFY-01** | `pnpm test` green, `pnpm check` clean; **plus** a real card rendered in ≥3 messengers | phase gate | `pnpm test && pnpm check`; then **`checkpoint:human-verify`** — deploy, run the Facebook Sharing Debugger + Twitter Card Validator, `curl -A 'facebookexternalhit/1.1' <url>`, and paste the link into WhatsApp, iMessage, Slack | ⚠️ suite exists; the human checkpoint must be an explicit task |
| **OG-PAGE-01** | song page renders `<img>` (not `.cover--placeholder`); `og:url` origin matches the requested origin; `og:type` is `music.song`/`music.album`/`profile` per route; exactly ONE `og:type` per page; **APK image not broken** | per task commit + device UAT | `curl -s $DEV/song/A/B \| grep -c 'og:type'` → 1, and `grep 'og:url'` shows `localhost:5173`; `<img>` presence via browser preview. **`checkpoint:human-verify` for the APK** | ❌ Wave 0 — no `PageOg` test exists |

**Cannot be validated in-sandbox — human required:**
1. **Real messenger cards** (OG-VERIFY-01) — needs a public deploy. No proxy for this.
2. **Edge CPU / cold-isolate behavior** — limits are not enforced locally. Only matters if OG-ZH-01 is taken against my recommendation.
3. **Real `caches.default` TTL / eviction / edge hit-rate** — `pnpm preview` simulates the API, not the cache.
4. **The APK `<img>`** (OG-PAGE-01) — needs `pnpm apk` on a device.

### Sampling Rate
- **Per task commit:** `pnpm vitest --run <touched test files>` + `pnpm check`
- **Per wave merge:** `pnpm test` (full) + `pnpm build` + `pnpm build:native` + the `curl` matrix against `pnpm dev`
- **Phase gate:** full suite green, both builds green, then the deployed-URL crawler checkpoint before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/routes/api/og/og-endpoint.test.ts` — OG-EP-01, OG-EP-02
- [ ] `src/lib/proxy/deezer-cover.test.ts` — OG-EP-03
- [ ] Loader tests for the two new routes and the three legacy loaders — OG-PATH-01, OG-COMPAT-01 (none exist today for any entity loader)
- [ ] Rewrite of the `songShareUrl` / `entityCardUrl` blocks in `share.test.ts` (§F.20) — OG-PATH-02, OG-ZH-01
- [ ] A `PageOg` assertion path (component-level or via the `curl` head check, since there is no jsdom project) — OG-PAGE-01
- [ ] Framework install: **none needed**
- [ ] `src/app.d.ts` — uncomment `ctx?: ExecutionContext` (`:21`) and add `ASSETS` if the binding is used

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface — `/api/og` and the share routes are public and keyless |
| V3 Session Management | no | No session |
| V4 Access Control | **yes** | Own-origin CORS only, never `*` — `hooks.server.ts:19-41` + `http.ts:30-40`. Inherited automatically; add nothing |
| V5 Input Validation | **yes** | `type` against a closed `as const` set; `artist`/`title` length-capped and only ever `encodeURIComponent`'d into fixed upstream URL templates (T-wv8-01 passthrough-only). Route params validated by SvelteKit's segment regex |
| V6 Cryptography | no | No crypto. **Never hand-roll** — not needed here |
| V10 Malicious Code / SSRF | **yes** | The core control: the resolved cover URL must pass a **per-tier** `safe*ImageUrl` allowlist (https-only + exact host suffix + CSS/attribute-breaker reject) **before** `fetch`. Input is path/query *text*, never a caller-supplied URL |
| V12 File / Resource | **yes** | `Content-Type` must match `^image/`; bound the buffered-for-cache size (`CACHE_BYTES_CAP`); one overall 2.5 s deadline; ≤4 subrequests |

### Known Threat Patterns for SvelteKit-on-Cloudflare + an image proxy

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| **SSRF via an attacker-chosen cover URL** | Tampering / Info disclosure | The URL is never caller-supplied — it comes from an allowlisted upstream's JSON and then passes a per-tier host allowlist. `/api/og` **must not** accept a URL parameter. Posture is strictly tighter than today's `?c=` |
| Open image relay (fetch-anything proxy) | Elevation of privilege | Three fixed host suffixes (`.dzcdn.net`, `.mzstatic.com`, `.kuwo.cn`), https-only. Anything else → branded fallback |
| Cache poisoning via cache key | Tampering | `ownOriginCacheKey()` only; never the upstream URL; the cached copy is CORS-free and origin is re-applied per request (WR-01, `deezer/search/+server.ts:189-201`) |
| Cache poisoning via unbounded query space | DoS | The layer-1 key is `matchKey(artist,title)`-normalized; input length is capped |
| Self-DoS against upstreams | DoS | `retries = 0`, per-tier timeouts, the 2.5 s ceiling, negative caching of clean misses, `max-age=86400` |
| Memory exhaustion via a huge upstream body | DoS | `clone()` only under an explicit `Content-Length` cap; otherwise stream without caching |
| Path traversal via a path segment | Tampering | Segments are data, never filesystem paths. WHATWG URL already normalizes `.`/`..` (which is why the encoder needs the dot guard — a *correctness* issue, not a security one) |
| XSS via an OG meta value | Tampering | `PageOg` binds every value via `content={...}` (Svelte escapes attribute bindings), never `{@html}` — T-gln-02, documented at `PageOg.svelte:6-9`. Preserve this when adding `og:type` |
| Secret leakage into a cache key or the client bundle | Info disclosure | `/api/og` reads **no** `platform.env` secret — all three upstreams are keyless |
| CORS wildcard regression | Elevation of privilege | Never add per-route CORS; the single seam handles `/api/og` |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Twitter/X, Discord, Facebook `og:image` byte caps (~5 MB / ~8 MB / ~8 MB) | §D.15 | Low — every measured cover is ≤332 KB, far under any of these |
| A2 | Crawlers have a "short fetch timeout" (3–10 s) for `og:image` | §D.15, §C.9 | Medium — the 2.5 s deadline is sized against it. If a crawler is stricter, the fallback path (0 subrequests) still returns instantly |
| A3 | iMessage/Apple does not reliably follow `og:image` redirects | §D.15 | Low — we never redirect, so the assumption only justifies an already-locked decision |
| A4 | `Cache-Control: immutable` behaves as expected alongside a `caches.default` entry | §C.14 | Low — worst case is a shorter effective cache life |
| A5 | `platform.ctx.waitUntil` is available under adapter-cloudflare at runtime | §C.10 | Low — the adapter passes `ctx` (`worker.js` `fetch(req, env2, ctx)`); if absent, `await cache.put` is the existing pattern |
| A6 | workerd counts dynamically-imported module evaluation against the triggering request's CPU budget | §E.17 | **Medium — this is the crux of the OG-ZH-01 argument.** If module eval were free, only the measured 8.9 ms `createConverterMap` would count — still ~90% of a 10 ms budget, so the recommendation survives either way |
| A7 | The current Cloudflare plan is **free** tier (10 ms CPU / 50 subrequests) | §C.14, §E.17 | **Medium.** CONTEXT.md and the exploration note both state free tier. On a paid plan (30 s CPU) the OG-ZH-01 cost objection largely evaporates and reason #1 weakens — but reasons #2–#5 (zero carriers, smaller diff, better resolution key, no `NodeFilter` fragility) stand independently. **Worth confirming with the user.** |
| A8 | Sandbox reachability of `kw-api.cenguigui.cn` is stable, not a transient | §D.16 | Low — keep the stubbed unit test as the authoritative gate regardless |
| A9 | `qlmanage -t` produces an acceptable 1200×630 PNG from `og.svg` | §C.11 | Low — the raster is recommended as a *deferred* follow-up, not in-phase |

---

## Open Questions

1. **Is the Cloudflare plan free or paid?**
   - Known: CONTEXT.md and `share-link-cover-carrier-tradeoff.md` both cite "50 subrequests + 10ms CPU per request" (free).
   - Unclear: not independently verified against the account.
   - Recommendation: **confirm with the user before finalizing OG-ZH-01.** It does not change my recommendation (four of five reasons are plan-independent) but it changes how loudly the CPU risk should be stated.

2. **Should in-app album navigation move to the 2-segment shape?**
   - Known: `artist/[name]/+page.svelte:464` is the only in-app path to an album page and uses the legacy `?artist=` form. The legacy route is LOCKED to stay, so it works either way.
   - Unclear: whether "OG-PATH-02 changes only share URLs" was meant to exclude internal nav.
   - Recommendation: **update it.** Otherwise the 2-segment album loader is only ever exercised by shared links, which is precisely the code path least likely to be manually tested.

3. **Should `static/og.png` land in this phase?**
   - Known: SVG `og:image` is unsupported everywhere; this is pre-existing, not introduced here; local rasterization is possible (`qlmanage`) but not reproducible in CI.
   - Recommendation: **defer.** Log a todo. If the planner wants it, make it a `checkpoint:human-verify` task — the asset needs eyeballing.

4. **Which OG title does the 2-segment album page show — the decoded `name`, or `name • artist`?**
   - Known: `entityCardUrl` album links carry both segments, and `buildOg` produces `Title • Artist` when an artist is passed (`share.ts:300`). The legacy album loader passes `displayArtist` (`album/[name]/+page.ts:31`).
   - Recommendation: pass both so the new shape's card matches the legacy card exactly. Assert it in the loader test.

5. **Does anything need `og:image:secure_url`?**
   - Known: some older Facebook guidance wanted it alongside `og:image` for https.
   - Unclear: whether any current crawler still requires it. PageOg does not emit it today and cards work.
   - Recommendation: don't add it. If the human crawler check shows a platform failing, add it then.

---

## Sources

### Primary (HIGH confidence — verified in this session)
- **SvelteKit 2.63 source, read directly from `node_modules`:**
  - `@sveltejs/kit/src/core/sync/create_manifest_data/conflict.js` — `prevent_conflicts`, `normalize_route_id` (route coexistence)
  - `@sveltejs/kit/src/utils/routing.js:1-100` (`parse_route_id`), `:214-227` (`escape`, the `%`/`/`/`?`/`#` note), `:290-311` (`find_route` → `decode_params`)
  - `@sveltejs/kit/src/utils/url.js:46-63` — `decode_pathname`, `decode_params`
  - `@sveltejs/kit/src/utils/page_nodes.js` — `#get_option`, `ssr()`, `prerender()` (per-route override semantics)
  - `@sveltejs/kit/src/runtime/server/respond.js:266`, `:334` — decode-then-match order
  - `@sveltejs/adapter-cloudflare/files/worker.js:35-95`, `ambient.d.ts` — `env.ASSETS`, `Platform`
- **Live probes against `pnpm dev` (:5173)** with the new routes temporarily present: route coexistence matrix, CJK/`%2F`/`%25`/`%23`/emoji/`..`/empty segment behavior, and the **`/album/50%25%20Off` → 500** double-decode reproduction.
- **`pnpm exec svelte-kit sync`, `pnpm build`, `pnpm build:native`** — all exit 0 with both new route shapes present; `build/` inspected for adapter-static output.
- **Live upstream probes:** Deezer search + 3 cover variants; iTunes search + 3 artwork variants; kuwo search + cover (all byte sizes measured with `curl -w`).
- **Vitest measurement** of `tongwen` dict import/parse, `createConverterMap` (8.90 ms), and per-line convert cost; **`pnpm build` chunk sizes** for `s2t-char.min.js` / `s2t-phrase.min.js` plus `gzip -c | wc -c` on the client chunks.
- **Repo source** (all `file:line` references in this document), incl. `.svelte-kit/cloudflare/_routes.json` and `_headers`.
- [WhatsApp Link Previews — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/link-previews/) — the only **official** og:image constraint found: "under 600KB", "300px or more in width with 4:1 width/height or less".

### Secondary (MEDIUM confidence)
- [Using the Cache API — Cloudflare Workers docs](https://developers.cloudflare.com/workers/examples/cache-api/) and [Cache — Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/cache/) — `cache.put` consumes the body; `clone()` buffers rather than streams.
- [Workers Streams — Cloudflare docs](https://developers.cloudflare.com/workers/runtime-apis/streams) — `new Response(body)` pass-through.
- [Workers are no longer limited to 1000 subrequests — Cloudflare Changelog, 2026-02-11](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/) — free plan remains 50 external subrequests.
- [Improved local development with wrangler and workerd — Cloudflare Blog](https://blog.cloudflare.com/wrangler3/) and [Architecting on Cloudflare, Ch. 5](https://architectingoncloudflare.com/chapter-05/) — Miniflare v3 simulates Cache; limits are not enforced locally.

### Tertiary (LOW confidence — flagged, mutually consistent but not authoritative)
- [previewog.com/og-image-guide](https://previewog.com/og-image-guide/) · [ogimagen.com/guides/og-image-sizes-2026](https://ogimagen.com/guides/og-image-sizes-2026) · [imagedimensions.com/guides/open-graph-image-size](https://imagedimensions.com/guides/open-graph-image-size) · [metablast.dev/blog/og-image-size-guide-2026](https://metablast.dev/blog/og-image-size-guide-2026) — per-platform byte caps, "SVG is not supported by any platform", "serve 200, no redirect".
- [previewog.com/fix-whatsapp-link-preview-not-working](https://previewog.com/fix-whatsapp-link-preview-not-working/) · [myog.social/bots/facebookexternalhit](https://myog.social/bots/facebookexternalhit) — redirect-follow behavior per crawler.

---

## Metadata

**Confidence breakdown:**
- **Routing / route coexistence / param decoding: HIGH** — read SvelteKit's own conflict + decode source *and* reproduced every case live, including the 500 bug.
- **Both build targets: HIGH** — `pnpm build` and `pnpm build:native` both run green with the new routes present.
- **Encode/decode design: HIGH** — every character class in the table was live-verified end-to-end, including the two failure modes the guards exist for.
- **`scoreMatch` tolerance: HIGH** — proved *exact* invariance from `match-key.ts:29`, then measured real upstream keyword sensitivity against both reachable engines.
- **`/api/og` tier mechanics + byte budgets: HIGH** — all three upstreams reachable and measured.
- **Cloudflare cache/stream semantics: MEDIUM-HIGH** — official docs on `clone()` buffering; cannot be fully verified without a deploy.
- **Crawler constraints: MEDIUM** — one official source (WhatsApp); the rest is consistent but non-authoritative, and **no** citable per-platform timeout exists.
- **OG-ZH-01 cost: HIGH on the numbers, MEDIUM on the workerd CPU-accounting model (A6)** — the recommendation holds under either model.
- **Call-site inventory: HIGH** — cross-checked with grep *and* by reading each file (per the `grep false-empty` memory note).

**Research date:** 2026-08-07
**Valid until:** 2026-09-06 for repo/SvelteKit facts (stable, pinned versions). **2026-08-21** for the crawler + Cloudflare-limit claims (fast-moving, low-quality sources).
