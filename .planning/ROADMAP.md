# Roadmap: MusicSquare Mobile

## Overview

MusicSquare Mobile is a ground-up reskin of a working desktop music player: the proven data/fetch layer is extracted from the `index.html` monolith and wired into a SvelteKit mobile PWA deployed on Cloudflare. Development proceeds bottom-up along a hard dependency chain — data layer + Worker proxy boundary, then the single-element audio engine and reactive stores, then persistence, then the mobile UI shell, then PWA wrap, then resilience/UX polish.

## Milestones

- ✅ **v1.0 Foundation** — Phases 1–7 (+14): data layer, audio engine, persistence, mobile UI shell, PWA, background audio, sources/queue/gestures (+ search/data responsiveness)
- ✅ **v1.1 Last.fm Read** — Phases 8–10 (shipped 2026-06-06): metadata enrichment, discovery/hot-picks, Last.fm-searchable source
- ✅ **v1.2 Resilient Playback & UX Polish** — Phases 16–24 (shipped 2026-06-15) → archived to [`milestones/v1.2-ROADMAP.md`](milestones/v1.2-ROADMAP.md)
- 📋 **v1.3 Last.fm Write-side** — Phases 11–13 (re-deferred 2026-06-10): auth, scrobble, loved-sync — *next milestone candidate*

## Phases

<details>
<summary>✅ v1.0 Foundation (Phases 1–7, +14)</summary>

- [ ] Phase 1: Data Layer + Proxy Foundation — typed source/proxy adapter registry; 4 sources end-to-end through same-origin `/api/*`; JOOX token edge-only
- [ ] Phase 2: Audio Engine + Playback Core — single `<audio>` singleton + reactive stores; play/pause/seek/next/prev, play modes (headless)
- [ ] Phase 3: Persistence + Library — favorites + playlists with localStorage parity + IndexedDB migration path; JSON import/export
- [ ] Phase 4: Mobile UI Shell — bottom-nav shell, mini-player, expandable now-playing, synced lyrics, zh/en toggle
- [ ] Phase 5: PWA + Service Worker — installable PWA; audio + `/api` bypass; offline state
- [ ] Phase 6: Background Audio + MediaSession — lock-screen controls + metadata; real-device iOS validation
- [ ] Phase 7: New Sources + Queue Model + Gestures — Kugou + Migu adapters; explicit Up-Next queue; drag/swipe gestures
- [x] Phase 14: Search & Data Responsiveness — first-load skeleton, cross-nav search-state restore, default 128–160k quality, TTL query cache, past-search suggestions, progressive results (completed 2026-06-06)

</details>

<details>
<summary>✅ v1.1 Last.fm Read (Phases 8–10) — SHIPPED 2026-06-06</summary>

- [x] Phase 8: Last.fm Read Foundation & Metadata Enrichment — edge read proxy + lazy additive enrichment (tags, bio, hi-res art); match-key normalization primitive (completed 2026-06-06)
- [x] Phase 9: Discovery / Hot-Picks Tab — auth-free Explore tab (charts, tag browsing, country top-lists), edge-cached (completed 2026-06-06)
- [x] Phase 10: Last.fm-searchable Source — re-search resolver best-match scoring; discovery is tap-to-play (completed 2026-06-06, security-verified)

</details>

<details>
<summary>✅ v1.2 Resilient Playback & UX Polish (Phases 16–24) — SHIPPED 2026-06-15</summary>

Full phase details archived in [`milestones/v1.2-ROADMAP.md`](milestones/v1.2-ROADMAP.md).

- [x] Phase 16: Playback Resilience Core (3/3 plans)
- [x] Phase 17: Up-Next Sourcing + Settings Plumbing (4/4 plans)
- [x] Phase 18: Sleep Timer (3/3 plans)
- [x] Phase 19: Track Menu Rework (3/3 plans)
- [x] Phase 20: Now-Playing Surface & Gestures (4/4 plans)
- [x] Phase 21: Search & Cover Pipeline Polish (5/5 plans)
- [x] Phase 22: Lyrics Polish (2/2 plans)
- [x] Phase 23: UX Audit & Homepage/Artist Polish (8/8 plans)
- [x] Phase 24: Offline App-Shell & Sharing/SEO (5/5 plans)

</details>

### 📋 v1.3 Last.fm Write-side (Phases 11–13, planned)

- [ ] Phase 11: Last.fm Auth (signed-call infrastructure + `sk` cookie)
- [ ] Phase 12: Scrobble
- [ ] Phase 13: Loved-track Sync

### 🌐 Translation Reliability (Phase 25, planned)

**Goal:** zh-Hans→zh-Hant becomes reliable + offline — a lazy client-side TongWenTang s2t converter handles Chinese content when the target is `zh-Hant` (no API, no rate limit, works offline / on lockscreen), non-Chinese lines fall through to `/api/translate`, and the server endpoint's single Google provider is replaced by an ordered cascade Azure → DeepL → Google that advances on failure / rate-limit / echo. The existing `translated`/`flags`/`complete` client contract stays intact.

