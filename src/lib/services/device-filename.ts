// device-filename.ts — PURE, node-testable filename PARSING for device import (34-D-12, D-13, D-14, D-16).
//
// This is the literal INVERSE of download-filename.ts: that module BUILDS `{artist} - {title}.{ext}`
// from a Track, this one reads such a name back into `{ artist, title }`. They share one extension
// vocabulary (AUDIO_EXTENSIONS, imported below) so export and import can never disagree about what
// "audio" means, and the normalization decisions there (CJK passes through, punctuation sanitized,
// missing album omitted) are the reason this parser can stay as simple as it is.
//
// PURITY CONTRACT (same as download-filename.ts): this module MUST NOT import `$lib/stores/*`,
// `$lib/i18n`, or `$app/*`, and MUST NOT use runes. It is consumed by the import service (34-06),
// the rules store (34-07) and the settings-page live preview (34-08) — keeping it store-free is what
// lets it live in the single Vitest node project (no jsdom, no runes) and be tested without a device.
//
// D-14 is the governing requirement: the defaults below must parse a normal library with ZERO
// configuration. The rules exist to adjust behaviour, never as a prerequisite.

import { AUDIO_EXTENSIONS } from './download-filename';

/** Versioned localStorage key for the import rules — `openmusic:<domain>:v<N>` convention. */
export const IMPORT_RULES_KEY = 'openmusic:import-rules:v1';

export type PresetId = 'artist-title' | 'title-artist' | 'track-title';

/** Canonical preset order — the order the chips render in. NOTE: matching uses the order the user
 *  DECLARED in `rules.presets`, not this one; this is presentation only. */
export const PRESET_ORDER: readonly PresetId[] = ['artist-title', 'title-artist', 'track-title'];

/** LITERAL chip labels (34-UI-SPEC contract 5) — rendered verbatim, never translated. They describe
 *  a filename shape, not prose, so a localized `{艺术家}` would be a lie about the file on disk. */
export const PRESET_LABELS: Record<PresetId, string> = {
	'artist-title': '{artist} - {title}',
	'title-artist': '{title} - {artist}',
	'track-title': '{track}. {title}'
};

// 34-D-12: the extensions offered as chips. AUDIO_EXTENSIONS is the shared export/import vocabulary;
// `opus` is import-only and OFF by default because Android messaging apps write `.opus` voice notes
// into shared storage — on by default it imports voicemail.
export const IMPORT_EXTENSIONS: readonly string[] = [...AUDIO_EXTENSIONS, 'opus'];

export interface ImportRules {
	/** Multi-select (checkbox semantics, not radio). Tried in THIS order; first match wins. */
	presets: PresetId[];
	stripTrackNo: boolean;
	stripBrackets: boolean;
	/** '' = none. ONLY ever holds a value that passed `validateCustomPattern`. */
	customPattern: string;
	/** 0..120, step 5. 0 = no length filter. */
	minSeconds: number;
	/** Subset of IMPORT_EXTENSIONS, lowercase, no dot. */
	extensions: string[];
	/** One phrase per entry, matched case-insensitively against displayName AND relativePath. */
	skipRules: string[];
}

const MIN_SECONDS_DEFAULT = 30;
const MIN_SECONDS_MAX = 120;

/** D-13/D-14: the zero-configuration defaults. `{artist} - {title}` on, track numbers stripped,
 *  30s floor (drops ringtones and notification blips, keeps a skit or a short punk track). */
export const DEFAULT_IMPORT_RULES: ImportRules = {
	presets: ['artist-title'],
	stripTrackNo: true,
	stripBrackets: false,
	customPattern: '',
	minSeconds: MIN_SECONDS_DEFAULT,
	extensions: [...AUDIO_EXTENSIONS],
	skipRules: []
};

/** A fresh, independently-mutable copy — callers (and the store) own their rules object, so the
 *  exported defaults can never be mutated through a returned array reference. */
