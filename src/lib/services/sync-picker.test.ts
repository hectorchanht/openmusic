// quick-261020-sync: the sync-item picker — the engine filters push AND pull by
// settings.syncItems (SYNC_DEFAULTS in $lib/config/defaults), never the whole envelope.
// These pin: key selection per family, envelope filtering in both directions, the
// selection read-through (missing / corrupt / tampered blobs), and the dirty hash
// counting a pure toggle (so the push carrying the new selection always fires).
import { describe, expect, it } from 'vitest';
import { LIBRARY_KEY, NAME_TR_PREFIX, PLAYER_KEY, SETTINGS_KEY, type BackupEnvelope } from '$lib/backup/backup-logic';
import { HISTORY_KEY } from '$lib/history/history-logic';
import { SEARCH_HISTORY_KEY } from '$lib/search/search-history-logic';
import { SYNC_DEFAULTS, type SyncItems } from '$lib/config/defaults';
import {
	diffSyncKeys,
	filterEnvelopeKeys,
	hashEachKey,
	hashSyncedKeys,
	keepDeselectedPlayer,
	readSyncItems,
	selectedWantedKeys
} from './sync';

/** quick-261118-xdresume: a valid player payload (35-D-02 superseded for player state). */
const PLAYER = {
	v: 1,
	current: { uid: 'kuwo:1' },
	queue: [{ uid: 'kuwo:1' }],
	currentTime: 10,
	shuffle: false,
	repeatMode: 'off',
	upNextAnchorUid: null,
	updatedAt: 100
};

const ALL_ON: SyncItems = { ...SYNC_DEFAULTS.items };

function mapStore(initial: Record<string, string> = {}) {
	const m = new Map(Object.entries(initial));
	return { m, read: (k: string): string | null => m.get(k) ?? null };
}

function envelopeWithAll(): BackupEnvelope {
	const keys: Record<string, unknown> = {
		[SETTINGS_KEY]: { theme: 'dark' },
		[LIBRARY_KEY]: { liked: [] },
		[HISTORY_KEY]: [],
		[SEARCH_HISTORY_KEY]: [],
		[`${NAME_TR_PREFIX}1:zh-Hant`]: { A: '甲' },
		[`${NAME_TR_PREFIX}1:en`]: { A: 'A' },
		[PLAYER_KEY]: PLAYER, // quick-261118-xdresume: the player family travels now
		'openmusic:diag:v1': 'secret' // foreign key — must never leak through
	};
	return { app: 'openmusic-backup', format: 1, exportedAt: '2026-10-20T00:00:00.000Z', keys };
}

describe('selectedWantedKeys', () => {
	it('selects the four exact keys plus the name-tr family when everything is on', () => {
		const keys = ['openmusic:cover-cache:v1', `${NAME_TR_PREFIX}1:zh-Hant`, `${NAME_TR_PREFIX}1:en`];
		const got = selectedWantedKeys(ALL_ON, keys);
		expect(got).toContain(SETTINGS_KEY);
		expect(got).toContain(LIBRARY_KEY);
		expect(got).toContain(HISTORY_KEY);
		expect(got).toContain(SEARCH_HISTORY_KEY);
		expect(got).toContain(`${NAME_TR_PREFIX}1:zh-Hant`);
		expect(got).toContain(`${NAME_TR_PREFIX}1:en`);
		expect(got).toContain(PLAYER_KEY);
		expect(got).not.toContain('openmusic:cover-cache:v1');
	});

	it('the player family maps to exactly PLAYER_KEY (quick-261118-xdresume)', () => {
		expect(selectedWantedKeys({ ...ALL_ON, player: false }, [])).not.toContain(PLAYER_KEY);
		expect(
			selectedWantedKeys({ settings: false, library: false, history: false, searchHistory: false, nameTr: false, player: true }, [])
		).toEqual([PLAYER_KEY]);
	});

	it('drops exactly the deselected families', () => {
		const keys = [`${NAME_TR_PREFIX}1:zh-Hant`];
		const got = selectedWantedKeys({ ...ALL_ON, library: false, nameTr: false }, keys);
		expect(got).toContain(SETTINGS_KEY);
		expect(got).not.toContain(LIBRARY_KEY);
		expect(got).not.toContain(`${NAME_TR_PREFIX}1:zh-Hant`);
	});

	it('an empty selection selects nothing', () => {
		expect(
			selectedWantedKeys({ settings: false, library: false, history: false, searchHistory: false, nameTr: false, player: false }, ['a'])
		).toEqual([]);
	});
});

