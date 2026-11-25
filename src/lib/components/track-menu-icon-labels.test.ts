// Workstream H batch 3 — TrackMenu / queue / library ICON-label regression pins
// (NO SILENT BREAKAGE). Hector 2026-11-23 22:08 (Dawn-Design §8 v1.6): the
// TrackMenu icon grid is icon-only — every cell's glyph carries its label and
// the word survives as aria-label + title. SUPERSEDED IN PART by Hector
// 2026-11-25 (quick-261125-microlabel): grid cells now render a visible 1–2
// char MICRO label (.gi-label, menu.micro.*) under the glyph — the full name
// still survives as aria-label + title, and the fixed cell geometry is now
// 78px. The micro-label set itself is pinned by track-menu-microlabel.test.ts;
// this file keeps the aria-name, readout and geometry pins. The download
// faces' CURRENT-SOURCE behaviour is untouched: the busy face keeps its %
// status readout (.gi-sub) and the downloaded faces keep their localMeta
// readout — status readouts are content, not labels. Queue + library
// controls were already icon-only and are pinned here against regression.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const menu = readFileSync('src/lib/components/TrackMenu.svelte', 'utf-8');
const upNext = readFileSync('src/lib/components/NpUpNext.svelte', 'utf-8');
const libraryPage = readFileSync('src/routes/(app)/library/+page.svelte', 'utf-8');

describe('H batch 3 — TrackMenu grid cells (micro-labels since 2026-11-25)', () => {
	it('a .gi-label span is rendered (visible micro label, markup + CSS class)', () => {
		expect(menu).toContain('class="gi-label"');
		expect(menu).toContain('.gi-label {');
	});
	it('every menu action key survives as an aria-label', () => {
		for (const key of [
			'menu.playNext', 'menu.noImport',
			'menu.addToQueue', 'menu.startRadio', 'menu.versions', 'menu.changeCover',
			'menu.fixLyrics', 'menu.viewComments', 'menu.viewRelated', 'menu.editTags',
			'menu.addToPlaylist', 'menu.customize', 'menu.shuffleQueue', 'menu.clearQueue',
			'menu.sleepTimer', 'menu.goToArtist', 'menu.share',
			'menu.downloadFromSource', 'menu.resetMenu', 'menu.done'
		]) {
			expect(menu, key).toContain(`aria-label={t('${key}')}`);
		}
		// Conditional / template aria-labels (state-named faces keep their names):
		expect(menu).toContain("aria-label={liked ? t('menu.liked') : t('menu.like')}");
		expect(menu).toContain("aria-label={inFlight.has('remix') ? t('menu.preparing') : t('menu.autoplay')}");
		expect(menu).toContain("aria-label={inFlight.has('goToAlbum') ? t('menu.preparing') : t('menu.goToAlbum')}");
		expect(menu).toContain("aria-label={inFlight.has('detail') ? t('menu.preparing') : t('menu.details')}");
		expect(menu).toContain("aria-label={`${t('menu.removeDownload')} · ${t('menu.downloadHoldHint')}`}");
		expect(menu).toContain("aria-label={`${t('menu.downloaded')} · ${t('menu.downloadHoldHint')}`}");
		expect(menu).toContain("`${t('menu.download')} ${Math.round(frac * 100)}%`");
		expect(menu).toContain("aria-label={player.repeatMode === 'one' ? t('nowplaying.repeatModeOne') : t('nowplaying.repeat')}");
	});
	it('edit-mode cells keep their EDIT_META aria-label and show the MICRO label', () => {
		expect(menu).toContain('aria-label={t(EDIT_META[id].label)}');
		expect(menu).toContain('<span class="gi-label">{t(EDIT_META[id].micro)}</span>');
		expect(menu).not.toContain('<span class="gi-label">{t(EDIT_META[id].label)}</span>');
	});
	it('download status readouts stay visible (content, not labels)', () => {
		expect(menu).toContain('<span class="gi-sub">{Math.round(frac * 100)}%</span>');
		expect(menu).toContain('{#if localMeta}<span class="gi-sub">{localMeta}</span>{/if}');
	});
	it('cell geometry is fixed at 78px (NO STRETCH)', () => {
		expect(menu).toContain('min-height: 78px;');
	});
});

describe('H batch 3 — queue + library controls stay icon-only (pinned)', () => {
	it('Up Next grip handle is an aria-labelled glyph', () => {
		expect(upNext).toContain("aria-label={t('nowplaying.reorderTrack')}");
		expect(upNext).toContain('<GripVertical size={18} />');
	});
	it('library page actions (play all / shuffle / edit / options) are aria-labelled glyphs', () => {
		expect(libraryPage).toContain("aria-label={t('library.playAll')}");
		expect(libraryPage).toContain("aria-label={t('nowplaying.shuffle')}");
		expect(libraryPage).toContain("aria-label={t('menu.options')}");
	});
});
