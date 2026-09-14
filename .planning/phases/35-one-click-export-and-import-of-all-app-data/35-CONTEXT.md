# Phase 35: One-click export and import of all app data - Context

**Gathered:** 2026-09-13
**Status:** Ready for planning

<domain>
## Phase Boundary

One Export button and one Import button in Settings → Data that round-trip every piece of restorable user state through a single portable, version-tagged JSON file — restoring the app on a new device or after a wipe. Round-trip is lossless for what it carries; an import from a corrupt or newer file fails safe instead of half-writing.

Fixed scope anchor from ROADMAP.md. Importing device audio files is Phase 34. Writing tags into audio files is Phase 36. Exporting the audio bytes themselves is explicitly out (see D-05).

</domain>

<decisions>
## Implementation Decisions

### What the file carries

- **D-01:** **Identity keys only.** Export/import covers exactly: `openmusic:library:v1` (liked / playlists / downloads), `openmusic:history:v1`, `openmusic:search-history:v1`, `openmusic:settings:v1`, and the name-translation cache (`openmusic:name-tr:*`, owner `stores/names.svelte.ts`). Everything else is skipped as derivable or machine-local: `cover-cache:v1`, `action-log:v1`, `top-picks:v1`/`:v2`, `home-library:v1`, `lyrics-tr:v3:*`, `diag:v1`, `library:tab`.
  - Cover cache is skipped **deliberately** — shipping a stale cover cache to a fresh device is worse than a cold one (the app already has a known stale-URL problem there, and covers re-resolve on their own).
  - Scouting found **16** `openmusic:*` keys in the tree, not the 12 listed in 35-NOTES.md. The planner must enumerate from the code, not from the notes.
- **D-02:** **`openmusic:player:v1` is NOT exported.** Restoring a half-played queue onto a different device is surprising, and the track it points at may not resolve there. A restored device starts clean.
- **D-03:** Envelope is **one human-readable JSON file**: app version + per-key schema version + payloads. Pretty-printed. No zip, no archive — the project has zero third-party runtime deps and a zip library would be the first (constraint in CLAUDE.md).
- **D-04:** Filename **`openmusic-backup-YYYY-MM-DD.json`** — dated, sorts naturally, multiple backups coexist.

### Downloads and audio bytes

- **D-05:** **The list travels, the bytes do not.** Downloaded audio (IndexedDB on web, `Directory.Data` + `Music/OpenMusic/` on native, via `services/blob-store.ts`) is never in the file — it is gigabytes. Download *entries* ride along inside `library:v1` so the record of what the user chose to keep offline survives.
- **D-06:** A **one-click "re-download missing" button lives in Settings → Data, beside Import.** It re-downloads only entries whose bytes are absent on this device. Safe to tap repeatedly; resumable if it dies halfway. No auto-start after import — a large unasked-for network job (possibly on cellular) is exactly the mistake `openmusic-pushes-autodeploy-live` already cost once.
- **D-07:** "Missing" is **computed from `blobStore` presence at render time, not stored in the file.** This is what reconciles D-11's Replace with a device that has real local downloads: an imported entry whose bytes happen to be present here shows as downloaded, one whose bytes are absent shows as missing. Consistent with the truthfulness fix in `quick-260913-jq4`.

### Import semantics

- **D-08:** **Replace, not merge.** Import wipes the restorable keys (D-01 set) and writes the file's contents. Predictable, exactly reproduces the source device, and makes the round-trip trivially testable. Requires an explicit confirm dialog naming what is about to be replaced.
- **D-09:** **A silent rollback snapshot is taken before every Replace.** Current restorable keys are stashed (same JSON shape — no new serializer) and an **Undo import** is offered afterwards. Cheap, and it is what makes a destructive one-tap button safe.
- **D-10:** **Atomic or nothing.** Parse and validate the ENTIRE envelope before a single write. A corrupt / foreign / newer-version file leaves existing state completely untouched. No best-effort partial restore.
- **D-11:** **Failures name their reason** — distinct messages for "not an OpenMusic backup", "made by a newer version of the app", "file is damaged". Accepted cost: three strings across 16 locale dictionaries (double-quote convention, `src/lib/i18n/*.ts`).
- **D-12:** **Older files migrate where a path exists, are refused per-key where it does not** (and say so). Per-key version tags exist precisely so an older key can be upgraded by the same tolerance each store's `load()` already applies to old localStorage data. Refusing every non-current file would invalidate every backup on every app update — fatal for a feature whose point is surviving a wipe.

