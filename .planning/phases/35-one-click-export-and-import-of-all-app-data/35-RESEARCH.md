# Phase 35: One-click export and import of all app data — Research

**Researched:** 2026-09-13
**Domain:** localStorage serialization, file I/O across web + Capacitor Android, atomic validated import
**Confidence:** HIGH for everything grounded in this repo's code; MEDIUM for the two device-only Android behaviours (flagged, with verification recipes)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**What the file carries**

- **D-01:** **Identity keys only.** Export/import covers exactly: `openmusic:library:v1` (liked / playlists / downloads), `openmusic:history:v1`, `openmusic:search-history:v1`, `openmusic:settings:v1`, and the name-translation cache (`openmusic:name-tr:*`, owner `stores/names.svelte.ts`). Everything else is skipped as derivable or machine-local: `cover-cache:v1`, `action-log:v1`, `top-picks:v1`/`:v2`, `home-library:v1`, `lyrics-tr:v3:*`, `diag:v1`, `library:tab`.
  - Cover cache is skipped **deliberately** — shipping a stale cover cache to a fresh device is worse than a cold one (the app already has a known stale-URL problem there, and covers re-resolve on their own).
  - Scouting found **16** `openmusic:*` keys in the tree, not the 12 listed in 35-NOTES.md. The planner must enumerate from the code, not from the notes.
- **D-02:** **`openmusic:player:v1` is NOT exported.** Restoring a half-played queue onto a different device is surprising, and the track it points at may not resolve there. A restored device starts clean.
- **D-03:** Envelope is **one human-readable JSON file**: app version + per-key schema version + payloads. Pretty-printed. No zip, no archive — the project has zero third-party runtime deps and a zip library would be the first (constraint in CLAUDE.md).
- **D-04:** Filename **`openmusic-backup-YYYY-MM-DD.json`** — dated, sorts naturally, multiple backups coexist.

**Downloads and audio bytes**

- **D-05:** **The list travels, the bytes do not.** Downloaded audio (IndexedDB on web, `Directory.Data` + `Music/OpenMusic/` on native, via `services/blob-store.ts`) is never in the file — it is gigabytes. Download *entries* ride along inside `library:v1` so the record of what the user chose to keep offline survives.
- **D-06:** A **one-click "re-download missing" button lives in Settings → Data, beside Import.** It re-downloads only entries whose bytes are absent on this device. Safe to tap repeatedly; resumable if it dies halfway. No auto-start after import — a large unasked-for network job (possibly on cellular) is exactly the mistake `openmusic-pushes-autodeploy-live` already cost once.
- **D-07:** "Missing" is **computed from `blobStore` presence at render time, not stored in the file.** This is what reconciles D-11's Replace with a device that has real local downloads: an imported entry whose bytes happen to be present here shows as downloaded, one whose bytes are absent shows as missing. Consistent with the truthfulness fix in `quick-260913-jq4`.

**Import semantics**

- **D-08:** **Replace, not merge.** Import wipes the restorable keys (D-01 set) and writes the file's contents. Predictable, exactly reproduces the source device, and makes the round-trip trivially testable. Requires an explicit confirm dialog naming what is about to be replaced.
- **D-09:** **A silent rollback snapshot is taken before every Replace.** Current restorable keys are stashed (same JSON shape — no new serializer) and an **Undo import** is offered afterwards. Cheap, and it is what makes a destructive one-tap button safe.
- **D-10:** **Atomic or nothing.** Parse and validate the ENTIRE envelope before a single write. A corrupt / foreign / newer-version file leaves existing state completely untouched. No best-effort partial restore.
- **D-11:** **Failures name their reason** — distinct messages for "not an OpenMusic backup", "made by a newer version of the app", "file is damaged". Accepted cost: three strings across 16 locale dictionaries (double-quote convention, `src/lib/i18n/*.ts`).
- **D-12:** **Older files migrate where a path exists, are refused per-key where it does not** (and say so). Per-key version tags exist precisely so an older key can be upgraded by the same tolerance each store's `load()` already applies to old localStorage data. Refusing every non-current file would invalidate every backup on every app update — fatal for a feature whose point is surviving a wipe.

**Post-import rehydration**

- **D-13:** **A successful import writes the keys then forces a full app reload** (`location.reload()`), so every store re-runs its existing `load()` on a cold path. One code path, no half-hydrated runes singletons, no six new `hydrate()` methods to keep correct forever. A reload immediately after an explicit import reads as normal behaviour.
  - Do NOT reach for live re-hydration. The mount-time restore path is a known loop hazard — see `restore-effect-self-invalidation-loop` (a `+layout` mount `$effect` self-invalidated because `player.restore()` mutates tracked `$state`).

**File I/O — web and native**

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

### Deferred Ideas (OUT OF SCOPE)

- **Cloud / account-backed sync** (backup to a server rather than a file) — a different capability with auth and storage implications; its own phase if ever.
- **Exporting the audio bytes** (a full offline archive including downloads) — explicitly rejected as gigabytes in one file (D-05). If it ever comes back it is a separate "archive" feature, not this button.
- **Merge-on-import** and **per-import Replace-or-Merge choice** — considered and rejected in favour of D-08's predictability. Revisit only if users report losing work by importing onto an active device (D-09's Undo is the mitigation until then).
- **File System Access API** save-in-place on desktop Chrome — rejected as a second code path for a platform the project barely targets (D-14).
</user_constraints>

---

## Summary

Almost every hard part of this phase is already built and just needs wiring. `blobStore.has()` exists (`src/lib/services/blob-store.ts:286`) and answers D-07's "are the bytes actually here?" without reading a byte. `downloadTrack(track, { save: false })` exists (`src/lib/services/download-track.ts:65`, the 31-D-12 "silent background repair" mode) and is *exactly* the call D-06's sweep needs on both platforms — it re-fetches and re-persists the offline blob without firing an `<a download>` click, so a 200-song sweep does not pop 200 save dialogs. The Android manifest already declares the `${applicationId}.fileprovider` provider (`android/app/src/main/AndroidManifest.xml:29-36`) with a `<cache-path>` entry — which is precisely and only what `@capacitor/share`'s file path needs. `BridgeWebChromeClient.onShowFileChooser` is implemented in the installed Capacitor 8.4.0 source (`node_modules/@capacitor/android/.../BridgeWebChromeClient.java:276`), so D-15 needs zero native code. Every store's `load()` is already defensively tolerant of arbitrary garbage, which makes D-12's migration table empty today.

The three things that genuinely need care are: (1) `accept=".json"` alone on the file input hits a **crash path** in Capacitor's own `showFilePicker` (`validTypes[0]` indexed on a possibly-empty array, line 379) — use `accept="application/json,.json"`; (2) the D-09 rollback snapshot must not be written to `localStorage` beside the live keys, because a heavy library already occupies ~740 KB of a ~5 MB origin budget shared with the cover cache and lyrics cache — `sessionStorage` survives `location.reload()`, has its own quota, and expires when the tab closes, which is also the right retention answer; (3) there is **no app version available to the client at all** (`package.json` is a never-bumped `0.0.1`, `versionName` is CI-tag-derived) — so D-03's "app version" must be a hardcoded envelope `format` integer, not a new version-injection pipeline.

Total envelope size for a heavy user (500 liked + 200 downloads + 5×40-track playlists + full name cache) measured at **0.72 MB compact / 1.11 MB pretty-printed** — trivially safe to build as one in-memory string.

**Primary recommendation:** One pure `src/lib/backup/backup-logic.ts` (envelope build + `validateEnvelope` returning a discriminated-union result, never throws, node-testable, co-located test) + one thin `src/lib/services/backup-io.ts` for the four platform-branched I/O calls + buttons in the existing `settings/data/+page.svelte`. Reuse `saveBlobToDisk`, `downloadTrack({save:false})`, `blobStore.has`, `confirm()` and `flash()`. Add exactly one dependency: `@capacitor/share@^8.0.1`.

---

## Project Constraints (from CLAUDE.md)

| Directive | Consequence for this phase |
|---|---|
| Svelte 5 runes FORCED project-wide; `$state`/`$derived`/`$effect`/`$props` only | New page state in `settings/data/+page.svelte` uses `$state`; no `export let`, no `$:` |
| Runes files MUST be `*.svelte.ts` / `*.svelte`; pure logic stays `.ts` | The envelope builder + validator MUST be `.ts` (no `$state`), or the single node Vitest project can't run them cleanly |
| Indentation is **tabs**; single quotes for TS/JS | Match exactly — no formatter enforces it |
| `src/lib/i18n/*.ts` uses **DOUBLE QUOTES** for every key AND value | The new strings are the one place in this phase where double quotes are mandatory |
| All locale files MUST expose an IDENTICAL key set; `i18n.test.ts` guards parity | Every new key must land in **all 15** dictionaries (see correction below) or the test fails |
| Never-throw services returning a sentinel | `validateEnvelope` returns a typed result; export/import never throw into the render tree |
| `browser` / `isNativePlatform()` guards on anything touching `localStorage`/`window`/`document` | D-18 |
| Zero third-party runtime npm deps for the web app | `@capacitor/share` is acceptable only because it is Capacitor-family and native-only-guarded |
| High comment density; decision refs (`D-09`, `WR-03`) are load-bearing | New code carries `35-D-NN` refs |
| localStorage access is always try/catch | Every read/write in the export/import path |
| Path aliases (`$lib/...`), `import type`, named exports, no default exports in `$lib` | |
| **GSD workflow enforcement** — no direct repo edits outside a GSD command | Execution runs under `/gsd:execute-phase` |

**Correction to CLAUDE.md / CONTEXT.md D-11:** there are **15** locale dictionaries, not 16. Verified: `ls src/lib/i18n/` → `ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant` (15 files), corroborated by `src/lib/i18n/index.ts:12-26` (15 imports) and the parity test's own comment `src/lib/i18n/i18n.test.ts:47` ("iterate ALL 15 locales"). `en.ts` currently holds 394 keys. [VERIFIED: codebase]

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Envelope build / validate / migrate | Pure logic (`$lib/backup/*.ts`) | — | No DOM, no runes, no platform — must run in the node Vitest project |
| localStorage read/write of the 5 key families | Pure logic + browser guard at caller | — | The *set* of keys is data, not a store concern; stores never learn about backup |
| Web file out (`Blob` + `<a download>`) | Browser / Client | — | `saveBlobToDisk` already owns this seam |
| Web + native file in (`<input type="file">`) | Browser / Client | Android WebView (`BridgeWebChromeClient`) | One element, both platforms (D-15) |
| Native file out (cache write + share sheet) | Native shell (Capacitor plugins) | Android FileProvider | `Filesystem.writeFile` → `getUri` → `Share.share({files})` |
| Blob-presence probe ("is it really downloaded?") | Browser (IndexedDB) / Native (Filesystem.stat) | — | `blobStore.has` already platform-switches |
| Re-download sweep | Browser/Client orchestration over existing `downloadTrack` | Edge proxy (`/api/*` resolve) | Must be sequential — see Pitfall 3 |
| Post-import rehydration | Browser (`location.reload()`) | — | D-13 deliberately avoids the store tier |
| Localized failure messages | UI (`t()`) | — | Stores/services emit a typed reason; the page localizes |

**Nothing in this phase touches the edge / API proxy tier** except indirectly via `ensureTrackDetails` during the re-download sweep.

---

## Answer 1 — Exact key inventory and per-key payload shape

### Complete `openmusic*` localStorage inventory

Enumerated from `grep -rn "localStorage\.\(setItem\|getItem\|removeItem\)" src/` cross-checked against `grep -rn "openmusic:" src/`. **14 distinct key names/families under `openmusic:` plus 1 family under a different prefix.** [VERIFIED: codebase]

| # | Key / pattern | Owner (file:line) | Shape | D-01 verdict |
|---|---|---|---|---|
| 1 | `openmusic:library:v1` | `src/lib/stores/library.svelte.ts:10` | `{liked:Track[], playlists:Playlist[], downloads:Track[], favArtists:string[]}` | **EXPORT** |
| 2 | `openmusic:history:v1` | `src/lib/history/history-logic.ts:14` | `HistoryEntry[]` (capped 50) | **EXPORT** |
| 3 | `openmusic:search-history:v1` | `src/lib/search/search-history-logic.ts:17` | `{query:string, ts:number}[]` (capped 12) | **EXPORT** |
| 4 | `openmusic:settings:v1` | `src/lib/stores/settings.svelte.ts:56` | flat object, ~44 fields | **EXPORT** |
| 5 | `openmusic:name-tr:v2:<lang>` | `src/lib/stores/names.svelte.ts:47` (`keyFor`) | `Record<original, translated>` — **ONE KEY PER TARGET LANG** | **EXPORT (prefix family)** |
| 6 | `openmusic:player:v1` | `src/lib/stores/player-persist.ts:25` | `{v:1, current, queue, currentTime, shuffle, repeatMode, upNextAnchorUid}` | skip (D-02) |
| 7 | `openmusic:cover-cache:v1` | `src/lib/services/cover-cache.ts:44` | flat `{key:{u,t}}`, 3 disjoint key families | skip (D-01) |
| 8 | `openmusic:action-log:v1` | `src/lib/diagnostics/action-log-logic.ts:12` | serialized log lines | skip |
| 9 | `openmusic:lyrics-tr:v3:<to>:<hash>` | `src/lib/services/translate.ts:210` | `string[]` — **one key PER TRANSLATED LYRIC** | skip |
| 10 | `openmusic:top-picks:v2` | `src/routes/(app)/+page.svelte:82` | picks cache | skip |
| 11 | `openmusic:top-picks:v1` | `src/routes/(app)/settings/data/+page.svelte:13` | legacy — clear-only, never written | skip |
| 12 | `openmusic:home-library:v1` | `src/routes/(app)/+page.svelte:125` | home shelves cache | skip |
| 13 | `openmusic:library:tab` | `src/routes/(app)/library/+page.svelte:47` | last-active tab string | skip (machine-local UI state) |
| 14 | `openmusic:diag:v1` | `src/routes/(app)/settings/activity/+page.svelte:12` | device-local diag upload token | skip (**secret — must never be exported**) |
| — | `openmusic-blob-uri:<uid>` | `src/lib/services/blob-store.ts:72` (`uriIndexKey`) | Android MediaStore content URI per uid | skip (**device-local content URIs; meaningless elsewhere — and note it is NOT `openmusic:` prefixed**, so a naive `startsWith('openmusic:')` sweep misses it, and a naive `startsWith('openmusic')` sweep would wrongly include it) |

