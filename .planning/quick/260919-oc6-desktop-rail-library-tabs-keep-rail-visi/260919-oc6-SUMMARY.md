---
phase: quick-260919-oc6
plan: 01
subsystem: navigation
tags: [desktop-rail, library-tabs, url-state, nowplaying]
requires: [url-tab.ts, pickTab, tabHref]
provides: [library-tabs.ts, navActive, LIBRARY_TAB_SET, DEFAULT_LIBRARY_TAB]
affects: ["src/routes/(app)/+layout.svelte", "src/routes/(app)/library/+page.svelte", "NowPlaying.svelte", "Nowbar.svelte"]
tech-stack:
  added: []
  patterns: [pure-service-plus-thin-caller, css-owns-the-breakpoint, untracked-url-reconcile-effect]
key-files:
  created:
    - src/lib/services/library-tabs.ts
    - src/lib/services/library-tabs.test.ts
  modified:
    - src/routes/(app)/library/+page.svelte
    - src/routes/(app)/+layout.svelte
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/Nowbar.svelte
decisions:
  - "The desktop rail REPLACES the generic Library entry with five ?tab= entries (mobileOnly flag), rather than showing both — two lit entries and a duplicated destination otherwise."
  - "The library page's URL write moved from raw history.replaceState (url-tab's syncTabUrl) to goto(replaceState) so $app/state page.url stays truthful for the rail."
  - "The npfix nav gate became a class (.tabbar.np-open) instead of an {#if} — still absence (display:none) on mobile, opt-back-in to display:flex inside the one 1024px media block, no matchMedia."
metrics:
  duration: ~12 min
  completed: 2026-09-19
---

# Quick 260919-oc6: Desktop rail library tabs + keep the rail visible — Summary

Five `/library?tab=<id>` entries now ride the existing `?tab=` mechanism into the desktop rail with exactly one lit at a time, the library page follows `page.url` on every navigation instead of reading it once at mount, and the NowPlaying sheet insets past the rail at >=1024px instead of swallowing it.

## What was built

**Task 1 — `src/lib/services/library-tabs.ts` (+ test), commit `5256e96`** (TDD: 13 tests written first, watched fail on the missing module, then green).
`LibraryTab` / `LIBRARY_TAB_SET` / `DEFAULT_LIBRARY_TAB` moved out of `library/+page.svelte` (the rail needs the same allowlist and default), plus `navActive(url, href)`:
- tab-less href → byte-for-byte the old `+layout.svelte:380` expression (`pathname === href || pathname.startsWith(href + '/')`), pinned case by case so "the mobile bar is unchanged" is checkable, not asserted;
- `?tab=` href → pathname gate first, then `pickTab(url, 'tab', LIBRARY_TAB_SET, 'liked') === want`. That is what gives "exactly one lit": canonical `/library` lights Liked (D-5 strips the default), and a tampered `?tab=` falls back to the default rather than lighting nothing or something bogus (T-23-10).
- try/catch → `false` on a malformed URL-like object.

**Task 2 — library page follows the URL, commit `a25ab49`.**
Root defect confirmed by reading: `loadInitialTab()` ran once at init and nothing re-read `page.url`, so a client-side nav between two `/library?tab=` URLs (same route → no remount) changed the address bar and nothing else. Added one `$effect` whose only tracked read is `page.url`, body in `untrack`, with an `appliedSearch` plain-field marker; precedence `?playlist > ?tab > stored` preserved verbatim, `openmusic:library:tab` still written (a rail click persists like a pill tap), and the effective tab is published back so the rail and the page agree.
Second defect the rail exposed: `syncTabUrl` uses raw `history.replaceState`, which SvelteKit never observes, so `page.url` went stale after every pill tap and the rail would have lit the wrong entry. The page's write is now `goto(href, { replaceState: true, noScroll: true, keepFocus: true })` — a normal router navigation (goto owns the history index; this is not the shallow-routing replaceState `url-tab.ts`/`overlays.svelte.ts` warn about), no history entry, so the overlay-depth == history-depth invariant is untouched. `url-tab.ts` is unchanged and `/artist/[name]/albums` still uses it.

