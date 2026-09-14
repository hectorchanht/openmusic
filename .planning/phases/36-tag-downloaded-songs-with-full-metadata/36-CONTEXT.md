# Phase 36: Tag downloaded songs with full metadata - Context

**Gathered:** 2026-09-13
**Status:** Ready for planning

<domain>
## Phase Boundary

At download time, write the complete metadata tag set INTO the audio file bytes before they land on
disk — container-aware (ID3v2 for MP3, MP4 atoms for m4a/AAC, Vorbis comments + PICTURE for FLAC) —
so the device music player, the file browser, and Phase 34's import scan all read a properly titled
and correctly-grouped library. A field the app does not actually know is OMITTED, never placeholdered.
A file is NEVER corrupted.

Fixed scope anchor from ROADMAP.md. This phase touches FILE BYTES. The in-app cover/name display
chain is a separate concern and is not changed here. Backup/restore of app state is Phase 35;
importing device files is Phase 34.

</domain>

<decisions>
## Implementation Decisions

### Tag codec and containers

- **D-01:** A **third-party tag dependency IS allowed** for this phase — a deliberate, explicit
  exception to `CLAUDE.md`'s "the web app has NO third-party runtime npm deps" rule, taken with the
  rule on the table. Rationale: the phase grew from cover-art-only to the FULL tag set across three
  containers, and hand-writing write-side codecs for all three is materially more code than the
  original shape justified. The exception covers **tagging only** — it is not a general relaxation.
- **D-02:** **All three containers** get write support in this phase: ID3v2 (`mp3`), MP4 atoms
  (`©nam`/`©ART`/`aART`/`trkn`/`covr` for `m4a`/`aac`), Vorbis comments + PICTURE block (`flac`).
  Post-Phase-32 the real download mix is m4a + FLAC, but `extFromAudioUrl` defaults an UNRECOGNIZED
  url to `'mp3'` and the kuwo/netease/joox fallback ladder still serves mp3 — so mp3 is not theoretical.
- **D-03:** **Phase 36 OWNS the tag module, READ and WRITE together.** Phase 34 imports it rather than
  writing a second parser. Two reasons: the notes call read+write of the same three containers one
  cohesive unit of work, and the parser is what makes the writer *provable* — round-trip tests
  (write tags → parse them back) verify byte layout in the node Vitest project with no device needed.
- **D-04:** The **specific dependency is the researcher's call, decided on evidence**, not on
  recollection. It MUST satisfy: (a) **write** support, not read-only — most popular tag libs
  (`music-metadata`, `jsmediatags`) are read-only and do NOT qualify; (b) all three containers, or a
  documented hand-written gap for whichever it misses; (c) runs in the **browser AND the Capacitor
  WebView AND the node Vitest project** (per D-05); (d) bundle/wasm cost reported in real numbers, since
  this is a mobile-first PWA. A wasm TagLib build and a set of per-container JS libs are both plausible
  shapes — the researcher picks between them with measurements.
- **D-05:** **One code path, web and native.** Tagging lives at the `download-track.ts` seam that both
  the web PWA and the Capacitor APK execute. Explicitly rejected: a native-APK-only tagger, and a
  Kotlin-side implementation — either would give one button two behaviours and force Phase 34's
  reader into a second language.
- **D-06:** **Tag failure saves the ORIGINAL bytes untouched, and `DownloadResult` stays `'saved'`.**
  An unknown container, a malformed input, an oversized or unfetchable cover, or a thrown library
  error all fall through to the untagged-but-intact file. Returning `'failed'` for a file that
  actually landed on disk and plays would be untruthful in the other direction — the same class of
  bug `quick-260913-jq4` just fixed on the download button.

### Tag field set

- **D-07:** **`year` and `genre` are OMITTED.** Neither exists on `Track`, and enriching them means
  adding Deezer/Last.fm calls to a path the project has repeatedly cut calls from (Phase 26: 59→3 per
  play; the `api-fetch-flood` freeze). No enrichment fetch is added to the download path.
