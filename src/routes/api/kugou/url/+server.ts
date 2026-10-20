// Kugou audio-URL resolve proxy (quick-261020-kugo).
//
// Two-leg resolver chain, ported from the open-source references (credited in the client
// adapter): guohuiyuan/music-lib `fetchSongInfo` → `fetchTrackerSongInfo`, and
// ELDment/Meting-Fixed `kugou_url`.
//
//   Leg 1 (primary): `m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=…&album_id=…`
//     — anonymous, returns a direct CDN `url` (+ `backup_url`) for FREE songs. Paid songs
//     answer with an empty url + pay_type>0 ("需要付费"); rate-limit answers errcode 1002.
//     Both fall through to leg 2.
//   Leg 2 (tracker): POST `media.store.kugou.com/v1/get_res_privilege` for the song's
//     `relate_goods` (one entry per quality hash), then for each good (best bitrate
//     first) `trackercdn.kugou.com/i/v2/?cmd=25&key=md5(hash+'kgcloudv2')&pid=3&
//     behavior=download`. Paid goods refuse with errcode 20028 — correctly unplayable.
//
// NOT used: `wwwapi.kugou.com/yy/index.php?r=play/getdata` (the third music-lib leg) —
// probed live 2026-10-20, it answers err_code 30020 anonymously (needs a real dfid
// session cookie), so it can never succeed from the edge. The gateway.kugou.com/v5/url
// leg (MakcRe/KuGouMusicApi) needs a logged-in user token — out of scope for an
// anonymous source, same posture as ytmusic's zero-auth rule.
//
// The response is NORMALIZED here ({ url, backupUrl, bitRate, extName, cover, fileSize,
// timeLength }) so the client adapter never sees upstream envelope drift. `url: null`
// means "no anonymous playable URL exists" — the adapter throws and cross-source
// fallback (SRC-FB-01) takes the song over, exactly like a region-blocked QQ track.
import type { RequestHandler } from './$types';
import { createHash } from 'node:crypto';
import { fetchWithRetry, jsonResponse, corsPreflight } from '$lib/proxy/http';

const KG_SONGINFO = 'https://m.kugou.com/app/i/getSongInfo.php';
const KG_PRIVILEGE = 'http://media.store.kugou.com/v1/get_res_privilege';
const KG_TRACKER = 'http://trackercdn.kugou.com/i/v2/';
const MOBILE_UA =
	'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';
const PC_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const HASH_RE = /^[0-9a-fA-F]{32}$/;

// Shared JSON responder (src/lib/proxy/http.ts).
const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

interface KgUrlResult {
	url: string | null;
	backupUrl?: string | null;
	bitRate?: number;
	extName?: string;
	cover?: string | null;
	fileSize?: number;
	timeLength?: number;
}

/** Upstream `url`/`backup_url` arrive as string | string[] | {} depending on the leg. */
function firstUrl(v: unknown): string | null {
	if (typeof v === 'string' && v.startsWith('http')) return v;
	if (Array.isArray(v)) {
		for (const x of v) if (typeof x === 'string' && x.startsWith('http')) return x;
	}
	return null;
}

interface SongInfoBody {
	url?: unknown;
	backup_url?: unknown;
	bitRate?: number;
	extName?: string;
	album_img?: string;
	fileSize?: number;
	timeLength?: number;
	errcode?: number;
}

/** Leg 1 — the mobile getSongInfo endpoint (music-lib `fetchSongInfo`). */
async function legSongInfo(hash: string, albumId: string): Promise<KgUrlResult | null> {
	const upstream =
		`${KG_SONGINFO}?cmd=playInfo&hash=${encodeURIComponent(hash)}` +
		(albumId ? `&album_id=${encodeURIComponent(albumId)}` : '');
	const res = await fetchWithRetry(
		upstream,
		{ signal: AbortSignal.timeout(8000), headers: { 'User-Agent': MOBILE_UA } },
		1
	);
	const body = (await res.json()) as SongInfoBody | null;
	if (!body || body.errcode === 1002) return null; // 1002 = rate-limited → try leg 2
	const url = firstUrl(body.url);
	if (!url) return null;
	return {
		url,
		backupUrl: firstUrl(body.backup_url),
		bitRate: body.bitRate,
		extName: body.extName,
		cover: body.album_img ? body.album_img.replace('{size}', '240') : null,
		fileSize: body.fileSize,
		timeLength: body.timeLength
	};
}

