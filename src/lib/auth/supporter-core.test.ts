// supporter-core tests (quick-261119-tipbind) — the account-binding contract
// exercised against a REAL SQLite (node:sqlite) running the module's verbatim
// DDL, via a thin D1Database-shaped adapter (the metric-counter.test.ts
// precedent). A real engine is what proves the UNIQUE/PK semantics the claim
// rules rest on: one claim per account, one account per key, no stealing.

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
	SUPPORTER_CLAIMS_DDL,
	claimSupporter,
	getAccountSupporter,
	revokeSupporterByKey
} from './supporter-core';

const NOW = '2026-11-19T06:00:00.000Z';
const LATER = '2026-11-20T06:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

/** Minimal D1Database stand-in backed by a real in-memory SQLite. */
function realDb(withTable = true) {
	const sqlite = new DatabaseSync(':memory:');
	if (withTable) sqlite.exec(SUPPORTER_CLAIMS_DDL);
	const db = {
		prepare(sql: string) {
			let params: unknown[] = [];
			const stmt = {
				bind(...p: unknown[]) {
					params = p;
					return stmt;
				},
				async first() {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					return sqlite.prepare(sql).get(...(params as any[])) ?? null;
				},
				async run() {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					sqlite.prepare(sql).run(...(params as any[]));
					return { success: true, meta: {} };
				}
			};
			return stmt;
		}
	};
	const all = () =>
		sqlite.prepare('SELECT user_id, key_hash, tier, verified_at FROM account_supporters ORDER BY user_id').all();
	return { db: db as unknown as D1Database, all, sqlite };
}

describe('SUPPORTER_CLAIMS_DDL', () => {
	it('stores the key ONLY as a hash — no raw-key or email column exists', () => {
		expect(SUPPORTER_CLAIMS_DDL).toContain('account_supporters');
		expect(SUPPORTER_CLAIMS_DDL).toContain('key_hash TEXT NOT NULL UNIQUE');
		expect(SUPPORTER_CLAIMS_DDL).toContain('user_id TEXT PRIMARY KEY');
		expect(SUPPORTER_CLAIMS_DDL.toLowerCase()).not.toContain('license_key');
		expect(SUPPORTER_CLAIMS_DDL.toLowerCase()).not.toContain('email');
	});
});

describe('claimSupporter + getAccountSupporter (real SQLite)', () => {
	it('a first claim is recorded and reads back with tier + verified_at', async () => {
		const { db, all } = realDb();
		expect(await claimSupporter(db, 'user-1', HASH_A, 'bronze', NOW)).toBe('claimed');
		expect(all()).toEqual([{ user_id: 'user-1', key_hash: HASH_A, tier: 'bronze', verified_at: NOW }]);
		expect(await getAccountSupporter(db, 'user-1')).toEqual({ tier: 'bronze', verified_at: NOW });
		expect(await getAccountSupporter(db, 'user-2')).toBeNull();
	});

	it('re-claiming the SAME key by the SAME user is already-yours and keeps the original row', async () => {
		const { db, all } = realDb();
		await claimSupporter(db, 'user-1', HASH_A, 'bronze', NOW);
		expect(await claimSupporter(db, 'user-1', HASH_A, 'bronze', LATER)).toBe('already-yours');
		// verified_at is the FIRST verification — the record is "since when", not "last seen".
		expect(all()).toEqual([{ user_id: 'user-1', key_hash: HASH_A, tier: 'bronze', verified_at: NOW }]);
	});

	it('a same-key re-verify at a higher tier refreshes the tier, still already-yours', async () => {
		const { db } = realDb();
		await claimSupporter(db, 'user-1', HASH_A, 'bronze', NOW);
		expect(await claimSupporter(db, 'user-1', HASH_A, 'gold', LATER)).toBe('already-yours');
		expect(await getAccountSupporter(db, 'user-1')).toEqual({ tier: 'gold', verified_at: NOW });
	});

	it('a key claimed by a DIFFERENT user is key-in-use — never stolen, never overwritten', async () => {
		const { db, all } = realDb();
		await claimSupporter(db, 'user-1', HASH_A, 'bronze', NOW);
		expect(await claimSupporter(db, 'user-2', HASH_A, 'gold', LATER)).toBe('key-in-use');
		expect(all()).toEqual([{ user_id: 'user-1', key_hash: HASH_A, tier: 'bronze', verified_at: NOW }]);
		expect(await getAccountSupporter(db, 'user-2')).toBeNull();
	});

	it('a user who already holds a claim keeps it when verifying a second key (already-yours)', async () => {
		const { db, all } = realDb();
		await claimSupporter(db, 'user-1', HASH_A, 'bronze', NOW);
		expect(await claimSupporter(db, 'user-1', HASH_B, 'bronze', LATER)).toBe('already-yours');
		// The first claim stands; the second key is NOT swapped in.
		expect(all()).toEqual([{ user_id: 'user-1', key_hash: HASH_A, tier: 'bronze', verified_at: NOW }]);
	});

	it('two different users with two different keys both claim fine', async () => {
		const { db, all } = realDb();
		expect(await claimSupporter(db, 'user-1', HASH_A, 'bronze', NOW)).toBe('claimed');
		expect(await claimSupporter(db, 'user-2', HASH_B, 'gold', NOW)).toBe('claimed');
		expect(all()).toHaveLength(2);
	});
});

describe('revokeSupporterByKey (refund path)', () => {
	it('deletes only the row matching BOTH user and key', async () => {
		const { db, all } = realDb();
		await claimSupporter(db, 'user-1', HASH_A, 'bronze', NOW);
		await claimSupporter(db, 'user-2', HASH_B, 'bronze', NOW);
		// Wrong user for this key — nothing is deleted.
		expect(await revokeSupporterByKey(db, 'user-2', HASH_A)).toBe(true);
		expect(all()).toHaveLength(2);
		// Wrong key for this user — nothing is deleted.
		expect(await revokeSupporterByKey(db, 'user-1', HASH_B)).toBe(true);
		expect(all()).toHaveLength(2);
		// The matching pair revokes exactly that claim.
		expect(await revokeSupporterByKey(db, 'user-1', HASH_A)).toBe(true);
		expect(all()).toEqual([{ user_id: 'user-2', key_hash: HASH_B, tier: 'bronze', verified_at: NOW }]);
		expect(await getAccountSupporter(db, 'user-1')).toBeNull();
	});
});

describe('never-throw contract (missing table = not-yet-applied DDL)', () => {
	it('claim → error, read → null, revoke → false, and nothing throws', async () => {
		const { db } = realDb(false);
		expect(await claimSupporter(db, 'user-1', HASH_A, 'bronze', NOW)).toBe('error');
		expect(await getAccountSupporter(db, 'user-1')).toBeNull();
		expect(await revokeSupporterByKey(db, 'user-1', HASH_A)).toBe(false);
	});
});
