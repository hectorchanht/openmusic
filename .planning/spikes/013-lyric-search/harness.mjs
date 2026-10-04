// Spike 013 — lyric search, head-to-head. Run: node harness.mjs  (dev server on :4321 for the c/e targets)
//
// METHOD (MANIFEST requirement [013 method]): no lyric text is written or printed. For each song we pull
// its plain lyrics from LRCLIB (a NEUTRAL community DB — not Netease's/QQ's own transcription, so no
// source gets a home-index advantage), pick lines at runtime, and record only song / line position /
// variant / query length / hit rank. kuwo was the planned lyric source; its upstream cert expired
// 2026-04-14 (prod /api/kuwo → 526) — see README.
import { writeFileSync } from 'node:fs';
import { TARGETS, queryAll } from './targets.mjs';

import { SONGS, rank, lyricLines, variants, sleep } from './testset.mjs';

// ---- run ----
const results = [];
const lyricMiss = [];
const acao = {};
for (const song of SONGS) {
	const lines = await lyricLines(song);
	if (!lines || lines.length < 4) {
		lyricMiss.push(`${song.title}/${song.artist}`);
		console.log(`skip ${song.title} — no usable LRCLIB lyrics`);
		continue;
	}
	for (const pos of [0.35, 0.65]) {
		const line = lines[Math.floor(lines.length * pos)];
		for (const { v, q } of variants(line)) {
			const res = await queryAll(q);
			const row = { song: `${song.title} / ${song.artist}`, seg: song.seg, line: `p${pos * 100}`, variant: v, qlen: [...q].length, t: {} };
			for (const [k, r] of Object.entries(res)) {
				row.t[k] = { ...rank(r.rows, song), ms: r.ms, status: r.status, n: r.rows.length, err: r.err };
				if (r.acao !== undefined && !(k in acao)) acao[k] = r.acao;
			}
			results.push(row);
			process.stdout.write(`${song.seg.padEnd(6)} ${song.title.padEnd(18)} ${row.line} ${v.padEnd(10)} ` + Object.entries(row.t).map(([k, x]) => `${k.split(':')[0]}${x.exact ?? '·'}`).join(' ') + '\n');
			await sleep(400);
		}
	}
}

// ---- summary ----
const segs = [...new Set(SONGS.map((s) => s.seg))];
const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const summary = {};
for (const k of Object.keys(TARGETS)) {
	const xs = results.map((r) => r.t[k]);
	const bySeg = {};
	for (const sg of segs) {
		const ys = results.filter((r) => r.seg === sg).map((r) => r.t[k]);
		bySeg[sg] = { n: ys.length, exact5: pct(ys.filter((y) => y.exact).length, ys.length), title5: pct(ys.filter((y) => y.title).length, ys.length) };
	}
	const byVariant = {};
	for (const v of ['full', 'frag', 'alt-script']) {
		const ys = results.filter((r) => r.variant === v).map((r) => r.t[k]);
		byVariant[v] = { n: ys.length, exact5: pct(ys.filter((y) => y.exact).length, ys.length) };
	}
	summary[k] = {
		n: xs.length,
		exact1: pct(xs.filter((x) => x.exact === 1).length, xs.length),
		exact5: pct(xs.filter((x) => x.exact).length, xs.length),
		title5: pct(xs.filter((x) => x.title).length, xs.length),
		errors: xs.filter((x) => x.err || x.status === 'ERR').length,
		emptyRows: xs.filter((x) => x.n === 0).length,
		medianMs: median(xs.map((x) => x.ms)),
		acao: acao[k] ?? null,
		bySeg,
		byVariant
	};
}
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ ranAt: new Date().toISOString(), lyricSource: 'lrclib.net (plainLyrics)', lyricMiss, summary, results }, null, '\t'));
console.log('\nTARGET'.padEnd(22), 'ex@1 ex@5 ti@5  err empty  p50ms  ' + segs.join(' '));
for (const [k, s] of Object.entries(summary)) {
	console.log(k.padEnd(21), String(s.exact1).padStart(4), String(s.exact5).padStart(4), String(s.title5).padStart(4), String(s.errors).padStart(4), String(s.emptyRows).padStart(5), String(s.medianMs).padStart(6), ' ' + segs.map((sg) => String(s.bySeg[sg].exact5 ?? '-').padStart(sg.length)).join(' '));
}
console.log('lyricMiss:', lyricMiss.join(', ') || 'none');
