// comment-drafts — the composer's UNSENT work, kept across everything except the two
// deliberate endings (quick-261120-cdraft, Hector 2026-11-20).
//
// Hector's rule: a comment that has not been posted yet must NEVER disappear because the
// player advanced to the next song. The composer used to hold `text` in component state
// only, so any remount (track change, tab/pane close, reload) silently ate it. Drafts now
// live in localStorage, keyed by the SAME identity the thread itself uses — the comment
// thread key (first 32 hex of SHA-256(songKey)) — so a draft belongs to exactly one song
// and can never leak onto another. The name is global (one commenter, every song) and
// reuses the pre-existing remembered-name key, so names saved before this store existed
// are still there.
//
// Cleared ONLY on: a successful Post, or an explicit Cancel. Everything else — auto-advance,
// manual track change, closing the tab or the pane, a full reload — preserves the draft.
//
// Structurally the lyric-pins posture: pure, node-testable, NEVER throws, caps at the writer
// so a tampered or runaway record cannot eat the shared origin quota.

const DRAFT_KEY = 'openmusic:comment-drafts:v1';
// The remembered-name key predates this module (it lived inline in NpComments); the string
// is unchanged on purpose — existing users keep their remembered name.
const NAME_KEY = 'openmusic:comment-name:v1';

// The composer's own limit (TEXT_MAX in NpComments / the textarea's maxlength). A longer
// "draft" cannot have come from the box, so it is rejected, never truncated — a cut comment
// is a worse lie than no draft (the pin-store doctrine).
const MAX_DRAFT_CHARS = 280;
// ponytail: eviction is insertion-order-first (oldest write), the lyric-pins pattern. A
// listener with drafts on 50+ songs losing the oldest is the accepted ceiling.
const MAX_DRAFTS = 50;

/** The on-disk shape: thread key → draft text. Exported for tests only. */
export type CommentDraftRecord = Record<string, string>;

function readDrafts(): CommentDraftRecord {
	try {
		const raw = localStorage.getItem(DRAFT_KEY);
		if (!raw) return {};
		const v: unknown = JSON.parse(raw);
		if (v && typeof v === 'object' && !Array.isArray(v)) return v as CommentDraftRecord;
		return {};
	} catch {
		return {};
	}
}

/**
 * The saved draft for thread `key`, or ''. An empty key (thread not resolved yet) is
 * always a miss — a draft must never land in a shared, identity-less slot.
 */
export function getCommentDraft(key: string): string {
	if (!key) return '';
	const v = readDrafts()[key];
	return typeof v === 'string' ? v : '';
}

/**
 * Save `text` as the draft for thread `key`. Called on every keystroke by the composer, so
 * the draft is durable at ALL times, not just at some unload moment that may never fire.
 * Blank/whitespace text REMOVES the entry (an emptied box is no draft). Text over
 * MAX_DRAFT_CHARS is rejected untouched. Never throws.
 */
export function setCommentDraft(key: string, text: string): void {
	if (!key || typeof text !== 'string') return;
	if (!text.trim()) {
		clearCommentDraft(key);
		return;
	}
	if (text.length > MAX_DRAFT_CHARS) return;
	try {
		const rec = readDrafts();
		rec[key] = text;
		const keys = Object.keys(rec);
		for (let i = 0; keys.length - i > MAX_DRAFTS; i++) delete rec[keys[i]];
		localStorage.setItem(DRAFT_KEY, JSON.stringify(rec));
	} catch {
		/* quota or unavailable — non-fatal, the draft simply does not persist */
	}
}

/** Drop the draft for `key` — the Post-success and explicit-Cancel path, and no other. */
export function clearCommentDraft(key: string): void {
	if (!key) return;
	try {
		const rec = readDrafts();
		if (key in rec) {
			delete rec[key];
			localStorage.setItem(DRAFT_KEY, JSON.stringify(rec));
		}
	} catch {
		/* unavailable / corrupt — non-fatal, no-op */
	}
}

/** The remembered commenter name (global, not per song); '' when none. Never throws. */
export function getCommentName(): string {
	try {
		return localStorage.getItem(NAME_KEY) ?? '';
	} catch {
		return '';
	}
}

/** Remember the commenter name; an empty string forgets it. Never throws. */
export function setCommentName(name: string): void {
	try {
		if (name) localStorage.setItem(NAME_KEY, name);
		else localStorage.removeItem(NAME_KEY);
	} catch {
		/* private mode — the name just is not remembered */
	}
}