**CONTEXT's "16 keys" is slightly over-counted** (it likely counts `name-tr` and `lyrics-tr` twice, or counts the `:v1`/`:v2` top-picks pair separately). The table above is the authoritative enumeration; nothing in the D-01 set changes. [VERIFIED: codebase]

### Per-exported-key detail

#### `openmusic:library:v1` — `src/lib/stores/library.svelte.ts`

- **Write** (`save()`, :66-81): `JSON.stringify({liked, playlists, downloads, favArtists})`. Values are **full `Track` objects** as they sit in `$state` — including resolved extras (`songMid`, `qqSearchKey`, `tags`, `bio`, `duration`, `audioUrl`, `lrc`…). There is **no serialize whitelist here** (unlike `player-persist.ts` and `history-logic.ts`, which both strip). This is why library is by far the largest payload.
- **Read** (`load()`, :49-64): whole-blob `try/catch`; `v.liked ?? []`, `v.playlists ?? []`, `v.downloads ?? []`, `Array.isArray(v.favArtists) ? … : []`. **Only `favArtists` gets a type guard**; `liked`/`playlists`/`downloads` are cast with a nullish fallback and could be a number if tampered.
- **Not persisted (transient, correctly excluded):** `downloading: Set<string>` (:39), `downloadProgress: Record<string,number>` (:45) — explicitly documented as never entering `LibShape`.
- `clearAll()` (:218) zeroes all four arrays and saves — **the D-08 wipe step for this key is already written.**

> **Implication for the validator:** because `load()` only nullish-guards three arrays, the *importer* is the last line of defence. `validateEnvelope` must assert `Array.isArray` on `liked` / `playlists` / `downloads` / `favArtists` before writing; otherwise a hostile backup writes `{liked: 5}` and `library.liked` becomes `5`, which the home shelves then `.map()` over.

#### `openmusic:history:v1` — `src/lib/history/history-logic.ts`

- `HISTORY_CAP = 50` (:11) — **hard bound, per-entry 11-field whitelist** (`toEntry`, :36). Volatile fields (`audioUrl`, `lrc`, `lrcUrl`, `detailsLoaded`) deliberately omitted.
- `parseHistory(raw)` (:70): null → `[]`; parse throw → `[]`; non-array → `[]`. **No per-entry validation.**

#### `openmusic:search-history:v1` — `src/lib/search/search-history-logic.ts`

- `SEARCH_HISTORY_CAP = 12` (:14).
- `parseSearchHistory` (:58) is the **most tolerant loader in the codebase** — it validates per-entry (`typeof query === 'string' && typeof ts === 'number'`, :67-72) and *filters* bad entries rather than failing the blob. Comment `CR-01` explains why: `recordQuery`'s `.filter(e => e.query.toLowerCase())` would throw on a malformed entry and break the whole search form. **This is the shape the importer's validator should imitate for lists of records.**

#### `openmusic:settings:v1` — `src/lib/stores/settings.svelte.ts`

The important one, and it is **already maximally tolerant**:

- `KEY` :56, `load()` :217-365, `save()` :367-417.
- **WR-10 confirmed** (:6-8 header, and every fallback): every absent field falls back to a `defaults.ts` const — `GENERAL_DEFAULTS` / `APPEARANCE_DEFAULTS` / `TRANSLATION_DEFAULTS` / `PLAYBACK_DEFAULTS` / `UPNEXT_DEFAULTS` / `HOME_DEFAULTS`. No duplicated literals.
- **T-vzu-01 confirmed** (:305-307 and every boolean): `typeof v.x === 'boolean' ? v.x : DEFAULT` — a truthy string like `'yes'` must not flip a setting.
- Union-validated fields: `theme` (:311), `upnextMode` (:270), `homeLandingTab` (:348-351).
- Range-clamped fields: all five `fontScale*`, `coverScale`, `homeGridCols` via `clampInt` (:68-72); `homeShelfSize` via `clampShelfSize`.
- Object-not-array guarded: `enabledSources` (:238), `upnextPerContext` (:263), `homeSectionDensity` (:331-341, with per-entry `migrateDensity` and garbage entries **dropped**).
- Array-guarded: the four `*Skip` lists, the four `home*` lists.
- Only one field depends on an external global: `appLang` falls back to `detectAppLang(navigator.language)` (:224).
- `load()` ends with `applyTheme()` (:365), which writes CSS custom properties on `document.documentElement`.

> **Conclusion: settings needs essentially no import-time validation beyond "is it a non-null, non-array object".** Every field is individually defended. Attempting a per-field validator here would duplicate ~150 lines of existing defence and go stale. Say this explicitly in the plan so nobody builds it.

#### `openmusic:name-tr:*` — `src/lib/stores/names.svelte.ts` — **MULTI-KEY PREFIX FAMILY**

This is the one whose shape the notes got wrong.

- `STORE_VER = 'v2'` (:46), `keyFor(lang) = \`openmusic:name-tr:${STORE_VER}:${lang}\`` (:47). **One localStorage key per target language**, hydrated lazily per language (`langCache`, :87-104) and persisted per language (`persist`, :106-114) as `JSON.stringify(Object.fromEntries(map))` → a flat `Record<original, translated>`.
- Therefore "export that key" means **enumerate `localStorage` by prefix** — exactly what `clearCache()` already does at :283-292 (`for (let i=0; i<localStorage.length; i++)` … `k.startsWith('openmusic:name-tr:')`) and what `purgeStale()` does at :69-85.
- `purgeStale()` (:69-85) **deletes every `openmusic:name-tr:` key that is not `openmusic:name-tr:v2:`** on first hydration of any language. This has a direct consequence for D-12: **importing an old `v1` name-tr key is pointless — the store deletes it on next boot.** Migration verdict for this family: carry whatever prefix-matching keys exist, write them back verbatim; a stale-version key self-purges harmlessly.
- **Do not import `STORE_VER` into the pure backup module.** `names.svelte.ts` is a runes file; importing it drags `$state` + `settings` + `translate` + `zh-convert` into a node test. The prefix literal `'openmusic:name-tr:'` already appears twice as a bare literal in that file (:78, :287) — own a third copy as `NAME_TR_PREFIX` in the pure backup module and enumerate by prefix. No version knowledge needed, and a future `STORE_VER` bump requires no change to the backup code. [This is the laziest correct design.]

### Tolerance summary — what `load()` already handles

| Key | Corrupt JSON | Wrong top-level type | Bad field type | Bad entry in list |
|---|---|---|---|---|
| `library:v1` | → empty (catch) | → three raw casts, **unguarded** | only `favArtists` guarded | not checked |
| `history:v1` | → `[]` | non-array → `[]` | not checked | not checked |
| `search-history:v1` | → `[]` | non-array → `[]` | checked | **filtered out** |
| `settings:v1` | → defaults (catch) | non-object → mostly defaults | **every field guarded** | n/a |
| `name-tr:v2:<lang>` | → empty map (catch) | `Object.entries` of a non-object → `[]` | not checked | not checked |

---

## Answer 2 — Where per-key schema versions come from

**There is no in-payload version field on any of the five exported keys.** [VERIFIED: codebase]

- `library:v1`, `history:v1`, `search-history:v1`, `settings:v1`, `name-tr:v2:<lang>` — all carry their version **only in the key NAME**. None writes a `v:` field.
- The **only** store that writes an in-payload version is the one we are *not* exporting: `player-persist.ts:83` writes `{v: 1, …}` — and `parsePlayerState` (:130) **never reads it back**. It is decorative there too.
- `library:v1` has already absorbed one silent schema change with **no version bump**: `favArtists?: string[]` was added as optional (`src/lib/stores/library.svelte.ts:22-23`, "Optional in storage for non-destructive migration"). The house precedent is **additive-optional-field evolution, not version bumps.**

### Recommendation

**Record the full localStorage KEY NAME as the map key. The version is then implicit and exact, zero extra machinery.**

```ts
// $lib/backup/backup-logic.ts  (pure, no runes, no browser)

/** 35-D-03: ENVELOPE format version. This — NOT any per-key tag — is the single gate for
 *  D-11's "made by a newer version" message. Bump ONLY when the envelope STRUCTURE changes,
 *  never when a payload's inner shape drifts (the stores' own load() tolerance covers that). */
export const BACKUP_FORMAT = 1;
export const BACKUP_MAGIC = 'openmusic-backup';

export interface BackupEnvelope {
	app: typeof BACKUP_MAGIC;   // D-11 message 1: wrong/absent -> "not an OpenMusic backup"
	format: number;             // D-11 message 2: > BACKUP_FORMAT -> "made by a newer version"
	exportedAt: string;         // ISO 8601, informational only
	/** Key = the LITERAL localStorage key name, version segment included. Value = the parsed
	 *  payload. Round-trip is byte-lossless because import writes back under the same name. */
	keys: Record<string, unknown>;
}
```

**Why the key name and not a separate tag:** a backup written by today's app contains `"openmusic:library:v1"`. If the app later ships `openmusic:library:v2`, the importer sees an unknown-version key for a **known domain** (`openmusic:library:`) and can consult a migration table. Today that table is **empty** and should be written as an empty `Record` with a comment, not as an abstraction:

```ts
/** 35-D-12: domain -> (oldKeyName -> migrate). EMPTY TODAY and that is correct: no exported key
 *  has ever changed its version segment. Add an entry the DAY a version is bumped, not before. */
export const MIGRATIONS: Record<string, (payload: unknown) => unknown> = {};
```

### What D-12's migration story actually is

Grounded in the `load()` tolerance measured in Answer 1, **the migration story is much smaller than it sounds**:

