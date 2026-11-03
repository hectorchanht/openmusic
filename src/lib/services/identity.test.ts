// quick-261102-sjg (DECISIONS.md §1) — characterization + invariants for THE song identity.
// Golden fixtures: Without You (Explicit) / 高爾宣 OSN, a duet credit, 周杰倫/周杰伦.
import { describe, it, expect, beforeAll } from 'vitest';
import { warmScript } from '$lib/services/zh-convert';
import { songKey, sameSongStrings, sameArtistCredit } from '$lib/services/dedupe';
import { matchKey } from '$lib/services/match-key';

beforeAll(async () => {
	await warmScript('zh-Hans');
});

describe('identity invariants (hold before and after convergence)', () => {
	it('an (Explicit) bracket is not a different song', () => {
		expect(songKey('高爾宣 OSN', 'Without You (Explicit)')).toBe(songKey('高爾宣 OSN', 'Without You'));
		expect(matchKey('高爾宣 OSN', 'Without You (Explicit)')).toBe(matchKey('高爾宣 OSN', 'Without You'));
	});

	it('a different artist is a different song', () => {
		expect(sameSongStrings('高爾宣 OSN', 'Without You', 'Lilcory_offical', 'Without you')).toBe(false);
		expect(sameSongStrings('周杰倫', '說了再見', '阿傑', '說了再見')).toBe(false);
	});

	it('duet credit containing the target counts; segments compare whole', () => {
		expect(sameArtistCredit('周杰倫', '周杰倫/蔡依林')).toBe(true);
		expect(sameArtistCredit('阿傑', '阿傑正傳')).toBe(false);
		expect(sameArtistCredit('Jay', 'Jay Park')).toBe(false);
	});

	it('songKey folds 繁/簡', () => {
		expect(songKey('周杰倫', '晴天')).toBe(songKey('周杰伦', '晴天'));
	});
});

describe('identity divergences (characterization: current behaviour)', () => {
	it('matchKey does NOT fold 繁/簡', () => {
		expect(matchKey('周杰倫', '晴天')).not.toBe(matchKey('周杰伦', '晴天'));
	});

	it('a bare "feat. X" title tail is a different song', () => {
		expect(songKey('Artist', 'Song feat. Other')).not.toBe(songKey('Artist', 'Song'));
	});

	it('matchKey keeps a translated English tail (玻璃 - glass ≠ 玻璃)', () => {
		expect(matchKey('X', '玻璃 - glass')).not.toBe(matchKey('X', '玻璃'));
	});
});
