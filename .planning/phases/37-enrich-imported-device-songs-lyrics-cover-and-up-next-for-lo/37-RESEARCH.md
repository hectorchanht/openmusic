# Phase 37: Enrich imported device songs — lyrics, cover and up-next for local files — Research

**Researched:** 2026-09-15
**Domain:** This codebase. `player.play()`'s offline-blob branch, the cover cache, taglib-wasm's picture read, the name-based lyric walk.
**Confidence:** HIGH (every finding below is file:line from this repo or an executed test; the two exceptions are flagged `[UNVERIFIED-SANDBOX]`)

---

## Summary

The phase description names three causes. **Two of them are wrong, and the real cause is a single early `return`.**

`player.play()` has an offline-blob fast path (`player.svelte.ts:3150-3217`) that ends in `return;` at **line 3217**. Everything the phase wants lives BELOW that return:

- `resolveCoverAsync` — the Deezer→iTunes→CN cover chain — is at **3442**.
- `upgradeCoverAsync` — the Deezer HQ upgrade — is at **3455**.
- The entire fresh-play up-next branch (`weaveFreshHistory`, `upNextAnchorUid`, `regenerate`) is at **3461-3486**.

A `device:` track ALWAYS takes the blob branch (`library.isDownloaded(uid)` is true for every imported row, and `blobStore.get` serves a device uid from its content URI at `blob-store.ts:218`). So it never reaches any of it. **This is also a pre-existing bug for ordinary downloaded tracks** — they lose the cover chain and the generated up-next too. Fixing it at the seam fixes both classes at once.

The lyric story is different and needs one new export. The blob branch DOES call `backfillLyrics` (`3160`), but `backfillLyrics` routes through `ensureTrackDetails` (`745`), which returns a device uid untouched at `catalog.ts:359`. So it is a guaranteed no-op. The repair already exists in the file: `crossSourceLyric` (`catalog.ts:566`) is a pure **name-based** lyric walk that returns a bare `string | null` and can never produce an `audioUrl`. It is just not exported.

The embedded-picture read is **not new work**. `readTags()` from `taglib-wasm/simple` — which `readAudioTags` (`audio-tags.ts:213`) already calls — populates `pictures` for free, in the same open pass (`node_modules/taglib-wasm/dist/src/utils/tag-mapping.js:34-35`). I proved it round-trips in all three containers by running a scratch vitest against the repo's own fixtures.

**Primary recommendation:** Do not add a device-specific enrichment pipeline. Delete the early `return` at `player.svelte.ts:3217` by letting the blob branch fall through to the shared post-play tail (cover chain + fresh-play up-next), add a `lrc`-only device branch beside `backfillLyrics`, and read the embedded picture out of the `readTags()` call that already exists.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Up-next content for a local song**
ONLINE SIMILAR SONGS — generate exactly as a streamed song does (similar-by-name, the existing Last.fm `track.getSimilar` path), so an imported song flows into the wider catalogue. Up-next entries will be songs the user does not own; that is accepted. Not "imported songs only", not a mixed/prefer-local ordering.

**When embedded tags are read**
ON FIRST PLAY, PER SONG. No scan-time pass over the whole library and no idle backfill worker. Reading tags off hundreds of files through taglib-wasm at import is explicitly rejected (686 kB module, 40 MB per-file ceiling, an Emscripten heap that grows but never shrinks — a real risk of a killed WebView on Android). The first play of each imported song pays one bounded wasm decode.

**Enrichment order (from the phase description, not re-litigated)**
Embedded tags FIRST (zero network — files downloaded from openmusic itself now carry both a FrontCover picture and the raw LRC), then a NAME-BASED online fallback when the file carries neither.

### Claude's Discretion
- Where the extracted embedded cover lives (the shared cover cache keyed by uid is the presumption, so every surface and the OS media card pick it up through the existing reactive read).
- How the name-based lyric lookup reaches a device track without going through the device-guarded `ensureTrackDetails` return.
- Whether the up-next generation needs a queue-context change, a device-specific branch, or neither.

### Deferred Ideas (OUT OF SCOPE)
*(CONTEXT.md has no `## Deferred Ideas` section.)*

### Canonical References — HARD CONSTRAINTS
- **34-D-01**: a `device:` uid is an identity NAMESPACE, not a source. `track.source` is a PLACEHOLDER (`'kuwo'`) that must NEVER be dispatched. No network resolve may ever produce an `audioUrl` for a device track.
- **No re-resolve loops**: the device early-return sits deliberately ABOVE `isTrackReady`.
- **No fan-out**: enrichment must not fire a per-row network call across hundreds of files.
- **Cover must reach the OS media card**: https or `data:`, landing in the SHARED cover cache.
- **taglib-wasm cost**: ~686 kB lazy dynamic import, `TAG_MAX_BYTES` 40 MB, heap grows but never shrinks.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

ROADMAP.md:411-419 lists Phase 37 with `**Requirements**: TBD` and `**Goal:** [To be planned]`. There are no requirement IDs to map. CONTEXT.md's `<domain>` block is the operative scope statement; the three deliverables are lyrics, cover, and up-next for a `device:` track.
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

| Directive | Where it bites this phase |
|---|---|
| Svelte 5 runes; stores are `*.svelte.ts` singletons | Any new memo store must be `.svelte.ts`; a pure cache must be plain `.ts` |
| **Generation-guard idiom** — snapshot `playGen`, re-check after EVERY `await` | Mandatory on all three new async pieces |
| Pure logic extracted into `.ts` for node-Vitest | Tag-picture extraction + lyric-by-name belong in `.ts`, not in the store |
| Never-throw services return a sentinel | New helpers return `null`, never reject |
| Zero `as any` in production source | — |
| `browser` guard on anything touching `localStorage`/`window`/`Image` | A `data:`-URL path touches none of these; a cache write does |
| Shared primitives — import, never re-inline | `hasHttpsScheme` (`services/url-safety.ts`), `combinedSignal` (`services/abort-signal.ts`), `writeCoverBoth` (`stores/cover-version.svelte.ts`), `bytesToBase64` (`services/media-artwork.ts`) |
| High comment density; decision refs (`37-D-nn`) are load-bearing | Every non-obvious choice gets a ref comment |
| `svelte-check` is the only quality gate (`pnpm check`) | Plus `pnpm test` |
| GSD workflow enforcement — no direct edits outside a GSD command | Planner/executor only |
| `pnpm deploy` is shadowed by a pnpm builtin — use `pnpm run deploy` | (MEMORY; CLAUDE.md documents it wrong) |
| **Push to main auto-deploys prod** (MEMORY) | Do not push mid-phase |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Read embedded picture + LRC from file bytes | Client / pure service (`audio-tags.ts`) | — | taglib-wasm is a client wasm module; `audio-tags.ts` already owns the codec and is node-testable |
| Convert picture bytes → renderable URL | Client / pure service | — | `bytesToBase64` already exists in `media-artwork.ts:71` |
| Name-based lyric lookup | Client service (`catalog.ts`) → API proxy → CN upstream | — | `crossSourceLyric` already lives here and threads `AbortSignal` |
| Name-based cover chain | Client service (`cover-backfill.ts`) → `/api/deezer`, iTunes direct, CN | — | `resolveCoverForTrack` is the single-item seam |
| Up-next generation | Client store (`player.regenerate`) → `similar.ts` → `/api/lastfm/similar-tracks` | — | `buildSimilarQueue` is artist/title driven, no source gate |
| Sequencing + supersedence | Client store (`player.svelte.ts`) | — | `playGen` is the only generation authority |
| Persistence of the enriched result | Client (localStorage via `library.downloads` / cover-cache) | — | **Size-constrained — see Pitfall 2** |

