// quick-261119-dldelete: downloadVersionsOf — the remove-download confirm's version list.
// The identity is the SONG (any source, any rendition), never the rendition-exact playback
// identity: managing copies must see them all, playback must never merge them.
import { describe, it, expect } from 'vitest';
import { downloadVersionsOf } from './download-versions';
import { warmScript } from './zh-convert';
import type { Track } from '$lib/sources/types';

const mk = (over: Partial<Track>): Track =>
	({
		uid: 'kuwo:1',
		source: 'kuwo',
		songid: '1',
		title: '晴天',
		artist: '周杰倫',
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		quality: null,
		qualityLabel: null,
		...over
	}) as Track;

const studio = mk({});
const qqTwin = mk({ uid: 'qq:9', source: 'qq', songid: '9' });
const liveCut = mk({ uid: 'netease:5', source: 'netease', songid: '5', title: '晴天 (Live)' });
const otherSong = mk({ uid: 'kuwo:2', songid: '2', title: '稻香' });
const deviceCopy = mk({ uid: 'device:42', source: 'device' as Track['source'] });

describe('downloadVersionsOf (quick-261119-dldelete)', () => {
	it('null / undefined track → no versions', () => {
		expect(downloadVersionsOf([studio], null)).toEqual([]);
		expect(downloadVersionsOf([studio], undefined)).toEqual([]);
	});

	it('the exact-uid record comes first, wherever it sits in the list', () => {
		const out = downloadVersionsOf([qqTwin, studio, otherSong], studio);
		expect(out.map((v) => v.uid)).toEqual(['kuwo:1', 'qq:9']);
	});

	it('collects the same song across sources, and excludes other songs', () => {
		const out = downloadVersionsOf([studio, qqTwin, otherSong], qqTwin);
		expect(out.map((v) => v.uid)).toEqual(['qq:9', 'kuwo:1']);
	});

	it('another rendition of the song (live cut) is a version too', () => {
		const out = downloadVersionsOf([studio, liveCut], studio);
		expect(out.map((v) => v.uid)).toEqual(['kuwo:1', 'netease:5']);
	});

	it('a device import of the same song is NOT a version (its own no-import lane owns it)', () => {
		const out = downloadVersionsOf([studio, deviceCopy], studio);
		expect(out.map((v) => v.uid)).toEqual(['kuwo:1']);
	});

	it('a track that is not itself downloaded still lists its downloaded twins', () => {
		const row = mk({ uid: 'joox:7', source: 'joox', songid: '7' });
		const out = downloadVersionsOf([studio, qqTwin], row);
		expect(out.map((v) => v.uid)).toEqual(['kuwo:1', 'qq:9']);
	});

	it('script-folded twins group together once the dict is warm', async () => {
		await warmScript('zh-Hans');
		const hans = mk({ uid: 'qq:11', source: 'qq', songid: '11', artist: '周杰伦' });
		const out = downloadVersionsOf([studio, hans], studio);
		expect(out.map((v) => v.uid)).toEqual(['kuwo:1', 'qq:11']);
	});

	it('nothing downloaded → empty', () => {
		expect(downloadVersionsOf([], studio)).toEqual([]);
		expect(downloadVersionsOf([otherSong], studio)).toEqual([]);
	});
});
