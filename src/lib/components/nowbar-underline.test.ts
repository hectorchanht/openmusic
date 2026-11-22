// quick-261122-ugcb1 — source pins for the Nowbar lyric underline (brief §2.6). The maths is
// tested in services/lrc-progress.test.ts; these pins hold the WIRING: the bar uses the ONE
// shared progress function, paints per frame off the audio clock without $state, and stays
// SIMPLE (no per-character sweep — that belongs to the NowPlaying pane, Hector 2026-11-20 20:31).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/lib/components/Nowbar.svelte', 'utf-8');

describe('Nowbar underline wiring', () => {
	it('uses the shared lineProgressAt (no inline re-derivation of line ends)', () => {
		expect(src).toMatch(/import \{[^}]*lineProgressAt[^}]*\} from "\$lib\/services\/lrc"/);
		expect(src).not.toMatch(/lineEndAt\(/);
	});

	it('renders exactly one underline element inside the lyric line', () => {
		expect(src.match(/class="np-uline"/g)?.length).toBe(1);
	});

	it('paints per frame from the audio element clock, transform-only', () => {
		expect(src).toContain('player.liveTime()');
		expect(src).toContain('requestAnimationFrame(loop)');
		expect(src).toContain('cancelAnimationFrame(raf)');
		expect(src).toMatch(/el\.style\.transform = `scaleX\(/);
	});

	it('carries no per-character sweep (the Nowbar stays simple)', () => {
		expect(src).not.toMatch(/charSpans|charProgress|np-char/);
	});
});
