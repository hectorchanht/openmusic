# Phase 34: Import device songs as native downloads - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `34-CONTEXT.md` — this log preserves how they were reached.

**Date:** 2026-09-13
**Phase:** 34-import-device-songs-as-native-downloads
**Mode:** discuss (default, interactive)
**Areas discussed:** Identity of imported files, How imported files play, The app's own downloads get re-found, Scan scope + junk files

## Scout findings that shaped the questions

Two facts found before questioning, both of which changed what was worth asking:

1. **Downloads are already written twice on native** (999.1 D-10/D-11, confirmed in `blob-store.ts`): an app-private copy in `Directory.Data` (the offline read source) AND a public copy in `Music/OpenMusic/` via the Kotlin MediaStore bridge. A device scan therefore finds the app's own downloads on the first run — making "what about our own files?" a mandatory decision, not a hypothetical.
2. **Offline playback is gated at 5 call sites** in `player.svelte.ts` (`isDownloaded(uid)` → `blobStore.get(uid)`). An imported file has no app-private copy, so without intervention it falls through to the CN resolver and fails for anything not in the catalog.

## Questions and answers

### Area: Identity of imported files

| Question | Options presented | Selected |
|---|---|---|
| How should an imported device file get its `Track.uid`? | `device:` pseudo-source (rec) / tag-match to a catalog uid / `device:` now, match later | **`device:` pseudo-source** |
| File moved or renamed, then re-imported — what happens? | MediaStore `_ID` (rec) / file path hash / audio content hash / you decide | **MediaStore `_ID`** |

### Area: How imported files play

| Question | Options presented | Selected |
|---|---|---|
| An imported file has no app-private copy — how does it play? | Play in place (rec) / copy into app-private storage / play in place, copy on demand | **Play in place** |
| File deleted or unplugged outside the app — what does the user see? | Mark unavailable, keep entry (rec) / silently drop / leave it and let playback fail | **Mark unavailable, keep entry** |

### Area: The app's own downloads get re-found

| Question | Options presented | Selected |
|---|---|---|
| What should import do with `Music/OpenMusic/` files? | Skip the folder (rec) / import then merge onto existing uid / import as separate entries | **Import, then merge onto existing uid** |
| Second import a week later — what happens to already-imported songs? | Idempotent, add new only (rec) / full re-sync, drop vanished / you decide | **Full re-sync, drop vanished** |

**Conflict surfaced and resolved.** "Mark unavailable, keep the entry" (playback) and "full re-sync, drop vanished" (re-import) prescribe opposite handling for the same situation — a song whose file is gone. Raised explicitly rather than silently picking one.

| Question | Options presented | Selected |
|---|---|---|
| Missing file: keep-and-mark vs drop — which wins? | Unavailable now, dropped at next import (rec) / always keep / always drop immediately | **Unavailable now, dropped at next import** |
| Merge conflict — stored Track vs file on disk, which side wins? | App entry wins, file only restores playability (rec) / file tags win / you decide | **You decide** (→ D-10, Claude's discretion) |

### Area: Scan scope + junk files

| Question | Options presented | Selected |
|---|---|---|
| Which folders should the scan cover? | Music + Download (rec) / everything MediaStore indexes / user picks folders | **Music + Download** |
| Untagged file (`track01.mp3`, 9-second clip) — import it? | Filename as title + skip tiny files (rec) / import everything / skip untagged | **Free-text — see below** |

**Free-text answer (scope expansion, accepted):**

> "let user define skip rules and file name regex, default grep filename by {artist name} - {song name}, allow user change regex with simple rules in checkbox, create range filter on how short of audio will be skipped, and what file extensions will be counted or skipped in checkbox"

This turns "a button" into "a button plus an import-rules panel". Treated as in-scope — it clarifies HOW the scoped import behaves rather than adding a new capability — but it is a material UI expansion and is recorded as such (D-12).

Two follow-ups to pin the UI shape:

| Question | Options presented | Selected |
|---|---|---|
| How much regex should the user actually touch? | Checkbox presets + raw-regex escape hatch (rec) / presets only / raw regex only | **Presets + raw-regex escape hatch** |
| Does import work before the user configures anything? | Yes, ship working defaults (rec) / no, require rules first | **Yes, working defaults** |

## Claude's Discretion items

- Merge conflict resolution between a stored Track and a found file (D-10).
- Minimum-duration default value; default extension set.
- Runtime permission flow shape (`READ_MEDIA_AUDIO`), following the existing `publicMusicPermsCallback` pattern.
- Whether `device:` entries carry cover art in this phase.
- Scan progress/reporting UI.

## Deferred

- Linking `device:` entries to catalog uids via tag-matching — its own phase (D-03).
- User-selected scan folders / folder picker.
- Copy-on-demand pinning of an imported file into app-private storage.

## Todos reviewed, not folded

`todo.match-phase 34` returned 4 matches, all keyword false positives (`artist`, `title`, `page`): artist-page hyphenated lookup key; `/api/og` artist `picture_xl` oversize; song-share stale cover comment. None relate to device import.
