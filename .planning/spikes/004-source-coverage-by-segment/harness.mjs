// Spike 004 — source-coverage-by-segment.
//
// Extends spike 001 with a DIVERSE corpus (language/region × genre) and aggregates per SEGMENT,
// not just globally. Answers: is kuwo universal, or does joox win Cantonese / jamendo+audius earn
// their place for Western-indie / does any segment have NO good CN source? → a minimal per-segment
// resolution policy (which ONE source first + fallback) that stays fully functional everywhere.
//
// Same method as 001 (CONVENTIONS.md): Node ESM → live /api/* on :4321, replicate each adapter's
// search+resolve request/parse, ranged-probe media + cover URLs for real playability.

const BASE = process.env.BASE || 'http://localhost:4321';
const T = (ms) => AbortSignal.timeout(ms);

// corpus: {artist, title, seg}  — seg = language/region + genre bucket
const SONGS = [
	// Mandarin pop (TW/mainland)
	{ artist: '周杰伦', title: '稻香', seg: 'mando-pop' },
	{ artist: '林俊杰', title: '江南', seg: 'mando-pop' },
	{ artist: '邓紫棋', title: '光年之外', seg: 'mando-pop' },
	{ artist: '李荣浩', title: '模特', seg: 'mando-pop' },
	// Cantonese (HK)
	{ artist: '陈奕迅', title: '富士山下', seg: 'canto' },
	{ artist: '张国荣', title: '风继续吹', seg: 'canto' },
	{ artist: 'Beyond', title: '海阔天空', seg: 'canto' },
	{ artist: '谭咏麟', title: '朋友', seg: 'canto' },
	// CN rock / folk / indie
	{ artist: '五月天', title: '突然好想你', seg: 'cn-rock-indie' },
	{ artist: '赵雷', title: '成都', seg: 'cn-rock-indie' },
	{ artist: '万能青年旅店', title: '杀死那个石家庄人', seg: 'cn-rock-indie' },
	// CN hip-hop
	{ artist: '热狗', title: '差不多先生', seg: 'cn-hiphop' },
	{ artist: 'GAI', title: '天干物燥', seg: 'cn-hiphop' },
	// CN oldies (80-90s)
	{ artist: '邓丽君', title: '月亮代表我的心', seg: 'cn-oldies' },
	{ artist: '罗大佑', title: '光阴的故事', seg: 'cn-oldies' },
	// CN OST
	{ artist: '周深', title: '大鱼', seg: 'cn-ost' },
	{ artist: '张碧晨', title: '年轮', seg: 'cn-ost' },
	// Japanese
	{ artist: '米津玄師', title: 'Lemon', seg: 'japanese' },
	{ artist: 'YOASOBI', title: '夜に駆ける', seg: 'japanese' },
	{ artist: 'LiSA', title: '紅蓮華', seg: 'japanese' },
	// Korean
	{ artist: 'BTS', title: 'Dynamite', seg: 'korean' },
	{ artist: 'BLACKPINK', title: 'How You Like That', seg: 'korean' },
	{ artist: 'IU', title: 'Through the Night', seg: 'korean' },
	// English pop
	{ artist: 'Taylor Swift', title: 'Blank Space', seg: 'en-pop' },
	{ artist: 'Ed Sheeran', title: 'Shape of You', seg: 'en-pop' },
	{ artist: 'Adele', title: 'Hello', seg: 'en-pop' },
	// English rock
	{ artist: 'Coldplay', title: 'Yellow', seg: 'en-rock' },
	{ artist: 'Queen', title: 'Bohemian Rhapsody', seg: 'en-rock' },
	// Hip-hop (EN)
	{ artist: 'Eminem', title: 'Lose Yourself', seg: 'en-hiphop' },
	{ artist: 'Kendrick Lamar', title: 'HUMBLE.', seg: 'en-hiphop' },
	// EDM / electronic
	{ artist: 'Avicii', title: 'Wake Me Up', seg: 'edm' },
	{ artist: 'Alan Walker', title: 'Faded', seg: 'edm' },
	// R&B (EN)
	{ artist: 'The Weeknd', title: 'Blinding Lights', seg: 'en-rnb' },
	{ artist: 'Bruno Mars', title: "That's What I Like", seg: 'en-rnb' },
	// Classical / instrumental
	{ artist: '久石让', title: 'Summer', seg: 'instrumental' },
	{ artist: 'Yiruma', title: 'River Flows in You', seg: 'instrumental' },
	// Latin / Spanish
	{ artist: 'Luis Fonsi', title: 'Despacito', seg: 'latin' },
	{ artist: 'Shakira', title: "Hips Don't Lie", seg: 'latin' }
];

const SOURCES = ['netease', 'qq', 'kuwo', 'joox', 'fivesing', 'jamendo', 'audius'];

