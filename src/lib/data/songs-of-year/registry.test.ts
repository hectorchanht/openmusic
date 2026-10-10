import { describe, it, expect } from 'vitest';
import {
	SOY_YEARS,
	SOY_COUNTRIES,
	SOY_AVAILABLE,
	soyHasData,
	loadSoyYear
} from './registry';

describe('songs-of-year registry', () => {
	it('covers 2000–2026, newest first', () => {
		expect(SOY_YEARS).toHaveLength(27);
		expect(SOY_YEARS[0]).toBe(2026);
		expect(SOY_YEARS[SOY_YEARS.length - 1]).toBe(2000);
		expect(new Set(SOY_YEARS).size).toBe(27);
	});

	it('countries match the app discovery list (no duplicates)', () => {
		expect(SOY_COUNTRIES).toContain('United States');
		expect(SOY_COUNTRIES.length).toBeGreaterThanOrEqual(20);
		expect(new Set(SOY_COUNTRIES).size).toBe(SOY_COUNTRIES.length);
	});

	it('availability only lists covered years and countries', () => {
		for (const [y, cs] of Object.entries(SOY_AVAILABLE)) {
			expect(SOY_YEARS).toContain(Number(y));
			for (const c of cs) expect(SOY_COUNTRIES).toContain(c);
		}
	});

	it('soyHasData validates year and country', () => {
		expect(soyHasData(2024, 'United States')).toBe(true);
		expect(soyHasData(2000, 'United States')).toBe(true);
		expect(soyHasData(2024, 'France')).toBe(false); // coming soon, not fabricated
		expect(soyHasData(2026, 'United States')).toBe(false); // 2026 = curated region packs
		expect(soyHasData(1999, 'United States')).toBe(false);
		expect(soyHasData(2024, 'Narnia')).toBe(false);
		expect(soyHasData(NaN, 'United States')).toBe(false);
		expect(soyHasData(2024.5, 'United States')).toBe(false);
	});

	it('loadSoyYear rejects for years with no year file', async () => {
		await expect(loadSoyYear(2026)).rejects.toThrow();
		await expect(loadSoyYear(1999)).rejects.toThrow();
	});
});

describe('songs-of-year data files (Billboard Year-End Hot 100)', () => {
	it.each(SOY_YEARS.filter((y) => y !== 2026))(
		'year %i: 50 clean, unique, rank-ordered entries',
		async (year) => {
			const m = await loadSoyYear(year);
			const songs = m['United States'];
			expect(songs).toHaveLength(50);
			const seen = new Set<string>();
			songs.forEach((s, i) => {
				expect(s.artist.trim().length).toBeGreaterThan(0);
				expect(s.title.trim().length).toBeGreaterThan(0);
				expect(s.note).toBe(`#${i + 1} Billboard 年終`);
				const key = `${s.artist} — ${s.title}`;
				expect(seen.has(key), `duplicate: ${key}`).toBe(false);
				seen.add(key);
				// no wiki-markup leaks from the scrape
				expect(`${s.artist}${s.title}`).not.toMatch(/\[\[|\]\]|\{\{|\}\}|rowspan/);
			});
		},
		30000
	);
});
