// Netease proxy adapter — real upstream URL build (Task 3). No auth for Netease.
//
// All Netease metadata comes from the qijieya Meting proxy (legacy:1988 search,
// 2271 url, 2274 lrc). The client hits /api/netease/<type>?<params> and this adapter
// maps <type> + the forwarded query onto the upstream Meting URL. D-09 passthrough:
// the +server.ts route forwards the upstream JSON/text body unchanged.
import type { ProxyAdapter, Env } from './proxy-types';

const METING_BASE = 'https://api.qijieya.cn/meting/';

// The Meting `type` values this proxy understands. `path` is the [...path] segment
// after /api/netease/ (e.g. "search", "url", "lrc").
const ALLOWED_TYPES = new Set(['search', 'url', 'lrc']);

export const neteaseProxy: ProxyAdapter = {
	id: 'netease',
	buildUrl(path: string, searchParams: URLSearchParams, _env: Env | undefined): string {
		// Normalize the path → meting type. Default to 'search' when path is empty.
		const type = (path || 'search').replace(/^\/+|\/+$/g, '');
		if (!ALLOWED_TYPES.has(type)) {
			throw new Error(`netease: unsupported path "${type}"`);
		}

		const upstream = new URL(METING_BASE);
		upstream.searchParams.set('server', 'netease');
		upstream.searchParams.set('type', type);

		// Forward the caller's params (id, limit). `id` is the keyword for search and
		// the songid for url/lrc — the client sets it correctly per call.
		const id = searchParams.get('id');
		if (id !== null) upstream.searchParams.set('id', id);
		const limit = searchParams.get('limit');
		if (type === 'search' && limit !== null) upstream.searchParams.set('limit', limit);

		return upstream.toString();
	}
};
