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
// PSEUDONYMOUS EVENTS (quick-261122-pseudo; Hector's ruling 2026-11-20): the
// counter pings above are unchanged and keep feeding metric_counters. BESIDE
// them, when PSEUDO_ANALYTICS_LIVE is on, every action is ALSO posted to
// /api/analytics/event carrying the random, user-resettable pseudo_id
// ($lib/pseudo-id) so distinct users + retention can be counted — plus the v1
// signal events (search_miss, play_failure, lyrics_missing, session_start).
// That ping carries ONLY: pseudo_id, action, song fields, query/stage where the
// event names one, app_version and a one-bit platform class. Still credential-
// less: an analytics row can never be joined to the signed-in account.
//
// Fire-and-forget posture (unchanged): uses apiUrl() (not apiFetch) so the
// ping never competes with playback traffic for the outbound governor's
// concurrency slots, and `keepalive: true` so it can finish even as the page
// hides. A failed ping is swallowed — analytics must never break playback.

import { apiUrl } from '$lib/services/api-base';
import type { Track } from '$lib/sources/types';
import { PSEUDO_ANALYTICS_LIVE } from '$lib/config/pseudo-analytics';
import { getPseudoId, platformClass } from '$lib/pseudo-id';
import type { FailureStage, PseudoAction } from '$lib/services/pseudo-events';

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

/** App version baked at build time (VITE_APP_VERSION from CI); 'dev' locally. */
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev';

/**
 * Pseudonymous event ping (quick-261122-pseudo). A no-op unless the launch
 * switch is on AND a pseudo_id exists. Never throws.
 */
function pseudoEvent(action: PseudoAction, fields: Record<string, unknown> = {}): void {
	if (!PSEUDO_ANALYTICS_LIVE) return;
	const pseudoId = getPseudoId();
	if (!pseudoId) return;
	ping('/api/analytics/event', {
		...fields,
		action,
		pseudo_id: pseudoId,
		app_version: APP_VERSION,
		platform: platformClass()
	});
}

export function trackPlayStart(track: TrackRef): void {
	ping('/api/analytics/play', baseFields(track));
	pseudoEvent('play', baseFields(track));
}

/** Like/unlike count ping (anonymous totals — see the doctrine note above). */
export function trackLike(track: TrackRef, action: 'like' | 'unlike'): void {
	ping('/api/analytics/like', { ...baseFields(track), action });
	pseudoEvent(action, baseFields(track));
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
	pseudoEvent('download', baseFields(track));
}

/** search_miss — a settled search that returned ZERO results (the gap list). */
export function trackSearchMiss(query: string): void {
	const q = query.trim();
	if (!q) return;
	pseudoEvent('search_miss', { query: q });
}

/** play_failure — a track every source failed for; `stage` is the player's SkipReason. */
export function trackPlayFailure(track: TrackRef, stage: FailureStage): void {
	pseudoEvent('play_failure', { ...baseFields(track), stage });
}

/** lyrics_missing — a real play where no lyrics existed (UGC lyrics demand queue). */
export function trackLyricsMissing(track: TrackRef): void {
	pseudoEvent('lyrics_missing', baseFields(track));
}

/** session_start — once per app boot; retention is derived from active days. */
export function trackSessionStart(): void {
	pseudoEvent('session_start');
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
