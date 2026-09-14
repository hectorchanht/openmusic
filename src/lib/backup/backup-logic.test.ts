// Co-located unit coverage for the PURE backup codec (35-D-01..D-04, D-09..D-12, Pitfall 7).
//
// No `vi.mock`, no stubbed globals: every function under test takes its inputs as parameters
// (a `read` closure, a key list, Storage objects), so this file drives it from plain Maps —
// the same posture as player-persist.test.ts / search-history-logic.test.ts.
import { describe, expect, it } from 'vitest';
import { HISTORY_KEY } from '$lib/history/history-logic';
import { SEARCH_HISTORY_KEY } from '$lib/search/search-history-logic';
import {
	BACKUP_EXACT_KEYS,
	BACKUP_FORMAT,
	BACKUP_MAGIC,
	LIBRARY_KEY,
	MIGRATIONS,
	NAME_TR_PREFIX,
	SETTINGS_KEY,
	UNDO_KEY,
	backupFilename,
	buildEnvelope,
	serializeEnvelope,
	storageKeys,
	validateEnvelope,
	type BackupEnvelope
} from './backup-logic';

/** Every `openmusic*` key the app writes today (35-RESEARCH Answer 1), plus the differently
 *  prefixed `openmusic-blob-uri:` family and two name-tr languages. */
function seed(): Record<string, string> {
	return {
		'openmusic:library:v1': JSON.stringify({ liked: [{ uid: 'kuwo:1' }], playlists: [], downloads: [], favArtists: ['A'] }),
		'openmusic:history:v1': JSON.stringify([{ uid: 'kuwo:1' }]),
		'openmusic:search-history:v1': JSON.stringify([{ query: 'x', ts: 1 }]),
		'openmusic:settings:v1': JSON.stringify({ appLang: 'zh-Hant' }),
		'openmusic:name-tr:v2:zh-Hant': JSON.stringify({ Foo: '福' }),
		'openmusic:name-tr:v2:en': JSON.stringify({ 福: 'Foo' }),
		'openmusic:player:v1': JSON.stringify({ v: 1, current: { uid: 'kuwo:1' } }),
		'openmusic:cover-cache:v1': JSON.stringify({}),
		'openmusic:action-log:v1': JSON.stringify([]),
		'openmusic:lyrics-tr:v3:en:abc': JSON.stringify(['line']),
		'openmusic:top-picks:v2': JSON.stringify({}),
		'openmusic:top-picks:v1': JSON.stringify({}),
		'openmusic:home-library:v1': JSON.stringify({}),
		'openmusic:library:tab': '"liked"',
		'openmusic:diag:v1': '"secret-upload-token"',
		'openmusic-blob-uri:kuwo:1': '"content://media/1"'
	};
}

function readerFor(store: Record<string, string>) {
	return (k: string) => (k in store ? store[k] : null);
}

/** A minimal envelope wrapper for the reject-reason cases. */
function envJson(body: Record<string, unknown>): string {
	return JSON.stringify(body);
}

function okEnvelope(keys: Record<string, unknown>): string {
	return envJson({ app: BACKUP_MAGIC, format: BACKUP_FORMAT, exportedAt: '2026-09-13T00:00:00.000Z', keys });
}

describe('envelope', () => {
	it('carries exactly the 4 exact keys plus every name-tr key in the store', () => {
		const store = seed();
		const got = Object.keys(buildEnvelope(readerFor(store), Object.keys(store)).keys).sort();
		expect(got).toEqual(
			[LIBRARY_KEY, HISTORY_KEY, SEARCH_HISTORY_KEY, SETTINGS_KEY, 'openmusic:name-tr:v2:en', 'openmusic:name-tr:v2:zh-Hant'].sort()
		);
	});

	it('skips a corrupt name-tr value without throwing (a local mess never aborts an export)', () => {
		const store = seed();
		store['openmusic:name-tr:v2:ja'] = '{not json';
		const env = buildEnvelope(readerFor(store), Object.keys(store));
		expect(Object.keys(env.keys)).not.toContain('openmusic:name-tr:v2:ja');
	});

	it('omits an absent exact key rather than writing null', () => {
		const store = seed();
		delete store[SETTINGS_KEY];
		const env = buildEnvelope(readerFor(store), Object.keys(store));
		expect(SETTINGS_KEY in env.keys).toBe(false);
	});

	it('storageKeys enumerates a Storage by index and survives a throwing store', () => {
		const map = new Map<string, string>([['a', '1'], ['b', '2']]);
		expect(storageKeys({ length: map.size, key: (i) => Array.from(map.keys())[i] ?? null })).toEqual(['a', 'b']);
		const hostile: Pick<Storage, 'length' | 'key'> = {
			get length(): number {
				throw new Error('storage unavailable');
			},
			key: () => null
		};
		expect(storageKeys(hostile)).toEqual([]);
	});
});

