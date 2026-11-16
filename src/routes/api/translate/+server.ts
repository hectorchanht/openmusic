// Lyrics / name translation proxy (NEW feature endpoint — not part of the music data layer).
// POST { lines: string[], to: LyricsLang } -> { translated: string[], flags: boolean[] }.
// Server-side runs an ordered provider cascade (D-05) — Azure Translator → DeepL Free →
// Cloudflare Workers AI (m2m100-1.2b, quick-261020-wai, $5/day budget guard) → keyless
// unofficial-Google — advancing on transport error / non-2xx / rate-limit / echo, so
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
//
// LATENCY (quick-261116-perf / Korean-lyrics report): correctness was fine but a batched
// Workers-AI reply failed the sentinel segment guard (m2m100 drops/merges `‹i›` markers
// while preserving newlines), so EVERY chunk degraded to per-line fan-out — a 20-line
// Korean lyric batch took ~15-30s and a full song minutes, which reads as "translation
// not working" (NpLyrics waits for the whole batch). Fix: the Workers-AI tier counts
// segments by newline as well as sentinels, translateChunk accepts an exactly-aligned
// newline split, and fully-genuine results are edge-cached provider-side (see POST) so
// repeat plays are instant and spend no AI neurons.
import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';

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

// quick-261116-perf: provider-side translation cache (see POST). VER is the impl/prompt
// version segment of the cache key; the L1 edge TTL is only an upper bound (PoPs evict
// at will) — lyric/name translations are stable and the client already persists
// complete batches indefinitely.
// quick-261116-kvprog: VER bumped v1 → v2 for the KV L2 layer — the key semantics changed
// (a v2 entry may now be served from global KV, not only this PoP's edge cache), so v1
// edge entries are orphaned rather than shadow the new layer.
// quick-261116-kvttl: VER bumped v2 → v3 and KV writes are now PERMANENT (no
// expirationTtl — a KV put without one never expires). Lyric text is immutable, so a
// genuine translation never goes stale: the invalidation lever is this cache-key impl
// version, not time. v2 KV entries (written with the old 90-day TTL) are simply
// orphaned by the version bump and age out on their own — no migration. The L1 edge
// TTL rises to a year as a pure upper bound; KV is the durable layer.
const TRANSLATE_CACHE_VER = 'v3';
const TRANSLATE_CACHE_TTL = 31536000;

// Lines per Google request. Empirically the free endpoint flips to echo-mode (returns the
// input untranslated) somewhere past ~45 sentinel-separated short lines; 20 keeps every
// chunk comfortably inside the reliable zone with margin for longer (lyric) lines.
const CHUNK_SIZE = 20;
// Max simultaneous per-line fallback requests, so a recovering chunk doesn't burst N GETs
// and trip Google's rate limiter (which itself manifests as echo-mode / failures).
// quick-261116-perf: raised 6 → 20 (= CHUNK_SIZE, one wave per chunk) — with the
// Workers-AI batch paths fixed (below) this fallback is rare, but when it does fire on
// a full song (60+ short lyric lines) narrow waves at ~2s/call were the difference
// between ~5s and ~30s of dead waiting.
const PERLINE_CONCURRENCY = 20;

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

