// Home-layout config resolution — PURE helpers (quick-260606-w87).
//
// This module is the ROBUSTNESS LAYER between attacker/corruption-controllable persisted
// config (localStorage `openmusic:settings:v1`) and the home render. localStorage is an
// untrusted input (threats T-w87-01/02/03/05): a poisoned shelf size, an unknown section
// id, a tag no longer in the pool, or a garbage landing tab must NEVER break the home
// page's first paint — they clamp, drop, or fall back to the default that reproduces
// today's behavior. Every helper here is deterministic, imports NOTHING from stores/$app,
// and runs in the node Vitest project alongside discovery.test.ts.
//
// It also OWNS the discovery POOL constants (DISCOVERY_TAGS/COUNTRIES). They live here —
// not in discovery.ts — to break a circular import: settings.svelte.ts needs the pools for
// its default subsets, and discovery.ts already imports settings (inside resolveStub). Since
// home-layout imports nothing, `settings → home-layout` and `discovery → home-layout` are
// safe one-way edges; discovery.ts re-exports the pools so existing consumers are unchanged.

// ---- Discovery pool (the AVAILABLE tags/countries the user subsets from) ---------------
// Curated genre/mood tags for the per-tag home shelves (DISCO-02). Each becomes one
// `tag.getTopTracks` shelf. CN-biased + a few Western/utility moods. Editable.
// World-spanning genre POOL (Last.fm `tag.getTopTracks` tags — lowercase free-form). Broadened
// to cover the major global listening blocs (~80% of world music lovers): Western pop/rock/
// hip-hop/r&b/electronic/indie/country/metal, the CJK blocs (mando/canto/k-pop/j-pop), Latin,
// classical/jazz, reggae/soul/folk/blues, and Afrobeats. The user subsets + reorders these via
// the home-layout settings; only the selected ones become shelves.
export const DISCOVERY_TAGS: string[] = [
	'pop',
	'rock',
	'hip-hop',
	'rnb',
	'electronic',
	'dance',
	'indie',
	'k-pop',
	'j-pop',
	'mandopop',
	'cantopop',
	'latin',
	'classical',
	'jazz',
	'metal',
	'country',
	'reggae',
	'soul',
	'folk',
	'afrobeats',
	'lo-fi',
	'workout'
];

// World-spanning country POOL for the per-country home shelves (DISCO-03). Each becomes one
// `geo.getTopTracks` shelf. ISO 3166-1 NAMES (e.g. `United States`), NOT codes. Covers the
// largest music markets across regions; the user subsets + reorders.
export const DISCOVERY_COUNTRIES: string[] = [
	'China',
	'Taiwan',
	'Hong Kong',
	'Japan',
	'South Korea',
	'United States',
	'United Kingdom',
	'Canada',
	'Brazil',
	'Mexico',
	'Germany',
	'France',
	'Spain',
	'Italy',
	'India',
	'Indonesia',
	'Philippines',
	'Australia',
	'Russia',
	'Turkey'
];

// DEFAULT selections (what a fresh user — and anyone who presses "Reset to default" — sees).
//
// quick-260919-hm1: GENRES now default to the WHOLE pool, not the curated 8-of-22 subset. The
// curated order is kept at the FRONT and the rest of the pool appended, so the first shelves a
// fresh user scrolls past are still the CJK/global mix this app is biased toward — enabling the
// long tail adds shelves below, it does not reshuffle the top of the page.
// COST (stated deliberately, per this repo's API-flood history): each selected tag is ONE
// `tag.getTopTracks` call on a cold home, so the genre fan-out goes 8 → 22 requests, and the
// cover-backfill set grows with it. Both stay behind the existing limiters — the home's
// FANOUT_CAP=4, cover-backfill's CAP=6 in-flight pool, and apiFetch's GET dedupe /
// MAX_CONCURRENT_REQUESTS=8 / circuit breaker. No new throttle is needed or wanted here.
const CURATED_HOME_TAGS: string[] = [
	'cantopop',
	'mandopop',
	'pop',
	'hip-hop',
	'rock',
	'k-pop',
	'electronic',
	'latin'
];
export const DEFAULT_HOME_TAGS: string[] = [
	...CURATED_HOME_TAGS,
	...DISCOVERY_TAGS.filter((tag) => !CURATED_HOME_TAGS.includes(tag))
];
export const DEFAULT_HOME_COUNTRIES: string[] = [
	'United States',
	'Hong Kong',
	'Japan',
	'Taiwan',
	'China',
	'South Korea',
	'United Kingdom'
];

