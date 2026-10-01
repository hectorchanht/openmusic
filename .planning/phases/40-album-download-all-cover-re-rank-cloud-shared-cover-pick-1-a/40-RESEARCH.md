# Phase 40: Album download-all + cover re-rank + cloud-shared cover pick - Research

**Researched:** 2026-09-30
**Domain:** SvelteKit/Capacitor download pipeline (MediaStore, store-only ZIP), cover-resolution tier chain, R2 vote store on Cloudflare Workers
**Confidence:** HIGH for the code map and the flows (read end to end, plus live probes). MEDIUM for Android MediaStore move semantics, which need device UAT.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Album download — folder + platforms
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

#### Cover rank
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

#### Shared cover — identity + precedence
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

#### Shared cover — consensus
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

### Deferred Ideas (OUT OF SCOPE)
- Re-filing existing single downloads into `<Artist>/<Album>/` — out of scope (D-02).
- Withdraw-vote endpoint / undo UI for shared covers — not now (D-19).
- (Reviewed, not folded) `pageog-hardcoded-site-origin.md` — unrelated.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are assigned (`.planning/REQUIREMENTS.md` does not exist). Coverage comes from D-01..D-19:

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01 | Android `Music/OpenMusic/<Artist>/<Album>/` | Pattern 2 (Kotlin `subPath`), Pattern 3 (sticky dir index), Pitfalls 1, 2, 8 |
| D-02 | Singles stay flat | `nativePut` default unchanged; sticky dir only set by the album path (Pattern 3) |
| D-03 | Web: one store-only `.zip` | Pattern 4 (zip writer, prototyped + verified with `unzip -t` and `ditto`) |
| D-04 | `persist:true` | Root cause confirmed at `download-track.ts:291-293`. Album path passes `persist:true, save:false` |
| D-05 | Move an already-downloaded single | Pattern 2 `moveInMusic` (API 29+ `RELATIVE_PATH` update, URI unchanged; ≤28 rename, URI changes); web reuses `blobStore.get` |
| D-06 | Toast progress, skip failures | Pattern 1 `download-album.ts` loop with an `onProgress` callback; 2 new i18n keys x 15 locales |
| D-07 | Un-comment the button | album `+page.svelte:694` |
| D-08 | QQ → iTunes → Deezer → other CN → YTM | Pattern 5. **QQ search has NO cover**, so the QQ tier needs search plus a detail call (Pitfall 4) |
| D-09 | Inline cover kept (incl. ytmusic) | `upgradeCoverAsync` currently REPLACES inline covers. Gate it (Pattern 6) |
| D-10 | Picker order own, QQ, iTunes, Deezer, CN, YTM | `collectCoverCandidates` rewrite (Pattern 5) |
| D-11 | HQ path + header comments | Pattern 6 + Open Question 1 |
| D-12 | Share carrier keeps working | `resolveShareCover`/`coverToken` are decoupled. Leave them untouched and pin it with a test (Pitfall 5) |
| D-13 | uid then name key | Pattern 7 key design (`u` and `n` SHA-256 hex32, domain-separated) |
| D-14 | pin > crowd > inline > chain | Pattern 8: a separate `crowd:` cache family, `readChosenCover`, 9 call-site swaps, play-seed / Site A / adoptCover / postPlayCover / healCover edits |
| D-15 | Only `pickCover` votes | `TrackMenu.svelte:346` |
| D-16 | Lookup on play only | `postPlayCover` (`player.svelte.ts:4009`), one GET per play, one attempt per uid per session |
| D-17 | Most votes, tie → recent | Pattern 7 `consensus` |
| D-18 | Known hosts only | New `CN_IMAGE_HOSTS` + composed `COVER_PICK_IMAGE_HOSTS`. Real hosts listed in §Security |
| D-19 | Re-pick replaces, no withdraw | `applyVote` keyed by voterId |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Runes stores live in `*.svelte.ts`. Pure logic lives in `.ts` and stays node-testable (single Vitest node project, no jsdom). Stores never localize; they emit `TranslationKey`s.
- Never-throw services return sentinels. Generation guards protect any async path a newer action can supersede.
- All `/api/*` calls go through `apiFetch` (GET dedupe, `MAX_CONCURRENT_REQUESTS=8`, 25 s timeout, circuit breaker). Media and blob bytes use raw `fetch`.
- A `+server.ts` may export **only** HTTP verbs. Helpers go in `$lib/proxy/*.ts` (memory: svelte-server-endpoint-only-verb-exports).
- i18n: every key in **all locale files**, double quotes. **There are 15 locale files** (`ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant`), not 16. CLAUDE.md is stale here, and `i18n.test.ts` guards parity.
- Shared Primitives must be imported, never re-inlined: `hasHttpsScheme`, `safeImageUrl`, `onlySource`, `combinedSignal`, `jsonResponse`, `isAllowedOrigin`, `edgeCache`/`ownOriginCacheKey`, `writeCoverBoth`, `sanitizeFilename`.
- High comment density with decision refs. Add `Phase 40 D-NN` refs and keep existing `quick-…` and decision-ref comments.
- Tabs, single quotes (except i18n). No `as any` in production. `import type` for types. Path aliases.
- SSR/browser guards on anything touching `localStorage`, `window` or `document`.
- Do not use bare `pnpm deploy` (memory: it is shadowed by a builtin). Pushing to main auto-deploys prod, so do not ship half a decision.

## Summary

All three deliverables reuse existing seams. The album download is broken for exactly the reason already found: `persist:false` skips `blobStore.put`, which skips the native public write (`download-track.ts:291`). The fix is a small orchestration module, `download-album.ts`. It calls `downloadTrack(tr, { persist: true, save: false, dir })` on native. On web it collects the persisted blobs and saves one hand-written store-only ZIP. Prototyping showed the ZIP writer is about 50 lines: the CRC-32 check value `cbf43926` matches, `unzip -t` passes, and macOS `ditto` creates the `Artist - Album/` folder from implicit paths.

On Android, `saveToMusic` needs a validated `subPath`. A new `moveInMusic` plugin method handles D-05: on API 29+ an update of `RELATIVE_PATH` on an app-owned row moves the file with no permission and keeps the same `content://` URI. On API ≤28 it is a file rename, and the `file://` URI changes. The non-obvious hazard is that `nativePut` re-saves to the flat folder whenever a file is rewritten (retag, cover-pin tag sync, background repair). Without a **per-uid sticky folder index**, those paths would silently move album songs back out of their album folder.

For the cover re-rank, the key discovery is that **QQ search returns `cover: null`** (`qq.ts:291`, confirmed against the live tang API). A QQ tier shaped like `ytmusicSongCover` would therefore always miss. It has to be search plus one qq detail call (`album_pic`, a 500px https image on `y.gtimg.cn`, ~1.7 s measured). That makes QQ-first measurably more expensive than today's iTunes-first: one own-edge request plus one tang request per resolve, on every list backfill. The share carrier is safe as long as `resolveShareCover` and `coverToken` are left alone. The QQ host is not in the `?ci=` grammar, so QQ-displayed songs will share through the existing iTunes/Deezer prewarm fallback.

D-09 currently conflicts with existing code: `upgradeCoverAsync` replaces any inline cover, including a ytmusic thumbnail, with iTunes or Deezer art. It must be gated.

The crowd pick cannot ride on the existing uid/name cache layers. Rows read `track.cover` (inline) **before** those layers, and the auto chain overwrites them. It needs its own `crowd:` key family, read right after the pin by a new `readChosenCover()`. That function must replace `readPinnedCover()` as the leading rung at about 9 call sites.

