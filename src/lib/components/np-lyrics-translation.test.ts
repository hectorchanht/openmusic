import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// quick-261121-trfix — STRUCTURAL pins for the lyrics-translation fix (brief
// 2026-11-21), in the lyrics-settings-sheet / track-menu-ssr source technique
// (no jsdom in this project; the pane's $effect does not run under SSR). The
// BEHAVIOURAL halves live where behaviour is testable: translate.test.ts
// (peek / bust / zero-fetch switch / echo never cached), detect.test.ts
// (majorityLang), lyric-chunks.test.ts (applyUniqueChunkFlags) and
// lyrics-translation.svelte.test.ts (requestRetranslate). These pins hold the
// pane-side wiring those behaviours depend on.
const pane = readFileSync('src/lib/components/NpLyrics.svelte', 'utf-8');

describe('NpLyrics translation — switch is display/cache only (brief pins 1, 2, 5)', () => {
	it('pin 1: the effect rerun key excludes translateMode — a mode flip is a pure re-render', () => {
		const keyLine = pane.match(/const key = `[^`]*`;/)?.[0] ?? '';
		expect(keyLine).toContain('${t.uid}:${lang}:${n}:${skip');
		expect(keyLine).not.toContain('translateMode');
		// …while the template still reads the mode for rendering:
		expect(pane).toContain("settings.translateMode === 'replace'");
	});

	it('pin 2: a completed render is served from the pane cache, and the line cache is seeded BEFORE any chunk fires', () => {
		expect(pane).toContain('const cached = trCache.get(key);');
		expect(pane).toContain('peekLineTranslation(sendText[s], lang)');
		// seed order: the peek loop runs ahead of the chunk worker setup.
		expect(pane.indexOf('peekLineTranslation(sendText[s], lang)')).toBeLessThan(
			pane.indexOf('const ranges = chunkRanges(')
		);
		// a fully-seeded switch completes without entering the worker path:
		expect(pane).toContain('if (seeded === sendIdx.length)');
	});

	it('pin 5: toggling skip re-derives through the seed, not a blanket reset — skip stays in the key and cached lines stay settled', () => {
		const keyLine = pane.match(/const key = `[^`]*`;/)?.[0] ?? '';
		expect(keyLine).toContain('skip');
		// seeded lines are marked genuine + settled, never pending:
		expect(pane).toContain('genuine0[sendIdx[s]] = true;');
		expect(pane).toContain('pending0[sendIdx[s]] = false;');
	});
});

describe('NpLyrics translation — echo integrity (brief pins 3, 6)', () => {
	it('pin 3: genuine flags ride the chunk stitch, and a settled echo renders NO translation span', () => {
		expect(pane).toContain(
			'trGenuine = applyUniqueChunkFlags(trGenuine, sendIdx, uniqOf, range.start, res.flags);'
		);
		// the below-mode echo branch sits between the pending skeleton and the
		// dedupe/render branch, so an echo can never reach the .tr span:
		const pendingAt = pane.indexOf('{#if trPending[i]}');
		const echoAt = pane.indexOf('{:else if trSent[i] && !trGenuine[i]}');
		const renderAt = pane.indexOf('translationDuplicatesOriginal(l.text, trLines[i]');
		expect(pendingAt).toBeGreaterThan(-1);
		expect(echoAt).toBeGreaterThan(pendingAt);
		expect(renderAt).toBeGreaterThan(echoAt);
	});

	it('pin 3b: a whole-song echo raises the unavailable/retry row instead of posing as translated', () => {
		expect(pane).toContain('trUnavailable = sendIdx.length > 0 && !sendIdx.some((pos) => trGenuine[pos]);');
		expect(pane).toContain("t('nowplaying.translationUnavailable')");
		expect(pane).toContain('class="tr-retry"');
		// echoes are also blocked from the Nowbar publish (never served as a translation):
		expect(pane).toContain('sent[i] === true && genuine[i] !== true');
	});

	it('pin 6: show-below interleave — the original line and its .tr span render from the same <p>', () => {
		expect(pane).toContain('{l.text}');
		expect(pane).toContain('<span class="tr"');
		expect(pane).toContain('{trLines[i]}');
	});
});

describe('NpLyrics translation — whole-song skip pre-gate (brief pin 4)', () => {
	it('pin 4: the majority-language gate runs BEFORE the cache serve and before any translateLinesEx call', () => {
		const gateAt = pane.indexOf('const songLang = majorityLang(');
		expect(gateAt).toBeGreaterThan(-1);
		expect(pane).toContain('skip.includes(songLang)');
		expect(gateAt).toBeLessThan(pane.indexOf('const cached = trCache.get(key);'));
		expect(gateAt).toBeLessThan(pane.indexOf('translateLinesEx(chunkLines'));
		// a gated song publishes nothing (no stale Nowbar column):
		const gateBlock = pane.slice(gateAt, gateAt + 800);
		expect(gateBlock).toContain('lyricsTranslation.clear();');
	});
});

describe('NpLyrics translation — force refresh (Hector 2026-11-21)', () => {
	it('the pane consumes store requests for its own (uid, lang) and busts per chunk, scoped to the chunk lines + target', () => {
		expect(pane).toContain('const rtSeq = lyricsTranslation.retranslateSeq;');
		expect(pane).toContain('lyricsTranslation.retranslateUid === (t?.uid ?? \'\')');
		expect(pane).toContain('trCache.delete(key);');
		expect(pane).toContain(
			'if (forceRun) bustLyricsTranslation(chunkLines, lang, { segments: true, skip });'
		);
		// a force run skips the cache seed (distrusting the cache is its point):
		expect(pane).toContain('if (!forceRun) {\n\t\t\tlet seeded = 0;');
		// …and a same-key re-entry cannot be written over by the superseded run:
		// the staleness guard compares the run GENERATION, not only the key.
		expect(pane).toContain('runGen !== trRunGen');
	});

	it('the pane carries its own point-of-use re-translate row while a translation is on screen', () => {
		expect(pane).toContain("t('lyricsSettings.retranslate')");
		expect(pane).toContain('class="tr-refresh"');
		expect(pane).toContain(
			'lyricsTranslation.requestRetranslate(uid, effectiveTarget(settings.lyricsLang));'
		);
	});
});