---

## Q1 — Lyrics for a device track

### How a NORMAL track gets its `lrc` today

Two shapes exist on `Track` (`sources/types.ts:38-41`): an **inline `lrc`** string and an **`lrcUrl`**.

| Source | Mechanism | Evidence |
|---|---|---|
| kuwo | inline `lrc` from the detail body, `lrcUrl: null` | `sources/kuwo.ts:102`, `:158` |
| qq | inline `lrc`, `lrcUrl: null` | `sources/qq.ts:294` |
| joox | inline, `lrcUrl` explicitly nulled | `sources/joox.ts:409` |
| ytmusic | inline, never sets `lrcUrl` | `sources/ytmusic.ts:143`, `:250-270` |
| **netease** | **the ONLY `lrcUrl` producer** — sets `lrcUrl` at search time, rewrites an upstream Meting URL to own-origin `/api/netease/lrc?id=`, then fetches it inside `resolve()` and fills `lrc` | `sources/netease.ts:107`, `:139-147`, `:170-178` |
| jamendo / audius / fivesing | `LYRICLESS_SOURCES` — never have lyrics | `catalog.ts:29` |

So **`lrcUrl` is a netease-internal staging field, consumed inside `netease.resolve()` before the track ever leaves the adapter.** By the time a track reaches the player it always carries an inline `lrc` or nothing. `NowPlaying.svelte:174` reads only `player.current?.lrc`:

```
player.current?.lrc ? splitParenLines(reorderPairs(parseLRC(player.current.lrc))) : []
```

Nothing in the UI reads `lrcUrl`. `player-persist.ts:54`/`:112` and `history-logic.ts:18` strip both as volatile.

**The cross-source tail.** When a resolve lands playable but lyric-less, `catalog.ts:540-551` runs `crossSourceLyric(resolved, sig)` and copies ONLY `resolved.lrc = lrc`. That function (`catalog.ts:566-597`) is:

- artist/title driven — `matchKey(artist, title)` identity + `scoreMatch` ranking;
- a **single-source walk** in registry order (`qq, netease, kuwo, joox, fivesing, jamendo, audius, ytmusic` — `registry.ts:44`), one `searchAll(query, 1, onlySource(src), signal)` per rung;
- bounded: resolves AT MOST one candidate per rung, stops at the first lrc;
- `AbortSignal`-threaded and never-throws (`return null` on everything).

**It returns a bare `string | null`. It cannot produce an `audioUrl` for the caller's track.** That is exactly the 34-D-01-safe shape this phase needs.

### Why a device track gets nothing today

`play()`'s blob branch fires `this.backfillLyrics(this.current)` at **`player.svelte.ts:3160`**. `backfillLyrics` (`:745-760`) does:

```
void ensureTrackDetails({ ...track, detailsLoaded: false, lrcUnresolved: true })
```

and `ensureTrackDetails` short-circuits at **`catalog.ts:359`**:

```
if (isDeviceUid(track.uid)) return track;
```

The input carries `lrc: null`, so the `.then` bails at `if (!resolved.lrc) return;`. **Guaranteed no-op, zero network, no loop.** Same for `restore()`'s blob branch at `:600`.

### Smallest honest fix

1. **Export a name-only wrapper from `catalog.ts`.** `crossSourceLyric` is currently `async function` (module-private, `:566`). Add:

   ```ts
   export async function lyricByName(artist: string, title: string, signal: AbortSignal): Promise<string | null>
   ```

   implemented as a thin call into the existing walk. **Do NOT pass the device Track object verbatim**: `crossSourceLyric` skips `src === track.source` (`:578`), and a device track's placeholder source is `'kuwo'` (`device-track.ts:121`) — the single best CN lyric source would be skipped for no reason. Pass a source the ladder does not contain (or drop the self-skip for the wrapper).

2. **Add a device branch in `backfillLyrics`** rather than a new call site. `backfillLyrics` is already the one seam every no-resolve path funnels through (`:600`, `:3160`, `:3339`), it already owns the `myGen` + `this.current?.uid` double guard, and it already skips when `track.lrc` is present. A device uid takes `lyricByName(track.artist, track.title, sig)` instead of `ensureTrackDetails`; everything else — the guards, the `.catch`, the `lrc`-only patch — is reused verbatim.

3. **Embedded LRC wins first.** `readAudioTags` already returns `lyrics` (`audio-tags.ts:229` — `t.lyrics?.[0]?.text`, from `ExtendedTag.lyrics: UnsyncedLyrics[]`, quick-260915-062). `parseLRC` (`lrc.ts:26`) drops any line with no `[mm:ss]` stamp, so a plain-text (unstamped) embedded lyric parses to `[]` and renders as "no lyrics" — **the network fallback must therefore be gated on "did `parseLRC` produce lines", not merely on "was the string non-empty"**, or a plain-text-lyric file silently shows an empty pane.

**Does a name-based lyric path exist?** Yes, complete and bounded (`catalog.ts:566`). Only the export is missing.

---

## Q2 — Embedded picture read (the sharpest question)

### The exact API — verified against installed `taglib-wasm@2.2.2`

**Finding that contradicts the phase description:** CONTEXT.md `<specifics>` says "A `getPictures`-equivalent read path is new work." It is not. `readAudioTags` already gets pictures for free.

`readAudioTags` calls `readTags(bytes)` from `taglib-wasm/simple` (`audio-tags.ts:214`). That routes `readTags → withAudioFile → readExtendedTag` (`dist/src/simple/tag-operations.js:9-14`), and `readExtendedTag` does:

```js
// node_modules/taglib-wasm/dist/src/utils/tag-mapping.js:34-35
const pictures = audioFile.getPictures();
if (pictures.length > 0) tag.pictures = pictures;
```

So `t.pictures` is populated by the **same single open pass** that already yields title/artist/album/lyrics. `ExtendedTag.pictures?: Picture[]` is declared at `dist/src/types/tags.d.ts:252`.

**Shape** (`dist/src/types/pictures.d.ts:15-23`):

```ts
interface Picture {
  readonly mimeType: string;                 // e.g. "image/jpeg"
  readonly data: Uint8Array;                 // raw image bytes
  readonly type: PictureType;                // "FrontCover" | "BackCover" | ... (21 members, :40)
  readonly description?: string;
}
```

`getPictures()` on the core handle is **synchronous** and is the exact mirror of the `setPictures` the write side already uses (`dist/src/taglib/audio-file-interface.d.ts:77-83`; impl `audio-file-impl.js:129-137` maps the numeric type back through `PICTURE_TYPE_NAMES`).

