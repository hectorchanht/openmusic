// Spike 006 — THE WALL: can we extract a PLAYABLE audio stream URL for a videoId, from the edge,
// with no yt-dlp / no native? Tests multiple InnerTube client contexts to find one that returns
// real adaptiveFormats with DIRECT urls (no signature cipher), then probes whether the URL serves
// audio bytes and at what throughput.
//
// Run: node .planning/spikes/006-ytmusic-playable-stream/player-harness.mjs [videoId]

import { writeFileSync } from 'node:fs';

const VIDEO_ID = process.argv[2] || 'l78stHRr2Ps'; // Clairo — Bags (from spike 005)
const KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30'; // WEB_REMIX public key (works for player too)
const PLAYER = 'https://music.youtube.com/youtubei/v1/player?prettyPrint=false&key=' + KEY;

// Candidate clients. The extractor community (yt-dlp/NewPipe) finds these return direct (uncipher'd)
// urls without a PoToken, whereas WEB/WEB_REMIX now gate formats behind BotGuard/PoToken.
const CLIENTS = {
	ANDROID_MUSIC: {
		context: { client: { clientName: 'ANDROID_MUSIC', clientVersion: '6.42.52', androidSdkVersion: 33, hl: 'en', gl: 'US' } },
		ua: 'com.google.android.apps.youtube.music/6.42.52 (Linux; U; Android 13) gzip'
	},
	ANDROID_VR: {
		context: { client: { clientName: 'ANDROID_VR', clientVersion: '1.60.19', androidSdkVersion: 32, deviceModel: 'Quest 3', hl: 'en', gl: 'US' } },
		ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; Quest 3) gzip'
	},
	IOS: {
		context: { client: { clientName: 'IOS', clientVersion: '19.45.4', deviceModel: 'iPhone16,2', hl: 'en', gl: 'US' } },
		ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)'
	},
	TVHTML5_EMBED: {
		context: {
			client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en', gl: 'US' },
			thirdParty: { embedUrl: 'https://www.youtube.com/' }
		},
		ua: 'Mozilla/5.0'
	},
	WEB_REMIX: {
		context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'US' } },
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'
	}
};

async function callPlayer(name, cfg) {
	const body = {
		context: cfg.context,
		videoId: VIDEO_ID,
		playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
		contentCheckOk: true,
		racyCheckOk: true
	};
	const res = await fetch(PLAYER, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'user-agent': cfg.ua, origin: 'https://music.youtube.com' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(15000)
	});
	const json = await res.json();
	const ps = json?.playabilityStatus;
	const sd = json?.streamingData;
	const adaptive = sd?.adaptiveFormats ?? [];
	const audio = adaptive.filter((f) => (f.mimeType || '').startsWith('audio/'));
	const summarize = (f) => ({
		itag: f.itag,
		mime: (f.mimeType || '').split(';')[0],
		bitrate: f.bitrate,
		hasDirectUrl: !!f.url,
		ciphered: !!f.signatureCipher,
		urlHasN: f.url ? /[?&]n=/.test(f.url) : (f.signatureCipher ? /n%3D|[?&]n=/.test(f.signatureCipher) : false),
		approxDurMs: f.approxDurationMs
	});
	return {
		status: res.status,
		playability: ps?.status,
		reason: ps?.reason || ps?.errorScreen?.playerErrorMessageRenderer?.reason?.runs?.[0]?.text || null,
		audioCount: audio.length,
		audioFormats: audio.map(summarize),
		// pick the best audio format object (highest bitrate) for the byte-probe
		best: audio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] || null
	};
}

// Extract a usable url from a format (direct only for now — cipher handling is a separate finding).
function urlOf(fmt) {
	if (!fmt) return null;
	if (fmt.url) return fmt.url;
	if (fmt.signatureCipher) {
		// signatureCipher = "s=<sig>&sp=signature&url=<encoded>". Without deciphering `s`, the url
		// alone is usually 403. Return the raw url so we can PROVE it 403s (documents the cipher wall).
		const p = new URLSearchParams(fmt.signatureCipher);
		return p.get('url');
	}
	return null;
}

