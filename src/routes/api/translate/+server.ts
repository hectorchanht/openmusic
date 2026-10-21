// Lyrics / name translation proxy (NEW feature endpoint — not part of the music data layer).
// POST { lines: string[], to: LyricsLang } -> { translated: string[], flags: boolean[] }.
// Server-side runs an ordered provider cascade (D-05) — Azure Translator → DeepL Free →
// keyless unofficial-Google — advancing on transport error / non-2xx / rate-limit / echo, so
// a single flaky upstream no longer drops the batch. Provider keys are OPTIONAL and edge-only
// (D-06): an absent key skips that tier and the cascade falls through, ending at keyless
// Google. It batches the lines in chunked requests and falls back to the originals on total
// failure. CORS is
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
//
// FALLBACK SIGNAL (WR / debug:dashboard-liked-not-translated): a fallback line (echo /
// transport failure / per-line miss) is returned as the ORIGINAL text, indistinguishable
// from a line that legitimately translates to itself. The CLIENTS cached those originals as
// final translations and never re-requested → liked/library names stayed Simplified forever.
// Fix: emit a per-line `flags: boolean[]` alongside `translated` — true when a line was
// GENUINELY translated, false when it fell back to the original. Clients persist only
// genuinely-translated lines (fallbacks stay eligible for a later retry instead of poisoning
// the cache). `flags` is additive; the `translated`/length contract is unchanged.
import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';

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

// A per-line outcome: the (possibly original) text + whether it was GENUINELY translated.
interface LineResult {
	text: string;
	translated: boolean;
}

function reply(translated: string[], flags: boolean[]): Response {
	return new Response(JSON.stringify({ translated, flags }), {
		headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' }
	});
}

interface GResult {
	text: string; // concatenated translated segments
	// Number of translated segments: Google's own array length, or (Azure/DeepL) the
	// sentinel-delimited part count of the reply. Drives the echo-mode guard — a multi-line
	// batch that comes back as a SINGLE segment was NOT translated.
	segments: number;
}

// Unique, non-blank, translation-stable boundary marker. Guillemet brackets + index survive
// every provider unchanged and (being non-blank content) are not stripped at batch edges the
// way bare blank lines are. Defined BEFORE the providers so azure/deepl can derive `segments`
// from the surviving sentinels.
const sentinel = (i: number) => `\n‹${i}›\n`;
// Matches a sentinel surrounded by any whitespace a provider may have added/reflowed around it.
const SENTINEL_RE = /\s*‹\d+›\s*/;

// --- Provider cascade (D-05): Azure Translator → DeepL Free → keyless Google. ---
// Each provider maps the APP target code (e.g. 'zh-Hant') itself and returns the unchanged
// GResult shape, or null to advance the cascade. RAW `fetch` of ABSOLUTE upstream URLs is
// correct on the edge (apiFetch is the CLIENT seam and would prepend /api — wrong here); each
// stays on AbortSignal.timeout(TIMEOUT_MS). Provider keys are read from `env` (platform.env)
// and injected into upstream HEADERS ONLY — never echoed to the client (D-06 / T-25c-01).

// A provider: (joined-or-single text, APP target code, edge env) → GResult | null.
type Provider = (text: string, appTo: string, env: Env | undefined) => Promise<GResult | null>;

// Azure BCP-47 target codes. zh-Hant/zh-Hans are Azure's exact codes; the rest pass through.
const AZURE_MAP: Record<string, string> = {
	'zh-Hant': 'zh-Hant',
	'zh-Hans': 'zh-Hans',
	en: 'en', ja: 'ja', ko: 'ko', es: 'es', fr: 'fr', de: 'de', pt: 'pt',
	ru: 'ru', ar: 'ar', hi: 'hi', id: 'id', it: 'it', vi: 'vi', th: 'th', tr: 'tr'
};

// DeepL target_lang codes (uppercase). zh-Hant→ZH-HANT (Traditional, supported since Nov 2024).
// ar/hi/vi/th are NOT DeepL-supported → absent from the map so the cascade advances to Google.
const DEEPL_MAP: Record<string, string> = {
	'zh-Hant': 'ZH-HANT',
	'zh-Hans': 'ZH-HANS',
	en: 'EN', ja: 'JA', ko: 'KO', es: 'ES', fr: 'FR', de: 'DE', pt: 'PT',
	ru: 'RU', id: 'ID', it: 'IT', tr: 'TR'
};

