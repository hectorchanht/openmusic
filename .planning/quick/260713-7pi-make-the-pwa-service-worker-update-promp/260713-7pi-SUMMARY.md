---
quick_id: 260713-7pi
slug: make-the-pwa-service-worker-update-promp
status: complete
date: 2026-07-13
---

# Quick Task 260713-7pi — Summary

## What shipped

A **user-driven PWA update prompt** so a deploy reaches home-screen PWA users promptly
instead of them running the old cached bundle until they fully close the app (the
confirmed cause of "typeahead still broken on my Android PWA" — the fix was live on the
web but the stale service worker kept serving old JS).

Flow: new SW installs → waits → client shows a "New version — Reload" banner →
user taps → `SKIP_WAITING` message → `skipWaiting()` + `clients.claim()` →
one `controllerchange`-driven reload to the fresh bundle. A `visibilitychange`
`registration.update()` check makes the prompt appear promptly on a long-open PWA.

**Deliberate safety call:** the SW does NOT `skipWaiting()` on install (auto-activation
would reload the page mid-session and **kill background audio**, the app's core value).
Activation is gated behind the user's Reload tap.

## Files changed

- `src/service-worker.ts` — `message` handler (`SKIP_WAITING` → `sw.skipWaiting()`);
  `sw.clients.claim()` added to `activate`. No install-time skipWaiting (commented why).
- `src/lib/stores/swUpdate.svelte.ts` — NEW runes singleton (browser-guarded, mirrors
  `online`/`overlays`): `updateReady` state, `init()` (detect waiting SW via
  `updatefound`/`statechange` with the `controller`-present guard that excludes the
  first install; `controllerchange`→reload-once; `visibilitychange`→`reg.update()`),
  `applyUpdate()` (post `SKIP_WAITING`). Internal `reg`/`refreshing`/`started` are plain
  fields (house convention).
- `src/routes/(app)/+layout.svelte` — `swUpdate.init()` wired into `onMount` (+teardown);
  `.update-bar` banner with a Reload button; CSS.
- `src/lib/i18n/*.ts` (16) — `update.available` + `update.reload`.

## Verification

- `pnpm check` → **0 errors, 0 warnings** (i18n key-set parity across all 16 locales +
  SW `ServiceWorkerGlobalScope`/store types).
- `pnpm test` → **1242/1242 pass** (i18n parity test included).
- **Live dev browser:** app boots with `swUpdate.init()` running, **zero console errors**;
  forcing `updateReady=true` renders the banner ("A new version is available" + "Reload",
  both i18n-resolved) — mobile screenshot captured; tapping Reload safely dismisses the
  banner with no crash (dev has no waiting SW so it no-ops).
- **Not dev-testable:** the real install→wait→prompt→SKIP_WAITING→reload cycle needs two
  deployed builds (the SW doesn't run under `vite dev`) → deploy/device UAT. The SW
  message/claim logic is standard + typechecked.

## Notes

- Native (Capacitor) build: SvelteKit doesn't register the SW there
  (`serviceWorker: { register: !native }`), and `swUpdate.init()` no-ops without
  `navigator.serviceWorker` — so this is web-PWA only, as intended. The installed APK
  still updates only via a new APK build + reinstall.
- This does NOT retroactively fix an already-stale PWA instance — that still needs one
  full close/reopen to pick up THIS build; every deploy after it gets the prompt.
