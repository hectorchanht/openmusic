# Phase 37: Enrich imported device songs — Context

**Gathered:** 2026-09-15
**Status:** Ready for research + planning

<domain>
## Task Boundary

Imported (`device:`) tracks play as second-class citizens: no lyrics pane, no cover anywhere (hero / nowbar / OS media card), and no up-next list. Make an imported song behave like any other song — WITHOUT ever letting a network resolve supply its audio bytes.

Three verified causes:
1. `rowToTrack` (src/lib/services/device-track.ts:126) mints every imported track with `cover: null` and `lrc: null`; nothing ever fills them.
2. `ensureTrackDetails` (src/lib/services/catalog.ts:359) returns a `device:` uid untouched — correct per 34-D-01 (the file IS the resolve), but that early return also skips the lyric/cover enrichment a normal track gets on first play.
3. Playing an imported song from the library installs a `same-list` queue context, so there is no generated up-next to grow.
</domain>

<decisions>
## Implementation Decisions

### Up-next content for a local song
ONLINE SIMILAR SONGS — generate exactly as a streamed song does (similar-by-name, the existing Last.fm `track.getSimilar` path), so an imported song flows into the wider catalogue. Up-next entries will be songs the user does not own; that is accepted. Not "imported songs only", not a mixed/prefer-local ordering.

### When embedded tags are read
ON FIRST PLAY, PER SONG. No scan-time pass over the whole library and no idle backfill worker. Reading tags off hundreds of files through taglib-wasm at import is explicitly rejected (686 kB module, 40 MB per-file ceiling, an Emscripten heap that grows but never shrinks — a real risk of a killed WebView on Android). The first play of each imported song pays one bounded wasm decode.

### Enrichment order (from the phase description, not re-litigated)
Embedded tags FIRST (zero network — files downloaded from openmusic itself now carry both a FrontCover picture and the raw LRC), then a NAME-BASED online fallback when the file carries neither.

### Claude's Discretion
- Where the extracted embedded cover lives (the shared cover cache keyed by uid is the presumption, so every surface and the OS media card pick it up through the existing reactive read).
- How the name-based lyric lookup reaches a device track without going through the device-guarded `ensureTrackDetails` return.
- Whether the up-next generation needs a queue-context change, a device-specific branch, or neither.
</decisions>

<specifics>
## Specific Ideas

- `src/lib/services/audio-tags.ts` already READS title/artist/album/albumArtist/trackNumber and (as of quick-260915-062) LYRICS via taglib-wasm, and already WRITES a FrontCover picture — but has NO picture READ. A `getPictures`-equivalent read path is new work.
- Files downloaded from openmusic itself (post quick-260914-to2 / quick-260915-062) carry a real cover AND the raw LRC, so for that common case the data is already on the device and needs no network at all.
- The cover chain is already name-keyed and should work for a device track; lyrics are the piece with no name-based path today.
</specifics>

<canonical_refs>
## Canonical References — HARD CONSTRAINTS (pre-existing, do not break)

- **34-D-01**: a `device:` uid is an identity NAMESPACE, not a source. `track.source` on one is a PLACEHOLDER ('kuwo') that must NEVER be dispatched. No network resolve may ever produce an `audioUrl` for a device track — its bytes come from blobStore.
- **No re-resolve loops**: the device early-return sits deliberately ABOVE `isTrackReady` because a local file has no TTL and must never be judged stale. This codebase has been bitten by re-resolve loops three times (see .planning/debug/knowledge-base.md).
- **No fan-out**: enrichment must not fire a per-row network call across an imported library of hundreds of files. Anything running on play must be bounded and generation-guarded like every other async path in player.svelte.ts.
- **Cover must reach the OS media card**: that means an https URL or a `data:` URL, landing in the SHARED cover cache. See the four-instance history of cover-surface asymmetry bugs — `buildArtwork`'s https gate silently emits /favicon.svg for anything else, and the media card only ever shows what that gate accepts.
- **taglib-wasm cost**: ~686 kB lazy dynamic import, `TAG_MAX_BYTES` 40 MB per-file ceiling, heap grows but never shrinks.
</canonical_refs>