// TIER 1 — Azure Translator (2M chars/mo free). Skipped (null) when no key is configured; the
// region header is injected when present. `segments` = surviving sentinel-part count so the
// existing batched echo-mode guard applies uniformly across providers.
const azureTranslate: Provider = async (text, appTo, env) => {
	const key = env?.AZURE_TRANSLATOR_KEY;
	if (!key) return null; // absent key → skip this tier (supported state, cascade falls through)
	const azTo = AZURE_MAP[appTo];
	if (!azTo) return null; // target unsupported by Azure → advance
	try {
		const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(azTo)}`;
		const headers: Record<string, string> = {
			'Ocp-Apim-Subscription-Key': key,
			'content-type': 'application/json'
		};
		// Region is required for most Azure Translator resources; inject it edge-side when set.
		if (env?.AZURE_TRANSLATOR_REGION)
			headers['Ocp-Apim-Subscription-Region'] = env.AZURE_TRANSLATOR_REGION;
		const res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify([{ Text: text }]),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!res.ok) return null; // non-2xx (incl. 429 rate-limit) → advance
		// shape: [ { translations: [ { text, to } ] } ]
		const data = (await res.json()) as Array<{ translations?: Array<{ text?: string }> }>;
		const out = data?.[0]?.translations?.[0]?.text;
		if (typeof out !== 'string') return null;
		return { text: out, segments: out.split(SENTINEL_RE).length };
	} catch {
		return null;
	}
};

// TIER 2 — DeepL Free (500k chars/mo, api-free.deepl.com). Skipped (null) with no key.
const deeplTranslate: Provider = async (text, appTo, env) => {
	const key = env?.DEEPL_KEY;
	if (!key) return null; // absent key → skip this tier (supported state)
	const dlTo = DEEPL_MAP[appTo];
	if (!dlTo) return null; // target unsupported by DeepL (ar/hi/vi/th) → advance to Google
	try {
		const res = await fetch('https://api-free.deepl.com/v2/translate', {
			method: 'POST',
			headers: {
				authorization: `DeepL-Auth-Key ${key}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ text: [text], target_lang: dlTo }),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!res.ok) return null; // non-2xx (incl. 456 quota / 429) → advance
		// shape: { translations: [ { detected_source_language, text } ] }
		const data = (await res.json()) as { translations?: Array<{ text?: string }> };
		const out = data?.translations?.[0]?.text;
		if (typeof out !== 'string') return null;
		return { text: out, segments: out.split(SENTINEL_RE).length };
	} catch {
		return null;
	}
};

// TIER 3 — keyless unofficial Google (the ORIGINAL gtranslate body, verbatim). Always attempted
// last; maps via LANG_MAP (zh-Hant→zh-TW). `segments` is Google's own array length — the value
// the echo-mode guard was originally calibrated against.
const googleTranslate: Provider = async (text, appTo) => {
	const to = LANG_MAP[appTo];
	if (!to) return null; // not Google-supported (unreachable — validated at the top level)
	try {
		const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
		// RAW fetch (not apiFetch — fetch→apiFetch audit): SERVER-SIDE (edge) fetch of the ABSOLUTE upstream
		// Google Translate URL. apiFetch is the client seam and would prepend the /api base — wrong here.
		const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!res.ok) return null;
		// shape: [ [ [translatedChunk, originalChunk, ...], ... ], ... ]
		const data = (await res.json()) as [Array<[string, string]>];
		const segs = data?.[0] ?? [];
		return { text: segs.map((seg) => seg?.[0] ?? '').join(''), segments: segs.length };
	} catch {
		return null;
	}
};

// Ordered cascade: tries providers in [Azure, DeepL, Google] order and returns the FIRST
// GENUINE translation. A provider is "failed" (advance to next) when it returns null (transport
// error / non-2xx / rate-limit / absent key / unsupported lang), OR when a MULTI-SEGMENT source
// (a sentinel-joined batch) comes back as a single segment (echo-mode — the existing segments<=1
// heuristic), OR when the output equals the input verbatim (pure echo). If every provider fails,
// returns null so the caller's per-line fallback still runs. Providers run SEQUENTIALLY per
// chunk (advance-on-failure, NOT a parallel fan-out across providers — T-25c-03).
const PROVIDERS: Provider[] = [azureTranslate, deeplTranslate, googleTranslate];
async function cascade(text: string, appTo: string, env: Env | undefined): Promise<GResult | null> {
	// The segment-count echo heuristic only applies to a joined batch (carries sentinels): a
	// single short line legitimately translates to ONE segment and must not be rejected as echo.
	const multiSegment = /‹\d+›/.test(text);
	for (const provider of PROVIDERS) {
		const r = await provider(text, appTo, env);
		if (r == null) continue; // transport / non-2xx / absent key / unsupported → next provider
		if (multiSegment && r.segments <= 1) continue; // echo-mode: multi-line collapsed to one segment
		if (r.text === text) continue; // pure echo (output identical to input) → next provider
		return r; // genuine translation
	}
	return null; // every provider failed → the per-line fallback runs
}

