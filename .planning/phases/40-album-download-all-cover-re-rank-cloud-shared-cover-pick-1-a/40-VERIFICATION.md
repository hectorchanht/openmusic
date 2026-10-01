---
phase: 40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a
verified: 2026-09-30T21:50:00Z
status: human_needed
score: 3/3 roadmap goals verified (code level); 6 device/prod items pending human
has_blocking_gaps: false
overrides_applied: 0
re_verification: false
human_verification:
  - test: "Offline playback of a downloaded album song"
    expected: "Airplane mode, library Downloads, tap an album-downloaded song: it plays from the blob."
    why_human: "Needs a real device/APK and network toggle."
  - test: "YTM-fallback album download on the Android emulator/device"
    expected: "A ytmusic album song downloads via a donor source and lands in Music/OpenMusic/<Artist>/<Album>/ with correct tags."
    why_human: "Native MediaStore plus a live upstream donor lookup."
  - test: "Crowd cover loads inside the APK against production"
    expected: "GET https://openmusic.lol/api/cover-pick returns CORS-valid JSON to the WebView and a published pick is adopted."
    why_human: "Needs a deploy. The route is not on prod yet."
  - test: "Cover updated toast and OS lock-screen artwork after a crowd adopt"
    expected: "After a crowd pick is adopted mid-play, the hero, Nowbar and lock-screen card show the new art."
    why_human: "Media Session and lock screen are device-only."
  - test: "Kotlin legacy (API <=28) file move (WR-05)"
    expected: "On an API 24-28 device, a held single moves into the album folder. A missing source or an existing target is rejected as 'saved, not moved'."
    why_human: "performMove has no unit test and needs an API <=28 device. It compiles; pnpm apk built."
  - test: "Real 2-voter flow after the quorum change (WR-01)"
    expected: "One voter publishes nothing. A second distinct IP voting the same URL makes GET return it. A second URL ties to the most recent."
    why_human: "Needs distinct client IPs (wrangler pages dev with spoofed cf-connecting-ip) or prod."
---

# Phase 40: Album download-all + cover re-rank + cloud-shared cover pick: Verification Report

