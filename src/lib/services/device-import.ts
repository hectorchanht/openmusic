// device-import.ts — the PURE import brain for Phase 34 (D-07/D-08/D-09/D-10/D-11/D-12/D-14).
//
// Rows + rules + the library the user already has in; a complete SyncPlan (the next downloads
// array, the relink list, the summary counts) out. Every decision this phase makes about DATA lives
// here, which is what lets all of them be tested without an Android device.
//
// NEVER THROWS. Every function is TOTAL over its inputs — a malformed or missing row is skipped as
// 'outside' rather than raising into a loop that is halfway through rebuilding the user's library.
// The same posture as download-track.ts: a failure produces a sentinel, never an exception.
//
// PURITY CONTRACT (mirrors device-filename.ts): this module MUST NOT import the i18n layer, any
// runes store, or a SvelteKit app module, and MUST NOT use runes. Plan 34-07's store pages the
// MediaStore bridge and APPLIES the plan; the settings page LOCALISES the summary. Keeping the
// brain store-free is what keeps it in the single Vitest node project (no jsdom, no runes).
//
// REFRESH-IN-PLACE SUPERSEDES MediaStore.getVersion (RESEARCH Pitfall 5). Every device entry that
// is present in a scan is REBUILT from its current row, so after a MediaStore rebuild `device:<id>`
// always shows the song that IS row <id> — never a stale title over different bytes. The residual
// cost is exactly D-02's stated accepted cost: a like or playlist reference to a rebuilt _ID now
// points at a different song.
// ponytail: add getVersion() + content re-match (displayName + size + duration) if that ever bites.

import type { Track } from '$lib/sources/types';
import { isDeviceUid, rowToTrack, type ScanRow } from './device-track';
import { extOf, parseFilename, type ImportRules } from './device-filename';
import { matchKey } from './match-key';

/** Rows per scanAudio page (RESEARCH Pitfall 9 — ~125 KB of bridge payload; tune on device). */
export const SCAN_PAGE_SIZE = 500;

/**
 * ReDoS layer 2 (RESEARCH Pitfall 8): the CUMULATIVE wall-clock budget a custom pattern may spend
 * across one whole run. Layer 1 (`validateCustomPattern`'s save-time probe) explicitly cannot catch
 * a pattern that is merely polynomial at 24 characters and exponential at 200; this bounds the
 * damage of one that slips through to a single budget instead of a hung WebView.
 */
export const PATTERN_SCAN_BUDGET_MS = 2000;

/** 999.1 D-11 — the folder the app writes its OWN downloads to. Must equal MediaStoreSaverPlugin.kt's
 *  `"${Environment.DIRECTORY_MUSIC}/OpenMusic/"`; a row under it is a D-09 merge candidate. */
export const OPENMUSIC_RELATIVE_PATH = 'Music/OpenMusic/';

/** D-11 scan scope. Kotlin's SQL selection is the PRIMARY filter; this is the belt for OEM
 *  MediaProvider quirks that return rows the selection should have excluded. Counted as
 *  `skippedOutside` — logged, not rendered, because a file outside these two folders is out of
 *  scope BY DECISION, not a silent skip of something the user expected to see. */
const SCAN_ROOTS = ['Music/', 'Download/'];

/** Counts that map 1:1 onto UI-SPEC Contract 4's summary lines. A branch without a count is a
 *  silent failure, which is the thing D-16 exists to prevent. */
export interface ImportSummary {
	added: number;
	relinked: number;
	removed: number;
	already: number;
	skippedShort: number;
	skippedExt: number;
	skippedRule: number;
	skippedOutside: number;
	/** The floor in force — UI-SPEC's skipTooShort line carries the actual `{seconds}`. */
	minSeconds: number;
	/** false → the D-07 drop pass did NOT run (cancelled or failed scan). */
	complete: boolean;
	/** ReDoS layer 2 tripped → the UI surfaces toast.patternFellBack. */
	patternFellBack: boolean;
}

