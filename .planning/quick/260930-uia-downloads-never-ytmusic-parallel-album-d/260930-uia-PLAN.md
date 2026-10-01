---
phase: quick-260930-uia
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/download-track.ts
  - src/lib/services/download-track.test.ts
  - src/lib/components/TrackMenu.svelte
  - src/lib/services/download-album.ts
  - src/lib/services/download-album.test.ts
  - src/lib/components/SongRow.svelte
  - src/routes/(app)/album/[name]/+page.svelte
autonomous: true
requirements: [quick-260930-uia]
must_haves:
  truths:
    - "No download path (TrackMenu single, Download from… picker, album, background repair) ever fetches a ytmusic audio file; a ytmusic-sourced song downloads a non-ytmusic donor's audio under its own identity, or returns 'no-audio'"
    - "The Download from… sheet never offers a YouTube Music row"
    - "An album download runs at most 3 songs at once, zip entries / track numbers stay in album order, the n/total toast counts completions"
    - "While an album download runs, each album row's own DownloadControl ring shows that song's progress and ends on the downloaded tick"
  artifacts:
    - path: "src/lib/services/download-track.ts"
      provides: "the ONE ytmusic rule: donor lookup + 'no-audio' + picker refusal"
      contains: "fetchVariants"
    - path: "src/lib/services/download-album.ts"
      provides: "3-wide pool, order-preserved entries, completion-counted progress"
      contains: "POOL"
    - path: "src/lib/components/SongRow.svelte"
      provides: "`resolved` prop so a stub row keys download state on the page's resolved uid"
      contains: "resolved"
  key_links:
    - from: "src/lib/services/download-album.ts"
      to: "src/lib/services/download-track.ts"
      via: "downloadTrack(tr, { persist: true, save: false, ... }) with NO audioFrom donor loop of its own"
      pattern: "downloadTrack\\("
    - from: "src/lib/components/TrackMenu.svelte"
      to: "src/lib/services/download-track.ts"
      via: "canDownloadFrom filter on dlPickList"
      pattern: "canDownloadFrom"
    - from: "src/routes/(app)/album/[name]/+page.svelte"
      to: "src/lib/components/SongRow.svelte"
      via: "resolved={resolvedRows[i]} so DownloadControl keys on the real uid"
      pattern: "resolved=\\{"
---

<objective>
Downloads never route to YT Music, album downloads run 3-wide with per-row progress.

Purpose: a ytmusic audio file cannot be fetched by any download path (web: googlevideo 403 through the stream proxy; native: no CORS on the direct url) and the user rule is "downloading a song should never route to YT Music". Today the donor fallback lives only in the album loop, so single/picker downloads of a ytmusic song still try (and fail on) the ytmusic file, and the album still tries it "last". Album downloads are also strictly sequential (~200 s for 10 songs) and the rows show nothing while it runs.

Output: one shared ytmusic rule in `downloadTrack`, a ytmusic-free "Download from…" sheet, a 3-wide `downloadAlbum` pool, album rows that light their own DownloadControl ring during the album download. Failing-first tests for the rule and the pool.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a/40-03-SUMMARY.md
@.planning/debug/resolved/album-zip-duplicate-songs.md
@src/lib/services/download-track.ts
@src/lib/services/download-album.ts
@src/lib/services/download-album.test.ts
@src/lib/services/download-track.test.ts
@src/lib/components/DownloadControl.svelte
@src/lib/components/SongRow.svelte

<interfaces>
<!-- Already in the codebase. Use directly. -->

From src/lib/services/variants.ts:
  export async function fetchVariants(track: Track, signal?: AbortSignal): Promise<Track[]>   // the "Download from…" lookup (memoised searchAll by name)
  export function versionsIncludingOwn(track: Track, variants: Track[]): Track[]              // own track first, ONE row per source, pure

From src/lib/services/download-probe.ts:
  export async function probeDownload(track: Track, signal?: AbortSignal): Promise<DownloadProbe>  // resolves at settings.downloadQuality + HEAD; `.track` is the resolved Track or null

From src/lib/services/download-track.ts (today):
  export type DownloadResult = 'saved' | 'no-audio' | 'failed';
  export async function downloadTrack(track: Track, opts?: { persist?, save?, trackNumber?, albumArtist?, audioFrom?: Track, dir?, onSaved? }): Promise<DownloadResult>
  // `audioFrom` = donor's resolved audio saved under `track`'s identity (quick-260916-0d9); `r` spreads `track` so uid/source stay the original's.

