import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// quick-261125-microlabel (Hector 2026-11-25) — STRUCTURAL gate for the TrackMenu
// micro-label ruling. Hector's screenshot showed the 4×5 grid as ICON-ONLY: pretty
// but unreadable — worst case, TWO cells carry the same Trash2 icon for completely
// different actions (remove-download vs clear-queue). The ruling: every grid cell
// shows icon + a 1–2 character micro label (menu.micro.*); the full-length name
// stays in aria-label/title. This source pin (the track-menu-ssr technique — no
// jsdom in this project) fails if a cell loses its micro label, if the two Trash2
// cells ever share one, if a locale drops a micro key, or if the label CSS can
// stretch a cell again (NO STRETCH: fixed 1fr tracks, label nowrap + ellipsis).
const read = (p: string) => readFileSync(p, 'utf-8');
const src = read('src/lib/components/TrackMenu.svelte');

const LOCALES = ['en', 'zh-Hant', 'zh-Hans', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'tr', 'ar', 'hi', 'id', 'vi', 'th'] as const;
const dict = (lang: string) => read(`src/lib/i18n/${lang}.ts`);
const microOf = (lang: string, key: string) =>
	dict(lang).match(new RegExp(`"menu\\.micro\\.${key}": "([^"]*)"`))?.[1];

/** action id -> micro key suffix (they differ where the full key is a phrase). */
const ACTION_MICRO: Record<string, string> = {
	remix: 'remix', share: 'share', download: 'download', like: 'like',
	playNext: 'playNext', changeCover: 'changeCover', changeLyrics: 'changeLyrics',
	goToArtist: 'goToArtist', repeat: 'repeat', shuffleQueue: 'shuffleQueue',
	clearQueue: 'clearQueue', addQueue: 'addQueue', editTags: 'editTags',
	addToPlaylist: 'addToPlaylist', detail: 'detail', sleepTimer: 'sleepTimer',
	versions: 'versions', customize: 'customize', goToAlbum: 'goToAlbum',
	startRadio: 'startRadio', downloadSource: 'downloadSource',
	viewComments: 'viewComments', viewRelated: 'viewRelated'
};
const MICRO_KEYS = [...Object.values(ACTION_MICRO), 'removeDownload', 'downloaded', 'noImport'];

describe('TrackMenu micro labels (quick-261125-microlabel)', () => {
	it('every catalog action has a micro label wired in the component (directly or via EDIT_META)', () => {
		for (const micro of Object.values(ACTION_MICRO)) {
			expect(src, `menu.micro.${micro}`).toContain(`menu.micro.${micro}`);
		}
	});

	it('every live grid cell renders its label from a micro key (no full-length .gi-label left)', () => {
		const labels = src.match(/<span class="gi-label">\{t\('([^']+)'\)\}<\/span>/g) ?? [];
		expect(labels.length).toBeGreaterThanOrEqual(20);
		for (const l of labels) expect(l).toContain('menu.micro.');
		// the edit/customize grid reads the micro field, not the full label
		expect(src).toContain('<span class="gi-label">{t(EDIT_META[id].micro)}</span>');
	});

	it('the two Trash2 cells are disambiguated: remove-download ≠ clear-queue', () => {
		const removeCell = src.match(/<button class="gi"[^>]*openRemoveDownload[\s\S]{0,400}?<\/button>/)?.[0] ?? '';
		const clearCell = src.match(/<button class="gi"[^>]*onclick=\{clearQueue\}[\s\S]{0,300}?<\/button>/)?.[0] ?? '';
		expect(removeCell).toContain('menu.micro.removeDownload');
		expect(clearCell).toContain('menu.micro.clearQueue');
		expect(microOf('zh-Hant', 'removeDownload')).toBe('刪檔');
		expect(microOf('zh-Hant', 'clearQueue')).toBe('清列');
		// …and the full names still ride in aria-label for accessibility
		expect(removeCell).toContain("t('menu.removeDownload')");
		expect(clearCell).toContain("t('menu.clearQueue')");
	});

	it('playNext / addQueue / addToPlaylist stay three different micro labels', () => {
		const zh = ['playNext', 'addQueue', 'addToPlaylist'].map((k) => microOf('zh-Hant', k));
		expect(zh).toEqual(['插播', '入列', '加單']);
		expect(new Set(zh).size).toBe(3);
	});

	it('zh-Hant micro labels are exactly the approved 1–2 char set', () => {
		const approved: Record<string, string> = {
			remix: '混播', share: '分享', download: '下載', removeDownload: '刪檔', downloaded: '已載',
			like: '收藏', playNext: '插播', addQueue: '入列', startRadio: '電台', versions: '版本',
			changeCover: '封面', changeLyrics: '歌詞', goToArtist: '歌手', goToAlbum: '專輯',
			repeat: '循環', shuffleQueue: '隨機', clearQueue: '清列', sleepTimer: '定時',
			editTags: '標籤', addToPlaylist: '加單', detail: '詳情', customize: '自訂',
			downloadSource: '選源', viewComments: '留言', viewRelated: '相關'
		};
		for (const [k, v] of Object.entries(approved)) expect(microOf('zh-Hant', k), k).toBe(v);
	});

	it('all 15 locales define every micro key, non-empty and ≤ 2 words', () => {
		for (const lang of LOCALES) {
			for (const k of MICRO_KEYS) {
				const v = microOf(lang, k);
				expect(v, `${lang} menu.micro.${k}`).toBeTruthy();
				expect(v!.trim().split(/\s+/).length, `${lang} menu.micro.${k} brevity`).toBeLessThanOrEqual(2);
			}
		}
	});

	it('NO STRETCH: fixed grid tracks and a label that can never widen its cell', () => {
		expect(src).toContain('grid-template-columns: repeat(4, 1fr)');
		const gi = src.match(/\.gi \{[^}]*\}/)?.[0] ?? '';
		expect(gi).toContain('min-width: 0');
		const label = src.match(/\.gi-label \{[^}]*\}/)?.[0] ?? '';
		expect(label).toContain('white-space: nowrap');
		expect(label).toContain('text-overflow: ellipsis');
		expect(label).toContain('max-width: 100%');
	});
});
