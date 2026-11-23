import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * PLAYSTATE-ICON (quick-261122-npicon): every play/pause glyph must be a pure function of the ONE
 * central player state — `class:is-playing={player.playing}` — never a component-local mirror
 * ($state copy, prop, derived alias). The store side (player.playing == real <audio> state) is pinned
 * in player.svelte.test.ts under the same PLAYSTATE-ICON tag. Both run in the deploy gate
 * (`pnpm test:gate`).
 */
const SURFACES = ['NowPlaying.svelte', 'Nowbar.svelte'];

describe('PLAYSTATE-ICON: play/pause glyph wiring reads the central player state only', () => {
	for (const file of SURFACES) {
		it(`${file}: every .play-glyph binds is-playing to player.playing`, () => {
			const src = readFileSync(resolve(__dirname, file), 'utf8');
			const glyphs = src.match(/<span[^>]*class="play-glyph"[^>]*>/g) ?? [];
			expect(glyphs.length).toBeGreaterThan(0);
			for (const tag of glyphs) expect(tag).toMatch(/class:is-playing=\{player\.playing\}/);
		});
	}
});
