// analytics-doctrine — structural pins for the Dawn free-apps data doctrine.
//
// HISTORY: written 2026-11-18 (quick-261118-datadoctrine) for the TOTALS-ONLY
// doctrine. REVISED — not deleted — 2026-11-22 (quick-261122-pseudo) for
// Hector's 2026-11-20 ruling: OpenMusic now counts distinct users under a
// random, user-resettable PSEUDONYMOUS ID, with real identity never known.
//
// What these pins now hold:
//   1. The COUNTER endpoints (play/like/download/share → metric_counters) are
//      still totals-only — unchanged pins, unchanged posture.
//   2. The PSEUDONYMOUS path (client analytics.ts + pseudo-id.ts, the
//      /api/analytics/event writer, the pseudo-events store, the report route)
//      contains: no IP read or column, no account/session join key, no
//      User-Agent / fingerprint fields, no accounts DB.
//   3. The reset behaviour is present (resetPseudoId + the Settings → About
//      control), and the promise copy is coupled to collection through the one
//      PSEUDO_ANALYTICS_LIVE switch (promise-first ordering).
//
// Behavioural suites prove what the code DOES today; this suite greps the
// sources so a future edit cannot quietly widen collection. Prose comments
// describe banned designs on purpose — they are stripped before pins apply.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf-8');
function stripComments(src: string): string {
	return src
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((l) => !/^\s*\/\//.test(l))
		.join('\n');
}
const code = (p: string) => stripComments(read(p));

// ── 1. counter endpoints: totals only (2026-11-18 pins, unchanged) ─────────────
const COUNTERS: Record<string, string> = {
	'play/+server.ts': code('src/routes/api/analytics/play/+server.ts'),
	'like/+server.ts': code('src/routes/api/analytics/like/+server.ts'),
	'download/+server.ts': code('src/routes/api/analytics/download/+server.ts'),
	// quick-261122-sharefeed: the share-sheet K-factor counters are held to the same doctrine.
	'share/+server.ts': code('src/routes/api/analytics/share/+server.ts')
};
const COUNTER_BANNED: Record<string, RegExp> = {
	'anon_id field': /anon_id/,
	'pseudo_id field': /pseudo_id/,
	'user_id column': /user_id/,
	'session resolution': /getUserFromRequest/,
	'User-Agent header read': /user-agent/i,
	'CF-IPCountry header read': /cf-ipcountry/i,
	'client address read': /getClientAddress/,
	'retired play_events table': /play_events/,
	'retired like_events table': /like_events/,
	'retired download_events table': /download_events/,
	'accounts DB as analytics target': /ACCOUNTS_DB/
};

// ── 2. pseudonymous path: no IP, no account join, no UA fingerprint ────────────
const PSEUDO: Record<string, string> = {
	'src/lib/analytics.ts': code('src/lib/analytics.ts'),
	'src/lib/pseudo-id.ts': code('src/lib/pseudo-id.ts'),
	'pseudo-events.ts': code('src/lib/services/pseudo-events.ts'),
	'pseudo-report.ts': code('src/lib/services/pseudo-report.ts'),
	'event/+server.ts': code('src/routes/api/analytics/event/+server.ts'),
	'report/+server.ts': code('src/routes/api/analytics/report/+server.ts')
};
const PSEUDO_BANNED: Record<string, RegExp> = {
	'client address read': /getClientAddress/,
	'CF-Connecting-IP read': /cf-connecting-ip/i,
	'X-Forwarded-For read': /x-forwarded-for/i,
	'X-Real-IP read': /x-real-ip/i,
	'ip column / field': /\bip_?(addr(ess)?)?\b\s*(TEXT|:)/i,
	'User-Agent read': /user-agent|userAgent/,
	'fingerprint signals': /hardwareConcurrency|deviceMemory|screen\.(width|height)|getContext\(|navigator\.plugins/,
	'account join key': /user_id|account_id/,
	'email field': /\bemail\b/i,
	'session / cookie read': /getUserFromRequest|cookies\.|om_session|credentials/,
	'auth store import': /stores\/auth/,
	'accounts DB': /ACCOUNTS_DB/,
	'legacy anon id': /anon_id|openmusic_anon_id|getAnonId/
};

describe('analytics doctrine — counter endpoints stay totals-only', () => {
	for (const [name, src] of Object.entries(COUNTERS)) {
		for (const [label, pattern] of Object.entries(COUNTER_BANNED)) {
			it(`${name} contains no ${label}`, () => expect(src, name).not.toMatch(pattern));
		}
		it(`${name} writes through the single counter path`, () => {
			expect(src).toContain("from '$lib/services/metric-counter'");
			expect(src).toContain('bumpMetric(');
		});
	}
});

describe('analytics doctrine — pseudonymous path guardrails', () => {
	for (const [name, src] of Object.entries(PSEUDO)) {
		for (const [label, pattern] of Object.entries(PSEUDO_BANNED)) {
			it(`${name} contains no ${label}`, () => expect(src, name).not.toMatch(pattern));
		}
	}

	it('the event writer goes through the single pseudo-events path and the launch switch', () => {
		const src = PSEUDO['event/+server.ts'];
		expect(src).toContain("from '$lib/services/pseudo-events'");
		expect(src).toContain('recordPseudoEvent(');
		expect(src).toContain('isPseudoId(');
		expect(src).toContain('PSEUDO_ANALYTICS_LIVE');
	});

	it('country is the ONLY geo signal, taken from the CF header', () => {
		expect(PSEUDO['event/+server.ts']).toMatch(/coarseCountry\(request\.headers\.get\('cf-ipcountry'\)\)/);
	});

	it('the report route is bearer-gated (fail-closed) and never selects pseudo_id', () => {
		expect(PSEUDO['report/+server.ts']).toContain('bearerMatches(');
		expect(PSEUDO['report/+server.ts']).toContain('ANALYTICS_READ_TOKEN');
		expect(PSEUDO['pseudo-report.ts']).not.toMatch(/SELECT\s+pseudo_id\b(?![\s\S]{0,40}MIN\(day\))/);
	});

	it('the store lives in openmusic-analytics, never the accounts database', () => {
		const wrangler = read('wrangler.jsonc');
		expect(wrangler).toMatch(/"binding": "ANALYTICS_DB",\s*"database_name": "openmusic-analytics"/);
		expect(PSEUDO['event/+server.ts']).toContain('ANALYTICS_DB');
	});
});

describe('analytics doctrine — reset behaviour + promise-first coupling', () => {
	it('the client exposes a reset that mints a fresh random ID', () => {
		expect(PSEUDO['src/lib/pseudo-id.ts']).toMatch(/export function resetPseudoId/);
		expect(PSEUDO['src/lib/pseudo-id.ts']).toContain('crypto.randomUUID()');
	});

	it('Settings → About renders the reset control and the pseudonymous promise', () => {
		const about = code('src/routes/(app)/settings/about/+page.svelte');
		expect(about).toContain('resetPseudoId()');
		expect(about).toContain("t('privacy.resetId')");
		expect(about).toContain("t('free.dataPromisePseudo')");
		expect(about).toContain('PSEUDO_ANALYTICS_LIVE');
	});

	it('/free switches its promise on the same launch flag', () => {
		const free = code('src/routes/(app)/free/+page.svelte');
		expect(free).toMatch(/PSEUDO_ANALYTICS_LIVE \? 'free\.dataPromisePseudo' : 'free\.dataPromise'/);
	});

	it('the client never sends a pseudo event unless the switch is on', () => {
		expect(PSEUDO['src/lib/analytics.ts']).toMatch(/if \(!PSEUDO_ANALYTICS_LIVE\) return;/);
		expect(PSEUDO['src/lib/pseudo-id.ts']).toMatch(/if \(!live\) return null;/);
	});
});
