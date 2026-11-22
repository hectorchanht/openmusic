// AI voice button — the PURE intent layer (quick-261122-voice).
//
// Design target (todo ai-voice-button.md, Hector 2026-11-18): a 90-year-old who loves
// Cantonese opera, cannot type and cannot use any Chinese input method, speaks ONE simple
// sentence (Cantonese / Mandarin / English). The AI works out the intent, the app shows an
// action card ("I will play X"), she taps OK, the system executes — the Hotel Portal AI Bulk
// Edit pattern: AI PROPOSES, human CONFIRMS, system EXECUTES.
//
// This module is dependency-free and node-testable, and is imported by BOTH sides:
//  - the edge route /api/voice/intent uses `normalizeIntent` to sanitise the LLM's JSON and
//    `parseIntentLocal` as its never-throw fallback (no binding / budget cap / bad JSON) and
//    as a zero-cost fast path for unambiguous transport commands ("暫停", "next");
//  - the client store uses `parseIntentLocal` when the route itself is unreachable, plus the
//    language helpers below for Web Speech / Whisper / speechSynthesis.
//
// V1 intents (todo): play a song/artist, play a genre/era (Cantonese opera, 80s goldies),
// resume favourites/history, playback controls, and pure Q&A.

/** The SPOKEN language the user picked (not the UI language). */
export type VoiceLang = 'yue' | 'cmn' | 'en';
export type VoiceLangSetting = 'auto' | VoiceLang;
export const VOICE_LANGS: readonly VoiceLang[] = ['yue', 'cmn', 'en'] as const;

export const VOICE_INTENT_KINDS = [
	'play_song',
	'play_artist',
	'play_genre',
	'play_liked',
	'play_history',
	'pause',
	'resume',
	'next',
	'previous',
	'answer',
	'unknown'
] as const;
export type VoiceIntentKind = (typeof VOICE_INTENT_KINDS)[number];

export interface VoiceIntent {
	kind: VoiceIntentKind;
	/** Search keyword for play_song / play_artist / play_genre ('' otherwise). */
	query: string;
	/** Short spoken-style reply for `answer` ('' otherwise). */
	answer: string;
}

/** Transport kinds — executed on the player directly, no search. */
export const CONTROL_KINDS: readonly VoiceIntentKind[] = ['pause', 'resume', 'next', 'previous'];
/** Kinds that need a non-empty search query to mean anything. */
const QUERY_KINDS: readonly VoiceIntentKind[] = ['play_song', 'play_artist', 'play_genre'];

export const MAX_UTTERANCE = 300;
const MAX_QUERY = 100;
const MAX_ANSWER = 500;

const UNKNOWN: VoiceIntent = { kind: 'unknown', query: '', answer: '' };

/**
 * Sanitise an untrusted intent object (the LLM's JSON, or a client-received body). Unknown
 * kinds, non-string fields and query-kinds with an empty query all collapse to `unknown`, so a
 * downstream switch never sees an invalid shape. Never throws.
 */
export function normalizeIntent(raw: unknown): VoiceIntent {
	if (!raw || typeof raw !== 'object') return { ...UNKNOWN };
	const r = raw as Record<string, unknown>;
	const kind = typeof r.kind === 'string' && (VOICE_INTENT_KINDS as readonly string[]).includes(r.kind)
		? (r.kind as VoiceIntentKind)
		: 'unknown';
	const query = typeof r.query === 'string' ? r.query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY) : '';
	const answer = typeof r.answer === 'string' ? r.answer.trim().slice(0, MAX_ANSWER) : '';
	if (QUERY_KINDS.includes(kind) && !query) return { ...UNKNOWN };
	if (kind === 'answer' && !answer) return { ...UNKNOWN };
	return {
		kind,
		query: QUERY_KINDS.includes(kind) ? query : '',
		answer: kind === 'answer' ? answer : ''
	};
}

// --- Rule-based parser ---------------------------------------------------------------------
// Covers the common one-sentence commands in all three spoken languages. It is the fallback
// whenever the AI is unavailable, so it must ALWAYS produce something playable for a plain
// "播帝女花" / "帝女花" / "play Teresa Teng".

