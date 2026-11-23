import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// quick-261122-tsfix — STRUCTURAL pins for the degenerate-stamp repair in the LyricsEditor,
// in the lyrics-settings-sheet.test.ts technique (no jsdom in this project). The behaviour
// itself is pinned in services/lyrics-editor.test.ts (predicate + chain stamp); these pins
// hold the component end of the seams: detection runs on the seeded lines however they
// arrived, the banner's one tap routes through the existing estimator, and the re-time
// tap routes through the chain-stamp helper at the live playhead.
const editor = readFileSync('src/lib/components/LyricsEditor.svelte', 'utf-8');
const service = readFileSync('src/lib/services/lyrics-editor.ts', 'utf-8');

describe('LyricsEditor — degenerate-stamp banner + re-time mode (quick-261122-tsfix)', () => {
	it('the service exports the predicate and the chain-stamp helper', () => {
		expect(service).toContain('export function hasDegenerateStamps');
		expect(service).toContain('export function stampNextInSequence');
	});

	it('detection is derived from the lines themselves (draft seeds included)', () => {
		expect(editor).toContain('const degenerate = $derived(hasDegenerateStamps(lines, duration));');
		expect(editor).toContain("{#if degenerate && !retime}");
		expect(editor).toContain("t('lyricsEditor.degenerate', { time: fmt(duration) })");
	});

	it('the banner’s one tap distributes through the existing estimator and flips the class', () => {
		expect(editor).toContain('lines = estimateLines(lines.map((l) => l.text), duration);');
		expect(editor).toContain("t('lyricsEditor.distribute')");
	});

	it('the re-time tap stamps the next line at the live playhead through the helper', () => {
		expect(editor).toContain('stampNextInSequence(lines, retimeCursor, player.currentTime, duration)');
		expect(editor).toContain("t('lyricsEditor.retime')");
		expect(editor).toContain("t('lyricsEditor.stampNext')");
	});

	it('the cursor line carries the distinct next-to-stamp style', () => {
		expect(editor).toContain('class:next={retime && i === retimeCursor}');
		expect(editor).toContain('.line.next');
		expect(editor).toContain("t('lyricsEditor.nextLine')");
	});
});
