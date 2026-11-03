// Cross-device sync engine (quick-261020-acct) — browser-guarded, never-throw.
//
// The server stores ONE backup envelope per user (PUT/GET /api/me/sync); this engine keeps
// the local copy and the server copy converged:
//   - any local key differs from the meta's per-key hash → PUSH only those keys (null =
//     delete a key the client no longer carries); a change here is the newest write by
//     definition — it just happened. Clean keys never leave the device (quick-261020-incsync).
//   - local is clean and the server is ahead of our meta → quick-261023-syncmerge: MERGE
//     each present family with the local copy (union; tombstones suppress deletes) instead
//     of replacing, then validate + applyEnvelope + location.reload() (35-D-13: every store
//     re-runs load() cold; never a live re-hydrate). A family ABSENT from the remote
//     envelope is delete-wins (the picker's uncheck semantics).
//   - server has nothing → PUSH the local envelope as the baseline.
//   - quick-261023-syncmerge-review: on FIRST sign-in, when both sides hold differing data,
//     the engine stays parked until the user picks Merge / Keep this device / Use cloud in
//     the review modal (checkFirstSync/resolveFirstSync below) — never an auto-merge.
// Only the backup key set travels (BACKUP_EXACT_KEYS + the name-tr prefix family — exactly
// what buildEnvelope reads), and the change hash covers exactly that set, so a cover-cache
// write can never trigger a sync.
//
// quick-261020-sync — the sync-item PICKER: settings.syncItems (SYNC_DEFAULTS in
// $lib/config/defaults) selects which of the five families travels. The engine reads the
// selection from the settings blob through the `read` closure (never the settings runes
// singleton), filters push AND pull by it (filterEnvelopeKeys), and folds it into the
// change hash so a pure toggle counts as dirty and pushes immediately.
//
// The engine knows NOTHING about the auth store: the store injects `SyncHooks` (an authed
// fetch, a signed-in probe, and two status sinks). That keeps the dependency one-way
// (auth → sync) and the engine's decision helpers below pure + node-testable.
//
// Anonymous users NEVER sync: every entry point checks hooks.isSignedIn() first, and the
// store only starts the engine after a user is known.

import { browser } from '$app/environment';
import {
	LIBRARY_KEY,
	NAME_TR_PREFIX,
	SETTINGS_KEY,
	applyEnvelope,
	buildEnvelope,
	storageKeys,
	validateEnvelope,
	type BackupEnvelope
} from '$lib/backup/backup-logic';
// HISTORY_KEY / SEARCH_HISTORY_KEY are NOT re-exported by backup-logic — both live in
// already-pure modules the node test project imports without globals.
import { HISTORY_KEY } from '$lib/history/history-logic';
import { SEARCH_HISTORY_KEY } from '$lib/search/search-history-logic';
// quick-261020-sync: SYNC_DEFAULTS is a pure value module (defaults.ts has no runtime
// imports from any store — only type imports + pure value modules), so the engine can
// read the selection straight from the settings blob without importing the settings
// runes singleton (the node Vitest project can't compile runes).
import { SYNC_DEFAULTS, type SyncItems } from '$lib/config/defaults';
// quick-261023-syncmerge: the pull path unions instead of replacing (see merge-logic.ts).
// quick-261023-syncmerge-review: first-sign-in review gate (checkFirstSync/resolveFirstSync).
import { mergeEnvelopes, previewHasDiff, previewMerge, type SyncPreview } from '$lib/sync/merge-logic';
/** Re-exported for the auth store's review-modal state (the type lives in merge-logic). */
export type { SyncPreview } from '$lib/sync/merge-logic';

/** localStorage key for the sync bookkeeping: { updatedAt: server ms, hash: last synced }. */
export const SYNC_META_KEY = 'openmusic:sync:v1';

/**
 * Background convergence cadence while the app is open. quick-261020-syncfreq: was 30s —
 * with history dirtying on every played song that meant an upload every 30s during active
 * listening. The tick is hash-gated (clean = zero network), so this is only the *detection*
 * cadence; 5 min is plenty, and visibilitychange→hidden + beforeunload push dirty state
 * promptly when the user leaves.
 */
