import { describe, it, expect } from 'vitest';
import {
	DISCOVERY_TAGS,
	DEFAULT_HOME_TAGS,
	HOME_SECTIONS,
	DEFAULT_SECTION_ORDER,
	resolveSectionOrder,
	resolveSubset,
	resolveSectionDensity,
	migrateDensity,
	clampShelfSize,
	SHELF_MIN,
	SHELF_MAX,
	SHELF_DEFAULT,
	LANDING_PATHS,
	CLASSIC_SECTIONS,
	CHART_SECTIONS,
	CHART_REGIONS,
	KKBOX_REGIONS,
	YT_REGIONS,
	resolveChartRegion,
	resolveExtraRegions,
	CHART_GENRE_IDS,
	CHART_GENRES,
	DEEZER_GENRE_IDS,
	DEFAULT_CHART_GENRES,
	resolveChartGenres,
	HOME_LAYOUT_VERSION,
	migrateHomeLayout,
	reorderListed,
	type HomeSectionId
} from './home-layout';

// home-layout.ts is a PURE config-resolution module (no runes, no browser, runs in the
// node Vitest project alongside discovery.test.ts). It guards the home render against a
// corrupt/old persisted config (quick-260606-w87 — threats T-w87-01/02/03/05): a poisoned
// shelf size, an unknown section id, or a tag no longer in the pool must NEVER break the
// render — they clamp / drop / fall back to defaults. These tests are fully deterministic.

describe('HOME_SECTIONS / DEFAULT_SECTION_ORDER', () => {
	it('is the seventeen home section ids in canonical order (39-D-08: chart block after radio, classic block after charts)', () => {
		expect(HOME_SECTIONS).toEqual([
			'liked',
			'downloads',
			'radio',
			'chart-songs',
			'new-releases',
			'chart-artists',
			'chart-albums',
			'yt-trending',
			'genres',
			'regions',
			'top-hits',
			'top-artists',
			'tags',
			'countries',
			'fav-artists',
			'playlists',
			'history'
		]);
	});

	it("DEFAULT_SECTION_ORDER is the user's exported order (quick-260925-vtg)", () => {
		expect(DEFAULT_SECTION_ORDER).toEqual([
			'radio',
			'downloads',
			'liked',
			'chart-songs',
			'new-releases',
			'chart-artists',
			'chart-albums',
			'yt-trending',
			'genres',
			'top-hits',
			'top-artists',
			'regions',
			'tags',
			'countries',
			'fav-artists',
			'playlists',
			'history'
		]);
	});

	it('DEFAULT_SECTION_ORDER is a permutation of all 17 HOME_SECTIONS ids (quick-260925-vtg — resolveSectionOrder returns it verbatim)', () => {
		expect([...DEFAULT_SECTION_ORDER].sort()).toEqual([...HOME_SECTIONS].sort());
		expect(new Set(DEFAULT_SECTION_ORDER).size).toBe(17);
	});

	it('DEFAULT_SECTION_ORDER is a distinct array (not the same ref — safe to spread)', () => {
		expect(DEFAULT_SECTION_ORDER).not.toBe(HOME_SECTIONS);
	});

	it('CLASSIC_SECTIONS + CHART_SECTIONS are disjoint subsets of HOME_SECTIONS', () => {
		expect(CLASSIC_SECTIONS).toEqual(['top-hits', 'top-artists', 'tags', 'countries']);
		expect(CHART_SECTIONS).toEqual([
			'chart-songs',
			'new-releases',
			'chart-artists',
			'chart-albums',
			'yt-trending',
			'genres',
			'regions'
		]);
		for (const id of [...CLASSIC_SECTIONS, ...CHART_SECTIONS]) expect(HOME_SECTIONS).toContain(id);
		expect(CLASSIC_SECTIONS.some((id) => (CHART_SECTIONS as readonly string[]).includes(id))).toBe(false);
	});
});

