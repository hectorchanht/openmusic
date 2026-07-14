// YouTube Music STREAM byte-proxy (Plan 27-03, YT-PLAY-01 / YT-DOWNLOAD-01) — THE WALL (spike 006).
//
// GET /api/ytmusic/stream/:videoId — pure itag-140 selection + playability gate (Task 1). The route
// handler (ANDROID_VR player -> googlevideo relay) lands in Task 2.
//
// ZERO auth: the player call uses an ANONYMOUS visitorData token only (spike 006) — no Google
// account, no PoToken, no cookie. Nothing here introduces an account/OAuth/user-token surface.

// --- Untrusted InnerTube player-response shapes — every field optional, accessed via optional
// chaining (no `as any`, mirroring the search-adapter + lyrics-walker typing). ---
interface YtAdaptiveFormat {
	itag?: number;
	mimeType?: string;
	bitrate?: number;
	/** Direct googlevideo URL — present for itag 140 (spike 006: no signatureCipher, no n-throttle). */
	url?: string;
	/** A ciphered format has this INSTEAD of `url`; we ignore it (we solve no signature cipher). */
	signatureCipher?: string;
}
interface YtPlayerJson {
	playabilityStatus?: { status?: string; reason?: string };
	streamingData?: { adaptiveFormats?: YtAdaptiveFormat[] };
}

/**
 * True only when `playabilityStatus.status === 'OK'`. LOGIN_REQUIRED / UNPLAYABLE / a bot challenge
 * are all false — the route refreshes visitorData once then 502s (Task 2).
 */
export function isPlayable(playerJson: unknown): boolean {
	return (playerJson as YtPlayerJson)?.playabilityStatus?.status === 'OK';
}

/**
 * Pick the streamable audio URL from a player response's adaptiveFormats:
 *   1. itag 140 (AAC-LC / mp4, 128 kbps) with a direct `url` — the codec iOS Safari `<audio>` plays
 *      (Opus/webm itag 251 does NOT play in Safari, so it is NEVER chosen).
 *   2. else the highest-bitrate `audio/mp4` format with a direct `url` (a safety fallback).
 *   3. else null (no playable AAC — the route 502s so cross-source fallback engages).
 * Ciphered formats (signatureCipher, no `url`) are ignored — we solve no signature cipher (spike 006).
 */
export function selectAudioFormat(playerJson: unknown): string | null {
	const formats = (playerJson as YtPlayerJson)?.streamingData?.adaptiveFormats ?? [];

	// 1. itag 140 = AAC-LC/mp4 128k — the primary pick (spike 006).
	const itag140 = formats.find(
		(f) => f?.itag === 140 && typeof f?.url === 'string' && f.url.length > 0
	);
	if (itag140?.url) return itag140.url;

	// 2. Fallback: highest-bitrate audio/mp4 with a DIRECT url (never Opus/webm, never ciphered).
	const mp4 = formats
		.filter(
			(f) =>
				typeof f?.url === 'string' &&
				f.url.length > 0 &&
				(f?.mimeType ?? '').startsWith('audio/mp4')
		)
		.sort((a, b) => (b?.bitrate ?? 0) - (a?.bitrate ?? 0));

	return mp4[0]?.url ?? null;
}
