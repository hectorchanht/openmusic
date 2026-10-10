// Songs of the Year registry — every year × every country (Hector 2026-10-10:
// "build Songs of the year for openmusic for every available years for every country").
//
// - SOY_YEARS: 2026 → 2000 (desc, picker order). 2026 is the live year: the five
//   curated region packs (cantopop/mandopop/kpop/jpop/western-2026) are its content.
//   2000–2025 are Billboard Year-End Hot 100 (United States) year files.
// - SOY_COUNTRIES: the app's 20 discovery countries (same list as the home country
//   shelves and /charts/countries/[country]) — imported, not duplicated.
// - SOY_AVAILABLE[year]: countries with real data for that year. Combos NOT listed
//   render a "coming soon" state — never fabricated songs (FACT-CHECK rule).
// - SOY_LOADERS[year]: lazy per-year import so the hub never bundles all 26 years.
//
// Adding a country later = one data file (or one record in the year file) + one line
// in SOY_AVAILABLE. No route or UI changes needed.

import type { PackSong } from '$lib/data/cantopop-2026';
import { DISCOVERY_COUNTRIES } from '$lib/services/home-layout';

/** All years the Songs-of-Year section covers, newest first. */
export const SOY_YEARS: number[] = (() => {
	const years: number[] = [2026];
	for (let y = 2025; y >= 2000; y--) years.push(y);
	return years;
})();

/** Every country the section covers — the app's discovery country list. */
export const SOY_COUNTRIES: string[] = DISCOVERY_COUNTRIES;

const US = 'United States';

/** Countries with real, verified data for each year. */
export const SOY_AVAILABLE: Record<number, string[]> = (() => {
	const m: Record<number, string[]> = { 2026: [] };
	for (let y = 2025; y >= 2000; y--) m[y] = [US];
	return m;
})();

/** True when year/country has a real pack (validated inputs only). */
export function soyHasData(year: number, country: string): boolean {
	return (
		Number.isInteger(year) &&
		SOY_YEARS.includes(year) &&
		SOY_COUNTRIES.includes(country) &&
		(SOY_AVAILABLE[year] ?? []).includes(country)
	);
}

/** Lazy per-year data loader. Rejects for years with no year file (2026). */
export function loadSoyYear(year: number): Promise<Record<string, PackSong[]>> {
	const loader = SOY_LOADERS[year];
	if (!loader) return Promise.reject(new Error(`no songs-of-year data for ${year}`));
	return loader();
}

// One explicit dynamic import per year (Vite needs the static pattern; the hub
// stays light because only the selected year is ever fetched).
const SOY_LOADERS: Record<number, () => Promise<Record<string, PackSong[]>>> = {
	2000: () => import('./years/2000').then((m) => m.SOY_2000),
	2001: () => import('./years/2001').then((m) => m.SOY_2001),
	2002: () => import('./years/2002').then((m) => m.SOY_2002),
	2003: () => import('./years/2003').then((m) => m.SOY_2003),
	2004: () => import('./years/2004').then((m) => m.SOY_2004),
	2005: () => import('./years/2005').then((m) => m.SOY_2005),
	2006: () => import('./years/2006').then((m) => m.SOY_2006),
	2007: () => import('./years/2007').then((m) => m.SOY_2007),
	2008: () => import('./years/2008').then((m) => m.SOY_2008),
	2009: () => import('./years/2009').then((m) => m.SOY_2009),
	2010: () => import('./years/2010').then((m) => m.SOY_2010),
	2011: () => import('./years/2011').then((m) => m.SOY_2011),
	2012: () => import('./years/2012').then((m) => m.SOY_2012),
	2013: () => import('./years/2013').then((m) => m.SOY_2013),
	2014: () => import('./years/2014').then((m) => m.SOY_2014),
	2015: () => import('./years/2015').then((m) => m.SOY_2015),
	2016: () => import('./years/2016').then((m) => m.SOY_2016),
	2017: () => import('./years/2017').then((m) => m.SOY_2017),
	2018: () => import('./years/2018').then((m) => m.SOY_2018),
	2019: () => import('./years/2019').then((m) => m.SOY_2019),
	2020: () => import('./years/2020').then((m) => m.SOY_2020),
	2021: () => import('./years/2021').then((m) => m.SOY_2021),
	2022: () => import('./years/2022').then((m) => m.SOY_2022),
	2023: () => import('./years/2023').then((m) => m.SOY_2023),
	2024: () => import('./years/2024').then((m) => m.SOY_2024),
	2025: () => import('./years/2025').then((m) => m.SOY_2025)
};
