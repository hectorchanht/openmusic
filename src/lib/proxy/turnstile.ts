// turnstile — server-side Cloudflare Turnstile verification for POST /api/comments (quick-260926-nsz).
//
// The browser widget only produces a token; this is the check that makes it mean anything. A token
// is accepted only when siteverify says `success` AND it was minted for OUR action AND on one of OUR
// hostnames — a token harvested from another site's widget (or another widget of ours) fails the
// action/hostname match even though siteverify itself succeeds. Replay protection is siteverify's:
// tokens are single-use, so a second submission of the same token comes back `success: false`.
//
// Never-throw, three-way verdict. 'unconfigured' (no secret or no hostname allowlist) is distinct
// from 'rejected' so the route can answer 503 for a deployment problem and 403 for a bad token.
// The secret is only ever placed in the siteverify form body — never logged, never returned.

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 10_000;

export type TurnstileVerdict = 'ok' | 'unconfigured' | 'rejected';

/** `TURNSTILE_HOSTNAMES` is a comma list ("openmusic.lol" in production, plus localhost in dev). */
export function parseHostnames(raw: string | undefined): Set<string> {
	return new Set(
		(raw ?? '')
			.split(',')
			.map((h) => h.trim().toLowerCase())
			.filter(Boolean)
	);
}

export async function verifyTurnstile(
	opts: { token: string; ip: string; secret: string | undefined; hostnames: Set<string>; expectedAction: string },
	fetchImpl: typeof fetch = fetch
): Promise<TurnstileVerdict> {
	const { token, ip, secret, hostnames, expectedAction } = opts;
	if (!secret || hostnames.size === 0) return 'unconfigured';
	try {
		const res = await fetchImpl(SITEVERIFY_URL, {
			method: 'POST',
			body: new URLSearchParams({ secret, response: token, remoteip: ip }),
			signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS)
		});
		if (!res.ok) return 'rejected';
		const out = (await res.json()) as { success?: unknown; action?: unknown; hostname?: unknown } | null;
		const ok =
			out?.success === true &&
			out.action === expectedAction &&
			typeof out.hostname === 'string' &&
			hostnames.has(out.hostname.toLowerCase());
		return ok ? 'ok' : 'rejected';
	} catch {
		// Network error, timeout or a non-JSON body: fail CLOSED — an unverifiable token is not a pass.
		return 'rejected';
	}
}
