---
phase: 36-tag-downloaded-songs-with-full-metadata
plan: 03
subsystem: services
tags: [download-seam, audio-tags, artwork-embed, album-order, service-worker, precache]

# Dependency graph
requires: [36-01, 36-02]
provides:
  - "The ONE tag seam: downloadTrack tags every download between readBlobWithProgress and blobStore.put / saveBlobToDisk"
  - "downloadTrack opts widened with trackNumber/albumArtist (album page only)"
  - "Embedded cover on downloads via the existing resolveArtworkDataUrl chain"
  - "logAction('download.tag') — tag outcome visible in Settings → Activity log"
  - "Service-worker ASSETS excludes .wasm, so the 686 kB taglib blob is no longer precached"
affects: [36-04, 36-05, 34]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A runtime filter over SvelteKit's inlined `build` asset list to keep a heavy lazy asset out of install-time precache"
    - "Executing the BUILT service worker in a node vm with stubbed caches/self to prove a precache claim a static grep cannot"

key-files:
  created: []
  modified:
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
    - src/routes/(app)/album/[name]/+page.svelte
    - src/service-worker.ts

key-decisions:
  - "A4 MEASURED, and the answer was the costly one: SvelteKit's `build` array DOES list the emitted taglib wasm, so before this plan every PWA user precached 686 kB (230 kB gzip) on install and again on every deploy (the cache name rotates per version) for a codec only downloaders touch. The filter is load-bearing, not defensive."
  - "The plan's `! grep -q '\\.wasm' service-worker.js` acceptance criterion is unsatisfiable by construction and was replaced with a functional proof. SvelteKit inlines the asset list as a string literal and our `.filter()` runs at SW startup, so the path necessarily survives in the file text while ASSETS excludes it. Verified instead by running the built SW in a node vm and capturing what `cache.addAll` actually receives: 133 entries, 0 `.wasm`."
  - "No try/catch around tagAudioBlob. It never rejects and returns the caller's own blob on any failure, so D-17 NEVER-THROWS and 36-D-06 TAG-OR-INTACT hold by construction rather than by a swallow — and a swallow would have hidden the outcome the Activity log now records."
  - "The artwork resolve is awaited sequentially before the tag, not raced with the body read. One bounded request (6 s / 1 MB) per download, and the album loop's existing 250 ms stagger already serializes it — T-36-11 (the api-fetch-flood history) argues against adding parallelism on the download path."

patterns-established:
  - "Comment-stripping in source-guard tests now uses the three-shape filter (`//`, `/*`, ` *`) via a shared `stripComments` helper — the `//`-only idiom let JSDoc through, which is exactly where a forbidden identifier gets NAMED in order to forbid it."
  - "A cross-file source guard (download-track.test.ts reading the album +page.svelte body) pins a contract that spans a service and its only privileged caller, without a component test runner."

requirements-completed: [D-05, D-06, D-10, D-11, D-12, D-13, D-14, D-16]

# Metrics
duration: 6min
completed: 2026-09-13
---

# Phase 36 Plan 03: Wire the Codec into the Download Seam Summary

**Every download — TrackMenu, DownloadControl, album bulk, background repair — now lands on disk carrying title/artist/album/album-artist and the cover the app displays, because all four route through one `tagAudioBlob` call in `downloadTrack`; the album page is the only caller that supplies a real track number, and the 686 kB wasm stopped shipping to every PWA user.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-09-14T01:29:19Z
- **Completed:** 2026-09-14T01:35:03Z
- **Tasks:** 3
- **Files modified:** 4 (0 created)

## Accomplishments

