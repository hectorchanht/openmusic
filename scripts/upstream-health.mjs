// Upstream health check (quick-260831-sh9).
//
// WHY THIS EXISTS: on 2026-08-31 we found that kuwo's upstream (kw-api.cenguigui.cn) had been
// serving an EXPIRED TLS certificate since 2026-04-14 — Cloudflare had been returning 526 for
// every /api/kuwo/* request for four and a half months and nobody noticed. Because kuwo was the
// registry's primary source, that silently emptied the similar-song fallbacks and collapsed
// Up-Next to a random grab-bag for any track Last.fm had no data for.
//
// The bug was not the certificate. The bug was that an upstream could die and stay dead without
// producing a single visible signal. This script is that signal.
//
// TWO KINDS OF CHECK, because the kuwo failure and the /api/translate failure look different:
//   1. CERT   — days until each upstream host's TLS certificate expires. Catches the kuwo class
//               BEFORE it breaks, and would have flagged it on day one.
//   2. PAYLOAD — a real request whose RESPONSE BODY is asserted. A 200 is not proof of health:
//               /api/translate is documented in CLAUDE.md as returning 200 with the originals echoed
//               back, and MusicBrainz answers a rate-limit with 200-shaped errors in some paths.
//               Every probe therefore asserts something only a working upstream can produce.
//
// SEVERITY reflects real user impact given the current fallback chains, so the job fails only
// when something is actually broken for users:
//   critical — no fallback covers it; playback or the whole album/cover layer degrades.
//   degraded — a documented fallback absorbs it (quality drops, nothing breaks).
// kuwo is 'degraded' precisely BECAUSE it is already dead and demoted off the resolve floor; a
// permanently-red check trains people to ignore the whole report, which is how this started.
//
// Run: node scripts/upstream-health.mjs [--origin https://openmusic.lol] [--warn-days 30]
// Exit: 0 all good (or only degraded findings) · 1 a critical check failed.
import tls from 'node:tls';

/** @typedef {'critical'|'degraded'} Severity */

/**
 * @typedef {object} CertCheck
 * @property {string} host
 * @property {Severity} severity
 * @property {string} why  what breaks for users if this host goes away
 */

/**
 * @typedef {object} PayloadCheck
 * @property {string} id
 * @property {Severity} severity
 * @property {string} path      absolute URL, or a /api/... path resolved against --origin
 * @property {(body: string) => boolean} assert
 * @property {string} expects   human description of what `assert` requires
 */

/** Hosts whose certificate expiry we track. */
export const CERT_CHECKS = /** @type {CertCheck[]} */ ([
	{ host: 'api.deezer.com', severity: 'critical', why: 'covers, artist albums, similar artists, radio' },
	{ host: 'api.qijieya.cn', severity: 'critical', why: 'netease — search + resolve floor' },
	{ host: 'tang.api.s01s.cn', severity: 'critical', why: 'qq — search + resolve floor (primary)' },
	{ host: 'musicbrainz.org', severity: 'degraded', why: 'CJK identity + original-script albums; falls back to Deezer' },
	{ host: 'coverartarchive.org', severity: 'degraded', why: 'MusicBrainz album art; falls back to the gradient' },
	{ host: 'ws.audioscrobbler.com', severity: 'degraded', why: 'Last.fm similar/enrich; falls back to Deezer' },
	{ host: 'kw-api.cenguigui.cn', severity: 'degraded', why: 'kuwo — DEAD since 2026-04-14, demoted off the resolve floor' }
]);

/** Parse a JSON body, returning null instead of throwing.
 * @param {string} body
 * @returns {any}
 */
function json(body) {
	try {
		return JSON.parse(body);
	} catch {
		return null;
	}
}

/**
 * Functional probes. Keyless upstreams are hit DIRECTLY (the point is upstream health, not ours).
 * Anything needing an edge-injected secret is probed through our own origin, which also proves the
 * secret is still wired.
 */