describe('resolveSectionOrder', () => {
	it('undefined → DEFAULT_SECTION_ORDER (deep-equal, new array)', () => {
		const r = resolveSectionOrder(undefined);
		expect(r).toEqual(DEFAULT_SECTION_ORDER);
		expect(r).not.toBe(DEFAULT_SECTION_ORDER);
	});

	it('empty → DEFAULT_SECTION_ORDER (deep-equal, new array)', () => {
		const r = resolveSectionOrder([]);
		expect(r).toEqual(DEFAULT_SECTION_ORDER);
		expect(r).not.toBe(DEFAULT_SECTION_ORDER);
	});

	it('corrupt (non-array) → DEFAULT_SECTION_ORDER', () => {
		// @ts-expect-error — deliberately passing a corrupt persisted value
		expect(resolveSectionOrder('bogus')).toEqual(DEFAULT_SECTION_ORDER);
		// @ts-expect-error — deliberately passing a corrupt persisted value
		expect(resolveSectionOrder(42)).toEqual(DEFAULT_SECTION_ORDER);
	});

	it('keeps the saved order then appends the 15 missing known ids in canonical order', () => {
		expect(resolveSectionOrder(['top-hits', 'liked'])).toEqual([
			'top-hits',
			'liked',
			// missing ids appended in canonical (HOME_SECTIONS) order
			'downloads',
			'radio',
			'chart-songs',
			'new-releases',
			'chart-artists',
			'chart-albums',
			'yt-trending',
			'genres',
			'regions',
			'top-artists',
			'tags',
			'countries',
			'fav-artists',
			'playlists',
			'history'
		]);
	});

	it('drops ids not in HOME_SECTIONS (unknown/old ids ignored) and still covers every id', () => {
		expect(resolveSectionOrder(['bogus', 'tags'])).toEqual([
			'tags',
			'liked',
			'downloads',
			'radio',
			'chart-songs',
			'new-releases',
			'chart-artists',
			'chart-albums',
			'yt-trending',
			'genres',
			'regions',
			'top-hits',
			'top-artists',
			'countries',
			'fav-artists',
			'playlists',
			'history'
		]);
	});

	it('de-dupes a repeated saved id (a known id appears at most once)', () => {
		const r = resolveSectionOrder(['tags', 'tags', 'top-hits']);
		expect(r.slice(0, 2)).toEqual(['tags', 'top-hits']);
		expect(r.filter((id) => id === 'tags')).toHaveLength(1);
		expect(r).toHaveLength(HOME_SECTIONS.length);
	});

	it('a full valid permutation is returned as-is', () => {
		const order = [
			'tags',
			'countries',
			'top-artists',
			'top-hits',
			'regions',
			'genres',
			'yt-trending',
			'chart-albums',
			'chart-artists',
			'new-releases',
			'chart-songs',
			'liked',
			'downloads',
			'radio',
			'fav-artists',
			'playlists',
			'history'
		];
		expect(resolveSectionOrder(order)).toEqual(order);
	});

	it('kmn: legacy saved order without fav-artists has it appended (existing-user upgrade path)', () => {
		const legacy = ['liked', 'downloads', 'top-hits', 'top-artists', 'tags', 'countries', 'playlists', 'history'];
		const r = resolveSectionOrder(legacy);
		expect(r).toContain('fav-artists');
		// User's saved order preserved, the ids it lacks appended in canonical order (after history
		// here) — quick-260924-pgu: 'radio' is one of them, which is how existing users gain the shelf.
		// 39-D-08: the chart ids are appended too at render time; migrateHomeLayout (39-D-11) is what
		// moves them up to the old chart block, once, at load.
		expect(r.slice(0, legacy.length)).toEqual(legacy);
		expect(r.slice(legacy.length)).toEqual(['radio', ...CHART_SECTIONS, 'fav-artists']);
	});
});

describe('resolveSubset', () => {
	const POOL = ['pop', 'rock', 'electronic', 'jazz'];

	it('undefined → the full pool (default = everything, preserves today)', () => {
		expect(resolveSubset(undefined, POOL)).toEqual(POOL);
	});

	it('empty selection → the full pool (fall-back-to-full rule)', () => {
		expect(resolveSubset([], POOL)).toEqual(POOL);
	});

	it('all selections invalid → the full pool (never a blank surface)', () => {
		expect(resolveSubset(['bogus', 'nope'], POOL)).toEqual(POOL);
	});

	it('filters to pool members, dropping ones not in the pool', () => {
		expect(resolveSubset(['rock', 'bogus'], POOL)).toEqual(['rock']);
	});

	it('result order follows SELECTION order (drives home shelf order), de-duped', () => {
		expect(resolveSubset(['jazz', 'pop'], POOL)).toEqual(['jazz', 'pop']);
		expect(resolveSubset(['pop', 'jazz', 'pop'], POOL)).toEqual(['pop', 'jazz']);
	});

	it('corrupt (non-array) selection → the full pool', () => {
		// @ts-expect-error — deliberately passing a corrupt persisted value
		expect(resolveSubset('rock', POOL)).toEqual(POOL);
	});

	it('does not mutate the pool', () => {
		const pool = [...POOL];
		resolveSubset(['rock'], pool);
		expect(pool).toEqual(POOL);
	});
});

