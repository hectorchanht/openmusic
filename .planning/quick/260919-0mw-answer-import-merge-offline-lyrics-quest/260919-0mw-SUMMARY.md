---
phase: quick-260919-0mw
plan: 01
subsystem: covers / share / downloads / now-playing
tags: [cover-chain, ytmusic, share-links, capacitor, audio-tags, nowplaying]
requires: [searchAll, onlySource, matchKey, apiUrl, DownloadControl]
provides: [resolveHqCover, shareOrigin, apiOrigin, albumTag]
affects: [cover-backfill, share, api-base, audio-tags, download-track, retag, NowPlaying, player]
tech-stack:
  added: []
  patterns: [single-source-of-truth tier chain, shared-primitive reuse over re-inlining, prefs-aware test mocking]
key-files:
  created: []
  modified:
    - src/lib/services/cover-backfill.ts
    - src/lib/services/cover-backfill.test.ts
    - src/lib/services/cover-cache.ts
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/services/share.ts
    - src/lib/services/share.test.ts
    - src/lib/services/api-base.ts
    - src/lib/services/audio-tags.ts
    - src/lib/services/audio-tags.test.ts
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
    - src/lib/services/retag.ts
    - src/lib/services/retag.test.ts
    - src/lib/components/NowPlaying.svelte
decisions:
  - "Cover track chain is YTM -> iTunes -> Deezer -> CN; the artist chain stays Deezer -> iTunes"
  - "resolveDeezerHQ renamed resolveHqCover and made a two-tier YTM -> Deezer ladder"
  - "shareOrigin() is the single origin authority in share.ts; a real web origin always passes through unchanged"
  - "The public share origin is api-base's VITE_API_BASE, not a second hardcoded domain"
  - "albumTag() drops an album equal to any supplied title; both tag writers route through it"
  - "NowPlaying gains a DownloadControl as an addition, not a swap (shuffle was already gone)"
metrics:
  tasks: 5
  commits: 4
  tests: 2541 passing (129 files)
  completed: 2026-09-19
---

# Quick 260919-0mw: Import/Offline Answers + Four Fixes Summary

Answered the import-merge and offline-lyrics questions from code, then shipped four
independent fixes: YouTube Music now leads the cover chain, share links stop emitting
`https://localhost` from the APK, downloaded files stop claiming the song title is an
album, and the now-playing transport row gained a download control.

---

## Answers

### Q1. Does app-data import MERGE with existing data, or overwrite it?

**It REPLACES. It does not merge, and the policy is uniform across every domain it
touches.** The decision is `35-D-08`, and it is decided in exactly one place:
`src/lib/backup/backup-logic.ts:288` — `wipeAndWrite()`.

Confirmed against the body, not just the comment:

- `backup-logic.ts:289-291` — it builds a `doomed` list of **every** restorable key
  (`BACKUP_EXACT_KEYS` plus every `openmusic:name-tr:*` key found on the live store),
  `removeItem`s all of them, and only then `setItem`s the file's payloads. A key the file
  does NOT carry is still deleted. So importing a backup that contains only settings
  **wipes your library** — this is a replace, not a per-key upsert.
- The wipe is a plain `removeItem`, deliberately **not** `library.clearAll()`
  (`backup-logic.ts:280-283`): `clearAll()` would mutate live runes fields and fire
  `save()`, which could write an empty blob back over the `setItem`.

**Per domain** (`backup-logic.ts:60`, `BACKUP_EXACT_KEYS`):

| Domain | Key | Import behaviour |
|---|---|---|
| Library (liked songs, playlists, **downloads list**) | `openmusic:library:v1` | **Replaced** wholesale |
| Play history | `openmusic:history:v1` | **Replaced** wholesale |
| Search history | `openmusic:search-history:v1` | **Replaced** wholesale |
| Settings | `openmusic:settings:v1` | **Replaced** wholesale |
| Name translations | every `openmusic:name-tr:*` | **Replaced**, including languages the file does not carry |
| Player state (now playing, queue, seek) | `openmusic:player:v1` | **Untouched** — excluded from backup by `35-D-02` (pinned at `backup-logic.test.ts:112`) |
| Downloaded audio BLOBS (IndexedDB) | — | **Untouched.** Only the downloads *list* is in the envelope. `35-D-07` (`settings/data/+page.svelte:112-116`) is what reconciles the two: "missing" is computed from `blobStore.has` at render time and never stored in the file, so an imported entry whose bytes happen to be on this device reads as present, one whose bytes are absent reads as missing. |

