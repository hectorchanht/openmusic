---
phase: quick-260930-vjp
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/download-track.ts
  - src/lib/services/download-track.test.ts
  - src/lib/services/download-album.ts
  - src/lib/services/download-album.test.ts
autonomous: true
requirements: [QUICK-260930-VJP]
must_haves:
  truths:
    - "Album download: at most 3 songs are inside the link-resolve step (ensureTrackDetails / fetchVariants / probeDownload) at once"
    - "Album download: at most 8 songs are inside the byte-download step (fetch → read → tag → persist/save) at once"
    - "A song whose resolve is slow does not stop the other songs from downloading and completing"
    - "Zip entries and track numbers stay in album order; seenUids, held-single reuse/move, per-row rings, completion-counted n/total progress, never-throw all hold"
    - "downloadTrack with no `stages` option behaves exactly as before for TrackMenu / Download from… / repair callers"
    - "A different song started while the album downloads begins playing (resolve slots are left for playback)"
  artifacts:
    - path: "src/lib/services/download-track.ts"
      provides: "DownloadOpts.stages gate contract; resolve step bracketed by stages.resolve, byte step by stages.transfer"
      contains: "stages"
    - path: "src/lib/services/download-album.ts"
      provides: "RESOLVE_POOL=3 / TRANSFER_POOL=8 gates; every song enters the pipeline at once"
      contains: "TRANSFER_POOL"
  key_links:
    - from: "src/lib/services/download-album.ts"
      to: "src/lib/services/download-track.ts"
      via: "downloadTrack(tr, { ..., stages })"
      pattern: "stages"
    - from: "src/lib/services/download-track.ts"
      to: "ensureTrackDetails / fetch"
      via: "resolve gate around ensureTrackDetails, transfer gate around the fetch→save block"
      pattern: "stages\\?\\.(resolve|transfer)"
---

<objective>
Split the album download's single 3-wide pool into two pipelined stages: RESOLVE (link lookup, max 3,
shares the apiFetch governor with playback) and TRANSFER (raw audio fetch + tag + persist/save, max 8,
never apiFetch). A song enters stage 2 the moment its link resolves, so one slow resolve or one slow CDN
body no longer holds a pool slot hostage.

Purpose: 155 s for a 10-song album was dominated by a 1-busy tail (one slow body held a slot) and
resolve/body work sharing the same 3 slots. Separate caps let the governor keep room for playback
while bodies stream wide.

Output: `stages` option on `downloadTrack` (gate contract, opt-in, zero behaviour change without it),
two-stage `downloadAlbum`, failing-first tests for both, E2E timing + playback-responsiveness report.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260930-uia-downloads-never-ytmusic-parallel-album-d/260930-uia-SUMMARY.md
@src/lib/services/download-track.ts
@src/lib/services/download-album.ts
@src/lib/services/download-track.test.ts
@src/lib/services/download-album.test.ts

<interfaces>
<!-- Current contracts. Use directly. -->

From src/lib/services/download-track.ts:
```typescript
export type DownloadResult = 'saved' | 'no-audio' | 'failed';
export function canDownloadFrom(source: SourceId): boolean;
type DownloadOpts = { persist?: boolean; save?: boolean; trackNumber?: string; albumArtist?: string;
	audioFrom?: Track; dir?: string; onSaved?: (uid: string, filename: string, blob: Blob) => void };
async function downloadOne(track: Track, opts?: DownloadOpts): Promise<DownloadResult>;   // private
export async function downloadTrack(track: Track, opts?: DownloadOpts): Promise<DownloadResult>;
```
Stage 1 sites inside download-track.ts: the `else` re-resolve branch of `downloadOne`
(`r = await ensureTrackDetails({...track, detailsLoaded:false, audioUrl:null, lrc:null}, undefined, settings.downloadQuality).catch(() => track)`),
and in `downloadTrack`'s ytmusic path `await fetchVariants(track)` and `await probeDownload(donor)`.
Stage 2 starts at `const resp = await fetch(r.audioUrl)` and runs to the end of the `try` (read, tag,
`blobStore.put`, `onSaved`, `saveBlobToDisk`). `resolveArtworkDataUrl` inside stage 2 is a RAW fetch
(6 s / 1 MB bound, `/api/og` tier via `apiUrl` + raw fetch, NOT apiFetch) — stage 2 uses no apiFetch; leave it.

