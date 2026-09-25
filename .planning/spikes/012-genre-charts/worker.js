// Spike 012 — genre-chart sources from Cloudflare Workers egress (run via `wrangler dev --remote`).
// GET /?suite=itunes|deezer|env → JSON rows. Legacy iTunes RSS is the only NEW host here; Deezer
// genre charts share api.deezer.com with the prod /api/deezer/chart route and are a control.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const TODAY = Date.parse('2026-09-25');

function medianAge(dates) {
	const a = dates.map((d) => Math.round((TODAY - Date.parse(d)) / 864e5)).filter(Number.isFinite).sort((x, y) => x - y);
	return a.length ? a[a.length >> 1] : null;
}

async function probe(name, url, parse) {
	const t0 = Date.now();
	try {
		const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
		const text = await res.text();
		const base = { name, status: res.status, ms: Date.now() - t0, acao: res.headers.get('access-control-allow-origin'), cc: res.headers.get('cache-control') };
		return res.ok ? { ...base, ...parse(text) } : { ...base, count: 0, bodyHead: text.slice(0, 160) };
	} catch (e) {
		return { name, status: 0, ms: Date.now() - t0, count: 0, error: String(e).slice(0, 160) };
	}
}

// Legacy feed: `entry` is an object (not an array) when there is exactly one row.
function parseItunes(genreId) {
	return (text) => {
		const f = JSON.parse(text).feed;
		const e = [].concat(f.entry || []);
		const onGenre = e.filter((x) => x.category?.attributes?.['im:id'] === String(genreId)).length;
		return {
			count: e.length,
			onGenre, // rows whose own genre id matches the filter — a bogus id silently returns the overall chart
			updated: f.updated?.label,
			medianAgeTop20: medianAge(e.slice(0, 20).map((x) => x['im:releaseDate']?.label)),
			sample: e.slice(0, 3).map((x) => `${x['im:name'].label} — ${x['im:artist'].label}`),
			art: e[0]?.['im:image']?.at(-1)?.label
		};
	};
}

const SUITES = {
	async env() {
		return [await probe('trace', 'https://www.cloudflare.com/cdn-cgi/trace', (t) => ({ count: 1, sample: [t.match(/ip=.*|colo=.*/g).join(' ')] }))];
	},
	async itunes() {
		const out = [];
		for (const [cc, g, n] of [['hk', 1251, 'Cantopop'], ['hk', 1253, 'Mandopop'], ['tw', 1253, 'Mandopop'], ['hk', 51, 'K-Pop'], ['jp', 27, 'J-Pop'], ['hk', 14, 'Pop'], ['hk', 16, 'Soundtrack'], ['hk', 29, 'Anime'], ['us', 18, 'Hip-Hop'], ['hk', 99999, 'bogus id']])
			out.push(await probe(`${cc} ${n} (${g})`, `https://itunes.apple.com/${cc}/rss/topsongs/limit=100/genre=${g}/json`, parseItunes(g)));
		out.push(await probe('hk Cantopop ALBUMS', 'https://itunes.apple.com/hk/rss/topalbums/limit=50/genre=1251/json', parseItunes(1251)));
		return out;
	},
	// Follow-up: itunes.apple.com 403s every genre from the edge. Is it the header set or the IP?
	async itunes403() {
		const u = 'https://itunes.apple.com/hk/rss/topsongs/limit=10/genre=1251/json';
		const variants = [
			['no UA', {}],
			['curl UA', { 'user-agent': 'curl/8.7.1' }],
			['browser UA + accept + lang', { 'user-agent': UA, accept: 'application/json,text/javascript,*/*', 'accept-language': 'zh-HK,en;q=0.8' }],
			['xml format', { 'user-agent': UA }, u.replace(/json$/, 'xml')],
			['no genre (overall)', { 'user-agent': UA }, 'https://itunes.apple.com/hk/rss/topsongs/limit=10/json'],
			['iTunes search API (control)', { 'user-agent': UA }, 'https://itunes.apple.com/search?term=%E5%A7%9C%E6%BF%A4&entity=song&limit=1&country=hk']
		];
		const out = [];
		for (const [n, headers, url = u] of variants) {
			const t0 = Date.now();
			const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
			const body = await res.text();
			out.push({ name: n, status: res.status, ms: Date.now() - t0, count: res.ok ? 1 : 0, server: res.headers.get('server'), bodyHead: body.slice(0, 140) });
		}
		return out;
	},
	async deezer() {
		const out = [];
		for (const [g, n] of [[132, 'Pop'], [116, 'Rap/Hip Hop'], [152, 'Rock'], [113, 'Dance'], [165, 'R&B'], [106, 'Electro'], [16, 'Asian'], [85, 'Alternative']])
			out.push(await probe(`${n} (${g})`, `https://api.deezer.com/chart/${g}/tracks?limit=50`, (t) => {
				const d = JSON.parse(t).data || [];
				return { count: d.length, sample: d.slice(0, 3).map((x) => `${x.title} — ${x.artist?.name}`), art: d[0]?.album?.cover_xl };
			}));
		return out;
	}
};

export default {
	async fetch(req) {
		const fn = SUITES[new URL(req.url).searchParams.get('suite') || 'env'];
		return fn ? Response.json(await fn()) : Response.json({ error: 'unknown suite' }, { status: 404 });
	}
};
