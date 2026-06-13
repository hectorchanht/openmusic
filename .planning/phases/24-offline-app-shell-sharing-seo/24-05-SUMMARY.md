---
phase: 24-offline-app-shell-sharing-seo
plan: 05
subsystem: ui
tags: [offline, pwa, service-worker, sharing, seo, svelte5, i18n, cloudflare, adapter-static]

# Dependency graph
requires:
  - phase: 24-01
    provides: online.svelte.ts (online.isOnline + init() lifecycle), sw-cache + online store
  - phase: 24-02
    provides: share.ts entityShareUrl / encodeShare / shareUrl / parseEntityParam / slugify
  - phase: 24-03
    provides: src/service-worker.ts (native SW, /api/* + audio bypass, version-keyed activate)
  - phase: 24-04
    provides: song/[slug] SSR route, album/artist SSR opt-in, static app.html SEO default
provides:
  - Global offline indicator wired into the (app) shell, driven by online.isOnline (OFFL-03)
  - Per-surface inline offline empty-states on search/charts/artist/album that short-circuit the fetch (OFFL-03/D-10)
  - Song share buttons emit readable /song/{slug}-{source}{id} links + ?play= queue carrier via entityShareUrl (SHARE-02/D-06)
  - OFFL-02 regression-clear: downloaded-song blob playback bypasses the SW fetch handler
  - D-03 dual-adapter build gate proven green (pnpm build + pnpm build:native both exit 0)
affects: [offline-ux, sharing, seo, capacitor-native-build]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Offline short-circuit: guard the fetch entry on !online.isOnline and clear the loading/skeleton flag so no stuck loader, then render an inline offline empty-state promoting Downloads (no forced redirect)"
    - "Shared .offline-state CSS idiom inlined per online-only surface (text-align center, primary-pill CTA to /library)"

key-files:
  created: []
  modified:
    - src/routes/(app)/+layout.svelte
    - src/routes/(app)/search/+page.svelte
    - src/routes/(app)/charts/top/+page.svelte
    - src/routes/(app)/artist/[name]/+page.svelte
    - src/routes/(app)/album/[name]/+page.svelte
    - src/lib/components/TrackMenu.svelte
    - "src/lib/i18n/*.ts (15 locales: offline.* keys)"

key-decisions:
  - "Global offline indicator is a thin in-flow top banner (role=status) gated on !online.isOnline — additive to the shell, never fixed-positioned, never forces navigation (D-09)"
  - "Each online-only surface short-circuits BEFORE firing its fetch when offline AND clears its loading/skeleton flag, so an offline visit never strands a spinner (D-10)"
  - "Song share = entityShareUrl('song', track) readable path + ?play=encodeShare(track,queue) carrier (D-04/D-06); shareUrl retained in share.ts (not deleted)"
  - "album/artist share kept on the literal-name /{type}/[name] routes (round-trip-correct for CJK) — entityShareUrl NOT forced there because those routes decode params.name, not a slug (deviation)"
  - "OFFL-02 verified by inspection + the player suite: downloads play via blobStore.get->URL.createObjectURL; blob: URLs never reach the SW fetch handler so playback is unaffected by the SW"

patterns-established:
  - "Offline-aware fetch entry: `if (!online.isOnline) { <clear-loading-flags>; return; }` at the top of every online-only fetch effect/handler"
  - "Inline offline empty-state promoting Downloads with a CTA button → goto('/library')"

requirements-completed: [OFFL-02, OFFL-03, SHARE-02]

# Metrics
duration: 18min
completed: 2026-06-14
---

# Phase 24 Plan 05: Offline Degradation, Readable Sharing & Dual-Build Gate Summary

**Global offline indicator + per-surface inline offline states (short-circuit before fetch, promote Downloads), song share repointed to the readable entityShareUrl link with a ?play= queue carrier, OFFL-02 blob playback verified regression-clear, and the D-03 dual-adapter build gate proven green — now paused at the [BLOCKING] human checkpoint for the manual crawler/iOS-offline smokes.**

## Performance

- **Duration:** ~18 min (autonomous tasks; checkpoint pending human verify)
- **Started:** 2026-06-14T00:46Z
- **Completed (autonomous portion):** 2026-06-14T00:58Z
- **Tasks:** 3 of 4 (Task 4 is the [BLOCKING] checkpoint — build gate run, manual smokes awaited)
- **Files modified:** 20 (6 source + 14 locale dicts; en.ts counts in the 6)

## Accomplishments
- **OFFL-03 global indicator:** `online.init()` wired into the `(app)` shell onMount (teardown composed with the overlays teardown); a thin localized offline banner shows whenever `!online.isOnline`. No forced redirect (D-09).
- **OFFL-03 inline offline states:** search, charts/top, artist, and album all short-circuit their data-fetch entries when offline (no `searchAll` / `getAlbumTracklist` / chart fetch fires) AND clear their loading/skeleton flags, then render an inline "you're offline" state promoting Downloads (CTA → `/library`). No stuck loaders, no dead screens, no redirect.
- **SHARE-02 song share:** `TrackMenu.doShare` now builds the readable `/song/{slug}-{source}{id}` link via `entityShareUrl('song', track)` and appends `?play=<encodeShare(track, player.queue)>` as the optional queue carrier (D-04/D-06). `shareUrl` stays exported in `share.ts`.
- **OFFL-02 verified:** the player resolves downloaded songs through `blobStore.get(uid) → URL.createObjectURL(blob)` (player.svelte.ts:377/447/1379/1473). `blob:` URLs never hit the SW fetch handler (RESEARCH line 240), so downloaded playback is unaffected by the SW. Player suite 92/92 green.
- **D-03 dual-adapter build gate (BLOCKING, automated portion):** `pnpm test` 832/832 green; `pnpm build` (adapter-cloudflare, SSR entity routes present) exit 0; `pnpm build:native` (adapter-static SPA) exit 0 — "Wrote site to build". The SSR entity routes did not break the static build.
- **i18n parity:** added `offline.indicator/title/body/goToLibrary` across all 15 locales; the i18n parity test (12 tests) passes.

## Task Commits

1. **Task 1: Global offline indicator + online store lifecycle (OFFL-03)** - `197eaa7` (feat)
2. **Task 2: Per-surface inline offline empty-states (OFFL-03)** - `44858a7` (feat)
3. **Task 3: Wire song share to entityShareUrl + verify OFFL-02 (SHARE-02, OFFL-02)** - `5897149` (feat)
4. **Task 4: [BLOCKING] dual-adapter build-smoke gate + manual smokes** — build gate run green (test 832/832, build + build:native both exit 0); **manual crawler-curl + iOS-offline smokes AWAITING human verification** (see below).

## Files Created/Modified
- `src/routes/(app)/+layout.svelte` - `online.init()` lifecycle + global offline banner (OFFL-03)
- `src/routes/(app)/search/+page.svelte` - `run()` short-circuits offline; inline offline state
- `src/routes/(app)/charts/top/+page.svelte` - onMount fetch short-circuits offline (skeleton flags cleared); inline offline state
- `src/routes/(app)/artist/[name]/+page.svelte` - searchAll/enrich/albums/related/deezer effects short-circuit offline; inline offline state; share kept on literal-name route
- `src/routes/(app)/album/[name]/+page.svelte` - tracklist/enrich/deezer effects short-circuit offline; inline offline state; share kept on literal-name route
- `src/lib/components/TrackMenu.svelte` - `doShare` → `entityShareUrl('song', track)` + `?play=` carrier
- `src/lib/i18n/{en,zh-Hant,zh-Hans,es,fr,de,pt,it,ru,tr,ar,hi,id,vi,th}.ts` - `offline.*` keys (15-locale parity)

## Decisions Made
- Indicator is a thin in-flow banner (not fixed/overlay) so it never collides with the nowbar/tabbar and is the simplest thing that satisfies the "don't bloat" D-10 constraint.
- Offline guards clear the relevant loading/skeleton flags (charts `showTrackSkeleton`/`showArtistSkeleton`, artist `loading`/`enrichLoading`/`albumsLoading`/`relatedLoading`/`dzLoading`, album `loading`) so an offline first-visit can't sit on a spinner forever.
- Song share carries the slug in the path (so the cosmetic `?t=` segment is dropped) and the `?play=` token both unfurls the entity (crawler) and restores the queue on open.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] album/artist share kept on the literal-name route instead of entityShareUrl**
- **Found during:** Task 3 (share wiring)
- **Issue:** The plan directed using `entityShareUrl('album', ...)` / `entityShareUrl('artist', ...)`. But the `(app)/album/[name]` and `(app)/artist/[name]` routes decode `params.name` via `decodeURIComponent` and query the catalog with the LITERAL name (`getAlbumTracklist(name, artist)` / `searchAll(name)`) — they were NOT migrated to a slug+`{source}{id}` scheme (24-04 only added the SSR OG head; albums/artists have no source/id key). `entityShareUrl` slugifies to ASCII and STRIPS CJK to `''` (share.ts slugify), so `entityShareUrl('artist', {title:'情非得已'})` would yield `/artist/` (empty) and `entityShareUrl('album', {title:'稻香'})` → `/album/` — a non-reopening link for the app's primary CJK catalog. Forcing it would ship broken share links.
- **Fix:** Kept the album/artist share URLs on the round-trip-correct literal-name form (`/{type}/${encodeURIComponent(name)}`, album also carries `?artist=`), SSR-guarded for `location`. These ARE the readable entity routes 24-04 opted into SSR; the crawler OG head is built server-side from `params.name` regardless. `entityShareUrl` is therefore used for the SONG share (the route it was designed for — slug + authoritative `{source}{id}` key + `?play=`), not for album/artist.
- **Files modified:** src/routes/(app)/album/[name]/+page.svelte, src/routes/(app)/artist/[name]/+page.svelte
- **Verification:** `pnpm check` 0 errors; both builds green; CJK album/artist links continue to round-trip via the existing literal-name decode.
- **Committed in:** `5897149` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — correctness over a literal plan instruction that would have broken CJK links).
**Impact on plan:** Song share fully meets SHARE-02 (readable entityShareUrl path + ?play= carrier). Album/artist share remains correct and readable via their literal-name SSR routes. `entityShareUrl` appears in TrackMenu.svelte (the song route); it is intentionally NOT in album/artist files — documented here so the acceptance grep is interpreted against route reality. No scope creep.

## Issues Encountered
- None beyond the share-route mismatch documented as the deviation above. All four offline-aware surfaces required clearing their respective loading/skeleton flags on the offline short-circuit to avoid stuck loaders (D-10); done per-surface.

## Manual / Human-Only Verifications — AWAITING (Task 4 [BLOCKING] checkpoint)

The automated portion of the BLOCKING gate is GREEN (test 832/832; `pnpm build` exit 0; `pnpm build:native` exit 0). The following are human-only per VALIDATION.md and are NOT self-certified:

1. **Crawler OG smoke (manual):** `pnpm preview` then `curl -A facebookexternalhit http://localhost:4173/song/<slug>-qq123` → assert per-song `og:title` (not the generic default); repeat for an album + artist entity URL; `curl` a shell page (e.g. `/search`) → assert the static app.html `<title>`/description/canonical (SHARE-03).
2. **iOS offline smoke (real device, VALIDATION.md Pitfall 7):** install the PWA → go offline → reload (shell loads) → find a downloaded song in Library → tap → plays end-to-end offline (OFFL-02) → visit `/search` → inline offline state shows (no stuck loader), Downloads promoted (OFFL-03). Document any iOS storage-eviction as a known constraint, not a regression.

**Resume signal:** type "approved" once the crawler + iOS-offline smokes pass, or describe failures.

## Self-Check: PASSED
- `src/routes/(app)/+layout.svelte` — FOUND, contains `online.init` + `online.isOnline`
- `src/lib/components/TrackMenu.svelte` — FOUND, contains `entityShareUrl`
- `online.isOnline` present in search / charts/top / artist / album surfaces — FOUND
- Commits `197eaa7`, `44858a7`, `5897149` — present in git log
- `pnpm check` 0 errors; `pnpm test` 832/832; `pnpm build` + `pnpm build:native` both exit 0

## Next Phase Readiness
- Phase 24 implementation surface is complete pending the human BLOCKING smokes. Once approved, the phase can be signed off / verified.
- No blockers from the automated gate. The single deviation (album/artist share on literal-name routes) is correctness-preserving and documented.

---
*Phase: 24-offline-app-shell-sharing-seo*
*Completed (autonomous portion): 2026-06-14 — Task 4 BLOCKING checkpoint awaiting human verify*