- [x] Phase 25: zh-Hant Offline Conversion + Translation Fallback Cascade — bundle `tongwen-core` + `tongwen-dict` s2t dicts (~72 KB gz, lazy client-side dynamic import); route Chinese source → offline Simplified→Traditional when target `zh-Hant` (no API, works offline/lockscreen); replace the single unofficial-Google call with a provider **cascade Azure → DeepL → Google** (advance on failure / rate-limit / echo via the existing `flags`/`complete` signal); CJK-source detection so JA kanji isn't mis-converted; existing test suite stays green. See [`notes/zh-hant-offline-conversion.md`](notes/zh-hant-offline-conversion.md). (completed 2026-07-11)

**Plans:** 3 plans (2 waves)

- [x] 25-01-PLAN.md — Lazy TongWenTang s2t converter module + CJK/kana `isChineseLine` predicate + unit tests; pinned tongwen deps behind a legitimacy checkpoint (D-01/D-03/D-04) [wave 1]
- [x] 25-02-PLAN.md — `/api/translate` Azure → DeepL → Google provider cascade; optional edge-only provider keys in `Env`; server-side tests (D-05/D-06) [wave 1]
- [x] 25-03-PLAN.md — Wire the offline converter into `translateLinesEx` so `zh-Hant` Chinese lines convert offline and only non-Chinese lines hit the API; `CACHE_VER` bump; contract preserved (D-02/D-04) [wave 2, depends 25-01]

### Phase 27: YouTube Music Source (v1.4 — search · play · lyrics · download)

**Goal:** Add YouTube Music as a first-class **anonymous** source — search · play · lyrics · download — that fits the existing adapter model (`src/lib/sources/ytmusic.ts` client adapter + `src/routes/api/ytmusic/` edge proxy + one `registry.ts`/`SourceId` line) and preserves the app's zero-user-credentials trust posture. De-risked by spikes 005–007 (`.planning/spikes/`): search = InnerTube `WEB_REMIX`; play = `ANDROID_VR` player + cached `visitorData` → direct AAC (itag 140), no cipher/throttle, **IP-locked so bytes must proxy edge-side (audius pattern)**; lyrics = plain via `next`→`browse`, timed via the existing `crossSourceLyric` fallback. YTMusic stays **OFF the kuwo-first resolve hot path** (search-page + explicit-pick only). **Account connection / library inheritance (liked songs · history · genre) is OUT** — spike 008 = a separate, later, legal-gated milestone.
**Requirements:** YT-SRC-01 (SourceId + registry + adapter contract), YT-SEARCH-01 (InnerTube search → Track stubs), YT-PLAY-01 (ANDROID_VR+visitorData resolve → edge-proxied AAC stream), YT-LYRICS-01 (plain via InnerTube + timed via crossSourceLyric fallback), YT-DOWNLOAD-01 (download via the proxied stream URL), YT-RESILIENCE-01 (never-throw + graceful failure + adversarial-upstream maintenance posture)
**Depends on:** none — additive source; independent of the Last.fm write-side (11–13). Honors the spike-findings-openmusic resolution policy (kuwo-first floor unchanged).
**Plans:** 2/4 plans executed

- [x] 27-01-PLAN.md — `SourceId`+`autoResolveEligible` flag, `registry.ts` line (ytmusic last, off the auto-resolve floor), client adapter `search()` parse over a captured InnerTube fixture (YT-SRC-01/YT-SEARCH-01) [wave 1]
- [x] 27-02-PLAN.md — Edge routes `/api/ytmusic/search` + `/api/ytmusic/lyrics` + shared `src/lib/proxy/ytmusic.ts` (InnerTube consts, `innerTubePost`, `getVisitorData`, lyrics extractors) (YT-SEARCH-01/YT-LYRICS-01) [wave 1]
- [x] 27-03-PLAN.md — Stream route `/api/ytmusic/stream/:videoId`: ANDROID_VR player + cached visitorData → itag-140 AAC → googlevideo byte-proxy with Range passthrough (raw fetch); refresh-on-LOGIN_REQUIRED (YT-PLAY-01/YT-DOWNLOAD-01) [wave 2, depends 27-02]
- [x] 27-04-PLAN.md — Adapter `resolve()` best-effort plain lyrics + resilience wiring (registry-flag exclusion from failover/name-stub; allSettled isolation; registry-driven settings/label) (YT-LYRICS-01/YT-RESILIENCE-01) [wave 2, depends 27-01]

### Phase 28: YTMusic-Powered Up-Next Recommendations

_v1.5 — source-aware similar + top-hits fallback_

