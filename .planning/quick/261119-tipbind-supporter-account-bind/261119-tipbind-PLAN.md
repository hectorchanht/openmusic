# quick-261119-tipbind — Supporter account binding: a verified tip is remembered against the account, forever

**Reporter:** Hector, 2026-11-19. A user who tips gets a Gumroad license key; POST
/api/sponsored/verify verified it, but supporter status lived ONLY in that one
device's localStorage (`dawn_supporter`, `dawn_tip_license_key`, tier). The same
user signing in with the same account on a second device (his own case: phone →
tablet, Google sign-in) was asked for the key again. His ruling: once a signed-in
user has verified a tip ONCE, the server must remember it against their account
forever — any device where they sign in is automatically a supporter, with a
server-side record. The user must never have to remember or re-enter the token.

## Fix

1. **New pure core `src/lib/auth/supporter-core.ts`** (never-throw, auth-core
   precedent): `SUPPORTER_CLAIMS_DDL` for `account_supporters` in ACCOUNTS_DB
   (`openmusic-accounts` — PII-adjacent account data; key stored ONLY as SHA-256
   in `key_hash`, raw key never stored); `claimSupporter` →
   claimed / already-yours / key-in-use (a key claimed by a different user is
   never stolen) / error; `getAccountSupporter`; `revokeSupporterByKey`
   (user+key pair only, the refund path). DDL applied out-of-band (no migrations
   runner — the METRIC_COUNTERS_DDL precedent).
2. **Verify route**: on success (admin → gold, Gumroad → bronze), best-effort
   claim for the session user (getUserFromRequest over ACCOUNTS_DB); response
   gains `account: true` only when the claim is recorded/already theirs. A
   `refunded` result revokes the session user's claim for that key. Anonymous
   behaviour byte-identical.
3. **Session route**: `{ user, supporter }` — supporter = `{ tier, since }` or
   null; never 500s.
4. **Client (`auth.svelte.ts`)**: parse `supporter` from the session probe;
   on any session establishment heal localStorage (SUPPORTER_KEY + tier) so
   every isSupporter() gate passes with zero user action; claim-on-login
   migration for pre-feature / signed-out verifies (stored local key
   re-verified once per page load via authedFetch, NO public_wall field —
   wall untouched, silent on failure). Layout mirrors the claim into the
   support store via $effect (setPlaybackProbe precedent — auth imports no
   other store). No new user-visible strings; SupporterSheet unchanged.

## Verify

- supporter-core tests (real SQLite, verbatim DDL): claim/already-yours/
  key-in-use/tier-refresh/revoke-pair/missing-table.
- verify-endpoint tests extended: signed-in claim + account:true, same-user
  re-verify, second-user key-in-use, refunded revoke, anonymous unchanged,
  no-binding unchanged.
- session endpoint tests: supporter present/absent; existing expectations
  migrated to the { user, supporter } shape.
- New auth-supporter store tests: parseSupporterClaim, heal-on-load,
  claim-on-login migration (once, no wall field), silent failure.
- Full vitest suite + `pnpm check` (svelte-check) + `pnpm build`.
- NOT deployed, NOT pushed; DDL applied out-of-band by the maintainer.
