// lyrics-editor-follow — STANDING RULE (Hector 2026-11-21, quick-261122-rules): the lyrics
// editor AUTO-SCROLLS to the current line during playback UNLESS the user is actively editing.
// Focus in an editor field or any edit SUSPENDS the follow; it stays suspended until the user
// RE-ENGAGES the playback position (a seek — the editor's own timestamp tap or any outside
// seek — a stamp at the playhead, or resuming playback). Blur alone does NOT resume: the user
// may be reading what they just typed.
//
// PURE and node-testable (lyric-hold.ts posture); LyricsEditor.svelte is the thin DOM shell.
// The estimator (estimateLines) is untouched by this module — Hector approved its timing the
// same night ("The lyrics approximate is running very well").

/** What happened in / around the editor that bears on following the playhead. */
export type FollowEvent = 'open' | 'focus' | 'edit' | 'seek' | 'stamp' | 'resume';

/**
 * The follow state after `ev`. Editing (focus / edit) suspends; every playhead re-engagement
 * (seek / stamp / resume) and a fresh open resume. A stamp re-engages because it is literally
 * "this line starts at the playhead" — the user is tracking the playback position, and the
 * stamped line becoming active should stay in view.
 */
export function nextFollow(_following: boolean, ev: FollowEvent): boolean {
	return !(ev === 'focus' || ev === 'edit');
}

/**
 * Which row to scroll to now, or null for "leave the scroll alone". Only while following,
 * only for a real active line, and only when it CHANGED since the last scroll (so a user's
 * own scrolling between line changes is not fought on every timeupdate).
 */
export function followScrollTarget(
	following: boolean,
	activeIdx: number,
	lastScrolledIdx: number,
	lineCount: number
): number | null {
	if (!following) return null;
	if (!Number.isInteger(activeIdx) || activeIdx < 0 || activeIdx >= lineCount) return null;
	if (activeIdx === lastScrolledIdx) return null;
	return activeIdx;
}

/** Playhead drift beyond which a position change is a SEEK, not playback (seconds). */
export const SEEK_JUMP_SEC = 2;

export interface PlayheadSample {
	/** player.currentTime, seconds. */
	t: number;
	/** Wall clock, milliseconds (performance.now()). */
	wall: number;
	playing: boolean;
}

/**
 * Classify a playhead update against the previous sample: 'resume' on a paused → playing
 * edge, 'seek' when the position moved by more than playback explains (while playing: drift
 * from wall-clock elapsed; while paused: any move), else null. No previous sample → null.
 */
export function classifyPlayhead(
	prev: PlayheadSample | null,
	cur: PlayheadSample
): 'seek' | 'resume' | null {
	if (!prev || !Number.isFinite(prev.t) || !Number.isFinite(cur.t)) return null;
	if (cur.playing && !prev.playing) return 'resume';
	const moved = cur.t - prev.t;
	if (cur.playing) {
		const elapsed = Math.max(0, (cur.wall - prev.wall) / 1000);
		return Math.abs(moved - elapsed) > SEEK_JUMP_SEC ? 'seek' : null;
	}
	return Math.abs(moved) > SEEK_JUMP_SEC ? 'seek' : null;
}