// TIER — Cloudflare Workers AI (m2m100-1.2b, quick-261020-wai). Runs on Cloudflare's own
// GPUs via the Workers AI binding (`AI` — add in dashboard: Pages → openmusic → Settings →
// Functions → Bindings → Add → Workers AI, name `AI`). No API keys, no egress blocks.
//
// COST GUARD (Hector: "$5 limit per month"): billed in Neurons — 10K/day free, then
// $0.011/1K neurons. $5/mo ≈ 454K neurons/mo. We track per-call `usage.neurons` (the API
// reports it) in a per-isolate monthly counter and DISABLE the tier for the UTC month once
// MONTHLY_BUDGET_NEURONS is reached. Best-effort (per-isolate, not global) — but at current
// volume (~hundreds of neurons/day ≈ ~10K/month) the $5 cap is unreachable; the guard is a
// safety net, not a throttle.
//
// NOTE: m2m100 outputs Simplified-leaning Chinese for target_lang "chinese". The CLIENT
// normalizes to the requested script (s2t/t2s in translate.ts) — the server returns raw.
const AI_MODEL = '@cf/meta/m2m100-1.2b';
const MONTHLY_BUDGET_NEURONS = 450_000; // ≈ $4.95/mo — Hector's $5/month cap
let aiNeuronsUsed = 0;
let aiBudgetMonth = '';
function aiBudgetOk(): boolean {
	const month = new Date().toISOString().slice(0, 7); // UTC month (YYYY-MM)
	if (month !== aiBudgetMonth) {
		aiBudgetMonth = month;
		aiNeuronsUsed = 0;
	}
	return aiNeuronsUsed < MONTHLY_BUDGET_NEURONS;
}
// m2m100 language names (the API takes English names, not codes).
const AI_LANG_NAMES: Record<string, string> = {
	'zh-Hant': 'chinese',
	'zh-Hans': 'chinese',
	en: 'english',
	ja: 'japanese',
	ko: 'korean',
	es: 'spanish',
	fr: 'french',
	de: 'german',
	pt: 'portuguese',
	ru: 'russian',
	ar: 'arabic',
	hi: 'hindi',
	id: 'indonesian',
	it: 'italian',
	vi: 'vietnamese',
	th: 'thai',
	tr: 'turkish'
};
const workersAiTranslate: Provider = async (text, appTo, env) => {
	const ai = (env as Record<string, unknown> | undefined)?.AI as
		| { run: (model: string, input: Record<string, string>) => Promise<unknown> }
		| undefined;
	if (!ai || !aiBudgetOk()) return null; // no binding, or $5 cap hit → advance
	const target = AI_LANG_NAMES[appTo];
	if (!target) return null;
	// m2m100 needs an explicit source_lang — minimal script-based guess.
	let source = 'english';
	if (/[぀-ゟ゠-ヿ]/.test(text)) source = 'japanese';
	else if (/[가-힣]/.test(text)) source = 'korean';
	else if (/[一-鿿]/.test(text)) source = 'chinese';
	if (source === target) return null;
	try {
		const out = (await ai.run(AI_MODEL, {
			text,
			source_lang: source,
			target_lang: target
		})) as { translated_text?: string; usage?: { neurons?: number } };
		if (typeof out?.usage?.neurons === 'number') aiNeuronsUsed += out.usage.neurons;
		const translated = out?.translated_text;
		if (typeof translated !== 'string' || !translated) return null;
		// quick-261116-perf (Korean-lyrics latency root cause): m2m100 routinely DROPS or
		// merges the `‹i›` sentinel lines while faithfully preserving the newline between
		// real lines, so the sentinel-only segment count read 1 for a perfectly good
		// 20-line batch → the cascade's echo guard rejected it → every chunk degraded to
		// per-line fan-out (~1.5-3.5s × lines / concurrency ≈ 15-30s per song, which users
		// experience as "translation not working"). Count segments by BOTH delimiters and
		// take the max: sentinel parts when they survive, non-empty newline parts when
		// only the line structure survived. A genuine single-segment echo still counts 1.
		const bySentinel = translated.split(SENTINEL_RE).length;
		const byLine = translated.split('\n').filter((l) => l.trim()).length;
		return { text: translated, segments: Math.max(bySentinel, byLine) };
	} catch {
		return null;
	}
};

// Ordered cascade: tries providers in [Azure, DeepL, WorkersAI, Google] order and returns the
// FIRST GENUINE translation. A provider is "failed" (advance to next) when it returns null
// (transport error / non-2xx / rate-limit / absent key / unsupported lang / budget cap), OR when
// a MULTI-SEGMENT source (a sentinel-joined batch) comes back as a single segment (echo-mode —
// the existing segments<=1 heuristic), OR when the output equals the input verbatim (pure
// echo). If every provider fails, returns null so the caller's per-line fallback still runs.
// Providers run SEQUENTIALLY per chunk (advance-on-failure, NOT a parallel fan-out across
// providers — T-25c-03).
const PROVIDERS: Provider[] = [azureTranslate, deeplTranslate, workersAiTranslate, googleTranslate];
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

