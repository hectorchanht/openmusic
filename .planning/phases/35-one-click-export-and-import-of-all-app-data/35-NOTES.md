# Phase 35 — seed notes

Captured at `/gsd:add-phase` time.

## Shape

Two buttons in **Settings → Data** (`src/routes/(app)/settings/data/+page.svelte`, 79L — today it can only CLEAR things: cover cache, search history, library, names). Add Export (write one file) and Import (read one file back).

## What "all app data" actually is

localStorage keys found in the tree (`openmusic:<domain>:v<N>`):

| Key | Owner |
|---|---|
| `openmusic:library:v1` | `stores/library.svelte.ts` — liked songs / library |
| `openmusic:history:v1` | `stores/history.svelte.ts` — play history |
| `openmusic:search-history:v1` | `stores/searchHistory.svelte.ts` |
| `openmusic:settings:v1` | `stores/settings.svelte.ts` |
| `openmusic:player:v1` | `stores/player-persist.ts` — transport/queue restore |
| `openmusic:cover-cache:v1` | `services/cover-cache.ts` |
| `openmusic:action-log:v1` | `stores/actionLog.svelte.ts` |
| `openmusic:top-picks:v1`, `:v2` | picks |
| `openmusic:home-library:v1`, `openmusic:lyrics-tr:v3`, `openmusic:diag:v1` | home / translation cache / diagnostics |

Decide per key: **restore** (library, history, search history, settings, names) vs **skip** (caches and logs — derivable, and shipping a stale cover cache to a new device is worse than a cold one). Do not blanket-dump every key.

Also on disk, NOT in localStorage: downloaded audio blobs in IndexedDB (`services/blob-store.ts`). Almost certainly out of scope for a "one file" export (gigabytes) — the plan should say so explicitly rather than leave it ambiguous.

## Constraints

- **Version-tag the envelope.** Keys already carry `:v1`/`:v3`. An export must record the schema version per key so a future import can refuse or migrate rather than half-write.
- **Fail safe.** Validate the whole file before writing anything; a corrupt or newer-version import must leave existing state untouched (no partial restore).
- **Native vs web file I/O.** Web = `Blob` + download link / File input. Native (Capacitor) = `@capacitor/filesystem` + `capacitor-blob-writer`, already dependencies. Both paths guarded per the house `browser` / `isNativePlatform()` convention.
- Stores read their key at `load()` — an import has to re-hydrate the live runes singletons (or require a reload) rather than only writing localStorage behind their back.
