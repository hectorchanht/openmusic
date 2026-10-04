// Spike 013/014 — shared test set: song identities (no lyrics), matching, runtime lyric-line picking.
// Imported by 013 harness.mjs and 014 harness.mjs so both score identically.
export const T2S = (await import('tongwen-dict/dist/t2s-char.min.json', { with: { type: 'json' } })).default;
export const S2T = (await import('tongwen-dict/dist/s2t-char.min.json', { with: { type: 'json' } })).default;
export const mapChars = (m, x) => [...x].map((c) => m[c] ?? c).join('');

// Identity only — titles + artists, no lyrics. `seg` mirrors spike 004's segment idea.
export const SONGS = [
	{ seg: 'canto', title: '富士山下', artist: '陳奕迅', artists: ['Eason Chan'] },
	{ seg: 'canto', title: '海闊天空', artist: 'Beyond' },
	{ seg: 'canto', title: '囍帖街', artist: '謝安琪', artists: ['Kay Tse'], titles: ['喜帖街'] },
	{ seg: 'canto', title: '少女的祈禱', artist: '楊千嬅', artists: ['Miriam Yeung'] },
	{ seg: 'mando', title: '稻香', artist: '周杰倫', artists: ['Jay Chou'] },
	{ seg: 'mando', title: '倔強', artist: '五月天', artists: ['Mayday'] },
	{ seg: 'mando', title: '江南', artist: '林俊傑', artists: ['JJ Lin'] },
	{ seg: 'mando', title: '消愁', artist: '毛不易', artists: ['Mao Buyi'] },
	{ seg: 'mando', title: '光年之外', artist: '鄧紫棋', artists: ['G.E.M.'] },
	{ seg: 'mando', title: '若月亮沒來', artist: '王宇宙Leto', artists: ['王宇宙', 'Leto'] },
	{ seg: 'en', title: 'Bohemian Rhapsody', artist: 'Queen' },
	{ seg: 'en', title: 'Someone Like You', artist: 'Adele' },
	{ seg: 'en', title: 'Shape of You', artist: 'Ed Sheeran' },
	{ seg: 'en', title: 'Love Story', artist: 'Taylor Swift' },
	{ seg: 'jp', title: 'Lemon', artist: '米津玄師', artists: ['Kenshi Yonezu'] },
	{ seg: 'jp', title: '夜に駆ける', artist: 'YOASOBI', titles: ['Yoru ni Kakeru', 'Racing into the Night'] },
	{ seg: 'kr', title: '밤편지', artist: 'IU', artists: ['아이유'], titles: ['Through the Night'] },
	{ seg: 'kr', title: 'Dynamite', artist: 'BTS', artists: ['방탄소년단'] }
];

// ---- matching (title-alias contained in the row title; artist-alias contained in the row artist) ----
export const N = (s) => mapChars(T2S, String(s || '').toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, '');
const aliases = (song) => ({
	titles: [song.title, ...(song.titles || [])].map(N).filter(Boolean),
	artists: [song.artist, ...(song.artists || [])].map(N).filter(Boolean)
});
export function rank(rows, song) {
	const a = aliases(song);
	let exact = null, title = null;
	rows.forEach((r, i) => {
		const tm = a.titles.some((t) => N(r.title).includes(t));
		const am = a.artists.some((x) => N(r.artist).includes(x));
		if (tm && title === null) title = i + 1;
		if (tm && am && exact === null) exact = i + 1;
	});
	return { exact, title };
}

// ---- lyric lines (runtime only) ----
const HAN = /\p{Script=Han}/u, KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u, HANGUL = /\p{Script=Hangul}/u;
const isCJK = (s) => HAN.test(s) || KANA.test(s) || HANGUL.test(s);
const isChinese = (s) => HAN.test(s) && !KANA.test(s) && !HANGUL.test(s);
const cjkLen = (s) => [...s].filter((c) => isCJK(c)).length;

export async function lyricLines(song) {
	const u = `https://lrclib.net/api/search?track_name=${encodeURIComponent(song.title)}&artist_name=${encodeURIComponent(song.artist)}`;
	const get = () => fetch(u, { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch(() => null);
	let rows = await get();
	if (!Array.isArray(rows)) { await sleep(3000); rows = await get(); } // LRCLIB sometimes answers an error object
	if (!Array.isArray(rows)) return null;
	const a = aliases(song);
	const hit = rows.find((r) => r.plainLyrics && !r.instrumental && a.titles.some((t) => N(r.trackName).includes(t)));
	if (!hit) return null;
	const titleN = a.titles;
	const seen = new Set();
	return hit.plainLyrics
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !/[:：]/.test(l) && !/^(作词|作曲|编曲|作詞|編曲|词|曲)/.test(l))
		.filter((l) => !titleN.some((t) => N(l).includes(t))) // a line holding the title is a free keyword hit — exclude
		.filter((l) => (isCJK(l) ? cjkLen(l) >= 6 : l.split(/\s+/).length >= 4))
		.filter((l) => (seen.has(N(l)) ? false : (seen.add(N(l)), true)));
}

export function variants(line) {
	const out = [{ v: 'full', q: line }];
	if (isCJK(line)) {
		const cs = [...line];
		const n = Math.max(5, Math.round(cs.length * 0.6));
		const start = Math.floor((cs.length - n) / 2);
		if (n < cs.length) out.push({ v: 'frag', q: cs.slice(start, start + n).join('').trim() });
	} else {
		const w = line.split(/\s+/);
		if (w.length >= 5) out.push({ v: 'frag', q: w.slice(1, -1).join(' ') });
	}
	if (isChinese(line)) {
		const t = mapChars(S2T, line);
		const flip = t !== line ? t : mapChars(T2S, line);
		if (flip !== line) out.push({ v: 'alt-script', q: flip });
	}
	return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
