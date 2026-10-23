// analytics — play/like/download pings, client side.
//
// getAnonId(): a random UUID persisted in localStorage ('openmusic_anon_id'). No
// account, no login, no fingerprint — just a stable random id so "N plays" can later
// be de-duplicated into "~M listeners" (COUNT(DISTINCT anon_id); note it resets if
// the user clears site data, so it is an approximation). Never throws (SSR /
// private-mode safe).
//
// trackPlayStart(track): fire-and-forget POST to /api/analytics/play with the song
// fields plus client-declared properties: platform ('web' | 'android'), app_version
// (VITE_APP_VERSION when the build bakes one, else ''), locale (navigator.language).
// device_type / os / country are derived SERVER-side from request headers — the
// client never sends them. Uses apiUrl() (not apiFetch) so the ping never competes
// with playback traffic for the outbound governor's concurrency slots, and
// `keepalive: true` so it can finish even as the page hides. A failed ping is
// swallowed — analytics must never break playback.
//
// trackLike(track, action) / trackDownload(track, extra): the identity-linked pings
// (quick-261023-like-dl). Same fire-and-forget + keepalive posture, but sent with
// `credentials: 'include'` so the server can resolve the session to a user_id.
// Identity is NEVER sent from the client — the server derives it from the session
// cookie/bearer; a logged-out ping is simply anonymous (user_id NULL server-side).

import { Capacitor } from '@capacitor/core';
import { apiUrl } from '$lib/services/api-base';
import type { Track } from '$lib/sources/types';

const ANON_KEY = 'openmusic_anon_id';

export function getAnonId(): string {
	try {
		const store = globalThis.localStorage;
		let id = store.getItem(ANON_KEY);
		if (!id) {
			id = globalThis.crypto.randomUUID();
			store.setItem(ANON_KEY, id);
		}
		return id;
	} catch {
		return '';
	}
}

function clientPlatform(): 'web' | 'android' {
	try {
		return Capacitor.isNativePlatform() ? 'android' : 'web';
	} catch {
		return 'web';
	}
}

function clientLocale(): string {
	try {
		return globalThis.navigator?.language ?? '';
	} catch {
		return '';
	}
}

type TrackRef = Pick<Track, 'uid' | 'title' | 'artist' | 'source'>;

function baseFields(track: TrackRef): Record<string, unknown> {
	return {
		anon_id: getAnonId(),
		song_id: track.uid,
		title: track.title ?? '',
		artist: track.artist ?? '',
		source: track.source ?? '',
		platform: clientPlatform(),
		app_version: import.meta.env.VITE_APP_VERSION ?? '',
		locale: clientLocale()
	};
}

/** Shared fire-and-forget ping. `withCreds` attaches the session (cookie/bearer) so
 *  the server can resolve identity; the anonymous play ping omits it. Never throws. */
function ping(path: string, fields: Record<string, unknown>, withCreds: boolean): void {
	try {
		void fetch(apiUrl(path), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(fields),
			keepalive: true,
			...(withCreds ? { credentials: 'include' as RequestCredentials } : {})
		}).catch(() => {
			/* analytics ping failed — ignore */
		});
	} catch {
		/* never break the app for analytics */
	}
}

export function trackPlayStart(track: TrackRef): void {
	ping('/api/analytics/play', baseFields(track), false);
}

/** Identity-linked like/unlike ping (quick-261023-like-dl). The server resolves
 *  user_id from the session; a logged-out ping is stored anonymous. Never throws. */
export function trackLike(track: TrackRef, action: 'like' | 'unlike'): void {
	ping('/api/analytics/like', { ...baseFields(track), action }, true);
}

/** Identity-linked download ping (quick-261023-like-dl). Fire at the point a
 *  download result becomes 'saved'. Never throws. */
export function trackDownload(
	track: TrackRef,
	extra?: { quality?: string; bytes?: number }
): void {
	ping(
		'/api/analytics/download',
		{
			...baseFields(track),
			quality: extra?.quality ?? '',
			bytes: typeof extra?.bytes === 'number' ? extra.bytes : null
		},
		true
	);
}
