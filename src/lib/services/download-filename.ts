// download-filename.ts — PURE, node-testable download-filename helpers (DL-FILE-01, D-08).
//
// This consolidates the `{artist} - {title}.${ext}` shape + sanitize that had DRIFTED across two
// call sites (TrackMenu.svelte:203-204 and album/[name]/+page.svelte:392-395) into ONE source of
// truth so the format can never diverge again. Every save site (TrackMenu, album, native
// blob-store, migration) imports these.
//
// PURITY CONTRACT (RESEARCH anti-pattern): this module MUST NOT import `$lib/stores/names` or any
// runes store — the caller runs artist/title through `names.dnArtist`/`names.dnTitle` (D-05) with
// raw fallback (D-07, synchronous) and passes the ALREADY-translated strings in. Keeping the
// helper store-free is what lets it live in the single Vitest node project (no jsdom, no runes).

// D-06: audio container extensions we recognize on a resolved audioUrl. Case-insensitive, matched
// at end-of-string after the query string is stripped. Copied verbatim from the inline regex the
// two call sites used so behavior is identical.
// 34-D-12: exported as a tuple so device-filename.ts's extension chips and this module's export path
// can never disagree about what "audio" means.
export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav'] as const;
const AUDIO_EXT = new RegExp(`\\.(${AUDIO_EXTENSIONS.join('|')})$`, 'i');

/**
 * D-06: derive the container extension from a resolved audio URL. The `?query` is stripped first
 * (CDN URLs carry auth tokens after the real filename), then the $-anchored, case-insensitive
 * match returns the lowercased extension WITHOUT the dot. Unknown or null → 'mp3' (the existing
 * default) so a filename is always buildable.
 */
export function extFromAudioUrl(audioUrl: string | null): string {
	return (audioUrl?.split('?')[0].match(AUDIO_EXT)?.[1] ?? 'mp3').toLowerCase();
}

// quick-260913-tmi: ext → audio MIME. Covers exactly the AUDIO_EXT set above, so the two vocabularies
// cannot drift. m4a/aac in an MP4 container are `audio/mp4`; a bare ADTS `.aac` is `audio/aac`.
const AUDIO_MIME: Record<string, string> = {
	mp3: 'audio/mpeg',
	flac: 'audio/flac',
	m4a: 'audio/mp4',
	aac: 'audio/aac',
	ogg: 'audio/ogg',
	wav: 'audio/wav'
};

/**
 * quick-260913-tmi: the MIME type a downloaded blob should carry, given the resolved audio URL and
 * whatever the response's `Content-Type` header claimed.
 *
 * WHY THIS EXISTS. The qq CDN serves audio as `application/x-www-form-urlencoded`. `resp.blob()`
 * takes its type straight from that header, so a 24MB m4a was being persisted to IndexedDB and
 * handed to `<a download>` labelled as a form body. Playback survived only because browsers sniff
 * the bytes; that is luck, not a contract, and the saved file carries the wrong type to whatever
 * opens it next.
 *
 * POLICY: trust the header ONLY when it already looks like audio — a correct `audio/mpeg` on an
 * `.mp3` agrees with the derived value anyway, so deferring to it costs nothing and keeps a CDN
 * that knows better (a subtype we do not model) authoritative. Otherwise derive from the URL's
 * container extension, which is what the filename and the OS will go by. Unknown extension falls
 * back through `extFromAudioUrl`'s 'mp3' default, so this always returns a real audio type.
 *
 * Pure and store-free, like the rest of this module.
 */
export function audioMimeForUrl(audioUrl: string | null, headerType?: string | null): string {
	const claimed = (headerType ?? '').split(';')[0].trim().toLowerCase();
	if (claimed.startsWith('audio/')) return claimed;
	return AUDIO_MIME[extFromAudioUrl(audioUrl)] ?? 'audio/mpeg';
}

/**
 * THE ONE SANITIZER (quick-260919-30x, T-30x-01). The char class `/[/\\?%*:|"<>]/g` is the VERBATIM
 * one this module has always used (originally TrackMenu.svelte:204 — do not invent a new class):
 * stripping path separators + reserved chars blocks `../` traversal and MediaStore RELATIVE_PATH
 * escape (T-29-01-01), so no `/` or `\` survives.
 *
 * Extracted from `buildDownloadFilename` because the metadata editor now lets a user TYPE a
 * filename, and that string reaches a MediaStore `saveToMusic({ fileName })`. Both paths go through
 * here, so there is still exactly ONE of these — a second copy is how a security control drifts.
 * Total over null/undefined.
 */
export function sanitizeFilename(name: string): string {
	return String(name ?? '').replace(/[/\\?%*:|"<>]/g, '_');
}

/**
 * quick-260919-30x: the cap on a USER-TYPED base name, applied before the extension is appended.
 * Android's filename limit is 255 BYTES, and a CJK name is 3 bytes per character — 120 characters
 * is comfortably inside it with room left for `.flac`.
 */
export const MAX_FILENAME_BASE = 120;

/**
 * D-05/D-08: compose `${artist} - ${title}.${ext}` then strip filesystem-unsafe chars. `artist`
 * and `title` MUST already be run through `names.dn*` by the caller (D-05/D-07 raw fallback) — this
 * helper never translates. Sanitizing is delegated to `sanitizeFilename` above; the output is
 * byte-identical to what this function has always produced.
 */
export function buildDownloadFilename(artist: string, title: string, ext: string): string {
	return sanitizeFilename(`${artist} - ${title}.${ext}`);
}