export const SYNC_INTERVAL_MS = 300_000;

/** What the auth store renders (Settings → Account). The engine is the only writer. */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface SyncMeta {
	/** Server `updatedAt` (epoch ms) of the envelope we last pushed or pulled. 0 = none yet. */
	updatedAt: number;
	/** quick-261020-incsync: per-key hashes — only changed keys are pushed, never the
	 *  whole envelope. Replaces the old aggregate `hash` (see readSyncMeta migration). */
	hashes: Record<string, string>;
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
 * quick-261020-sync: the sync-item PICKER. The selection lives in the settings blob
 * (settings.syncItems, SYNC_DEFAULTS in $lib/config/defaults) and the engine reads it
 * through the injected `read` closure — it never imports the settings runes singleton
 * (the node Vitest project can't compile runes; see the defaults.ts import note above).
 */

/** PURE: the exact localStorage key list the current selection allows to travel. */
export function selectedWantedKeys(items: SyncItems, allKeys: readonly string[]): string[] {
	const out: string[] = [];
	if (items.settings) out.push(SETTINGS_KEY);
	if (items.library) out.push(LIBRARY_KEY);
	if (items.history) out.push(HISTORY_KEY);
	if (items.searchHistory) out.push(SEARCH_HISTORY_KEY);
	if (items.nameTr) out.push(...allKeys.filter((k) => k.startsWith(NAME_TR_PREFIX)));
	return out;
}

/**
 * PURE: read the picker selection from the settings blob through `read`. A missing /
 * corrupt / tampered blob falls back PER-KEY to SYNC_DEFAULTS — never throws.
 */
export function readSyncItems(read: (k: string) => string | null): SyncItems {
	const def = { ...SYNC_DEFAULTS.items };
	let raw: string | null = null;
	try {
		raw = read(SETTINGS_KEY);
	} catch {
		return def;
	}
	if (raw == null) return def;
	try {
		const v = JSON.parse(raw) as { syncItems?: unknown };
		const s = v.syncItems;
		if (s == null || typeof s !== 'object' || Array.isArray(s)) return def;
		const r = s as Record<string, unknown>;
		return {
			settings: typeof r.settings === 'boolean' ? r.settings : def.settings,
			library: typeof r.library === 'boolean' ? r.library : def.library,
			history: typeof r.history === 'boolean' ? r.history : def.history,
			searchHistory: typeof r.searchHistory === 'boolean' ? r.searchHistory : def.searchHistory,
			nameTr: typeof r.nameTr === 'boolean' ? r.nameTr : def.nameTr
		};
	} catch {
		return def;
	}
}

/**
 * PURE: drop every key the selection excludes from an envelope.
 *  - PUSH side: the cloud copy becomes EXACTLY the selected keys. Unchecking a family
 *    DELETES it from the server on the next push (last-write-wins): the PUT upserts the
 *    whole filtered envelope, so the family is gone for every device — a deliberate,
 *    visible choice, documented here so no one "fixes" it back into a merge.
 *  - PULL side: filter the server envelope BEFORE validateEnvelope, so a deselected
 *    family is never applied to the local store (the local copy is kept untouched).
 *  NOTE (cross-device): if device A unchecks `library` and pushes, device B (still
 *  checked) pulls an envelope without it. B's apply does not restore it — B converges
 *  to the family-less state; any later local library change on B pushes it back up.
 */
export function filterEnvelopeKeys(env: BackupEnvelope, items: SyncItems): BackupEnvelope {
	const allowExact = new Set<string>();
	if (items.settings) allowExact.add(SETTINGS_KEY);
	if (items.library) allowExact.add(LIBRARY_KEY);
	if (items.history) allowExact.add(HISTORY_KEY);
	if (items.searchHistory) allowExact.add(SEARCH_HISTORY_KEY);
	const keys: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(env.keys)) {
		if (k.startsWith(NAME_TR_PREFIX)) {
			if (items.nameTr) keys[k] = v;
		} else if (allowExact.has(k)) {
			keys[k] = v;
		}
		// Dropped silently: an unselected family, or a foreign/unknown key the validator
		// would drop anyway.
	}
	return { ...env, keys };
}

/**
 * PURE: hash of exactly the key set the selection allows to sync — the four exact keys
 * + the name-tr prefix family present in `allKeys`, each gated by the picker.
 * The SELECTION itself is folded into the hash: a pure toggle changes no payload but
 * MUST still count as dirty, or the push carrying the new selection never fires.
 * `items` defaults to all-on, so the two-arg call shape (and the existing tests) keeps
 * meaning "everything", as before the picker existed.
 */
export function hashSyncedKeys(
	read: (k: string) => string | null,
	allKeys: readonly string[],
	items: SyncItems = { ...SYNC_DEFAULTS.items }
): string {
	let acc = '';
	for (const k of selectedWantedKeys(items, allKeys)) acc += `${k}=${read(k) ?? ''}\n`;
	return cyrb53(`selection=${JSON.stringify(items)}\n${acc}`);
}

/**
 * quick-261020-incsync — per-key change hashes over the FILTERED envelope (what would
 * actually be pushed: slimmed + picker-filtered). A key whose hash differs from the meta
 * is pushed; a key in the meta but absent here (cleared data, deselected family) is
 * pushed as null so the server deletes that row. Clean keys never leave the device.
 */
export function hashEachKey(keys: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(keys)) {
		out[k] = cyrb53(`${k}=${JSON.stringify(v) ?? ''}`);
	}
	return out;
}