// ---- Chart region (39-D-09) ------------------------------------------------------------

/**
 * The offered Chart regions: every one returned 200 from Apple RSS and was echo-verified on
 * YouTube Charts (2026-09-25). Geographic, Asia-first — NOT alphabetical — so the chip order is
 * stable in every UI language. Mainland China is deliberately absent (see LANG_REGION).
 * This is the closed allowlist a persisted region is checked against before it can reach any
 * upstream URL (T-39-06).
 */
export const CHART_REGIONS = ['hk', 'tw', 'sg', 'jp', 'kr', 'us', 'gb', 'ca', 'au', 'de', 'fr', 'es', 'it', 'pt', 'br', 'mx', 'ru', 'tr', 'th', 'vn', 'id', 'in', 'ph', 'my', 'sa', 'ae', 'eg'] as const;
export type ChartRegion = (typeof CHART_REGIONS)[number];

/** KKBOX publishes charts for these territories only. */
export const KKBOX_REGIONS: readonly ChartRegion[] = ['hk', 'tw', 'sg'];
/** All 27 echo-verified on YouTube Charts 2026-09-25. A separate const so a YouTube-side drop can
 *  shrink it without touching the Apple list. */
export const YT_REGIONS: readonly ChartRegion[] = CHART_REGIONS;

/**
 * App language → default Chart region for `'auto'`. A fixed-map lookup (the LANDING_PATHS
 * posture): the region always comes from this table, never from the raw persisted string.
 *   - zh-Hans → tw, NEVER cn: the CN storefront's top-20 median age is ~22 years.
 *   - ar → sa, not ae: the UAE chart is expat/Western-skewed on both Apple and YouTube.
 */