function cloneDefaults(): ImportRules {
	return {
		...DEFAULT_IMPORT_RULES,
		presets: [...DEFAULT_IMPORT_RULES.presets],
		extensions: [...DEFAULT_IMPORT_RULES.extensions],
		skipRules: [...DEFAULT_IMPORT_RULES.skipRules]
	};
}

/**
 * Tolerant persisted-rules parser: NEVER throws, defaults per FIELD (not per object) so one bad
 * value in localStorage cannot reset a user's whole panel. Same shape as
 * `search/search-history-logic.ts` (KEY constant + pure tolerant parse) which a runes store wraps.
 *
 * An empty `presets` or `extensions` array is VALID — the user turned everything off — so these are
 * only replaced by defaults when the field is missing or not an array at all.
 */
export function parseImportRules(raw: string | null): ImportRules {
	const out = cloneDefaults();
	if (!raw) return out;

	let obj: Partial<ImportRules>;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
		obj = parsed as Partial<ImportRules>;
	} catch {
		return out; // corrupt JSON → defaults, silently. Import must still work (D-14).
	}

	if (Array.isArray(obj.presets)) {
		out.presets = dedupe(
			obj.presets.filter((p): p is PresetId => PRESET_ORDER.includes(p as PresetId))
		);
	}
	if (typeof obj.stripTrackNo === 'boolean') out.stripTrackNo = obj.stripTrackNo;
	if (typeof obj.stripBrackets === 'boolean') out.stripBrackets = obj.stripBrackets;
	if (typeof obj.customPattern === 'string') out.customPattern = obj.customPattern;
	if (typeof obj.minSeconds === 'number' && Number.isFinite(obj.minSeconds)) {
		out.minSeconds = Math.max(0, Math.min(MIN_SECONDS_MAX, Math.round(obj.minSeconds)));
	}
	if (Array.isArray(obj.extensions)) {
		out.extensions = dedupe(
			obj.extensions
				.filter((e): e is string => typeof e === 'string')
				.map((e) => e.trim().toLowerCase())
				.filter((e) => IMPORT_EXTENSIONS.includes(e))
		);
	}
	if (Array.isArray(obj.skipRules)) {
		out.skipRules = dedupe(
			obj.skipRules
				.filter((s): s is string => typeof s === 'string')
				.map((s) => s.trim())
				.filter(Boolean)
		);
	}
	return out;
}

function dedupe<T>(list: T[]): T[] {
	return [...new Set(list)];
}

export interface ParsedName {
	title: string;
	artist: string;
	album?: string;
	track?: number;
}

/** Strip any directory prefix. Both separators, because a DISPLAY_NAME is attacker-influenceable
 *  (any app can name a file) and nothing downstream should ever see a path fragment. */
function baseOf(displayName: string): string {
	return displayName.replace(/^.*[/\\]/, '');
}

/** `'a/b.c.mp3'` → `'b.c'`. Only the LAST extension is removed, and only when a stem survives, so a
 *  dotfile-style name like `.mp3` keeps its text rather than becoming empty. */
export function stemOf(displayName: string): string {
	const base = baseOf(displayName);
	return base.replace(/\.[^.]+$/, '') || base;
}

/** `'x.FLAC'` → `'flac'`; `'noext'` → `''`. The leading `.` in the pattern requires a character
 *  before the dot, so `.mp3` has no extension — consistent with `stemOf` keeping it whole. */
export function extOf(displayName: string): string {
	return (/.\.([^.]+)$/.exec(baseOf(displayName))?.[1] ?? '').toLowerCase();
}