**Phase Goal:** (1) the album page download button works and downloads every song of the album into an OpenMusic/<Artist>/<Album> folder on Android and one album-named .zip on web; (2) cover chain re-ranked (iTunes, QQ, Deezer, other CN, YTM; picker own/QQ/iTunes/Deezer/CN/YTM), YTM covers demoted and kept on their own uid, a track's own inline cover kept, HQ upgrade removed; (3) a cover picked in "Change cover" is voted to the cloud (R2 DIAG `cover-pick/`) and auto-applied for all users with precedence local pin > crowd > inline > chain.
**Verified:** 2026-09-30
**Status:** human_needed
**Re-verification:** No, initial verification
**Scope note:** No REQUIREMENTS.md exists. Coverage is by CONTEXT.md decisions D-01..D-19 plus amendments and the 40-REVIEW-FIX changes, all treated as intended.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The album Download button is live and drives an album orchestrator (D-07) | VERIFIED | `album/[name]/+page.svelte:685` renders the button, uncommented, `disabled={busyAction==='download'}`, `onclick={downloadAlbum}`. The handler (L457-478) calls `downloadAlbumTracks(resolved, {artist: dnArtist, album: dnTitle}, progress)`. It then toasts `albumSaved`, and `finally` resets `busyAction`. |
| 2 | Android: every song persists (`persist:true`) and lands in `Music/OpenMusic/<Artist>/<Album>/` (D-01/D-04) | VERIFIED (code) | `download-album.ts` calls `downloadTrack` with `persist:true, save:false, ...(native&&dir?{dir}:{})`. `download-track.ts` L313 passes `blobStore.put(..., {dir})`. `blob-store.ts` nativePut sends `subPath` to `saveToMusic`, with a sticky dir index so dir-less re-puts stay in the folder. `media-store.ts` and `MediaStoreSaverPlugin.kt` take `subPath` and re-validate it with `safeSubPath`. Both API 29+ `RELATIVE_PATH` and the legacy File path build the sub-dir (L86, L264). Device landing is in human items. |
| 3 | Single downloads stay flat (D-02) | VERIFIED | `dir` is passed only by the album path. `subPath` is added to the plugin call only when a dir exists. |
| 4 | An already-downloaded single is MOVED, not copied or skipped (D-05) | VERIFIED (code) | `download-album.ts` matches held by uid or `sameSongKey`. Native calls `blobStore.moveToDir` (blob-store L948) backed by Kotlin `moveInMusic`/`performMove`. Web reuses the held blob as a zip entry. The WR-05 guard is in place. |
| 5 | Web: one store-only zip named after the album (D-03) | VERIFIED | `buildZip` followed by `saveBlobToDisk(zip, '<folder>.zip')`. Spot-check: I built a zip with CJK entry names via `buildZip` and ran macOS `unzip -t`. It reported OK and extracted `01 光年之外.mp3` and `b.mp3`. The 40-03 UTF-8 and made-by fix holds. |
| 6 | Progress toast, `Saved X of Y`, failures skipped (D-06) | VERIFIED | `toast.albumProgress` and `toast.albumSaved` exist in all 16 locales (2 hits each). The per-song try/catch continues on failure. `download-album.test.ts` exists. |
| 7 | YTM album songs borrow audio from another source (40-03) | VERIFIED (code) | `download-album.ts` loops donors (`fetchVariants`, `versionsIncludingOwn`, `probeDownload`, `attempt(audioFrom)`) and tries the YTM file last. |
| 8 | Chain order is iTunes, QQ, Deezer, other CN (qq and ytmusic off), YTM (D-08) | VERIFIED | `resolveTrackChain` in `cover-backfill.ts` L298-352 matches exactly. Each tier is gated on the previous miss. |
| 9 | QQ tier is a real, health-gated tier (WR-06) | VERIFIED | `qqSongCover` uses `onlySource('qq')`, then a detail resolve on a COPY of the row, with a gate (`createHealthGate`) and a 4s deadline (`combinedSignal`). `__resetQqCoverGate` is exported for tests. |
| 10 | Picker order own, QQ, iTunes, Deezer, other CN, YTM, each source once (D-10) | VERIFIED | `collectCoverCandidates` concatenates `track.cover`, qq, itunes, deezer, cn (`{qq:false,ytmusic:false}`), ytm, then dedupes by url. |
| 11 | HQ upgrade removed (D-11a) | VERIFIED | `upgradeCoverAsync` and `resolveHqCover` have zero code references in `src/`. `postPlayCover` has a single `resolveCoverAsync` branch, and only comments mention the upgrade. |
| 12 | YTM covers stay on their uid, never the name layer (D-11b, WR-03) | VERIFIED | `isYtmCoverUrl` gates `setCachedCover` in `cover-backfill` (L383, L502), `cover-version.svelte.ts` L219 and `library.svelte.ts` L156. WR-03 added `uid` to `CoverNeed`. |
| 13 | A track's own inline cover is kept, including YTM thumbnails (D-09) | VERIFIED | The `resolvedCover` seed reads `track.cover` before the caches, and `postPlayCover` only runs the chain when the cover is not renderable. No automatic replacement path remains. |
| 14 | Share carrier grammar is not broken (D-12) | VERIFIED | `resolveShareCover` is untouched and the share tests pass in the full suite (3846 tests green). |
| 15 | `/api/cover-pick` GET+POST on the DIAG R2 `cover-pick/` prefix, verb-only exports (D-13/D-17/D-18/D-18a/D-19) | VERIFIED | `+server.ts` exports only `GET` and `POST`. The live dev server returned `{"ok":true,"u":null,"n":null}` for a valid key, so the route loads. It fails closed with 503, checks origin (403), content-type (415), size (413) and the vote shape (400), and runs the per-IP throttle (429) before the writes. Votes use R2 conditional puts. The GET edge cache sits on an off-path `__edge` key and re-applies CORS (40-08). |
| 16 | Consensus: most votes wins, a re-vote replaces, a tie goes to the most recent, 2-voter quorum, IPv6 /64 grouping | VERIFIED | `applyVote` is keyed by voter. `consensus()` tallies, breaks ties by `maxT`, and returns null below `PICK_AGREE_MIN=2`. `voterAddress` collapses IPv6 to /64. |
| 17 | The vote URL allowlist is exact-host, with the netease redirector resolved server-side (CR-01, D-18) | VERIFIED | `COVER_PICK_IMAGE_HOSTS` is its own exact list plus `.mzstatic.com` and `.music.126.net`. The route runs `resolveNeteasePic` after the throttle and re-screens the target. |
| 18 | Only the explicit picker tap votes (D-15) | VERIFIED | `TrackMenu.svelte` `pickCover` calls `pinCover`, then `coverPickKeys(...).then(k => k && submitCoverPick(k, url))`. It is the only caller; `coverPickKeys` returns a null `u` for device uids. |
| 19 | The crowd pick is fetched once per played song, cached, and adopted (D-16) | VERIFIED | `crowdCoverAsync` in `player.svelte.ts` L4070. It skips device and pinned uids, uses a `crowdRequested` set, and writes the cache before the gen check (WR-02). A null result un-marks the uid for retry. Adoption goes through `adoptCover`, which refreshes `resolvedCover` and the OS media card. |
| 20 | Precedence pin > crowd > inline > chain (D-14/D-14a) | VERIFIED | The play seed (L3649) and restore seeds (L653, L790) read pin, then crowd, then attached album cover, then `track.cover`, then caches. `readChosenCover` is pin then crowd and is used by 10 display surfaces (rows, up-next, related, hero, home, downloads). `adoptCover` accepts only the chosen URL. WR-04 returns null for `device:` uids. |
| 21 | Crowd art never leaks into the auto cache layers | VERIFIED | Crowd and pin seeds skip `writeCoverBoth`, and `writeCrowdCover` writes only the crowd family. |

