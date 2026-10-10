// Year picker for the 2026 chart pack pages (src/routes/(app)/charts/{region}-2026/).
//
// Tapping a year navigates to a REAL Songs-of-Year route — never an invented
// /charts/<region>-<year> URL (those routes don't exist). 2026 is the live year:
// the pack page itself is the content, so 2026 renders as the active chip.
// Every other year links to /charts/songs-of-year/[year]/[country] with the
// region's mapped country; combos without verified data render the hub's
// "coming soon" state (never fabricated, never a dead link).
//
// The year list itself comes from the songs-of-year registry (single source).
export type ChartRegion = 'cantopop' | 'mandopop' | 'kpop' | 'jpop' | 'western';

/** Which songs-of-year country each 2026 pack region maps to. */
export const CHART_REGION_COUNTRY: Record<ChartRegion, string> = {
	cantopop: 'Hong Kong',
	mandopop: 'Taiwan',
	kpop: 'South Korea',
	jpop: 'Japan',
	western: 'United States'
};

/** Href for a region's year chip — mirrors the hub's openCountryPack URL shape. */
export function chartYearHref(region: ChartRegion, year: number): string {
	return `/charts/songs-of-year/${year}/${encodeURIComponent(CHART_REGION_COUNTRY[region])}`;
}