**Goal:** Make the "generate by similar songs" up-next builder **source-aware** so a YTMusic-only seed (repro: 摩四老年《港耆》) yields genuine related tracks from YouTube Music's watch-next/radio queue instead of silently falling back to unrelated picks — and replace the last-resort empty-similar fallback so it draws from real top/chart hits rather than a random hard-coded artist pool. Diagnosis: [`.planning/debug/upnext-similar-empty-fallback.md`](debug/upnext-similar-empty-fallback.md) — `buildSimilarQueue` ([`similar.ts:173`](../src/lib/services/similar.ts)) is structurally source-blind (all 3 tiers key on seed `artist`/`title` strings vs Last.fm/Deezer/CN; never reads `track.source`/`track.songid`), so a YT-only seed returns `[]` and both callers (`regenerate()` [`player.svelte.ts:3077`](../src/lib/stores/player.svelte.ts), `ensureAhead()` [`player.svelte.ts:2011`](../src/lib/stores/player.svelte.ts)) silently substitute `buildDiversePicks` random `ARTIST_POOL` ([`picks.ts:9`](../src/lib/services/picks.ts)). Transport already exists: `innerTubePost` → `NEXT_URL` (`youtubei/v1/next`, [`proxy/ytmusic.ts:59`](../src/lib/proxy/ytmusic.ts)), already called by the lyrics route which discards the watch-next rows it carries.
**Requirements:**
- **UPNEXT-YT-01** — YTMusic related/watch-next source: parse the `NEXT_URL` watch-next queue → `Track` stubs; expose via a source method (`ytmusic.related(videoId)`) + route (new `/api/ytmusic/related` or lyrics-route extension), reusing the existing `innerTubePost`/`NEXT_URL`/`getVisitorData` transport.
- **UPNEXT-YT-02** — Source-aware branch in `buildSimilarQueue`/`regenerate`: when `seed.source === 'ytmusic'`, use `seed.songid` (videoId) against the YTMusic related path before/instead of the string-keyed Last.fm tiers; honor `autoResolveEligible: false` for resulting stubs.
- **UPNEXT-FB-01** — Replace the `buildDiversePicks` random `ARTIST_POOL` last-resort fallback with a **top/chart-hits** fallback so the genuinely-empty case still offers broad, real-popular options (not random noise).
- **UPNEXT-YT-03** — Never-throw + graceful degrade (empty → existing fallback chain); zero regression to CN-seed similar behavior; `pnpm test` green + `pnpm check` clean.
**Depends on:** Phase 27 (YouTube Music Source) — reuses its edge proxy transport (`proxy/ytmusic.ts`) + adapter/registry wiring.
**Plans:** 3 plans
- [ ] 28-01-PLAN.md — YTMusic related/watch-next edge parser (`parseWatchNextQueue`) + `/api/ytmusic/related` route [wave 1]
- [ ] 28-02-PLAN.md — source-aware `buildSimilarQueue` YT-seed branch + `ytmusicRelated` client service [wave 2]
- [ ] 28-03-PLAN.md — `buildTopHitsQueue` fallback + swap both `buildDiversePicks` player call sites [wave 3]

### Phase 29: Download UX & Folder Control

_v1.5 — controlled filename · media-page bug fix · per-song state · native `/download/openmusic` + migration_

