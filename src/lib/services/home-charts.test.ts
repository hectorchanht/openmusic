import { describe, it, expect } from 'vitest';
import {
	planChartShelves,
	poolKey,
	genrePoolKey,
	samplePicks,
	regionLabel,
	regionListLabel,
	chartAlbumHref,
	CHART_GENRE_LABEL,
	HOME_CACHE_KEY,
	LEGACY_HOME_CACHE_KEYS,
	POOL_STALE_MS,
	POOL_CAP,
	type ChartPlanConfig,
	type ChartTask
} from './home-charts';
import { DEFAULT_CHART_GENRES, CHART_SECTIONS, CHART_REGIONS, KKBOX_REGIONS, YT_REGIONS, CHART_GENRE_IDS } from './home-layout';

// Everything here is deterministic except samplePicks, whose randomness is asserted only as
// "more than one distinct result over 200 draws" — never a specific permutation. The planner
// tests ARE the "a hidden section issues zero requests" guarantee (T-39-21): no task, no fetch.

const cfg = (over: Partial<ChartPlanConfig> = {}): ChartPlanConfig => ({
	region: 'hk',
	extraRegions: [],
	genres: [...DEFAULT_CHART_GENRES],
	hidden: [],
	...over
});

const keysOf = (tasks: ChartTask[]) => tasks.map((t) => t.key).sort();

describe('poolKey / genrePoolKey', () => {
	it('region-qualifies the section key', () => {
		expect(poolKey('chart-songs', 'hk')).toBe('chart-songs:hk');
		expect(poolKey('region', 'jp')).toBe('region:jp');
	});
	it('keys a genre pool by genre alone', () => {
		expect(genrePoolKey('kpop')).toBe('genre:kpop');
	});
});

