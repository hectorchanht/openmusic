// quick-261102-tdc (DECISIONS.md §6) — characterization + invariants for the ONE cover identity gate.
// Golden fixture: Without You (Explicit) / 高爾宣 OSN — the song page showed Lilcory_offical's
// "Without you" while the now bar showed the right cover.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { warmScript } from '$lib/services/zh-convert';
import { itunesSongCover } from '$lib/services/itunes-cover';
import { isCoverOf } from '$lib/services/song-variant';

const WRONG = 'https://is1-ssl.mzstatic.com/image/thumb/wrong/100x100bb.jpg';
const RIGHT = 'https://is1-ssl.mzstatic.com/image/thumb/right/100x100bb.jpg';

beforeAll(async () => {
	await warmScript('zh-Hans');
});
afterEach(() => vi.unstubAllGlobals());

function stubItunes() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () =>
			new Response(
				JSON.stringify({
					results: [
						{ artworkUrl100: WRONG, trackName: 'Without you', artistName: 'Lilcory_offical' },
						{ artworkUrl100: RIGHT, trackName: 'Without You (Explicit)', artistName: '高爾宣 OSN' }
					]
				})
			)
		)
	);
}

describe('one cover identity gate (quick-261102-tdc)', () => {
	it('the in-app iTunes rung skips a stranger\'s first result for the song\'s own', async () => {
		stubItunes();
		const out = await itunesSongCover('高爾宣 OSN', 'Without You (Explicit)');
		expect(out).toContain('/right/');
	});

	it('isCoverOf: whole-segment / alias artist, bare version tail tolerated, scripts folded', () => {
		const song = { artist: '高爾宣 OSN', title: 'Without You (Explicit)' };
		expect(isCoverOf(song, { artist: 'Osn', title: 'Without you explicit' })).toBe(true);
		expect(isCoverOf(song, { artist: '高爾宣', title: 'Without You' })).toBe(true);
		expect(isCoverOf(song, { artist: 'Lilcory_offical', title: 'Without you' })).toBe(false);
		expect(isCoverOf({ artist: '周杰倫', title: '晴天' }, { artist: '周杰伦', title: '晴天' })).toBe(true);
		// whole segment, never substring (was ≥2-char containment in /api/og)
		expect(isCoverOf({ artist: '阿傑', title: 'X' }, { artist: '阿傑正傳', title: 'X' })).toBe(false);
	});
});