// quick-261116-perf: dedicated Workers-AI BATCH attempt — the chunk's lines joined by
// PLAIN newlines (m2m100's natural input shape) in small parallel groups, split back
// on newlines. Live evidence after the sentinel fix alone: cold 20-line Korean batches
// still took 8-19s, i.e. long-batch replies misalign (the model merges short lines)
// and chunks degraded to per-line waves. Returns null on total misalignment / echo /
// missing binding / budget cap, leaving the caller's existing sentinel cascade +
// per-line fallbacks fully intact. Only attempted when NO keyed tier (Azure/DeepL) is
// configured, so the D-05 provider priority is unchanged in keyed deployments — in
// the production (keyless) deployment Workers AI already outranks keyless Google.
async function workersAiBatch(
	lines: string[],
	appTo: string,
	env: Env | undefined
): Promise<LineResult[] | null> {
	if (env?.AZURE_TRANSLATOR_KEY || env?.DEEPL_KEY) return null; // keyed tiers keep D-05 order
	const ai = (env as Record<string, unknown> | undefined)?.AI as
		| { run: (model: string, input: Record<string, string>) => Promise<unknown> }
		| undefined;
	if (!ai || !aiBudgetOk()) return null;
	const target = AI_LANG_NAMES[appTo];
	if (!target) return null;
	// Same minimal script-based source guess as workersAiTranslate.
	let source = 'english';
	const probe = lines.join('\n');
	if (/[぀-ゟ゠-ヿ]/.test(probe)) source = 'japanese';
	else if (/[가-힣]/.test(probe)) source = 'korean';
	else if (/[一-鿿]/.test(probe)) source = 'chinese';
	if (source === target) return null;

	// One ai.run for a small group of lines, newline-joined. Aligned parts or null.
	const runGroup = async (group: string[]): Promise<string[] | null> => {
		try {
			const out = (await ai.run(AI_MODEL, {
				text: group.join('\n'),
				source_lang: source,
				target_lang: target
			})) as { translated_text?: string; usage?: { neurons?: number } };
			if (typeof out?.usage?.neurons === 'number') aiNeuronsUsed += out.usage.neurons;
			if (typeof out?.translated_text !== 'string' || !out.translated_text) return null;
			const parts = out.translated_text
				.split('\n')
				.map((l) => l.trim())
				.filter(Boolean);
			if (parts.length !== group.length) return null; // misaligned
			if (parts.every((p, i) => p === group[i])) return null; // pure echo
			return parts;
		} catch {
			return null;
		}
	};

	// GROUPED, not one 20-line call (live evidence, quick-261116-perf): m2m100 merges
	// short lyric lines in a long batch, so a whole-chunk reply misaligns and the chunk
	// degrades to slow per-line waves. 5-line groups align reliably; the groups run in
	// PARALLEL (independent ai.run calls, ~1.5s each), and only a misaligned group pays
	// the per-line fallback — for its own lines only.
	const GROUP_SIZE = 5;
	const groups: string[][] = [];
	for (let i = 0; i < lines.length; i += GROUP_SIZE) groups.push(lines.slice(i, i + GROUP_SIZE));
	const settled = await Promise.all(groups.map((g) => runGroup(g)));
	if (settled.every((p) => p !== null))
		return (settled as string[][]).flatMap((parts, gi) =>
			parts.map((text, j) => {
				const src = groups[gi][j];
				return { text, translated: Boolean(src) && text !== src };
			})
		);
	// Partial success: keep the aligned groups, per-line ONLY the failed groups' lines.
	if (settled.some((p) => p !== null)) {
		const out = new Array<LineResult>(lines.length);
		let base = 0;
		for (let gi = 0; gi < groups.length; gi++) {
			const parts = settled[gi];
			if (parts) {
				parts.forEach((text, j) => {
					const src = groups[gi][j];
					out[base + j] = { text, translated: Boolean(src) && text !== src };
				});
			} else {
				const sub = await perLine(groups[gi], appTo, env);
				sub.forEach((r, j) => (out[base + j] = r));
			}
			base += groups[gi].length;
		}
		return out;
	}
	return null; // every group misaligned → caller's sentinel cascade + per-line
}