| Scenario | What actually happens | Work needed |
|---|---|---|
| Backup from an older app, same key names | Stores' `load()` fills missing fields from `defaults.ts` / `?? []` | **Nothing** |
| Backup has extra fields we no longer read (e.g. retired `nameLang`) | `load()` ignores unknown fields entirely | **Nothing** |
| Backup missing a field added since (e.g. pre-`favArtists`) | `Array.isArray(v.favArtists) ? … : []` (`library.svelte.ts:59`) | **Nothing** |
| Backup carries `openmusic:name-tr:v1:zh-Hant` | Written back, then `purgeStale()` (`names.svelte.ts:69-85`) deletes it next boot | **Nothing** (document it) |
| Backup `format` > `BACKUP_FORMAT` | Refuse whole file, D-11 message 2 | **One comparison** |
| Unknown key name in a known domain, no migration entry | Skip that key, keep the rest, report which key was skipped (D-12 "refused per-key, and say so") | **One branch** |
| Unknown key name in an unknown domain | Skip silently (forward-compat: a future app exporting a 6th key must not break today's import) | **One branch** |

> Write this table into the plan. The biggest risk here is a planner inventing a per-key migration framework for a table that is empty and will stay empty for a long time.

---

## Answer 3 — The validator

### Established precedent (three examples, one shape)

| Module | Entry point | Contract |
|---|---|---|
| `src/lib/stores/player-persist.ts:130` | `parsePlayerState(raw: string \| null): RestoredState \| null` | "NEVER throws: every failure mode degrades to null" (:121-129). Three historical early-returns collapsed into one null sentinel. |
| `src/lib/search/search-history-logic.ts:58` | `parseSearchHistory(raw): SearchHistoryEntry[]` | `[]` on null / throw / non-array; **per-entry filter** for survivors |
| `src/lib/history/history-logic.ts:70` | `parseHistory(raw): HistoryEntry[]` | `[]` on null / throw / non-array |
| `src/lib/diagnostics/action-log-logic.ts` | `ACTION_LOG_KEY` + pure serialize/parse | key const lives in the pure module, store imports it |

**The house shape, precisely:** a pure `.ts` module with (a) the localStorage key constants as exports, (b) `serialize*(snapshot) → string`, (c) `parse*(raw) → typed | sentinel`, never throwing, with an extensive header comment stating the no-runes / no-`$app/environment` / no-circular-import rule, plus a co-located `*.test.ts`.

### Where this phase must deviate — and why that is fine

Every precedent returns a **bare sentinel** (`null` / `[]`) because the caller's only response is "start empty". D-11 demands **three distinguishable failure reasons**, so a bare sentinel loses required information. Return a discriminated union — still never throwing, still pure:

```ts
// $lib/backup/backup-logic.ts

/** 35-D-11: distinguishable failure reasons. A `reason` maps 1:1 to an i18n key at the UI
 *  layer — this module NEVER imports $lib/i18n (t() reads runes $state and would break the
 *  single node Vitest project), exactly as download-track.ts declines to localize (D-17 there). */
export type BackupReject =
	| { ok: false; reason: 'not-ours' }                            // magic/app field wrong or absent
	| { ok: false; reason: 'newer'; format: number }               // format > BACKUP_FORMAT
	| { ok: false; reason: 'damaged' };                            // JSON.parse threw, or a payload failed its shape check

export type ValidateResult =
	| { ok: true; envelope: BackupEnvelope; skipped: string[] }    // skipped = D-12 per-key refusals
	| BackupReject;

/** PURE + NEVER THROWS. Takes the raw file TEXT (the UI does `await file.text()`), so the
 *  node test drives it with a string and needs no File/FileReader stub. */
export function validateEnvelope(raw: string): ValidateResult { /* … */ }
```

**Ordering inside `validateEnvelope` matters for D-11's message accuracy** — check in this order:

1. `JSON.parse` in a `try` → throw ⇒ `damaged`.
2. Top level is a non-null, non-array object ⇒ else `not-ours`.
3. `app === BACKUP_MAGIC` ⇒ else `not-ours`. *(Checked before `format` so a random `{format:99}` JSON reads "not an OpenMusic backup", not "newer version".)*
4. `typeof format === 'number'` and `format <= BACKUP_FORMAT` ⇒ else `newer`. *(A non-number `format` on an otherwise-valid magic ⇒ `damaged`.)*
5. `keys` is a non-null, non-array object ⇒ else `damaged`.
6. **Per-key shape checks for every key we will write** (D-10 atomicity — this is the step that prevents a half-write):
   - `openmusic:library:v1` → object, and `liked`/`playlists`/`downloads` each `Array.isArray` (absent is OK → `[]`), `favArtists` array-or-absent. Per Answer 1, `library.load()` does **not** guard these, so this check is load-bearing, not belt-and-braces.
   - `openmusic:history:v1` → `Array.isArray`.
   - `openmusic:search-history:v1` → `Array.isArray`.
   - `openmusic:settings:v1` → non-null, non-array object. **Nothing more** (Answer 1: every field is already guarded by `load()`).
   - `openmusic:name-tr:*` → non-null, non-array object whose values are all strings.
   - Any key that fails ⇒ `damaged` (whole file rejected, D-10). Any key we do not recognize ⇒ pushed to `skipped`, not a rejection (forward-compat).

7. On success return the envelope; the **caller** does the write.

### Module layout

```
src/lib/backup/
  backup-logic.ts       # keys, BACKUP_FORMAT, buildEnvelope, validateEnvelope, MIGRATIONS — PURE
  backup-logic.test.ts  # co-located
```

`src/lib/backup/` is a new sibling of the existing pure-logic folders `src/lib/history/`, `src/lib/search/`, `src/lib/diagnostics/` — the established pattern for "a pure feature core that a store or page thinly wraps". [VERIFIED: codebase]

**Import direction:** `backup-logic.ts` may import `HISTORY_KEY` from `$lib/history/history-logic` and `SEARCH_HISTORY_KEY` from `$lib/search/search-history-logic` (both pure). It must **NOT** import `library.svelte.ts`, `settings.svelte.ts` or `names.svelte.ts` — those are runes files. Own local `const LIBRARY_KEY = 'openmusic:library:v1'`, `SETTINGS_KEY`, `NAME_TR_PREFIX` copies, and pin them with an equality assertion in the test, exactly as `action-log-logic.test.ts:13` and `search-history-logic.test.ts:111-112` already do:

```ts
it('key literals match their owning stores', () => {
	expect(LIBRARY_KEY).toBe('openmusic:library:v1');
	expect(SETTINGS_KEY).toBe('openmusic:settings:v1');
	expect(NAME_TR_PREFIX).toBe('openmusic:name-tr:');
	expect(BACKUP_KEYS).not.toContain('openmusic:player:v1'); // 35-D-02 regression pin
	expect(BACKUP_KEYS).not.toContain('openmusic:diag:v1');   // never export the upload token
});
```

---

## Answer 4 — Blob presence (D-07) and the re-download sweep (D-06)

### There IS a cheap existence check — it already exists

`blobStore.has(uid): Promise<boolean>` — `src/lib/services/blob-store.ts:286-300`, added by `quick-260913-jq4`. Its header (:270-285) reads like it was written for this phase.

- **Web branch** (:293): `txStore(db,'readonly').getKey(uid)` — an **index-only lookup**, no bytes read. The header states this explicitly: "a stored blob is a whole audio file (a lossless track is tens of MB). `get` would pull those bytes into memory just to compare against null. `getKey` answers from the index alone."
- **Native branch** (`nativeHas`, :158-166): `Filesystem.stat({path, directory: Directory.Data})` → `size >= MIN_BLOB_BYTES` (8192, :34). No read.
- Never throws, SSR-guarded, any error ⇒ `false`.

> **⚠️ Platform asymmetry — flag this in the plan.** The **native** branch applies the `MIN_BLOB_BYTES` floor (:161); the **web** branch does not — `getKey` returns `true` for a stored 0-byte record that `get()` would reject as `null` (:260). So on web a truncated blob reports "present" to `has()` but "missing" to playback. Impact on this phase: a re-download sweep on web will skip a truncated file that actually needs re-downloading. Two options for the planner: (a) accept it and document, or (b) one-line fix in `has()`'s web branch — use `.get(uid)` only when `getKey` hits and you need certainty, or add a `count`-based variant. **Recommendation: accept + document.** The floor exists to stop a dead blob reaching `<audio>`; the player's own `audio.error` → 31-D-12 repair path (`downloadTrack(…, {save:false})`) already re-downloads truncated files on next play. Do not widen the sweep's job to cover it.

### What the UI calls TODAY to decide "downloaded"

Two different answers live in the codebase right now, and the plan must pick deliberately:

| Surface | Call | Meaning |
|---|---|---|
| `DownloadControl.svelte:49` (`isDownloaded = library.isDownloaded(uid)`) — used by library / history / album rows | `library.isDownloaded` → membership in `library.downloads` (`library.svelte.ts:201`) | "the user asked for this offline" — can be true with zero bytes stored |
| `TrackMenu.svelte:215-235` (`blobPresent`) | `blobStore.has(uid)` | "the bytes are actually here" |

`TrackMenu.svelte:202-214` documents exactly why the list lies: `addDownload` runs **before** the fetch (`download-track.ts:103`, deliberate — DL-BUG-01 keeps a failed download re-streamable), and the web save is an `<a download>` click that **reports success even when the user cancels the browser's save dialog**. It also states the scope limit: *"migrating the other surfaces that render download state to this probe is a separate change."*

**D-07 is that separate change, scoped to Settings → Data.** Do not migrate `DownloadControl` in this phase.

### How to cheaply ask "are the bytes here?" for N entries

`blobStore.has` is the right call; the only question is fan-out. Each call opens/reuses one cached IDB connection (`openPromise`, :187-210) and issues one `getKey` — cheap, but N promises is still N transactions.

**Recommendation:** `await Promise.all(downloads.map(t => blobStore.has(t.uid)))`.
- Web: N index lookups against one cached connection. For N=200 this is single-digit milliseconds. No network, no governor involvement.
- Native: N `Filesystem.stat` calls over the Capacitor bridge. This is the slower branch; measure on the emulator. If it is visibly slow, chunk it (e.g. 20 at a time) — but do **not** pre-optimize; the counter is rendered once when the Data page mounts, not per frame.
- Store the result in a `$state<Set<string>>` of *missing* uids and render `missing.size`. Recompute on demand (a refresh tap / after the sweep), not on a timer.

### How a download is actually triggered today

`downloadTrack(track, opts?: {persist?: boolean; save?: boolean}): Promise<DownloadResult>` — `src/lib/services/download-track.ts:65`. The single shared initiation path (29-03); `TrackMenu.svelte:189`, `DownloadControl.svelte:68` and the album bulk path (`album/[name]/+page.svelte:428`) all route through it. `DownloadResult = 'saved' | 'no-audio' | 'failed'` (:39). Never throws, never navigates.

Sequence (:71-154): `library.beginDownload` → reuse `player.current`'s URL if fresh + quality-sufficient (`hasFreshAudioUrl`, :79-83) else `ensureTrackDetails({...track, detailsLoaded:false, audioUrl:null, lrc:null}, undefined, settings.downloadQuality)` → `library.addDownload(r)` → `fetch(r.audioUrl)` (**raw fetch**) → `readBlobWithProgress` → `blobStore.put` (unless `persist:false`) → `saveBlobToDisk` (unless `save:false`) → `finally { library.endDownload }`.

### **The sweep must call `downloadTrack(t, { save: false })`** — this is the single most important finding for D-06

`opts.save === false` is the **31-D-12 "silent background repair" mode** (:60-63, :138-141):

> *"the offline blob is re-persisted and the library record refreshed, but no `<a download>` click fires. The repair is triggered by a playback error the user never asked about, so popping a file-save dialog mid-song would itself be the bug."*

That is verbatim D-06's requirement. Concretely:
- **Web:** `blobStore.put` runs (IndexedDB blob restored — which is what `has()` probes and what offline playback reads), and `saveBlobToDisk` is skipped, so **200 songs do not produce 200 browser save dialogs**. This would otherwise be a showstopper.
- **Native:** `blobStore.put` → `nativePut` (:106-133) writes **both** the app-private `Directory.Data` copy *and* the public `Music/OpenMusic/` MediaStore copy. So `save:false` loses nothing on Android — the `<a download>` click was never the native mechanism.
- Free bonuses: `beginDownload`/`endDownload` bracket per uid, so `DownloadControl` spinners on other surfaces animate correctly during the sweep; `library.addDownload` is a no-op for an entry already in the list (:204-209); `downloadProgress` is populated so a per-song progress bar is available.

Do **not** use `persist: false` (that is the album path, which deliberately skips the offline blob — the opposite of what the sweep wants).

### Concurrency — what exists, what does not, and the `api-fetch-flood-freeze` constraint

**What exists:**
- `apiFetch` governor in `src/lib/services/api-base.ts`: in-flight **GET dedupe**, `MAX_CONCURRENT_REQUESTS = 8` with a FIFO queue, `REQUEST_TIMEOUT_MS = 25_000`, and a **circuit breaker** (`CIRCUIT_FAILURE_THRESHOLD = 30` failures in `CIRCUIT_WINDOW_MS = 3_000`, `CIRCUIT_COOLDOWN_MS = 10_000`, single half-open probe). All `/api/*` traffic, including `ensureTrackDetails`, passes through it.
- The album bulk path's hand-rolled pacing (`album/[name]/+page.svelte:427-434`): a plain `for` loop, `await downloadTrack(...)`, then `await new Promise(r => setTimeout(r, 250))` — **concurrency 1 with a 250 ms stagger**, commented *"Stagger so browser doesn't squash concurrent downloads / hit per-origin caps."*

**What does NOT exist:**
- `src/lib/services/downloads-queue.ts` is **NOT a download queue** despite the name — it is `buildOfflineQueue`, the offline up-next builder (PLAY-09 / D-07). Do not mistake it for a reusable concurrency primitive.
- **The audio-bytes fetch is ungoverned.** `download-track.ts:106-109` uses a **raw `fetch`**, with an explicit comment: *"RAW fetch (not apiFetch — fetch→apiFetch audit): a MEDIA download-to-blob… a full-file body must not be routed through the JSON governor's dedup/cap."* Same for `nativeGet` (`blob-store.ts:143-144`). **So `apiFetch`'s cap protects the resolve half of a sweep and nothing else.** A parallel sweep of 200 songs would issue 200 simultaneous multi-megabyte body reads that nothing caps — precisely the shape of `api-fetch-flood-freeze` (connection-pool saturation → app appears frozen), except with far larger bodies.

**What the sweep MUST do (state this as a hard requirement in the plan):**

1. **Strictly sequential — concurrency 1.** `for (const t of missing) { await downloadTrack(t, {save:false}); }`. Copy the album path's proven shape; do not invent a worker pool. A backup restore is not latency-sensitive.
2. **Keep a small inter-item delay** (the album path's 250 ms) so a long run yields to the UI thread and the browser's pool never sees back-to-back saturation.
3. **A user-visible stop control.** A flag read at the top of each iteration (`if (!sweepRunning) break;`). D-06 says "safe to tap repeatedly; resumable if it dies halfway" — a run over 200 lossless tracks is hundreds of megabytes and minutes long; the user must be able to stop it.
4. **Recompute membership per iteration, not up front.** `if (await blobStore.has(t.uid)) continue;` at the top of each loop body. This is what makes it *idempotent and resumable for free* (D-06) — the "missing" set is derived state (D-07), never stored, so a run that dies halfway simply has a smaller missing set next time. **No progress bookmark, no resume token, no new persisted key.**
5. **Never auto-start.** D-06 is explicit. The button is in Settings → Data and the user taps it.
6. **Count outcomes, don't toast per song.** `downloadTrack` returns a sentinel per track; accumulate `{saved, noAudio, failed}` and flash one summary via the page's existing `flash()`.
7. **Do not add a global concurrency cap to the media path.** Tempting, out of scope, and the raw-fetch decision is a documented deliberate one. Sequential-at-the-caller achieves the same protection for this feature with zero blast radius.

> A "re-download 200 songs" button is the exact shape of the `api-fetch-flood-freeze` incident. Sequential + stop-flag + per-iteration re-probe is the complete mitigation, and it is about ten lines.

---

## Answer 5 — `@capacitor/share` (D-17)

### Version

| Fact | Value | Source |
|---|---|---|
| Correct version for Capacitor 8 | **`@capacitor/share@8.0.1`** (`latest`; `latest-8` line; published 2026-09-11) | `npm view @capacitor/share dist-tags` / `version` [VERIFIED: npm registry, discovered from capacitorjs.com official docs] |
| Peer dependency | `{"@capacitor/core": ">=8.0.0"}` — satisfied by the pinned `8.4.0` | `npm view @capacitor/share@latest peerDependencies` [VERIFIED: npm registry] |
| Declaration style to match siblings | `"@capacitor/share": "^8.0.1"` in `dependencies` | matches `@capacitor/app ^8.1.0`, `@capacitor/splash-screen ^8.0.1`, `@capacitor/status-bar ^8.0.2` in `package.json` |
| slopcheck | **`[OK]`** | `slopcheck install @capacitor/share` |

Avoid `9.0.0-alpha.2` (`next`) and every `nightly`/`dev` tag.

### The Android file-sharing API — concrete implementation path

**`ShareOptions.files` is `string[]` of `file://` URLs.** [CITED: capacitorjs.com/docs/apis/share]

`SharePlugin.java` (ionic-team/capacitor-plugins, `main`) [CITED: raw.githubusercontent.com/ionic-team/capacitor-plugins/main/share/android/src/main/java/com/capacitorjs/plugins/share/SharePlugin.java]:
- Rejects anything not starting with `file:` — `call.reject("only file urls are supported")`. **A `content://` URI is rejected.**
- Converts the `file://` path to a `content://` URI via `FileProvider.getUriForFile(ctx, getContext().getPackageName() + ".fileprovider", file)`.
- MIME type from `MimeTypeMap.getFileExtensionFromUrl(url)` → `getMimeTypeFromExtension(ext)`; `*/*` for multiple files.
- The plugin itself imposes **no cache-directory restriction** — the restriction is the FileProvider's `file_paths.xml`.

### This repo already has the manifest half

`android/app/src/main/AndroidManifest.xml:29-36` [VERIFIED: codebase]:

```xml
<provider
    android:name="androidx.core.content.FileProvider"
    android:authorities="${applicationId}.fileprovider"
    android:exported="false"
    android:grantUriPermissions="true">
    <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths" />
</provider>
```

The authority is **byte-identical** to what `SharePlugin` computes (`com.openmusic.app.fileprovider`, from `capacitor.config.ts` `appId`). And `android/app/src/main/res/xml/file_paths.xml` already contains:

```xml
<external-path name="my_images" path="." />
<cache-path name="my_cache_images" path="." />
```

`<cache-path>` maps to `Context.getCacheDir()`, which is what `@capacitor/filesystem`'s `Directory.Cache` writes to. **So writing the backup to `Directory.Cache` needs no manifest change and no `file_paths.xml` change.** (`Directory.Data` maps to `getFilesDir()`, which would need a `<files-path>` entry — **do not use `Directory.Data` for the share file.** This also matches D-16's "write to app cache" wording.)

### Verified implementation shape

```ts
// $lib/services/backup-io.ts — thin platform seam, browser/native guarded (35-D-18)
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** 35-D-16/D-17: native export. Never throws — returns false and the caller flashes a message
 *  (house never-throw posture; mirrors saveBlobToDisk's boolean contract). */
export async function shareBackupNative(json: string, filename: string): Promise<boolean> {
	try {
		// UTF8 encoding => writeFile takes the STRING directly. The base64 round-trip that
		// blob-store.ts avoids (WR-03) applies to BINARY writes only; a text file is exactly
		// what writeFile + Encoding.UTF8 is for, so capacitor-blob-writer is NOT needed here.
		await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 });
		// getUri returns a file:// URI on Android — the ONLY form SharePlugin accepts.
		const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
		await Share.share({ title: filename, files: [uri], dialogTitle: filename });
		return true;
	} catch {
		return false; // includes the user dismissing the sheet, which rejects on Android
	}
}
```

Notes the planner needs:
- `Encoding.UTF8` ⇒ `data` is the plain string; without `encoding`, `writeFile` expects base64. [CITED: capacitorjs.com/docs/apis/filesystem]
- `Filesystem.getUri()` returns `{ uri: string }`, a `file://` URI on Android. [CITED: capacitorjs.com/docs/apis/filesystem]
- **A dismissed share sheet rejects on Android** — wrap in `try/catch` and treat it as a non-error (do not flash "export failed" when the user just backed out).
- `Share.canShare()` is available if a capability gate is wanted; `isNativePlatform()` is sufficient here.
- The cache file is left behind deliberately — Android reclaims `getCacheDir()` under pressure. Do not add cleanup code.

### What `npx cap sync` covers

`pnpm apk` already runs `pnpm build:native && npx cap sync android && cd android && ./gradlew assembleDebug` (`package.json` scripts). Adding `@capacitor/share`:

1. `pnpm add @capacitor/share@^8.0.1` (pnpm 8.15.5 via corepack; `engine-strict=true`, Node ≥22).
2. `npx cap sync android` — discovers the plugin, adds it to `android/capacitor.settings.gradle` + `android/app/capacitor.build.gradle`, and copies the web assets. **No manual Gradle or manifest edit.**
3. Rebuild. On this machine Gradle needs JDK 21:
   ```bash
   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home pnpm apk
   ```
   (`apk-build-needs-jdk21`; `/opt/homebrew/opt/openjdk@21` confirmed present. Not committed — developer-machine concern.)
4. **No new Android permission.** `ACTION_SEND` via FileProvider requires none.
5. **Guard the web build.** `@capacitor/share`'s web implementation calls the Web Share API and rejects on unsupported browsers; the import is static, so it ships in the web bundle regardless. Branch on `Capacitor.isNativePlatform()` and use `saveBlobToDisk` on web (D-14/D-18). This keeps "zero third-party runtime deps for the web app" morally intact — same posture as the four existing Capacitor plugins.

### Residual risk (MEDIUM confidence)

`MimeTypeMap.getFileExtensionFromUrl("…json")` → `getMimeTypeFromExtension("json")` may return `null` on some Android versions (AOSP expanded its MIME table substantially at API 29; whether `json` is in the pre-29 table could not be settled from an authoritative source in this session). If it returns `null`, `SharePlugin` sets a null/`*/*` intent type and the chooser shows a broader or narrower app list than ideal. **This degrades the chooser; it does not fail the share.** No JS-side workaround exists (the MIME is computed natively). Verify on the emulator; if the chooser is unusable, the fallback is a `dialogTitle` tweak or, last resort, a tiny Kotlin `ACTION_SEND` with an explicit type — but do not plan for that up front.

---

## Answer 6 — `<input type="file">` inside the Capacitor Android WebView (D-15)

### Settled from the installed source — D-15 needs zero native code

`node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java` (Capacitor **8.4.0**, the exact version this repo builds against) [VERIFIED: codebase]:

- **`:276` `public boolean onShowFileChooser(WebView, ValueCallback<Uri[]>, FileChooserParams)` is implemented and returns `true`.**
- `:279-289` route `capture`-enabled image/video inputs to the camera; **everything else falls to `showFilePicker(...)` at `:299`.** A `<input type="file" accept="application/json">` takes the plain branch.
- `:371-405` `showFilePicker` builds the intent from `fileChooserParams.createIntent()` (AOSP: `ACTION_GET_CONTENT` + `CATEGORY_OPENABLE`, type = `acceptTypes[0]`), launches it via the bridge's `activityLauncher`, and delivers the result back through `filePathCallback.onReceiveValue(result)` — handling both `ClipData` (multi) and `FileChooserParams.parseResult` (single).
- `ActivityNotFoundException` is caught (`:402-404`) and yields `onReceiveValue(null)` — i.e. a device with no document picker cancels cleanly rather than crashing.

**Confidence: HIGH that the element opens the system picker.** Remaining uncertainty is only the `accept` attribute's interaction, below.

### ⚠️ The `accept=".json"` gotcha — a real crash path, read from the source

`showFilePicker`, `:375-381`:

```java
if (fileChooserParams.getAcceptTypes().length > 1 || intent.getType().startsWith(".")) {
    String[] validTypes = getValidTypes(fileChooserParams.getAcceptTypes());
    intent.putExtra(Intent.EXTRA_MIME_TYPES, validTypes);
    if (intent.getType().startsWith(".")) {
        intent.setType(validTypes[0]);          // <-- unguarded index
    }
}
```

and `getValidTypes`, `:407-423`:

```java
for (String mime : currentTypes) {
    if (mime.startsWith(".")) {
        String extension = mime.substring(1);
        String extensionMime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        if (extensionMime != null && !validTypes.contains(extensionMime)) validTypes.add(extensionMime);
    } else if (!validTypes.contains(mime)) validTypes.add(mime);
}
```

With `accept=".json"` **alone**: `acceptTypes = [".json"]`, so `createIntent()` sets type `".json"` → `startsWith(".")` is true. If `getMimeTypeFromExtension("json")` returns `null` on that device, `validTypes` is **empty** and `validTypes[0]` throws `ArrayIndexOutOfBoundsException` — **outside** the `try` block that begins at `:388`. That is an uncaught exception inside `onShowFileChooser`. This is the exact mechanism behind the widely-reported "`accept=".json"` filters everything out / breaks the picker on Android" class of bug.

### Recommendation — sidestep the question entirely

```html
<input type="file" accept="application/json,.json" bind:this={fileInput} onchange={onPick} hidden />
```

Why this is safe on **every** API level, traced through the same code:
- `acceptTypes = ["application/json", ".json"]` → `length > 1` ⇒ the block runs.
- `createIntent()` sets type = `acceptTypes[0]` = `"application/json"` → **does not** start with `"."` ⇒ **`validTypes[0]` is never evaluated.** Crash path avoided unconditionally.
- `EXTRA_MIME_TYPES` receives `["application/json"]` (plus the `.json` mapping when the device has one) — so pickers that honour `EXTRA_MIME_TYPES` filter correctly, and the trailing `.json` helps browsers that only understand extensions.
- On iOS Safari and desktop the same attribute is the standard, well-supported form.

**Escape hatch if a device still hides the file:** drop `accept` entirely (`*/*` — always shows everything) and validate by content in `validateEnvelope`, which already rejects a non-backup with `not-ours`. Content validation is the real gate; `accept` is only a convenience filter. Note this in the plan so the fix is one attribute deletion, not a native plugin.

### Reading the picked file

Standard, no Capacitor involvement: `input.files?.[0]` → `await file.text()` → `validateEnvelope(text)`. The WebView materializes the picked `content://` URI into a `File` object; the JS side never sees a URI. Worth pinning in the plan: `validateEnvelope` takes a **string**, so the node test needs no `File`/`FileReader` stub.

### Verification recipe (D-15 — device-only, do not mark verified from code)

```bash
# 1. Build + install (JDK 21 required on this machine)
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home pnpm apk

# 2. Boot the existing AVD (confirmed present: ~/.android/avd/Pixel_3a_API_34.avd)
emulator -avd Pixel_3a_API_34 &
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# 3. Push a fixture the picker can see
adb push /tmp/openmusic-backup-2026-09-13.json /sdcard/Download/

# 4. Attach CDP (apk-debug-via-emulator-cdp) — chrome://inspect, or:
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.openmusic.app)
curl -s localhost:9222/json | python3 -m json.tool | head -30

# 5. In the app: Settings -> Data -> Import.
#    PASS = the Android document picker opens AND the pushed .json is selectable (not greyed out).
#    Then confirm the import completes and the app reloads with the restored library.

# 6. Export: Settings -> Data -> Export.
#    PASS = the Android share sheet opens, lists real targets (Drive/Files/Gmail),
#    and the saved file opens as readable JSON.
#    Also tap OUTSIDE the sheet to dismiss it -> PASS = no "export failed" message.

# 7. Watch logcat for the crash path this research flagged:
adb logcat | grep -iE "ArrayIndexOutOfBounds|FileChooser|fileprovider|SharePlugin"
```

Both steps 5 and 6 are `checkpoint:human-verify` material. Steps 5 and 6 are also the only two things in this phase that cannot be proven by `pnpm test`.

### Bonus finding — `confirm()` works in the Capacitor WebView

CONTEXT's discretion item ("`confirm()` or a proper sheet?") and the Phase 33 worry about `prompt()` are settled by the installed source [VERIFIED: codebase]:

- `BridgeWebChromeClient.java:135` `onJsAlert` → native `AlertDialog`
- `:168` **`onJsConfirm` → native `AlertDialog` with OK / cancel wired to `result.confirm()` / `result.cancel()`**
- `:207` `onJsPrompt` → native `AlertDialog` with an `EditText`

All three are implemented in Capacitor 8.4.0. **Use the existing `confirm()` pattern** (`settings/data/+page.svelte:35`, `clearLibrary`) for D-08's destructive confirm. It works identically on web, iOS Safari and the APK, costs zero new components, and matches the page's established idiom. Building a bespoke confirm sheet would be unrequested scope.

---

## Answer 7 — Where the web download path can bite

### Reuse `saveBlobToDisk` — do not write a second anchor helper

`src/lib/services/download-save.ts:24` [VERIFIED: codebase]:

```ts
export function saveBlobToDisk(blob: Blob, filename: string, doc: Document | undefined = globalThis.document): boolean
```

It creates a same-origin `blob:` URL, wires a hidden `<a download>`, clicks it, and **revokes the URL in a `finally`** (`:51-53`). Returns `false` — never throws, never navigates — if `document` or `URL.createObjectURL` is missing (`:30-39`). `doc` is injectable so it runs in the node Vitest project with a fake document, **no jsdom required**.

It carries a **guardrail the plan must respect** (`:13-16`): *"this function's body MUST NOT re-introduce a new-tab navigation fallback nor a save-picker branch — those two paths ARE the bug. The co-located test greps this function's source to enforce their absence."* So `download-save.test.ts` will fail if anyone adds a File System Access branch — which is independently what D-14 forbids. Nothing to change; just do not touch it.

Export call site:

```ts
const filename = `openmusic-backup-${new Date().toISOString().slice(0, 10)}.json`;  // 35-D-04
const blob = new Blob([json], { type: 'application/json' });
const ok = saveBlobToDisk(blob, filename);   // 35-D-14 — the EXISTING anchor seam, unchanged
```

### `src/lib/services/share.ts` is NOT a file-sharing helper

Despite the name and CLAUDE.md's mention of `isHttpsUrl`, `share.ts` is a **URL / base64url share-token builder** (`encodeShare` :159, `decodeShare` :175, `songShareUrl` :369, `entityShareUrl` :433, `isHttpsUrl` :530). It contains no `navigator.share` call and no file handling. [VERIFIED: codebase]

`navigator.share` is called inline in exactly three components — `TrackMenu.svelte:317`, `album/[name]/+page.svelte:519`, `artist/[name]/+page.svelte:255` — always `{ title?, text }`, **never `{ files }`**. There is no reusable share-sheet helper to extend. Do not try to fold the backup share into `share.ts`; different concern, and D-16's native export goes through `@capacitor/share`, not `navigator.share`.

### iOS Safari `<a download>` + `createObjectURL` — the real limitations

iOS Safari is the primary target, so these matter [ASSUMED — training knowledge, not verifiable in this session; treat as risk notes, not facts]:

1. **The click must be inside the user-gesture task.** iOS blocks a programmatic anchor click that happens after an `await`. **Build the whole JSON string synchronously in the click handler, then click.** This is free here: every exported key is a synchronous `localStorage.getItem` — there is no async step in the export path at all. **Do not make `buildEnvelope` async.** (`downloadTrack` gets away with awaiting because *it* is not gesture-bound on the anchor click; the backup export has no such excuse and no such need.)
2. **`download` attribute support landed in iOS 13.** Safe for the supported baseline.
3. **iOS ignores the `download` filename in some versions** and may name the file `Unknown` or open it in a preview tab. The existing download feature already lives with this for audio; a JSON that opens in a preview tab is still shareable from there. **Accept; do not build an iOS-specific path** — D-14 explicitly rejects a second code path.
4. **Revoke after the click, not before.** `saveBlobToDisk`'s `finally` already does this correctly; iOS has historically needed the URL alive at click time, which it is.
5. **`type: 'application/json'`** — some iOS versions will preview rather than download this. `'application/octet-stream'` forces a download more reliably but makes the file less pleasant elsewhere. **Recommendation: keep `application/json`** (D-03's "human-readable" intent); note the alternative in a comment.

---

## Answer 8 — Payload size reality check

Measured with a script over the **actual** persisted shapes (`library.save()` writes full `Track` objects; `Track` fields from `src/lib/sources/types.ts:27-90`), with realistic CJK metadata and real-length QQ CDN cover URLs:

**Scenario:** 500 liked + 200 downloads + 5 playlists × 40 tracks + 40 fav artists + 50 history (the cap) + 12 search history (the cap) + full settings + 3 000 name-translation entries.

| Key | Compact | Pretty (2-space) |
|---|---|---|
| `openmusic:library:v1` | 607 KB | 856 KB |
| `openmusic:name-tr:v2:zh-Hant` | 118 KB | 130 KB |
| `openmusic:history:v1` | 15 KB | 18 KB |
| `openmusic:search-history:v1` | 1 KB | 1 KB |
| `openmusic:settings:v1` | 1 KB | 2 KB |
| **Full envelope** | **0.72 MB** | **1.11 MB** |
| Worst case (Last.fm `bio` + `lastfmArt` on all 500 liked) | 0.94 MB | ~1.4 MB |

### Conclusions

1. **One in-memory string is completely safe.** ~1.1 MB of pretty-printed JSON is nothing for a mobile browser. No streaming, no chunking. D-03's pretty-print costs ~55 % and is worth it.
2. **History is capped at 50, not 1000.** `HISTORY_CAP = 50` (`history-logic.ts:11`), `SEARCH_HISTORY_CAP = 12` (`search-history-logic.ts:14`). The brief's "1000 history entries" cannot occur. **`library:v1` is ~84 % of the payload**; everything else is rounding error. Any size optimization that is not about library is wasted effort.
3. **Library is big because it stores full `Track`s with no whitelist.** `player-persist.ts:58` and `history-logic.ts:36` both strip to 11 fields; `library.save()` does not. Stripping would cut the file by more than half — but it is **out of scope and dangerous**: `library.liked` entries are handed straight to `player.setQueue`, and fields like `songMid` / `qqSearchKey` / `duration` / `tags` are load-bearing downstream. **Export verbatim.** (Worth logging as a separate future idea; not this phase.)

### ⚠️ The D-09 rollback snapshot must NOT go in `localStorage`

localStorage is ~5 MB **per origin, total**. In the scenario above the five restorable keys already occupy **~740 KB**, and they share that origin budget with `cover-cache:v1` (three key families across every track the user has seen) and the `lyrics-tr:v3:*` family (**one key per translated lyric sheet**). A full snapshot beside the live keys **doubles the restorable footprint to ~1.5 MB** on top of caches of unmeasured and unbounded-ish size. `library.save()`'s quota catch is `/* quota — non-fatal */` (`library.svelte.ts:78-80`) — meaning a quota failure is **silent**. Writing a snapshot that pushes the origin over quota could silently break the next library save.

**Recommendation: put the rollback snapshot in `sessionStorage`.** This is rung 4 of the ladder — a native platform feature that answers three requirements at once:

- **It survives `location.reload()`** (same tab, same origin), which is exactly what D-13's forced reload needs for the Undo affordance to still be there afterwards.
- **It has its own ~5 MB quota**, separate from localStorage — zero competition with the live keys or the caches.
- **It dies when the tab/app closes**, which is the right answer to the discretion question "how long is the rollback snapshot retained?" Undo is meaningful for the minutes after an import, not for weeks. No expiry timer, no cleanup job, no new persisted key to document.

Mechanics:
1. Before writing, build the snapshot with the **same `buildEnvelope()`** used for export (D-09: "same JSON shape — no new serializer").
2. `sessionStorage.setItem('openmusic:import-undo:v1', snapshotJson)` in a `try/catch` — on quota failure, **abort the import and tell the user** rather than proceeding without a safety net (a destructive one-tap button with no undo is the thing D-09 exists to prevent).
3. After reload, the Data page checks for the key; if present, render **Undo import**.
4. Undo = validate the snapshot through the same `validateEnvelope`, write it back, `removeItem`, `location.reload()`. **One code path for both directions.**

Note: `grep -rn "sessionStorage" src/` returns nothing today — this would be the first use. It is a standard Web Storage API, available in iOS Safari and the Android WebView alike, and needs the same `browser` guard as localStorage. If the planner prefers not to introduce a second storage API, the fallback is `localStorage` under `openmusic:import-undo:v1` with an explicit size pre-check (`if (snapshot.length > 2_000_000) skip snapshot and warn`) — but sessionStorage is strictly less code and strictly better semantics.

---

## Answer 9 — Existing test infrastructure

### There is no jsdom — localStorage is a hand-rolled in-memory stub

`vite.config.ts` defines **one** Vitest project: `{ name: 'server', environment: 'node', include: ['src/**/*.{test,spec}.{js,ts}'] }`. The comment is explicit: *"No jsdom client project exists, so a `.svelte.test.ts` must run under this node project."* [VERIFIED: codebase]

The established harness (introduced in `library.svelte.test.ts:14-26`, reused verbatim in `settings-persist.svelte.test.ts:12-22`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$app/environment', () => ({ browser: true }));   // module-scoped: ONE value per test FILE

const memStore = new Map<string, string>();
const localStorageMock: Storage = {
	get length() { return memStore.size; },
	clear: () => memStore.clear(),
	getItem: (k: string) => (memStore.has(k) ? (memStore.get(k) as string) : null),
	key: (i: number) => Array.from(memStore.keys())[i] ?? null,
	removeItem: (k: string) => void memStore.delete(k),
	setItem: (k: string, v: string) => void memStore.set(k, String(v))
};
vi.stubGlobal('localStorage', localStorageMock);
```

**`key(i)` and `length` are implemented** — which matters here, because the name-tr prefix enumeration uses exactly that `for (let i=0; i<localStorage.length; i++) localStorage.key(i)` loop (`names.svelte.ts:74-79`, `:285-288`). `translate.test.ts:47` already exercises prefix enumeration against this stub (`lsKeys().filter(k => k.startsWith('openmusic:lyrics-tr:v3:'))`). The harness is proven for the one non-obvious thing this phase needs.

Additional patterns to copy:

- **`browser: true` is module-scoped, one value per file.** `settings-persist.svelte.test.ts:4-8` documents why a *second* test file was created rather than flipping the mock: `settings.svelte.test.ts` depends on `browser === false`. If this phase needs both, split files.
- **Singletons carry a `loaded` once-guard**, so every load case needs a fresh module (`settings-persist.svelte.test.ts:32-36`):
  ```ts
  async function freshSettings() { vi.resetModules(); const { settings } = await import('./settings.svelte'); return settings; }
  ```
  Registered `vi.mock` factories survive `resetModules`. A **round-trip test** (export → import → reload → same state) must use this to simulate D-13's reload: write keys, `vi.resetModules()`, re-import each store, call `load()`, assert.
- **Extra globals settings needs:** `vi.stubGlobal('navigator', { language: 'en-US' })` and `vi.stubGlobal('document', { documentElement: { style: { setProperty: () => {} }, dataset: {} } })` (`settings-persist.svelte.test.ts:26-27`) — because `load()` reads `navigator.language` and both `load()` and `save()` end in `applyTheme()`.
- **For the pure validator, none of this is needed.** `backup-logic.test.ts` imports the pure module and drives `validateEnvelope(string)` directly — no `vi.mock`, no globals. Same as `player-persist.test.ts`, `history-logic.test.ts`, `search-history-logic.test.ts`.
- **Key-literal pinning is an established assertion** (`action-log-logic.test.ts:13`, `search-history-logic.test.ts:111-112`, `player-persist.test.ts:41`) — use it for the D-01/D-02 key set.
- **`expect: { requireAssertions: true }`** is set globally — every `it()` must assert.
- **For `saveBlobToDisk`**, inject a fake `doc` and stub `globalThis.URL` — `download-save.test.ts` already does this; copy it rather than reinventing.

---

## Architecture Patterns

### System Architecture Diagram

```text
                       Settings → Data page  (src/routes/(app)/settings/data/+page.svelte)
                       [Export] [Import] [Re-download missing (N)] [Undo import?]
                              │            │             │                │
             ┌────────────────┘            │             │                │
             │                             │             │                │
             ▼                             ▼             │                │
   ┌───────────────────┐        <input type="file">      │                │
   │  buildEnvelope()  │        accept="application/     │                │
   │   (SYNCHRONOUS —  │              json,.json"        │                │
   │  iOS gesture rule)│                  │              │                │
   └─────────┬─────────┘            await file.text()    │                │
             │                            │              │                │
      reads 5 key families                ▼              │                │
      from localStorage           ┌─────────────────┐    │                │
      (4 exact + 1 PREFIX scan)   │validateEnvelope │    │                │
             │                    │  PURE, never    │    │                │
             │                    │  throws, returns│    │                │
             │                    │  ok | not-ours  │    │                │
             │                    │  | newer |      │    │                │
             │                    │    damaged      │    │                │
             │                    └────────┬────────┘    │                │
             │                        ok?  │  no ────────┼──► t('backup.err.*')  [D-11]
             │                             │ yes         │      NOTHING WRITTEN  [D-10]
             │                             ▼             │                │
             │                     confirm()  [D-08]     │                │
             │                       native AlertDialog  │                │
             │                       in the APK too      │                │
             │                             │             │                │
             │                             ▼             │                │
             │                  buildEnvelope() again ───┼──► sessionStorage
             │                  → rollback snapshot      │    'openmusic:import-undo:v1'
             │                             │             │                │  [D-09]
             │                             ▼             │                └──┐
             │             wipe D-01 keys, write payloads │                   │
             │              (all-or-nothing, post-validate)                   │
             │                             │             │                   │
             │                             ▼             │                   ▼
             │                    location.reload()  [D-13]         validate + write
             │                    every store's load() reruns          + reload
             │                                           │
    ┌────────┴─────────┐                                 │
    │ isNativePlatform?│                                 ▼
    └───┬──────────┬───┘                    ┌────────────────────────────┐
   web  │          │ native                 │ missing = downloads.filter │
        ▼          ▼                        │   !await blobStore.has(uid)│  [D-07]
  saveBlobToDisk   Filesystem.writeFile     │   (getKey / stat — no bytes)│
  (blob: + <a      Directory.Cache, UTF8    └────────────┬───────────────┘
   download>,      → Filesystem.getUri()                 │ SEQUENTIAL loop
   existing seam)  → file:// URI                         │ + stop flag
        │          → Share.share({files})                │ + re-probe per item
        │            → FileProvider                      ▼
        │              ${appId}.fileprovider   downloadTrack(t, {save:false})
        │              (ALREADY in manifest)   ├─ ensureTrackDetails → apiFetch (governed, cap 8)
        ▼              <cache-path> covers it  ├─ RAW fetch of audio bytes (UNGOVERNED — why
   browser Downloads          │                │   concurrency MUST be 1; api-fetch-flood-freeze)
                              ▼                └─ blobStore.put (IDB / Directory.Data + MediaStore)
                        Android share sheet
```

### Recommended file layout

```
src/lib/backup/
├── backup-logic.ts        # PURE: key consts, BACKUP_FORMAT, buildEnvelope, validateEnvelope,
│                          #       MIGRATIONS (empty), collectNameTrKeys(keyList)
└── backup-logic.test.ts   # co-located, node project, no jsdom

src/lib/services/
└── backup-io.ts           # THIN platform seam: exportBackup(json, filename),
                           # pickAndReadFile is inline in the page (an <input> element).
                           # Guarded by Capacitor.isNativePlatform(); wraps saveBlobToDisk
                           # on web and Filesystem+Share on native. Never throws (boolean).

src/routes/(app)/settings/data/+page.svelte   # MODIFIED: 3 buttons + hidden input + undo affordance
src/lib/i18n/*.ts                             # MODIFIED: new keys in ALL 15 dictionaries
package.json                                  # MODIFIED: + "@capacitor/share": "^8.0.1"
```

**No new store.** The page holds its own `$state` for counts / busy flags / messages, exactly as it does today (`msg`, `counts`). Adding a `backup.svelte.ts` singleton for two buttons would be an unrequested abstraction.

### Pattern 1 — Pure core + thin platform seam

**What:** All decisions (what to read, what shape, is it valid, what to migrate) live in a pure `.ts`. All platform contact (localStorage, Blob, Filesystem, Share) lives in a thin wrapper or the page.
**When:** Every feature in this codebase. `cover-version.svelte.ts` / `cover-cache.ts` is named in CLAUDE.md as the canonical "wrap, don't rewrite" example; `history-logic.ts` ← `history.svelte.ts` and `player-persist.ts` ← `player.svelte.ts` are the closest structural matches.

```ts
// Source: shape derived from src/lib/stores/player-persist.ts:1-18 + :130
// PURE — NO runes, NO `$app/environment`, NEVER throws.
export function buildEnvelope(read: (k: string) => string | null, allKeys: string[]): BackupEnvelope { … }
```

> Threading `read` and `allKeys` in as parameters (rather than touching `localStorage` directly) keeps `buildEnvelope` pure **and** lets the test drive it from a `Map` with no `vi.stubGlobal`. `saveBlobToDisk`'s injectable `doc` parameter (`download-save.ts:27`) is the in-repo precedent for exactly this trick.

### Pattern 2 — Typed reason, localized at the UI layer

**What:** The service returns a machine reason; the component maps it to `t()`.
**Source:** `download-track.ts:10-15` — *"It deliberately imports NEITHER `$lib/i18n` NOR `$lib/stores/toast`: the `t()` reads runes `$state` and would break the single node Vitest project, and text localization is the UI layer's job."* Same reason applies verbatim here.

```svelte
const res = validateEnvelope(text);
if (!res.ok) {
	flash(res.reason === 'not-ours' ? t('backup.errNotOurs')
	    : res.reason === 'newer'   ? t('backup.errNewer')
	    :                            t('backup.errDamaged'));
	return;   // 35-D-10: nothing written
}
```

### Pattern 3 — Derived state, never stored

**What:** "Which downloads are missing" is recomputed from `blobStore.has`, never persisted.
**Source:** D-07, and the precedent in `TrackMenu.svelte:215-235` (`blobPresent = $state<boolean|null>(null)`, probed on open, reset to `null` on close). Gives D-06 resumability for free and adds no 15th localStorage key.

### Anti-patterns to avoid

- **Live re-hydration after import.** D-13 forbids it; `restore-effect-self-invalidation-loop` is the scar. `location.reload()` is one line and correct.
- **A per-key migration framework.** `MIGRATIONS` is empty and every store's `load()` is already tolerant (Answer 2). Write the empty record with a comment; add entries the day a version is actually bumped.
- **A second anchor-download helper.** `saveBlobToDisk` exists, is tested, and carries a grep-enforced guardrail against the exact bug D-14 is avoiding.
- **Parallel re-downloads.** The audio fetch is ungoverned raw `fetch` by explicit design. Sequential (Answer 4).
- **`async` in the export click handler before the anchor click.** iOS gesture rule; and it is unnecessary since every read is synchronous.
- **Re-validating settings field-by-field on import.** `settings.load()` already guards every field against a tamperable store (T-vzu-01). Duplicating it would go stale.
- **Exporting `openmusic:diag:v1`.** It is a device-local upload token — a secret. It is outside D-01, but say so explicitly in the plan so a "just grab all openmusic: keys" shortcut can never ship.
- **`accept=".json"` alone.** Answer 6 — a crash path in Capacitor's own picker code.
- **Importing `names.svelte.ts`'s `STORE_VER` into the pure module.** Drags runes into the node test; enumerate by prefix instead.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Save a Blob to the user's Downloads (web) | anchor + object-URL + revoke | `saveBlobToDisk` (`$lib/services/download-save.ts:24`) | Tested, revokes in `finally`, never navigates, grep-guardrailed against DL-BUG-01 |
| "Are the bytes actually on disk?" | IDB open + read + size check | `blobStore.has` (`$lib/services/blob-store.ts:286`) | Index-only on web, `stat` on native, never throws, already platform-switched |
| Re-download one song | resolve + fetch + persist + filename | `downloadTrack(t, {save:false})` (`$lib/services/download-track.ts:65`) | Quality tier, URL reuse, isolation (D-18), spinner brackets, never-throws, and `save:false` is *exactly* the silent-repair mode D-06 needs |
| Wipe the library key before Replace | manual `removeItem` + store reset | `library.clearAll()` (`$lib/stores/library.svelte.ts:218`) | Zeroes all four arrays and saves; already the Clear-library button's implementation |
| Destructive confirm in the APK | a custom sheet component | `confirm()` | Capacitor 8 renders a native `AlertDialog` (`BridgeWebChromeClient.java:168`); the page already uses this at `:35` |
| Android `ACTION_SEND` for a file | Kotlin plugin | `@capacitor/share@^8.0.1` | D-17; the FileProvider it needs is already in the manifest |
| Android file picker | a `@PluginMethod` wrapping `ACTION_OPEN_DOCUMENT` | `<input type="file">` | `BridgeWebChromeClient.onShowFileChooser` is implemented (`:276`) |
| Write a text file on native | `capacitor-blob-writer` / base64 dance | `Filesystem.writeFile({encoding: Encoding.UTF8})` | The base64 concern (WR-03) is about **binary** blobs; a UTF-8 string write is what this API is for |
| Snapshot retention / expiry | a TTL + cleanup job | `sessionStorage` | Survives the reload, separate quota, expires with the tab — three requirements, zero code |
| Compress the export | a zip/gzip dependency | pretty-printed JSON | D-03; 1.1 MB measured (Answer 8) — compression would buy nothing and cost the project's first runtime dep |
| Per-entry validation of search history | a new validator | `parseSearchHistory` (`$lib/search/search-history-logic.ts:58`) | Already validates + filters per entry; copy its *shape* for the envelope's list checks |

**Key insight:** this phase is ~90 % wiring. Nearly every hard primitive — cheap blob probe, silent re-download, anchor save, never-throw pure-parse shape, native FileProvider, native confirm dialog, in-memory localStorage test harness — already exists and was written for adjacent reasons. The genuinely new code is one pure module (envelope + validator), one thin platform seam, three buttons, and 15 dictionary edits.

---

## Common Pitfalls

### Pitfall 1 — `accept=".json"` crashes Capacitor's own file picker
**What goes wrong:** `BridgeWebChromeClient.showFilePicker` evaluates `validTypes[0]` on a possibly-empty array (`:379`) when the intent type starts with `"."`, outside its `try`.
**Why:** `MimeTypeMap.getMimeTypeFromExtension("json")` can return `null`; `getValidTypes` then yields an empty array.
**Avoid:** `accept="application/json,.json"` — the first entry is a real MIME, so the `"."` branch never runs. Escape hatch: drop `accept` entirely; content validation is the real gate.
**Warning signs:** `ArrayIndexOutOfBoundsException` in logcat when tapping Import; picker never opens; or the `.json` file appears greyed out.

### Pitfall 2 — the rollback snapshot blows the localStorage quota
**What goes wrong:** A full snapshot beside the live keys doubles the restorable footprint (~740 KB → ~1.5 MB measured) inside a ~5 MB origin budget already shared with `cover-cache:v1` and the unbounded `lyrics-tr:v3:*` family. `library.save()`'s quota catch is silent (`library.svelte.ts:78-80`), so the *next* library write fails without a word.
**Avoid:** `sessionStorage` (Answer 8). If localStorage is used anyway, pre-check the length and refuse the import rather than proceeding without an undo.
**Warning signs:** likes stop persisting after an import; nothing in the console.

### Pitfall 3 — a parallel re-download sweep reproduces `api-fetch-flood-freeze`
**What goes wrong:** `downloadTrack` fetches audio with **raw `fetch`** (`:106-109`), deliberately outside the `apiFetch` governor. N parallel calls = N simultaneous multi-MB body reads against a ~6-connection pool.
**Avoid:** strictly sequential loop, a small stagger, a stop flag, and a `blobStore.has` re-probe at the top of each iteration.
**Warning signs:** UI freezes mid-sweep; `net::ERR_INSUFFICIENT_RESOURCES`; the circuit breaker opening on the *resolve* half.

### Pitfall 4 — the name-translation cache is a key FAMILY, not a key
**What goes wrong:** `localStorage.getItem('openmusic:name-tr')` returns `null`; the export silently ships an empty name cache and the round-trip is quietly lossy.
**Why:** `keyFor(lang)` (`names.svelte.ts:47`) makes one key per target language.
**Avoid:** enumerate by prefix `'openmusic:name-tr:'` via the `length`/`key(i)` loop, exactly as `clearCache()` does (`:285-288`). The test stub implements both.
**Warning signs:** a test that only covers the 4 exact keys passes; the restored device re-translates every name.

### Pitfall 5 — iOS blocks the anchor click after an `await`
**What goes wrong:** export does nothing on iOS Safari, silently.
**Avoid:** keep `buildEnvelope` synchronous — every read is a synchronous `getItem`, so there is no reason for it to be async. Do not add `await` between the click handler entry and `saveBlobToDisk`.
**Warning signs:** works on desktop Chrome, no-ops on iPhone.

### Pitfall 6 — writing the share file to `Directory.Data`
**What goes wrong:** `Share.share` fails with a FileProvider `IllegalArgumentException` ("Failed to find configured root").
**Why:** `file_paths.xml` declares only `<external-path>` and `<cache-path>`. `Directory.Data` → `getFilesDir()` needs a `<files-path>` entry that does not exist.
**Avoid:** `Directory.Cache` (which is also what D-16 says). Do not edit `file_paths.xml`.
**Warning signs:** export works on web, rejects on the APK with a FileProvider error in logcat.

### Pitfall 7 — `library.load()` does not type-guard its three arrays
**What goes wrong:** an imported `{"liked": 5}` sets `library.liked = 5`; home shelves `.map()` over a number and the app white-screens on next boot — *after* the import already reloaded the page, so the user is stuck.
**Why:** `library.svelte.ts:56-58` uses bare `?? []` casts; only `favArtists` gets `Array.isArray`.
**Avoid:** `validateEnvelope` asserts `Array.isArray` on `liked` / `playlists` / `downloads` before the write. This is the one place where the importer is genuinely the last line of defence.
**Warning signs:** none until reload, which is what makes it dangerous.

### Pitfall 8 — a dismissed Android share sheet is reported as a failure
**What goes wrong:** the user taps outside the sheet, `Share.share` rejects, the app flashes "Export failed".
**Avoid:** `try/catch` and treat a rejection after a successful file write as a non-error (or say nothing at all).

### Pitfall 9 — the i18n key-set parity test fails the whole suite
**What goes wrong:** new keys added to `en.ts` only; `i18n.test.ts:52-57` asserts every locale's key set equals `en`'s.
**Avoid:** add every new key to all **15** dictionaries in the same commit, **double-quoted** for both key and value (CLAUDE.md; no formatter enforces it).

### Pitfall 10 — `blobStore.has` web/native asymmetry
**What goes wrong:** on web, `getKey` reports `true` for a stored 0-byte record that `get()` rejects via `MIN_BLOB_BYTES` (`:34`, `:260`); the sweep skips a file that actually needs re-downloading.
**Avoid:** accept and document — the player's 31-D-12 repair path already re-downloads truncated blobs on the next play attempt. Do not widen the sweep's job.

---

## Code Examples

### Building the envelope (pure, synchronous, injectable)

```ts
// Source: shape from src/lib/stores/player-persist.ts:83 + injectable-dep trick from
//         src/lib/services/download-save.ts:27
export const LIBRARY_KEY = 'openmusic:library:v1';
export const SETTINGS_KEY = 'openmusic:settings:v1';
export const NAME_TR_PREFIX = 'openmusic:name-tr:';
/** 35-D-01/D-02: the EXACT exported set. player:v1 and diag:v1 are deliberately absent —
 *  pinned by a test so a future "just grab everything" shortcut can never ship. */
export const BACKUP_EXACT_KEYS = [LIBRARY_KEY, HISTORY_KEY, SEARCH_HISTORY_KEY, SETTINGS_KEY] as const;

export function buildEnvelope(read: (k: string) => string | null, allKeys: readonly string[]): BackupEnvelope {
	const keys: Record<string, unknown> = {};
	const take = (k: string) => {
		const raw = read(k);
		if (raw == null) return;              // absent key is simply absent from the envelope
		try { keys[k] = JSON.parse(raw); } catch { /* corrupt local key: skip, never abort an export */ }
	};
	for (const k of BACKUP_EXACT_KEYS) take(k);
	// 35-D-01: name-tr is a PREFIX FAMILY (one key per target lang, names.svelte.ts:47).
	// Enumerated by prefix so a future STORE_VER bump needs no change here.
	for (const k of allKeys) if (k.startsWith(NAME_TR_PREFIX)) take(k);
	return { app: BACKUP_MAGIC, format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), keys };
}
```

### Enumerating localStorage keys (the in-repo idiom)

```ts
// Source: src/lib/stores/names.svelte.ts:285-288 (clearCache) — identical loop at :74-79.
// The node test stub implements BOTH `length` and `key(i)` (library.svelte.test.ts:16-23).
function allLocalStorageKeys(): string[] {
	const out: string[] = [];
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k) out.push(k);
		}
	} catch { /* unavailable — treat as empty */ }
	return out;
}
```

### The atomic write (D-08 + D-09 + D-10 + D-13)

```ts
// Page-level; runs ONLY after validateEnvelope returned ok (35-D-10).
function applyImport(env: BackupEnvelope): boolean {
	const snapshot = JSON.stringify(buildEnvelope(k => localStorage.getItem(k), allLocalStorageKeys()));
	try {
		// 35-D-09: a destructive one-tap button without an undo is the thing this prevents.
		// sessionStorage survives location.reload() (D-13), has its own quota, and expires with
		// the tab — which is also the retention answer.
		sessionStorage.setItem(UNDO_KEY, snapshot);
	} catch {
		return false;                         // no safety net -> refuse rather than proceed
	}
	try {
		// Wipe the D-01 set, INCLUDING every existing name-tr key (Replace, not merge).
		for (const k of BACKUP_EXACT_KEYS) localStorage.removeItem(k);
		for (const k of allLocalStorageKeys()) if (k.startsWith(NAME_TR_PREFIX)) localStorage.removeItem(k);
		for (const [k, v] of Object.entries(env.keys)) localStorage.setItem(k, JSON.stringify(v));
	} catch {
		return false;                         // quota mid-write: the snapshot in sessionStorage is the recovery
	}
	location.reload();                        // 35-D-13
	return true;
}
```

### Native export (D-16/D-17)

See Answer 5 for `shareBackupNative`. Web/native branch:

```ts
// 35-D-18: both branches guarded. The web build must not call into a Capacitor plugin path.
export async function exportBackup(json: string, filename: string): Promise<boolean> {
	if (Capacitor.isNativePlatform()) return shareBackupNative(json, filename);
	return saveBlobToDisk(new Blob([json], { type: 'application/json' }), filename);
}
```

### The re-download sweep (D-06)

```ts
// Source: loop shape from src/routes/(app)/album/[name]/+page.svelte:427-434
let sweeping = $state(false);
async function redownloadMissing() {
	if (sweeping) return;
	sweeping = true;
	let saved = 0, failed = 0;
	try {
		for (const t of library.downloads) {
			if (!sweeping) break;                              // user-tappable stop
			if (await blobStore.has(t.uid)) continue;          // 35-D-07: derived, so resumable for free
			// save:false = the 31-D-12 silent-repair mode: persists the offline blob (and the
			// native public copy) WITHOUT firing an <a download> click. 200 songs, 0 save dialogs.
			const res = await downloadTrack(t, { save: false });
			res === 'saved' ? saved++ : failed++;
			// Sequential + stagger. The audio fetch is RAW (download-track.ts:106) and therefore
			// UNGOVERNED — parallelism here is exactly api-fetch-flood-freeze.
			await new Promise(r => setTimeout(r, 250));
		}
		flash(t('backup.sweepDone', { saved, failed }));
	} finally { sweeping = false; }
}
```

---

## State of the Art

| Old approach | Current approach | When changed | Impact here |
|---|---|---|---|
| `library.isDownloaded(uid)` as "is it downloaded" | `blobStore.has(uid)` for byte-truth; the list keeps its "user asked for this" meaning | `quick-260913-jq4` (2026-09-13) | D-07 is the sanctioned continuation of an explicitly-deferred migration (`TrackMenu.svelte:213-214`) |
| Per-call-site download code with `window.open` fallback | one shared `downloadTrack` (29-03), never navigates | Phase 29 | The sweep reuses it; adding a second download path would be a regression |
| File System Access save-picker | `<a download>` anchor seam with a grep-enforced guardrail | DL-BUG-01 / D-02 / D-09 | D-14's "no FSA" is already enforced by a test |
| Ungoverned `fetch` for `/api/*` | `apiFetch` governor: dedupe + cap 8 + 25 s timeout + circuit breaker | `api-fetch-flood-freeze` rounds 1-2 | Protects the *resolve* half of the sweep only; media bytes remain raw by design |
| Capacitor 6/7 plugin line | Capacitor **8.4.0**; plugins on the `8.x` line | `999.1` native migration | `@capacitor/share@^8.0.1` is the matching version |

**Deprecated / not applicable:**
- `openmusic:top-picks:v1` — legacy, clear-only (`settings/data/+page.svelte:13`); never written. Out of scope either way.
- `src/lib/services/downloads-queue.ts` — **misleading name**; it is `buildOfflineQueue`, the offline up-next builder. Not a download queue. Do not plan around it.
- The desktop original's `importPlaylistData` / `exportPlaylistData` — the file is not in this repo (`app-is-sveltekit-not-index-html`). Conceptual precedent only; do not search for it.

---

## Project skill relevance

`.claude/skills/spike-findings-openmusic/SKILL.md` — **NOT relevant to this phase.** Its stated auto-load trigger is "the source-resolution / up-next / cover / API-reduction redesign" (kuwo-first resolution, `track.getSimilar` up-next, inline covers). This phase touches none of those. The one adjacency is that the sweep calls `ensureTrackDetails`, but it does so through `downloadTrack`, which owns the quality-tier decision — nothing in the skill changes that call. Do not load it.

---

## Runtime State Inventory

This is not a rename/refactor, but it **writes and deletes persisted state**, so the same discipline applies.

| Category | Items found | Action required |
|---|---|---|
| **Stored data** | localStorage: 14 `openmusic:*` names/families + the `openmusic-blob-uri:<uid>` family (full table, Answer 1). IndexedDB `openmusic-blobs`/`tracks` (`blob-store.ts:24-26`). Native: `Directory.Data/downloads/<sanitized-uid>` + public `Music/OpenMusic/`. | **Read** the 5 exported families; **delete + rewrite** them on import. **Never touch** IndexedDB, the native download dirs, `openmusic-blob-uri:*`, or `openmusic:diag:v1` (a secret). |
| **Live service config** | None — no server-side or external-service state. The export is entirely device-local. | None — verified: this phase adds no `/api/*` route and no Cloudflare binding. |
| **OS-registered state** | Android FileProvider `${applicationId}.fileprovider` — **already declared** (`AndroidManifest.xml:29-36`), `<cache-path>` present in `file_paths.xml`. `@capacitor/share` is registered by `npx cap sync`. | Re-run `npx cap sync android` after adding the dependency. **No manifest edit.** |
| **Secrets / env vars** | `openmusic:diag:v1` is a device-local diagnostic **upload token** (`settings/activity/+page.svelte:12`). Server secrets (`JOOX_TOKEN`, `LASTFM_*`, `DIAG_*`) live only in Cloudflare `platform.env` and never reach the client. | **Explicitly exclude `openmusic:diag:v1`** from the export and pin it with a test assertion. No env-var change. |
| **Build artifacts** | `android/app/build/outputs/apk/debug/app-debug.apk` goes stale once the dependency is added. `.svelte-kit/` and `build/` regenerate. | Rebuild with `JAVA_HOME=/opt/homebrew/opt/openjdk@21/... pnpm apk` before any device verification. |

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| Node | tooling | ✓ | ≥22 (`engines`, `.nvmrc`) | — |
| pnpm | add `@capacitor/share` | ✓ | 8.15.5 (pinned, corepack) | — |
| `@capacitor/core` | plugin peer | ✓ | 8.4.0 | — |
| `@capacitor/filesystem` | D-16 cache write + `getUri` | ✓ | 8.1.2 (already a dependency) | — |
| `@capacitor/share` | D-17 | ✗ | to add: `^8.0.1` | none — D-16 requires it |
| Android FileProvider entry | `Share.share({files})` | ✓ | `${applicationId}.fileprovider` + `<cache-path>` already in the repo | — |
| JDK 21 | `pnpm apk` | ✓ | `/opt/homebrew/opt/openjdk@21` (needs explicit `JAVA_HOME`) | — |
| Android emulator AVD | D-15 / D-16 device verification | ✓ | `Pixel_3a_API_34` | a physical device |
| Vitest | tests | ✓ | ^4.1.3, single node project | — |
| slopcheck | package legitimacy | ✓ | ran clean | — |

**Missing with no fallback:** `@capacitor/share@^8.0.1` — a plain `pnpm add`, slopcheck `[OK]`, first-party, peer-compatible.
**Missing with fallback:** none.

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source repo | slopcheck | Disposition |
|---|---|---|---|---|---|---|
| `@capacitor/share` | npm | `latest-3` back to v1.1.2 — multi-year, maintained release line; `8.0.1` published 2026-09-11 | first-party Capacitor plugin (same org as the 5 already installed) | github.com/ionic-team/capacitor-plugins | **[OK]** | **Approved** |

**Removed due to `[SLOP]`:** none.
**Flagged `[SUS]`:** none.

Verification performed:
- `slopcheck install @capacitor/share` → `[OK]`, `1 OK` of 1 scanned. (slopcheck's own `npm install` step then errored on this pnpm workspace — **nothing was installed**; `git status package.json pnpm-lock.yaml` clean and `ls node_modules/@capacitor/` unchanged.)
- `npm view @capacitor/share version` → `8.0.1`; `dist-tags` show a maintained `latest-3`…`latest-8` ladder (not a fresh squat).
- `npm view @capacitor/share@latest peerDependencies` → `{"@capacitor/core": ">=8.0.0"}`.
- Ecosystem correct (npm, a JS/TS project).
- Discovered from **capacitorjs.com official docs**, not from a search result — so `[VERIFIED: npm registry]` is warranted rather than `[ASSUMED]`.
- No `postinstall` script inspected as risky; the plugin follows the standard Capacitor layout that `npx cap sync` consumes.

---

## Validation Architecture

### Test framework

| Property | Value |
|---|---|
| Framework | Vitest `^4.1.3`, **one** project: `{name:'server', environment:'node'}` — no jsdom |
| Config file | `vite.config.ts` (`test.projects[0]`), `expect.requireAssertions: true` |
| Quick run | `npx vitest run src/lib/backup/ src/lib/services/backup-io` |
| Full suite | `pnpm test` (`vitest --run`, ~1320 tests across ~67 files) |
| Typecheck gate | `pnpm check` (`svelte-kit sync && svelte-check`) — the project's only linter |

### Phase behaviours → test map

(No `REQ-` IDs are assigned in ROADMAP.md; mapped to the decision refs, which are the phase's actual requirements.)

| Ref | Behaviour | Type | Automated command | File exists? |
|---|---|---|---|---|
| D-01 | Envelope carries exactly the 5 key families; `name-tr` prefix family fully collected | unit | `npx vitest run src/lib/backup/backup-logic.test.ts -t "envelope"` | ❌ Wave 0 |
| D-02 | `openmusic:player:v1` never appears in an envelope; nor does `openmusic:diag:v1` | unit | `… -t "never exports"` | ❌ Wave 0 |
| D-03 | Envelope has `app` + `format` + per-key names; `JSON.stringify(env, null, 2)` round-trips | unit | `… -t "envelope shape"` | ❌ Wave 0 |
| D-04 | Filename is `openmusic-backup-YYYY-MM-DD.json` | unit | `… -t "filename"` | ❌ Wave 0 |
| D-08/D-10 | Round-trip: write keys → `vi.resetModules()` → re-import stores → `load()` → identical state | integration (node) | `npx vitest run src/lib/backup/backup-roundtrip.svelte.test.ts` | ❌ Wave 0 |
| D-10 | A rejected envelope writes **nothing** (memStore unchanged, byte-for-byte) | unit | `… -t "atomic"` | ❌ Wave 0 |
| D-11 | `not-ours` / `newer` / `damaged` each returned for the right input, **in the right precedence order** | unit | `… -t "reject reason"` | ❌ Wave 0 |
| D-12 | Unknown key in a known domain → `skipped`, rest imported; unknown domain → skipped silently | unit | `… -t "migration"` | ❌ Wave 0 |
| Pitfall 7 | `{"liked": 5}` is rejected as `damaged`, not written | unit | `… -t "array guard"` | ❌ Wave 0 |
| D-09 | Snapshot taken before write; undo restores the pre-import state | unit (sessionStorage stub) | `… -t "undo"` | ❌ Wave 0 |
| D-06/D-07 | Sweep skips uids where `has()` is true; sequential (no overlap); stop flag honoured | unit (mock `blobStore`/`downloadTrack`) | `npx vitest run src/lib/backup/sweep.test.ts` | ❌ Wave 0 |
| D-11 i18n | All 15 dictionaries expose the new keys | unit | `npx vitest run src/lib/i18n/i18n.test.ts` | ✅ exists (`i18n.test.ts:52`) |
| D-14 | Web export calls `saveBlobToDisk` with the right filename/type | unit (fake `doc`) | `npx vitest run src/lib/services/backup-io` | ❌ Wave 0 |
| **D-15** | **File input opens the Android document picker; `.json` is selectable** | **manual — device only** | `checkpoint:human-verify` (recipe in Answer 6) | n/a |
| **D-16/D-17** | **Share sheet opens on the APK; shared file is readable JSON; dismiss is not an error** | **manual — device only** | `checkpoint:human-verify` (recipe in Answer 6) | n/a |
| D-14 (iOS) | Export downloads on a real iPhone | manual — device only | `checkpoint:human-verify` | n/a |

### Sampling rate

- **Per task commit:** `npx vitest run src/lib/backup/` + `pnpm check`
- **Per wave merge:** `pnpm test`
- **Phase gate:** `pnpm test` green + `pnpm check` clean + the three device checkpoints signed off before `/gsd:verify-work`

### Wave 0 gaps

- [ ] `src/lib/backup/backup-logic.ts` + `backup-logic.test.ts` — D-01…D-04, D-10…D-12, Pitfall 7
- [ ] `src/lib/backup/backup-roundtrip.svelte.test.ts` — D-08/D-13 round-trip (needs the `browser:true` + memStore harness, so a **separate file** per `settings-persist.svelte.test.ts:4-8`)
- [ ] `src/lib/backup/sweep.test.ts` — D-06/D-07 sequencing + stop flag
- [ ] `src/lib/services/backup-io.test.ts` — D-14 web branch with an injected fake `doc`
- [ ] No framework install needed — Vitest, the node project, and the localStorage stub idiom all exist.
- [ ] A `sessionStorage` stub — copy the localStorage stub verbatim (the `Storage` interface is identical); **new**, since `grep -rn "sessionStorage" src/` returns nothing today.

---

## Security Domain

### Applicable ASVS categories

| Category | Applies | Standard control |
|---|---|---|
| V2 Authentication | no | No accounts; feature is device-local |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | No multi-user model |
| **V5 Input Validation** | **yes** | **`validateEnvelope` is the control.** An imported file is fully untrusted input — the same posture `settings.load()` takes toward localStorage (T-vzu-01: "localStorage is tamperable, so only an explicit boolean wins"). A backup file is *more* hostile: it can arrive from anywhere. Validate structurally before any write (D-10) and type-guard `library`'s three arrays, which `load()` does not (Pitfall 7). |
| V6 Cryptography | no | No encryption in scope; D-03 mandates a human-readable file |
| V8 Data Protection | **yes** | Export must not carry secrets. **`openmusic:diag:v1` is a device-local upload token** and is excluded by D-01 — pin it with a test. `openmusic-blob-uri:*` holds device-local content URIs; excluded. Server secrets never reach the client (`CLAUDE.md`, `proxy-types.ts` `Env`). |
| V12 Files & Resources | **yes** | Native write is confined to `Directory.Cache`, shared through the app-scoped FileProvider (`android:exported="false"`, `grantUriPermissions="true"`). No new permission. No path is taken from the file's contents — the filename is app-generated (D-04). |

### Known threat patterns

| Pattern | STRIDE | Mitigation |
|---|---|---|
| Malicious/crafted backup corrupts app state | Tampering | D-10 validate-entire-envelope-before-write; `validateEnvelope` array/object guards; D-09 snapshot + undo |
| Type-confusion via `library.liked` (Pitfall 7) | Tampering / DoS | `Array.isArray` in the validator — `library.load()` does not guard this |
| Backup leaks the diag upload token | Information disclosure | `openmusic:diag:v1` excluded by D-01; assert `BACKUP_KEYS` excludes it |
| Quota exhaustion from an oversized import | DoS | Wrap writes in `try/catch`; the sessionStorage snapshot is the recovery path; a mid-write quota failure returns `false` rather than silently half-writing |
| Unbounded re-download job saturates the network | DoS (self-inflicted) | D-06 never auto-starts; sequential + stop flag (Pitfall 3) |
| Path traversal via a filename in the file | Tampering | Filename is generated (D-04), never read from the envelope |
| Over-broad FileProvider exposure | Information disclosure | Existing provider is `exported="false"` and scoped to `<cache-path>` / `<external-path>`; **do not widen `file_paths.xml`** |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | iOS Safari blocks a programmatic `<a download>` click issued after an `await` in the gesture handler | Answer 7 | Low — the recommended fix (keep `buildEnvelope` synchronous) costs nothing and is correct regardless |
| A2 | iOS Safari may ignore the `download` filename / preview JSON instead of downloading | Answer 7 | Low — cosmetic; D-14 already rejects a second iOS path. Confirm during the iOS checkpoint |
| A3 | `MimeTypeMap.getMimeTypeFromExtension("json")` may return `null` on some Android versions | Answers 5, 6 | **The import path risk is fully neutralized** by `accept="application/json,.json"` (the crash mechanism is read from the installed source, so the *mitigation* is verified even though the MIME question is not). For **share**, a null MIME degrades the chooser only. Verify on the emulator |
| A4 | `sessionStorage` survives `location.reload()` in the Capacitor Android WebView and iOS Safari PWA | Answer 8 | Medium — if it does not, Undo silently disappears after the reload. **Verify with a 5-line probe before building on it**; fallback is localStorage + a size pre-check |
| A5 | `@capacitor/filesystem`'s `Directory.Cache` maps to `Context.getCacheDir()`, the same root `<cache-path>` covers | Answer 5 | Medium — if wrong, `Share.share` throws a FileProvider "Failed to find configured root". Caught by the D-16 device checkpoint; fix is one `<files-path>` line |
| A6 | `N` parallel `blobStore.has` calls are cheap enough to run at once for N≈200 on native | Answer 4 | Low — worst case the Data page's missing-count is slow to appear; chunk if observed |

---

## Open Questions

1. **Does `sessionStorage` survive `location.reload()` in the Capacitor WebView?** (A4)
   - Known: it does in every standards-compliant browser; the Capacitor WebView is a standard Android WebView with DOM storage enabled (localStorage already works).
   - Unclear: not verified on this specific stack; no existing `sessionStorage` usage in the repo to lean on.
   - Recommendation: a 5-line probe in the D-15 emulator session — `sessionStorage.setItem('x','1'); location.reload()` then read it back. Do this *before* the undo task is built. Fallback: localStorage + a size pre-check (Answer 8).

2. **Is a whole-page reload (D-13) acceptable UX in the installed APK?** A web reload is instant; an APK reload re-runs the SPA boot including the splash screen.
   - Known: D-13 is locked and its reasoning (one code path, no half-hydrated singletons) is sound.
   - Unclear: whether the native splash flash is jarring enough to warrant a toast beforehand.
   - Recommendation: flash a "Backup restored — reloading…" message and `setTimeout(reload, ~600ms)`. Observe during the D-15 checkpoint; do not redesign.

3. **Should `library:v1` entries be whitelist-stripped on export?** It is ~84 % of the payload and stores full `Track`s with resolved extras, unlike `player-persist` and `history-logic` which both strip to 11 fields.
   - Known: stripping would more than halve the file.
   - Unclear: which extras are load-bearing downstream (`songMid`, `qqSearchKey`, `duration`, `tags` at minimum).
   - Recommendation: **export verbatim this phase.** 1.1 MB is a non-problem (Answer 8) and a lossy export contradicts "round-trip is lossless". Log as a future idea.

4. **`openmusic:library:tab` — genuinely skip?** D-01 says skip. It is a one-string UI preference (`library/+page.svelte:47`) and arguably belongs with settings.
   - Recommendation: **respect D-01, skip it.** Not worth re-litigating a locked decision for a 20-byte string.

---

## Sources

### Primary (HIGH confidence)

- **This codebase** (every file:line citation above), notably: `src/lib/stores/{library,settings,names,history,searchHistory}.svelte.ts`, `src/lib/stores/player-persist.ts`, `src/lib/{history/history-logic,search/search-history-logic,diagnostics/action-log-logic}.ts`, `src/lib/services/{blob-store,download-track,download-save,downloads-queue,api-base,share}.ts`, `src/lib/sources/types.ts`, `src/routes/(app)/settings/data/+page.svelte`, `src/routes/(app)/album/[name]/+page.svelte`, `src/lib/components/{TrackMenu,DownloadControl}.svelte`, `src/lib/i18n/i18n.test.ts`, `vite.config.ts`, `package.json`, `capacitor.config.ts`, `android/app/src/main/{AndroidManifest.xml,res/xml/file_paths.xml}`, `.planning/config.json`
- **`node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java`** (Capacitor 8.4.0, the exact installed version) — `onShowFileChooser:276`, `showFilePicker:371-405`, `getValidTypes:407-423`, `onJsAlert:135`, `onJsConfirm:168`, `onJsPrompt:207`
- `npm view @capacitor/share` (`version`, `dist-tags`, `peerDependencies`) — 8.0.1 / `>=8.0.0`
- `slopcheck install @capacitor/share` — `[OK]`
- https://capacitorjs.com/docs/apis/share — `ShareOptions`, `files: string[]` of `file://` URLs, `canShare()`, Android cache-folder note
- https://capacitorjs.com/docs/apis/filesystem — `Directory` enum, `getUri()`, `writeFile` + `Encoding.UTF8`
- https://raw.githubusercontent.com/ionic-team/capacitor-plugins/main/share/android/src/main/java/com/capacitorjs/plugins/share/SharePlugin.java — `getPackageName() + ".fileprovider"`, `"only file urls are supported"`, `MimeTypeMap` derivation
- Local measurement script (`node`, actual `Track`/`LibShape`/`HistoryEntry` shapes) — the Answer 8 size table

### Secondary (MEDIUM confidence)

- https://github.com/ionic-team/capacitor/blob/main/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java — corroborates the locally-installed source
- https://developer.android.com/reference/android/webkit/MimeTypeMap — `getMimeTypeFromExtension` returns `null` for unregistered extensions

### Tertiary (LOW confidence — flagged in the Assumptions Log)

- iOS Safari `<a download>` / `createObjectURL` gesture + filename behaviour (A1, A2) — training knowledge, no authoritative source consulted this session
- Whether `"json"` is present in AOSP's MIME table at any given API level (A3) — https://www.codestudy.net/blog/how-to-determine-mime-type-of-file-in-android/ and the Android reference confirm the `null` failure mode exists but do not settle `json` specifically

---

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|---|---|---|
| Key inventory & payload shapes | **HIGH** | Read every owning store's `load()`/`save()` line by line; cross-checked two independent greps |
| Version / migration story | **HIGH** | Verified no in-payload version exists on any exported key; tolerance measured per key |
| Validator shape | **HIGH** | Three in-repo precedents with identical structure |
| Blob probe & re-download sweep | **HIGH** | `blobStore.has` and `downloadTrack({save:false})` both read in full; the album loop is the pacing precedent; the raw-fetch/ungoverned finding is from an explicit source comment |
| `@capacitor/share` version & API | **HIGH** | npm registry + official docs + plugin source; the FileProvider prerequisite verified present in this repo |
| `<input type="file">` in the WebView | **HIGH** for "it works" (installed Capacitor 8.4.0 source), **MEDIUM** for the `.json` MIME specifics — but the recommended `accept` value sidesteps the uncertain part entirely |
| Payload size | **HIGH** | Measured, not estimated, against the real persisted shapes |
| Test infrastructure | **HIGH** | Harness read from two existing test files; prefix-enumeration already exercised by `translate.test.ts` |
| iOS Safari download specifics | **LOW–MEDIUM** | Training knowledge only; flagged A1/A2, mitigations are free |
| `sessionStorage` in the Capacitor WebView | **MEDIUM** | Standards-compliant expectation, unverified on this stack; probe recipe supplied (A4) |

**Research date:** 2026-09-13
**Valid until:** 2026-10-13 (30 days — the codebase facts are stable; re-check `@capacitor/share` only if Capacitor 9 ships before execution)
