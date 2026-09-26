// home-charts — PURE orchestration helpers for the chart homepage (39-D-20).
//
// The home page and the home settings page call these; they hold the two guarantees that must be
// provable without a browser: `planChartShelves` is "a hidden section issues zero requests" and
// `samplePicks` is "Randomize costs zero requests" (a local re-draw from an already-fetched pool).
//
// Pure module: imports only home-layout, chart-parse, discography, shuffle and a type-only
// TranslationKey. It must NOT import settings.svelte.ts, charts.ts or `$app/*` — the page resolves
// settings into a `ChartPlanConfig` and passes it in. Node-Vitest-testable like home-layout.ts.
import {
	KKBOX_REGIONS,
	YT_REGIONS,
	type ChartGenre,
	type ChartRegion,
	type ChartSectionId
} from '$lib/services/home-layout';
import { stripReleaseSuffix, type ChartAlbum } from '$lib/services/chart-parse';
import { albumHref } from '$lib/services/discography';
import { shuffle } from './shuffle';
import type { TranslationKey } from '$lib/i18n';

/** Resolved home settings — every field has already passed the home-layout resolvers. */
export interface ChartPlanConfig {
	region: ChartRegion;
	/** From `resolveExtraRegions` (main region already excluded — not re-filtered here). */
	extraRegions: readonly ChartRegion[];
	genres: readonly ChartGenre[];
	hidden: readonly string[];
}

/** One fetch the page runs. Tasks sharing a `key` fill the same pool (fused). */
export type ChartTask =
	| { key: string; section: ChartSectionId; src: 'apple'; kind: 'songs' | 'albums'; cc: ChartRegion }
	| { key: string; section: ChartSectionId; src: 'kkbox'; kind: 'song' | 'newrelease'; cc: ChartRegion }
	| { key: string; section: ChartSectionId; src: 'yt'; kind: 'tracks' | 'artists'; cc: ChartRegion }
	| { key: string; section: ChartSectionId; src: 'genre'; genre: ChartGenre };

type RegionPool = 'chart-songs' | 'new-releases' | 'chart-artists' | 'chart-albums' | 'yt-trending' | 'region';

/** 39-D-21 / UI-SPEC §1.7: region-qualified so a region change never shows the previous region's
 *  items under the new title. */
export function poolKey(section: RegionPool, cc: ChartRegion): string {
	return `${section}:${cc}`;
}

export function genrePoolKey(genre: ChartGenre): string {
	return `genre:${genre}`;
}

/**
 * One task per VISIBLE, region-capable shelf, in CHART_SECTIONS order (the most visible shelf is
 * scheduled first). A hidden section pushes nothing — THIS is the "zero requests for a hidden
 * section" guarantee (T-39-21). Bounded by 6 + genres (≤11) + extra regions.
 */
export function planChartShelves(cfg: ChartPlanConfig): ChartTask[] {
	const vis = (id: ChartSectionId) => !cfg.hidden.includes(id);
	const cc = cfg.region;
	const kk = KKBOX_REGIONS.includes(cc);
	const yt = YT_REGIONS.includes(cc);
	const out: ChartTask[] = [];

	if (vis('chart-songs')) {
		const key = poolKey('chart-songs', cc);
		// 39-D-22 (PATTERNS scope correction): in hk/tw/sg KKBOX and Apple are FUSED into one pool,
		// not a fallback — two tasks, one key.
		if (kk) out.push({ key, section: 'chart-songs', src: 'kkbox', kind: 'song', cc });
		out.push({ key, section: 'chart-songs', src: 'apple', kind: 'songs', cc });
	}
	if (vis('new-releases') && kk) {
		out.push({ key: poolKey('new-releases', cc), section: 'new-releases', src: 'kkbox', kind: 'newrelease', cc });
	}
	if (vis('chart-artists') && yt) {
		out.push({ key: poolKey('chart-artists', cc), section: 'chart-artists', src: 'yt', kind: 'artists', cc });
	}
	// KKBOX's album chart type returns error 103, so albums are Apple for every region.
	if (vis('chart-albums')) {
		out.push({ key: poolKey('chart-albums', cc), section: 'chart-albums', src: 'apple', kind: 'albums', cc });
	}
	if (vis('yt-trending') && yt) {
		out.push({ key: poolKey('yt-trending', cc), section: 'yt-trending', src: 'yt', kind: 'tracks', cc });
	}
	if (vis('genres')) {
		for (const genre of cfg.genres) out.push({ key: genrePoolKey(genre), section: 'genres', src: 'genre', genre });
	}
	if (vis('regions')) {
		for (const r of cfg.extraRegions) {
			out.push({ key: poolKey('region', r), section: 'regions', src: 'apple', kind: 'songs', cc: r });
		}
	}
	return out;
}

