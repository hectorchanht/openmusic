// quick-261116-perf: this module is now a thin SHIM over @dawn-studio/zh-convert
// (v0.5.0) — the Dawn Studio shared package that grew out of this very file (same
// tongwen engine, same lazy separate s2t/t2s dict loads, same idempotent s2t merge,
// same sync no-flash handles, same never-throw boundaries). Every existing importer
// keeps importing from '$lib/services/zh-convert'; the conversion behaviour lives in
// ONE place for all Dawn apps. The package additionally applies PROTECTED_WORDS
// (占 protection + 佔卜 normalization) — a superset of the old local behaviour.
//
// foldScript / ensureFoldReady / foldScriptReady have no package equivalent (they are
// OpenMusic's identity fold, quick-261102-sdm), so they stay here, implemented on the
// package's t2s primitives with their original logic unchanged.
//
// tongwen-core / tongwen-dict remain in devDependencies ONLY: two cold/broken-dict
// tests mock the dict chunk by its package specifier ('tongwen-dict/dist/…'), which
// must resolve at the top level for vi.doMock to intercept the package's own load.
// No app code imports them — at runtime they arrive solely as the package's deps.

export {
	warmS2T,
	s2tConvertLineSync,
	isChineseLine,
	s2tConvertLines,
	t2sConvertLines,
	warmT2S,
	t2sConvertLineSync,
	lockScriptSync,
	warmScript
} from '@dawn-studio/zh-convert';
export type { ZhScript } from '@dawn-studio/zh-convert';

import { isChineseLine, t2sConvertLineSync, warmT2S, warmScript } from '@dawn-studio/zh-convert';

const HAN_CHAR = /\p{Script=Han}/u;

/**
 * quick-261102-sdm (DECISIONS.md §2) — THE identity fold: Traditional → Simplified, the one
 * function every matching key, search keyword and script-folded cache key goes through.
 * Matching always normalizes to Simplified (most upstreams index zhs only).
 *
 * PER CHARACTER, not per line: the t2s phrase table also swaps regional VOCABULARY
 * (緊急聯絡人 → 紧急联系人, 國際孤獨等級 → 国际孤独级别), which is a different title, not a
 * spelling fold — one char at a time can only hit the char table, so it maps script alone.
 * Gate: `isChineseLine` (kana/hangul-first), so a Japanese line keeps its kanji — the same gate
 * the cover alias keys always used; the old `\p{Script=Han}`-only gate in dedupe folded 東京 in
 * 東京ラブストーリー while the cover cache did not.
 *
 * Cold dict → input unchanged + a warm is triggered. Anything that PERSISTS a folded key or
 * sends it upstream must `await ensureFoldReady()` first (comments.ts pattern); in-memory
 * comparisons may run cold only because both sides are folded with the same cold state.
 */
export function foldScript(s: string): string {
	if (!s || !HAN_CHAR.test(s) || !isChineseLine(s)) return s;
	let out = '';
	for (const c of s) {
		if (!HAN_CHAR.test(c)) {
			out += c;
			continue;
		}
		const f = t2sConvertLineSync(c);
		if (f === null) {
			warmT2S();
			return s;
		}
		out += f;
	}
	return out;
}

/** quick-261102-sdm: true once foldScript is warm. Awaitable, never rejects. */
export async function ensureFoldReady(): Promise<boolean> {
	await warmScript('zh-Hans');
	// Probe with a char that only converts when the t2s dict is actually loaded:
	// cold → null (not ready), warm → the Simplified form (ready).
	return t2sConvertLineSync('測') !== null;
}

/** quick-261102-sdm: foldScript after the dict is guaranteed warm (or failed to load). */
export async function foldScriptReady(s: string): Promise<string> {
	if (s && HAN_CHAR.test(s)) await ensureFoldReady();
	return foldScript(s);
}
