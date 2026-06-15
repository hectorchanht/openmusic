# Milestones

## v1.2 Resilient Playback & UX Polish (Shipped: 2026-06-15)

**Phases completed:** 9 (Phases 16–24) + Phase 999.1 (v2.0 backlog, executed early)
**Plans:** 43 | **Timeline:** 2026-06-10 → 2026-06-14
**Known deferred items at close:** 81 (see STATE.md → Deferred Items)

**Key accomplishments:**

- **Phase 16 — Playback Resilience Core:** a failed track retries across every other source then auto-skips with an explanatory toast; next track prefetched for instant start; queue auto-regenerates on exhaustion; consecutive-failure loop-guard with one actionable sticky toast.
- **Phase 17 — Up-Next Sourcing + Settings:** per-context up-next (genre-generated default, no silent search-append, no auto-expand on track change), direct queue management (swipe-to-remove, clear-all), per-context override settings, Deezer enrichment on artist/album pages.
- **Phase 18 — Sleep Timer:** set from track menu with an active-timer indicator (cancel/change anytime); ~10s volume-fade on Android/desktop, instant-pause on iOS.
- **Phase 19 — Track Menu Rework:** opens instantly with all actions visible while data resolves in background; data-gated actions self-enable on arrival; "Remix" starts a genre-generated queue; two-row marquee header; no stuck focus on long-press.
- **Phase 20 — Now-Playing Surface & Gestures:** axis-locked cover-swipe track change (vertical collapse + tap preserved), self-scrolling half-open sheet, tap-cover-to-collapse, running-line loader, nowbar mini-player swipe.
- **Phase 21 — Search & Cover Pipeline Polish:** result scoring favours shorter titles / frequent artists and penalises sub-60s 試聽 clips; cover fallback chain; lazy on-scroll cover resolution with a uid-first/name-keyed cache; empty-query autofocus without breaking state restore.
- **Phase 22 — Lyrics Polish:** tap-line-to-seek, touch/scroll auto-scroll suspend with idle-resume, end spacer to centre final lines, CN-LRC original-line highlight, wider bracket set for translation-hiding (never drops original lyrics).
- **Phase 23 — UX Audit & Homepage/Artist Polish:** shape-matched skeletons everywhere, toast + double-tap-guard action buttons, list-row swipe actions, haptics, accessibility pass (aria-pressed / focus-traps / icon labels), homepage rows-of-4 compact mode, trackless-album hiding on artist page.
- **Phase 24 — Offline App-Shell & Sharing/SEO:** service-worker app-shell loads offline (never caches `/api/*` or audio; evicts stale shells on deploy), downloaded songs play offline, online-only surfaces degrade gracefully, readable short share links with server-rendered OG/SEO per entity.
- **Phase 999.1 — v2.0 Native (Capacitor), executed early:** dual-build single codebase (web `adapter-cloudflare` untouched / native `adapter-static`), `API_BASE` fetch seam + Capacitor-origin CORS, platform-switch filesystem blob-store, background audio + hand-written Kotlin MediaStore plugin, GitHub Actions signed-APK release pipeline for sideload. Web suite stayed green.

**Carried to v1.3:** Last.fm write-side (Phases 11–13, re-deferred 2026-06-10).

---
