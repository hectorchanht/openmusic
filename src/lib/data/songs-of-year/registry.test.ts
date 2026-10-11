import { describe, it, expect } from 'vitest';
import {
	SOY_YEARS,
	SOY_COUNTRIES,
	SOY_AVAILABLE,
	soyHasData,
	loadSoyYear,
	loadSoySources
} from './registry';

describe('songs-of-year registry', () => {
	it('covers 1946–2026, newest first', () => {
		expect(SOY_YEARS).toHaveLength(81);
		expect(SOY_YEARS[0]).toBe(2026);
		expect(SOY_YEARS[SOY_YEARS.length - 1]).toBe(1946);
		expect(new Set(SOY_YEARS).size).toBe(81);
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
		expect(soyHasData(1999, 'United States')).toBe(true);
		expect(soyHasData(1946, 'United States')).toBe(true); // earliest Billboard year-end
		expect(soyHasData(1945, 'United States')).toBe(false); // before the source starts
		expect(soyHasData(1995, 'Japan')).toBe(true); // Oricon 1989+
		expect(soyHasData(1990, 'Australia')).toBe(true); // ARIA 1988+
		expect(soyHasData(1980, 'United Kingdom')).toBe(true); // UK 1971–1987
		expect(soyHasData(1990, 'United Kingdom')).toBe(false); // no UK table for 1990
		expect(soyHasData(1999, 'United Kingdom')).toBe(false); // no UK table for 1999
		expect(soyHasData(2005, 'South Korea')).toBe(false); // Gaon launched 2010
		expect(soyHasData(2024, 'Narnia')).toBe(false);
		expect(soyHasData(NaN, 'United States')).toBe(false);
		expect(soyHasData(2024.5, 'United States')).toBe(false);
	});

	it('loadSoyYear rejects for years with no year file', async () => {
		await expect(loadSoyYear(2026)).rejects.toThrow();
		await expect(loadSoyYear(1945)).rejects.toThrow();
	});
});

describe('songs-of-year data files (Billboard Year-End)', () => {
	it.each(SOY_YEARS.filter((y) => y !== 2026))(
		'year %i: clean, unique, rank-ordered US entries',
		async (year) => {
			const m = await loadSoyYear(year);
			const songs = m['United States'];
			// Pre-1959 charts were Top 30 (or shorter with ties); 1956+ publish 50+.
			// We ship at most the top 50, verbatim ranks (ties kept, e.g. 1946 #19 ×2).
			expect(songs.length).toBeGreaterThan(0);
			expect(songs.length).toBeLessThanOrEqual(50);
			if (year >= 1956) expect(songs).toHaveLength(50);
			const seen = new Set<string>();
			let prevRank = 0;
			songs.forEach((s, i) => {
				expect(s.artist.trim().length).toBeGreaterThan(0);
				expect(s.title.trim().length).toBeGreaterThan(0);
				const rankMatch = /^#(\d+) Billboard 年終$/.exec(s.note ?? '');
				expect(rankMatch, `bad note ${s.note}`).not.toBeNull();
				const rank = Number(rankMatch![1]);
				expect(rank, 'rank went backwards').toBeGreaterThanOrEqual(prevRank);
				prevRank = rank;
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

describe('songs-of-year data files (all countries)', () => {
	it.each(SOY_YEARS.filter((y) => y !== 2026))(
		'year %i: every available country has clean, rank-ordered entries',
		async (year) => {
			const m = await loadSoyYear(year);
			const countries = SOY_AVAILABLE[year] ?? [];
			expect(countries.length).toBeGreaterThan(0);
			for (const c of countries) {
				const songs = m[c];
				expect(songs, `${year}/${c}: missing data`).toBeDefined();
				expect(songs.length).toBeGreaterThan(0);
				const seen = new Set<string>();
				let prevRank = 0;
				songs.forEach((s, i) => {
					expect(s.artist.trim().length, `${year}/${c} #${i + 1}: empty artist`).toBeGreaterThan(0);
					expect(s.title.trim().length, `${year}/${c} #${i + 1}: empty title`).toBeGreaterThan(0);
					// note carries the published rank: "#<rank> <Chart …>". Ranks are
					// non-decreasing (ties/gaps preserved verbatim, e.g. Oricon 2001 skips #49).
					// Exception: explicitly unranked packs (note contains "排名不分先後")
					// are allowed without #N — never fabricate ranks (FACT-CHECK rule).
					const unranked = (s.note ?? '').includes('排名不分先後');
					if (!unranked) {
						const rankMatch = /^#(\d+) /.exec(s.note ?? '');
						expect(rankMatch, `${year}/${c} #${i + 1}: bad note ${s.note}`).not.toBeNull();
						const rank = Number(rankMatch![1]);
						expect(rank, `${year}/${c}: rank went backwards`).toBeGreaterThanOrEqual(prevRank);
						expect(rank, `${year}/${c}: rank must be positive`).toBeGreaterThan(0);
						prevRank = rank;
					}
					const key = `${s.artist} — ${s.title}`;
					// Known exceptions: Oricon counts two editions of the same single
					// as separate year-end rows — faithful to the published chart.
					// (2012 #40/#48 Tohoshinki "ANDROID"; 1999 #5/#22 Utada Hikaru
					// "Automatic / time will tell", 12cm vs 8cm editions.)
					const knownDup =
						(year === 2012 && c === 'Japan' && key === 'Tohoshinki — ANDROID') ||
						(year === 1999 &&
							c === 'Japan' &&
							key === 'Utada Hikaru — Automatic / time will tell');
					expect(seen.has(key) && !knownDup, `${year}/${c} duplicate: ${key}`).toBe(false);
					seen.add(key);
					expect(`${s.artist}${s.title}`).not.toMatch(/\[\[|\]\]|\{\{|\}\}|rowspan/);
				});
			}
		},
		30000
	);
});

describe('songs-of-year source attribution', () => {
	it('loadSoySources covers every available country with name + URL', async () => {
		for (const year of SOY_YEARS.filter((y) => y !== 2026)) {
			const sources = await loadSoySources(year);
			for (const c of SOY_AVAILABLE[year] ?? []) {
				const s = sources[c];
				expect(s, `${year}/${c}: missing source`).toBeDefined();
				expect(s.name.trim().length).toBeGreaterThan(0);
				expect(s.url).toMatch(/^https?:\/\//);
			}
		}
	});

	it('loadSoySources rejects for years with no year file', async () => {
		await expect(loadSoySources(2026)).rejects.toThrow();
		await expect(loadSoySources(1945)).rejects.toThrow();
	});
});