/** PURE-ish read of the sync meta; absent / corrupt → null (treated as "never synced"). */
export function readSyncMeta(store: Pick<Storage, 'getItem'>): SyncMeta | null {
	try {
		const raw = store.getItem(SYNC_META_KEY);
		if (!raw) return null;
		const v = JSON.parse(raw) as Partial<SyncMeta> & { hash?: unknown };
		if (typeof v.updatedAt !== 'number') return null;
		if (v.hashes != null && typeof v.hashes === 'object' && !Array.isArray(v.hashes)) {
			return { updatedAt: v.updatedAt, hashes: v.hashes as Record<string, string> };
		}
		// quick-261020-incsync migration: the old aggregate-hash meta carries no per-key
		// state — start with empty hashes so the next tick pushes every key once, then
		// goes incremental.
		if (typeof v.hash === 'string') return { updatedAt: v.updatedAt, hashes: {} };
		return null;
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

/** The live picker selection, read from the settings blob on every pass — a toggle
 *  takes effect on the very next tick without restarting the engine. */
function localItems(): SyncItems {
	return readSyncItems(localRead);
}

/** The filtered envelope's keys + their per-key hashes (what a push would carry). */
function localEnvelopeHashes(): { keys: Record<string, unknown>; hashes: Record<string, string> } {
	const keys = localEnvelope().keys as Record<string, unknown>;
	return { keys, hashes: hashEachKey(keys) };
}

/** Build the full envelope, then filter to the selection — the cloud copy carries ONLY
 *  what the user checked (filterEnvelopeKeys documents the uncheck-drops-it semantics).
 *  quick-261023-syncmerge: the sync payload strips the device-local downloads/unavailable
 *  (they describe this device's files and never sync). */
function localEnvelope(): BackupEnvelope {
	return filterEnvelopeKeys(
		buildEnvelope(localRead, storageKeys(localStorage), new Date(), { stripDeviceLocal: true }),
		localItems()
	);
}

/**
 * PUSH only the changed keys (quick-261020-incsync); on success the meta's per-key
 * hashes are re-anchored to the server's updatedAt. `changed` maps key → value, or
 * key → null to delete a key the client no longer carries.
 */
async function pushNow(
	hooks: SyncHooks,
	changed: Record<string, unknown>,
	hashes: Record<string, string>,
	keepalive = false
): Promise<boolean> {
	hooks.setStatus('syncing');
	try {
		const res = await hooks.request('/api/me/sync', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ keys: changed }),
			keepalive
		});
		if (!res.ok) {
			hooks.setStatus('error');
			return false;
		}
		const body = (await res.json().catch(() => null)) as { updatedAt?: number } | null;
		const meta = readSyncMeta(localStorage) ?? { updatedAt: 0, hashes: {} };
		for (const k of Object.keys(changed)) {
			if (changed[k] === null) delete meta.hashes[k];
			else meta.hashes[k] = hashes[k];
		}
		meta.updatedAt = body?.updatedAt ?? Date.now();
		writeSyncMeta(localStorage, meta);
		hooks.setStatus('synced');
		hooks.setLastSyncedAt(Date.now());
		return true;
	} catch {
		hooks.setStatus('error');
		return false;
	}
}

