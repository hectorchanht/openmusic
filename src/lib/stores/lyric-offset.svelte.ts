// lyric-offset (reactive) — quick-260926-mis: per-song lyric TIME offset, in seconds.
//
// Keyed by track UID, NOT by name: a live version and its studio version are different uids and MUST
// realign independently (the live one has a talking intro, the studio one is already in step). Only
// non-zero values are stored; the sign convention lives in services/lrc.ts (LYRIC_OFFSET_MAX).
//
// Same reactive-wrapper idiom as lyric-pins.svelte.ts, minus two things:
//   - no separate pure `.ts`: the record read/write is a few lines, and the try/catch around
//     localStorage IS the browser guard (no `$app/environment` import), so this stays node-testable.
//   - no rAF-deferred bump: the bump is SYNCHRONOUS. The highlight + anchor must repaint on the same
//     tick as the hold/nudge; the verification browser pane has frozen rAF; and coalescing buys
//     nothing for a write that only ever happens on a user gesture.

import { normalizeLyricOffset } from '$lib/services/lrc';

const KEY = 'openmusic:lyric-offset:v1';

const _v = $state({ n: 0 });

/** Current offset version. CALL inside a $derived/template to depend on offset writes. */
export function lyricOffsetVersion(): number {
	return _v.n;
}

function readRec(): Record<string, number> {
	try {
		const raw = localStorage.getItem(KEY);
		const rec: unknown = raw ? JSON.parse(raw) : null;
		return rec && typeof rec === 'object' && !Array.isArray(rec) ? (rec as Record<string, number>) : {};
	} catch {
		return {};
	}
}

/** The offset for `uid` (0 when none). Normalized on READ so a tampered value is clamped (T-mis-01). */
export function getLyricOffset(uid: string | null | undefined): number {
	lyricOffsetVersion(); // reactive dependency
	if (!uid) return 0;
	const v = readRec()[uid];
	return normalizeLyricOffset(typeof v === 'number' ? v : 0);
}

/** Persist the offset for `uid` (0 deletes the entry) and repaint every reader on this tick. */
export function setLyricOffset(uid: string, sec: number): void {
	if (!uid) return;
	const n = normalizeLyricOffset(sec);
	try {
		const rec = readRec();
		if (n === 0) delete rec[uid];
		else rec[uid] = n;
		localStorage.setItem(KEY, JSON.stringify(rec));
	} catch {
		// quota / unavailable: non-fatal, the offset just does not persist
	}
	// Unconditional: readers re-read storage, so a failed write correctly still shows the old value.
	_v.n++;
}
