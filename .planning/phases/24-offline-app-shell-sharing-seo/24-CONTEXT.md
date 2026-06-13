# Phase 24: Offline App-Shell & Sharing/SEO - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Two net-new infrastructure capabilities, isolated at the end of v1.2 (highest Cloudflare blast radius):

1. **Offline app-shell** — a native service worker (`src/service-worker.ts`, NOT vite-pwa) that loads the app shell offline, never caches `/api/*` or audio CDN responses, evicts stale shells on deploy (version-keyed activate); downloaded songs play end-to-end offline from the local blob store; online-only surfaces degrade gracefully (OFFL-01..03).
2. **Sharing / SEO** — per-entity server-rendered OG metadata (song / album / artist) so crawlers and chat apps unfurl the right entity; short readable share links replacing the opaque token; proper SEO meta (title / description / canonical) on every page (SHARE-01..03).

Fixed by ROADMAP. Discussion clarifies HOW within this boundary. Both halves are flagged **HIGH research** — SW lifecycle on Cloudflare Pages + iOS Safari PWA quirks, and edge SSR / CJK slugs — to be dug into by `/gsd:plan-phase --research-phase 24` (consider splitting offline vs SEO research spikes).
</domain>

<decisions>
## Implementation Decisions

### SSR strategy (SHARE-01 / SHARE-03)
- **D-01:** Deliver server-rendered OG/SEO via a **per-route SSR subtree**, NOT a global SSR flip. Root `src/routes/+layout.ts` keeps `ssr = false` (full SPA); only the entity routes opt back into SSR.
- **D-02:** The entity routes that get SSR: `(app)/album/[name]`, `(app)/artist/[name]`, and a song-share surface (today a song is shared via the base64url `?play=` token on the homepage — planner/research decides whether song sharing needs its own SSR entity route or an SSR share landing; album/artist already have `+page.ts` that builds `og`).
- **D-03:** SSR must be **Cloudflare-only** and not break the `adapter-static` Capacitor SPA build (dual-adapter D-01 in svelte.config). The static build is selected by **`BUILD_TARGET=native`** (NOT `static` — verified against svelte.config.js / package.json; research correction). NEVER use `+page.server.ts` (breaks the static build) — use universal `+page.ts` + `export const ssr = true` so the entity route SSRs on Cloudflare and stays SPA-compatible. This guard is a hard constraint — verify both `pnpm build` and `pnpm build:native`.

### Share-link shape (SHARE-02)
- **D-04:** URL pattern: **readable ASCII slug + stable id**, e.g. `/song/qing-fei-de-yi-qq123` (`/{type}/{slug}-{source}{id}`). The stable `{source}{id}` (or uid) is the **authoritative** decode key; the slug is cosmetic and ignored on decode.
- **D-05:** CJK titles are slugified to ASCII (pinyin or transliteration/strip) for the visible slug — links stay readable and copy-paste-clean, never percent-encoded CJK.
- **D-06:** Keep the existing base64url `?play=` payload (`share.ts` v2: current track + capped queue, QUEUE_CAP=30) as the **optional queue carrier** layered on top of the readable path — the path identifies the entity, the `?play=` token (when present) restores the up-next queue. Do not embed expiring audio URLs (re-resolved on play, existing behavior).

### OG image source (SHARE-01)
- **D-07:** OG image = **resolved cover CDN URL when it is a solid https value, else the static branded fallback** (`/og.svg`). Reuse the existing `buildOg` helper (already enforces https-only, null→fallback) and the cover pipeline. No new edge image rendering this phase.
- **D-08:** Edge-composed OG cards (cover + title/artist overlay) are **deferred to backlog** — net-new edge image rendering + caching, too heavy for this phase.

### Offline degradation UX (OFFL-03)
- **D-09:** **Per-surface inline offline states + promote Downloads.** A global offline indicator; each online-only screen (search, discovery/charts, artist/album) renders an inline offline empty-state; Library/Downloads stay fully usable and are surfaced. **No forced redirect** — the user is never yanked between tabs.
- **D-10:** Explicitly avoid stuck loaders / dead screens offline (the failure OFFL-03 calls out): offline-aware surfaces short-circuit to their inline offline state instead of hanging on a fetch. Keep it simple — "don't bloat" per the requirement.

### SEO scope (SHARE-03) — resolved post-research
- **D-11:** "Every page carries SEO meta" = **per-entity SSR meta on the entity routes (song/album/artist) + a static site-default (title/description/canonical) baked into `app.html`** for the `ssr=false` shell pages. Does NOT mean dynamic SSR meta on every shell page (would break D-01). Crawlers get real per-entity meta where it matters; everything else carries the static default.