**Undo and the warning.** It is not a silent destructive step:

- `applyEnvelope` (`backup-logic.ts:309-311`) snapshots the **current** store into the
  undo store **before** any write, and `35-D-09` refuses the whole import (`'no-snapshot'`)
  if the snapshot cannot be stored — nothing has been written at that point, so the live
  store is byte-identical.
- A mid-write failure rolls back through the same validator the import path uses
  (`backup-logic.ts:315-330`), returning `'write-failed'`.
- `undoImport` (`backup-logic.ts:342`) puts the pre-import bytes back; `hasUndoSnapshot`
  (`backup-logic.ts:373`) is what makes the affordance appear after the reload. One level
  of undo, no redo stack.
- The caller is `src/routes/(app)/settings/data/+page.svelte:87-88`, and the user IS warned
  first: a `confirm()` carrying `backup.importConfirm` — *"Replace your liked songs,
  playlists, downloads list, play history, search history, settings and name translations
  on this device with the contents of this file?"* (`src/lib/i18n/en.ts:486`). The word
  "Replace" in that string is accurate.

### Q2. Is lyrics read from the downloaded file offline, or does it still need the network?

**A downloaded song IS lyrics-self-sufficient offline — but only when the file actually
carries usable embedded LRC. When it does not, offline playback still reaches for the
network, and with no network the lyrics pane stays empty.**

The write side that makes it possible: `src/lib/services/download-track.ts:256` passes
`lyrics: r.lrc || undefined` into `tagAudioBlob` (the `quick-260915-062` seam), so every
download made since that change embeds its LRC into the file's own tags.

The read side, in `src/lib/stores/player.svelte.ts`:

1. **Offline-first branch.** When `library.isDownloaded(uid)` and `blobStore.get(uid)`
   returns a blob (`player.svelte.ts:594-613` in `restore`, mirrored at
   `player.svelte.ts:3357` in `play`), the network resolve `ensureTrackDetails` is
   **SKIPPED entirely** and `enrichFromLocalFile(localTrack, offlineBlob, playGen)` runs
   instead.
2. **The file's own tags are read.** `enrichFromLocalFile` (`player.svelte.ts:783`) calls
   `localEnrichment(uid, blob)` (`src/lib/services/local-tags.ts:80`) → `readAudioTags` →
   `tags.lyrics`. Gated by `parseLRC(tags.lyrics).length > 0` at `local-tags.ts:105`
   (`37-D-07`: "has lyrics" must mean "renders lyrics" — an unstamped plain-text lyric
   parses to `[]` and is treated as absent rather than painting an empty pane).
   `player.svelte.ts:791` then adopts it: `if (found.lrc && !cur.lrc) this.current = { ...cur, lrc: found.lrc }`.
3. **The gap.** `player.svelte.ts:818` — `if (!found.lrc && !cur.lrc) this.backfillLyrics(q)`.
   This network walk fires **only** when the file carried no usable embedded LRC. Two
   populations hit it: songs downloaded **before** the `quick-260915-062` seam landed, and
   songs whose upstream had no synced LRC at download time. For those, truly offline
   playback plays the audio fine but shows no lyrics — there is no on-device retry or
   backfill-on-reconnect for the embedded frame today.

Note also that `localEnrichment` decodes **at most once per uid per session** (memoised,
`MEMO_MAX = 6`, `local-tags.ts:66-78`), so this is not a per-play cost.

---

## Scope notes

### A4 — the shuffle button was already gone (re-confirmed)

**The user's premise is stale, and it is still stale as of this task.** The request was to
"replace the shuffle button with a download button" in the now-playing view. There is **no
shuffle button in `NowPlaying.svelte`**. Re-confirmed before editing:

```
$ grep -n -i "shuffle" src/lib/components/NowPlaying.svelte
73: // shuffle/repeat moved to the store (gte) so the audio `ended` handler + next() can read
74: // them. The transport buttons below bind to player.shuffle / player.repeatMode directly.
77: // Shuffle in the transport row; Shuffle moved into the TrackMenu kebab menu).
```

