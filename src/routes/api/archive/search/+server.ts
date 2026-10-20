// Internet Archive search edge proxy (quick-261020-arch; k3y: caches.default at 1h).
//
// archive.org is a two-call source: advancedsearch.php returns ITEMS (albums,
// concerts, singles), and only metadata/<identifier> knows an item's playable
// files. This route does BOTH server-side — one own-origin response of flattened
// TRACK rows — so the client adapter stays a thin mapper (the multi-step work
// belongs at the edge, per the dedicated-route idiom). Fan-out is bounded: at
// most ITEMS_PER_PAGE metadata calls in parallel per request, a failed item is
// skipped (never fatal), and rows per item are capped.
//
// No API key, no signing — archive.org's API is public by design.
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders, jsonResponse } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { buildArchiveQuery, pickPlayableFiles, type IaFile, type ArchiveRow } from '$lib/proxy/archive';

const TTL = 3600; // 1h (search-route idiom)
const ITEMS_PER_PAGE = 10; // upstream items per page — bounds the metadata fan-out
const MAX_ROWS_PER_ITEM = 40; // a 4-disc box set must not flood one result page
const ARCHIVE_UA = 'Mozilla/5.0 (compatible; OpenMusic/1.0; +https://openmusic.lol)';

// Shared JSON responder (src/lib/proxy/http.ts).
const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

interface IaSearchDoc {
	identifier?: string;
	title?: string;
	creator?: string | string[];
	year?: number;
}
interface IaSearchBody {
	response?: { numFound?: number; docs?: IaSearchDoc[] };
}
interface IaMetadataBody {
	metadata?: { title?: string; creator?: string | string[] };
	files?: IaFile[];
}

function joinCreator(c: string | string[] | undefined): string | null {
	if (typeof c === 'string' && c) return c;
	if (Array.isArray(c)) {
		const names = c.filter((x): x is string => typeof x === 'string' && !!x);
		return names.length > 0 ? names.join(', ') : null;
	}
	return null;
}

/** Metadata for one item → its flattened playable rows (empty when unusable). */
async function itemRows(doc: IaSearchDoc): Promise<ArchiveRow[]> {
	const identifier = doc.identifier;
	if (!identifier) return [];
	try {
		const res = await fetchWithRetry(
			`https://archive.org/metadata/${encodeURIComponent(identifier)}`,
			{ signal: AbortSignal.timeout(8000), headers: { 'User-Agent': ARCHIVE_UA } },
			1
		);
		const body = (await res.json()) as IaMetadataBody | null;
		if (!body || !Array.isArray(body.files)) return [];
		const itemTitle = body.metadata?.title || doc.title || null;
		const creator = joinCreator(body.metadata?.creator) || joinCreator(doc.creator);
		return pickPlayableFiles(body.files)
			.slice(0, MAX_ROWS_PER_ITEM)
			.map((p) => ({
				identifier,
				file: p.file,
				title: p.title,
				itemTitle,
				creator,
				year: typeof doc.year === 'number' ? doc.year : null,
				lengthSec: p.lengthSec,
				format: p.format,
				size: p.size
			}));
	} catch {
		return []; // one dead item must not sink the whole page
	}
}

const EMPTY = { rows: [] as ArchiveRow[] };

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const keyword = (url.searchParams.get('keyword') ?? '').trim();
	if (!keyword) return jsonPassthrough(EMPTY, origin);

	const page = Math.min(50, Math.max(1, Number(url.searchParams.get('page')) || 1));

	const cache = edgeCache();
	const cacheReq = new Request(url.toString());
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			const cached = await hit.json();
			return jsonPassthrough(cached, origin, TTL);
		}
	}

	try {
		const q = buildArchiveQuery(keyword);
		const fl = ['identifier', 'title', 'creator', 'year', 'downloads']
			.map((f) => `&fl[]=${f}`)
			.join('');
		const upstream =
			`https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}${fl}` +
			`&sort[]=downloads+desc&rows=${ITEMS_PER_PAGE}&page=${page}&output=json`;
		const res = await fetchWithRetry(
			upstream,
			{ signal: AbortSignal.timeout(8000), headers: { 'User-Agent': ARCHIVE_UA } },
			2
		);
		const body = (await res.json()) as IaSearchBody | null;
		const docs = body?.response?.docs;
		if (!Array.isArray(docs)) return jsonPassthrough(EMPTY, origin);

		const perItem = await Promise.all(docs.map((d) => itemRows(d)));
		const out = { rows: perItem.flat() };
		if (cache) {
			const cached = new Response(JSON.stringify(out), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
			await cache.put(cacheReq, cached);
		}
		return jsonPassthrough(out, origin, TTL);
	} catch {
		// Upstream error → empty page (NO cache write — next retry can succeed).
		return jsonPassthrough(EMPTY, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