/**
 * Diff the filtered envelope against the meta's per-key hashes. Returns null when
 * nothing changed (zero network), else the partial key set to push (null = delete).
 */
export function diffSyncKeys(
	keys: Record<string, unknown>,
	hashes: Record<string, string>,
	meta: SyncMeta
): Record<string, unknown> | null {
	const changed: Record<string, unknown> = {};
	for (const [k, h] of Object.entries(hashes)) {
		if (meta.hashes[k] !== h) changed[k] = keys[k];
	}
	for (const k of Object.keys(meta.hashes)) {
		if (!(k in hashes)) changed[k] = null;
	}
	return Object.keys(changed).length > 0 ? changed : null;
}

/**
 * quick-261023-syncmerge-review: the first-sign-in review gate.
 *
 * On first sign-in, when BOTH this device and the cloud hold data AND they differ, the app
 * must NOT auto-merge — the user reviews the itemized diff first and picks Merge / Keep
 * this device / Use cloud data. checkFirstSync returns the preview exactly when ALL hold:
 * signed in, this device never synced (no meta), the cloud holds an envelope, the device
 * holds syncable data, and the two differ. Otherwise null — the engine's normal converge
 * handles it (pure pull when the device is empty, baseline push when the cloud is empty).
 *
 * The fetched remote envelope is stashed in localStorage (SYNC_REVIEW_KEY) alongside, so a
 * reload mid-review neither loses the review nor needs a refetch. resolveFirstSync applies
 * the user's choice; until then the engine stays parked (syncOnce + beforeunload gate on
 * isReviewPending). Nothing here throws — a failure must never block sign-in.
 */

/** Persisted first-sync review state: the remote envelope, stashed at check time. */
export const SYNC_REVIEW_KEY = 'openmusic:sync-review:v1';

interface ReviewStash {
	envelope: BackupEnvelope;
	updatedAt: number;
}

/** In-memory: a first-sync review is awaiting the user's choice — the engine stays parked. */
let reviewPending = false;

/** The engine (and the beforeunload push) must not run while the user hasn't chosen. */
export function isReviewPending(): boolean {
	if (reviewPending) return true;
	try {
		return localStorage.getItem(SYNC_REVIEW_KEY) != null;
	} catch {
		return false;
	}
}

function readReviewStash(): ReviewStash | null {
	try {
		const raw = localStorage.getItem(SYNC_REVIEW_KEY);
		if (!raw) return null;
		const v = JSON.parse(raw) as { envelope?: unknown; updatedAt?: unknown };
		if (v == null || typeof v !== 'object') return null;
		const env = v.envelope as { keys?: unknown } | null;
		if (env == null || typeof env !== 'object' || env.keys == null || typeof env.keys !== 'object')
			return null;
		if (typeof v.updatedAt !== 'number') return null;
		return { envelope: v.envelope as BackupEnvelope, updatedAt: v.updatedAt };
	} catch {
		return null;
	}
}

function writeReviewStash(envelope: BackupEnvelope, updatedAt: number): void {
	try {
		localStorage.setItem(SYNC_REVIEW_KEY, JSON.stringify({ envelope, updatedAt, at: Date.now() }));
	} catch {
		/* quota — the in-memory flag still gates this session */
	}
}

