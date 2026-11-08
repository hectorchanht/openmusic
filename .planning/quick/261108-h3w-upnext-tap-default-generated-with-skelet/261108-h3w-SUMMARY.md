---
quick_id: 261108-h3w
status: complete
---
# Quick 261108-h3w Summary

- `src/lib/config/defaults.ts`: `UPNEXT_DEFAULTS.tap` 'preserve' -> 'generate'. Installs that
  already persisted a tapUpnext value keep it (settings save writes the field unconditionally).
- `src/lib/stores/player.svelte.ts`: `upNextPending` flag + `markUpNextPending()`; cleared in
  regenerate `finally` (newest build only), play() entry (unless forceGenerated/fromFallback),
  postPlayQueue non-fresh no-build branch, tapStub miss.
- `src/lib/components/NpUpNext.svelte`: `shownRows` prefix slice + LoadingState row skeletons.
- Tests: settings default test updated; 2 new player tests (pending set/cleared; preserve never pending).
- Verify: vitest player+settings 443/443 pass; full suite 5 failures are pre-existing on base
  (settings-persist showSourceTag, track-menu-order) — unrelated. `pnpm check` 0 errors.
- Not E2E-verified in browser.
