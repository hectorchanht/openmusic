// Migu audio-URL resolve proxy (quick-261020-migu).
//
// Three-leg resolve chain — every leg is one a maintained open-source client ships
// today (guohuiyuan/music-lib migu, CharlesPikachu/musicdl migu, Domdkw/
// miguMusic-api-enhanced). The chain exists because Migu retires listen endpoints
// roughly yearly; each leg alone has died at some point, in some region.
//
//   Leg 1 (app v2.1): `c.musicapp.migu.cn/MIGUM2.0/v2.1/content/listen-url` with the
//     app headers music-lib sends (channel 0146832 — required, a wrong/absent channel
//     changes the answer). Success = { code: '000000', data: { url } }.
//   Leg 2 (PC strategy v1.0): `app.c.nf.migu.cn/MIGUM3.0/strategy/pc/listen/v1.0`
//     (Domdkw `url_v1`) — returns data.url at PQ; for an HQ request the CDN path
//     segment is rewritten MP3_128_16_Stero → MP3_320_16_Stero (musicdl's trick —
//     the freetyst layout is bitrate-in-path, so the swap is exact, not a guess).
//   Leg 3 (legacy v1.0): `c.musicapp.migu.cn/MIGUM2.0/v1.0/content/listen-url.do`
//     with the shared trial userId and redirect:'manual' — success is a 302 whose
//     Location is the final freetyst.nf.migu.cn URL. Captured, NOT followed: the
//     adapter wants the final URL as JSON (the brief's Migu contract), and following
//     would stream audio bytes into a JSON route.
//
// REGION REALITY (live-probed 2026-10-20 from this VM's non-CN egress): legs 1 and 2
// currently answer with Migu's region dialog (cannotCode 440001, "暂无法在当前地区
// 提供服务") for CN-catalogue songs, and leg 3's gateway route answers 299996
// "路由请求不支持" — while an earlier probe the same day DID capture leg-3 302s to
// playable freetyst URLs. Availability is egress-dependent and shifts; the chain is
// shipped because search is fully live and each leg is proven in at least one
// maintained client. When every leg refuses, the response is { url: null } and the
// adapter throws → cross-source fallback (SRC-FB-01) covers the song.
//
// The response reports the tone ACTUALLY delivered (`tone`) so quality labels never
// overclaim: leg 2 asked for SQ still delivers (and reports) PQ or HQ.
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders, jsonResponse } from '$lib/proxy/http';

const MG_V21 = 'https://c.musicapp.migu.cn/MIGUM2.0/v2.1/content/listen-url';
const MG_PC = 'https://app.c.nf.migu.cn/MIGUM3.0/strategy/pc/listen/v1.0';
const MG_LEGACY = 'https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/listen-url.do';
// The shared trial user ID every public client passes to the legacy endpoint.
const TRIAL_USER_ID = '155486145878';
const APP_UA = 'Android_migu/7.41.13 okhttp/3.12.13';
const PC_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const ID_RE = /^\d{6,24}$/;
const TONES = new Set(['LQ', 'PQ', 'HQ', 'SQ', 'ZQ', 'ZQ24']);

// Shared JSON responder (src/lib/proxy/http.ts).
const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

interface MgResult {
	url: string | null;
	tone?: string;
}

interface V21Body {
	code?: string;
	data?: { url?: string; cannotCode?: string; dialogInfo?: unknown };
}
interface PcBody {
	code?: string;
	data?: { url?: string; cannotCode?: string };
}