- **D-08:** **No provenance tag** — no comment, encoder, or app-branding field. The user's file stays
  clean. (Phase 34's D-09 already identifies app-written files by their `Music/OpenMusic/` location,
  so nothing depends on a stamp.)
- **D-09:** **Duration tag: Claude's discretion.** Strong prior from discussion — MP4, FLAC STREAMINFO
  and MP3 headers already encode true duration in the audio stream, every player reads it there, and
  `Track.duration` is QQ-only and can disagree with the actually-downloaded tier. Leaning: write no
  duration tag. Settle against the chosen library's API.
- **D-10:** **`album` is omitted when `Track.album` is empty** (common on search stubs). No extra
  lookup is added to fill it — if `downloadTrack`'s existing fresh `ensureTrackDetails` returned an
  album it is already on `r` and gets written; if not, the field is left out and the device player
  applies its own "Unknown album" convention.
- **D-11:** **Track number comes ONLY from the album-page download loop**, threaded in as an explicit
  parameter. A song downloaded from search, now-playing, or the background repair path gets NO track
  number. `displayIndex` MUST NOT be used — it is 1-based ordering across an INTERLEAVED multi-source
  search list (`sources/types.ts`: "ORDERING ONLY, NEVER used for identity"), so writing it would
  stamp "track 7" permanently onto a song that is track 1.
- **D-12:** **`albumArtist` = the album page's artist when downloading from an album; otherwise the
  track's own `artist`.** This is the GROUPING field — using per-track artist on an album with guest
  features is what scatters one album into one-song entries. The album-page value keeps compilations
  and featured-guest tracks under a single album; the `Track.artist` fallback groups correctly for the
  common single-artist case.
- **D-13:** **Embedded cover art is whatever the app currently DISPLAYS**, resolved through the
  existing `resolveArtworkDataUrl()` in `services/media-artwork.ts`. Do NOT write a second image fetch
  path — that module already handles the CORS tiers (Deezer/iTunes direct, `/api/og` for CN covers),
  the `MAX_ART_BYTES = 1_000_000` cap, the content-type check and the `ART_FETCH_TIMEOUT_MS = 6_000`
  deadline. Because it resolves the displayed cover, a user's `attached-cover` override is honoured
  and the file agrees with the app.
- **D-14:** **Wait for cover art, bounded by the existing 6s cap.** Art is the most visible tag in a
  device music player and a wall of grey squares is much of what this phase exists to fix. A miss or a
  timeout falls through to saving with every other tag intact (D-06).

### Native side and UI

- **D-15:** **In-file tags only — the Kotlin MediaStore plugin is NOT extended with metadata columns.**
  `MediaStoreSaverPlugin.kt` keeps writing just `DISPLAY_NAME` / `MIME_TYPE` / `RELATIVE_PATH` /
  `IS_PENDING`; on API 29+ the media scanner reads the tags we just wrote and populates its own
  `TITLE`/`ARTIST`/`ALBUM` columns on the `IS_PENDING → 0` flip. One source of truth, no chance of the
  two surfaces disagreeing, and web and native produce byte-identical files.
  **Verification note:** scanner behaviour varies by OEM. If on-device testing shows the scanner NOT
  picking the tags up, adding `ContentValues` columns is the remedy — but it is a fallback, not the plan.
- **D-16:** **No new UI state for tagging.** It folds into the existing per-uid download spinner and the
  real byte-progress just added by `quick-260913-omi` (`readBlobWithProgress`). Tagging is an
  in-memory pass after the bytes are in hand; a second progress concept for a usually-instant step is
  not worth it.

### Retro-tagging existing downloads

- **D-17:** **Retro-tagging IS in scope, and is OPT-IN.** New downloads are always tagged. Files
  already on disk are rewritten ONLY when the user explicitly ticks/runs a retag action in the
  Settings download page. It never runs automatically and never runs in the background.
- **D-18:** **Retag scope is the app's OWN downloads** — the entries in `library.downloads` and the
  files the app wrote to `Music/OpenMusic/`. NOT a device-wide sweep: that requires the MediaStore
  scan capability which is Phase 34's deliverable and does not exist yet. Scoping to files the app
  already tracks means this phase has no hard dependency on 34.
