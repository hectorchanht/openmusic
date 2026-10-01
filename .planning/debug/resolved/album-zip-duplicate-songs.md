---
status: resolved
trigger: "Album download zip contains duplicate songs (陳奕迅 - rice & shine: 8 tracks saved as 陳奕迅 - 明年今日.flac (2)…(8), all 20MB)"
created: 2026-10-01T03:46:06Z
updated: 2026-10-01T04:30:00Z
---

## Symptoms

- **Expected:** album download zip "陳奕迅 - rice & shine.zip" contains one file per album track, each the right song.
- **Actual:** 10 files: 陳奕迅 - 可以了.flac (58MB), 陳奕迅 - 四季圈.flac (33.8MB), and EIGHT copies of 陳奕迅 - 明年今日.flac / 明年今日 (2)…(8).flac, all exactly 20MB — 8 different album tracks saved with identical audio and the same name.
- **Errors:** none reported.
- **Timeline:** Phase 40 album download (new feature, first real use on this album).
- **Reproduction:** web, dev server http://localhost:5173/album/rice%20%26%20shine?artist=%E9%99%B3%E5%A5%95%E8%BF%85&mbid=03fac712-87f5-4a57-a083-e9c40382964a → tap album Download → unzip.

## Suspects (from orchestrator scan)

- (a) album tracklist stub resolution (`resolveAllCached` on `src/routes/(app)/album/[name]/+page.svelte`) mapping several different track stubs to the same search hit 明年今日.
- (b) 40-03 YTM donor fallback in `src/lib/services/download-album.ts` (`fetchVariants` + `versionsIncludingOwn` + `probeDownload` → `downloadTrack` `audioFrom`) picking the same donor for different songs, or `onSaved` filename taken from the donor instead of the album track.
- (c) held-single reuse `library.downloads.find(d => d.uid === tr.uid || sameSongKey(d, tr))` matching the wrong held download.

## Current Focus

reasoning_checkpoint:
  hypothesis: "resolveStub returns a junk same-artist row for a Traditional-script stub because dedupeBest's key() folds Trad->Simp (n0r) so the group survivor is the Simplified qq/netease row, but scoreMatch's matchKey is script-blind: the survivor scores 0 against the Traditional query while a junk Traditional joox row of the same artist scores 4 and wins; preferEligible then settles on that weak row (CJK query never retries)."
  confirming_evidence:
    - "live: 6/10 album stubs resolve to joox:ZD7DF66B0C90DD 明年今日; the raw searchAll rows for each contain the correct song in qq/netease (Simplified) and joox (Traditional)"
    - "replicated attempt(): dict warm -> ranked top = 4:joox/明年今日, then 0:qq/陈奕迅/放弃治疗; dict cold (first call) -> 10:joox/愚人快樂 top. resolveStub returned 明年今日 in all warm cases"
  falsification_test: "fold both sides to Simplified inside scoreMatch.similarity(); if the live resolveStub still returns 明年今日 for 對面/放棄治療, the hypothesis is wrong"
  fix_rationale: "scoreMatch is the ONE ranking authority shared by resolveStub, the search page and crossSourceLyric; folding script there (same per-char foldScript dedupe uses) makes ranking agree with the identity dedupe already applies. The album loop also gets a uid guard so identical audio identity can never be zipped twice for different album tracks."
  blind_spots: "Other language pairs (JA/KO) untouched; shortTitleBoost length math unchanged by fold (same char count). Search-page ranking for Traditional-typed queries now ranks Simplified exact rows as exact (intended)."
- next_action: write failing tests (score-match.test.ts, discovery.test.ts, download-album.test.ts), confirm RED, apply fix, run pnpm test + pnpm check, re-run live probe

## Evidence

