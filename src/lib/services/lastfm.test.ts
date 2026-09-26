import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	enrichTrack,
	enrichArtist,
	enrichAlbum,
	getChartTopTracks,
	getChartTopArtists,
	getTagTopTracks,
	getGeoTopTracks,
	getArtistTopAlbums,
	getAlbumTracklist
} from './lastfm';
import { __clearSearchCache } from './ttl-cache';
import type { Track } from '$lib/sources/types';

// services/lastfm.ts is the CLIENT enrichment service. It only ever sees the clean
// shape from /api/lastfm/info — the LASTFM_KEY stays server-side (T-08-01). Every
// export resolves to an all-empty result on ANY failure and NEVER throws (ENRICH-01,
// off the playback critical path). It never touches platform.env.

const EMPTY = { tags: [], bio: null, bioUrl: null, lastfmArt: null };

function track(over: Partial<Track> = {}): Track {
	return {
		uid: 'netease:1',
		source: 'netease',
		songid: '1',
		title: '稻香',
		artist: '周杰伦',
		album: '魔杰座',
		cover: 'https://src/cover.jpg',
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '稻香',
		displayIndex: 1,
		...over
	};
}

beforeEach(() => { vi.restoreAllMocks(); __clearSearchCache(); });
afterEach(() => { vi.restoreAllMocks(); __clearSearchCache(); });

/** Stub fetch returning a per-method clean LastfmInfo shape. */
function stubInfo(byMethod: Record<string, object>) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const u = new URL(String(input), 'https://x');
			const m = u.searchParams.get('method') ?? '';
			const body = byMethod[m] ?? {
				tags: [],
				bio: null,
				bioUrl: null,
				image: null,
				listeners: null,
				playcount: null
			};
			return new Response(JSON.stringify(body), { status: 200 });
		})
	);
}

describe('enrichTrack — additive merge, never throws, album.getInfo art', () => {
	it('merges tags (track.getinfo), bio+bioUrl (artist.getinfo), lastfmArt (album.getinfo)', async () => {
		stubInfo({
			'track.getinfo': { tags: ['mandopop', 'pop'], bio: null, bioUrl: null, image: null, listeners: 1, playcount: 2 },
			'artist.getinfo': {
				tags: ['pop'],
				bio: 'Jay Chou is huge.',
				bioUrl: 'https://www.last.fm/music/Jay+Chou',
				image: 'https://lastfm/artist.png',
				listeners: 9,
				playcount: 8
			},
			'album.getinfo': { tags: ['rnb'], bio: null, bioUrl: null, image: 'https://lastfm/album-xl.png', listeners: null, playcount: null }
		});

		const out = await enrichTrack(track());
		expect(out.tags).toEqual(['mandopop', 'pop']);
		expect(out.bio).toBe('Jay Chou is huge.');
		expect(out.bioUrl).toBe('https://www.last.fm/music/Jay+Chou');
		// cover candidate MUST come from album.getInfo (D-04 guardrail 1), not artist image
		expect(out.lastfmArt).toBe('https://lastfm/album-xl.png');
	});

	it('caps tags at 5', async () => {
		stubInfo({
			'track.getinfo': {
				tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
				bio: null,
				bioUrl: null,
				image: null,
				listeners: null,
				playcount: null
			}
		});
		const out = await enrichTrack(track());
		expect(out.tags.length).toBeLessThanOrEqual(5);
		expect(out.tags).toEqual(['a', 'b', 'c', 'd', 'e']);
	});

	it('resolves to all-empty (never throws) when fetch throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(enrichTrack(track())).resolves.toEqual(EMPTY);
	});

	it('resolves to all-empty when the endpoint returns the absent-key empty shape', async () => {
		stubInfo({}); // every method → the all-empty shape (absent-key posture)
		await expect(enrichTrack(track())).resolves.toEqual(EMPTY);
	});

	it('a single failing sub-call still yields the other fields (allSettled)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const u = new URL(String(input), 'https://x');
				const m = u.searchParams.get('method') ?? '';
				if (m === 'album.getinfo') throw new Error('album fetch failed');
				if (m === 'track.getinfo')
					return new Response(
						JSON.stringify({ tags: ['pop'], bio: null, bioUrl: null, image: null, listeners: null, playcount: null }),
						{ status: 200 }
					);
				return new Response(JSON.stringify({ tags: [], bio: 'bio', bioUrl: 'u', image: null, listeners: null, playcount: null }), {
					status: 200
				});
			})
		);
		const out = await enrichTrack(track());
		expect(out.tags).toEqual(['pop']);
		expect(out.bio).toBe('bio');
		expect(out.lastfmArt).toBeNull(); // album sub-call failed → no art, but no throw
	});
});

