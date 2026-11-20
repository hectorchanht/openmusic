// lyric-script — the Chinese script lock for LYRIC text (quick-260919-2jo, follow-up).
//
// 2jo put the lock at `names.resolve`, which covers every NAME (dnTitle / dnArtist / dnLastfm /
// dnBio and their ~26 call sites: rows, now-playing meta, the OS media-session card, the document
// title, the download filename). Lyrics never touch that seam — LRC text is its own pipeline
// (`readLyrics` → `parseLRC` → the pane / the Nowbar line), so the lock did not reach it and a
// Simplified-locked user kept reading Traditional lyrics. This file is that seam.
//
// WHY HERE, and not at each display site (the argument that made `names.resolve` the right place):
//   - `parseLRC`'s OUTPUT is the single thing every lyric renderer consumes — NowPlaying's pane,
//     the Nowbar's one-liner, and TrackMenu's Fix-lyrics candidate preview are its only three
//     display callers. One wrapper covers all three with no per-line call in any template.
//   - `readLyrics` (one rung earlier) would have been the tighter choke point, but it is NOT
//     display-only: TrackMenu feeds it to the retag writer and the metadata editor. Locking there
//     would convert the LRC that gets written into the user's DOWNLOADED FILE and into an editable
//     field — a persistent mutation, not a display choice. Parse-time is the last read-only rung.
//   - `parseLRC` itself stays a pure `.ts` (node-testable, no runes, no store imports). This file
//     is the `.svelte.ts` wrapper — the same "wrap, don't rewrite" split as
//     cover-cache.ts / cover-version.svelte.ts.
//
// REACTIVITY ("instantly", the other half of the requirement): the conversion goes through
// `names.zhLock`, so it inherits BOTH of the store's reactive dependencies — `settings.zhScript`
// (flipping the setting invalidates the caller's `$derived` and repaints the lyrics already on
// screen, mid-song, with no reload and no track change) and `names.rev` (the `warmLock` latch
// bumps it when a cold tongwen dict finishes loading, so the first cold render repaints converted
// instead of sitting in the source script). Reusing `zhLock` is also what keeps this to ONE
// converter and ONE setting read for the whole app.
//
// COST: every caller invokes this inside a `$derived`, so Svelte's own memoisation is the memo —
// the whole LRC is converted ONCE per invalidation (track change / pin write / lock flip / a rev
// bump), never per line per timeupdate tick. The per-tick work is unchanged: `activeLineAt` scans
// an already-converted array.

import { parseLRC, type LyricLine } from '$lib/services/lrc';
import { names } from '$lib/stores/names.svelte';

/**
 * Parse LRC text into display lines with the Chinese script lock applied — the drop-in replacement
 * for `parseLRC` at every LYRIC DISPLAY site.
 *
 * Per-LINE conversion (not one pass over the whole LRC blob) because `lockScriptSync`'s
 * `isChineseLine` gate is per line: a blob-level test would let one kana-bearing line veto the
 * whole song, or one Chinese line drag a Japanese song along with it. Same granularity as names.
 * Inherits 2jo's known ceiling unchanged — a zero-kana Japanese line classifies as Chinese and is
 * converted — and applies it to no wider a unit than a single lyric line.
 *
 * Unchanged lines are returned by IDENTITY (the original object, not a copy), so `fromParen` and
 * every other field survive and a lock-off pass allocates nothing new per line.
 */
export function parseLyrics(txt: string | null | undefined): LyricLine[] {
	return parseLRC(txt ?? '').map((l) => {
		const text = names.zhLock(l.text);
		return text === l.text ? l : { ...l, text };
	});
}

/**
 * The same lock for the lyrics TRANSLATION column (NowPlaying's `translated[]`, the /api/translate
 * output rendered under — or in `replace` mode instead of — each original line).
 *
 * It needs its own call because the translation is a SECOND source of source-derived text: it is
 * produced after parse time and the pane's translate cache is keyed by `uid:lang:n:skip`, so a lock
 * flip does not (and should not) re-run the round-trip. Locking the rendered array instead repaints
 * it instantly and for free.
 *
 * Ordering matches 2jo's D-6 exactly: translate FIRST, then lock — a user who sets lyricsLang to
 * one script and the lock to the other authored that contradiction, and the lock gets the last word.
 * Positionally aligned (out.length === lines.length) so the caller's `translated[i]` index
 * alignment and its `translated.length === lines.length` render gate are untouched.
 */
export function lockLyricLines(lines: readonly string[]): string[] {
	return lines.map((s) => names.zhLock(s));
}
