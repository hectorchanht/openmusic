# Phase 36: Tag downloaded songs with full metadata - Research

**Researched:** 2026-09-13
**Domain:** Audio container metadata (ID3v2 / MP4 `ilst` atoms / FLAC Vorbis+PICTURE) written from a browser + Capacitor WebView, plus Android MediaStore scanner behaviour
**Confidence:** HIGH on the dependency choice and byte-layout behaviour (empirically round-trip tested in this session). MEDIUM on Capacitor-WebView and on-device MediaStore behaviour (device-only). HIGH on the AOSP scanner semantics (read from AOSP source).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Tag codec and containers

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

#### Tag field set

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

#### Native side and UI

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

#### Retro-tagging existing downloads

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

### Deferred Ideas (OUT OF SCOPE)

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
  hardcoded origin). All matched on generic keywords and none concern file tagging. Not folded.
</user_constraints>

<phase_requirements>
## Phase Requirements

**None assigned.** ROADMAP.md lists "Requirements: TBD" for Phase 36 and the orchestrator confirmed no
requirement IDs. The planner should mint phase-local IDs (`TAG-01…`) from the D-NN decisions above
rather than inventing new scope.
</phase_requirements>

---

## Summary

The central question — D-04's dependency choice — has a clear, **empirically verified** answer:
**`taglib-wasm@2.2.2`**, a WebAssembly build of TagLib with a TypeScript wrapper. It is the only
candidate in the current JS ecosystem that writes *native* tags for all three required containers,
and it was verified in this session by actually round-tripping title / artist / album / albumArtist /
track-number / embedded cover art through real MP3, M4A and FLAC files, then confirming the tagged
outputs still decode correctly with CoreAudio (`afinfo`). Every plausible alternative fails a hard
requirement: `music-metadata` and `jsmediatags` are read-only; `browser-id3-writer` is MP3-only and
write-only (no parse, so no round-trip proof); `mp3tag.js` writes ID3v2 *inside an MP4 `ID32` box*,
not the `moov.udta.meta.ilst` atoms D-02 names and Android actually reads; `metaflac-js` is a Node
CLI library that depends on `commander`/`file-type`/`image-size` and `Buffer`/`fs`. The
three-JS-libs-plus-a-hand-written-gap shape therefore costs *more* code, covers *less*, and still
leaves D-03's read side unbuilt.

The cost is honest and measured, not guessed. In a real Vite 8.0.16 application build (the project's
exact Vite version), taglib-wasm emits **686.5 kB raw / 232 kB gzip** of `.wasm` plus **75 kB raw /
25 kB gzip** of JS — about **257 kB gzip total**, all of it behind a dynamic `import()` and therefore
absent from the initial bundle. Tagging a 50.5 MB FLAC took **29 ms** in a single open→set→save pass;
the memory cost is the real constraint at roughly **6× the file size in peak RSS** (~370 MB for a
50 MB FLAC, with the Emscripten heap never shrinking afterwards). That is the one number that could
bite on a low-RAM Android device and it drives a recommended size cap.

There is one **hard, verified blocker** the plan must clear in Wave 0: `taglib-wasm` declares
`engines.node >= 24.0.0`, and this repo has `engine-strict=true` in `.npmrc` with `.nvmrc` pinned to
`22` and three GitHub workflows pinned to `node-version: 22`. `pnpm add taglib-wasm` under Node 22.22.0
**fails** with `ERR_PNPM_UNSUPPORTED_ENGINE` (reproduced). The engines field is, however, a
*declaration* and not a real runtime requirement — the same installed package **runs perfectly on
Node 22** (verified: all three containers round-trip). pnpm's `packageExtensions` cannot override
`engines` (also verified). So the plan must bump the project to Node 24, or vendor the wasm.

Finally, D-15's core assumption is **confirmed at AOSP source level**, and its named fallback is
**refuted**. `ModernMediaScanner.scanItemAudio` always runs `MediaMetadataRetriever` over the file and
upserts `TITLE`/`ARTIST`/`ALBUM`/`ALBUM_ARTIST`/`TRACK` from the file's own embedded tags — exactly
what D-15 relies on. But the same upsert *pre-sets* `ARTIST = "<unknown>"` and
`ALBUM = <parent folder name>` before the retriever values land, which means app-supplied
`ContentValues` for those columns get overwritten by any later scan. If the on-device test fails, the
`ContentValues` remedy will not durably save it.

**Primary recommendation:** Add `taglib-wasm@2.2.2` as a pinned runtime dependency, bump the project
to Node 24 in Wave 0, and put a single pure `src/lib/services/audio-tags.ts` module — lazily
`await import()`ing taglib-wasm inside a `browser` guard, never throwing, returning the original blob
on any failure — at the one seam in `downloadTrack` between `readBlobWithProgress` and
`blobStore.put` / `saveBlobToDisk`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Container detection (mp3 / m4a / flac / unknown) | Browser (pure `.ts`) | — | Byte-level sniff; taglib's `readFormat()` already does it from the first bytes. Must NOT trust `extFromAudioUrl`'s `'mp3'` default. |
| Tag encode/decode (ID3v2, MP4 ilst, FLAC Vorbis+PICTURE) | Browser / Capacitor WebView (wasm) | — | D-05 locks one shared code path; wasm runs identically on web, WebView and node. |
| Cover-art byte resolution | Browser (existing `media-artwork.ts`) | API proxy (`/api/og` for CN covers) | D-13 reuses the existing CORS-tiered, size-capped, timeout-bounded resolver. No second fetch path. |
| Download orchestration + tag injection | Browser (`download-track.ts`) | — | The single seam all four callers route through. |
| Web save to disk | Browser (`download-save.ts` anchor) | — | Unchanged; receives the tagged blob instead of the raw one. |
| App-private offline copy | Native filesystem (`capacitor-blob-writer`) | Browser (IndexedDB) | `blobStore.put` is already platform-split; it receives the tagged blob. |
| Public `Music/OpenMusic/` copy + MediaStore entry | Native (Kotlin `MediaStoreSaverPlugin`) | — | D-15 keeps it writing only `DISPLAY_NAME`/`MIME_TYPE`/`RELATIVE_PATH`/`IS_PENDING`. |
| Device library indexing (TITLE/ARTIST/ALBUM columns) | Android OS (`ModernMediaScanner`) | — | Not ours. Reads the in-file tags on the `IS_PENDING → 0` flip. Verified in AOSP source. |
| Retag rewrite of an existing public file | Native (Kotlin, new `@PluginMethod`) | Browser (drives the loop) | Rewriting a MediaStore entry needs `ContentResolver.openFileDescriptor(uri, "rwt")` — only reachable from Kotlin. |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `taglib-wasm` | `2.2.2` (pin exact) | Read + write ID3v2, MP4 `ilst` atoms, FLAC Vorbis comments + PICTURE, from one API | The only JS package that writes all three containers *natively*. Wraps TagLib — the reference C++ tagging library behind Kid3, Amarok, Clementine, beets, VLC. `[VERIFIED: npm registry + hands-on round-trip test, this session]` |

**What it actually does, verified in this session (not from training data):**

```
--- test.mp3  8340 B → 9593 B   format MP3   title/artist/album/albumArtist/track/cover all round-trip ✓
--- test.m4a  8324 B → 9160 B   format MP4   ✓   (also verified on a non-faststart, mdat-first file)
--- test.flac 22295 B → 26494 B format FLAC  ✓
All three re-verified with `afinfo`: audio still decodes, correct duration, correct audio byte count.
```

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| *(none)* | — | — | No second package is needed. `readFormat()` replaces magic-byte sniffing; `readTags()`/`readCoverArt()` give D-03's read side and the round-trip test oracle. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff — why rejected |
|------------|-----------|--------------------------|
| `taglib-wasm` | `browser-id3-writer@6.4.0` (MIT, 12 kB, updated 2026-07-30) | **MP3 only, WRITE only.** No parser → no round-trip proof (D-03 unmet). Covers ~0 % of the real post-Phase-32 download mix (m4a + FLAC). `[VERIFIED: npm view]` |
| `taglib-wasm` | `mp3tag.js@3.17.0` (MIT, 139 kB min, updated 2026-06-30) | Looks like it covers MP4 — its own README says *"Read and write ID3v2 tags in MP4/M4A/M4V/MOV containers (**via ID32 box**)"*. That is an ID3 chunk bolted into MP4, **not** the `moov.udta.meta.ilst` `©nam`/`aART`/`covr` atoms D-02 names and that Android/iTunes actually read. Fails D-02. No FLAC at all. `[VERIFIED: package README in the published tarball]` |
| `taglib-wasm` | `mp4-tag@0.1.0-beta` (MIT, 60 kB min) | Genuine MP4 `ilst` writer, same author as mp3tag.js. But **beta**, last published **2024-08-11**, **116 downloads/week**. Would still need two more libs for MP3 and FLAC. `[VERIFIED: npm view + npm downloads API]` |
| `taglib-wasm` | `metaflac-js@1.0.5` (ISC) | Pure-JS FLAC metadata writer, but a **Node CLI library**: depends on `commander`, `file-type`, `image-size`, and uses `Buffer`/`fs` throughout (25 hits). Last published 2022. Would need browser polyfills. `[VERIFIED: published package.json + source grep]` |
| `taglib-wasm` | `music-metadata@11.15.0` / `jsmediatags@3.9.7` | **Read-only.** Explicitly disqualified by D-04(a). `[VERIFIED: package descriptions]` |
| `taglib-wasm` | Hand-write all three | D-01 exists precisely because this was judged too much code. Concretely: an ID3v2.3 writer (~200 lines), an MP4 atom-tree rewriter with `stco`/`co64` offset fix-up (~400 lines, the classic corruption trap), a FLAC block editor (~200 lines) — **and** D-03 requires a parser for each, roughly doubling it. ~1200 lines of byte-level code with a "never corrupt the file" guarantee. Rejected. |

