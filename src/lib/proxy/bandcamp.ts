// Bandcamp upstream helpers (43) — PURE parsers/validators plus the one shared
// network resolve, used by the edge routes /api/bandcamp/{search,resolve,stream}.
//
// Upstream facts (live-verified 2026-11-04):
//   - Search: POST bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic
//     {search_text, search_filter:'t'} → auto.results[] (≤ 50, no pagination).
//     Rows carry id + band_id; our songid is `${band_id}-${id}`.
//   - Resolve: GET bandcamp.com/api/mobile/24/tralbum_details?band_id&tralbum_type=t
//     &tralbum_id → tracks[0].{duration, streaming_url['mp3-128']}. An unknown id
//     is HTTP 200 `{error:true, error_message}` — never trust the status (Pitfall 7).
//   - streaming_url is bandcamp.com/stream_redirect → 302 → t4.bcbits.com/stream/…
//     mp3-128 progressive; ts = now + 24 h; 206 on Range; no Referer check.
//   - bcbits sends NO ACAO header: <audio> plays the direct URL fine, but a
//     download fetch() → Blob is CORS-blocked, hence the own-origin stream route.
//   - Art: https://f4.bcbits.com/img/a{art_id}_16.jpg (700 px). Built from the
//     numeric art_id, never echoed from the row's `img` field.
import { fetchWithRetry } from './http';
import { safeImageUrl, BANDCAMP_IMAGE_HOSTS } from './safe-image-url';

export interface BandcampRow {
	id: string;
	title: string;
	artist: string;
	album: string;
	cover: string | null;
}

const BC_ID_RE = /^\d{1,12}-\d{1,12}$/;

/** `band_id-track_id`, both numeric — the only input any Bandcamp route accepts. */
export function isBandcampId(id: string): boolean {
	return BC_ID_RE.test(id);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const numericId = (v: unknown): string | null =>
	(typeof v === 'number' && Number.isInteger(v) && v > 0) ||
	(typeof v === 'string' && /^\d{1,12}$/.test(v))
		? String(v)
		: null;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** autocomplete_elastic body → track rows. Every field is untrusted. */
export function parseBandcampSearch(json: unknown): BandcampRow[] {
	if (!isRecord(json) || !isRecord(json.auto) || !Array.isArray(json.auto.results)) return [];
	const rows: BandcampRow[] = [];
	for (const r of json.auto.results) {
		if (!isRecord(r) || r.type !== 't') continue;
		const id = numericId(r.id);
		const band = numericId(r.band_id);
		const title = str(r.name).trim();
		if (!id || !band || !title) continue;
		const art = numericId(r.art_id);
		rows.push({
			id: `${band}-${id}`,
			title,
			artist: str(r.band_name),
			album: str(r.album_name),
			cover: art ? safeImageUrl(`https://f4.bcbits.com/img/a${art}_16.jpg`, BANDCAMP_IMAGE_HOSTS) : null
		});
	}
	return rows;
}

/** tralbum_details body → the mp3-128 stream_redirect + duration (s), or null. */
export function streamFromTralbum(json: unknown): { redirect: string; duration: number } | null {
	if (!isRecord(json) || json.error === true || !Array.isArray(json.tracks)) return null;
	const t = json.tracks[0];
	if (!isRecord(t) || !isRecord(t.streaming_url)) return null;
	const redirect = t.streaming_url['mp3-128'];
	if (typeof redirect !== 'string' || !redirect.startsWith('https://')) return null;
	const duration = Number(t.duration);
	return { redirect, duration: Number.isFinite(duration) ? duration : 0 };
}

/** The one media-host shape the stream route will ever fetch: https + *.bcbits.com. */
export function isBcbitsMediaUrl(url: string): boolean {
	try {
		const u = new URL(url);
		return u.protocol === 'https:' && u.hostname.toLowerCase().endsWith('.bcbits.com');
	} catch {
		return false;
	}
}

/**
 * id → signed bcbits media URL (valid 24 h) + duration. Shared by resolve and
 * stream so the SSRF discipline lives in one place: the tralbum URL is a fixed
 * template over a validated id, and the 302 Location is returned only when it
 * passes isBcbitsMediaUrl. Throws only on abort/network; null = unstreamable.
 */
export async function resolveBandcampStream(
	id: string,
	signal: AbortSignal
): Promise<{ url: string; duration: number } | null> {
	if (!isBandcampId(id)) return null;
	const [band, track] = id.split('-');
	const res = await fetchWithRetry(
		`https://bandcamp.com/api/mobile/24/tralbum_details?band_id=${band}&tralbum_type=t&tralbum_id=${track}`,
		{ signal },
		1
	);
	if (!res.ok) return null;
	const stream = streamFromTralbum(await res.json().catch(() => null));
	if (!stream) return null;
	const hop = await fetch(stream.redirect, { redirect: 'manual', signal });
	await hop.body?.cancel().catch(() => {});
	const location = hop.headers.get('location');
	if (!location || !isBcbitsMediaUrl(location)) return null;
	return { url: location, duration: stream.duration };
}
