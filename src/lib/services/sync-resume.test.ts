// quick-261118-xdresume — cross-device resume: the sync engine's IDLE-ONLY player application.
// (35-D-02 superseded for player state, 2026-11-18 — Hector.)
//
// Drives the real syncOnce() pull branch end-to-end over in-memory Web Storage: a server
// envelope whose (LWW-winning) player state differs from this device's must NOT be applied —
// no applyEnvelope write, no meta anchor, no reload — while SyncHooks.isPlaying() is true, and
// must apply (and reload) when idle or when the probe is absent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));
// The fold dictionary is irrelevant here (no favourite artists) — keep the node test offline.
vi.mock('$lib/services/zh-convert', () => ({
	ensureFoldReady: async () => {},
	foldScript: (s: string) => s
}));

import { PLAYER_KEY, SETTINGS_KEY, buildEnvelope, storageKeys } from '$lib/backup/backup-logic';
import {
	SYNC_META_KEY,
	filterEnvelopeKeys,
	hashEachKey,
	readSyncItems,
	readSyncMeta,
	shouldDeferPull,
	syncOnce,
	type SyncHooks,
	type SyncStatus
} from './sync';

function memStorage() {
	const m = new Map<string, string>();
	const store = {
		get length() {
			return m.size;
		},
		key: (i: number) => [...m.keys()][i] ?? null,
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, String(v)),
		removeItem: (k: string) => void m.delete(k),
		clear: () => m.clear()
	};
	return { m, store: store as unknown as Storage };
}

const player = (uid: string, updatedAt: number) => ({
	v: 1,
	current: { uid },
	queue: [{ uid }],
	currentTime: 30,
	shuffle: false,
	repeatMode: 'off',
	upNextAnchorUid: null,
	updatedAt
});

let local: ReturnType<typeof memStorage>;
let session: ReturnType<typeof memStorage>;
const reload = vi.fn();

/** Seed this device as fully synced (meta hashes == the current filtered envelope) at server t=1. */
function seedSyncedDevice(localPlayer: unknown) {
	local.store.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'dark' }));
	local.store.setItem(PLAYER_KEY, JSON.stringify(localPlayer));
	const read = (k: string) => local.store.getItem(k);
	const env = filterEnvelopeKeys(
		buildEnvelope(read, storageKeys(local.store), new Date(), { stripDeviceLocal: true }),
		readSyncItems(read)
	);
	local.store.setItem(SYNC_META_KEY, JSON.stringify({ updatedAt: 1, hashes: hashEachKey(env.keys as Record<string, unknown>) }));
}

function hooks(remotePlayer: unknown, isPlaying?: () => boolean): SyncHooks & { statuses: SyncStatus[] } {
	const statuses: SyncStatus[] = [];
	return {
		statuses,
		request: async () =>
			new Response(
				JSON.stringify({
					ok: true,
					updatedAt: 5,
					envelope: {
						app: 'openmusic-backup',
						format: 1,
						exportedAt: '',
						keys: { [SETTINGS_KEY]: { theme: 'dark' }, [PLAYER_KEY]: remotePlayer }
					}
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			),
		isSignedIn: () => true,
		setStatus: (s) => void statuses.push(s),
		setLastSyncedAt: () => {},
		isPlaying
	};
}

beforeEach(() => {
	local = memStorage();
	session = memStorage();
	reload.mockReset();
	vi.stubGlobal('localStorage', local.store);
	vi.stubGlobal('sessionStorage', session.store);
	vi.stubGlobal('location', { reload });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('syncOnce idle-only player application (quick-261118-xdresume)', () => {
	it('DEFERS the whole pull while playing when the player differs: no apply, no meta anchor, no reload', async () => {
		seedSyncedDevice(player('kuwo:local', 100));
		const before = local.store.getItem(PLAYER_KEY);
		const metaBefore = local.store.getItem(SYNC_META_KEY);
		const h = hooks(player('kuwo:remote', 200), () => true);
		await syncOnce(h);
		expect(reload).not.toHaveBeenCalled();
		expect(local.store.getItem(PLAYER_KEY)).toBe(before);
		expect(local.store.getItem(SYNC_META_KEY)).toBe(metaBefore);
		expect(h.statuses.at(-1)).toBe('synced');
		// Nothing was snapshotted either — applyEnvelope never ran.
		expect(session.m.size).toBe(0);
	});

	it('APPLIES when idle: the newer remote player lands, the meta anchors, the page reloads', async () => {
		seedSyncedDevice(player('kuwo:local', 100));
		const h = hooks(player('kuwo:remote', 200), () => false);
		await syncOnce(h);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(JSON.parse(local.store.getItem(PLAYER_KEY)!).current.uid).toBe('kuwo:remote');
		expect(readSyncMeta(local.store)?.updatedAt).toBe(5);
	});

	it('an absent isPlaying probe counts as idle and applies', async () => {
		seedSyncedDevice(player('kuwo:local', 100));
		await syncOnce(hooks(player('kuwo:remote', 200)));
		expect(reload).toHaveBeenCalledTimes(1);
		expect(JSON.parse(local.store.getItem(PLAYER_KEY)!).current.uid).toBe('kuwo:remote');
	});

	it('playing but the LWW keeps local (older remote) → nothing player-wise differs → the pull applies', async () => {
		seedSyncedDevice(player('kuwo:local', 300));
		await syncOnce(hooks(player('kuwo:remote', 200), () => true));
		expect(reload).toHaveBeenCalledTimes(1);
		expect(JSON.parse(local.store.getItem(PLAYER_KEY)!).current.uid).toBe('kuwo:local');
	});
});

describe('shouldDeferPull (pure)', () => {
	const env = (keys: Record<string, unknown>) => ({ app: 'openmusic-backup' as const, format: 1, exportedAt: '', keys });
	const localRaw = JSON.stringify(player('a', 1));

	it('no probe → never defers', () => {
		expect(shouldDeferPull(env({ [PLAYER_KEY]: player('b', 2) }), localRaw, undefined)).toBe(false);
	});

	it('differs + playing → defer; differs + idle → apply', () => {
		expect(shouldDeferPull(env({ [PLAYER_KEY]: player('b', 2) }), localRaw, () => true)).toBe(true);
		expect(shouldDeferPull(env({ [PLAYER_KEY]: player('b', 2) }), localRaw, () => false)).toBe(false);
	});

	it('a clock-only difference never defers', () => {
		expect(shouldDeferPull(env({ [PLAYER_KEY]: player('a', 99) }), localRaw, () => true)).toBe(false);
	});

	it('a delete-wins pull (merged lacks the player) differs → defers while playing', () => {
		expect(shouldDeferPull(env({}), localRaw, () => true)).toBe(true);
	});

	it('a throwing probe counts as idle', () => {
		expect(
			shouldDeferPull(env({ [PLAYER_KEY]: player('b', 2) }), localRaw, () => {
				throw new Error('x');
			})
		).toBe(false);
	});
});