**Verified empirically, not assumed.** Given the two prior taglib-wasm doc failures called out in CONTEXT.md, I wrote a scratch vitest against the repo's own fixtures, embedded a 1×1 PNG via `writeAudioTags(..., { data, mimeType: 'image/png' })`, and read it back with `readTags`:

```
Test Files  1 passed (1)
     Tests  3 passed (3)      # tiny.mp3, tiny.m4a, tiny.flac
```

Each container returned `pictures[0].mimeType === 'image/png'`, `pictures[0].type === 'FrontCover'`, and `pictures[0].data.length === 71` (byte-exact). The scratch file was deleted. **This assertion belongs in `audio-tags.test.ts` as a permanent round-trip test.**

**Do NOT use `readCoverArt` / `readPictures` from `taglib-wasm/simple`** (`dist/src/simple/picture-operations.d.ts:10`, `:49`). Each is its own `withAudioFile` call — a **second full open + wasm heap copy** of a file up to 40 MB, for data the existing `readTags` call already has. `readCoverArt` also throws away the MIME type (returns bare `Uint8Array | undefined`), which you need for the `data:` URL. One pass, one dispose (the `TAG_MAX_BYTES` note at `audio-tags.ts:79-89` measures ~6× file size peak RSS and an Emscripten heap that never shrinks — a second pass doubles the exposure).

