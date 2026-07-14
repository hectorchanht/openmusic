// YouTube Music client adapter (Plan 27, YT-SRC-01 / YT-SEARCH-01) — a FULLY ANONYMOUS source.
//
// ZERO auth: no account, OAuth, device flow, cookie, or user token is created or referenced here or
// anywhere in Plan 27. Account/library sync is a separate, later, legal-gated milestone (spike 008);
// if a change here ever tempts adding auth "while we're here", STOP — it is explicitly out of scope.
//
// Closest analog is audius.ts: the playable stream URL is DETERMINISTIC from the videoId, so
// resolve() has NO client-side JSON hop — it just stamps the own-origin /api/ytmusic/stream/{videoId}
// path. The bytes are edge-proxied because the real googlevideo URL is IP-locked + expires ~6h
// (spike 006), so the client's <audio>.src only ever sees the own-origin path (Capacitor/CORS-safe,
// exactly like the audius <audio>.src note).
//
// search() parses the proxied InnerTube WEB_REMIX envelope CLIENT-side (testable per conventions —
// see ytmusic.test.ts + the captured __fixtures__/ytmusic-search.json). The thin edge proxy that
// performs the InnerTube POST lands in Plan 27-02; the stream byte-proxy in Plan 27-03; resolve()'s
// best-effort plain-lyrics fetch + the registry-flag failover exclusion in Plan 27-04. THIS file is
// the adapter shape, the search() parse (Task 2), and the resolve() stream-URL stamp (Task 1).

import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { apiUrl } from '../services/api-base';

export const ytmusic: SourceAdapter = {
	id: 'ytmusic',
	label: 'YouTube Music',
	// Discoverable in the normal search fan-out (an extra Promise.allSettled source can never break
	// the existing ones — a ytmusic failure is isolated to its own settled slot).
	enabledByDefault: true,
	// OFF the kuwo-first auto-resolve floor (27-CONTEXT): searchable + explicit-pick only, NEVER a
	// cross-source-failover target for a non-ytmusic track. See the SourceAdapter.autoResolveEligible
	// doc; the failover / name-stub code that honors this flag lands in Plan 27-04.
	autoResolveEligible: false,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		// Single song shelf, no reliable pagination (the audius rule) — page>1 is a no-op with no
		// upstream call.
		if ((page || 1) > 1) return [];
		// The InnerTube envelope parse is implemented in Plan 27-01 Task 2 (TDD, over the captured
		// fixture). This skeleton keeps the adapter shape total for the registry
		// Record<SourceId,SourceAdapter> typecheck until the parse lands.
		void keyword;
		void signal;
		return [];
	},

	async resolve(track: Track, signal: AbortSignal): Promise<Track> {
		// No JSON hop — the stream URL is deterministic from the videoId (the audius pattern), so there
		// is nothing to abort. The plain-lyrics fetch + resilience wiring land in Plan 27-04, NOT here.
		void signal;
		if (!track.songid) throw new Error('ytmusic: missing videoId on resolve');
		// Own-origin proxy path; apiUrl prefixes VITE_API_BASE on native, returns it unchanged on web
		// (Capacitor/CORS-safe). The /api/ytmusic/stream/{videoId} byte-proxy lands in Plan 27-03.
		track.audioUrl = apiUrl('/api/ytmusic/stream/' + encodeURIComponent(track.songid));
		// itag 140 = 128 kbps AAC/mp4 (spike 006 — the iOS-Safari-safe format, NOT Opus/webm itag 251).
		// The proxy path carries no file extension, so inferQualityFromUrl would MISLABEL it 320K —
		// stamp the true AAC-128 tier directly instead.
		track.quality = '128k';
		track.qualityLabel = '128k AAC';
		track.detailsLoaded = true;
		return track;
	}
};
