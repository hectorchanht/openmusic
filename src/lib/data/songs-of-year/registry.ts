// Songs of the Year registry — every year × every country (Hector 2026-10-10:
// "build Songs of the year for openmusic for every available years for every country").
//
// - SOY_YEARS: 2026 → 1946 (desc, picker order). 2026 is the live year: the five
//   curated region packs (cantopop/mandopop/kpop/jpop/western-2026) are its content.
//   1946–2025 are multi-country year-end chart files: US (Billboard, 1946+),
//   Japan (Oricon, 1989+), Australia (ARIA, 1988+), South Korea (Gaon/Circle, 2010+),
//   UK (Official Charts, 1971–1987/1989/1991–1998 + 2015–2017/2019–2025),
//   Spain (PROMUSICAE, 2019/2021/2023–2025),
//   Hong Kong (叱咤樂壇流行榜 專業推介．叱咤十大 1998–2025; 香港電台 十大中文金曲獎 1988–1997).
//   Each year file also exports SOY_SOURCES_<year> (name + URL per country) for the
//   pack page footer.
// - SOY_COUNTRIES: the app's 20 discovery countries (same list as the home country
//   shelves and /charts/countries/[country]) — imported, not duplicated.
// - SOY_AVAILABLE[year]: countries with real data for that year. Combos NOT listed
//   render a "coming soon" state — never fabricated songs (FACT-CHECK rule).
// - SOY_LOADERS[year]: lazy per-year import so the hub never bundles all 80 years.
//
// Adding a country later = one data file (or one record in the year file) + one line
// in SOY_AVAILABLE. No route or UI changes needed.

import type { PackSong } from '$lib/data/cantopop-2026';
import { DISCOVERY_COUNTRIES } from '$lib/services/home-layout';



/** Every country the section covers — the app's discovery country list. */
export const SOY_COUNTRIES: string[] = DISCOVERY_COUNTRIES;

const US = 'United States';

/**
 * Countries with real, verified data for each year.
 * - US: Billboard Year-End (1946–2025, Wikipedia; pre-1959 = year-end top 30/singles,
 *   the Hot 100 only launched in 1958).
 * - Japan: Oricon Yearly Singles Chart (1989–2025, generasia; nothing verifiable before 1989).
 * - Australia: ARIA End Of Year Singles Chart (1988–2025, aria.com.au; archive starts 1988).
 * - South Korea: Gaon (2010–2021) / Circle (2022–2025) yearly digital chart (chart launched 2010).
 * - United Kingdom: Official Charts end-of-year via Wikipedia "YYYY in British music"
 *   (1971–1987, 1989, 1991–1998, 2015–2017, 2019–2025; other years have no table).
 * - Spain: PROMUSICAE Top 100 Canciones Anual (2019, 2021, 2023–2025).
 * Combos NOT listed render a "coming soon" state — never fabricated songs (FACT-CHECK rule).
 */
export const SOY_AVAILABLE: Record<number, string[]> = (() => {
	const m: Record<number, string[]> = { 2026: [] };
	// UK years with a verifiable "Best-selling singles" year-end table.
	const ukYears = new Set<number>();
	for (let y = 1971; y <= 1987; y++) ukYears.add(y);
	ukYears.add(1989);
	for (let y = 1991; y <= 1998; y++) ukYears.add(y);
	for (let y = 2015; y <= 2017; y++) ukYears.add(y);
	for (let y = 2019; y <= 2025; y++) ukYears.add(y);
	for (let y = 2025; y >= 1946; y--) {
		const cs = [US];
		if (y >= 1988) cs.push('Australia');
		if (y >= 1989) cs.push('Japan');
		if (y >= 2010) cs.push('South Korea');
		if (ukYears.has(y)) cs.push('United Kingdom');
		if (y === 2019 || y === 2021 || y >= 2023) cs.push('Spain');
		if (y >= 1988) cs.push('Hong Kong');
		if (y >= 1997 && y <= 2021) cs.push('Taiwan');
		m[y] = cs;
	}
	return m;
})();

/** All years the Songs-of-Year section covers, newest first.
 *  Derived from SOY_AVAILABLE (years that actually have at least one
 *  country's pack) — never a hardcoded range, so a year with no data
 *  never renders a pill (Hector 2026-10-11: list must be dynamic to data).
 *  2026 is the live curated year (five region packs, not SOY_AVAILABLE rows).
 */
