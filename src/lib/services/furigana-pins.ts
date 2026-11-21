// furigana-pins — the USER'S PINNED READING for one word in one song
// (quick-261120-furi, spec Addendum 6: WHY NOT ALL — variants are shown, the
// user pins, the pin teaches the system which reading this situation wants).
//
// Structurally the lyric-pins pattern (pure, node-testable, NEVER throws, its
// own key family): the engine offers EVERY plausible reading of a surface;
// this store is where the user's pick for (song, line, word) persists. The
// key is the song's UID (identity, D-1 of lyric-pins: never a name key), then
// the LINE TEXT and the word SURFACE — line text, not line index, so the pin
// survives an LRC re-fetch that re-times the same words, and a repeated
// chorus line (same text) shares the pin, which is the correct semantics:
// same line, same word, same song → same reading.

const PIN_KEY = 'openmusic:furigana-pins:v1';

/** uid → (lineKey → reading). lineKey = line text + NUL + surface. */
export type FuriganaPinRecord = Record<string, Record<string, string>>;

// The same shared-quota discipline as lyric-pins D-3: caps live at the WRITER.
// A reading pin is a few dozen bytes, so the caps are generous; they exist so
// this record can never grow unbounded inside the shared origin quota.
const MAX_SONGS = 200;
const MAX_PINS_PER_SONG = 400;

function lineKey(lineText: string, surface: string): string {
	return lineText + '\u0000' + surface;
}

/** Read the pin record; {} on absent / corrupt / unavailable storage (never throws). */
function readPins(): FuriganaPinRecord {
	try {
		const raw = localStorage.getItem(PIN_KEY);
		if (!raw) return {};
		const v: unknown = JSON.parse(raw);
		if (v && typeof v === 'object' && !Array.isArray(v)) return v as FuriganaPinRecord;
		return {};
	} catch {
		return {};
	}
}

/**
 * The user's pinned reading for `surface` in `lineText` of song `uid`, or null.
 * EMPTY-UID GUARD (mirrors getPinnedLyrics): a uid-less stub has no identity,
 * so it never reads a shared slot.
 */
export function getReadingPin(uid: string, lineText: string, surface: string): string | null {
	if (!uid) return null;
	const song = readPins()[uid];
	if (!song || typeof song !== 'object') return null;
	const v = song[lineKey(lineText, surface)];
	return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Pin `reading` for `surface` in `lineText` of song `uid`. No-op on an empty
 * uid / blank fields. Trims the record oldest-first at both caps before
 * writing. Swallows quota / unavailable storage.
 *
 * Callers use pinReading() in stores/furigana-pins.svelte.ts so the reactive
 * bump is never forgotten.
 */
export function setReadingPin(uid: string, lineText: string, surface: string, reading: string): void {
	if (!uid || !lineText || !surface || !reading) return;
	try {
		const rec = readPins();
		const song = rec[uid] && typeof rec[uid] === 'object' ? rec[uid] : {};
		song[lineKey(lineText, surface)] = reading;
		const skeys = Object.keys(song);
		for (let i = 0; skeys.length - i > MAX_PINS_PER_SONG; i++) delete song[skeys[i]];
		rec[uid] = song;
		const keys = Object.keys(rec);
		for (let i = 0; keys.length - i > MAX_SONGS; i++) delete rec[keys[i]];
		localStorage.setItem(PIN_KEY, JSON.stringify(rec));
	} catch {
		/* quota or unavailable — non-fatal, the pin simply does not persist */
	}
}
