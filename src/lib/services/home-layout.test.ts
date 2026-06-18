import { describe, it, expect } from 'vitest';
import {
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
	LANDING_PATHS
} from './home-layout';

// home-layout.ts is a PURE config-resolution module (no runes, no browser, runs in the
// node Vitest project alongside discovery.test.ts). It guards the home render against a
// corrupt/old persisted config (quick-260606-w87 — threats T-w87-01/02/03/05): a poisoned
// shelf size, an unknown section id, or a tag no longer in the pool must NEVER break the
// render — they clamp / drop / fall back to defaults. These tests are fully deterministic.

describe('HOME_SECTIONS / DEFAULT_SECTION_ORDER', () => {
	it('is the nine home group ids in canonical order (kyf: fav-artists moved next to top-artists)', () => {
		expect(HOME_SECTIONS).toEqual([
			'liked',
			'downloads',
			'top-hits',
			'top-artists',
			'fav-artists',
			'tags',
			'countries',
			'playlists',
			'history'
		]);
	});

	it('DEFAULT_SECTION_ORDER deep-equals HOME_SECTIONS (preserves today fixed order)', () => {
		expect(DEFAULT_SECTION_ORDER).toEqual(HOME_SECTIONS);
	});

	it('DEFAULT_SECTION_ORDER is a distinct array (not the same ref — safe to spread)', () => {
		expect(DEFAULT_SECTION_ORDER).not.toBe(HOME_SECTIONS);
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

	it('keeps the saved order then appends any missing known ids (permutation-superset)', () => {
		expect(resolveSectionOrder(['countries', 'top-hits'])).toEqual([
			'countries',
			'top-hits',
			// missing ids appended in canonical (HOME_SECTIONS) order
			'liked',
			'downloads',
			'top-artists',
			'fav-artists',
			'tags',
			'playlists',
			'history'
		]);
	});

	it('drops ids not in HOME_SECTIONS (unknown/old ids ignored) and still covers every id', () => {
		expect(resolveSectionOrder(['bogus', 'tags'])).toEqual([
			'tags',
			'liked',
			'downloads',
			'top-hits',
			'top-artists',
			'fav-artists',
			'countries',
			'playlists',
			'history'
		]);
	});

	it('de-dupes a repeated saved id (a known id appears at most once)', () => {
		expect(resolveSectionOrder(['tags', 'tags', 'top-hits'])).toEqual([
			'tags',
			'top-hits',
			'liked',
			'downloads',
			'top-artists',
			'fav-artists',
			'countries',
			'playlists',
			'history'
		]);
	});

	it('a full valid permutation is returned as-is', () => {
		const order = [
			'tags',
			'countries',
			'top-artists',
			'top-hits',
			'liked',
			'downloads',
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
		// User's saved order preserved, fav-artists appended in canonical position (after history here)
		expect(r.slice(0, legacy.length)).toEqual(legacy);
		expect(r[legacy.length]).toBe('fav-artists');
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
		expect(clampShelfSize(SHELF_DEFAULT)).toBe(16);
	});

	it('floors a fractional value', () => {
		expect(clampShelfSize(12.7)).toBe(12);
	});

	it('non-number / NaN / undefined → SHELF_DEFAULT', () => {
		// clampShelfSize takes `unknown`, so a corrupt string is a runtime concern, not a type one.
		expect(clampShelfSize('x')).toBe(SHELF_DEFAULT);
		expect(clampShelfSize(undefined)).toBe(SHELF_DEFAULT);
		expect(clampShelfSize(NaN)).toBe(SHELF_DEFAULT);
		expect(clampShelfSize(SHELF_DEFAULT)).toBe(16);
	});

	it('a negative value clamps up to SHELF_MIN (never a NaN / negative page size)', () => {
		expect(clampShelfSize(-5)).toBe(SHELF_MIN);
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