**Score:** 21/21 code-level truths verified. Device and production behaviours are in Human Verification.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/services/zip-store.ts` (+test) | VERIFIED | Real writer, exercised by the unzip spot-check. |
| `src/lib/services/download-filename.ts` (`sanitizePathSegment`, `albumDir`, `albumFolder`) | VERIFIED | Imported by `download-album.ts`. |
| `src/lib/services/download-album.ts` (+test) | VERIFIED | Wired from the album page. |
| `src/lib/services/blob-store.ts` (`dir`, `moveToDir`), `media-store.ts`, `MediaStoreSaverPlugin.kt` | VERIFIED | `subPath` and `moveInMusic` present. `pnpm apk` built per REVIEW-FIX. |
| `src/lib/services/cover-backfill.ts` | VERIFIED | New chain, QQ tier and picker. |
| `src/lib/proxy/cover-pick.ts`, `src/routes/api/cover-pick/+server.ts` (+tests) | VERIFIED | Route reachable in dev. |
| `src/lib/proxy/safe-image-url.ts` (`COVER_PICK_IMAGE_HOSTS`) | VERIFIED | Exact-host list. |
| `src/lib/services/cover-pick-shared.ts` (+test) | VERIFIED | Client keys, fetch and submit. |
| `src/lib/services/cover-cache.ts` and `cover-version.svelte.ts` (crowd family, `readChosenCover`, `writeCrowdCover`) | VERIFIED | Used by the player and 10 surfaces. |
| `TrackMenu.svelte`, `player.svelte.ts` wiring | VERIFIED | `pickCover` votes. `crowdCoverAsync` fetches and adopts. |

### Key Link Verification

| From | To | Status |
|------|----|--------|
| Album page, `downloadAlbumTracks`, `downloadTrack`, `blobStore.put`, `saveToMusic(subPath)`, Kotlin | WIRED |
| Album page, `buildZip`, `saveBlobToDisk` (web) | WIRED |
| `pickCover`, `submitCoverPick`, `POST /api/cover-pick`, R2 `cover-pick/` | WIRED |
| `play()`/`postPlayCover`, `crowdCoverAsync`, `fetchCoverPick`, `writeCrowdCover`, `adoptCover` | WIRED |
| Display surfaces, `readChosenCover`, `getPinnedCover ?? getCrowdCover` | WIRED |

### Data-Flow Trace (Level 4)

The crowd GET reads real R2 objects through `parseRecord` and `consensus` (not static). `writeCrowdCover` feeds the reactive `coverVersion` signal, which `readChosenCover` reads, so the surfaces repaint. The album orchestrator downloads real blobs and the zip carries them (spot-check: sizes, CRC OK).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit suite | `pnpm test` | 171 files, 3846 tests passed | PASS |
| Type check | `pnpm check` | 0 errors, 12 warnings (unused CSS selectors) | PASS |
| Web build | `pnpm build` | adapter-cloudflare done | PASS |
| Native build | `pnpm build:native` | adapter-static done | PASS |
| Route loads (verb-only exports) | `curl localhost:5173/api/cover-pick?u=<32hex>` | `{"ok":true,"u":null,"n":null}` | PASS |
| Zip validity with CJK names | `buildZip`, then macOS `unzip -t` and extract | OK, names extracted intact | PASS |

### Probe Execution

SKIPPED. The phase declares no probe scripts.

### Requirements Coverage

No REQUIREMENTS.md and no plan requirement IDs. Coverage is by decisions D-01..D-19 plus amendments, mapped in the Observable Truths above. Every decision is addressed: D-01 to D-07 (truths 1-7), D-08 to D-12 (truths 8-14), D-13 to D-19 (truths 15-21). There are no orphans.

### Anti-Patterns Found

None blocking. A scan of the 60 `src/` and `android/` files changed in the phase found no `TBD`, `FIXME` or `XXX`. The deliberate `ponytail:` ceilings are documented in code: sequential album download, and the throttle versus quorum limits.

### Notes

- The 2-voter quorum means a lone voter's pick is never published to others. This is intended (WR-01), but a new picker sees no cross-user effect until a second distinct voter agrees. The voter's own pin applies immediately.
- `pnpm check` is green. The 12 warnings are in files outside the phase.
- `pnpm test` passes, but it does not cover the Kotlin `performMove` or live MediaStore behavior.

### Human Verification Required

See the frontmatter `human_verification` list for the six items. In order:

1. Offline playback of a downloaded album song.
2. YTM-fallback album download on the emulator or device.
3. Crowd cover loading in the APK against production, after the deploy.
4. "Cover updated" toast and lock-screen artwork after a crowd adopt.
5. Kotlin legacy (API <=28) move (WR-05).
6. The real 2-voter flow after the quorum change.

### Gaps Summary

No gaps. Every must-have verified against the code, and the full suite, type check, both builds, the live route load and a real-unzip check all pass. Status is `human_needed` only because the device and production behaviours listed above cannot be confirmed programmatically.

---

_Verified: 2026-09-30_
_Verifier: Claude (gsd-verifier)_
