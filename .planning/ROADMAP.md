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
**Plans:** _pending — populated by `/gsd:plan-phase 27`_

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
| 27. YouTube Music Source (search·play·lyrics·download) | v1.4 | Planning | — |

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