**The honest framing of the trade, as D-04 asked for it:** one wasm library covers all three containers
for **257 kB gzip** behind a dynamic import, versus three JS libraries (one of which is beta and one of
which is a Node CLI) that together **still do not** cover the required MP4 atoms, plus a hand-written
FLAC writer, plus three hand-written parsers. The wasm wins on every axis except raw byte count, and
the byte count is paid lazily by the ~small fraction of users who press Download.

**Installation:**

```bash
pnpm add taglib-wasm@2.2.2   # exact pin, no caret — see Pitfall 8
```

**Version verification:** `npm view taglib-wasm version` → `2.2.2`, published `2026-08-23`, license
`MIT` (wrapper), 376 files / 2.39 MB unpacked, single dependency `@msgpack/msgpack@^3.1.3`.
`[VERIFIED: npm view, 2026-09-13]`

---

## Package Legitimacy Audit

`slopcheck` was available and run.

```
slopcheck install taglib-wasm browser-id3-writer mp3tag.js mp4-tag metaflac-js
→ scanned 5 packages, 5 OK
```

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `taglib-wasm` | npm | repo created 2025-06-10; v2.2.2 published 2026-08-23 | 1,526 / wk | github.com/CharlesWiltgen/TagLib-Wasm (38★, 0 open issues, last push 2026-09-03) | `[OK]` | **Approved — recommended** |
| `mp3tag.js` | npm | v3.17.0, 2026-06-30 | 4,259 / wk | github.com/eidoriantan/mp3tag.js | `[OK]` | Rejected on capability (ID32 box, not `ilst`) |
| `browser-id3-writer` | npm | v6.4.0, 2026-07-30 | 11,106 / wk | github.com/egoroof/browser-id3-writer | `[OK]` | Rejected on scope (MP3 only, write only) |
| `mp4-tag` | npm | v0.1.0-**beta**, 2024-08-11 | 116 / wk | github.com/eidoriantan/mp4-tag | `[OK]` *("not exactly popular")* | Rejected — beta, stale, low use |
| `metaflac-js` | npm | v1.0.5, 2022-05-09 | 544 / wk | github.com/ishowshao/metaflac-js | `[OK]` *("not exactly popular")* | Rejected — Node-only, 3 transitive deps |

**Packages removed due to slopcheck `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** none.

**Honest supply-chain caveat (not a slopcheck finding, a judgement call the planner should surface):**
`taglib-wasm` has **one maintainer** (`charleswiltgen`), 1.5 k weekly downloads, and ships a **686 kB
opaque wasm binary** that no reviewer will realistically audit. That is exactly the class of risk
`CLAUDE.md`'s zero-runtime-deps rule exists to avoid, and D-01's exception does not make it disappear.
Mitigations the plan should adopt:

1. **Pin the exact version** (`"taglib-wasm": "2.2.2"`, no caret). The lockfile is already
   `--frozen-lockfile` in CI.
2. **Never auto-bump.** A wasm-blob update is a review event, not a dependabot merge.
3. **Fallback option if the Node-24 bump proves painful:** vendor `dist/taglib-web.wasm` +
   `dist/taglib-wrapper.js` + the browser entry into the repo and drop the npm dependency entirely.
   This also freezes the binary under review and sidesteps the `engines` blocker. Cost: ~686 kB in git,
   manual updates. Documented here as a real option, not recommended as the default.

---

## The Node Engine Blocker (must be resolved in Wave 0)

This is the single highest-risk item in the phase and it is **verified, not suspected**.

| Fact | Evidence |
|------|----------|
| `taglib-wasm@2.2.2` declares `engines.node: ">=24.0.0"` | `npm view taglib-wasm engines` |
| Every version back to `1.7.2` declares `>=24.0.0`; only `1.0.0` allowed `>=22.6.0` | `npm view taglib-wasm@<v> engines` |
| This repo sets `engine-strict=true` (`.npmrc`), `.nvmrc` = `22`, and `node-version: 22` in `android-main.yml`, `android-release.yml`, `upstream-health.yml` | file reads |
| `pnpm add taglib-wasm` under Node 22.22.0 **fails**: `ERR_PNPM_UNSUPPORTED_ENGINE` | **reproduced in a scratch dir this session** |
| pnpm `packageExtensions` **cannot** override `engines` (only deps/peerDeps) | **reproduced — same error with the override in place** |
| The package nevertheless **runs correctly on Node 22.22.0** — all three containers round-trip | **reproduced: copied `node_modules` to a Node-22 process, ran the round-trip, 3/3 pass** |

The `>=24` floor gates taglib-wasm's optional **WASI** backend; the Emscripten backend it actually
falls back to has no such requirement. (On Node 24 the library even logs
`WASI unavailable: Node.js 24.13.0 requires --experimental-wasm-exnref. Falling back to Emscripten.`)

**Recommended remedy — bump the project to Node 24** (current Active LTS):

- `.nvmrc` → `24` (Cloudflare Pages reads this for the build image)
- `package.json` `engines.node` → `">=24"`
- `.github/workflows/{android-main,android-release,upstream-health}.yml` → `node-version: 24`

This must be its own Wave-0 task with a full `pnpm install && pnpm check && pnpm test && pnpm build`
gate *before* any tagging code is written, because a Node bump can independently break the
SvelteKit/wrangler/adapter-cloudflare build. Vite 8.0.16 and SvelteKit 2.63 both support Node 24.

**Rejected remedies:** `engine-strict=false` (disables the guard for every package in the repo — the
guard is doing its job here, it correctly stopped a mismatch); downgrading to `taglib-wasm@1.0.0`
(two years of fixes behind, and the browser entry / `applyCoverArt` API surface differs).

---

## Architecture Patterns

### System Architecture Diagram

```
  TrackMenu           DownloadControl        album/[name] downloadAlbum()      player.svelte.ts:2121
  (single song)       (row + header)         (bulk loop, persist:false)        (silent repair, save:false)
        │                    │                        │                                  │
        └────────────────────┴────────────┬───────────┴──────────────────────────────────┘
                                          ▼
                            downloadTrack(track, opts)            ← the ONE seam (D-05)
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              ▼                           ▼                           ▼
    ensureTrackDetails(fresh)     library.addDownload(r)      fetch(r.audioUrl)  [raw, not apiFetch]
                                                                      │
                                                                      ▼
                                              readBlobWithProgress(resp, onProgress, {type})
                                                                      │
                                                                      ▼
      ┌─────────────────────── NEW: tagAudioBlob(blob, fields) ───────────────────────┐
      │                                                                               │
      │   1. if (!browser) return blob                        ← SSR / node guard      │
      │   2. art = await resolveArtworkDataUrl({cover,title,artist})   (D-13/D-14)    │
      │            └─ media-artwork.ts: Deezer/iTunes direct → /api/og → null         │
      │   3. if (blob.size > TAG_MAX_BYTES) return blob        ← memory ceiling       │
      │   4. bytes = new Uint8Array(await blob.arrayBuffer())                         │
      │   5. { readFormat } = await import('taglib-wasm/simple')  ← lazy, browser ent. │
      │      fmt = await readFormat(bytes)   MP3 | MP4 | FLAC | undefined             │
      │      if (!fmt) return blob                             ← D-06 unknown → intact│
      │   6. taglib.open(bytes) → tag().setTitle/setArtist/setAlbum                   │
      │                        → setProperty('ALBUMARTIST' | 'TRACKNUMBER')           │
      │                        → setPictures([front cover])                           │
      │                        → save() → getFileBuffer() → dispose()                 │
      │   7. return new Blob([out], { type: blob.type })                              │
      │   ANY throw / any falsy step ⇒ return the ORIGINAL blob (D-06, never throws)  │
      └───────────────────────────────────────────────────────────────────────────────┘
                                          │ tagged (or original) blob
              ┌───────────────────────────┴───────────────────────────┐
              ▼                                                       ▼
      blobStore.put(uid, blob, filename)                     saveBlobToDisk(blob, filename)
      │  web → IndexedDB                                     web → <a download> click
      │  native → capacitor-blob-writer (app-private)
      │         → MediaStoreSaver.saveToMusic (public copy)
      │            └─ ContentValues: DISPLAY_NAME/MIME/RELATIVE_PATH/IS_PENDING  (D-15: unchanged)
      ▼
   Android ModernMediaScanner on IS_PENDING → 0
      └─ MediaMetadataRetriever reads OUR tags → upserts TITLE/ARTIST/ALBUM/ALBUM_ARTIST/TRACK
```

### Recommended Project Structure

```
src/lib/services/
├── audio-tags.ts           # NEW. PURE, node-testable. Container detect + read + write.
│                           #   export type AudioTagFields  (what we know, all optional)
│                           #   export async function readAudioTags(bytes): Promise<AudioTagFields|null>
│                           #   export async function writeAudioTags(bytes, fields, art): Promise<Uint8Array|null>
│                           #   NEVER throws. null = "could not tag / could not read".
│                           #   Owns the lazy `await import('taglib-wasm/simple')`.
├── audio-tags.test.ts      # NEW. Round-trip proof for all three containers (D-03).
├── download-track.ts       # MODIFIED. One new await between readBlobWithProgress and blobStore.put.
├── media-artwork.ts        # UNCHANGED. D-13 reuses resolveArtworkDataUrl().
├── download-filename.ts    # UNCHANGED. extFromAudioUrl stays the FILENAME source of truth only.
└── retag.ts                # NEW. PURE batch planner for D-17/D-18/D-19 (what to retag, in what order).

