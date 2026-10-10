// analytics — anonymous play-count ping, client side.
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

export function trackPlayStart(track: Pick<Track, 'uid' | 'title' | 'artist' | 'source'>): void {
	try {
		const body = JSON.stringify({
			anon_id: getAnonId(),
			song_id: track.uid,
			title: track.title ?? '',
			artist: track.artist ?? '',
			source: track.source ?? '',
			platform: clientPlatform(),
			app_version: import.meta.env.VITE_APP_VERSION ?? '',
			locale: clientLocale()
		});
		void fetch(apiUrl('/api/analytics/play'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
			keepalive: true
		}).catch(() => {
			/* analytics ping failed — ignore */
		});
	} catch {
		/* never break playback for analytics */
	}
}
