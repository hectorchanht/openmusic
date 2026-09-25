// Spike 011 — edge reachability of fresh chart sources, run from Cloudflare Workers egress.
// `wrangler dev --remote` executes this ON the Cloudflare network, so every subrequest below
// leaves from a real Workers IP (plus the `CF-Worker` header Cloudflare stamps on subrequests) —
// the same trust position the Pages Functions proxy would have in production.
//
// GET /                 → live HTML report (runs every suite in turn, renders a matrix)
// GET /?suite=<name>    → JSON for one suite. Suites are split so each invocation stays well
//                         under the free-plan 50-subrequest cap.

const BROWSER_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const APPLE = 'https://rss.marketingtools.apple.com/api/v2';
const KKBOX = 'https://kma.kkbox.com/charts/api/v1/daily';
const YT = 'https://charts.youtube.com/youtubei/v1/browse?alt=json';

// ---- shared probe -----------------------------------------------------------------------------

const KEEP_HEADERS = ['content-type', 'cache-control', 'age', 'server', 'x-cache', 'cf-cache-status', 'retry-after'];

async function probe(name, url, { init = {}, parse, ua = BROWSER_UA } = {}) {
	const headers = new Headers(init.headers || {});
	if (ua) headers.set('user-agent', ua);
	const t0 = Date.now();
	try {
		const res = await fetch(url, { ...init, headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
		const text = await res.text();
		const ms = Date.now() - t0;
		const kept = {};
		for (const h of KEEP_HEADERS) if (res.headers.get(h)) kept[h] = res.headers.get(h);
		let parsed = { count: 0, sample: [] };
		if (res.ok && parse) {
			try {
				parsed = parse(text);
			} catch (e) {
				parsed = { count: 0, sample: [], parseError: String(e).slice(0, 160) };
			}
		}
		return {
			name, url: url.replace(/key=[^&]+/, 'key=…'), status: res.status, ms, bytes: text.length,
			headers: kept, ...parsed,
			// A non-OK body is usually the block reason (WAF page, error JSON) — keep a short head.
			bodyHead: res.ok ? undefined : text.slice(0, 240)
		};
	} catch (e) {
		return { name, url, status: 0, ms: Date.now() - t0, error: String(e).slice(0, 200), count: 0, sample: [] };
	}
}

// Ranged GET: does an image URL actually serve from here, without downloading it?
async function probeImage(name, url) {
	if (!url) return { name, status: 0, error: 'no url', count: 0, sample: [] };
	const t0 = Date.now();
	try {
		const res = await fetch(url, { headers: { range: 'bytes=0-1', 'user-agent': BROWSER_UA }, signal: AbortSignal.timeout(10000) });
		await res.body?.cancel();
		return { name, url, status: res.status, ms: Date.now() - t0, headers: { 'content-type': res.headers.get('content-type') }, count: res.ok ? 1 : 0, sample: [] };
	} catch (e) {
		return { name, url, status: 0, ms: Date.now() - t0, error: String(e).slice(0, 200), count: 0, sample: [] };
	}
}

// ---- parsers ----------------------------------------------------------------------------------

function parseApple(text) {
	const feed = JSON.parse(text).feed;
	const r = feed.results || [];
	return {
		count: r.length,
		updated: feed.updated,
		sample: r.slice(0, 3).map((x) => `${x.name} — ${x.artistName}`),
		firstArt: r[0]?.artworkUrl100 || null
	};
}

function parseKkbox(text) {
	const d = JSON.parse(text);
	const charts = d?.data?.charts || {};
	const key = Object.keys(charts)[0];
	const rows = key ? charts[key] : [];
	return {
		count: rows.length,
		updated: d?.data?.date,
		apiCode: d?.code,
		sample: rows.slice(0, 3).map((x) => `${x.song_name ?? x.album_name} — ${x.artist_name}`),
		firstArt: rows[0]?.cover_image?.normal || null
	};
}

// Median / newest / oldest release age in days of a list of YYYY-MM-DD strings.
function ageSummary(dates) {
	const now = Date.now();
	const ages = dates.map((d) => Math.round((now - Date.parse(d)) / 864e5)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
	if (!ages.length) return 'ages: none';
	return `release age days (top ${ages.length}): median=${ages[ages.length >> 1]} newest=${ages[0]} oldest=${ages.at(-1)}`;
}

function findKey(o, k, out = []) {
	if (Array.isArray(o)) for (const v of o) findKey(v, k, out);
	else if (o && typeof o === 'object') for (const [kk, v] of Object.entries(o)) { if (kk === k) out.push(v); findKey(v, k, out); }
	return out;
}

function parseYt(kind) {
	return (text) => {
		const d = JSON.parse(text);
		const views = findKey(d, kind === 'ARTISTS' ? 'artistViews' : 'trackViews')[0] || [];
		const first = views[0];
		return {
			count: views.length,
			sample: views.slice(0, 3).map((x) => kind === 'ARTISTS' ? x.name : `${x.name} — ${(x.artists || []).map((a) => a.name).join(', ')} [${x.encryptedVideoId}]`),
			firstArt: first?.thumbnail?.thumbnails?.at(-1)?.url || null
		};
	};
}

// ---- suites -----------------------------------------------------------------------------------

function ytBody(cc, type, period = 'WEEKLY', clientVersion = '2.0') {
	return JSON.stringify({
		context: { client: { clientName: 'WEB_MUSIC_ANALYTICS', clientVersion, hl: 'en', gl: cc.toUpperCase() } },
		browseId: 'FEmusic_analytics_charts_home',
		query: `perspective=CHART_DETAILS&chart_params_country_code=${cc}&chart_params_chart_type=${type}&chart_params_period_type=${period}`
	});
}
const ytInit = (body, withOrigin = true) => ({
	method: 'POST',
	body,
	headers: {
		'content-type': 'application/json',
		...(withOrigin ? { origin: 'https://charts.youtube.com', referer: 'https://charts.youtube.com/' } : {})
	}
});

const SUITES = {
	// Who/where are we? The egress IP + colo is the whole point of the spike.
	async env() {
		const r = await probe('cdn-cgi/trace', 'https://www.cloudflare.com/cdn-cgi/trace', {
			parse: (t) => {
				const kv = Object.fromEntries(t.trim().split('\n').map((l) => l.split('=')));
				return { count: 1, sample: [`ip=${kv.ip} colo=${kv.colo} loc=${kv.loc} warp=${kv.warp}`] };
			}
		});
		return [r];
	},

	async apple() {
		const out = [];
		for (const cc of ['hk', 'tw', 'jp', 'us', 'cn', 'kr', 'sg'])
			out.push(await probe(`songs ${cc} 50`, `${APPLE}/${cc}/music/most-played/50/songs.json`, { parse: parseApple }));
		out.push(await probe('albums hk 50', `${APPLE}/hk/music/most-played/50/albums.json`, { parse: parseApple }));
		out.push(await probe('albums tw 50', `${APPLE}/tw/music/most-played/50/albums.json`, { parse: parseApple }));
		// Edge cases: max page size, a bad storefront, no user-agent at all (Workers default).
		out.push(await probe('songs hk 100', `${APPLE}/hk/music/most-played/100/songs.json`, { parse: parseApple }));
		out.push(await probe('songs hk 200 (over max?)', `${APPLE}/hk/music/most-played/200/songs.json`, { parse: parseApple }));
		out.push(await probe('songs xx (bad storefront)', `${APPLE}/xx/music/most-played/10/songs.json`, { parse: parseApple }));
		out.push(await probe('songs hk no-UA', `${APPLE}/hk/music/most-played/10/songs.json`, { parse: parseApple, ua: null }));
		// Old host (dead from the Mac: 301 → 405) — confirm it's dead here too.
		out.push(await probe('OLD host rss.applemarketingtools.com', 'https://rss.applemarketingtools.com/api/v2/hk/music/most-played/10/songs.json', { parse: parseApple }));
		// Artwork: the feed gives 100x100; the mzstatic path is resizable → 600x600 for tiles.
		const art = out[0].firstArt;
		out.push(await probeImage('artwork 100 (as given)', art));
		out.push(await probeImage('artwork 600 (resized)', art && art.replace(/\/\d+x\d+bb\./, '/600x600bb.')));
		return out;
	},

	async kkbox() {
		const out = [];
		const q = (p) => `${KKBOX}?${new URLSearchParams({ limit: '50', lang: 'tc', category: '297', ...p })}`;
		for (const terr of ['hk', 'tw', 'sg', 'my', 'jp'])
			out.push(await probe(`song ${terr}`, q({ type: 'song', terr }), { parse: parseKkbox }));
		out.push(await probe('newrelease hk', q({ type: 'newrelease', terr: 'hk' }), { parse: parseKkbox }));
		out.push(await probe('newrelease tw', q({ type: 'newrelease', terr: 'tw' }), { parse: parseKkbox }));
		out.push(await probe('song hk lang=en', q({ type: 'song', terr: 'hk', lang: 'en' }), { parse: parseKkbox }));
		out.push(await probe('song hk cat=390', q({ type: 'song', terr: 'hk', category: '390' }), { parse: parseKkbox }));
		out.push(await probe('song hk cat=320', q({ type: 'song', terr: 'hk', category: '320' }), { parse: parseKkbox }));
		out.push(await probe('song hk limit=100', q({ type: 'song', terr: 'hk', limit: '100' }), { parse: parseKkbox }));
		out.push(await probe('song hk no-UA', q({ type: 'song', terr: 'hk' }), { parse: parseKkbox, ua: null }));
		out.push(await probeImage('cover i.kfs.io', out[0].firstArt));
		return out;
	},

	async yt() {
		const out = [];
		for (const cc of ['hk', 'tw', 'jp', 'us', 'kr'])
			out.push(await probe(`TRACKS ${cc} weekly`, YT, { init: ytInit(ytBody(cc, 'TRACKS')), parse: parseYt('TRACKS') }));
		out.push(await probe('ARTISTS hk weekly', YT, { init: ytInit(ytBody('hk', 'ARTISTS')), parse: parseYt('ARTISTS') }));
		out.push(await probe('ARTISTS tw weekly', YT, { init: ytInit(ytBody('tw', 'ARTISTS')), parse: parseYt('ARTISTS') }));
		out.push(await probe('TRACKS global (ZZ)', YT, { init: ytInit(ytBody('zz', 'TRACKS')), parse: parseYt('TRACKS') }));
		// Edge cases: no origin/referer, no UA, a bogus client version.
		out.push(await probe('TRACKS hk no origin/referer', YT, { init: ytInit(ytBody('hk', 'TRACKS'), false), parse: parseYt('TRACKS') }));
		out.push(await probe('TRACKS hk no-UA', YT, { init: ytInit(ytBody('hk', 'TRACKS')), parse: parseYt('TRACKS'), ua: null }));
		out.push(await probe('TRACKS hk clientVersion=0.1', YT, { init: ytInit(ytBody('hk', 'TRACKS', 'WEEKLY', '0.1')), parse: parseYt('TRACKS') }));
		out.push(await probeImage('thumbnail', out[0].firstArt));
		return out;
	},

	// Follow-up 1 (run1 surprise): Apple had one 15 s timeout in a 15× burst and the 200-row
	// request hung 11 s. 30 more sequential calls → is the tail latency systematic or a blip?
	// Alternate the two hosts to see if the old one (301 → new) behaves differently.
	async apple30() {
		const runs = [];
		for (let i = 0; i < 30; i++) {
			const host = i % 2 ? 'https://rss.applemarketingtools.com/api/v2' : APPLE;
			const r = await probe(i % 2 ? 'old' : 'new', `${host}/hk/music/most-played/50/songs.json`, { parse: parseApple });
			runs.push({ host: r.name, status: r.status, ms: r.ms, n: r.count, cc: r.headers?.['cache-control'], age: r.headers?.age, err: r.error });
		}
		return runs.map((r, i) => ({ name: `#${i} ${r.host}`, status: r.status, ms: r.ms, count: r.n, sample: [`cache-control=${r.cc ?? '-'} age=${r.age ?? '-'}${r.err ? ' ' + r.err : ''}`] }));
	},

	// Follow-up 2: YT global code (ZZ was a 400), YT chart period metadata (how fresh is "weekly"?),
	// KKBOX weekly endpoint + category names, and release-date age of each source's top 20.
	async misc() {
		const out = [];
		for (const cc of ['global', 'GLOBAL', ''])
			out.push(await probe(`YT TRACKS cc="${cc}"`, YT, { init: ytInit(ytBody(cc, 'TRACKS')), parse: parseYt('TRACKS') }));
		out.push(await probe('YT hk period + release ages', YT, {
			init: ytInit(ytBody('hk', 'TRACKS')),
			parse: (t) => {
				const d = JSON.parse(t);
				const views = findKey(d, 'trackViews')[0] || [];
				const periods = findKey(d, 'chartPeriod').concat(findKey(d, 'periodEndDate'), findKey(d, 'endDate')).slice(0, 2);
				const dates = views.slice(0, 20).map((v) => v.releaseDate).filter(Boolean);
				return { count: views.length, sample: [`period=${JSON.stringify(periods).slice(0, 160)}`, ageSummary(dates.map((x) => typeof x === 'object' ? `${x.year}-${String(x.month).padStart(2, '0')}-${String(x.day).padStart(2, '0')}` : x))] };
			}
		}));
		out.push(await probe('KKBOX weekly song hk', `https://kma.kkbox.com/charts/api/v1/weekly?type=song&terr=hk&lang=tc&category=297&limit=50`, { parse: parseKkbox }));
		out.push(await probe('KKBOX daily hk release ages', `${KKBOX}?type=song&terr=hk&lang=tc&category=297&limit=50`, {
			parse: (t) => {
				const rows = JSON.parse(t).data.charts.song;
				return { count: rows.length, sample: [ageSummary(rows.slice(0, 20).map((r) => new Date(r.release_date * 1000).toISOString().slice(0, 10)))] };
			}
		}));
		for (const cc of ['hk', 'tw', 'cn'])
			out.push(await probe(`Apple ${cc} release ages`, `${APPLE}/${cc}/music/most-played/20/songs.json`, {
				parse: (t) => { const r = JSON.parse(t).feed.results; return { count: r.length, sample: [ageSummary(r.map((x) => x.releaseDate))] }; }
			}));
		out.push(await probe('KKBOX page (category names)', 'https://kma.kkbox.com/charts/?terr=hk&lang=en', {
			parse: (t) => {
				const cats = [...t.matchAll(/category=(\d+)[^>]*>\s*([^<]{1,40})</g)].map((m) => `${m[1]}=${m[2].trim()}`);
				return { count: cats.length, sample: [[...new Set(cats)].join(', ').slice(0, 300)] };
			}
		}));
		return out;
	},

	// Rapid-fire the SAME request 15× per source: a WAF / rate limit shows up as a status flip.
	async burst(src) {
		const one = {
			apple: () => probe('apple', `${APPLE}/hk/music/most-played/50/songs.json`, { parse: parseApple }),
			kkbox: () => probe('kkbox', `${KKBOX}?type=song&terr=hk&lang=tc&category=297&limit=50`, { parse: parseKkbox }),
			yt: () => probe('yt', YT, { init: ytInit(ytBody('hk', 'TRACKS')), parse: parseYt('TRACKS') })
		}[src];
		if (!one) return [{ name: 'burst', status: 0, error: 'src must be apple|kkbox|yt', count: 0, sample: [] }];
		const runs = [];
		for (let i = 0; i < 15; i++) runs.push(await one());
		const statuses = {};
		for (const r of runs) statuses[r.status] = (statuses[r.status] || 0) + 1;
		const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
		return [{
			name: `burst ${src} ×15 sequential`, status: runs.every((r) => r.status === 200 && r.count > 0) ? 200 : runs.at(-1).status,
			count: runs.filter((r) => r.count > 0).length,
			sample: [`statuses ${JSON.stringify(statuses)}`, `ms p50=${ms[7]} max=${ms[14]}`],
			ms: ms[7]
		}];
	}
};

// ---- HTTP -------------------------------------------------------------------------------------

const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Edge chart probe</title>
<style>
:root{--bg:#fff;--fg:#111;--mut:#666;--ok:#0a7d32;--bad:#c62828;--line:#e3e3e3}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--mut:#999;--ok:#4cc672;--bad:#ff6b6b;--line:#2a2a2a}}
body{background:var(--bg);color:var(--fg);font:13px/1.4 ui-monospace,Menlo,monospace;margin:0;padding:16px}
h1{font-size:16px}h2{font-size:14px;margin:20px 0 6px}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
.ok{color:var(--ok)}.bad{color:var(--bad)}.mut{color:var(--mut)}
</style>
<h1>Spike 011 — chart sources from Cloudflare edge egress</h1><div id=out>running…</div>
<script>
const suites=[['env'],['apple'],['kkbox'],['yt'],['burst','apple'],['burst','kkbox'],['burst','yt']];
const out=document.getElementById('out');out.textContent='';const all={};
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
(async()=>{for(const [s,src] of suites){const key=src?s+':'+src:s;
 const rows=await fetch('/?suite='+s+(src?'&src='+src:'')).then(r=>r.json()).catch(e=>[{name:key,status:0,error:String(e)}]);
 all[key]=rows;
 out.insertAdjacentHTML('beforeend','<h2>'+esc(key)+'</h2><table><tr><th>probe</th><th>status</th><th>ms</th><th>items</th><th>sample / error</th></tr>'+
 rows.map(r=>{const good=r.status>=200&&r.status<300&&(r.count>0);return '<tr><td>'+esc(r.name)+'</td><td class='+(good?'ok':'bad')+'>'+r.status+'</td><td>'+(r.ms??'')+'</td><td>'+(r.count??'')+'</td><td>'+esc((r.sample||[]).join(' · ')||r.error||r.bodyHead||'')+(r.updated?' <span class=mut>['+esc(r.updated)+']</span>':'')+'</td></tr>'}).join('')+'</table>');}
 window.__results=all;document.title='done';})();
</script>`;

export default {
	async fetch(req) {
		const u = new URL(req.url);
		const suite = u.searchParams.get('suite');
		if (!suite) return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
		const fn = SUITES[suite];
		if (!fn) return Response.json({ error: 'unknown suite' }, { status: 404 });
		const rows = await fn(u.searchParams.get('src'));
		return Response.json(rows, { headers: { 'cache-control': 'no-store' } });
	}
};