src/routes/(app)/settings/downloads/+page.svelte   # NEW ROUTE — see Open Question 1
tests/fixtures/                                    # NEW. 3 tiny synthetic audio files — see Validation
android/.../MediaStoreSaverPlugin.kt               # MODIFIED only if native retag is in scope — see Pitfall 10
```

`audio-tags.ts` is a **pure `.ts`**, not `.svelte.ts`: it manipulates bytes, imports no store, and must
run in the single node Vitest project. Same shape as `download-filename.ts` / `media-session.ts`.

### Pattern 1: Lazy, browser-guarded dynamic import of the wasm

**What:** `taglib-wasm` is loaded with `await import()` inside the function that needs it, never at
module top level.
**When to use:** always, for this dependency.
**Why it is load-bearing here, three separate reasons:**

1. **Bundle.** A static import puts 257 kB gzip into the main chunk for every visitor. The dynamic
   import keeps it in its own chunk, fetched only when someone taps Download. Verified: the Vite build
   emits `taglib-web-<hash>.wasm`, `taglib-wrapper-<hash>.js` and `simple.browser-<hash>.js` as
   separate assets.
2. **SSR / Cloudflare build.** The app is `ssr = false`, but SvelteKit still SSR-processes the module
   graph at build time. Under SSR conditions `taglib-wasm` resolves to its **node** entry (`dist/index.js`),
   which pulls in WASI/`node:fs` code that must not reach the Workers bundle.
3. **Precedent.** `player.svelte.ts:2119` already uses exactly this idiom to dynamic-import
   `download-track` and break a module cycle.

```typescript
// Source: verified against the published taglib-wasm@2.2.2 type declarations + a live round-trip run
import { browser } from '$app/environment';

