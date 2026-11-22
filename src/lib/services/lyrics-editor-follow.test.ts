import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	nextFollow,
	followScrollTarget,
	classifyPlayhead,
	SEEK_JUMP_SEC,
	type FollowEvent
} from '$lib/services/lyrics-editor-follow';
import { estimateLines } from '$lib/services/lyrics-editor';

// STANDING RULE guard (Hector 2026-11-21, quick-261122-rules): the lyrics editor auto-scrolls
// to the current line during playback UNLESS the user is actively editing; editing suspends it
// until the playback position is re-engaged. If an assertion here fails the rule is broken —
// fix the code, do not "update" the test.

describe('nextFollow — editing suspends, re-engaging the playhead resumes', () => {
	it('focus and edit suspend', () => {
		expect(nextFollow(true, 'focus')).toBe(false);
		expect(nextFollow(true, 'edit')).toBe(false);
	});

	it('seek, stamp, resume and a fresh open re-engage', () => {
		for (const ev of ['seek', 'stamp', 'resume', 'open'] as FollowEvent[]) {
			expect(nextFollow(false, ev)).toBe(true);
		}
	});

	it('stays suspended through more editing — there is no time-out back to following', () => {
		let f = nextFollow(true, 'focus');
		f = nextFollow(f, 'edit');
		f = nextFollow(f, 'focus');
		expect(f).toBe(false);
	});
});

describe('followScrollTarget — scroll only while following, only on a line change', () => {
	it('following + a new active line → scroll to it', () => {
		expect(followScrollTarget(true, 3, 2, 10)).toBe(3);
	});
	it('suspended (editing) → never scroll', () => {
		expect(followScrollTarget(false, 3, 2, 10)).toBeNull();
	});
	it('same line as last scroll → leave the scroll alone', () => {
		expect(followScrollTarget(true, 3, 3, 10)).toBeNull();
	});
	it('no active line / out of range → null', () => {
		expect(followScrollTarget(true, -1, 2, 10)).toBeNull();
		expect(followScrollTarget(true, 10, 2, 10)).toBeNull();
	});
	it('re-engaging (lastScrolled reset to -1) scrolls straight back to the current line', () => {
		expect(followScrollTarget(nextFollow(false, 'seek'), 4, -1, 10)).toBe(4);
	});
});

describe('classifyPlayhead — outside seeks and resume re-engage too', () => {
	const at = (t: number, wall: number, playing = true) => ({ t, wall, playing });
	it('normal playback is not a seek', () => {
		expect(classifyPlayhead(at(10, 0), at(10.25, 250))).toBeNull();
		expect(classifyPlayhead(at(10, 0), at(40, 30_000))).toBeNull(); // throttled tab, still playing
	});
	it('a jump beyond playback is a seek (forward and back)', () => {
		expect(classifyPlayhead(at(10, 0), at(10 + SEEK_JUMP_SEC + 5, 250))).toBe('seek');
		expect(classifyPlayhead(at(60, 0), at(5, 250))).toBe('seek');
	});
	it('a move while paused is a seek; standing still while paused is not', () => {
		expect(classifyPlayhead(at(10, 0, false), at(50, 5000, false))).toBe('seek');
		expect(classifyPlayhead(at(10, 0, false), at(10, 9000, false))).toBeNull();
	});
	it('paused → playing is a resume', () => {
		expect(classifyPlayhead(at(10, 0, false), at(10, 100, true))).toBe('resume');
	});
	it('no previous sample → nothing', () => {
		expect(classifyPlayhead(null, at(10, 0))).toBeNull();
	});
});

describe('the approved estimator is not regressed (Hector 2026-11-21: "running very well")', () => {
	it('duration ÷ lines, in sequence, last line ends at the duration', () => {
		expect(estimateLines(['a', 'b', 'c', 'd'], 200)).toEqual([
			{ start: 0, end: 50, text: 'a' },
			{ start: 50, end: 100, text: 'b' },
			{ start: 100, end: 150, text: 'c' },
			{ start: 150, end: 200, text: 'd' }
		]);
	});
});

// Structural pins (the lyrics-settings-sheet source technique — no jsdom in this project):
// the DOM shell actually routes every editing path and every re-engagement through the rule.
const ed = readFileSync('src/lib/components/LyricsEditor.svelte', 'utf-8');

describe('LyricsEditor wiring', () => {
	it('focus in any field suspends (focusin on the sheet, inputs/textareas only)', () => {
		expect(ed).toContain('onfocusin={onEditorFocusIn}');
		expect(ed).toMatch(/matches\('input, textarea'\)\) follow\('focus'\)/);
	});
	it('every edit path suspends: paste/typing, line text, nudge/drag (adjust default)', () => {
		expect(ed).toMatch(/function onRawInput\(\) \{\s*follow\('edit'\)/);
		expect(ed).toMatch(/lines\[i\]\.text = e\.currentTarget\.value; follow\('edit'\)/);
		expect(ed).toMatch(/function adjust\(i: number, next: EditorLine, ev: FollowEvent = 'edit'\)/);
	});
	it('re-engagement: the timestamp tap seeks, a stamp, and outside seek/resume via classifyPlayhead', () => {
		expect(ed).toMatch(/player\.seekFraction\(frac\);\s*follow\('seek'\)/);
		expect(ed).toContain("duration), 'stamp');");
		expect(ed).toMatch(/classifyPlayhead\(lastSample, cur\)/);
	});
	it('the scroll targets the bounded lines list, never scrollIntoView', () => {
		expect(ed).toContain('bind:this={linesEl}');
		expect(ed).toContain('linesEl.scrollTo(');
		expect(ed).not.toContain('scrollIntoView(');
	});
});