describe('never exports', () => {
	it('key literals match their owning stores', () => {
		expect(LIBRARY_KEY).toBe('openmusic:library:v1');
		expect(SETTINGS_KEY).toBe('openmusic:settings:v1');
		expect(NAME_TR_PREFIX).toBe('openmusic:name-tr:');
		expect(UNDO_KEY).toBe('openmusic:import-undo:v1');
		expect(BACKUP_MAGIC).toBe('openmusic-backup');
		expect(BACKUP_FORMAT).toBe(1);
	});

	it('BACKUP_EXACT_KEYS excludes the player state (35-D-02) and the diag upload token', () => {
		expect(BACKUP_EXACT_KEYS).not.toContain('openmusic:player:v1');
		expect(BACKUP_EXACT_KEYS).not.toContain('openmusic:diag:v1');
		expect([...BACKUP_EXACT_KEYS].sort()).toEqual([LIBRARY_KEY, HISTORY_KEY, SEARCH_HISTORY_KEY, SETTINGS_KEY].sort());
	});

	it('an envelope built over a full store contains no player / diag / blob-uri key', () => {
		const store = seed();
		const got = Object.keys(buildEnvelope(readerFor(store), Object.keys(store)).keys);
		expect(got).not.toContain('openmusic:player:v1');
		expect(got).not.toContain('openmusic:diag:v1');
		expect(got.some((k) => k.startsWith('openmusic-blob-uri:'))).toBe(false);
	});
});

describe('envelope shape', () => {
	it('stamps app / format / the injected ISO timestamp', () => {
		const store = seed();
		const now = new Date('2026-09-13T15:04:05Z');
		const env = buildEnvelope(readerFor(store), Object.keys(store), now);
		expect(env.app).toBe(BACKUP_MAGIC);
		expect(env.format).toBe(BACKUP_FORMAT);
		expect(env.exportedAt).toBe(now.toISOString());
	});

	it('serializes pretty-printed and round-trips through the validator', () => {
		const store = seed();
		const env = buildEnvelope(readerFor(store), Object.keys(store), new Date('2026-09-13T15:04:05Z'));
		const text = serializeEnvelope(env);
		expect(text).toContain('\n  "app"');
		const res = validateEnvelope(text);
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.envelope.keys).toEqual(env.keys);
	});
});

describe('filename', () => {
	it('is openmusic-backup-YYYY-MM-DD.json (35-D-04)', () => {
		expect(backupFilename(new Date('2026-09-13T15:04:05Z'))).toBe('openmusic-backup-2026-09-13.json');
		expect(backupFilename(new Date('2026-01-02T00:00:00Z'))).toMatch(/^openmusic-backup-\d{4}-\d{2}-\d{2}\.json$/);
	});
});

describe('reject reason', () => {
	it('unparseable text is damaged', () => {
		expect(validateEnvelope('not json')).toEqual({ ok: false, reason: 'damaged' });
	});

	it('a non-object top level is not-ours', () => {
		expect(validateEnvelope('[]')).toEqual({ ok: false, reason: 'not-ours' });
		expect(validateEnvelope('null')).toEqual({ ok: false, reason: 'not-ours' });
	});

	it('checks the magic BEFORE the format, so a foreign file never reads as "newer"', () => {
		expect(validateEnvelope('{"format":99}')).toEqual({ ok: false, reason: 'not-ours' });
	});

	it('a higher format is newer, and reports the format it saw', () => {
		expect(validateEnvelope(envJson({ app: BACKUP_MAGIC, format: 2 }))).toEqual({ ok: false, reason: 'newer', format: 2 });
	});

	it('a non-number format on an otherwise-ours file is damaged', () => {
		expect(validateEnvelope(envJson({ app: BACKUP_MAGIC, format: '1' }))).toEqual({ ok: false, reason: 'damaged' });
	});

	it('a missing or non-object keys map is damaged', () => {
		expect(validateEnvelope(envJson({ app: BACKUP_MAGIC, format: 1 }))).toEqual({ ok: false, reason: 'damaged' });
		expect(validateEnvelope(envJson({ app: BACKUP_MAGIC, format: 1, keys: [] }))).toEqual({ ok: false, reason: 'damaged' });
	});

	it('an empty keys map is a valid (if useless) backup', () => {
		const res = validateEnvelope(envJson({ app: BACKUP_MAGIC, format: 1, keys: {} }));
		expect(res).toEqual({ ok: true, envelope: { app: BACKUP_MAGIC, format: 1, exportedAt: '', keys: {} }, skipped: [] });
	});

	it('a non-array history / search-history, or an array settings, is damaged', () => {
		expect(validateEnvelope(okEnvelope({ [HISTORY_KEY]: {} }))).toEqual({ ok: false, reason: 'damaged' });
		expect(validateEnvelope(okEnvelope({ [SEARCH_HISTORY_KEY]: 'x' }))).toEqual({ ok: false, reason: 'damaged' });
		expect(validateEnvelope(okEnvelope({ [SETTINGS_KEY]: [] }))).toEqual({ ok: false, reason: 'damaged' });
	});

	it('a name-tr map whose values are not all strings is damaged', () => {
		expect(validateEnvelope(okEnvelope({ 'openmusic:name-tr:v2:en': { a: 1 } }))).toEqual({ ok: false, reason: 'damaged' });
		expect(validateEnvelope(okEnvelope({ 'openmusic:name-tr:v2:en': [] }))).toEqual({ ok: false, reason: 'damaged' });
	});
});

