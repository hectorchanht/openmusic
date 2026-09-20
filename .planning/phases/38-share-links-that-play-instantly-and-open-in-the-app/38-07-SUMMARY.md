---
phase: 38-share-links-that-play-instantly-and-open-in-the-app
plan: 07
subsystem: infra
tags: [capacitor, android-app-links, deep-link, sveltekit, routing]

# Dependency graph
requires:
  - phase: 38-01
    provides: deepLinkPath / APP_LINK_HOST — the pure, host-checked, never-throw URL→path gate
  - phase: 38-04
    provides: arriveTrack / arriveShared — the shared arrival path the navigated-to route runs
provides:
  - "Cold native launch: App.getLaunchUrl() read in a root-layout onMount, navigating to the deep-link path"
  - "Warm native re-tap: appUrlOpen listener navigating to the same path, released on teardown"
  - "Both seams host-gated by deepLinkPath before goto(); off-host and non-https URLs are dropped"
affects: [38-09 emulator verification, any future native deep-link surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capacitor deep-link bootstrap: isNativePlatform() guard + dynamic import + onMount disposer"

key-files:
  created: []
  modified:
    - src/routes/+layout.svelte

key-decisions:
  - "Both native seams live in ONE onMount in the root layout (the only once-per-app-lifetime mount point), not two call sites"
  - "onMount, never $effect: goto() leads to a route that writes player $state, which inside a tracked effect is the documented restore-effect self-invalidation loop"
  - "@capacitor/app is imported dynamically so the web chunk never carries it; @capacitor/core (Capacitor.isNativePlatform) stays a static import, matching every other native call site in the repo"
  - "The warm handler re-runs deepLinkPath rather than sharing a closure with the cold path — the gate is per-URL, and a hostile VIEW intent reaches the warm seam too (T-38-02)"

patterns-established:
  - "Native-only bootstrap: `if (!Capacitor.isNativePlatform()) return;` as the first line of onMount, async IIFE inside, `return () => off?.()` as the disposer"

requirements-completed: [38-B]

# Metrics
duration: 9min
completed: 2026-09-20
---

# Phase 38 Plan 07: Native deep-link bootstrap Summary

**Both Android App Link seams wired in the root layout — `App.getLaunchUrl()` for the cold launch and an `appUrlOpen` listener for the warm re-tap — each passing the URL through `deepLinkPath` before `goto()`, the whole block a no-op on web.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-09-20T14:01:27Z
- **Completed:** 2026-09-20T14:10:12Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Cold path implemented: `App.getLaunchUrl()` is read on mount, which is the ONLY way a cold-start deep link is visible (the Bridge captures `intent.getData()` privately and loads `index.html` without navigating to it). Without this the feature would have silently died in its most common real-world case.
- Warm path implemented: `App.addListener("appUrlOpen", …)` handles a re-tap while the activity is alive (`launchMode="singleTask"` → `onNewIntent` → the event), with `h.remove()` wired to the `onMount` disposer so a re-mount cannot leak a duplicate that double-fires `goto`.
- Both seams are distinguishable in the diff and both call `deepLinkPath` independently — an off-host, non-https, or junk URL from a hostile `VIEW` intent never reaches the router (T-38-02).
- Web build is untouched at runtime: the first line of `onMount` returns on `!Capacitor.isNativePlatform()`, and `@capacitor/app` is a dynamic import so it is not pulled into the web entry chunk.

## Task Commits

1. **Task 1: COLD path — `App.getLaunchUrl()` + host-gated `goto`** - `24dae61` (feat)
2. **Task 2: WARM path — `appUrlOpen` listener + teardown** - `87a83d3` (feat)

## Files Created/Modified
- `src/routes/+layout.svelte` - Added `onMount`/`goto`/`Capacitor`/`deepLinkPath` imports and one native-only `onMount` block holding both deep-link seams, below the two existing `$effect`s. The `untrack()` attach/restore block and the `document.title` effect are byte-unchanged.

## Verification Performed

Commands run, with observed results:

- `pnpm check` — `COMPLETED 4576 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` (run after each task).
- `pnpm build` (adapter-cloudflare) — `✓ built in 6.54s`, adapter `✔ done`. Confirms the dynamic import compiles into the web bundle while the runtime guard no-ops it.
- `pnpm test` — `Test Files 145 passed (145)`, `Tests 2969 passed (2969)`.
- Static greps: `App.getLaunchUrl()` = 1, `"appUrlOpen"` = 1, `h.remove()` present, `deepLinkPath(` = 2, `Capacitor.isNativePlatform()` = 1, `goto(launch…` = 0, `goto(e.url)` = 0, `from "@capacitor/app"` (static import) = 0, `$effect(` declarations = 2.
- `sed -n 22,40p src/routes/+layout.svelte` still contains `untrack(() => {` and `void player.restore();`.

**NOT verified here (by design):** on-device cold and warm App Link behaviour. That needs a deployed `assetlinks.json` plus an installed APK and is plan 38-09's job. Nothing in this plan's evidence implies the deep link has been observed working on a device.

## Decisions Made
- Kept both seams in a single async IIFE inside one `onMount` rather than splitting into two registrations — the cold read must complete before the listener is added anyway (sequential awaits on the same `App` import), and one mount point is what makes the T-38-07 duplicate-listener argument hold.
- Did not extract a local `routeDeepLink` helper: with the gate already extracted as `deepLinkPath` (plan 01), each seam is a two-line body, and a one-line wrapper over a one-line call is indirection without a payer.

## Deviations from Plan

None — plan executed exactly as written.

One acceptance-criterion clarification, not a code deviation: the plan's `grep -c "\$effect" src/routes/+layout.svelte` expects `2`, but that pattern also matches prose mentions of `$effect` in this file's comment blocks (the pre-existing ones and the new decision-record comment, which cites the effect rule). The substantive criterion — no new effect — holds: `grep -c '\$effect(' ` prints `2`.

## Issues Encountered
None.

## User Setup Required
None for this plan. The end-to-end feature still needs the deployed `static/.well-known/assetlinks.json` (D-22 fingerprint) and an installed APK before a device can verify the link — handled by the App Links plans and verified in 38-09.

## Next Phase Readiness
- Code side of requirement 38-B (a share link opens the app) is complete and typechecks/builds clean.
- 38-09 can now do emulator verification of BOTH paths: cold (kill app → `adb shell am start -a android.intent.action.VIEW -d "https://openmusic.lol/song/..."`) and warm (app foregrounded → same command).
- Residual risk sits entirely outside this diff: App Link verification depends on `assetlinks.json` being served as `application/json` over https with no redirect (the CONTEXT verification landmine).

---
*Phase: 38-share-links-that-play-instantly-and-open-in-the-app*
*Completed: 2026-09-20*

## Self-Check: PASSED
