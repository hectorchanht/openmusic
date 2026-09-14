// PURE backup/restore codec — NO runes, no app-environment import, no i18n import, NEVER throws.
//
// This module is the node-Vitest-testable core of Settings → Data's Export / Import buttons.
// The page merely WRAPS it: it reads the file text, calls `validateEnvelope`, and — on ok —
// hands the two Web Storage objects to `applyEnvelope` before reloading (35-D-13). That is the
// established "extract a pure helper module the runes caller thinly wraps" precedent already
// used by player-persist.ts, history-logic.ts and search-history-logic.ts.
//
// Nothing here reaches for a global. Every entry point takes its inputs as parameters — a
// `read` closure, a key list, Storage objects — so the unit tests drive it from plain Maps with
// zero global stubbing, and the same code serves both the web and the native build.
//
// 35-D-11: failures come back as a typed `reason`, never as a throw and never as English. The
// caller maps a reason to an i18n key; `t()` reads runes state and would break the single node
// Vitest project, exactly as download-track.ts declines to localize (D-17 there).
import { HISTORY_KEY } from '$lib/history/history-logic';
import { SEARCH_HISTORY_KEY } from '$lib/search/search-history-logic';

/** Magic marker in every file we write. 35-D-11 message 1: absent/different → "not ours". */
export const BACKUP_MAGIC = 'openmusic-backup';

/**
 * 35-D-03: ENVELOPE format version — the single gate for 35-D-11's "made by a newer version"
 * message. Bump ONLY when the envelope STRUCTURE changes, never when a payload's inner shape
 * drifts (each store's own `load()` tolerance already absorbs that).
 *
 * There is deliberately no app-version field: the client has no version to report
 * (`package.json` sits at a never-bumped 0.0.1), so a hardcoded integer is the honest gate.
 */
export const BACKUP_FORMAT = 1;

// The three keys below are owned by runes singletons (library.svelte.ts:10,
// settings.svelte.ts:56, names.svelte.ts:47). Importing those files would drag runes state —
// plus settings/translate/zh-convert — into this pure module and its node test, so we own local
// copies and PIN them with equality assertions in backup-logic.test.ts instead. HISTORY_KEY and
// SEARCH_HISTORY_KEY need no copy: their owners are already pure modules.

/** Owner: src/lib/stores/library.svelte.ts:10. */
export const LIBRARY_KEY = 'openmusic:library:v1';

/** Owner: src/lib/stores/settings.svelte.ts:56. */
export const SETTINGS_KEY = 'openmusic:settings:v1';

/**
 * Owner: src/lib/stores/names.svelte.ts:47 — a PREFIX FAMILY, one key per target language
 * (`openmusic:name-tr:<ver>:<lang>`). A single read of one key name would silently ship an
 * empty cache, so both the export and the wipe enumerate by prefix. No version knowledge is
 * needed here: a future `STORE_VER` bump requires no change to this module.
 */
export const NAME_TR_PREFIX = 'openmusic:name-tr:';

/** Where the 35-D-09 rollback snapshot lives. The page passes the per-tab Storage, never the
 *  persistent one — the live keys already occupy ~740 KB of a ~5 MB origin budget shared with
 *  the cover cache, and library.save()'s quota catch is silent. */
export const UNDO_KEY = 'openmusic:import-undo:v1';

/** 35-D-01: the four exactly-named keys that travel. Everything else is derivable, machine-local,
 *  or a secret: the player queue (35-D-02), the cover cache (stale URLs are worse than none),
 *  the diag upload token, and the device-local `openmusic-blob-uri:` content URIs. */
export const BACKUP_EXACT_KEYS: readonly string[] = [LIBRARY_KEY, HISTORY_KEY, SEARCH_HISTORY_KEY, SETTINGS_KEY];

/**
 * 35-D-12: old key name → upgrade function. EMPTY TODAY and that is correct: no exported key has
 * ever changed its version segment (library:v1 absorbed `favArtists` additively instead). Add an
 * entry the DAY a version is bumped, not before — a migration framework for an empty table is
 * the abstraction this comment exists to prevent.
 */
export const MIGRATIONS: Record<string, (payload: unknown) => unknown> = {};