// Per-line fallback: translate each line independently so a single misaligning (or echoed)
// line cannot collapse the rest of the chunk. Bounded concurrency; preserves order and
// empty/failed slots. A line is `translated` only when the cascade succeeded AND changed it.
async function perLine(lines: string[], appTo: string, env: Env | undefined): Promise<LineResult[]> {
	const out = new Array<LineResult>(lines.length);
	let next = 0;
	async function worker() {
		while (next < lines.length) {
			const i = next++;
			const line = lines[i];
			if (!line) {
				out[i] = { text: line, translated: false }; // blank line → nothing to translate
				continue;
			}
			const t = await cascade(line, appTo, env);
			if (t == null) out[i] = { text: line, translated: false };
			else out[i] = { text: t.text, translated: t.text !== line };
		}
	}
	await Promise.all(Array.from({ length: Math.min(PERLINE_CONCURRENCY, lines.length) }, worker));
	return out;
}

// Translate one chunk (<= CHUNK_SIZE lines) and return positionally-aligned per-line results.
async function translateChunk(lines: string[], appTo: string, env: Env | undefined): Promise<LineResult[]> {
	if (lines.length === 1) {
		const t = await cascade(lines[0], appTo, env);
		if (t == null) return [{ text: lines[0], translated: false }];
		return [{ text: t.text, translated: t.text !== lines[0] }];
	}

	// Batched path: join with unique sentinels, split the reply back on them.
	const joined = lines.map((l, i) => (i === 0 ? l : sentinel(i) + l)).join('');
	const res = await cascade(joined, appTo, env);
	if (res != null) {
		// ECHO-MODE GUARD: a multi-line payload returned as a single segment was NOT
		// translated (Google echoed the input). The sentinel-split count would still match,
		// so we must reject it here BEFORE the count check and fall through to per-line.
		if (res.segments > 1) {
			const parts = res.text.split(SENTINEL_RE);
			if (parts.length === lines.length)
				return parts.map((p, i) => {
					const text = p ?? '';
					// Genuinely translated when the batched output differs from the source line.
					return { text, translated: Boolean(lines[i]) && text !== lines[i] };
				});
		}
	}

	// Residual mismatch / echo-mode / transport failure → per-line so we never collapse the chunk.
	return perLine(lines, appTo, env);
}

export const POST: RequestHandler = async ({ request, platform }) => {
	// platform?.env is the verified Cloudflare-adapter binding path (parity with /api/similar).
	// Provider keys are read edge-side only and NEVER echoed to the client (D-06 / T-25c-01);
	// they are threaded through the cascade and injected into upstream headers only.
	const env = platform?.env as Env | undefined;

	let body: { lines?: unknown; to?: unknown };
	try {
		body = await request.json();
	} catch {
		return reply([], []);
	}
	const lines = Array.isArray(body.lines) ? body.lines.map((x) => String(x)) : [];
	// Keep the APP target code (e.g. 'zh-Hant') so each provider maps it itself. "Supported" =
	// the union of providers, i.e. anything in LANG_MAP (at least Google-supported); an unknown
	// `to` is rejected here and the originals are returned with all-false flags.
	const appTo = typeof body.to === 'string' && body.to in LANG_MAP ? body.to : undefined;
	if (!lines.length || !appTo) return reply(lines, lines.map(() => false));

	// Single line: no batching needed, no alignment risk.
	if (lines.length === 1) {
		const t = await cascade(lines[0], appTo, env);
		if (t == null) return reply([lines[0]], [false]);
		return reply([t.text], [t.text !== lines[0]]);
	}

	// Chunk so each provider request stays under the echo-mode threshold. Chunks run in
	// parallel; results are concatenated positionally → out.length === lines.length.
	const chunks: string[][] = [];
	for (let i = 0; i < lines.length; i += CHUNK_SIZE) chunks.push(lines.slice(i, i + CHUNK_SIZE));
	try {
		const results = (await Promise.all(chunks.map((c) => translateChunk(c, appTo, env)))).flat();
		if (results.length !== lines.length) return reply(lines, lines.map(() => false));
		return reply(
			results.map((r) => r.text),
			results.map((r) => r.translated)
		);
	} catch {
		return reply(lines, lines.map(() => false));
	}
};
