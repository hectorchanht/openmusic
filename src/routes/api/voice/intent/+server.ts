// AI voice button — intent endpoint (quick-261122-voice).
// POST { text: string, lang: 'yue'|'cmn'|'en' } → { intent: VoiceIntent, via: 'rules'|'ai'|'cache' }.
//
// Order: (1) unambiguous short transport commands ("暫停", "next") are answered by the pure
// rule parser with ZERO AI cost; (2) the global KV cache (TRANSLATE_CACHE namespace, disjoint
// `voice-intent:` prefix) answers repeats; (3) Workers AI (voice-ai.ts, budget-capped);
// (4) the rule parser again as the never-throw floor. Always 200 with a valid intent — the
// client never has to handle an error shape. CORS is central (hooks.server.ts).
import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse } from '$lib/proxy/http';
import { aiIntent } from '$lib/proxy/voice-ai';
import {
	MAX_UTTERANCE,
	VOICE_LANGS,
	isConfidentLocal,
	normalizeIntent,
	parseIntentLocal,
	type VoiceIntent,
	type VoiceLang
} from '$lib/services/voice-intent';

/** Bump when the prompt / model / schema output changes. */
const INTENT_CACHE_VER = 'v1';
/** 30 days — Q&A answers are evergreen-ish; a stale one costs a re-ask, nothing more. */
const INTENT_CACHE_TTL = 60 * 60 * 24 * 30;

async function sha256Hex(s: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;
	const reply = (intent: VoiceIntent, via: 'rules' | 'ai' | 'cache') =>
		jsonResponse({ intent, via }, origin, { cacheControl: 'no-store' });

	let body: { text?: unknown; lang?: unknown };
	try {
		body = await request.json();
	} catch {
		return reply(normalizeIntent(null), 'rules');
	}
	const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, MAX_UTTERANCE) : '';
	const lang: VoiceLang = (VOICE_LANGS as readonly unknown[]).includes(body.lang) ? (body.lang as VoiceLang) : 'yue';
	const local = parseIntentLocal(text);
	if (!text || isConfidentLocal(text, local)) return reply(local, 'rules');

	const kv = env?.TRANSLATE_CACHE;
	const key = `voice-intent:${INTENT_CACHE_VER}:${lang}:${await sha256Hex(text.toLowerCase())}`;
	if (kv) {
		try {
			const hit = await kv.get(key);
			if (hit) return reply(normalizeIntent(JSON.parse(hit)), 'cache');
		} catch {
			/* KV fault → treat as a miss */
		}
	}

	const ai = await aiIntent(env, text, lang);
	if (ai) {
		if (kv && ai.kind !== 'unknown') {
			try {
				await kv.put(key, JSON.stringify(ai), { expirationTtl: INTENT_CACHE_TTL });
			} catch {
				/* never-throw */
			}
		}
		// The big model saying "unknown" while the rules found a playable phrase: trust the rules
		// (a bare "帝女花" must still play for the design target).
		if (ai.kind === 'unknown' && local.kind !== 'unknown') return reply(local, 'rules');
		return reply(ai, 'ai');
	}
	return reply(local, 'rules');
};
