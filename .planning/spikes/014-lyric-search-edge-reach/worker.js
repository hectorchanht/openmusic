// Spike 014 — the 013 lyric-search targets, executed FROM Cloudflare Workers egress.
// Imports 013's targets.mjs verbatim (bundled by wrangler/esbuild), so the edge runs the exact same
// request + parse as the local run — only the egress IP differs.
//
// GET /trace            → egress IP + colo (cdn-cgi/trace)
// GET /probe?q=…        → every upstream target's top 5 (the dev-proxy targets are skipped: no :4321 here)
// GET /burst?t=…&q=…&n= → n back-to-back calls to ONE target (rate-limit check, n ≤ 20)
// Queries are never logged.
import { TARGETS, queryAll } from '../013-lyric-search/targets.mjs';

const EDGE = Object.keys(TARGETS).filter((k) => !k.startsWith('e:') && !k.includes('(proxy)'));
const json = (x) => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } });

export default {
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname === '/trace') {
			const t = await fetch('https://www.cloudflare.com/cdn-cgi/trace').then((r) => r.text());
			return json(Object.fromEntries(t.trim().split('\n').map((l) => l.split('=')).filter(([k]) => ['ip', 'colo', 'loc', 'http'].includes(k))));
		}
		const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
		if (!q) return json({ error: 'q required', targets: EDGE });
		if (url.pathname === '/probe') return json(await queryAll(q, EDGE));
		if (url.pathname === '/burst') {
			const t = url.searchParams.get('t');
			if (!EDGE.includes(t)) return json({ error: 'bad t', targets: EDGE });
			const n = Math.min(20, Number(url.searchParams.get('n') || 15));
			const out = [];
			for (let i = 0; i < n; i++) {
				const r = (await queryAll(q, [t]))[t];
				out.push({ i, status: r.status, ms: r.ms, n: r.rows.length, err: r.err });
			}
			return json(out);
		}
		return json({ targets: EDGE });
	}
};