From src/lib/stores/library.svelte.ts:
  beginDownload(uid) / endDownload(uid)          // copy-on-write Set `downloading`; begin clears downloadProgress[uid]
  setDownloadProgress(uid, fraction)             // only while downloading.has(uid)
  downloadProgress: Record<string, number>       // absent = indeterminate (DownloadRing spins)

From src/lib/components/DownloadControl.svelte:
  props { track?: Track|null, resolve?: (() => Promise<Track|null>)|null, persist?, size? }
  uid = resolved?.uid ?? track?.uid ?? ''  →  isDownloading = localBusy || library.downloading.has(uid); dlFrac = library.downloadProgress[uid]
  // i.e. the ring already works for ANY uid in library.downloading — the album rows only need to hand it the RESOLVED uid.

From src/lib/components/SongRow.svelte (quick-260919-l9e):
  props include `track`, `resolve`, `persist`, `actions`; internal `resolvedTrack = $state<Track|null>(null)`; `actUid = resolvedTrack?.uid ?? track.uid`;
  <DownloadControl track={resolvedTrack ?? (resolve ? null : track)} resolve={resolve ? runResolve : null} {persist} />
  toggleLike(): rowActionTarget(track, resolvedTrack, !!resolve)

From src/lib/components/TrackMenu.svelte:
  line ~765/770: dlPickList = versionsIncludingOwn(target, found)   // the "Download from…" rows
  pickDownload(v): downloadTrack(track, { audioFrom: p.track }) → toast 'saved' | 'no-audio' (toast.noAudio) | else downloadFailedKeptInLibrary