function clearReviewStash(): void {
	reviewPending = false;
	try {
		localStorage.removeItem(SYNC_REVIEW_KEY);
	} catch {
		/* ignore */
	}
}

/** Fetch + picker-filter + validate the cloud envelope. Null when there is nothing (or on any failure). */
async function fetchRemoteEnvelope(
	hooks: SyncHooks
): Promise<{ envelope: BackupEnvelope; updatedAt: number } | null> {
	try {
		const res = await hooks.request('/api/me/sync');
		if (!res.ok) return null;
		const body = (await res.json().catch(() => null)) as {
			envelope: unknown;
			updatedAt: number | null;
		} | null;
		if (!body || body.envelope == null) return null;
		const verdict = validateEnvelope(
			JSON.stringify(filterEnvelopeKeys(body.envelope as BackupEnvelope, localItems()))
		);
		if (!verdict.ok) return null;
		return { envelope: verdict.envelope, updatedAt: body.updatedAt ?? 0 };
	} catch {
		return null;
	}
}

function envelopeKeysEmpty(env: BackupEnvelope): boolean {
	return Object.keys(env.keys ?? {}).length === 0;
}

export async function checkFirstSync(hooks: SyncHooks): Promise<SyncPreview | null> {
	try {
		if (!browser || !hooks.isSignedIn()) return null;
		// This device converged before — the normal engine owns every later decision.
		if (readSyncMeta(localStorage) != null) return null;
		const stashed = readReviewStash();
		let remote: { envelope: BackupEnvelope; updatedAt: number } | null = stashed
			? { envelope: stashed.envelope, updatedAt: stashed.updatedAt }
			: null;
		if (!remote) {
			const fresh = await fetchRemoteEnvelope(hooks);
			if (!fresh) return null;
			remote = fresh;
		}
		const localEnv = localEnvelope();
		// The device holds nothing syncable — a plain pull converges; nothing to review.
		// (Also clears a stale stash, e.g. the user wiped the device mid-review.)
		if (envelopeKeysEmpty(localEnv)) {
			clearReviewStash();
			return null;
		}
		const preview = previewMerge(localEnv, remote.envelope);
		if (!previewHasDiff(preview)) {
			clearReviewStash();
			return null;
		}
		writeReviewStash(remote.envelope, remote.updatedAt);
		reviewPending = true;
		return preview;
	} catch {
		return null;
	}
}

/**
 * Apply the user's first-sync choice. Returns false when there was nothing pending (the
 * caller then just starts the engine). 'merge' and 'theirs' end in location.reload() —
 * code after those branches never runs; the post-reload boot finds the anchored meta and
 * starts the engine without re-reviewing. Never throws.
 */
export async function resolveFirstSync(
	hooks: SyncHooks,
	choice: 'merge' | 'mine' | 'theirs'
): Promise<boolean> {
	try {
		const stashed = readReviewStash();
		if (!stashed || !hooks.isSignedIn()) {
			clearReviewStash();
			return false;
		}
		const { envelope: remoteEnv, updatedAt: serverAt } = stashed;
		if (choice === 'mine') {
			// Local wins: push the whole local envelope over the cloud copy.
			const { keys, hashes } = localEnvelopeHashes();
			clearReviewStash();
			await pushNow(hooks, keys, hashes);
			return true;
		}
		hooks.setStatus('syncing');
		const merged =
			choice === 'merge'
				? mergeEnvelopes(localEnvelope(), remoteEnv, localRead(LIBRARY_KEY))
				: remoteEnv;
		let applied: ReturnType<typeof applyEnvelope>;
		try {
			applied = applyEnvelope(merged, localStorage, sessionStorage);
		} catch {
			hooks.setStatus('error');
			return true;
		}
		clearReviewStash();
		if (applied !== 'ok') {
			hooks.setStatus('error');
			return true;
		}
		// Anchor the meta to the adopted state BEFORE the reload (the pull-path idiom).
		writeSyncMeta(localStorage, { updatedAt: serverAt, hashes: localEnvelopeHashes().hashes });
		hooks.setLastSyncedAt(Date.now());
		hooks.setStatus('synced');
		// 35-D-13: a FULL reload so every store re-runs load() on a cold path.
		location.reload();
		return true;
	} catch {
		clearReviewStash();
		return false;
	}
}