- **D-19:** D-06 applies **per file** inside a retag batch: a file that cannot be tagged is left
  exactly as it was, and one failure never aborts or corrupts the rest of the batch.

### Claude's Discretion

- Whether to write a duration tag at all (D-09).
- Exact sentinel/return shape for a tagged-vs-untagged save, given `DownloadResult` stays `'saved'` (D-06).
- Progress and result reporting for a retag batch (D-17/D-19).
- Exact placement and wording of the retag control within the Settings download page.
- How the album-page position parameter is threaded into `downloadTrack` without widening its
  signature for every other caller.

</decisions>

<specifics>
## Specific Ideas

- **Omit, never placeholder** is the phase's spine. "Unknown Artist" written into a tag pollutes the
  user's device library permanently — the same untruthful-UI class that `quick-260913-jq4` fixed.
- The user accepted a dependency **knowing it breaks the house rule**, because the scope widened from
  cover-art-only to the full tag set across three containers. Downstream agents should treat D-01 as a
  settled, informed exception and not re-argue it.
- Retro-tagging as a **checkbox the user decides before tagging** — the user's own framing. Explicit
  consent before the app rewrites files already on their disk.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase
- `.planning/phases/36-tag-downloaded-songs-with-full-metadata/36-NOTES.md` — seed notes: the tag-set
  table with per-field app-side sources, entry points, container constraints, the never-corrupt rule.

### Prior locked decisions this phase inherits
- `.planning/phases/34-import-device-songs-as-native-downloads/34-CONTEXT.md` §decisions — **D-15**
  (embedded tags WIN over filename parsing: 34 reads what 36 writes), **D-09** (`Music/OpenMusic/` is
  how app-written files are recognised — the reason D-08 needs no provenance stamp), **D-16**
  (untagged files still import). D-03/D-18 of this phase depend directly on these.
- `.planning/phases/32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p/32-CONTEXT.md`
  §decisions — **D-01/D-02** (QQ lossless-first; `'auto'` = lossless on wifi) and **D-08** (qq top of
  `SOURCE_RANK`, qq metadata wins on disagreement). Together these make m4a + FLAC the real download
  mix and decide whose title/album strings get tagged.
- `.planning/phases/999.1-v2-0-native-capacitor-migration/999.1-CONTEXT.md` §decisions — **D-10**
  (blob-store platform split) and **D-11** (downloads go to the public Music folder via the
  hand-written Kotlin MediaStore bridge). D-15's scanner reasoning sits on top of D-11.

### Code that defines the contracts
- `src/lib/services/download-track.ts` — the orchestration and the tag-injection seam. The blob now
  comes from `readBlobWithProgress(resp, …)` (~:114), BEFORE `blobStore.put` (native public copy) and
  `saveBlobToDisk` (web anchor). Tagging the blob at that one point covers both save paths. Its
  D-17 NEVER-THROWS and D-18 DOWNLOAD-ISOLATION contracts are asserted by `download-track.test.ts`
  and must survive this change.
- `src/lib/services/media-artwork.ts` — `resolveArtworkDataUrl()`, `bytesToBase64()`, `MAX_ART_BYTES`,
  `ART_FETCH_TIMEOUT_MS`. D-13 reuses this; do NOT add a second image fetch path.
- `src/lib/services/download-filename.ts` — `extFromAudioUrl()` (the container signal; unknown → `'mp3'`)
  and `buildDownloadFilename()`. Its CJK/punctuation/sanitize decisions are settled — reuse, do not re-litigate.
- `src/lib/services/download-save.ts` — the web anchor seam, with a test that GREPS the function body
  to forbid re-introducing a save-picker or new-tab navigation. Do not touch that guardrail.
