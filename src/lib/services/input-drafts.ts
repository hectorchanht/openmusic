// input-drafts — GOLD RULE (Hector 2026-11-21, ALL Dawn products): all user input is
// auto-cached. comment-drafts.ts is the reference implementation; this is the same posture
// generalised for the other OpenMusic input surfaces the 2026-11-22 audit found losing text
// (quick-261122-rules):
//   - the SEARCH box: unsubmitted typing was only in component state (searchSession.q is
//     written on settle and is in-memory), so a reload ate it;
//   - the LYRICS EDITOR (UGC paste): the pasted text and every hand adjustment lived in the
//     sheet's component state, so a stray scrim tap / drag-close / reload lost the whole paste.
//
// Saved on every change (never at some unload moment that may not fire); cleared ONLY by the
// surface's deliberate ending (the search X / emptied box, the editor's Save). Pure, NEVER
// throws, capped at the writer so a runaway record cannot eat the shared origin quota.

const KEY = 'openmusic:input-drafts:v1';
/** Per-draft ceiling: a full LRC with explicit ends is a few KB; 64K chars is generous. */
export const MAX_INPUT_DRAFT_CHARS = 64_000;
/** Entry ceiling — insertion-order eviction (comment-drafts / lyric-pins pattern). */
export const MAX_INPUT_DRAFTS = 30;

/** The search box's draft slot (one box, one slot). */
export const SEARCH_DRAFT = 'search';
/** The lyrics editor's draft slot for one track ('' for no uid — never a shared slot). */
export function lyricsDraftKey(uid: string | null | undefined): string {
	return uid ? `lyrics:${uid}` : '';
}

function read(): Record<string, string> {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return {};
		const v: unknown = JSON.parse(raw);
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
	} catch {
		return {};
	}
}

/** The saved draft for `key`, or ''. Never throws. */
export function getInputDraft(key: string): string {
	if (!key) return '';
	const v = read()[key];
	return typeof v === 'string' ? v : '';
}

/**
 * Save `text` for `key`. Blank text REMOVES the entry (an emptied box is no draft); text over
 * the cap is rejected untouched (a cut draft is a worse lie than the last good one). A rewrite
 * moves the key to the newest position so eviction drops the stalest draft. Never throws.
 */
export function setInputDraft(key: string, text: string): void {
	if (!key || typeof text !== 'string') return;
	if (!text.trim()) {
		clearInputDraft(key);
		return;
	}
	if (text.length > MAX_INPUT_DRAFT_CHARS) return;
	try {
		const rec = read();
		if (rec[key] === text) return;
		delete rec[key];
		rec[key] = text;
		const keys = Object.keys(rec);
		for (let i = 0; keys.length - i > MAX_INPUT_DRAFTS; i++) delete rec[keys[i]];
		localStorage.setItem(KEY, JSON.stringify(rec));
	} catch {
		/* quota or unavailable — non-fatal */
	}
}

/** Drop the draft for `key` — the surface's deliberate ending, and nothing else. */
export function clearInputDraft(key: string): void {
	if (!key) return;
	try {
		const rec = read();
		if (key in rec) {
			delete rec[key];
			localStorage.setItem(KEY, JSON.stringify(rec));
		}
	} catch {
		/* non-fatal */
	}
}

/** The lyrics editor's saved working state: the raw paste plus the timed lines (as LRC). */
export interface LyricsEditorDraft {
	raw: string;
	lrc: string;
	estimated: boolean;
}

/** '' for an empty working state (setInputDraft then clears the slot). */
export function encodeLyricsDraft(d: LyricsEditorDraft): string {
	if (!d.raw.trim() && !d.lrc.trim()) return '';
	return JSON.stringify({ raw: d.raw, lrc: d.lrc, estimated: !!d.estimated });
}

/** Parse a stored lyrics draft; anything malformed → null (no draft), never a throw. */
export function decodeLyricsDraft(s: string): LyricsEditorDraft | null {
	if (!s) return null;
	try {
		const v: unknown = JSON.parse(s);
		if (!v || typeof v !== 'object') return null;
		const o = v as Record<string, unknown>;
		if (typeof o.raw !== 'string' || typeof o.lrc !== 'string') return null;
		if (!o.raw.trim() && !o.lrc.trim()) return null;
		return { raw: o.raw, lrc: o.lrc, estimated: o.estimated === true };
	} catch {
		return null;
	}
}