describe('enrichArtist / enrichAlbum — clean shapes consumed by Plans 02/03', () => {
	it('enrichArtist returns bio+bioUrl+tags + image as lastfmArt', async () => {
		stubInfo({
			'artist.getinfo': {
				tags: ['pop', 'mandopop'],
				bio: 'About the artist.',
				bioUrl: 'https://last.fm/x',
				image: 'https://lastfm/hero.png',
				listeners: 5,
				playcount: 6
			}
		});
		const out = await enrichArtist('Jay Chou');
		expect(out.bio).toBe('About the artist.');
		expect(out.bioUrl).toBe('https://last.fm/x');
		expect(out.tags).toEqual(['pop', 'mandopop']);
		expect(out.lastfmArt).toBe('https://lastfm/hero.png');
	});

	it('enrichAlbum returns lastfmArt + tags + listeners/playcount', async () => {
		stubInfo({
			'album.getinfo': {
				tags: ['rock'],
				bio: null,
				bioUrl: null,
				image: 'https://lastfm/album.png',
				listeners: 111,
				playcount: 222
			}
		});
		const out = await enrichAlbum('魔杰座', '周杰伦');
		expect(out.lastfmArt).toBe('https://lastfm/album.png');
		expect(out.tags).toEqual(['rock']);
		expect(out.listeners).toBe(111);
		expect(out.playcount).toBe(222);
	});

	it('enrichArtist never throws on fetch failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('boom');
			})
		);
		await expect(enrichArtist('X')).resolves.toEqual(EMPTY);
	});
});

// Phase 9 (D-02): discovery list builders hit /api/lastfm/discovery (lists) — except
// getAlbumTracklist which consumes the Task-2 /api/lastfm/info album.getinfo tracks
// field. Each returns a clean list and NEVER throws ([] on any failure / absent-key
// empty shape). The LASTFM_KEY stays server-side; these only see the clean shape.
describe('discovery list builders — clean lists, never throw', () => {
	/** Stub /api/lastfm/discovery returning a fixed { items } list. */
	function stubDiscovery(items: object[]) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ items }), { status: 200 }))
		);
	}

	it('getChartTopTracks returns the { artist, title, image }[] items', async () => {
		stubDiscovery([
			{ artist: '周杰伦', title: '稻香', image: 'https://lastfm/a.png' },
			{ artist: 'Ed Sheeran', title: 'Perfect', image: null }
		]);
		const out = await getChartTopTracks();
		expect(out).toEqual([
			{ artist: '周杰伦', title: '稻香', image: 'https://lastfm/a.png' },
			{ artist: 'Ed Sheeran', title: 'Perfect', image: null }
		]);
	});

	it('getChartTopArtists returns the { name, image }[] items', async () => {
		stubDiscovery([{ name: '周杰伦', image: 'https://lastfm/jay.png' }]);
		const out = await getChartTopArtists();
		expect(out).toEqual([{ name: '周杰伦', image: 'https://lastfm/jay.png' }]);
	});

	it('getTagTopTracks passes the tag through and returns track items', async () => {
		let capturedUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUrl = String(input);
				return new Response(JSON.stringify({ items: [{ artist: 'A', title: 'T', image: null }] }), {
					status: 200
				});
			})
		);
		const out = await getTagTopTracks('mandopop');
		expect(capturedUrl).toContain('method=tag.gettoptracks');
		expect(capturedUrl).toContain('tag=mandopop');
		expect(out).toEqual([{ artist: 'A', title: 'T', image: null }]);
	});

	it('getGeoTopTracks passes the ISO 3166-1 NAME (country) through', async () => {
		let capturedUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUrl = String(input);
				return new Response(JSON.stringify({ items: [{ artist: 'A', title: 'T', image: null }] }), {
					status: 200
				});
			})
		);
		const out = await getGeoTopTracks('United States');
		expect(capturedUrl).toContain('method=geo.gettoptracks');
		// URLSearchParams form-encodes the space as '+'; assert it round-trips to the
		// ISO 3166-1 NAME (not a code) regardless of +/%20 encoding.
		const qs = new URL(capturedUrl, 'https://x').searchParams;
		expect(qs.get('country')).toBe('United States');
		expect(out).toHaveLength(1);
	});

	it('getArtistTopAlbums passes the artist through and returns { name, image }[]', async () => {
		let capturedUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUrl = String(input);
				return new Response(JSON.stringify({ items: [{ name: '魔杰座', image: null }] }), {
					status: 200
				});
			})
		);
		const out = await getArtistTopAlbums('周杰伦');
		expect(capturedUrl).toContain('method=artist.gettopalbums');
		expect(capturedUrl).toContain(encodeURIComponent('周杰伦'));
		expect(out).toEqual([{ name: '魔杰座', image: null }]);
	});

	it('getAlbumTracklist consumes /api/lastfm/info album.getinfo tracks (D-05)', async () => {
		let capturedUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUrl = String(input);
				return new Response(
					JSON.stringify({
						tags: [],
						bio: null,
						bioUrl: null,
						image: null,
						listeners: null,
						playcount: null,
						tracks: [
							{ artist: '周杰伦', title: '稻香' },
							{ artist: '周杰伦', title: '魔术先生' }
						]
					}),
					{ status: 200 }
				);
			})
		);
		const out = await getAlbumTracklist('魔杰座', '周杰伦');
		expect(capturedUrl).toContain('/api/lastfm/info');
		expect(capturedUrl).toContain('method=album.getinfo');
		expect(out).toEqual([
			{ artist: '周杰伦', title: '稻香' },
			{ artist: '周杰伦', title: '魔术先生' }
		]);
	});

	it('getAlbumTracklist returns [] when info has no tracks (absent-key / miss)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							tags: [],
							bio: null,
							bioUrl: null,
							image: null,
							listeners: null,
							playcount: null
						}),
						{ status: 200 }
					)
			)
		);
		await expect(getAlbumTracklist('X', 'Y')).resolves.toEqual([]);
	});

	it('every builder returns [] when fetch throws (never throws)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(getChartTopTracks()).resolves.toEqual([]);
		await expect(getChartTopArtists()).resolves.toEqual([]);
		await expect(getTagTopTracks('pop')).resolves.toEqual([]);
		await expect(getGeoTopTracks('China')).resolves.toEqual([]);
		await expect(getArtistTopAlbums('X')).resolves.toEqual([]);
		await expect(getAlbumTracklist('A', 'B')).resolves.toEqual([]);
	});

	it('builders return [] on the absent-key empty list shape', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }))
		);
		await expect(getChartTopTracks()).resolves.toEqual([]);
		await expect(getChartTopArtists()).resolves.toEqual([]);
	});
});

