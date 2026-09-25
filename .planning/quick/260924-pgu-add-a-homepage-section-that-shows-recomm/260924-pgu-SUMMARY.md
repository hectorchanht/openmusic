---
phase: quick-260924-pgu-add-a-homepage-section-that-shows-recomm
plan: 01
status: complete
subsystem: home / discovery
tags: [home, radio, recommendations, similar, lastfm, deezer, i18n]
requires: [similar.ts fetchSimilarTracks + nameStub, deezer.ts deezerArtistRadio, discovery.ts mapWithConcurrency, player.playStub + setListQueue]
provides: [radio.ts pickRadioSeeds / mergeRadio / buildRadio, 'radio' HomeSectionId, settings.homeSectionRadio]
affects: [Home page, Settings -> Home, 15 locale dictionaries]
tech-stack:
  added: []
  patterns: [lazy nameStub shelf, playStub + setListQueue list-as-Up-Next (album hero precedent)]
key-files:
  created:
    - src/lib/services/radio.ts
    - src/lib/services/radio.test.ts
  modified:
    - src/lib/services/similar.ts
    - src/lib/services/home-layout.ts
    - src/lib/services/home-layout.test.ts
    - src/routes/(app)/settings/home/+page.svelte
    - src/routes/(app)/+page.svelte
    - src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "Your Radio (id 'radio', key settings.homeSectionRadio) seeds from the 4 most recent distinct-artist history entries; Last.fm track.getSimilar per seed, Deezer artist radio on a dry seed; round-robin merge drops every already-played song"
  - "Radio tiles route through playStub (not play) so history never records a synthetic similar- uid; the shelf is installed as the queue via setListQueue(radioShelf, 'home-discovery')"
  - "No localStorage cache for the shelf: the in-memory 6h cached() makes SPA navs free (observed: 0 requests on the SPA return to Home)"
metrics:
  duration: ~12min
  completed: 2026-09-24
  tasks: 3
  files: 22
---

# Quick 260924-pgu Plan 01: Your Radio home shelf Summary

A "Your Radio" shelf on Home: up to 4 recent distinct-artist plays go in, lazy name stubs for similar songs the user hasn't played come out (Last.fm `track.getSimilar`, falling back to Deezer artist radio). Tapping a tile plays it and the rest of the shelf becomes Up Next.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (RED) | 3cafd3f | test(quick-260924-pgu): add failing tests for radio seed pick + merge |
| 1 (GREEN) | e676ecf | feat(quick-260924-pgu): radio shelf builder seeded from play history |
| 2 | 8dfc11c | feat(quick-260924-pgu): register the Your Radio home section |
| 3 | 29d2ce1 | feat(quick-260924-pgu): Your Radio shelf on Home, tap plays the shelf as Up Next |

## Verification (observed)

- Task 1 verify: `fetchSimilarTracks` export grep = 1, test tag grep = 1, `pnpm test -- radio`: 6/6 passed, `pnpm test -- similar`: 3 files, 42 tests passed.
- Task 1 RED: `pnpm test -- radio` failed on the missing `./radio` import before radio.ts existed.
- Task 2 verify: all 15 locales carry the key, settings label grep = 1, `'radio',` grep = 1, `pnpm test -- home-layout`: 38 passed, `pnpm test -- i18n`: 2 files, 50 passed, `pnpm check`: 0 errors, 0 warnings.
- Task 3 / final: `pnpm check`: 4579 files, 0 errors, 0 warnings. `pnpm test`: 146 files, 3020 tests passed.
- `git diff` of similar.ts: exactly one `export` keyword plus one docblock line.

## E2E (headless Chrome over CDP against the running dev server on :5173, fresh profile per run)

The preview tooling wasn't available to this agent. A `pnpm dev` server was already listening on 5173 and serving this same working tree, so I drove headless Google Chrome through a small CDP script kept in the session scratchpad, not in the repo.

- **(a) Fresh profile, `/`:** 30 shelf headers and no "Your Radio". 0 requests to `/api/lastfm/similar-tracks` or `/api/deezer/radio` out of 73 `/api/*` calls. PASS.
- **(b) Search "Coldplay Yellow" and tap the first row:** played and recorded as `qq:000Z74wD1h9F10`. After an SPA nav back to `/`, "Your Radio" was the first header, with 20 tiles (The Scientist, Sparks, Somewhere Only We Know, Chasing Cars, …). "Yellow" was not among them. This mount made 0 radio requests, because the Up-Next regenerate had already warmed the in-memory `cached()` for that seed. PASS.
- **(c) Tap the 3rd tile (Keane, "Somewhere Only We Know"):** it played from the qq CDN (`audio.paused=false`, t≈7s, no error). The persisted player state shows `current` = the real `qq:000JA7Br201IH5` and `upNextAnchorUid` = that uid. The queue is [Yellow (history prefix), The Scientist, Sparks, **Keane**, Snow Patrol, … Kings of Leon], so Up Next is the rest of the shelf. The newest history entry is the real qq uid, with no `similar-` uid (T-pgu-04 confirmed). PASS. See the drift note below about the now-bar.
- **(d) Settings -> Home:** "Your Radio" is the third row, with a drag grip, 3 density buttons and the switch on. Setup for this run: history seeded with Jay Chou "Mojito" and Coldplay "Yellow", then a full load of `/`. That load made 3 radio requests: Last.fm for both seeds, plus `deezer/radio?artist=Jay+Chou&limit=24`, because Last.fm is dry for Mojito. This is the Deezer fallback working live. The 24 tiles alternate between the two seeds (Jay Chou / Coldplay / …), and neither Mojito nor Yellow is among them. Toggling the switch persisted `homeHidden: ['radio']`. A full reload after that made **0** radio requests and showed no header. PASS.
- Network in this sandbox: Last.fm, Deezer, kuwo **and qq** were all reachable (qq served both the resolve and the audio), which contradicts the "qq blocked" note.

## Deviations from Plan

None. The plan was executed as written.

## Assumption Drift (advisory)

- **Found during:** Task 3 E2E (c).
  - **Planned:** "now-bar shows it immediately, audio follows."
  - **Actual:** if a song is already playing, the now-bar keeps showing it until the resolve lands. The switch happened between 1.5s and 10s.
  - **Why:** `Nowbar.svelte` renders `player.current ?? player.pendingTrack`, so the optimistic pending stub only shows when nothing is current. This behaviour already existed and is shared by every `playStub` surface (home discovery tiles, album rows). The radio wiring didn't introduce it, and it wasn't changed here.

## Known Stubs

None. Radio tiles are lazy `resolveByName` name stubs by design, not placeholder data.

## Threat Flags

None. No new endpoints or trust-boundary surface. The shelf only calls the existing `/api/lastfm/similar-tracks` and `/api/deezer/radio` routes through `apiFetch`.

## Self-Check: PASSED

- FOUND: src/lib/services/radio.ts, src/lib/services/radio.test.ts
- FOUND commits: 3cafd3f, e676ecf, 8dfc11c, 29d2ce1
