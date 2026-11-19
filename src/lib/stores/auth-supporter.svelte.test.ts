// auth store — supporter account binding (quick-261119-tipbind).
//
// The behaviour under test: GET /api/auth/session now carries the account's
// server-side supporter claim, and the store must (a) HEAL this device's local
// supporter flag from it (every isSupporter() gate reads localStorage, so a
// healed device is a supporter with zero user action) and (b) run the
// claim-on-login migration — a signed-in user whose claim exists ONLY locally
// (verified before this feature, or while signed out) re-verifies the stored
// key ONCE so the server binds it to the account.
//
// Seams: browser flipped ON with an in-memory localStorage (the
// library.svelte.test.ts pattern); the sync engine module is mocked out (its
// own suites cover it — here it would only add intervals and /api/me/sync
// traffic); Capacitor is stubbed to the web platform (the native bearer seam
// is covered elsewhere); global fetch routes the two endpoints in play.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('$lib/services/sync', () => ({
	checkFirstSync: vi.fn(async () => null),
	isReviewPending: vi.fn(() => false),
	resolveFirstSync: vi.fn(async () => {}),
	startSyncEngine: vi.fn(() => ({ stop: () => {}, syncNow: async () => {} }))
}));

const memStore = new Map<string, string>();
const localStorageMock: Storage = {
	get length() {
		return memStore.size;
	},
	clear: () => memStore.clear(),
	getItem: (k: string) => (memStore.has(k) ? (memStore.get(k) as string) : null),
	key: (i: number) => Array.from(memStore.keys())[i] ?? null,
	removeItem: (k: string) => void memStore.delete(k),
	setItem: (k: string, v: string) => void memStore.set(k, String(v))
};
vi.stubGlobal('localStorage', localStorageMock);

const USER = { id: 'user-1', email: 'a@b.co' };
const SINCE = '2026-11-19T06:00:00.000Z';

let sessionBody: unknown;
let verifyCalls: { url: string; body: unknown }[] = [];
let verifyBody: unknown;

function stubFetch() {
	verifyCalls = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: unknown, init?: { body?: unknown }) => {
			const u = String(url);
			if (u.includes('/api/auth/session')) {
				return new Response(JSON.stringify(sessionBody), { status: 200 });
			}
			if (u.includes('/api/sponsored/verify')) {
				verifyCalls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
				return new Response(JSON.stringify(verifyBody), { status: 200 });
			}
			return new Response('{}', { status: 404 });
		})
	);
}

/** Fresh store singleton per test (load() is once-guarded by design). */
async function freshAuth() {
	vi.resetModules();
	return (await import('./auth.svelte')).auth;
}

beforeEach(() => {
	memStore.clear();
	sessionBody = { user: null, supporter: null };
	verifyBody = { ok: true, account: true };
	stubFetch();
});

describe('parseSupporterClaim', () => {
	it('accepts a well-formed claim and rejects everything else', async () => {
		const { parseSupporterClaim } = await import('./auth.svelte');
		expect(parseSupporterClaim({ tier: 'gold', since: SINCE })).toEqual({ tier: 'gold', since: SINCE });
		expect(parseSupporterClaim({ tier: 'bronze' })).toEqual({ tier: 'bronze', since: '' });
		expect(parseSupporterClaim({ tier: 'platinum', since: SINCE })).toBeNull();
		expect(parseSupporterClaim({ since: SINCE })).toBeNull();
		expect(parseSupporterClaim(null)).toBeNull();
		expect(parseSupporterClaim('gold')).toBeNull();
		expect(parseSupporterClaim(undefined)).toBeNull();
	});
});

describe('auth.load() — supporter healing (quick-261119-tipbind)', () => {
	it('a server claim heals the local flag + tier so isSupporter() passes on this device', async () => {
		sessionBody = { user: USER, supporter: { tier: 'gold', since: SINCE } };
		const auth = await freshAuth();
		await auth.load();
		const { isSupporter, getSupporterTier } = await import('$lib/config/sponsored');
		expect(auth.user).toEqual(USER);
		expect(auth.supporter).toEqual({ tier: 'gold', since: SINCE });
		expect(localStorage.getItem('dawn_supporter')).toBe('1');
		expect(isSupporter()).toBe(true);
		expect(getSupporterTier()).toBe('gold');
		// Healing is not a migration — no verify POST was needed.
		expect(verifyCalls).toHaveLength(0);
	});

	it('signed out: supporter stays null and nothing is written or claimed', async () => {
		sessionBody = { user: null, supporter: null };
		const auth = await freshAuth();
		await auth.load();
		expect(auth.user).toBeNull();
		expect(auth.supporter).toBeNull();
		expect(localStorage.getItem('dawn_supporter')).toBeNull();
		expect(verifyCalls).toHaveLength(0);
	});

	it('signed in with NO local key and NO server claim: no migration POST', async () => {
		sessionBody = { user: USER, supporter: null };
		const auth = await freshAuth();
		await auth.load();
		expect(auth.supporter).toBeNull();
		expect(verifyCalls).toHaveLength(0);
	});
});

describe('auth.load() — claim-on-login migration (quick-261119-tipbind)', () => {
	it('a local-only supporter re-verifies the stored key ONCE (no wall field) and gains the server claim', async () => {
		sessionBody = { user: USER, supporter: null };
		localStorage.setItem('dawn_supporter', '1');
		localStorage.setItem('dawn_tip_license_key', 'REAL-KEY-1234');
		localStorage.setItem('dawn_supporter_tier', 'silver');
		const auth = await freshAuth();
		await auth.load();
		// The migration is fire-and-forget — let its microtasks settle.
		await vi.waitFor(() => expect(auth.supporter).not.toBeNull());
		expect(verifyCalls).toHaveLength(1);
		expect(verifyCalls[0].body).toEqual({ license_key: 'REAL-KEY-1234' });
		// Supporter state mirrors the LOCAL tier (the claim the device recorded).
		expect(auth.supporter?.tier).toBe('silver');
	});

	it('a failed migration is silent: local flag untouched, supporter stays null, no throw', async () => {
		sessionBody = { user: USER, supporter: null };
		verifyBody = { ok: false, reason: 'invalid' };
		localStorage.setItem('dawn_supporter', '1');
		localStorage.setItem('dawn_tip_license_key', 'STALE-KEY');
		const auth = await freshAuth();
		await auth.load();
		await new Promise((r) => setTimeout(r, 20));
		expect(verifyCalls).toHaveLength(1);
		expect(auth.supporter).toBeNull();
		const { isSupporter } = await import('$lib/config/sponsored');
		expect(isSupporter()).toBe(true); // the device-local flag is the user's own record
	});
});
