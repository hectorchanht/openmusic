// Jamendo client adapter (quick-260607-ixw — Western CC-licensed indie catalog).
//
// Jamendo fills the OTHER big gap our existing sources don't reach: Creative-Commons indie
// + Western non-mainstream. Net-new supply, zero overlap with the CN sources or 5sing UGC.
// Direct progressive mp3 (`audioformat=mp32`) — plays in <audio> with no MSE / no DRM.
//
// Ships `enabledByDefault: false` (CC indie is a different intent than mainstream search;
// users opt in via the /settings/playback Advanced — Sources accordion added in ii6).
//
// Auth: a PUBLIC `client_id` is sent on every API request — exactly the same posture as
// the Last.fm public API key. The client_secret Jamendo issues alongside is ONLY needed
// for OAuth flows (user-authorization for upload / favourite-on-jamendo / etc.) which we
// don't implement. The secret is intentionally NOT used anywhere in this app and never
// reaches the proxy or the client bundle.

import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl } from '../services/lrc';
import { apiFetch } from '../services/api-base';

// Upstream `results[]` row shape — only the fields we read; all optional (untrusted JSON).
interface JmResult {
	id?: string;
	name?: string;
	artist_name?: string;
	album_name?: string;
	image?: string;          // album/track cover URL
	album_image?: string;    // sometimes only this is set
	audio?: string;          // streaming mp3 (mp32 = 96kbps OGG-equivalent mp3 by name)
}
interface JmHeaders {
	status?: 'success' | 'failed';
	code?: number;           // 0 = success
	error_message?: string;
}
interface JmResponse {
	headers?: JmHeaders;
	results?: JmResult[];
}

export const jamendo: SourceAdapter = {
	id: 'jamendo',
	label: 'Jamendo',
	// CC indie is opt-in. The Playback Advanced — Sources accordion (ii6) is the discovery path.
	enabledByDefault: true,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		// Jamendo's v3 API paginates via `offset` not `page`. limit=20 matches our other adapters'
		// "first page = 20 rows" idiom. The proxy fills client_id; we never send it from the
		// client (defense-in-depth even though it's a public id).
		const offset = Math.max(0, ((page || 1) - 1) * 20);
		const path = `/api/jamendo/search?search=${encodeURIComponent(keyword)}&limit=20&offset=${offset}`;

		const res = await apiFetch(path, { signal });
		const json = (await res.json()) as JmResponse | null;

		// Contract-drift guard: success envelope is `{ headers: { code: 0 }, results: [] }`.
		// Anything else → throw so the fan-out records a typed per-source error.
		if (!json || !json.headers || json.headers.code !== 0 || !Array.isArray(json.results)) {
			throw new Error('jamendo: contract-drift (expected {headers:{code:0}, results:[]})');
		}

		const tracks: Track[] = [];
		json.results.forEach((it, idx) => {
			if (!it.id || !it.audio) return; // unplayable row — skip
			const songid = String(it.id);
			tracks.push({
				uid: makeUid('jamendo', songid),
				source: 'jamendo',
				songid,
				title: it.name || '',
				artist: it.artist_name || '',
				album: it.album_name || '',
				cover: it.image || it.album_image || null,
				// Jamendo gives the streaming URL right at search time — no resolve hop needed
				// for audioUrl. We still set detailsLoaded=false so resolve() runs once to fill
				// quality tags (the readiness guard in catalog.ts already short-circuits when
				// audioUrl is present + lrc is null AND lrcUrl is null, which IS true here, so
				// resolve() typically no-ops on the second call — exactly what we want).
				audioUrl: it.audio,
				lrc: null,
				lrcUrl: null,
				detailsLoaded: false,
				quality: null,
				qualityLabel: null,
				keyword,
				displayIndex: idx + 1
			});
		});
		return tracks;
	},

	async resolve(track: Track, signal: AbortSignal): Promise<Track> {
		// Jamendo's audio URL is delivered at SEARCH time, so resolve() is normally a no-op:
		// stamp detailsLoaded + the quality tag from the URL extension, return. If audioUrl is
		// missing (extremely rare — search filters those rows out) we throw, mirroring the
		// other adapters so cross-source fallback (SRC-FB-01) can kick in.
		void signal; // no network — nothing to abort
		if (!track.audioUrl) throw new Error('jamendo: missing audioUrl on resolve');
		const q = inferQualityFromUrl(track.audioUrl);
		track.quality = q.tag;
		track.qualityLabel = q.label;
		track.detailsLoaded = true;
		return track;
	}
};