From src/lib/services/download-album.ts:
```typescript
const POOL = 3;   // becomes RESOLVE_POOL / TRANSFER_POOL
export async function downloadAlbum(tracks: Track[], meta: { artist: string; album: string },
	onProgress?: (n: number, total: number) => void): Promise<{ saved: number; total: number }>;
```
The album test mocks `downloadTrack` (`mocks.downloadTrack`, `vi.mock('$lib/services/download-track')`)
and already has a `deferredImpl()` helper + `flush()`; the track test mocks `ensureTrackDetails`,
`fetchVariants`, `probeDownload`, `blobStore.put`, `library.*` and stubs global `fetch`.

Test guards to keep green: `download-track.test.ts` "import contract" reads `download-album.ts` source
and requires `trackNumber: String(i + 1)` inside `downloadAlbum`'s body and no `displayIndex`; it also
requires `tagAudioBlob(` and `resolveArtworkDataUrl(` in download-track.ts.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: `stages` gate option on downloadTrack (resolve + transfer brackets)</name>
  <files>src/lib/services/download-track.ts, src/lib/services/download-track.test.ts</files>
  <behavior>
    - A `StageGate` is `() => Promise<() => void>` (acquire → release). `opts.stages = { resolve, transfer }` is optional.
    - With stages: `ensureTrackDetails` runs AFTER `stages.resolve()` grants and the release fn is called BEFORE `fetch` is issued; `fetch` runs AFTER `stages.transfer()` grants; the transfer release runs on EVERY exit (saved, `resp.ok=false` → 'failed', empty body, throw) — assert via an in/out log: `['resolve:in','ensure','resolve:out','transfer:in','fetch','transfer:out']` for the happy path, and acquire count == release count for a `resp.ok=false` path.
    - Reuse branches (reuseCurrent / reuseInput / audioFrom) never call `stages.resolve` (no network resolve), but still take the transfer gate.
    - ytmusic donor path: `fetchVariants` and each `probeDownload` run under `stages.resolve` (acquire/release around each, released before `downloadOne` is entered), and the donor's `downloadOne` takes `stages.transfer`.
    - Without `stages`: every existing test stays green unchanged (no new calls, same sentinels, same begin/end bracketing).
  </behavior>
  <action>
    RED first: add a `describe('downloadTrack — stages gates (quick-260930-vjp)')` block to
    download-track.test.ts with a `gateOf(name, log)` helper that pushes `${name}:in` on acquire and
    returns a release pushing `${name}:out`; have `mocks.ensureTrackDetails` / the fetch stub push
    `'ensure'` / `'fetch'` into the same log. Run `pnpm test -- download-track.test.ts` — the new block
    must fail (stages ignored). Commit `test(quick-260930-vjp): stage gates on downloadTrack`.

    GREEN: in download-track.ts export `type StageGate = () => Promise<() => void>` and add
    `stages?: { resolve: StageGate; transfer: StageGate }` to `DownloadOpts` with a comment tagged
    quick-260930-vjp explaining the two stages and that only the album passes it. In `downloadOne`
    declare `let release: (() => void) | undefined` before the `try`; in the re-resolve `else` branch
    do `release = await opts?.stages?.resolve()` immediately before `ensureTrackDetails` and
    `release?.(); release = undefined` immediately after it (inside the branch — the reuse branches do
    not resolve). Immediately before `const resp = await fetch(r.audioUrl)` do
    `release = await opts?.stages?.transfer()`. In the existing `finally`, call `release?.()` before
    `library.endDownload`. Keep the code FLAT — acquire/release, no closure re-indent of the 150-line
    stage-2 block, no change to any comment there. In `downloadTrack`'s ytmusic path, bracket
    `fetchVariants(track)` and each `probeDownload(donor)` the same way (acquire, await, release in a
    `finally`), releasing before `downloadOne(track, { ...opts, audioFrom })` so a held resolve slot
    never overlaps a transfer slot (no hold-and-wait, so no deadlock between the two gates). D-17 /
    D-18 / DL-BUG-01 / 36-D-06 untouched: no new throw path (a gate rejection is caught by the
    existing outer `catch` → 'failed', and `finally` still releases + ends the spinner).
    Commit `feat(quick-260930-vjp): downloadTrack resolve/transfer stage gates`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm test -- download-track.test.ts</automated>
  </verify>
  <done>New stages block green, all prior download-track tests green, `grep -c "stages?.resolve\|stages?.transfer" src/lib/services/download-track.ts` ≥ 4 (one resolve in downloadOne, one transfer, two in the donor path).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: downloadAlbum two-stage pipeline (3 resolve / 8 transfer)</name>
  <files>src/lib/services/download-album.ts, src/lib/services/download-album.test.ts</files>
  <behavior>
    - `downloadTrack` is called for EVERY song up front (all enter the pipeline) with `stages: { resolve: fn, transfer: fn }` plus the existing opts (persist:true, save:false, trackNumber:String(i+1), albumArtist, dir/onSaved).
    - Max 3 resolve grants outstanding: 10 songs whose mock holds the resolve slot → exactly 3 granted after a flush; releasing one grants the 4th.
    - Max 8 transfer grants outstanding: 10 songs with instant resolve and a held transfer → exactly 8 granted; releasing one grants the 9th.
    - Slow resolve does not block: song 1's resolve never settles until the end; songs 2..7 go resolve→transfer→'saved' and `onProgress` reaches (6, 7) BEFORE song 1 settles; final result `{ saved: 7, total: 7 }`.
    - Album order: the existing "reverse completion still yields album-ordered zip entries and track numbers" test stays green as written.
    - The seenUids duplicate skip, held-single move/reuse, completion-counted progress, failure isolation, never-throw tests all stay green as written.
  </behavior>
  <action>
    RED first: replace the `describe('downloadAlbum — 3-wide pool …')` block's FIRST test ("runs at
    most 3 songs at once…" — wrong by design now, since every song enters the pipeline) with a
    `describe('downloadAlbum — two-stage pipeline (quick-260930-vjp)')` block. Extend the local
    `deferredImpl()` idea into a `stagedImpl()` whose `mocks.downloadTrack` implementation does
    `const free = await opts.stages.resolve()` (count granted, track max), parks on a per-song deferred
    `resolved`, calls `free()`, then `const freeT = await opts.stages.transfer()` (count granted, track
    max), parks on `transferred`, fires `opts.onSaved`, `freeT()`, resolves 'saved'. Write the four tests
    from `<behavior>` (max-3 resolve, max-8 transfer, slow-resolve-no-block, and the `stages` opts
    assertion via `toMatchObject({ stages: { resolve: expect.any(Function), transfer: expect.any(Function) } })`).
    Keep the "reverse completion" and "progress counts completions" tests in place (they still use
    `deferredImpl`, which ignores stages — that is fine, stages are opt-in to the mock). Run
    `pnpm test -- download-album.test.ts` → the new block fails. Commit
    `test(quick-260930-vjp): 3-resolve / 8-transfer pipeline, slow resolve does not block`.

    GREEN in download-album.ts: replace `const POOL = 3` with `const RESOLVE_POOL = 3` and
    `const TRANSFER_POOL = 8`, and add a local `function gate(n: number): StageGate` (counter + FIFO
    queue of grant fns; acquire resolves with a release that decrements and shifts the next grant —
    ~10 lines, no new file, no new dependency; import `StageGate` as a type from download-track).
    Replace the `worker`/`next` pool with
    `await Promise.all(tracks.map((tr, i) => one(i, tr).then(() => { done++; try { onProgress?.(done, total) } catch {} })))`
    — `tracks.map` invokes `one` synchronously in index order, so the `seenUids` claim order is
    unchanged (first occurrence wins). Pass `stages` (one `gate(RESOLVE_POOL)` + one
    `gate(TRANSFER_POOL)` created per `downloadAlbum` call) into the `downloadTrack` opts; keep
    `trackNumber: String(i + 1)` literally (the import-contract test greps for it). Update the header
    comment: the uia pool paragraph and the `ponytail: POOL=3` note become a quick-260930-vjp note —
    stage 1 shares the apiFetch governor (MAX_CONCURRENT_REQUESTS=8) with playback, so 3 leaves
    headroom; stage 2 is raw CDN fetches outside the governor, and 8 is the ceiling with
    `ponytail: 8 lossless bodies can sit in heap at once (~400 MB worst case); lower TRANSFER_POOL or stream to IndexedDB if that bites`.
    Also note (one line) that rows now show the busy ring from the moment the album starts — queued
    is busy; the progress fraction appears once bytes flow (`setDownloadProgress`) — which satisfies
    "ring shows during resolve" without a second begin/end bracket. Held-single move/reuse,
    `slots[i]` index assembly, `uniqueName`, zip build, `saved = 0` on zip failure are untouched.
    Commit `feat(quick-260930-vjp): album download pipelines 3-wide resolve into 8-wide transfer`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm test -- download-album.test.ts download-track.test.ts && pnpm check 2>&1 | tail -3</automated>
  </verify>
  <done>Both test files green (import-contract test included), `pnpm check` 0 errors, `grep -v '^\s*//' src/lib/services/download-album.ts | grep -c 'TRANSFER_POOL'` ≥ 2, no `fetchVariants|probeDownload` import in download-album.ts.</done>