describe('clampShelfSize', () => {
	it('clamps a too-large value down to SHELF_MAX', () => {
		expect(clampShelfSize(100)).toBe(SHELF_MAX);
		expect(clampShelfSize(100)).toBe(24);
	});

	it('clamps a too-small value up to SHELF_MIN', () => {
		expect(clampShelfSize(2)).toBe(SHELF_MIN);
		expect(clampShelfSize(2)).toBe(8);
	});

	it('passes a valid value through', () => {
		expect(clampShelfSize(18)).toBe(18);
		expect(clampShelfSize(SHELF_DEFAULT)).toBe(24);
	});

	it('floors a fractional value', () => {
		expect(clampShelfSize(12.7)).toBe(12);
	});

	it('non-number / NaN / undefined → SHELF_DEFAULT', () => {
		// clampShelfSize takes `unknown`, so a corrupt string is a runtime concern, not a type one.
		expect(clampShelfSize('x')).toBe(SHELF_DEFAULT);
		expect(clampShelfSize(undefined)).toBe(SHELF_DEFAULT);
		expect(clampShelfSize(NaN)).toBe(SHELF_DEFAULT);
		expect(clampShelfSize(SHELF_DEFAULT)).toBe(24);
	});

	it('a negative value clamps up to SHELF_MIN (never a NaN / negative page size)', () => {
		expect(clampShelfSize(-5)).toBe(SHELF_MIN);
	});

	// quick-260919-hm1: the default IS the maximum now. Asserted as a relation, not a literal,
	// so moving SHELF_MAX can never leave the default quietly below it.
	it('SHELF_DEFAULT is the maximum the slider allows', () => {
		expect(SHELF_DEFAULT).toBe(SHELF_MAX);
	});
});

describe('LANDING_PATHS', () => {
	it('maps every landing tab to a fixed in-app path (no open-redirect)', () => {
		expect(LANDING_PATHS.home).toBe('/');
		expect(LANDING_PATHS.search).toBe('/search');
		expect(LANDING_PATHS.library).toBe('/library');
	});
});

// resolveSectionDensity (HOME-02 / D-07) — per-section density override resolver. Mirrors the
// resolveSubset "unknown/garbage → fallback, never blank" posture (threats T-23-06/07): an
// attacker-influenceable persisted map must never throw and never blank the render — any
// invalid per-section value (or a missing/undefined map) falls back to the globalDefault. The
// list-by-default requirement ships by the home page passing 'list' as globalDefault.
// quick-260618-goe: density values renamed to 'list' | 'pile' | 'grid'.
describe('resolveSectionDensity (HOME-02 / D-07)', () => {
	it('a valid per-section override wins over the global default', () => {
		expect(resolveSectionDensity('tags', { tags: 'pile' }, 'list')).toBe('pile');
		expect(resolveSectionDensity('tags', { tags: 'grid' }, 'list')).toBe('grid');
	});

	it('an empty map falls back to the global default', () => {
		expect(resolveSectionDensity('tags', {}, 'list')).toBe('list');
	});

	it('a garbage per-section value falls back to the global default (never blanks)', () => {
		expect(resolveSectionDensity('tags', { tags: 'garbage' as never }, 'list')).toBe('list');
		// a now-LEGACY value is no longer accepted as a per-section override (migration is a load concern)
		expect(resolveSectionDensity('tags', { tags: 'compact' as never }, 'list')).toBe('list');
	});

	it('an undefined map falls back to the global default (never blanks)', () => {
		expect(resolveSectionDensity('tags', undefined, 'list')).toBe('list');
	});

	it('honours the global default value passed in (pile) when there is no override', () => {
		expect(resolveSectionDensity('countries', {}, 'pile')).toBe('pile');
	});
});