const LANG_REGION: Record<string, ChartRegion> = {
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

function isChartRegion(v: unknown): v is ChartRegion {
	return typeof v === 'string' && (CHART_REGIONS as readonly string[]).includes(v);
}

/**
 * Resolve the persisted `homeChartRegion` (`'auto' | ChartRegion`) to a concrete offered region:
 *   1. a saved offered region wins;
 *   2. else (39-D-09b) a `navigator.language` region subtag that is offered — 'zh-TW' → tw,
 *      'en-GB' → gb, 'zh-Hant-HK' → hk;
 *   3. else the app-language default, else 'us'.
 * 'auto', garbage, cn or any other unknown code falls through; none of the three steps can yield a
 * region outside CHART_REGIONS.
 */
export function resolveChartRegion(saved: unknown, appLang: string, navLang?: string): ChartRegion {
	if (isChartRegion(saved)) return saved;
	if (typeof navLang === 'string') {
		const sub = navLang
			.split(/[-_]/)
			.slice(1)
			.find((s) => /^[a-z]{2}$/i.test(s))
			?.toLowerCase();
		if (isChartRegion(sub)) return sub;
	}
	return Object.prototype.hasOwnProperty.call(LANG_REGION, appLang) ? LANG_REGION[appLang] : 'us';
}

/**
 * Resolve the persisted "More regions" list: offered regions only, de-duped, saved order kept,
 * the main region dropped (it already has its own shelves). Non-array → [] — the default is NO
 * extra regions, unlike resolveSubset's full-pool fallback (T-39-07).
 */
export function resolveExtraRegions(saved: unknown, main: ChartRegion): ChartRegion[] {
	if (!Array.isArray(saved)) return [];
	const out: ChartRegion[] = [];
	for (const cc of saved) {
		if (isChartRegion(cc) && cc !== main && !out.includes(cc)) out.push(cc);
	}
	return out;
}

// ---- Chart genres (39-D-10) ------------------------------------------------------------

export const CHART_GENRE_IDS = ['cantopop', 'mandopop', 'kpop', 'jpop', 'hiphop', 'rock', 'dance', 'rnb', 'electronic', 'alternative', 'asian'] as const;
export type ChartGenre = (typeof CHART_GENRE_IDS)[number];
export type ChartGenreSource = { src: 'itunes'; cc: 'hk' | 'tw' | 'jp'; id: number } | { src: 'deezer'; id: number };

/**
 * Where each genre shelf reads from. Regional genres use the legacy iTunes genre feed with a
 * FIXED storefront, independent of the Chart region — the HK storefront's J-Pop and Mandopop
 * charts are stale purchase charts, so Mandopop reads tw and J-Pop reads jp. Western genres read
 * Deezer's genre charts, because the legacy feed ranks iTunes Store purchases (HK Rock median
 * age ~18 years).
 */
export const CHART_GENRES: Record<ChartGenre, ChartGenreSource> = {
	cantopop: { src: 'itunes', cc: 'hk', id: 1251 },
	mandopop: { src: 'itunes', cc: 'tw', id: 1253 },
	kpop: { src: 'itunes', cc: 'hk', id: 51 },
	jpop: { src: 'itunes', cc: 'jp', id: 27 },
	hiphop: { src: 'deezer', id: 116 },
	rock: { src: 'deezer', id: 152 },
	dance: { src: 'deezer', id: 113 },
	rnb: { src: 'deezer', id: 165 },
	electronic: { src: 'deezer', id: 106 },
	alternative: { src: 'deezer', id: 85 },
	asian: { src: 'deezer', id: 16 }
};

/** The Deezer genre ids in pool order — the edge route's allowlist. */
export const DEEZER_GENRE_IDS: readonly number[] = CHART_GENRE_IDS.flatMap((g) => {
	const s = CHART_GENRES[g];
	return s.src === 'deezer' ? [s.id] : [];
});

/** quick-260925-vtg — every pool genre, in pool order (the user's own exported settings adopted
 *  as the defaults; supersedes the 39-D-10 8-genre lock). Kept as an explicit literal, not
 *  `[...CHART_GENRE_IDS]`, so a future pool addition does not silently widen the default. */
export const DEFAULT_CHART_GENRES: readonly ChartGenre[] = [
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
];

/**
 * Resolve the persisted genre selection: pool ids only, de-duped, saved order kept (it is the
 * shelf order). Non-array → the defaults. An EMPTY selection stays empty — it means "no genre
 * shelves", so there is deliberately no fall-back-to-all here (contrast resolveSubset) (T-39-07).
 */
export function resolveChartGenres(saved: unknown): ChartGenre[] {
	if (!Array.isArray(saved)) return [...DEFAULT_CHART_GENRES];
	const out: ChartGenre[] = [];
	for (const g of saved) {
		if ((CHART_GENRE_IDS as readonly unknown[]).includes(g) && !out.includes(g)) out.push(g);
	}
	return out;
}

// ---- Section order + visibility --------------------------------------------------------

/**
 * Stable, canonical section ids for the four home discovery groups, in TODAY's fixed
 * render order (top hits → top artists → genre shelves → country shelves). These strings
 * are PERSISTED (they live in `homeSectionOrder`/`homeHidden`), so they must never change.
 *
 * Note that the per-tag and per-country SHELVES are each grouped under ONE id ('tags' /
 * 'countries') rather than one id per shelf: a reorder moves the whole group as a block,
 * which matches the current four-block layout and keeps the persisted order tiny + stable
 * regardless of which tags/countries the user has selected.
 */
// quick-260924-pgu: 'radio' sits in the personal group at the top so a fresh (or reset) user sees
// personalised content first; an existing user's saved order gets it APPENDED by resolveSectionOrder.
// 39-D-08: the seven chart ids ('chart-songs' … 'regions') sit right after the personal group and
// the four classic Deezer/Last.fm ids follow them. The chart ids are this project's own naming and
// are PERSISTED exactly like the others — once shipped they must never be renamed.
export const HOME_SECTIONS = [
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
] as const;

export type HomeSectionId = (typeof HOME_SECTIONS)[number];

/** 39-D-08: the four pre-chart shelves (Deezer top hits/artists, Last.fm tags/countries). */
export const CLASSIC_SECTIONS = ['top-hits', 'top-artists', 'tags', 'countries'] as const;
/** 39-D-08: the chart shelves, in canonical order. */
export const CHART_SECTIONS = ['chart-songs', 'new-releases', 'chart-artists', 'chart-albums', 'yt-trending', 'genres', 'regions'] as const;
export type ChartSectionId = (typeof CHART_SECTIONS)[number];

/**
 * quick-260925-vtg — no longer === HOME_SECTIONS: this is the user's own exported order (personal
 * group radio-first, classic shelves interleaved where the export put them), adopted as the
 * default. It MUST remain a permutation of all 17 HOME_SECTIONS ids (guarded by
 * home-layout.test.ts) because resolveSectionOrder returns it verbatim as the fallback.
 * HOME_SECTIONS itself stays the canonical/append order and is unchanged.
 */
export const DEFAULT_SECTION_ORDER: HomeSectionId[] = [
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
];

/**
 * Resolve a persisted section order into a VALID render order. Always returns a
 * permutation-superset covering every known section id, so the home page can iterate it
 * directly and a corrupt/old saved value can never blank the render (T-w87-02):
 *   - undefined / empty / non-array (corrupt) → a fresh copy of DEFAULT_SECTION_ORDER.
 *   - unknown / old ids in `saved` are dropped.
 *   - any known id MISSING from `saved` is appended in canonical order (so a newly-added
 *     section never vanishes for an existing user).
 *   - duplicate ids collapse to a single occurrence (the first).
 */
export function resolveSectionOrder(saved: string[] | undefined): HomeSectionId[] {
	if (!Array.isArray(saved) || saved.length === 0) return [...DEFAULT_SECTION_ORDER];
	const known = new Set<string>(HOME_SECTIONS);
	const out: HomeSectionId[] = [];
	const seen = new Set<HomeSectionId>();
	// Keep the user's order, dropping unknown ids and de-duping.
	for (const id of saved) {
		if (known.has(id) && !seen.has(id as HomeSectionId)) {
			out.push(id as HomeSectionId);
			seen.add(id as HomeSectionId);
		}
	}
	// Append any known id the user's order omitted (canonical order) so the result always
	// covers every section — a newly-shipped section is never silently lost.
	for (const id of HOME_SECTIONS) {
		if (!seen.has(id)) out.push(id);
	}
	// If `saved` held ONLY garbage, `out` is now just the appended defaults — still valid.
	return out.length ? out : [...DEFAULT_SECTION_ORDER];
}

/**
 * 39-D-12: move one LISTED row of the /settings/home drag list. `from`/`to` index the listed
 * (non-classic) ids only. Classic ids keep their exact array slot, so a hidden classic shelf never
 * moves when the user drags a listed row; the listed ids refill the remaining slots in the new
 * order. Out-of-range or non-integer indices return an unchanged copy (T-39-09).
 */
export function reorderListed(order: HomeSectionId[], from: number, to: number): HomeSectionId[] {
	const isClassic = (id: HomeSectionId) => (CLASSIC_SECTIONS as readonly string[]).includes(id);
	const listed = order.filter((id) => !isClassic(id));
	const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < listed.length;
	if (!inRange(from) || !inRange(to)) return [...order];
	const [moved] = listed.splice(from, 1);
	listed.splice(to, 0, moved);
	let next = 0;
	return order.map((id) => (isClassic(id) ? id : listed[next++]));
}

// ---- Tag / country subset --------------------------------------------------------------

/**
 * Resolve a persisted tag/country SUBSET against the available `pool`, falling back to the
 * full pool whenever the resolved subset would be empty (T-w87-03 — a poisoned tag string
 * is dropped before it ever reaches the edge, and an empty/garbage selection never yields a
 * blank discovery surface):
 *   - undefined / non-array (corrupt) → the full pool (default = everything, preserves today).
 *   - otherwise, filter `pool` to members the user selected (so the RESULT ORDER follows the
 *     pool's canonical order, NOT the selection order), dropping any selection not in the pool.
 *   - if that filter is empty (none selected, or every selection invalid) → the full pool.
 * Returns a fresh array; never mutates `pool`.
 */
export function resolveSubset(saved: string[] | undefined, pool: string[]): string[] {
	if (!Array.isArray(saved)) return [...pool];
	// Preserve the SAVED (user) order — it drives the home shelf order, so a drag-reorder in
	// settings must survive here. Keep only valid pool members, de-duped. Empty / all-invalid
	// → the full pool (the "showing everything" fallback).
	const known = new Set(pool);
	const seen = new Set<string>();
	const filtered: string[] = [];
	for (const item of saved) {
		if (known.has(item) && !seen.has(item)) {
			seen.add(item);
			filtered.push(item);
		}
	}
	return filtered.length ? filtered : [...pool];
}

// ---- Items per shelf -------------------------------------------------------------------

export const SHELF_MIN = 8;
export const SHELF_MAX = 24;
/** quick-260919-hm1: the default is now the MAXIMUM the slider allows (SHELF_MAX). 24 is also
 *  under HomeGridPager's MAX_TILES=27, so a full shelf is rendered whole — nothing is sliced off
 *  the end at any column count. */
export const SHELF_DEFAULT = SHELF_MAX;

/**
 * Coerce a persisted items-per-shelf value into a SAFE integer in [SHELF_MIN, SHELF_MAX]
 * (T-w87-01 — a poisoned `999` / `"x"` / negative can never produce a giant fan-out limit
 * or a NaN page size that breaks a discovery request):
 *   - non-number / NaN / undefined → SHELF_DEFAULT.
 *   - floors fractionals, then clamps to [SHELF_MIN, SHELF_MAX].
 */
export function clampShelfSize(n: unknown): number {
	if (typeof n !== 'number' || !Number.isFinite(n)) return SHELF_DEFAULT;
	const floored = Math.floor(n);
	if (floored < SHELF_MIN) return SHELF_MIN;
	if (floored > SHELF_MAX) return SHELF_MAX;
	return floored;
}

// ---- Density + landing tab -------------------------------------------------------------

/**
 * Tile density for the home shelves/grid (quick-260618-goe — renamed for developer clarity):
 *   - 'list' — the stacked compact text rows (the CompactPager columns-of-4). (was 'compact')
 *   - 'pile' — the larger horizontal cover shelf (the discoveryShelf albumrow). (was 'comfortable')
 *   - 'grid' — the NEW 3×3 paginated cover grid (HomeGridPager, 9/page · max 3 pages · 27 tiles).
 */
export type HomeDensity = 'list' | 'pile' | 'grid';

/** The three valid density values — single source of truth for the load/render guards. */
export const DENSITY_VALUES = ['list', 'pile', 'grid'] as const;

/**
 * Resolve the EFFECTIVE density for one home section (HOME-02 / D-07). A per-section override
 * wins ONLY when it is exactly one of the three valid values ('list' | 'pile' | 'grid'); any
 * other input — a missing key, an undefined map, or a garbage/non-enum value — falls back to
 * `globalDefault`. This mirrors resolveSubset's "unknown/garbage → fallback, never blank" posture
 * so an attacker-influenceable persisted `homeSectionDensity` map can never throw or blank the
 * render (threats T-23-06/07).
 *
 * The list-by-default behaviour is achieved by the CALLER passing 'list' as `globalDefault`;
 * this resolver only layers a per-section override on top of whatever default the caller chooses.
 */
export function resolveSectionDensity(
	sectionId: HomeSectionId,
	perSection: Partial<Record<HomeSectionId, HomeDensity>> | undefined,
	globalDefault: HomeDensity
): HomeDensity {
	const v = perSection?.[sectionId];
	return DENSITY_VALUES.includes(v as HomeDensity) ? (v as HomeDensity) : globalDefault;
}

/**
 * Pure NON-DESTRUCTIVE migration for a persisted density value (quick-260618-goe). The
 * HomeDensity union was renamed; a returning user's old localStorage values must resolve to
 * the same visual layout:
 *   - legacy 'compact'     → 'list'
 *   - legacy 'comfortable' → 'pile'
 *   - already-new 'list' / 'pile' / 'grid' → passthrough
 *   - anything else (missing, garbage, wrong type) → undefined (the caller picks the fallback).
 * Kept PURE (imports nothing) so the node Vitest project can drive it directly.
 */
export function migrateDensity(v: unknown): HomeDensity | undefined {
	if (v === 'compact') return 'list';
	if (v === 'comfortable') return 'pile';
	if (v === 'list' || v === 'pile' || v === 'grid') return v;
	return undefined;
}
/** Which bottom-nav tab the app opens on at `/`. */
export type HomeLandingTab = 'home' | 'search' | 'library';

/**
 * Fixed mapping from a landing-tab choice to its in-app path. The redirect target is ALWAYS
 * looked up here, never taken from the raw persisted string (T-w87-05 — no open-redirect /
 * arbitrary-path navigation from a poisoned `homeLandingTab`).
 */
export const LANDING_PATHS: Record<HomeLandingTab, string> = {
	home: '/',
	search: '/search',
	library: '/library'
};

// ---- One-time chart-layout migration (39-D-11) -----------------------------------------

/**
 * Persisted home-layout version. A settings blob without the field is version 1. A one-shot
 * migration needs its own persisted version marker (the same record settings.svelte.ts keeps at
 * its upnextPerContext block): without it, a classic shelf the user re-enables would be re-hidden
 * on every load.
 */
export const HOME_LAYOUT_VERSION = 2;

/** Old shelf → its chart counterpart, for the per-section density carry-over. */
const DENSITY_CARRY: [HomeSectionId, HomeSectionId][] = [
	['top-hits', 'chart-songs'],
	['top-artists', 'chart-artists'],
	['tags', 'genres'],
	['countries', 'regions']
];

/**
 * The existing-user switch to the chart layout. Pure, never throws on array input, and idempotent
 * (a second run finds nothing missing and the hidden union is unchanged):
 *   - order: de-duped; only the MISSING chart ids are inserted, in canonical order, at the first
 *     classic id's slot (where the old chart block sat) — after 'radio' when no classic id is
 *     present, else at the start. Chart ids already present stay put.
 *   - hidden: unioned with the four classic ids.
 *   - density: a valid override on an old shelf is copied to its chart counterpart wherever the
 *     counterpart has no valid override of its own.
 * resolveSectionOrder stays the render-time robustness layer for anything still missing (T-39-08).
 */
export function migrateHomeLayout(
	order: string[],
	hidden: string[],
	density: Partial<Record<HomeSectionId, HomeDensity>> = {}
): { order: string[]; hidden: string[]; density: Partial<Record<HomeSectionId, HomeDensity>> } {
	const out = [...new Set(order)];
	const missing = CHART_SECTIONS.filter((id) => !out.includes(id));
	let at = out.findIndex((id) => (CLASSIC_SECTIONS as readonly string[]).includes(id));
	if (at < 0) at = out.includes('radio') ? out.indexOf('radio') + 1 : 0;
	out.splice(at, 0, ...missing);
	const valid = (v: unknown): v is HomeDensity => DENSITY_VALUES.includes(v as HomeDensity);
	const carried: Partial<Record<HomeSectionId, HomeDensity>> = {};
	for (const [from, to] of DENSITY_CARRY) {
		const v = density[from];
		if (valid(v) && !valid(density[to])) carried[to] = v;
	}
	return {
		order: out,
		hidden: [...new Set([...hidden, ...CLASSIC_SECTIONS])],
		density: { ...density, ...carried }
	};
}
