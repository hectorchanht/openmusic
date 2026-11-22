import { describe, it, expect } from 'vitest';
import {
	normalizeIntent,
	parseIntentLocal,
	isConfidentLocal,
	resolveVoiceLang,
	speechRecognitionLang,
	whisperLanguage,
	ttsLang,
	intentSystemPrompt
} from './voice-intent';

describe('parseIntentLocal — quick-261122-voice rule fallback', () => {
	it.each([
		['暫停', 'pause'],
		['停一停', 'pause'],
		['pause', 'pause'],
		['Stop the music', 'pause'],
		['繼續播', 'resume'],
		['继续', 'resume'],
		['resume', 'resume'],
		['下一首', 'next'],
		['換歌啦', 'next'],
		['next song', 'next'],
		['上一首', 'previous'],
		['previous track', 'previous']
	])('%s → %s', (text, kind) => {
		expect(parseIntentLocal(text).kind).toBe(kind);
	});

	it('liked / history', () => {
		expect(parseIntentLocal('播我鍾意嘅歌').kind).toBe('play_liked');
		expect(parseIntentLocal('play my favourites').kind).toBe('play_liked');
		expect(parseIntentLocal('播返之前聽過嘅').kind).toBe('play_history');
		expect(parseIntentLocal('recently played').kind).toBe('play_history');
	});

	it('genres map to a CN-platform keyword', () => {
		expect(parseIntentLocal('我想聽粵劇')).toEqual({ kind: 'play_genre', query: '粤剧', answer: '' });
		expect(parseIntentLocal('播大戲啦').query).toBe('粤剧');
		expect(parseIntentLocal('play some 80s goldies').query).toBe('80年代 粤语 金曲');
	});

	it('play X strips the verb and particles', () => {
		expect(parseIntentLocal('播帝女花啦')).toEqual({ kind: 'play_song', query: '帝女花', answer: '' });
		expect(parseIntentLocal('幫我播一首月亮代表我的心')).toMatchObject({ kind: 'play_song', query: '月亮代表我的心' });
		expect(parseIntentLocal('Play Teresa Teng please')).toMatchObject({ kind: 'play_song', query: 'Teresa Teng' });
	});

	it('a bare name is a play request (the elderly user just says the title)', () => {
		expect(parseIntentLocal('帝女花')).toMatchObject({ kind: 'play_song', query: '帝女花' });
	});

	it('"X 嘅歌" is an artist request', () => {
		expect(parseIntentLocal('播張學友嘅歌')).toMatchObject({ kind: 'play_artist', query: '張學友' });
	});

	it('a question without a play verb is unknown (rules cannot answer)', () => {
		expect(parseIntentLocal('今日天氣點樣？').kind).toBe('unknown');
		expect(parseIntentLocal('who sang this?').kind).toBe('unknown');
	});

	it('empty → unknown', () => {
		expect(parseIntentLocal('').kind).toBe('unknown');
		expect(parseIntentLocal('  。 ').kind).toBe('unknown');
	});
});

describe('isConfidentLocal', () => {
	it('only short transport commands skip the AI', () => {
		expect(isConfidentLocal('暫停', parseIntentLocal('暫停'))).toBe(true);
		expect(isConfidentLocal('播帝女花', parseIntentLocal('播帝女花'))).toBe(false);
	});
});

describe('normalizeIntent — untrusted LLM JSON', () => {
	it('passes a valid intent', () => {
		expect(normalizeIntent({ kind: 'play_song', query: ' 帝女花 ', answer: 'x' })).toEqual({
			kind: 'play_song',
			query: '帝女花',
			answer: ''
		});
	});
	it('rejects unknown kinds / garbage', () => {
		expect(normalizeIntent({ kind: 'rm -rf', query: 'a' }).kind).toBe('unknown');
		expect(normalizeIntent(null).kind).toBe('unknown');
		expect(normalizeIntent('play').kind).toBe('unknown');
	});
	it('a query kind with an empty query is unknown', () => {
		expect(normalizeIntent({ kind: 'play_artist', query: '' }).kind).toBe('unknown');
	});
	it('answer needs text, and is capped', () => {
		expect(normalizeIntent({ kind: 'answer', answer: '' }).kind).toBe('unknown');
		expect(normalizeIntent({ kind: 'answer', answer: 'x'.repeat(900) }).answer.length).toBe(500);
	});
	it('controls drop stray query/answer', () => {
		expect(normalizeIntent({ kind: 'pause', query: 'zzz', answer: 'zzz' })).toEqual({ kind: 'pause', query: '', answer: '' });
	});
});

describe('language helpers', () => {
	it('auto → Cantonese for HK devices and zh-Hant UI, Mandarin for TW/CN, else English', () => {
		expect(resolveVoiceLang('auto', 'en', ['zh-HK'])).toBe('yue');
		expect(resolveVoiceLang('auto', 'zh-Hant', [])).toBe('yue');
		expect(resolveVoiceLang('auto', 'zh-Hant', ['zh-TW'])).toBe('cmn');
		expect(resolveVoiceLang('auto', 'zh-Hans', [])).toBe('cmn');
		expect(resolveVoiceLang('auto', 'en', ['en-US'])).toBe('en');
		expect(resolveVoiceLang('en', 'zh-Hant', ['zh-HK'])).toBe('en');
	});
	it('maps to recogniser / whisper / tts codes', () => {
		expect(speechRecognitionLang('yue', 'zh-Hant')).toBe('yue-Hant-HK');
		expect(speechRecognitionLang('cmn', 'zh-Hans')).toBe('zh-CN');
		expect(whisperLanguage('yue')).toBe('yue');
		expect(whisperLanguage('cmn')).toBe('zh');
		expect(ttsLang('yue', 'zh-Hant')).toBe('zh-HK');
		expect(ttsLang('en', 'en')).toBe('en');
	});
	it('prompt names the spoken language and every kind', () => {
		const p = intentSystemPrompt('yue');
		expect(p).toContain('Cantonese');
		for (const k of ['play_song', 'play_genre', 'play_liked', 'answer']) expect(p).toContain(k);
	});
});
