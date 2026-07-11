# Deferred Items — Phase 25

Out-of-scope discoveries logged during execution (NOT fixed — unrelated to the current task's changes).

## Pre-existing test failure: `searchHistory.svelte.test.ts` SSR guard (Node 22+ native localStorage)

- **Discovered during:** Plan 25-01, Task 3 (full `pnpm test` run).
- **File:** `src/lib/stores/searchHistory.svelte.test.ts` (last modified Phase 14-01, commit `188b495` — long before Phase 25).
- **Failing case:** `SSR guard: under !browser, save() writes nothing to localStorage and does not throw` — asserts `expect(typeof globalThis.localStorage).toBe('undefined')`.
- **Root cause:** The running toolchain is **Node v25.9.0**, which exposes a **native `globalThis.localStorage`** (Web Storage API, stable since Node 22). The test was written when the node Vitest project had no `localStorage` global, so the assumption "`globalThis.localStorage` is absent in the node project" no longer holds. The test now sees `typeof globalThis.localStorage === 'object'`.
- **Why out of scope:** Fails in ISOLATION (running only that file), reproduces with zero Phase-25 code involved, lives in an unrelated store, and is a Node-runtime behavior change — not caused by the tongwen deps or `zh-convert.*`.
- **Suggested fix (future):** Update the test to stub/delete `globalThis.localStorage` for the SSR-guard case (or assert the guard behavior directly) rather than asserting the global is `undefined`. Consider a shared node-project setup that normalizes the Web Storage globals across Node versions.
