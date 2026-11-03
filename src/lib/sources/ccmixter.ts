// CCMixter client adapter (quick-261101-ccm — CC-licensed remix/indie catalog).
//
// ccMixter (ccmixter.org) is a long-running Creative-Commons music community:
// remixes, samples and indie uploads, all CC-licensed. Net-new supply with zero
// overlap with the CN sources — like jamendo/archive it is a SEARCH-ONLY
// catalog source: `autoResolveEligible: false` (its catalog is remixes/indie,
// not official versions, so cross-source failover must never pick it as a
// resolve TARGET for another source's track).
//
// Playback shape (why there are two edge routes): upstream media enforces
// `Referer: https://ccmixter.org/` and sends no CORS headers, so search goes
// through /api/ccmixter/search (XSPF parsed at the edge) and playback streams
// through /api/ccmixter/stream?id=<uploadId>, which re-derives the media URL
// server-side and injects the Referer. No signing, no cookies, no keys.
//
// Durations: the XSPF <duration> field is the file SIZE in bytes (verified
// live), so search rows carry NO duration (Track.duration undefined — the
// unknown-neutral state, never penalized). No lyrics upstream (the source is
// in catalog.ts LYRICLESS_SOURCES). Cover = the XSPF <image> (artist avatar)
// when present; the cover-heal chain upgrades it when it can.

import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl } from '../services/lrc';
import { apiFetch, apiUrl } from '../services/api-base';
import { ccmixterHealth } from '../services/ccmixter-health';

// Row shape returned by /api/ccmixter/search — the edge route has already
// parsed + validated the XSPF; all fields still treated as untrusted.
interface CcmRow {
	id?: string;
	title?: string;
	artist?: string;
	cover?: string | null;
}
interface CcmResponse {
	rows?: CcmRow[];
}

export const ccmixter: SourceAdapter = {
	id: 'ccmixter',
	label: 'CCMixter',
	// Ships enabled by default; toggleable off via the Playback Advanced — Sources
	// accordion (registry-driven, no per-source UI). CC remix/indie is a different
	// intent than mainstream search.
	enabledByDefault: true,
	// Search-only legal catalog — off the auto-resolve floor (jamendo/archive posture).
	autoResolveEligible: false,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		// HEALTH-GATE short-circuit (ccmixter-health, wired from day one): after a
		// run of HARD failures, skip the wasted call for a bounded window; the gate
		// then auto-opens for one probe whose outcome re-decides. Empty results are
		// NEVER counted (see ccmixter-health.ts — empty is the normal answer for
		// this catalogue on CN queries, not an outage shape).
		if (ccmixterHealth.isGated()) return [];

		// The edge route paginates via `offset`, limit=20 matches the other
		// adapters' "first page = 20 rows" idiom.
		const offset = Math.max(0, ((page || 1) - 1) * 20);
		const path = `/api/ccmixter/search?search=${encodeURIComponent(keyword)}&limit=20&offset=${offset}`;

		// Fetch + parse in ONE try (the kuwoJson lesson) so every failure shape
		// counts; a caller abort is a supersede, not an outage — rethrown uncounted.
		let json: CcmResponse | null;
		try {
			const res = await apiFetch(path, { signal });
			json = (await res.json()) as CcmResponse | null;
		} catch (err) {
			if (!signal.aborted) ccmixterHealth.recordFail();
			throw err;
		}

		// Contract-drift guard: success envelope is `{ rows: [] }`. Anything else
		// → throw so the fan-out records a typed per-source error.
		if (!json || !Array.isArray(json.rows)) {
			ccmixterHealth.recordFail();
			throw new Error('ccmixter: contract-drift (expected {rows: []})');
		}
		// A well-formed body is a live upstream — instant recovery (empty included).
		ccmixterHealth.recordOk();

		const tracks: Track[] = [];
		json.rows.forEach((it, idx) => {
			if (!it.id || !it.title) return; // unplayable/unidentifiable row — skip
			const songid = String(it.id);
			tracks.push({
				uid: makeUid('ccmixter', songid),
				source: 'ccmixter',
				songid,
				title: it.title,
				artist: it.artist || '',
				album: '',
				cover: it.cover ?? null,
				// Media URL is NEVER handed to the client: resolve() stamps the
				// own-origin stream route, which re-derives it from the id.
				audioUrl: null,
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
		// No network (mirrors jamendo): the stream URL is deterministic from the
		// songid, so resolve() just stamps it + the quality tag. The stream route
		// does the real upstream work (by-id XSPF lookup + Referer media fetch).
		// Carries no health signal, so the gate is not wired here.
		void signal;
		if (!track.songid) throw new Error('ccmixter: missing songid on resolve');
		const stream = apiUrl(`/api/ccmixter/stream?id=${encodeURIComponent(track.songid)}`);
		track.audioUrl = stream;
		track.proxyUrl = stream;
		// No file extension on the proxy path → inferQualityFromUrl's default tag
		// (the audius posture for extension-less stream URLs).
		const q = inferQualityFromUrl(track.audioUrl);
		track.quality = q.tag;
		track.qualityLabel = q.label;
		track.detailsLoaded = true;
		return track;
	}
};