// migrateDensity (quick-260618-goe) — pure non-destructive migration of a persisted density
// value after the HomeDensity union was renamed. A returning user's old value must resolve to
// the same visual layout; garbage returns undefined so the caller picks the fallback.
describe('migrateDensity (quick-260618-goe)', () => {
	it('maps legacy compact → list', () => {
		expect(migrateDensity('compact')).toBe('list');
	});

	it('maps legacy comfortable → pile', () => {
		expect(migrateDensity('comfortable')).toBe('pile');
	});

	it('passes through already-new values (list / pile / grid)', () => {
		expect(migrateDensity('list')).toBe('list');
		expect(migrateDensity('pile')).toBe('pile');
		expect(migrateDensity('grid')).toBe('grid');
	});

	it('returns undefined for garbage / missing / wrong-type (caller decides the fallback)', () => {
		expect(migrateDensity('garbage')).toBeUndefined();
		expect(migrateDensity(undefined)).toBeUndefined();
		expect(migrateDensity(null)).toBeUndefined();
		expect(migrateDensity(42)).toBeUndefined();
		expect(migrateDensity({})).toBeUndefined();
	});
});

// DEFAULT_HOME_TAGS (quick-260919-hm1) — the shipped genre default is now the WHOLE pool, with
// the curated CJK/global set still at the front. Asserted against DISCOVERY_TAGS rather than a
// copied list so adding a genre to the pool without enabling it fails here.
describe('DEFAULT_HOME_TAGS (quick-260919-hm1)', () => {
	it('enables every genre in the pool, with no duplicates', () => {
		expect([...DEFAULT_HOME_TAGS].sort()).toEqual([...DISCOVERY_TAGS].sort());
		expect(new Set(DEFAULT_HOME_TAGS).size).toBe(DEFAULT_HOME_TAGS.length);
	});

	it('keeps the curated CJK/global picks at the top of the shelf order', () => {
		expect(DEFAULT_HOME_TAGS.slice(0, 2)).toEqual(['cantopop', 'mandopop']);
	});

	it('survives resolveSubset unchanged (order preserved, nothing dropped)', () => {
		expect(resolveSubset(DEFAULT_HOME_TAGS, DISCOVERY_TAGS)).toEqual(DEFAULT_HOME_TAGS);
	});
});