**Primary recommendation:** build three self-contained slices (album download, cover re-rank, shared cover pick), each with pure helpers plus tests and thin store/component wiring. Use zero new npm packages and zero new bindings: reuse DIAG under `cover-pick/` and hand-write the ZIP writer.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Album download orchestration (loop, progress, skip-on-fail, move-vs-download) | Browser / Client (pure service `download-album.ts`) | — | The client already holds the tracklist and the offline copies. The edge never sees bytes |
| Public folder write / move | Native shell (Kotlin `MediaStoreSaverPlugin`) | Client (`blob-store.ts` index) | Only native code can touch MediaStore. The TS side owns the uid → URI / dir index |
| ZIP assembly | Browser / Client (pure `zip-store.ts`) | — | Blob composition plus CRC over `blob.stream()`. No server round-trip |
| Cover tier chain | Browser / Client (`cover-backfill.ts`) | API proxy (`/api/qq/search`, `/api/deezer/*`) | The existing chain runs client-side through apiFetch |
| Crowd vote storage + consensus | API / Backend (edge route + `$lib/proxy/cover-pick.ts`) | Database / Storage (R2 DIAG `cover-pick/`) | Votes must be server-authoritative. The IP-derived voterId exists only at the edge |
| Crowd lookup + precedence | Browser / Client (player store + `cover-version.svelte.ts`) | CDN (edge cache, 300 s) | One GET per play. The result is cached locally so rows benefit |
| URL allowlist | API / Backend (POST screen) | Client (pre-filter + re-check on GET) | A security control. Server-side is authoritative, client-side is defense in depth |

## Standard Stack

### Core (all already in the repo — nothing new to install)
| Library / API | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | 4.1.8 (`^4.1.3` in package.json) | Unit tests, node project | The project's only test runner [VERIFIED: ran 6 target files, 338 tests pass] |
| `@capacitor/core` / `@capacitor/filesystem` / `capacitor-blob-writer` | 8.4.0 / installed | Native app-private copy + `Filesystem.getUri` | Already used by `nativePut` [VERIFIED: blob-store.ts imports] |
| Web platform `Blob`, `Blob.stream()`, `TextEncoder`, `DataView`, `crypto.subtle` | — | ZIP assembly, CRC streaming, key hashing | Stdlib. No dependency needed [VERIFIED: prototype ran on Node 25 / 22 semantics] |
| Android `MediaStore.Audio.Media` + `ContentResolver.update` | compileSdk 36, minSdk 24 | Sub-folder insert + move | [CITED: developer.android.com/training/data-storage/shared/media] |
| Cloudflare R2 (DIAG binding) + Cache API (`edgeCache`) | — | Vote records + edge GET cache | Same as `/api/lyric-offset` [VERIFIED: lyric-offset/+server.ts] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written store-only ZIP | `fflate` / `client-zip` / `JSZip` | Rejected by D-03 (no third-party runtime deps). Store-only needs no deflate, so the whole format is three fixed headers plus CRC |
| `moveInMusic` (RELATIVE_PATH update) | Re-run `nativePut` step 2 (save new copy, delete old) | Copy+delete needs the app-private copy, a filename, and an extension sniff. D-05 explicitly specifies the row move |
| Separate `crowd:` cache family | Write crowd URL via `writeCoverBoth` into the uid/name layers | Fails D-14: rows read inline `track.cover` before those layers, and the chain, heal and HQ paths overwrite them |
| One combined GET `?u=&n=` | Two GETs (`?k=` per key) | Two requests per play vs one. Combined costs up to 300 s of staleness on other copies' name-layer reads |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed by this phase. slopcheck is not applicable. **Packages removed:** none. **Packages flagged:** none.

## Architecture Patterns

### System Architecture Diagram

```
ALBUM DOWNLOAD
 tap Download (album page) ──► resolveAllCached() (existing, ≤4 concurrent resolveStub)
        │
        ▼
 download-album.ts loop (sequential, onProgress n/total → toast)
        │
        ├─ already downloaded? (library.downloads uid OR sameSongKey, + blobStore.has)
        │      ├─ native: storedDir==target? → count ── else blobStore.moveToDir(uid, dir)
        │      │                                          └─► Kotlin moveInMusic (29+: update RELATIVE_PATH,
        │      │                                               same URI; ≤28: renameTo → new file:// URI)
        │      └─ web: blobStore.get(uid) ──► zip entry (no re-fetch)
        │
        └─ not downloaded ──► downloadTrack(tr,{persist:true, save:false, trackNumber, albumArtist, dir, onSaved})
                                 resolve → fetch → tag → blobStore.put(uid, blob, filename, {dir})
                                    ├─ native: write_blob (app-private) → saveToMusic({fileName, sourcePath, subPath})
                                    │          → setStoredUri + setStoredDir
                                    └─ web: IndexedDB put ──► onSaved → blobStore.get(uid) ──► zip entry
        ▼
 web only: buildZip(entries) ──► saveBlobToDisk(zip, "<Artist> - <Album>.zip")   (ONE save)
 toast "Saved X of Y"

COVER (play path)
 play(track) ─► sync seed: pin ?? crowd(uid→name) ?? attached ?? track.cover ?? cache ─► resolvedCover
     │
     └─► postPlayCover ─┬─ no renderable cover → resolveTrackChain: QQ(search+detail) → iTunes → Deezer
                        │                                             → other CN {qq:false,ytmusic:false} → YTM
                        ├─ inline https cover, NOT chosen, source∉{ytmusic,qq} → resolveHqCover (iTunes→Deezer)
                        └─ not pinned, not device → GET /api/cover-pick?u=<h>&n=<h>  (apiFetch, edge-cached)
                                 ─► gen-check ─► writeCrowdCover (crowd:uid / crowd:name) + bump
                                 ─► player.adoptCover(uid, winner)  (hero + OS media card repaint)

 Rows / hero / downloads / media card read: readChosenCover (pin → crowd) → uid cache → name cache → inline/rc

VOTE
 TrackMenu pickCover(url) ─► pinCover + adoptCover (existing) ─► submitCoverPick({u,n,url}) fire-and-forget
     ─► POST /api/cover-pick: origin gate → JSON type → size cap → parse (32-hex keys, safeImageUrl)
        → ip → voterId(ip,key) → R2 RMW per key (conditional put ×3) → bust exact GET cache key
```

### Recommended Project Structure (new / changed files)
```
src/lib/services/
├── zip-store.ts              # NEW pure: crc32, buildZip(entries) → Blob (store-only, UTF-8 names)
├── zip-store.test.ts         # NEW
├── download-album.ts         # NEW orchestration (store-importing like download-track.ts; mocked in tests)
├── download-album.test.ts    # NEW
├── download-filename.ts      # + sanitizePathSegment(), albumFolder()  (pure)
├── download-track.ts         # + opts.dir, opts.onSaved
├── blob-store.ts             # put(uid, blob, filename?, {dir}?) + sticky dir index + moveToDir()
├── media-store.ts            # saveToMusic({..., subPath?}) + moveInMusic({uri, subPath})
├── cover-backfill.ts         # qqSongCover tier; chain + picker + HQ reorder; header comments
├── cover-cache.ts            # crowd:uid:/crowd:name: family get/set/remove (pure)
└── cover-pick-shared.ts      # NEW client: coverPickKeys(), fetchCoverPick(), submitCoverPick()
src/lib/proxy/
├── cover-pick.ts             # NEW pure: key screen, object key, parse, applyVote, consensus, voterId
└── safe-image-url.ts         # + CN_IMAGE_HOSTS, COVER_PICK_IMAGE_HOSTS
src/lib/stores/
├── cover-version.svelte.ts   # + readChosenCover, writeCrowdCover, removeCrowdCover; readCoverByUidOrName uses it
└── player.svelte.ts          # seed / Site A / postPlayCover / adoptCover / healCover edits + crowdCoverAsync
src/routes/api/cover-pick/
├── +server.ts                # NEW GET + POST only
└── cover-pick-endpoint.test.ts
android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt  # subPath + moveInMusic
src/routes/(app)/album/[name]/+page.svelte   # thin downloadAlbum + un-comment button
src/lib/components/TrackMenu.svelte          # pickCover → submitCoverPick; activeCover rung
src/lib/i18n/*.ts (15)                       # toast.albumProgress, toast.albumSaved
```