let taglibPromise: Promise<typeof import('taglib-wasm/simple')> | null = null;
/** Cached module handle — the wasm compiles ONCE per session, then every later tag is ~ms. */
function loadTaglib() {
	return (taglibPromise ??= import('taglib-wasm/simple'));
}
```

### Pattern 2: Detect the container from BYTES, never from the URL extension

**What:** call `readFormat(bytes)` (taglib) instead of trusting `extFromAudioUrl(audioUrl)`.
**When to use:** always, before choosing to tag.

`extFromAudioUrl` deliberately **defaults an unrecognised URL to `'mp3'`** — correct for building a
filename (you always need *some* extension), catastrophic as a tagging dispatch key, because a FLAC
served from a URL with no extension would be routed through an ID3 writer. `readFormat` reads the
first bytes (`ID3`/MPEG sync, `ftyp`, `fLaC`) and returns `MP3 | MP4 | FLAC | …` or `undefined`. An
`undefined` return is D-06's "unknown container → save the original bytes" branch, for free.

**Do not hand-roll the sniff.** taglib already has it, it is the same code path that will then parse
the file, so it cannot disagree with itself. (For reference, if it ever had to be hand-rolled:
`66 4C 61 43` = `fLaC` at offset 0; `66 74 79 70` = `ftyp` at offset **4**; `49 44 33` = `ID3` at
offset 0, else an MPEG frame sync `FF Ex/Fx`.)

### Pattern 3: ONE open → set everything → save (not `applyTags` then `applyCoverArt`)

**What:** use the full API (`TagLib.initialize()` → `taglib.open()` → mutate → `save()` →
`getFileBuffer()` → `dispose()`) rather than chaining the two `simple` helpers.
**When to use:** always on the download path. Measured difference on a 50.5 MB FLAC:

| Approach | Passes over the bytes | Time | Peak RSS |
|----------|----------------------|------|----------|
| `applyTags()` then `applyCoverArt()` | 2 full open/save cycles | 46 ms + 17 ms | **437 MB** |
| single `open` → `setTag` + `setPictures` → `save` | 1 | **29 ms** | **392 MB** |

The `simple` API is still the right choice for the **test** side (`readTags`, `readCoverArt`,
`readFormat`) where the files are tiny and clarity matters.

### Pattern 4: Never-throw service returning the original blob

Identical posture to `deezer.ts` / `itunes-cover.ts` / `fallback.ts`. The tagger's failure sentinel is
"here are your bytes back". `download-track.ts` must be able to write:

```typescript
const tagged = await tagAudioBlob(blob, fields);   // never rejects; worst case === blob
```

with no try/catch of its own, so D-17's NEVER-THROWS contract is unchanged by construction.

### Pattern 5: Tag with the SAME display names the filename already uses

`downloadTrack` builds the filename from `names.dnArtist(r.artist)` / `names.dnTitle(r.title)` — i.e.
the *translated* display names, honouring the user's `appLang` / zh-conversion. Passing raw
`r.title`/`r.artist` into the tags would produce a file whose **name says 標題 and whose tag says 标题**.
Read the same two values once, use them for both.

`names` is a runes store — but `download-track.ts` already imports it, so nothing new is coupled. The
`audio-tags.ts` module stays pure: it receives already-translated strings, exactly as
`buildDownloadFilename` does (its purity contract explicitly says so).

### Anti-Patterns to Avoid

- **Static `import 'taglib-wasm'` at module top level.** Breaks the Cloudflare/SSR build and adds
  257 kB gzip to the entry chunk. See Pattern 1.
- **Dispatching on `extFromAudioUrl()`.** Its `'mp3'` default will hand a FLAC to an ID3 writer.
- **Calling `applyTags` then `applyCoverArt`.** Doubles the memory peak on exactly the files
  (large FLACs) where memory is the risk.
- **Writing a duration tag.** See D-09 resolution below — it can only ever disagree with the stream.
- **Writing `"Unknown Artist"` / `"Unknown Album"` when a field is missing.** D-10/the phase spine.
  `setTitle('')` is taglib's *clearing* contract (`removeProperty` is documented as equivalent to
  `setProperty(key, "")`), so an empty string is safe — but simply not calling the setter is safer
  and clearer.
- **Touching `saveBlobToDisk`'s body.** `download-save.test.ts` greps that function's source to forbid
  a save-picker or a new-tab navigation. Pass it a different blob; do not edit it.
- **A `Tag with metadata` toggle in Settings.** Nobody asked for it; D-16 says no new UI state for
  tagging on the download path.

---

## D-09 resolved: do NOT write a duration tag

D-09 is Claude's discretion and asked to be settled against the chosen library's API. Settled: **no
duration tag.** Three reasons, two of which are now measured rather than assumed:

1. **The library computes duration from the stream, and exposes it read-only.** `readProperties()`
   returned correct `durationMs` for all three fixtures (521 / 1022 / 917 ms) with no tag present.
   There is no `duration` field on `TagInput` — taglib deliberately does not let you write one.
2. **Android reads it from the stream too.** `ModernMediaScanner` fills `MediaColumns.DURATION` from
   `MediaMetadataRetriever.METADATA_KEY_DURATION`, which for MP4/FLAC/MP3 comes from the container
   headers, not from a tag.
3. **`Track.duration` is QQ-only and can be wrong** for the tier actually downloaded (Phase 32 makes
   the downloaded tier vary). Writing it would be writing a claim we cannot back.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MP4 atom insertion | A `moov`/`udta`/`meta`/`ilst` tree rewriter | `taglib-wasm` | The `stco`/`co64` chunk-offset table must be rebuilt whenever anything before `mdat` grows. This is *the* classic MP4-tagging corruption bug. Verified handled: a hand-built **mdat-first (non-faststart)** M4A tagged cleanly and still decoded. |
| FLAC metadata blocks | A block-list editor | `taglib-wasm` | The last-metadata-block flag, 24-bit big-endian block sizes, padding reuse, and the PICTURE block's own nested length fields. Verified output: `STREAMINFO → VORBIS_COMMENT → PICTURE → PADDING(last=1)`, padding correctly regenerated. |
| ID3v2 frame encoding | A TIT2/TPE1/TALB/TPE2/TRCK/APIC writer | `taglib-wasm` | Sync-safe integers, UTF-8 vs UCS-2 encoding bytes, unsynchronisation, the extended header, and padding. Verified output: ID3v2.4.0, UTF-8 (`enc 3`) on every text frame. |
| Container detection | Magic-byte sniffing | `readFormat()` | Already in the library, and it is the same parser that will then read the file — it cannot disagree with itself. |
| Cover-art fetching | A second image fetch | `resolveArtworkDataUrl()` | D-13. Already CORS-tiered, size-capped (1 MB), content-type checked and 6 s-bounded. |
| Base64 of image bytes | `FileReader` / `String.fromCharCode(...bytes)` | `bytesToBase64()` in `media-artwork.ts` | `FileReader` does not exist in the node test project (the module says so explicitly), and the spread blows the argument limit on a 100 kB image. |
| Test fixture audio | Downloading real songs | `say` + `afconvert` (see Validation) | Licensing-clean, deterministic, kilobytes. |

**Key insight:** every one of these is a place where "it looks right and the file plays on my machine"
and "the file is actually valid" diverge. The whole reason D-03 demands read+write together is that a
parser is the only cheap oracle for a writer; using a library that ships both is the same insight,
executed once instead of three times.

---

## Runtime State Inventory

This phase rewrites bytes that are already on users' disks (D-17/D-18). A grep audit will not find any
of the following.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | `library.downloads: Track[]` in `localStorage` key `openmusic:library:v1` — the D-18 retag inventory. It stores the `Track`, **not** whether the file on disk is tagged. | The plan needs a *tagged* marker so a second retag run is idempotent and so the button can say how many remain. Options: a new `openmusic:tagged:v1` uid set, or read the file back with `readAudioTags()` and check. Reading back is honest but costs a full file read per entry. **Recommend the uid set**, with retag being safe to re-run anyway. |
| | IndexedDB `openmusic-blobs` / object store `tracks` — the web offline copies, keyed by uid. These are the *web* retag targets. | Rewrite in place: `get(uid)` → tag → `put(uid, tagged)`. No new plumbing. Note this does **not** fix the file the user already saved to their Downloads folder — the browser gives no handle back. **State that honestly in the retag UI.** |
| | App-private native copies at `Directory.Data/downloads/<sanitized-uid>` via `capacitor-blob-writer`. | Same read-tag-write loop through `blobStore.get`/`put`. |
| **Live service config** | Android **MediaStore** rows under `Music/OpenMusic/` — the public copies. Their `TITLE`/`ARTIST`/`ALBUM` columns live in MediaProvider's SQLite DB, **not in git and not in the app**. Recorded content URIs live in `localStorage` as `openmusic-blob-uri:<uid>` (written by `blobStore.nativePut`). | A retag must rewrite the file *and* get the row re-scanned. See Pitfall 10. **Gap:** the album bulk path calls `downloadTrack(tr, { persist: false })`, so album downloads have **no** app-private copy, **no** public copy and **no** recorded URI on native — they are outside retag scope entirely on native. Say so in the UI. |
| **OS-registered state** | None registered by this app (no Task-Scheduler/launchd analogue). The Android media database is covered above. | None — verified by reading `MediaStoreSaverPlugin.kt` (only `saveToMusic` / `deleteFromMusic` exist). |
| **Secrets / env vars** | None. Tagging adds no secret and reads none. `JOOX_TOKEN`/`LASTFM_*` are untouched. | None — verified by grep of `proxy-types.ts` `Env` and `wrangler.jsonc`. |
| **Build artifacts** | `pnpm-lock.yaml` gains `taglib-wasm` + `@msgpack/msgpack`. `.svelte-kit/cloudflare` and `build/` gain a ~686 kB `.wasm` asset. `android/app/src/main/assets/public/` gains the same file on `cap sync`. | `pnpm install` after the Node bump; a full `pnpm apk` to confirm the wasm lands in the APK assets and loads in the WebView. |
| | **Service worker precache.** `src/service-worker.ts` does `ASSETS = [...build, ...files]; cache.addAll(ASSETS)`. If SvelteKit's `build` array includes emitted non-JS assets (it is documented as "the files generated by Vite"), the 686 kB wasm is precached on install **for every user on every deploy**, including users who never download a song. | **Verify and almost certainly fix**: filter `.wasm` out of `ASSETS` and let the runtime fetch handler cache it on first use. One line in `service-worker.ts`; the bypass logic in `sw-cache.ts` is untouched. Marked MEDIUM confidence — confirm with `pnpm build` then grep the generated service worker. |

---

## Common Pitfalls

### Pitfall 1: Node engine mismatch blocks `pnpm install` entirely

**What goes wrong:** `pnpm add taglib-wasm` fails with `ERR_PNPM_UNSUPPORTED_ENGINE`; CI with
`--frozen-lockfile` fails too.
**Why it happens:** `engines.node >= 24` vs `.nvmrc 22` + `engine-strict=true`.
**How to avoid:** bump to Node 24 as a standalone Wave-0 task, gated by a full
`pnpm install && pnpm check && pnpm test && pnpm build` before any tagging code exists.
**Warning signs:** the error above; a green local install on a machine that happens to run Node 24+
while CI (pinned to 22) goes red. *(The researcher's own machine runs Node 25 — this is exactly how
this one hides.)*

### Pitfall 2: Memory, not time, is the mobile constraint

**What goes wrong:** the WebView is killed mid-download on a large FLAC.
**Why it happens:** measured on a 50.5 MB FLAC, single-pass: peak RSS **392 MB**, i.e. ≈ **6× the file
size**. The Blob, its `arrayBuffer()` copy, the wasm heap copy, TagLib's internal save buffers and the
output buffer all coexist. The Emscripten heap **grows and never shrinks** — after the first big file
the process stays ~370 MB for its lifetime (measured: pass 0 → 317 MB, pass 1 → 369 MB, pass 2 → 369 MB,
no further growth).
**Timing is a non-issue** for comparison: 29 ms for that same 50 MB file.
**How to avoid:**
- Add a `TAG_MAX_BYTES` ceiling and return the blob untagged above it (a clean D-06 fall-through).
  A defensible starting value is **40 MB** — it covers every m4a and most FLACs while excluding the
  pathological ones. Make it a named exported constant so it is trivially tunable, and log a
  `logAction('tag.skipped-size', …)` so the Activity log shows when it trips.
- Drop the source reference before returning (`bytes = null as never` style is not possible with
  `const` — structure the function so the input array goes out of scope).
- Never hold the untagged blob and the tagged blob past the `return`.
**Warning signs:** the download silently "completes" with no file on a 60 MB lossless track; a WebView
reload mid-download; Chrome DevTools memory graph on the emulator (see the existing
`apk-debug-via-emulator-cdp` note — a Pixel_3a_API_34 AVD + CDP is already the established way to
watch this).

### Pitfall 3: `extFromAudioUrl`'s `'mp3'` default routes a FLAC to an ID3 writer

**What goes wrong:** a corrupt or mis-tagged file from a URL with no recognisable extension.
**Why it happens:** the helper is documented as "Unknown or null → 'mp3' (the existing default) so a
filename is always buildable" — correct for filenames, wrong for byte layout.
**How to avoid:** dispatch on `readFormat(bytes)`, never on the extension. Keep `extFromAudioUrl` for
the filename only.
**Warning signs:** a `.mp3`-named download that a device player refuses; a size delta on a FLAC that
looks like an ID3 header was prepended.

### Pitfall 4: TagLib writes ID3v2.**4**, and Android's ID3 support is version-sensitive

**What goes wrong:** an MP3 whose tags a particular Android player ignores.
**Why it happens:** verified by parsing the tagged fixture — TagLib emits `ID3 v2.4.0`, flags `0x00`,
frames `TIT2 / TPE1 / TALB / TPE2 / TRCK / APIC`, all text frames with encoding byte `3` (UTF-8).
ID3v2.3 is the more conservatively-compatible choice and is widely recommended for maximum player
support; taglib-wasm@2.2.2 exposes **no option to force 2.3** (searched the published type
declarations and dist — no `id3v2Version` / `saveWithVersion` surface). `[VERIFIED: fixture byte
analysis + dist grep]`
**How much this matters here:** less than it first appears. Post-Phase-32 the real download mix is
**m4a + FLAC**; mp3 only appears on the kuwo/netease/joox fallback ladder. AOSP's `ID3.cpp` does parse
2.2/2.3/2.4, so stock Android is fine; the risk is OEM skins and third-party players.
**How to avoid / what to do:** accept 2.4, and make "an MP3 download shows correct title/artist in the
device player" an explicit item on the on-device verification checklist. If it fails, the escape hatch
is a small hand-written ID3v2.3 post-pass on the MP3 branch only (the frame set is six frames) — do
**not** build it speculatively. `[ASSUMED — Android ID3v2.4 support: needs device confirmation]`

### Pitfall 5: Omitting `album` does NOT give "Unknown album" on Android — it gives "OpenMusic"

**What goes wrong:** D-10 omits the album when `Track.album` is empty, expecting the device player's
own "Unknown album" convention. On Android the actual result is worse: the scanner falls back to the
**parent folder name**.
**Why it happens:** `ModernMediaScanner.scanItemAudio` unconditionally runs
`op.withValue(MediaColumns.ALBUM, file.getParentFile().getName())` *before* the retriever values are
applied, and `withOptionalValue` only overwrites when a value is present. Files live in
`Music/OpenMusic/`, so an album-less track lands in a pseudo-album called **"OpenMusic"**.
Likewise `op.withValue(MediaColumns.ARTIST, UNKNOWN_STRING)` → an artist-less track shows `<unknown>`.
`[VERIFIED: AOSP ModernMediaScanner.java lines 1456-1465]`
**How to avoid:** nothing to change — D-10 is locked and this is the OS's behaviour, not a placeholder
the app wrote. **But document it in the plan and in the phase summary**, because "omit album" reading
as "grouped under OpenMusic" on device is a surprise the user should hear about before they see it.

### Pitfall 6: The tagged blob must keep its MIME type

**What goes wrong:** the saved file is labelled `application/x-www-form-urlencoded` again.
**Why it happens:** `quick-260913-tmi` threaded `audioMimeForUrl(...)` into `readBlobWithProgress`
precisely because the qq CDN lies in its `Content-Type`. `new Blob([taggedBytes])` with no `type`
throws that fix away, and `MediaStoreSaverPlugin.mimeForFileName` would then be the only thing
standing between the user and a mis-typed file.
**How to avoid:** `new Blob([out], { type: original.type })`. Add a test asserting it.
**Warning signs:** the native public copy opens in the wrong app; the web `<a download>` file has no
audio icon.

### Pitfall 7: Two separate `apply*` calls on the same file double the peak memory

Covered in Pattern 3 with numbers. Mentioned again because the `simple` API is the one the README
leads with, so this is the default a hurried implementer will reach for.

### Pitfall 8: A caret range on the wasm dependency

**What goes wrong:** a routine `pnpm update` swaps a 686 kB opaque binary that nobody reviews.
**How to avoid:** exact pin, and treat any bump as a review event with a fresh round-trip run.

### Pitfall 9: The service worker precaches the wasm for everyone

Covered in the Runtime State Inventory. The fix is one filter line; the cost of missing it is
686 kB of install-time download for every PWA user on every deploy.

### Pitfall 10: Retagging a public MediaStore file is a delete-and-rewrite unless Kotlin is extended

**What goes wrong:** a half-written public file — a corrupt song in the user's library, which is
precisely what D-19 forbids.
**Why it happens:** `MediaStoreSaverPlugin.kt` today has only `saveToMusic` (insert + stream + flip
`IS_PENDING`) and `deleteFromMusic`. There is no update path. Rewriting the *content* of an existing
entry requires, from Kotlin, `contentResolver.openFileDescriptor(uri, "rwt")` (`t` = truncate) or
`openOutputStream(uri, "wt")` — the app owns these rows (`OWNER_PACKAGE_NAME`), so **no
`RecoverableSecurityException` handling is needed**, which is the good news.
`[CITED: developer.android.com/training/data-storage/shared/media — modes `r`/`w`/`rwt`, ownership rules]`
**Two shapes for the plan to choose between:**

| Shape | Risk | Cost |
|-------|------|------|
| **A — delete + re-save** (reuse the existing two methods verbatim) | A crash between `deleteFromMusic` and `saveToMusic` loses the public copy. **Recoverable**, not corrupting: the app-private copy still exists and the user can re-download. New MediaStore `_ID`. | **Zero Kotlin.** The TS retag loop calls existing methods. |
| **B — new `updateInMusic` `@PluginMethod`** with `IS_PENDING=1` → `openFileDescriptor(uri,"rwt")` → stream → `IS_PENDING=0` | A crash mid-write leaves a truncated file that is *still* `IS_PENDING=1`, so other apps do not see it. Preserves `_ID`. | ~40 lines of Kotlin + an APK rebuild in the verification loop. |

**Recommendation: Shape A.** It is strictly less code, needs no Kotlin change, and its failure mode
(missing public copy, app-private copy intact) is milder than B's (truncated file). Preserving the
MediaStore `_ID` has no consumer today — Phase 34's D-02 uses `_ID` for *imported* `device:` entries,
and D-09 merges `Music/OpenMusic/` files onto their real source uid by location, not by `_ID`.
The `openmusic-blob-uri:<uid>` localStorage index is rewritten by `blobStore.put` anyway.
**Order matters:** tag the bytes and verify them *first* (read the tags back), then touch the disk.
Never delete before the replacement bytes exist and parse.

### Pitfall 11: Retag can only fix what the app still holds

The web `<a download>` path hands the file to the browser and gets no handle back. Retagging on web
can rewrite the IndexedDB offline copy but **cannot** touch the file already in the user's Downloads
folder. On native, album-bulk downloads used `persist: false` and have neither copy. The retag UI must
say what it actually did, not "Retagged 42 songs" when 30 of those files are untouched on disk. This
is the same truthfulness class as `quick-260913-jq4`.

---

## Code Examples

All examples below were executed against `taglib-wasm@2.2.2` in this session unless marked otherwise.

### Container detection + full single-pass write (the download path)

```typescript
// Source: taglib-wasm@2.2.2 published .d.ts + a verified live run.
// src/lib/services/audio-tags.ts — PURE, never throws, node-testable.

