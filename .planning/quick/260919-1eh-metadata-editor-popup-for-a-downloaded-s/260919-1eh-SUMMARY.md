---
phase: quick-260919-1eh
plan: 01
subsystem: offline-library
tags: [metadata, tags, retag, offline, i18n, trackmenu]
requires:
  - "audio-tags.ts codec (Phase 36): tagAudioBlob / readAudioTags / albumTag"
  - "local-tags.ts session memo (Phase 37)"
  - "blob-store.ts put/get/has"
  - "device-track.ts isDeviceUid (Phase 34)"
provides:
  - "retagOne — the exported single-file tag-rewrite path (batch step + editor save)"
  - "library.applyMetadata — list-row repaint seam"
  - "player.adoptMetadata — hero / Nowbar / OS media-card repaint seam"
  - "MetadataEditor.svelte — the edit sheet"
  - "11 i18n keys across all 15 dictionaries"
affects:
  - "Settings -> Downloads batch retag (now refuses imported device: files)"
  - "TrackMenu long-press menu (new Edit metadata row)"
tech-stack:
  added: []
  patterns:
    - "one guard inside the shared function, covering both callers"
    - "VersionPicker sheet chrome + distinct overlayId (WR-02)"
    - "$effect whose only dependency is `open`, whole body untracked"
key-files:
  created:
    - src/lib/components/MetadataEditor.svelte
  modified:
    - src/lib/services/retag.ts
    - src/lib/services/retag.test.ts
    - src/lib/services/local-tags.ts
    - src/lib/services/local-tags.test.ts
    - src/lib/stores/library.svelte.ts
    - src/lib/stores/library.svelte.test.ts
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/components/TrackMenu.svelte
    - "src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts"
decisions:
  - "D-2 enforced inside retagOne, not at either call site — one guard closes the shipped Settings sweep and the new editor together"
  - "tags.* i18n keys placed directly under menu.editTags rather than after the whole menu.* block"
  - "the seeding $effect untracks its ENTIRE body, not just the track read"
metrics:
  duration: ~35 min
  tasks: 4
  commits: 7
  files: 25
  completed: 2026-09-19
---

# Quick 260919-1eh: Metadata Editor for a Downloaded Song — Summary

Long-press a song the app holds an offline copy of and an **Edit metadata** row opens a sheet that
writes the typed title/artist/album into the audio file's own tags, together with the cover and
lyrics the app is showing, then repaints every surface that displays the song.

## What shipped

| Task | What | Commits |
|---|---|---|
| 1 | `retagOne` exported + `lyrics` threaded + `device:` refusal + memo eviction | `ee9fe1c` (RED), `c4919bd` (GREEN) |
| 2 | `library.applyMetadata` + `player.adoptMetadata` | `407a357` (RED), `aab4997` (GREEN) |
| 3 | 11 i18n keys x 15 dictionaries | `9b8a78d` |
| 4 | `MetadataEditor.svelte` + the TrackMenu row | `42f6b8e`, `f1c6153` |

## The shipped `nativePut` bug the planner found — confirmed, and closed for both callers

**The planner's claim is real.** I traced the whole chain in the code rather than taking it on trust:

1. The device import calls `library.setDownloads(next)`, so imported rows live in
   `library.downloads` (`library.svelte.ts:320`; the comment there even names the import as the lane
   that drops into it).
2. The Settings -> Downloads page builds its `eligible` list by looping `library.downloads` and
   keeping anything `await blobStore.has(d.uid)` accepts
   (`routes/(app)/settings/downloads/+page.svelte:104-107`).
3. `nativeHas` **short-circuits a `device:` uid** to `probeContentUri(deviceContentUri(uid))`
   (`blob-store.ts:243`, 34-D-05) — so it answers **true** for an imported file. The device row
   therefore landed in `eligible` and was handed to `retagDownloads`.
4. `retagOne` then called `blobStore.get` (which for a device uid reads the **user's own file in
   place**, `blob-store.ts:218`) and `blobStore.put`.
5. **`nativePut` has no device short-circuit** (`blob-store.ts:113`). It would `write_blob` an
   app-private copy at `nativePath(uid)` — which `nativeGet` will **never read back**, because
   `nativeGet` short-circuits the same uid to the content URI — and then
   `MediaStoreSaver.saveToMusic` a **second public `Music/OpenMusic/` copy** of a song the user
   already owns.