// resolveChartRegion (39-D-09) — the persisted Chart region is `'auto' | ChartRegion`, resolved at
// render against a CLOSED allowlist (T-39-06). 'cn' is deliberately not offered (the CN storefront's
// top-20 median age is ~22 years), so no input — saved, app language or navigator.language — can
// ever produce it.
describe('resolveChartRegion (39-D-09)', () => {
	const APP_LANGS = [
		'en',
		'zh-Hant',
		'zh-Hans',
		'es',
		'fr',
		'de',
		'pt',
		'it',
		'ru',
		'tr',
		'ar',
		'hi',
		'id',
		'vi',
		'th'
	];

	it('an explicitly saved offered region wins', () => {
		expect(resolveChartRegion('tw', 'en')).toBe('tw');
		expect(resolveChartRegion('eg', 'zh-Hant')).toBe('eg');
	});

	it("'auto' maps every app language to its verified default storefront", () => {
		const expected: Record<string, string> = {
			en: 'us',
			'zh-Hant': 'hk',
			'zh-Hans': 'tw',
			de: 'de',
			fr: 'fr',
			es: 'es',
			it: 'it',
			pt: 'br',
			ru: 'ru',
			tr: 'tr',
			th: 'th',
			vi: 'vn',
			id: 'id',
			hi: 'in',
			ar: 'sa'
		};
		for (const lang of APP_LANGS) expect(resolveChartRegion('auto', lang)).toBe(expected[lang]);
	});

	it('every one of the 15 AppLangs resolves to an offered region and never to cn', () => {
		for (const lang of APP_LANGS) {
			const r = resolveChartRegion('auto', lang);
			expect(CHART_REGIONS).toContain(r);
			expect(r).not.toBe('cn');
		}
	});

	it('an unknown app language falls back to us', () => {
		expect(resolveChartRegion('auto', 'xx')).toBe('us');
		// prototype keys are not languages (the map lookup is own-property only)
		expect(resolveChartRegion('auto', 'constructor')).toBe('us');
		expect(resolveChartRegion('auto', '__proto__')).toBe('us');
	});

	it("a saved 'cn' is never honoured — zh-Hans falls back to tw, never cn", () => {
		expect(resolveChartRegion('cn', 'zh-Hans')).toBe('tw');
	});

	it('garbage saved values fall back to the app-language default', () => {
		expect(resolveChartRegion(42, 'en')).toBe('us');
		expect(resolveChartRegion(null, 'en')).toBe('us');
		expect(resolveChartRegion(undefined, 'de')).toBe('de');
		expect(resolveChartRegion('HK', 'en')).toBe('us');
		expect(resolveChartRegion({ cc: 'hk' }, 'en')).toBe('us');
	});

	it('39-D-09b: a navigator.language region subtag in the offered list refines auto', () => {
		expect(resolveChartRegion('auto', 'zh-Hant', 'zh-TW')).toBe('tw');
		expect(resolveChartRegion('auto', 'en', 'en-GB')).toBe('gb');
		expect(resolveChartRegion('auto', 'zh-Hant', 'zh-Hant-HK')).toBe('hk');
		expect(resolveChartRegion('auto', 'en', 'en_AU')).toBe('au');
	});

	it('a navigator.language region that is not offered never yields cn — the language default applies', () => {
		expect(resolveChartRegion('auto', 'zh-Hans', 'zh-CN')).toBe('tw');
		expect(resolveChartRegion('auto', 'es', 'es-419')).toBe('es');
	});

	it('a navigator.language without a region subtag uses the language default', () => {
		expect(resolveChartRegion('auto', 'en', 'en')).toBe('us');
		expect(resolveChartRegion('auto', 'en', '')).toBe('us');
	});

	it('an explicit saved region beats navigator.language', () => {
		expect(resolveChartRegion('hk', 'en', 'en-GB')).toBe('hk');
	});

	it('the offered list is the 27 verified storefronts in the fixed Asia-first order', () => {
		expect(CHART_REGIONS).toEqual([
			'hk',
			'tw',
			'sg',
			'jp',
			'kr',
			'us',
			'gb',
			'ca',
			'au',
			'de',
			'fr',
			'es',
			'it',
			'pt',
			'br',
			'mx',
			'ru',
			'tr',
			'th',
			'vn',
			'id',
			'in',
			'ph',
			'my',
			'sa',
			'ae',
			'eg'
		]);
		expect(CHART_REGIONS).not.toContain('cn');
		expect(KKBOX_REGIONS).toEqual(['hk', 'tw', 'sg']);
		expect(YT_REGIONS).toEqual(CHART_REGIONS);
	});
});

describe('resolveExtraRegions', () => {
	it('drops the main region, unknown codes and duplicates, keeping saved order', () => {
		expect(resolveExtraRegions(['tw', 'hk', 'tw', 'xx', 'jp'], 'hk')).toEqual(['tw', 'jp']);
	});

	it('non-array → none (the default is no extra regions, NOT the full pool)', () => {
		expect(resolveExtraRegions(undefined, 'hk')).toEqual([]);
		expect(resolveExtraRegions('tw', 'hk')).toEqual([]);
		expect(resolveExtraRegions(null, 'hk')).toEqual([]);
	});

	it('an empty selection stays empty', () => {
		expect(resolveExtraRegions([], 'us')).toEqual([]);
	});

	it('never yields cn or a non-string entry', () => {
		expect(resolveExtraRegions(['cn', 42, null, 'kr'], 'us')).toEqual(['kr']);
	});
});

