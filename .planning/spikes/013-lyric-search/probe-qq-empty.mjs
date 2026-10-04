// Follow-up: are QQ type-7 empties a soft block or a genuine miss? Prints codes/counts only — never the query.
import { SONGS, lyricLines, variants, sleep, rank } from './testset.mjs';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
async function qq(q, type) {
	const body = { comm: { ct: 19, cv: 1859, uin: '0' }, req: { method: 'DoSearchForQQMusicDesktop', module: 'music.search.SearchCgiService', param: { query: q, num_per_page: 5, page_num: 1, search_type: type } } };
	const r = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', { method: 'POST', headers: { 'user-agent': UA, referer: 'https://y.qq.com/', 'content-type': 'application/json' }, body: JSON.stringify(body) });
	const j = await r.json();
	const list = j.req?.data?.body?.song?.list || [];
	return { code: `${r.status}/${j.code}/${j.req?.code}`, sum: j.req?.data?.meta?.sum, est: j.req?.data?.meta?.estimate_sum, rows: list.map((s) => ({ title: s.name, artist: (s.singer || []).map((a) => a.name).join('/') })) };
}
for (const t of ['囍帖街', '江南', 'Bohemian Rhapsody', '夜に駆ける']) {
	const song = SONGS.find((s) => s.title === t);
	const lines = await lyricLines(song);
	for (const pos of [0.35, 0.65]) {
		const line = lines[Math.floor(lines.length * pos)];
		for (const { v, q } of variants(line)) {
			const a = await qq(q, 7); await sleep(500);
			const b = await qq(q, 0); await sleep(500); // type 0 = general song search
			console.log(`${t.padEnd(18)} p${pos * 100} ${v.padEnd(10)} t7 ${a.code} rows=${a.rows.length} sum=${a.sum} hit=${rank(a.rows, song).exact ?? '·'} | t0 ${b.code} rows=${b.rows.length} hit=${rank(b.rows, song).exact ?? '·'}`);
		}
	}
}
// control: a plain title query right after, to rule out a session-wide block
const c = await qq('富士山下', 7);
console.log('control t7 title-query', c.code, 'rows', c.rows.length);
