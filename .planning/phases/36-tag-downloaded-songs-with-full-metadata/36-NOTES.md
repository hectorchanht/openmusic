# Phase 36 — seed notes

Captured at `/gsd:add-phase` time; scope widened by the user from "cover art" to the FULL tag set.

## Shape

At download time, write the complete metadata tag set INTO the audio file before it lands on disk, so the device music player, the file browser, and Phase 34's import scan all read a properly titled and grouped library. Distinct from the in-app cover/name chain, which never touches file bytes.

## The tag set

| Field | App-side source |
|---|---|
| title | `Track.name` |
| artist | `Track.artist` |
| album | `Track.album` (may be absent on search stubs) |
| album artist | album page context, else artist — decides player GROUPING; getting this wrong scatters an album into one-song entries |
| track number / disc | album page ordering. NOTE: `displayIndex` is ORDERING ONLY, never identity (`sources/types.ts`) — do not persist it as a track number without confirming it reflects real album position |
| year / genre | not obviously carried on `Track` today — plan must decide: enrich (Deezer/Last.fm already in the cover chain) or omit |
| duration | from the decoded audio, not from a tag guess |
| cover art | `services/media-artwork.ts` (below) |

**Omit, never placeholder.** A field the app does not actually know must be left out of the tag, not filled with "Unknown Artist" — that pollutes the device library permanently and is exactly the kind of untruthful-UI bug quick-260913-jq4 just fixed on the download button.

## Known entry points

- `src/lib/services/download-save.ts` → `saveBlobToDisk(...)` — the seam where the finished audio Blob goes to disk. Tag injection happens on the Blob before this call.
- `src/lib/services/download-track.ts` → `downloadTrack(...)`, `DownloadResult = 'saved' | 'no-audio' | 'failed'` — where the `Track` (the metadata source) is still in hand.
- `src/lib/services/download-filename.ts` — already derives a human filename from track fields; the same normalization questions (CJK, punctuation, missing album) recur for tags. Reuse its decisions, don't re-litigate them.
- `src/lib/services/media-artwork.ts` — ALREADY resolves artwork to bytes: `resolveArtworkDataUrl()`, `bytesToBase64()`, `MAX_ART_BYTES = 1_000_000`, `ART_FETCH_TIMEOUT_MS = 6_000`. Built for the media-session artwork crash fix; reuse it, do not write a second fetch path.
- `src/lib/stores/attached-cover.ts` — the in-app album-scoped cover OVERRIDE (`seedCover` / `buildAttachment`). It decides which cover a track *displays*, and is the right source for which image to embed — but it is NOT a file-tagging module.
- `android/.../MediaStoreSaverPlugin.kt` → `performSave` / `mimeForFileName` — the native write side. MediaStore keeps its OWN metadata columns (title/artist/album) separate from in-file tags; the plan must decide whether to populate both, since a player may read either.

## Constraints

- **Container-specific.** ID3v2 for MP3, MP4 atoms (`©nam`/`©ART`/`aART`/`trkn`/`covr`) for m4a/AAC, Vorbis comments + PICTURE block for FLAC. The catalog serves m4a AND FLAC (Phase 32 is QQ-lossless-first), so an MP3-only tagger does not cover the real download mix.
- **No third-party runtime deps on the web app** is the house rule (`CLAUDE.md`: zero third-party runtime npm deps). Either hand-write the minimal tag writers, or justify a dependency explicitly. This is a decision for the plan, not an implementation detail — and a full tag writer across three containers is materially more code than an art-only one.
- **Never corrupt the file.** A failed art fetch, an oversized image, an unknown container, or a malformed existing tag must fall through to saving the original bytes untouched. A silently corrupt download is worse than an untagged one.
- **Shares a tag codec with Phase 34** — 34 READS the tags this phase WRITES. Whichever is planned first owns the module; the second imports it. Read and write of the same three containers is one cohesive unit of work.