### Post-import rehydration

- **D-13:** **A successful import writes the keys then forces a full app reload** (`location.reload()`), so every store re-runs its existing `load()` on a cold path. One code path, no half-hydrated runes singletons, no six new `hydrate()` methods to keep correct forever. A reload immediately after an explicit import reads as normal behaviour.
  - Do NOT reach for live re-hydration. The mount-time restore path is a known loop hazard — see `restore-effect-self-invalidation-loop` (a `+layout` mount `$effect` self-invalidated because `player.restore()` mutates tracked `$state`).

### File I/O — web and native

- **D-14:** **Web:** `Blob` + `<a download>` out, `<input type="file">` in. No File System Access API — iOS Safari is the primary target and a second code path buys nothing there.
- **D-15:** **Native import: a plain `<input type="file">`**, same element as web. Capacitor's Android WebView handles file inputs through its default chrome client and opens the system document picker. Zero native code. **Must be verified on-device** — the APK-via-emulator + CDP path is available (`apk-debug-via-emulator-cdp`), and Phase 33 hit the sibling of this question with `prompt()` in the WebView. If it fails, the fallback is an `ACTION_OPEN_DOCUMENT` `@PluginMethod`.
- **D-16:** **Native export: the system share sheet.** Write to app cache, hand the URI to the OS share sheet so the user can send it to Drive, Files, mail, anywhere — rather than dropping it in a folder they then have to hunt for.
- **D-17:** **Add `@capacitor/share`** for D-16. It is first-party Capacitor, the same family as the four plugins already in `dependencies`, and avoids writing and owning Kotlin `ACTION_SEND`. The existing `MediaStoreSaverPlugin.kt` is audio-only (`MediaStore.Audio`, `Music/` `RELATIVE_PATH`) and is the wrong tool for a JSON file.
- **D-18:** Both branches guarded per the house rule — `browser` from `$app/environment` and `isNativePlatform()`. The web build must not render a broken native control, and vice versa.

### Claude's Discretion

- Exact envelope field names and the per-key version-tag shape.
- Where the validator lives (must be a pure `.ts`, node-testable under the single Vitest server project — not in a `.svelte.ts` store).
- How long the rollback snapshot is retained, and where it is stored.
- Progress / result reporting UI for export, import, and the re-download sweep.
- Whether the confirm dialog is `confirm()` (the existing pattern in `settings/data/+page.svelte` `clearLibrary`) or a proper sheet.

</decisions>

<specifics>
## Specific Ideas

- The user's addition on downloads: export the list, **"and user can one click to re-download all those songs if missing"** — the restore story is incomplete if a new device shows 200 liked songs and no way to get the offline copies back without tapping each one.
- The desktop original this app was reskinned from already had import/export of library JSON (`importPlaylistData` / `exportPlaylistData`, PROJECT.md "Validated" list). This phase is restoring a capability the product used to have, at a wider scope.
- Recommended option taken on every question in all four areas — the shape of this feature was not contentious, the payload boundaries were.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase
- `.planning/phases/35-one-click-export-and-import-of-all-app-data/35-NOTES.md` — seed notes: key inventory (INCOMPLETE — 12 of 16, re-enumerate from code), version-tag and fail-safe constraints, native-vs-web I/O framing.

ROADMAP.md lists no `Canonical refs:` line for this phase, and there are no ADRs or feature specs covering backup/restore. Requirements are fully captured in the decisions above.

### Prior locked decisions this phase inherits
- `.planning/phases/999.1-v2-0-native-capacitor-migration/999.1-CONTEXT.md` §decisions — **D-10** (blob-store is platform-switched: IndexedDB on web, `@capacitor/filesystem` + `capacitor-blob-writer` on native) and **D-11** (public writes go through the hand-written Kotlin MediaStore bridge). D-05/D-16/D-17 sit on top of these.
- `.planning/phases/34-import-device-songs-as-native-downloads/34-CONTEXT.md` §decisions — **D-14** (the button works with zero configuration) is the ethos for both buttons here. Phase 34 also owns `device:` uids, which will appear inside `library:v1` download entries once it ships; the export must treat them as opaque uids and not choke on them.

