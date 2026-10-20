// Cross-device sync engine (quick-261020-acct) — browser-guarded, never-throw.
//
// The server stores ONE backup envelope per user (PUT/GET /api/me/sync); this engine keeps
// the local copy and the server copy converged with LAST-WRITE-WINS by server `updatedAt`:
//   - local differs from the last synced hash → PUSH the local envelope (a change here is
//     the newest write by definition — it just happened);
//   - local is clean and the server is ahead of our meta → validate + applyEnvelope +
//     location.reload() (35-D-13: every store re-runs load() cold; never a live re-hydrate);
//   - server has nothing → PUSH the local envelope as the baseline.
// Only the backup key set travels (BACKUP_EXACT_KEYS + the name-tr prefix family — exactly
// what buildEnvelope reads), and the change hash covers exactly that set, so a cover-cache
// write can never trigger a sync.
//
// The engine knows NOTHING about the auth store: the store injects `SyncHooks` (an authed
// fetch, a signed-in probe, and two status sinks). That keeps the dependency one-way
// (auth → sync) and the engine's decision helpers below pure + node-testable.
//
// Anonymous users NEVER sync: every entry point checks hooks.isSignedIn() first, and the
// store only starts the engine after a user is known.

import { browser } from '$app/environment';
import {
	BACKUP_EXACT_KEYS,
	NAME_TR_PREFIX,
	applyEnvelope,
	buildEnvelope,
	storageKeys,
	validateEnvelope,
	type BackupEnvelope
} from '$lib/backup/backup-logic';

/** localStorage key for the sync bookkeeping: { updatedAt: server ms, hash: last synced }. */
export const SYNC_META_KEY = 'openmusic:sync:v1';

/** Background convergence cadence while the app is open. */
export const SYNC_INTERVAL_MS = 30_000;

/** What the auth store renders (Settings → Account). The engine is the only writer. */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface SyncMeta {
	/** Server `updatedAt` (epoch ms) of the envelope we last pushed or pulled. 0 = none yet. */
	updatedAt: number;
	/** hashSyncedKeys() of the local synced key set at that moment. */
	hash: string;
}

/** Injected seams — the auth store supplies these; tests supply fakes. */
export interface SyncHooks {
	/** apiFetch through the api-base seam, credentials + native bearer already applied. */
	request(path: string, init?: RequestInit): Promise<Response>;
	/** Anonymous users never sync — every engine entry point checks this first. */
	isSignedIn(): boolean;
	setStatus(status: SyncStatus): void;
	setLastSyncedAt(at: number | null): void;
}

/** cyrb53 — a fast non-cryptographic string hash. Change DETECTION only (never a security
 *  boundary): two different local states colliding is a missed push, not a breach. */
function cyrb53(str: string, seed = 0): string {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * PURE: hash of exactly the key set that syncs — the four exact keys + the name-tr prefix
 * family present in `allKeys`. `read` is injected (the engine passes a localStorage
 * getItem closure, the tests pass a Map lookup), mirroring buildEnvelope's seam.
 */
export function hashSyncedKeys(read: (k: string) => string | null, allKeys: readonly string[]): string {
	const wanted = [...BACKUP_EXACT_KEYS, ...allKeys.filter((k) => k.startsWith(NAME_TR_PREFIX))];
	let acc = '';
	for (const k of wanted) acc += `${k}=${read(k) ?? ''}\n`;
	return cyrb53(acc);
}

/** PURE-ish read of the sync meta; absent / corrupt → null (treated as "never synced"). */
export function readSyncMeta(store: Pick<Storage, 'getItem'>): SyncMeta | null {
	try {
		const raw = store.getItem(SYNC_META_KEY);
		if (!raw) return null;
		const v = JSON.parse(raw) as Partial<SyncMeta>;
		if (typeof v.updatedAt !== 'number' || typeof v.hash !== 'string') return null;
		return { updatedAt: v.updatedAt, hash: v.hash };
	} catch {
		return null;
	}
}

/** Write the sync meta. Best-effort — a quota failure just re-syncs next tick. */
export function writeSyncMeta(store: Pick<Storage, 'setItem'>, meta: SyncMeta): void {
	try {
		store.setItem(SYNC_META_KEY, JSON.stringify(meta));
	} catch {
		/* quota — the next tick re-detects the drift and retries */
	}
}

function localRead(k: string): string | null {
	try {
		return localStorage.getItem(k);
	} catch {
		return null;
	}
}

function localHash(): string {
	return hashSyncedKeys(localRead, storageKeys(localStorage));
}

function localEnvelope(): BackupEnvelope {
	return buildEnvelope(localRead, storageKeys(localStorage));
}

/** PUSH the local envelope; on success the meta is re-anchored to the server's updatedAt. */
async function pushNow(hooks: SyncHooks, hash: string, keepalive = false): Promise<boolean> {
	hooks.setStatus('syncing');
	try {
		const res = await hooks.request('/api/me/sync', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ envelope: localEnvelope() }),
			keepalive
		});
		if (!res.ok) {
			hooks.setStatus('error');
			return false;
		}
		const body = (await res.json().catch(() => null)) as { updatedAt?: number } | null;
		writeSyncMeta(localStorage, { updatedAt: body?.updatedAt ?? Date.now(), hash });
		hooks.setStatus('synced');
		hooks.setLastSyncedAt(Date.now());
		return true;
	} catch {
		hooks.setStatus('error');
		return false;
	}
}

