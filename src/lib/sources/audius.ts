// Audius client adapter (quick-260616-0zn — net-new Western/indie/electronic + UGC catalog).
//
// Zero overlap with the CN sources or Jamendo. Fully public — `app_name` (appended by the
// proxy) is a free-text identifier, NOT a key. Search returns a flat best-match list with no
// reliable pagination, so page>1 is treated as "no more" (research note A3).
//
// Audius does NOT return the file URL in search JSON; the stream URL is DETERMINISTIC from the
// track id, so resolve() has NO JSON hop — it just stamps the own-origin
// /api/audius/stream/{id} path (the proxy follows the 302 to the signed GCS mp3 and streams
// the body). Using the apiUrl seam keeps <audio>.src own-origin (Capacitor/CORS-safe), exactly
// like the Netease <audio>.src note in api-base.ts.

import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl } from '../services/lrc';
import { apiFetch, apiUrl } from '../services/api-base';

// Upstream `data[]` row shape — only the fields we read; all optional (untrusted JSON).
interface AudiusRow {
	id?: string;
	title?: string;
	user?: { name?: string };
	artwork?: Record<string, string> | null;
	duration?: number;
	is_streamable?: boolean;
}
interface AudiusResponse {
	data?: AudiusRow[];
}

export const audius: SourceAdapter = {
	id: 'audius',
	label: 'Audius',
	// Verified-working, zero-overlap net-new supply — enabled in the default resolver
	// (parallel Promise.allSettled fan-out means an extra source can't break existing ones).
	enabledByDefault: true,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		// Endpoint does not paginate (research A3) — page>1 is a no-op (no upstream call).
		if ((page || 1) > 1) return [];

		const path = '/api/audius/search?query=' + encodeURIComponent(keyword);
		const res = await apiFetch(path, { signal });
		const json = (await res.json()) as AudiusResponse | null;

		// Contract-drift guard: success envelope is `{ data: [] }`. Anything else → throw so
		// the fan-out records a typed per-source error (mirrors jamendo's headers.code guard).
		if (!json || !Array.isArray(json.data)) {
			throw new Error('audius: contract-drift (expected {data:[]})');
		}

		const tracks: Track[] = [];
		json.data.forEach((it, idx) => {
			if (!it.id || it.is_streamable === false) return; // unplayable / missing id — skip
			const songid = String(it.id);
			const track: Track = {
				uid: makeUid('audius', songid),
				source: 'audius',
				songid,
				title: it.title || '',
				artist: it.user?.name || '',
				album: '', // no album in the track row
				cover: it.artwork?.['480x480'] ?? it.artwork?.['150x150'] ?? null,
				audioUrl: null, // resolved deterministically in resolve()
				lrc: null,
				lrcUrl: null,
				detailsLoaded: false,
				quality: null,
				qualityLabel: null,
				keyword,
				displayIndex: idx + 1
			};
			if (typeof it.duration === 'number') track.duration = it.duration;
			tracks.push(track);
		});
		return tracks;
	},

	async resolve(track: Track, signal: AbortSignal): Promise<Track> {
		// No JSON hop — the stream URL is deterministic from the id, so there is nothing to abort.
		void signal;
		if (!track.songid) throw new Error('audius: missing songid on resolve');
		// Own-origin proxy path; apiUrl prefixes VITE_API_BASE on native, returns it unchanged on web.
		track.audioUrl = apiUrl('/api/audius/stream/' + encodeURIComponent(track.songid));
		// No file extension → inferQualityFromUrl falls back to its default tag (acceptable).
		const q = inferQualityFromUrl(track.audioUrl);
		track.quality = q.tag;
		track.qualityLabel = q.label;
		track.detailsLoaded = true;
		return track;
	}
};
