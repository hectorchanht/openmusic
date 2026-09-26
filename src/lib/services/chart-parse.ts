// chart-parse — reshape Apple Music RSS, KKBOX kma, YouTube Charts and legacy iTunes RSS chart bodies
// into the existing discovery shapes (`DiscoveryTrack` / `DiscoveryArtist`) plus `ChartAlbum`.
//
// Every body here is untrusted, two upstreams are undocumented, and two LIE with a 200 on bad input:
// YouTube Charts serves the GLOBAL chart for an unsupported country, and the legacy iTunes genre feed
// serves the OVERALL chart for a bogus genre id. So the validation lives here, in pure parsers pinned
// by real fixtures (`__fixtures__/charts`), and the edge route + client services are thin callers.
//
// Contract: every parser returns `[]` (never throws) on null / {} / [] / a string / schema drift, reads
// at most 50 rows, and never emits a raw image URL — it goes through the caller's `ImageValidator`
// (the edge binds `safeImageUrl` + the per-source host allowlist).
//
// Pure module: no runes, no `$state`, no `$app/*`, no store imports — imported by BOTH the edge proxy
// and the client, and node-Vitest-testable like match-key.ts.
import type { DiscoveryTrack, DiscoveryArtist } from '$lib/services/lastfm';

/** An album-chart row (Apple RSS `most-played/albums`). */
export interface ChartAlbum {
	name: string;
	artist: string;
	image: string | null;
}

/**
 * Image validator, passed in so the same parser serves the edge (`safeImageUrl` + APPLE_/KKBOX_/
 * YOUTUBE_IMAGE_HOSTS) and the client iTunes feed. Returns null for anything it does not approve.
 */
export type ImageValidator = (u?: string | null) => string | null;

const MAX_ROWS = 50;

/** A trimmed string, or '' for anything that is not a string (schema drift never throws). */
function str(v: unknown): string {
	return typeof v === 'string' ? v.trim() : '';
}

