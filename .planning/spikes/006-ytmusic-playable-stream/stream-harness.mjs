// Spike 006 (focused) — ANDROID_VR + visitorData is the client that returns play=OK from a
// datacenter IP. Now answer the three questions that decide the architecture:
//   Q1. Are the audio formats DIRECT urls (no signature cipher to solve)?
//   Q2. Does the URL actually serve audio bytes, and at a usable throughput (n-param throttle)?
//   Q3. IP-LOCK: the url is signed against the requester IP. Does it 403 from a "different client"?
//       (We approximate a different client by stripping/So we reason about proxy-vs-direct <audio>.)
//
// Run: node .planning/spikes/006-ytmusic-playable-stream/stream-harness.mjs [videoId]

import { writeFileSync } from 'node:fs';

const VIDEO_ID = process.argv[2] || 'l78stHRr2Ps';
const KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';

async function getVisitorData() {
	const r = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false&key=' + KEY, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'US' } },
			query: 'music'
		}),
		signal: AbortSignal.timeout(12000)
	});
	const j = await r.json();
	return j?.responseContext?.visitorData || null;
}

async function androidVrPlayer(videoId, visitorData) {
	const ctx = {
		client: {
			clientName: 'ANDROID_VR',
			clientVersion: '1.60.19',
			androidSdkVersion: 32,
			deviceModel: 'Quest 3',
			hl: 'en',
			gl: 'US',
			visitorData
		}
	};
	const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=' + KEY, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'user-agent': 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; Quest 3) gzip'
		},
		body: JSON.stringify({ context: ctx, videoId, contentCheckOk: true, racyCheckOk: true }),
		signal: AbortSignal.timeout(15000)
	});
	return r.json();
}

async function probe(url, label, extraHeaders = {}) {
	const t0 = Date.now();
	try {
		const res = await fetch(url, {
			headers: { range: 'bytes=0-2097151', ...extraHeaders }, // first 2 MB
			signal: AbortSignal.timeout(25000)
		});
		const buf = await res.arrayBuffer();
		const ms = Date.now() - t0;
		const bytes = buf.byteLength;
		const kbps = ms > 0 ? Math.round((bytes / 1024 / (ms / 1000)) * 8) : 0;
		const r = {
			label,
			ok: res.status === 200 || res.status === 206,
			httpStatus: res.status,
			contentType: res.headers.get('content-type'),
			contentRange: res.headers.get('content-range'),
			bytes,
			ms,
			throughputKbps: kbps
		};
		console.log(`   [${label}] ${r.ok ? 'OK' : 'FAIL'} http=${r.httpStatus} bytes=${bytes} ${kbps}kbit/s ${r.contentType} range=${r.contentRange}`);
		return r;
	} catch (e) {
		console.log(`   [${label}] ERR ${e.name}: ${e.message}`);
		return { label, ok: false, err: e.name + ': ' + e.message };
	}
}

const vd = await getVisitorData();
console.log('visitorData:', vd ? vd.slice(0, 24) + '…' : 'NONE');
const json = await androidVrPlayer(VIDEO_ID, vd);
const ps = json?.playabilityStatus;
const audio = (json?.streamingData?.adaptiveFormats ?? [])
	.filter((f) => (f.mimeType || '').startsWith('audio/'))
	.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

console.log(`\nplayability: ${ps?.status} ${ps?.reason || ''}`);
console.log(`audio formats: ${audio.length}`);
const out = {
	generatedAt: new Date().toISOString(),
	videoId: VIDEO_ID,
	playability: ps?.status,
	expiresInSeconds: json?.streamingData?.expiresInSeconds,
	formats: audio.map((f) => ({
		itag: f.itag,
		mime: (f.mimeType || '').split(';')[0],
		codec: (f.mimeType || '').match(/codecs="([^"]+)"/)?.[1],
		bitrate: f.bitrate,
		audioSampleRate: f.audioSampleRate,
		hasDirectUrl: !!f.url,
		ciphered: !!f.signatureCipher,
		urlHasN: f.url ? /[?&]n=/.test(f.url) : false,
		loudnessDb: f.loudnessDb,
		contentLength: f.contentLength
	}))
};
for (const f of out.formats) {
	console.log(
		`   itag ${f.itag} ${f.mime} [${f.codec}] ${Math.round((f.bitrate || 0) / 1000)}kbps ${f.audioSampleRate}Hz direct=${f.hasDirectUrl} cipher=${f.ciphered} n-param=${f.urlHasN} len=${f.contentLength}`
	);
}

// Q2 + Q3: probe the best (highest-bitrate) audio format URL.
const best = audio[0];
const url = best?.url || (best?.signatureCipher ? new URLSearchParams(best.signatureCipher).get('url') : null);
out.bestItag = best?.itag;
out.bestCiphered = !!best?.signatureCipher;
console.log(`\nProbing best itag ${best?.itag} (cipher=${!!best?.signatureCipher}):`);
if (url) {
	// Probe A: straight ranged GET (requester = this sandbox, same IP that signed the url)
	out.probeSameIp = await probe(url, 'same-ip ranged');
	// Probe B: full first-chunk again to gauge n-param throttle consistency
	out.probeSecond = await probe(url, 'repeat (throttle check)');
	// Q3 note: a TRUE different-IP test needs a second host; documented in README. Here we also
	// test whether the url carries an `ip=` param (informational) and whether stripping range works.
	const u = new URL(url);
	out.urlParams = {
		hasIpParam: u.searchParams.has('ip'),
		ipParam: u.searchParams.get('ip'),
		hasMn: u.searchParams.has('mn'),
		host: u.host,
		expire: u.searchParams.get('expire')
	};
	console.log(`\n   url host=${out.urlParams.host} ip-param=${out.urlParams.ipParam} expire=${out.urlParams.expire}`);
} else {
	console.log('   NO URL to probe (all ciphered with no url field)');
}

writeFileSync(new URL('./stream-results.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('\n✓ wrote stream-results.json');
