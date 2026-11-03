// GD音乐台 Netease proxy adapter (quick-261020-gdnt — second Netease pipe).
//
// music-api.gdstudio.xyz is a public no-key aggregator (1404 GitHub code refs —
// UnblockNeteaseMusic, musicdl, AlgerMusicPlayer, LX Music custom sources) with
// a Netease backend. No `Access-Control-Allow-Origin` header (verified
// 2026-10-20), so — unlike the CORS-open meting/qijieya pipe — it MUST go
// through our /api proxy (same structural reason as kuwo search).
//
// Upstream contract (live-probed 2026-10-20):
//   search: GET /api.php?types=search&source=netease&name={kw}&count={n}&page=1
//     → [{ id, name, artist[], album, pic_id, url_id, lyric_id, source }]
//   url:    GET /api.php?types=url&source=netease&id={url_id}&br=320
//     → { url: "https://m801.music.126.net/…/….mp3", br: 320, size: 12764517 }
//   lyric:  GET /api.php?types=lyric&source=netease&id={lyric_id}
//     → { lyric: "[00:00.00]…" }  (extractLrcFromJson handles the `lyric` key)
// The `url` leg returns JSON, NOT a 302 — so the client adapter parses it and
// sets audioUrl to the DIRECT CDN url (the catch-all forwards the body
// unchanged, D-09 passthrough). The CDN urls are signed/expiring; the track
// `resolvedAt` freshness mechanism covers staleness, same as every CN pipe.
import type { ProxyAdapter, Env } from './proxy-types';

const GD_BASE = 'https://music-api.gdstudio.xyz/api.php';

// The gdstudio `types` values this proxy understands. `path` is the [...path]
// segment after /api/gdnetease/ (e.g. "search", "url", "lrc").
const ALLOWED_TYPES = new Set(['search', 'url', 'lrc']);

export const gdneteaseProxy: ProxyAdapter = {
	id: 'gdnetease',
	buildUrl(path: string, searchParams: URLSearchParams, _env: Env | undefined): string {
		const type = (path || 'search').replace(/^\/+|\/+$/g, '');
		if (!ALLOWED_TYPES.has(type)) {
			throw new Error(`gdnetease: unsupported path "${type}"`);
		}

		const upstream = new URL(GD_BASE);
		upstream.searchParams.set('source', 'netease');
		// gdstudio's own `types` vocabulary differs from our path names.
		upstream.searchParams.set('types', type === 'lrc' ? 'lyric' : type);

		const id = searchParams.get('id');
		if (id !== null) {
			// `id` is the keyword for search, the url_id for url, the lyric_id for lrc.
			upstream.searchParams.set(type === 'search' ? 'name' : 'id', id);
		}
		if (type === 'search') {
			const limit = searchParams.get('limit');
			upstream.searchParams.set('count', limit ?? '10');
			upstream.searchParams.set('page', '1');
		}
		if (type === 'url') {
			// br passes through untouched: the adapter sets br=320 for streaming and
			// OMITS br for a lossless resolve (upstream then returns FLAC — verified
			// 2026-10-20: br 1619, 64.5 MB, HEAD 200). No default here so the two
			// paths cannot be confused by a silent fallback.
			const br = searchParams.get('br');
			if (br !== null) upstream.searchParams.set('br', br);
		}

		return upstream.toString();
	}
};
