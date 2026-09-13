# Phase 34: Import device songs as native downloads - Context

**Gathered:** 2026-09-13
**Status:** Ready for planning

<domain>
## Phase Boundary

A user-triggered import that turns audio files already on the device into entries the app treats as downloaded songs — playable, listed, and indexed like any app-downloaded track. Entry point is a button in the Settings download page, plus the import rules that govern what gets picked up.

Fixed scope anchor from ROADMAP.md. Writing tags INTO files is Phase 36. Backup/restore of app state is Phase 35.

</domain>

<decisions>
## Implementation Decisions

### Identity

- **D-01:** Imported files get a `device:` pseudo-source uid — `device:<stable-key>` via the existing `makeUid()` contract. The client source registry (`src/lib/sources/registry.ts`) is NOT extended; `device:` is an identity namespace, not a searchable/resolvable source. Rationale: it can never collide with a real source id, and an imported file genuinely IS a different thing from a streamed track.
- **D-02:** The stable key is the Android **MediaStore `_ID`**, so a file the user moves or renames stays ONE library entry across re-imports. Accepted cost: `_ID` is not stable across a factory reset or SD-card reinsert — those re-import as new entries.
- **D-03:** No tag-matching to catalog uids in this phase. An imported song and the same song streamed from a source remain two separate library entries. Linking them is explicitly deferred (see `<deferred>`), and is the reason D-01 chose the honest-namespace option over adopting a catalog uid.

### Playback

- **D-04:** Imported files play **in place** — no copy is made into app-private storage. Importing a large library costs zero extra disk and is near-instant.
- **D-05:** The in-place read is implemented INSIDE the native branch of `blobStore.get()` (`src/lib/services/blob-store.ts`), which returns the device file's bytes/URL for a `device:` uid. This is deliberate: `player.svelte.ts` gates offline playback on `library.isDownloaded(uid)` → `blobStore.get(uid)` at **5 call sites** (lines ~581, ~666, ~3122, ~3335, plus the prebuffer guard at ~2864). Fixing the shared function covers all of them; patching call sites does not, and would leave the next one written broken.
- **D-06:** A missing file (deleted, SD card pulled) marks the entry **unavailable but keeps it listed** — the user sees why it won't play and can re-import. It must NOT silently vanish. This is a deliberate departure from the existing broken-blob path at `player.svelte.ts:~2100`, which does `blobStore.del()` + `library.removeDownload()`; that self-healing behaviour is correct for an evictable downloaded blob and wrong for a user's own file.

### Re-import and the app's own downloads

- **D-07:** Import is a **full re-sync against the device**: new files are added, and entries whose files are confirmed gone are dropped.
- **D-08:** D-06 and D-07 are reconciled as: **unavailable between imports, dropped at the next import.** Removal only ever happens inside an explicit user-initiated import — never silently in the background. A transient read failure must not be treated as "confirmed gone".
- **D-09:** `Music/OpenMusic/` (files the app itself wrote, per 999.1 D-11) is scanned, and a found file is **merged onto the existing library entry's real source uid** rather than added as a second `device:` entry. Purpose of the merge is to restore playability for a public file whose app-private copy was evicted. The first import must NOT make every existing download appear twice.
- **D-10:** Merge conflict rule (stored Track vs file on disk) is **Claude's discretion** — settle it against the actual `Track` shape during planning. Strong prior from the discussion: the app's stored entry is enriched (real cover, proper album) and the file's tags usually are not, so metadata churn from a merge is a downgrade risk.

### Scan scope and import rules

- **D-11:** Scan covers **Music + Download** only. Not every directory MediaStore indexes — that sweeps in ringtones, notification sounds, voice memos, messaging-app audio and podcast caches.
- **D-12:** Import is governed by a **user-editable rules panel** in the Settings download page, alongside the import button:
  - **Filename parsing** — checkbox presets for common layouts (`{artist} - {title}`, `{title} - {artist}`, `{track}. {title}`, strip leading track numbers, strip bracketed tags like `[Official MV]`), PLUS one advanced raw-regex field with named groups as an escape hatch.
  - **Minimum duration** — a range filter so short clips (ringtones, notification blips) are skipped without judging content.
  - **File extensions** — checkboxes for which audio extensions count.
  - **Skip rules** — user-defined exclusions.
- **D-13:** `{artist} - {title}` is the **default** parsing preset.
- **D-14:** The import button **works with zero configuration.** Defaults ship working (D-13 parsing, a sane minimum duration, common audio extensions on). The rules panel exists to adjust behaviour, never as a prerequisite — the user's ask was a button, not a setup form.
- **D-15:** **Embedded tags win over filename parsing.** Filename parsing is the fallback for files whose tags are missing or empty, not an override.
- **D-16:** An untagged file is **imported with its parsed filename as the title**, not skipped. A song the user can plainly see on their phone silently not importing reads as the feature being broken.

### Claude's Discretion