/** Everything we might know. A field we do not know is simply absent — never a placeholder. */
export interface AudioTagFields {
	title?: string;
	artist?: string;
	album?: string;        // D-10: absent when Track.album is empty
	albumArtist?: string;  // D-12: album-page artist, else track artist
	trackNumber?: string;  // D-11: ONLY from the album download loop
	// D-07: no year, no genre.  D-08: no comment/encoder.  D-09: no duration.
}

/** Memory ceiling (Pitfall 2). Above this, save the original bytes untagged (D-06). */
export const TAG_MAX_BYTES = 40 * 1024 * 1024;

let modPromise: Promise<typeof import('taglib-wasm')> | null = null;

/**
 * Write `fields` (+ optional front cover) into `bytes`. Returns the tagged bytes, or `null` when
 * the container is unrecognised / the input is malformed / anything throws — the caller then saves
 * the ORIGINAL bytes untouched (D-06). NEVER throws, never mutates `bytes`.
 */
export async function writeAudioTags(
	bytes: Uint8Array,
	fields: AudioTagFields,
	art?: { data: Uint8Array; mimeType: string } | null
): Promise<Uint8Array | null> {
	if (bytes.byteLength > TAG_MAX_BYTES) return null; // Pitfall 2
	try {
		const { TagLib } = await (modPromise ??= import('taglib-wasm'));
		const taglib = await TagLib.initialize();
		const file = await taglib.open(bytes);
		try {
			// Pattern 2: dispatch on BYTES. An unknown container throws here / getFormat() is falsy.
			if (!file.getFormat()) return null;
			const tag = file.tag();
			// "Omit, never placeholder" — only call a setter when we actually know the value.
			if (fields.title) tag.setTitle(fields.title);
			if (fields.artist) tag.setArtist(fields.artist);
			if (fields.album) tag.setAlbum(fields.album);
			// ALBUMARTIST / TRACKNUMBER are format-agnostic property keys; taglib maps them to
			// TPE2 (ID3), aART (MP4) and ALBUMARTIST (Vorbis) — verified in all three fixtures.
			if (fields.albumArtist) file.setProperty('ALBUMARTIST', fields.albumArtist);
			if (fields.trackNumber) file.setProperty('TRACKNUMBER', fields.trackNumber);
			if (art) {
				file.setPictures([
					{ mimeType: art.mimeType, data: art.data, type: 'FrontCover', description: '' }
				]);
			}
			if (!file.save()) return null;
			return file.getFileBuffer();
		} finally {
			file.dispose(); // frees the wasm-side handle; the heap itself does not shrink (Pitfall 2)
		}
	} catch {
		// D-06: an unknown container, a malformed input, an OOM, a wasm load failure — all land here.
		return null;
	}
}
```

### Reading tags back (D-03's read side, consumed by Phase 34)

```typescript
// Source: verified live — readTags returns string[] per field, readCoverArt returns raw bytes.
export async function readAudioTags(bytes: Uint8Array): Promise<AudioTagFields | null> {
	try {
		const { readTags } = await import('taglib-wasm/simple');
		const t = await readTags(bytes);
		return {
			title: t.title?.[0],
			artist: t.artist?.[0],
			album: t.album?.[0],
			albumArtist: t.albumArtist?.[0],
			trackNumber: typeof t.trackNumber === 'string' ? t.trackNumber : undefined
		};
	} catch {
		return null; // Phase 34 D-16: an untagged/unreadable file still imports, via filename parsing
	}
}
```

### The `download-track.ts` seam (the whole integration, one block)

```typescript
// Insert between readBlobWithProgress(...) and the blobStore.put / saveBlobToDisk calls.
// Everything above and below is UNCHANGED — D-17 NEVER-THROWS and D-18 ISOLATION hold by construction.

const ext = extFromAudioUrl(r.audioUrl);                      // filename only (Pitfall 3)
const dnArtist = names.dnArtist(r.artist);                    // Pattern 5: tag and filename agree
const dnTitle = names.dnTitle(r.title);
const filename = buildDownloadFilename(dnArtist, dnTitle, ext);

// 36-D-13/D-14: reuse the ONE artwork resolver. 6s-bounded, 1MB-capped, CORS-tiered. Null on miss.
const artUrl = await resolveArtworkDataUrl({ cover: r.cover, title: dnTitle, artist: dnArtist });
const blob = await tagAudioBlob(rawBlob, {
	title: dnTitle,
	artist: dnArtist,
	album: r.album || undefined,                              // 36-D-10
	albumArtist: opts?.albumArtist ?? dnArtist,               // 36-D-12
	trackNumber: opts?.trackNumber                            // 36-D-11 — album loop ONLY
}, artUrl);
// tagAudioBlob NEVER throws and returns `rawBlob` unchanged on any failure (36-D-06).
```

### D-11/D-12 threading without widening the signature for every caller

`downloadTrack` already takes an options bag (`{ persist?, save? }`). Add two optional keys to it:

```typescript
opts?: { persist?: boolean; save?: boolean; trackNumber?: string; albumArtist?: string }
```

Only `album/[name]/+page.svelte`'s `downloadAlbum` passes them:

```typescript
for (const [i, tr] of resolved.entries()) {
	const res = await downloadTrack(tr, {
		persist: false,
		trackNumber: String(i + 1),   // 36-D-11: REAL album order from THIS page's resolved list.
		albumArtist: albumArtistName  // 36-D-12: the album page's artist, not tr.artist.
	});
	…
}
```

`i + 1` over `resolved` is the album page's own ordering, which is real album position — **not**
`tr.displayIndex`, which D-11 forbids. TrackMenu, DownloadControl and the player repair path pass
neither key and get no track number, exactly as D-11 requires.

---

## Verified byte-layout facts (what the library actually produces)

Everything in this section was produced by tagging a real fixture and parsing the output.

### ID3v2 (mp3)

```
ID3 v2.4.0, flags 0x00, tag size 1115
  TALB  6  enc=3 (UTF-8)  "Album"
  TPE2 13  enc=3          "Album Artist"      ← album artist
  TPE1  7  enc=3          "Artist"
  TIT2 13  enc=3          "標題 Title"          ← CJK survives
  TRCK  2  enc=3          "7"
  APIC 94  enc=0  "image/png\0" type=0x03 (Front cover) "Front Cover\0" <PNG bytes>
```

### MP4 / M4A — atom tree after tagging (moov-first fixture)

```
ftyp 28
moov 1746
  mvhd / trak(tkhd, mdia(mdhd, hdlr, minf(smhd, dinf, stbl(stsd, stts, stsc, stsz, stco))))
  udta 1086
    meta 1078
      hdlr 34
      ilst 453
        ---- 188   ← iTunSMPB gapless info, PRESERVED from the source encoder, not injected
        aART 36    ← album artist
        covr 94    ← cover art
        trkn 32    ← track number
        ©ART 30 / ©alb 29 / ©nam 36
      free 579     ← padding TagLib leaves for future edits
