---
phase: 24-offline-app-shell-sharing-seo
plan: 04
subsystem: routing-seo
tags: [ssr, seo, og, share, sveltekit]
requires:
  - "24-02: share.ts entityShareUrl/parseEntityParam/slugify/buildOg/decodeShare"
provides:
  - "/song/[slug] SSR-safe per-song OG share route (SHARE-01)"
  - "album + artist routes opted into SSR (SHARE-01)"
  - "static site-default SEO meta in app.html for ssr=false shell pages (SHARE-03 / D-11)"
  - "parseEntityParam source enum reconciled with live SourceId (fivesing/jamendo decode)"
affects:
  - "src/lib/services/share.ts (ENTITY_SOURCE_RE / ENTITY_SOURCE_ONLY_RE anchors)"
  - "Plan 05 build-smoke gate (pnpm build + pnpm build:native must both succeed)"
tech-stack:
  added: []
  patterns:
    - "Per-route SSR subtree opt-in (universal +page.ts + export const ssr = true); root +layout.ts stays ssr=false (D-01)"
    - "SSR-safe-by-construction share page: PageOg + browser + page imports only, no top-level store import/method"
    - "Static site-default SEO in app.html before %sveltekit.head% so SSR entity heads win (D-11 / Pitfall 6)"
key-files:
  created:
    - "src/routes/(app)/song/[slug]/+page.ts"
    - "src/routes/(app)/song/[slug]/+page.svelte"
  modified:
    - "src/routes/(app)/album/[name]/+page.ts"
    - "src/routes/(app)/artist/[name]/+page.ts"
    - "src/app.html"
    - "src/lib/services/share.ts"
    - "src/lib/services/share.test.ts"
decisions:
  - "Song-page Play CTA is a plain <a> link to /?play=<token> (home owns queue-install + playback on mount) instead of importing the player store — keeps the page zero-store-coupling and SSR-safe by construction"
  - "Reconciled parseEntityParam source enum NOW (not deferred to 24-05): dropped stale kugou|migu, added fivesing|jamendo to match the live SourceId union"
metrics:
  duration: ~12m
  completed: 2026-06-14
  tasks: 3
  files: 7
---

# Phase 24 Plan 04: Per-Entity SSR OG + Static Shell SEO Summary

Per-entity OG/SEO is now crawler-visible via a per-route SSR subtree: a new minimal SSR-safe `/song/[slug]` share route, album/artist routes opted back into SSR, and a static site-default title/description/canonical baked into `app.html` for the `ssr=false` shell pages — root layout stays `ssr=false` and no `+page.server.ts` was introduced.

## What Was Built

### Task 1 — New SSR-safe `(app)/song/[slug]` route (commit 714e2d6)
- `+page.ts`: universal load with `export const ssr = true; export const prerender = false;`. Reads the slug ONLY through `parseEntityParam` (T-24-03 validation gate; null on no-match, never throws). Optionally decodes a `?play=` token via `decodeShare` to enrich the OG title/artist/cover (D-06). Builds `og` via `buildOg`. Derives a Title-Cased display name from the slug prefix (strips the trailing `{source}{id}`), falling back to `openmusic`. Plain strings, not `t()` (load runs server-side). No server-side fetch (T-24-08, no SSRF surface).
- `+page.svelte`: SSR-safe BY CONSTRUCTION — the ONLY imports are `PageOg`, `{ browser }`, `{ page }`. No top-level store import and no store method at module scope. Renders `<PageOg og={data.og} />`, a static entity card (cover/title/artist, all `{expr}`-bound, never `{@html}` — T-24-07), and a Play CTA. The CTA is a plain `<a href="/?play=<token>">` (the home route already installs the shared queue + starts playback on mount), so the page never touches the player store at all.

### Source-enum reconciliation (committed with Task 1)
Plan 24-02 flagged that `parseEntityParam`'s anchor used a stale `netease|qq|kuwo|joox|kugou|migu` set while the live `SourceId` (src/lib/sources/types.ts:17) is `netease|qq|kuwo|joox|fivesing|jamendo`. Reconciled BOTH `ENTITY_SOURCE_RE` and `ENTITY_SOURCE_ONLY_RE` in `share.ts` to the live union: dropped the non-existent `kugou|migu`, added `fivesing|jamendo` so those entity links decode. Added two tests to `share.test.ts` (fivesing/jamendo now decode; kugou/migu now correctly return null). 29 share tests pass.

### Task 2 — Album + artist SSR opt-in (commit 296c4cf)
Added `export const ssr = true; export const prerender = false;` to both `album/[name]/+page.ts` and `artist/[name]/+page.ts` (loads already build `og` — no other load change). No `+page.server.ts`.

### Task 3 — Static site-default SEO in app.html (commit f4a689a)
Added a static `<title>`, `<meta name="description">`, and `<link rel="canonical" href="https://openmusic.pages.dev/">` to `app.html`, placed BEFORE `%sveltekit.head%` so SSR entity routes' `<svelte:head>` still wins. Text matches `+layout.svelte`'s `TITLE`/`DESC` verbatim. Gives the `ssr=false` shell pages baseline SEO without flipping any to SSR (preserves D-01; fixes Pitfall 6).

## SSR-Safety Audit Outcome (Task 2)

CLEAN — no changes needed before flipping `ssr=true`:
- `album/[name]/+page.svelte`: the only `window`/`document`/`navigator` accesses are inside async event-handler functions (download blob path ~L402, `shareAlbum` ~L460). None at module top.
- `artist/[name]/+page.svelte`: the only `navigator`/`location` access is inside the `shareArtist` event handler (~L153–158), already `typeof location !== 'undefined'`-guarded for `location`. None at module top.
- Store imports (player/library/settings/names/overlays) and their construction are SSR-safe (runes `$state` works server-side); Svelte `use:` actions never run during SSR. Nothing was wrapped.

## Deviations from Plan

None — plan executed exactly as written. The source-enum reconciliation called out in `<critical_constraints>` was performed (not deferred); it is the only constraint that touched a file (`share.ts`) outside the plan's `files_modified` list, and was explicitly mandated by the orchestrator prompt.

## Verification

- `pnpm check`: 0 errors, 0 warnings (4279 files). No SSR "not defined" errors in the song page or album/artist routes.
- `pnpm test`: 62 files, 832 tests passed (incl. 29 share.ts tests with the new enum cases).
- grep acceptance: `ssr = true` present in song/album/artist `+page.ts`; `parseEntityParam` used in song load; `PageOg` rendered in song page; `rel="canonical"` in app.html before `%sveltekit.head%`.
- `find src -name "+page.server.ts"` → empty (D-03 preserved).
- Full `pnpm build` + `pnpm build:native` SSR-safety proof is the Plan 05 build-smoke gate (out of scope here).
- No STATE.md / ROADMAP.md modifications (orchestrator owns those).

## Self-Check: PASSED

- FOUND: src/routes/(app)/song/[slug]/+page.ts
- FOUND: src/routes/(app)/song/[slug]/+page.svelte
- FOUND: src/app.html (static SEO)
- FOUND commit 714e2d6 (Task 1 + enum reconcile)
- FOUND commit 296c4cf (Task 2)
- FOUND commit f4a689a (Task 3)