- 2026-10-01 read download-album.ts: zip entry name comes from `onSaved` filename = downloadTrack's `buildDownloadFilename(dn(r.artist), dn(r.title))` where `r = {...track, audioUrl: donor...}` — so the filename ALWAYS carries the album track's own title, never the donor's. Eight files named 明年今日 therefore means eight RESOLVED tracks whose `title` is 明年今日, i.e. the defect is upstream of downloadTrack (suspect (a) resolveStub, or (c) held-single reuse via heldFilename which uses the HELD track's title).
- 2026-10-01 read heldFilename: it names the entry after the HELD download (`held.title`), not the album track. With `sameSongKey(d, tr)` match, a wrong held match would produce a donor-titled file. But the symptom says 8 identical 20MB files; a held-single reuse would reuse ONE blob for N tracks only if sameSongKey matched 8 different stubs to the same held download — requires the 8 resolved tracks to already share identity.
- 2026-10-01 dev server: 5173 up (200), 4321 down.
- 2026-10-01 LIVE REPRO (vitest probe, VITE_API_BASE=localhost:5173, real resolveStub over the MB tracklist): 6 of 10 stubs (愚人快樂/不如承諾來的簡單/對面/放棄治療/時光隧道/陰天快樂) all resolve to the SAME `joox:ZD7DF66B0C90DD 陳奕迅/明年今日 (The Line Up)`; 你給我聽好 -> joox 富士山下. Not ytmusic, so suspect (b) is out; suspect (a) confirmed as the symptom site.
- 2026-10-01 per-source searchAll for the Traditional query `陳奕迅 愚人快樂` DOES return the right song in every source: joox `陳奕迅/愚人快樂` (scoreMatch 10, isStrongMatch true), qq/netease `陈奕迅/愚人快乐` (Simplified; scoreMatch 0, isStrongMatch false — both are script-blind). The junk joox rows (明年今日/富士山下, the artist's popular songs) score 4 (artist match 3 + token 1).
- 2026-10-01 replicated attempt()'s pick: with the t2s dict WARM, `dedupeBest` (key() folds Trad->Simp since quick-260926-n0r) MERGES joox 愚人快樂 with qq/netease 愚人快乐 and the group survivor is the Simplified qq/netease row (SOURCE_RANK qq 4 > netease 3 > joox 1). scoreMatch(Trad query, Simp survivor) = 0, while the junk joox 明年今日 row keeps its own key and scores 4 -> junk wins the stable max. preferEligible: strongFolded(junk)=false, but a CJK query "settles" on ANY candidate, so the urx t2s retry never fires. With the dict COLD (first call in process) the joox Trad row is not merged, scores 10 and wins — explains why the bug is intermittent/order-dependent.

## Eliminated

## Resolution

- root_cause: `scoreMatch` (the ONE ranking authority behind resolveStub, the search page and crossSourceLyric) compared Traditional vs Simplified script literally, while `dedupeBest`'s `key()` has folded Trad→Simp since quick-260926-n0r. For a Traditional MusicBrainz album stub (陳奕迅 / 愚人快樂) the merged same-song group's survivor is the Simplified qq/netease row (SOURCE_RANK), which scored 0 against the Traditional query; joox's artist-popular filler rows (明年今日, 富士山下 — Traditional, same artist) scored 4 and won the stable max. `preferEligible` settles a CJK query on any candidate, so the urx t2s retry never fired. Six of ten album stubs resolved to the single joox 明年今日 uid; downloadAlbum then saved that one blob under eight (2)…(8) names. Intermittent because with the t2s dict cold the fold degrades to identity and the joox Traditional hit scores 10.
- fix: (1) `score-match.ts` `similarity()` folds both query and candidate through dedupe's exported `foldScript` before `matchKey`, so ranking and identity agree on script (cold dict = pre-fix numbers). (2) `download-album.ts` defensive guard: a `seenUids` set skips any album track whose uid already produced an entry/move — one audio identity, one zip entry, never counted as saved twice.
- verification: failing-first vitest (5 RED → GREEN): score-match fold (2), discovery live-case regression reproducing `joox:ZD7DF66B0C90DD` (1), download-album uid guard web+native (2). `pnpm test` 172 files / 3852 passed; `pnpm check` 0 errors. Live re-probe against dev server 5173 through the real resolveStub over the MusicBrainz tracklist: all 10 rice & shine stubs resolve to 10 distinct correct songs (was 6× 明年今日 + 1× 富士山下).
- files_changed: [src/lib/services/score-match.ts, src/lib/services/dedupe.ts, src/lib/services/download-album.ts, src/lib/services/score-match.test.ts, src/lib/services/discovery.test.ts, src/lib/services/download-album.test.ts]
