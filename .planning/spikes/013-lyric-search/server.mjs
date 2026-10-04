// Spike 013 — paste-a-lyric page. Run: node server.mjs  → http://localhost:4399
// GET /probe?q=…  → every target's top 5 (same targets.mjs the harness scores). The query is never logged.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { queryAll } from './targets.mjs';

const PORT = Number(process.env.PORT || 4399);
const here = (f) => new URL(`./${f}`, import.meta.url);

createServer(async (req, res) => {
	const url = new URL(req.url, `http://localhost:${PORT}`);
	try {
		if (url.pathname === '/probe') {
			const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
			if (!q) return res.writeHead(400).end('q required');
			res.writeHead(200, { 'content-type': 'application/json' });
			return res.end(JSON.stringify(await queryAll(q)));
		}
		if (url.pathname === '/results.json') {
			res.writeHead(200, { 'content-type': 'application/json' });
			return res.end(await readFile(here('results.json')));
		}
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		res.end(await readFile(here('report.html')));
	} catch (e) {
		res.writeHead(500).end(String(e?.message || e));
	}
}).listen(PORT, () => console.log(`spike 013 → http://localhost:${PORT}`));
