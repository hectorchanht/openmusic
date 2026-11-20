// diag-auth — the bearer gate for the diagnostic log endpoints (D-01 upload, D-03 read).
//
// FAIL CLOSED. `bearerMatches` returns false for EVERY header when the expected secret is missing
// or blank, so an unconfigured `DIAG_UPLOAD_TOKEN` / `DIAG_READ_TOKEN` locks the door rather than
// removing it (T-33-01). This is the OPPOSITE posture from the optional-key routes elsewhere in
// `$lib/proxy` (e.g. the Last.fm-backed `/api/similar`, which degrades to "no data" when its key is
// absent). Fail-open is right there — a missing key costs a recommendation. It is wrong here — a
// missing key would publish every user's activity log to the internet.
//
// WHY NOT `crypto.subtle.timingSafeEqual`: it is a Cloudflare-only Web Crypto extension and does
// not exist on Node 22. Using it would mean this security control's production path could not run
// under the project's single node Vitest project — the tested path would be a stand-in for the
// deployed one, which for an auth check is worse than a slightly hand-rolled compare.
// `crypto.subtle.digest` and `TextEncoder` are globals on BOTH workerd and Node 22, so the path the
// tests exercise below IS the path that runs at the edge.
//
// Comparing DIGESTS rather than raw strings means both operands are always exactly 32 bytes, so
// there is no length-mismatch branch that could leak the token's length, and the XOR accumulation
// never early-exits on the first differing byte (T-33-08). Remote timing over the internet is
// infeasible against this anyway; it costs ~10 lines, so we pay it.

/** SHA-256 of a UTF-8 string, as raw bytes. Both globals exist on workerd and Node 22. */
async function sha256(s: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** True only when `header` is exactly `Bearer <expected>`. False whenever `expected` is unset. */
export async function bearerMatches(
	header: string | null,
	expected: string | undefined
): Promise<boolean> {
	// Order is load-bearing: the unconfigured-secret check comes first and short-circuits, so a
	// deployment missing its binding can never reach the comparison at all.
	if (!expected) return false;
	if (!header?.startsWith('Bearer ')) return false;
	const presented = header.slice('Bearer '.length);
	if (!presented) return false;

	const [a, b] = await Promise.all([sha256(presented), sha256(expected)]);
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}
