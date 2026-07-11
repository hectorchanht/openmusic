---
phase: 26-minimal-api-click-to-play-redesign
reviewed: 2026-07-12T02:45:00Z
depth: standard
files_reviewed: 45
files_reviewed_list:
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/TrackMenu.svelte
  - src/lib/components/VersionPicker.svelte
  - src/lib/i18n/ar.ts
  - src/lib/i18n/de.ts
  - src/lib/i18n/en.ts
  - src/lib/i18n/es.ts
  - src/lib/i18n/fr.ts
  - src/lib/i18n/hi.ts
  - src/lib/i18n/id.ts
  - src/lib/i18n/it.ts
  - src/lib/i18n/pt.ts
  - src/lib/i18n/ru.ts
  - src/lib/i18n/th.ts
  - src/lib/i18n/tr.ts
  - src/lib/i18n/vi.ts
  - src/lib/i18n/zh-Hans.ts
  - src/lib/i18n/zh-Hant.ts
  - src/lib/services/catalog.test.ts
  - src/lib/services/catalog.ts
  - src/lib/services/cover-backfill.test.ts
  - src/lib/services/cover-backfill.ts
  - src/lib/services/dedupe.test.ts
  - src/lib/services/dedupe.ts
  - src/lib/services/fallback.test.ts
  - src/lib/services/fallback.ts
  - src/lib/services/netease-health.test.ts
  - src/lib/services/netease-health.ts
  - src/lib/services/similar.test.ts
  - src/lib/services/similar.ts
  - src/lib/services/variants.test.ts
  - src/lib/services/variants.ts
  - src/lib/sources/joox.test.ts
  - src/lib/sources/joox.ts
  - src/lib/sources/netease.test.ts
  - src/lib/sources/netease.ts
  - src/lib/sources/registry.test.ts
  - src/lib/sources/registry.ts
  - src/lib/sources/types.ts
  - src/lib/stores/player.svelte.test.ts
  - src/lib/stores/player.svelte.ts
  - src/routes/(app)/search/+page.svelte
  - src/routes/api/lastfm/similar-tracks/+server.ts
  - src/routes/api/lastfm/similar-tracks/similar-tracks-endpoint.test.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 26: Code Review Report

**Reviewed:** 2026-07-12T02:45:00Z
**Depth:** standard
**Files Reviewed:** 45
**Status:** issues_found

## Summary

Phase 26 reworks click-to-play into a low-API-call flow: a `track.getSimilar` Up-Next
(56→1), a resolve-phase watchdog, a cross-source variant picker fed by a single lazy
fan-out, a netease dry-window health gate, a graceful never-throw JOOX identity self-heal,
and a per-tile cover-cost reduction. The core correctness surface is strong: the
generation-guard idiom is applied consistently on every async path (playGen re-checked
across both watchdog awaits; queueGen re-checked after the second `buildDiversePicks`
await in `regenerate`; per-open `versionGen`/`versionAc` supersedence on the pickers),
the never-throw sentinel contract holds across `variants.ts`, `similar.ts`,
`netease-health.ts`, and the JOOX self-heal, and the never-stop invariant is reinforced
rather than weakened (watchdog → `runFallback` → auto-skip; regenerate never-empty net).

Objective checks performed:
- **Full test suite for the changed files passes** — 361 tests across the 11 scoped
  service/source/endpoint test files (172) + the player store test (189).
