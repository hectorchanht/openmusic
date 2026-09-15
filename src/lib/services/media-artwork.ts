// media-artwork — turn a cover URL into a `data:` URL the native media-session plugin
// cannot crash on (quick-260913-artcrash-2).
//
// WHY THIS EXISTS. `@jofr/capacitor-media-session`'s `setMetadata` is declared
// `throws IOException`, and its `urlToBitmap()` runs a blocking
// `HttpURLConnection.connect()` with NO try/catch:
//
//     private Bitmap urlToBitmap(String url) throws IOException {
//         final boolean httpUrl = url.startsWith("http");
//         if (httpUrl) { ... connection.connect(); ... }      // <- any failure escapes
//         int base64Index = url.indexOf(";base64,");          // <- this branch never touches the network
//
// Capacitor invokes plugin methods by reflection on the `CapacitorPlugins` HandlerThread, so an
// IOException there is UNCAUGHT and kills the process. The JS-side fire-and-forget `.catch()` in
// native-media-session.ts cannot intercept it — the throw happens natively, before any promise
// settles. A dead process on a metadata write is especially nasty here because `restore()` replays
// the persisted track's cover on launch, turning one bad cover into an app that will not open.
//
// The earlier fix (buildArtwork's `hasHttpsScheme` gate) closed the cleartext trigger. It did not
// close the rest: an https cover whose fetch fails natively — offline playback of a downloaded
// track, a 404, a TLS error, a DNS failure — still throws inside the plugin and still kills the
// app. The only way to close it for good is to never hand the plugin a URL it has to fetch, which
// means resolving the bytes in JS (where a failure is an ordinary rejection) and passing the
// `;base64,` branch instead.
//
// BYTE SOURCES, in order. Measured from the app origin (https://localhost) inside the Android
// WebView on 2026-09-13, because CORS decides this and guessing it wrong silently costs artwork:
//
//   cdn-images.dzcdn.net   ok   type:"cors"   (Deezer — the primary cover tier)
//   is1-ssl.mzstatic.com   ok   type:"cors"   (iTunes — the second tier)
//   y.gtimg.cn             FAIL TypeError: Failed to fetch  (QQ/CN — no CORS headers)
//
// So a direct fetch covers the Deezer/iTunes tiers and cannot cover the CN tier. For CN covers we
// fall back to `/api/og`, which is already an own-origin, host-allowlisted, content-type-validated,
// size-capped, twice-cached image endpoint. It deliberately accepts TEXT (artist+title) and never a
// URL (T-24-08 / T-wv8-01) — that restriction is a security control and is NOT relaxed here; we
// simply use it the way it was designed to be used, with the title/artist the media session already
// has in hand.
//
// A total miss on /api/og is NOT a miss at the HTTP level: it answers 200 + image/jpeg + the branded
// openmusic share card, because a crawler that gets a non-200 shows no card at all. That response
// carries `x-og-fallback` and fetchAsDataUrl treats it as no cover (quick-260914-to2).
//
// If every source fails we return null and the caller sends the `/favicon.svg` sentinel, which
// matches neither of the plugin's branches — `urlToBitmap` returns null without touching the
// network, clearing stale art rather than crashing.
import { apiUrl } from '$lib/services/api-base';
import { hasHttpsScheme } from '$lib/services/url-safety';

/**
 * Cap on the decoded image. Base64 inflates by 4/3 and the result crosses the Capacitor JSON
 * bridge as a string, so a huge cover would be paid for twice. The live probe recorded in
 * /api/og's header measured real covers at 72-104 KB, so 1 MB is far above anything legitimate
 * and only rejects a pathological response.
 */
export const MAX_ART_BYTES = 1_000_000;

/** Per-fetch deadline. Artwork is decoration — it must never hold up a metadata write for long. */
export const ART_FETCH_TIMEOUT_MS = 6_000;

/** Image MIME types worth handing to BitmapFactory. An HTML error page must never get through. */
function isImageType(contentType: string | null): boolean {
	return typeof contentType === 'string' && contentType.toLowerCase().startsWith('image/');
}

/**
 * Base64-encode bytes without FileReader (absent in the node test project) and without
 * `String.fromCharCode(...bytes)` (which blows the argument limit on a 100 KB image).
 * Chunked so the spread stays small.
 */
export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

/** Fetch one URL and encode it as a `data:` URL, or null on ANY failure. Never throws. */
async function fetchAsDataUrl(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(ART_FETCH_TIMEOUT_MS) });
		if (!res.ok) return null;
		// quick-260914-to2: /api/og NEVER 404s a cover miss — it serves 200 + image/jpeg + the branded
		// share card so a social crawler always gets an image. A 200 image that IS the card is not a
		// cover: accepting it stamped the openmusic logo into no-cover downloads as FrontCover and onto
		// the OS media card. The marker is the only discriminant (both outcomes are valid 200 images);
		// the route exposes it via Access-Control-Expose-Headers so this read also works on the native
		// build, where /api/og is cross-origin. null here lets the caller embed nothing / send the
		// favicon sentinel — do not "fix" this back to returning the bytes.
		if (res.headers.get('x-og-fallback')) return null;
		const type = res.headers.get('content-type');
		if (!isImageType(type)) return null;
		const buf = await res.arrayBuffer();
		if (buf.byteLength === 0 || buf.byteLength > MAX_ART_BYTES) return null;
		// Strip any `; charset=…` parameter — the data: URL wants the bare MIME.
		const mime = (type ?? 'image/jpeg').split(';')[0].trim();
		return `data:${mime};base64,${bytesToBase64(new Uint8Array(buf))}`;
	} catch {
		// CORS rejection, offline, DNS failure, timeout, 404 — all land here as an ordinary
		// rejection instead of a native uncaught IOException. That is the entire point.
		return null;
	}
}

/** What the media session knows about the track, used to build the /api/og fallback query. */
export interface ArtworkQuery {
	cover: string | null;
	title: string;
	artist: string;
}

/**
 * Resolve `q` to a `data:` URL, or null if no source produced usable image bytes.
 *
 * Order: an already-inlined data: URL is passed through untouched; then the cover URL directly
 * (works for the CORS-clean Deezer/iTunes tiers); then own-origin /api/og by title+artist (the
 * only route to CN covers, which send no CORS headers). A non-https cover is never fetched — it
 * would be blocked as mixed content anyway, and it is the exact input that crashed the app.
 */
export async function resolveArtworkDataUrl(q: ArtworkQuery): Promise<string | null> {
	if (q.cover && q.cover.startsWith('data:')) return q.cover;

	if (hasHttpsScheme(q.cover)) {
		const direct = await fetchAsDataUrl(q.cover);
		if (direct) return direct;
	}

	// /api/og resolves a cover from TEXT. Without at least a title it has nothing to work with.
	if (!q.title.trim()) return null;
	const params = new URLSearchParams({ type: 'song', title: q.title, artist: q.artist });
	return fetchAsDataUrl(apiUrl(`/api/og?${params.toString()}`));
}
