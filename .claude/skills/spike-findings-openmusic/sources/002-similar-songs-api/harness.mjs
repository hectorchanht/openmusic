// Spike 002 — similar-songs-api comparison.
//
// Question: can we get similar songs as EXACT {artist, title} pairs directly, instead of
// today's artist-hop (artist.getSimilar → 8× searchAll per artist)?
//
// Compares, per seed track:
//   002a  Last.fm track.getSimilar  → similar TRACKS (name + artist) in ONE call
//   002b  Last.fm artist.getSimilar → similar ARTISTS (baseline first hop), then must search each
//   002c  Deezer related            → related ARTISTS (also artist-hop), then must search each
// Then verifies 002a's pairs are RESOLVABLE in our catalog (kuwo search — the reliable source).
//
// Reads LASTFM_KEY from .dev.vars for the direct track.getSimilar call (no existing /api route
// exposes track.getsimilar). The key is NEVER printed or written to any output file.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:4321';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)); // repo root
const LFM = 'https://ws.audioscrobbler.com/2.0/';

// --- load LASTFM_KEY from .dev.vars (never logged) ---
function loadKey() {
	try {
		const txt = readFileSync(ROOT + '.dev.vars', 'utf8');
		const m = txt.match(/^LASTFM_KEY=(.+)$/m);
		return m ? m[1].trim() : null;
	} catch {
		return null;
	}
}
const KEY = loadKey();

const SEEDS = [
	{ artist: '周杰伦', title: '稻香' },
	{ artist: '陈奕迅', title: '十年' },
	{ artist: '邓紫棋', title: '光年之外' },
	{ artist: '林俊杰', title: '江南' },
	{ artist: '五月天', title: '突然好想你' },
	{ artist: '毛不易', title: '消愁' },
	{ artist: 'Taylor Swift', title: 'Blank Space' },
	{ artist: 'Ed Sheeran', title: 'Shape of You' },
	{ artist: 'Adele', title: 'Hello' },
	{ artist: 'Coldplay', title: 'Yellow' }
];

const T = (ms) => AbortSignal.timeout(ms);

async function lfm(params) {
	const qs = new URLSearchParams({ ...params, api_key: KEY, format: 'json' }).toString();
	const r = await fetch(`${LFM}?${qs}`, { signal: T(10000) });
	return r.json();
}

async function trackGetSimilar(artist, track, limit = 20) {
	try {
		const j = await lfm({ method: 'track.getsimilar', artist, track, autocorrect: '1', limit: String(limit) });
		const arr = j?.similartracks?.track ?? [];
		return arr.map((t) => ({ title: t.name, artist: t.artist?.name || '', match: Number(t.match) || 0 }));
	} catch (e) {
		return { err: e?.name || String(e) };
	}
}

async function artistGetSimilar(artist, limit = 20) {
	try {
		const j = await lfm({ method: 'artist.getsimilar', artist, autocorrect: '1', limit: String(limit) });
		const arr = j?.similarartists?.artist ?? [];
		return arr.map((a) => a.name).filter(Boolean);
	} catch (e) {
		return { err: e?.name || String(e) };
	}
}

async function deezerRelated(artist, limit = 20) {
	try {
		const r = await fetch(
			`${BASE}/api/deezer/related?artist=${encodeURIComponent(artist)}&limit=${limit}`,
			{ signal: T(10000) }
		);
		const j = await r.json();
		return Array.isArray(j?.artists) ? j.artists : [];
	} catch (e) {
		return { err: e?.name || String(e) };
	}
}

// verify a track.getSimilar pair resolves in our catalog via the reliable source (kuwo)
async function kuwoFinds(artist, title) {
	try {
		const kw = `${artist} ${title}`.trim();
		const r = await fetch(`${BASE}/api/kuwo/search?name=${encodeURIComponent(kw)}&page=1&limit=5`, {
			signal: T(9000)
		});
		const j = await r.json();
		const rows = j?.code === 200 && Array.isArray(j.data) ? j.data : [];
		return rows.length > 0;
	} catch {
		return false;
	}
}

const norm = (s) => (s || '').toLowerCase().replace(/[\s\-_.,'"()\[\]!?/]+/g, '');

async function main() {
	if (!KEY) {
		console.log('NO LASTFM_KEY in .dev.vars — cannot run track.getSimilar comparison.');
		process.exit(1);
	}
	console.log('LASTFM_KEY loaded (len=' + KEY.length + '). Running comparison...\n');

	const out = [];
	for (const seed of SEEDS) {
		const [ts, as, dz] = await Promise.all([
			trackGetSimilar(seed.artist, seed.title),
			artistGetSimilar(seed.artist),
			deezerRelated(seed.artist)
		]);
		const tsArr = Array.isArray(ts) ? ts : [];
		const asArr = Array.isArray(as) ? as : [];
		const dzArr = Array.isArray(dz) ? dz : [];

		// verify top-5 track.getSimilar pairs resolve in kuwo
		const top5 = tsArr.slice(0, 5);
		const resolved = await Promise.all(top5.map((t) => kuwoFinds(t.artist, t.title)));
		const resolvableCount = resolved.filter(Boolean).length;

		const rec = {
			seed: `${seed.artist} — ${seed.title}`,
			trackSimilar_count: tsArr.length,
			trackSimilar_top5: top5.map((t) => `${t.artist} — ${t.title}`),
			trackSimilar_top5_resolvable: `${resolvableCount}/${top5.length}`,
			artistSimilar_count: asArr.length,
			artistSimilar_top5: asArr.slice(0, 5),
			deezerRelated_count: dzArr.length
		};
		out.push(rec);

		console.log(`● ${rec.seed}`);
		console.log(`   track.getSimilar : ${tsArr.length} songs | top5 resolvable in kuwo: ${rec.trackSimilar_top5_resolvable}`);
		top5.forEach((t) => console.log(`        - ${t.artist} — ${t.title} (match ${t.match.toFixed(2)})`));
		console.log(`   artist.getSimilar: ${asArr.length} artists (baseline → then 8× searchAll)`);
		console.log(`   deezer related   : ${dzArr.length} artists (also artist-hop)\n`);
	}

	// --- call-count model to build a 10-song up-next list ---
	console.log('=== API-CALL MODEL: build a 10-song Up-Next list ===');
	console.log('track.getSimilar : 1 call → 10 exact {artist,title} pairs (resolve lazily on play).');
	console.log('baseline         : 1 (artist.getSimilar) + 8× searchAll fan-out (each = 4–7 upstream calls) ≈ 33–57 calls.');
	console.log('deezer related   : 1 (related) + N× searchAll (same artist-hop cost as baseline).');

	const totalTS = out.reduce((s, r) => s + r.trackSimilar_count, 0);
	const withData = out.filter((r) => r.trackSimilar_count > 0).length;
	const cnSeeds = out.slice(0, 6);
	const cnWithData = cnSeeds.filter((r) => r.trackSimilar_count > 0).length;
	console.log(`\ntrack.getSimilar coverage: ${withData}/${out.length} seeds returned data (Chinese seeds: ${cnWithData}/6).`);
	console.log(`avg similar songs/seed (when present): ${withData ? (totalTS / withData).toFixed(1) : 0}`);

	const fs = await import('node:fs');
	const dir = fileURLToPath(new URL('.', import.meta.url));
	fs.writeFileSync(dir + 'results.json', JSON.stringify(out, null, 2));
	console.log('\nWrote results.json');
}

main().catch((e) => {
	console.error('FATAL', e);
	process.exit(1);
});
