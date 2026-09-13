---
id: 260913-omi
mode: quick
status: complete
date: 2026-09-13
---

# Quick 260913-omi — real progress on the Download row

The menu's Download row showed an indeterminate spinner for the whole transfer. A lossless track is
tens of MB over a CN CDN, so the user could not tell a slow download from a stuck one.

`downloadTrack` already fetched the audio itself and called `await resp.blob()`, which reads the
whole stream internally and reports nothing. Reading the body through a reader gives real progress
as a side effect of the pass we were already making — no polling, no estimation, no second request.

## What changed

**`download-progress.ts` (new)** — `readBlobWithProgress(resp, onProgress)`. Reads the body to a
Blob, calling back with a 0..1 fraction. Extracted rather than inlined so it is node-testable under
the single Vitest project (the house pure-function convention, same shape as download-filename /
download-save).

Key decisions:
- **Never invents progress.** No `Content-Length`, a zero/unparseable one, or no readable body →
  falls back to `resp.blob()` and calls back zero times. That is the indeterminate path and it stays
  byte-identical to the old behaviour, so the row keeps its spinner. A fake creeping bar would be
  worse than none: it would claim movement about a transfer that may be stalled.
- **One callback per whole percent** — a 40MB file emits ≤101 calls instead of one per chunk, which
  is what makes the store's copy-on-write reassign free.
- Clamps at 1 (an under-reported `Content-Length` must not render 137%) without truncating bytes,
  and preserves the response content type.

**`library.svelte.ts`** — `downloadProgress: Record<uid, number>` alongside `downloading`, same
posture: transient, never in `LibShape`, never persisted. Kept a SEPARATE map rather than a richer
`downloading` value because an absent entry means *indeterminate*, a real state the UI renders
differently — folding it in would force every existing `downloading.has(uid)` reader to care.
`beginDownload` drops residue from a previous attempt (a retry must not resume a failed run's bar);
`endDownload` clears it, and it already runs in `downloadTrack`'s `finally`, so every exit path —
saved, no-audio, failed, throw — leaves nothing behind. `setDownloadProgress` ignores a uid that is
not in flight, so a late callback cannot resurrect a bar on a finished row.

**`download-track.ts`** — one line: `resp.blob()` → `readBlobWithProgress(resp, …)`. D-17
never-throws and D-18 download-isolation untouched.

**`TrackMenu.svelte`** — the busy branch reads `library.downloadProgress[uid]`. Undefined → today's
spinner. A number → static Download icon, a left-to-right tint fill (`::after`, 18% primary — light
enough that the label stays legible with no stacking-context work), and a right-aligned percentage
reusing the existing `.count` idiom with `tabular-nums` so the digits do not jitter the row's right
edge as they climb. `aria-label` announces the percentage so the state is not colour-only. The
width transition is deliberately un-tagged so `app.css`'s reduce-motion rule kills it. Disabled
opacity is overridden to 1 on this variant — the row is disabled only because it is busy, and the
bar is hard to read at 0.4.

No new i18n keys (label stays "Download", the percentage is a number).

## Files

- `src/lib/services/download-progress.ts` (new)
- `src/lib/services/download-progress.test.ts` (new, 9 cases)
- `src/lib/stores/library.svelte.ts`
- `src/lib/services/download-track.ts`
- `src/lib/components/TrackMenu.svelte`

## Verification

`pnpm check` clean (4439 files, 0 errors). `pnpm test` 2105/2105 (up from 2096).

Verified against the running dev server with a real 24.6MB download from the qq CDN, sampling the
row every 200ms:

| t (ms) | row | `--dl` | fill width |
|---|---|---|---|
| 0–1000 | `Download` + spinner | 0 | — (indeterminate: resolve/connect) |
| 1200 | `Download 2%` | 0.0203 | 11px |
| 2400 | `Download 43%` | 0.4324 | 260px |
| 3600 | `Download 72%` | 0.7211 | 477px |
| 4400 | `Download 96%` | 0.9601 | 632px |
| 4600 | `Downloaded` | — | — |

The fill trails `--dl` slightly, which is the 120ms transition doing its job. Blob landed at
24,607,567 bytes and the header flipped to the blob-backed Check.

## Observation (pre-existing, not introduced here)

The stored blob's type came back as `application/x-www-form-urlencoded` — that is the qq CDN's
`Content-Type` on the audio response. `resp.blob()` took its type from the same header, so this is
unchanged behaviour, but it means the saved file carries a wrong MIME type. Worth a separate look.

## Commit

`2b164ca`
