// Bilibili edge helpers (quick-261020-bili) — shared by the /api/bilibili/* routes.
//
// Ported from guohuiyuan/music-lib `bilibili` (AGPL, read-only reference) + the WBI
// signing scheme every public client implements (SocialSisterYi bilibili-API-collect).
// All mechanics below were live-probed from the VM on 2026-10-20:
//
//   - WBI keys come from `x/web-interface/nav` — anonymously the call reports
//     code -101 (not logged in) but `data.wbi_img` is still served. The mixin key is
//     the standard permutation of img_key+sub_key, first 32 chars.
//   - Signed `x/web-interface/wbi/search/type` answers code 0 with NO cookie.
//   - `x/player/pagelist` (unsigned) yields the cid for a bvid's first part.
//   - `x/player/playurl` must be UNSIGNED + carry a `buvid3` cookie + a bilibili
//     Referer; the WBI-signed variant is answered with an HTML block page instead.
//   - The DASH audio CDN (bilivideo.com) enforces Referer: no Referer → 403,
//     Referer https://openmusic.lol/ → 403, Referer https://www.bilibili.com/ → 206.
//     HTML <audio> cannot set headers, so playback goes through /api/bilibili/stream
//     which injects the Referer at the edge (see that route's header).

import { fetchWithRetry } from './http';

export const BILI_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const BILI_REFERER = 'https://www.bilibili.com/';

/** The WBI mixin permutation table (bilibili-API-collect, canonical). */
const MIXIN_TAB = [
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42,
	19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60,
	51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

// ---- tiny MD5 (WBI's w_rid) ---------------------------------------------------------------
// WebCrypto has no MD5 and this repo adds no runtime deps, so w_rid needs a local
// implementation. This is the classic RSA Data Security MD5 (RFC 1320) over the
// UTF-8 bytes of the query string, written against the public-domain reference
// algorithm (same structure as blueimp/JavaScript-MD5, BSD). Only ever applied to
// short ASCII query strings here.
const MD5_S: number[] = [
	7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20,
	5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16,
	23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];
const MD5_K: number[] = Array.from({ length: 64 }, (_, i) =>
	Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)
);