- Merge conflict resolution between a stored Track and a found file (D-10).
- Exact minimum-duration default value.
- Which audio extensions are on by default.
- Runtime permission flow shape (`READ_MEDIA_AUDIO` on modern Android) — follow the existing `publicMusicPermsCallback` pattern in the Kotlin plugin.
- Whether `device:` entries carry cover art in this phase, and where it comes from (embedded art vs the existing cover chain).
- Progress/reporting UI during a scan.

</decisions>

<specifics>
## Specific Ideas

- The user's framing throughout: **"a button in the settings download page that lets user import songs"** — one tap, works immediately, rules available for those who want them.
- The rules panel is checkbox-first by design. The raw-regex field is the escape hatch for unusual naming schemes, not the primary interface.
- Truthfulness over tidiness on missing files (D-06) — consistent with `quick-260913-jq4`, which fixed the download button claiming success when no copy existed on disk.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase
- `.planning/phases/34-import-device-songs-as-native-downloads/34-NOTES.md` — seed notes: entry points, known constraints, permission pattern.

### Prior locked decisions this phase inherits
- `.planning/phases/999.1-v2-0-native-capacitor-migration/999.1-CONTEXT.md` §decisions — **D-10** (blob-store is platform-switched: IndexedDB on web, `@capacitor/filesystem` + `capacitor-blob-writer` on native) and **D-11** (downloads go to the public Music folder; a hand-written Kotlin MediaStore bridge is accepted; app-private-only fallback explicitly rejected). D-04/D-05/D-09 of this phase build directly on these.

### Code that defines the contracts
- `src/lib/services/blob-store.ts` — the native/web storage split, the never-throws contract, `MIN_BLOB_BYTES` gate, and the dual-write (app-private `Directory.Data` + public `Music/OpenMusic/`) that D-09 has to account for.
- `src/lib/stores/library.svelte.ts` — `downloads: Track[]` persisted to `openmusic:library:v1`; `isDownloaded(uid)` is uid membership (`:176`).
- `src/lib/sources/types.ts` — `Track` / `makeUid()` identity contract; `displayIndex` is ORDERING ONLY, never identity.
- `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt` — currently write-only (`saveToMusic`, `deleteFromMusic`); `publicMusicPermsCallback` is the existing runtime-permission pattern.
- `src/routes/(app)/settings/` — no `download/` subroute exists yet; confirm where Phase 29's download UI landed before adding the button and rules panel.

### Project conventions
- `CLAUDE.md` — runes conventions, `*.svelte.ts` vs `.ts` split, browser/native guarding, never-throw service posture, i18n double-quote rule.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `blobStore` (`services/blob-store.ts`) — already platform-switched and already never-throws. D-05 extends its native branch rather than introducing a parallel storage concept.
- `MediaStoreSaver` (`services/media-store.ts`) — the existing TS↔Kotlin bridge. The new scan/query `@PluginMethod` belongs here, not in a second bridge.
- `library.addDownload` / `removeDownload` / `isDownloaded` — the whole "is this downloaded" surface already exists; import feeds it, nothing new is needed for downloaded-state rendering.
- `download-filename.ts` — already derives human filenames from track fields. Its normalization decisions (CJK, punctuation, missing album) are the inverse of D-12's filename PARSING and should be read before re-litigating any of them.

### Established Patterns
- **Pure logic in `.ts`, runes in `.svelte.ts`** — filename parsing, rule matching, and the scan→Track mapping are pure and node-testable; keep them out of the store (precedent: `player-persist.ts`, `attached-cover.ts`, `media-session.ts`).
- **Never-throw services returning a sentinel** — a failed scan returns an empty result, never an exception into the render tree.
- **`browser` + `isNativePlatform()` guarding** — the web build must no-op cleanly; the import button should not appear as a broken control on web.
- **Generation guards** on async paths that a newer user action can supersede (a second import tap must not interleave with the first).

### Integration Points
- New query `@PluginMethod` in `MediaStoreSaverPlugin.kt` → `services/media-store.ts` → a new import service → `library.downloads`.
- `blobStore.get()` native branch — the single seam that makes `device:` uids playable across all 5 player call sites (D-05).
- Settings download page — the button and the rules panel.
- Rules persistence — follow the `openmusic:<domain>:v<N>` localStorage convention.

</code_context>

<deferred>
## Deferred Ideas

- **Linking a `device:` entry to a catalog uid** (tag-matching so an imported song and its streamed twin become one entry) — deliberately out of scope per D-03. Needs the fuzzy-matching work that `scoreMatch` has a CJK history with; belongs in its own phase.
- **User-selected scan folders / folder picker** — rejected for this phase in favour of Music + Download (D-11). Revisit if SD-card or unusual-layout reports come in.
- **Copy-on-demand pinning** of an imported file into app-private storage — considered and set aside; adds a second storage concept to explain.
- **Reviewed todos (not folded):** `todo.match-phase 34` returned 4 matches (artist-page hyphenated lookup key, `/api/og` artist `picture_xl` oversize, song-share stale cover comment). All matched on generic keywords (`artist`, `title`, `page`) and are unrelated to device import. Not folded.

</deferred>

---

*Phase: 34-import-device-songs-as-native-downloads*
*Context gathered: 2026-09-13*