### Code that defines the contracts
- `src/routes/(app)/settings/data/+page.svelte` (79L) — the page both buttons land on. Today it is clear-only. Note its existing `confirm()` + `flash()` patterns and its direct `localStorage.removeItem` calls for `top-picks` / `home-library`.
- `src/lib/stores/library.svelte.ts` — `KEY = 'openmusic:library:v1'`; `load()` at :43, private `save()` at :60; holds `liked` / `playlists` / `downloads`.
- `src/lib/stores/settings.svelte.ts` — `KEY` at :56, `load()` at :217, `save()` at :362. **WR-10:** `src/lib/config/defaults.ts` is the single source of truth for defaults and every `load()` fallback reads it. **T-vzu-01:** localStorage is treated as tamperable — only an explicit boolean wins. An imported settings blob is exactly as untrusted as a tampered one.
- `src/lib/stores/history.svelte.ts`, `src/lib/stores/searchHistory.svelte.ts`, `src/lib/stores/names.svelte.ts` — the remaining three restorable keys and their load/save shape.
- `src/lib/stores/player-persist.ts` — the key deliberately NOT exported (D-02).
- `src/lib/services/blob-store.ts` — never-throws contract, the app-private + public dual write, `MIN_BLOB_BYTES`. D-07's "is it actually here?" check goes through this, not around it.
- `src/lib/services/cover-cache.ts` — the three disjoint key families in one flat record, for the record of what D-01 is skipping and why.
- `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt` — audio-only today (`saveToMusic` / `deleteFromMusic`, `MediaStore.Audio`, `publicMusicPermsCallback`). Read before assuming it can carry a JSON file.
- `CLAUDE.md` — runes conventions, `*.svelte.ts` vs `.ts` split, `browser` / `isNativePlatform()` guarding, never-throw services, the i18n DOUBLE-QUOTE rule (D-11 adds strings to 16 dictionaries with identical key sets; `i18n.test.ts` guards parity).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Every store already has a `load()` that parses its own key from localStorage with fallbacks and tamper-tolerance. **D-13 exists to reuse those verbatim** rather than write a second hydration path.
- `settings/data/+page.svelte` already owns the page, the button styling (`.item` / `.item.danger`), `flash()` toasts, `confirm()` for destructive actions, and `use:tapBounce`. The two new buttons are additions to an existing surface, not a new screen.
- `library.clearAll()` (used by the existing Clear library button) is most of the "wipe before Replace" step for the largest key.
- The old desktop app's `importPlaylistData` / `exportPlaylistData` are the conceptual precedent — the file does not live in this repo any more (`app-is-sveltekit-not-index-html`), so do not go looking for it.

### Established Patterns
- **Pure logic in `.ts`, runes in `.svelte.ts`** — the envelope builder, the validator and the migration table are pure and node-testable (precedent: `player-persist.ts`, `search-history-logic.ts`, `history-logic.ts`, all of which already have co-located tests).
- **Never-throw services returning a sentinel** — a failed export or a rejected import returns a typed result, never an exception into the render tree.
- **`openmusic:<domain>:v<N>` key namespace** — the rollback snapshot (D-09) follows it.
- **localStorage access is always try/catch** — no exception here.

### Integration Points
- Settings → Data page: Export button, Import button (+ hidden `<input type="file">`), Re-download-missing button, Undo-import affordance.
- `blobStore.get()` / an existence check — feeds D-07's missing-vs-present rendering and D-06's re-download sweep.
- `@capacitor/share` — a new dependency plus a `cap sync`; the Android build (`pnpm apk`, needs `JAVA_HOME` on openjdk@21 per `apk-build-needs-jdk21`) must be re-run to verify.
- i18n dictionaries — new keys for both buttons, the confirm dialog, and the three distinct failure messages (D-11).

</code_context>

<deferred>
## Deferred Ideas

- **Cloud / account-backed sync** (backup to a server rather than a file) — a different capability with auth and storage implications; its own phase if ever.
- **Exporting the audio bytes** (a full offline archive including downloads) — explicitly rejected as gigabytes in one file (D-05). If it ever comes back it is a separate "archive" feature, not this button.
- **Merge-on-import** and **per-import Replace-or-Merge choice** — considered and rejected in favour of D-08's predictability. Revisit only if users report losing work by importing onto an active device (D-09's Undo is the mitigation until then).
- **File System Access API** save-in-place on desktop Chrome — rejected as a second code path for a platform the project barely targets (D-14).

### Reviewed Todos (not folded)
- `song-share-stale-cover-comment.md` (score 0.6) — keyword match on "cover"/"app" only; it is a stale comment on the share page, unrelated to backup/restore.
- `artist-page-hyphenated-lookup-key.md` (score 0.2) — keyword match on "one"; unrelated.

</deferred>

---

*Phase: 35-one-click-export-and-import-of-all-app-data*
*Context gathered: 2026-09-13*
