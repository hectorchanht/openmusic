// Kuwo stall-fallback stream route (Hector 2026-11-19, media-cache option ii) — the ONLY
// production byte-proxy in the app, and deliberately NOT a playback path: the player attaches
// here solely after a kuwo track has proven it cannot sustain DIRECT playback (buffer-gate
// hold timeout / repeated holds — see $lib/services/proxy-rescue). Normal playback stays
// browser→kuwo-CDN direct; the edge relays bytes only for tracks that already stalled.
//
// The upstream URL is resolved SERVER-SIDE from the songid through the existing resolver
// seam (fetchKuwoDetail) and re-validated against the kuwo host gate — the route accepts
// NO url parameter and can never become an open relay. GET only; anything that is not a
// numeric kuwo id at a whitelisted tier is a 400 before any upstream work happens.
// Behaviour (stream-tee, Range, Cache API under a stable kuwo:<id>@<level> key) lives in
// the source-generic $lib/proxy/byte-proxy handler — qq/joox/kugou/migu adopt it later by
// adding sibling routes, not by editing this one.
import type { RequestHandler } from './$types';
import { fetchKuwoDetail, isAllowedKuwoAudioUrl } from '$lib/proxy/kuwo';
import { handleByteProxy } from '$lib/proxy/byte-proxy';

/** The tier tokens the client resolver itself mints (sources/kuwo.ts) — anything else 400s. */
const LEVELS: ReadonlySet<string> = new Set(['128k', '320k', 'zp']);

export const GET: RequestHandler = async ({ params, url, request, platform }) => {
	const songid = (params.songid ?? '').trim();
	if (!/^\d{1,12}$/.test(songid)) {
		return new Response('kuwo stream: bad id', { status: 400, headers: { 'content-type': 'text/plain' } });
	}
	const level = url.searchParams.get('level') ?? '';
	if (!LEVELS.has(level)) {
		return new Response('kuwo stream: bad level', { status: 400, headers: { 'content-type': 'text/plain' } });
	}
	return handleByteProxy(request, {
		id: songid,
		level,
		cacheKey: `https://openmusic.lol/__proxy_cache__/kuwo:${songid}@${encodeURIComponent(level)}`,
		resolveUrl: async (id, lvl) => {
			const { status, body } = await fetchKuwoDetail(id, lvl);
			if (status !== 200 || !body || typeof body !== 'object') return null;
			const u = (body as { data?: { url?: unknown } }).data?.url;
			// Same host gate the detail route's clients are protected by (T-n1i-01): only an
			// https *.kuwo.cn URL is ever fetched, even if a resolver upstream is compromised.
			return isAllowedKuwoAudioUrl(u) ? u : null;
		},
		waitUntil: (p) => {
			platform?.ctx?.waitUntil(p);
		}
	});
};
