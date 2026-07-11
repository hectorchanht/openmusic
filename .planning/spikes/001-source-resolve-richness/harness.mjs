// Spike 001 — source-resolve-richness harness.
//
// Drives ~20 real songs through EACH source's real /api/* proxy (dev server on :4321),
// replicating each adapter's search + resolve request/parse EXACTLY (ported from
// src/lib/sources/*.ts). Measures, per source per song:
//   searchHit · resolveOk · audioPlayable · coverPresent+coverLoads · lrcPresent · duration
// Writes results.json + report.html and prints a ranking matrix.
//
// FACT spike (benchmark numbers), so stdout/JSON + a static HTML matrix is the right
// deliverable (per spike workflow: "genuinely about a fact, not a feeling").

const BASE = process.env.BASE || 'http://localhost:4321';
const T = (ms) => AbortSignal.timeout(ms);

// ---- 20 real songs: Chinese-mainstream heavy (the app's primary catalog) + English
// mainstream + a couple that lean Western/indie (jamendo/audius territory). ----
const SONGS = [
	{ artist: '周杰伦', title: '稻香' },
	{ artist: '陈奕迅', title: '十年' },
	{ artist: '邓紫棋', title: '光年之外' },
	{ artist: '林俊杰', title: '江南' },
	{ artist: '五月天', title: '突然好想你' },
	{ artist: '李荣浩', title: '模特' },
	{ artist: '薛之谦', title: '演员' },
	{ artist: '田馥甄', title: '小幸运' },
	{ artist: '张学友', title: '吻别' },
	{ artist: '王菲', title: '红豆' },
	{ artist: '毛不易', title: '消愁' },
	{ artist: '周深', title: '大鱼' },
	{ artist: 'Beyond', title: '海阔天空' },
	{ artist: '李宗盛', title: '山丘' },
	{ artist: 'Taylor Swift', title: 'Blank Space' },
	{ artist: 'Ed Sheeran', title: 'Shape of You' },
	{ artist: 'Adele', title: 'Hello' },
	{ artist: 'Coldplay', title: 'Yellow' },
	{ artist: 'Bruno Mars', title: 'The Lazy Song' },
	{ artist: 'Billie Eilish', title: 'bad guy' }
];

const SOURCES = ['netease', 'qq', 'kuwo', 'joox', 'fivesing', 'jamendo', 'audius'];