From src/routes/(app)/album/[name]/+page.svelte:
  resolveAll(): order-preserved (Track|null)[] filled by 4 workers, then `.filter` DROPS nulls (index alignment lost)
  resolveAllCached(): caches the filtered list in `resolvedCache`
  rows: {#each tracks as track, i (i)} … <SongRow track={rowTrack} index={i} cover={heroImg} lazy={false} persist={false} resolve={() => resolveStub(...)} onplay=… onrequestmenu=… swipe=… />
  downloadAlbum(): resolveAllCached() → downloadAlbumTracks(resolved, {artist, album}, (n,total) => toast albumProgress) → toast albumSaved
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: The ONE ytmusic rule lives in downloadTrack; the picker hides YouTube Music</name>
  <files>src/lib/services/download-track.ts, src/lib/services/download-track.test.ts, src/lib/components/TrackMenu.svelte</files>
  <behavior>
    New tests in download-track.test.ts (add `vi.mock('$lib/services/variants', …)` keeping `versionsIncludingOwn` real and mocking `fetchVariants`, and `vi.mock('$lib/services/download-probe', …)` mocking `probeDownload` — same shape as download-album.test.ts lines 23-45). All MUST fail before the implementation:
    - Test 1 (donor): track `{uid:'ytmusic:abc', source:'ytmusic'}`, fetchVariants → [another ytmusic row, qq row, kuwo row], probeDownload returns `{track:{...t, audioUrl:'https://cdn.example/<uid>.m4a'}}`. `downloadTrack(yt)` → `'saved'`; `ensureTrackDetails` was NEVER called (no ytmusic resolve); global fetch was called ONCE with the qq donor url; `blobStore.put` keyed by `'ytmusic:abc'` (identity is the original's); `probeDownload` never called with a `source:'ytmusic'` object.
    - Test 2 (next donor on failure): fetch for the qq url answers `{ok:false}`, kuwo url answers ok with bytes → `'saved'`, fetch called twice, in donor order (qq then kuwo = versionsIncludingOwn's order).
    - Test 3 (no donor): fetchVariants → [] → `'no-audio'`; fetch never called; `library.addDownload` never called; begin/endDownload bracketed once each (spinner cleared).
    - Test 4 (all donors fail): both donor fetches `{ok:false}` → `'failed'` (not 'no-audio').
    - Test 5 (picker refusal): `downloadTrack(qqTrack, { audioFrom: { ...ytTrack, audioUrl:'https://googlevideo/x' } })` → `'no-audio'`, fetch never called.
    - Test 6 (non-ytmusic untouched): `downloadTrack(qqTrack)` never calls fetchVariants/probeDownload (existing happy-path tests keep passing).
    - Test 7 (import/grep contract, style of the existing "import contract" describe): `download-album.ts` source contains neither `fetchVariants` nor `probeDownload` (this one goes RED now and GREEN after Task 2 — write it here, note it in the commit).
  </behavior>
  <action>
    In `src/lib/services/download-track.ts`:
    1. Export `canDownloadFrom(source: SourceId): boolean` → `source !== 'ytmusic'` (one module-level `const YTMUSIC = 'ytmusic'`; this is the named user rule "downloading a song should never route to YT Music", so a literal is right — it is NOT the auto-resolve-floor flag). Doc-comment it as the rule every download affordance consults.
    2. Rename the current function body to a module-private `downloadOne(track, opts)` and add at its top, BEFORE `library.beginDownload`: `if (opts?.audioFrom && !canDownloadFrom(opts.audioFrom.source)) return 'no-audio';` (picker refusal — belt to the UI filter below).
    3. New exported `downloadTrack(track, opts)` keeps the exact signature + `DownloadResult`. If `canDownloadFrom(track.source)` → `return downloadOne(track, opts)` (zero behaviour change for every non-ytmusic caller). Otherwise the donor loop MOVED VERBATIM from download-album.ts: `library.beginDownload(track.uid)` (so the row ring spins through the lookup), then `const donors = versionsIncludingOwn(track, await fetchVariants(track)).filter(v => canDownloadFrom(v.source))`; for each donor: `library.beginDownload(track.uid)` again (idempotent Set add — downloadOne's `finally` just removed it), `const p = await probeDownload(donor)`; skip when `!p.track?.audioUrl`; `res = await downloadOne(track, { ...opts, audioFrom: p.track })`; return on `'saved'`; remember `'failed'`. After the loop return `'failed'` if any donor attempt failed, else `'no-audio'`. Wrap in try/finally → `library.endDownload(track.uid)`; wrap the whole thing in try/catch → `'failed'` (D-17 never-throws). The resolve path is never reached for a ytmusic track (no `/api/ytmusic` call at all), which is what "resolve for download never picks ytmusic" means here — cross-source fallback and resolveNameStub already exclude ytmusic via isAutoResolveEligible, so `r.source` can only be ytmusic when `track.source` is.
    4. Replace the 40-03 "ytmusic file itself is tried last" comment with the rule: never fetched, 'no-audio' instead. Keep every existing decision-ref comment. Add a `quick-260930-uia` comment at the rule.
    In `src/lib/components/TrackMenu.svelte` lines ~765 and ~770: `dlPickList = versionsIncludingOwn(target, …).filter((v) => canDownloadFrom(v.source))` (import `canDownloadFrom` from `$lib/services/download-track`, already imported module). A ytmusic own-track therefore shows only donor rows; an empty list falls into the existing `versions.empty` state.
    Run `pnpm test -- src/lib/services/download-track.test.ts` RED first (commit the tests alone: `test(quick-260930-uia): ytmusic rule in downloadTrack`), then GREEN (`feat(quick-260930-uia): …`). Test 7 stays RED until Task 2 — say so in the commit body.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm test -- src/lib/services/download-track.test.ts 2>&1 | tail -15 && grep -c "canDownloadFrom" src/lib/components/TrackMenu.svelte</automated>
  </verify>
  <done>Tests 1-6 green (7 pending Task 2); `downloadTrack` of a ytmusic track never calls ensureTrackDetails or fetches a googlevideo/ytmusic url; TrackMenu's picker list is filtered through `canDownloadFrom`; all pre-existing download-track tests still pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: downloadAlbum — drop its donor loop, run a 3-wide pool, keep order + seenUids + completion-counted progress</name>
  <files>src/lib/services/download-album.ts, src/lib/services/download-album.test.ts</files>
  <behavior>
    In download-album.test.ts (failing-first):
    - Replace the `ytmusic donor fallback (40-03)` describe with: a ytmusic song is handed to `downloadTrack` ONCE with no `audioFrom` and `fetchVariants`/`probeDownload` are never called by this module (the shared rule owns donors now); delete the variants/download-probe `vi.mock`s and the `fetchVariants`/`probeDownload` mock fields.
    - Pool: `downloadTrack` mock returns a deferred promise per call and records `inFlight` (increment on call, decrement on resolve); 7 tracks → `max(inFlight)` is exactly 3, the 4th call starts only after one of the first three resolves, all 7 are called.
    - Order: resolve the deferreds in REVERSE order (track 7 first); on web the zip entries passed to `buildZip` are still `Artist - Album/Artist - Song1.m4a … Song7.m4a` in album order, and `trackNumber` for call i is `String(i+1)`.
    - Progress: `onProgress` receives `(1,7) … (7,7)` in order of COMPLETION, never a value before the matching download resolved (assert the call count equals the number of settled downloads at each step); a failed or seenUids-skipped song still advances it.
    - The existing `seenUids` tests, D-05 held-single tests, failure-isolation tests and `a throwing onProgress does not abort` keep passing (adapt the progress assertions from "before start" to "after completion").
  </behavior>
  <action>
    In `src/lib/services/download-album.ts`:
    1. Delete the `fetchVariants` / `versionsIncludingOwn` / `probeDownload` imports, the `YTMUSIC` const and the whole `if (tr.source === YTMUSIC) { … }` donor branch plus the trailing `if (res !== 'saved') res = await attempt();` — one `const res = await attempt();` per song. The shared `downloadTrack` now returns 'no-audio' for a donor-less ytmusic song, which the existing "skip, keep going" branch already handles. Update the header comment: the ytmusic rule points at download-track.ts; replace the "ponytail: sequential" paragraph with "ponytail: POOL=3 workers; the apiFetch governor (MAX_CONCURRENT_REQUESTS=8, api fetch-flood-freeze) still bounds the resolve/probe calls, and the audio bodies are raw fetches that never shared that pool. Raise POOL only with a measurement."
    2. Pool shape (same idiom as the page's `resolveAll`): `const POOL = 3`; `let next = 0; let done = 0;` `const slots: ({ filename: string; blob: Blob } | null)[] = new Array(total).fill(null);` worker = `for (let i = next++; i < total; i = next++) { await one(i); done++; try { onProgress?.(done, total) } catch {} }`; `await Promise.all(Array.from({ length: Math.min(POOL, total || 1) }, worker))`. `one(i)` is the current per-song body: the `seenUids` check+add happens SYNCHRONOUSLY at the top of `one(i)` before any await (so two workers can never both claim a uid); native held-move / web held-reuse / `downloadTrack` exactly as today; on web it writes `slots[i] = { filename, blob }` instead of calling `addEntry` directly; `saved++` where it is today. After `Promise.all`, build `entries` by iterating `slots` in index order through the existing `addEntry` (so `uniqueName`'s `(2)` suffixing is deterministic in album order), then the unchanged zip/save tail.
    3. `onProgress` is called ONLY after a song settles (saved, failed, skipped) — the album page's `toast.albumProgress` "Downloading n of total" then counts completions as the task demands. Keep the try/catch around it (36-D-19).
    4. Keep: never-throws outer try/catch, `trackNumber: String(i + 1)` + the 36-D-11 comment, `meta.artist || undefined`, the debug album-zip-duplicate-songs comment and guard, `albumArtist`, `dir`/`onSaved` wiring. Nothing in download-track.ts changes in this task.
    RED first (commit tests alone), then GREEN. Then `pnpm test` (whole suite) and `pnpm check` must be clean; Task 1's import-contract test goes green here.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm test -- src/lib/services/download-album.test.ts src/lib/services/download-track.test.ts 2>&1 | tail -15 && ! grep -q "fetchVariants\|probeDownload" src/lib/services/download-album.ts && grep -c "POOL" src/lib/services/download-album.ts</automated>
  </verify>
  <done>download-album.ts has no donor loop and no variants/probe import; 7-track pool test shows max 3 in flight; reverse-completion test yields album-ordered zip entries and track numbers; progress counts completions; seenUids / held-single / isolation tests green; `pnpm test` and `pnpm check` clean.</done>
</task>

<task type="auto">
  <name>Task 3: Album rows show their own song's progress during the album download; verify on the dev server</name>
  <files>src/lib/components/SongRow.svelte, src/routes/(app)/album/[name]/+page.svelte</files>
  <action>
    Why nothing shows today: album rows DO have a DownloadControl (quick-260919-l9e moved it INSIDE SongRow, governed by `settings.rowActions` default `['download','like']`), but it keys on `resolvedTrack?.uid ?? track.uid`, and an untapped row's `resolvedTrack` is null, so the ring reads `library.downloading.has('<synthetic nameStub uid>')` — never true. The album download runs on the RESOLVED uids. Fix = hand the row the page's resolved Track; the existing ring/tick pipeline (begin/endDownload + setDownloadProgress inside downloadTrack → DownloadControl → DownloadRing) does the rest. Do not add a new indicator.
    1. `SongRow.svelte`: add prop `resolved?: Track | null` (default null, doc: "the page's already-resolved Track for a stub row, so download/like state keys on the real uid before the user taps; the row still DISPLAYS `track`"). `const real = $derived(resolvedTrack ?? resolved ?? null)`; use `real` in `actUid`, in `rowActionTarget(track, real, !!resolve)`, and in `<DownloadControl track={real ?? (resolve ? null : track)} …>`. Nothing else in SongRow changes (the row still renders the stub's title/cover; `rowId`/gen untouched).
    2. Album page: keep `resolveAll()`'s aligned `out` array — add `let resolvedRows = $state<(Track | null)[]>([])` set from `out` inside `resolveAll` before the `.filter` (reset it where `resolvedCache` is reset on album change, ~line 142-146). In the row markup pass `resolved={resolvedRows[i] ?? null}` to `<SongRow>`. Because `downloadAlbum()` awaits `resolveAllCached()` before `downloadAlbumTracks`, every row holds its resolved uid by the time the first `beginDownload` lands, so each ring lights only for ITS song, fills with `readBlobWithProgress`'s fraction, and ends on the downloaded tick (`persist: true` → `library.isDownloaded`). Held singles / seenUids-skipped rows simply show their existing state. Add a `quick-260930-uia` comment at both edits.
    3. `pnpm check` + `pnpm test` clean.
    4. Dev-server verification (do NOT push): probe `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/` then 4321; start `pnpm dev` only if neither answers. Open `http://localhost:5173/album/rice%20%26%20shine?artist=%E9%99%B3%E5%A5%95%E8%BF%85&mbid=03fac712-87f5-4a57-a083-e9c40382964a` in headless Chrome via CDP (the 40-03 E2E recipe; a fresh profile so no held singles), click the album Download button, and record: (a) the toast sequence `Preparing download…` → `Downloading 1 of 10…` … `10 of 10` → `Saved N of 10` with N == 10; (b) while running, up to 3 rows at once carry `aria-busy="true"` on their DownloadControl and a `DownloadRing` arc, and each turns into the greyed Check tick when its song lands; (c) the single saved `陳奕迅 - rice & shine.zip` lists 10 distinct non-empty entries (`unzip -l`), no `(2)` names; (d) the network log shows NO request to `/api/ytmusic/stream` or `googlevideo`. Also open any song's long-press menu → "Download from…" caret and confirm no "YouTube Music" row. Note wall-clock vs the 40-03 sequential ~204 s. Capture these in the SUMMARY.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm check 2>&1 | tail -3 && pnpm test 2>&1 | tail -4 && grep -c "resolved=" "src/routes/(app)/album/[name]/+page.svelte"</automated>
    <human-check>Album page on the dev server: during Download, 3 rows at a time show the filling ring, each ends on the tick; zip has 10 distinct entries; no ytmusic/googlevideo requests; "Download from…" shows no YouTube Music row.</human-check>
  </verify>
  <done>SongRow accepts `resolved`; the album page passes the aligned resolved Track per row; `pnpm check`/`pnpm test` clean; dev-server run observed with per-row rings, album-ordered 10-entry zip, zero ytmusic fetches, and the timing recorded in the SUMMARY.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → /api/* and CDN | donor audio urls come from the existing probeDownload resolve (same hosts as today); nothing new is fetched |
| user → Download from… picker | row choice; a ytmusic row is both hidden (UI) and refused (service) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-uia-01 | DoS | downloadAlbum pool | mitigate | POOL=3 fixed; resolve/probe still under apiFetch MAX_CONCURRENT_REQUESTS=8 + circuit breaker; audio bodies were never in that pool |
| T-uia-02 | Tampering | ytmusic rule bypass via audioFrom | mitigate | `downloadOne` refuses `audioFrom.source==='ytmusic'` regardless of UI; grep-tested that download-album has no donor loop of its own |
| T-uia-03 | Spoofing | donor identity | accept | donor audio saved under the original uid is the existing quick-260916-0d9 contract; filename/tags still come from the original track |
| T-uia-SC | Tampering | npm installs | accept | no package installs in this plan |
</threat_model>

<verification>
- `pnpm test` whole suite green, `pnpm check` 0 errors.
- `grep -n "fetchVariants\|probeDownload" src/lib/services/download-album.ts` → no output; same grep in download-track.ts → present.
- Dev-server album run per Task 3 step 4; no push.
</verification>

<success_criteria>
- A ytmusic single, a picker pick, an album song and a background repair all go through the one `downloadTrack` rule: donor audio or 'no-audio', never a ytmusic fetch.
- Album download of 10 songs completes 3-wide, album-ordered, with completion-counted toasts and one zip of 10 distinct entries.
- Album rows light their own ring during the album download using the existing DownloadControl/DownloadRing pipeline.
</success_criteria>

<output>
Create `.planning/quick/260930-uia-downloads-never-ytmusic-parallel-album-d/260930-uia-SUMMARY.md` when done
</output>
