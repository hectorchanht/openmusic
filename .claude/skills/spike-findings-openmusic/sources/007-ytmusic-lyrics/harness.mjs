// Spike 007 — YTMusic lyrics: availability + shape (plain vs timed/synced).
// Path: next(videoId) → find the "Lyrics" tab browseId → browse(browseId) → description runs.
// Metadata endpoints are NOT bot-gated (only player/stream is), so WEB_REMIX works with no auth.
//
// Run: node .planning/spikes/007-ytmusic-lyrics/harness.mjs

import { writeFileSync } from 'node:fs';

const KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const NEXT = 'https://music.youtube.com/youtubei/v1/next?prettyPrint=false&key=' + KEY;
const BROWSE = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false&key=' + KEY;
const CTX = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'US' } };
const H = { 'content-type': 'application/json', origin: 'https://music.youtube.com', referer: 'https://music.youtube.com/' };

async function next(videoId) {
	const r = await fetch(NEXT, {
		method: 'POST',
		headers: H,
		body: JSON.stringify({ context: CTX, videoId, isAudioOnly: true }),
		signal: AbortSignal.timeout(12000)
	});
	return r.json();
}
async function browse(browseId) {
	const r = await fetch(BROWSE, {
		method: 'POST',
		headers: H,
		body: JSON.stringify({ context: CTX, browseId }),
		signal: AbortSignal.timeout(12000)
	});
	return r.json();
}

// Walk the tab list for a tab whose title is "Lyrics" → its browseId (or note if disabled).
function findLyricsTab(nextJson) {
	const tabs =
		nextJson?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
			?.watchNextTabbedResultsRenderer?.tabs ?? [];
	for (const t of tabs) {
		const tr = t?.tabRenderer;
		if (!tr) continue;
		const title = tr?.title ?? '';
		if (/lyric/i.test(title)) {
			const browseId = tr?.endpoint?.browseEndpoint?.browseId ?? null;
			// unselectable tab = no lyrics for this track
			return { title, browseId, disabled: !browseId };
		}
	}
	return { title: null, browseId: null, disabled: true };
}

// Extract lyric text + attribution from a lyrics browse response. Also detect timed-lyrics shape.
function extractLyrics(browseJson) {
	// Classic plain path: musicDescriptionShelfRenderer.description.runs[].text (+ footer attribution)
	let text = null;
	let footer = null;
	let timed = false;
	let timedLineCount = 0;
	const walk = (node) => {
		if (!node || typeof node !== 'object') return;
		if (node.musicDescriptionShelfRenderer) {
			const d = node.musicDescriptionShelfRenderer;
			const runs = d?.description?.runs ?? [];
			if (runs.length) text = runs.map((r) => r.text).join('');
			footer = d?.footer?.runs?.[0]?.text ?? footer;
		}
		// Newer timed-lyrics container (when present): timedLyricsData / musicSyncedLyrics… lines w/ cueRange
		if (node.timedLyricsData || node.musicSyncedLyricsData) {
			timed = true;
			const lines = node.timedLyricsData?.lyricsLines || node.musicSyncedLyricsData?.lines || [];
			timedLineCount = Array.isArray(lines) ? lines.length : 0;
		}
		if (/cueRange/i.test(JSON.stringify(Object.keys(node)))) timed = true;
		for (const k of Object.keys(node)) walk(node[k]);
	};
	walk(browseJson);
	return { text, footer, timed, timedLineCount };
}

const VIDS = [
	['Clairo — Bags', 'l78stHRr2Ps'],
	['Taylor — Blank Space', '-MtKC5wXqdQ'],
	['周杰倫 — 稻香', 'l6a5D6yxqEU'],
	['Hikaru Utada — First Love', 't21dyImwINM']
];

const out = { generatedAt: new Date().toISOString(), results: {} };
for (const [name, vid] of VIDS) {
	try {
		const n = await next(vid);
		const tab = findLyricsTab(n);
		let lyr = { text: null, footer: null, timed: false, timedLineCount: 0 };
		if (tab.browseId) {
			const b = await browse(tab.browseId);
			lyr = extractLyrics(b);
		}
		const chars = lyr.text ? lyr.text.length : 0;
		out.results[name] = {
			videoId: vid,
			lyricsTab: tab.title,
			browseId: tab.browseId,
			disabled: tab.disabled,
			hasPlainLyrics: chars > 0,
			chars,
			timed: lyr.timed,
			timedLineCount: lyr.timedLineCount,
			attribution: lyr.footer,
			preview: lyr.text ? lyr.text.slice(0, 90).replace(/\n/g, ' / ') : null
		};
		console.log(
			`\n${name} (${vid})\n   tab=${tab.title || 'NONE'} disabled=${tab.disabled} plain=${chars > 0}(${chars}c) timed=${lyr.timed} src="${lyr.footer || '—'}"`
		);
		if (lyr.text) console.log(`   "${lyr.text.slice(0, 80).replace(/\n/g, ' / ')}…"`);
	} catch (e) {
		out.results[name] = { videoId: vid, error: e.name + ': ' + e.message };
		console.log(`\n${name} (${vid}) → ERR ${e.name}: ${e.message}`);
	}
}

writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('\n✓ wrote results.json');
