import { describe, it, expect } from 'vitest';
import type { Track } from '$lib/sources/types';
import { pickArtistTracks, controlFor, swapAlternate } from './voice-plan';

const tr = (uid: string, artist: string) => ({ uid, artist, title: uid }) as unknown as Track;

describe('voice-plan — quick-261122-voice', () => {
	it("pickArtistTracks keeps the artist's own rows (duets included)", () => {
		const list = [tr('a', '张学友'), tr('b', '刘德华'), tr('c', '张学友 / 梅艳芳'), tr('d', '张学友')];
		expect(pickArtistTracks(list, '张学友').map((t) => t.uid)).toEqual(['a', 'c', 'd']);
	});
	it('falls back to the whole list when too few match', () => {
		const list = [tr('a', 'Jacky Cheung'), tr('b', '刘德华')];
		expect(pickArtistTracks(list, '张学友').map((t) => t.uid)).toEqual(['a', 'b']);
	});
	it('controlFor maps transport kinds only', () => {
		expect(controlFor('pause')).toBe('pause');
		expect(controlFor('play_song')).toBeNull();
	});
	it('swapAlternate promotes the pick and demotes the old main song', () => {
		const p = { kind: 'play-song' as const, track: tr('a', 'x'), alternates: [tr('b', 'x'), tr('c', 'x')] };
		const out = swapAlternate(p, 'c');
		expect(out).toMatchObject({ track: { uid: 'c' } });
		expect((out as typeof p).alternates.map((t) => t.uid)).toEqual(['a', 'b']);
		expect(swapAlternate(p, 'zzz')).toBe(p);
	});
});
