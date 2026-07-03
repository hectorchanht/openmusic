// PURE persistence codec — NO runes, NO `$state`, NO `$app/environment`, NEVER throws.
//
// This module is the node-Vitest-testable core of the player's localStorage persistence.
// The runes player store (src/lib/stores/player.svelte.ts) merely WRAPS these helpers
// behind its SSR guard + try/catch + removeItem branch + the async offline-blob /
// ensureTrackDetails / pendingSeek orchestration — exactly as that store already wraps
// media-session.ts and sleep-timer.ts (the established "extract a pure helper module the
// runes store thinly wraps" precedent). The `Track` import below is TYPE-ONLY — erased at
// runtime, so there is ZERO runtime coupling to the source layer and, crucially, this
// module does NOT import player.svelte.ts (that would be a circular import — forbidden).
//
// Extracted in quick-260704-3ov (optimization backlog #7) from player.svelte.ts to de-risk
// the #1 regression hotspot: the serialize/parse slice is pure and cohesive, so peeling it
// out into a colocated, independently-tested module shrinks the god-object without any
// behavior change. The persisted bytes are BYTE-IDENTICAL to before — the same key, the same
// `v:1` envelope, the same serializeTrack whitelist — so an existing user's saved state still
// restores unchanged.
import type { Track } from '$lib/sources/types';

/**
 * Load-bearing localStorage key — the persisted player shape `openmusic:player:v1`.
 * An existing user's saved state lives under this exact key; it MUST NOT change (bumping
 * it would silently drop every user's restore).
 */
export const STATE_KEY = 'openmusic:player:v1';

/** The parsed, reshaped restore payload the runes store assigns from. `seek` is the clamped
 *  absolute currentTime (>= 0); the store applies it via its pendingSeek slot on loadedmetadata. */
export interface RestoredState {
	current: Track;
	queue: Track[];
	seek: number;
	shuffle: boolean;
	repeatMode: 'off' | 'one';
}

/** The persistable snapshot the store hands to serializePlayerState. Kept structural (plain
 *  fields, no runes) so this module stays pure and node-testable with a fake object. */
export interface PlayerSnapshot {
	current: Track;
	queue: Track[];
	currentTime: number;
	shuffle: boolean;
	repeatMode: 'off' | 'one';
}

/** Strip volatile fields (audioUrl / lrc / lrcUrl / detailsLoaded) before persisting a
 *  Track to localStorage — they expire and must be re-resolved on the next load. Mirrors
 *  the legacy serializeTrack whitelist + the history-entry shape. Returns ONLY the 11
 *  whitelist fields; Last.fm / source-specific extras are intentionally absent. */
export function serializeTrack(t: Track): Partial<Track> {
	return {
		uid: t.uid,
		source: t.source,
		songid: t.songid,
		title: t.title,
		artist: t.artist,
		album: t.album,
		cover: t.cover,
		quality: t.quality,
		qualityLabel: t.qualityLabel,
		keyword: t.keyword,
		displayIndex: t.displayIndex
	};
}

/**
 * Build the persistable localStorage JSON string from a snapshot. PURE: it does NOT read
 * `browser`, does NOT touch localStorage, and does NOT handle the no-current case (that
 * removeItem branch stays in the Player store). The returned string is BYTE-shape-identical
 * to the store's historical persist() payload — the same `v:1` envelope, the same whitelist
 * fields — so an existing on-disk record round-trips unchanged.
 */
export function serializePlayerState(snapshot: PlayerSnapshot): string {
	return JSON.stringify({
		v: 1,
		current: serializeTrack(snapshot.current),
		queue: snapshot.queue.map(serializeTrack),
		currentTime: snapshot.currentTime,
		shuffle: snapshot.shuffle,
		repeatMode: snapshot.repeatMode
	});
}

/** Re-hydrate a persisted Partial<Track> back to a full Track: apply the whitelist defaults
 *  and NULL the volatile fields (audioUrl / lrc / lrcUrl re-resolved on next load;
 *  detailsLoaded reset to false). Module-internal — parsePlayerState is the only consumer
 *  (the tests exercise it THROUGH parsePlayerState), matching cover-cache's private helper
 *  pattern. */
function reshape(p: Partial<Track>): Track {
	return {
		uid: p.uid ?? '',
		source: p.source ?? ('netease' as Track['source']),
		songid: p.songid ?? '',
		title: p.title ?? '',
		artist: p.artist ?? '',
		album: p.album ?? '',
		cover: p.cover ?? null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: p.quality ?? null,
		qualityLabel: p.qualityLabel ?? null,
		keyword: p.keyword ?? '',
		displayIndex: p.displayIndex ?? 1
	};
}

/**
 * Parse + reshape a persisted localStorage string into a restore payload. NEVER throws:
 * every failure mode degrades to null (the store early-returns on null, exactly as it did
 * across its old `!raw` / JSON.parse-catch / `!current.uid` early-returns — all three
 * collapse into this single null sentinel with identical observable behavior).
 *
 * Returns null when: raw is null/empty; JSON.parse throws (corrupt / tampered blob); or the
 * payload has no `current.uid` (the null-sentinel gate). Otherwise reshapes current + queue,
 * clamps seek to `Math.max(0, Number(currentTime) || 0)`, and coerces shuffle/repeatMode.
 */
export function parsePlayerState(raw: string | null): RestoredState | null {
	if (!raw) return null;
	let payload: {
		v?: number;
		current?: Partial<Track> | null;
		queue?: Partial<Track>[];
		currentTime?: number;
		shuffle?: boolean;
		repeatMode?: 'off' | 'one';
	} | null = null;
	try {
		payload = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!payload?.current?.uid) return null;
	return {
		current: reshape(payload.current as Partial<Track>),
		queue: (payload.queue ?? []).map(reshape),
		seek: Math.max(0, Number(payload.currentTime) || 0),
		shuffle: !!payload.shuffle,
		// D-11: 2-state migration — only an explicit 'one' is kept; any persisted repeat-all
		// (from a prior tri-state session), missing, or tampered value collapses to safe 'off'.
		repeatMode: payload.repeatMode === 'one' ? 'one' : 'off'
	};
}