### Pattern 1: Album orchestration as a node-testable service
**What:** Move the loop out of `+page.svelte` (`downloadAlbum` at L459-487) into `download-album.ts`, mirroring `download-track.ts`: it imports stores, is mocked in tests, never throws, and never localizes. The page calls it and maps the progress counts to `t()` toasts.
```ts
// download-album.ts (shape)
export async function downloadAlbum(
	tracks: Track[],                 // resolved, album order
	meta: { artist: string; album: string },  // ALREADY dn*-translated by the page
	total: number,                   // tracks.length of the tracklist (unresolvable ones count as not saved)
	onProgress: (n: number, total: number) => void
): Promise<{ saved: number; total: number }> {
	const native = Capacitor.isNativePlatform();
	const dir = albumDir(meta.artist, meta.album);          // "Artist/Album" (native)
	const folder = albumFolder(meta.artist, meta.album);    // "Artist - Album" (zip root)
	const entries: ZipEntry[] = []; let saved = 0;
	for (const [i, tr] of tracks.entries()) {
		onProgress(i + 1, total);
		const have = findHeldDownload(tr);                    // uid OR sameSongKey in library.downloads
		if (have && (await blobStore.has(have.uid))) { /* D-05: move (native) / reuse blob (web) */ }
		else { /* downloadTrack(tr, { persist: true, save: false, trackNumber: String(i + 1),
		                               albumArtist, dir: native ? dir : undefined, onSaved }) */ }
	}
	if (!native && entries.length) { if (!saveBlobToDisk(await buildZip(entries), `${folder}.zip`)) saved = 0; }
	return { saved, total };
}
```
- Keep `trackNumber = String(i + 1)` (36-D-11: the album page is the only legitimate track-number source).
- Match held downloads with `sameSongKey` as well as uid. `resolveStub` is non-deterministic and `dedupeBest` collapses variants, so the album's resolved uid often differs from the uid of the user's earlier single download (see the comment at album `+page.svelte` ~L405).
- `save: false` on **both** platforms. On native, `<a download>` is a no-op: Capacitor Android installs no `DownloadListener` [VERIFIED: no DownloadListener in `node_modules/@capacitor/android/.../getcapacitor/*.java`]. On web the single ZIP save replaces per-song anchors, so the 250 ms stagger is no longer needed.

### Pattern 2: Kotlin `subPath` + `moveInMusic`
**What:** Add a validated `subPath` to `saveToMusic`, and add one new method. Validate in Kotlin as well (defense in depth; T-29-01-01 RELATIVE_PATH escape).
```kotlin
// Source: developer.android.com/training/data-storage/shared/media ("You can move files on disk during a
// call to update() by changing MediaColumns.RELATIVE_PATH or DISPLAY_NAME"; own files need no permission on 10+)
private fun safeSubPath(raw: String?): String? {          // null = flat (D-02)
    if (raw.isNullOrBlank()) return null
    val segs = raw.split('/')
    if (segs.size > 2 || segs.any { it.isBlank() || it == "." || it == ".." || it.contains('\\') ||
            it.any { c -> c.code < 0x20 } }) throw IllegalArgumentException("bad subPath")
    return segs.joinToString("/")
}
private fun relPath(sub: String?) = "${Environment.DIRECTORY_MUSIC}/OpenMusic/" + (sub?.let { "$it/" } ?: "")

@PluginMethod fun moveInMusic(call: PluginCall) {          // D-05
    // uri + subPath required. API 29+: ContentValues(RELATIVE_PATH=relPath(sub)); rows = resolver.update(uri, v, null, null)
    //   rows > 0 → resolve {uri: same uri}; else reject("io:move")
    // API ≤28: (same publicMusic permission gate as saveToMusic) File(uri.path).renameTo(File(targetDir, name));
    //   scanFile(old + new paths); resolve {uri: Uri.fromFile(newFile)}
}
```
- `performSave` takes `subPath`. API 29+ uses `put(RELATIVE_PATH, relPath(sub))`. Legacy uses `File(musicDir, "OpenMusic" + (sub?.let { "/$it" } ?: ""))`. The same applies at L76 (`relativePath` val) and L223.
- **`publicMusicPermsCallback` (L165) re-reads params from the call. It must re-read `subPath` too**, or legacy API 24-28 album saves land flat after the permission prompt.
- `moveInMusic` on legacy needs the same `WRITE_EXTERNAL_STORAGE` gate and callback pattern.
- The scan (`performScan` L649) uses `Music/%`, so it already covers subfolders. `device-import.ts:169` uses `startsWith('Music/OpenMusic/')`, so it already matches album subfolders for the relink lane [VERIFIED: read both].

### Pattern 3: Sticky per-uid folder index (prevents silent un-filing)
**What:** `blob-store.ts` gains `openmusic-blob-dir:<uid>`, the same posture as the existing `openmusic-blob-uri:` and `openmusic-blob-name:` indexes (L82-175).
- `put(uid, blob, filename?, opts?: { dir?: string })`: `const dir = opts?.dir ?? getStoredDir(uid)` → `saveToMusic({ fileName, sourcePath, ...(dir ? { subPath: dir } : {}) })`, then `setStoredDir` when `dir` is set. **Why:** `nativePut` deletes the previous URI and re-saves (36-D-19). `retag.ts`, the cover-pin `writeTagsForGesture` (TrackMenu `pickCover`), the lyric auto-embed (`player.svelte.ts` ~L1034 `syncFileTags`) and the 31-D-12 background repair (`downloadTrack(..., {save:false})`, player ~L2584) all call `put` **without** a dir. Without the sticky index, each one would move an album song back to flat `Music/OpenMusic/`.
- `moveToDir(uid, dir): Promise<boolean>`. Refuse device uids first (34 Pitfall 1). Read the stored URI; if there is none, return false (nothing public to move — count as saved, not moved). Call `MediaStoreSaver.moveInMusic({ uri, subPath: dir })`, then `setStoredUri(uid, newUri)` (it changes on ≤28) and `setStoredDir(uid, dir)`. Never throw.
- `del()` clears the dir index next to `clearStoredName` (above the native fork, L839ff).
- Spread `subPath` conditionally so the existing `blob-store.test.ts` call-shape assertions (L269-305) stay green.
- The backup export already excludes `openmusic-blob-*` keys (`backup-logic.ts:59`), so the new key needs no backup change [VERIFIED].

