// quick-261102-sjg (DECISIONS.md §1) — characterization + invariants for THE song identity.
// Golden fixtures: Without You (Explicit) / 高爾宣 OSN, a duet credit, 周杰倫/周杰伦.
import { describe, it, expect, beforeAll } from 'vitest';
import { warmScript } from '$lib/services/zh-convert';
import { songKey, sameSongStrings, sameArtistCredit, matchKey } from '$lib/services/dedupe';

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

describe('one identity — matchKey is songKey artist-first (quick-261102-sjg)', () => {
	it('matchKey folds 繁/簡', () => {
		expect(matchKey('周杰倫', '晴天')).toBe(matchKey('周杰伦', '晴天'));
	});

	it('a bare "feat. X" title tail is the same song', () => {
		expect(songKey('Artist', 'Song feat. Other')).toBe(songKey('Artist', 'Song'));
		expect(songKey('Artist', 'Song ft. Other')).toBe(songKey('Artist', 'Song'));
	});

	it('"feat" inside a word is not a tail', () => {
		expect(songKey('Artist', 'Defeat Me')).not.toBe(songKey('Artist', 'De'));
	});

	it('matchKey drops a translated English tail like songKey (玻璃 - glass = 玻璃)', () => {
		expect(matchKey('X', '玻璃 - glass')).toBe(matchKey('X', '玻璃'));
	});

	it('matchKey and songKey carry the same halves', () => {
		const [t, a] = songKey('周杰倫', '說了再見 (Live)').split('|');
		expect(matchKey('周杰倫', '說了再見 (Live)')).toBe(`${a}|${t}`);
	});
});

// Moved from identity.test.ts (module deleted, quick-261102-sjg).
describe('matchKey — {artist}+{title} normalization', () => {
	it('strips case and whitespace', () => {
		expect(matchKey('Jay Chou', 'Dao Xiang')).toBe(matchKey('  jay   chou ', ' DAO xiang  '));
	});

	it('folds bracketed and feat./remaster/live suffixes (same key as the bare form)', () => {
		expect(matchKey('Jay Chou', 'Dao Xiang (Live)')).toBe(matchKey('jay chou', 'dao xiang'));
		expect(matchKey('Adele', 'Hello - Remaster 2015')).toBe(matchKey('adele', 'hello'));
		expect(matchKey('Drake', 'One Dance (feat. Wizkid)')).toBe(matchKey('drake', 'one dance'));
		expect(matchKey('某歌手', '某歌【Live】')).toBe(matchKey('某歌手', '某歌'));
	});

	it('canonical order is artist-first', () => {
		expect(matchKey('A', 'B')).not.toBe(matchKey('B', 'A'));
		expect(matchKey('jaychou', 'daoxiang')).toBe('jaychou|daoxiang');
	});

	it('tolerates empty / missing inputs without throwing', () => {
		expect(matchKey('', '')).toBe('|');
		// @ts-expect-error — guard against undefined at runtime even though typed string
		expect(matchKey(undefined, undefined)).toBe('|');
	});
});