Comment lines only — no markup, no icon import, no handler. It was removed by an earlier
task (`ii6`), which moved Shuffle into the TrackMenu kebab menu and put Like in its place.

So the removal half of the request was **already done**, and the constraints it carried
(shuffle logic stays in `player.svelte.ts`, shuffle stays reachable from the kebab) were
already satisfied. **This task therefore ADDED the download control and removed nothing.**
No substitute removal was invented — Repeat, Heart and the three transport buttons are all
untouched. Before: Heart · SkipBack · Play/Pause · SkipForward · Repeat (five controls).
After: the same five plus Download trailing (six).

### A3 — every writer of the album tag, and what each now does

Three candidates were checked; **exactly two are writers**, and both now route through the
same guard.

| Writer | File:line | What it did | What it does now |
|---|---|---|---|
| Single-song download seam (36-D-05 — all four download callers funnel through it: TrackMenu, DownloadControl, the album bulk loop, background repair) | `src/lib/services/download-track.ts:253` | `album: r.album \|\| undefined` — wrote the raw catalog string verbatim | `album: albumTag(r.album, r.title, dnTitle)` — writes **no album frame at all** when the album normalises equal to either the raw title or the display title |
| Background retag path | `src/lib/services/retag.ts:89` | `album: entry.album \|\| undefined` | `album: albumTag(entry.album, entry.title)` — same guard. `RetagEntry` (`retag.ts:37`) carries a single, already-display-translated title, so that is the only title available to compare |
| Android MediaStore bridge | `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt:337/384/401` | **NOT a writer** — it only READS `MediaStore.Audio.Media.ALBUM`. Ruled out, unchanged. | unchanged |

`writeAudioTags` (`audio-tags.ts:205`, `if (fields.album) tag.setAlbum(...)`) already
honoured `36-D-10` and skips the setter for an `undefined` album — that behaviour is
unchanged and is now re-pinned by a test.

**Root cause, for the record:** this was never a writer bug. CN and streaming catalogs set
a single's `album` equal to its own track name, `Track.album` is copied through verbatim by
the resolvers (`kuwo.ts:154`, `album: d.album || track.album`), and we faithfully wrote it.
Evidence files: `The Weeknd - The Hills (Explicit).flac` (ALBUM = `The Hills (Explicit)`)
and `Polar G - 過一招 (feat. 拉天糖).m4a` (ALBUM = `过一招 (feat. 拉天糖)`). The
Simplified-album / Traditional-filename split in the second one is why `albumTag` is
variadic: the filename/tag uses the display title while the album rides the raw catalog
string, so a single-title compare would have missed it.

**Already-downloaded files keep their bad album tag.** No migration sweep is in scope. The
existing background retag path now corrects them the next time it runs over a file
(Settings → Downloads → "Retag downloaded songs"), because `retag.ts` calls the same guard.

---

## Tasks Completed

| # | Task | Commit | Verification actually run |
|---|---|---|---|
| 1 | Q1 / Q2 read-only investigation | (no code) | `git diff --quiet -- src/` → clean; findings above carry file:line citations |
| 2 | A1 — cover chain reordered to YTM → iTunes → Deezer → CN | `a48dbdd` | `pnpm vitest --run src/lib/services/cover-backfill.test.ts` → **44 passed**; `player.svelte.test.ts` → **278 passed** |
| 3 | A2 — `shareOrigin()` public-origin fallback | `767aed2` | `pnpm vitest --run src/lib/services/share.test.ts` → **94 passed** |
| 4 | A3 — `albumTag()` drops a title-echoing album | `5fe9711` | `pnpm vitest --run audio-tags/retag/download-track` → **123 passed** (then 47 in download-track after adding two more) |
| 5 | A4 — `DownloadControl` in the transport row | `cb4acbc` | `pnpm check` → 0 errors; `pnpm vitest --run src/lib/i18n/i18n.test.ts` → **29 passed** |

## Verification (observed output, not restated intent)