**Recommended shape:** widen `AudioTagFields` with an optional `art?: { data: Uint8Array; mimeType: string }`, populated from `t.pictures` in `readAudioTags`, preferring `type === 'FrontCover'` and falling back to `pictures[0]` (mirroring `readCoverArt`'s own documented fallback). Keep the existing "absent field is ABSENT, never empty" contract.

### How the bytes become something the cover surfaces accept

`data:` URL via the **existing** `bytesToBase64` (`media-artwork.ts:71-79` — chunked, no `FileReader`, works in node and the WebView). Not an object URL: a `blob:` URL is per-document, dies on reload, and the native media-session plugin has no branch for it.

**But `buildArtwork` rejects `data:` today.** `media-session.ts:66-73`:

```ts
export function buildArtwork(cover: string | null): MediaImage[] {
	if (hasHttpsScheme(cover)) { ...ladder... }
	return [{ src: FALLBACK_ART, sizes: 'any', type: 'image/svg+xml' }];   // '/favicon.svg'
}
```

`hasHttpsScheme` is https-only, so a `data:` cover becomes `/favicon.svg`. The native adapter then reads `value.artwork[0].src` (`native-media-session.ts:~95`) and hands it to `resolveArtworkDataUrl`, whose FIRST line is a pass-through for an already-`data:` URL (`media-artwork.ts:~118`) — **which would work perfectly if buildArtwork had not already destroyed it.**

**Required change (one predicate):** widen `buildArtwork`'s gate to accept `data:`. This is safe against the crash class the gate exists for: the plugin's `urlToBitmap()` takes its blocking-HTTP branch on `startsWith("http")` and its **network-free** branch on `;base64,` (documented at `media-artwork.ts:9-13` and `media-session.ts:38-50`). A `data:…;base64,` src is structurally incapable of the `IOException` that kills the process. Emit **ONE** `sizes: 'any'` entry for a `data:` cover, not the 6-entry `SIZE_LADDER` — the ladder would duplicate a ~100 KB string six times, and `native-media-session.ts` only reads `[0]` anyway (its own comment explains it loops and keeps the last).

### Size implication — the sharpest part

**A `data:` URL must NOT go into the shared cover cache.**

`cover-cache.ts` is localStorage-backed at key `openmusic:cover-cache:v1` (`:47`). Its sizing assumption is explicit at `:57-60`:

> "Cover URLs are tiny (~80–150 bytes/entry as `{u,t}` JSON), so 2000 entries is well under the ~5 MB localStorage budget"

A 1000×1000 JPEG is ~100–400 KB raw → **×4/3 base64 → 130–530 KB per entry.** Ten of those exceed the whole ~5 MB budget. And `writeKey` (`cover-cache.ts:194-220`) has **no https guard and no length guard** — it writes any non-empty string. The https gating lives entirely at the CALL SITES (`player.svelte.ts:3094`, `:3348`, `library.svelte.ts:136`, `cover-backfill.ts:~200`). `writeCoverBoth` (`cover-version.svelte.ts:~110`) is likewise ungated. So **`writeCoverBoth(uid, artist, title, dataUrl)` compiles, type-checks, and quietly poisons the cache.** On `QuotaExceededError` the `catch` swallows it and the ENTIRE `setItem` fails — meaning one oversized write can silently stop all subsequent cover caching for that session.

**Recommendation:** embedded art lives in **memory only**, in a module-level `Map<uid, string>` in a pure `.ts` (e.g. `device-art.ts`), capped at a handful of entries (the current track plus the prefetched next is all that is ever displayed). Persisting is not needed: the bytes are already on disk in the user's file, and the second play re-reads them from a blob that is already in memory at `player.svelte.ts:3129`.

`player.resolvedCover` is a plain `$state<string|null>` with no scheme constraint, so assigning a `data:` URL there works for the hero and nowbar immediately.

**Belt-and-braces:** cap the embedded picture at `MAX_ART_BYTES` (`media-artwork.ts:56` — 1 000 000, already exported and already the cap `resolveArtworkDataUrl` enforces). A picture over that is dropped and the name-based chain runs instead.

---

## Q3 — Cover for a device track: does the existing chain already run?

**Partly — and the part that does not run is the whole answer.**

### What DOES already run

`use:lazyCover` is applied to the downloads-tab rows (`routes/(app)/library/+page.svelte:297`; also `:236`, `:272`, `:336`). Imported tracks live in that tab (`library.downloads`, `device-import.ts:271`). `lazyCover` fires `resolveCoverForTrack(track)` — the full Deezer→iTunes→CN chain — on first intersection (`actions/lazyCover.ts:136`), and `resolveCoverForTrack` (`cover-backfill.ts:~195`) writes BOTH cache layers for any truthy uid. A device uid is truthy.

**So the name-based cover chain ALREADY runs for a device track — but only for a row the user has scrolled into view, and only on that page.**

### What does NOT run — the actual reason

`resolveCoverAsync` fires at **`player.svelte.ts:3442`**:

```ts
if (!hasHttpsScheme(this.resolvedCover)) void this.resolveCoverAsync(resolved, myGen);
```

The offline-blob branch **returns at line 3217** — 225 lines earlier. `upgradeCoverAsync` (`:3455`) is skipped too.

A device track therefore only ever shows the cover that the **synchronous** seed at `:3086-3092` found:

```ts
this.resolvedCover =
	this.attachedCoverFor(track) ?? track.cover ??
	getCachedCoverByUid(track.uid) ?? getCachedCover(track.artist, track.title) ?? null;
```

`rowToTrack` mints `cover: null` (`device-track.ts:126`), so this is a pure cache read. Tap a song whose row was never scrolled into view → all four rungs miss → `resolvedCover` stays `null` → the metadata write at `:3166` sends `buildArtwork(null)` = `/favicon.svg`, and **nothing ever re-tries, because the only re-try lives below the return.**

That is the honest, evidenced cause. It is not "the cover chain doesn't work for device tracks."

### The secondary cause (real, but second-order)

`tagOrEmpty` (`device-track.ts:88-93`) maps MediaStore's `<unknown>` placeholder — and a TITLE equal to the filename stem — to `''`. `rowToTrack:114` then takes `tagOrEmpty(row.artist) || parsed.artist || ''`, so an untagged, unparseable file legitimately imports with **`artist: ''`**. For such a track:

- `resolveTrackChain('', title, …)` → Deezer/iTunes queries degenerate; a miss is likely.
- `coverCacheKey('', title)` still produces a usable per-song key (`matchKey`), so caching is not broken, just useless.
- `resolveCoverForTrack` gets `null` and caches nothing (by design — failures are never cached, `cover-backfill.ts:~205`).

And `cover-backfill.ts`'s negative-miss cache (`:98-115`, `MISS_TTL_MS` 5 min) will suppress a retry for 5 minutes after a miss — but only for `backfillCovers`, **not** for `resolveCoverForTrack`, which has no miss memo at all. Flagged in Pitfall 5.

### Also worth knowing

On **native only**, the OS media card already has a second chance the web build does not: `native-media-session.ts` passes `/favicon.svg` into `resolveArtworkDataUrl`, which falls through to `/api/og?type=song&title=…&artist=…` (`media-artwork.ts:~125`) — a text-driven own-origin cover endpoint. A true miss there returns the branded share card with an `x-og-fallback` header, which `fetchAsDataUrl` correctly treats as no cover (`:~85`). So on Android the lock screen may already be showing art the in-app hero does not. Do not let that mislead a device UAT into thinking the cover chain works.

---

## Q4 — Up-next

### What installs the queue

`routes/(app)/library/+page.svelte:183-191`:

```ts
const ctx: QueueContext = tab === 'playlists' ? 'playlist' : tab === 'downloads' ? 'downloads' : 'liked';
player.setListQueue(list, ctx);
player.play(t, { fresh: true });
```

An imported track is on the **`downloads`** tab → context `'downloads'`.

### CONTEXT.md's stated cause #3 is WRONG

CONTEXT says "installs a `same-list` queue context." It does not. `effectiveUpnextMode` (`settings.svelte.ts:509-515`) returns `upnextPerContext[ctx] ?? upnextMode`, and `UPNEXT_DEFAULTS.perContext` is `{ album: 'same-list' }` **only** (`config/defaults.ts:143`) — `downloads` is not overridden, so it resolves to the global default `'generated'` (`defaults.ts:135`). The mode is already correct.

### The actual cause — the same early return

The `if (opts?.fresh)` branch that calls `regenerate` is at **`player.svelte.ts:3461-3486`**:

```
3461  if (opts?.fresh) {
3463      this.removedUids.clear();
3469      this.weaveFreshHistory(resolved);
3473      this.upNextAnchorUid = resolved.uid;
3475      if (settings.effectiveUpnextMode(this.queueContext) === 'generated') {
3477          void this.regenerate(resolved).then(() => this.primeNext());
3482      } else { void this.primeNext(); }
```

The blob branch returns at **3217**, after calling only `void this.primeNext()` (`:3216`). So a device play gets:

- **no `regenerate`** → no `buildSimilarQueue` → no online similar songs;
- **no `weaveFreshHistory`** → no history prefix;
- **no `upNextAnchorUid = resolved.uid`** → the anchor keeps whatever `setListQueue` set (`:2388`, `current.uid` — the PREVIOUS track), which is the exact null/stale-anchor class MEMORY records as `upnext-anchor-history-model` / quick-260712-hm9.

`primeNext()` → `ensureAhead()` (`:2934-2936`) is the only queue work that does run, and it early-returns unless `this.queue.length - i <= 2` (`:2514`). On a library of more than three songs it is a pure no-op. So Up-Next shows the tail of the downloads list, forever.

### The minimal change

`buildSimilarQueue` (`similar.ts:~165`) has **no source gate at all** — it is driven by `track.artist` / `track.title` only, through `fetchSimilarTracks` → `/api/lastfm/similar-tracks` (`similar.ts:64-82`), and falls through Deezer radio → similar-artists → same-artist → `buildDiversePicks`. `regenerate` (`player.svelte.ts:3780`) likewise names no source. **A device track needs no device-specific branch and no `QueueContext` change.** It only needs to reach line 3461.

The generated stubs carry `resolveByName: true` and a never-dispatched placeholder source (`similar.ts:128-152`); they resolve through `resolveNameStub` on play (`catalog.ts:~515`) exactly as they do for any other seed. No 34-D-01 exposure — the device track itself is never re-resolved.

**Named function + condition:** `Player.play`, the `if (offlineBlob && this.audio) { … return; }` block at `player.svelte.ts:3150-3217`. The `return;` at **3217** is the single condition to remove.

---

## Q5 — Ordering and bounding on first play

### The sequencing constraint

The blob branch already carries, in order: `blobStore.get` (IDB/content-URI read), `createObjectURL`, `backfillLyrics`, a media-metadata write, `audio.src = …`, `armStall()`, `prefetchNext()` (eager, `:3182`), `audio.play()`, `primeNext()`. This phase adds up to three more. They must not stack.

### Recommended order

| Step | When | Blocking? | Guard |
|---|---|---|---|
| 0 | `audio.src` set + `audio.play()` | — | **unchanged — must stay first** |
| 1 | Memo hit? (`Map<uid, {lrc, art}>`) → apply synchronously, done | sync | — |
| 2 | ONE `readAudioTags(new Uint8Array(await offlineBlob.arrayBuffer()))` — yields title/artist/album/**lyrics**/**picture** in a single wasm open | async, off critical path | `myGen !== this.playGen` after the await |
| 3a | Embedded LRC present AND `parseLRC(...).length > 0` → patch `current.lrc`, **skip the network lyric walk entirely** | sync after 2 | uid + gen |
| 3b | Embedded FrontCover present and `≤ MAX_ART_BYTES` → `bytesToBase64` → `data:` URL → `resolvedCover` + memo + fresh `MediaMetadata`, **skip `resolveCoverAsync`** | sync after 2 | uid + gen |
| 4 | Only for whichever of {lyric, cover} step 2 did NOT supply: fire the name-based fallback (`lyricByName` / `resolveCoverAsync`) — **in parallel with each other, never with step 2** | async | `myGen` snapshot, `AbortSignal` |
| 5 | Fall through to the existing `if (opts?.fresh)` up-next branch | async | `queueGen` (already inside `regenerate`) |

The wasm decode is the **gate**: it is the zero-network path and it decides whether steps 4a/4b run at all. Running it concurrently with the network fallbacks would fire calls that the file's own tags then make redundant — the opposite of this project's standing API-call-reduction posture.

### What an already-enriched replay must skip

Everything from step 2 on. The memo is the whole story:

- **The `lrc`**: writing it onto the `library.downloads` Track WOULD persist (the store JSON-stringifies the whole array — `library.svelte.ts:85-88`) and `syncDevice` refresh-in-place preserves a stored `cover` (`device-import.ts:249`). **But do not persist the lrc there.** An LRC is 2–6 KB; 500 imported songs is 1–3 MB of localStorage in a store that also holds liked + playlists + history. That is a quota hazard, and the enrichment is free to recompute from a local file. Keep it in the in-memory memo.
- **The picture `data:` URL**: in-memory only, per Q2.
- **The negative result matters too.** Memoise "this file has no embedded art / no embedded lyrics" so a replay does not pay a second 686 kB-module wasm decode to learn the same thing. Without it, every replay of an untagged file re-runs taglib and re-fires the network fallbacks.
- **Session-scoped is correct.** A new session pays one wasm decode per song actually played — bounded by user behaviour, never by library size. This is exactly the CONTEXT-locked "on first play, per song."

### Generation guarding

`playGen` is the only authority (`player.svelte.ts:3110-3114`). Snapshot `myGen` once, re-check after **every** await — `arrayBuffer()`, `readAudioTags`, `lyricByName`, `resolveCoverForTrack`. Additionally re-check `this.current?.uid === uid` before any write, exactly as `backfillLyrics:747-750` and `healCover:3687` do. A `data:`-URL cover write that lands after a track change would paint the wrong art on the hero AND the lock screen.

---

## Q6 — Pitfalls, each with the line that proves it

### Pitfall 1 — Removing the `return` at 3217 changes behaviour for ORDINARY downloads too
**Proof:** `player.svelte.ts:3127` `if (library.isDownloaded(track.uid))` — the branch is shared by every downloaded track, not only device ones.
**What happens:** downloaded tracks gain the cover chain and the generated up-next. That is almost certainly desirable (it is the same bug), but it is a behaviour change outside the phase's stated scope and must be a named decision, not a side effect.
**Mitigation:** make the fall-through unconditional and say so in a `37-D-nn` comment; do NOT gate it on `isDeviceUid` — a device-only gate re-creates the two-code-paths asymmetry that produced the four documented cover-surface bugs (MEMORY `hero-mediacard-cover-resolvedcover-asymmetry`).

### Pitfall 2 — A `data:` URL in the shared cover cache silently kills all cover caching
**Proof:** `cover-cache.ts:194-220` `writeKey` has no scheme and no length guard; its `catch` swallows `QuotaExceededError` (`:218`). Sizing assumption at `:57-60` is "~80–150 bytes/entry". `cover-version.svelte.ts:~110` `writeCoverBoth` is equally ungated.
**Mitigation:** never call `writeCoverBoth` with a `data:` URL. Consider adding a defensive `hasHttpsScheme` guard inside `writeKey` itself — one guard at the single shared writer beats four call-site guards, and it is the root-cause shape (the same reasoning `library.adoptCover:136` already applies at its own site).

### Pitfall 3 — A non-https cover in `resolvedCover` starves EVERY re-resolve
**Proof:** `player.svelte.ts:3442` `if (!hasHttpsScheme(this.resolvedCover))` (full chain) vs `:3455` `else if (hasHttpsScheme(this.resolvedCover) && …)` (Deezer upgrade) vs `healCover:3679` `if (!hasHttpsScheme(url)) return;`.
**This is the exact `media-card-shows-app-icon` bug** (knowledge-base.md:15-21): a truthy-but-not-https cover fell through **both** branches and could never reach the media card.
**Consequence for this phase:** a `data:` cover in `resolvedCover` is truthy-but-not-https — it will take the `:3442` branch and fire `resolveCoverAsync` on a track that already has art, on every play. The embedded-art path must set a flag (or the memo must be consulted) so `:3442` is skipped, OR `hasHttpsScheme` must be replaced at these three sites by a shared "is this a renderable cover" predicate covering `https:` + `data:`. **Prefer the shared predicate in `url-safety.ts`** — three sites, one definition, matching the shared-primitives table in CLAUDE.md.

### Pitfall 4 — `healCover` can loop on a `data:` cover
**Proof:** `healCover:3679` bails on non-https, so today a `data:` cover is simply never healed — fine. But `NowPlaying` calls `healCover` for ANY non-null displayed cover (comment at `:3666`). If the predicate in Pitfall 3 is widened without also widening `healProbed`'s one-shot key handling, a `data:` URL becomes a probe target. `this.healProbed.add(key)` at `:3685` keys on `` `${uid}|${url}` `` — a 400 KB `data:` URL as a Set key is a 400 KB string retained for the session, per track.
**Mitigation:** leave `healCover` https-only explicitly. A local file's embedded art cannot 404.

### Pitfall 5 — Fan-out across a large imported library
**Proof (a):** `lazyCover` already fires `resolveCoverForTrack` per row on intersection (`actions/lazyCover.ts:136`). Scrolling 500 imported rows = 500 Deezer→iTunes→CN chains. This is **pre-existing**, de-duped only by `inFlight` (`:44`) and the one-shot `done` flag — there is **no** concurrency cap and **no** negative-miss memo on this path (`MISS_TTL_MS` at `cover-backfill.ts:103` and the `CAP = 6` pool at `:92` are inside `backfillCovers`, which `lazyCover` does not use).
**Proof (b):** the only backstop is the `apiFetch` governor — `MAX_CONCURRENT_REQUESTS = 8` (`api-base.ts:71`), 25 s timeout (`:73`), circuit breaker at 30 failures / 3 s (`:99-102`). That governor is the fix for MEMORY `api-fetch-flood-freeze`. **iTunes tier-2 is a DIRECT `fetch` to `itunes.apple.com`, outside the governor.**
**Mitigation for this phase:** do not add any new per-row path. Enrichment fires from `play()` only, for `this.current`, exactly once per uid per session. Do NOT add a "warm the next track's tags" step to `prefetchNext` — that turns one wasm decode per play into two, and the heap never shrinks.

### Pitfall 6 — Re-resolve loop risk
**Proof:** `catalog.ts:351-359` — the device early return sits ABOVE `isTrackReady` deliberately, because a local file has no `resolvedAt`/TTL. MEMORY records three distinct loop classes: the synchronous `audio.error` re-resolve storm (`nowbar-freeze-reresolve-loop`), the async `/api/*` fetch flood (`api-fetch-flood-freeze`), and the `$effect` self-invalidation at mount (`restore-effect-self-invalidation-loop`).
**The trap here:** patching `this.current = {...this.current, lrc}` / `resolvedCover = dataUrl` mutates tracked `$state`. If any `$effect` in `NowPlaying`/`+layout` reads those fields and triggers further enrichment, that is loop class 3 verbatim. **Nothing new may re-enter `play()` or touch `audio.src`.** `backfillLyrics` is the correct template: it writes `this.current` and nothing else, never bumps a generation, never touches the audio element.
**Also:** the enrichment MUST NOT set `detailsLoaded: false` or clear `audioUrl` on a device track — those are the inputs `reresolveCurrent:648` uses, and a device track has no url to re-resolve.

### Pitfall 7 — A plain-text embedded lyric renders as an empty pane
**Proof:** `lrc.ts:26-42` `parseLRC` `continue`s on any line with no `[mm:ss]` match, so an unstamped lyric yields `[]`. `NowPlaying.svelte:174` renders that as nothing.
**Mitigation:** gate the "we have lyrics, skip the network" decision on `parseLRC(text).length > 0`, not on `text.length > 0`.

### Pitfall 8 — `crossSourceLyric` skips the device track's placeholder source
**Proof:** `catalog.ts:578` `if (src === track.source || LYRICLESS_SOURCES.has(src)) continue;` and `device-track.ts:121` `source: 'kuwo'`.
**Consequence:** a device track's lyric walk silently skips kuwo — the primary CN lyric source and (per MEMORY `sandbox-no-cn-upstream-network`) **the only CN source reachable from this sandbox**. Passing the device Track straight in would make the feature untestable locally and weaker in production.

### Pitfall 9 — `buildArtwork`'s size ladder × a `data:` URL
**Proof:** `media-session.ts:67-69` builds 6 `MediaImage` entries all carrying the same `src`. `native-media-session.ts` explicitly notes the plugin loops the array and keeps only the last, which is why it takes `[0]`.
**Mitigation:** single `sizes: 'any'` entry for a `data:` cover.

### Pitfall 10 — `readAudioTags` returns `null` for an unrecognised container
**Proof:** `audio-tags.ts:216-217` — `CONTAINER_BY_FORMAT` covers MP3 / MP4 / FLAC only (`:117-121`). An imported `.ogg` / `.wav` / `.opus` returns `null`, not an error.
**Mitigation:** treat `null` as "no embedded data" and go straight to the name-based fallback. Never surface an error. Note `tagAudioBlob` checks size BEFORE `arrayBuffer()` (`:280`) — the read path must do the same (`blob.size > TAG_MAX_BYTES` → skip the decode entirely), or a 45 MB FLAC gets fully copied into memory just to be rejected at `writeAudioTags:145`.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Read the embedded FrontCover | `getPictures()` on a second wasm open | `readTags()`'s `t.pictures` — already in the call | `tag-mapping.js:34-35`; second open doubles a 40 MB-ceiling heap |
| Bytes → renderable URL | A new base64 helper / `FileReader` | `bytesToBase64` (`media-artwork.ts:71`) | Chunked, node + WebView safe, already tested |
| Name-based lyric lookup | A new search-and-pick walk | `crossSourceLyric` (`catalog.ts:566`) | Already bounded, ranked, abortable, never-throws |
| Online similar up-next | A device-specific queue builder | `regenerate` → `buildSimilarQueue` (`similar.ts`) | No source gate; artist/title only |
| Cover fallback chain | A new Deezer/iTunes call | `resolveCoverForTrack` (`cover-backfill.ts:~195`) | One seam, https-gated, writes both layers |
| "Is this cover usable" | A new regex | `hasHttpsScheme` (`services/url-safety.ts`) — widened once if `data:` is needed | 6 copies under 4 names were already deduped |
| Supersedence | A new abort flag | `playGen` snapshot + re-check after every await | The house idiom; `backfillLyrics:745` is the template |
| Caller signal + timeout | `Promise.race` with a local timer | `combinedSignal` (`services/abort-signal.ts`) | Composing local bounds is the named `api-fetch-flood-freeze` root cause |

---

## Code Examples

### The existing lyric walk (the thing to export) — `catalog.ts:566-597`
```ts
async function crossSourceLyric(track: Track, signal: AbortSignal): Promise<string | null> {
	const wantKey = matchKey(artist, title);
	const order = getEnabledAdapters({}).map((a) => a.id);
	for (const src of order) {
		if (signal.aborted) return null;
		if (src === track.source || LYRICLESS_SOURCES.has(src)) continue;   // <- skips 'kuwo' for a device track
		const sr = await searchAll(query, 1, onlySource(src), signal);
		const best = sr.interleaved
			.filter((c) => matchKey(c.artist || '', c.title || '') === wantKey)
			.sort((a, b) => scoreMatch(q, b) - scoreMatch(q, a))[0];
		if (best?.lrc?.trim()) return best.lrc;
		const resolvedCand = await SOURCES[best.source].resolve(best, signal);
		if (resolvedCand.lrc?.trim()) return resolvedCand.lrc;
	}
	return null;
}
```

### The guard template every new async piece must copy — `player.svelte.ts:745-760`
```ts
private backfillLyrics(track: Track) {
	if (track.lrc) return;
	const uid = track.uid;
	const myGen = this.playGen;
	void ensureTrackDetails({ ...track, detailsLoaded: false, lrcUnresolved: true })
		.then((resolved) => {
			if (myGen !== this.playGen) return;        // track changed mid-fetch
			if (this.current?.uid !== uid) return;     // current moved on
			if (!resolved.lrc) return;
			this.current = { ...this.current, lrc: resolved.lrc, lrcUrl: resolved.lrcUrl };
		})
		.catch(() => { /* best-effort */ });
}
```

### The gate that destroys a `data:` cover — `media-session.ts:66-73`
```ts
export function buildArtwork(cover: string | null): MediaImage[] {
	if (hasHttpsScheme(cover)) {
		const ladder: MediaImage[] = SIZE_LADDER.map((sizes) => ({ src: cover, sizes, type: '' }));
		ladder.push({ src: cover, sizes: 'any', type: '' });
		return ladder;
	}
	return [{ src: FALLBACK_ART, sizes: 'any', type: 'image/svg+xml' }];  // '/favicon.svg'
}
```

### The receiving end that would accept it — `media-artwork.ts` `resolveArtworkDataUrl`
```ts
if (q.cover && q.cover.startsWith('data:')) return q.cover;   // pass-through, network-free
```

---

## Runtime State Inventory

Not a rename/refactor/migration phase — but two categories have real content worth recording.

| Category | Items found | Action |
|---|---|---|
| Stored data | `openmusic:cover-cache:v1` (localStorage, MAX_ENTRIES 2000, 14 d TTL, ~5 MB budget) — **must not receive a `data:` URL** (Pitfall 2). `openmusic:library:v1` holds full `Track` objects incl. any `lrc` you write — quota hazard at scale. | Memory-only memo; no schema change |
| Live service config | None — no external service holds device-track state. | None |
| OS-registered state | MediaStore rows are read-only inputs; `deviceContentUri` is reconstructed, never persisted (`device-track.ts:65-70`). | None |
| Secrets / env vars | `LASTFM_KEY` gates `/api/lastfm/similar-tracks`; absent → up-next falls to Deezer radio then diverse picks (`similar.ts:~180`). Present in `.dev.vars`. | None |
| Build artifacts | `taglib-wasm@2.2.2` already installed; no new dependency. | None |

---

## Environment Availability

| Dependency | Required by | Available here | Version | Fallback |
|---|---|---|---|---|
| `taglib-wasm` | Embedded tag + picture read | ✓ | 2.2.2 (`node_modules/taglib-wasm/package.json`) | none needed |
| Deezer (`api.deezer.com`) | Cover tier 1 | ✓ (HTTP 200) | — | iTunes → CN |
| Last.fm (`ws.audioscrobbler.com`) | `track.getSimilar` up-next | ✓ (HTTP 400 on a bare call = reachable) | — | Deezer radio → similar-artists → diverse |
| `LASTFM_KEY` | same | ✓ in `.dev.vars` | — | `/api/similar` falls back same-artist |
| kuwo upstream | Lyric walk rung | ✓ per MEMORY `sandbox-no-cn-upstream-network` (`kuwo.cn` root returns 500, but the app uses a different host) | — | qq / netease (both blocked here) |
| netease / qq upstreams | Lyric walk rungs | **✗ blocked in this sandbox** (MEMORY) | — | kuwo answers |
| Android device / emulator | Media-card + MediaStore verification | Emulator available per MEMORY `apk-debug-via-emulator-cdp` (Pixel_3a_API_34 + CDP); `pnpm apk` needs `JAVA_HOME` → Homebrew `openjdk@21` | — | — |

**`[UNVERIFIED-SANDBOX]`** — two things cannot be proven here and must be device/emulator UAT:
1. That a real MediaStore-imported file's embedded FrontCover survives `getPictures()` on a real Android file (verified only against synthetic fixtures in node).
2. That a `data:` artwork src actually repaints the Android lock screen through `@jofr/capacitor-media-session` (the `;base64,` branch is read from the plugin source comment at `media-artwork.ts:9-13`, not executed here).

---

## Validation Architecture

### Test framework
| Property | Value |
|---|---|
| Framework | Vitest `^4.1.3` (resolved 4.1.8), single node/server project, **no jsdom** |
| Config | `vite.config.ts` |
| Quick run | `pnpm vitest --run <file>` |
| Full suite | `pnpm test` (`vitest --run`), plus `pnpm check` (`svelte-check`) |

### Deliverable → test map
| Deliverable | Behaviour | Type | Command | Exists? |
|---|---|---|---|---|
| Picture read | `writeAudioTags(art)` → `readAudioTags` returns `art` for mp3/m4a/flac | unit | `pnpm vitest --run src/lib/services/audio-tags.test.ts` | ❌ **Wave 0** (I proved it in scratch; make it permanent) |
| Picture read | Oversized picture (> `MAX_ART_BYTES`) is dropped, not embedded | unit | same | ❌ Wave 0 |
| Picture read | Unknown container / `null` bytes → `null`, never throws | unit | same | ✅ pattern exists |
| Lyric by name | `lyricByName` returns a string and NEVER an `audioUrl`-bearing Track | unit | `pnpm vitest --run src/lib/services/catalog.test.ts` | ❌ Wave 0 (`catalog.test.ts:770-790` has the crossSourceLyric harness to extend) |
| Lyric by name | Walks all rungs incl. kuwo for a device seed | unit | same | ❌ Wave 0 |
| Device enrichment | A `device:` play patches `current.lrc` without calling `ensureTrackDetails` | unit | `pnpm vitest --run src/lib/stores/player.svelte.test.ts` | ❌ Wave 0 |
| Device enrichment | A `device:` play NEVER acquires an `audioUrl` (34-D-01 regression) | unit | same | ❌ Wave 0 — **highest-value test in the phase** |
| Device enrichment | Second play of the same uid does ZERO wasm decodes (memo) | unit | same | ❌ Wave 0 |
| Cover | Embedded art → `data:` in `resolvedCover`, and **NOT** in the cover cache | unit | same + `cover-cache.test.ts` | ❌ Wave 0 |
| Media card | `buildArtwork('data:image/jpeg;base64,…')` → one entry, not `/favicon.svg` | unit | `pnpm vitest --run src/lib/services/media-session.test.ts` | ❌ Wave 0 |
| Up-next | A `device:` fresh play reaches `regenerate` and installs similar stubs | unit | `pnpm vitest --run src/lib/stores/player.svelte.test.ts` | ❌ Wave 0 |
| Up-next | `upNextAnchorUid === device uid` after a fresh device play | unit | same | ❌ Wave 0 |
| Loop safety | No `audio.src` re-drive and no `playGen` bump from any enrichment | unit | same | ❌ Wave 0 |

### Sampling rate
- **Per task commit:** `pnpm vitest --run src/lib/services/audio-tags.test.ts src/lib/services/catalog.test.ts src/lib/stores/player.svelte.test.ts`
- **Per wave merge:** `pnpm test && pnpm check`
- **Phase gate:** full suite green, plus **device/emulator UAT** for the two `[UNVERIFIED-SANDBOX]` items.

### Wave 0 gaps
- [ ] Picture round-trip assertions in `src/lib/services/audio-tags.test.ts` (fixtures already exist: `__fixtures__/tiny.{mp3,m4a,flac}`)
- [ ] `lyricByName` cases in `src/lib/services/catalog.test.ts`
- [ ] Device-enrichment + up-next cases in `src/lib/stores/player.svelte.test.ts`
- [ ] `data:` artwork case in `src/lib/services/media-session.test.ts`
- No framework install needed.

---

## Security Domain

### Applicable ASVS categories
| Category | Applies | Control |
|---|---|---|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| **V5 Input Validation** | **yes** | Embedded tag values are **untrusted file content**. The `mimeType` from `Picture` goes verbatim into a `data:` URL. Validate against an image allowlist (`image/jpeg|png|webp`) before building the URL — `media-artwork.ts:62` `isImageType` is the existing predicate. Enforce `MAX_ART_BYTES`. |
| V6 Cryptography | no | — |
| V12 File Handling | **yes** | `TAG_MAX_BYTES` (40 MB, `audio-tags.ts:89`) must be checked against `blob.size` **before** `arrayBuffer()`. `readAudioTags` never throws (`:245`). |

### Threat patterns for this stack
| Pattern | STRIDE | Mitigation |
|---|---|---|
| Crafted `mimeType` in an ID3 APIC frame → arbitrary scheme in a `data:` URL | Tampering / XSS | Allowlist the MIME; render as `<img src>` attribute only, **never** CSS `url()` (T-rvy-01, `cover-cache.ts:15-17`) |
| Huge embedded picture → localStorage quota exhaustion, killing all cover caching | DoS | Never cache a `data:` URL; cap at `MAX_ART_BYTES` |
| 40 MB+ file → Emscripten heap growth → WebView kill | DoS | `TAG_MAX_BYTES` pre-check on `blob.size` |
| Device-track lyric lookup accidentally producing an `audioUrl` | Tampering (34-D-01) | `lyricByName` returns `string \| null` by construction; assert it in a test |
| Enrichment storm across a large library | DoS (self) | Play-scoped only; `apiFetch` governor + circuit breaker as backstop |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | The user's "no cover" report is the `:3217` early return, not a broken cover chain | Q3 | If some device tracks DO show a cover (because their row was scrolled), the fix still applies but the symptom description was incomplete |
| A2 | `@jofr/capacitor-media-session`'s `;base64,` branch renders a `data:` artwork on the lock screen | Q2 | Read from the plugin-source quote in `media-artwork.ts:9-13`, not executed. If wrong, embedded art reaches the hero but not the OS card, and `/api/og` remains the card's path |
| A3 | A real MediaStore file's embedded picture behaves like the synthetic fixtures | Q2 | Verified for synthetic mp3/m4a/flac only; a real ID3v2.3 APIC with an odd text encoding could differ |
| A4 | Making the blob branch fall through is acceptable for ordinary downloads too | Pitfall 1 | Needs an explicit decision, not an assumption |
| A5 | Session-scoped memoisation is sufficient (no persistence) | Q5 | If users complain about a per-session re-decode delay, revisit — but persisting LRC text at library scale is a quota hazard |

---

## Open Questions

1. **Should the fall-through apply to ordinary downloaded tracks?**
   Known: they hit the same `return` and lose the same two features. Unclear: whether that is intended for offline-first behaviour (a cover chain is a network call on a path designed to work offline). Recommendation: **yes, fall through** — the cover chain is already best-effort and never-throws offline, and a device-only gate would re-create the exact asymmetry that caused four prior cover bugs. Record as `37-D-01`.

2. **A device track with `artist: ''`** (an untagged, unparseable file — `device-track.ts:114`).
   Known: the tag read at step 2 can RECOVER artist/title from the file's own embedded tags, which MediaStore missed. Unclear: whether to write the recovered artist/title back onto the library entry. Recommendation: yes — it is free, it is the file's own truth (34-D-15 "tags win"), and it is what makes the name-based fallbacks work at all. It also survives a re-import: `syncDevice` refresh-in-place only carries `cover` across (`device-import.ts:249`), so a re-scan would blank a recovered artist. **That is a real gap the planner must close** — either persist the recovered fields the way `cover` is carried, or accept a re-decode after each re-import.

3. **`hasHttpsScheme` widening vs a flag.** Three sites (`:3442`, `:3455`, `healCover:3679`) branch on it. A shared "renderable cover" predicate in `url-safety.ts` is the root-cause fix; a per-track flag is smaller but re-creates the two-predicate asymmetry. Recommendation: the shared predicate, applied at `:3442`/`:3455` and `buildArtwork`, with `healCover` left explicitly https-only (Pitfall 4).

---

## State of the Art

| Old belief (from the phase description) | What the code actually says | Evidence |
|---|---|---|
| "Playing an imported song installs a `same-list` queue context" | It installs `'downloads'`, which resolves to `'generated'` | `library/+page.svelte:187`, `defaults.ts:143`, `settings.svelte.ts:509` |
| "`audio-tags.ts` has NO picture read — new work" | `readTags()` already returns `pictures` in the same open pass | `tag-mapping.js:34-35`; proven by executed round-trip |
| "`rowToTrack` mints `cover: null` and nothing ever fills them" | `lazyCover` DOES fill the cover cache for a scrolled device row; the play path is what never re-tries | `lazyCover.ts:136`, `library/+page.svelte:297`, `player.svelte.ts:3217` vs `:3442` |
| "`ensureTrackDetails`'s early return skips the enrichment a normal track gets" | True for lyrics; for cover and up-next the blocker is `play()`'s own `return`, 200 lines earlier | `catalog.ts:359`; `player.svelte.ts:3217` |
| "Phase 34's device import reads through `audio-tags.ts`" (module header claim) | It does not — `readAudioTags` has exactly one caller, `retag.ts:93`. Import uses MediaStore columns only | `grep readAudioTags`, `device-track.ts:108-142` |

---

## Package Legitimacy Audit

**No new packages.** Every dependency this phase touches is already in `package.json`: `taglib-wasm@2.2.2` (installed, verified in `node_modules`), `@jofr/capacitor-media-session`. No install step, so the slopcheck gate does not apply.

---

## Sources

### Primary (HIGH — this repo / executed)
- `src/lib/stores/player.svelte.ts` — `play()` blob branch `:3127-3217`; `resolveCoverAsync` `:3442`/`:3511`; up-next branch `:3461-3486`; `regenerate` `:3780`; `backfillLyrics` `:745`; `syncMetadata` `:1289`; `healCover` `:3675`; `ensureAhead` `:2504`; `setQueue`/`setListQueue` `:2313`/`:2368`
- `src/lib/services/catalog.ts` — device guard `:359`; `LYRICLESS_SOURCES` `:29`; cross-source tail `:540-551`; `crossSourceLyric` `:566-597`
- `src/lib/services/audio-tags.ts` — `readAudioTags` `:213-245`; `TAG_MAX_BYTES` `:89`; `writeAudioTags` `:145-200`
- `src/lib/services/cover-cache.ts` — sizing `:57-60`; `writeKey` `:194-220`
- `src/lib/stores/cover-version.svelte.ts` — `writeCoverBoth`, `readCoverByUidOrName`
- `src/lib/services/media-session.ts` — `buildArtwork` `:66-73`
- `src/lib/services/media-artwork.ts` — `bytesToBase64` `:71`; `MAX_ART_BYTES` `:56`; `resolveArtworkDataUrl`
- `src/lib/services/native-media-session.ts` — metadata setter, `[0]`-only artwork
- `src/lib/services/cover-backfill.ts` — `resolveCoverForTrack`, `resolveTrackChain`, miss cache `:98-115`
- `src/lib/services/similar.ts` — `buildSimilarQueue`, `nameStub` `:128-152`
- `src/lib/services/device-track.ts` / `device-import.ts` / `blob-store.ts` — device identity, import plan, `nativeGet` `:218`
- `src/routes/(app)/library/+page.svelte` — `playList` `:183-191`, `use:lazyCover` `:297`
- `src/lib/actions/lazyCover.ts` — per-row resolve `:136`
- `src/lib/config/defaults.ts` — `QueueContext` `:109-122`, `UPNEXT_DEFAULTS` `:124-143`
- `node_modules/taglib-wasm/dist/src/utils/tag-mapping.js:34-35`, `dist/src/types/pictures.d.ts:15-40`, `dist/src/taglib/audio-file-impl.js:129-145`, `dist/src/simple/picture-operations.d.ts`
- **Executed:** scratch vitest, picture round-trip, 3/3 passed across mp3/m4a/flac (file deleted after)
- **Executed:** `curl` reachability probes (Deezer 200, Last.fm reachable)

### Secondary (MEDIUM)
- `.planning/debug/knowledge-base.md` — `media-card-shows-app-icon`, `stall-kills-healthy-tracks`
- Session MEMORY — `nowbar-freeze-reresolve-loop`, `api-fetch-flood-freeze`, `restore-effect-self-invalidation-loop`, `hero-mediacard-cover-resolvedcover-asymmetry`, `sandbox-no-cn-upstream-network`, `upnext-anchor-history-model`, `media-session-artwork-native-crash`, `apk-debug-via-emulator-cdp`, `openmusic-pushes-autodeploy-live`

### Tertiary (LOW)
- None. No web search was needed — every question was answerable from this repo.

---

## Metadata

**Confidence breakdown**
- Root cause (the `:3217` return): **HIGH** — line-exact, three separate skipped features trace to it
- taglib picture API: **HIGH** — read from installed `.d.ts`/`.js` AND executed round-trip in all three containers
- Lyric path: **HIGH** — `crossSourceLyric` read in full; the no-op proof is a two-hop trace
- Up-next: **HIGH** — context resolution traced through `defaults.ts` + `settings.svelte.ts`; contradicts CONTEXT
- `data:` on the Android lock screen: **MEDIUM** — plugin-source quote, not executed here (A2)
- Real-device MediaStore picture behaviour: **MEDIUM** — synthetic fixtures only (A3)

**Research date:** 2026-09-15
**Valid until:** 2026-10-15 (stable — all findings are in-repo; only the sandbox network notes can drift)