export const PAYLOAD_CHECKS = /** @type {PayloadCheck[]} */ ([
	{
		id: 'deezer/search',
		severity: 'critical',
		path: 'https://api.deezer.com/search/artist?q=Coldplay&limit=5',
		expects: 'an artist array containing a high-fan Coldplay',
		// Asserts nb_fan is present, because the namesake-shell bug (fixed 2026-08-31) was invisible
		// to a mere "did it return rows" check — the shells return rows, just useless ones.
		assert: (b) => {
			const d = json(b);
			return Array.isArray(d?.data) && d.data.some((/** @type {any} */ a) => (a?.nb_fan ?? 0) > 1_000_000);
		}
	},
	{
		id: 'netease/search',
		severity: 'critical',
		path: 'https://api.qijieya.cn/meting/?server=netease&type=search&id=Coldplay&limit=5',
		expects: 'a non-empty array of rows carrying name + artist',
		assert: (b) => {
			const d = json(b);
			return Array.isArray(d) && d.length > 0 && typeof d[0]?.name === 'string';
		}
	},
	{
		id: 'qq/search',
		severity: 'critical',
		path: 'https://tang.api.s01s.cn/music_open_api.php?msg=Coldplay&type=json',
		expects: 'rows carrying song_title + song_mid',
		assert: (b) => {
			const d = json(b);
			const rows = Array.isArray(d) ? d : d?.data;
			return Array.isArray(rows) && rows.length > 0 && typeof rows[0]?.song_title === 'string';
		}
	},
	{
		id: 'musicbrainz/artist',
		severity: 'degraded',
		path: 'https://musicbrainz.org/ws/2/artist/?query=%E5%91%A8%E6%9D%B0%E5%80%AB&fmt=json&limit=1',
		expects: 'a score-100 CJK artist match (the identity layer working, not just a 200)',
		assert: (b) => {
			const d = json(b);
			const a = d?.artists?.[0];
			return !!a?.id && (a?.score ?? 0) >= 90;
		}
	},
	{
		id: 'coverartarchive',
		severity: 'degraded',
		// A stable, long-standing release-group (周杰倫 — 最偉大的作品).
		path: 'https://coverartarchive.org/release-group/8770e36c-464b-47ea-9a62-862025d27bf8/front-250',
		expects: 'image bytes (follows the archive.org redirect)',
		assert: (b) => b.length > 1000
	},
	{
		id: 'lastfm/similar (via origin)',
		severity: 'degraded',
		path: '/api/similar?artist=Coldplay&limit=5',
		expects: 'a non-empty artists array — also proves LASTFM_KEY is still injected at the edge',
		assert: (b) => {
			const d = json(b);
			return Array.isArray(d?.artists) && d.artists.length > 0;
		}
	},
	{
		id: 'kuwo/search',
		severity: 'degraded',
		path: 'https://kw-api.cenguigui.cn/?name=Coldplay&page=1&limit=5',
		expects: 'a {code:200,data:[]} search body — EXPECTED TO FAIL until the cert is renewed',
		assert: (b) => {
			const d = json(b);
			return d?.code === 200 && Array.isArray(d?.data);
		}
	}
]);

/**
 * Days until `host`'s TLS certificate expires.
 * Resolves to a negative number for an already-expired cert, or null when the handshake itself
 * fails (which is what an expired cert looks like from a validating client — hence `rejectUnauthorized:
 * false`, so we can still READ the dates of a cert that no longer validates and report WHY).
 * @param {string} host
 * @param {number} [timeoutMs]
 * @returns {Promise<{days: number|null, validTo: string|null, error: string|null}>}
 */
export function certDaysRemaining(host, timeoutMs = 10000) {
	return new Promise((resolve) => {
		let settled = false;
		/** @param {{days: number|null, validTo: string|null, error: string|null}} v */
		const done = (v) => {
			if (!settled) {
				settled = true;
				resolve(v);
			}
		};
		try {
			const socket = tls.connect(
				{ host, port: 443, servername: host, rejectUnauthorized: false, timeout: timeoutMs },
				() => {
					const cert = socket.getPeerCertificate();
					socket.end();
					if (!cert || !cert.valid_to) return done({ days: null, validTo: null, error: 'no peer certificate' });
					const expiry = Date.parse(cert.valid_to);
					if (Number.isNaN(expiry)) return done({ days: null, validTo: cert.valid_to, error: 'unparsable valid_to' });
					const days = Math.floor((expiry - Date.now()) / 86_400_000);
					done({ days, validTo: cert.valid_to, error: null });
				}
			);
			socket.on('timeout', () => {
				socket.destroy();
				done({ days: null, validTo: null, error: 'timeout' });
			});
			socket.on('error', (e) => done({ days: null, validTo: null, error: e?.message ?? 'socket error' }));
		} catch (e) {
			done({ days: null, validTo: null, error: e instanceof Error ? e.message : String(e) });
		}
	});
}

