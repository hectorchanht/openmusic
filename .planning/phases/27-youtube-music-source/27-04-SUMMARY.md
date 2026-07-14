---
phase: 27-youtube-music-source
plan: 04
subsystem: sources+services
tags: [ytmusic, lyrics, resilience, fallback, name-stub, allsettled, registry-driven]
requires:
  - "src/lib/sources/ytmusic.ts (27-01 adapter: search() parse + resolve() deterministic stream stamp + autoResolveEligible:false flag)"
  - "src/routes/api/ytmusic/lyrics/+server.ts (27-02 edge route → { text, attribution })"
  - "src/lib/services/api-base.ts (apiFetch governor for the /api/ytmusic/lyrics JSON hop)"
  - "src/lib/sources/registry.ts (SOURCES + getEnabledAdapters; ytmusic autoResolveEligible:false)"
provides:
  - "ytmusic resolve() enhanced: best-effort plain-lyrics fetch (spike-007 tier 1) alongside the deterministic stream stamp + itag-140 quality"
  - "fallbackOrder + resolveNameStub honor autoResolveEligible===false (ytmusic never an auto-resolve/failover TARGET) — registry-flag-driven, no source named"
  - "allSettled isolation + registry-driven settings/label test coverage for ytmusic"
affects:
  - "src/lib/stores/player.svelte.ts (via ensureTrackDetails → crossSourceLyric: a ytmusic track with no plain lyrics gets timed LRC from the existing fallback — no new wiring)"
  - "cross-source failover (fallback.ts) + Up-Next name-stub resolution (catalog.ts): ytmusic excluded as a target; kuwo→qq→netease→joox floor UNCHANGED"
tech-stack:
  added: []
  patterns:
    - "audius-style resolve() (deterministic own-origin stream stamp) + a best-effort never-throw JSON hop for plain lyrics only"
    - "registry-flag-driven exclusion (autoResolveEligible !== false) in aggregation code — no source id literal, invariant preserved"
    - "two-tier lyrics: plain in resolve(), timed via the EXISTING crossSourceLyric(name,artist) fallback (ytmusic NOT in LYRICLESS_SOURCES)"
key-files:
  created: []
  modified:
    - src/lib/sources/ytmusic.ts
    - src/lib/sources/ytmusic.test.ts
    - src/lib/services/fallback.ts
    - src/lib/services/fallback.test.ts
    - src/lib/services/catalog.ts
    - src/lib/services/catalog.test.ts
    - src/lib/sources/registry.test.ts
decisions:
  - "resolve() stores ONLY the plain lyric text into track.lrc; attribution (Musixmatch/LyricFind) is parsed but not surfaced — Track has no attribution field yet, and the plan's behavior fixes track.lrc = text (adding an attribution surface would be UI scope creep, T-27-04-04 keeps it display-only)"
  - "The autoResolveEligible exclusion is applied to fallbackOrder + resolveNameStub ONLY (per plan scope). crossSourceLyric is left untouched: it uses a source purely as a LYRIC provider (copies lrc, never the track's audioUrl), so ytmusic there is a benign — even beneficial — lyric source, not an auto-resolve-to-play target"
  - "Added ytmusic (autoResolveEligible:false) to fallback.test.ts's registry mock so the EXISTING mainstream-floor assertions become a live proof of the exclusion — without the filter, ytmusic would leak into every fallbackOrder result and break them"
metrics:
  duration: 9min
  tasks: 3
  files: 7
  completed: 2026-07-15
---

# Phase 27 Plan 04: YTMusic resolve() Lyrics + Off-the-Hot-Path Resilience Summary

Closed out Phase 27 (4/4). The YTMusic adapter's `resolve()` now delivers **two-tier lyrics** — plain
lyrics fetched best-effort from the anonymous `/api/ytmusic/lyrics` route (spike-007 tier 1) on top of
the deterministic own-origin stream stamp + itag-140 quality from Plan 27-01 — and a lyrics miss
routes to the app's EXISTING `crossSourceLyric(name,artist)` timed fallback with no new wiring. The
resilience policy is now HONORED, not just declared: `fallbackOrder` (cross-source failover) and
`resolveNameStub` (kuwo-first Up-Next resolution) exclude any source flagged
`autoResolveEligible === false` (ytmusic), so ytmusic is never auto-selected to play a track it did not
originate — while a FAILED ytmusic track still falls FORWARD to the unchanged kuwo→qq→netease→joox
floor. Both filters read the registry flag (no source named). Zero auth.

## What Was Built

### Task 1 (TDD) — resolve() best-effort plain lyrics (`db4c9e6` RED, `e7890a5` GREEN)
- **`ytmusic.ts` `resolve()`**: keeps the Plan 27-01 deterministic stamp
  (`audioUrl = apiUrl('/api/ytmusic/stream/' + encodeURIComponent(songid))`, fixed `128k`/`128k AAC`
  quality, `detailsLoaded=true`). Added a best-effort plain-lyrics fetch:
  `apiFetch('/api/ytmusic/lyrics?videoId=' + encodeURIComponent(songid), { signal })`, parse the
  `{ text, attribution }` payload (typed `YtLyricsResponse`, zero `as any`), and set `track.lrc` ONLY
  when `text` is a non-empty (post-trim) string. The whole lyrics step is wrapped in try/catch — any
  rejection (network, abort, contract drift, empty text) is swallowed so `track.lrc` stays null, the
  stream `audioUrl` is always stamped (a lyrics miss never fails or delays playback), and the timed
  LRC comes from the existing `crossSourceLyric` path (ytmusic is deliberately NOT in
  `LYRICLESS_SOURCES` — it HAS plain lyrics). No stream bytes fetched in resolve; `lrcUrl` never set
  (no netease-style timed-lyric re-resolve). Two-tier design commented with the spike-007 ref.