// Ranged byte-probe: does the URL actually serve audio? Measure throughput on the first ~1MB.
async function probeUrl(url) {
	if (!url) return { ok: false, note: 'no url' };
	const t0 = Date.now();
	try {
		const res = await fetch(url, {
			headers: { range: 'bytes=0-1048575' }, // first 1 MB
			signal: AbortSignal.timeout(20000)
		});
		const buf = await res.arrayBuffer();
		const ms = Date.now() - t0;
		const bytes = buf.byteLength;
		const kbps = ms > 0 ? Math.round((bytes / 1024 / (ms / 1000)) * 8) : 0; // kbit/s
		return {
			ok: res.status === 200 || res.status === 206,
			httpStatus: res.status,
			contentType: res.headers.get('content-type'),
			acceptRanges: res.headers.get('accept-ranges'),
			contentRange: res.headers.get('content-range'),
			bytes,
			ms,
			throughputKbps: kbps
		};
	} catch (e) {
		return { ok: false, err: e.name + ': ' + e.message, ms: Date.now() - t0 };
	}
}

const out = { generatedAt: new Date().toISOString(), videoId: VIDEO_ID, clients: {} };
console.log(`\n=== Spike 006: player extraction for videoId=${VIDEO_ID} ===`);
for (const [name, cfg] of Object.entries(CLIENTS)) {
	try {
		const r = await callPlayer(name, cfg);
		out.clients[name] = r;
		console.log(
			`\n[${name}] http ${r.status} · playability ${r.playability}${r.reason ? ' (' + r.reason + ')' : ''} · audio formats ${r.audioCount}`
		);
		for (const f of r.audioFormats.slice(0, 4)) {
			console.log(
				`   itag ${f.itag} ${f.mime} ${Math.round((f.bitrate || 0) / 1000)}kbps direct=${f.hasDirectUrl} cipher=${f.ciphered} n-param=${f.urlHasN}`
			);
		}
		// probe the best audio url
		if (r.best) {
			const fullFmt = r.best; // note: summarized; re-fetch url from raw below
		}
	} catch (e) {
		out.clients[name] = { error: e.name + ': ' + e.message };
		console.log(`\n[${name}] ERR ${e.name}: ${e.message}`);
	}
}

// Second pass: for each client that produced audio, re-call to get the RAW format object and probe its URL.
console.log(`\n=== Byte-probes (first 1 MB, throughput) ===`);
for (const [name, cfg] of Object.entries(CLIENTS)) {
	if (!out.clients[name] || out.clients[name].error || !out.clients[name].audioCount) continue;
	try {
		// re-call to get raw formats (we only summarized above)
		const body = { context: cfg.context, videoId: VIDEO_ID, contentCheckOk: true, racyCheckOk: true };
		const res = await fetch(PLAYER, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'user-agent': cfg.ua },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15000)
		});
		const json = await res.json();
		const audio = (json?.streamingData?.adaptiveFormats ?? [])
			.filter((f) => (f.mimeType || '').startsWith('audio/'))
			.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
		const best = audio[0];
		const url = urlOf(best);
		const probe = await probeUrl(url);
		out.clients[name].probe = { itag: best?.itag, ciphered: !!best?.signatureCipher, ...probe };
		console.log(
			`[${name}] itag ${best?.itag} cipher=${!!best?.signatureCipher} → ${probe.ok ? 'PLAYS' : 'FAIL'} ` +
				`http=${probe.httpStatus ?? probe.err} bytes=${probe.bytes ?? 0} ${probe.throughputKbps ? probe.throughputKbps + 'kbit/s' : ''} ${probe.contentType ?? ''}`
		);
	} catch (e) {
		console.log(`[${name}] probe ERR ${e.name}: ${e.message}`);
	}
}

writeFileSync(new URL('./player-results.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('\n✓ wrote player-results.json');
