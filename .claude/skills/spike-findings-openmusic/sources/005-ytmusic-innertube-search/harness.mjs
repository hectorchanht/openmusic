// Spike 005 — YouTube Music InnerTube search from the edge (node-parity harness).
//
// Question: can we hit YT Music's InnerTube search with the public WEB_REMIX key + client
// context, and parse the deeply-nested response into OpenMusic `Track` stubs
// (videoId/title/artist/album/cover)? No auth, no yt-dlp, native fetch only (workerd-parity).
//
// Run: node .planning/spikes/005-ytmusic-innertube-search/harness.mjs
// Writes results.json next to this file.

import { writeFileSync } from 'node:fs';

const KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30'; // public WEB_REMIX key (not a secret; shipped in the YTM web client)
const SEARCH = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false&key=' + KEY;
// Songs-only filter param (InnerTube `params` for the "Songs" chip) — yields a clean song shelf,
// no Top-result / Videos / Albums noise. Stable, widely used by the InnerTune-lineage clients.
const SONGS_FILTER = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';

const CTX = {
	client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'US' }
};

const HEADERS = {
	'content-type': 'application/json',
	origin: 'https://music.youtube.com',
	referer: 'https://music.youtube.com/',
	'user-agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
};

// --- tiny deep-walk helpers (InnerTube JSON is deeply + inconsistently nested) ---
function firstRun(col) {
	// musicResponsiveListItemFlexColumnRenderer.text.runs[0].text
	return col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ?? '';
}
function allRuns(col) {
	return col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
}
function bestThumb(item) {
	const thumbs =
		item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
		item?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
		[];
	if (!thumbs.length) return null;
	// YTM cover URLs are resizable via =w{n}-h{n}; take the largest listed, note we can upscale later.
	return thumbs[thumbs.length - 1]?.url ?? null;
}

// Extract every musicShelfRenderer's rows from the sectionList.
function extractRows(json) {
	const tabs =
		json?.contents?.tabbedSearchResultsRenderer?.tabs ??
		json?.contents?.sectionListRenderer // some responses skip the tab wrapper
			? [{ tabRenderer: { content: json.contents } }]
			: [];
	const rows = [];
	const shelfTitles = [];
	const walk = (node) => {
		if (!node || typeof node !== 'object') return;
		if (node.musicShelfRenderer) {
			const shelf = node.musicShelfRenderer;
			shelfTitles.push(shelf?.title?.runs?.[0]?.text ?? '(untitled shelf)');
			for (const c of shelf.contents ?? []) {
				if (c.musicResponsiveListItemRenderer) rows.push(c.musicResponsiveListItemRenderer);
			}
		}
		for (const k of Object.keys(node)) walk(node[k]);
	};
	walk(json);
	return { rows, shelfTitles: [...new Set(shelfTitles)] };
}

function rowToStub(item, keyword, idx) {
	// videoId lives in the play button overlay (songs) — sometimes in the row's playlistItemData too.
	const videoId =
		item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
			?.playNavigationEndpoint?.watchEndpoint?.videoId ??
		item?.playlistItemData?.videoId ??
		item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
			?.navigationEndpoint?.watchEndpoint?.videoId ??
		null;

	const cols = item?.flexColumns ?? [];
	const title = firstRun(cols[0]);
	// Second column is a mixed run list: "Artist • Album • 3:45" — runs alternate with " • " separators.
	const secondary = allRuns(cols[1])
		.map((r) => r?.text ?? '')
		.filter((t) => t && t.trim() !== ' • ');
	// Heuristic: first meaningful run = artist; a run whose navigationEndpoint is a browse to a
	// MUSIC_PAGE_TYPE_ALBUM = album; a run matching m:ss = duration.
	let artist = '';
	let album = '';
	let durationText = '';
	for (const r of allRuns(cols[1])) {
		const t = (r?.text ?? '').trim();
		if (!t || t === '•') continue;
		const pageType =
			r?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
				?.browseEndpointContextMusicConfig?.pageType ?? '';
		if (/^\d+:\d{2}$/.test(t)) durationText = t;
		else if (pageType === 'MUSIC_PAGE_TYPE_ALBUM') album = t;
		else if (pageType === 'MUSIC_PAGE_TYPE_ARTIST' && !artist) artist = t;
		else if (!artist && !/^\d/.test(t)) artist = t; // fallback: first text run
	}
	if (!artist) artist = secondary[0] ?? '';

	const [m, s] = durationText.split(':');
	const duration = durationText ? Number(m) * 60 + Number(s) : undefined;

	return {
		// OpenMusic Track-stub parity (source id would be 'ytmusic'; songid = videoId)
		uid: videoId ? `ytmusic:${videoId}` : null,
		videoId,
		title,
		artist,
		album,
		cover: bestThumb(item),
		duration,
		keyword,
		displayIndex: idx + 1
	};
}

async function searchSongs(query) {
	const res = await fetch(SEARCH, {
		method: 'POST',
		headers: HEADERS,
		body: JSON.stringify({ context: CTX, query, params: SONGS_FILTER }),
		signal: AbortSignal.timeout(12000)
	});
	const json = await res.json();
	const { rows, shelfTitles } = extractRows(json);
	const stubs = rows.map((r, i) => rowToStub(r, query, i));
	return { status: res.status, shelfTitles, rawRows: rows.length, stubs };
}

const QUERIES = [
	'hikaru utada first love', // JP pop
	'taylor swift blank space', // EN mainstream
	'周杰倫 稻香', // CJK (Jay Chou)
	'clairo bags', // indie
	'aaaasdfghjklqwerty zzz' // nonsense — expect 0 (negative control)
];

const out = { generatedAt: new Date().toISOString(), key: 'WEB_REMIX(public)', queries: {} };
for (const q of QUERIES) {
	try {
		const r = await searchSongs(q);
		// quality checks per query
		const withId = r.stubs.filter((s) => s.videoId).length;
		const withCover = r.stubs.filter((s) => s.cover).length;
		const withArtist = r.stubs.filter((s) => s.artist).length;
		const withAlbum = r.stubs.filter((s) => s.album).length;
		out.queries[q] = {
			status: r.status,
			shelfTitles: r.shelfTitles,
			rawRows: r.rawRows,
			parsed: r.stubs.length,
			withVideoId: withId,
			withCover,
			withArtist,
			withAlbum,
			sample: r.stubs.slice(0, 4)
		};
		console.log(
			`\n"${q}" → status ${r.status} · shelves [${r.shelfTitles.join(', ')}] · rows ${r.rawRows}` +
				`\n   videoId ${withId}/${r.stubs.length} · cover ${withCover} · artist ${withArtist} · album ${withAlbum}`
		);
		for (const s of r.stubs.slice(0, 3)) {
			console.log(`   • ${s.title} — ${s.artist} — ${s.album || '(no album)'} — ${s.videoId} — ${s.duration ?? '?'}s`);
		}
	} catch (e) {
		out.queries[q] = { error: e.name + ': ' + e.message };
		console.log(`\n"${q}" → ERR ${e.name}: ${e.message}`);
	}
}

writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('\n✓ wrote results.json');