</task>

<task type="auto">
  <name>Task 3: Full suite + headless-Chrome E2E (wall time vs 155 s, playback stays responsive)</name>
  <files>src/lib/services/download-album.ts</files>
  <action>
    Run `pnpm test` (full suite must pass) and `pnpm check`.

    E2E on the running dev server at http://localhost:5173 (probe it; if down, start `pnpm dev` in the
    background and note the port). Copy the previous script
    `/private/tmp/claude-501/-Users-laichan-code-tung-openmusic/b3813084-0071-47c0-b3df-530ff9268cf2/scratchpad/uia-e2e.mjs`
    to `<scratchpad>/vjp-e2e.mjs` (fresh profile + download dirs named `vjp-*`) and adapt it:
    1. Same page URL (`/album/rice%20%26%20shine?artist=陳奕迅&mbid=03fac712-87f5-4a57-a083-e9c40382964a`),
       same 400x860 mobile emulation, same toast sampler, click `button.act[aria-label="Download"]`,
       record wall clock from click to the `Saved N of M` toast. Report it next to the previous 155.0 s.
    2. Concurrency evidence from CDP Network events: pair `Network.requestWillBeSent` with
       `loadingFinished`/`loadingFailed` per requestId and track in-flight counts in two buckets —
       `/api/` requests (expect ≤ 8, the governor) and non-localhost audio bodies (CDN hosts; expect ≤ 8,
       the transfer pool). Print the max of each. The `.dc.busy` row count will now be ~10 from the
       start (queued = busy) — print its histogram but do not assert 3.
    3. Playback-responsiveness probe: when the first `Downloading 1 of` toast appears (stage 2 has
       begun), tap a different song's row (inspect the DOM for the row's primary tap target inside
       `li.row-line:nth-child(8)`; the previous run's selectors are in the old script) and poll
       `(() => { const a = document.querySelector('audio'); return a && !a.paused && a.currentTime > 0.5 })()`
       every 100 ms. Report time-to-playing in seconds. If it is not playing within 30 s, record that
       as a FAIL in the summary with the observed audio state.
    4. Keep the previous checks: exactly one `陳奕迅 - rice & shine.zip` with 10 non-empty entries in
       page-row order and no `(2)` names; 0 requests to `/api/ytmusic/stream` or `googlevideo`.
    Record all numbers in the SUMMARY. If the E2E exposes a real defect (e.g. transfer gate leaked →
    download stalls, or playback never starts), fix it in download-album.ts / download-track.ts with a
    regression test and re-run. Do NOT push.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm test 2>&1 | tail -4 && ls /private/tmp/claude-501/-Users-laichan-code-tung-openmusic/b3813084-0071-47c0-b3df-530ff9268cf2/scratchpad/vjp-dl/*.zip</automated>
  </verify>
  <done>Full suite green; E2E script saved in the scratchpad; SUMMARY reports wall time (vs 155.0 s), max in-flight `/api/` and audio-body counts, time-to-playing for the mid-download song, zip entry order/count, 0 ytmusic stream requests; nothing pushed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → CDN audio hosts | raw `fetch(r.audioUrl)` bodies, now up to 8 at once |
| client → /api/* (governor) | resolve calls share MAX_CONCURRENT_REQUESTS=8 with playback |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-vjp-01 | DoS (self) | download-album TRANSFER_POOL=8 | mitigate | RESOLVE_POOL=3 keeps ≥5 governor slots for playback (E2E time-to-playing probe); transfer fetches are outside the governor by design; heap ceiling noted in a `ponytail:` comment |
| T-vjp-02 | DoS (stall) | stage gates in download-track | mitigate | release in `finally`, resolve slot released before transfer is requested (no hold-and-wait); tests assert acquire==release on the failed path |
| T-vjp-03 | Tampering | ytmusic donor path | accept | unchanged: `canDownloadFrom` refusal still runs before any gate; E2E re-asserts 0 ytmusic stream requests |
| T-vjp-SC | Tampering | npm installs | accept | no new dependencies in this plan |
</threat_model>

<verification>
- `pnpm test -- download-track.test.ts download-album.test.ts` green, including the import-contract grep tests.
- `pnpm test` full suite green; `pnpm check` 0 errors.
- E2E: album saves 10/10 in order, wall time reported vs 155 s, max in-flight audio bodies ≤ 8, `/api/` ≤ 8, another song starts playing mid-download.
</verification>

<success_criteria>
- `downloadTrack` without `stages` is byte-for-byte the same behaviour (all existing tests untouched and green).
- Album download: ≤3 in resolve, ≤8 in transfer, slow resolve does not block others, album order kept, all uia guarantees intact.
- E2E numbers recorded; nothing pushed.
</success_criteria>

<output>
Create `.planning/quick/260930-vjp-album-download-two-stage-pipeline-resolv/260930-vjp-SUMMARY.md` when done
</output>
