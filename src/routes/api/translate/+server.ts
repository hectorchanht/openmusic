// Lyrics / name translation proxy (NEW feature endpoint — not part of the music data layer).
// POST { lines: string[], to: LyricsLang } -> { translated: string[] }.
// Server-side calls an unofficial Google translate endpoint (no key), batches the
// lines in chunked requests, and falls back to the originals on any failure. CORS is
// handled CENTRALLY by src/hooks.server.ts (allowlisted Access-Control-Allow-Origin +
// OPTIONS 204 for every /api/* route, incl. the native Capacitor origin) — this handler
// needs no per-route CORS logic of its own.
//
// ALIGNMENT (WR / debug:translation-not-applied): callers (services/translate.ts,
// stores/names.svelte.ts, NowPlaying stitch) REQUIRE a 1:1 positionally-aligned result
// (out.length === lines.length) or they discard the whole batch and show originals.
// A naive "join lines with \n, split reply on \n" breaks this: Google Translate STRIPS
// leading/trailing blank lines and reflows segments, so any batch with a boundary blank
// line (very common in lyrics intros/outros) yields a different segment count → the entire
// batch collapsed to Simplified. Fix: separate each line with a unique non-blank SENTINEL
// token (`‹i›` on its own line) that survives translation and resists blank-line stripping,
// then split the reply back on those sentinels. On any residual mismatch we fall back to
// per-line requests so a single bad line never poisons the rest of the batch.
//
// ECHO-MODE (WR / debug:library-tracks-not-translated): the free Google endpoint silently
// bails on an OVERSIZED `q=` payload — instead of translating, it echoes the input back as
// ONE untranslated segment (data[0].length === 1). The sentinels survive that echo intact,
// so the sentinel-split count STILL matches lines.length and the old guard accepted the
// untranslated originals as a "successful" batch → a populated Library tab (50+ distinct
// names queued in one 160ms batch) rendered all Simplified, while small search batches were
// under the threshold and worked. Fix: (1) CHUNK the batch (CHUNK_SIZE lines per Google
// request) so each request stays in the reliable zone; (2) treat a multi-line reply that
// came back as a SINGLE segment as a failure (echo-mode detection) and fall through to
// per-line for that chunk; (3) cap per-line fan-out concurrency so a recovering chunk can't
// burst N parallel requests and get rate-limited.
import type { RequestHandler } from './$types';

const LANG_MAP: Record<string, string> = {
	'zh-Hant': 'zh-TW',
	'zh-Hans': 'zh-CN',
	en: 'en',
	ja: 'ja',
	ko: 'ko',
	es: 'es',
	fr: 'fr',
	de: 'de',
	pt: 'pt',
	ru: 'ru',
	ar: 'ar',
	hi: 'hi',
	id: 'id',
	it: 'it',
	vi: 'vi',
	th: 'th',
	tr: 'tr'
};

const TIMEOUT_MS = 8000;

// Lines per Google request. Empirically the free endpoint flips to echo-mode (returns the
// input untranslated) somewhere past ~45 sentinel-separated short lines; 20 keeps every
// chunk comfortably inside the reliable zone with margin for longer (lyric) lines.
const CHUNK_SIZE = 20;
// Max simultaneous per-line fallback requests, so a recovering chunk doesn't burst N GETs
// and trip Google's rate limiter (which itself manifests as echo-mode / failures).
const PERLINE_CONCURRENCY = 6;

function reply(translated: string[]): Response {
	return new Response(JSON.stringify({ translated }), {
		headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' }
	});
}

interface GResult {
	text: string; // concatenated translated segments
	segments: number; // number of segments Google returned
}

// One Google Translate request for an arbitrary text. Returns the concatenated translated
// text plus the segment count, or null on transport / parse failure so the caller can fall
// back. The segment count lets the batched path detect echo-mode (a multi-line payload that
// comes back as a single segment was NOT translated).
async function gtranslate(text: string, to: string): Promise<GResult | null> {
	try {
		const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
		const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!res.ok) return null;
		// shape: [ [ [translatedChunk, originalChunk, ...], ... ], ... ]
		const data = (await res.json()) as [Array<[string, string]>];
		const segs = data?.[0] ?? [];
		return { text: segs.map((seg) => seg?.[0] ?? '').join(''), segments: segs.length };
	} catch {
		return null;
	}
}

// Unique, non-blank, translation-stable boundary marker. Guillemet brackets + index survive
// Google Translate unchanged and (being non-blank content) are not stripped at batch edges
// the way bare blank lines are.
const sentinel = (i: number) => `\n‹${i}›\n`;
// Matches a sentinel surrounded by any whitespace Google may have added/reflowed around it.
const SENTINEL_RE = /\s*‹\d+›\s*/;

// Per-line fallback: translate each line independently so a single misaligning (or echoed)
// line cannot collapse the rest of the chunk. Bounded concurrency; preserves order and
// empty/failed slots.
async function perLine(lines: string[], to: string): Promise<string[]> {
	const out = new Array<string>(lines.length);
	let next = 0;
	async function worker() {
		while (next < lines.length) {
			const i = next++;
			const line = lines[i];
			if (!line) {
				out[i] = line; // blank line → keep as-is (nothing to translate)
				continue;
			}
			const t = await gtranslate(line, to);
			out[i] = t == null ? line : t.text;
		}
	}
	await Promise.all(Array.from({ length: Math.min(PERLINE_CONCURRENCY, lines.length) }, worker));
	return out;
}

// Translate one chunk (<= CHUNK_SIZE lines) and return positionally-aligned results.
async function translateChunk(lines: string[], to: string): Promise<string[]> {
	if (lines.length === 1) {
		const t = await gtranslate(lines[0], to);
		return [t == null ? lines[0] : t.text];
	}

	// Batched path: join with unique sentinels, split the reply back on them.
	const joined = lines.map((l, i) => (i === 0 ? l : sentinel(i) + l)).join('');
	const res = await gtranslate(joined, to);
	if (res != null) {
		// ECHO-MODE GUARD: a multi-line payload returned as a single segment was NOT
		// translated (Google echoed the input). The sentinel-split count would still match,
		// so we must reject it here BEFORE the count check and fall through to per-line.
		if (res.segments > 1) {
			const parts = res.text.split(SENTINEL_RE);
			if (parts.length === lines.length) return parts.map((p) => p ?? '');
		}
	}

	// Residual mismatch / echo-mode / transport failure → per-line so we never collapse the chunk.
	return perLine(lines, to);
}

export const POST: RequestHandler = async ({ request }) => {
	let body: { lines?: unknown; to?: unknown };
	try {
		body = await request.json();
	} catch {
		return reply([]);
	}
	const lines = Array.isArray(body.lines) ? body.lines.map((x) => String(x)) : [];
	const to = typeof body.to === 'string' ? LANG_MAP[body.to] : undefined;
	if (!lines.length || !to) return reply(lines);

	// Single line: no batching needed, no alignment risk.
	if (lines.length === 1) {
		const t = await gtranslate(lines[0], to);
		return reply([t == null ? lines[0] : t.text]);
	}

	// Chunk so each Google request stays under the echo-mode threshold. Chunks run in
	// parallel; results are concatenated positionally → out.length === lines.length.
	const chunks: string[][] = [];
	for (let i = 0; i < lines.length; i += CHUNK_SIZE) chunks.push(lines.slice(i, i + CHUNK_SIZE));
	try {
		const results = await Promise.all(chunks.map((c) => translateChunk(c, to)));
		const out = results.flat();
		return reply(out.length === lines.length ? out : lines);
	} catch {
		return reply(lines);
	}
};