describe('planChartShelves', () => {
	// quick-260925-vtg: counts are non-genre tasks + DEFAULT_CHART_GENRES.length, and the default
	// genre set went 8 → 11, so each count below moved by 3.
	it('plans 17 tasks for a KKBOX region with every section visible', () => {
		const tasks = planChartShelves(cfg());
		expect(tasks).toHaveLength(17);
		expect(keysOf(tasks)).toEqual(
			[
				'chart-songs:hk',
				'chart-songs:hk',
				'new-releases:hk',
				'chart-artists:hk',
				'chart-albums:hk',
				'yt-trending:hk',
				...DEFAULT_CHART_GENRES.map((g) => `genre:${g}`)
			].sort()
		);
	});

	it('fuses two chart-songs tasks (kkbox + apple) under ONE key in a KKBOX region', () => {
		const songs = planChartShelves(cfg()).filter((t) => t.section === 'chart-songs');
		expect(songs).toHaveLength(2);
		expect(new Set(songs.map((t) => t.key))).toEqual(new Set(['chart-songs:hk']));
		expect(songs).toContainEqual({ key: 'chart-songs:hk', section: 'chart-songs', src: 'kkbox', kind: 'song', cc: 'hk' });
		expect(songs).toContainEqual({ key: 'chart-songs:hk', section: 'chart-songs', src: 'apple', kind: 'songs', cc: 'hk' });
	});

	it('maps each other section to its source', () => {
		const tasks = planChartShelves(cfg());
		expect(tasks.find((t) => t.section === 'new-releases')).toMatchObject({ src: 'kkbox', kind: 'newrelease', cc: 'hk' });
		expect(tasks.find((t) => t.section === 'chart-artists')).toMatchObject({ src: 'yt', kind: 'artists', cc: 'hk' });
		expect(tasks.find((t) => t.section === 'chart-albums')).toMatchObject({ src: 'apple', kind: 'albums', cc: 'hk' });
		expect(tasks.find((t) => t.section === 'yt-trending')).toMatchObject({ src: 'yt', kind: 'tracks', cc: 'hk' });
	});

	it('emits genre tasks in the given genre order', () => {
		const genres = planChartShelves(cfg()).filter((t) => t.section === 'genres');
		expect(genres.map((t) => t.key)).toEqual(DEFAULT_CHART_GENRES.map((g) => `genre:${g}`));
		expect(genres[0]).toEqual({ key: 'genre:cantopop', section: 'genres', src: 'genre', genre: 'cantopop' });
	});

	it('plans 15 tasks for a non-KKBOX region, chart-songs exactly once (apple) (quick-260925-vtg: 11 genres)', () => {
		const tasks = planChartShelves(cfg({ region: 'us' }));
		expect(tasks).toHaveLength(15);
		const songs = tasks.filter((t) => t.key === 'chart-songs:us');
		expect(songs).toEqual([{ key: 'chart-songs:us', section: 'chart-songs', src: 'apple', kind: 'songs', cc: 'us' }]);
	});

	it('plans no new-releases task outside hk/tw/sg (us)', () => {
		const tasks = planChartShelves(cfg({ region: 'us' }));
		expect(tasks.some((t) => t.section === 'new-releases')).toBe(false);
		expect(keysOf(tasks)).not.toContain('new-releases:us');
	});

	it('plans new-releases for every KKBOX region', () => {
		for (const cc of KKBOX_REGIONS) {
			expect(planChartShelves(cfg({ region: cc })).map((t) => t.key)).toContain(`new-releases:${cc}`);
		}
	});

	it('a hidden section emits no task (zero requests)', () => {
		const tasks = planChartShelves(cfg({ hidden: ['chart-songs', 'genres'] }));
		expect(tasks.some((t) => t.section === 'chart-songs' || t.section === 'genres')).toBe(false);
		expect(tasks.map((t) => t.section)).toEqual(['new-releases', 'chart-artists', 'chart-albums', 'yt-trending']);
	});

	it('every section hidden → no tasks at all', () => {
		expect(planChartShelves(cfg({ hidden: [...CHART_SECTIONS], extraRegions: ['tw', 'jp'] }))).toEqual([]);
	});

	it('hiding a classic section id does not affect chart tasks (quick-260925-vtg: 17 with 11 genres)', () => {
		expect(planChartShelves(cfg({ hidden: ['top-hits', 'tags'] }))).toHaveLength(17);
	});

	it('adds one apple songs task per extra region, in order', () => {
		const regions = planChartShelves(cfg({ extraRegions: ['tw', 'jp'] })).filter((t) => t.section === 'regions');
		expect(regions).toEqual([
			{ key: 'region:tw', section: 'regions', src: 'apple', kind: 'songs', cc: 'tw' },
			{ key: 'region:jp', section: 'regions', src: 'apple', kind: 'songs', cc: 'jp' }
		]);
	});

	it('hidden regions → no extra-region tasks', () => {
		const tasks = planChartShelves(cfg({ extraRegions: ['tw'], hidden: ['regions'] }));
		expect(tasks.some((t) => t.section === 'regions')).toBe(false);
	});

	it('empty genres → no genre tasks', () => {
		expect(planChartShelves(cfg({ genres: [] })).some((t) => t.section === 'genres')).toBe(false);
	});

	it('orders tasks by CHART_SECTIONS (chart-songs first, regions last)', () => {
		const tasks = planChartShelves(cfg({ extraRegions: ['jp'] }));
		const rank = (t: ChartTask) => CHART_SECTIONS.indexOf(t.section);
		const ranks = tasks.map(rank);
		expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
		expect(tasks[0].section).toBe('chart-songs');
		expect(tasks.at(-1)?.section).toBe('regions');
	});

	it('never emits an unallowlisted cc for any region', () => {
		for (const region of CHART_REGIONS) {
			for (const t of planChartShelves(cfg({ region, extraRegions: ['jp'] }))) {
				if ('cc' in t) expect(CHART_REGIONS).toContain(t.cc);
				if (t.src === 'kkbox') expect(KKBOX_REGIONS).toContain(t.cc);
				if (t.src === 'yt') expect(YT_REGIONS).toContain(t.cc);
				if (t.src === 'genre') expect(CHART_GENRE_IDS).toContain(t.genre);
			}
		}
	});
});