/**
 * One convergence pass (see the header for the decision table). Never throws; failures land
 * on the 'error' status and the next tick (or "Sync now") retries.
 */
export async function syncOnce(hooks: SyncHooks): Promise<void> {
	if (!browser || !hooks.isSignedIn()) return;
	const hash = localHash();
	const meta = readSyncMeta(localStorage) ?? { updatedAt: 0, hash: '' };

	// Local moved since the last sync → this device holds the newest write.
	if (hash !== meta.hash) {
		await pushNow(hooks, hash);
		return;
	}

	// Local is clean → ask the server whether another device is ahead.
	let body: { envelope: unknown; updatedAt: number | null } | null = null;
	try {
		const res = await hooks.request('/api/me/sync');
		if (!res.ok) {
			hooks.setStatus('error');
			return;
		}
		body = (await res.json().catch(() => null)) as { envelope: unknown; updatedAt: number | null } | null;
	} catch {
		hooks.setStatus('error');
		return;
	}
	if (!body) {
		hooks.setStatus('error');
		return;
	}
	if (body.envelope == null) {
		// Signed in but the server has never seen this account → baseline push.
		await pushNow(hooks, hash);
		return;
	}
	const serverAt = body.updatedAt ?? 0;
	if (serverAt > meta.updatedAt) {
		// Another device is ahead. Validate through the ONE validator before any byte of it
		// reaches localStorage (the server validates too — defence in depth, not trust).
		const verdict = validateEnvelope(JSON.stringify(body.envelope));
		if (!verdict.ok) {
			hooks.setStatus('error');
			return;
		}
		hooks.setStatus('syncing');
		let applied: ReturnType<typeof applyEnvelope>;
		try {
			applied = applyEnvelope(verdict.envelope, localStorage, sessionStorage);
		} catch {
			hooks.setStatus('error');
			return;
		}
		if (applied !== 'ok') {
			hooks.setStatus('error');
			return;
		}
		// Anchor the meta to the PULLED state BEFORE the reload, or the post-reload tick
		// would see server > meta and apply the same envelope forever.
		writeSyncMeta(localStorage, { updatedAt: serverAt, hash: localHash() });
		hooks.setLastSyncedAt(Date.now());
		hooks.setStatus('synced');
		// 35-D-13: a FULL reload so every store re-runs load() on a cold path.
		location.reload();
		return;
	}
	hooks.setStatus('synced');
	hooks.setLastSyncedAt(Date.now());
}

/**
 * Start the background engine: an immediate pass, then every SYNC_INTERVAL_MS, on
 * visibilitychange→visible, and a keepalive push on beforeunload when the local state is
 * dirty (so closing the tab cannot strand a change the interval had not reached yet).
 * Returns the engine handle; stop() removes every listener and the timer.
 */
export function startSyncEngine(hooks: SyncHooks): { stop: () => void; syncNow: () => Promise<void> } {
	if (!browser) return { stop: () => {}, syncNow: async () => {} };
	let stopped = false;
	let running = false;

	const tick = async (): Promise<void> => {
		if (stopped || running || !hooks.isSignedIn()) return;
		running = true;
		try {
			await syncOnce(hooks);
		} catch {
			hooks.setStatus('error');
		} finally {
			running = false;
		}
	};

	const onVisibility = () => {
		if (document.visibilityState === 'visible') void tick();
	};
	const onBeforeUnload = () => {
		// Fire-and-forget by necessity (the page is going away): push only when dirty, and
		// with keepalive so the request outlives the unload.
		if (!hooks.isSignedIn()) return;
		const meta = readSyncMeta(localStorage);
		const hash = localHash();
		if (meta && hash === meta.hash) return;
		void pushNow(hooks, hash, true);
	};

	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('beforeunload', onBeforeUnload);
	const timer = setInterval(() => void tick(), SYNC_INTERVAL_MS);
	void tick();

	return {
		stop: () => {
			stopped = true;
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('beforeunload', onBeforeUnload);
		},
		syncNow: tick
	};
}