/** A string url or undefined — what an ImageValidator accepts. */
function url(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

/** The first MAX_ROWS elements when `v` is an array, else [] (a string or object never reaches .map). */
function rows<T>(v: unknown): T[] {
	return Array.isArray(v) ? v.slice(0, MAX_ROWS) : [];
}

function isObject(v: unknown): v is object {
	return !!v && typeof v === 'object';
}

// 39-D-02: Apple RSS sends artworkUrl100 …/100x100bb.jpg and the legacy iTunes feed …/170x170bb.png.
// One regex serves both — upgradeArtwork() in itunes-cover.ts only swaps the literal '100x100bb',
// which is why this is a new helper and not a reuse.
/** Rewrite an mzstatic `/NxNbb.` size segment to `/{px}x{px}bb.`; null for a missing url. */
export function resizeMzstatic(url: string | null | undefined, px = 600): string | null {
	if (!url) return null;
	return url.replace(/\/\d+x\d+bb\./, `/${px}x${px}bb.`);
}

/** Upsize a googleusercontent `=w180-h180-l90-rj` thumbnail to 544px; any other url is returned as-is. */
export function resizeYtThumb(url: string | null | undefined): string | null {
	if (!url) return null;
	return url.replace(/=w\d+-h\d+(-[a-z0-9-]*)?$/, '=w544-h544$1');
}

/**
 * Drop a trailing ASCII alias from a non-ASCII name: '田馥甄 (Hebe)' → '田馥甄'. 60-70% of KKBOX artist
 * names carry one, and YouTube zh-TW emits '五月天 (Mayday)' too. An ASCII-only name keeps its brackets
 * ('Taylor Swift (Deluxe)' is a real name, not an alias).
 */
export function stripLatinAlias(name: string): string {
	const s = name ?? '';
	const m = /^(.*\S)\s*\(([\x20-\x7E]+)\)\s*$/.exec(s);
	return m && /[^\x00-\x7F]/.test(m[1]) ? m[1].trim() : s.trim();
}

/** 'X - EP' / 'X - Single' → 'X' (Apple album names). */
export function stripReleaseSuffix(name: string): string {
	return (name ?? '').replace(/\s+-\s+(Single|EP)$/i, '').trim();
}

// ── Apple Music RSS v2 ────────────────────────────────────────────────────────────────────────

interface AppleRow {
	name?: unknown;
	artistName?: unknown;
	artworkUrl100?: unknown;
}
interface AppleFeed {
	feed?: { results?: AppleRow[] };
}

/** Apple RSS v2 `most-played/{songs|albums}.json` → tracks or albums (600px mzstatic covers). */
export function parseAppleRss(data: unknown, kind: 'songs', img: ImageValidator): DiscoveryTrack[];
export function parseAppleRss(data: unknown, kind: 'albums', img: ImageValidator): ChartAlbum[];
export function parseAppleRss(
	data: unknown,
	kind: 'songs' | 'albums',
	img: ImageValidator
): DiscoveryTrack[] | ChartAlbum[] {
	if (!isObject(data)) return [];
	const results = rows<AppleRow>((data as AppleFeed).feed?.results);
	const image = (r: AppleRow) => img(resizeMzstatic(url(r?.artworkUrl100)));
	if (kind === 'albums') {
		return results
			.map((r) => ({
				name: stripReleaseSuffix(str(r?.name)),
				artist: str(r?.artistName),
				image: image(r)
			}))
			.filter((a) => a.name && a.artist);
	}
	return results
		.map((r) => ({ artist: str(r?.artistName), title: str(r?.name), image: image(r), mbid: null }))
		.filter((t) => t.artist && t.title);
}

// ── KKBOX kma ─────────────────────────────────────────────────────────────────────────────────

interface KkboxRow {
	song_name?: unknown;
	artist_name?: unknown;
	cover_image?: { normal?: unknown };
}
interface KkboxBody {
	data?: { charts?: Partial<Record<string, KkboxRow[]>> };
}

/**
 * KKBOX kma `/charts/api/v1/daily?type={song|newrelease}` → tracks. A missing bucket is [] (the body
 * for one type never carries the other). Artist Latin aliases are stripped for display.
 *
 * 39-D-03: KKBOX ` - 電影《…》主題曲` title subtitles are KEPT — the displayed title keeps them (UI-SPEC
 * 1.4) and their effect on resolve could not be measured while the CN upstreams were dry.
 */
export function parseKkbox(
	data: unknown,
	type: 'song' | 'newrelease',
	img: ImageValidator
): DiscoveryTrack[] {
	if (!isObject(data)) return [];
	return rows<KkboxRow>((data as KkboxBody).data?.charts?.[type])
		.map((r) => ({
			artist: stripLatinAlias(str(r?.artist_name)),
			title: str(r?.song_name),
			image: img(url(r?.cover_image?.normal)), // i.kfs.io …/fit/500x500.jpg
			mbid: null
		}))
		.filter((t) => t.artist && t.title);
}

// ── YouTube Charts ────────────────────────────────────────────────────────────────────────────

interface YtBody {
	contents?: {
		sectionListRenderer?: {
			contents?: {
				musicAnalyticsSectionRenderer?: {
					content?: {
						perspectiveMetadata?: { requestParams?: { chartParams?: { countryCode?: unknown } } };
					};
				};
			}[];
		};
	};
}
interface YtThumbnail {
	thumbnail?: { thumbnails?: { url?: unknown }[] };
}
interface YtTrackRow extends YtThumbnail {
	name?: unknown;
	artists?: { name?: unknown }[];
}
interface YtArtistRow extends YtThumbnail {
	name?: unknown;
}

/** The first array found under `key`, depth-first. The row lists sit at different depths per chart type. */
function deepFind(o: unknown, key: string): unknown[] | null {
	if (!isObject(o)) return null;
	const rec = o as Record<string, unknown>;
	const hit = rec[key];
	if (Array.isArray(hit)) return hit;
	for (const v of Object.values(rec)) {
		const found = deepFind(v, key);
		if (found) return found;
	}
	return null;
}

/** The largest (last) thumbnail, upsized when it is a sized googleusercontent url. */
function ytImage(r: YtThumbnail, img: ImageValidator): string | null {
	const thumbs = r?.thumbnail?.thumbnails;
	const last = Array.isArray(thumbs) ? thumbs.at(-1) : undefined;
	return img(resizeYtThumb(url(last?.url)));
}

/** YouTube Charts `FEmusic_analytics_charts_home` weekly TRACKS / ARTISTS → tracks or artists. */
export function parseYtCharts(
	data: unknown,
	cc: string,
	kind: 'tracks',
	img: ImageValidator
): DiscoveryTrack[];
export function parseYtCharts(
	data: unknown,
	cc: string,
	kind: 'artists',
	img: ImageValidator
): DiscoveryArtist[];
export function parseYtCharts(
	data: unknown,
	cc: string,
	kind: 'tracks' | 'artists',
	img: ImageValidator
): DiscoveryTrack[] | DiscoveryArtist[] {
	if (!isObject(data)) return [];
	// 39-D-04 (RESEARCH Pitfall 3, probed 2026-09-25): an unsupported country returns 200 + the GLOBAL
	// chart; the only tell is the echoed countryCode ('global'). Never trust the status — gate on the
	// echo before a single row is read.
	const echo = (data as YtBody).contents?.sectionListRenderer?.contents?.[0]
		?.musicAnalyticsSectionRenderer?.content?.perspectiveMetadata?.requestParams?.chartParams
		?.countryCode;
	if (typeof echo !== 'string' || echo !== cc) return [];

	if (kind === 'artists') {
		return rows<YtArtistRow>(deepFind(data, 'artistViews'))
			.map((r) => ({ name: stripLatinAlias(str(r?.name)), image: ytImage(r, img), mbid: null }))
			.filter((a) => a.name);
	}
	return rows<YtTrackRow>(deepFind(data, 'trackViews'))
		.map((r) => ({
			artist: rows<{ name?: unknown }>(r?.artists)
				.map((a) => stripLatinAlias(str(a?.name)))
				.filter(Boolean)
				.join(', '),
			title: str(r?.name),
			image: ytImage(r, img),
			mbid: null
		}))
		.filter((t) => t.artist && t.title);
}

// ── Legacy iTunes RSS genre feed (client-side) ────────────────────────────────────────────────

interface ItunesEntry {
	'im:name'?: { label?: unknown };
	'im:artist'?: { label?: unknown };
	'im:image'?: { label?: unknown }[];
	category?: { attributes?: { 'im:id'?: unknown } };
}
interface ItunesFeed {
	feed?: { entry?: ItunesEntry | ItunesEntry[] };
}

/** Legacy iTunes `/{cc}/rss/topsongs/limit=100/genre={id}/json` → on-genre tracks (600px covers). */
export function parseItunesGenreFeed(
	data: unknown,
	genreId: number,
	img: ImageValidator
): DiscoveryTrack[] {
	if (!isObject(data)) return [];
	const raw = (data as ItunesFeed).feed?.entry;
	// 39-D-05: a feed with exactly one row carries `entry` as an OBJECT, not an array.
	const entries: ItunesEntry[] = Array.isArray(raw) ? raw : isObject(raw) ? [raw] : [];
	const want = String(genreId);
	return (
		entries
			// 39-D-06: a bogus genre id returns 200 with the OVERALL chart — keep only rows that carry
			// the requested genre id.
			.filter((e) => e?.category?.attributes?.['im:id'] === want)
			.slice(0, MAX_ROWS)
			.map((e) => {
				const images = e['im:image'];
				const last = Array.isArray(images) ? images.at(-1) : undefined;
				return {
					artist: str(e['im:artist']?.label),
					title: str(e['im:name']?.label),
					image: img(resizeMzstatic(url(last?.label))), // 170x170bb.png → 600x600bb.png
					mbid: null
				};
			})
			.filter((t) => t.artist && t.title)
	);
}
