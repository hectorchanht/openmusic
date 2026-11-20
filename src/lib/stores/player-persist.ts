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
// behavior change. The persisted bytes were BYTE-IDENTICAL to before at extraction — the same
// key, the same `v:1` envelope, the same serializeTrack whitelist — so an existing user's saved
// state still restores unchanged. Since then two ADDITIVE fields joined the `v:1` envelope (no
// key or field change, legacy blobs parse exactly as before): `upNextAnchorUid`
// (quick-260712-hm9) and `updatedAt` (quick-261118-xdresume — the cross-device resume LWW clock).
import type { Track } from '$lib/sources/types';

/**
 * Load-bearing localStorage key — the persisted player shape `openmusic:player:v1`.
 * An existing user's saved state lives under this exact key; it MUST NOT change (bumping
 * it would silently drop every user's restore).
 */
export const STATE_KEY = 'openmusic:player:v1';

/** The parsed, reshaped restore payload the runes store assigns from. `seek` is the clamped
 *  absolute currentTime (>= 0); the store applies it via its pendingSeek slot on loadedmetadata.
 *  quick-260712-hm9: `anchorUid` is the persisted Up-Next VIEW anchor (upNextAnchorUid). Absent
 *  in legacy on-disk blobs → parses to null; the store then anchors at the restored current so a
 *  resumed run keeps its played-song history (see player.svelte.ts restore()). */
export interface RestoredState {
	current: Track;
	queue: Track[];
	seek: number;
	shuffle: boolean;
	repeatMode: 'off' | 'one';
	anchorUid: string | null;
}

/** The persistable snapshot the store hands to serializePlayerState. Kept structural (plain
 *  fields, no runes) so this module stays pure and node-testable with a fake object.
 *  quick-260712-hm9: `anchorUid` carries the store's upNextAnchorUid (a state-level VIEW field,
 *  NOT a Track field — it is NOT part of the 11-field serializeTrack whitelist). */
export interface PlayerSnapshot {
	current: Track;
	queue: Track[];
	currentTime: number;
	shuffle: boolean;
	repeatMode: 'off' | 'one';
	anchorUid: string | null;
	/** quick-261118-xdresume: epoch ms of the last MEANINGFUL change (see stampUpdatedAt) — the
	 *  last-write-wins clock the cross-device sync merge compares (merge-logic mergePlayerLww).
	 *  Optional so a snapshot without it serializes as 0 ("older than anything"). */
	updatedAt?: number;
}

/** Strip volatile fields (audioUrl / lrc / lrcUrl / detailsLoaded) before persisting a
 *  Track to localStorage — they expire and must be re-resolved on the next load. Mirrors
 *  the legacy serializeTrack whitelist + the history-entry shape. Returns ONLY the 11
 *  whitelist fields; Last.fm / source-specific extras are intentionally absent.
 *
 *  quick-261008-audit: an inline `data:` cover (cov1's downscaled embedded art) is stripped
 *  like library.save() does — persisting ~10 KB data: URLs would bloat `openmusic:player:v1`
 *  and the Settings backup (which serializes localStorage verbatim). On restore the shared
 *  cover cache re-supplies the art; the hero re-resolves full-res on play.
 */
export function serializeTrack(t: Track): Partial<Track> {
	return {
		uid: t.uid,
		source: t.source,
		songid: t.songid,
		title: t.title,
		artist: t.artist,
		album: t.album,
		cover: t.cover && t.cover.startsWith('data:') ? null : t.cover,
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
		repeatMode: snapshot.repeatMode,
		// quick-260712-hm9: persist the Up-Next VIEW anchor so a reload/PWA reopen restores the
		// EXACT played-song history view. Additive to the `v:1` envelope (placed after repeatMode);
		// legacy blobs simply lack this key and parse back to null (back-compatible).
		upNextAnchorUid: snapshot.anchorUid ?? null,
		// quick-261118-xdresume (35-D-02 superseded for player state, 2026-11-18): the LWW clock
		// for cross-device resume. ADDITIVE to the `v:1` envelope exactly as upNextAnchorUid was;
		// parsePlayerState ignores it, so legacy blobs (which lack it) restore unchanged and the
		// sync layer reads a missing value as 0.
		updatedAt: snapshot.updatedAt ?? 0
	});
}

/** Player tolerance for "the same position" — a reload re-seeks to the saved currentTime and the
 *  element can report it back a few ms off (frame snapping), which is not a user change. */
const SAME_POSITION_S = 1;

/**
 * quick-261118-xdresume — PURE: the `updatedAt` to persist. Returns the PREVIOUS blob's
 * updatedAt when nothing meaningful changed since it was written, else `now`.
 *
 * Why not just `Date.now()` on every persist: persist also runs on non-changes (the
 * visibilitychange/pagehide flush, a restore re-seek). A fresh stamp there would make a device
 * that merely ADOPTED another device's state look newer than it — it would push the identical
 * state back, the other device would adopt it and reload, and the two would ping-pong reloads
 * forever. "Meaningful" = any field other than updatedAt differs, with currentTime compared to
 * SAME_POSITION_S. A missing / corrupt previous blob → `now`.
 */
export function stampUpdatedAt(prevRaw: string | null, snapshot: PlayerSnapshot, now: number): number {
	if (!prevRaw) return now;
	let prev: Record<string, unknown>;
	try {
		const p: unknown = JSON.parse(prevRaw);
		if (p == null || typeof p !== 'object' || Array.isArray(p)) return now;
		prev = p as Record<string, unknown>;
	} catch {
		return now;
	}
	const prevAt = prev.updatedAt;
	if (typeof prevAt !== 'number' || !Number.isFinite(prevAt) || prevAt <= 0) return now;
	const next = JSON.parse(serializePlayerState({ ...snapshot, updatedAt: 0 })) as Record<string, unknown>;
	const prevTime = Number(prev.currentTime) || 0;
	const nextTime = Number(next.currentTime) || 0;
	if (Math.abs(prevTime - nextTime) >= SAME_POSITION_S) return now;
	const strip = (o: Record<string, unknown>) =>
		JSON.stringify({ ...o, currentTime: 0, updatedAt: 0 });
	return strip(prev) === strip(next) ? prevAt : now;
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
		upNextAnchorUid?: string | null;
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
		repeatMode: payload.repeatMode === 'one' ? 'one' : 'off',
		// quick-260712-hm9: only a real string uid survives; absent (legacy blob) or garbage → null.
		// The store treats null as "no persisted anchor" and re-anchors at the restored current.
		anchorUid: typeof payload.upNextAnchorUid === 'string' ? payload.upNextAnchorUid : null
	};
}