### Pattern 4: Store-only ZIP writer (prototyped and verified)
```ts
// Source: PKWARE APPNOTE.TXT 4.3.7 / 4.3.12 / 4.3.16 / 4.4.4 bit 11 / 4.4.7 (pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLE[n] = c >>> 0; }
export function crc32(bytes: Uint8Array, crc = 0): number {
	let c = ~crc >>> 0;
	for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return ~c >>> 0;
}
async function blobCrc(blob: Blob): Promise<number> {          // streamed: bounded memory
	let crc = 0; const r = blob.stream().getReader();
	for (;;) { const { done, value } = await r.read(); if (done) return crc; crc = crc32(value, crc); }
}
// Per entry: local header 30 B [sig 0x04034b50, ver 20, flags 0x0800 (UTF-8), method 0, dos time, dos date,
//   crc, size, size, nameLen, 0] + name + blob.  Central header 46 B [sig 0x02014b50, made-by 20, ver 20,
//   0x0800, 0, time, date, crc, size, size, nameLen, 0,0,0,0, extAttr 0, localOffset].
// EOCD 22 B [sig 0x06054b50, 0, 0, count, count, cdSize, cdOffset, 0].
// return new Blob([...lh/name/blob..., ...central..., eocd], { type: 'application/zip' })
```
Verified in the scratchpad: `crc32("123456789") = cbf43926` (the standard check value). `unzip -t` reports "No errors". `python3 -m zipfile -l` shows correct UTF-8 CJK names. `ditto -x -k` creates `周杰倫 - 葉惠美/…` from implicit paths, so no explicit directory entries are needed.
- DOS time: `(h<<11)|(m<<5)|(s>>1)`; date: `((y-1980)<<9)|((mo+1)<<5)|d` [CITED: APPNOTE 4.4.6].
- Guard: when the running offset or any size exceeds `0xFFFFFFFF`, or the entry count exceeds `0xFFFF`, return null (Zip64 is out of scope). A 12-track lossless album is about 0.3-0.6 GB, well inside the limit.
- Composing a `Blob` from parts references the IndexedDB-backed blobs and does not copy them. CRC reads stream chunk by chunk. Peak JS heap is about one chunk plus the headers [ASSUMED for browser blob-storage internals; see Pitfall 6].
- Entry names: `${folder}/${filename}`. Use the same `{artist} - {title}.{ext}` filename as the native path (DL-FILE-01). Dedupe collisions inside one ZIP with ` (2)` before the extension.

### Pattern 5: QQ tier + reorder (D-08 / D-10)
```ts
// QQ search rows carry cover:null (qq.ts:291) — the art only exists on the DETAIL body (album_pic, https()-
// upgraded at qq.ts:357). So the tier is search → top row → ONE detail call. Never mutate the cached row.
async function qqSongCover(artist: string, title: string, signal?: AbortSignal): Promise<string | null> {
	const r = await searchAll(`${artist} ${title}`, 1, onlySource('qq'), signal);
	const row = dedupeBest(r.interleaved, settings.preferredSource)[0];
	if (!row || signal?.aborted) return null;
	const d = await SOURCES.qq.resolve({ ...row }, signal ?? new AbortController().signal);
	return d.cover ?? null;
}
// resolveTrackChain: qq → itunes → deezer → otherCn → ytmusic
// otherCn: searchAll(term, 1, { qq: false, ytmusic: false }, signal)   ← explicit false beats user prefs
```
- `SOURCES` is exported from `registry.ts`. `cover-backfill.ts` already names `ytmusic` through `onlySource`, so naming `qq` is consistent.
- Use explicit `{ qq: false, ytmusic: false }` prefs for "other CN", not a post-filter of `{}`. It skips a second qq search and an InnerTube POST on every miss. The cost is that the searchAll cache key no longer matches `resolveStub`'s `{}` key.
- Picker (`collectCoverCandidates` L576): add a parallel `qq` tier (search, then resolve up to `PER_TIER_CAP` distinct rows; the governor caps concurrency at 8). Order: `own, qq, itunes, deezer, otherCn, ytm`. With four multi-hit tiers, 12 tiles are full before YTM; that matches D-10's intent. Consider `PER_TIER_CAP = 3` so one or two YTM tiles still appear.
- Optional: QQ art accepts `R800x800` in place of `R500x500` [VERIFIED: one live probe, 200 image/jpeg 183 KB]. Not required, and unverified across albums, so skip it.

### Pattern 6: D-09 / D-11 gates in the player
- `postPlayCover` (`player.svelte.ts:4009`): the HQ branch currently fires for any https inline cover that is not attached and not pinned. Add `resolved.source !== 'ytmusic'` (D-09) and `!readChosen(resolved)`, so neither pin nor crowd is upgraded. Recommend also skipping `source === 'qq'`, because QQ art is now rank 1 and upgrading it to iTunes contradicts D-08 (Open Question 1).
- `resolveHqCover` (L327) stays iTunes → Deezer. Do **not** add QQ there: that adds a ~2 s tang detail to every play and breaks the "~3 calls per play" budget (T-26-02-01). Update its doc comment with a Phase 40 note.
- Header comment block (L11-53): rewrite the tier list for QQ → iTunes → Deezer → other CN → YTM, keep the nyq history paragraphs, and add a `Phase 40 D-08` paragraph that explains the cost change (Pitfall 4).

### Pattern 7: `/api/cover-pick` (clone of lyric-offset)
- `$lib/proxy/cover-pick.ts`, pure:
  - `isPickKey = /^[0-9a-f]{32}$/` and `pickObjectKey(kind: 'u'|'n', k) => \`cover-pick/${kind}/${k}.json\``. This is the **only** R2 key builder, so `log/` cannot be reached.
  - `MAX_VOTE_BODY_BYTES = 1024`, `MAX_URL_CHARS = 512`, `MAX_VOTES = 50`, `COVER_PICK_TTL = 300`.
  - Record shape: `{ v: 1, votes: { [voter]: { u: string; t: number } } }`. `parseRecord` re-validates each stored `u` through `safeImageUrl`.
  - `parseVoteBody(text) → { u: string|null; n: string|null; url: string } | null`: at least one key is required, and `url` must be `safeImageUrl(url, COVER_PICK_IMAGE_HOSTS)`. Store the returned normalized `href`.
  - `applyVote`: copy lyric-offset's (re-vote replaces; cap to the newest 50).
  - `consensus(rec) → string|null`: count per URL; highest count wins; ties go to the URL with the most recent vote. D-17 sets no quorum, so one vote applies.
  - `voterId(ip, key)`: copy lyric-offset's per-key salt.
- Route: `GET ?u=<hex>&n=<hex>` (either may be absent; both absent → 400) → 503 if `DIAG` is absent → edge cache match → read both objects → `{ ok: true, u: url|null, n: url|null }` → cache.put with `max-age=300` → respond `no-cache`.
  `POST`: origin gate (`isAllowedOrigin`), `application/json` only, content-length and real-length caps, parse, `getClientAddress` (refuse if null). For each present key, run a conditional-put RMW (3 attempts). Then **bust the exact GET URL** rebuilt from the body (`?u=..&n=..`, same param order as the client). Respond `{ ok, u, n }`.
- Client `cover-pick-shared.ts`:
  - `coverPickKeys(uid, artist, title)`: `u = sha256hex32('u\n' + uid)` when uid is truthy and not `device:`; `n = sha256hex32('n\n' + matchKey(artist, title))` unless the key is `'|'`. The domain prefixes keep the two families from colliding. Return null when `crypto.subtle` is missing (LAN http dev).
  - `fetchCoverPick(keys, signal)` and `submitCoverPick(keys, url)`: copy `lyric-offset-shared.ts`. Use `apiFetch` and the `content-type: application/json` header (Cloudflare 403s JSON without it). Re-check every returned URL with `safeImageUrl` before use.

