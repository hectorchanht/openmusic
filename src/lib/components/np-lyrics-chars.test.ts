// quick-261122-ugcb4 — wiring pins for the per-character highlight (the maths lives in
// services/lyric-chars.test.ts). Two surfaces, opposite richness (Hector 2026-11-20 20:31):
// the NowPlaying pane sweeps character by character; the Nowbar keeps one simple underline.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { reflowCharText, groupCharSpansBySurfaces, allocateChars } from '$lib/services/lyric-chars';

const np = readFileSync('src/lib/components/NpLyrics.svelte', 'utf-8');
const bar = readFileSync('src/lib/components/Nowbar.svelte', 'utf-8');
const script = readFileSync('src/lib/stores/lyric-script.svelte.ts', 'utf-8');

describe('NpLyrics per-character sweep', () => {
	it('reads characters through the ONE charSpansFor (hand-set, else pre-allocated)', () => {
		expect(np).toContain("import { charSpansFor, charFillAt, groupCharSpansBySurfaces, type TimedChar } from '$lib/services/lyric-chars'");
		expect(np).toContain('charSpansFor(l, lineEndAt(lines, i, player.duration))');
	});
	it('only sung lines of the active group sweep (translations keep the plain line)', () => {
		expect(np).toContain('if (l.time !== activeTime || l.fromParen || l.isTranslation) continue;');
	});
	it('paints per frame off the audio clock, minus the lyric offset, into --p only', () => {
		expect(np).toContain('player.liveTime() - off');
		expect(np).toContain("el.style.setProperty('--p'");
		expect(np).toContain('cancelAnimationFrame(raf)');
	});
	it('keeps the per-frame path paint-only (no filter on the swept glyphs)', () => {
		const css = np.slice(np.indexOf('.lyrics .ch {'), np.indexOf('}', np.indexOf('.lyrics .ch {')));
		expect(css).not.toContain('filter');
	});
	it('the Nowbar carries no character sweep', () => {
		expect(bar).not.toMatch(/charSpansFor|class="ch"/);
	});
});

describe('sweepfix — no full-line white flash at line change (Hector 2026-11-22)', () => {
	it('a swept line carries .sweep alongside .active, except in replace mode (no sweep there)', () => {
		expect(np).toContain('class:sweep={sweepLine}');
		expect(np).toContain("settings.translateMode === 'replace'");
	});
	it('.sweep keeps the muted base colour and no shadow, AFTER the .active rule so it wins', () => {
		const activeAt = np.indexOf('.lyrics p.active {');
		const sweepAt = np.indexOf('.lyrics p.sweep {');
		expect(activeAt).toBeGreaterThan(-1);
		expect(sweepAt).toBeGreaterThan(activeAt);
		const css = np.slice(sweepAt, np.indexOf('}', sweepAt));
		expect(css).toContain('color: var(--color-text-muted)');
		expect(css).toContain('text-shadow: none');
		expect(css).not.toContain('font-weight');
	});
	it('the swept glyphs themselves carry no inherited text-shadow', () => {
		const css = np.slice(np.indexOf('.lyrics .ch {'), np.indexOf('}', np.indexOf('.lyrics .ch {')));
		expect(css).toContain('text-shadow: none');
	});
	it('the furigana branch sweeps too: surfaces re-group the timed characters into .ch spans', () => {
		expect(np).toContain('groupCharSpansBySurfaces(chs, spans.map((s) => s.surface))');
		expect(np).toContain('furiChars.get(i)?.[si]');
		// both the ruby (chosen) and plain (unread) furigana spans render .ch on the active line
		expect(np.match(/furiChars[\s\S]{0,2000}class="ch"/g)?.length).toBeGreaterThan(0);
	});
	it('groupCharSpansBySurfaces groups, splits straddles in time proportion, and refuses mismatches', () => {
		const chars = allocateChars('愛してる', 0, 4); // 4 chars, 1s each
		expect(groupCharSpansBySurfaces(chars, ['愛し', 'てる'])?.map((g) => g.map((c) => c.text).join(''))).toEqual(['愛し', 'てる']);
		const split = groupCharSpansBySurfaces([{ text: '愛し', start: 0, end: 2 }], ['愛', 'し']);
		expect(split).toEqual([
			[{ text: '愛', start: 0, end: 1 }],
			[{ text: 'し', start: 1, end: 2 }]
		]);
		expect(groupCharSpansBySurfaces(chars, ['愛し'])).toBeNull();
		expect(groupCharSpansBySurfaces([], ['愛'])).toBeNull();
	});
});

describe('script lock keeps hand-set character timing', () => {
	it('parseLyrics re-slices spans onto the re-scripted text', () => {
		expect(script).toContain('reflowCharText(l.chars, text)');
	});
	it('reflowCharText maps grapheme-for-grapheme, null on a count mismatch', () => {
		const spans = [
			{ text: '愛', start: 1, end: 2 },
			{ text: '國', start: 2, end: 3 }
		];
		expect(reflowCharText(spans, '爱国')).toEqual([
			{ text: '爱', start: 1, end: 2 },
			{ text: '国', start: 2, end: 3 }
		]);
		expect(reflowCharText(spans, '爱')).toBeNull();
	});
});