const PAUSE_RE = /^(?:請|请)?(?:幫我|帮我)?(?:暫停|暂停|停(?:一停|一下|低|止|咗佢|下)?|唔好播(?:住)?|不要播了?|收聲|pause|stop)(?:\s*(?:it|the music|music))?(?:啦|吖|呀|喇|吧|了|先)?[.!。！]*$/i;
const RESUME_RE = /^(?:請|请)?(?:幫我|帮我)?(?:繼續|继续|再播|接住播|接着播|恢復播放|恢复播放|resume|continue|unpause|keep playing)(?:播|播放|playing)?(?:啦|吖|呀|喇|吧|了)?[.!。！]*$/i;
const NEXT_RE = /(?:下一首|下一隻|下一只|下首|下一曲|轉歌|换一首|換一首|換歌|换歌|跳過|跳过|next(?: song| track)?|skip(?: this)?)/i;
const PREV_RE = /(?:上一首|上一隻|上一只|上首|上一曲|previous(?: song| track)?|go back|last song)/i;
const LIKED_RE = /(?:(?:我|我哋|我们)?(?:鍾意|鐘意|中意|喜歡|喜欢|收藏|最愛|最爱|心水)(?:嘅|的|咗嘅|了的)?(?:歌|歌曲)|favou?rites?|liked songs|songs i like|my likes)/i;
const HISTORY_RE = /(?:(?:之前|上次|最近|頭先|啱先|刚才|剛才)(?:聽|听)(?:過|过|緊|紧)?(?:嘅|的)?|聽過嘅|听过的|history|recently played|played before|what i (?:was )?listen)/i;
const OPERA_RE = /(?:粵劇|粤剧|大戲|大戏|粵曲|粤曲|戲曲|戏曲|cantonese opera)/i;
const GOLDIES_RE = /(?:(?:80|八十|八零)年代|懷舊|怀旧|金曲|老歌|經典歌|经典歌|oldies|goldies|golden oldies|80s)/i;
const QUESTION_RE = /(?:\?|？|什麼|什么|甚麼|點解|点解|點樣|点样|幾點|几点|邊個|边个|係咪|是不是|為什麼|为什么|乜嘢|咩嘢|\bwhat\b|\bwho\b|\bwhy\b|\bhow\b|\bwhen\b|\bwhere\b)/i;
const PLAY_PREFIX_RE = /^(?:請|请|please\s+)?(?:幫我|帮我|同我|俾我|給我|给我|我想|我要|想|可唔可以|可不可以|can you|could you)?\s*(?:播放|播|放|聽|听|唱|play|put on|listen to)(?:下|一下|吓|一首|首|返|番)?\s*/i;
const TRAILING_RE = /\s*(?:啦|吖|呀|喇|吧|了|先|please|for me|thanks|thank you|唔該|唔该|謝謝|谢谢)[\s.!。！]*$/i;
const BY_ARTIST_RE = /(?:嘅歌|的歌|啲歌|嘅嘢|的作品|songs?(?: by)?)$/i;

/** Strip leading/trailing punctuation and filler. */
function clean(text: string): string {
	return text.replace(/[\s,，。.!！、]+$/g, '').replace(/^[\s,，。.!！、]+/g, '').trim();
}

export function parseIntentLocal(input: string): VoiceIntent {
	const text = clean(String(input ?? '').slice(0, MAX_UTTERANCE));
	if (!text) return { ...UNKNOWN };
	if (PAUSE_RE.test(text)) return { kind: 'pause', query: '', answer: '' };
	if (RESUME_RE.test(text)) return { kind: 'resume', query: '', answer: '' };
	if (text.length <= 24 && NEXT_RE.test(text)) return { kind: 'next', query: '', answer: '' };
	if (text.length <= 24 && PREV_RE.test(text)) return { kind: 'previous', query: '', answer: '' };
	if (LIKED_RE.test(text)) return { kind: 'play_liked', query: '', answer: '' };
	if (HISTORY_RE.test(text)) return { kind: 'play_history', query: '', answer: '' };
	if (OPERA_RE.test(text)) return { kind: 'play_genre', query: '粤剧', answer: '' };
	if (GOLDIES_RE.test(text)) return { kind: 'play_genre', query: '80年代 粤语 金曲', answer: '' };

	const hadPlayVerb = PLAY_PREFIX_RE.test(text);
	let rest = text.replace(PLAY_PREFIX_RE, '');
	rest = clean(rest.replace(TRAILING_RE, ''));
	// A question without a play verb is Q&A — the rules cannot answer, so `unknown`.
	if (!hadPlayVerb && QUESTION_RE.test(text)) return { ...UNKNOWN };
	if (!rest) return { ...UNKNOWN };
	if (BY_ARTIST_RE.test(rest)) {
		const artist = clean(rest.replace(BY_ARTIST_RE, ''));
		if (artist) return { kind: 'play_artist', query: artist.slice(0, MAX_QUERY), answer: '' };
	}
	// A bare phrase ("帝女花", "Teresa Teng") is a play request — the elderly user often just
	// says the name. Song vs artist is indistinguishable here; play_song searches it and
	// the top hit wins either way.
	return { kind: 'play_song', query: rest.slice(0, MAX_QUERY), answer: '' };
}