// --- helpers ---------------------------------------------------------------
const norm = (s) =>
	(s || '')
		.toLowerCase()
		.replace(/[\s\-_.,'"()\[\]!?/]+/g, '')
		.trim();

/** Pick the row best matching the query (token overlap on title+artist); fallback row[0]. */
function pickBest(rows, song) {
	if (!rows.length) return { row: null, idx: -1 };
	const wantT = norm(song.title);
	const wantA = norm(song.artist);
	let best = 0,
		bestIdx = 0;
	rows.forEach((r, i) => {
		const t = norm(r.title);
		const a = norm(r.artist);
		let score = 0;
		if (t && (t.includes(wantT) || wantT.includes(t))) score += 2;
		if (a && (a.includes(wantA) || wantA.includes(a))) score += 1;
		if (score > best) {
			best = score;
			bestIdx = i;
		}
	});
	return { row: rows[bestIdx], idx: bestIdx, matched: best >= 2 };
}

async function getJson(path, ms = 9000) {
	const res = await fetch(BASE + path, { signal: T(ms), headers: { origin: BASE } });
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* non-json (html error page etc.) */
	}
	return { status: res.status, json, text };
}

/** Ranged probe — does this URL serve bytes? For images also flags content-type. Never throws. */
async function probe(u, ms = 8000) {
	if (!u) return { ok: false, reason: 'no-url' };
	// absolute-ize own-origin proxy paths
	const url = u.startsWith('/') ? BASE + u : u;
	try {
		const res = await fetch(url, {
			method: 'GET',
			headers: { Range: 'bytes=0-1' },
			redirect: 'follow',
			signal: T(ms)
		});
		try {
			await res.body?.cancel();
		} catch {
			/* ignore */
		}
		const ct = res.headers.get('content-type') || '';
		const ok = res.ok || res.status === 206 || (res.status >= 200 && res.status < 400);
		return { ok, status: res.status, contentType: ct, isImage: ct.startsWith('image/') };
	} catch (e) {
		return { ok: false, reason: e?.name || String(e) };
	}
}

const lrcOk = (s) => typeof s === 'string' && s.trim().length > 8;

// --- pickQueryParam (netease songid from ?id=) ---
function pickId(rawUrl) {
	if (!rawUrl) return '';
	try {
		return new URL(rawUrl, 'https://x.invalid/').searchParams.get('id') || '';
	} catch {
		const m = String(rawUrl).match(/[?&]id=([^&]+)/);
		return m ? decodeURIComponent(m[1]) : '';
	}
}

// --- per-source runners: return normalized rows + a resolve() ---------------
const RUNNERS = {
	async netease(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(`/api/netease/search?id=${encodeURIComponent(kw)}&limit=10`);
		const arr = Array.isArray(json) ? json : [];
		const rows = arr.map((it) => ({
			title: it.name || '',
			artist: it.artist || '',
			cover: it.pic || null,
			audioUrl: it.url || null,
			lrcUrl: it.lrc || null,
			songid: pickId(it.url)
		}));
		return { rows, kw };
	},
	async qq(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(`/api/qq/search?msg=${encodeURIComponent(kw)}&type=json`);
		const data = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
		const rows = data
			.filter((it) => it.song_mid)
			.map((it) => ({
				title: it.song_title || '',
				artist: it.singer_name || '',
				cover: null,
				audioUrl: null,
				lrcUrl: null,
				songid: it.song_mid
			}));
		return { rows, kw };
	},
	async kuwo(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(
			`/api/kuwo/search?name=${encodeURIComponent(kw)}&page=1&limit=10`
		);
		const data = json?.code === 200 && Array.isArray(json.data) ? json.data : [];
		const rows = data
			.filter((it) => it.rid !== undefined && it.rid !== null && it.rid !== '')
			.map((it) => ({
				title: it.name || '',
				artist: it.artist || '',
				cover: it.pic || null,
				audioUrl: null,
				lrcUrl: null,
				songid: String(it.rid)
			}));
		return { rows, kw };
	},
	async joox(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(`/api/joox/search?msg=${encodeURIComponent(kw)}`);
		const songs =
			json?.code === 200 && Array.isArray(json?.data?.songs) ? json.data.songs : [];
		const rows = songs.map((it, idx) => ({
			title: it['歌曲名称'] || '',
			artist: it['歌手'] || '',
			cover: null,
			audioUrl: null,
			lrc: it['歌词内容'] || null,
			lrcUrl: null,
			songid: it.songmid || it['歌曲ID'] || String(idx + 1),
			_n: idx + 1
		}));
		return { rows, kw };
	},
	async fivesing(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(
			`/api/fivesing/search?keyword=${encodeURIComponent(kw)}&page=1&pagesize=20`
		);
		const list = Array.isArray(json?.list) ? json.list : [];
		const rows = list
			.filter((it) => it.songId != null && it.songId !== '')
			.map((it) => ({
				title: (it.songName || '').replace(/<[^>]+>/g, ''),
				artist: (it.singer || it.originSinger || '').replace(/<[^>]+>/g, ''),
				cover: null,
				audioUrl: null,
				lrcUrl: null,
				songid: String(it.songId),
				_type: it.typeEname === 'fc' || it.typeEname === 'bz' || it.typeEname === 'yc' ? it.typeEname : 'yc'
			}));
		return { rows, kw };
	},
	async jamendo(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(
			`/api/jamendo/search?search=${encodeURIComponent(kw)}&limit=20&offset=0`
		);
		const results = json?.headers?.code === 0 && Array.isArray(json.results) ? json.results : [];
		const rows = results
			.filter((it) => it.id && it.audio)
			.map((it) => ({
				title: it.name || '',
				artist: it.artist_name || '',
				cover: it.image || it.album_image || null,
				audioUrl: it.audio,
				lrcUrl: null,
				songid: String(it.id)
			}));
		return { rows, kw };
	},
	async audius(song) {
		const kw = `${song.artist} ${song.title}`.trim();
		const { json } = await getJson(`/api/audius/search?query=${encodeURIComponent(kw)}`);
		const data = Array.isArray(json?.data) ? json.data : [];
		const rows = data
			.filter((it) => it.id && it.is_streamable !== false)
			.map((it) => ({
				title: it.title || '',
				artist: it.user?.name || '',
				cover: it.artwork?.['480x480'] ?? it.artwork?.['150x150'] ?? null,
				audioUrl: null,
				lrcUrl: null,
				songid: String(it.id),
				duration: typeof it.duration === 'number' ? it.duration : undefined
			}));
		return { rows, kw };
	}
};

const JOOX_ORDER = [
	'Atmos全景声', '无损FLAC', 'Hi-Res无损', '母带无损', 'OGG 320', 'MP3 320',
	'AAC 192', 'OGG 192', 'MP3 128', 'AAC 96', 'AAC 48'
];

// --- resolve the picked row per source; return the enriched fields ----------
async function resolveRow(source, pick, kw) {
	const row = pick.row;
	const out = { audioUrl: null, cover: row.cover || null, lrc: row.lrc || null, duration: row.duration, resolveOk: false, err: null };
	try {
		if (source === 'netease') {
			out.audioUrl = row.audioUrl || `/api/netease/url?id=${encodeURIComponent(row.songid)}`;
			const lrcPath = row.lrcUrl && row.lrcUrl.includes('http') ? row.lrcUrl : `/api/netease/lrc?id=${encodeURIComponent(row.songid)}`;
			const r = await fetch(lrcPath.startsWith('/') ? BASE + lrcPath : lrcPath, { signal: T(9000) });
			const body = await r.text();
			out.lrc = lrcOk(body) ? body : null;
			out.resolveOk = true;
		} else if (source === 'qq') {
			const { json } = await getJson(
				`/api/qq/detail?msg=${encodeURIComponent(kw)}&type=json&mid=${encodeURIComponent(row.songid)}`
			);
			const d = json && typeof json === 'object' && json.song_mid ? json : null;
			if (!d) throw new Error('qq detail invalid');
			out.cover = d.album_pic || d.singer_pic || null;
			out.audioUrl =
				d.song_play_url_sq || d.song_play_url_pq || d.song_play_url_accom || d.song_play_url_hq ||
				d.song_play_url_standard || d.song_play_url_fq || d.song_play_url || null;
			out.lrc = (typeof d.song_lyric === 'string' && d.song_lyric.trim()) ? d.song_lyric : (typeof d.lyric === 'string' ? d.lyric : null);
			out.duration = typeof d.song_play_time === 'number' && d.song_play_time > 0 ? d.song_play_time : undefined;
			out.resolveOk = true;
		} else if (source === 'kuwo') {
			const { json } = await getJson(
				`/api/kuwo/detail?id=${encodeURIComponent(row.songid)}&type=song&level=zp&format=json`
			);
			if (json?.code !== 200 || !json.data) throw new Error('kuwo detail failed');
			const d = json.data;
			out.cover = d.pic || row.cover || null;
			out.audioUrl = d.url || null;
			out.lrc = lrcOk(d.lyric) ? d.lyric : null;
			out.resolveOk = true;
		} else if (source === 'joox') {
			const n = row._n || pick.idx + 1;
			const { json } = await getJson(
				`/api/joox/detail?msg=${encodeURIComponent(kw)}&n=${encodeURIComponent(String(n))}`
			);
			if (json?.code !== 200 || !json.data) throw new Error('joox detail failed');
			const d = json.data;
			const links = d['播放链接'] || {};
			let picked = null;
			for (const name of JOOX_ORDER) {
				if (links[name]) { picked = links[name]; break; }
			}
			if (!picked) { const vals = Object.values(links); picked = vals[0] || null; }
			out.audioUrl = picked;
			out.cover = null; // JOOX detail carries NO cover field
			out.lrc = lrcOk(d['歌词内容']) ? d['歌词内容'] : (lrcOk(row.lrc) ? row.lrc : null);
			out.resolveOk = true;
		} else if (source === 'fivesing') {
			const { json } = await getJson(
				`/api/fivesing/url?songid=${encodeURIComponent(row.songid)}&songtype=${encodeURIComponent(row._type || 'yc')}`
			);
			if (json?.code !== 1000 || !json.data) throw new Error('fivesing url failed');
			const d = json.data;
			out.audioUrl = d.squrl || d.hqurl || d.lqurl || d.squrl_backup || d.hqurl_backup || d.lqurl_backup || null;
			out.cover = null;
			out.lrc = null;
			out.resolveOk = !!out.audioUrl;
		} else if (source === 'jamendo') {
			out.audioUrl = row.audioUrl; // delivered at search
			out.cover = row.cover || null;
			out.resolveOk = !!out.audioUrl;
		} else if (source === 'audius') {
			out.audioUrl = `/api/audius/stream/${encodeURIComponent(row.songid)}`;
			out.cover = row.cover || null;
			out.duration = row.duration;
			out.resolveOk = true;
		}
	} catch (e) {
		out.err = e?.message || String(e);
	}
	return out;
}

// --- main -------------------------------------------------------------------
async function runCell(source, song) {
	const cell = {
		searchHit: false, matched: false, resolveOk: false,
		audioPresent: false, audioPlayable: false,
		coverPresent: false, coverLoads: false,
		lrcPresent: false, durationPresent: false,
		err: null, title: null, artist: null
	};
	try {
		const { rows, kw } = await RUNNERS[source](song);
		cell.searchHit = rows.length > 0;
		if (!rows.length) return cell;
		const pick = pickBest(rows, song);
		if (!pick.row) return cell;
		cell.matched = !!pick.matched;
		cell.title = pick.row.title;
		cell.artist = pick.row.artist;

		const r = await resolveRow(source, pick, kw);
		cell.resolveOk = r.resolveOk;
		cell.err = r.err;
		cell.audioPresent = !!r.audioUrl;
		cell.coverPresent = !!r.cover;
		cell.lrcPresent = lrcOk(r.lrc);
		cell.durationPresent = typeof r.duration === 'number' && r.duration > 0;

		// probe audio + cover concurrently
		const [ap, cp] = await Promise.all([
			r.audioUrl ? probe(r.audioUrl) : Promise.resolve({ ok: false }),
			r.cover ? probe(r.cover) : Promise.resolve({ ok: false })
		]);
		cell.audioPlayable = !!ap.ok;
		cell.audioProbe = ap.status || ap.reason;
		cell.coverLoads = !!cp.ok && (cp.isImage !== false);
		cell.coverProbe = cp.status || cp.reason;
	} catch (e) {
		cell.err = e?.name === 'TimeoutError' ? 'timeout' : e?.message || String(e);
	}
	return cell;
}

async function main() {
	const results = {}; // source -> song-index -> cell
	for (const s of SOURCES) results[s] = [];

	for (let i = 0; i < SONGS.length; i++) {
		const song = SONGS[i];
		// sources in parallel per song
		const cells = await Promise.all(SOURCES.map((s) => runCell(s, song)));
		SOURCES.forEach((s, k) => (results[s][i] = cells[k]));
		const line = SOURCES.map((s, k) => {
			const c = cells[k];
			const rich = [c.audioPlayable, c.coverLoads, c.lrcPresent].filter(Boolean).length;
			return `${s[0]}${c.audioPlayable ? '▶' : c.searchHit ? '·' : '✗'}${rich}`;
		}).join(' ');
		console.log(`${String(i + 1).padStart(2)}. ${song.artist} ${song.title}  |  ${line}`);
	}

	// --- aggregate ---
	const agg = {};
	for (const s of SOURCES) {
		const cells = results[s];
		const n = cells.length;
		const cnt = (f) => cells.filter(f).length;
		agg[s] = {
			searchHit: cnt((c) => c.searchHit),
			matched: cnt((c) => c.matched),
			resolveOk: cnt((c) => c.resolveOk),
			audioPlayable: cnt((c) => c.audioPlayable),
			coverLoads: cnt((c) => c.coverLoads),
			lrcPresent: cnt((c) => c.lrcPresent),
			durationPresent: cnt((c) => c.durationPresent),
			n
		};
	}

	console.log('\n=== AGGREGATE (out of ' + SONGS.length + ') ===');
	console.log('source     search resolve  audio▶  cover  lrc  dur');
	const rank = SOURCES.slice().sort((a, b) => agg[b].audioPlayable - agg[a].audioPlayable);
	for (const s of rank) {
		const a = agg[s];
		console.log(
			`${s.padEnd(10)} ${String(a.searchHit).padStart(4)}  ${String(a.resolveOk).padStart(6)}  ${String(a.audioPlayable).padStart(5)}  ${String(a.coverLoads).padStart(5)}  ${String(a.lrcPresent).padStart(3)}  ${String(a.durationPresent).padStart(3)}`
		);
	}

	const fs = await import('node:fs');
	const url = await import('node:url');
	const dir = url.fileURLToPath(new URL('.', import.meta.url));
	fs.writeFileSync(dir + 'results.json', JSON.stringify({ songs: SONGS, results, agg }, null, 2));
	fs.writeFileSync(dir + 'report.html', buildHtml(SONGS, results, agg, rank));
	console.log('\nWrote results.json + report.html');
}

function buildHtml(songs, results, agg, rank) {
	const cellHtml = (c) => {
		if (!c) return '<td></td>';
		if (!c.searchHit) return '<td class="miss" title="no search hit">—</td>';
		const bits = [
			c.audioPlayable ? 'A' : c.audioPresent ? 'a' : '',
			c.coverLoads ? 'C' : c.coverPresent ? 'c' : '',
			c.lrcPresent ? 'L' : '',
			c.durationPresent ? 'D' : ''
		].filter(Boolean).join('');
		const cls = c.audioPlayable ? 'ok' : c.searchHit ? 'partial' : 'miss';
		const t = `${c.artist||''} — ${c.title||''}${c.err ? ' | err:'+c.err : ''}${c.audioProbe? ' | audio:'+c.audioProbe:''}${c.coverProbe? ' | cover:'+c.coverProbe:''}`;
		return `<td class="${cls}" title="${t.replace(/"/g,'&quot;')}">${bits||'·'}</td>`;
	};
	const rows = songs
		.map((song, i) => {
			return `<tr><td class="song">${song.artist} — ${song.title}</td>${rank
				.map((s) => cellHtml(results[s][i]))
				.join('')}</tr>`;
		})
		.join('\n');
	const aggRow = (label, f) =>
		`<tr class="agg"><td>${label}</td>${rank.map((s) => `<td>${f(agg[s])}</td>`).join('')}</tr>`;
	return `<!doctype html><meta charset=utf8><title>Spike 001 — source resolve richness</title>
<style>
body{font:13px/1.4 -apple-system,system-ui,sans-serif;padding:20px;color:#111;background:#fff}
h1{font-size:18px} table{border-collapse:collapse;margin-top:10px}
td,th{border:1px solid #ddd;padding:3px 7px;text-align:center}
td.song{text-align:left;max-width:220px;font-size:12px}
.ok{background:#d8f5d8} .partial{background:#fff3cd} .miss{background:#f8d7da;color:#999}
tr.agg td{font-weight:700;background:#eef}
.legend{margin-top:12px;color:#555;font-size:12px}
</style>
<h1>Spike 001 — source resolve richness (${songs.length} songs)</h1>
<p class=legend>Cell letters: <b>A</b>=audio plays (probed) · <b>a</b>=audio url only · <b>C</b>=cover loads · <b>c</b>=cover url only · <b>L</b>=lyrics · <b>D</b>=duration. Green=playable, yellow=search hit no play, red=miss. Hover a cell for details.</p>
<table>
<tr><th>song ↓ / source →</th>${rank.map((s) => `<th>${s}</th>`).join('')}</tr>
${rows}
${aggRow('▶ audio playable', (a) => a.audioPlayable + '/' + a.n)}
${aggRow('search hit', (a) => a.searchHit + '/' + a.n)}
${aggRow('cover loads', (a) => a.coverLoads + '/' + a.n)}
${aggRow('lyrics', (a) => a.lrcPresent + '/' + a.n)}
${aggRow('duration', (a) => a.durationPresent + '/' + a.n)}
</table>`;
}

main().catch((e) => {
	console.error('FATAL', e);
	process.exit(1);
});
