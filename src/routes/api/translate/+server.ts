// Lyrics / name translation proxy (NEW feature endpoint — not part of the music data layer).
// POST { lines: string[], to: LyricsLang } -> { translated: string[] }.
// Server-side calls an unofficial Google translate endpoint (no key), batches the
// lines in ONE request, and falls back to the originals on any failure. CORS is handled
// CENTRALLY by src/hooks.server.ts (allowlisted Access-Control-Allow-Origin + OPTIONS 204
// for every /api/* route, incl. the native Capacitor origin) — this handler needs no
// per-route CORS logic of its own.
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

function reply(translated: string[]): Response {
	return new Response(JSON.stringify({ translated }), {
		headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' }
	});
}

// One Google Translate request for an arbitrary text. Returns the concatenated translated
// text (segments joined), or null on transport / parse failure so the caller can fall back.
async function gtranslate(text: string, to: string): Promise<string | null> {
	try {
		const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
		const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!res.ok) return null;
		// shape: [ [ [translatedChunk, originalChunk, ...], ... ], ... ]
		const data = (await res.json()) as [Array<[string, string]>];
		return (data?.[0] ?? []).map((seg) => seg?.[0] ?? '').join('');
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

// Per-line fallback: translate each line independently so a single misaligning line cannot
// collapse the rest of the batch. Runs in parallel; preserves order and empty/failed slots.
async function perLine(lines: string[], to: string): Promise<string[]> {
	return Promise.all(
		lines.map(async (line) => {
			if (!line) return line; // blank line → keep as-is (nothing to translate)
			const t = await gtranslate(line, to);
			return t == null ? line : t;
		})
	);
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
		return reply([t == null ? lines[0] : t]);
	}

	// Batched path: join with unique sentinels, split the reply back on them.
	const joined = lines.map((l, i) => (i === 0 ? l : sentinel(i) + l)).join('');
	const out = await gtranslate(joined, to);
	if (out != null) {
		const parts = out.split(SENTINEL_RE);
		if (parts.length === lines.length) return reply(parts.map((p) => p ?? ''));
	}

	// Residual mismatch / transport failure → per-line so we never collapse the whole batch.
	try {
		const perLineOut = await perLine(lines, to);
		return reply(perLineOut);
	} catch {
		return reply(lines);
	}
};
