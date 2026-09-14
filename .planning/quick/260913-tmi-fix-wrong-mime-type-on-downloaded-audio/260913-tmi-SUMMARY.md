---
id: 260913-tmi
mode: quick
status: complete
date: 2026-09-13
---

# Quick 260913-tmi — stop trusting the CDN's Content-Type on downloaded audio

Follow-up to the observation logged at the end of quick-260913-omi.

## The bug

The qq CDN serves audio with `Content-Type: application/x-www-form-urlencoded`. `resp.blob()` takes
its type straight from that header, so a 24MB track was persisted to IndexedDB and handed to
`<a download>` labelled as a form body. Playback survived only because browsers sniff the bytes —
that is luck, not a contract, and the saved file carried the wrong type to whatever opened it next.

Pre-existing: `readBlobWithProgress` had deliberately preserved the same header for byte-identical
behaviour, so it inherited the problem rather than causing it.

## The fix

**`download-filename.ts`** — new pure `audioMimeForUrl(audioUrl, headerType)`. An `AUDIO_MIME` map
covering exactly the existing `AUDIO_EXT` set, so the two vocabularies cannot drift.

Policy: trust the header ONLY when it already looks like `audio/*`. A correct `audio/mpeg` on an
`.mp3` agrees with the derived value anyway, so deferring costs nothing and keeps a CDN that knows
better (a subtype we do not model) authoritative. Anything else — junk, `application/octet-stream`,
`video/mp4`, empty — derives from the URL's container extension, which is what the filename and the
OS go by. Unknown extension falls through `extFromAudioUrl`'s `'mp3'` default, so the result is
always a real audio type.

**`download-progress.ts`** — `readBlobWithProgress` takes an optional `type`. The streaming path
builds the Blob with it directly (free — that Blob was being constructed anyway), so the main path
never pays for a re-wrap of tens of MB. The indeterminate fallback re-wraps only when the type
actually differs.

**`download-track.ts`** — derives the type from the resolved URL and threads it in. One call site,
so the saved file, the offline copy and the filename extension all agree.

Native is unaffected: `nativePut` writes bytes plus a filename and MediaStore infers from the
extension — it never read `blob.type`.

## Files

- `src/lib/services/download-filename.ts` + `.test.ts` (6 new cases)
- `src/lib/services/download-progress.ts` + `.test.ts` (4 new cases)
- `src/lib/services/download-track.ts` + `.test.ts` (2 new cases; the happy-path test's blob
  IDENTITY assertion became a bytes/type/filename assertion, since the blob is now re-typed)

## Verification

`pnpm check` clean (4439 files, 0 errors). `pnpm test` 2117/2117 (up from 2105).

Live, on the same real qq download that exposed the bug: the stored blob came back
`type: "audio/flac"`, 24,607,567 bytes — previously `application/x-www-form-urlencoded`. (FLAC, not
m4a, because `downloadTrack` re-resolves at the lossless download tier rather than reusing the
streaming URL — so the derived type correctly follows the *download's* URL.) Decoded the stored blob
through an `<audio>` element to confirm the new type did not break playback: duration 209.72s.

## Commit

`a7d7c64`
