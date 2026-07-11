// Last.fm similar-TRACKS proxy (Phase 26, UPNEXT-01 — the 56→1 up-next change).
//
// Dedicated route (NOT the /api/[source]/[...path] catch-all): reads the OPTIONAL
// LASTFM_KEY from platform.env, calls Last.fm track.getSimilar, and returns a clean
// { tracks: [{ artist, title, match }] } list pre-ranked by Last.fm `match`. The key is
// injected into the upstream URL on the edge and NEVER reaches the client (threat
// T-26-03-01, parity with JOOX_TOKEN / T-01-04 and the shipped /api/similar). The key +
// upstream URL are NEVER logged (T-26-03-01).
//
// Mirrors /api/similar's posture EXACTLY. It CANNOT reuse /api/similar (that is
// artist.getSimilar — artist-only) nor /api/lastfm/info (that whitelists *.getInfo).
//
// An ABSENT key is a SUPPORTED state (T-26-03-05 fallback): with no key — or on any
// upstream error / malformed JSON / Last.fm `error` — we return 200 { tracks: [] } so the
// service layer (buildSimilarQueue) falls back to the artist-hop and playback is never
// blocked. CORS is scoped to the own origin via corsHeaders (never `*`, T-26-03-04).
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import type { Env } from '$lib/proxy/proxy-types';

const LASTFM_ENDPOINT = 'https://ws.audioscrobbler.com/2.0/';
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

/** Clean client-facing pair. Absent-key / error / miss all return { tracks: [] }. */
interface SimilarTrack {
	artist: string;
	title: string;
	match: number;
}

function jsonTracks(tracks: SimilarTrack[], origin: string | null): Response {
	return new Response(JSON.stringify({ tracks }), {
		status: 200,
		headers: { ...corsHeaders(origin), 'content-type': 'application/json' }
	});
}

/** Clamp the client-supplied limit to a small positive integer (T-26-03-03). */
function clampLimit(raw: string | null): number {
	const n = Number.parseInt(raw ?? '', 10);
	if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
	return Math.min(n, MAX_LIMIT);
}

// ---- Last.fm response sub-shapes (only the fields we read) ----
interface LfmSimilarTrack {
	name?: string;
	match?: string | number;
	artist?: { name?: string } | string;
}
interface LfmSimilarBlock {
	track?: LfmSimilarTrack[] | LfmSimilarTrack;
}

function toMatch(v: string | number | undefined): number {
	if (v == null) return 0;
	const n = typeof v === 'number' ? v : Number.parseFloat(v);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Reshape the upstream `{ similartracks: { track: [...] } }` into the clean
 * `{ tracks: [{ artist, title, match }] }` list. Handles Last.fm's array-or-single quirk
 * (a single similar track may come back as an object, as /api/lastfm/info does for
 * tags/tracks), coerces `match` to a number, trims artist/title, drops entries missing
 * artist or title, and PRESERVES the upstream match-descending order — capped to `limit`.
 */
function reshape(block: LfmSimilarBlock | undefined, limit: number): SimilarTrack[] {
	if (!block?.track) return [];
	const arr = Array.isArray(block.track) ? block.track : [block.track];
	const out: SimilarTrack[] = [];
	for (const t of arr) {
		const artist = (typeof t.artist === 'string' ? t.artist : t.artist?.name ?? '').trim();
		const title = (t.name ?? '').trim();
		if (!artist || !title) continue; // drop incomplete pairs
		out.push({ artist, title, match: toMatch(t.match) });
		if (out.length >= limit) break; // upstream is already match-descending
	}
	return out;
}

export const GET: RequestHandler = async ({ url, platform, request }) => {
	const origin = request.headers.get('origin');

	// platform?.env is the verified Cloudflare-adapter path for bindings/secrets.
	const env = platform?.env as Env | undefined;
	const key = env?.LASTFM_KEY;

	// No key configured → supported fallback state. Do NOT throw (unlike JOOX), and
	// do NOT fetch an api_key=undefined upstream URL (T-26-03-05).
	if (!key) return jsonTracks([], origin);

	const artist = (url.searchParams.get('artist') ?? '').trim();
	const track = (url.searchParams.get('track') ?? '').trim();
	// track.getSimilar needs BOTH artist and track — missing either is a supported empty state.
	if (!artist || !track) return jsonTracks([], origin);
	const limit = clampLimit(url.searchParams.get('limit'));

	// artist + track are URL-encoded passthrough only (T-26-03-02 — no command construction;
	// method is fixed to track.getsimilar server-side). The key is injected on the edge.
	const upstream =
		`${LASTFM_ENDPOINT}?method=track.getsimilar` +
		`&artist=${encodeURIComponent(artist)}` +
		`&track=${encodeURIComponent(track)}` +
		`&autocorrect=1` +
		`&api_key=${encodeURIComponent(key)}` +
		`&format=json&limit=${limit}`;

	try {
		// Bounded retry + native timeout (T-26-03-03). NEVER log the key or upstream URL (T-26-03-01).
		const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
		const data = (await res.json()) as { error?: number; similartracks?: LfmSimilarBlock };
		// Last.fm error-6 (not found) and friends → silent empty best-effort.
		if (data?.error) return jsonTracks([], origin);
		return jsonTracks(reshape(data.similartracks, limit), origin);
	} catch {
		// Upstream error / malformed JSON → best-effort empty; client falls back.
		return jsonTracks([], origin);
	}
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-26-03-04).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