describe('readSyncItems', () => {
	it('a missing settings blob → all on (pre-picker installs)', () => {
		expect(readSyncItems(() => null)).toEqual(ALL_ON);
	});

	it('a corrupt blob → all on, never throws', () => {
		expect(readSyncItems(() => '{not json')).toEqual(ALL_ON);
	});

	it('honours persisted booleans per key and falls back per key on tampering', () => {
		const blob = JSON.stringify({
			syncItems: { settings: false, library: true, history: 'yes', searchHistory: 0, nameTr: null, extra: true }
		});
		// quick-261118-xdresume: an absent `player` member (every pre-resume blob) → default ON.
		expect(readSyncItems(() => blob)).toEqual({ settings: false, library: true, history: true, searchHistory: true, nameTr: true, player: true });
	});

	it('honours a persisted player:false and defaults a tampered player to ON', () => {
		expect(readSyncItems(() => JSON.stringify({ syncItems: { player: false } })).player).toBe(false);
		expect(readSyncItems(() => JSON.stringify({ syncItems: { player: 'no' } })).player).toBe(true);
	});

	it('a non-object syncItems → all on', () => {
		expect(readSyncItems(() => JSON.stringify({ syncItems: ['settings'] }))).toEqual(ALL_ON);
	});
});

describe('filterEnvelopeKeys', () => {
	it('keeps the envelope intact when everything is on, minus foreign keys', () => {
		const got = filterEnvelopeKeys(envelopeWithAll(), ALL_ON);
		expect(got.app).toBe('openmusic-backup');
		expect(got.keys[SETTINGS_KEY]).toBeDefined();
		expect(got.keys[LIBRARY_KEY]).toBeDefined();
		expect(got.keys[`${NAME_TR_PREFIX}1:zh-Hant`]).toBeDefined();
		expect(got.keys[PLAYER_KEY]).toEqual(PLAYER);
		expect(got.keys['openmusic:diag:v1']).toBeUndefined();
	});

	it('player OFF drops the player key; every other family stays (quick-261118-xdresume)', () => {
		const got = filterEnvelopeKeys(envelopeWithAll(), { ...ALL_ON, player: false });
		expect(got.keys[PLAYER_KEY]).toBeUndefined();
		expect(got.keys[SETTINGS_KEY]).toBeDefined();
		expect(got.keys[LIBRARY_KEY]).toBeDefined();
	});

	it('drops deselected families (the push side: the cloud copy becomes exactly the selection)', () => {
		const got = filterEnvelopeKeys(envelopeWithAll(), { ...ALL_ON, library: false, nameTr: false });
		expect(got.keys[LIBRARY_KEY]).toBeUndefined();
		expect(got.keys[`${NAME_TR_PREFIX}1:zh-Hant`]).toBeUndefined();
		expect(got.keys[`${NAME_TR_PREFIX}1:en`]).toBeUndefined();
		expect(got.keys[SETTINGS_KEY]).toBeDefined();
		expect(got.keys[HISTORY_KEY]).toBeDefined();
		expect(got.keys[SEARCH_HISTORY_KEY]).toBeDefined();
	});
});

