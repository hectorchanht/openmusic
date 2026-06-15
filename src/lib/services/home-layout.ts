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

// Curated DEFAULT selections (a fresh user sees these as shelves — a manageable subset of the
// broad pools above, balancing global + CJK). The full pools remain available as toggle chips.
export const DEFAULT_HOME_TAGS: string[] = [
	'cantopop',
	'mandopop',
	'pop',
	'hip-hop',
	'rock',
	'k-pop',
	'electronic',
	'latin'
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
export const HOME_SECTIONS = ['liked', 'downloads', 'top-hits', 'top-artists', 'fav-artists', 'tags', 'countries', 'playlists', 'history'] as const;

export type HomeSectionId = (typeof HOME_SECTIONS)[number];

/**
 * Default order === HOME_SECTIONS (preserves today's fixed order). A fresh spread so the
 * caller can never accidentally mutate the canonical constant.
 */
export const DEFAULT_SECTION_ORDER: HomeSectionId[] = [...HOME_SECTIONS];

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
export const SHELF_DEFAULT = 16;

/**
 * Coerce a persisted items-per-shelf value into a SAFE integer in [SHELF_MIN, SHELF_MAX]
 * (T-w87-01 — a poisoned `999` / `"x"` / negative can never produce a giant fan-out limit
 * or a NaN page size that breaks a discovery request):
 *   - non-number / NaN / undefined → SHELF_DEFAULT.
 *   - floors fractionals, then clamps to [6, 24].
 */
export function clampShelfSize(n: unknown): number {
	if (typeof n !== 'number' || !Number.isFinite(n)) return SHELF_DEFAULT;
	const floored = Math.floor(n);
	if (floored < SHELF_MIN) return SHELF_MIN;
	if (floored > SHELF_MAX) return SHELF_MAX;
	return floored;
}

// ---- Density + landing tab -------------------------------------------------------------

/** Tile density for the home shelves/grid. */
export type HomeDensity = 'comfortable' | 'compact';

/**
 * Resolve the EFFECTIVE density for one home section (HOME-02 / D-07). A per-section override
 * wins ONLY when it is exactly 'comfortable' or 'compact'; any other input — a missing key, an
 * undefined map, or a garbage/non-enum value — falls back to `globalDefault`. This mirrors
 * resolveSubset's "unknown/garbage → fallback, never blank" posture so an attacker-influenceable
 * persisted `homeSectionDensity` map can never throw or blank the render (threats T-23-06/07).
 *
 * Compact-by-default (D-07 "all compact by default") is achieved by the CALLER passing 'compact'
 * as `globalDefault` (Plan 04 wires this); the persisted `homeDensity` field semantics are
 * unchanged — this resolver only layers a per-section override on top of whatever default the
 * caller chooses.
 */
export function resolveSectionDensity(
	sectionId: HomeSectionId,
	perSection: Partial<Record<HomeSectionId, HomeDensity>> | undefined,
	globalDefault: HomeDensity
): HomeDensity {
	const v = perSection?.[sectionId];
	return v === 'comfortable' || v === 'compact' ? v : globalDefault;
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