describe('samplePicks', () => {
	it('returns n unique ascending (sorted chart-rank order) indices in range', () => {
		const out = samplePicks(50, 24);
		expect(out).toHaveLength(24);
		for (const i of out) {
			expect(Number.isInteger(i)).toBe(true);
			expect(i).toBeGreaterThanOrEqual(0);
			expect(i).toBeLessThan(50);
		}
		for (let k = 1; k < out.length; k++) expect(out[k]).toBeGreaterThan(out[k - 1]);
	});

	it('returns every index when the pool is smaller than n', () => {
		expect(samplePicks(10, 24)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it('returns [] for an empty pool, zero or negative n', () => {
		expect(samplePicks(0, 5)).toEqual([]);
		expect(samplePicks(5, 0)).toEqual([]);
		expect(samplePicks(50, -1)).toEqual([]);
	});

	it('draws randomly (more than one distinct result over 200 runs)', () => {
		const seen = new Set<string>();
		for (let r = 0; r < 200; r++) seen.add(samplePicks(50, 24).join(','));
		expect(seen.size).toBeGreaterThanOrEqual(2);
	});
});

describe('regionLabel / regionListLabel', () => {
	it('uses the short Intl.DisplayNames style', () => {
		expect(regionLabel('hk', 'en')).toBe('Hong Kong');
		expect(regionLabel('us', 'en')).toBe('US');
	});

	it('localizes into Chinese scripts', () => {
		expect(regionLabel('hk', 'zh-Hant')).toBe('香港');
		expect(regionLabel('tw', 'zh-Hans')).toBe('台湾');
	});

	it('never throws on an unknown region or a bad language tag', () => {
		expect(regionLabel('xx', 'en').length).toBeGreaterThan(0);
		expect(() => regionLabel('hk', 'not-a-lang')).not.toThrow();
		expect(regionLabel('hk', '!!')).toBe('HK');
	});

	it('joins region names with Intl.ListFormat', () => {
		expect(regionListLabel(['tw', 'jp', 'kr'], 'en')).toBe('Taiwan, Japan, South Korea');
		expect(regionListLabel(['hk'], 'en')).toBe('Hong Kong');
		expect(regionListLabel([], 'en')).toBe('');
	});

	it('falls back to a comma join on a bad language tag', () => {
		expect(regionListLabel(['hk', 'tw'], '!!')).toBe('HK, TW');
	});
});

describe('chartAlbumHref', () => {
	it('strips a " - EP" / " - Single" suffix into the name-only album URL', () => {
		expect(chartAlbumHref({ name: 'Short n Sweet - EP', artist: 'Sabrina Carpenter', image: null })).toBe(
			'/album/Short%20n%20Sweet?artist=Sabrina%20Carpenter'
		);
		expect(chartAlbumHref({ name: 'Espresso - Single', artist: 'Sabrina Carpenter', image: null })).toBe(
			'/album/Espresso?artist=Sabrina%20Carpenter'
		);
	});

	it('leaves a suffix-free name unchanged apart from encoding, with no dzid/mbid', () => {
		const href = chartAlbumHref({ name: 'GNX', artist: 'Kendrick Lamar', image: 'https://x/y.jpg' });
		expect(href).toBe('/album/GNX?artist=Kendrick%20Lamar');
		expect(href).not.toMatch(/&dzid=|&mbid=/);
	});
});

describe('constants', () => {
	it('CHART_GENRE_LABEL maps every genre id to home.genre.<id>', () => {
		expect(Object.keys(CHART_GENRE_LABEL).sort()).toEqual([...CHART_GENRE_IDS].sort());
		for (const id of CHART_GENRE_IDS) expect(CHART_GENRE_LABEL[id]).toBe(`home.genre.${id}`);
	});

	it('pins the home cache key, its legacy keys and the pool tunables', () => {
		expect(HOME_CACHE_KEY).toBe('openmusic:top-picks:v3');
		expect(LEGACY_HOME_CACHE_KEYS).toEqual(['openmusic:top-picks:v1', 'openmusic:top-picks:v2']);
		expect(POOL_STALE_MS).toBe(21600000);
		expect(POOL_CAP).toBe(50);
	});
});