Net effect of the shipped sweep on an imported file: a silent duplicate of the user's own music
under a different filename, plus an edit that never shows up anywhere the app reads. Worth stating
precisely — the user's **original file was not corrupted**: `get` reads it, the codec returns a new
blob, and `put` writes elsewhere. The harm is the duplicate and the invisible edit, not data loss.
(The 36-D-19 "delete the previous public URI first" step does run for a device uid, since
`setStoredUri` has no device guard, so repeated sweeps cap at one extra public copy rather than
accumulating one per run.)

**Does the guard close it for the existing sweep as well as the new editor? Yes.** The guard is the
**first statement of `retagOne`**, before the `try`, and `retagDownloads` calls `retagOne` unchanged
— so the batch sweep passes through exactly the same refusal the editor does. Two tests pin it, and
both were RED before the fix:

- `'a device: uid is refused BEFORE any blobStore call — no get, no put'` asserts `retagOne` returns
  `'device-skipped'` with `get`, `put` and `tagAudioBlob` all never called.
- `'the SHIPPED Settings sweep no longer touches an imported file: mixed list still adds up'` drives
  it **through `retagDownloads`** (not `retagOne`) over a mixed list and asserts
  `{ total: 3, tagged: 2, skipped: { 'device-skipped': 1 } }`, that the buckets still sum to the
  total, and that `put` was called for `netease-1` and `netease-3` only.

The Settings page needed no edit: it reports `tagged` vs `total - tagged`, so the new bucket lands in
its "skipped" count and the line it shows stays truthful.

The UI half (`{#if blobPresent && !isDevice}` on the menu row) is belt-and-braces only — the
enforcing half is in the service, which is why it also covers the sweep.

## The one honest gap

**On the web build, the copy in the user's own Downloads folder cannot be rewritten.** The save goes
through `blobStore.put`, which on web rewrites the IndexedDB record — that is the copy the app serves
offline, so in-app playback picks up the edit immediately. But the file the user saved to their
Downloads folder came from an `<a download>` click, and **no browser API can reach back into it**.
There is no handle, no path, no permission to ask for. That copy keeps its old tags until the user
re-downloads the song. This is not a shortcut I took — it is a platform ceiling, and the plan
(D-3) correctly told me not to attempt a workaround. On native both copies are rewritten (the
app-private one and, via 36-D-19's replacing save, the public `Music/OpenMusic/` one).

## Could not verify without a device / browser

Everything below is **unverified**, not "assumed working". No browser automation was available in
this environment and the human-check steps need a real downloaded file.

- **The entire UI flow.** I never opened the sheet. The row gating, the prefill, the Save button's
  in-flight state, the toast, and the live repaint of the library row / hero / Nowbar are verified
  only at the unit and typecheck level. `pnpm check` compiles `MetadataEditor.svelte` and the
  TrackMenu wiring with 0 errors, and `pnpm build` produces a clean Cloudflare bundle — that proves
  the component compiles and bundles, nothing about how it behaves on screen.
- **The actual tag write.** `retagOne`'s codec calls are mocked in the retag suite (the real codec
  has its own 29 tests). No wasm tag pass ran against a real downloaded file in this session.
- **Native behaviour (human-checks 6, 7, 8).** The phone's music app showing the song **once** with
  the new artist, the lock-screen media card after an edit, and the absence of the Edit row on an
  imported `device:` song all need an APK on a device. The device-refusal logic is unit-tested; its
  *native consequence* is not.