/** Known key DOMAINS → the current key name in that domain. A file carrying an unknown version
 *  segment of a known domain is refused per-key and named (35-D-12); an entirely unknown domain
 *  is dropped silently so a future app's 6th key cannot break today's import. */
const DOMAINS: ReadonlyArray<readonly [string, string]> = [
	['openmusic:library:', LIBRARY_KEY],
	['openmusic:search-history:', SEARCH_HISTORY_KEY],
	['openmusic:history:', HISTORY_KEY],
	['openmusic:settings:', SETTINGS_KEY]
];

export interface BackupEnvelope {
	/** 35-D-11 message 1. */
	app: typeof BACKUP_MAGIC;
	/** 35-D-11 message 2. */
	format: number;
	/** ISO 8601. Informational only — nothing branches on it. */
	exportedAt: string;
	/** Key = the LITERAL storage key name, version segment included (so the per-key version is
	 *  implicit and exact). Value = the parsed payload, written back verbatim on import. */
	keys: Record<string, unknown>;
}

/** 35-D-11: three distinguishable refusals, each mapping 1:1 to an i18n key at the UI layer. */
export type BackupReject =
	| { ok: false; reason: 'not-ours' }
	| { ok: false; reason: 'newer'; format: number }
	| { ok: false; reason: 'damaged' };

export type ValidateResult = { ok: true; envelope: BackupEnvelope; skipped: string[] } | BackupReject;

/** `no-snapshot` = refused before touching anything; `write-failed` = rolled back. */
export type ApplyResult = 'ok' | 'no-snapshot' | 'write-failed';

