import { describe, it, expect } from 'vitest';
import {
	parseAppleRss,
	parseKkbox,
	parseYtCharts,
	parseItunesGenreFeed,
	stripLatinAlias,
	stripReleaseSuffix,
	resizeMzstatic,
	resizeYtThumb,
	fuseCharts
} from './chart-parse';
import type { DiscoveryTrack } from '$lib/services/lastfm';
import { matchKey } from '$lib/services/match-key';
import {
	safeImageUrl,
	APPLE_IMAGE_HOSTS,
	KKBOX_IMAGE_HOSTS,
	YOUTUBE_IMAGE_HOSTS
} from '$lib/proxy/safe-image-url';
import appleHkSongs from './__fixtures__/charts/apple-hk-songs.json';
import appleHkAlbums from './__fixtures__/charts/apple-hk-albums.json';
import kkboxHkSong from './__fixtures__/charts/kkbox-hk-song.json';
import kkboxHkNewrelease from './__fixtures__/charts/kkbox-hk-newrelease.json';
import ytHkTracks from './__fixtures__/charts/yt-hk-tracks.json';
import ytHkArtists from './__fixtures__/charts/yt-hk-artists.json';
import ytCnGlobal from './__fixtures__/charts/yt-cn-global.json';
import itunesHk1251 from './__fixtures__/charts/itunes-hk-1251.json';
import itunesHk1251Single from './__fixtures__/charts/itunes-hk-1251-single.json';
import itunesBogus from './__fixtures__/charts/itunes-bogus.json';

// Fixtures are trimmed REAL upstream bodies captured 2026-09-25 (see __fixtures__/charts). Two of the
// upstreams lie with a 200 on bad input — YouTube Charts serves the GLOBAL chart for an unsupported
// country and the legacy iTunes feed serves the OVERALL chart for a bogus genre id — so those two
// gates are pinned against the real lying bodies, not hand-built ones.

const apple = (u?: string | null) => safeImageUrl(u, APPLE_IMAGE_HOSTS);
const kkbox = (u?: string | null) => safeImageUrl(u, KKBOX_IMAGE_HOSTS);
const youtube = (u?: string | null) => safeImageUrl(u, YOUTUBE_IMAGE_HOSTS);

const GARBAGE: unknown[] = [null, undefined, {}, [], 'garbage', 42];

describe('resizeMzstatic', () => {
	it('rewrites any NxNbb size segment to 600x600bb', () => {
		expect(resizeMzstatic('https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg')).toBe(
			'https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.jpg'
		);
		expect(resizeMzstatic('https://is1-ssl.mzstatic.com/image/thumb/a/170x170bb.png')).toBe(
			'https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.png'
		);
	});

	it('honours an explicit px', () => {
		expect(resizeMzstatic('https://is1-ssl.mzstatic.com/a/100x100bb.jpg', 300)).toBe(
			'https://is1-ssl.mzstatic.com/a/300x300bb.jpg'
		);
	});

	it('is null for null / undefined / empty', () => {
		expect(resizeMzstatic(null)).toBeNull();
		expect(resizeMzstatic(undefined)).toBeNull();
		expect(resizeMzstatic('')).toBeNull();
	});
});