export function md5Hex(input: string): string {
	const bytes = new TextEncoder().encode(input);
	const bitLen = bytes.length * 8;
	const padded = new Uint8Array(((bytes.length + 8) >> 6 << 6) + 64);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const dv = new DataView(padded.buffer);
	dv.setUint32(padded.length - 8, bitLen >>> 0, true);
	dv.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);

	let a0 = 0x67452301;
	let b0 = 0xefcdab89;
	let c0 = 0x98badcfe;
	let d0 = 0x10325476;
	const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

	for (let off = 0; off < padded.length; off += 64) {
		const m: number[] = [];
		for (let j = 0; j < 16; j++) m[j] = dv.getUint32(off + j * 4, true);
		let a = a0;
		let b = b0;
		let c = c0;
		let d = d0;
		for (let i = 0; i < 64; i++) {
			let f: number;
			let g: number;
			if (i < 16) {
				f = (b & c) | (~b & d);
				g = i;
			} else if (i < 32) {
				f = (d & b) | (~d & c);
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				f = b ^ c ^ d;
				g = (3 * i + 5) % 16;
			} else {
				f = c ^ (b | ~d);
				g = (7 * i) % 16;
			}
			const tmp = d;
			d = c;
			c = b;
			b = (b + rotl((a + f + MD5_K[i] + m[g]) >>> 0, MD5_S[i])) >>> 0;
			a = tmp;
		}
		a0 = (a0 + a) >>> 0;
		b0 = (b0 + b) >>> 0;
		c0 = (c0 + c) >>> 0;
		d0 = (d0 + d) >>> 0;
	}
	const hex = (n: number) =>
		[n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
			.map((x) => x.toString(16).padStart(2, '0'))
			.join('');
	return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

// ---- WBI signing --------------------------------------------------------------------------

interface NavBody {
	data?: { wbi_img?: { img_url?: string; sub_url?: string } };
}

let mixinCache: { key: string; at: number } | null = null;
const MIXIN_TTL_MS = 30 * 60 * 1000; // keys rotate daily-ish; 30 min is well inside

function keyFromUrl(u: string | undefined): string {
	if (!u) return '';
	const file = u.slice(u.lastIndexOf('/') + 1);
	return file.split('.')[0] || '';
}

/** Fetch (and per-isolate memoize) the current WBI mixin key. Throws on drift. */
export async function biliMixinKey(): Promise<string> {
	if (mixinCache && Date.now() - mixinCache.at < MIXIN_TTL_MS) return mixinCache.key;
	const res = await fetchWithRetry(
		'https://api.bilibili.com/x/web-interface/nav',
		{ signal: AbortSignal.timeout(8000), headers: { 'User-Agent': BILI_UA } },
		1
	);
	const body = (await res.json()) as NavBody | null;
	const raw = keyFromUrl(body?.data?.wbi_img?.img_url) + keyFromUrl(body?.data?.wbi_img?.sub_url);
	if (raw.length < 64) throw new Error('bilibili: wbi keys unavailable (nav drift)');
	const key = MIXIN_TAB.map((i) => raw[i]).join('').slice(0, 32);
	mixinCache = { key, at: Date.now() };
	return key;
}

/** Sign params per the WBI scheme: add wts, sort, strip !'()* from values, md5. */
export function biliSign(params: Record<string, string | number>, mixin: string): string {
	const all: Record<string, string> = {};
	for (const [k, v] of Object.entries(params)) all[k] = String(v);
	all.wts = String(Math.floor(Date.now() / 1000));
	// Wire format matches the proven reference clients (URLSearchParams / urllib):
	// spaces as '+', not '%20' — the signature is computed over the string AS SENT.
	const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
	const query = Object.keys(all)
		.sort()
		.map((k) => `${enc(k)}=${enc(all[k].replace(/[!'()*]/g, ''))}`)
		.join('&');
	return `${query}&w_rid=${md5Hex(query + mixin)}`;
}

// ---- Search -------------------------------------------------------------------------------

/** Signed video search (search_type=video). Returns the raw upstream body. */
export async function biliSearch(keyword: string, page: number, pageSize: number): Promise<unknown> {
	const mixin = await biliMixinKey();
	const qs = biliSign(
		{ search_type: 'video', keyword, page, page_size: pageSize },
		mixin
	);
	const res = await fetchWithRetry(
		`https://api.bilibili.com/x/web-interface/wbi/search/type?${qs}`,
		{
			signal: AbortSignal.timeout(8000),
			headers: { 'User-Agent': BILI_UA, Referer: BILI_REFERER }
		},
		1
	);
	return res.json();
}

// ---- Resolve (pagelist + unsigned playurl DASH) -------------------------------------------

export interface BiliDashAudio {
	cid: number;
	url: string;
	bandwidth: number;
	id: number;
}

interface PagelistBody {
	code?: number;
	data?: Array<{ cid?: number; part?: string }>;
}
interface PlayurlBody {
	code?: number;
	data?: {
		dash?: { audio?: Array<{ id?: number; baseUrl?: string; base_url?: string; bandwidth?: number }> };
	};
}

/** A plausible buvid3 fingerprint cookie — the playurl gate checks presence/shape. */
function fabricateBuvid3(): string {
	const hex = (n: number) =>
		Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
	return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}${Date.now()}infoc`;
}

let buvid3: string | null = null;

/**
 * Resolve a bvid to its best DASH audio stream (first part only — music uploads are
 * single-part; multi-part videos play their first part, documented in the adapter).
 * Returns null when the video is gone, region-locked, or carries no audio track.
 */
export async function biliResolveDashAudio(bvid: string): Promise<BiliDashAudio | null> {
	if (!buvid3) buvid3 = fabricateBuvid3();

	const plRes = await fetchWithRetry(
		`https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`,
		{ signal: AbortSignal.timeout(8000), headers: { 'User-Agent': BILI_UA, Referer: BILI_REFERER } },
		1
	);
	const pl = (await plRes.json()) as PagelistBody | null;
	const cid = pl?.code === 0 ? pl.data?.[0]?.cid : undefined;
	if (!cid) return null;

	const puRes = await fetchWithRetry(
		`https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=16&fnver=0&fourk=1`,
		{
			signal: AbortSignal.timeout(8000),
			headers: {
				'User-Agent': BILI_UA,
				Referer: `https://www.bilibili.com/video/${bvid}/`,
				Cookie: `buvid3=${buvid3}`
			}
		},
		1
	);
	const pu = (await puRes.json()) as PlayurlBody | null;
	const audios = pu?.code === 0 ? (pu.data?.dash?.audio ?? []) : [];
	let best: BiliDashAudio | null = null;
	for (const a of audios) {
		const url = a.baseUrl || a.base_url;
		if (!url || typeof a.bandwidth !== 'number') continue;
		if (!best || a.bandwidth > best.bandwidth) {
			best = { cid, url, bandwidth: a.bandwidth, id: a.id ?? 0 };
		}
	}
	return best;
}

/** Hosts the stream route may proxy — anything else means upstream drift; refuse. */
export function isBiliCdnUrl(u: string): boolean {
	try {
		const h = new URL(u).hostname;
		return h.endsWith('.bilivideo.com') || h.endsWith('.akamaized.net');
	} catch {
		return false;
	}
}
