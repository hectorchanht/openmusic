// Workstream H batch 2 — nav / tabs / transport ICON-label regression pins
// (NO SILENT BREAKAGE). Hector 2026-11-23 22:08 (Dawn-Design §8 v1.6): every UI
// label an icon can carry IS an icon; words survive only as aria-label (+ title).
// These pins FAIL if the app tabbar, the charts Songs/Artists toggle, or the
// artist-discography filter chips ever render their labels as visible text
// again, if the accessible names are dropped, or if the fixed icon geometry
// (NO STRETCH) moves. Transport (NowPlaying five-control row + Nowbar) was
// already icon-only — pinned here so it can never regress to text.
// Source pins follow the repo's established pattern (no jsdom in this project).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const layout = readFileSync('src/routes/(app)/+layout.svelte', 'utf-8');
const charts = readFileSync('src/routes/(app)/charts/top/+page.svelte', 'utf-8');
const albums = readFileSync('src/routes/(app)/artist/[name]/albums/+page.svelte', 'utf-8');
const nowPlaying = readFileSync('src/lib/components/NowPlaying.svelte', 'utf-8');
const nowbar = readFileSync('src/lib/components/Nowbar.svelte', 'utf-8');

describe('H batch 2 — app tabbar is icon-only', () => {
	it('tab anchor carries the label as aria-label + title, never as visible text', () => {
		expect(layout).toContain('aria-label={t(tab.labelKey)}');
		expect(layout).toContain('title={t(tab.labelKey)}');
		expect(layout).not.toContain('</span>{t(tab.labelKey)}');
	});
	it('tab icon span and active-fill idiom are unchanged', () => {
		expect(layout).toContain('<span class="ic"><Icon size={20}');
		expect(layout).toContain("aria-current={active ? 'page' : undefined}");
	});
});

describe('H batch 2 — charts Songs/Artists toggle is icon-only', () => {
	it('Songs = Music2, Artists = Users, names kept as aria-label + title', () => {
		expect(charts).toContain("import { Music2, Users } from '@lucide/svelte'");
		expect(charts).toContain('<Music2 size={18} />');
		expect(charts).toContain('<Users size={18} />');
		expect(charts).toContain("aria-label={t('charts.topTracksTab')}");
		expect(charts).toContain("aria-label={t('charts.topArtistsTab')}");
		expect(charts).not.toContain("{t('charts.topTracksTab')}\n\t</button>");
		expect(charts).not.toContain("{t('charts.topArtistsTab')}\n\t</button>");
	});
	it('toggle geometry is a fixed 36px square (NO STRETCH)', () => {
		expect(charts).toContain('width: 36px; height: 36px;');
	});
});

describe('H batch 2 — discography filter chips are icon-only', () => {
	it('main = Disc3, single = Disc, all = LayoutGrid; names as aria-label + title', () => {
		expect(albums).toContain("icon: Disc3");
		expect(albums).toContain("icon: Disc");
		expect(albums).toContain("icon: LayoutGrid");
		expect(albums).toContain('aria-label={t(f.key)}');
		expect(albums).toContain('title={t(f.key)}');
		expect(albums).not.toContain('use:tapBounce>{t(f.key)}</button');
	});
	it('chip geometry is a fixed 32px square (NO STRETCH)', () => {
		expect(albums).toContain('width: 32px; height: 32px;');
	});
});

describe('H batch 2 — transport stays icon-only (already shipped, pinned)', () => {
	it('NowPlaying five-control row: like/prev/play/next/download, all aria-labelled glyphs', () => {
		expect(nowPlaying).toContain("aria-label={t('nowplaying.previous')}");
		expect(nowPlaying).toContain("aria-label={t('nowplaying.next')}");
		expect(nowPlaying).toContain("aria-label={t('nowplaying.playPause')}");
		expect(nowPlaying).toContain('<SkipBack size={26} />');
		expect(nowPlaying).toContain('<SkipForward size={26} />');
		expect(nowPlaying).toContain('<DownloadControl track={player.current} size={20}/>');
	});
	it('Nowbar transport buttons keep aria-labels and glyphs', () => {
		expect(nowbar).toContain('aria-label={t("nowbar.playPause")}');
		expect(nowbar).toContain('aria-label={t("nowplaying.previous")}');
		expect(nowbar).toContain('aria-label={t("nowplaying.next")}');
	});
});
