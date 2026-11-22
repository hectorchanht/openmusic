// AI voice button — edge-side Workers AI helpers (quick-261122-voice).
//
// Two calls, both on the existing `AI` binding (wrangler.jsonc, quick-261020-wai) — no new
// keys, no third-party egress:
//  - INTENT: @cf/meta/llama-3.3-70b-instruct-fp8-fast in JSON mode (json_schema) turns one
//    transcribed sentence into a VoiceIntent. ~700 tokens/call ≈ $0.0004. Falls back to the
//    8B model, then to the pure rule parser — never throws.
//  - TRANSCRIBE: @cf/openai/whisper-large-v3-turbo ($0.0005/audio-minute) for devices with
//    no Web Speech API (the Capacitor Android WebView). Whisper large-v3 knows Cantonese
//    (`yue`), which is the whole point of the feature.
//
// COST CAP (todo: "AI backend + cost cap"): a per-isolate monthly neuron budget, the same
// best-effort posture as /api/translate's $5 guard, SEPARATE from it so a voice burst can
// never starve lyric translation (and vice versa). Over the cap → intent degrades to the rule
// parser, transcribe returns '' (the client says "didn't catch that"). Repeat intents are KV-
// cached (standing KV-cache rule) so a household asking "播帝女花" daily pays once.
import {
	INTENT_JSON_SCHEMA,
	intentSystemPrompt,
	normalizeIntent,
	whisperLanguage,
	type VoiceIntent,
	type VoiceLang
} from '$lib/services/voice-intent';

export const INTENT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const INTENT_MODEL_FALLBACK = '@cf/meta/llama-3.1-8b-instruct';
export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

/** ≈ $2/month at $0.011/1K neurons beyond the free 10K/day — Hector's cost cap for voice. */
export const VOICE_MONTHLY_BUDGET_NEURONS = 180_000;

interface AiBinding {
	run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

let neuronsUsed = 0;
let budgetMonth = '';

export function voiceBudgetOk(now = new Date()): boolean {
	const month = now.toISOString().slice(0, 7);
	if (month !== budgetMonth) {
		budgetMonth = month;
		neuronsUsed = 0;
	}
	return neuronsUsed < VOICE_MONTHLY_BUDGET_NEURONS;
}

function charge(out: unknown, fallbackNeurons: number): void {
	const n = (out as { usage?: { neurons?: number } } | null)?.usage?.neurons;
	neuronsUsed += typeof n === 'number' && Number.isFinite(n) ? n : fallbackNeurons;
}

/** Test seam. */
export function __resetVoiceBudget(used = 0): void {
	neuronsUsed = used;
	budgetMonth = new Date().toISOString().slice(0, 7);
}

export function aiBinding(env: unknown): AiBinding | null {
	const ai = (env as Record<string, unknown> | undefined)?.AI as AiBinding | undefined;
	return ai && typeof ai.run === 'function' ? ai : null;
}

/** Pull the model's JSON out of either shape Workers AI returns (object or string). */
export function extractJson(out: unknown): unknown {
	const r = (out as { response?: unknown } | null)?.response;
	if (r && typeof r === 'object') return r;
	if (typeof r !== 'string') return null;
	const m = r.match(/\{[\s\S]*\}/);
	if (!m) return null;
	try {
		return JSON.parse(m[0]);
	} catch {
		return null;
	}
}

/**
 * Ask the LLM for an intent. Returns null on ANY failure (no binding, budget, transport,
 * JSON-mode miss, invalid shape → `unknown` is treated as a miss so the caller's rule
 * fallback gets a chance).
 */
export async function aiIntent(env: unknown, text: string, lang: VoiceLang): Promise<VoiceIntent | null> {
	const ai = aiBinding(env);
	if (!ai || !voiceBudgetOk()) return null;
	const messages = [
		{ role: 'system', content: intentSystemPrompt(lang) },
		{ role: 'user', content: text }
	];
	for (const model of [INTENT_MODEL, INTENT_MODEL_FALLBACK]) {
		try {
			const out = await ai.run(model, {
				messages,
				max_tokens: 256,
				temperature: 0,
				response_format: { type: 'json_schema', json_schema: INTENT_JSON_SCHEMA }
			});
			charge(out, 60);
			// A genuine "unknown" is an answer, not a fault — no fallback-model retry for it; the
			// route decides whether the rule parser outranks it.
			return normalizeIntent(extractJson(out));
		} catch {
			/* advance to the fallback model */
		}
	}
	return null;
}

/** Base64 without Buffer (works in workerd and node). */
export function toBase64(bytes: Uint8Array): string {
	let s = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(s);
}

/** Whisper transcription. '' on any failure. */
export async function aiTranscribe(env: unknown, audio: Uint8Array, lang: VoiceLang): Promise<string> {
	const ai = aiBinding(env);
	if (!ai || !voiceBudgetOk() || audio.length === 0) return '';
	try {
		const out = await ai.run(WHISPER_MODEL, {
			audio: toBase64(audio),
			task: 'transcribe',
			language: whisperLanguage(lang),
			vad_filter: true
		});
		charge(out, 20);
		const text = (out as { text?: unknown } | null)?.text;
		return typeof text === 'string' ? text.trim() : '';
	} catch {
		return '';
	}
}
