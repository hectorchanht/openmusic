// Kuwo edge chain — search + full-length audio + lyrics behind /api/kuwo/search and /api/kuwo/detail
// (quick-261004-n1i). Pure and fetch-injectable (`fetchImpl`, the turnstile.ts convention) so the
// resolver walk is unit-testable call by call; the two +server.ts routes are thin verb-only callers.
//
// WHY A DEDICATED ROUTE PAIR (quick-261004-n1i), replacing the old catch-all passthrough adapter:
//  - the old single upstream `kw-api.cenguigui.cn` is dead BEYOND its expired cert — with the cert
//    ignored it answers 200 with a 0-byte body, so there is nothing left to point the passthrough at;
//  - kuwo's own `antiserver.kuwo.cn` convert_url / `mobi.kuwo.cn` endpoints serve 11 s PREVIEW clips
//    for paid songs — never use them, a clip that "plays" is worse than a clean failure;
//  - full-length audio now comes from free third-party resolvers that die without notice, so it
//    needs a FALLBACK CHAIN, and the [source] catch-all is a single-URL passthrough that cannot
//    compose one. All the logic therefore lives here.
//
// UPSTREAMS:
//  - search  search.kuwo.cn/r.s (official, keyless; text/plain body that IS JSON)
//  - lyrics  m.kuwo.cn/newh5/singles/songinfoandlrc (official, needs a m.kuwo.cn Referer; flaky —
//            it intermittently answers status 301 "音乐查询失败", so it is never load-bearing)
//  - audio   musicapi.haitangw.net → music.nxinxz.com, SEQUENTIAL (see resolveAudioUrl)
//
// LICENSE: the resolver URLs and their query params come from musicdl's kuwo source list
// (github.com/CharlesPikachu/musicdl, PolyForm Noncommercial). They are used as FACTS only — no
// musicdl code is copied. scripts/musicdl-watch.mjs watches that list for host changes.
import { safeImageUrl, type ImageHostAllowlist } from './safe-image-url';

/** Resolver quality rungs: lossless → .flac, exhigh → 320k mp3, standard → 128k mp3. */
export type KuwoLevel = 'lossless' | 'exhigh' | 'standard';

/** The legacy search row the client adapter (src/lib/sources/kuwo.ts) reads — shape unchanged. */
export interface KuwoSearchRow {
	rid: string;
	name: string;
	artist: string;
	album: string;
	pic: string | null;
}

const KUWO_SEARCH_BASE = 'https://search.kuwo.cn/r.s';
const KUWO_LYRIC_BASE = 'https://m.kuwo.cn/newh5/singles/songinfoandlrc';
const KUWO_COVER_BASE = 'https://img2.kuwo.cn/star/albumcover/500/';

// quick-261004-n1i: per-ATTEMPT timeout. Two sequential 6 s resolver attempts + the parallel 6 s
// lyric fetch stay under the client's 25 s apiFetch budget, so one hung resolver can never stall a
// play past the point where the client gives up anyway.
const UPSTREAM_MS = 6000;
const SEARCH_MS = 8000;

// Same guard as og-cover's safeKuwoImageUrl, but a local allowlist object: importing og-cover here
// would create an import cycle (og-cover imports this module).
const KUWO_IMAGE_HOSTS: ImageHostAllowlist = { suffix: ['.kuwo.cn'] };

const resolverAt =
	(base: string) =>
	(rid: string, level: KuwoLevel): string =>
		`${base}?id=${encodeURIComponent(rid)}&level=${level}&type=json`;

/**
 * Full-length audio resolvers, walked IN ORDER. Both answer `{ code: 200, data: { url } }` with a
 * SIGNED, expiring *.kuwo.cn CDN url (car-er / car-lw) — hence /api/kuwo/detail is never cached.
 * nxinxz is plain http: fine edge-side, the client never sees that hop.
 * music.xcloudv.top (404) is dead and deliberately absent.
 */
export const KUWO_AUDIO_RESOLVERS: readonly {
	id: 'haitangw' | 'nxinxz';
	build(rid: string, level: KuwoLevel): string;
}[] = [
	{ id: 'haitangw', build: resolverAt('https://musicapi.haitangw.net/music/kw.php') },
	{ id: 'nxinxz', build: resolverAt('http://music.nxinxz.com/kw.php') }
];

const clamp50 = (n: number) => Math.min(50, Math.max(1, Math.floor(n) || 1));

