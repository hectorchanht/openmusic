// Lyrics-translation publication seam (Svelte 5 runes singleton, quick-261116-lyrux Fix 2).
//
// WHY IT EXISTS. The API-generated lyric translation is computed inside NpLyrics (the
// Now Playing lyrics pane) and used to live ONLY there — the Nowbar, which shows the
// active line in the docked mini-player, had no way to honour "replace" for GENERATED
// translations (it only ever saw translations embedded in the LRC file itself). This
// store is the one-way bridge: NpLyrics PUBLISHES its progressive translation state as
// it changes; the Nowbar READS it. Neither component imports the other.
//
// LEAF DISCIPLINE: this store imports NOTHING (no player, no settings, no services) —
// both publishers and readers import IT, never the reverse, so no cycle is possible.
// The published arrays are the pane's own snapshots: NpLyrics always REASSIGNS its
// `translated` / pending arrays (never mutates them), so a published reference is a
// stable point-in-time view until the next publish replaces it wholesale.
//
// `lines` are the POST-LOCK lines (the pane's `trLines`, after lockLyricLines) — the
// exact strings the pane renders — so the bar and the pane can never disagree about
// what a replaced line says. `pending[i]` is true while line i's chunk is still in
// flight: its slot holds the ORIGINAL as a placeholder, which is not a translation
// and must never be served as one (see publishedLineFor).

/** A point-in-time snapshot of one track's generated lyric translation. */
export interface PublishedTranslation {
	uid: string;
	/** The EFFECTIVE target language the lines were translated to (post-'auto'). */
	lang: string;
	/** Post-lock translated lines, aligned to the full parsed-lines array. */
	lines: readonly string[];
	/** Per-line in-flight flags, aligned to `lines` (see header). */
	pending: readonly boolean[];
}

class LyricsTranslation implements PublishedTranslation {
	uid = $state('');
	lang = $state('');
	lines = $state<string[]>([]);
	pending = $state<boolean[]>([]);

	/** Replace the whole snapshot (NpLyrics calls this on every progressive change). */
	publish(uid: string, lang: string, lines: readonly string[], pending: readonly boolean[]): void {
		this.uid = uid;
		this.lang = lang;
		this.lines = lines.slice();
		this.pending = pending.slice();
	}

	/** Drop the snapshot (translation turned off / nothing to publish). */
	clear(): void {
		this.uid = '';
		this.lang = '';
		this.lines = [];
		this.pending = [];
	}
}

export const lyricsTranslation = new LyricsTranslation();

/**
 * The reader decision, pure (unit-tested): the generated translation for the line at
 * FULL-array index `fullIdx`, or null when the original must show. Null unless the
 * snapshot is for THIS track and THIS effective target, the index is in range, and
 * the line has SETTLED — a pending slot holds the original as a placeholder, and
 * serving it as "the translation" would freeze the pre-translation text into the
 * replace-mode bar even after the real translation lands elsewhere.
 */
export function publishedLineFor(
	pub: PublishedTranslation,
	uid: string,
	lang: string,
	fullIdx: number
): string | null {
	if (!uid || pub.uid !== uid || pub.lang !== lang) return null;
	if (fullIdx < 0 || fullIdx >= pub.lines.length) return null;
	if (pub.pending[fullIdx]) return null;
	const v = pub.lines[fullIdx];
	return v === undefined ? null : v;
}
