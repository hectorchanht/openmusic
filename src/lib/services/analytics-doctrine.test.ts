// analytics-doctrine — structural pins for the Dawn free-apps data doctrine
// (quick-261118-datadoctrine; Hector, 2026-11-18): OpenMusic analytics are
// anonymous TOTALS ONLY — no user IDs, no anon IDs, no IP, no User-Agent
// signals, no per-user event rows.
//
// Behavioural tests (endpoint suites, metric-counter suite) prove what the
// code DOES today; this suite greps the sources so a future edit cannot
// quietly re-introduce tracking: if any banned token returns to the client
// ping module or the three endpoint handlers, this file fails. Same
// source-pin precedent (and stripComments helper) as bulk-download-e2e.test.ts.

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

const SOURCES: Record<string, string> = {
	'src/lib/analytics.ts': stripComments(read('src/lib/analytics.ts')),
	'play/+server.ts': stripComments(read('src/routes/api/analytics/play/+server.ts')),
	'like/+server.ts': stripComments(read('src/routes/api/analytics/like/+server.ts')),
	'download/+server.ts': stripComments(read('src/routes/api/analytics/download/+server.ts'))
};

// Tokens whose presence in executable code would mean per-user data is being
// collected or stored again. (Prose comments name the retired design on
// purpose — they are stripped before the pin applies.)
const BANNED: Record<string, RegExp> = {
	'anon_id field': /anon_id/,
	'anon-id storage key': /openmusic_anon_id/,
	'getAnonId helper': /getAnonId/,
	'user_id column': /user_id/,
	'session resolution': /getUserFromRequest/,
	'User-Agent header read': /user-agent/,
	'CF-IPCountry header read': /cf-ipcountry/i,
	'client address read': /getClientAddress/,
	'retired play_events table': /play_events/,
	'retired like_events table': /like_events/,
	'retired download_events table': /download_events/,
	'accounts DB as analytics target': /ACCOUNTS_DB/
};

describe('analytics doctrine — no per-user tracking can come back silently', () => {
	for (const [name, code] of Object.entries(SOURCES)) {
		for (const [label, pattern] of Object.entries(BANNED)) {
			it(`${name} contains no ${label}`, () => {
				expect(code, name).not.toMatch(pattern);
			});
		}
	}

	it('all three endpoints write through the single counter path', () => {
		for (const name of ['play/+server.ts', 'like/+server.ts', 'download/+server.ts']) {
			expect(SOURCES[name], name).toContain("from '$lib/services/metric-counter'");
			expect(SOURCES[name], name).toContain('bumpMetric(');
		}
	});

	it('the client attaches no credentials to any ping', () => {
		expect(SOURCES['src/lib/analytics.ts']).not.toContain('credentials');
	});
});
