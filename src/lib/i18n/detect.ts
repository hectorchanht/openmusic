// Pure source-language detection + per-part translation decision.
//
// Design (CONTEXT D-01): a hand-rolled Unicode-range + small simplified/traditional
// char-set classifier. NO external deps, NO unicode property escapes (explicit \u
// ranges only, so any TS target compiles). Both exports are PURE — no $state, no
// browser — so they run under the node Vitest project alongside i18n.test.ts.
//
// Priority order for detectLang:
//   1. kana (Hiragana/Katakana)  → 'ja'   (wins over Han when mixed)
//   2. hangul (syllables/jamo)   → 'ko'   (wins over Han when mixed)
//   3. Han present, no kana/hangul:
//        simplified-only signal  → 'zh-Hans'
//        traditional-only signal → 'zh-Hant'
//        ambiguous (both/neither)→ 'zh-Hant'  (default Traditional)
//   4. no CJK / Latin-dominant / empty → 'en'
//
// Kanji-only Japanese acceptably misclassifies as Chinese (CONTEXT D-01) — rare for
// names/lyrics and not worth a dictionary.

export type LangTag = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko';

// Hiragana U+3040–309F, Katakana U+30A0–30FF, Katakana phonetic ext U+31F0–31FF,
// halfwidth katakana U+FF66–FF9D.
const KANA = /[぀-ゟ゠-ヿㇰ-ㇿｦ-ﾝ]/;
// Hangul syllables U+AC00–D7A3, compatibility jamo U+3130–318F, jamo U+1100–11FF.
const HANGUL = /[가-힣㄰-㆏ᄀ-ᇿ]/;
// CJK Unified Ideographs U+4E00–9FFF (+ ext-A U+3400–4DBF).
const HAN = /[㐀-䶿一-鿿]/;

// High-frequency SIMPLIFIED-ONLY characters (their traditional form differs).
// ~50 disambiguating chars. Presence ⇒ the text is Simplified Chinese.
const SIMP_ONLY = new Set(
	'简体爱国听乐这会时实当对开关门问题语习书张飞马鸟鱼龙凤'.split('').concat(
		'东车轮转还过远进运动员丰币应学习气长发齐讠忆认让议讯记'.split('')
	)
);

// High-frequency TRADITIONAL-ONLY characters (their simplified form differs).
// ~50 disambiguating chars. Presence ⇒ the text is Traditional Chinese.
const TRAD_ONLY = new Set(
	'繁體愛國聽樂這會時實當對開關門問題語習書張飛馬鳥魚龍鳳'.split('').concat(
		'東車輪轉還過遠進運動員豐幣應學習氣長髮齊訁憶認讓議訊記'.split('')
	)
);

/** Pure source-language classifier. See module header for priority order. */
export function detectLang(text: string): LangTag {
	if (!text) return 'en';
	if (KANA.test(text)) return 'ja';
	if (HANGUL.test(text)) return 'ko';
	if (HAN.test(text)) {
		let simp = false;
		let trad = false;
		for (const ch of text) {
			if (SIMP_ONLY.has(ch)) simp = true;
			else if (TRAD_ONLY.has(ch)) trad = true;
		}
		if (simp && !trad) return 'zh-Hans';
		if (trad && !simp) return 'zh-Hant';
		// both signals OR neither (ambiguous Han) → default Traditional.
		return 'zh-Hant';
	}
	return 'en';
}

/**
 * Per-text-unit decision: should this text be sent to translation for `target`?
 * Pure. Used per name (artist/title), per lyric line, per Last.fm tag.
 *   - target === 'off'                  → false (no translation at all)
 *   - detected source ∈ whitelist       → false (render original / pass-through)
 *   - detected source === target        → false (already in target; skip round-trip)
 *   - otherwise                         → true
 */
export function shouldTranslate(text: string, target: string, whitelist: readonly string[]): boolean {
	if (target === 'off') return false;
	const src = detectLang(text);
	if (whitelist.includes(src)) return false;
	if (src === target) {
		// zh-Hant/zh-Hans detection rides a small disambiguation char-set, so a src===target
		// match does NOT prove the text is already in the target script. Common simplified chars
		// outside the set (e.g. 陈 in 陈奕迅) misdetect as the zh-Hant default and were wrongly
		// skipped, leaving simplified text on screen. For a CHINESE target we therefore fall
		// through and let /api/translate normalize the script — a no-op when already correct,
		// cached by the names store — guaranteeing simplified↔traditional always converts. For
		// en/ja/ko an exact match still skips the round-trip. Opt out per part via the skip
		// whitelist (e.g. add zh-Hant to leave Traditional untouched).
		if (target !== 'zh-Hant' && target !== 'zh-Hans') return false;
	}
	return true;
}