/** True when the rule parser's verdict is unambiguous enough to skip the AI call entirely. */
export function isConfidentLocal(text: string, intent: VoiceIntent): boolean {
	return CONTROL_KINDS.includes(intent.kind) && clean(text).length <= 16;
}

// --- Language helpers ----------------------------------------------------------------------

/**
 * Resolve `auto` to a concrete spoken language. Cantonese wins for HK/MO device locales (the
 * design target), Mandarin for zh-CN/TW/SG, Traditional-Chinese UI without a TW hint →
 * Cantonese (this app's home audience), anything else → English.
 */
export function resolveVoiceLang(
	setting: VoiceLangSetting,
	appLang: string,
	navLangs: readonly string[] = []
): VoiceLang {
	if (setting !== 'auto') return setting;
	const langs = navLangs.map((l) => l.toLowerCase());
	if (langs.some((l) => l.startsWith('yue') || l === 'zh-hk' || l === 'zh-mo' || l.startsWith('zh-hant-hk'))) return 'yue';
	if (appLang === 'zh-Hant') {
		return langs.some((l) => l === 'zh-tw' || l.startsWith('zh-hant-tw')) ? 'cmn' : 'yue';
	}
	if (appLang === 'zh-Hans' || langs.some((l) => l.startsWith('zh'))) return 'cmn';
	return 'en';
}

/** BCP-47 tag for Web Speech recognition. */
export function speechRecognitionLang(lang: VoiceLang, appLang: string): string {
	if (lang === 'yue') return 'yue-Hant-HK';
	if (lang === 'cmn') return appLang === 'zh-Hant' ? 'zh-TW' : 'zh-CN';
	return 'en-US';
}

/** Whisper `language` code (ISO-639 — Whisper large-v3 knows Cantonese as `yue`). */
export function whisperLanguage(lang: VoiceLang): string {
	return lang === 'yue' ? 'yue' : lang === 'cmn' ? 'zh' : 'en';
}

/** speechSynthesis voice tag for reading the card (the card text is in the UI language). */
export function ttsLang(lang: VoiceLang, appLang: string): string {
	if (appLang === 'zh-Hant') return lang === 'cmn' ? 'zh-TW' : 'zh-HK';
	if (appLang === 'zh-Hans') return 'zh-CN';
	return appLang;
}

/** Human name of the spoken language for the LLM prompt. */
function langName(lang: VoiceLang): string {
	return lang === 'yue' ? 'Cantonese (reply in Traditional Chinese, Hong Kong Cantonese style)'
		: lang === 'cmn' ? 'Mandarin (reply in Chinese)'
		: 'English (reply in English)';
}

/** The LLM's JSON schema (Workers AI JSON mode, OpenAI-compatible `json_schema`). */
export const INTENT_JSON_SCHEMA = {
	type: 'object',
	properties: {
		kind: { type: 'string', enum: [...VOICE_INTENT_KINDS] },
		query: { type: 'string' },
		answer: { type: 'string' }
	},
	required: ['kind', 'query', 'answer']
} as const;

/** System prompt for the intent model. Kept here so tests can pin the contract. */
export function intentSystemPrompt(lang: VoiceLang): string {
	return [
		'You are the voice assistant of a music player app used by elderly people in Hong Kong.',
		'The user said ONE short sentence (speech-to-text output, may contain recognition errors or homophones — guess the most likely meaning).',
		'Classify it into exactly one kind and return JSON {"kind","query","answer"}:',
		'- play_song: wants a specific song (query = song title, plus the singer if said).',
		'- play_artist: wants songs by a singer/band (query = the singer name).',
		'- play_genre: wants a genre, style or era, e.g. Cantonese opera, 80s Cantonese hits, Teresa Teng-era classics (query = a short search keyword in Simplified Chinese that works on Chinese music platforms, e.g. "粤剧", "80年代 粤语 金曲", "邓丽君 经典").',
		'- play_liked: wants their favourite / liked / saved songs.',
		'- play_history: wants what they listened to before / recently.',
		'- pause, resume, next, previous: playback controls.',
		'- answer: a question or chat that is not a music command (answer = a short, warm reply of at most 2 sentences).',
		'- unknown: cannot tell.',
		'For songs and singers, write the query with the ORIGINAL Chinese name when the song/singer is Chinese (e.g. 帝女花, 任剑辉, 张学友), fixing obvious speech-recognition homophone mistakes.',
		'query is "" unless kind is play_song/play_artist/play_genre. answer is "" unless kind is answer.',
		`The user speaks ${langName(lang)}.`
	].join('\n');
}