// Translate one chunk (<= CHUNK_SIZE lines) and return positionally-aligned per-line results.
async function translateChunk(lines: string[], appTo: string, env: Env | undefined): Promise<LineResult[]> {
	if (lines.length === 1) {
		const t = await cascade(lines[0], appTo, env);
		if (t == null) return [{ text: lines[0], translated: false }];
		return [{ text: t.text, translated: t.text !== lines[0] }];
	}

	// quick-261116-perf: plain-newline Workers-AI batch first (keyless deployments) —
	// one AI call per chunk instead of a per-line wave. Null → the sentinel cascade.
	const batch = await workersAiBatch(lines, appTo, env);
	if (batch) return batch;

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
			// quick-261116-perf: sentinel-mangled but newline-faithful reply (the m2m100
			// batch shape — see workersAiTranslate). Accept the non-empty lines positionally
			// when their count aligns exactly; any other count still falls to per-line.
			const byLine = res.text
				.split('\n')
				.map((l) => l.trim())
				.filter(Boolean);
			if (byLine.length === lines.length)
				return byLine.map((text, i) => ({
					text,
					translated: Boolean(lines[i]) && text !== lines[i]
				}));
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

	// quick-261116-perf — PROVIDER-SIDE CACHE (standing KV-cache rule; the repo's edge
	// pattern is caches.default via edgeCache(), keyed by an own-origin synthetic GET
	// whose query carries the impl version + target + SHA-256 of the canonical input —
	// the dawn-ai-cache key shape: version + input hash). A hit returns BEFORE the
	// cascade runs, so repeat plays of a song cost zero provider calls and zero Workers
	// AI neurons (the $5/mo budget guard below only ever sees misses). Only FULLY
	// genuine results are stored (every non-blank line flagged) — an echo/fallback
	// batch is never cached, mirroring the client's persist rule. Bump
	// TRANSLATE_CACHE_VER whenever the cascade's output behaviour changes.
	//
	// quick-261116-kvprog — TWO LAYERS. L1 = the edge cache above (fast, but per-PoP and
	// evictable: a song paid for in Calgary was a cold miss in Toronto). L2 = KV
	// (`TRANSLATE_CACHE`, namespace openmusic-translate-cache): global + durable, so a
	// genuine translation is paid for ONCE worldwide. Lookup order L1 → L2 → cascade;
	// a genuine result writes BOTH layers (KV permanently — quick-261116-kvttl). A KV hit backfills L1
	// so this PoP serves the next hit at edge speed. Every KV operation is wrapped —
	// a KV fault degrades to L1/cascade and NEVER fails or blocks the response.
	const cache = edgeCache();
	const kv = env?.TRANSLATE_CACHE;
	let cacheReq: Request | null = null;
	let kvKey: string | null = null;
	try {
		const digest = await crypto.subtle.digest(
			'SHA-256',
			new TextEncoder().encode(JSON.stringify([appTo, lines]))
		);
		const hash = Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		kvKey = `translate:${TRANSLATE_CACHE_VER}:${appTo}:${hash}`;
		if (cache)
			cacheReq = ownOriginCacheKey(
				`https://openmusic.lol/api/translate/cache?v=${TRANSLATE_CACHE_VER}&to=${appTo}&h=${hash}`
			);
	} catch {
		kvKey = null; // cache is an optimization — a fault must never fail the request
	}
	const storeL1 = async (translated: string[], flags: boolean[]): Promise<void> => {
		if (!cache || !cacheReq) return;
		try {
			await cache.put(
				cacheReq,
				new Response(JSON.stringify([translated, flags]), {
					headers: {
						'content-type': 'application/json',
						'cache-control': `public, max-age=${TRANSLATE_CACHE_TTL}`
					}
				})
			);
		} catch {
			/* cache write is best-effort */
		}
	};
	// L1 read.
	if (cache && cacheReq) {
		try {
			const hit = await cache.match(cacheReq);
			if (hit) {
				const [hitTranslated, hitFlags] = JSON.parse(await hit.text()) as [string[], boolean[]];
				if (Array.isArray(hitTranslated) && hitTranslated.length === lines.length)
					return reply(hitTranslated, hitFlags);
			}
		} catch {
			cacheReq = null; // a broken L1 key must not receive the finish() write either
		}
	}
	// L2 read (KV) — only on an L1 miss.
	if (kv && kvKey) {
		try {
			const raw = await kv.get(kvKey);
			if (raw) {
				const [kvTranslated, kvFlags] = JSON.parse(raw) as [string[], boolean[]];
				if (Array.isArray(kvTranslated) && kvTranslated.length === lines.length) {
					await storeL1(kvTranslated, kvFlags); // backfill this PoP's L1
					return reply(kvTranslated, kvFlags);
				}
			}
		} catch {
			/* KV fault — degrade to the cascade */
		}
	}
	const finish = async (translated: string[], flags: boolean[]): Promise<Response> => {
		if (lines.every((l, i) => !l || flags[i])) {
			await storeL1(translated, flags);
			if (kv && kvKey) {
				try {
					// quick-261116-kvttl: NO expirationTtl — the entry never expires
					// (lyric text is immutable; TRANSLATE_CACHE_VER is the invalidation lever).
					await kv.put(kvKey, JSON.stringify([translated, flags]));
				} catch {
					/* KV write is best-effort */
				}
			}
		}
		return reply(translated, flags);
	};

	// Single line: no batching needed, no alignment risk.
	if (lines.length === 1) {
		const t = await cascade(lines[0], appTo, env);
		if (t == null) return reply([lines[0]], [false]);
		return finish([t.text], [t.text !== lines[0]]);
	}

	// Chunk so each provider request stays under the echo-mode threshold. Chunks run in
	// parallel; results are concatenated positionally → out.length === lines.length.
	const chunks: string[][] = [];
	for (let i = 0; i < lines.length; i += CHUNK_SIZE) chunks.push(lines.slice(i, i + CHUNK_SIZE));
	try {
		const results = (await Promise.all(chunks.map((c) => translateChunk(c, appTo, env)))).flat();
		if (results.length !== lines.length) return reply(lines, lines.map(() => false));
		return finish(
			results.map((r) => r.text),
			results.map((r) => r.translated)
		);
	} catch {
		return reply(lines, lines.map(() => false));
	}
};