/**
 * `n` unique pool indices drawn uniformly, returned ASCENDING so the shelf keeps chart-rank order
 * (UI-SPEC UI-9 — no rank numbers are shown). A pool smaller than `n` yields every index.
 */
export function samplePicks(len: number, n: number): number[] {
	if (len <= 0 || n <= 0) return [];
	return shuffle([...Array(Math.floor(len)).keys()])
		.slice(0, Math.floor(n))
		.sort((a, b) => a - b);
}

const displayNames = new Map<string, Intl.DisplayNames>();

/** Short localized region name ('hk' → 'Hong Kong' / '香港'); `cc.toUpperCase()` on any failure (T-39-24). */
export function regionLabel(cc: string, lang: string): string {
	try {
		let dn = displayNames.get(lang);
		if (!dn) {
			dn = new Intl.DisplayNames([lang], { type: 'region', style: 'short' });
			displayNames.set(lang, dn);
		}
		return dn.of(cc.toUpperCase()) || cc.toUpperCase();
	} catch {
		return cc.toUpperCase();
	}
}

/** Localized list of region names ('Taiwan, Japan, South Korea'); '' for none. */
export function regionListLabel(ccs: readonly string[], lang: string): string {
	const labels = ccs.map((cc) => regionLabel(cc, lang));
	if (!labels.length) return '';
	try {
		return new Intl.ListFormat(lang, { type: 'conjunction', style: 'narrow' }).format(labels);
	} catch {
		return labels.join(', ');
	}
}

/**
 * 39-D-23: an album tile opens the existing name-only album page (Last.fm tracklist + enrichment),
 * so the tap itself costs zero calls. Stripping is idempotent, so it never conflicts with the
 * parser's own strip. `albumHref` encodes name + artist into a fixed in-app path (T-39-23).
 */
export function chartAlbumHref(album: ChartAlbum): string {
	return albumHref(
		{ id: null, mbid: null, name: stripReleaseSuffix(album.name), image: album.image, releaseDate: null, type: 'album' },
		album.artist
	);
}

export const CHART_GENRE_LABEL: Record<ChartGenre, TranslationKey> = {
	cantopop: 'home.genre.cantopop',
	mandopop: 'home.genre.mandopop',
	kpop: 'home.genre.kpop',
	jpop: 'home.genre.jpop',
	hiphop: 'home.genre.hiphop',
	rock: 'home.genre.rock',
	dance: 'home.genre.dance',
	rnb: 'home.genre.rnb',
	electronic: 'home.genre.electronic',
	alternative: 'home.genre.alternative',
	asian: 'home.genre.asian'
};

/** 39-D-24: v3 — the home cache now holds pools + picks. Lives in `$lib` (a route file can't be
 *  imported as a helper) so the settings "Clear picks" button, a no-op since the v2 bump, shares it. */
export const HOME_CACHE_KEY = 'openmusic:top-picks:v3';
/** Old home-cache keys to remove on load / clear. */
export const LEGACY_HOME_CACHE_KEYS: readonly string[] = ['openmusic:top-picks:v1', 'openmusic:top-picks:v2'];
/** A pool older than this is refetched. */
export const POOL_STALE_MS = 6 * 3600_000;
/** Max rows kept per pool. */
export const POOL_CAP = 50;