// PRESETS ARE NEVER USER INPUT (RESEARCH Pitfall 8 layer 3). These three patterns are fixed and
// audited; only the `customPattern` escape hatch is untrusted, and that one goes through
// `validateCustomPattern` below. Nothing here can backtrack catastrophically.
//
// The separator is SPACE-HYPHEN-SPACE (`\s+-\s+`), never a bare `-`. That single choice is what
// keeps `Jay-Z - 99 Problems.mp3` parsing as artist `Jay-Z` / title `99 Problems` instead of
// artist `Jay` / title `Z - 99 Problems`. Hyphenated names are common; spaced hyphens are the
// convention every filename builder (including our own download-filename.ts) actually emits.
const PRESET_PATTERNS: Record<PresetId, RegExp> = {
	'artist-title': /^(?<artist>.+?)\s+-\s+(?<title>.+)$/,
	'title-artist': /^(?<title>.+?)\s+-\s+(?<artist>.+)$/,
	'track-title': /^(?<track>\d{1,3})\s*[.\-]\s*(?<title>.+)$/
};

// ponytail: a bare "01 Title" (space only) is NOT stripped; requiring a . or - separator is what
// keeps "24K Magic" and "2 Become 1" intact — use the {track}. {title} preset for numbered lists.
const TRACK_NO = /^\d{1,3}\s*[.\-]\s*/;

// Lifted verbatim from services/match-key.ts:26 — do not author a third bracket regex. Lines 27-28
// of that chain (feat.-suffix strip, punctuation strip) are deliberately NOT applied here because
// parsing must preserve DISPLAY text: match-key normalizes for comparison, this produces the string
// a user will read in their library.
const BRACKETS = /[（(【\[].*?[)）\]】]/g;

/** Build a ParsedName from regex groups, with the D-16 stem fallback for a missing/blank title. */
function fromGroups(groups: Record<string, string | undefined>, stem: string): ParsedName {
	const out: ParsedName = {
		title: (groups.title ?? '').trim() || stem,
		artist: (groups.artist ?? '').trim()
	};
	const album = (groups.album ?? '').trim();
	if (album) out.album = album;
	const track = Number((groups.track ?? '').trim());
	if (groups.track !== undefined && Number.isFinite(track)) out.track = track;
	return out;
}

/**
 * 34-D-12/D-13/D-16: parse a MediaStore `DISPLAY_NAME` into display metadata.
 *
 * Order: stem → strip track number → strip brackets → collapse whitespace → custom pattern →
 * presets in the user's DECLARED order (first match wins) → stem fallback. The strip steps run
 * BEFORE matching so `01. Adele - Hello.mp3` reaches the `{artist} - {title}` preset as
 * `Adele - Hello`.
 *
 * Never returns null and never returns an empty title (D-16): a song the user can plainly see on
 * their phone must import with something visible rather than be silently skipped.
 */
export function parseFilename(
	displayName: string,
	rules: ImportRules,
	custom: RegExp | null
): ParsedName {
	let stem = stemOf(displayName);
	if (rules.stripTrackNo) stem = stem.replace(TRACK_NO, '');
	if (rules.stripBrackets) stem = stem.replace(BRACKETS, ' ');
	stem = stem.replace(/\s+/g, ' ').trim();

	// 34-D-16: the stem is never empty for a real file; if the strip steps ate everything, fall all
	// the way back to the raw name so the row is still identifiable.
	if (!stem) stem = displayName.trim() || displayName;

	if (custom) {
		const m = custom.exec(stem);
		if (m?.groups) return fromGroups(m.groups, stem);
	}

	for (const id of rules.presets) {
		const m = PRESET_PATTERNS[id]?.exec(stem);
		if (m?.groups) return fromGroups(m.groups, stem);
	}

	// 34-D-16 fallback: nothing matched (or the user turned every preset off) — the stem IS the title.
	return { title: stem, artist: '' };
}