// CHART_GENRES (39-D-10) — regional genres read a FIXED storefront independent of the Chart region;
// Western genres read Deezer. The ids are verified upstream ids, so pin every entry.
describe('CHART_GENRES / resolveChartGenres (39-D-10)', () => {
	it('carries the exact 11 genre sources', () => {
		expect(CHART_GENRE_IDS).toEqual([
			'cantopop',
			'mandopop',
			'kpop',
			'jpop',
			'hiphop',
			'rock',
			'dance',
			'rnb',
			'electronic',
			'alternative',
			'asian'
		]);
		expect(CHART_GENRES.cantopop).toEqual({ src: 'itunes', cc: 'hk', id: 1251 });
		expect(CHART_GENRES.mandopop).toEqual({ src: 'itunes', cc: 'tw', id: 1253 });
		expect(CHART_GENRES.kpop).toEqual({ src: 'itunes', cc: 'hk', id: 51 });
		expect(CHART_GENRES.jpop).toEqual({ src: 'itunes', cc: 'jp', id: 27 });
		expect(CHART_GENRES.hiphop).toEqual({ src: 'deezer', id: 116 });
		expect(CHART_GENRES.rock).toEqual({ src: 'deezer', id: 152 });
		expect(CHART_GENRES.dance).toEqual({ src: 'deezer', id: 113 });
		expect(CHART_GENRES.rnb).toEqual({ src: 'deezer', id: 165 });
		expect(CHART_GENRES.electronic).toEqual({ src: 'deezer', id: 106 });
		expect(CHART_GENRES.alternative).toEqual({ src: 'deezer', id: 85 });
		expect(CHART_GENRES.asian).toEqual({ src: 'deezer', id: 16 });
		expect(Object.keys(CHART_GENRES)).toHaveLength(11);
	});

	it('DEEZER_GENRE_IDS is the Deezer ids in pool order', () => {
		expect(DEEZER_GENRE_IDS).toEqual([116, 152, 113, 165, 106, 85, 16]);
	});

	it('DEFAULT_CHART_GENRES is every pool genre in pool order (quick-260925-vtg)', () => {
		expect(DEFAULT_CHART_GENRES).toEqual([
			'cantopop',
			'mandopop',
			'kpop',
			'jpop',
			'hiphop',
			'rock',
			'dance',
			'rnb',
			'electronic',
			'alternative',
			'asian'
		]);
	});

	it('keeps only pool ids, de-duped, in saved order', () => {
		expect(resolveChartGenres(['rock', 'bogus', 'rock', 'cantopop'])).toEqual(['rock', 'cantopop']);
	});

	it('an empty selection stays EMPTY (no fall-back-to-all, unlike resolveSubset)', () => {
		expect(resolveChartGenres([])).toEqual([]);
		expect(resolveChartGenres(['bogus'])).toEqual([]);
	});

	it('non-array → a fresh copy of the defaults', () => {
		const r = resolveChartGenres(undefined);
		expect(r).toEqual([...DEFAULT_CHART_GENRES]);
		expect(r).not.toBe(DEFAULT_CHART_GENRES);
		expect(resolveChartGenres('rock')).toEqual([...DEFAULT_CHART_GENRES]);
		expect(resolveChartGenres(null)).toEqual([...DEFAULT_CHART_GENRES]);
	});
});