```
pnpm check   → COMPLETED 4533 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
pnpm test    → Test Files 129 passed (129) | Tests 2541 passed (2541)

grep -rn "resolveDeezerHQ" src/          → 1 hit, and it is the rename decision-record
                                            comment in cover-backfill.ts:262 (intended)
grep -c "ytmusic" src/lib/services/cover-backfill.ts   → 11
grep -c "location.origin" src/lib/services/share.ts    → 2 (one real read inside
                                            shareOrigin, one inside its doc comment)
grep -rn "albumTag(" src/lib/services/   → 1 definition + exactly 2 call sites
grep -n -i "shuffle" NowPlaying.svelte   → comment lines only, no markup
grep -n "DownloadControl" NowPlaying.svelte → import + one mount + style comment
```

**Not verified — device/visual only.** The A4 `<human-check>` (open the now-playing view,
tap the download icon, confirm it settles into the greyed Check state, reopen on an
already-downloaded song and confirm Check shows immediately) was **not performed**. It
needs a running app with a playable track; the known Browser-pane rAF freeze makes the
expandable now-playing overlay unreliable to drive there, and CN upstreams are blocked in
this sandbox. What IS confirmed is construction-level: the component mounts, typechecks,
and is bound to `player.current`, whose downloaded state `DownloadControl` already derives
from `library.isDownloaded(uid)` — the same derivation five shipped list-row call sites use.

## What Changed

