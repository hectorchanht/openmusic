// Co-located unit coverage for the PURE backup codec (35-D-01..D-04, D-09..D-12, Pitfall 7).
//
// No `vi.mock`, no stubbed globals: every function under test takes its inputs as parameters
// (a `read` closure, a key list, Storage objects), so this file drives it from plain Maps —
// the same posture as player-persist.test.ts / search-history-logic.test.ts.
import { describe, expect, it } from 'vitest';
import { HISTORY_KEY } from '$lib/history/history-logic';
import { SEARCH_HISTORY_KEY } from '$lib/search/search-history-logic';
import { STATE_KEY } from '$lib/stores/player-persist';
import {
	BACKUP_EXACT_KEYS,
	BACKUP_FORMAT,
	BACKUP_MAGIC,
	LIBRARY_KEY,
	MIGRATIONS,
	NAME_TR_PREFIX,
	PLAYER_KEY,
	PLAYER_QUEUE_CAP,
	SETTINGS_KEY,
	UNDO_KEY,
	applyEnvelope,
	backupFilename,
	buildEnvelope,
	cleanPlayerPayload,
	hasUndoSnapshot,
	serializeEnvelope,
	slimLibraryForSync,
	slimTrackForSync,
	storageKeys,
	undoImport,
	validateEnvelope,
	validateSyncKey,
	type BackupEnvelope
} from './backup-logic';

