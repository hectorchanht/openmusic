// QQ proxy adapter — real upstream URL build (plan 01-02). No auth for QQ.
//
// All QQ metadata comes from the tang music_open_api endpoint (legacy:2043-2046 search,
// 2323-2327 detail). The client hits /api/qq/<type>?<params> and this adapter maps the
// forwarded query onto the single upstream URL. Search and detail share ONE endpoint,
// distinguished only by the presence of `mid` (detail) vs not (search) — legacy never
// used a real path here. D-09 passthrough: the +server.ts route forwards the upstream
// body unchanged.
import type { ProxyAdapter, Env } from './proxy-types';

const TANG_BASE = 'https://tang.api.s01s.cn/music_open_api.php';

// The client uses these path segments after /api/qq/ (e.g. "search", "detail"). They
// both map to the same upstream — only the params (msg, mid) differ.
const ALLOWED_TYPES = new Set(['search', 'detail']);

export const qqProxy: ProxyAdapter = {
	id: 'qq',
	buildUrl(path: string, searchParams: URLSearchParams, _env: Env | undefined): string {
		const type = (path || 'search').replace(/^\/+|\/+$/g, '');
		if (!ALLOWED_TYPES.has(type)) {
			throw new Error(`qq: unsupported path "${type}"`);
		}

		const upstream = new URL(TANG_BASE);
		upstream.searchParams.set('type', 'json');

		// `msg` is the keyword — required for both search and detail (detail re-sends the
		// original search keyword so upstream ordering stays consistent, legacy:2312-2315).
		const msg = searchParams.get('msg');
		if (msg !== null) upstream.searchParams.set('msg', msg);

		// `mid` is present only on the detail call (legacy:2327) — it switches the upstream
		// from a search list to a single-song detail object.
		const mid = searchParams.get('mid');
		if (mid !== null) upstream.searchParams.set('mid', mid);

		return upstream.toString();
	}
};
