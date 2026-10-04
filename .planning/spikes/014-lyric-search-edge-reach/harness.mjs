// Spike 014 — do the 013 lyric-search winners work from Cloudflare Workers egress, survive a burst, and/or
// allow a browser-direct call (CORS)? Needs: the edge worker on :8798 (wrangler dev --remote, see README).
// Run: node harness.mjs   → results.json. Same method as 013: lyric lines are runtime-only, never written.
import { writeFileSync } from 'node:fs';
import { SONGS, rank, lyricLines, sleep } from '../013-lyric-search/testset.mjs';

const EDGE = process.env.EDGE || 'http://127.0.0.1:8798';
const get = (path) => fetch(EDGE + path, { signal: AbortSignal.timeout(60000) }).then((r) => r.json());

// 1) Edge accuracy on the same lines 013 scored locally (full-line variant, p35 + p65).
const trace = await get('/trace');
const rows = [];
for (const song of SONGS) {
	const lines = await lyricLines(song);
	if (!lines || lines.length < 4) continue;
	for (const pos of [0.35, 0.65]) {
		const q = lines[Math.floor(lines.length * pos)];
		const r = await get(`/probe?q=${encodeURIComponent(q)}`);
		const row = { song: `${song.title} / ${song.artist}`, seg: song.seg, line: `p${pos * 100}`, t: {} };
		for (const [k, v] of Object.entries(r)) row.t[k] = { ...rank(v.rows, song), ms: v.ms, status: v.status, n: v.rows.length, err: v.err };
		rows.push(row);
		console.log(song.seg.padEnd(6), song.title.padEnd(18), row.line, Object.entries(row.t).map(([k, x]) => `${k.split(':')[0]}${x.exact ?? '·'}(${x.status})`).join(' '));
		await sleep(400);
	}
}

// 2) Burst: 15 back-to-back calls per target, from the edge. Query = a song TITLE (rate limits don't care
//    what the text is, and a title keeps lyric text out of this step entirely).
const bursts = {};
for (const t of ['a:netease-1006', 'b:qq-type7', 'c:ytm-top(direct)', 'd:genius']) {
	const out = await get(`/burst?t=${encodeURIComponent(t)}&q=${encodeURIComponent('海闊天空')}&n=15`);
	bursts[t] = { ok: out.filter((x) => x.n > 0).length, n: out.length, statuses: [...new Set(out.map((x) => String(x.status)))], p50ms: out.map((x) => x.ms).sort((a, b) => a - b)[7] };
	console.log('burst', t.padEnd(20), JSON.stringify(bursts[t]));
}

// 3) Browser-direct: does each upstream answer a CORS check from our origin? (simple GET with Origin, and
//    the preflight a JSON POST would need). Run from Node — CORS is a header contract, not an IP property.
const ORIGIN = 'https://openmusic.lol';
async function cors(name, url, method = 'GET') {
	const res = await fetch(url, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': method, 'access-control-request-headers': 'content-type' } }).catch((e) => ({ status: 'ERR', headers: new Headers(), e }));
	const simple = await fetch(url, { headers: { origin: ORIGIN } }).catch(() => null);
	return { name, preflight: res.status, preflightAcao: res.headers.get('access-control-allow-origin'), getAcao: simple?.headers.get('access-control-allow-origin') ?? null };
}
const corsChecks = [
	await cors('netease cloudsearch', 'https://music.163.com/api/cloudsearch/pc?s=test&type=1006&limit=1'),
	await cors('qq musicu (POST)', 'https://u.y.qq.com/cgi-bin/musicu.fcg', 'POST'),
	await cors('qq musicu (GET ?data=)', 'https://u.y.qq.com/cgi-bin/musicu.fcg?data=%7B%7D'),
	await cors('genius search/lyric', 'https://genius.com/api/search/lyric?q=test'),
	await cors('ytm search (POST)', 'https://music.youtube.com/youtubei/v1/search', 'POST')
];
corsChecks.forEach((c) => console.log('cors', JSON.stringify(c)));

// summary vs 013 local
const local = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../013-lyric-search/results.json', import.meta.url))).summary;
const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);
const summary = {};
for (const k of Object.keys(rows[0]?.t || {})) {
	const xs = rows.map((r) => r.t[k]);
	summary[k] = { edgeExact5: pct(xs.filter((x) => x.exact).length, xs.length), localExact5_full: local[k]?.byVariant?.full?.exact5 ?? null, empty: xs.filter((x) => x.n === 0).length, errors: xs.filter((x) => x.err).length, statuses: [...new Set(xs.map((x) => String(x.status)))] };
}
console.log('\nedge vs local (full-line exact@5):');
for (const [k, s] of Object.entries(summary)) console.log(k.padEnd(20), `edge ${s.edgeExact5}%  local ${s.localExact5_full}%  empty ${s.empty}  statuses ${s.statuses.join(',')}`);
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ ranAt: new Date().toISOString(), trace, summary, bursts, cors: corsChecks, rows }, null, '\t'));