// ─── The custom-pattern escape hatch: save-time ReDoS probe (RESEARCH Pitfall 8, layer 1) ────────
//
// A user-typed regex is the only untrusted input in this module, and it runs over thousands of
// attacker-influenceable filenames on the single-threaded WebView. JS RegExp has no timeout, there
// are no Web Workers (CLAUDE.md architectural constraint), and a runtime dependency is forbidden
// (`safe-regex` / `recheck` were explicitly rejected). So the defence is three cheap layers:
//   1. THIS — compile, require a named group, and time a small adversarial battery at SAVE time.
//   2. A cumulative scan budget with preset fallback in device-import.ts (Plan 34-06).
//   3. The presets above are fixed audited patterns, never user input.
//
// WHY 24 CHARS AND 25 ms. A well-behaved pattern finishes the whole battery in microseconds, so the
// budget has enormous headroom and cannot produce a false rejection. A catastrophic pattern like
// `(a+)+$` takes roughly 2^24 backtracking steps on 24 characters — hundreds of milliseconds, well
// over budget but BOUNDED, so the probe itself can never hang. The same pattern on a real 200-char
// filename would be ~2^200, i.e. never. That asymmetry is the whole trick: keep the probe input
// short enough to be measurable and long enough to be exponential. Each battery string ends in `!`
// because it is the FAILING match that forces the backtracking; a string that matches returns early.

/** Wall-clock budget for the whole probe battery. Over this → the pattern is refused at save time. */
export const PATTERN_PROBE_BUDGET_MS = 25;

/** Length of each adversarial probe string, before its trailing `!`. */
export const PATTERN_PROBE_LEN = 24;

export type PatternRejection = 'invalid' | 'no-groups' | 'too-slow';

/** The named groups parseFilename knows how to consume. At least one must be present. */
const NAMED_GROUP = /\(\?<(title|artist|album|track)>/;

/** Build the probe battery: generic adversarial shapes plus one string made from the pattern's own
 *  literal characters, so a pattern tuned to its own alphabet still gets a worst-case input. */
function probeBattery(src: string): string[] {
	const literals = src.replace(/[\\^$.*+?()[\]{}|]/g, '') || 'a';
	const fromSrc = literals.repeat(Math.ceil(PATTERN_PROBE_LEN / literals.length)).slice(0, PATTERN_PROBE_LEN);
	return [
		'a'.repeat(PATTERN_PROBE_LEN) + '!',
		'a '.repeat(PATTERN_PROBE_LEN / 2) + '!',
		'ab'.repeat(PATTERN_PROBE_LEN / 2) + '!',
		'-'.repeat(PATTERN_PROBE_LEN) + '!',
		'1. '.repeat(PATTERN_PROBE_LEN / 3) + '!',
		fromSrc + '!'
	];
}

/**
 * 34-D-12: validate a user-typed custom pattern before it is ever saved or run over a library.
 *
 * All three rejections are NON-DESTRUCTIVE at the call site (UI-SPEC contract 6): the typed text
 * stays in the field, the last valid pattern stays in force, and the Import CTA stays enabled — a
 * bad regex must never block D-14's "one tap and it works".
 *
 * ponytail: a pattern that is polynomial at 24 chars but exponential later slips through layer 1 —
 * layer 2 (device-import.ts PATTERN_SCAN_BUDGET_MS) bounds that to one run's budget.
 */
export function validateCustomPattern(
	src: string
): { ok: true; re: RegExp } | { ok: false; reason: PatternRejection } {
	// Empty is "no custom pattern", not a valid one — the caller clears the rule instead of saving ''.
	if (src.trim() === '') return { ok: false, reason: 'invalid' };

	let re: RegExp;
	try {
		// NO FLAGS, deliberately. A `g` flag carries a stateful `lastIndex` across calls, so exec()
		// would silently skip every second filename in the scan loop.
		re = new RegExp(src);
	} catch {
		return { ok: false, reason: 'invalid' };
	}

	if (!NAMED_GROUP.test(src)) return { ok: false, reason: 'no-groups' };

	const t0 = performance.now(); // global in Node >= 16 and every browser — no import needed
	for (const s of probeBattery(src)) {
		re.test(s);
		// Checked after EVERY string, not once at the end: the first catastrophic probe must abort
		// the battery rather than be repeated five more times.
		if (performance.now() - t0 > PATTERN_PROBE_BUDGET_MS) return { ok: false, reason: 'too-slow' };
	}
	return { ok: true, re };
}
