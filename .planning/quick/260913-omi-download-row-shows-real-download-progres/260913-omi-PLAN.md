---
id: 260913-omi
mode: quick
status: planned
date: 2026-09-13
must_haves:
  truths:
    - The menu's Download row shows real byte progress while a download runs, not just an indeterminate spinner.
    - Progress comes from actual streamed bytes against Content-Length — never a fake animation.
    - A response with no Content-Length (or no readable body) falls back to today's spinner rather than a stalled 0%.
    - Progress state is transient and per-uid; it never persists and never wedges a row.
  artifacts:
    - src/lib/services/download-progress.ts
    - src/lib/services/download-progress.test.ts
    - src/lib/stores/library.svelte.ts
    - src/lib/services/download-track.ts
    - src/lib/components/TrackMenu.svelte
  key_links:
    - src/lib/services/download-track.ts (the `await resp.blob()` that currently swallows the stream)
    - src/lib/stores/library.svelte.ts:39 (downloading — the transient per-uid busy set, D-10/DL-STATE-01)
    - src/lib/components/TrackMenu.svelte:455 (the Download row's busy branch)
---

# Quick 260913-omi — real progress on the Download row

Today the row shows an indeterminate spinner for the whole download. A lossless track is tens of
MB over a CN CDN, so "something is happening" is not enough feedback — the user cannot tell a slow
download from a stuck one.

`downloadTrack` already fetches the audio itself (`const blob = await resp.blob()`), so the bytes
are right there; `resp.blob()` just throws the stream away. Reading the body through a reader gives
real progress for free — no polling, no estimation, no second request.

## Design

**Where progress lives.** A new `library.downloadProgress` record, mirroring `library.downloading`
exactly: transient, per-uid, never persisted, cleared by `endDownload`. Absent uid = indeterminate.

**How the row looks.** The row stays a normal `.mi` and grows two things while downloading:

- a left-to-right tint fill behind the row content (18% primary, an `::after` at low opacity so the
  label stays legible without any stacking-context work), and
- a right-aligned percentage reusing the existing `.count` idiom, with tabular numerals so the
  digits do not jitter as they climb.

The icon swaps from the spinner to a static `Download` glyph once a real percentage exists — the
spinner's job is to say "indeterminate", and the bar has taken that over. No new i18n keys: the
label stays "Download" and the percentage is a number.

Reduced motion needs no special handling — `app.css` already kills transitions app-wide under
`:root[data-reduce-motion]`, and this fill is a plain `width` transition (not `.motion-always`).

**The header icon keeps its spinner.** A 44px icon button has no room for a bar, and the row
carries the detail. Out of scope here.

## Tasks

### T1 — `readBlobWithProgress`

**files:** `src/lib/services/download-progress.ts` (new), `src/lib/services/download-progress.test.ts` (new)

**action:** A single exported helper that turns a `Response` into a `Blob` while reporting fraction
complete. Extracted rather than inlined so it is node-testable under the single Vitest project (the
house "pure functions are extracted and exported for testability" convention).

- `total` from the `Content-Length` header. It is CORS-safelisted, so it survives the cross-origin
  CDN fetch.
- No `total`, or no readable `body`, or no `getReader` → `resp.blob()` unchanged. That is the
  indeterminate path, and it must stay byte-identical to today's behaviour.
- Otherwise read chunks, accumulate, and call `onProgress(received / total)` — but only when the
  whole percent CHANGES, so a 40MB file emits ≤100 callbacks instead of one per chunk. That cap is
  what makes the store's copy-on-write reassign free.
- Clamp to 1: a server that under-reports `Content-Length` must not produce 137%.
- Preserve the response's `Content-Type` on the assembled Blob.

**verify:** `pnpm test` — no-content-length falls back, progress sequence is monotonic and
de-duplicated per percent, final blob bytes and type match, over-long body clamps at 1.

**done:** The helper exists, never invents progress, and degrades to `resp.blob()`.

### T2 — per-uid progress in the library store

**files:** `src/lib/stores/library.svelte.ts`

**action:** `downloadProgress = $state<Record<string, number>>({})` next to `downloading`, with the
same posture: transient, never in `LibShape`, never persisted. `beginDownload` clears any stale
entry for the uid (a previous failed attempt must not seed the next one); `endDownload` deletes it
so every exit path — saved, no-audio, failed, throw — leaves no residue. Add
`setDownloadProgress(uid, frac)` which reassigns a new record (the `downloading` Set-reassign idiom).

**verify:** existing library tests stay green; progress is gone after `endDownload`.

**done:** A uid's progress exists only while that uid is genuinely mid-download.

### T3 — stream the download

**files:** `src/lib/services/download-track.ts`

**action:** Replace `const blob = await resp.blob()` with `readBlobWithProgress(resp, frac =>
library.setDownloadProgress(track.uid, frac))`. Nothing else moves: `beginDownload`/`endDownload`
still bracket the whole operation in the existing `finally`, so a mid-stream throw still clears both
the busy flag and the progress. D-17 never-throws and D-18 download-isolation are untouched.

**verify:** `pnpm test` (download-track suite green).

**done:** One fetch, one pass over the bytes, progress as a side effect.

### T4 — render it

**files:** `src/lib/components/TrackMenu.svelte`

**action:** In the Download row's busy branch, read `library.downloadProgress[track.uid]`. When it
is a number: static `Download` icon, `--dl` custom property on the button, `.dl-progress` class, and
a right-aligned `{pct}%` in a `.count`. When it is undefined: today's spinner, unchanged. Announce
the percentage via `aria-label` so the state is not colour-only, and keep `aria-busy`.

**verify:** in the running dev server, tap Download on an undownloaded track and watch the fill and
the percentage advance to 100 before the row flips to Downloaded.

**done:** The row reports real progress.

## Out of scope

- The header icon button and `DownloadControl.svelte` (other surfaces) keep their spinners.
- Cancelling an in-flight download. Worth doing, but it is a different change (an AbortController
  threaded through `downloadTrack`), not a rendering one.
- Album/bulk download progress.
