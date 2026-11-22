// analytics — play/like/download count pings, client side.
//
// DATA DOCTRINE (quick-261118-datadoctrine; Hector, 2026-11-18): analytics are
// anonymous TOTALS ONLY. Each ping carries nothing but the song's content
// fields (song_id, title, artist, source — plus the action for likes). The
// server folds it into a (day, action, song) counter; there is no per-user
// record anywhere. Accordingly this client:
//   - has NO anonymous id (the retired 'openmusic_anon_id' localStorage UUID
//     is no longer generated, sent, or read — an old value left in storage is
//     simply never touched again),
//   - sends NO platform / app_version / locale (the counters don't want them),
//   - NEVER attaches the session (no credentials) — likes and downloads used
//     to be identity-linked server-side (quick-261023-like-dl); that design
//     was per-user tracking and is retired.
//
// Fire-and-forget posture (unchanged): uses apiUrl() (not apiFetch) so the
// ping never competes with playback traffic for the outbound governor's
// concurrency slots, and `keepalive: true` so it can finish even as the page
// hides. A failed ping is swallowed — analytics must never break playback.

import { apiUrl } from '$lib/services/api-base';
import type { Track } from '$lib/sources/types';

type TrackRef = Pick<Track, 'uid' | 'title' | 'artist' | 'source'>;

function baseFields(track: TrackRef): Record<string, unknown> {
	return {
		song_id: track.uid,
		title: track.title ?? '',
		artist: track.artist ?? '',
		source: track.source ?? ''
	};
}

/** Shared fire-and-forget ping. Credential-less by doctrine. Never throws. */
function ping(path: string, fields: Record<string, unknown>): void {
	try {
		void fetch(apiUrl(path), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(fields),
			keepalive: true
		}).catch(() => {
			/* analytics ping failed — ignore */
		});
	} catch {
		/* never break the app for analytics */
	}
}

export function trackPlayStart(track: TrackRef): void {
	ping('/api/analytics/play', baseFields(track));
}

/** Like/unlike count ping (anonymous totals — see the doctrine note above). */
export function trackLike(track: TrackRef, action: 'like' | 'unlike'): void {
	ping('/api/analytics/like', { ...baseFields(track), action });
}

/**
 * Download count ping, fired at the point a download result becomes 'saved'.
 * The `extra` argument is accepted for call-site compatibility with
 * download-track.ts but is DELIBERATELY not transmitted: quality and byte
 * counts are not part of the totals-only counters (quick-261118-datadoctrine).
 */
export function trackDownload(
	track: TrackRef,
	_extra?: { quality?: string; bytes?: number }
): void {
	ping('/api/analytics/download', baseFields(track));
}

/** quick-261122-sharefeed: what the share sheet counts — opens, copies, WhatsApp taps. */
export type ShareAction = 'open' | 'copy' | 'wa';

/**
 * Share-sheet count ping (K-factor instrumentation). Anonymous totals only: the
 * action, the message language and which variant (full / short / link) — never
 * the sender name, the track, or anything that could identify who shared.
 */
export function trackShare(
	action: ShareAction,
	lang: string,
	variant: 'full' | 'short' | 'link' = 'full'
): void {
	ping('/api/analytics/share', { action, lang, variant });
}
