import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// quick-261125-cascade — STRUCTURAL pins for cascade timing + interludes
// (Hector 2026-11-23, re-flagged 2026-11-25), in the house source-reading
// technique (no jsdom in this project). The pins exist so the features cannot
// silently vanish from the components while the pure helpers stay green:
//   1. The editor carries the cascade mode toggle (chain icon family) and
//      routes nudges/drag/stamp through the pure cascade helpers.
//   2. The editor renders an interlude as a SPINNER row (data-interlude +
//      LoaderCircle) — and NO word (esp. 間奏) ever occupies a lyric position
//      in either component.
//   3. Playback renders the interlude progress bar from the SAME derivation
//      (interludeSegmentsFromSpans / activeInterludeAt), as a <div> — never a
//      <p>, which the scroll-anchor pass counts by index.
const editor = readFileSync('src/lib/components/LyricsEditor.svelte', 'utf-8');
const pane = readFileSync('src/lib/components/NpLyrics.svelte', 'utf-8');

describe('LyricsEditor — cascade mode toggle + dispatch', () => {
	it('exposes Single / Ripple / Anchor modes with i18n micro-labels', () => {
		expect(editor).toContain("t('lyricsEditor.modeSingle')");
		expect(editor).toContain("t('lyricsEditor.modeRipple')");
		expect(editor).toContain("t('lyricsEditor.modeAnchor')");
		expect(editor).toContain("mode = $state<EditorCascadeMode>('single')");
	});

	it('routes boundary nudges, drags and stamps through the pure cascade helpers', () => {
		expect(editor).toContain('rippleShiftDraft');
		expect(editor).toContain('anchorStretchLines');
		expect(editor).toContain('function nudgeStart');
		expect(editor).toContain('function nudgeEnd');
	});
});

describe('Interludes — spinner in the editor, bar in playback, no lyric-position words', () => {
	it('the editor renders segments as spinner rows and offers insert/resize/delete', () => {
		expect(editor).toContain('data-interlude');
		expect(editor).toContain('LoaderCircle');
		expect(editor).toContain('insertInterlude');
		expect(editor).toContain('resizeInterlude');
		expect(editor).toContain('deleteInterlude');
		expect(editor).toContain('interludesFromEditorLines');
	});

	it('no interlude word ever sits in a lyric position (editor or playback)', () => {
		expect(editor).not.toContain('間奏');
		expect(pane).not.toContain('間奏');
	});

	it('playback derives segments from the same model and renders a div progress bar', () => {
		expect(pane).toContain('interludeSegmentsFromSpans');
		expect(pane).toContain('activeInterludeAt');
		expect(pane).toContain('class="interlude-bar"');
		expect(pane).not.toContain('<p class="interlude-bar"');
	});
});