- **The memo-eviction payoff.** `forgetLocalEnrichment` is directly tested (it drops one uid,
  re-decodes on the next read, leaves a sibling's memo hit intact), but "play the edited song
  offline and see the new embedded art/LRC" was not exercised end to end.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The seeding `$effect` would have wiped the user's typing mid-edit**

- **Found during:** Task 4, reviewing my own component before committing.
- **Issue:** The plan specified an `$effect` depending on `open` that reads the track `untrack`ed.
  I wrote exactly that — but the *seed values* come from `names.dnTitle()` / `names.dnArtist()`, and
  those are not pure reads: they read the reactive name map plus four `settings` fields, and they
  **schedule a translation batch as a side effect**. So the effect's real dependency set included
  the name map, and a translation landing a moment later would re-run the effect and overwrite
  whatever the user had typed. The write-inside-a-tracked-effect shape is also the self-invalidation
  loop class this codebase has been bitten by before.
- **Fix:** wrapped the **entire** seed body in `untrack`, not just the `track` read, so the effect's
  only dependency really is `open`. Commented with both reasons.
- **Files modified:** `src/lib/components/MetadataEditor.svelte`
- **Commit:** `f1c6153`

### Deliberate choices, recorded not asked

**2. `tags.*` keys placed under `menu.editTags`, not after the whole `menu.*` block.** The plan asked
for the block "after the `menu.*` block". Locating the end of that block differs per dictionary (the
two zh files have a different layout and a ~22-line offset from the rest), and a per-file heuristic
across 15 files is the kind of thing that silently misplaces one. Grouping the sheet's whole key
family directly under the row that opens it is consistent in every dictionary and reads better.
Key-set parity — the thing the test actually enforces — is unaffected.

**3. `$lib/services/...` import paths for the two new imports in `retag.ts`,** as the plan specified,
even though the file's existing import block is all-relative. Both resolve identically; the test
mocks both spellings.

**4. Two test-file assertions updated rather than worked around.** `retag.test.ts`'s module-shape
test asserted `Object.keys(retagModule)` equals `['retagDownloads']` and `local-tags.test.ts`'s
asserted a two-element export list. Both had to grow by exactly the new export. The retag one is now
`.sort()`ed, because the namespace key order is declaration order and `retagOne` is declared first —
an ordering assertion there was testing nothing useful.

## Assumption Drift (advisory)

**`retagOne`'s verify-before-write step does not run when the title field is left blank.** The
plan's threat register (T-1eh-01) treats the read-back verify as unconditional protection for the
editor. It is conditional: `if (entry.title && back.title !== entry.title) return 'verify-failed'`,
so a user who blanks the title (meaning "keep the existing one", D-4) gets only the weaker
`if (!back) return 'verify-failed'` check — the bytes must still *parse*, but nothing confirms a
specific field round-tripped. This is pre-existing `retagOne` behaviour, not something I introduced
(the batch sweep always supplies a title, so it never hit this path), and the file is still never
replaced by unparseable bytes. Recorded because the threat model reads as if the stronger check
always applies. No gate, no change requested.

## Threat Flags

None. No new network endpoint, no new auth path, no new file-access pattern, no schema change. The
cover path reuses `resolveArtworkDataUrl` with its existing 6 s / 1 MB / https-only bounds; the one
genuinely new trust boundary (free-form user text reaching the codec and, on native, a MediaStore
filename) is handled by the unchanged `buildDownloadFilename` sanitiser, with no second filename
composer added — exactly as T-1eh-04 required.

## Verification

Observed results, not restatements of the plan's commands:

- `pnpm check` — `COMPLETED 4534 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.
- `pnpm test` — **129 test files, 2568 tests, all passing** (up from 2551; 17 new).
- `pnpm test -- i18n` — 46 passing, including the key-set parity check across all 15 locales.
- Per-dictionary key count: all 15 report exactly **11** on
  `grep -cE '^\s*"(tags\.|menu\.editTags|toast\.tags)'`.
- Double-quote convention: the only `'` anywhere in the new i18n values is the French apostrophe in
  `d'enregistrer`, inside a double-quoted value — matching the existing `fr.ts` style.
- `grep -v '^\s*//' src/lib/components/TrackMenu.svelte | grep -cE 'MetadataEditor|applyMetadata|adoptMetadata|blobPresent && !isDevice'` → **7**.
- `git diff --stat package.json pnpm-lock.yaml` → **empty**. No new dependency.
- `pnpm build` → `✔ done`, adapter-cloudflare, built in 5.78s.
- TDD gates: `test(...)` then `feat(...)` commits exist in order for Tasks 1 and 2. Task 1's RED run
  failed 11 tests; Task 2's RED run failed 10.
- **Not pushed.** All 7 commits are local on `main`.

## Self-Check: PASSED

- `src/lib/components/MetadataEditor.svelte` — FOUND
- Commits `ee9fe1c`, `c4919bd`, `407a357`, `aab4997`, `9b8a78d`, `42f6b8e`, `f1c6153` — all FOUND in
  `git log`.