describe('resizeYtThumb', () => {
	it('upsizes a googleusercontent =wN-hN thumbnail to 544', () => {
		expect(resizeYtThumb('https://yt3.googleusercontent.com/abc=w180-h180-l90-rj')).toBe(
			'https://yt3.googleusercontent.com/abc=w544-h544-l90-rj'
		);
	});

	it('leaves size-less and i.ytimg urls untouched, and is null-safe', () => {
		expect(resizeYtThumb('https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe(
			'https://i.ytimg.com/vi/x/hqdefault.jpg'
		);
		expect(resizeYtThumb('https://lh3.googleusercontent.com/x')).toBe(
			'https://lh3.googleusercontent.com/x'
		);
		expect(resizeYtThumb(null)).toBeNull();
	});
});

describe('stripLatinAlias', () => {
	it('drops a trailing ASCII alias from a non-ASCII name', () => {
		expect(stripLatinAlias('田馥甄 (Hebe)')).toBe('田馥甄');
		expect(stripLatinAlias('五月天 (Mayday)')).toBe('五月天');
	});

	it('leaves ASCII-only names and a bare alias untouched', () => {
		expect(stripLatinAlias('Taylor Swift (Deluxe)')).toBe('Taylor Swift (Deluxe)');
		expect(stripLatinAlias('(Hebe)')).toBe('(Hebe)');
	});

	it('trims, and handles the empty string', () => {
		expect(stripLatinAlias('  周杰倫 ')).toBe('周杰倫');
		expect(stripLatinAlias('')).toBe('');
	});
});

describe('stripReleaseSuffix', () => {
	it("drops ' - EP' / ' - Single' case-insensitively", () => {
		expect(stripReleaseSuffix('Short n Sweet - EP')).toBe('Short n Sweet');
		expect(stripReleaseSuffix('Song - Single')).toBe('Song');
		expect(stripReleaseSuffix('X - ep')).toBe('X');
	});

	it('keeps any other dash suffix', () => {
		expect(stripReleaseSuffix('Show - Live')).toBe('Show - Live');
	});
});

describe('parseAppleRss', () => {
	it('maps songs to DiscoveryTrack with a 600px mzstatic cover', () => {
		const items = parseAppleRss(appleHkSongs, 'songs', apple);
		expect(items.length).toBeGreaterThanOrEqual(1);
		expect(items.length).toBeLessThanOrEqual(50);
		for (const t of items) {
			expect(t.artist).not.toBe('');
			expect(t.title).not.toBe('');
			expect(t.mbid).toBeNull();
			if (t.image !== null) expect(t.image).toMatch(/^https:\/\/.*\/600x600bb\./);
		}
	});

	it("maps albums to { name, artist, image } with ' - EP' / ' - Single' stripped", () => {
		const items = parseAppleRss(appleHkAlbums, 'albums', apple);
		expect(items.length).toBe(appleHkAlbums.feed.results.length);
		for (const a of items) {
			expect(Object.keys(a).sort()).toEqual(['artist', 'image', 'name']);
			expect(a.name).not.toMatch(/ - (EP|Single)$/);
		}
		expect(items.map((a) => a.name)).toContain('Fallen Angel');
	});
});

describe('parseKkbox', () => {
	it('strips the Latin alias from artists and keeps i.kfs.io covers', () => {
		const items = parseKkbox(kkboxHkSong, 'song', kkbox);
		expect(items.length).toBe(kkboxHkSong.data.charts.song.length);
		for (const t of items) {
			expect(stripLatinAlias(t.artist)).toBe(t.artist);
			expect(t.image).toMatch(/^https:\/\/i\.kfs\.io\//);
			expect(t.mbid).toBeNull();
		}
		expect(items.map((t) => t.artist)).toContain('李佳薇');
	});

	it('reads the newrelease bucket, and a missing bucket is [] not a throw', () => {
		expect(parseKkbox(kkboxHkNewrelease, 'newrelease', kkbox).length).toBeGreaterThanOrEqual(1);
		expect(parseKkbox(kkboxHkSong, 'newrelease', kkbox)).toEqual([]);
	});
});

describe('parseYtCharts', () => {
	it("maps tracks with artists joined by ', ' and a 544px allowlisted cover", () => {
		const items = parseYtCharts(ytHkTracks, 'hk', 'tracks', youtube);
		expect(items.length).toBeGreaterThanOrEqual(1);
		expect(items.map((t) => t.artist)).toContain('米爺, 黃淑蔓');
		for (const t of items) {
			expect(t.title).not.toBe('');
			expect(t.mbid).toBeNull();
			expect(t.image).not.toBeNull();
			if (t.image?.includes('googleusercontent')) expect(t.image).toContain('=w544-h544');
		}
	});

	it('maps artists to { name, image, mbid: null }', () => {
		const items = parseYtCharts(ytHkArtists, 'hk', 'artists', youtube);
		expect(items.length).toBeGreaterThanOrEqual(1);
		for (const a of items) {
			expect(Object.keys(a).sort()).toEqual(['image', 'mbid', 'name']);
			expect(a.name).not.toBe('');
			expect(a.mbid).toBeNull();
		}
		expect(items[0].name).toBe('陳奕迅');
	});

	it("returns [] when the echoed countryCode is 'global' (unsupported-country fallback 200)", () => {
		expect(
			ytCnGlobal.contents.sectionListRenderer.contents[0].musicAnalyticsSectionRenderer.content
				.perspectiveMetadata.requestParams.chartParams.countryCode
		).toBe('global');
		expect(parseYtCharts(ytCnGlobal, 'cn', 'tracks', youtube)).toEqual([]);
	});

	it('returns [] when the echo is a different real country', () => {
		expect(parseYtCharts(ytHkTracks, 'tw', 'tracks', youtube)).toEqual([]);
		expect(parseYtCharts(ytHkArtists, 'tw', 'artists', youtube)).toEqual([]);
	});
});

describe('parseItunesGenreFeed', () => {
	it('keeps only rows whose category im:id equals the requested genre, at 600px', () => {
		const onGenre = itunesHk1251.feed.entry.filter(
			(e) => e.category.attributes['im:id'] === '1251'
		).length;
		const items = parseItunesGenreFeed(itunesHk1251, 1251, apple);
		expect(items.length).toBe(onGenre);
		for (const t of items) {
			expect(t.artist).not.toBe('');
			expect(t.title).not.toBe('');
			expect(t.image).toMatch(/\/600x600bb\.(png|jpg)$/);
		}
	});

	it('returns [] for a bogus genre id (the overall-chart 200)', () => {
		expect(parseItunesGenreFeed(itunesBogus, 99999, apple)).toEqual([]);
	});

	it('parses a single-entry feed whose entry is an OBJECT, not an array', () => {
		expect(Array.isArray(itunesHk1251Single.feed.entry)).toBe(false);
		expect(parseItunesGenreFeed(itunesHk1251Single, 1251, apple).length).toBe(1);
	});
});

describe('every parser never throws on garbage', () => {
	it.each(GARBAGE.map((g) => [JSON.stringify(g) ?? 'undefined', g]))('returns [] for %s', (_l, g) => {
		expect(parseAppleRss(g, 'songs', apple)).toEqual([]);
		expect(parseAppleRss(g, 'albums', apple)).toEqual([]);
		expect(parseKkbox(g, 'song', kkbox)).toEqual([]);
		expect(parseYtCharts(g, 'hk', 'tracks', youtube)).toEqual([]);
		expect(parseYtCharts(g, 'hk', 'artists', youtube)).toEqual([]);
		expect(parseItunesGenreFeed(g, 1251, apple)).toEqual([]);
	});
});

describe('fuseCharts (39-D-07 / P39-13)', () => {
	const tr = (artist: string, title: string, image: string | null = null): DiscoveryTrack => ({
		artist,
		title,
		image,
		mbid: null
	});
	const a = [tr('A1', 'one'), tr('Shared', 'song'), tr('A3', 'three')];
	const b = [tr('shared', 'Song'), tr('B2', 'two'), tr('B3', 'three b')];

	it('ranks a song on both charts above every single-chart song, each song once', () => {
		const out = fuseCharts([a, b]);
		expect(out[0].title).toBe('song');
		expect(out).toHaveLength(5);
		expect(new Set(out.map((t) => matchKey(t.artist, t.title))).size).toBe(5);
	});

	it("keeps the FIRST list's display strings on overlap (Apple precedence)", () => {
		const apple = [tr('田馥甄', '要去什麼地方')];
		const kkbox = [tr('田馥甄 (Hebe)', '要去什麼地方')];
		expect(fuseCharts([apple, kkbox])).toEqual([tr('田馥甄', '要去什麼地方')]);
		expect(fuseCharts([kkbox, apple])[0].artist).toBe('田馥甄 (Hebe)');
	});

	it('takes the first non-null image across the group without mutating inputs', () => {
		const apple = [tr('X', 'y', null)];
		const kkbox = [tr('X', 'y', 'https://i.kfs.io/a.jpg')];
		expect(fuseCharts([apple, kkbox])[0].image).toBe('https://i.kfs.io/a.jpg');
		expect(apple[0].image).toBeNull();
	});

	it('passes one list through unchanged when the other is empty', () => {
		expect(fuseCharts([[], a])).toEqual(a);
		expect(fuseCharts([a, []])).toEqual(a);
		expect(fuseCharts([[], []])).toEqual([]);
		expect(fuseCharts([])).toEqual([]);
	});

	it("skips a row whose match key is blank ('|')", () => {
		const out = fuseCharts([[tr('', ''), tr('  ', '!!'), tr('A', 'b')]]);
		expect(out).toEqual([tr('A', 'b')]);
	});

	it('caps the result (default 50)', () => {
		const left = Array.from({ length: 50 }, (_, i) => tr(`L${i}`, `l${i}`));
		const right = Array.from({ length: 50 }, (_, i) => tr(`R${i}`, `r${i}`));
		expect(fuseCharts([left, right])).toHaveLength(50);
		expect(fuseCharts([left, right], 60, 3)).toHaveLength(3);
	});

	it('breaks score ties by first appearance (stable)', () => {
		const out = fuseCharts([
			[tr('X1', 'x'), tr('X2', 'x')],
			[tr('Y1', 'y'), tr('Y2', 'y')]
		]);
		expect(out.map((t) => t.artist)).toEqual(['X1', 'Y1', 'X2', 'Y2']);
	});

	it("folds a KKBOX ' - subtitle' / 《…》 tail out of the fusion key, keeping Apple's display title (39-D-44)", () => {
		// Real HK pair (2026-09-25): KKBOX carries the subtitle Apple drops.
		const apple = [tr('李佳薇', '甲乙丙丁Strangers')];
		const kkbox = [tr('李佳薇', '甲乙丙丁Strangers - 你我怎麼兩清')];
		expect(fuseCharts([apple, kkbox])).toEqual([tr('李佳薇', '甲乙丙丁Strangers')]);
		expect(fuseCharts([[tr('X', '歌')], [tr('X', '歌《電影》主題曲')]])).toHaveLength(1);
		expect(fuseCharts([[tr('X', '歌')], [tr('X', '歌（電視劇片尾曲）')]])).toHaveLength(1);
		// A title that IS the tail keeps its own key instead of blanking (and being skipped).
		expect(fuseCharts([[tr('X', '《追》')]])).toEqual([tr('X', '《追》')]);
	});

	it('takes k as a parameter and still ranks the overlap first', () => {
		expect(fuseCharts([a, b], 1)[0].title).toBe('song');
	});

	it('fuses the real Apple + KKBOX HK fixtures into a unique, capped list', () => {
		const out = fuseCharts([
			parseAppleRss(appleHkSongs, 'songs', apple),
			parseKkbox(kkboxHkSong, 'song', kkbox)
		]);
		expect(out.length).toBeGreaterThan(0);
		expect(out.length).toBeLessThanOrEqual(50);
		const keys = out.map((t) => matchKey(t.artist, t.title));
		expect(new Set(keys).size).toBe(keys.length);
	});
});