/** Official search URL. limit/page clamped to 1..50 (T-n1i-06); `pn` is 0-based upstream. */
export function buildKuwoSearchUrl(name: string, limit: number, page: number): string {
	const q = new URLSearchParams({
		all: name,
		ft: 'music',
		rformat: 'json',
		encoding: 'utf8',
		rn: String(clamp50(limit)),
		pn: String(clamp50(page) - 1),
		vipver: '1',
		client: 'kt',
		cluster: '0',
		mobi: '1'
	});
	return `${KUWO_SEARCH_BASE}?${q}`;
}

const ENTITIES: Record<string, string> = {
	'&nbsp;': ' ',
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'"
};

// Exactly the six entities kuwo emits, ONE pass (so `&amp;lt;` stays `&lt;`, never `<`).
// artist-split.ts only normalises `&amp;` inline, so there is nothing to reuse (T-n1i-05).
const decodeEntities = (s: string): string =>
	s.replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);

const text = (v: unknown): string => (typeof v === 'string' ? decodeEntities(v).trim() : '');
const textOrNull = (v: unknown): string | null => text(v) || null;

/**
 * `web_albumpic_short` ("120/s3s94/93/211513640.jpg") → the 500px album cover. The leading size
 * segment is dropped and the rest is appended to a FIXED img2.kuwo.cn base, so only a strict path
 * shape is accepted (T-n1i-04): no `..`, no query, no whitespace, no quotes.
 */
