// quick-261102-tdc (DECISIONS.md §6) — characterization + invariants for the ONE cover identity gate.
// Golden fixture: Without You (Explicit) / 高爾宣 OSN — the song page showed Lilcory_offical's
// "Without you" while the now bar showed the right cover.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { warmScript } from '$lib/services/zh-convert';
import { itunesSongCover } from '$lib/services/itunes-cover';

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

describe('cover identity (characterization: current behaviour)', () => {
	it('the in-app iTunes rung takes results[0] blind — a stranger\'s cover', async () => {
		stubItunes();
		const out = await itunesSongCover('高爾宣 OSN', 'Without You (Explicit)');
		expect(out).toContain('/wrong/');
	});
});