- **One insertion, four callers (36-D-05).** The seam audit held: the tag step sits between `readBlobWithProgress` and both save paths, so the web `<a download>`, the native offline blob, and the native public `Music/OpenMusic/` copy all receive the same tagged bytes with no per-caller change.
- **36-D-06 proved by test, not by intent.** Unknown container, over the size ceiling, and codec error each return `'saved'` with the *same blob object identity* that the tagger was handed — asserted, so a future refactor that starts writing `tagged.blob` conditionally fails loudly.
- **Display-name parity (Pattern 5).** `dnArtist`/`dnTitle` are computed once and feed both `buildDownloadFilename` and the tag fields, so a file can never be named 標題 while its tag says 标题. Pinned by a test that stubs the translator and asserts both the filename and the fields.
- **`extFromAudioUrl` is now explicitly labelled FILENAME-ONLY** at the call site — its `'mp3'` default would route a FLAC into ID3 if anyone reached for it as a container key. The codec sniffs bytes.
- **Real album order, from the only place it exists.** The album page loops `resolved.entries()` and passes `String(i + 1)`; `displayIndex` is banned by a source guard at *both* sites (the service and the page), because it is interleaved multi-source search ordering, not a position on a record.
- **The wasm is off the install path.** Measured before deciding (below), then excluded and re-verified by executing the built SW.

## Verification Evidence (observed, not assumed)