### Pattern 8: The crowd layer and the D-14 precedence wiring
- `cover-cache.ts` (pure): `crowd:uid:<uid>` and `crowd:name:<matchKey>` keys in the existing flat record. They inherit the 14-day TTL, the LRU cap and `clearCoverCache`. They are provably disjoint: `norm()` strips `:` so a matchKey never contains a colon, and `uid:`, `artist:` and `itunes:` are different prefixes [VERIFIED: match-key.ts].
- `cover-version.svelte.ts`:
  - `readChosenCover(uid, artist, title) = coverVersion(), getPinnedCover(uid) ?? crowdUid ?? crowdName`.
  - `readCoverByUidOrName` becomes `readChosenCover(...) ?? uidLayer ?? nameLayer`.
  - `writeCrowdCover(uid, artist, title, {u, n})` writes only when the value is https, then bumps.
  - `removeCrowdCover` evicts locally only (D-19: never touches the server).
- Swap the leading `readPinnedCover(uid)` rung for `readChosenCover(uid, artist, title)` at: `SongRow.svelte:201`, `CompactRow.svelte:82`, `NpUpNext.svelte:223`, `NpRelated.svelte:168`, `NowPlaying.svelte:392`, `(app)/+page.svelte:1041 / 1159 / 1534`, `TrackMenu.svelte:168` (activeCover). Keep `readPinnedCover` wherever the UI asks "is this pinned?" (the reset-pin affordance).
- `player.svelte.ts`:
  - play seed (~L3631): `getPinnedCover ?? getCrowdCover(uid, a, t) ?? attachedCoverFor ?? track.cover ?? ...`.
  - Site A (~L3645): skip `writeCoverBoth` when the cover is chosen (same reason pins are skipped there: the chosen art must not leak into the auto layers).
  - `adoptCover` (L4240): `const chosen = pin ?? crowd; if (chosen && url !== chosen) return; if (!chosen) writeCoverBoth(...)`. This keeps the NowPlaying Last.fm hi-res swap from displacing a crowd pick.
  - `healCover` (~L4358): `if (getPinnedCover(uid) === url) unpinCover(uid)` gains a crowd twin.
  - New `crowdCoverAsync(resolved, myGen)`, fired from `postPlayCover`. Skip it if pinned, if the uid is a `device:` uid, or if this uid was already requested this session. Fetch, then `if (myGen !== this.playGen) return`, then `writeCrowdCover`, then `this.adoptCover(uid, winner)`, which refreshes `resolvedCover` and the OS media card.

### Anti-Patterns to Avoid
- **A QQ tier that reads `searchAll(onlySource('qq'))[0].cover`.** It is always null (Pitfall 4).
- **Writing the crowd pick only through `writeCoverBoth`.** Inline covers outrank those layers on rows, and the chain overwrites them.
- **Calling `ensureTrackDetails` for the QQ cover tier.** It adds the `/api/resolve` cache-first read and audio-URL semantics. Use the adapter's `resolve` on a copy.
- **A `+server.ts` helper export.** Every key screen and consensus function goes in `$lib/proxy/cover-pick.ts`.
- **Per-row crowd lookups** (D-16, api fetch-flood freeze).
- **Changing `resolveShareCover`, `coverToken` or `og-cover.ts`** in the reorder (D-12).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL host screening | A new regex or allowlist check | `safeImageUrl` + a new `CN_IMAGE_HOSTS` constant | A security control that already had 4 drifting copies |
| Vote / consensus / voter identity | New logic | Clone `$lib/proxy/lyric-offset.ts` shapes | Tested RMW and conditional-put semantics |
| Edge cache + bust | Custom cache keys | `edgeCache()` + `ownOriginCacheKey(url)` | The GET and bust keys must match exactly |
| Origin / JSON / size gates | — | lyric-offset POST preamble + `isAllowedOrigin` | Prevents drive-by votes |
| Filename sanitizing | A new char class | `sanitizeFilename` (one sanitizer, T-30x-01), wrapped by `sanitizePathSegment` | A second copy is how the control drifts |
| Single-source search | Hand-built prefs | `onlySource('qq')` | It zeroes every other source explicitly |
| Web save | New anchor code | `saveBlobToDisk` | Its body is test-guarded against DL-BUG-01 |
| Container sniff for held blobs | URL guess | `containerFromMagic(stat.head)` (download-probe.ts) | Sniffs the real bytes |
| Song identity across uids | uid compare | `sameSongKey` | Handles artist aliases and script folding |

**Key insight:** every risky piece (vote store, allowlist, sanitizer, governor) already exists. The phase is mostly wiring plus two small pure modules (zip, path segment) and one Kotlin method.

## Runtime State Inventory

Not a rename phase, but the phase does change stored state:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | R2 DIAG: new `cover-pick/u/*.json`, `cover-pick/n/*.json`. localStorage: new `openmusic-blob-dir:<uid>`, new `crowd:` keys inside `openmusic:cover-cache:v1` | Code only. No migration: existing downloads have no dir, which means flat (D-02) |
| Live service config | None. DIAG binding already exists in `wrangler.jsonc:31` | None. No new binding (memory: wrangler-wrong-account, r2-binding-before-bucket) |
| OS-registered state | MediaStore rows of existing single downloads: moved only when the user downloads the containing album (D-05) | Runtime move via `moveInMusic`, per song |
| Secrets/env vars | None | None |
| Build artifacts | The APK must be rebuilt for the Kotlin change (`pnpm apk`, JDK 21) | Rebuild + device/emulator UAT |

## Common Pitfalls

### Pitfall 1: Rewrite paths un-file album songs
**What goes wrong:** retag, cover-pin tag sync, lyric auto-embed and background repair call `blobStore.put` with no dir. `nativePut` deletes the old row and saves into flat `Music/OpenMusic/`.
**How to avoid:** the sticky dir index (Pattern 3). Add a blob-store test: put with a dir, then put without one, and assert the second `saveToMusic` received the same `subPath`.

### Pitfall 2: The permission callback drops `subPath`
**What goes wrong:** on API 24-28 the first save triggers `requestPermissionForAlias`. `publicMusicPermsCallback` rebuilds args from `call.getString` and currently reads only `fileName` and `sourcePath`.
**How to avoid:** read `subPath` in the callback. Apply the same gate and callback for `moveInMusic`.

### Pitfall 3: Uid mismatch between album resolve and the held single
**What goes wrong:** `resolveStub` can pick a different source or variant than the one the user downloaded. A uid-only check re-downloads it and leaves two library entries, which violates D-05's "one entry".
**How to avoid:** match with `library.downloads.find(d => d.uid === tr.uid || sameSongKey(d, tr))`, then use **that** entry's uid for `moveToDir` and `get`.

### Pitfall 4: QQ-first cost and the shared breaker
**What goes wrong:** today tier 1 (iTunes) is a direct CORS GET with zero own-edge cost. The QQ tier is one own-edge `/api/qq/search` plus one tang detail (direct, about 1.7-2.7 s) for **every** cover resolve: home backfill (`DEFAULT_MAX=400`, `CAP=6`), lazyCover rows, heal, and play misses. A tang outage now fails tier 1 of every resolve, and tang failures count toward the ONE shared apiFetch circuit breaker (`qq.ts` 32-D-13 note). Covers, translate and Deezer can all be fast-rejected during that window.
**How to avoid:** this is locked (D-08), so mitigate without new throttles (which would compose bounds, the api-fetch-flood root cause). Skip the detail call when the search returned no row. Keep the negative-miss cache (5 min). Rely on the existing CAP=6 pool. Optionally gate the QQ tier with `createHealthGate` (Shared Primitive; netease and kuwo use it) so a dry or erroring tang drops out of tier 1 for a window. The planner should state the cost in the PLAN's Risks section (Open Question 2).
**Warning signs:** Activity log or network shows `/api/qq/search` bursts on Home. Covers stall during a tang outage.

