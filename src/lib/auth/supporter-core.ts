// Supporter account binding (quick-261119-tipbind) — PURE, never-throw core for
// remembering a verified tip against a signed-in account, forever.
//
// THE PROBLEM (Hector, 2026-11-19): a tipper verified their Gumroad license key
// on one device and supporter status lived ONLY in that device's localStorage
// (`dawn_supporter` / `dawn_tip_license_key`). Signing in with the SAME account
// on a second device asked for the key again. His ruling: once a signed-in user
// has verified a tip ONCE, the server remembers it against their account — any
// device where they sign in is automatically a supporter, with a server-side
// record, and the user never has to remember or re-enter the token.
//
// This module is the node-Vitest-testable core the /api/sponsored/verify and
// /api/auth/session routes thinly wrap (the auth-core / metric-counter
// precedent: the route owns the HTTP shape, this module owns the semantics).
//
// STORAGE: the `account_supporters` table lives in ACCOUNTS_DB (the
// `openmusic-accounts` D1) — it is PII-adjacent account data (it says THIS
// user tipped), so it belongs beside the user row, NOT in the anonymous
// ANALYTICS_DB and NOT in the public SUPPORTERS_DB wall. The license key is
// stored ONLY as its SHA-256 hash (`key_hash`) — the raw key never touches D1,
// the same doctrine as the supporters wall and the session/magic token hashes
// in auth-core.ts. A database leak therefore hands out no usable key.
//
// No migrations runner exists in this project: the DDL lives here as the
// single source of truth (SUPPORTER_CLAIMS_DDL, the METRIC_COUNTERS_DDL
// precedent) and is applied out-of-band via the D1 API / wrangler. Every
// function below is never-throw precisely so a not-yet-applied table degrades
// to "no record" instead of breaking verify or session.

import type { SupporterTier } from '$lib/config/sponsored';

/** The account-supporters table's DDL — apply out-of-band to `openmusic-accounts`.
 *  `user_id` is the PK (one claim per account); `key_hash` is UNIQUE (one
 *  account per key — a key claimed by someone else is never stolen). */
export const SUPPORTER_CLAIMS_DDL = `CREATE TABLE IF NOT EXISTS account_supporters (
	user_id TEXT PRIMARY KEY,
	key_hash TEXT NOT NULL UNIQUE,
	tier TEXT NOT NULL DEFAULT 'bronze',
	verified_at TEXT NOT NULL
)`;

/** The stored claim shape getAccountSupporter returns (null = no claim). */
export interface AccountSupporter {
	tier: SupporterTier;
	verified_at: string;
}

/** claimSupporter outcomes:
 *  - 'claimed'      — a new row was recorded for this user + key;
 *  - 'already-yours'— this user already holds a claim (this key, or another
 *                     key they verified earlier — the first claim stands);
 *  - 'key-in-use'   — this key_hash is claimed by a DIFFERENT user; the row is
 *                     never stolen or overwritten;
 *  - 'error'        — the store failed (missing table / D1 error). Callers
 *                     treat it as best-effort and answer exactly as before. */
export type ClaimResult = 'claimed' | 'already-yours' | 'key-in-use' | 'error';

function asTier(v: unknown): SupporterTier {
	return v === 'silver' || v === 'gold' ? v : 'bronze';
}

/**
 * Record (userId, keyHash, tier) as a supporter claim. Never throws.
 * `nowIso` is injected so tests pin the stored timestamp deterministically.
 */
export async function claimSupporter(
	db: D1Database,
	userId: string,
	keyHash: string,
	tier: SupporterTier,
	nowIso: string
): Promise<ClaimResult> {
	try {
		const byUser = await db
			.prepare('SELECT user_id, key_hash, tier FROM account_supporters WHERE user_id = ?')
			.bind(userId)
			.first<{ user_id: string; key_hash: string; tier: string }>();
		if (byUser) {
			// This account already holds a claim. Same key: refresh the tier (an
			// admin-key re-verify upgrades bronze → gold) and report already-yours.
			// A DIFFERENT key: the first claim stands — the user is already a
			// supporter forever, and swapping the recorded key would free the
			// first key for someone else to claim.
			if (byUser.key_hash === keyHash && byUser.tier !== tier) {
				try {
					await db
						.prepare('UPDATE account_supporters SET tier = ? WHERE user_id = ?')
						.bind(tier, userId)
						.run();
				} catch {
					/* tier refresh is cosmetic — the claim itself already stands */
				}
			}
			return 'already-yours';
		}
		const byKey = await db
			.prepare('SELECT user_id FROM account_supporters WHERE key_hash = ?')
			.bind(keyHash)
			.first<{ user_id: string }>();
		if (byKey) return byKey.user_id === userId ? 'already-yours' : 'key-in-use';
		try {
			await db
				.prepare('INSERT INTO account_supporters (user_id, key_hash, tier, verified_at) VALUES (?, ?, ?, ?)')
				.bind(userId, keyHash, tier, nowIso)
				.run();
			return 'claimed';
		} catch {
			// A concurrent claim raced the SELECTs above — re-read once and
			// classify honestly instead of reporting a bare error.
			const racedKey = await db
				.prepare('SELECT user_id FROM account_supporters WHERE key_hash = ?')
				.bind(keyHash)
				.first<{ user_id: string }>()
				.catch(() => null);
			if (racedKey) return racedKey.user_id === userId ? 'already-yours' : 'key-in-use';
			const racedUser = await db
				.prepare('SELECT user_id FROM account_supporters WHERE user_id = ?')
				.bind(userId)
				.first<{ user_id: string }>()
				.catch(() => null);
			return racedUser ? 'already-yours' : 'error';
		}
	} catch {
		return 'error';
	}
}

/**
 * The claim held by `userId`, or null — no claim, a missing table, or any D1
 * error all read as null (never throws), so the session route can always
 * answer and the client simply stays in its local state.
 */
export async function getAccountSupporter(db: D1Database, userId: string): Promise<AccountSupporter | null> {
	try {
		const row = await db
			.prepare('SELECT tier, verified_at FROM account_supporters WHERE user_id = ?')
			.bind(userId)
			.first<{ tier: string; verified_at: string }>();
		if (!row) return null;
		return { tier: asTier(row.tier), verified_at: row.verified_at };
	} catch {
		return null;
	}
}

/**
 * Refund path: delete ONLY the row matching BOTH this user and this key hash —
 * a refunded key revokes its own claim and nobody else's. Returns true when
 * the delete ran without error (whether or not a row matched). Never throws.
 */
export async function revokeSupporterByKey(db: D1Database, userId: string, keyHash: string): Promise<boolean> {
	try {
		await db
			.prepare('DELETE FROM account_supporters WHERE user_id = ? AND key_hash = ?')
			.bind(userId, keyHash)
			.run();
		return true;
	} catch {
		return false;
	}
}
