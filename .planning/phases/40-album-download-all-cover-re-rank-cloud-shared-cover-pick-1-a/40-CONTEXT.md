# Phase 40: Album download-all + cover re-rank + cloud-shared cover pick - Context

**Gathered:** 2026-09-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Three deliverables, nothing more:

1. **Album download-all works** — the album page's download button (currently commented out at
   `src/routes/(app)/album/[name]/+page.svelte:694` because it "fails") downloads every song of the album
   into an album folder on the device.
2. **Cover re-rank** — QQ and iTunes covers rank highest; YT Music covers stop dominating.
3. **Cloud-shared cover pick** — a cover chosen in the "Change cover" picker is stored server-side and
   auto-applied for all users, modelled on the shared lyric-offset store.

Root cause already found for (1): `downloadAlbum()` passes `persist:false` to `downloadTrack`, which skips
`blobStore.put` → skips the native `Music/OpenMusic/` MediaStore write. On Android an album download
produces no public file at all (documented as a known Phase 29/36 limitation in the comment above
`downloadAlbum`).

</domain>

<decisions>
## Implementation Decisions

### Album download — folder + platforms
- **D-01:** Android: album songs land in `Music/OpenMusic/<Artist>/<Album>/` (album artist, album name;
  sanitize both for path safety). Requires the `MediaStoreSaver` plugin's `saveToMusic` to accept a
  sub-path (API 29+ `RELATIVE_PATH`; API ≤28 legacy `File(musicDir, "OpenMusic/<Artist>/<Album>")`).
- **D-02:** Single-song downloads are UNCHANGED — they stay flat in `Music/OpenMusic/`. Existing files are
  never re-filed.
- **D-03:** Web/PWA: one `.zip` per album (a browser cannot create folders); unzipping yields an
  `<Artist> - <Album>/` (or `<Album>/`) folder of the tagged files. One save prompt instead of one per song.
  Store-only zip (no compression needed for audio) — prefer a small hand-written writer over a new npm
  dependency (project has NO third-party runtime deps; see CLAUDE.md).
- **D-04:** Album downloads keep the offline copy — `persist:true`, same as single songs. They appear in
  library Downloads and play offline. (On Android the public write rides on the offline copy, so this is
  the natural fix.)
- **D-05:** A song in the album that is ALREADY downloaded as a single is **MOVED** (not copied, not
  skipped) into the album folder. On Android this means relocating the app-owned MediaStore row
  (update `RELATIVE_PATH` on API 29+; file rename on ≤28) and updating the stored content URI. On web the
  already-held offline blob is reused for the zip entry (no re-fetch). The library record stays one entry.
- **D-06:** Progress: reuse the toast — `Downloading n/total` while running, then a final
  `Saved X of Y` count. Failed songs are skipped, never abort the album. Button stays disabled
  (`busyAction === 'download'`) while running.
- **D-07:** Un-comment the album download button once it works.

### Cover rank
- **D-08:** New automatic chain (`resolveTrackChain` in `src/lib/services/cover-backfill.ts`, the single
  source of truth for every consumer): **QQ → iTunes → Deezer → other CN → YTM**. QQ becomes its OWN tier 1
  (aimed via `onlySource('qq')`, same shape as the existing `ytmusicSongCover`). "Other CN" excludes BOTH
  qq (already tried) and ytmusic — today's `searchAll(..., {})` CN tier can pick a ytmusic row via
  `dedupeBest`, which is one way YTM covers leak into "Now Playing / lists generally".
- **D-09:** A track's OWN inline cover is kept — including a ytmusic-sourced track's own YTM thumbnail.
  The chain only applies where a cover must be resolved. (User: "ytmusic sourced track should keep its own
  thumbnail.")
- **D-10:** Change-cover picker grid order (`collectCoverCandidates`): current cover, QQ, iTunes, Deezer,
  other CN, YTM. Remove ytmusic (and qq) from the CN tier so each source appears exactly once.
- **D-11:** Update the HQ-upgrade path and the module-header rank comments in `cover-backfill.ts` to match;
  keep the `quick-260920-nyq` history comments, add a Phase 40 decision ref.
- **D-12:** CHECK `share-carrier-grammar` before reordering: the `?ci=` share carrier is a closed host tag
  set tied to the cover tier chain — reordering silently killed share-card art once before (memory:
  share-carrier-grammar-tracks-cover-chain). QQ-first must keep share cards working.

### Shared cover — identity + precedence
- **D-13:** Key: BOTH — exact uid first, then song name (artist+title `matchKey`), mirroring the cover
  cache's uid → name read order. A pick made on the qq copy therefore also reaches the kuwo/netease/YTM copy
  of the same song via the name layer.
- **D-14:** Precedence: **my local pin > crowd pick > track's inline cover > auto chain.** The crowd (an
  explicit human choice) may replace a ytmusic track's own thumbnail; the AUTO chain may not (D-09).
- **D-15:** Only explicit "Change cover" picker taps (`pickCover` in `TrackMenu.svelte`) upload a vote.
  Auto-resolved covers are never uploaded.
- **D-16:** Lookup happens on play / Now Playing only (one fetch per played song, edge-cached — the
  lyric-offset pattern). The result is written into the local cover cache so list rows benefit afterwards.
  No per-row cloud lookups.

### Shared cover — consensus
- **D-17:** Most votes wins, one vote per voter; a voter's new pick replaces their earlier one; ties go to
  the most recent. Same model as `src/lib/proxy/lyric-offset.ts` (`voterId`, `applyVote`, `consensus`).
