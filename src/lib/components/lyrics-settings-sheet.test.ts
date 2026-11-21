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
const picker = readFileSync('src/lib/components/SettingPicker.svelte', 'utf-8');

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

// quick-261120-segfix — Hector's dogfood screenshot (2026-11-20 21:35): the sheet's
// TRANSLATION group rendered as two clipped strips. Root cause: .sheet is a
// max-height-capped flex column, so flex shrink compressed its children; the two
// SettingPicker .seg rows were the ONLY children that could be crushed — their
// overflow-x:auto zeroes their automatic minimum size, while every sibling
// (.row min-height, toggles) has a floor. These pins hold BOTH ends of the seam:
// the control refuses compression, and the sheet never asks for it.
describe('LyricsSettingsSheet — translation pickers keep their geometry', () => {
	it('both translation controls render in the sheet with their full option sets', () => {
		expect(sheet).toContain('options={langOptions}');
		expect(sheet).toContain('options={modeOptions}');
		// the language list: off + auto + 17 endonyms (scoped to the `langs`
		// declaration — quick-261121-trfix added a second endonym list, `sources`)
		const langsBlock = sheet.slice(
			sheet.indexOf('const langs'),
			sheet.indexOf('];', sheet.indexOf('const langs'))
		);
		expect(langsBlock.match(/\{ v: '(off|auto|zh-Hant|zh-Hans|en|ja|ko|es|fr|de|pt|it|ru|tr|ar|hi|id|vi|th)', label:/g)).toHaveLength(19);
		// the mode control: both display modes, nothing else
		expect(sheet).toContain("{ v: 'replace' as TranslateMode");
		expect(sheet).toContain("{ v: 'below' as TranslateMode");
	});

	it('the segmented control refuses flex compression (component owns its geometry)', () => {
		const segRule = picker.match(/\.seg \{[\s\S]*?\}/)?.[0] ?? '';
		expect(segRule).toContain('flex-shrink: 0');
	});

	it('the scrolling sheet never compresses a child', () => {
		expect(sheet).toMatch(/\.sheet > :global\(\*\) \{ flex: none; \}/);
	});
});

// quick-261121-trfix — the skip-whitelist UI restoration (brief pin 7) + the
// sheet-side force refresh. The lsheet move dropped the skip control's only UI
// while the setting + pane consumption survived; these pins hold the restored
// wiring: the sheet writes the SAME settings.lyricsSkip field the pane's
// translate effect reads, with the full SourceLang list.
describe('LyricsSettingsSheet — skip whitelist + force refresh (quick-261121-trfix)', () => {
	it('the sheet hosts a skip control writing settings.lyricsSkip (the field the pane reads)', () => {
		expect(sheet).toContain(
			'settings.lyricsSkip = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]'
		);
		expect(sheet).toContain('settings.save()');
		expect(sheet).toContain("t('settings.skipLanguages')");
		expect(sheet).toContain('settings.lyricsSkip.includes(s.v)');
		// the full 17-tag SourceLang list, endonym labels literal
		const sourcesBlock = sheet.slice(
			sheet.indexOf('const sources'),
			sheet.indexOf('];', sheet.indexOf('const sources'))
		);
		expect(
			sourcesBlock.match(/\{ v: '(zh-Hant|zh-Hans|en|ja|ko|es|fr|de|pt|it|ru|tr|ar|hi|id|vi|th)', label:/g)
		).toHaveLength(17);
		// …and the pane consumes that same field (the other end of the seam):
		expect(pane).toContain('const skip = settings.lyricsSkip;');
	});

	it('the sheet sends the force-refresh request for the current track + effective target', () => {
		expect(sheet).toContain(
			'lyricsTranslation.requestRetranslate(track.uid, effectiveTarget(settings.lyricsLang))'
		);
		expect(sheet).toContain("t('lyricsSettings.retranslate')");
		// gated on translation being ON (the mode picker's own gate pattern):
		expect(sheet).toContain("settings.lyricsLang === 'off'");
	});
});