interface PrivilegeGood {
	hash?: string;
	info?: { bitrate?: number };
}
interface PrivilegeBody {
	data?: Array<{ relate_goods?: PrivilegeGood[] }>;
}
interface TrackerBody {
	url?: unknown;
	backup_url?: unknown;
	bitRate?: number;
	extName?: string;
	album_img?: string;
	fileSize?: number;
	timeLength?: number;
	errcode?: number;
}

/** Leg 2 — privilege goods → tracker cmd=25 (Meting `kugou_url` / music-lib tracker). */
async function legTracker(hash: string): Promise<KgUrlResult | null> {
	const privRes = await fetchWithRetry(
		KG_PRIVILEGE,
		{
			method: 'POST',
			signal: AbortSignal.timeout(8000),
			headers: { 'User-Agent': PC_UA, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				relate: 1,
				userid: '0',
				vip: 0,
				appid: 1000,
				token: '',
				behavior: 'download',
				area_code: '1',
				clientver: '8990',
				resource: [{ id: 0, type: 'audio', hash }]
			})
		},
		1
	);
	const priv = (await privRes.json()) as PrivilegeBody | null;
	const goods = (priv?.data?.[0]?.relate_goods ?? [])
		.filter((g) => typeof g.hash === 'string' && HASH_RE.test(g.hash))
		.sort((a, b) => (b.info?.bitrate ?? 0) - (a.info?.bitrate ?? 0));
	for (const good of goods) {
		const gh = (good.hash as string).toLowerCase();
		const key = createHash('md5').update(gh + 'kgcloudv2').digest('hex');
		const upstream = `${KG_TRACKER}?cmd=25&key=${key}&hash=${gh}&behavior=download&pid=3`;
		try {
			const res = await fetchWithRetry(
				upstream,
				{ signal: AbortSignal.timeout(8000), headers: { 'User-Agent': PC_UA, Referer: 'https://www.kugou.com/' } },
				0
			);
			const body = (await res.json()) as TrackerBody | null;
			if (!body || (body.errcode !== undefined && body.errcode !== 0)) continue;
			const url = firstUrl(body.url);
			if (!url) continue;
			return {
				url,
				backupUrl: firstUrl(body.backup_url),
				bitRate: body.bitRate,
				extName: body.extName,
				cover: body.album_img ? body.album_img.replace('{size}', '240') : null,
				fileSize: body.fileSize,
				timeLength: body.timeLength
			};
		} catch {
			// One good refusing (or timing out) must not poison the rest of the ladder.
			continue;
		}
	}
	return null;
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const hash = (url.searchParams.get('hash') ?? '').trim();
	const albumId = (url.searchParams.get('album_id') ?? '').trim();

	// Validate at the edge — a malformed hash never reaches upstream.
	if (!HASH_RE.test(hash)) return jsonPassthrough({ url: null }, origin);
	if (albumId && !/^\d{1,12}$/.test(albumId)) return jsonPassthrough({ url: null }, origin);

	try {
		const leg1 = await legSongInfo(hash, albumId);
		if (leg1) return jsonPassthrough(leg1, origin);
	} catch {
		// Leg 1 transport failure → leg 2 still gets its chance.
	}
	try {
		const leg2 = await legTracker(hash);
		if (leg2) return jsonPassthrough(leg2, origin);
	} catch {
		// fall through to the null result
	}
	return jsonPassthrough({ url: null }, origin);
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