**A1 — cover ranking.** `resolveTrackChain` (`cover-backfill.ts:181`) is the single source
of truth for the track chain; every consumer (`resolveCoverForTrack`,
`backfillCovers.resolveOne`, `lazyCover`, the player's `resolveCoverAsync` and `healCover`)
routes through it, so one edit moved all of them. The new tier 1 is
`searchAll(term, 1, onlySource('ytmusic'), signal)` — the same shape as the existing CN
tier, just pinned to one source — so there is no new module, no new endpoint and no new
fetch path, and it inherits the `apiFetch` governor for free (T-0mw-01 mitigation as
planned; no new throttle added). `resolveDeezerHQ` became `resolveHqCover`, a two-tier
YTM → Deezer ladder; the T-26-02-01 bound holds (still bounded to the now-playing track,
still never a per-tile fan-out, still zero iTunes and zero CN). `collectCoverCandidates`
was reordered to own → ytmusic → itunes → deezer → CN, still parallel, still capped at 12.
The stale `MULTI-TIER CHAINS` header block was rewritten with the new order and rate-limit
reasoning; every prior decision ref was kept.

**A2 — share links.** All four builders inlined
`typeof location !== 'undefined' ? location.origin : ''`. The reported bug came through
`songShareUrl`, but patching only that would have left the album and artist card links
still emitting `https://localhost` from the APK — so it was fixed once in `shareOrigin()`
(`share.ts:35`), which all four now call. A real web origin passes through **unchanged**
(the deployed website is byte-identical); only localhost / `127.0.0.1` / `[::1]` /
`capacitor:` / `file:` / opaque `'null'` are rewritten, matched on hostname + protocol via
`new URL` inside a try/catch — never a substring, so `localhost.example.com` is untouched.
The public origin comes from a new one-line `apiOrigin()` in `api-base.ts` (the native
build's `VITE_API_BASE`) rather than a second hardcoded copy of the domain, with the
literal only as the web-build fallback. `isHttpsUrl` was left alone per CLAUDE.md.

**A3 — album tags.** Covered in Scope notes above.

**A4 — now-playing download.** Covered in Scope notes above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `albumTag` was called before it was imported in `download-track.ts`**
- **Found during:** Task 4
- **Issue:** The plan's interface block quoted `retag.ts`'s relative import shape; `download-track.ts`
  actually imports from the `$lib/services/audio-tags` alias, so the first import edit did not match
  and `albumTag` was an unresolved reference at runtime. 28 `download-track.test.ts` tests went red
  with `res === 'failed'` (the service's never-throw contract swallowed the ReferenceError into its
  sentinel, which is exactly why the tests — not the typechecker — caught it).
- **Fix:** imported `albumTag` from the alias path in `download-track.ts:42`.
- **Files modified:** `src/lib/services/download-track.ts`
- **Commit:** `5fe9711`

**2. [Rule 3 - Blocking] Two test files mocked `./audio-tags` with a factory that omitted `albumTag`**
- **Found during:** Task 4
- **Issue:** `retag.test.ts:27` and `download-track.test.ts:62` replaced the whole module with a
  two-key object. Adding a new export to a module under test therefore broke every test in both files.
- **Fix:** both factories now spread the real module via `vi.mock(path, async (orig) => ({ ...(await orig()), … }))`,
  so only the codec entry points are stubbed and pure helpers stay real.
- **Files modified:** `src/lib/services/retag.test.ts`, `src/lib/services/download-track.test.ts`
- **Commit:** `5fe9711`

**3. [Rule 3 - Blocking] `audio-tags.test.ts` pins the module's exact export surface**
- **Found during:** Task 4
- **Issue:** `audio-tags.test.ts:89` asserts `Object.keys(mod).sort()` equals a literal five-name list
  (a deliberate 36-D-03 purity guard). Adding `albumTag` failed it.
- **Fix:** added `albumTag` to the expected list with a one-line note on what it is. The guard keeps
  doing its job; it just knows about the sixth export now.
- **Files modified:** `src/lib/services/audio-tags.test.ts`
- **Commit:** `5fe9711`

**4. [Rule 3 - Blocking] The YTM tier made a large block of existing cover tests unsound**
- **Found during:** Task 2
- **Issue:** The new tier 1 and the existing CN tier are the SAME `searchAll` function, differing only
  by the `prefs` argument. Existing tests used `vi.spyOn(catalog, 'searchAll').mockResolvedValue(...)`,
  which answers for both — so the CN tier became unobservable — and several tests did not spy
  `searchAll` at all, which after the reorder would have issued a REAL network call from the suite.
- **Fix:** added a prefs-aware `mockSearch({ ytm, cn })` helper plus `ytmCalls()` / `cnCalls()`
  accounting, defaulted `searchAll` to a miss in `beforeEach` so no unmocked test can reach the
  network, and rewrote the chain-order assertions for the new ranking.
- **Files modified:** `src/lib/services/cover-backfill.test.ts`
- **Commit:** `a48dbdd`

### Assumption Drift (advisory)

**1. The plan's "exactly one `location.origin` left" check**
- **Planned:** `grep -c 'location.origin' src/lib/services/share.ts` returns 1.
- **Actual:** returns 2.
- **Why:** one is the single real read inside `shareOrigin()`; the second is the word appearing inside
  that function's own doc comment, which explains *why* the Capacitor WebView's `location.origin` is
  unusable. The substantive property the check was after — one origin authority — holds. Advisory
  only; no behaviour differs.

**2. `resolveHqCover`'s worst-case cost**
- **Planned:** the HQ upgrade is "≤1 Deezer call" (the T-26-02-01 fan-out proof's wording).
- **Actual:** worst case is now 2 calls (YTM, then Deezer on a miss); common case stays 1.
- **Why:** this IS the plan's own instruction and is documented in the code comment, but the
  pre-existing fan-out-proof test asserted the ≤1 number literally, so that assertion was restated as
  "≤2 total upgrade calls, 0 iTunes, 0 CN". The bound that actually matters — never a per-tile
  fan-out, never the 7-source CN walk — is unchanged and still pinned.

### Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None. The three trust boundaries the plan identified were handled as planned:
`T-0mw-01` (YTM tier routed through `searchAll` → `apiFetch`, no new throttle),
`T-0mw-02` (the share fallback origin is a build-time constant or a literal, never derived
from user input, a query param or a path segment — any real web origin passes through, so
the rewrite can only ever narrow to one known-good host), and `T-0mw-05` (client rendering
keeps the existing `hasHttpsScheme` `<img src>` gate; `proxy/safe-image-url.ts` and the
`/api/og` server-side host allowlist are untouched, so a YTM cover simply does not tokenize
into the `ci` carrier and the card falls through to today's server chain).

## Out of Scope — Not Started

Backlog phases `999.2` / `999.3` / `999.4` were not touched. `ROADMAP.md` was left alone.
Nothing was pushed to `origin`; all four commits are local.

## Self-Check: PASSED

- `src/lib/services/cover-backfill.ts` — FOUND
- `src/lib/services/share.ts` — FOUND
- `src/lib/services/api-base.ts` — FOUND
- `src/lib/services/audio-tags.ts` — FOUND
- `src/lib/services/download-track.ts` — FOUND
- `src/lib/services/retag.ts` — FOUND
- `src/lib/components/NowPlaying.svelte` — FOUND
- commit `a48dbdd` — FOUND
- commit `767aed2` — FOUND
- commit `5fe9711` — FOUND
- commit `cb4acbc` — FOUND