/** All-zero counts for `rules`. A completed scan that found nothing is still `complete: true`. */
export function emptySummary(rules: ImportRules): ImportSummary {
	return {
		added: 0,
		relinked: 0,
		removed: 0,
		already: 0,
		skippedShort: 0,
		skippedExt: 0,
		skippedRule: 0,
		skippedOutside: 0,
		minSeconds: rules?.minSeconds ?? 0,
		complete: true,
		patternFellBack: false
	};
}

export type RowVerdict =
	| { kind: 'import'; track: Track }
	| { kind: 'relink'; uid: string; uri: string }
	| { kind: 'skip'; reason: 'short' | 'ext' | 'rule' | 'outside' };

export interface SyncPlan {
	downloads: Track[];
	relink: { uid: string; uri: string }[];
	summary: ImportSummary;
}

/** D-11 belt: is this row under one of the two scanned roots? */
function isInside(relativePath: string): boolean {
	const path = typeof relativePath === 'string' ? relativePath : '';
	return SCAN_ROOTS.some((root) => path.startsWith(root));
}

/**
 * One row → exactly one verdict. Filters run in the order outside → ext → short → rule, so a row
 * failing several is counted ONCE, under the first — a summary whose categories add up to more than
 * the file count is worse than no summary.
 */
export function classifyRow(
	row: ScanRow,
	rules: ImportRules,
	existingByKey: Map<string, Track>,
	custom: RegExp | null
): RowVerdict {
	// A missing/malformed row has no folder, so it fails the scope test first — same as a real row
	// from somewhere we do not scan. Never throws on a null.
	if (!row || !isInside(row.relativePath)) return { kind: 'skip', reason: 'outside' };

	const ext = extOf(row.displayName ?? '');
	if (!ext || !rules.extensions.includes(ext)) return { kind: 'skip', reason: 'ext' };

	// A duration of 0 means MediaStore could not measure the file — unknown is never penalised, the
	// same neutrality `rowToTrack` applies when it omits Track.duration.
	if (rules.minSeconds > 0 && row.durationMs > 0 && row.durationMs < rules.minSeconds * 1000) {
		return { kind: 'skip', reason: 'short' };
	}

	// D-12: one phrase per rule, matched case-insensitively against the NAME and the FOLDER, because
	// "voice memo" is as often a directory as a filename.
	const hay = `${row.displayName ?? ''} ${row.relativePath ?? ''}`.toLowerCase();
	for (const rule of rules.skipRules) {
		const needle = typeof rule === 'string' ? rule.trim().toLowerCase() : '';
		if (needle && hay.includes(needle)) return { kind: 'skip', reason: 'rule' };
	}

	const track = rowToTrack(row, parseFilename(row.displayName ?? '', rules, custom));

	// 34-D-09 / D-10 — THE MERGE LANE, deliberately the narrowest possible.
	//
	// Only rows under Music/OpenMusic/ (files THIS APP wrote) are ever considered, and only against
	// real-source entries. D-03 forbids tag-matching a device file to a catalog entry in general;
	// this narrow exception exists because the app already knows it wrote that file.
	//
	// The merge writes exactly ONE thing — the public content URI, consumed by blob-store's
	// stored-URI fallback — and touches NO stored field. The stored entry has the resolved cover,
	// the proper album and the translated names; the file's tags are whatever our own filename
	// builder gave it. D-09's purpose is PLAYABILITY, not metadata (RESEARCH Open Q3), and the
	// same posture as library.adoptCover: never churn a field that already has a value.
	if (row.relativePath.startsWith(OPENMUSIC_RELATIVE_PATH)) {
		const key = matchKey(track.artist, track.title);
		// '|' is the empty key (both components normalise away). Matching on it would link every
		// nameless file to the same stored entry — a wrong link is worse than no link.
		const found = key === '|' ? undefined : existingByKey.get(key);
		if (found && !isDeviceUid(found.uid)) return { kind: 'relink', uid: found.uid, uri: row.uri };
	}

	// D-16: a song the user can plainly see on their phone must not vanish. An OpenMusic-folder row
	// that matches nothing imports as an ordinary device track rather than being dropped.
	return { kind: 'import', track };
}
