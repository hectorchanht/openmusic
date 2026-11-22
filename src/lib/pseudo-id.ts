// pseudo-id — the client's random, user-resettable pseudonymous analytics ID
// (quick-261122-pseudo; Hector's ruling 2026-11-20).
//
// GUARDRAILS (pinned in pseudo-id.test.ts + analytics-doctrine.test.ts):
//   - A fresh crypto.randomUUID() kept in localStorage under its OWN key. It is
//     never derived from, stored beside, or sent with anything identifying: no
//     account/session, no email, no IP, no device fingerprint (the coarse
//     platform class below is a single mobile|desktop bit from a media query,
//     NOT a User-Agent read).
//   - User-resettable: resetPseudoId() (Settings → About → "Reset my anonymous
//     ID") replaces it with a new random UUID — from then on this device counts
//     as a NEW user. Clearing site data has the same effect.
//   - Nothing happens while PSEUDO_ANALYTICS_LIVE is false: no ID is generated,
//     read or written (promise-first ordering).
//   - Never synced: the key is not part of the backup envelope / account sync.

import { PSEUDO_ANALYTICS_LIVE } from '$lib/config/pseudo-analytics';
import { isPseudoId, type PlatformClass } from '$lib/services/pseudo-events';

export const PSEUDO_ID_KEY = 'openmusic:pseudo-id:v1';

function storage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

function freshId(): string | null {
	try {
		return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: null;
	} catch {
		return null;
	}
}

/**
 * The current pseudonymous ID, creating one on first use. Null when the
 * feature is not live, storage is unavailable, or no CSPRNG UUID exists —
 * callers then simply send nothing.
 */
export function getPseudoId(live: boolean = PSEUDO_ANALYTICS_LIVE): string | null {
	if (!live) return null;
	const ls = storage();
	if (!ls) return null;
	try {
		const cur = ls.getItem(PSEUDO_ID_KEY);
		if (isPseudoId(cur)) return cur;
		const id = freshId();
		if (!id) return null;
		ls.setItem(PSEUDO_ID_KEY, id);
		return id;
	} catch {
		return null;
	}
}

/**
 * Replace the ID with a brand-new random one. Returns the new ID (or null if
 * storage is unavailable). The old ID is simply never sent again — it was
 * never linked to anything, so there is nothing to unlink.
 */
export function resetPseudoId(): string | null {
	const ls = storage();
	if (!ls) return null;
	try {
		ls.removeItem(PSEUDO_ID_KEY);
		const id = freshId();
		if (!id) return null;
		ls.setItem(PSEUDO_ID_KEY, id);
		return id;
	} catch {
		return null;
	}
}

/** Coarse platform class from the primary pointer — one bit, not a fingerprint. */
export function platformClass(): PlatformClass | '' {
	try {
		if (typeof matchMedia !== 'function') return '';
		return matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
	} catch {
		return '';
	}
}