/**
 * One convergence pass (see the header for the decision table). Never throws; failures land
 * on the 'error' status and the next tick (or "Sync now") retries.
 */
export async function syncOnce(hooks: SyncHooks): Promise<void> {
	if (!browser || !hooks.isSignedIn()) return;
	// quick-261023-syncmerge-review: parked until the user resolves the first-sync review.
	if (isReviewPending()) return;
	const { keys, hashes } = localEnvelopeHashes();
	const meta = readSyncMeta(localStorage) ?? { updatedAt: 0, hashes: {} };

	// quick-261020-incsync: push ONLY the keys that changed (null when clean = zero
	// network). A changed key here is the newest write by definition — it just happened.
	const changed = diffSyncKeys(keys, hashes, meta);
	if (changed) {
		await pushNow(hooks, changed, hashes);
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
		// Signed in but the server has never seen this account → baseline push of every key.
		await pushNow(hooks, keys, hashes);
		return;
	}
	const serverAt = body.updatedAt ?? 0;
	if (serverAt > meta.updatedAt) {
		// Another device is ahead. Validate through the ONE validator before any byte of it
		// reaches localStorage (the server validates too — defence in depth, not trust).
		// quick-261020-sync: the server envelope is filtered to the local picker selection
		// FIRST — a deselected family is never applied to the local store.
		const verdict = validateEnvelope(JSON.stringify(filterEnvelopeKeys(body.envelope as BackupEnvelope, localItems())));
		if (!verdict.ok) {
			hooks.setStatus('error');
			return;
		}
		hooks.setStatus('syncing');
		// quick-261023-syncmerge: MERGE, not replace. Each family present in the remote
		// envelope unions with the local copy (tombstones suppress deletes); a family
		// ABSENT from the remote envelope is delete-wins — mergeEnvelopes omits it, so
		// applyEnvelope clears it locally (the picker's uncheck-deletes-family semantics).
		// The merge reads the FULL local library blob (localRead, not the slimmed push
		// envelope) so the device-local downloads/unavailable survive the round trip.
		const merged = mergeEnvelopes(localEnvelope(), verdict.envelope, localRead(LIBRARY_KEY));
		let applied: ReturnType<typeof applyEnvelope>;
		try {
			applied = applyEnvelope(merged, localStorage, sessionStorage);
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
		writeSyncMeta(localStorage, { updatedAt: serverAt, hashes: localEnvelopeHashes().hashes });
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
 * visibilitychange (hidden pushes dirty state promptly — mobile beforeunload is
 * unreliable; visible re-checks for a server-ahead pull), and a keepalive push on
 * beforeunload when the local state is dirty (so closing the tab cannot strand a change
 * the interval had not reached yet).
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
		// quick-261020-syncfreq: tick on hidden too — mobile beforeunload often never fires,
		// so backgrounding is the reliable moment to push dirty state promptly.
		void tick();
	};
	const onBeforeUnload = () => {
		// Fire-and-forget by necessity (the page is going away): push only when dirty, and
		// with keepalive so the request outlives the unload.
		if (!hooks.isSignedIn()) return;
		// quick-261023-syncmerge-review: never push while the first-sync review is pending —
		// that push would clobber the cloud copy before the user has chosen.
		if (isReviewPending()) return;
		const meta = readSyncMeta(localStorage) ?? { updatedAt: 0, hashes: {} };
		const { keys, hashes } = localEnvelopeHashes();
		const changed = diffSyncKeys(keys, hashes, meta);
		if (!changed) return;
		void pushNow(hooks, changed, hashes, true);
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
