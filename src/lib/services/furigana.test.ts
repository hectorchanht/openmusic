import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	annotateLine,
	loadTables,
	ensureFuriganaTables,
	hasKana,
	type FuriganaTables,
	type KanjiEntry
} from './furigana';
import wordsJson from './furigana/words.json';
import kanjiJson from './furigana/kanji.json';
import variantsJson from './furigana/variants.json';

// quick-261120-furi — the local furigana engine, tested against the spike's
// hand-verified Gold6 (~/workspace/furigana-spike/test/corpus.json — the six
// lines kuromoji also gets right, checked by a human, not by another engine).
// Plus the Addendum 6 contract: a span NEVER carries just one reading when
// the language has more — variants[] holds every plausible reading and
// `chosen` is only the engine's first offer.

const tables: FuriganaTables = loadTables(
	wordsJson as Record<string, string>,
	kanjiJson as unknown as Record<string, KanjiEntry>,
	variantsJson as Record<string, string[]>
);

const GOLD6: { line: string; expect: [string, string][] }[] = [
	{ line: '上を向いて歩こう', expect: [['上', 'うえ'], ['向い', 'むい'], ['歩こう', 'あるこう']] },
	{ line: '涙がこぼれないように', expect: [['涙', 'なみだ']] },
	{ line: '沈むように溶けてゆくように', expect: [['沈む', 'しずむ'], ['溶けて', 'とけて']] },
	{ line: '大胆不敵にハイカラ革命', expect: [['大胆', 'だいたん'], ['不敵', 'ふてき'], ['革命', 'かくめい']] },
	{ line: '夜に駆ける', expect: [['夜', 'よる'], ['駆ける', 'かける']] },
	{ line: '君の声が聞こえる', expect: [['君', 'きみ'], ['声', 'こえ'], ['聞こえる', 'きこえる']] }
];

describe('furigana — Gold6 through the integrated path', () => {
	for (const g of GOLD6) {
		it(`annotates ${g.line}`, () => {
			const got = annotateLine(g.line, tables)
				.filter((s) => s.chosen)
				.map((s) => [s.surface, s.chosen]);
			expect(got).toEqual(g.expect);
		});
	}

	it('the shipped tables are the spike tables (18,016 words / 2,970 kanji)', async () => {
		const t = await ensureFuriganaTables();
		expect(t.words.size).toBe(18016);
		expect(t.kanji.size).toBe(2970);
	});
});

describe('furigana — variants are never narrowed (Addendum 6)', () => {
	it('明日 offers あした AND あす AND みょうにち, engine best first', () => {
		const span = annotateLine('明日はきっと晴れる', tables).find((s) => s.surface === '明日');
		expect(span?.chosen).toBe('あした');
		expect(span?.variants).toEqual(expect.arrayContaining(['あした', 'あす', 'みょうにち']));
		expect(span?.variants[0]).toBe('あした');
	});

	it('今日 offers きょう AND こんにち', () => {
		// (Not 今日は… — that surface is itself the greeting こんにちは in JMdict,
		// and longest-match correctly prefers it there.)
		const span = annotateLine('今日もいい天気', tables).find((s) => s.surface === '今日');
		expect(span?.chosen).toBe('きょう');
		expect(span?.variants).toEqual(expect.arrayContaining(['きょう', 'こんにち']));
	});

	it('行く and 行う are different words with different readings — context decides the span', () => {
		const iku = annotateLine('君と行く', tables).find((s) => s.surface === '行く');
		expect(iku?.chosen).toBe('いく');
		expect(iku?.variants).toEqual(expect.arrayContaining(['いく', 'ゆく']));
		const okonau = annotateLine('式を行う', tables).find((s) => s.surface === '行う');
		expect(okonau?.chosen).toBe('おこなう');
	});

	it('a single-kanji word also carries its kanji-table readings as variants', () => {
		const span = annotateLine('空を見上げる', tables).find((s) => s.surface === '空');
		expect(span?.chosen).toBe('そら');
		expect(span?.variants.length).toBeGreaterThan(1);
		expect(span?.variants).toContain('くう');
	});

	it('a word outside the dictionary falls back per-kanji, flagged estimated', () => {
		const spans = annotateLine('高楼を見上げる', tables);
		const est = spans.find((s) => s.estimated);
		expect(est).toBeTruthy();
		expect(est?.chosen).toBeTruthy();
	});

	it('kana-only text gets no annotation at all', () => {
		const spans = annotateLine('ありがとう', tables);
		expect(spans.every((s) => !s.chosen)).toBe(true);
	});
});

describe('furigana — Japanese detection gate', () => {
	it('hasKana is the line-level signal', () => {
		expect(hasKana('明日は')).toBe(true);
		expect(hasKana('明日')).toBe(false); // kanji-only: ambiguous with Chinese
		expect(hasKana('hello')).toBe(false);
		expect(hasKana('カタカナ')).toBe(true);
	});
});

describe('furigana — integration pins (sheet toggle, pane rendering, defaults)', () => {
	const pane = readFileSync('src/lib/components/NpLyrics.svelte', 'utf-8');
	const sheet = readFileSync('src/lib/components/LyricsSettingsSheet.svelte', 'utf-8');
	const defaults = readFileSync('src/lib/config/defaults.ts', 'utf-8');
	const settings = readFileSync('src/lib/stores/settings.svelte.ts', 'utf-8');

	it('the pane renders ruby only behind the toggle + loaded tables; the plain path survives', () => {
		expect(pane).toContain('if (!settings.lyricsFurigana || !tb) return null');
		expect(pane).toContain('<ruby>');
		expect(pane).toContain('{l.text}'); // toggle OFF renders exactly this, as before
	});

	it('a word tap opens the chooser and never seeks', () => {
		expect(pane).toContain('openFuriChooser');
		expect(pane).toContain('e.stopPropagation()');
		expect(pane).toContain('pinReading(');
		expect(pane).toContain("t('lyrics.furiganaChoose')");
	});

	it('the sheet hosts the toggle on the same store field', () => {
		expect(sheet).toContain("t('lyricsSettings.furigana')");
		expect(sheet).toContain('checked={settings.lyricsFurigana}');
	});

	it('the default is OFF in the one default-value file, and the store round-trips it', () => {
		expect(defaults).toContain('lyricsFurigana: false');
		expect(settings).toContain('lyricsFurigana = $state<boolean>(TRANSLATION_DEFAULTS.lyricsFurigana)');
		expect(settings).toContain('lyricsFurigana: this.lyricsFurigana');
	});
});
