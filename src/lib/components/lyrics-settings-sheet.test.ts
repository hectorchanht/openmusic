import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// quick-261120-lsheet — STRUCTURAL pins for the lyrics settings move (Hector
// 2026-11-20), in the track-menu-ssr / np-comments-composer source technique
// (no jsdom in this project). The move's whole point is ONE home per control:
//   1. The sheet's controls write the SAME settings-store fields the Settings
//      page used (surface move only — store, persistence, saved values intact).
//   2. The Settings translation page no longer exposes ANY lyrics control.
//   3. The NP tab row carries the one sliders button, lyrics tab only.
//   4. The dedupe default is ON in the ONE default-value file.
const sheet = readFileSync('src/lib/components/LyricsSettingsSheet.svelte', 'utf-8');
const page = readFileSync('src/routes/(app)/settings/translation/+page.svelte', 'utf-8');
const np = readFileSync('src/lib/components/NowPlaying.svelte', 'utf-8');
const defaults = readFileSync('src/lib/config/defaults.ts', 'utf-8');
const pane = readFileSync('src/lib/components/NpLyrics.svelte', 'utf-8');

describe('LyricsSettingsSheet — the one home for lyrics controls', () => {
	it('the sheet writes the same store fields the Settings page used', () => {
		expect(sheet).toContain('settings.lyricsLang = v');
		expect(sheet).toContain('settings.translateMode = v');
		expect(sheet).toContain('settings.lyricsHideParenLines = !settings.lyricsHideParenLines');
		expect(sheet).toContain(
			'settings.lyricsHideParenTranslation = !settings.lyricsHideParenTranslation'
		);
		expect(sheet).toContain('settings.lyricsDedupeIdentical = !settings.lyricsDedupeIdentical');
	});

	it('the sheet hosts the source picker seam and the editor entry', () => {
		expect(sheet).toContain('collectLyricCandidates');
		expect(sheet).toContain('pinLyrics(track.uid, lrc)');
		expect(sheet).toContain("t('menu.writeOwnLyrics')");
		expect(sheet).toContain('<LyricsEditor');
	});

	it('the sheet nudges the shared offset store at the 0.1s step', () => {
		expect(sheet).toContain('setLyricOffset(uid, offset + delta)');
		expect(sheet).toContain('nudge(-0.1)');
		expect(sheet).toContain('nudge(0.1)');
	});

	it('the Settings translation page exposes no lyrics control any more', () => {
		expect(page).not.toContain('settings.lyricsLang');
		expect(page).not.toContain('settings.translateMode');
		expect(page).not.toContain('lyricsHideParen');
		expect(page).not.toContain('settings.lyricsSkip');
		// …while the parts that stay keep working:
		expect(page).toContain('settings.artistLang');
		expect(page).toContain('settings.titleLang');
		expect(page).toContain('settings.zhScript');
	});

	it('the NP tab row carries the sliders button, lyrics tab only', () => {
		expect(np).toContain('class="lyr-set"');
		expect(np).toContain("tab === 'lyrics'");
		expect(np).toContain('<LyricsSettingsSheet');
	});

	it('the dedupe default is ON in the one default-value file', () => {
		expect(defaults).toContain('lyricsDedupeIdentical: true');
	});

	it('the pane applies the dedupe rule in below mode', () => {
		expect(pane).toContain('settings.lyricsDedupeIdentical');
		expect(pane).toContain('translationDuplicatesOriginal(l.text, trLines[i]');
	});
});