- **`ytmusic.test.ts` (+5)**: resolve stamps `/api/ytmusic/stream/<songid>` + quality +
  `detailsLoaded`, `lrcUrl` null; a `{ text }` payload populates `track.lrc` and hits
  `/api/ytmusic/lyrics?videoId=<encoded>`; empty-text leaves `lrc` null; a rejected fetch leaves `lrc`
  null and still returns a resolved Track (never throws); an aborted signal does not throw.

### Task 2 — off-the-hot-path enforcement (`4c2ba58`)
- **`fallback.ts` `fallbackOrder`**: added `SOURCES[s].autoResolveEligible !== false` to the
  `remaining` filter (SOURCES already imported) so an off-the-floor source is NEVER a failover target;
  extended the ORDER-INHERITANCE doc comment noting the exclusion bars only the reverse direction (a
  failed ytmusic track still falls forward — it is the `failed` source, dropped by `s !== failed`).
- **`catalog.ts` `resolveNameStub`**: applied the same
  `.filter((id) => SOURCES[id].autoResolveEligible !== false)` to the walked kuwo-first `order` so an
  Up-Next name stub never auto-resolves to ytmusic. `ensureTrackDetails` lyric block + `LYRICLESS_SOURCES`
  + `crossSourceLyric` left untouched (per plan scope). Neither file hardcodes the `'ytmusic'` literal.
- **`fallback.test.ts` (+4)**: added ytmusic (`autoResolveEligible:false`) to the registry mock, which
  turns the EXISTING mainstream-floor assertions into a live exclusion proof; new cases —
  `fallbackOrder` never contains ytmusic for any non-ytmusic failure (incl. with a preferred source),
  `fallbackOrder('ytmusic')` returns the mainstream floor `['kuwo','qq','netease','joox']`, and
  `tryFallback` never attempts/records ytmusic.
- **`catalog.test.ts` (+1)**: `resolveNameStub` walks kuwo (the floor) but never searches ytmusic.

### Task 3 — isolation + registry-driven settings/label (`20ce847`)
- **`catalog.test.ts` (+1)**: a THROWING ytmusic `search()` is recorded by `Promise.allSettled` as a
  typed per-source error (`status==='error'`, empty tracks) while the four mainstream sources' results
  stay intact — a YTMusic failure never breaks the search fan-out (no exception escapes `searchAll`).
- **`registry.test.ts` (+3)**: `SOURCES.ytmusic.label === 'YouTube Music'`; ytmusic participates in the
  `Object.values(SOURCES)` toggle enumeration (every adapter has a non-empty string label → the
  `{#each Object.values(SOURCES)}` toggle in `settings/playback/+page.svelte` renders it with NO
  per-source code); a `{ ytmusic: false }` `enabledSources` override is SourceId-keyed + `satisfies`-typed.

## Deviations from Plan

None — the plan executed as written. Notes on choices made within the plan's latitude (logged as
decisions above): attribution is parsed but not surfaced (no Track field / plan fixes `lrc = text`);
`crossSourceLyric` is intentionally NOT filtered (it is a lyric provider, not an auto-resolve target);
adding ytmusic to the fallback.test.ts registry mock makes the pre-existing floor assertions a live
proof of the exclusion.

Task 3 modified `src/lib/sources/registry.test.ts` — this is the file the plan's Task 3 `<files>`
lists (the frontmatter `files_modified` block omitted it), so it is in scope, not a deviation.

## Authentication Gates

None. Fully anonymous by design (scope guard honored): `resolve()` fetches plain lyrics from the
anonymous `/api/ytmusic/lyrics` route (Plan 27-02); no account / OAuth / device-flow / cookie /
user-token / visitorData-for-user / library-sync code was added anywhere. Timed LRC reuses the
existing `crossSourceLyric` — no new timed-lyrics scraping.

## Known Stubs

None. `resolve()` wires real plain lyrics from the live route; no hardcoded empty values flow to the
lyric pane (a genuine miss leaves `lrc` null and the timed `crossSourceLyric` fallback fills it).

## TDD Gate Compliance

- RED: `test(27-04)` commit `db4c9e6` — the plain-lyrics-population assertion fails against the
  27-01 resolve() (11/12 pass; only the new `track.lrc` behavior is red).
- GREEN: `feat(27-04)` commit `e7890a5` — all 12 ytmusic assertions pass; `pnpm check` clean.
- No REFACTOR commit needed (clean on first green). Gate sequence (test → feat) satisfied.
- Tasks 2 and 3 are non-TDD tasks (feat `4c2ba58`, test-only `20ce847`).

## Verification

- `pnpm check` — 0 errors, 0 warnings.
- `pnpm test -- src/lib/sources/ytmusic.test.ts src/lib/services/fallback.test.ts
  src/lib/services/catalog.test.ts src/lib/sources/registry.test.ts` — 4 files, 74 tests passed.
- `pnpm test src/lib/sources/ src/lib/services/` — 38 files, 662 tests passed.
- `pnpm test` (full suite) — 79 files, 1320 tests passed (+14 over 27-03's 1306; no regressions).
- `grep -n "/api/ytmusic/lyrics" src/lib/sources/ytmusic.ts` — present; `LYRICLESS_SOURCES` in
  catalog.ts does NOT contain ytmusic (verified).
- `grep -n "autoResolveEligible" src/lib/services/{fallback,catalog}.ts` — the flag filter is in both
  `fallbackOrder` and `resolveNameStub`; neither file hardcodes the `'ytmusic'` string literal.

## Self-Check: PASSED

- Files: all 7 modified files present on disk (+ this SUMMARY).
- Commits: `db4c9e6`, `e7890a5`, `4c2ba58`, `20ce847` all present in git history.
