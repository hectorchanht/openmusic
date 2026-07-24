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
const AUDIO_EXT = /\.(mp3|flac|m4a|aac|ogg|wav)$/i;

/**
 * D-06: derive the container extension from a resolved audio URL. The `?query` is stripped first
 * (CDN URLs carry auth tokens after the real filename), then the $-anchored, case-insensitive
 * match returns the lowercased extension WITHOUT the dot. Unknown or null → 'mp3' (the existing
 * default) so a filename is always buildable.
 */
export function extFromAudioUrl(audioUrl: string | null): string {
	return (audioUrl?.split('?')[0].match(AUDIO_EXT)?.[1] ?? 'mp3').toLowerCase();
}

/**
 * D-05/D-08: compose `${artist} - ${title}.${ext}` then strip filesystem-unsafe chars. `artist`
 * and `title` MUST already be run through `names.dn*` by the caller (D-05/D-07 raw fallback) — this
 * helper never translates. The sanitize char class `/[/\\?%*:|"<>]/g` is copied VERBATIM from
 * TrackMenu.svelte:204 (do not invent a new class): stripping path separators + reserved chars
 * blocks `../` traversal and MediaStore RELATIVE_PATH escape (T-29-01-01) — no `/` or `\` survives.
 */
export function buildDownloadFilename(artist: string, title: string, ext: string): string {
	return `${artist} - ${title}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_');
}
