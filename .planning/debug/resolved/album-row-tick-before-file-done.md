---
status: resolved
trigger: "Album download: some song rows show the tick after a quick spin while the file is not fully downloaded yet"
created: 2026-10-01T00:00:00Z
updated: 2026-10-01T11:40:00Z
---

## Symptoms

- **Expected:** a row's download icon keeps spinning (progress ring) until that song's file is really fully downloaded and saved; only then the tick.
- **Actual:** after tapping album Download, several rows spin briefly then show the tick while their file is still downloading (or not downloaded at all).
- **Errors:** none reported.
- **Timeline:** after quick-260930-uia (per-row rings), 260930-vjp (3-resolve/8-transfer pipeline), 260930-x3q / 261001-0p9 (qq rate-limit retry + donor walk).
- **Reproduction:** web dev server http://localhost:5173/album/rice%20%26%20shine?artist=%E9%99%B3%E5%A5%95%E8%BF%85&mbid=03fac712-87f5-4a57-a083-e9c40382964a → tap album Download → watch row icons.

## Orchestrator lead (unverified)

- `src/lib/components/DownloadControl.svelte` header comment: `isDownloaded` is true from `library.addDownload` onward, which runs PRE-fetch by design (DL-BUG-01, `download-track.ts` ~L239); the tick shows whenever `isDownloading` (`library.downloading.has(uid)`) is false.
- So any window where the uid is not in `library.downloading` but `addDownload` already ran → tick early. Candidates: gaps between `endDownload` of one attempt and `beginDownload` of the next (album qq retry backoff 3/6/9/12 s, donor walk in `downloadFromDonor` ~L464-493, `downloadOne` begin L172 / end L407); a failed/'no-audio' attempt whose library entry stays (DL-BUG-01: kept in Library, re-streams) → permanent tick with no file; held-single paths.

## Current Focus

- hypothesis: H1 — the tick is `isDownloaded && !downloading`; `downloadOne` runs `library.addDownload` pre-fetch and its `finally` calls `endDownload` after EVERY attempt, so (a) the album loop's backoff sleeps (3/6/9/12 s) between attempts leave the uid in `downloads` but not in `downloading` → tick with no file; (b) a song whose final outcome is 'no-audio'/'failed'/'rate-limited' stays in `downloads` forever → permanent tick with no file.
- test: CDP E2E (scratchpad/tick-e2e.mjs): hook `IDBObjectStore.prototype.put` for the blob persist time, poll each row's `.dc` class every 200 ms, compare first TICK time vs put time per uid.
- expecting: rows showing TICK before their put (or with no put at all) confirm H1; if every TICK follows its put, H1 is wrong.
- next_action: none — resolved (fix committed, see Resolution). If the user still sees an early tick: re-run scratchpad/tick-e2e.mjs (TAG=x) and look for a row whose first TICK precedes its IDB put, or a row with no put that ends TICK instead of UNAVAIL.

reasoning_checkpoint:
  hypothesis: "Row tick = isDownloaded && !library.downloading.has(uid). downloadOne calls addDownload PRE-fetch and endDownload in its finally on EVERY attempt, so a song is 'downloaded, not downloading' (a) between album attempts — the 3/6/9/12 s qq backoff sleeps and the gap before downloadFromDonor — and (b) permanently after a non-saved final outcome ('rate-limited'/'no-audio'/'failed'), because nothing marks the file-less entry."
  confirming_evidence:
    - "download-track.ts L172/L239/L407: beginDownload → addDownload before fetch → endDownload in finally for every return path incl. 'rate-limited'/'no-audio'."
    - "download-album.ts L196-210: await downloadTrack → setTimeout backoff → downloadTrack again → downloadFromDonor, with no bracket around the sleeps; L211 `if (res !== 'saved') return` leaves the addDownload'd entry untouched."
    - "downloadFromDonor L471-474 re-arms beginDownload after each inner attempt — a local patch for exactly this gap, proving the plain Set cannot express nested brackets."
    - "download-state.ts: busy > unavailable > downloaded; nothing calls markUnavailable except the player's two device seams, so a failed download can only render as the tick."
  falsification_test: "tick-e2e (hooks IDBObjectStore.put): if every row's first TICK follows its own blob put and no put-less row ever shows TICK on the unfixed tree, the hypothesis is wrong."
  fix_rationale: "Make library.downloading a refcount so nested brackets compose; one outer bracket per album song from start to final outcome (covers sleeps + donor walk); downloadOne marks a non-saved outcome unavailable (and clears it on saved) so an entry without a file renders the existing alert glyph, never the tick. Addresses the predicate itself, so singles/TrackMenu/RowBadges/downloads list all inherit it."
  blind_spots: "Svelte flush ordering between endDownload and markUnavailable (mitigated by marking BEFORE endDownload inside the same finally); the album page's per-row DownloadControl passes persist={false}, unchanged; device: uids never go through downloadOne."

## Evidence