// quick-260926-hze — Last.fm keeps ONE canonical title per album, in either script (probed:
// 範特西 0 tracks vs 范特西 10; 十一月的萧邦 0 vs 十一月的蕭邦 12). A Chinese-title miss retries
// the other script(s) sequentially; hits and non-Chinese titles cost exactly one call.
describe('quick-260926-hze getAlbumTracklist script rescue', () => {
	const TRACKS = [{ artist: '周杰伦', title: '双截棍' }];

	/** Stub fetch: tracks ONLY for the `hit` album title, `{}` otherwise. Records album params. */
	function stubAlbums(hit: string): string[] {
		const albums: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const album = new URL(String(input), 'http://x').searchParams.get('album') ?? '';
				albums.push(album);
				return new Response(JSON.stringify(album === hit ? { tracks: TRACKS } : {}), { status: 200 });
			})
		);
		return albums;
	}

	it('Traditional miss → Simplified hit', async () => {
		const albums = stubAlbums('范特西');
		await expect(getAlbumTracklist('範特西', '周杰倫')).resolves.toEqual(TRACKS);
		expect(albums[1]).toBe('范特西');
	});

	it('Simplified miss → Traditional hit', async () => {
		const albums = stubAlbums('十一月的蕭邦');
		await expect(getAlbumTracklist('十一月的萧邦', '周杰伦')).resolves.toEqual(TRACKS);
		expect(albums.at(-1)).toBe('十一月的蕭邦');
	});

	it('a non-Chinese miss makes exactly ONE call', async () => {
		const albums = stubAlbums('nothing');
		await expect(getAlbumTracklist('Parachutes', 'Coldplay')).resolves.toEqual([]);
		expect(albums).toHaveLength(1);
	});

	it('a first-lookup hit makes exactly ONE call', async () => {
		const albums = stubAlbums('范特西');
		await expect(getAlbumTracklist('范特西', '周杰伦')).resolves.toEqual(TRACKS);
		expect(albums).toHaveLength(1);
	});

	it('a Chinese miss in every script resolves [] and never throws', async () => {
		stubAlbums('nothing');
		await expect(getAlbumTracklist('范特西', '周杰伦')).resolves.toEqual([]);
	});
});
