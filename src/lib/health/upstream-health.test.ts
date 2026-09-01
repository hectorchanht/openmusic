import { describe, it, expect } from 'vitest';
// The runner lives in scripts/ (a .mjs so CI's Node 22 needs no TS-stripping flag), but its pure
// pieces are exported precisely so they can be tested here rather than only in production.
import {
	CERT_CHECKS,
	PAYLOAD_CHECKS,
	exitCodeFor,
	resolvePath,
	parseArgs
} from '../../../scripts/upstream-health.mjs';

// quick-260831-sh9. This check exists because kuwo's upstream served an expired certificate for
// 4.5 months without producing a single signal. The tests below guard the two properties that
// make the check worth having: it must FAIL when something is really broken, and it must NOT go
// red for things a fallback already covers (a permanently-red check is one people stop reading).

describe('exitCodeFor — only real breakage fails the job', () => {
	it('passes when everything is ok', () => {
		expect(exitCodeFor([{ severity: 'critical', ok: true }, { severity: 'degraded', ok: true }])).toBe(0);
	});

	it('FAILS on a critical failure', () => {
		expect(exitCodeFor([{ severity: 'critical', ok: false }])).toBe(1);
	});

	it('does NOT fail on degraded findings alone — kuwo must not keep the job permanently red', () => {
		expect(exitCodeFor([{ severity: 'degraded', ok: false }, { severity: 'critical', ok: true }])).toBe(0);
	});

	it('passes on an empty result set', () => {
		expect(exitCodeFor([])).toBe(0);
	});
});

describe('resolvePath', () => {
	it('leaves an absolute upstream URL untouched', () => {
		expect(resolvePath('https://api.deezer.com/x', 'https://openmusic.lol')).toBe('https://api.deezer.com/x');
	});

	it('resolves an /api path against the origin (the key-injected probes)', () => {
		expect(resolvePath('/api/similar?artist=X', 'https://openmusic.lol')).toBe(
			'https://openmusic.lol/api/similar?artist=X'
		);
	});

	it('does not double the slash when the origin has a trailing one', () => {
		expect(resolvePath('/api/similar', 'https://openmusic.lol/')).toBe('https://openmusic.lol/api/similar');
	});
});

describe('parseArgs', () => {
	it('defaults to the production origin and a 30-day cert warning', () => {
		expect(parseArgs([])).toEqual({ origin: 'https://openmusic.lol', warnDays: 30 });
	});

	it('honours overrides', () => {
		expect(parseArgs(['--origin', 'http://localhost:4321', '--warn-days', '7'])).toEqual({
			origin: 'http://localhost:4321',
			warnDays: 7
		});
	});

	it('falls back to 30 for a non-numeric warn-days rather than NaN-ing every cert check', () => {
		expect(parseArgs(['--warn-days', 'soon']).warnDays).toBe(30);
	});
});

describe('check tables', () => {
	it('covers every upstream host the app actually depends on', () => {
		const hosts = CERT_CHECKS.map((c: { host: string }) => c.host);
		for (const h of [
			'api.deezer.com',
			'api.qijieya.cn',
			'tang.api.s01s.cn',
			'musicbrainz.org',
			'coverartarchive.org',
			'ws.audioscrobbler.com',
			'kw-api.cenguigui.cn'
		]) {
			expect(hosts).toContain(h);
		}
	});

	it('marks the sources with no fallback as critical', () => {
		const bySeverity = Object.fromEntries(
			CERT_CHECKS.map((c: { host: string; severity: string }) => [c.host, c.severity])
		);
		expect(bySeverity['api.deezer.com']).toBe('critical');
		expect(bySeverity['tang.api.s01s.cn']).toBe('critical');
		// MusicBrainz falls back to Deezer, so its loss is quality-only.
		expect(bySeverity['musicbrainz.org']).toBe('degraded');
	});

	it('gives every check an explanation, so a red line says what breaks for users', () => {
		for (const c of CERT_CHECKS as { why: string }[]) expect(c.why.length).toBeGreaterThan(10);
		for (const p of PAYLOAD_CHECKS as { expects: string }[]) expect(p.expects.length).toBeGreaterThan(10);
	});
});

// The assertions are the whole point — a probe that returns true for any 200 would have missed
// BOTH bugs this month (kuwo's dead upstream and Deezer's namesake shells). These cases feed each
// predicate a realistic good and bad body.
describe('payload assertions actually discriminate', () => {
	const byId = Object.fromEntries(
		(PAYLOAD_CHECKS as { id: string; assert: (b: string) => boolean }[]).map((p) => [p.id, p.assert])
	);

	it('deezer/search rejects the namesake SHELL profiles that broke /related and /artist', () => {
		const shells = JSON.stringify({ data: [{ id: 316813311, name: 'Coldplay', nb_fan: 91 }] });
		const real = JSON.stringify({
			data: [
				{ id: 316813311, name: 'Coldplay', nb_fan: 91 },
				{ id: 892, name: 'Coldplay', nb_fan: 18367520 }
			]
		});
		expect(byId['deezer/search'](shells)).toBe(false);
		expect(byId['deezer/search'](real)).toBe(true);
	});

	it('musicbrainz/artist rejects a low-confidence match, not just a non-200', () => {
		const weak = JSON.stringify({ artists: [{ id: 'a223958d-5c56-4b2c-a30a-87e357bc121b', score: 40 }] });
		const good = JSON.stringify({ artists: [{ id: 'a223958d-5c56-4b2c-a30a-87e357bc121b', score: 100 }] });
		expect(byId['musicbrainz/artist'](weak)).toBe(false);
		expect(byId['musicbrainz/artist'](good)).toBe(true);
	});

	it('netease/qq reject an empty result set', () => {
		expect(byId['netease/search']('[]')).toBe(false);
		expect(byId['netease/search'](JSON.stringify([{ name: 'Yellow', artist: 'Coldplay' }]))).toBe(true);
		expect(byId['qq/search'](JSON.stringify([]))).toBe(false);
		expect(byId['qq/search'](JSON.stringify([{ song_title: 'Yellow', song_mid: 'x' }]))).toBe(true);
	});

	it('lastfm rejects the empty-artists shape a missing LASTFM_KEY produces', () => {
		expect(byId['lastfm/similar (via origin)'](JSON.stringify({ artists: [] }))).toBe(false);
		expect(byId['lastfm/similar (via origin)'](JSON.stringify({ artists: ['Travis'] }))).toBe(true);
	});

	it('every assertion rejects non-JSON garbage instead of throwing', () => {
		for (const p of PAYLOAD_CHECKS as { id: string; assert: (b: string) => boolean }[]) {
			// coverartarchive asserts on byte length, so give it something short.
			expect(() => p.assert('<html>502 Bad Gateway</html>')).not.toThrow();
		}
		expect(byId['deezer/search']('not json at all')).toBe(false);
	});
});
