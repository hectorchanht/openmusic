# quick-261119-tipbind — SUMMARY

**Status:** implemented + fully gated on local branch `feat/supporter-account-bind`. NOT pushed, NOT deployed.

## What shipped

- `src/lib/auth/supporter-core.ts` — pure never-throw claim core + `SUPPORTER_CLAIMS_DDL`
  (`account_supporters` in ACCOUNTS_DB; key only as SHA-256).
- `src/routes/api/sponsored/verify/+server.ts` — best-effort account claim on
  success (admin gold / Gumroad bronze), `account: true` when recorded;
  refunded → best-effort revoke. Anonymous answers byte-identical.
- `src/routes/api/auth/session/+server.ts` — `{ user, supporter: { tier, since } | null }`.
- `src/lib/stores/auth.svelte.ts` — `auth.supporter` $state, localStorage heal on
  any session establishment, claim-on-login migration (once per page load,
  authedFetch, no `public_wall` field, silent on failure), logout clears the
  mirror only.
- `src/routes/(app)/+layout.svelte` — $effect mirroring `auth.supporter` into
  `support.isSupporter` (cross-store wiring stays in the layout).

## Gates

- Touched-area tests: 49 passed (supporter-core 9, verify-endpoint 11,
  auth-endpoint 23, auth-supporter store 6).
- Full suite: `vitest --run` — 273 files / 5683 tests, all passed.
- `pnpm check` — svelte-check 0 errors (18 warnings, all pre-existing in
  untouched files).
- `pnpm build` — success.

## Maintainer follow-up (out-of-band)

Apply to the `openmusic-accounts` D1 (binding ACCOUNTS_DB):

```sql
CREATE TABLE IF NOT EXISTS account_supporters (
	user_id TEXT PRIMARY KEY,
	key_hash TEXT NOT NULL UNIQUE,
	tier TEXT NOT NULL DEFAULT 'bronze',
	verified_at TEXT NOT NULL
)
```

Until the DDL lands, every path degrades gracefully (claims read as no record;
verify/session answers unchanged).

## Known gap

The admin-key claim path (tier gold) shares `claimForSessionUser` with the
Gumroad path and the core's gold handling is unit-tested, but there is no
endpoint test for it: the admin plaintext key is a secret known only to Hector
(only its SHA-256 is in the repo), so a test cannot present it.