### Pitfall 5: Share-card regression (D-12)
**What goes wrong:** the displayed cover becomes `y.gtimg.cn` more often. `coverToken` returns null for it (its grammar is `d:` `l:` `k:` `i:` only).
**Why it is still safe:** TrackMenu's prewarm effect (L205-246) already runs `resolveShareCover` (iTunes → Deezer) whenever `coverToken(activeCover)` is null. It is deliberately decoupled from the display chain (cover-backfill L360-372).
**How to avoid:** do not edit `resolveShareCover`, `coverToken` or `og-cover.ts`. Add a cover-backfill test asserting `resolveShareCover` makes **zero** qq calls and zero `searchAll` calls (one already exists for searchAll; extend it). Adding a `q:` tag would widen the `/api/og` host set (T-3uo-02) and is out of scope.

### Pitfall 6: Web ZIP memory and save behaviour
**What goes wrong:** holding the in-memory fetched blobs for a 12-track lossless album means about 0.5 GB of RAM on a phone. iOS Safari may also fail if the object URL is revoked immediately after `a.click()` (FileSaver.js waits 40 s) [ASSUMED].
**How to avoid:** zip from `blobStore.get(uid)`, the IndexedDB-backed handle, with `onSaved`'s blob only as a fallback. Stream the CRC. Treat iOS large-ZIP save as a manual UAT item. If UAT fails, add a deferred revoke for the ZIP call only. The `saveBlobToDisk` body is test-guarded, so add a parameter rather than editing the forbidden-API section.

### Pitfall 7: The crowd layer loses to inline art on rows
**What goes wrong:** `pickRowCover(pinned, resolved, seeded=track.cover, cached)` puts inline art before the cache.
**How to avoid:** a separate family plus `readChosenCover` as the first rung (Pattern 8). Test: a crowd entry beats `track.cover` in `pickRowCover` inputs, and a pin beats the crowd.

### Pitfall 8: Path segment byte length
**What goes wrong:** Linux and Android filesystems cap a name at 255 **bytes**. `MAX_FILENAME_BASE = 120` characters can be 360 bytes for CJK. The comment at `download-filename.ts` claims 120 is "comfortably inside", which is wrong for 3-byte characters.
**How to avoid:** `sanitizePathSegment` = `sanitizeFilename`, strip control characters, collapse whitespace, trim, strip leading and trailing dots and spaces, then truncate by code point until the UTF-8 length is at most 180 bytes. Return `''` for an empty result, in which case the caller drops that path level (`<Album>` alone, or flat). Use the same helper for the ZIP folder.

### Pitfall 9: MediaStore name collision on move or insert
**What goes wrong:** inserting into a folder that already has the same `DISPLAY_NAME` gets ` (1)` appended. The behaviour of an `update()` into a folder with a same-name row is undocumented [ASSUMED].
**How to avoid:** skip the move when the stored dir already equals the target (re-running an album download). Treat a `moveInMusic` reject as "saved, not moved" and leave the file where it is. UAT on the emulator.

### Pitfall 10: YTM covers leak through the name layer (adjacent to D-08/D-09)
**What goes wrong:** Site A (play seed), Site B (`writeCoverBoth` ~L3878), `adoptCover` and `library.adoptCover` (library.svelte.ts:154) write a ytmusic track's own thumbnail into the shared **name** layer. Every other source's copy of that song then paints the YTM thumbnail.
**How to avoid:** D-09 only requires the ytmusic track to keep its own art. Recommend writing only the uid layer when `track.source === 'ytmusic'` (Open Question 3). Do not do this in `setCachedCover` globally: backfill YTM-tier hits would stop caching and re-fan the chain on every visit.

### Pitfall 11: Crowd URL goes dead
**What goes wrong:** a crowd URL that 404s keeps painting a broken image, because `healCover` only evicts the uid/name layers and the pin.
**How to avoid:** add the crowd twin of the `getPinnedCover(uid) === url` branch in `healCover`, and evict locally only.

## Code Examples

### Cover-pick consensus (pure)
```ts
// Source: modelled on src/lib/proxy/lyric-offset.ts applyVote/consensus
export function consensus(rec: PickRecord): string | null {
	const tally = new Map<string, { n: number; t: number }>();
	for (const v of Object.values(rec.votes)) {
		const e = tally.get(v.u) ?? { n: 0, t: 0 };
		tally.set(v.u, { n: e.n + 1, t: Math.max(e.t, v.t) });
	}
	let best: string | null = null, bn = 0, bt = 0;
	for (const [u, { n, t }] of tally) if (n > bn || (n === bn && t > bt)) { best = u; bn = n; bt = t; }
	return best;
}
```

