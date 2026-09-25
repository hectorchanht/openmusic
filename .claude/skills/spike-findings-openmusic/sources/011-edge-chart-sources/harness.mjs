// Spike 011 harness: call each suite on the edge-preview Worker (wrangler dev --remote on :8799)
// and persist the raw rows. Usage: node .planning/spikes/011-edge-chart-sources/harness.mjs [label]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8799';
const SUITES = [['env'], ['apple'], ['kkbox'], ['yt'], ['burst', 'apple'], ['burst', 'kkbox'], ['burst', 'yt']];
const label = process.argv[2] || new Date().toISOString();
const file = new URL('./results.json', import.meta.url);

const run = { label, at: new Date().toISOString(), suites: {} };
for (const [s, src] of SUITES) {
	const key = src ? `${s}:${src}` : s;
	const res = await fetch(`${BASE}/?suite=${s}${src ? `&src=${src}` : ''}`, { signal: AbortSignal.timeout(120000) });
	run.suites[key] = await res.json();
	for (const r of run.suites[key]) {
		const good = r.status >= 200 && r.status < 300 && r.count > 0;
		console.log(`${good ? 'OK ' : 'BAD'} ${key.padEnd(12)} ${String(r.name).padEnd(38)} ${String(r.status).padEnd(4)} ${String(r.ms ?? '').padStart(5)}ms n=${r.count ?? ''} ${(r.sample || []).join(' · ').slice(0, 110) || r.error || (r.bodyHead || '').slice(0, 110)}`);
	}
}
const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
writeFileSync(file, JSON.stringify([...prior, run], null, 2));
console.log(`\nsaved run "${label}" → results.json (${prior.length + 1} runs)`);
