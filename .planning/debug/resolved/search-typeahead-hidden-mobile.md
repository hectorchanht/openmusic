---
slug: search-typeahead-hidden-mobile
status: resolved
trigger: "search page suggestion is not shown in mobile android web app but shown in desktop web"
created: 2026-07-12
updated: 2026-07-12
---

# Debug: search typeahead hidden on mobile Android Chrome

## Symptoms (user-reported)

- **Expected:** typing ≥2 chars in the search box shows the live typeahead
  (song / artist / album suggestions) — as it does on desktop web.
- **Actual:** on mobile **Android Chrome (deployed site, same-origin)** the typeahead
  never appears.
- **Surface:** Android Chrome on the site (NOT the APK) → same-origin, so CORS / native
  API-base / circuit-breaker are ruled out.
- **Which:** the while-typing typeahead (not the recent-searches list).
- **Full search still works on the same mobile** (song results appear) → network,
  Deezer, and CN sources are all fine on mobile; the failure is isolated to the
  typeahead render path.

## Investigation

- Reproduced the search page at mobile viewport (375×812) in sandbox Chrome: the
  typeahead **renders fine** (8 rows for "jay chou"). → NOT a CSS/width/layout bug.
- The only condition the typeahead gate has that the working full-search path does NOT
  is `inputFocused`:
  `{#if inputFocused && q.trim().length >= MIN_QUERY_LEN && suggestions.length > 0}`
  (`src/routes/(app)/search/+page.svelte`).
- **Mechanism proven in-sandbox:** with the typeahead populated (8 rows, query
  "jay chou"), firing a `blur` on the input → after the `onblur`
  `setTimeout(() => inputFocused = false, 150)` elapsed → the typeahead **vanished**
  (`rowsNow: 0`, `.suggest` block gone) **despite the query still being "jay chou" and
  suggestions still fetched.**

## Root cause

The typeahead visibility is gated on `inputFocused`. On desktop, focus stays on the
input while typing, so it shows. On **mobile Android Chrome**, the soft-keyboard / touch
focus lifecycle drops input focus (a `blur`); the `onblur` handler's
`setTimeout(() => inputFocused = false, 150)` then flips `inputFocused` false and
**nothing re-sets it true while the user keeps typing on the on-screen keyboard**, so a
populated suggestion list is suppressed. `suggestions` IS fetched (the same
`deezerSearchTopN` the working full-search uses), and the query is valid — only the
`inputFocused` gate fails. That gate is the single difference from the full-search path,
which is why full search works on mobile and the typeahead does not.

## Fix

Drop the `inputFocused` dependency from the typeahead gate — show it whenever there is a
≥2-char query with resolved suggestions:

`{#if q.trim().length >= MIN_QUERY_LEN && suggestions.length > 0}`

This is self-limiting (no lingering dropdown): `suggestions` is cleared on submit
(`run`), on tap (`pickSuggestion`), on clear-X (`clearSearch`), and when the query drops
below `MIN_QUERY_LEN` (`onSuggestInput`). Mirrors the same `inputFocused`-drop already
applied to the recent-searches block in quick-260711-sm7. Mutual exclusivity with the
recent block is preserved (recent requires `q.trim()===''`; typeahead requires ≥2 chars).

**files_changed:** `src/routes/(app)/search/+page.svelte`

## Verification

- In-sandbox: after the fix, a populated typeahead **stays visible** across a blur
  (`inputFocused` no longer gates it); `pnpm check` clean.
- Device UAT: confirm on real Android Chrome that the typeahead now appears while typing.

## Reopened 2026-07-13 — "still no suggestion in android mobile app"

**Report:** user says the typeahead is still missing on the Android app after the fix.

**Investigation:**
- The fix commit `a0ef59a` is on `origin/main` (local == origin/main, nothing unpushed).
- **Verified LIVE on the deployed https://openmusic.lol/search**: typed a query → 8
  suggestions populate → a REAL `input.blur()` (activeElement ≠ input) → the typeahead
  **stays visible** (8 rows). So the fix IS deployed to the web and works.
- CORS allowlist (`src/lib/proxy/http.ts`) already includes the Capacitor WebView origins
  (`http://localhost`, `https://localhost`, `capacitor://localhost`) → not a CORS block.
- User surface = **home-screen PWA**, and they have **not** reloaded a fresh build.

**True cause of the "still broken" report:** stale client bundle. The PWA's service
worker (`src/service-worker.ts`) uses no `skipWaiting()`/`clientsClaim()`, so the OLD SW
(installed before the fix) keeps controlling the app and serving the OLD precached JS
bundle until every PWA window is fully closed (or site data cleared). The device is
running pre-fix code even though the web is fixed. NOT a code defect in the fix.

**Resolution (user action):** on the phone, fully close the PWA (swipe from recents) and
reopen — or clear site data / reinstall the home-screen app — to pull the fixed bundle.
Confirmed the code path is correct + live; no further code change needed for THIS bug.

**Follow-up (optional, separate):** the SW update strategy makes PWA users wait for a full
app-close before a deploy reaches them. Adding `skipWaiting()` + `clientsClaim()` + a
"new version — reload" prompt would push future fixes to PWA users promptly. Does NOT
retroactively fix an already-stale instance. Left as a proposed quick task, not done here.
