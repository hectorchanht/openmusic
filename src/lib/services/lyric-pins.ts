// lyric-pins — the USER'S EXPLICIT LRC CHOICE, one entry per uid (quick-260919-1we, D-1/D-2/D-3).
//
// The lyric chain is first-source-wins and sometimes wins wrong (wrong song, wrong language, an
// instrumental's LRC). This is where the correction lives. Structurally a near-verbatim copy of the
// PIN_KEY block in cover-cache.ts: pure, node-testable, NEVER throws, a failed write simply does not
// persist.
//
// D-1 — its OWN key family, per UID. Not a name key: the menu already disables pin-style actions on a
// uid-less name stub, and a name-key pin would spill one song's choice onto every same-titled variant
// (the exact bug the cover cache's name layer is documented to cause when a pin enters it).
//
// D-2 — the stored value is the LRC TEXT, not a source id. Storing "the user picked kuwo" would make
// every replay depend on kuwo answering, and would silently show DIFFERENT lyrics when upstream
// drifts. The text is the choice; persist the choice.

const PIN_KEY = 'openmusic:lyric-pins:v1';

// D-3 / T-1we-01 — the two caps the cover pin store does not need, and the one way this feature could
// break something unrelated. localStorage is a SHARED origin quota, and the cover cache's writer
// swallows QuotaExceededError — so an unbounded LRC record would surface as "covers silently stopped
// caching", miles from the cause. Both caps live at the WRITER so every caller inherits them.
//
// ponytail: reject over-long, do not truncate — a half LRC is a worse lie than no pin. Ceiling: a
// genuinely 20k+ char LRC (a 30-minute live set with per-character timing) cannot be pinned. Upgrade
// path if anyone hits it: compress, or move the record to IndexedDB where the quota is not shared.
const MAX_LRC_CHARS = 20_000;
// ponytail: eviction is insertion-order-first (JS string-key object order), i.e. oldest WRITE wins the
// axe, not least-recently-USED. Good enough for a 100-entry list a human curates by hand. Upgrade
// path if anyone ever complains: store `{ lrc, at }` and evict by `at`.
const MAX_PINS = 100;

/** The on-disk shape: uid → LRC text. Exported for the reactive wrapper's typing only. */
export type LyricPinRecord = Record<string, string>;

/** Read the pin record; {} on absent / corrupt / unavailable storage (never throws). */
function readPins(): LyricPinRecord {
	try {
		const raw = localStorage.getItem(PIN_KEY);
		if (!raw) return {};
		const v: unknown = JSON.parse(raw);
		if (v && typeof v === 'object' && !Array.isArray(v)) return v as LyricPinRecord;
		return {};
	} catch {
		return {};
	}
}

/**
 * The user's pinned LRC for `uid`, or null. Pure read, never throws.
 * EMPTY-UID GUARD (mirrors getPinnedCover): a uid-less name stub has no identity, so it must never
 * read a shared slot — an empty uid is always a miss, whatever is on disk.
 */
export function getPinnedLyrics(uid: string): string | null {
	if (!uid) return null;
	const v = readPins()[uid];
	return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Pin `lrc` as the lyrics for `uid`. No-op on an empty uid (no identity to pin against), on blank /
 * whitespace-only text (a blank pick is not a choice) and on text over MAX_LRC_CHARS (D-3 — REJECTED,
 * never truncated, and a pre-existing pin for that uid survives untouched). Trims the record to
 * MAX_PINS oldest-first before writing. Swallows quota / unavailable storage.
 *
 * Callers use pinLyrics() in lyric-pins.svelte.ts so the reactive bump is never forgotten.
 */
export function setPinnedLyrics(uid: string, lrc: string): void {
	if (!uid || typeof lrc !== 'string' || !lrc.trim()) return;
	if (lrc.length > MAX_LRC_CHARS) return;
	try {
		const rec = readPins();
		rec[uid] = lrc;
		// Trim from the FRONT (insertion order) until the record fits. The just-written uid is last in
		// key order when it is new, so it can never be the one evicted.
		const keys = Object.keys(rec);
		for (let i = 0; keys.length - i > MAX_PINS; i++) delete rec[keys[i]];
		localStorage.setItem(PIN_KEY, JSON.stringify(rec));
	} catch {
		/* quota or unavailable — non-fatal, the pin simply does not persist */
	}
}

/** Drop the pin for `uid`. Removing a missing uid is a true no-op. Never throws. */
export function removePinnedLyrics(uid: string): void {
	if (!uid) return;
	try {
		const rec = readPins();
		if (uid in rec) {
			delete rec[uid];
			localStorage.setItem(PIN_KEY, JSON.stringify(rec));
		}
	} catch {
		/* unavailable / quota / corrupt — non-fatal, no-op */
	}
}