describe('migration', () => {
	it('has an EMPTY migration table today', () => {
		expect(Object.keys(MIGRATIONS)).toHaveLength(0);
	});

	it('an unmigratable key in a KNOWN domain is refused per-key and named in `skipped`', () => {
		const res = validateEnvelope(okEnvelope({ 'openmusic:library:v0': {}, [HISTORY_KEY]: [] }));
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.skipped).toEqual(['openmusic:library:v0']);
			expect('openmusic:library:v0' in res.envelope.keys).toBe(false);
			expect(res.envelope.keys[HISTORY_KEY]).toEqual([]);
		}
	});

	it('a key in an UNKNOWN domain is dropped silently (forward compat)', () => {
		const res = validateEnvelope(okEnvelope({ 'openmusic:future-thing:v1': { a: 1 } }));
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.skipped).toEqual([]);
			expect('openmusic:future-thing:v1' in res.envelope.keys).toBe(false);
		}
	});

	it('a player-state key inside a file is dropped and NOT reported (35-D-02)', () => {
		const res = validateEnvelope(okEnvelope({ 'openmusic:player:v1': { v: 1 } }));
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect('openmusic:player:v1' in res.envelope.keys).toBe(false);
			expect(res.skipped).toEqual([]);
		}
	});

	it('a stale-version name-tr key is kept verbatim (names.purgeStale drops it on next boot)', () => {
		const res = validateEnvelope(okEnvelope({ 'openmusic:name-tr:v1:en': { 福: 'Foo' } }));
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.envelope.keys['openmusic:name-tr:v1:en']).toEqual({ 福: 'Foo' });
	});
});

describe('array guard', () => {
	// Pitfall 7 / T-35-02: library.load() casts liked/playlists/downloads with only a nullish
	// fallback, so the importer is the last line of defence against `library.liked = 5`.
	it('rejects a non-array liked / playlists / downloads / favArtists', () => {
		expect(validateEnvelope(okEnvelope({ [LIBRARY_KEY]: { liked: 5 } }))).toEqual({ ok: false, reason: 'damaged' });
		expect(validateEnvelope(okEnvelope({ [LIBRARY_KEY]: { liked: [], playlists: 'x' } }))).toEqual({ ok: false, reason: 'damaged' });
		expect(validateEnvelope(okEnvelope({ [LIBRARY_KEY]: { downloads: {} } }))).toEqual({ ok: false, reason: 'damaged' });
		expect(validateEnvelope(okEnvelope({ [LIBRARY_KEY]: { liked: [], favArtists: 'a' } }))).toEqual({ ok: false, reason: 'damaged' });
	});

	it('accepts absent sub-arrays (pre-favArtists backups stay importable)', () => {
		expect(validateEnvelope(okEnvelope({ [LIBRARY_KEY]: { liked: [] } })).ok).toBe(true);
		expect(validateEnvelope(okEnvelope({ [LIBRARY_KEY]: {} })).ok).toBe(true);
	});

	it('rejects a non-object library payload outright', () => {
		expect(validateEnvelope(okEnvelope({ [LIBRARY_KEY]: [] }))).toEqual({ ok: false, reason: 'damaged' });
	});
});

// Type-level pin: the exported envelope interface is what plans 03/04 import.
const _shape: BackupEnvelope = { app: BACKUP_MAGIC, format: BACKUP_FORMAT, exportedAt: '', keys: {} };
describe('envelope contract', () => {
	it('exposes the BackupEnvelope interface downstream plans import', () => {
		expect(_shape.app).toBe(BACKUP_MAGIC);
	});
});