### Claude's Discretion (defer to research/planning)
- SW precache manifest contents (app-shell-only vs shell + key static), version-keying / activate-eviction mechanism, runtime cache strategy boundaries (the `/api/*` + audio bypass is locked by OFFL-01; the rest is implementation).
- iOS Safari PWA + SW + background-audio interaction specifics (known constraint — research flag).
- Exact slugify algorithm (pinyin lib vs transliterate-and-strip) — D-05 locks ASCII-readable, not the library.
- Whether song sharing needs a dedicated `(app)/song/[...]` SSR route vs an SSR share-landing (D-02).
</decisions>

<specifics>
## Specific Ideas

- "Don't bloat" offline degradation — simplest implementation that satisfies OFFL-03 (per the requirement text itself).
- Stable id is authoritative, slug cosmetic — mirrors the existing `share.ts` philosophy (visible `?t=<slug>` is readability-only; the opaque payload is authoritative).
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §OFFL-01..03, §SHARE-01..03 — acceptance criteria for both halves; note the reversed "offline audio download" scope decision (downloads → IndexedDB blob-store already shipped).
- `.planning/ROADMAP.md` → Phase 24 — goal, 5 success criteria, the HIGH research flag (offline SW + edge SSR), and the suggestion to split offline vs SEO research spikes.

### Existing share/SEO code (reuse, don't reinvent)
- `src/lib/services/share.ts` — base64url v2 share payload (current track + capped queue, QUEUE_CAP=30), `toBase64Url`/`fromBase64Url` (Workers-runtime btoa/atob), `buildOg` (https-only image guard, null→fallback). The slug/SSR work extends this.
- `src/lib/components/PageOg.svelte` — per-page OG/Twitter tags into `<svelte:head>`; root layout gates static default OG behind `{#if !page.data?.og}`. Currently client-only because root `ssr=false` — the SSR subtree (D-01/D-02) is what makes these tags reach crawlers.
- `src/routes/(app)/album/[name]/+page.ts`, `src/routes/(app)/artist/[name]/+page.ts` — already build `og`; need SSR opt-in.

### Build / SSR config (the central constraint)
- `src/routes/+layout.ts` — `export const ssr = false; export const prerender = false;` (the CSR-only root that D-01 deliberately preserves).
- `svelte.config.js` — dual-adapter switch (D-01): default `@sveltejs/adapter-cloudflare`, `BUILD_TARGET=native` → `@sveltejs/adapter-static` SPA for Capacitor. SSR routes must not break the static build (D-03).

### Existing offline/download code (reuse)
- `src/lib/services/blob-store.ts`, `src/lib/services/downloads-queue.ts` — IndexedDB blob store + download queue; OFFL-02 plays from these offline.
- `static/manifest.webmanifest` — existing PWA manifest.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `share.ts` (`buildOg`, base64url encode/decode, v2 payload) — extend for readable slugs + entity OG, don't replace.
- `PageOg.svelte` — already renders OG/Twitter tags; just needs SSR to reach crawlers.
- `blob-store.ts` + `downloads-queue.ts` — offline playback source (OFFL-02) already exists.
- Album/artist `+page.ts` already produce `og` via universal load.

### Established Patterns
- Full CSR SPA: root `+layout.ts ssr=false/prerender=false`. SSR is the exception, opted-in per-route (D-01).
- Dual-adapter build (D-01 in svelte.config): Cloudflare (web) vs adapter-static (Capacitor). Every server-side feature must degrade for the static build.
- "Authoritative id + cosmetic slug" already used by share `?t=`.
- Native service worker chosen over vite-pwa (roadmap research flag) — file at `src/service-worker.ts` (SvelteKit convention), none exists yet.

### Integration Points
- `src/routes/+layout.ts` (ssr flag) + entity-route layouts/`+page.server.ts` — the SSR subtree boundary.
- `svelte.config.js` `BUILD_TARGET=native` branch — SSR-route guard for the static build.
- `src/service-worker.ts` (new) — SvelteKit auto-registers; `/api/*` + audio bypass; version-keyed activate.
- Online/offline state surfaced app-wide (new) consumed by online-only surfaces for inline offline states (D-09).
</code_context>

<deferred>
## Deferred Ideas

- Edge-composed OG cards (cover + title/artist overlay rendered at the edge) — backlog (D-08).
- Background offline sync / pre-download of "up next" while online — out of scope; OFFL-02 is play-what's-already-downloaded.

None of these block Phase 24.
</deferred>

---

*Phase: 24-offline-app-shell-sharing-seo*
*Context gathered: 2026-06-13*