describe('player family through the incremental push (quick-261118-xdresume)', () => {
	it('a new player key is pushed; deselecting it pushes a null tombstone; no special-casing', () => {
		// Baseline: everything but the player has synced before (the meta predates the family).
		const on = filterEnvelopeKeys(envelopeWithAll(), ALL_ON).keys as Record<string, unknown>;
		const withoutPlayer = { ...on };
		delete withoutPlayer[PLAYER_KEY];
		const meta = { updatedAt: 1, hashes: hashEachKey(withoutPlayer) };
		expect(diffSyncKeys(on, hashEachKey(on), meta)).toEqual({ [PLAYER_KEY]: PLAYER });

		// Synced with the player → clean.
		const synced = { updatedAt: 2, hashes: hashEachKey(on) };
		expect(diffSyncKeys(on, hashEachKey(on), synced)).toBeNull();

		// A position change dirties only the player key.
		const moved = { ...on, [PLAYER_KEY]: { ...PLAYER, currentTime: 99, updatedAt: 200 } };
		expect(Object.keys(diffSyncKeys(moved, hashEachKey(moved), synced) ?? {})).toEqual([PLAYER_KEY]);

		// Picker OFF → the filtered envelope lacks it → null tombstone deletes the cloud copy.
		const off = filterEnvelopeKeys(envelopeWithAll(), { ...ALL_ON, player: false }).keys as Record<string, unknown>;
		expect(diffSyncKeys(off, hashEachKey(off), synced)).toEqual({ [PLAYER_KEY]: null });
	});
});

describe('keepDeselectedPlayer (quick-261118-xdresume)', () => {
	const env = (keys: Record<string, unknown>): BackupEnvelope => ({ app: 'openmusic-backup', format: 1, exportedAt: '', keys });

	it('player selected → the envelope is untouched (a remote without it stays delete-wins)', () => {
		const e = env({ [SETTINGS_KEY]: {} });
		expect(keepDeselectedPlayer(e, ALL_ON, JSON.stringify(PLAYER))).toBe(e);
	});

	it('player DESELECTED → the local blob is carried through so the apply-wipe cannot clear it', () => {
		const got = keepDeselectedPlayer(env({ [SETTINGS_KEY]: {} }), { ...ALL_ON, player: false }, JSON.stringify(PLAYER));
		expect(got.keys[PLAYER_KEY]).toEqual(PLAYER);
		expect(got.keys[SETTINGS_KEY]).toEqual({});
	});

	it('deselected with no / corrupt local blob → untouched', () => {
		const e = env({});
		expect(keepDeselectedPlayer(e, { ...ALL_ON, player: false }, null)).toBe(e);
		expect(keepDeselectedPlayer(e, { ...ALL_ON, player: false }, '{nope')).toBe(e);
	});
});

describe('hashSyncedKeys picker', () => {
	function stateful() {
		return mapStore({ [SETTINGS_KEY]: '{"theme":"dark"}', [LIBRARY_KEY]: '{"liked":[]}' });
	}

	it('a pure toggle (no payload change) counts as dirty', () => {
		const s = stateful();
		const keys = [...s.m.keys()];
		const before = hashSyncedKeys(s.read, keys, ALL_ON);
		const after = hashSyncedKeys(s.read, keys, { ...ALL_ON, library: false });
		expect(after).not.toBe(before);
	});

	it('a change to a deselected family does not move the hash', () => {
		const s = stateful();
		const items = { ...ALL_ON, library: false };
		const before = hashSyncedKeys(s.read, [...s.m.keys()], items);
		s.m.set(LIBRARY_KEY, '{"liked":["x"]}');
		expect(hashSyncedKeys(s.read, [...s.m.keys()], items)).toBe(before);
	});

	it('a change to a selected family moves the hash', () => {
		const s = stateful();
		const before = hashSyncedKeys(s.read, [...s.m.keys()], ALL_ON);
		s.m.set(LIBRARY_KEY, '{"liked":["x"]}');
		expect(hashSyncedKeys(s.read, [...s.m.keys()], ALL_ON)).not.toBe(before);
	});
});
