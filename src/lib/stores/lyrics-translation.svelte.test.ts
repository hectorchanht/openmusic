import { describe, it, expect, beforeEach } from 'vitest';
import { lyricsTranslation, publishedLineFor, translationDuplicatesOriginal, type PublishedTranslation } from './lyrics-translation.svelte';

// quick-261116-lyrux (Fix 2): the publication seam between NpLyrics (publisher) and
// the Nowbar (reader). The reader decision is pure; the store is a plain snapshot.

const pub = (over: Partial<PublishedTranslation> = {}): PublishedTranslation => ({
	uid: 'kuwo:1',
	lang: 'zh-Hant',
	lines: ['愛你', '今晚', '握住你的手'],
	pending: [false, false, false],
	...over
});

describe('publishedLineFor', () => {
	it('returns the settled translation for the line', () => {
		expect(publishedLineFor(pub(), 'kuwo:1', 'zh-Hant', 1)).toBe('今晚');
	});
	it('returns null for a different track (stale publish)', () => {
		expect(publishedLineFor(pub(), 'kuwo:2', 'zh-Hant', 1)).toBeNull();
	});
	it('returns null for a different target language', () => {
		expect(publishedLineFor(pub(), 'kuwo:1', 'en', 1)).toBeNull();
	});
	it('returns null while the line is still pending (placeholder is not a translation)', () => {
		expect(publishedLineFor(pub({ pending: [false, true, false] }), 'kuwo:1', 'zh-Hant', 1)).toBeNull();
		// …while its settled neighbours still serve.
		expect(publishedLineFor(pub({ pending: [false, true, false] }), 'kuwo:1', 'zh-Hant', 0)).toBe('愛你');
	});
	it('returns null out of range / for an empty uid', () => {
		expect(publishedLineFor(pub(), 'kuwo:1', 'zh-Hant', 3)).toBeNull();
		expect(publishedLineFor(pub(), 'kuwo:1', 'zh-Hant', -1)).toBeNull();
		expect(publishedLineFor(pub(), '', 'zh-Hant', 0)).toBeNull();
	});
});

describe('lyricsTranslation store', () => {
	beforeEach(() => lyricsTranslation.clear());
	it('publishes a snapshot the reader can consume, and clear() empties it', () => {
		lyricsTranslation.publish('kuwo:9', 'en', ['one', 'two'], [true, false]);
		expect(lyricsTranslation.uid).toBe('kuwo:9');
		expect(publishedLineFor(lyricsTranslation, 'kuwo:9', 'en', 1)).toBe('two');
		expect(publishedLineFor(lyricsTranslation, 'kuwo:9', 'en', 0)).toBeNull();
		lyricsTranslation.clear();
		expect(publishedLineFor(lyricsTranslation, 'kuwo:9', 'en', 1)).toBeNull();
	});
	it('publish copies the arrays — later caller-side reuse cannot mutate the snapshot', () => {
		const lines = ['a'];
		const pending = [false];
		lyricsTranslation.publish('kuwo:9', 'en', lines, pending);
		lines[0] = 'MUTATED';
		pending[0] = true;
		expect(lyricsTranslation.lines[0]).toBe('a');
		expect(lyricsTranslation.pending[0]).toBe(false);
	});
});

describe('translationDuplicatesOriginal (quick-261120-lsheet)', () => {
	it('identical text duplicates', () => {
		expect(translationDuplicatesOriginal('hello world', 'hello world')).toBe(true);
	});
	it('surrounding whitespace is ignored', () => {
		expect(translationDuplicatesOriginal('  hello ', 'hello')).toBe(true);
	});
	it('different text does not duplicate', () => {
		expect(translationDuplicatesOriginal('你好', 'hello')).toBe(false);
	});
	it('empty sides never duplicate', () => {
		expect(translationDuplicatesOriginal('', '')).toBe(false);
		expect(translationDuplicatesOriginal('hello', '')).toBe(false);
		expect(translationDuplicatesOriginal('', 'hello')).toBe(false);
		expect(translationDuplicatesOriginal('   ', '   ')).toBe(false);
	});
});

// quick-261121-trfix: the FORCE-REFRESH request channel (sheet / pane → the
// pane's translate effect). One song, one target; a fresh seq per tap so a
// repeated request can never be mistaken for the previous one.
describe('requestRetranslate', () => {
	beforeEach(() => {
		lyricsTranslation.clear();
		lyricsTranslation.retranslateUid = '';
		lyricsTranslation.retranslateLang = '';
		lyricsTranslation.retranslateSeq = 0;
	});
	it('records the (uid, lang) target and bumps the sequence on every tap', () => {
		lyricsTranslation.requestRetranslate('kuwo:1', 'fr');
		expect(lyricsTranslation.retranslateUid).toBe('kuwo:1');
		expect(lyricsTranslation.retranslateLang).toBe('fr');
		expect(lyricsTranslation.retranslateSeq).toBe(1);
		lyricsTranslation.requestRetranslate('kuwo:1', 'fr');
		expect(lyricsTranslation.retranslateSeq).toBe(2);
	});
	it('ignores an empty uid or an off/empty target', () => {
		lyricsTranslation.requestRetranslate('', 'fr');
		lyricsTranslation.requestRetranslate('kuwo:1', 'off');
		lyricsTranslation.requestRetranslate('kuwo:1', '');
		expect(lyricsTranslation.retranslateSeq).toBe(0);
	});
	it('clear() (the snapshot reset) leaves a pending request intact', () => {
		lyricsTranslation.requestRetranslate('kuwo:1', 'fr');
		lyricsTranslation.clear();
		expect(lyricsTranslation.retranslateSeq).toBe(1);
		expect(lyricsTranslation.retranslateUid).toBe('kuwo:1');
	});
});
