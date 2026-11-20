// import-exclusions — "DON'T IMPORT THIS FILE AGAIN", one entry per uid (quick-260919-30x, D-1/D-2/D-3).
//
// The device importer's job is to bring in everything it finds; this is where the user's per-file
// veto lives. Structurally a near-verbatim copy of lyric-pins.ts (itself a copy of the cover-cache
// PIN block): pure, node-testable, NEVER throws, a failed write simply does not persist.
//
// ---- WHAT THIS IS NOT ---------------------------------------------------------------------------
// Marking a file is NOT a delete and this module writes NOTHING to the filesystem. The mark's only
// effects are this localStorage record and (at the call site) `library.removeDownload`, whose
// disk-side step is `blobStore.del` — and `nativeDel` REFUSES a `device:` uid as its first
// statement (34 Pitfall 1), so the user's own audio file is not read, renamed, moved or deleted.
// It stays in their Music/ or Download/ folder under its own name, listed by their own music app.
//
// D-1 — its OWN key family. `openmusic:library:v1` is rewritten wholesale by `setDownloads` on every
// import, so an exclusion stored inside it would be clobbered by the very pass that must read it;
// `openmusic:import-rules:v1` holds generic case-insensitive PHRASE rules matched against the name
// AND the folder, so folding a filename into it would silently exclude every same-named variant and
// every file under a same-named folder. A per-file choice needs a per-file record.
//
// D-3 — KEYED ON THE `device:<id>` UID, whose id is the MediaStore `_ID`. A MediaStore provider
// rebuild (clear-storage, factory reset, SD remount) reassigns ids, so an exclusion can either
// (i) LAPSE — the file re-imports and the user marks it again, or (ii) in the pathological case
// LAND ON A DIFFERENT FILE, which is then quietly not imported until the user allows it again.
// This is not a new bug class: it is exactly the cost 34-D-02 already accepts ("a like or playlist
// reference to a rebuilt _ID now points at a different song"), and the whole refresh-in-place
// design in device-import.ts is built on top of it. The MITIGATION is the recovery list under
// Settings -> Downloads: every mark is visible and reversible, never invisible state.
// Why not key on the file path: `relativePath`/`displayName` live on the ScanRow and are never
// persisted onto the Track, so they cannot be computed at the mark site (TrackMenu holds a Track,
// not a row) — it would take a new persisted field plus a migration, and a path lapses on rename.

const EXCL_KEY = 'openmusic:import-exclusions:v1';

// D-2 / T-30x-02 — the two caps, at the WRITER so every caller inherits them. The reasoning is
// lyric-pins D-3's, inherited rather than re-derived: localStorage is a SHARED origin quota and the
// cover cache's writer swallows QuotaExceededError, so an unbounded record here surfaces as "covers
// silently stopped caching", miles from the cause. Worst case at these caps is ~65 KB.
//
// DIVERGENCE FROM lyric-pins, deliberate: an over-long label is TRUNCATED, not rejected. There, a
// half LRC is a worse lie than no pin at all. Here the label is only a human identifier for the
// recovery list and the EXCLUSION ITSELF is the payload — rejecting the write would throw away the
// thing the user actually asked for in order to protect a display string.
const MAX_LABEL_CHARS = 120;
// ponytail: eviction is insertion-order-first (JS string-key object order), i.e. the oldest MARK is
// evicted, not the least-recently-used one. That file then re-imports on the next scan and the user
// marks it again — visible and recoverable, which is the whole posture of this feature. Upgrade
// path if anyone ever fills 500 slots: store `{ label, at }` and evict by `at`.
const MAX_EXCLUSIONS = 500;

/** The on-disk shape: uid → a human label for the recovery list. */
export type ExclusionRecord = Record<string, string>;

/** Read the record; {} on absent / corrupt / unavailable storage (never throws). */
export function readExclusions(): ExclusionRecord {
	try {
		const raw = localStorage.getItem(EXCL_KEY);
		if (!raw) return {};
		const v: unknown = JSON.parse(raw);
		if (v && typeof v === 'object' && !Array.isArray(v)) return v as ExclusionRecord;
		return {};
	} catch {
		return {};
	}
}

/** Every marked uid, as the set `classifyRow` takes. Empty record → empty set. Never throws. */
export function excludedUids(): Set<string> {
	return new Set(Object.keys(readExclusions()));
}

/**
 * Is `uid` marked? EMPTY-UID GUARD (mirrors getPinnedLyrics): a uid-less stub has no identity, so an
 * empty uid is always a miss whatever is on disk — it must never read a shared slot.
 */
export function isExcluded(uid: string): boolean {
	if (!uid) return false;
	return uid in readExclusions();
}

/**
 * Mark `uid` as "never import this file again". No-op on an empty uid (no identity to mark against).
 * A blank / whitespace-only / non-string label stores `''` rather than refusing the write (D-2 — the
 * exclusion is the payload; a missing display string never blocks the user's choice). An over-long
 * label is truncated to MAX_LABEL_CHARS. Trims the record to MAX_EXCLUSIONS oldest-first before
 * writing. Swallows quota / unavailable storage.
 */
export function excludeUid(uid: string, label: string): void {
	if (!uid) return;
	const clean = typeof label === 'string' ? label.trim().slice(0, MAX_LABEL_CHARS) : '';
	try {
		const rec = readExclusions();
		rec[uid] = clean;
		// Trim from the FRONT (insertion order) until the record fits. A newly marked uid is last in
		// key order, so it can never be the one evicted; re-marking an existing uid is an update and
		// does not grow the record at all.
		const keys = Object.keys(rec);
		for (let i = 0; keys.length - i > MAX_EXCLUSIONS; i++) delete rec[keys[i]];
		localStorage.setItem(EXCL_KEY, JSON.stringify(rec));
	} catch {
		/* quota or unavailable — non-fatal, the mark simply does not persist */
	}
}

/** Allow `uid` to import again. Un-marking an absent uid is a true no-op (no write). Never throws. */
export function unexcludeUid(uid: string): void {
	if (!uid) return;
	try {
		const rec = readExclusions();
		if (uid in rec) {
			delete rec[uid];
			localStorage.setItem(EXCL_KEY, JSON.stringify(rec));
		}
	} catch {
		/* unavailable / quota / corrupt — non-fatal, no-op */
	}
}