export const SOY_YEARS: number[] = (() => {
	const years = Object.keys(SOY_AVAILABLE)
		.map(Number)
		.filter((y) => (SOY_AVAILABLE[y] ?? []).length > 0)
		.sort((a, b) => b - a);
	if (!years.includes(2026)) years.unshift(2026);
	return years;
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

/**
 * Chart source attribution per (year, country) — rendered in the pack page footer
 * so every year page shows where its ranking came from.
 */
export interface SoySource {
	/** Display name, e.g. "Billboard Year-End Hot 100". Chart names stay in English as proper nouns. */
	name: string;
	/** Exact page URL the ranking was taken from. */
	url: string;
}

/** Lazy per-year source loader. Rejects for years with no year file (2026). */
export function loadSoySources(year: number): Promise<Record<string, SoySource>> {
	const loader = SOY_SOURCE_LOADERS[year];
	if (!loader) return Promise.reject(new Error(`no songs-of-year sources for ${year}`));
	return loader();
}

// One explicit dynamic import per year (Vite needs the static pattern; the hub
// stays light because only the selected year is ever fetched).
const SOY_LOADERS: Record<number, () => Promise<Record<string, PackSong[]>>> = {
	1999: () => import('./years/1999').then((m) => m.SOY_1999),
	1998: () => import('./years/1998').then((m) => m.SOY_1998),
	1997: () => import('./years/1997').then((m) => m.SOY_1997),
	1996: () => import('./years/1996').then((m) => m.SOY_1996),
	1995: () => import('./years/1995').then((m) => m.SOY_1995),
	1994: () => import('./years/1994').then((m) => m.SOY_1994),
	1993: () => import('./years/1993').then((m) => m.SOY_1993),
	1992: () => import('./years/1992').then((m) => m.SOY_1992),
	1991: () => import('./years/1991').then((m) => m.SOY_1991),
	1990: () => import('./years/1990').then((m) => m.SOY_1990),
	1989: () => import('./years/1989').then((m) => m.SOY_1989),
	1988: () => import('./years/1988').then((m) => m.SOY_1988),
	1987: () => import('./years/1987').then((m) => m.SOY_1987),
	1986: () => import('./years/1986').then((m) => m.SOY_1986),
	1985: () => import('./years/1985').then((m) => m.SOY_1985),
	1984: () => import('./years/1984').then((m) => m.SOY_1984),
	1983: () => import('./years/1983').then((m) => m.SOY_1983),
	1982: () => import('./years/1982').then((m) => m.SOY_1982),
	1981: () => import('./years/1981').then((m) => m.SOY_1981),
	1980: () => import('./years/1980').then((m) => m.SOY_1980),
	1979: () => import('./years/1979').then((m) => m.SOY_1979),
	1978: () => import('./years/1978').then((m) => m.SOY_1978),
	1977: () => import('./years/1977').then((m) => m.SOY_1977),
	1976: () => import('./years/1976').then((m) => m.SOY_1976),
	1975: () => import('./years/1975').then((m) => m.SOY_1975),
	1974: () => import('./years/1974').then((m) => m.SOY_1974),
	1973: () => import('./years/1973').then((m) => m.SOY_1973),
	1972: () => import('./years/1972').then((m) => m.SOY_1972),
	1971: () => import('./years/1971').then((m) => m.SOY_1971),
	1970: () => import('./years/1970').then((m) => m.SOY_1970),
	1969: () => import('./years/1969').then((m) => m.SOY_1969),
	1968: () => import('./years/1968').then((m) => m.SOY_1968),
	1967: () => import('./years/1967').then((m) => m.SOY_1967),
	1966: () => import('./years/1966').then((m) => m.SOY_1966),
	1965: () => import('./years/1965').then((m) => m.SOY_1965),
	1964: () => import('./years/1964').then((m) => m.SOY_1964),
	1963: () => import('./years/1963').then((m) => m.SOY_1963),
	1962: () => import('./years/1962').then((m) => m.SOY_1962),
	1961: () => import('./years/1961').then((m) => m.SOY_1961),
	1960: () => import('./years/1960').then((m) => m.SOY_1960),
	1959: () => import('./years/1959').then((m) => m.SOY_1959),
	1958: () => import('./years/1958').then((m) => m.SOY_1958),
	1957: () => import('./years/1957').then((m) => m.SOY_1957),
	1956: () => import('./years/1956').then((m) => m.SOY_1956),
	1955: () => import('./years/1955').then((m) => m.SOY_1955),
	1954: () => import('./years/1954').then((m) => m.SOY_1954),
	1953: () => import('./years/1953').then((m) => m.SOY_1953),
	1952: () => import('./years/1952').then((m) => m.SOY_1952),
	1951: () => import('./years/1951').then((m) => m.SOY_1951),
	1950: () => import('./years/1950').then((m) => m.SOY_1950),
	1949: () => import('./years/1949').then((m) => m.SOY_1949),
	1948: () => import('./years/1948').then((m) => m.SOY_1948),
	1947: () => import('./years/1947').then((m) => m.SOY_1947),
	1946: () => import('./years/1946').then((m) => m.SOY_1946),
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

// One explicit dynamic import per year (same Vite static pattern as SOY_LOADERS;
// the module is cached, so this costs no extra fetch when the songs were loaded).
const SOY_SOURCE_LOADERS: Record<number, () => Promise<Record<string, SoySource>>> = {
	1999: () => import('./years/1999').then((m) => m.SOY_SOURCES_1999),
	1998: () => import('./years/1998').then((m) => m.SOY_SOURCES_1998),
	1997: () => import('./years/1997').then((m) => m.SOY_SOURCES_1997),
	1996: () => import('./years/1996').then((m) => m.SOY_SOURCES_1996),
	1995: () => import('./years/1995').then((m) => m.SOY_SOURCES_1995),
	1994: () => import('./years/1994').then((m) => m.SOY_SOURCES_1994),
	1993: () => import('./years/1993').then((m) => m.SOY_SOURCES_1993),
	1992: () => import('./years/1992').then((m) => m.SOY_SOURCES_1992),
	1991: () => import('./years/1991').then((m) => m.SOY_SOURCES_1991),
	1990: () => import('./years/1990').then((m) => m.SOY_SOURCES_1990),
	1989: () => import('./years/1989').then((m) => m.SOY_SOURCES_1989),
	1988: () => import('./years/1988').then((m) => m.SOY_SOURCES_1988),
	1987: () => import('./years/1987').then((m) => m.SOY_SOURCES_1987),
	1986: () => import('./years/1986').then((m) => m.SOY_SOURCES_1986),
	1985: () => import('./years/1985').then((m) => m.SOY_SOURCES_1985),
	1984: () => import('./years/1984').then((m) => m.SOY_SOURCES_1984),
	1983: () => import('./years/1983').then((m) => m.SOY_SOURCES_1983),
	1982: () => import('./years/1982').then((m) => m.SOY_SOURCES_1982),
	1981: () => import('./years/1981').then((m) => m.SOY_SOURCES_1981),
	1980: () => import('./years/1980').then((m) => m.SOY_SOURCES_1980),
	1979: () => import('./years/1979').then((m) => m.SOY_SOURCES_1979),
	1978: () => import('./years/1978').then((m) => m.SOY_SOURCES_1978),
	1977: () => import('./years/1977').then((m) => m.SOY_SOURCES_1977),
	1976: () => import('./years/1976').then((m) => m.SOY_SOURCES_1976),
	1975: () => import('./years/1975').then((m) => m.SOY_SOURCES_1975),
	1974: () => import('./years/1974').then((m) => m.SOY_SOURCES_1974),
	1973: () => import('./years/1973').then((m) => m.SOY_SOURCES_1973),
	1972: () => import('./years/1972').then((m) => m.SOY_SOURCES_1972),
	1971: () => import('./years/1971').then((m) => m.SOY_SOURCES_1971),
	1970: () => import('./years/1970').then((m) => m.SOY_SOURCES_1970),
	1969: () => import('./years/1969').then((m) => m.SOY_SOURCES_1969),
	1968: () => import('./years/1968').then((m) => m.SOY_SOURCES_1968),
	1967: () => import('./years/1967').then((m) => m.SOY_SOURCES_1967),
	1966: () => import('./years/1966').then((m) => m.SOY_SOURCES_1966),
	1965: () => import('./years/1965').then((m) => m.SOY_SOURCES_1965),
	1964: () => import('./years/1964').then((m) => m.SOY_SOURCES_1964),
	1963: () => import('./years/1963').then((m) => m.SOY_SOURCES_1963),
	1962: () => import('./years/1962').then((m) => m.SOY_SOURCES_1962),
	1961: () => import('./years/1961').then((m) => m.SOY_SOURCES_1961),
	1960: () => import('./years/1960').then((m) => m.SOY_SOURCES_1960),
	1959: () => import('./years/1959').then((m) => m.SOY_SOURCES_1959),
	1958: () => import('./years/1958').then((m) => m.SOY_SOURCES_1958),
	1957: () => import('./years/1957').then((m) => m.SOY_SOURCES_1957),
	1956: () => import('./years/1956').then((m) => m.SOY_SOURCES_1956),
	1955: () => import('./years/1955').then((m) => m.SOY_SOURCES_1955),
	1954: () => import('./years/1954').then((m) => m.SOY_SOURCES_1954),
	1953: () => import('./years/1953').then((m) => m.SOY_SOURCES_1953),
	1952: () => import('./years/1952').then((m) => m.SOY_SOURCES_1952),
	1951: () => import('./years/1951').then((m) => m.SOY_SOURCES_1951),
	1950: () => import('./years/1950').then((m) => m.SOY_SOURCES_1950),
	1949: () => import('./years/1949').then((m) => m.SOY_SOURCES_1949),
	1948: () => import('./years/1948').then((m) => m.SOY_SOURCES_1948),
	1947: () => import('./years/1947').then((m) => m.SOY_SOURCES_1947),
	1946: () => import('./years/1946').then((m) => m.SOY_SOURCES_1946),
	2000: () => import('./years/2000').then((m) => m.SOY_SOURCES_2000),
	2001: () => import('./years/2001').then((m) => m.SOY_SOURCES_2001),
	2002: () => import('./years/2002').then((m) => m.SOY_SOURCES_2002),
	2003: () => import('./years/2003').then((m) => m.SOY_SOURCES_2003),
	2004: () => import('./years/2004').then((m) => m.SOY_SOURCES_2004),
	2005: () => import('./years/2005').then((m) => m.SOY_SOURCES_2005),
	2006: () => import('./years/2006').then((m) => m.SOY_SOURCES_2006),
	2007: () => import('./years/2007').then((m) => m.SOY_SOURCES_2007),
	2008: () => import('./years/2008').then((m) => m.SOY_SOURCES_2008),
	2009: () => import('./years/2009').then((m) => m.SOY_SOURCES_2009),
	2010: () => import('./years/2010').then((m) => m.SOY_SOURCES_2010),
	2011: () => import('./years/2011').then((m) => m.SOY_SOURCES_2011),
	2012: () => import('./years/2012').then((m) => m.SOY_SOURCES_2012),
	2013: () => import('./years/2013').then((m) => m.SOY_SOURCES_2013),
	2014: () => import('./years/2014').then((m) => m.SOY_SOURCES_2014),
	2015: () => import('./years/2015').then((m) => m.SOY_SOURCES_2015),
	2016: () => import('./years/2016').then((m) => m.SOY_SOURCES_2016),
	2017: () => import('./years/2017').then((m) => m.SOY_SOURCES_2017),
	2018: () => import('./years/2018').then((m) => m.SOY_SOURCES_2018),
	2019: () => import('./years/2019').then((m) => m.SOY_SOURCES_2019),
	2020: () => import('./years/2020').then((m) => m.SOY_SOURCES_2020),
	2021: () => import('./years/2021').then((m) => m.SOY_SOURCES_2021),
	2022: () => import('./years/2022').then((m) => m.SOY_SOURCES_2022),
	2023: () => import('./years/2023').then((m) => m.SOY_SOURCES_2023),
	2024: () => import('./years/2024').then((m) => m.SOY_SOURCES_2024),
	2025: () => import('./years/2025').then((m) => m.SOY_SOURCES_2025),
};