const norm = (s) => (s || '').toLowerCase().replace(/[\s\-_.,'"()\[\]!?/]+/g, '').trim();
function pickBest(rows, song) {
	if (!rows.length) return { row: null, idx: -1 };
	const wantT = norm(song.title), wantA = norm(song.artist);
	let best = 0, bestIdx = 0;
	rows.forEach((r, i) => {
		const t = norm(r.title), a = norm(r.artist);
		let s = 0;
		if (t && (t.includes(wantT) || wantT.includes(t))) s += 2;
		if (a && (a.includes(wantA) || wantA.includes(a))) s += 1;
		if (s > best) { best = s; bestIdx = i; }
	});
	return { row: rows[bestIdx], idx: bestIdx, matched: best >= 2 };
}
async function getJson(path, ms = 9000) {
	const res = await fetch(BASE + path, { signal: T(ms), headers: { origin: BASE } });
	const text = await res.text();
	let json = null; try { json = JSON.parse(text); } catch {}
	return { status: res.status, json };
}
async function probe(u, ms = 8000) {
	if (!u) return { ok: false };
	const url = u.startsWith('/') ? BASE + u : u;
	try {
		const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1' }, redirect: 'follow', signal: T(ms) });
		try { await res.body?.cancel(); } catch {}
		const ct = res.headers.get('content-type') || '';
		const ok = res.ok || res.status === 206 || (res.status >= 200 && res.status < 400);
		return { ok, status: res.status, isImage: ct.startsWith('image/') };
	} catch (e) { return { ok: false, reason: e?.name || String(e) }; }
}
const lrcOk = (s) => typeof s === 'string' && s.trim().length > 8;
function pickId(rawUrl) {
	if (!rawUrl) return '';
	try { return new URL(rawUrl, 'https://x.invalid/').searchParams.get('id') || ''; }
	catch { const m = String(rawUrl).match(/[?&]id=([^&]+)/); return m ? decodeURIComponent(m[1]) : ''; }
}

const RUNNERS = {
	async netease(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(`/api/netease/search?id=${encodeURIComponent(kw)}&limit=10`);
		const arr = Array.isArray(json) ? json : [];
		return { kw, rows: arr.map((it) => ({ title: it.name || '', artist: it.artist || '', cover: it.pic || null, audioUrl: it.url || null, lrcUrl: it.lrc || null, songid: pickId(it.url) })) };
	},
	async qq(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(`/api/qq/search?msg=${encodeURIComponent(kw)}&type=json`);
		const data = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
		return { kw, rows: data.filter((it) => it.song_mid).map((it) => ({ title: it.song_title || '', artist: it.singer_name || '', cover: null, audioUrl: null, lrcUrl: null, songid: it.song_mid })) };
	},
	async kuwo(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(`/api/kuwo/search?name=${encodeURIComponent(kw)}&page=1&limit=10`);
		const data = json?.code === 200 && Array.isArray(json.data) ? json.data : [];
		return { kw, rows: data.filter((it) => it.rid != null && it.rid !== '').map((it) => ({ title: it.name || '', artist: it.artist || '', cover: it.pic || null, audioUrl: null, lrcUrl: null, songid: String(it.rid) })) };
	},
	async joox(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(`/api/joox/search?msg=${encodeURIComponent(kw)}`);
		const songs = json?.code === 200 && Array.isArray(json?.data?.songs) ? json.data.songs : [];
		return { kw, rows: songs.map((it, idx) => ({ title: it['歌曲名称'] || '', artist: it['歌手'] || '', cover: null, audioUrl: null, lrc: it['歌词内容'] || null, lrcUrl: null, songid: it.songmid || it['歌曲ID'] || String(idx + 1), _n: idx + 1 })) };
	},
	async fivesing(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(`/api/fivesing/search?keyword=${encodeURIComponent(kw)}&page=1&pagesize=20`);
		const list = Array.isArray(json?.list) ? json.list : [];
		return { kw, rows: list.filter((it) => it.songId != null && it.songId !== '').map((it) => ({ title: (it.songName || '').replace(/<[^>]+>/g, ''), artist: (it.singer || it.originSinger || '').replace(/<[^>]+>/g, ''), cover: null, audioUrl: null, lrcUrl: null, songid: String(it.songId), _type: (it.typeEname === 'fc' || it.typeEname === 'bz' || it.typeEname === 'yc') ? it.typeEname : 'yc' })) };
	},
	async jamendo(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(`/api/jamendo/search?search=${encodeURIComponent(kw)}&limit=20&offset=0`);
		const results = json?.headers?.code === 0 && Array.isArray(json.results) ? json.results : [];
		return { kw, rows: results.filter((it) => it.id && it.audio).map((it) => ({ title: it.name || '', artist: it.artist_name || '', cover: it.image || it.album_image || null, audioUrl: it.audio, lrcUrl: null, songid: String(it.id) })) };
	},
	async audius(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(`/api/audius/search?query=${encodeURIComponent(kw)}`);
		const data = Array.isArray(json?.data) ? json.data : [];
		return { kw, rows: data.filter((it) => it.id && it.is_streamable !== false).map((it) => ({ title: it.title || '', artist: it.user?.name || '', cover: it.artwork?.['480x480'] ?? it.artwork?.['150x150'] ?? null, audioUrl: null, lrcUrl: null, songid: String(it.id), duration: typeof it.duration === 'number' ? it.duration : undefined })) };
	}
};
const JOOX_ORDER = ['Atmos全景声','无损FLAC','Hi-Res无损','母带无损','OGG 320','MP3 320','AAC 192','OGG 192','MP3 128','AAC 96','AAC 48'];

async function resolveRow(source, pick, kw) {
	const row = pick.row;
	const out = { audioUrl: null, cover: row.cover || null, lrc: row.lrc || null, duration: row.duration, resolveOk: false };
	try {
		if (source === 'netease') {
			out.audioUrl = row.audioUrl || `/api/netease/url?id=${encodeURIComponent(row.songid)}`;
			const lrcPath = row.lrcUrl && row.lrcUrl.includes('http') ? row.lrcUrl : `/api/netease/lrc?id=${encodeURIComponent(row.songid)}`;
			const r = await fetch(lrcPath.startsWith('/') ? BASE + lrcPath : lrcPath, { signal: T(9000) });
			const body = await r.text(); out.lrc = lrcOk(body) ? body : null; out.resolveOk = true;
		} else if (source === 'qq') {
			const { json } = await getJson(`/api/qq/detail?msg=${encodeURIComponent(kw)}&type=json&mid=${encodeURIComponent(row.songid)}`);
			const d = json && typeof json === 'object' && json.song_mid ? json : null;
			if (!d) throw new Error('qq detail');
			out.cover = d.album_pic || d.singer_pic || null;
			out.audioUrl = d.song_play_url_sq || d.song_play_url_pq || d.song_play_url_accom || d.song_play_url_hq || d.song_play_url_standard || d.song_play_url_fq || d.song_play_url || null;
			out.lrc = (typeof d.song_lyric === 'string' && d.song_lyric.trim()) ? d.song_lyric : (typeof d.lyric === 'string' ? d.lyric : null);
			out.duration = typeof d.song_play_time === 'number' && d.song_play_time > 0 ? d.song_play_time : undefined;
			out.resolveOk = true;
		} else if (source === 'kuwo') {
			const { json } = await getJson(`/api/kuwo/detail?id=${encodeURIComponent(row.songid)}&type=song&level=zp&format=json`);
			if (json?.code !== 200 || !json.data) throw new Error('kuwo detail');
			const d = json.data; out.cover = d.pic || row.cover || null; out.audioUrl = d.url || null; out.lrc = lrcOk(d.lyric) ? d.lyric : null; out.resolveOk = true;
		} else if (source === 'joox') {
			const n = row._n || pick.idx + 1;
			const { json } = await getJson(`/api/joox/detail?msg=${encodeURIComponent(kw)}&n=${encodeURIComponent(String(n))}`);
			if (json?.code !== 200 || !json.data) throw new Error('joox detail');
			const d = json.data; const links = d['播放链接'] || {}; let picked = null;
			for (const name of JOOX_ORDER) { if (links[name]) { picked = links[name]; break; } }
			if (!picked) { const vals = Object.values(links); picked = vals[0] || null; }
			out.audioUrl = picked; out.cover = null; out.lrc = lrcOk(d['歌词内容']) ? d['歌词内容'] : (lrcOk(row.lrc) ? row.lrc : null); out.resolveOk = true;
		} else if (source === 'fivesing') {
			const { json } = await getJson(`/api/fivesing/url?songid=${encodeURIComponent(row.songid)}&songtype=${encodeURIComponent(row._type || 'yc')}`);
			if (json?.code !== 1000 || !json.data) throw new Error('fivesing url');
			const d = json.data; out.audioUrl = d.squrl || d.hqurl || d.lqurl || d.squrl_backup || d.hqurl_backup || d.lqurl_backup || null; out.cover = null; out.lrc = null; out.resolveOk = !!out.audioUrl;
		} else if (source === 'jamendo') { out.audioUrl = row.audioUrl; out.cover = row.cover || null; out.resolveOk = !!out.audioUrl; }
		else if (source === 'audius') { out.audioUrl = `/api/audius/stream/${encodeURIComponent(row.songid)}`; out.cover = row.cover || null; out.duration = row.duration; out.resolveOk = true; }
	} catch {}
	return out;
}

async function runCell(source, song) {
	const cell = { searchHit: false, matched: false, audioPlayable: false, coverLoads: false, lrcPresent: false, durationPresent: false };
	try {
		const { rows, kw } = await RUNNERS[source](song);
		cell.searchHit = rows.length > 0;
		if (!rows.length) return cell;
		const pick = pickBest(rows, song);
		if (!pick.row) return cell;
		cell.matched = !!pick.matched;
		const r = await resolveRow(source, pick, kw);
		cell.lrcPresent = lrcOk(r.lrc);
		cell.durationPresent = typeof r.duration === 'number' && r.duration > 0;
		const [ap, cp] = await Promise.all([
			r.audioUrl ? probe(r.audioUrl) : Promise.resolve({ ok: false }),
			r.cover ? probe(r.cover) : Promise.resolve({ ok: false })
		]);
		cell.audioPlayable = !!ap.ok;
		cell.coverLoads = !!cp.ok && (cp.isImage !== false);
	} catch {}
	return cell;
}

// richness score for a cell: audio(3, gating) + cover(1) + lrc(1). No audio = 0 (unplayable = useless).
function richness(c) { return c.audioPlayable ? 3 + (c.coverLoads ? 1 : 0) + (c.lrcPresent ? 1 : 0) : 0; }

async function main() {
	const results = {}; for (const s of SOURCES) results[s] = [];
	for (let i = 0; i < SONGS.length; i++) {
		const song = SONGS[i];
		const cells = await Promise.all(SOURCES.map((s) => runCell(s, song)));
		SOURCES.forEach((s, k) => (results[s][i] = cells[k]));
		const line = SOURCES.map((s, k) => { const c = cells[k]; return `${s[0]}${c.audioPlayable ? '▶' : c.searchHit ? '·' : '✗'}${richness(c)}`; }).join(' ');
		console.log(`${String(i + 1).padStart(2)}. [${song.seg.padEnd(14)}] ${song.artist} ${song.title}  |  ${line}`);
	}

	// per-segment aggregation
	const segs = [...new Set(SONGS.map((s) => s.seg))];
	const perSeg = {};
	for (const seg of segs) {
		const idxs = SONGS.map((s, i) => (s.seg === seg ? i : -1)).filter((i) => i >= 0);
		perSeg[seg] = { n: idxs.length, sources: {} };
		for (const s of SOURCES) {
			const cells = idxs.map((i) => results[s][i]);
			perSeg[seg].sources[s] = {
				playable: cells.filter((c) => c.audioPlayable).length,
				cover: cells.filter((c) => c.coverLoads).length,
				lrc: cells.filter((c) => c.lrcPresent).length,
				avgRich: +(cells.reduce((a, c) => a + richness(c), 0) / cells.length).toFixed(1)
			};
		}
	}

	console.log('\n=== PER-SEGMENT WINNER (source ranked by playable, then richness) ===');
	console.log('segment          n  | winner (playable/rich)          | runner-up                | best-CN');
	const policy = {};
	for (const seg of segs) {
		const p = perSeg[seg];
		const ranked = SOURCES.slice().sort((a, b) => (p.sources[b].playable - p.sources[a].playable) || (p.sources[b].avgRich - p.sources[a].avgRich));
		const fmt = (s) => `${s} ${p.sources[s].playable}/${p.sources[s].n}·r${p.sources[s].avgRich}`;
		const CN = ['netease','qq','kuwo','joox','fivesing'];
		const bestCN = CN.slice().sort((a, b) => (p.sources[b].playable - p.sources[a].playable) || (p.sources[b].avgRich - p.sources[a].avgRich))[0];
		policy[seg] = { primary: ranked[0], fallback: ranked[1], bestCN, ranked: ranked.map(fmt) };
		console.log(`${seg.padEnd(15)} ${String(p.n).padStart(2)}  | ${fmt(ranked[0]).padEnd(30)} | ${fmt(ranked[1]).padEnd(24)} | ${bestCN}`);
	}

	console.log('\n=== GLOBAL (of ' + SONGS.length + ') ===');
	const gl = {};
	for (const s of SOURCES) { const cells = results[s]; gl[s] = { playable: cells.filter((c) => c.audioPlayable).length, cover: cells.filter((c) => c.coverLoads).length, lrc: cells.filter((c) => c.lrcPresent).length }; }
	for (const s of SOURCES.slice().sort((a, b) => gl[b].playable - gl[a].playable)) console.log(`${s.padEnd(10)} playable ${gl[s].playable}/${SONGS.length}  cover ${gl[s].cover}  lrc ${gl[s].lrc}`);

	const fs = await import('node:fs'); const url = await import('node:url');
	const dir = url.fileURLToPath(new URL('.', import.meta.url));
	fs.writeFileSync(dir + 'results.json', JSON.stringify({ songs: SONGS, results, perSeg, policy, global: gl }, null, 2));
	console.log('\nWrote results.json');
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
