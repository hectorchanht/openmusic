// Spike 013 — lyric-search targets. ONE module shared by harness.mjs (scored run) and server.mjs
// (paste-a-lyric page), so the two can never query differently.
//
// Every target takes a free-text query and returns { rows: [{title, artist}], ms, status, acao }.
// `acao` = the upstream's access-control-allow-origin header (spike 014 input: can the browser call it
// directly, the way qq detail already does — 32-D-12?).
//
// NOTHING here logs a query. Lyric text must never reach disk or stdout (MANIFEST requirement [013 method]).

const UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
export const DEV = globalThis.process?.env?.DEV_BASE || 'http://localhost:4321'; // workerd has no process (014)
const TOP = 5;
const T = () => AbortSignal.timeout(12000);
const WEB_REMIX_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30'; // public, ships in YTM's web JS (spike 005)

async function timed(fn) {
	const t0 = Date.now();
	try {
		const { rows, status, acao } = await fn();
		return { rows: rows.slice(0, TOP), ms: Date.now() - t0, status, acao: acao ?? null };
	} catch (e) {
		return { rows: [], ms: Date.now() - t0, status: 'ERR', err: String(e?.name || e?.message || e).slice(0, 60) };
	}
}
const acaoOf = (res) => res.headers.get('access-control-allow-origin');
const text = (runs) => (runs || []).map((r) => r.text).join('');

// ---- 013a: Netease official cloudsearch, type=1006 (lyric mode). `search/get/web` is dead abroad. ----
async function netease1006(q) {
	const u = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(q)}&type=1006&limit=${TOP}&offset=0`;
	const res = await fetch(u, { headers: { 'user-agent': UA, referer: 'https://music.163.com/' }, signal: T() });
	const j = await res.json();
	const rows = (j.result?.songs || []).map((s) => ({ title: s.name, artist: (s.ar || []).map((a) => a.name).join(' / ') }));
	return { rows, status: `${res.status}/${j.code}`, acao: acaoOf(res) };
}

// ---- 013b: QQ musicu.fcg, search_type=7 (lyric mode). ----
async function qq7(q) {
	const body = {
		comm: { ct: 19, cv: 1859, uin: '0' },
		req: {
			method: 'DoSearchForQQMusicDesktop',
			module: 'music.search.SearchCgiService',
			param: { query: q, num_per_page: TOP, page_num: 1, search_type: 7 }
		}
	};
	const res = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
		method: 'POST',
		headers: { 'user-agent': UA, referer: 'https://y.qq.com/', 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: T()
	});
	const j = await res.json();
	const rows = (j.req?.data?.body?.song?.list || []).map((s) => ({
		title: s.name || s.title,
		artist: (s.singer || []).map((a) => a.name).join(' / ')
	}));
	return { rows, status: `${res.status}/${j.code}/${j.req?.code}`, acao: acaoOf(res) };
}

// ---- 013c: YouTube Music free text. (i) through OUR /api/ytmusic/search (Songs+Videos chips, the
// shipped contract) and (ii) the unfiltered search (top-result card + shelves), direct InnerTube. ----
function ytRow(r) {
	const cols = r.flexColumns || [];
	const title = text(cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs);
	const sub = cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
	const artists = sub.filter((x) => x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST');
	return { title, artist: (artists.length ? artists : sub.slice(0, 1)).map((x) => x.text).join(' / ') };
}
function ytShelfRows(json) {
	const out = [];
	const tabs = json?.contents?.tabbedSearchResultsRenderer?.tabs || [];
	for (const tab of tabs) {
		for (const sec of tab.tabRenderer?.content?.sectionListRenderer?.contents || []) {
			// Unfiltered search = a top-result card (+ its own rows) then one itemSectionRenderer per row.
			const card = sec.musicCardShelfRenderer;
			if (card) out.push({ title: text(card.title?.runs), artist: text(card.subtitle?.runs).split('•').slice(1, 2).join('').trim(), card: true });
			for (const c of [...(card?.contents || []), ...(sec.musicShelfRenderer?.contents || []), ...(sec.itemSectionRenderer?.contents || [])]) {
				if (c.musicResponsiveListItemRenderer) out.push(ytRow(c.musicResponsiveListItemRenderer));
			}
		}
	}
	return out;
}
async function ytmProxy(q) {
	const res = await fetch(`${DEV}/api/ytmusic/search?q=${encodeURIComponent(q)}`, { signal: T() });
	const j = await res.json();
	const [songs] = j.ytmusicMerged || [];
	return { rows: ytShelfRows(songs), status: res.status };
}
async function ytmTop(q) {
	const res = await fetch(`https://music.youtube.com/youtubei/v1/search?key=${WEB_REMIX_KEY}&prettyPrint=false`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'user-agent': UA, origin: 'https://music.youtube.com' },
		body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'US' } }, query: q }),
		signal: T()
	});
	const j = await res.json();
	return { rows: ytShelfRows(j), status: res.status, acao: acaoOf(res) };
}

// ---- 013d: Genius keyless site search, lyric section. ----
async function genius(q) {
	const res = await fetch(`https://genius.com/api/search/lyric?q=${encodeURIComponent(q)}&per_page=${TOP}`, { headers: { 'user-agent': UA }, signal: T() });
	const j = await res.json();
	const rows = (j.response?.sections?.[0]?.hits || []).map((h) => ({ title: h.result?.title, artist: h.result?.artist_names || h.result?.primary_artist?.name }));
	return { rows, status: res.status, acao: acaoOf(res) };
}

// ---- 013e: BASELINE — today's keyword search proxies, fed the lyric line as a keyword. ----
async function devJson(path) {
	const res = await fetch(`${DEV}${path}`, { signal: T() });
	return { res, j: await res.json().catch(() => null) };
}
async function baseKuwo(q) {
	const { res, j } = await devJson(`/api/kuwo/search?name=${encodeURIComponent(q)}&page=1&limit=${TOP}`);
	return { rows: (Array.isArray(j?.data) ? j.data : []).map((s) => ({ title: s.name, artist: s.artist })), status: res.status };
}
async function baseQq(q) {
	const { res, j } = await devJson(`/api/qq/search?msg=${encodeURIComponent(q)}&type=json`);
	const data = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
	return { rows: data.map((s) => ({ title: s.song_title, artist: s.singer_name })), status: res.status };
}
async function baseNetease(q) {
	const { res, j } = await devJson(`/api/netease/search?id=${encodeURIComponent(q)}&limit=${TOP}`);
	return { rows: (Array.isArray(j) ? j : []).map((s) => ({ title: s.name, artist: Array.isArray(s.artist) ? s.artist.join(' / ') : s.artist })), status: res.status };
}
async function baseJoox(q) {
	const { res, j } = await devJson(`/api/joox/search?msg=${encodeURIComponent(q)}`);
	return { rows: (j?.data?.songs || []).map((s) => ({ title: s['歌曲名称'], artist: s['歌手'] })), status: res.status };
}

export const TARGETS = {
	'a:netease-1006': netease1006,
	'b:qq-type7': qq7,
	'c:ytm-songs(proxy)': ytmProxy,
	'c:ytm-top(direct)': ytmTop,
	'd:genius': genius,
	'e:base-kuwo': baseKuwo,
	'e:base-qq': baseQq,
	'e:base-netease': baseNetease,
	'e:base-joox': baseJoox
};

export async function queryAll(q, only = Object.keys(TARGETS)) {
	const entries = await Promise.all(only.map(async (k) => [k, await timed(() => TARGETS[k](q))]));
	return Object.fromEntries(entries);
}
