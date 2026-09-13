---
id: 260913-jq4
mode: quick
status: complete
date: 2026-09-13
---

# Quick 260913-jq4 — make the download button tell the truth

Two reported symptoms on the long-press menu's download button, two different root causes.

## A. First tap toasted "no audio available" instead of showing a spinner

**Root cause:** `gated('download', doDownload)` pre-resolved the stub and vetoed on
`!resolved.audioUrl` with `toast.noAudio` **before `doDownload` ever ran**. That veto resolved at
the *streaming* default, while `downloadTrack` forces its own fresh resolve at
`settings.downloadQuality` — so it could reject a download that would have succeeded, and it
surfaced as an instant error toast on the first tap.

**Fix:** Download no longer routes through `gated()`. `downloadTrack` is the authority: it brackets
`library.beginDownload`/`endDownload` synchronously before its first await (so the spinner shows on
the same tick and spans the real operation), never throws, and returns `'no-audio'` itself when
there genuinely is none. `gated()` still governs Remix and Detail, which do need a resolved
`audioUrl` in hand.

Side effect: one resolve per download instead of two.

## B. "Downloaded" showed even when nothing was saved

**Root cause:** `library.isDownloaded(uid)` is membership in the downloads *reference list*, and
`library.addDownload` deliberately runs **before** the fetch (DL-BUG-01 — a failed download still
leaves the song re-streamable). The web save is an `<a download>` click, which reports success even
when the user cancels the browser's save dialog; the platform exposes no cancel signal. So the list
could say "Downloaded" with nothing stored anywhere.

**Fix:** the Check state now reads the **offline copy**, which is what actually makes an offline
play work and is the one artifact the app can verify. New `blobStore.has(uid)`: IDB `getKey` on web
(existence without materializing a multi-MB blob), `Filesystem.stat` + the same 31-D-13
`MIN_BLOB_BYTES` floor on native, `false` on any error/SSR. TrackMenu probes it on menu open (guarded
against a stale probe landing on a newer track) and re-probes after a download resolves.

The downloads list keeps its own meaning ("the user asked for this offline") and is untouched.
Migrating the other surfaces that render download state to the blob probe is a separate change.

## Files

- `src/lib/services/blob-store.ts` — new `has(uid)` + `nativeHas`, exported through the namespace.
- `src/lib/services/blob-store.test.ts` — 9 new cases (web hit/miss/empty-uid, native
  hit/too-small/at-floor/throw/no-size/never-reads-bytes, fake-IDB present+absent).
- `src/lib/components/TrackMenu.svelte` — `startDownload()` replaces the gated call at both
  download surfaces; `blobPresent` drives the Check state on both.

## Verification

`pnpm check` clean (4437 files, 0 errors). `pnpm test` 2096/2096 (up from 2087).

Verified against the running dev server, not just unit tests:

- **A** — tapped Download on an unresolved stub, sampled the header every 250ms: `Preparing…` from
  t=0 through the whole ~5s operation, then `Downloaded`. No premature "no audio available".
- **B** — after a real download the header and the list row both read `Downloaded`. Cleared the
  IndexedDB blob store while leaving the downloads list intact (the cancelled-save shape) and
  reopened the menu: uid still in `library.downloads`, blob absent, and both surfaces correctly
  offered `Download` again instead of a greyed Check.

## Commit

`a0bd9c6`