/** Resolve a check path against the origin when it is not already absolute.
 * @param {string} path
 * @param {string} origin
 * @returns {string}
 */
export function resolvePath(path, origin) {
	return /^https?:\/\//i.test(path) ? path : `${origin.replace(/\/+$/, '')}${path}`;
}

/**
 * Decide the overall exit code. ONLY critical failures fail the job — a degraded finding is
 * reported and left visible without training people to ignore a permanently-red check.
 * @param {{severity: Severity, ok: boolean}[]} results
 */
export function exitCodeFor(results) {
	return results.some((r) => r.severity === 'critical' && !r.ok) ? 1 : 0;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
	/**
	 * @param {string} flag
	 * @param {string} fallback
	 * @returns {string}
	 */
	const get = (flag, fallback) => {
		const i = argv.indexOf(flag);
		return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
	};
	return {
		origin: get('--origin', 'https://openmusic.lol'),
		warnDays: Number(get('--warn-days', '30')) || 30
	};
}

// ---- runner ------------------------------------------------------------------------------

async function main() {
	const { origin, warnDays } = parseArgs(process.argv.slice(2));
	/** @type {{severity: Severity, ok: boolean}[]} */
	const results = [];
	/** @param {string} s */
	const line = (s) => console.log(s);

	line(`Upstream health — origin ${origin}, cert warning at <${warnDays}d\n`);

	line('CERTIFICATES');
	for (const c of CERT_CHECKS) {
		const { days, validTo, error } = await certDaysRemaining(c.host);
		const ok = error === null && days !== null && days >= warnDays;
		results.push({ severity: c.severity, ok });
		const status = error
			? `HANDSHAKE FAILED (${error})`
			: days !== null && days < 0
				? `EXPIRED ${Math.abs(days)}d ago (${validTo})`
				: `${days}d left (${validTo})`;
		line(`  ${ok ? 'ok  ' : c.severity === 'critical' ? 'FAIL' : 'warn'}  ${c.host.padEnd(24)} ${status}`);
		if (!ok) line(`        ↳ ${c.why}`);
	}

	line('\nPAYLOADS');
	for (const p of PAYLOAD_CHECKS) {
		const url = resolvePath(p.path, origin);
		let ok = false;
		let detail = '';
		// Retry a rate-limit answer. MusicBrainz throttles at ~1 req/s and replies 503; without
		// this the check goes red on timing alone, and a check that cries wolf is one people stop
		// reading — the precise failure mode this script exists to prevent.
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const res = await fetch(url, {
					redirect: 'follow',
					headers: {
						// MusicBrainz blocks generic agents; harmless everywhere else.
						'User-Agent': 'openmusic-healthcheck/1.0 ( https://openmusic.lol )'
					},
					signal: AbortSignal.timeout(15000)
				});
				if ((res.status === 503 || res.status === 429) && attempt < 2) {
					await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
					continue;
				}
				const body = await res.text();
				ok = res.ok && p.assert(body);
				detail = res.ok
					? ok
						? 'payload ok'
						: `200 but assertion FAILED — expected ${p.expects}`
					: `http ${res.status}`;
			} catch (e) {
				detail = e instanceof Error ? e.message : String(e);
			}
			break;
		}
		results.push({ severity: p.severity, ok });
		line(`  ${ok ? 'ok  ' : p.severity === 'critical' ? 'FAIL' : 'warn'}  ${p.id.padEnd(28)} ${detail}`);
	}

	const criticalFails = results.filter((r) => r.severity === 'critical' && !r.ok).length;
	const degradedFails = results.filter((r) => r.severity === 'degraded' && !r.ok).length;
	line(`\n${criticalFails} critical failure(s), ${degradedFails} degraded finding(s).`);
	if (criticalFails === 0 && degradedFails > 0) {
		line('Degraded findings do not fail this job — a fallback covers each of them.');
	}
	process.exit(exitCodeFor(results));
}

// Only run when executed directly, so the tests can import the pure pieces.
if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