free 3150
mdat 4236
```

Exactly the `©nam`/`©ART`/`aART`/`trkn`/`covr` set D-02 names. **`stco` survived intact and `afinfo`
decodes the file with the correct `audio bytes: 4228`.** The `----` freeform atom is
`com.apple.iTunes / iTunSMPB` carried over from the source encoder — TagLib preserves it and injects
nothing of its own, so **D-08 is satisfied: no provenance/encoder stamp is written.**

**The non-faststart case, tested explicitly.** A hand-built `ftyp / mdat / moov` layout (mdat before
moov, `stco` offsets patched to match) tagged cleanly: output stayed `ftyp / mdat / moov`, moov grew
at the end, `mdat` never moved, and `afinfo` reported identical duration and audio byte count. TagLib
sidesteps the offset problem in that layout rather than needing to rewrite `stco` at all.

### FLAC — metadata block chain after tagging

```
fLaC
  STREAMINFO      size=34   last=0
  VORBIS_COMMENT  size=153  last=0
  PICTURE         size=122  last=0
  PADDING         size=3970 last=1   ← regenerated, last-block flag correct
  audio frames start at 4299
```

Vorbis comment contents (vendor string **preserved** from the original encoder, not overwritten):

```
vendor: Apple
  ALBUM=Album
  ALBUMARTIST=Album Artist
  ARTIST=Artist
  TITLE=標題 Title
  TRACKNUMBER=7
  WAVEFORMATEXTENSIBLE_CHANNEL_MASK=0x4   ← pre-existing, preserved