**Task 3 — rail entries + nav gate + `.np` inset, commit `d2f1bb9`.**
- Five `desktopOnly` entries (Liked/Playlists/Downloads/Favourite artists/History) inserted before Settings using existing TranslationKeys and existing Lucide glyphs — no i18n edits, no new deps. The generic Library entry gained `mobileOnly: true` and a `.tab.mobile-only { display: none }` rule inside the existing 1024px block only.
- `{@const active = navActive(page.url, tab.href)}` replaces the inline expression.
- `{#if !player.expanded}` around the `<nav>` became `class:np-open={player.expanded}` with `.tabbar.np-open { display: none }` in the mobile cascade and `display: flex` in the desktop block. The `<Nowbar />` gate six lines up is untouched.
- `@media (min-width: 1024px) { .np { left: var(--rail-w); } }` in NowPlaying; the `quick-260919-np3` 1280px comment amended (the three-up split is now ~326/457/326, still well clear of the 278 "cramped" measurement) and the `quick-260919-et3` Nowbar comment amended (the "still covers the rail" half no longer holds). All existing decision-ref comments extended, none deleted.

## Verification — actually run, with observed output

| Gate | Command | Observed |
|---|---|---|
| New module (RED) | `pnpm vitest --run src/lib/services/library-tabs.test.ts` | `Test Files 1 failed (1)` / `Tests no tests` — failed to import `./library-tabs` (module absent) |
| New module (GREEN) | same | `Test Files 1 passed (1)` / `Tests 13 passed (13)` |
| Typecheck | `pnpm check` | `COMPLETED 4566 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| Full suite | `pnpm test` | `Test Files 141 passed (141)` / `Tests 2890 passed (2890)` — includes `breakpoints.test.ts` (the new `@media` is 1024, an allowed rung) and i18n parity |
| Grep gates | — | `desktopOnly: true` = 6 · `left: var(--rail-w)` at NowPlaying.svelte:1189 · `.tabbar.np-open` = 2 rules (mobile none / desktop flex) · `syncTabUrl` = 0 in the library page · no `{#if !player.expanded}` around the nav (the one at :361 is the untouched `<Nowbar />` gate) |

**NOT verified: anything visual or interactive.** No browser/device pass was run — no browser tool was reachable from this session, and the dev server in this folder belongs to another session. Everything above is construction-level plus node tests. The plan's human-check is still open:

- >=1024px: rail reads Home, Search, Liked, Playlists, Downloads, Favourite artists, History, Settings (no generic Library); clicking Downloads then History switches the page tab in place with exactly one entry lit; an in-page pill tap moves the rail and drops `?tab` back to `/library`; a reload on `/library` with a stored tab lights that tab.
- >=1024px: open NowPlaying — rail stays visible, sheet starts at the rail's right edge, no overlap.
- 375px: bottom bar is exactly Home/Search/Library; opening NowPlaying removes it for the whole fly-in (the `quick-260919-npfix` behaviour).
- `/library?playlist=<id>` still pins the detail view and lights Playlists.

## Deviations from Plan

**1. [Rule 3 - Blocking] The plan's own grep gate forced a comment rewording**
- **Found during:** Task 2
- **Issue:** The gate `grep -c 'syncTabUrl' library/+page.svelte | grep -qx 0` failed at 2 — both hits were prose inside the `quick-260919-2jo` comment, not code references.
- **Fix:** Reworded the two comment sentences to name "url-tab's raw history.replaceState helper" instead of the bare identifier, keeping the 2jo decision record intact and adding why the helper stays in `url-tab.ts` (the artist-albums page still uses it).
- **Files modified:** `src/routes/(app)/library/+page.svelte`
- **Commit:** `a25ab49`

Nothing else deviated.

## Assumption Drift (advisory)

None material — the two defects the plan predicted (no re-read of `page.url` on a same-route nav; `syncTabUrl` leaving `page.url` stale) were both confirmed by reading the code before editing.

## Known Stubs

None.

## Threat Flags

None — no new network surface, no new route, no new dependency. The `?tab=` read added to the `$effect` stays inside the existing `pickTab` allowlist (T-oc6-01), and the `writeTabUrl` ↔ `$effect` loop is closed by the `appliedSearch` marker plus the `href === page.url.href` early return (T-oc6-02).

## Self-Check: PASSED

- `src/lib/services/library-tabs.ts` — FOUND
- `src/lib/services/library-tabs.test.ts` — FOUND
- commits `5256e96`, `a25ab49`, `d2f1bb9` — all FOUND
- `git status --short` clean apart from untracked `.planning/` artifacts (nothing pushed)