- 2026-10-01 — checked: `download-track.ts` downloadOne L172/L239/L407. found: `beginDownload` at entry, `addDownload(r)` BEFORE fetch (DL-BUG-01), `endDownload` in `finally` on every exit incl. 'rate-limited' / 'no-audio' / 'failed'. implication: after any non-saved attempt the uid is downloaded-but-not-downloading = tick.
- 2026-10-01 — checked: `download-album.ts` L196-210. found: `await downloadTrack` → on 'rate-limited' `await setTimeout(3000/6000/9000/12000)` with NO beginDownload around the sleep → `downloadFromDonor`. implication: 3–30 s tick windows per limited song; a quick tang `请求过于频繁` answer = the "quick spin then tick" the user saw.
- 2026-10-01 — checked: `downloadFromDonor` L464-493. found: it re-arms `beginDownload` after each inner attempt because downloadOne's finally clears a plain Set — a hand-rolled fix for exactly this class of gap, local to the donor path only. implication: the Set cannot express nested brackets; the album loop has the same need and no re-arm.
- 2026-10-01 — checked: `download-state.ts` + `DownloadControl.svelte` + `RowBadges.svelte`. found: all read `downloaded: library.isDownloaded(uid)` (= membership in `library.downloads`) and `unavailable: library.isUnavailable(uid)`; nothing marks a failed download as file-less. `TrackMenu` already distrusts isDownloaded and probes `blobStore.has` instead (quick-260913-jq4). implication: the shared predicate has no "file really saved" signal; `unavailable` (persisted, "entry without a file") is the existing state that should carry it.

- 2026-10-01 — checked: baseline tick-e2e (TAG=before, unfixed tree, fresh profile, dev 5173; scratchpad/tick-before.log). found: 可以了 (qq:002KvLx4425LV7) showed TICK at 35.0 s, 38.4 s and 56.6 s with busy gaps of ~3 s / ~6 s / ~9 s between them — the RETRY_BACKOFF_MS ladder — and its blob put landed at 70.0 s; 陰天快樂 + 你給我聽好 (joox) showed TICK at 54.9 s with NO IDB put ever and the album ended "Saved 8 of 10"; the 7 saved netease/qq rows ticked in the same 200 ms poll as their put (the script's uid match on those rows is a 繁/简 title-fold miss, not a bug). implication: H1 CONFIRMED on both counts — (a) tick during backoff sleeps, (b) permanent tick on a failed song.

## Eliminated

- 2026-10-01 — checked: tick-e2e TAG=after (fixed tree; scratchpad/tick-after.log) and TAG=after-fail (tick-after-fail.log, one media fetch forced to 403 — the 403 landed on a resolve-time probe, not the download body, so every song still saved). found: 10/10 rows "OK tick after put" in both runs, BAD rows 0; every row busy from album start (9.1 s / 10.8 s, the resolve of the stubs) through busy% to TICK within one 200 ms poll of its own IDB put; "Saved 10 of 10". implication: no tick precedes its blob persist any more. The qq-backoff and failed/no-audio paths did not occur upstream in these runs; they are locked by the fake-timer album test (song stays bracketed through 30 s of sleeps + donor walk) and the downloadOne mark tests.

## Resolution

- root_cause: The row tick is `library.isDownloaded(uid) && !library.downloading.has(uid)` (download-state.ts), `downloadOne` calls `library.addDownload` BEFORE the fetch (DL-BUG-01) and `library.endDownload` in its `finally` after EVERY attempt, and `library.downloading` was a plain Set that cannot express nested brackets. So (a) the album loop's qq backoff sleeps (3/6/9/12 s) and the hop into `downloadFromDonor` left each limited song "downloaded, not downloading" = a tick with no file (E2E: 可以了 ticked at 35.0/38.4/56.6 s, blob put at 70.0 s); (b) a song whose final outcome was 'failed'/'no-audio'/'rate-limited' stayed in `library.downloads` with nothing marking it file-less = a permanent tick (E2E: two joox rows ticked with no put, "Saved 8 of 10"). `downloadFromDonor`'s per-attempt `beginDownload` re-arm was a local patch for the same gap on one path only.
- fix: (1) `library.beginDownload/endDownload` refcount per uid (private `downloadDepth` Map; the Set stays the reactive readable; progress still cleared on every end; self-heals if the Set is replaced). (2) `download-album.ts` `one()` holds ONE outer bracket per song from its start to its final outcome (sleeps, retries, donor walk all inside). (3) `downloadOne` is now a bracket wrapper around `runDownload`: in its `finally`, if the song is in the library, a non-'saved' result → `library.markUnavailable(uid)` (the existing 34-D-06 "entry without a file" alert glyph), 'saved' → `clearUnavailable(uid)`; both BEFORE `endDownload`. `clearUnavailable(uid)` early-returns when unmarked (no write per saved download). (4) Removed the hand-rolled re-arm in `downloadFromDonor`. Comments updated in DownloadControl / download-state / library. Tagged `debug album-row-tick-before-file-done`.
- verification: 8 failing-first vitest tests (library refcount ×2, downloadOne mark/clear/order/refusal/donor-balance ×5, album outer bracket ×2) RED before / GREEN after; `pnpm test` 3911 passed (one unrelated wall-clock test, device-filename <2 s, failed only while the E2E + svelte-check ran in parallel and passes alone); `pnpm check` 0 errors. CDP E2E on dev 5173 (fresh profile, IDB put hook): before = 9 BAD rows (3 ticks before put on the rate-limited song, 2 ticks with no blob); after = 0 BAD rows across two runs, every TICK within one poll after its own put.
- files_changed: [src/lib/stores/library.svelte.ts, src/lib/services/download-track.ts, src/lib/services/download-album.ts, src/lib/components/DownloadControl.svelte, src/lib/components/download-state.ts, src/lib/stores/library.svelte.test.ts, src/lib/services/download-track.test.ts, src/lib/services/download-album.test.ts]