```

TagLib regenerates padding so a *subsequent* small edit can be done without rewriting the stream; the
first write of a large PICTURE block does rewrite the file. That is why the memory figure in Pitfall 2
is what it is.

---

## Android MediaStore scanner behaviour (D-15)

**Question:** does the scanner read in-file tags for a file the app inserted via MediaStore on API 29+?
**Answer: YES — confirmed at AOSP source level, not inferred.**

`ModernMediaScanner.scanItemAudio()` (`packages/providers/MediaProvider`) builds an upsert and, inside
it, opens the file with `MediaMetadataRetriever` and calls `withRetrieverValues()`, which writes:

| MediaStore column | Source |
|---|---|
| `MediaColumns.TITLE` | `METADATA_KEY_TITLE` |
| `MediaColumns.ARTIST` | `firstPresent(METADATA_KEY_ARTIST, METADATA_KEY_ALBUMARTIST)` |
| `MediaColumns.ALBUM` | `METADATA_KEY_ALBUM` |
| `MediaColumns.ALBUM_ARTIST` | `METADATA_KEY_ALBUMARTIST` |
| `AudioColumns.TRACK` | `parseOptionalTrack(mmr)` — `disc * 1000 + track` when both present |
| `MediaColumns.DURATION` / `YEAR` / `GENRE` / `DISC_NUMBER` / `BITRATE` | corresponding retriever keys |

`[VERIFIED: aosp-mirror/platform_packages_providers_mediaprovider master, ModernMediaScanner.java lines 1300-1340 and 1456-1498]`

**The critical secondary finding — D-15's stated fallback would NOT work.** The same upsert
*pre-sets* defaults before the retriever values land:

```java
op.withValue(MediaColumns.ARTIST, UNKNOWN_STRING);                      // "<unknown>"
op.withValue(MediaColumns.ALBUM, file.getParentFile().getName());       // → "OpenMusic"
op.withValue(AudioColumns.TRACK, null);
op.withValue(MediaColumns.TITLE, FileUtils.extractFileName(file.getName()));  // in withGenericValues
```

and `withOptionalValue` only overwrites when the retriever actually produced a value. Because this is
an **upsert over the whole row**, any `ContentValues` the app supplied at insert time for
`TITLE`/`ARTIST`/`ALBUM` are replaced by the scanner's derived values. **If the on-device test shows
the scanner not picking up our tags, adding `ContentValues` columns will not durably fix it** — the
real fix in that case would be making the tags readable by `MediaMetadataRetriever` (most likely an
ID3v2.3 fallback on the MP3 branch, per Pitfall 4). The planner should record this so the D-15
fallback is not reached for reflexively.

**When does the scan run?** `resolver.update(uri, {IS_PENDING: 0})` is the documented trigger for
MediaProvider to scan the now-complete file — which is exactly what `performSave` already does. On
API ≤ 28 the plugin already calls `MediaScannerConnection.scanFile`. `[ASSUMED — the IS_PENDING→0
scan trigger is documented behaviour but was not source-verified in MediaProvider.java this session.]`

**OEM variation:** genuinely unknown to this research. `[ASSUMED]`

**Minimum evidence a device test needs to confirm or refute D-15:**

1. Build and install (`JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home pnpm apk`
   — the existing `apk-build-needs-jdk21` note).
2. Download **one m4a and one FLAC** (Phase 32 makes this the real mix) from an **album page** so
   track number and album artist are both populated.
3. Open the stock **Files** app → `Music/OpenMusic/` → confirm the files exist with the human filename.
4. Open the device's **own music player** (not OpenMusic) and confirm, per file: title, artist, album,
   **album grouping** (both tracks under one album, not two one-song albums), track number ordering,
   and **cover art thumbnail**.
5. The refutation signal is specific: **album shows as "OpenMusic" and artist as `<unknown>`** means
   the scanner read nothing (Pitfall 5's default path). Album showing the real name but art missing is
   a *different* failure (cover-art resolution, not scanning).
6. Repeat once after a reboot, to rule out a stale MediaProvider cache.

---

## The integration seam — audit result

**Confirmed: tagging the blob between `readBlobWithProgress` and `blobStore.put` / `saveBlobToDisk`
covers every save path.** There are exactly four callers of `downloadTrack` and all four route
through that single point:

| Caller | File:line | Options | Gets tagged? |
|---|---|---|---|
| TrackMenu (song menu) | `TrackMenu.svelte:189` | defaults | ✅ web save + offline blob + native public copy |
| DownloadControl (row/header button) | `DownloadControl.svelte:68` | `{ persist }` | ✅ same |
| Album bulk loop | `album/[name]/+page.svelte:428` | `{ persist: false }` | ✅ **web save only** — `persist:false` skips `blobStore.put`, so on native there is no offline blob and no public copy at all |
| Player background repair | `player.svelte.ts:2121` | `{ save: false }` | ✅ **offline blob only** — returns `'saved'` before `saveBlobToDisk` |

**Nothing bypasses it.** `saveBlobToDisk` and `blobStore.put` have no other callers on the download
path (`blobStore.put` is otherwise only reached from this function).

**Contracts that must survive, and why they do:**

- **D-17 NEVER-THROWS** — `tagAudioBlob` returns the original blob on any failure and never rejects,
  so `downloadTrack` gains no new throw site. The existing outer `try/catch` is untouched.
- **D-18 DOWNLOAD ISOLATION** — the tagger reads `r` (already a copy), `names.dn*` (read-only), and
  calls `resolveArtworkDataUrl` (its own `fetch`). It never touches `player.current`, `playGen`, the
  shared `<audio>`, or the track's `lrc`. **One thing to watch:** `resolveArtworkDataUrl` issues a
  network request on the download path. It is bounded (6 s, 1 MB) and D-14 explicitly accepts the
  wait, but it does mean the download path makes one more request than before — note it against the
  `api-fetch-flood` history. It is a *raw* `fetch`, not `apiFetch`, for the direct CDN tier; the
  `/api/og` tier goes through `apiUrl` and is therefore already governed.
- **DL-BUG-01** — unchanged; no new navigation, no new picker.
- **DL-STATE-01** — unchanged; `beginDownload`/`endDownload` still bracket everything.

**The album-loop asymmetry is worth surfacing to the user in the plan:** album downloads are tagged,
but on native they produce no public `Music/OpenMusic/` file at all — so the device music player will
not see them regardless of how good the tags are. That is pre-existing behaviour
(`persist: false`, documented as a Phase-29 limitation), not something this phase introduces, but it
does blunt the phase's headline benefit for exactly the use case (whole albums) where album artist and
track numbers matter most. **Flagging it, not fixing it** — changing it is a scope decision, not a
research finding.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "Browser JS can only write ID3 (`browser-id3-writer`); m4a/FLAC need a server" | A maintained wasm TagLib build covers all three containers client-side | `taglib-wasm` 1.x → 2.x, 2025-06 → 2026-08 | The reason D-01's dependency exception buys so much: this option did not meaningfully exist two years ago. |
| `jsmediatags` (last publish 2021/2022) as the default tag reader | `music-metadata` for reading; `taglib-wasm` when writing is needed | ~2023 onward | `jsmediatags` is effectively unmaintained; do not reach for it. |
| Legacy `MediaScannerConnection.scanFile` + `WRITE_EXTERNAL_STORAGE` | MediaStore `RELATIVE_PATH` + `IS_PENDING` on API 29+, no runtime permission for app-owned rows | Android 10 (2019) | Already implemented correctly in `MediaStoreSaverPlugin.kt`; nothing to change. |

**Deprecated/outdated — do not use:**

- `jsmediatags` (2022, read-only), `id3js` (2019/2022, read-only), `flac-metadata` (2022),
  `metaflac-js` (2022, Node-only), `id3-writer` (2022, **LGPL**, native bindings to id3lib/eyeD3 — a
  server package, not usable in a browser at all).

---

## Licensing

| Artifact | License | Implication for a deployed app |
|---|---|---|
| `taglib-wasm` npm wrapper + TS source | **MIT** (LICENSE file in the published tarball, © 2025 Charles Wiltgen) | None. |
| The bundled `taglib-web.wasm` — compiled **TagLib** | **Dual LGPL-2.1 / MPL-1.1** | TagLib's own README: *"TagLib is distributed under the GNU Lesser General Public License (LGPL) and Mozilla Public License (MPL). Essentially that means that it may be used in proprietary applications, but if changes are made to TagLib they must be contributed back."* `[CITED: github.com/taglib/taglib README + COPYING.LGPL + COPYING.MPL]` |

**What this means concretely, since the question specifically asks about a bundled wasm artifact:**

- Shipping an **unmodified** compiled TagLib is fine under either arm of the dual licence. Both are
  weak copyleft — neither reaches the application that links to it. OpenMusic's own source is on
  GitHub anyway, so the LGPL relinking concern is moot in practice.
- **Attribution is still an obligation and is currently missing.** The published npm package ships
  only its own MIT `LICENSE`; it does **not** include `COPYING.LGPL` / `COPYING.MPL` or a TagLib
  copyright notice. GitHub reports the repo's licence as `NOASSERTION`. So the app inherits an
  unfulfilled notice requirement by default.
- **Action for the plan (small, one task):** add a TagLib attribution line to
  `src/routes/(app)/settings/about/+page.svelte` (or a `NOTICE` file), naming TagLib, its dual
  LGPL/MPL licence, and a link to the licence text. Remember the i18n double-quote convention for any
  new string key.
- **Do not modify the wasm.** Modification triggers the contribute-back obligation. We only consume it.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Android's stock ID3 parser reads ID3v2.4 reliably; OEM players may not | Pitfall 4 | An MP3 download shows no metadata on some devices. Mitigation is a hand-written 2.3 post-pass on the MP3 branch — scoped but real. Only affects the fallback-ladder mp3 slice of downloads. |
| A2 | OEM MediaStore scanner behaviour matches AOSP | MediaStore section | D-15's premise fails on that OEM; the named `ContentValues` fallback would not save it (see the refutation above). |
| A3 | `resolver.update(IS_PENDING → 0)` is what triggers MediaProvider's scan | MediaStore section | If not, `MediaStore.scanFile(resolver, file)` would need to be called explicitly after the flip. Cheap to add; cheap to test. |
| A4 | SvelteKit's `$service-worker` `build` array includes emitted non-JS assets (the `.wasm`) | Runtime State Inventory | If false, nothing to fix. If true and unfixed, 686 kB of install-time precache for every PWA user. Verify with one `pnpm build` + grep. |
| A5 | The Capacitor Android WebView loads the emitted `.wasm` asset successfully | Environment Availability | The whole native path fails. Partially de-risked: the Emscripten glue has the standard `instantiateStreaming → catch → instantiateArrayBuffer` fallback (verified in the shipped wrapper), so a wrong `application/wasm` MIME from Capacitor's local server degrades to a slower compile rather than a failure. Still device-only to confirm. |
| A6 | `TAG_MAX_BYTES = 40 MB` is the right ceiling for an Android WebView | Pitfall 2 | Too low → large FLACs silently untagged. Too high → OOM kill. The 6×-file-size figure is measured on desktop node; a WebView's ceiling is device-specific. Tune on the emulator. |
| A7 | Node 24 does not break the SvelteKit / wrangler / adapter-cloudflare / Capacitor build | Node Engine Blocker | The Wave-0 bump fails and the phase needs the vendored-wasm fallback. Gate it with a full build before writing any tagging code. |
| A8 | Cloudflare Pages honours `.nvmrc` for the build image | Node Engine Blocker | Pages builds on Node 22 while local/CI use 24. Pages also honours a `NODE_VERSION` environment variable — set both. |

---

## Open Questions

1. **Where does the retag control actually live?**
   - What we know: D-17 says "the Settings download page". `src/routes/(app)/settings/` contains
     `about`, `activity`, `appearance`, `data`, `general`, `home`, `lastfm`, `playback`, `translation`
     — **there is no `download/` route.** Download *quality* lives in `settings/playback`; the
     downloads *list* lives in `library?tab=downloads`. Phase 34's context flagged the same gap for its
     import button and rules panel.
   - What's unclear: whether Phase 36 creates `settings/downloads/` (and Phase 34 later joins it), or
     whether the retag control is appended to `settings/playback` next to download quality.
   - Recommendation: **create `src/routes/(app)/settings/downloads/+page.svelte`** and move nothing.
     Phase 34's import button + rules panel and this retag control then share one obvious home, and
     `settings/playback` stays about playback. Confirm with the user before building — it changes the
     settings index. Needs new i18n keys across all 16 locale dictionaries (double quotes, `en` is the
     reference, `i18n.test.ts` guards key-set parity).

2. **Does the retag need a "tagged" marker, or is it idempotent enough to just re-run?**
   - What we know: retagging an already-tagged file is harmless (taglib overwrites), just wasteful.
   - What's unclear: whether the button should say "Retag 42 downloads" or "Retag all downloads".
   - Recommendation: **no marker.** Ship "Retag all downloads (42)" with per-file results, and skip the
     extra localStorage key. D-17 makes it explicitly user-triggered, so re-running is the user's
     choice, and a marker is state that can drift out of sync with the disk. (`ponytail:` skipped the
     tagged-set index; add it only if a user complains about retag time.)

3. **Should the album-bulk path's `persist: false` change?**
   - What we know: album downloads produce no native public copy, so the tags this phase writes are
     invisible to the device music player for exactly the album use case that motivates album artist
     and track numbers.
   - What's unclear: whether flipping it is in scope. It was a deliberate Phase-29 limitation.
   - Recommendation: **out of scope for Phase 36** — but the plan should state the limitation in the
     summary and the phase should not claim "your albums now group correctly on your phone" without it.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥ 24 | `taglib-wasm` install under `engine-strict=true` | ✗ (project pins 22) | `.nvmrc` = 22, CI = 22, local shell = 25.9.0 | Vendor the wasm + wrapper into the repo, drop the npm dep |
| pnpm 8.15.5 | install | ✓ | pinned via `packageManager` | — |
| `taglib-wasm` on Node 22 at **runtime** | tests, if the bump is deferred | ✓ | runs correctly despite the engines field (verified) | — |
| Vitest 4.1.3 node env | round-trip tests | ✓ | 3/3 fixtures passed in 33 ms (verified) | — |
| Vite 8.0.16 asset emission of `.wasm` | web + native builds | ✓ | emits `taglib-web-<hash>.wasm` as a separate hashed asset with the URL rewritten (verified in a real app build) | — |
| WebAssembly in Android WebView | the native path | ✗ **unverified — device only** | — | Emscripten's `instantiateStreaming → instantiateArrayBuffer` fallback covers a wrong MIME type (verified present in the shipped wrapper); a total absence of WASM has no fallback |
| `ffmpeg` | generating test fixtures | ✗ | not installed | **macOS `say` + `afconvert`** — verified working, produced valid m4a and FLAC this session |
| JDK 21 | `pnpm apk` for device verification | ✓ (Homebrew `openjdk@21`) | must set `JAVA_HOME` explicitly (existing project note) | — |
| Android emulator (`Pixel_3a_API_34`) + CDP | WebView memory + tag verification without a phone | ✓ (existing project note `apk-debug-via-emulator-cdp`) | — | a physical device |

**Missing dependencies with no fallback:**

- WebAssembly support in the target Android WebView — must be confirmed on device before the native
  half of this phase can be called done. (WebView has shipped WASM since v57 / 2017 and auto-updates
  via Play Store, so the practical risk is low, but it is unverified here.)

**Missing dependencies with fallback:**

- Node 24: fallback is vendoring the wasm.
- `ffmpeg`: fallback (and recommendation) is `say` + `afconvert`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.3`, single project `server`, `environment: 'node'`, **no jsdom** |
| Config file | `vite.config.ts` (`test.projects[0]`), include `src/**/*.{test,spec}.{js,ts}` |
| Quick run command | `pnpm vitest --run src/lib/services/audio-tags.test.ts` |
| Full suite command | `pnpm test` (`vitest --run`, ~67 test files) |

**Verified this session:** `taglib-wasm` works unmodified under Vitest 4.1.3 / `environment: 'node'` —
a 3-case round-trip suite (mp3, m4a, flac; title + albumArtist) passed in **33 ms**. No jsdom, no
`FileReader`, no DOM. The existing single-project setup needs no change.

### Phase Requirements → Test Map

