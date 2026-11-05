# Deferred items — phase 43

## Pre-existing full-suite failures (found during 43-01, out of scope)

`pnpm test` after 43-01: 5 failures in 2 files, none touching any 43-01 file:

- `src/lib/stores/settings-persist.svelte.test.ts` — showSourceTag default/corrupt/reset (3)
- `src/lib/services/track-menu-order.test.ts` — 23-id catalog order + drag splice (2)

Likely from the `050f5fa1 update` commit (settings defaults / menu catalog). Not fixed here.