/** quick-261118-xdresume: a canonical player blob — exactly what serializePlayerState writes. */
const PLAYER_BLOB = {
	v: 1,
	current: { uid: 'kuwo:1', source: 'kuwo', songid: '1', title: 'T', artist: 'A', album: '', cover: null, quality: null, qualityLabel: null, keyword: 'T', displayIndex: 1 },
	queue: [{ uid: 'kuwo:1', source: 'kuwo', songid: '1', title: 'T', artist: 'A', album: '', cover: null, quality: null, qualityLabel: null, keyword: 'T', displayIndex: 1 }],
	currentTime: 42.5,
	shuffle: false,
	repeatMode: 'off',
	upNextAnchorUid: 'kuwo:1',
	updatedAt: 1_700_000_000_000
};

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
		// quick-261118-xdresume: a VALID player blob in the cleaner's canonical (serializePlayerState)
		// field order — it now travels (35-D-02 superseded for player state, 2026-11-18).
		'openmusic:player:v1': JSON.stringify(PLAYER_BLOB),
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
	// quick-261118-xdresume: 5 exact keys now — the player state joined (35-D-02 superseded for
	// player state, 2026-11-18).
	it('carries exactly the exact keys (player included) plus every name-tr key in the store', () => {
		const store = seed();
		const got = Object.keys(buildEnvelope(readerFor(store), Object.keys(store)).keys).sort();
		expect(got).toEqual(
			[LIBRARY_KEY, HISTORY_KEY, SEARCH_HISTORY_KEY, SETTINGS_KEY, PLAYER_KEY, 'openmusic:name-tr:v2:en', 'openmusic:name-tr:v2:zh-Hant'].sort()
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

	it('PLAYER_KEY is pinned to the player store\'s STATE_KEY (quick-261118-xdresume)', () => {
		expect(PLAYER_KEY).toBe(STATE_KEY);
		expect(PLAYER_KEY).toBe('openmusic:player:v1');
	});

	// 35-D-02 was SUPERSEDED for player state on 2026-11-18 (Hector, quick-261118-xdresume): the
	// player key now travels; the diag token (a secret) still never does.
	it('BACKUP_EXACT_KEYS includes the player state (35-D-02 superseded) but never the diag upload token', () => {
		expect(BACKUP_EXACT_KEYS).toContain('openmusic:player:v1');
		expect(BACKUP_EXACT_KEYS).not.toContain('openmusic:diag:v1');
		expect([...BACKUP_EXACT_KEYS].sort()).toEqual(
			[LIBRARY_KEY, HISTORY_KEY, SEARCH_HISTORY_KEY, SETTINGS_KEY, PLAYER_KEY].sort()
		);
	});

	it('an envelope built over a full store carries the player state but no diag / blob-uri / cover-cache key', () => {
		const store = seed();
		const env = buildEnvelope(readerFor(store), Object.keys(store));
		const got = Object.keys(env.keys);
		expect(got).toContain('openmusic:player:v1');
		expect(env.keys['openmusic:player:v1']).toEqual(PLAYER_BLOB);
		expect(got).not.toContain('openmusic:diag:v1');
		expect(got).not.toContain('openmusic:cover-cache:v1');
		expect(got.some((k) => k.startsWith('openmusic-blob-uri:'))).toBe(false);
	});

	it('an unrecognisable local player blob is SKIPPED, never aborting the export', () => {
		const store = { ...seed(), 'openmusic:player:v1': JSON.stringify({ v: 1, current: { uid: 'kuwo:1' } }) };
		const env = buildEnvelope(readerFor(store), Object.keys(store));
		expect('openmusic:player:v1' in env.keys).toBe(false);
		expect(LIBRARY_KEY in env.keys).toBe(true);
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

	// quick-261118-xdresume: 35-D-02 superseded for player state (2026-11-18) — a player key in a
	// file is now RESTORED (cleaned), and an unknown version of it is refused per-key + named.
	it('a valid player-state key inside a file is accepted verbatim', () => {
		const res = validateEnvelope(okEnvelope({ 'openmusic:player:v1': PLAYER_BLOB }));
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.envelope.keys['openmusic:player:v1']).toEqual(PLAYER_BLOB);
			expect(res.skipped).toEqual([]);
		}
	});

	it('a dirty player payload is CLEANED: data: cover dropped, volatile fields stripped, queue capped', () => {
		const dirtyTrack = (i: number) => ({
			uid: `kuwo:${i}`,
			title: `T${i}`,
			cover: 'data:image/jpeg;base64,AAAA',
			audioUrl: 'https://cdn/x.mp3',
			lrc: '[00:01]la',
			lrcUrl: 'https://l',
			detailsLoaded: true,
			proxyUrl: 'blob:abc',
			songMid: 'zzz'
		});
		const dirty = {
			v: 1,
			current: dirtyTrack(0),
			queue: Array.from({ length: PLAYER_QUEUE_CAP + 20 }, (_, i) => dirtyTrack(i)),
			currentTime: 3,
			shuffle: true,
			repeatMode: 'one',
			upNextAnchorUid: 'kuwo:0',
			updatedAt: 5,
			junk: { nested: true }
		};
		const res = validateEnvelope(okEnvelope({ 'openmusic:player:v1': dirty }));
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const got = res.envelope.keys['openmusic:player:v1'] as Record<string, unknown>;
		expect(Object.keys(got)).toEqual(['v', 'current', 'queue', 'currentTime', 'shuffle', 'repeatMode', 'upNextAnchorUid', 'updatedAt']);
		expect(got.current).toEqual({ uid: 'kuwo:0', title: 'T0', cover: null });
		const queue = got.queue as Record<string, unknown>[];
		expect(queue).toHaveLength(PLAYER_QUEUE_CAP);
		expect(queue[0]).toEqual({ uid: 'kuwo:0', title: 'T0', cover: null });
		for (const t of queue) {
			for (const f of ['audioUrl', 'lrc', 'lrcUrl', 'detailsLoaded', 'proxyUrl', 'songMid']) expect(f in t).toBe(false);
		}
	});

	it('the queue cap keeps a current that sits beyond the cap', () => {
		const q = Array.from({ length: 900 }, (_, i) => ({ uid: `kuwo:${i}` }));
		const got = cleanPlayerPayload({ v: 1, current: { uid: 'kuwo:800' }, queue: q, currentTime: 0, shuffle: false, repeatMode: 'off' });
		const queue = (got as Record<string, unknown>).queue as { uid: string }[];
		expect(queue).toHaveLength(PLAYER_QUEUE_CAP);
		expect(queue.some((t) => t.uid === 'kuwo:800')).toBe(true);
		expect(queue[queue.length - 1].uid).toBe('kuwo:899');
	});

	it('a legacy player blob (no upNextAnchorUid / updatedAt, tri-state repeat) is accepted with defaults', () => {
		const got = cleanPlayerPayload({ v: 1, current: { uid: 'qq:1' }, queue: [], currentTime: 0, shuffle: false, repeatMode: 'all' });
		expect(got).toEqual({ v: 1, current: { uid: 'qq:1' }, queue: [], currentTime: 0, shuffle: false, repeatMode: 'off', upNextAnchorUid: null, updatedAt: 0 });
	});

	it('a malformed player payload damages the whole file (35-D-10 atomicity, like every exact key)', () => {
		for (const bad of [
			{ v: 2, current: null, queue: [], currentTime: 0, shuffle: false, repeatMode: 'off' },
			{ v: 1, current: { title: 'no uid' }, queue: [], currentTime: 0, shuffle: false, repeatMode: 'off' },
			{ v: 1, current: null, queue: 'nope', currentTime: 0, shuffle: false, repeatMode: 'off' },
			{ v: 1, current: null, queue: [5], currentTime: 0, shuffle: false, repeatMode: 'off' },
			{ v: 1, current: null, queue: [], currentTime: -1, shuffle: false, repeatMode: 'off' },
			{ v: 1, current: null, queue: [], currentTime: 0, shuffle: 'yes', repeatMode: 'off' },
			{ v: 1, current: null, queue: [], currentTime: 0, shuffle: false, repeatMode: 'loop' },
			{ v: 1, current: null, queue: [], currentTime: 0, shuffle: false, repeatMode: 'off', upNextAnchorUid: 7 },
			{ v: 1, current: null, queue: [], currentTime: 0, shuffle: false, repeatMode: 'off', updatedAt: -5 },
			[]
		]) {
			expect(validateEnvelope(okEnvelope({ 'openmusic:player:v1': bad }))).toEqual({ ok: false, reason: 'damaged' });
		}
	});

	it('an unknown-version player key is refused per-key and named, like every other domain', () => {
		const res = validateEnvelope(okEnvelope({ 'openmusic:player:v2': PLAYER_BLOB }));
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.skipped).toEqual(['openmusic:player:v2']);
			expect('openmusic:player:v2' in res.envelope.keys).toBe(false);
			expect('openmusic:player:v1' in res.envelope.keys).toBe(false);
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

// ---------------------------------------------------------------------------------------------
// Apply / undo (35-D-08, 35-D-09, 35-D-10). Two in-memory Storage objects, passed as ARGUMENTS —
// the stub shape is settings-persist.svelte.test.ts:11-22 verbatim, with no vi.stubGlobal because
// nothing under test reaches for a global.
// ---------------------------------------------------------------------------------------------

/** `failSetItemOn: 2` throws on the SECOND setItem only, so a rollback write still succeeds. */
function makeStore(entries: Record<string, string> = {}, opts: { failSetItemOn?: number; failEverySetItem?: boolean } = {}) {
	const map = new Map<string, string>(Object.entries(entries));
	let writes = 0;
	const store: Storage = {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
		key: (i: number) => Array.from(map.keys())[i] ?? null,
		removeItem: (k: string) => void map.delete(k),
		setItem: (k: string, v: string) => {
			writes++;
			if (opts.failEverySetItem || writes === opts.failSetItemOn) throw new Error('QuotaExceededError');
			map.set(k, String(v));
		}
	};
	return { map, store };
}

/** A backup that came from ANOTHER device — deliberately disjoint from `seed()`. */
function importedEnvelope(): BackupEnvelope {
	const source: Record<string, string> = {
		[LIBRARY_KEY]: JSON.stringify({ liked: [{ uid: 'qq:9' }], playlists: [], downloads: [], favArtists: [] }),
		[HISTORY_KEY]: JSON.stringify([]),
		[SEARCH_HISTORY_KEY]: JSON.stringify([{ query: 'imported', ts: 2 }]),
		[SETTINGS_KEY]: JSON.stringify({ appLang: 'en' }),
		'openmusic:name-tr:v2:fr': JSON.stringify({ Foo: 'Fou' })
	};
	return buildEnvelope(readerFor(source), Object.keys(source), new Date('2026-09-13T00:00:00Z'));
}

function liveSeed(): Record<string, string> {
	return { ...seed(), 'openmusic:name-tr:v2:ja': JSON.stringify({ Foo: 'フー' }) };
}

describe('atomic', () => {
	it('writes NOTHING when the snapshot cannot be stored (35-D-09: no safety net, no import)', () => {
		const live = makeStore(liveSeed());
		const undo = makeStore({}, { failEverySetItem: true });
		const before = Object.fromEntries(live.map);
		expect(applyEnvelope(importedEnvelope(), live.store, undo.store)).toBe('no-snapshot');
		expect(Object.fromEntries(live.map)).toEqual(before);
	});

	it('REPLACES the 35-D-01 families and leaves every other key untouched', () => {
		const live = makeStore(liveSeed());
		const undo = makeStore();
		const before = Object.fromEntries(live.map);
		expect(applyEnvelope(importedEnvelope(), live.store, undo.store)).toBe('ok');
		expect(live.map.get(LIBRARY_KEY)).toBe(JSON.stringify({ liked: [{ uid: 'qq:9' }], playlists: [], downloads: [], favArtists: [] }));
		expect(live.map.get('openmusic:name-tr:v2:fr')).toBe(JSON.stringify({ Foo: 'Fou' }));
		// Replace, not merge: name-tr languages absent from the file are gone.
		expect(live.map.has('openmusic:name-tr:v2:ja')).toBe(false);
		expect(live.map.has('openmusic:name-tr:v2:zh-Hant')).toBe(false);
		// quick-261118-xdresume: the player key is now a 35-D-01 family — a file WITHOUT one
		// replaces (clears) it, exactly like a missing name-tr language above.
		expect(live.map.has('openmusic:player:v1')).toBe(false);
		for (const untouched of ['openmusic:cover-cache:v1', 'openmusic:diag:v1', 'openmusic-blob-uri:kuwo:1']) {
			expect(live.map.get(untouched)).toBe(before[untouched]);
		}
	});

	it('restores the snapshot and keeps it when a write fails midway', () => {
		const live = makeStore(liveSeed(), { failSetItemOn: 2 });
		const undo = makeStore();
		const before = Object.fromEntries(live.map);
		expect(applyEnvelope(importedEnvelope(), live.store, undo.store)).toBe('write-failed');
		expect(Object.fromEntries(live.map)).toEqual(before);
		expect(undo.store.getItem(UNDO_KEY)).not.toBeNull();
	});

	it('stores the snapshot in the SAME envelope shape an export produces (35-D-09: no second serializer)', () => {
		const live = makeStore(liveSeed());
		const undo = makeStore();
		const before = Object.fromEntries(live.map);
		expect(applyEnvelope(importedEnvelope(), live.store, undo.store)).toBe('ok');
		const snapshot = validateEnvelope(undo.store.getItem(UNDO_KEY) as string);
		expect(snapshot.ok).toBe(true);
		if (snapshot.ok) {
			expect(snapshot.envelope.keys[LIBRARY_KEY]).toEqual(JSON.parse(before[LIBRARY_KEY]));
			expect(snapshot.envelope.keys['openmusic:name-tr:v2:ja']).toEqual(JSON.parse(before['openmusic:name-tr:v2:ja']));
			// quick-261118-xdresume: the player state is in the snapshot now, so Undo restores it.
			expect(snapshot.envelope.keys['openmusic:player:v1']).toEqual(JSON.parse(before['openmusic:player:v1']));
		}
	});
});

describe('undo', () => {
	it('reports a snapshot only once one exists', () => {
		const live = makeStore(liveSeed());
		const undo = makeStore();
		expect(hasUndoSnapshot(undo.store)).toBe(false);
		applyEnvelope(importedEnvelope(), live.store, undo.store);
		expect(hasUndoSnapshot(undo.store)).toBe(true);
	});

	it('restores the pre-import bytes and clears the snapshot', () => {
		const live = makeStore(liveSeed());
		const undo = makeStore();
		const before = Object.fromEntries(live.map);
		applyEnvelope(importedEnvelope(), live.store, undo.store);
		expect(undoImport(live.store, undo.store)).toBe('ok');
		expect(Object.fromEntries(live.map)).toEqual(before);
		expect(undo.store.getItem(UNDO_KEY)).toBeNull();
	});

	it('is a no-op when no snapshot was ever taken', () => {
		const live = makeStore(liveSeed());
		const before = Object.fromEntries(live.map);
		expect(undoImport(live.store, makeStore().store)).toBe('no-snapshot');
		expect(Object.fromEntries(live.map)).toEqual(before);
	});

	it('discards an unreadable snapshot instead of writing garbage back', () => {
		const live = makeStore(liveSeed());
		const undo = makeStore({ [UNDO_KEY]: 'garbage' });
		const before = Object.fromEntries(live.map);
		expect(undoImport(live.store, undo.store)).toBe('no-snapshot');
		expect(Object.fromEntries(live.map)).toEqual(before);
		expect(undo.store.getItem(UNDO_KEY)).toBeNull();
	});
});

// Type-level pin: the exported envelope interface is what plans 03/04 import.
const _shape: BackupEnvelope = { app: BACKUP_MAGIC, format: BACKUP_FORMAT, exportedAt: '', keys: {} };
describe('envelope contract', () => {
	it('exposes the BackupEnvelope interface downstream plans import', () => {
		expect(_shape.app).toBe(BACKUP_MAGIC);
	});
});

// quick-261020-slimsync: the library payload was 1.7MB (lrc lyrics text = 75% of it) and
// 504'd ~1 in 3 sync pushes over a marginal uplink. Sync keeps identity+display only.
describe('slimTrackForSync', () => {
	const full = {
		uid: 'kuwo:9',
		source: 'kuwo',
		songid: '9',
		title: '晴天',
		artist: '周杰倫',
		album: '葉惠美',
		cover: 'https://x/y.jpg',
		quality: '320k',
		duration: 240,
		songMid: 'MID-9',
		lrc: '[00:01]...lyrics...',
		lrcUrl: 'https://x/lrc',
		audioUrl: 'https://x/a.mp3',
		proxyUrl: 'https://openmusic.lol/api/x',
		keyword: '晴天 周杰倫',
		detailsLoaded: true,
		qualityLabel: 'HQ',
		displayIndex: 3
	};
	it('keeps identity + display fields + resolve extras', () => {
		expect(slimTrackForSync(full)).toEqual({
			uid: 'kuwo:9',
			source: 'kuwo',
			songid: '9',
			title: '晴天',
			artist: '周杰倫',
			album: '葉惠美',
			cover: 'https://x/y.jpg',
			quality: '320k',
			duration: 240,
			songMid: 'MID-9'
		});
	});
	it('drops lrc text, ephemeral urls and derivable fields', () => {
		const slim = slimTrackForSync(full) as Record<string, unknown>;
		for (const f of ['lrc', 'lrcUrl', 'audioUrl', 'proxyUrl', 'keyword', 'detailsLoaded', 'qualityLabel', 'displayIndex']) {
			expect(slim[f]).toBeUndefined();
		}
	});
	it('passes non-objects through untouched', () => {
		expect(slimTrackForSync(null)).toBeNull();
		expect(slimTrackForSync('x')).toBe('x');
	});
});

describe('slimLibraryForSync', () => {
	it('slims liked and nested playlist tracks, strips device-local downloads+unavailable', () => {
		const t = { uid: 'kuwo:9', title: '晴天', lrc: 'lyrics', audioUrl: 'https://x' };
		const lib = {
			liked: [t],
			downloads: [t],
			playlists: [{ name: 'p', tracks: [t] }],
			favArtists: ['周杰倫'],
			unavailable: ['kuwo:9'],
			deleted: ['u:kuwo:1']
		};
		const out = slimLibraryForSync(lib, true) as Record<string, any>;
		expect(out.liked[0]).toEqual({ uid: 'kuwo:9', title: '晴天' });
		// quick-261023-syncmerge: downloads describe this device's files — they never travel in sync.
		expect('downloads' in out).toBe(false);
		expect('unavailable' in out).toBe(false);
		expect(out.playlists[0].tracks[0]).toEqual({ uid: 'kuwo:9', title: '晴天' });
		expect(out.favArtists).toEqual(['周杰倫']);
		// ...but the tombstone set MUST travel, or deletes stop propagating.
		expect(out.deleted).toEqual(['u:kuwo:1']);
	});
	it('keeps downloads by default (manual backups + the 35-D-09 undo snapshot stay faithful)', () => {
		const lib = { liked: [], downloads: [{ uid: 'kuwo:9', title: '晴天' }], unavailable: ['kuwo:9'] };
		const out = slimLibraryForSync(lib) as Record<string, any>;
		expect(out.downloads).toEqual([{ uid: 'kuwo:9', title: '晴天' }]);
		expect(out.unavailable).toEqual(['kuwo:9']);
		const read = (k: string) => (k === LIBRARY_KEY ? JSON.stringify(lib) : null);
		const env = buildEnvelope(read, [LIBRARY_KEY], new Date(), { stripDeviceLocal: true });
		expect('downloads' in (env.keys[LIBRARY_KEY] as Record<string, unknown>)).toBe(false);
	});
	it('buildEnvelope slims the library key on export', () => {
		const lib = { liked: [{ uid: 'kuwo:9', title: '晴天', lrc: 'lyrics' }], downloads: [] };
		const read = (k: string) => (k === LIBRARY_KEY ? JSON.stringify(lib) : null);
		const env = buildEnvelope(read, [LIBRARY_KEY]);
		const out = (env.keys[LIBRARY_KEY] as any).liked[0];
		expect(out.lrc).toBeUndefined();
		expect(out.title).toBe('晴天');
	});
});

describe('validateSyncKey library deleted (quick-261023-syncmerge)', () => {
	it('accepts an absent or string-array deleted', () => {
		expect(validateSyncKey(LIBRARY_KEY, { liked: [] })).toBe(true);
		expect(validateSyncKey(LIBRARY_KEY, { liked: [], deleted: ['u:a', 'f:b'] })).toBe(true);
	});
	it('refuses non-string tombstones', () => {
		expect(validateSyncKey(LIBRARY_KEY, { liked: [], deleted: ['u:a', 5] })).toBe(false);
		expect(validateSyncKey(LIBRARY_KEY, { liked: [], deleted: 'u:a' })).toBe(false);
	});
});
