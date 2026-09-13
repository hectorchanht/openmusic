import { describe, it, expect } from 'vitest';
import { bearerMatches } from './diag-auth';

// This is the ONLY thing standing between the public internet and both the diagnostic upload
// endpoint and the log-read endpoint (D-01, D-03). It gets adversarial coverage, not happy-path
// coverage: every `it` below exists because a specific way of getting past the gate was considered.

describe('bearerMatches — fail-closed on an unconfigured secret (T-33-01)', () => {
	// THE load-bearing case. A missing binding must lock the door, not remove it. Get this backwards
	// (the fail-OPEN posture the optional-key routes like /api/similar correctly use) and a
	// forgotten `wrangler secret put` silently publishes every user's activity log.
	it('returns false for any header when the expected token is undefined', async () => {
		expect(await bearerMatches('Bearer x', undefined)).toBe(false);
		expect(await bearerMatches('Bearer anything-at-all', undefined)).toBe(false);
		expect(await bearerMatches(null, undefined)).toBe(false);
	});

	// An empty secret is the shape an unset-but-declared binding takes. Equally unconfigured.
	it('returns false when the expected token is the empty string', async () => {
		expect(await bearerMatches('Bearer ', '')).toBe(false);
		expect(await bearerMatches('Bearer x', '')).toBe(false);
	});
});

describe('bearerMatches — scheme screening', () => {
	it('returns false when no Authorization header was sent', async () => {
		expect(await bearerMatches(null, 'secret-1234')).toBe(false);
	});

	// Only the literal `Bearer ` scheme. Case-sensitive and space-exact: we issue these tokens to
	// ourselves, so there is no interop argument for being lenient here.
	it('rejects a non-Bearer scheme and a mis-cased one', async () => {
		expect(await bearerMatches('Token secret-1234', 'secret-1234')).toBe(false);
		expect(await bearerMatches('Basic secret-1234', 'secret-1234')).toBe(false);
		expect(await bearerMatches('bearer secret-1234', 'secret-1234')).toBe(false);
		expect(await bearerMatches('secret-1234', 'secret-1234')).toBe(false);
	});

	// `Bearer ` with nothing after it must not be mistaken for a match against a blank-ish secret.
	it('rejects an empty credential after the scheme', async () => {
		expect(await bearerMatches('Bearer ', 'secret-1234')).toBe(false);
		expect(await bearerMatches('Bearer', 'secret-1234')).toBe(false);
	});
});

describe('bearerMatches — exact match only (T-33-08)', () => {
	it('accepts exactly the expected token', async () => {
		expect(await bearerMatches('Bearer secret-1234', 'secret-1234')).toBe(true);
	});

	// A prefix must never pass. If it did, an attacker could extend a guessed token one character at
	// a time; comparing SHA-256 digests makes a prefix look like unrelated random bytes.
	it('rejects a strict prefix of the expected token', async () => {
		expect(await bearerMatches('Bearer secret-12', 'secret-1234')).toBe(false);
	});

	// The mirror case: the expected token plus a suffix. Both directions are rejected without any
	// length branch, which is why there is no length-based timing leak to begin with.
	it('rejects the expected token extended with a suffix', async () => {
		expect(await bearerMatches('Bearer secret-1234x', 'secret-1234')).toBe(false);
	});

	it('rejects a same-length token that differs in one character', async () => {
		expect(await bearerMatches('Bearer secret-1235', 'secret-1234')).toBe(false);
	});

	// Tokens are `crypto.randomUUID()`-ish in production; make sure nothing in the digest path
	// chokes on the real shape or on trailing whitespace sneaking through.
	it('handles a realistic uuid token and rejects it with trailing whitespace', async () => {
		const tok = '7f3c9a2e-1b4d-4c8a-9e0f-2d6b5a1c3e7f';
		expect(await bearerMatches(`Bearer ${tok}`, tok)).toBe(true);
		expect(await bearerMatches(`Bearer ${tok} `, tok)).toBe(false);
	});

	it('returns a promise rather than a sync boolean', () => {
		expect(bearerMatches('Bearer secret-1234', 'secret-1234')).toBeInstanceOf(Promise);
	});
});
