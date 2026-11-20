// Bandcamp client adapter (43 — own-audio Western indie source, 43-D-01).
//
// Bandcamp serves its own audio: every streamable track has an mp3-128 file on
// t4.bcbits.com behind a ~24 h signed URL. Search goes through
// /api/bandcamp/search (the upstream autocomplete is POST-only + not
// CORS-open); resolve goes through /api/bandcamp/resolve, which returns the
// signed bcbits URL + duration.
//
// Playback shape: bcbits media sends NO Access-Control-Allow-Origin, so
// `<audio>` plays the direct URL (media elements don't need CORS) while the
// download path (which fetch()es bytes) uses `proxyUrl` = the own-origin
// /api/bandcamp/stream byte-pipe (43 RESEARCH Pitfall 5).
//
// `page` is ignored: the upstream has no pagination (≤ 50 rows), so every call
// returns the full list — the superset contract still holds (RESEARCH
// Pattern 1). No lyrics upstream (catalog.ts LYRICLESS_SOURCES).
//
// Floor posture (43-D-06): autoResolveEligible is deliberately left undefined
// so Bandcamp is a last-resort failover / name-stub target, seated after every
// CN source in PLAYBACK_ORDER. noticeOnAutoPick (43-D-08) tells the listener
// when an auto-picked Bandcamp substitute may not be the original recording.
// loadRetries undefined: bcbits failures are per-song, not per-request.

import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { apiFetch, apiUrl } from '../services/api-base';
import { bandcampHealth } from '../services/bandcamp-health';

// Row shape from /api/bandcamp/search — parsed + validated at the edge, still
// treated as untrusted here.
interface BcRow {
	id?: string;
	title?: string;
	artist?: string;
	album?: string;
	cover?: string | null;
}
interface BcSearchResponse {
	rows?: BcRow[];
}
interface BcResolveResponse {
	url?: unknown;
	duration?: unknown;
}

export const bandcamp: SourceAdapter = {
	id: 'bandcamp',
	label: 'Bandcamp',
	health: bandcampHealth,
	enabledByDefault: true,
	noticeOnAutoPick: true,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		void page;
		// Health gate counts HARD failures only (see bandcamp-health.ts).
		if (bandcampHealth.isGated()) return [];

		// Fetch + status + parse in ONE counted try: apiFetch resolves non-ok
		// responses, so res.ok must be checked inside or a 503 slips past the gate.
		// A caller abort is a supersede, not an outage — rethrown uncounted.
		let json: BcSearchResponse | null;
		try {
			const res = await apiFetch(`/api/bandcamp/search?q=${encodeURIComponent(keyword)}`, {
				signal
			});
			if (!res.ok) throw new Error(`bandcamp: search ${res.status}`);
			json = (await res.json()) as BcSearchResponse | null;
		} catch (err) {
			if (!signal.aborted) bandcampHealth.recordFail();
			throw err;
		}

		if (!json || !Array.isArray(json.rows)) {
			bandcampHealth.recordFail();
			throw new Error('bandcamp: contract-drift (expected {rows: []})');
		}
		bandcampHealth.recordOk();

		const tracks: Track[] = [];
		json.rows.forEach((it) => {
			if (!it.id || !it.title) return;
			const songid = String(it.id);
			tracks.push({
				uid: makeUid('bandcamp', songid),
				source: 'bandcamp',
				songid,
				title: it.title,
				artist: it.artist || '',
				album: it.album || '',
				// Already host-allowlisted at the edge (safeImageUrl + BANDCAMP_IMAGE_HOSTS).
				cover: it.cover ?? null,
				audioUrl: null,
				lrc: null,
				lrcUrl: null,
				detailsLoaded: false,
				quality: null,
				qualityLabel: null,
				keyword,
				displayIndex: tracks.length + 1
			});
		});
		return tracks;
	},

	async resolve(track: Track, signal: AbortSignal): Promise<Track> {
		if (!track.songid) throw new Error('bandcamp: missing songid on resolve');
		const id = encodeURIComponent(track.songid);
		const res = await apiFetch(`/api/bandcamp/resolve?id=${id}`, { signal });
		if (!res.ok) throw new Error(`bandcamp: resolve ${res.status}`);
		const json = (await res.json()) as BcResolveResponse | null;
		// T-43-17: only an https string is adopted as a media URL; anything else
		// throws so the fallback walker moves on.
		if (!json || typeof json.url !== 'string' || !json.url.startsWith('https://')) {
			throw new Error('bandcamp: resolve returned no https url');
		}
		track.audioUrl = json.url;
		track.proxyUrl = apiUrl(`/api/bandcamp/stream?id=${id}`);
		if (typeof json.duration === 'number' && json.duration > 0) track.duration = json.duration;
		// Bandcamp's free stream is always mp3-128; inferQualityFromUrl would
		// mislabel an mp3 URL as 320K (RESEARCH "Quality tags").
		track.quality = '128k';
		track.qualityLabel = '128K';
		track.lrc = null;
		track.detailsLoaded = true;
		return track;
	}
};