/** Leg 1 — app v2.1 listen-url (music-lib `fetchListenURL`). */
async function legV21(cid: string, cpid: string, rt: string, tone: string): Promise<MgResult | null> {
	const upstream =
		`${MG_V21}?netType=01&resourceType=${encodeURIComponent(rt)}` +
		`&contentId=${encodeURIComponent(cid)}&toneFlag=${encodeURIComponent(tone)}` +
		`&copyrightId=${encodeURIComponent(cpid)}`;
	const res = await fetchWithRetry(
		upstream,
		{
			signal: AbortSignal.timeout(8000),
			headers: {
				'User-Agent': APP_UA,
				channel: '0146832',
				version: '7.41.13',
				Referer: 'https://music.migu.cn/'
			}
		},
		1
	);
	const body = (await res.json()) as V21Body | null;
	if (!body || body.code !== '000000') return null;
	if (body.data?.cannotCode || body.data?.dialogInfo) return null; // region/VIP dialog
	const url = body.data?.url;
	if (typeof url !== 'string' || !url.startsWith('http')) return null;
	return { url, tone };
}

/** Leg 2 — PC strategy listen (Domdkw `url_v1` + musicdl quality path rewrite). */
async function legPc(cid: string, cpid: string, rt: string, tone: string): Promise<MgResult | null> {
	const upstream =
		`${MG_PC}?contentId=${encodeURIComponent(cid)}&copyrightId=${encodeURIComponent(cpid)}` +
		`&resourceType=${encodeURIComponent(rt)}&toneFlag=PQ`;
	const res = await fetchWithRetry(
		upstream,
		{
			signal: AbortSignal.timeout(8000),
			headers: { 'User-Agent': PC_UA, Channel: '014X031', Referer: 'https://music.migu.cn/' }
		},
		1
	);
	const body = (await res.json()) as PcBody | null;
	if (!body || body.code !== '000000') return null;
	if (body.data?.cannotCode) return null; // region dialog
	let url = body.data?.url;
	if (typeof url !== 'string' || !url.startsWith('http')) return null;
	let delivered = 'PQ';
	if (tone === 'HQ' && url.includes('MP3_128_16_Stero')) {
		url = url.replace('MP3_128_16_Stero', 'MP3_320_16_Stero');
		delivered = 'HQ';
	}
	return { url, tone: delivered };
}

/** Leg 3 — legacy listen-url.do, 302 Location capture (the original trial endpoint). */
async function legLegacy(cid: string, tone: string): Promise<MgResult | null> {
	const upstream =
		`${MG_LEGACY}?toneFlag=${encodeURIComponent(tone)}&netType=00&userId=${TRIAL_USER_ID}` +
		`&ua=Android_migu&version=5.1&copyrightId=0&contentId=${encodeURIComponent(cid)}` +
		'&resourceType=2&channel=0';
	const res = await fetchWithRetry(
		upstream,
		{
			signal: AbortSignal.timeout(8000),
			redirect: 'manual',
			headers: { 'User-Agent': APP_UA, Referer: 'https://music.migu.cn/' }
		},
		0
	);
	if (res.status >= 300 && res.status < 400) {
		const loc = res.headers.get('location');
		if (loc && loc.startsWith('http')) return { url: loc, tone };
	}
	return null;
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const cid = (url.searchParams.get('contentId') ?? '').trim();
	const cpid = (url.searchParams.get('copyrightId') ?? '').trim();
	const rt = (url.searchParams.get('resourceType') ?? '2').trim();
	const tone = (url.searchParams.get('tone') ?? 'PQ').trim().toUpperCase();

	// Validate at the edge — malformed ids never reach upstream.
	if (!ID_RE.test(cid) || !ID_RE.test(cpid) || !TONES.has(tone)) {
		return jsonPassthrough({ url: null }, origin);
	}

	const legs: Array<() => Promise<MgResult | null>> = [
		() => legV21(cid, cpid, rt, tone),
		() => legPc(cid, cpid, rt, tone),
		() => legLegacy(cid, tone)
	];
	for (const leg of legs) {
		try {
			const r = await leg();
			if (r && r.url) return jsonPassthrough(r, origin);
		} catch {
			// one leg's transport failure must not poison the rest of the chain
		}
	}
	return jsonPassthrough({ url: null }, origin);
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