- **D-18:** Only https URLs on known cover hosts are accepted — reuse `src/lib/proxy/safe-image-url.ts`.
  Existing allowlists cover Deezer, Apple (`.mzstatic.com`), YouTube, Last.fm, KKBOX; a CN allowlist
  (QQ `y.gtimg.cn`, kuwo, netease `music.126.net`, etc.) must be ADDED. Validate server-side on POST.
- **D-19:** Re-picking replaces my vote. No withdraw/undo endpoint; resetting a local pin does not touch the
  cloud vote.

### Claude's Discretion
- Storage: reuse the existing DIAG R2 bucket under a new `cover-pick/` prefix (lyric-offset precedent: no new
  binding — memory warns new bindings need human Cloudflare re-auth and break the build if the bucket is
  missing). Key = hash of uid / of name key, never raw user input.
- Route shape (`/api/cover-pick` GET+POST, verb-only exports), edge-cache + bust-after-vote, fail-closed 503
  when the binding is absent.
- Zip writer implementation, filename sanitization, and the exact toast wording (new i18n keys in ALL 16
  locales, double quotes).
- How the two shared lookups (uid, name) are combined into one request.

### Folded Todos
None.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Album download
- `src/routes/(app)/album/[name]/+page.svelte` — `downloadAlbum()` (~L445-487) + hidden button (L694); the
  comment block documents the persist:false limitation
- `src/lib/services/download-track.ts` — the ONE shared download path; contracts D-17 never-throws,
  D-18 playback isolation, DL-BUG-01, 36-D-06 tag-or-intact; `persist`/`save`/`trackNumber`/`albumArtist` opts
- `src/lib/services/download-save.ts` — browser anchor save seam
- `src/lib/services/blob-store.ts` — native put() → `saveToMusic`
- `src/lib/services/media-store.ts` — TS wrapper of the MediaStoreSaver plugin
- `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt` — `relativePath`
  (`Music/OpenMusic/`, L76), legacy path (L223)

### Cover rank
- `src/lib/services/cover-backfill.ts` — module header rank rationale, `resolveTrackChain`,
  `ytmusicSongCover` (template for a QQ tier), HQ upgrade, `collectCoverCandidates` (L576+)
- `src/lib/sources/registry.ts` — `onlySource`
- `src/lib/stores/cover-version.svelte.ts` — `readCoverByUidOrName` (PIN → uid → name), `pinCover`, `writeCoverBoth`
- `src/lib/services/cover-cache.ts` — key families + `PIN_KEY`

### Shared cover
- `src/routes/api/lyric-offset/+server.ts` — the R2 vote route to model on
- `src/lib/proxy/lyric-offset.ts` — key screen, vote parse, `applyVote`, `consensus`, `voterId`, TTL
- `src/lib/services/lyric-offset-shared.ts` — client never-throw fetch/vote, key hashing
- `src/lib/proxy/safe-image-url.ts` — host allowlists (SECURITY control; add CN hosts here)
- `src/lib/components/TrackMenu.svelte` — `openCoverPicker` / `pickCover` (L322-357)
- `src/lib/stores/player.svelte.ts` — `adoptCover` (the one promotion seam for the current track)

### Project constraints
- `CLAUDE.md` — Shared Primitives table, never-throw services, i18n double quotes, verb-only `+server.ts` exports
- `.claude/skills/spike-findings-openmusic/SKILL.md` — covers / API-call-reduction patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `downloadTrack(tr, opts)` — already does resolve → tag → save per song; album path just needs persist:true + a folder/zip sink.
- `ytmusicSongCover` — exact template for a `qqSongCover` tier via `onlySource('qq')`.
- lyric-offset proxy + client modules — complete vote/consensus/edge-cache/fail-closed pattern to clone.
- `safeImageUrl` + allowlists — URL screen for the vote POST.
- `writeCoverBoth` — the single cover-cache writer; route the crowd result through it.

### Established Patterns
- Never-throw services with sentinel returns; generation guards around async UI fetches.
- `apiFetch` governor for all `/api/*` calls (GET dedupe, concurrency cap, circuit breaker) — memory: api fetch-flood freeze.
- Media/blob bytes use raw fetch, not apiFetch.
- `+server.ts` may export only HTTP verbs — helpers in `$lib/proxy/*.ts`.

### Integration Points
- Album page `downloadAlbum()` → new folder-aware save (native) / zip save (web).
- `MediaStoreSaverPlugin.kt` → sub-path param + move-row capability (D-01, D-05).
- `resolveTrackChain` / `collectCoverCandidates` → tier reorder.
- `pickCover` → also POST vote; play()/Now Playing → GET crowd pick → `writeCoverBoth` + `adoptCover`.
- `readCoverByUidOrName` precedence must express D-14 (pin > crowd > inline > chain) — the crowd layer
  needs its own slot, or must be written so it outranks the inline cover on surfaces that read `track.cover` first.

</code_context>

<specifics>
## Specific Ideas

- "qq and itunes cover resolver is usually more accurate, and there is too many yt music covers"
- "the selected cover can be store in cloud and auto choose by all users just like lyrics"
- "ytmusic sourced track should keep its own thumbnail" — the auto chain must not override it.
- Already-downloaded single in an album: "move the file instead of copy".

</specifics>

<deferred>
## Deferred Ideas

- Re-filing existing single downloads into `<Artist>/<Album>/` — out of scope (D-02).
- Withdraw-vote endpoint / undo UI for shared covers — not now (D-19).

### Reviewed Todos (not folded)
- `pageog-hardcoded-site-origin.md` (PageOg hardcodes openmusic.lol) — matched only on the "openmusic" keyword; unrelated.

</deferred>

---

*Phase: 40-album-download-all-cover-re-rank-cloud-shared-cover-pick*
*Context gathered: 2026-09-30*
