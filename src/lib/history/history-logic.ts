// PURE recently-played history logic — NO runes, NO `$state`, NO `$app/environment`.
//
// This module is the node-Vitest-testable core of the History feature. The runes
// singleton (src/lib/stores/history.svelte.ts) merely WRAPS these helpers, exactly
// as `t()` wraps the pure i18n helpers (lookupKey/interpolate) and the library/
// settings stores wrap their plain logic. The `Track` import below is types-only —
// erased at runtime, so there is zero runtime coupling to the source layer.
import type { Track } from '$lib/sources/types';

/** Most-recent-first cap. The persisted list never grows beyond this (T-ggv-03 DoS). */
export const HISTORY_CAP = 50;

/** Versioned localStorage key (separate from settings/library). */
export const HISTORY_KEY = 'openmusic:history:v1';

/**
 * Minimal, JSON-safe slice of a Track sufficient to RE-RESOLVE and replay it.
 * Volatile fields (audioUrl, lrc, lrcUrl, detailsLoaded) are deliberately OMITTED
 * so they are re-fetched on replay — mirroring the legacy serializeTrack whitelist.
 */
export interface HistoryEntry {
	uid: string;
	source: Track['source'];
	songid: string;
	title: string;
	artist: string;
	album: string;
	cover: string | null;
	quality: string | null;
	qualityLabel: string | null;
	keyword: string;
	displayIndex: number;
}

/** Pick the minimal replay whitelist from a full Track (drops volatile fields). */
export function toEntry(track: Track): HistoryEntry {
	return {
		uid: track.uid,
		source: track.source,
		songid: track.songid,
		title: track.title,
		artist: track.artist,
		album: track.album,
		cover: track.cover,
		quality: track.quality,
		qualityLabel: track.qualityLabel,
		keyword: track.keyword,
		displayIndex: track.displayIndex
	};
}

/**
 * Return a NEW most-recent-first list: drop any existing entry with the same uid,
 * prepend `entry`, then truncate to `cap`. (de-dupe by uid → replay moves to top;
 * cap → bounded growth.) Never mutates `list`.
 */
export function recordEntry(
	list: HistoryEntry[],
	entry: HistoryEntry,
	cap = HISTORY_CAP
): HistoryEntry[] {
	const without = list.filter((e) => e.uid !== entry.uid);
	return [entry, ...without].slice(0, cap);
}

/**
 * Parse a persisted history blob. Returns [] on null / parse error / non-array
 * (T-ggv-01 tampering: a corrupt store must never crash the app).
 */
export function parseHistory(raw: string | null): HistoryEntry[] {
	if (raw == null) return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? (v as HistoryEntry[]) : [];
	} catch {
		return [];
	}
}