**Goal:** Overhaul the download experience. Control the saved filename ourselves — `{artist} - {song}.{ext}` run through the display-name translation (`names.dnArtist`/`names.dnTitle`, so a zh-Hant user gets a zh-Hant filename), never the provider's name. Fix the "clicking download opens a media playing page" bug (a failed save currently does `window.open(audioUrl)` at [`TrackMenu.svelte:230`](../src/lib/components/TrackMenu.svelte) + the album twin). Give each song its own download state via a reactive `library.downloading` `Set<uid>` — a per-song spinner then a greyed, disabled "Downloaded" — on every track row (`CompactRow`, library, album, ⋮ menu), so downloading song A never spins song B. On **native** (Capacitor Android), land public downloads in `Download/openmusic/` instead of today's `Music/OpenMusic/` (folder hardcoded in [`MediaStoreSaverPlugin.kt:51`](../android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt) + legacy 178–179) with no per-download location prompt, and add a Settings → Data migration button that moves already-downloaded files into the new folder, rewrites the `openmusic-blob-uri:<uid>` index ("remap"), and switches all future read/write there. **Platform split (locked in [`29-CONTEXT.md`](phases/29-download-ux-folder-control/29-CONTEXT.md)):** native owns the folder + migration (a browser cannot pick a save folder or read/move files); the web PWA gets filename + bug-fix + per-song state, best-effort into the browser Downloads root. Existing never-throws + download-isolation contracts (quick-260625-pzs-04) preserved.
**Requirements:**
- **DL-FILE-01** — Controlled, translated filename: one shared pure helper (`download-filename.ts`) builds `{artist} - {song}.{ext}` from `names.dnArtist`/`names.dnTitle` (raw fallback when a translation isn't cached), extension from the resolved audio; called by TrackMenu, album download, and the native public-filename path (`blob-store.nativeFileName`, today `<uid>.mp3`). App-private offline copy stays uid-keyed.
- **DL-BUG-01** — Remove the `window.open(audioUrl)` fallback in `TrackMenu.doDownload` + `album.downloadAlbum`; drop `showSaveFilePicker` (prompts every time). On save failure: toast + keep the song in the Library Downloads reference list — never navigate to the stream.
- **DL-STATE-01** — Reactive per-uid downloading state (`library.downloading: Set<string>` with begin/end helpers); every track-row download affordance renders idle → spinner (`downloading.has(uid)`, disabled) → greyed "Downloaded" (`library.isDownloaded(uid)`, disabled). Rollout: `CompactRow`, library-page rows, album-page rows, ⋮ menu Download row. New i18n key `menu.downloaded` across all 16 locales.
- **DL-FOLDER-01** — Native public download target moves to `Download/openmusic/` (Kotlin `DIRECTORY_DOWNLOADS/openmusic/` API 29+ + legacy path), no location prompt. Web degrades to the browser Downloads root.
- **DL-MIGRATE-01** — Settings → Data native-only migration button: new `MediaStoreSaver.relocateToDownloads` Kotlin method moves existing public files `Music/OpenMusic/` → `Download/openmusic/`, rewrites each `openmusic-blob-uri:<uid>` entry, switches future writes; idempotent, per-uid graceful failure, app-private copies untouched.
- **DL-RESILIENCE-01** — All new native filesystem/MediaStore paths keep the never-throws contract (degrade to CDN re-stream, never crash the player); download work never mutates player state (isolation contract); `pnpm test` green + `pnpm check` clean.
**Depends on:** Phase 999.1 (native Capacitor migration) — reuses its `blob-store.ts` native branch + hand-written `MediaStoreSaverPlugin.kt` MediaStore bridge, both extended here.
**Plans:** 4/6 executed — **web scope COMPLETE** (29-01…04); native plans 29-05/29-06 **DEFERRED** (user: web-only for now, 2026-07-23). The web app fully delivers filename control + translation (DL-FILE-01), the media-page bug fix (DL-BUG-01), and per-song loading + greyed "Downloaded" (DL-STATE-01). The Android `Download/openmusic/` folder (DL-FOLDER-01) + migration button (DL-MIGRATE-01) remain for a future native pass — plans are written + de-risked, resume via `/gsd:execute-phase 29`.
- [x] 29-01-PLAN.md — Pure download helpers: `download-filename.ts` (translated `{artist} - {song}.{ext}` + `extFromAudioUrl`) + `download-save.ts` (anchor save, no `window.open`/`showSaveFilePicker`) + tests (DL-FILE-01/DL-BUG-01) [wave 1]
- [x] 29-02-PLAN.md — `library.downloading` reactive per-uid Set + begin/end helpers + `menu.downloaded`/migration i18n keys across all 16 locales (DL-STATE-01/DL-MIGRATE-01) [wave 1]
- [x] 29-03-PLAN.md — Shared `downloadTrack` service (isolation-safe, never-throws, no navigation) + `blobStore.put(uid, blob, filename?)` param (DL-FILE-01/DL-BUG-01/DL-STATE-01) [wave 2]
- [x] 29-04-PLAN.md — Wire `downloadTrack` into TrackMenu + album (delete `window.open`/`showSaveFilePicker`); `DownloadControl` tri-state rollout on library/album/⋮ rows + CompactRow passive badge (DL-FILE-01/DL-BUG-01/DL-STATE-01) [wave 3]
- [ ] 29-05-PLAN.md — ⏸ DEFERRED (native) — Native folder: Kotlin `MediaStore.Downloads` collection swap → `Download/openmusic/` + `saveToDownloads` rename; blob-store/media-store native branch; device UAT (DL-FOLDER-01/DL-RESILIENCE-01) [wave 3, autonomous:false]
- [ ] 29-06-PLAN.md — ⏸ DEFERRED (native) — Migration: `blobStore.migrateDownloads` copy+delete+remap (idempotent, per-uid never-throw) + native-only Settings→Data button "Moved N of M"; device UAT (DL-MIGRATE-01/DL-RESILIENCE-01) [wave 4, autonomous:false]

### Phase 30: Carrier-Free Share Links (`/{type}/{artist}/{title}` + `/api/og`)

_v1.5 — every query carrier removed from every share surface_

**Goal:** Make a shared link short, readable and meaningful while the OG card still shows real album art. Today a song link is `~172` chars and **64% of it is the cover carrier** — `?n=Come%20As%20You%20Are&a=Nirvana&c=https%3A%2F%2Fcdn-images.dzcdn.net%2F…1000x1000-000000-80-0-0.jpg` — because [`buildOg`](../src/lib/services/share.ts) may only emit `og:image` from query params (threat T-24-08 forbids an arbitrary server-side fetch from a share link). Fix both halves at once: move the identity into **two path segments** and move the cover into a **new own-origin `/api/og` image endpoint**. Result:

```
/song/Nirvana/Come-As-You-Are      ← was /song/come-as-you-are-nirvana?n=&a=&c=
/album/Nirvana/Nevermind           ← was /album/{name}?artist=&c=&dn=&da=
/artist/Nirvana                    ← was /artist/{name}?c=&dn=
```

**Zero query carriers remain.** `og:image` becomes `${SITE}/api/og?type=song&artist=…&title=…` — long, but it lives inside a meta tag where length is invisible. Direction, tradeoffs and the rejected alternatives (md5-only carrier, KV short links) are recorded in [`notes/share-link-cover-carrier-tradeoff.md`](notes/share-link-cover-carrier-tradeoff.md).

**Three findings de-risk this.** (1) Path segments are **not** ASCII-limited — `slugify` ASCII-strips, but a raw-UTF-8 path segment (`/song/周杰倫/稻香`) is valid, percent-encoded on the wire and shown decoded by browsers and messenger previews, so the path can carry the *authoritative* title+artist rather than a lossy cosmetic slug. (2) Two segments make `/` the separator, so the single-segment separator-ambiguity problem simply ceases to exist. (3) The song share page **never renders the carried cover** (it draws `cover--placeholder`, a gradient), so dropping `c` regresses zero in-app behavior. SSRF posture also gets **tighter**: input becomes path text instead of an arbitrary https URL from the sharer's client, and output still passes the `safeImageUrl` host allowlist.

**Requirements:**
- **OG-PATH-01** — New two-segment routes `/song/[artist]/[title]` and `/album/[artist]/[name]` (artist stays `/artist/[name]`), each a per-route `ssr = true` / `prerender = false` opt-in exactly like the current entity routes — **never** a `+page.server.ts` (that breaks the `adapter-static` native build, Pitfall 5 / T-24-09). Segments carry raw text with **original case preserved** and spaces as `-`. Case-preserving is deliberate: the OG card title is read straight from the path, so lowercasing would force a title-case reconstruction that renders `DNA` as `Dna`. Known lossy edge: a literal hyphen in a title decodes as a space (`Spider-Man` → `Spider Man`), absorbed by `playStub`'s fuzzy `scoreMatch`.
- **OG-PATH-02** — `songShareUrl` and `entityCardUrl` emit the new shapes and set **no query params at all** (`c`, `n`, `a`, `artist`, and — pending OG-ZH-01 — `dn`/`da` all gone). Resolution still runs through the existing `playStub` / `getAlbumTracklist` path, now keyed off the decoded segments.
- **OG-EP-01** — New `src/routes/api/og/+server.ts` (`GET ?type=song|album|artist&artist=&title=`) resolving the cover through a **tiered, bounded** chain: Deezer → iTunes → **kuwo only** → stream `/og.svg`. kuwo, not `searchAll` fan-out (per `spike-findings-openmusic` kuwo-first) — that caps the route at ≤3 subrequests so a cold crawl stays inside every crawler's fetch budget. Per-tier `AbortSignal.timeout` under one overall ~2.5s deadline; a miss or timeout falls through to the branded `/og.svg` — the route **never** 500s and never exceeds the crawl budget.
- **OG-EP-02** — Response streams `new Response(upstream.body, { headers })` (≈0 CPU on Workers — the body is not buffered) with `Content-Type` from upstream and `Cache-Control: public, max-age=86400, immutable`. **No 302 redirect** — streaming sidesteps per-crawler redirect-follow variance (WhatsApp / iMessage are the fussy ones). Two `caches.default` layers via `edgeCache()`/`ownOriginCacheKey()`: the `artist+title → coverUrl` resolve and the image bytes.
- **OG-EP-03** — Extract the Deezer cover upstream call from [`api/deezer/search/+server.ts`](../src/routes/api/deezer/search/+server.ts) into `$lib/proxy/deezer-cover.ts` so `/api/og` and `/api/deezer/search` share one implementation. Required, not cosmetic: a `+server.ts` cannot export non-verb helpers (it 500s at request time and unit tests miss it). Extend `safeImageUrl` to `*.mzstatic.com` + the kuwo cover host, applied per tier.
- **OG-ZH-01** — **Decide explicitly during planning, don't default to yes.** `dn`/`da` exist only because the zhs→zht-converted display name had no server-side equivalent — but [`zh-convert.ts`](../src/lib/services/zh-convert.ts) is pure `.ts` (no browser globals, node-testable) and `tongwen-core`/`tongwen-dict` are real runtime `dependencies`, so the SSR loader *can* convert Simplified→Traditional server-side and retire both carriers. Cost: the ~72KB s2t dict dynamic-imports into the edge SSR path — fine against the 3MB compressed Worker limit, but real per-request weight on a cold isolate. This is the only part of the phase that adds edge cost.
- **OG-COMPAT-01** — The old routes stay as **legacy handlers**: `/song/[slug]?n=&a=&c=` plus the query-carrier album/artist forms keep resolving *and* keep their card (legacy `c` still https-gated exactly as today). Path depth differs, so the routes coexist with no matching conflict. Tests assert both the new carrier-free path and every legacy query shape.
- **OG-VERIFY-01** — `share.test.ts` updated for the new shapes (incl. CJK segments and case preservation); new tests for the `/api/og` tier fallthrough, the deadline path, and `safeImageUrl` rejection per tier. Real-crawler check against WhatsApp / Twitter / iMessage / Slack / Discord. **Caveat:** the Deezer + iTunes tiers are E2E-verifiable in-sandbox; the **kuwo tier is not** (no CN upstream network here — see the `sandbox-no-cn-upstream-network` finding), so it needs unit tests plus a device/prod check. `pnpm test` green + `pnpm check` clean.
- **OG-PAGE-01** — Side-win: swap the song share page's `cover--placeholder` gradient for `<img src={data.og.image}>` so the crawler card and the landing page show the same art, and correct the stale "the cover is never carried" comment (see [`todos/pending/song-share-stale-cover-comment.md`](todos/pending/song-share-stale-cover-comment.md)). Fix `og:type` per surface while in `PageOg` (today every route emits `music.song`).

**Depends on:** Phase 24 (Offline App-Shell & Sharing/SEO) — owns the SSR opt-in + `buildOg`/`PageOg` seam this modifies; and the Deezer cover proxy from the Phase 9/26 cover pipeline, whose upstream call OG-EP-03 extracts.
**Plans:** 5/6 plans executed — **Phase 30 is DEPLOYED to `openmusic.lol`** and 30-06 is one check from closing. Its phase gate is green (89 test files / 1494 tests, `pnpm check` 4365 files 0 errors, both builds exit 0, the full curl matrix observed locally *and* in production, a `/api/og` cache hit at both the workerd and production level). **OG-VERIFY-01 PASSED** — a real WhatsApp card renders real album art from the deployed `/api/og`, and the pre-existing `%`-name 500 is confirmed fixed live (`/album/50%25%20Off` and `/artist/50%25%20Cent` both 200, both 500 before). Scope limit: WhatsApp only, no iMessage/Slack/validators. **OG-PAGE-01 still open** — the debug APK is built (5.2 MB) but has not been run on a device.

- [x] 30-01-PLAN.md — Carrier-free songShareUrl/entityCardUrl + path-segment codec + ogImageUrl; drop share-time s2t; §F.20 share.test.ts rewrite (OG-PATH-02/OG-ZH-01) [wave 1]
- [x] 30-02-PLAN.md — Extract `$lib/proxy/deezer-cover.ts` + rewire /api/deezer/search; deezer-endpoint.test.ts passes UNMODIFIED as the proof (OG-EP-03) [wave 1]
- [x] 30-03-PLAN.md — `$lib/proxy/og-cover.ts` tier chain (Deezer→iTunes→kuwo, 2.5s deadline) + streaming `/api/og` route with two own-origin cache layers + endpoint tests (OG-EP-01/02/03) [wave 2, depends 30-02]
- [x] 30-04-PLAN.md — New `/song/[artist]/[title]` + `/album/[artist]/[name]` routes + first loader tests + PageOg origin/og:type fix + APK-safe `<img>` (OG-PATH-01/OG-PAGE-01) [wave 2, depends 30-01]
- [x] 30-05-PLAN.md — Legacy compat: fix the live `%` double-decode 500 (fail-first tests), og.type per legacy loader, dual-shape artist handler, legacy song-page `<img>` swap (OG-COMPAT-01/OG-PAGE-01) [wave 3, depends 30-01+30-04]
- [ ] 30-06-PLAN.md — Phase gate: full suites/builds + curl matrix, then deploy + real-messenger card check and APK cover check (OG-VERIFY-01/OG-PAGE-01) [wave 4, autonomous:false] — **OPEN, one item left: Task 1 gate green + committed; Task 2 (deploy + WhatsApp card) PASSED; Task 3 APK built (5.2 MB) but the on-device cover check has not been run**

## Progress

| Phase | Milestone | Status | Completed |
| ----- | --------- | ------ | --------- |
| 1–7 Foundation | v1.0 | Foundation | — |
| 14. Search & Data Responsiveness | v1.0 | Complete | 2026-06-06 |
| 8. Last.fm Read Foundation | v1.1 | Complete | 2026-06-06 |
| 9. Discovery / Hot-Picks | v1.1 | Complete | 2026-06-06 |
| 10. Last.fm-searchable Source | v1.1 | Complete | 2026-06-06 |
| 16. Playback Resilience Core | v1.2 | Complete | 2026-06-15 |
| 17. Up-Next Sourcing + Settings | v1.2 | Complete | 2026-06-15 |
| 18. Sleep Timer | v1.2 | Complete | 2026-06-15 |
| 19. Track Menu Rework | v1.2 | Complete | 2026-06-15 |
| 20. Now-Playing Surface & Gestures | v1.2 | Complete | 2026-06-15 |
| 21. Search & Cover Pipeline Polish | v1.2 | Complete | 2026-06-15 |
| 22. Lyrics Polish | v1.2 | Complete | 2026-06-15 |
| 23. UX Audit & Homepage/Artist Polish | v1.2 | Complete | 2026-06-15 |
| 24. Offline App-Shell & Sharing/SEO | v1.2 | Complete | 2026-06-15 |
| 11–13. Last.fm Write-side | v1.3 | Planned | — |
| 25. zh-Hant Offline Conversion + Fallback Cascade | 3/3 | Complete   | 2026-07-11 |
| 26. Minimal-API Click-to-Play Redesign | 11/11 | Complete   | 2026-07-11 |
| 27. YouTube Music Source (search·play·lyrics·download) | 4/4 | Complete|  |
| 28. YTMusic-Powered Up-Next Recommendations | v1.5 | Planned | — |
| 29. Download UX & Folder Control | 4/6 (web ✓, native deferred) | Web Complete | 2026-07-23 |
| 30. Carrier-Free Share Links + `/api/og` | 5/6 | In Progress|  |

## Backlog

### Phase 999.1: v2.0 Native (Capacitor) migration (BACKLOG)

**Goal:** Ship an installable, signed Android APK of MusicSquare via Capacitor 8 — full background audio + lock-screen controls, downloads to device storage, distributed by sideload (GitHub Releases / Obtainium), with the web Cloudflare deploy untouched. (iOS slice + API worker extraction deferred.)
**Requirements:** none mapped (backlog phase — covers CONTEXT.md decisions D-01..D-12)
**Plans:** 6/6 plans complete (executed early during v1.2; device-UAT deferred — see STATE.md → Deferred Items)

Decided context (assessment 2026-06-11, full doc: `~/.claude/plans/i-m-planning-to-make-fluffy-star.md`):

- **Distribution:** sideload-only — Android signed APK via GitHub Releases, iOS Xcode sideload/AltStore. Store submission ruled out (Apple Guideline 5.2.3 / Google Play IP policy — unofficial music-source aggregation + downloads is near-certain rejection). Skip store-compliance scope entirely.
- **API extraction (no-regret, could pull forward):** port ~17 `/api/*` routes + `src/lib/proxy/` to standalone Hono Cloudflare Worker (`musicsquare-api` repo), wrangler CI auto-deploy, secrets via `wrangler secret`, CORS allowlist incl. `capacitor://localhost` + `http://localhost`. Frontend gains single `API_BASE` config (empty = same-origin web, worker URL = native).
- **Dual-build, single frontend codebase:** `svelte.config.js` switches adapter by env — default `adapter-cloudflare` (web unchanged), `BUILD_TARGET=native` → `adapter-static` SPA fallback.
- **Storage: NO sqlite.** localStorage persists fine in Capacitor app container (Safari-PWA eviction problem disappears). Platform-switch `src/lib/services/blob-store.ts` backend: IndexedDB on web (unchanged) / `@capacitor/filesystem` + `capacitor-blob-writer` on native for downloaded songs.
- **Highest risk = background audio:** iOS `UIBackgroundModes: audio` + AVAudioSession category; Android foreground service / media notification plugin. Needs dedicated research phase.
- **Effort:** ~3–4 weeks part-time. Rough phase split: (a) API worker extraction, (b) dual-build + Capacitor shell, (c) filesystem storage, (d) background audio + media controls, (e) APK release pipeline + sideload docs.
- When promoted: reverse the native-apps exclusion in PROJECT.md/REQUIREMENTS.md.

Plans:

- [x] 999.1-01-PLAN.md — API_BASE fetch seam (D-03) + Capacitor-origin CORS via hooks.server.ts (D-02); web byte-identical [wave 1]
- [x] 999.1-02-PLAN.md — dual-adapter build switch (D-01) + Capacitor Android scaffold (D-12); first foreground-playing debug APK [wave 2]
- [x] 999.1-03-PLAN.md — blob-store filesystem platform-switch (D-10) + public-Music vs app-private storage decision (D-11) [wave 3]
- [x] 999.1-04-PLAN.md — background audio: plugin Cap-8 compat spike + native media-session bridge + FGS (D-04/D-05/D-06); device-gated [wave 4]
- [x] 999.1-05-PLAN.md — GitHub Actions signed-APK release pipeline + Obtainium versioning (D-07/D-08/D-09) [wave 5]

**Cross-cutting constraints:**

- The existing ~626-test suite stays green and pnpm check passes (web must not regress)

### Phase 26: Minimal-API Click-to-Play Redesign

**Goal:** Cut a single-song play from ~59 `/api/*` calls to ~3 while staying fully functional across every language/region/genre. Grounded in spikes 001–004 (`Skill("spike-findings-openmusic")` + [`spikes/004-source-coverage-by-segment/POLICY.md`](spikes/004-source-coverage-by-segment/POLICY.md)): kuwo is empirically 100% playable+cover across all 14 language/region×genre segments; Last.fm `track.getSimilar` returns exact `{artist,title}` pairs in 1 call; measured baseline is ~59 calls/play (56 = `buildSimilarQueue`'s 8 similar-artists × 7 sources). **Hard rule: never fan out all 7 sources on click.**
**Requirements**: RESOLVE-01, RESOLVE-02, COVER-01, UPNEXT-01, VERSIONS-01, NETEASE-01 (phase-local tags derived from the spike POLICY + spike-findings skill)
**Depends on:** none — self-contained refactor of the resolve / up-next / cover paths (independent of Phase 25 translation work)
**Plans:** 11/11 plans complete

- [x] 26-01-PLAN.md — Kuwo-first resolve/fallback order + single-source name-stub resolver + bounded crossSourceLyric (RESOLVE-01/02) [wave 1]
- [x] 26-02-PLAN.md — Source-embedded cover on the hot path + bounded lazy Deezer HQ upgrade; no cover fan-out (COVER-01) [wave 1]
- [x] 26-04-PLAN.md — Version-picker modal on multi-source search rows (retain pre-dedupe variants) + i18n (VERSIONS-01) [wave 1]
- [x] 26-05-PLAN.md — netease qijieya dry-spell health-gate (skip/deprioritize + self-recover) (NETEASE-01) [wave 1]
- [x] 26-03-PLAN.md — New /api/lastfm/similar-tracks (track.getSimilar) route + buildSimilarQueue rewrite 56→1, lazy kuwo-first stubs (UPNEXT-01) [wave 2, depends 26-01]

Gap-closure plans (UAT 2026-07-11 — 6 diagnosed gaps; `/gsd:execute-phase 26 --gaps-only`):
- [x] 26-06-PLAN.md — [BLOCKER] click-to-play resolve watchdog: stalled/null initial resolve routes into the kuwo-first cross-source walk + auto-skip (RESOLVE-02) [wave 1]
- [x] 26-07-PLAN.md — Up-Next service+edge: CR-01 post-filter fallback gate + report(via) callback; /api/lastfm/similar-tracks image passthrough; seed stub covers (UPNEXT-01/COVER-01) [wave 1]
- [x] 26-08-PLAN.md — Gap-4/5 foundation: lazy on-demand fetchVariants (single fan-out) + VersionPicker loading state + intra-source dedup & distinguishing version label (album/(Live)/(Demo)/(Cover)) so variants aren't N identical rows + i18n (VERSIONS-01) [wave 1]
- [x] 26-09-PLAN.md — Up-Next player wiring: regenerate() buildDiversePicks safety net + upnext.source activity-log event (UPNEXT-01) [wave 2, depends 26-06, 26-07]
- [x] 26-10-PLAN.md — UI mounts: Up-Next tiles paint seeded covers (no per-tile chain) + version selector in Up-Next & TrackMenu, lazily; human-verify (COVER-01/VERSIONS-01) [wave 2, depends 26-07, 26-08]
- [x] 26-11-PLAN.md — [Gap-6] JOOX identity self-heal: on a stale n-index mismatch, re-locate the song by its stable songmid (one keyword re-search → corrected n → detail); unrecoverable mismatch returns UNRESOLVED (never throws) → routes into the null-resolve → runFallback → skip path, so a version pick never sticks a nowbar error (VERSIONS-01/RESOLVE-02) [wave 1]

Scope (candidate plans — plan-phase breaks these down):
- [ ] **Kuwo-first resolve/fallback chain** — reorder `kuwo → qq → netease → joox → (fivesing/audius/jamendo)`; single-source resolve on click; cross-source failover walks the chain, no re-search (`registry.ts`, `catalog.ts`, `player.svelte.ts`)
- [ ] **Source-embedded cover on the hot path** — use kuwo/qq/netease inline cover immediately; lazy Deezer HQ upgrade; run the Deezer→iTunes→CN chain only for coverless joox/fivesing (`cover-backfill.ts`, player cover seam)
- [ ] **Up-Next via `track.getSimilar`** — new `/api/lastfm/similar-tracks` edge route; rewrite `buildSimilarQueue` (56 calls → 1); exact name+artist stubs, lazy single-source resolve, `match`-ordered; artist-hop fallback resolved single-source; bound `crossSourceLyric` to one fetch (`similar.ts`, `catalog.ts`)
- [ ] **Version-picker modal** — control before the play/grip button opens a modal listing same-name+artist versions across sources (data already in search results)
- [ ] **netease upstream health-gate** — detect/skip the intermittent qijieya Meting dry-return so a dead default-primary doesn't silently degrade live search (`proxy/netease.ts` or catalog-level guard)

### Phase 31: Faster, smoother playback — cut click-to-play latency and stop failed/skipped tracks

**Goal:** Playback feels streaming-instant and never dead-ends: tap→audio start is fast, the next track never silently fails, and a broken download falls back to the normal resolver chain instead of being skipped.
**Requirements**: D-01..D-19 (locked decisions in 31-CONTEXT.md — `phase_req_ids` is null, so the D-numbers are the traceability keys)
**Depends on:** Phase 30
**Plans:** 6/6 plans complete

Scope (raw, pre-planning):
- **Click-to-play latency** — cut time from tap to first audio. Resolve path, prefetch, warming the next track's URL before it's needed.
- **Next-song failures** — harden auto-advance/prefetch so a stale or dead resolved URL doesn't produce a silent failure or a skip.
- **Downloaded-song fallback** — when a downloaded blob is missing/corrupt, treat the track like any un-downloaded track and run the full multi-resolver chain instead of skipping it (`player.svelte.ts` offline-first branch).
- **Open architecture question (settle in discuss):** does an edge-side store make playback faster — caching resolved audio URLs, cover/match data, or source-availability hints — and if so which store, what TTL, what invalidation, given CN source URLs expire.

**CF infra recon (2026-08-09, via Cloudflare API):**
- `open-music-db` D1 (`a14554d5-7190-440a-b4f4-23ec93dfb4b4`, created 2026-05-09) exists with **0 tables** and is **not bound** to the Pages project.
- `open-music-audio` R2 bucket (created 2026-05-09) exists and is **not bound** either.
- **No KV namespace** for openmusic. Pages production config carries only `JAMENDO_CLIENT_ID` + the three secrets — no `d1_databases`/`r2_buckets`/`kv_namespaces` bindings.
- So: "do we need a CF DB" is really "do we wire up the D1/R2 that were already provisioned and abandoned, or is Cache API (already used by `/api/og`) enough." Cache API is the cheapest rung; D1/R2 only if a cross-user, cross-PoP durable store is genuinely required.

Plans:
- [x] 31-01-PLAN.md — corrupt-download self-repair: blob size gate, provenance flag, eviction + background re-download (D-12/13/14) [wave 1]
- [x] 31-02-PLAN.md — reliability policy: cross-source retry before skip, forgiving strikes, skip toasts (D-15/16/17/18) [wave 2]
- [x] 31-03-PLAN.md — `/api/resolve` edge cache: versioned `caches.default` entry, edge-side fill, delete-only bust (D-06/07/09/10) [wave 1]
- [x] 31-04-PLAN.md — client cache-first read + dead-URL bust report, advisory and never-throwing (D-08/09/11) [wave 3]
- [x] 31-05-PLAN.md — pre-warm on top search result and menu open, via one testable seam (D-03) [wave 1]
- [x] 31-06-PLAN.md — phase gate + human verification of the real cache cycle and measured latency [wave 4]