- **`svelte-check` (the project's sole quality gate) is clean** — 0 errors, 1 pre-existing
  unused-CSS warning (see IN-02).
- **i18n key-set parity is intact** — all 359 `en` keys are present in every one of the 15
  locale dictionaries (verified by extracting every quoted key and diffing against `en`);
  zero missing / extra keys, and every i18n key referenced by the new components exists.
- **JOOX self-heal re-search is not stale** — `apiFetch` GET dedupe is in-flight-only
  (evicted on head settle), so the corrected `/api/joox/search` issues a genuinely fresh
  order rather than colliding with the initial search's cached response.
- **Last.fm key handling is safe** — the similar-tracks endpoint fixes the method
  server-side, URL-encodes passthrough params, injects the key edge-side, never logs it,
  and returns `200 {tracks:[]}` (not a throw, not an `api_key=undefined` fetch) on the
  absent-key path. No injection or secret-leak surface found.

No blockers. The findings below are two robustness/maintainability warnings and two
info-level cleanups.

## Warnings

### WR-01: cover-backfill tier-3 CN search is not abortable (drops the AbortSignal)

**File:** `src/lib/services/cover-backfill.ts:169`
**Issue:** `resolveTrackChain(artist, title, signal)` is documented as the single
abortable Deezer→iTunes→CN chain and threads `signal` to tier 1 (`deezerSongCover`) and
tier 2 (`itunesSongCover`). The tier-3 CN call, however, omits it:

```ts
cover = await tier(async () => {
    const r = await searchAll(`${artist} ${title}`, 1);   // no signal, no prefs
    return dedupeBest(r.interleaved, settings.preferredSource)[0]?.cover ?? null;
});
```

On supersede/unmount, tiers 1–2 are cancelled but the CN branch (a *full* enabled-source
fan-out, since `prefs` defaults to `{}`) keeps running to completion. The module's whole
purpose is a bounded, cancellable fan-out; this is the one place that escapes the bound.
Impact is limited by the `apiFetch` concurrency cap + circuit breaker (no flood), but it
is wasted, uncancellable work exactly on the abort path the rest of the function honors.
**Fix:**
```ts
const r = await searchAll(`${artist} ${title}`, 1, {}, signal);
```

### WR-02: shared overlay id `'versionpicker'` across concurrently-mounted picker instances

**File:** `src/lib/components/VersionPicker.svelte:95` (also `TrackMenu.svelte:422`, `NowPlaying.svelte` VersionPicker mount, `search/+page.svelte:729`)
**Issue:** Every `VersionPicker` self-registers the overlay key `'versionpicker'`. Both the
search page and NowPlaying mount *two* pickers apiece — their own, plus the one inside the
`TrackMenu` they also mount. `overlays.open()` is idempotent only for the *top* entry; if a
second `'versionpicker'` opens while another is already registered, `open()` filters out the
stale stack entry (`if (this.has(id)) this.stack = this.stack.filter(...)`) but leaves its
already-pushed `history.pushState` entry orphaned — desyncing the "history depth == overlay
depth" invariant and over-popping the Back gesture. Today this is unreachable because the
open picker's full-screen scrim blocks interacting with the trigger that would open the
second one, so the two are mutually exclusive in practice. It is nonetheless fragile: a
future change to trigger placement or scrim removes the only thing preventing the desync,
and the collision is silent (no assertion catches it).
**Fix:** Give each mount a distinct overlay id (e.g. `'versionpicker-menu'` /
`'versionpicker-list'`) so a stray concurrent open pushes/pops its own balanced entry, or
hoist a single shared `VersionPicker` mount per route instead of one-per-host.

## Info

### IN-01: 36 i18n keys single-quoted in 12 locales (double-quote convention violation)

**File:** `src/lib/i18n/{ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi}.ts` (36 keys each, identical set)
**Issue:** CLAUDE.md mandates that `src/lib/i18n/*.ts` use **double quotes for every key AND
value** (a manual, formatter-less convention). In all 12 non-CJK locales the same 36 keys
are single-quoted — e.g. `'search.artists': 'الفنانون'` in `ar.ts` — while `en.ts`,
`zh-Hans.ts`, and `zh-Hant.ts` are fully double-quoted. Key-set **parity is intact** (all
359 keys present everywhere) and the single quotes have no runtime or compile impact, so
this is purely a consistency/maintainability defect. It is pre-existing (the phase's own
`versions.*` keys are correctly double-quoted) and slips through because `i18n.test.ts`
guards key parity but not quote style. Offending keys include: `search.artists`,
`settings.theme`/`themeDark`/`themeLight`, `settings.lyricsHideParen*`,
`settings.fontSizeNp*`, `settings.upnext*`, `settings.ctx*`, `settings.demoPrefix`,
`settings.homeSectionFavArtists`, `toast.artist(Un)favorited`, `library.favArtists`/
`noFavArtists`/`playAll`, `artist.favorite`/`unfavorite`/`playArtist`/`share`,
`nowplaying.clearQueue`, `deezer.fans`/`albums`/`released`/`label`/`genres`/`tracks`/
`duration`.
**Fix:** Convert the 36 single-quoted key/value pairs to double quotes in each of the 12
files; consider extending `i18n.test.ts` to fail on a single-quoted line so the convention
is actually enforced.

### IN-02: dead code — write-only `someFailed`, unused `.warn` CSS, orphaned `gotoAlbum`/`Disc`

**File:** `src/routes/(app)/search/+page.svelte:88,336,353,376,611-613,776` and `src/lib/components/TrackMenu.svelte:130,379`
**Issue:** In the search page, `someFailed` is assigned at four sites but its only reader —
the `{#if someFailed}` warning block (lines 611-613) — is commented out, so the variable is
now write-only and the `.warn` CSS selector is unused (this is the lone `svelte-check`
warning, `776:2 Unused CSS selector ".warn"`). In `TrackMenu.svelte`, the `gotoAlbum()`
function (line 130) and the `Disc` icon import are unreferenced because the only caller —
the "Go to album" button (line 379) — is commented out.
**Fix:** Either delete the dead state/CSS/function/import (and the `Disc` import) or
un-comment and restore the "some sources failed" banner and "Go to album" action if they
are still intended.

---

_Reviewed: 2026-07-12T02:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