- `src/lib/sources/types.ts` — the `Track` contract. No `year`, no `genre`, no album-artist, no album
  position. `duration?` is optional and QQ-only. `displayIndex` is ORDERING ONLY (D-11's whole point).
- `src/routes/(app)/album/[name]/+page.svelte` (~:419 `downloadAlbum`) — the ONLY place real album
  order exists; where D-11's track number and D-12's album artist must be threaded from.
- `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt` (~:150) — the `ContentValues`
  block D-15 deliberately leaves unchanged.

### Project conventions
- `CLAUDE.md` — the zero-third-party-runtime-deps rule that **D-01 deliberately excepts**; the
  `*.svelte.ts` vs `.ts` split (the tag codec is PURE `.ts`, node-testable); never-throw service
  posture; `browser`/`isNativePlatform()` guarding; i18n double-quote rule for any new strings.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveArtworkDataUrl()` / `bytesToBase64()` (`services/media-artwork.ts`) — cover URL → bytes,
  already CORS-tiered, size-capped and timeout-bounded. D-13 consumes it directly.
- `extFromAudioUrl()` (`services/download-filename.ts`) — already derives the container from the
  resolved audio URL. It is the container dispatch key for the tag writer; no new sniffing needed
  (though a magic-byte check may be worth it, since the extension defaults to `'mp3'` when unknown).
- `library.downloads` + `blobStore` — the app already tracks exactly which files it wrote and where.
  That list IS D-18's retag scope; no new inventory mechanism is required.
- `download-track.test.ts` — an established node-project test harness for this exact orchestration,
  already asserting the never-throws and isolation contracts the tag step must not break.

### Established Patterns
- **Pure `.ts` for logic, runes only in `.svelte.ts`** — the tag codec is pure byte manipulation and
  belongs in a plain `.ts` so it runs in the single node Vitest project (no jsdom). Precedent:
  `download-filename.ts`, `media-session.ts`, `attached-cover.ts`.
- **Never-throw services returning a sentinel** — the tagger returns the original blob on any failure
  rather than rejecting (D-06). Same posture as `deezer.ts` / `itunes-cover.ts` / `fallback.ts`.
- **Fix the shared function, not the call sites** — the tag step goes at the ONE seam in
  `downloadTrack` so TrackMenu, DownloadControl, the album bulk loop and the background repair path
  all get it. (Phase 34 D-05 learned this the hard way with `blobStore.get()`'s 5 call sites.)
- **Load-bearing comments with decision refs** — new non-obvious choices get a `D-NN` comment per the
  house style.

### Integration Points
- `download-track.ts` — between `readBlobWithProgress(...)` and `blobStore.put` / `saveBlobToDisk`.
  The single seam covering web save, native public copy, and the offline blob.
- Album page `downloadAlbum` loop → a new positional/album-context parameter on `downloadTrack`.
- Settings download page → the opt-in retag control (D-17), alongside where Phase 34's import button
  and rules panel will also land. Confirm the route before adding.
- The new tag module → imported by Phase 34's import scan for its READ side (D-03).

</code_context>

<deferred>
## Deferred Ideas

- **Year / genre enrichment** (D-07) — revisit only if a device player surface makes their absence
  visibly wrong. Would need a call-budget decision first, given Phase 26/31's API-reduction work.
- **Device-wide retag** of audio files the app did not write — needs Phase 34's MediaStore scan.
  Deliberately outside D-18.
- **MediaStore `ContentValues` metadata columns** (D-15) — held as the remedy if on-device testing
  shows the media scanner failing to index in-file tags. Not built speculatively.
- **Lyrics embedded as a tag** (`USLT` / `©lyr` / `LYRICS`) — `Track.lrc` is resolved and in hand at
  download time, so it is cheap to add later, but it was not part of the scoped tag set.
- **Reviewed todos (not folded):** `todo.match-phase 36` returned 4 matches (artist-page hyphenated
  lookup key, `/api/og` artist `picture_xl` oversize, song-share stale cover comment, PageOg
  hardcoded origin). All matched on generic keywords (`artist`, `title`, `cover`, `shares`) and none
  concern file tagging. Not folded.

</deferred>

---

*Phase: 36-tag-downloaded-songs-with-full-metadata*
*Context gathered: 2026-09-13*
