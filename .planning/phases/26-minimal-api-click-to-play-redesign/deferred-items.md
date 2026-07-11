# Deferred Items — Phase 26

Out-of-scope discoveries logged during execution. NOT fixed here (SCOPE BOUNDARY: only
auto-fix issues directly caused by the current task's changes).

## From Plan 26-05 (netease health-gate)

### Pre-existing test failure: `searchHistory.svelte.test.ts` SSR-guard case

- **File:** `src/lib/stores/searchHistory.svelte.test.ts:37`
- **Failing assertion:** `expect(typeof globalThis.localStorage).toBe('undefined')`
- **Root cause:** ENVIRONMENTAL / pre-existing — the local runtime is Node **v25.9.0**, which
  ships a built-in Web Storage API (`globalThis.localStorage` is defined, stable since Node 22.4).
  The test was authored (Phase 14, commit `188b495`) under an older Node where `localStorage` was
  absent in the vitest node/server project. It now fails purely because the runtime provides
  `localStorage`.
- **Why out of scope for 26-05:** the file is untouched by this plan and imports nothing this plan
  changed (verified: fails identically in isolation, `netease-health` is not in its import graph).
- **Fix direction (future):** either pin the node/server vitest project to disable Web Storage
  (`--no-experimental-webstorage` is not applicable at 25.x; use a vitest `env` / setup that deletes
  `globalThis.localStorage`), or rewrite the SSR-guard assertion to feature-detect rather than assert
  `localStorage` is `undefined`. CLAUDE.md pins Node `>=22`; CI Node version should be confirmed.