export function coverFromShort(short: unknown): string | null {
	if (typeof short !== 'string' || !/^\d+\/[\w./-]+$/.test(short) || short.includes('..')) return null;
	return KUWO_COVER_BASE + short.replace(/^\d+\//, '');
}

interface KuwoAbsRow {
	MUSICRID?: unknown;
	SONGNAME?: unknown;
	NAME?: unknown;
	ARTIST?: unknown;
	ALBUM?: unknown;
	web_albumpic_short?: unknown;
}

/**
 * r.s body → legacy rows. `null` when `abslist` is not an array — CONTRACT DRIFT, distinct from a
 * clean `[]` miss, so og-cover can refuse to negative-cache it. rid keeps the bare numeric id
 * (`MUSIC_228908` → `228908`) so every saved `kuwo:<rid>` uid stays valid.
 */
export function mapSearch(body: unknown): KuwoSearchRow[] | null {
	const list = body && typeof body === 'object' ? (body as { abslist?: unknown }).abslist : undefined;
	if (!Array.isArray(list)) return null;
	const rows: KuwoSearchRow[] = [];
	for (const r of list as (KuwoAbsRow | null | undefined)[]) {
		const rid = String(r?.MUSICRID ?? '').replace(/^MUSIC_/, '');
		if (!/^\d+$/.test(rid)) continue;
		rows.push({
			rid,
			name: text(r?.SONGNAME) || text(r?.NAME),
			artist: text(r?.ARTIST),
			album: text(r?.ALBUM),
			pic: coverFromShort(r?.web_albumpic_short)
		});
	}
	return rows;
}

/** `[{ lineLyric, time: "2.25" }]` → an LRC string (`[00:02.25]…`); null when no line survives. */
export function lrclistToLrc(lrclist: unknown): string | null {
	if (!Array.isArray(lrclist)) return null;
	const lines: string[] = [];
	for (const e of lrclist as ({ lineLyric?: unknown; time?: unknown } | null)[]) {
		const s = Number.parseFloat(String(e?.time));
		if (!Number.isFinite(s) || s < 0) continue;
		const cs = Math.round(s * 100); // centiseconds, so 59.999 never renders as `00:60.00`
		const mm = String(Math.floor(cs / 6000)).padStart(2, '0');
		const ss = ((cs % 6000) / 100).toFixed(2).padStart(5, '0');
		lines.push(`[${mm}:${ss}]${typeof e?.lineLyric === 'string' ? e.lineLyric : ''}`);
	}
	return lines.length ? lines.join('\n') : null;
}

/**
 * Client level token → resolver rung. `zp` is the legacy lossless token; anything unknown defaults
 * UP to lossless so a stale client still plays.
 */
export function levelFor(token: string | null | undefined): KuwoLevel {
	return token === '128k' ? 'standard' : token === '320k' ? 'exhigh' : 'lossless';
}

/**
 * SECURITY gate on UNTRUSTED resolver output (T-n1i-01): only an https url on a *.kuwo.cn host is
 * ever handed to the client's <audio>. The suffix is DOT-anchored, mirroring safe-image-url.ts —
 * `endsWith('kuwo.cn')` would also pass `evil-kuwo.cn`; the apex `kuwo.cn` never serves audio.
 */
export function isAllowedKuwoAudioUrl(raw: unknown): raw is string {
	if (typeof raw !== 'string') return false;
	try {
		const u = new URL(raw);
		return u.protocol === 'https:' && u.hostname.toLowerCase().endsWith('.kuwo.cn');
	} catch {
		return false;
	}
}

/**
 * Walk KUWO_AUDIO_RESOLVERS SEQUENTIALLY — the second is a fallback, not a race (be polite to free
 * resolvers). Any throw / timeout / non-ok / non-JSON / code≠200 / url failing the gate = THAT
 * resolver failed → try the next. null when the list is exhausted.
 */
export async function resolveAudioUrl(
	rid: string,
	level: KuwoLevel,
	fetchImpl: typeof fetch = fetch
): Promise<{ url: string; resolver: string } | null> {
	for (const r of KUWO_AUDIO_RESOLVERS) {
		try {
			const res = await fetchImpl(r.build(rid, level), { signal: AbortSignal.timeout(UPSTREAM_MS) });
			if (!res.ok) continue;
			const j = (await res.json()) as { code?: unknown; data?: { url?: unknown } | null } | null;
			const url = j?.data?.url;
			if (Number(j?.code) === 200 && isAllowedKuwoAudioUrl(url)) return { url, resolver: r.id };
		} catch {
			// this resolver failed — walk on
		}
	}
	return null;
}

interface KuwoSonginfo {
	lyric: string | null;
	name: string | null;
	artist: string | null;
	album: string | null;
	pic: string | null;
}

/** Lyrics + display metadata. NEVER throws — any failure is the all-null object (T-n1i-03). */
async function fetchKuwoSonginfo(rid: string, fetchImpl: typeof fetch = fetch): Promise<KuwoSonginfo> {
	const none: KuwoSonginfo = { lyric: null, name: null, artist: null, album: null, pic: null };
	try {
		const res = await fetchImpl(`${KUWO_LYRIC_BASE}?musicId=${encodeURIComponent(rid)}`, {
			headers: { Referer: 'https://m.kuwo.cn/' },
			signal: AbortSignal.timeout(UPSTREAM_MS)
		});
		if (!res.ok) return none;
		const j = (await res.json()) as {
			data?: {
				lrclist?: unknown;
				songinfo?: { songName?: unknown; artist?: unknown; album?: unknown; pic?: unknown } | null;
			} | null;
		} | null;
		const info = j?.data?.songinfo;
		return {
			lyric: lrclistToLrc(j?.data?.lrclist),
			name: textOrNull(info?.songName),
			artist: textOrNull(info?.artist),
			album: textOrNull(info?.album),
			pic: safeImageUrl(typeof info?.pic === 'string' ? info.pic : null, KUWO_IMAGE_HOSTS)
		};
	} catch {
		return none;
	}
}

/** /api/kuwo/search body: the legacy `{ code: 200, data: rows }`, or a 502 on any upstream fault. */
export async function fetchKuwoSearch(
	name: string,
	limit: number,
	page: number,
	fetchImpl: typeof fetch = fetch
): Promise<{ status: number; body: { code: number; data?: KuwoSearchRow[]; msg?: string } }> {
	const fail = { status: 502, body: { code: 502, msg: 'kuwo: search upstream failed' } };
	try {
		const res = await fetchImpl(buildKuwoSearchUrl(name, limit, page), {
			signal: AbortSignal.timeout(SEARCH_MS)
		});
		if (!res.ok) return fail;
		const rows = mapSearch(JSON.parse(await res.text())); // text/plain body that IS JSON
		return rows ? { status: 200, body: { code: 200, data: rows } } : fail;
	} catch {
		return fail;
	}
}

/**
 * /api/kuwo/detail body: audio chain ∥ songinfo. A lyric/metadata miss never fails the detail; an
 * exhausted audio chain is a 502 ON PURPOSE — the client kuwoJson seam counts a non-200 against the
 * kuwo health gate, exactly as it counted the old 526.
 */
export async function fetchKuwoDetail(
	rid: string,
	levelToken: string | null,
	fetchImpl: typeof fetch = fetch
): Promise<{ status: number; body: unknown }> {
	const [audio, info] = await Promise.all([
		resolveAudioUrl(rid, levelFor(levelToken), fetchImpl),
		fetchKuwoSonginfo(rid, fetchImpl)
	]);
	if (!audio) return { status: 502, body: { code: 502, msg: 'kuwo: no playable url from any resolver' } };
	return {
		status: 200,
		body: {
			code: 200,
			data: {
				name: info.name,
				artist: info.artist,
				album: info.album,
				pic: info.pic,
				url: audio.url,
				lyric: info.lyric
			}
		}
	};
}