/** 35-D-04: dated so multiple backups coexist and sort naturally. */
export function backupFilename(now: Date): string {
	return `openmusic-backup-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Enumerate a Storage by index — the `for (let i = 0; i < length; i++) key(i)` loop from
 * names.svelte.ts:285-288, which is the only way to discover a prefix family. Returns whatever
 * it collected if the store throws mid-scan.
 */
export function storageKeys(store: Pick<Storage, 'length' | 'key'>): string[] {
	const out: string[] = [];
	try {
		for (let i = 0; i < store.length; i++) {
			const k = store.key(i);
			if (k) out.push(k);
		}
	} catch {
		/* unavailable — return what we have */
	}
	return out;
}

/**
 * Build the export payload. SYNCHRONOUS on purpose: the web export runs inside the click
 * handler, and iOS Safari discards the user gesture across an await (35-RESEARCH Pitfall 5).
 *
 * `read` is injected (the page passes a getItem closure over the live store, the test passes a Map
 * lookup) — the saveBlobToDisk(doc) precedent. A key that is absent is omitted entirely, and a
 * key whose stored value is corrupt is SKIPPED: a local mess must never abort an export.
 */
export function buildEnvelope(read: (k: string) => string | null, allKeys: readonly string[], now: Date = new Date()): BackupEnvelope {
	const keys: Record<string, unknown> = {};
	// 35-D-01: the four exact keys, then the name-tr PREFIX FAMILY enumerated from the store.
	const wanted = [...BACKUP_EXACT_KEYS, ...allKeys.filter((k) => k.startsWith(NAME_TR_PREFIX))];
	for (const k of wanted) {
		let raw: string | null = null;
		try {
			raw = read(k);
		} catch {
			/* unavailable — treat as absent */
		}
		if (raw == null) continue;
		try {
			keys[k] = JSON.parse(raw);
		} catch {
			/* corrupt local value — skip this key, never abort the export */
		}
	}
	return { app: BACKUP_MAGIC, format: BACKUP_FORMAT, exportedAt: now.toISOString(), keys };
}

/** 35-D-03: pretty-printed. Measured worst case ~1.4 MB — one in-memory string, no streaming. */
export function serializeEnvelope(env: BackupEnvelope): string {
	return JSON.stringify(env, null, 2);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return v != null && typeof v === 'object' && !Array.isArray(v);
}

/** Every value must be a string — a name-tr payload is a flat Record<original, translated>. */
function isStringRecord(v: unknown): boolean {
	return isPlainObject(v) && Object.values(v).every((x) => typeof x === 'string');
}

/**
 * Per-key shape check for the four exact keys. Deliberately asymmetric, because each owning
 * `load()` already defends a different amount:
 *  - library: liked/playlists/downloads/favArtists must each be an array or absent. library.load()
 *    casts the first three with only a `?? []` fallback (Pitfall 7 / T-35-02), so a hostile
 *    `{"liked": 5}` would land in the store and the home shelves would `.map()` over a number.
 *    THIS is the last line of defence for that key.
 *  - history / search-history: a bare array, matching parseHistory / parseSearchHistory.
 *  - settings: a non-null, non-array object AND NOTHING MORE. Every field is individually guarded
 *    by settings.load() (WR-10 / T-vzu-01); duplicating ~150 lines of per-field defence here
 *    would go stale.
 */
function shapeOk(key: string, v: unknown): boolean {
	if (key === LIBRARY_KEY) {
		if (!isPlainObject(v)) return false;
		for (const field of ['liked', 'playlists', 'downloads', 'favArtists']) {
			const got = v[field];
			if (got !== undefined && !Array.isArray(got)) return false;
		}
		return true;
	}
	if (key === HISTORY_KEY || key === SEARCH_HISTORY_KEY) return Array.isArray(v);
	if (key === SETTINGS_KEY) return isPlainObject(v);
	return false;
}

/**
 * PURE + NEVER THROWS. Takes the raw file TEXT (the page does `await file.text()`), so the node
 * test drives it with a string and needs no File/FileReader stub.
 *
 * Order matters for 35-D-11's message accuracy: parse → is-an-object → magic → format → keys map
 * → per-key shape. The magic is checked BEFORE the format so a random `{"format":99}` reads "not
 * an OpenMusic backup" rather than "made by a newer version".
 *
 * DIVERGENCE from parseSearchHistory (search-history-logic.ts:58), which FILTERS bad entries and
 * keeps going: here any shape failure rejects the WHOLE file (35-D-10 atomicity). Same guard
 * style, opposite disposition — do not "fix" one to match the other.
 */
export function validateEnvelope(raw: string): ValidateResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, reason: 'damaged' };
	}
	if (!isPlainObject(parsed)) return { ok: false, reason: 'not-ours' };
	if (parsed.app !== BACKUP_MAGIC) return { ok: false, reason: 'not-ours' };
	const format = parsed.format;
	if (typeof format !== 'number') return { ok: false, reason: 'damaged' };
	if (format > BACKUP_FORMAT) return { ok: false, reason: 'newer', format };
	if (!isPlainObject(parsed.keys)) return { ok: false, reason: 'damaged' };

	// Build a NEW map holding only what will actually be written — the caller never sees a key
	// it is not allowed to restore.
	const keys: Record<string, unknown> = {};
	const skipped: string[] = [];
	for (const [k, v] of Object.entries(parsed.keys)) {
		if (BACKUP_EXACT_KEYS.includes(k)) {
			if (!shapeOk(k, v)) return { ok: false, reason: 'damaged' };
			keys[k] = v;
			continue;
		}
		if (k.startsWith(NAME_TR_PREFIX)) {
			if (!isStringRecord(v)) return { ok: false, reason: 'damaged' };
			// Kept verbatim regardless of the version segment: names.purgeStale()
			// (names.svelte.ts:69-85) deletes stale versions on next boot, so a v1 key costs one
			// wasted write and needs no migration entry.
			keys[k] = v;
			continue;
		}
		const domain = DOMAINS.find(([prefix]) => k.startsWith(prefix));
		if (domain) {
			const migrate = MIGRATIONS[k];
			if (!migrate) {
				// 35-D-12: refused per-key, and say so — the page names the skipped keys.
				skipped.push(k);
				continue;
			}
			let upgraded: unknown;
			try {
				upgraded = migrate(v);
			} catch {
				return { ok: false, reason: 'damaged' };
			}
			const current = domain[1];
			if (!shapeOk(current, upgraded)) return { ok: false, reason: 'damaged' };
			keys[current] = upgraded;
			continue;
		}
		// Unknown domain — including `openmusic:player:v1` (35-D-02) and the diag token. Dropped
		// silently and NOT reported: these are not failures, they are keys we refuse to restore.
	}

	return {
		ok: true,
		envelope: {
			app: BACKUP_MAGIC,
			format,
			exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
			keys
		},
		skipped
	};
}

/**
 * 35-D-08 Replace, not merge: drop every restorable key (including name-tr languages the file
 * does NOT carry), then write the file's payloads. The ONLY function in this module that may
 * throw — a quota failure mid-write is exactly what applyEnvelope's rollback catches — and it is
 * private so that contract never leaks.
 *
 * 35-D-08: the library wipe is a plain removeItem, NOT library.clearAll(). clearAll() mutates the
 * live runes fields and fires save(), which could write an empty blob back over our setItem if any
 * reactive path ran before the reload. A plain remove leaves every singleton untouched until the
 * 35-D-13 reload re-runs load() cold.
 *
 * Collect-then-mutate, two passes: indices shift during removal, so the prefix scan can never be
 * interleaved with removeItem (names.svelte.ts:282-293).
 */
function wipeAndWrite(env: BackupEnvelope, live: Storage): void {
	const doomed: string[] = [...BACKUP_EXACT_KEYS];
	for (const k of storageKeys(live)) if (k.startsWith(NAME_TR_PREFIX)) doomed.push(k);
	for (const k of doomed) live.removeItem(k);
	for (const [k, v] of Object.entries(env.keys)) live.setItem(k, JSON.stringify(v));
}

/**
 * Snapshot → wipe → write, all-or-nothing (35-D-08 / 35-D-09 / 35-D-10).
 *
 * Both stores are PARAMETERS: the page passes the persistent store as `live` and the per-tab one
 * as `undo`. That single call-site argument is the whole platform seam — if the per-tab store ever
 * turns out not to survive a reload in the native WebView, the fallback is one different argument,
 * not a change in here.
 *
 * 35-D-09: if the snapshot cannot be stored we refuse rather than proceed. A destructive one-tap
 * button with no undo is precisely the thing this decision exists to prevent, and nothing has been
 * written at that point, so the live store is byte-identical.
 *
 * The reload (35-D-13) belongs to the page — this module has no window.
 */
export function applyEnvelope(env: BackupEnvelope, live: Storage, undo: Storage): ApplyResult {
	const snapshot = serializeEnvelope(buildEnvelope((k) => live.getItem(k), storageKeys(live)));
	try {
		undo.setItem(UNDO_KEY, snapshot);
	} catch {
		return 'no-snapshot';
	}
	try {
		wipeAndWrite(env, live);
	} catch {
		// Quota (or a hostile store) mid-write. Best-effort rollback through the SAME validator the
		// import path uses — one code path in both directions. The snapshot deliberately STAYS so
		// the user can retry the undo by hand if even this fails.
		const back = validateEnvelope(snapshot);
		if (back.ok) {
			try {
				wipeAndWrite(back.envelope, live);
			} catch {
				/* nothing further we can do from here — the snapshot is still on disk */
			}
		}
		return 'write-failed';
	}
	return 'ok';
}

/**
 * Put the pre-import bytes back and drop the snapshot. An unreadable snapshot is discarded rather
 * than written back, so a corrupt undo can never damage the live store.
 *
 * ponytail: one level of undo — a redo stack is unrequested, and the snapshot is intentionally NOT
 * re-snapshotted before the restore.
 */
export function undoImport(live: Storage, undo: Storage): ApplyResult {
	let raw: string | null = null;
	try {
		raw = undo.getItem(UNDO_KEY);
	} catch {
		/* unavailable — treat as no snapshot */
	}
	if (raw == null) return 'no-snapshot';
	const res = validateEnvelope(raw);
	if (!res.ok) {
		try {
			undo.removeItem(UNDO_KEY);
		} catch {
			/* ignore */
		}
		return 'no-snapshot';
	}
	try {
		wipeAndWrite(res.envelope, live);
	} catch {
		return 'write-failed';
	}
	try {
		undo.removeItem(UNDO_KEY);
	} catch {
		/* ignore */
	}
	return 'ok';
}

/** Does an Undo import affordance have anything to offer? Read by the page after the reload. */
export function hasUndoSnapshot(undo: Pick<Storage, 'getItem'>): boolean {
	try {
		return undo.getItem(UNDO_KEY) != null;
	} catch {
		return false;
	}
}