### Allowlist addition
```ts
// src/lib/proxy/safe-image-url.ts — Phase 40 D-18. Hosts observed in the adapters + live probes.
export const CN_IMAGE_HOSTS: ImageHostAllowlist = {
	exact: ['y.gtimg.cn', 'api.qijieya.cn'], // qq album_pic (https-upgraded, qq.ts:357); netease meting `pic` redirector
	suffix: ['.kuwo.cn', '.music.126.net']    // kuwo img1-4.kuwo.cn; netease p1-p4.music.126.net (redirect target)
};
export const COVER_PICK_IMAGE_HOSTS: ImageHostAllowlist = {
	exact: [...(DEEZER_IMAGE_HOSTS.exact ?? []), ...(LASTFM_IMAGE_HOSTS.exact ?? []), ...(KKBOX_IMAGE_HOSTS.exact ?? []),
		...(YOUTUBE_IMAGE_HOSTS.exact ?? []), ...(CN_IMAGE_HOSTS.exact ?? [])],
	suffix: [...DEEZER_IMAGE_HOSTS.suffix, ...LASTFM_IMAGE_HOSTS.suffix, ...APPLE_IMAGE_HOSTS.suffix,
		...KKBOX_IMAGE_HOSTS.suffix, ...YOUTUBE_IMAGE_HOSTS.suffix, ...CN_IMAGE_HOSTS.suffix]
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Chain iTunes → Deezer → CN(`{}` incl. qq+ytm) → YTM | QQ(search+detail) → iTunes → Deezer → CN(no qq/ytm) → YTM | Phase 40 D-08 | Higher per-resolve cost. QQ art finally reachable (search rows never had it) |
| Album download `persist:false`, per-song anchors | `persist:true`, native subfolder / one web ZIP | Phase 40 D-01..D-04 | Files appear in device music apps and play offline |
| Pin is the only human cover override | pin > crowd(R2 consensus) > inline > chain | Phase 40 D-14 | A new reactive family, about 9 call-site swaps |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | MediaStore `update(RELATIVE_PATH)` with multi-level `Music/OpenMusic/A/B/` creates the folders and moves the file on API 29-36 for app-owned rows | Pattern 2 | Move fails, so the file stays flat. Mitigated: a reject means "saved, not moved". Emulator UAT on API 34 (and 29 if available) |
| A2 | `update()` into a folder with a same-name row either renames or rejects (does not corrupt) | Pitfall 9 | Possible duplicate or failed move. UAT |
| A3 | Browser `Blob` composition from IndexedDB blobs stays disk-backed (low heap) on Chrome Android and iOS Safari | Pattern 4 / Pitfall 6 | OOM on large lossless albums. UAT with a FLAC album |
| A4 | iOS Safari `<a download>` of a large blob ZIP works with immediate revoke | Pitfall 6 | The ZIP save silently fails on iOS. UAT, then the deferred-revoke fallback |
| A5 | Windows Explorer honours bit 11 (UTF-8) names | Pattern 4 | Mojibake CJK names on old Windows. Could add the Info-ZIP 0x7075 extra field (skipped) |
| A6 | `api.qijieya.cn` (netease meting pic redirector) is acceptable on the vote allowlist | Code Examples | It is a third-party redirector. If it were compromised it could serve any image (already true for every netease row render) |
| A7 | Crowd should outrank the album-attached cover in the play seed | Pattern 8 | Album pages could show a per-song crowd pick instead of uniform album art. Needs user confirmation |
| A8 | QQ `R800x800` sizing works for all albums | Pattern 5 (optional) | Not used by default |

## Open Questions

1. **HQ upgrade scope under D-09/D-11.**
   - What we know: `upgradeCoverAsync` currently replaces every inline https cover with iTunes or Deezer art, including ytmusic thumbnails, which D-09 forbids. In discussion the user rejected "replace every inline".
   - **Recommendation:** keep `resolveHqCover` as iTunes → Deezer. Skip the upgrade for `source === 'ytmusic'` (required by D-09), for `source === 'qq'` (QQ art is rank 1 under D-08), and for chosen covers (pin or crowd). kuwo/netease inline covers keep today's upgrade. Confirm in plan review.
2. **QQ-first cost acceptance.**
   - **Recommendation:** D-08 is locked. Add `createHealthGate`-style gating only if the planner wants it; no new limiter. State the cost under Risks in the PLAN.
3. **YTM name-layer leak (Pitfall 10).**
   - **Recommendation:** fold in as a small D-08/D-09-aligned change (uid-layer-only writes for ytmusic-sourced tracks), or defer if the planner wants a strict scope. Flag as optional in the plan.
4. **Vote abuse with no quorum (D-17).**
   - What we know: one vote publishes a cover for everyone. Last.fm `/i/u/` and googleusercontent / i.ytimg are user-generated-content hosts, so a crafted POST can put arbitrary UGC images on popular songs. Each user's local pin still wins.
   - **Recommendation:** keep D-17 as decided. Add the comments-style per-IP throttle (`checkThrottle` pattern, global-salt voterId) on POST: 1 extra R2 get+put per vote, no new binding. Document the residual risk with a `ponytail:` comment, as lyric-offset does.
5. **Crowd fetch on `restore()` (app resume without play).**
   - **Recommendation:** D-16 says play only. Leave restore alone; the local `crowd:` cache (14-day TTL) covers repeats.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | build/test | ✓ | v25.9.0 in shell (`.nvmrc` 22) | `nvm use` |
| pnpm | all | ✓ | 8.15.5 | — |
| Vitest | tests | ✓ | 4.1.8 | — |
| JDK 21 (Homebrew openjdk@21) | `pnpm apk` (Kotlin) | ✓ | installed | Must set `JAVA_HOME` (memory: default Java 20 fails) |
| adb + emulator AVD `Pixel_3a_API_34` | native UAT | ✓ | — | No API 24-28 AVD, so the legacy branch is UAT-gated on a real old device or left manual |
| wrangler | per-voter E2E (`wrangler pages dev`) | ✓ | ~/.nvm node22 bin | vite dev emulates DIAG (one client IP only) |
| unzip / python3 / ditto | ZIP verification | ✓ | system | — |
| Live upstreams (qq tang, iTunes, Deezer, netease meting) | E2E cover chain | ✓ | probed 2026-09-30 | kuwo upstream TLS is DEAD (curl exit 60), as the registry comment says |

**Missing dependencies with no fallback:** none. **Missing with fallback:** API ≤28 Android test device (manual or deferred UAT).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8, single node project (`vite.config.ts` test.projects, `src/**/*.{test,spec}.{js,ts}`) |
| Config file | `vite.config.ts` |
| Quick run command | `pnpm exec vitest --run <changed test files>` |
| Full suite command | `pnpm test && pnpm check` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-03 | crc32 check value `cbf43926`. buildZip round-trip: parse the headers back, sizes, UTF-8 flag, offsets, EOCD count. >4 GB guard returns null | unit | `pnpm exec vitest --run src/lib/services/zip-store.test.ts` | ❌ Wave 0 |
| D-01/Pit 8 | `sanitizePathSegment`: `..`, `/`, control chars, trailing dots, 180-byte CJK cap, empty → '' ; `albumDir` / `albumFolder` | unit | `pnpm exec vitest --run src/lib/services/download-filename.test.ts` | ✅ extend |
| D-01/D-02/Pit 1 | `put(..., {dir})` passes `subPath`. Re-put without a dir keeps the sticky dir. Single put with no dir has no `subPath` key. `del` clears the dir. `moveToDir` updates the URI and refuses device uids | unit | `pnpm exec vitest --run src/lib/services/blob-store.test.ts` | ✅ extend |
| D-04 | Album path calls `blobStore.put` (persist) and `save:false` skips the anchor. `onSaved` fires with uid + filename | unit | `pnpm exec vitest --run src/lib/services/download-track.test.ts` | ✅ extend |
| D-05/D-06/Pit 3 | download-album: a held single (sameSongKey, different uid) is moved, not re-downloaded (native) or reused (web). Failures are skipped. `onProgress` n/total. Web saves exactly ONE zip. `saved` count is correct | unit | `pnpm exec vitest --run src/lib/services/download-album.test.ts` | ❌ Wave 0 |
| D-06 | i18n key parity for the new toast keys in all 15 locales | unit | `pnpm exec vitest --run src/lib/i18n/i18n.test.ts` | ✅ existing |
| D-08 | Chain order QQ→iTunes→Deezer→CN→YTM. QQ tier = search + resolve. CN tier prefs `{qq:false, ytmusic:false}`. Stops at first hit | unit | `pnpm exec vitest --run src/lib/services/cover-backfill.test.ts` | ✅ extend (update `ytmCalls`/`cnCalls` filters at L92-93) |
| D-10 | Picker order own, qq, itunes, deezer, cn, ytm. Each source appears once | unit | same | ✅ extend |
| D-12 | `resolveShareCover` makes zero searchAll / qq calls. `coverToken` grammar unchanged (existing round-trip test) | unit | `… cover-backfill.test.ts src/lib/services/share.test.ts` | ✅ extend / existing |
| D-09/D-11 | HQ upgrade skipped for ytmusic / qq / pinned / crowd. Crowd beats inline in adoptCover. healCover evicts a dead crowd entry | unit | `pnpm exec vitest --run src/lib/stores/player.svelte.test.ts` | ✅ extend |
| D-14 | `readChosenCover` pin > crowd uid > crowd name. `readCoverByUidOrName` includes crowd. Crowd keys disjoint from name keys | unit | `… src/lib/stores/cover-version.svelte.test.ts src/lib/services/cover-cache.test.ts` | ✅ extend |
| D-17/D-19 | `consensus` most votes / tie → recent / re-vote replaces / cap 50. `parseVoteBody` screens | unit | `pnpm exec vitest --run src/lib/proxy/cover-pick.test.ts` | ❌ Wave 0 |
| D-18 | Allowlist accepts y.gtimg.cn, img4.kuwo.cn, p3.music.126.net. Rejects `img4.kuwo.cn.evil.example`, http, quotes | unit | `pnpm exec vitest --run src/lib/proxy/safe-image-url.test.ts` | ✅ extend |
| D-13/D-16/D-18 | Route matrix: 400 bad key, 503 no DIAG, 403 foreign origin, 415 type, 413 size, 400 non-allowlisted url, GET cache hit, POST busts exact key, both records written, no voter id/IP in bodies, never touches `log/` | unit | `pnpm exec vitest --run src/routes/api/cover-pick/cover-pick-endpoint.test.ts` | ❌ Wave 0 (clone the lyric-offset fakeBucket) |
| D-13 | `coverPickKeys`: domain-separated, `'|'` → no n, device uid → no u. fetch/submit never throw | unit | `pnpm exec vitest --run src/lib/services/cover-pick-shared.test.ts` | ❌ Wave 0 |
| route load | Verb-only exports really load (unit tests import the module directly and miss this) | E2E | `pnpm dev` then `curl -s localhost:<port>/api/cover-pick?u=<32hex>` returns 200 JSON (vite dev emulates DIAG) | manual |
| D-17 multi-voter | Distinct voters change the winner; tie → recent | E2E | `pnpm build && wrangler pages dev .svelte-kit/cloudflare --port 8799 --persist-to <scratch>/wr`, curl with spoofed `cf-connecting-ip` | manual |
| D-01/D-05 native | Album lands in `Music/OpenMusic/<Artist>/<Album>/`. A held single moves (row id unchanged on API 34). Retag keeps it in the album folder. Delete removes it | device | `pnpm apk` (JAVA_HOME=openjdk@21) → emulator Pixel_3a_API_34 → `adb shell content query --uri content://media/external/audio/media --projection _id:relative_path:_display_name` | manual |
| D-03 web | ZIP downloads once and unzips to the folder with tagged files | E2E | browser on dev server (Chrome) + `unzip -t` on the result. iOS Safari is manual | manual |