| Command | Exit | Observed output |
|---|---|---|
| Task 1 grep block (`tagAudioBlob(`, `resolveArtworkDataUrl(`, `logAction('download.tag'`, widened opts, `36-D-06 TAG-OR-INTACT`, no `displayIndex` in stripped source) | 0 | `TASK1 GREPS OK` |
| `pnpm vitest --run download-track.test.ts` **after Task 1** | 1 | `Tests 1 failed \| 27 passed (28)` — the single red was the album-page guard, red **by design** until Task 2 |
| `pnpm vitest --run download-track.test.ts` **after Task 2** | 0 | `Test Files 1 passed (1)` · `Tests 28 passed (28)` · 239 ms |
| Task 2 greps + `downloadTrack(` call count in the album page | 0 | `GREPS OK`, count `1` (unchanged) |
| `pnpm build` (pre-change measurement) | 0 | built in 6.26 s; `adapter-cloudflare` done |
| `find .svelte-kit/cloudflare -name 'taglib-web*.wasm' \| wc -l` | 0 | `1` |
| **A4 measurement** — `grep -o '[^"]*\.wasm' .svelte-kit/cloudflare/service-worker.js` (pre-change) | 0 | wasm path present **inside the precache array literal** → SvelteKit's `build` DOES include it |
| `grep -l taglib .svelte-kit/cloudflare/_app/immutable/entry/*.js` | 1 (no match) | `0` files — still nothing in the entry chunk |
| `pnpm build` (post-change) | 0 | exit 0 |
| Built-SW execution proof (node `vm`, stubbed `caches`/`self`, capture `cache.addAll`) | 0 | `precache entries: 133` · `wasm entries in precache: 0 []` · `PASS` |
| `git diff --quiet src/lib/services/sw-cache.ts` | 0 | unmodified, as required |
| `pnpm test` (full) | 0 | `Test Files 119 passed (119)` · `Tests 2204 passed (2204)` · 8.98 s |
| `pnpm check` | 0 | `COMPLETED 4511 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |

Test count moved 2184 → 2204 (+20 across the three new describes and the two extended guards).

### Measured asset sizes (the numbers the wasm decision rests on)

| Asset | Raw | Gzip |
|---|---|---|
| `_app/immutable/assets/taglib-web.bIFBWRq2.wasm` | 686,505 B (686.5 kB) | 229,650 B (229.7 kB) |
| taglib JS wrapper chunk `BpZPg0BT.js` | 58,482 B | 17,764 B |
| second taglib chunk `Z0lho2A6.js` | 26,651 B | 9,652 B |

Matches RESEARCH's 686.5 kB / 232 kB gzip estimate for the wasm; the JS wrapper split across two chunks totalling 85 kB raw / 27 kB gzip against RESEARCH's 75 kB / 25 kB.

## Task Commits

1. **Task 1: Tag step at the seam + contract tests** — `3817991` (feat)
2. **Task 2: Album position + album artist threading** — `f4d9691` (feat)
3. **Task 3: Wasm out of the service-worker precache** — `48ae0cc` (perf)

## Files Modified

- `src/lib/services/download-track.ts` — fourth CONTRACTS entry (`36-D-06 TAG-OR-INTACT`); widened `opts`; hoisted display names; `resolveArtworkDataUrl` + `tagAudioBlob` + `logAction('download.tag')` between the body read and the save paths. Everything after (`blobStore.put`, the `save === false` early return, `saveBlobToDisk`, the outer try/catch/finally) is unchanged apart from receiving the possibly-tagged blob.
- `src/lib/services/download-track.test.ts` — three mocks (`tagAudioBlob`, `resolveArtworkDataUrl`, `logAction`) + their `vi.mock` factories and `beforeEach` resets; three new describes (D-06, D-11/D-12, D-13/D-14); the import-contract describe gained the `displayIndex` ban and the cross-file album-page guard; a shared `stripComments` helper.
- `src/routes/(app)/album/[name]/+page.svelte` — `resolved.entries()` loop, `trackNumber: String(i + 1)`, `albumArtist: albumArtist || undefined`, the 36-D-11/D-12 rationale comment, and one extra sentence on the LIMITATION block. `persist: false`, the `saved` counter, the 250 ms stagger, the toasts and the `finally` are byte-for-byte as they were; `albumArtist`'s `$derived` at :58 untouched.
- `src/service-worker.ts` — `ASSETS` gains `.filter((p) => !p.endsWith('.wasm'))` with the 36-D-01 / Pitfall 9 rationale. `sw-cache.ts` deliberately untouched: this is an asset-list change, not a bypass change.

## Decisions Made

See `key-decisions` in the frontmatter. The two worth reading in full:

> **A4 is answered and it was the expensive branch.** RESEARCH marked "does SvelteKit's `build` array include the emitted wasm?" as `[ASSUMED]`. It does. The pre-change build's `service-worker.js` carried `/_app/immutable/assets/taglib-web.bIFBWRq2.wasm` inside the array that `cache.addAll` consumes, meaning every PWA install — and every install again after each deploy, since `CACHE` is version-keyed — pulled 230 kB gzip of a codec that only fires when someone presses Download. The filter is not a defensive no-op; it removed a real, recurring, all-users cost.

> **The plan's static grep for `.wasm` in the built SW cannot pass and should not.** SvelteKit inlines the asset list as a literal, and a `.filter()` is evaluated at SW startup, so the string is still in the file no matter what ASSETS ends up containing. The only ways to satisfy the literal criterion would be a build plugin rewriting the manifest or a regex over the emitted bundle — both more machinery than the thing they'd prove. Replaced with a direct functional check: run the built worker in a node `vm` with stubbed `caches`/`self`/`location`, fire its `install` listener, and read what `cache.addAll` was actually given. 133 entries, zero `.wasm`. That is the claim the criterion was reaching for.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Hoisted `tagAudioBlob` mock's inferred return type was too narrow for per-test stubs**
- **Found during:** Task 1 (`pnpm check`)
- **Issue:** `vi.fn(async (blob) => ({ blob, result: 'tagged' as const, format: 'm4a' as const }))` infers a single-outcome return type, so `mockImplementation` with a `'skipped-size'` / `'unknown-container'` / `'error'` outcome was a hard type error.
- **Fix:** declared a module-level `type TagOutcomeLike = { blob: Blob; result: string; format?: string }` and annotated both the hoisted mock and the `runWith` helper's `outcome` parameter with it. No cast, no `as any`. Kept deliberately loose because the real `TagOutcome` is narrow-by-discriminant and would force a cast per stubbed outcome — the opposite of what the tests are checking.
- **Files modified:** `src/lib/services/download-track.test.ts`
- **Commit:** `3817991`

### Acceptance criterion replaced (Task 3)

The plan's `! grep -q '\.wasm' .svelte-kit/cloudflare/service-worker.js` is unsatisfiable with a runtime filter, for the structural reason set out under Decisions. Substituted a strictly stronger functional proof (execute the built worker, capture `cache.addAll`). Every other Task 3 criterion passed as written: one `taglib-web-*.wasm` emitted, no `taglib` in any entry chunk, `sw-cache.ts` unmodified, `pnpm build` / `pnpm test` / `pnpm check` all exit 0.

## Assumption Drift (advisory)

**1. The plan expected `36-02`'s `writeAudioTags` typing to be the friction point; the friction landed in the test mocks instead**
- **Found during:** Task 1
- **Planned:** the briefing flagged `Uint8Array<ArrayBuffer>` as the 36-02 deviation call sites might trip over.
- **Actual:** `downloadTrack` never touches `writeAudioTags` — it calls `tagAudioBlob`, which returns a `Blob`, so that deviation was invisible here exactly as the briefing predicted. The only typing work was in the test's own mock bag.
- **Why it matters:** 36-04's retag path, which *does* go near the byte-level API, is where that deviation will actually be felt.

**2. The artwork resolve adds an unconditional network round-trip to every download, including offline-blob repairs**
- **Found during:** Task 1
- **Planned:** D-13/D-14 frame the cover fetch as "bounded, accepted".
- **Actual:** it is also *unconditional* — the silent background repair path (`save: false`, 31-D-12) now makes an artwork request the user did not ask for. It is bounded (6 s / 1 MB, never throws, returns null on failure) and a repair already re-fetches the whole audio body, so the marginal cost is small and nothing was gated on it.
- **Why it matters:** if the repair path ever becomes bulk or automatic at scale, that is the first request to make conditional.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, no new host surface, no new fetch path — `resolveArtworkDataUrl` is reused unchanged (its own https-only direct tier and host-allowlisted `/api/og` tier), and the tagger is the 36-02 module with its existing size ceiling and never-throw contract.

## Issues Encountered

No `.git/index.lock` contention despite two concurrent phases. Every `git add` named explicit paths; Phase 35's untracked `src/lib/services/backup-io.ts` appeared in `git status` mid-run and was left alone.

## Backlog Note (NOT fixed here — success-criteria item)

**Album downloads still write no native public-folder copy.** `downloadAlbum` passes `persist: false`, which skips `blobStore.put` — and the native `Music/OpenMusic/` write hangs off that same call. So the album path now computes correct track numbers and album artists that the device music player will never read, because no public file is created for it to scan. This is pre-existing Phase 29 behaviour (RESEARCH Open Q2 / 29-CONTEXT), not a regression from this plan, and flipping `persist` for the album loop is a real behaviour change (offline blobs for a whole album, storage implications) that belongs in its own decision. Comment added at the call site; flagged here for the roadmap backlog.

Carry-forward for 36-05's device pass: per 36-02's note, an omitted album does NOT surface as "Unknown album" on Android — MediaStore substitutes the parent folder name, so album-less downloads will group under a pseudo-album called "OpenMusic".

## User Setup Required

None.

## Next Phase Readiness

- **36-04 (retag) is unblocked.** The seam it mirrors is now real: read the pattern from `download-track.ts` — resolve artwork, call `tagAudioBlob`, write `out.blob` unconditionally, log `out.result`. 36-04 owns `src/lib/services/retag.ts`, the settings route and the i18n dictionaries; none of them were touched here.
- **36-05 (device verification)** should confirm on-device that the tags written by this seam are what the Android MediaStore scanner reads, and that the wasm's first-use runtime fetch actually caches in the WebView. `pnpm apk` was deliberately not run here.
- **Phase 34** consumes the same `downloadTrack` seam for device imports; nothing in its owned files (`blob-store.ts`, `media-store.ts`) changed.

---
*Phase: 36-tag-downloaded-songs-with-full-metadata*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 4 modified files and the SUMMARY exist on disk; all three task commits (`3817991`, `f4d9691`, `48ae0cc`) exist in git.
