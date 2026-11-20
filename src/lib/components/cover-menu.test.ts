import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// quick-261119-lpc — STRUCTURAL gate for the cover long-press → TrackMenu wiring.
// Vitest here is ONE node project with NO jsdom, so the Svelte components cannot be
// rendered; like settings-ui.test.ts / free-page.test.ts, these assertions read SOURCE
// with comments stripped (both components DOCUMENT their gesture rules in comments, so
// a comment mentioning a rule must never satisfy or trip the gate).
//
// What this gate pins (Hector 2026-11-19: "long press cover will pop up detail modal;
// double click cover action preserve and careful nothing broken"):
//   1. Now Playing's CURRENT cover cell carries use:longpress + onlongpress +
//      oncontextmenu, all routed to the one shared openCoverMenu handler, which is
//      null-guarded and opens the menu for player.current via the existing openMenu.
//   2. The double-tap wiring on that same cell is BYTE-unchanged (same action, same
//      params) — the preserve-half of the instruction.
//   3. The long-press lives on the current cell ONLY: exactly one use:longpress in
//      NowPlaying (prev/next cells and the VideoStage cover get none).
//   4. The Nowbar's pre-existing cover long-press path stays intact: .np-open keeps
//      use:longpress / onlongpress / oncontextmenu → openBarMenu, .np-art keeps its
//      doubleTap (single=handleOpen, double=coverRandom), and the TrackMenu stays
//      mounted on player.current.

const read = (p: string) => readFileSync(p, 'utf-8');
function stripComments(src: string): string {
	return src
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((l) => !/^\s*\/\//.test(l))
		.join('\n');
}

const NOWPLAYING = 'src/lib/components/NowPlaying.svelte';
const NOWBAR = 'src/lib/components/Nowbar.svelte';

/** The markup window starting at `marker` — enough to cover one element's attribute list. */
function window_(src: string, marker: string, len = 700): string {
	const at = src.indexOf(marker);
	expect(at, marker).toBeGreaterThan(-1);
	return src.slice(at, at + len);
}

describe('NowPlaying cover long-press → TrackMenu (quick-261119-lpc)', () => {
	const code = stripComments(read(NOWPLAYING));

	it('imports the shared longpress action', () => {
		expect(code).toContain("import { longpress } from '$lib/actions/longpress';");
	});

	it('the CURRENT cell carries longpress + both menu gestures on the shared handler', () => {
		const cell = window_(code, 'class="cover-cell cur"');
		expect(cell).toContain('use:longpress');
		expect(cell).toContain('onlongpress={openCoverMenu}');
		expect(cell).toContain('oncontextmenu={openCoverMenu}');
	});

	it('openCoverMenu is null-guarded, haptic on hold only, and opens player.current via openMenu', () => {
		const fn = window_(code, 'function openCoverMenu(e: Event)', 400);
		expect(fn).toContain('if (!player.current) return;');
		expect(fn).toContain('e.preventDefault();');
		expect(fn).toContain("if (e.type === 'longpress') hapticTick();");
		expect(fn).toContain('openMenu(player.current);');
	});

	it('PRESERVE: the double-tap wiring on the current cell is unchanged', () => {
		const cell = window_(code, 'class="cover-cell cur"');
		expect(cell).toContain(
			'use:doubleTap={{ onsingletap: tapCoverCollapse, ondoubletap: coverRandom }}'
		);
		expect(code).toContain("import { doubleTap } from '$lib/actions/doubleTap';");
	});

	it('the long-press is on the current cell ONLY — one mount in the whole component', () => {
		expect(code.match(/use:longpress/g)).toHaveLength(1);
		expect(code.match(/onlongpress=/g)).toHaveLength(1);
		// The video cover branch is a different node and stays without the gesture.
		const video = window_(code, 'class="cover video-cover"', 200);
		expect(video).not.toContain('longpress');
	});
});

describe('Nowbar cover long-press — pre-existing path stays intact (quick-261119-lpc)', () => {
	const code = stripComments(read(NOWBAR));

	it('.np-open keeps longpress + contextmenu → openBarMenu', () => {
		const bar = window_(code, 'class="np-open"');
		expect(bar).toContain('use:longpress');
		expect(bar).toContain('onlongpress={openBarMenu}');
		expect(bar).toContain('oncontextmenu={openBarMenu}');
	});

	it('.np-art keeps its doubleTap: single expands, double dives', () => {
		const art = window_(code, 'class="np-art"');
		expect(art).toContain('onsingletap: handleOpen');
		expect(art).toContain('ondoubletap: coverRandom');
	});

	it('the TrackMenu stays mounted on player.current', () => {
		expect(code).toContain(
			'<TrackMenu track={player.current} open={menuOpen} onclose={() => (menuOpen = false)} />'
		);
	});
});