// migrateHomeLayout (39-D-11) — the one-time switch for an existing user: chart ids go where the old
// chart block sat, the four classic ids join homeHidden, per-section density carries old → new.
describe('migrateHomeLayout (39-D-11)', () => {
	const OLD_DEFAULT = [
		'liked',
		'downloads',
		'radio',
		'top-hits',
		'top-artists',
		'fav-artists',
		'tags',
		'countries',
		'playlists',
		'history'
	];

	it('HOME_LAYOUT_VERSION is 2', () => {
		expect(HOME_LAYOUT_VERSION).toBe(2);
	});

	it('the old 10-id default gets the chart block before top-hits and every classic id hidden', () => {
		const r = migrateHomeLayout(OLD_DEFAULT, []);
		expect(r.order).toEqual([
			'liked',
			'downloads',
			'radio',
			...CHART_SECTIONS,
			'top-hits',
			'top-artists',
			'fav-artists',
			'tags',
			'countries',
			'playlists',
			'history'
		]);
		expect(r.hidden).toEqual([...CLASSIC_SECTIONS]);
	});

	it('inserts at the FIRST classic id and unions hidden, keeping existing hidden ids first', () => {
		const r = migrateHomeLayout(['history', 'tags', 'liked', 'top-hits'], ['liked']);
		expect(r.order).toEqual(['history', ...CHART_SECTIONS, 'tags', 'liked', 'top-hits']);
		expect(r.hidden).toEqual(['liked', ...CLASSIC_SECTIONS]);
	});

	it('no classic id → right after radio', () => {
		expect(migrateHomeLayout(['liked', 'radio', 'history'], []).order).toEqual([
			'liked',
			'radio',
			...CHART_SECTIONS,
			'history'
		]);
	});

	it('no classic id and no radio → at the start', () => {
		expect(migrateHomeLayout(['history'], []).order).toEqual([...CHART_SECTIONS, 'history']);
		expect(migrateHomeLayout([], []).order).toEqual([...CHART_SECTIONS]);
	});

	it('de-dupes, leaves a chart id already present at its slot, inserts only the missing ones', () => {
		expect(migrateHomeLayout(['liked', 'liked', 'chart-songs', 'top-hits'], []).order).toEqual([
			'liked',
			'chart-songs',
			'new-releases',
			'chart-artists',
			'chart-albums',
			'yt-trending',
			'genres',
			'regions',
			'top-hits'
		]);
	});

	it('keeps an already-hidden classic id once (union, no duplicates)', () => {
		expect(migrateHomeLayout(OLD_DEFAULT, ['tags', 'tags']).hidden).toEqual([
			'tags',
			'top-hits',
			'top-artists',
			'countries'
		]);
	});

	it('is idempotent (twice deep-equals once)', () => {
		const density = { 'top-hits': 'pile', tags: 'grid' } as const;
		const once = migrateHomeLayout(OLD_DEFAULT, ['liked'], density);
		const twice = migrateHomeLayout(once.order, once.hidden, once.density);
		expect(twice).toEqual(once);
	});

	it('carries per-section density old → new only where the new id has no override', () => {
		const r = migrateHomeLayout(OLD_DEFAULT, [], { 'top-hits': 'pile', tags: 'grid', 'chart-songs': 'list' });
		expect(r.density).toEqual({ 'top-hits': 'pile', tags: 'grid', 'chart-songs': 'list', genres: 'grid' });
	});

	it('maps all four pairs and ignores a garbage old value', () => {
		const r = migrateHomeLayout(OLD_DEFAULT, [], {
			'top-hits': 'grid',
			'top-artists': 'pile',
			tags: 'list',
			countries: 'bogus' as never
		});
		expect(r.density['chart-songs']).toBe('grid');
		expect(r.density['chart-artists']).toBe('pile');
		expect(r.density.genres).toBe('list');
		expect(r.density.regions).toBeUndefined();
	});

	it('density defaults to an empty map and the inputs are not mutated', () => {
		const order = [...OLD_DEFAULT];
		const hidden = ['liked'];
		const r = migrateHomeLayout(order, hidden);
		expect(r.density).toEqual({});
		expect(order).toEqual(OLD_DEFAULT);
		expect(hidden).toEqual(['liked']);
	});
});

// reorderListed (39-D-12) — /settings/home drags only the listed (non-classic) rows; every classic id
// keeps its exact array index so a hidden classic shelf never moves.
describe('reorderListed (39-D-12)', () => {
	const ORDER: HomeSectionId[] = ['liked', 'top-hits', 'downloads', 'tags', 'radio'];

	it('moves one listed row while classic ids keep their index', () => {
		expect(reorderListed(ORDER, 0, 2)).toEqual(['downloads', 'top-hits', 'radio', 'tags', 'liked']);
	});

	it('moving a row upward works the same way', () => {
		expect(reorderListed(ORDER, 2, 0)).toEqual(['radio', 'top-hits', 'liked', 'tags', 'downloads']);
	});

	it('from === to is a no-op copy', () => {
		const r = reorderListed(ORDER, 1, 1);
		expect(r).toEqual(ORDER);
		expect(r).not.toBe(ORDER);
	});

	it('out-of-range or non-integer indices return an unchanged copy', () => {
		for (const [from, to] of [
			[-1, 0],
			[0, 3],
			[3, 0],
			[0, -1],
			[NaN, 0],
			[0.5, 1]
		]) {
			const r = reorderListed(ORDER, from, to);
			expect(r).toEqual(ORDER);
			expect(r).not.toBe(ORDER);
		}
	});

	it('every classic id keeps its exact index in the full default order', () => {
		const full = [...DEFAULT_SECTION_ORDER];
		const r = reorderListed(full, 0, 12);
		for (const id of CLASSIC_SECTIONS) expect(r.indexOf(id)).toBe(full.indexOf(id));
		expect([...r].sort()).toEqual([...full].sort());
		// quick-260925-vtg: the default order now starts with 'radio', which moves to the last
		// non-classic slot (index 16).
		expect(r[r.length - 1]).toBe('radio');
	});

	it('does not mutate the input', () => {
		const order = [...ORDER];
		reorderListed(order, 0, 2);
		expect(order).toEqual(ORDER);
	});
});