### Sampling Rate
- **Per task commit:** the quick command for the touched test files.
- **Per wave merge:** `pnpm test && pnpm check`.
- **Phase gate:** full suite green, plus `pnpm build` and `pnpm build:native` exit 0, plus the manual E2E/device rows above before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/services/zip-store.test.ts` — D-03
- [ ] `src/lib/services/download-album.test.ts` — D-05/D-06 (mock pattern: copy `download-track.test.ts` hoisted `vi.mock` block)
- [ ] `src/lib/proxy/cover-pick.test.ts` — D-17/D-19
- [ ] `src/routes/api/cover-pick/cover-pick-endpoint.test.ts` — route matrix (copy `fakeBucket` from `lyric-offset-endpoint.test.ts`)
- [ ] `src/lib/services/cover-pick-shared.test.ts` — client keys + never-throw

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Anonymous by design. voterId = SHA-256(ip\|key) |
| V3 Session Management | no | — |
| V4 Access Control | yes | `isAllowedOrigin` POST gate + JSON-only (no-preflight CSRF), R2 key builder confined to the `cover-pick/` prefix, never list |
| V5 Input Validation | yes | 32-hex key screen; body ≤1024 B (header + real length); url ≤512; `safeImageUrl(url, COVER_PICK_IMAGE_HOSTS)` (char screen, `new URL`, https, dot-anchored host allowlist); `parseRecord` re-validates stored entries |
| V6 Cryptography | yes (hashing only) | `crypto.subtle` SHA-256 (never hand-rolled); CRC-32 is integrity only, not security |
| V12 Files | yes | `sanitizePathSegment` (no `..`, separators or control chars) for MediaStore RELATIVE_PATH + ZIP entry names; Kotlin `safeSubPath` re-validates |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Drive-by votes from a foreign page | Spoofing/Tampering | Origin allow-list + `application/json` requirement (lyric-offset T-mzn) |
| Sybil / IP-rotation vote stuffing, no quorum | Tampering | Per-key voterId, MAX_VOTES cap, local pin wins. Recommended per-IP throttle (Open Q4). Residual risk documented |
| UGC image on an allowlisted host (googleusercontent, i.ytimg, Last.fm `/i/u/`) | Tampering (content) | Allowlist bounds it to known CDNs. Residual. Pin overrides locally |
| R2 key injection / reaching private `log/` | Elevation/Info disclosure | Only `pickObjectKey` builds keys, only from 32-hex input |
| CSS/attribute injection via stored URL | Tampering | `safeImageUrl` char screen + re-check on the client before writing the cache |
| RELATIVE_PATH escape / ZIP slip | Tampering | Segment sanitizer (TS) + `safeSubPath` (Kotlin), max 2 segments |
| Voter de-anonymization | Info disclosure | Only 16-hex hashes are stored, never returned. Raw IP never stored (same residual as lyric-offset: IPv4 hash is brute-forceable if the bucket leaks) |
| Write flood (R2 class-A ops) | DoS | Body caps. Throttle recommended. No new binding |

## Sources

### Primary (HIGH confidence)
- Codebase, read end to end: `download-track.ts`, `blob-store.ts`, `media-store.ts`, `MediaStoreSaverPlugin.kt`, `download-filename.ts`, `download-save.ts`, album `+page.svelte`, `cover-backfill.ts`, `cover-version.svelte.ts`, `cover-cache.ts`, `row-cover.ts`, `player.svelte.ts` (displayCover / play seed / postPlayCover / adoptCover / healCover), `TrackMenu.svelte`, `share.ts` `coverToken`, `safe-image-url.ts`, `lyric-offset` route/proxy/client, `comments.ts` throttle, `http.ts`, `registry.ts`, `catalog.ts`, `qq.ts`, `netease.ts`, `device-import.ts`, `retag.ts`, `backup-logic.ts`, `match-key.ts`
- Live probes 2026-09-30: tang qq search (no cover field), tang qq detail (`album_pic` http y.gtimg.cn 500x500, ~1.7 s), `y.gtimg.cn` https 500/800 → 200, netease meting `pic` → 302 to `p3.music.126.net`, kuwo upstream TLS failure
- Prototype: store-only ZIP verified with `unzip -t`, `python3 -m zipfile`, `ditto -x -k`
- PKWARE APPNOTE.TXT (pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) — header layouts, bit 11, CRC conditioning, DOS date
- developer.android.com/training/data-storage/shared/media — RELATIVE_PATH update moves files; own files need no permission on 10+

### Secondary (MEDIUM confidence)
- Project memories: share-carrier-grammar, r2-route-local-e2e-recipe, api-fetch-flood-freeze, wrangler-wrong-account, apk-build-needs-jdk21, apk-debug-via-emulator-cdp

### Tertiary (LOW confidence)
- FileSaver.js deferred-revoke convention, Windows UTF-8 zip handling, MediaStore update collision behaviour (all flagged [ASSUMED])

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. No new dependencies, and everything was verified in the repo.
- Architecture: HIGH. Every seam was read and line refs captured. The ZIP was prototyped.
- Pitfalls: HIGH for code-level pitfalls (sticky dir, uid mismatch, QQ null cover, row precedence). MEDIUM for Android/iOS platform behaviour (UAT-gated).

**Research date:** 2026-09-30
**Valid until:** 2026-10-30 (upstream API shapes can change without notice; re-probe the qq detail before execution if more than a week passes)