| Req | Behaviour | Test Type | Automated Command | File Exists? |
|-----|-----------|-----------|-------------------|--------------|
| D-02 | mp3 round-trips title/artist/album/albumArtist/track/cover | unit | `pnpm vitest --run -t "mp3 round-trip"` | ❌ Wave 0 |
| D-02 | m4a writes `©nam`/`©ART`/`©alb`/`aART`/`trkn`/`covr` and still parses | unit | `… -t "m4a round-trip"` | ❌ Wave 0 |
| D-02 | flac writes VORBIS_COMMENT + PICTURE with a correct last-block flag | unit | `… -t "flac round-trip"` | ❌ Wave 0 |
| D-03 | `readAudioTags(writeAudioTags(x)) === fields` for all three | unit | `… -t "round-trip"` | ❌ Wave 0 |
| D-06 | a garbage/unknown buffer returns `null`, never throws | unit | `… -t "unknown container"` | ❌ Wave 0 |
| D-06 | `downloadTrack` returns `'saved'` when the tagger returns `null` | unit | `pnpm vitest --run src/lib/services/download-track.test.ts` | ✅ extend |
| D-07/D-08 | output contains **no** year, genre, comment or encoder field | unit | `… -t "omits"` — assert via `readTags` that those keys are absent | ❌ Wave 0 |
| D-10 | an empty `album` produces no ALBUM tag (not `""`, not a placeholder) | unit | `… -t "omits album"` | ❌ Wave 0 |
| D-11 | `downloadTrack` without `opts.trackNumber` writes no track number; `displayIndex` never appears | unit + grep guard | `… -t "no track number"` | ❌ Wave 0 |
| D-12 | album loop passes the album-page artist as albumArtist | unit | album page or a `downloadTrack` opts test | ❌ Wave 0 |
| D-17 | `tagAudioBlob` never rejects (throwing tagger → original blob) | unit | `… -t "never throws"` | ❌ Wave 0 |
| D-18 | tagging touches no player state | grep-assert (existing pattern) | `download-track.test.ts` isolation block | ✅ extend |
| D-19 | one failing file in a retag batch does not abort the rest | unit | `src/lib/services/retag.test.ts` | ❌ Wave 0 |
| — | the tagged blob keeps its MIME type | unit | `… -t "preserves mime"` | ❌ Wave 0 |
| — | a blob over `TAG_MAX_BYTES` is returned untagged | unit | `… -t "size ceiling"` | ❌ Wave 0 |
| D-15 | device player shows title/artist/album grouping/track order/cover | **manual, device only** | `pnpm apk` + the 6-step checklist above | manual |

### Sampling Rate

- **Per task commit:** `pnpm vitest --run src/lib/services/audio-tags.test.ts src/lib/services/download-track.test.ts`
- **Per wave merge:** `pnpm test && pnpm check`
- **Phase gate:** full suite green **and** the on-device D-15 checklist passed before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `.nvmrc` / `package.json engines` / 3 workflows → Node 24; full `install && check && test && build` gate — **blocks everything else**
- [ ] `pnpm add taglib-wasm@2.2.2` (exact pin)
- [ ] `src/lib/services/audio-tags.ts` — the module itself
- [ ] `src/lib/services/audio-tags.test.ts` — round-trip suite
- [ ] `tests/fixtures/tiny.{mp3,m4a,flac}` — see below
- [ ] `src/service-worker.ts` — verify and, if needed, exclude `.wasm` from `ASSETS`

### Test fixtures — concrete recipe, sizes and licensing

Committing three tiny synthetic files is the right call: generated-at-test-time needs an encoder the
CI box may not have, and downloading real audio is a licensing problem. All three below were
**generated and verified in this session** and are licensing-clean (synthetic TTS / hand-built frames,
no third-party recording).

```bash
# m4a — ~8.3 kB. macOS `say` + `afconvert`, both preinstalled.
say -o src.aiff "test tone"
afconvert -f m4af -d aac -b 32000 src.aiff tiny.m4a

# flac — ~22 kB
afconvert -f flac -d flac src.aiff tiny.flac

# mp3 — ~8.3 kB. Hand-built silent MPEG-1 Layer III frames; no encoder needed, works anywhere.
python3 -c "open('tiny.mp3','wb').write((bytes([0xFF,0xFB,0x90,0x00])+b'\x00'*413)*20)"
```

Total committed: **~39 kB**. Each was confirmed to parse (`readFormat` → MP3 / MP4 / FLAC), tag, and
still decode afterwards (`afinfo`). Generate them once on a Mac, commit the binaries, and note the
recipe in a `tests/fixtures/README.md` so a Linux contributor can regenerate.

**Add a fourth fixture: a non-faststart (`mdat`-first) m4a.** It is the specific layout that breaks
naive MP4 taggers, and this session's hand-built version is easy to reproduce (relocate `moov` after
`mdat`, add the byte delta to every `stco` entry). It is the single highest-value regression test in
the suite because a failure there is silent file corruption, not a visible error.

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth on this path. |
| V3 Session Management | no | — |
| V4 Access Control | no | Only app-owned files are written (`OWNER_PACKAGE_NAME`; no `RecoverableSecurityException` path). |
| V5 Input Validation | **yes** | Cover-art bytes come from the network. `media-artwork.ts` already enforces: `https` only (`hasHttpsScheme`), `content-type` must start with `image/`, `0 < byteLength ≤ MAX_ART_BYTES` (1 MB), 6 s timeout. Do not relax any of these. `/api/og` remains **text-only** (title+artist), never a URL — that restriction is the T-24-08 / T-wv8-01 security control and is not touched. |
| V6 Cryptography | no | No crypto. |
| V12 File Upload / Handling | **yes** | Filenames already go through `buildDownloadFilename`'s `/[/\\?%*:|"<>]/g` sanitize, which blocks `../` traversal and MediaStore `RELATIVE_PATH` escape (T-29-01-01). Tagging does not change the filename path. |

### Known threat patterns for this stack

| Pattern | STRIDE | Standard mitigation |
|---|---|---|
| Malicious/oversized image inflating the audio file or OOM-ing the WebView | Denial of Service | `MAX_ART_BYTES = 1 MB` (existing) + `TAG_MAX_BYTES` on the audio (new). |
| Hostile audio bytes crashing the wasm parser | Denial of Service | wasm is memory-sandboxed — a parser bug is a trap inside the module, not RCE on the host. The `try/catch` → return-original (D-06) turns a trap into an untagged save. |
| Supply-chain: a compromised `taglib-wasm` release ships a hostile wasm | Tampering / Elevation | Exact version pin, `--frozen-lockfile` CI, no auto-bump, vendoring as the escape hatch. **This is the real residual risk of D-01's exception** and it should be named as such in the plan, not buried. |
| Path traversal via a crafted title into the filename | Tampering | Already mitigated by the existing sanitize; unchanged. |
| Cover URL used to probe internal hosts (SSRF) | Information Disclosure | `/api/og` is host-allowlisted and text-only; the direct tier is `https`-only and client-side. Unchanged. |

---

## Sources

### Primary (HIGH confidence — verified by direct execution or authoritative source)

- **Hands-on round-trip testing of `taglib-wasm@2.2.2`** (this session): all three containers tagged
  and read back; CJK text, albumArtist, track number and cover art verified; outputs re-validated with
  `afinfo`; non-faststart M4A case tested explicitly.
- **Memory/time measurement** on a 50.5 MB FLAC: 29 ms single-pass, ~392 MB peak RSS, heap
  non-shrinking across repeats.
- **Vite 8.0.16 real app build**: asset emission, file names and gzip sizes.
- **Vitest 4.1.3 node-environment run**: 3/3 round-trip tests pass.
- **`pnpm` install failure reproduction** on Node 22 + `engine-strict=true`, and the
  `packageExtensions` override failing too.
- AOSP `ModernMediaScanner.java` (aosp-mirror master) — `scanItemAudio`, `withRetrieverValues`,
  `withOptionalValue`, the `UNKNOWN_STRING` / parent-folder-name defaults.
- `taglib-wasm@2.2.2` published `.d.ts` files (`TagInput`, `AudioFile`, `MutableTag`, simple API).
- github.com/taglib/taglib README + `COPYING.LGPL` + `COPYING.MPL` — the dual licence.
- Published tarballs of `mp3tag.js`, `mp4-tag`, `browser-id3-writer`, `metaflac-js` (README + source
  + package.json read directly).
- Project source: `download-track.ts`, `download-save.ts`, `download-filename.ts`, `media-artwork.ts`,
  `blob-store.ts`, `download-progress.ts`, `service-worker.ts`, `sources/types.ts`,
  `MediaStoreSaverPlugin.kt`, `package.json`, `vite.config.ts`, `.npmrc`, `.nvmrc`, the 3 workflows.
- `slopcheck install` on all five candidate packages.
- npm registry (`npm view`) + `api.npmjs.org/downloads` + `api.github.com` repo metadata.

### Secondary (MEDIUM confidence)

- developer.android.com — *Access media files from shared storage*: update via MediaStore, the
  `r`/`w`/`rwt` modes, `OWNER_PACKAGE_NAME` ownership rules, `RecoverableSecurityException` only for
  other apps' files.
- commonsware.com — *How to Create Media*: `IS_PENDING` semantics.

### Tertiary (LOW confidence — flagged, not relied on)

- General web search on OEM media-scanner variation returned nothing authoritative. Recorded as
  assumption A2, to be settled by the device test.
- ID3v2.3-vs-2.4 Android player compatibility: widely repeated community guidance that 2.3 is safer,
  not verified against a device here. Assumption A1.

---

## Metadata

**Confidence breakdown:**

- Standard stack / dependency choice: **HIGH** — chosen by execution, not recollection; every rejected
  alternative was rejected on a fact read out of its own published package.
- Byte layout and container correctness: **HIGH** — the produced bytes were parsed and the files
  re-decoded, including the non-faststart MP4 trap case.
- Cost figures (bundle, memory, time): **HIGH** — measured, with the exact commands reproducible.
- Node engine blocker: **HIGH** — failure and the runtime-works-anyway finding both reproduced.
- Android scanner semantics: **HIGH** on AOSP behaviour (read from source); **LOW** on OEM variation.
- Capacitor WebView behaviour: **MEDIUM** — the streaming-fallback path was verified in the shipped
  code, but nothing was run on a device or emulator.
- Service-worker precache impact: **MEDIUM** — mechanism is clear, the `build` array's exact contents
  were not confirmed against a real build.

**Research date:** 2026-09-13
**Valid until:** ~2026-10-13 (30 days). `taglib-wasm` is on a fast release cadence (1.5.3 → 2.2.2
within a year); re-check `engines.node` and the browser API surface before a later re-plan.
