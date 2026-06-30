import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { joox } from './joox';
import type { Track } from './types';
import { settings } from '$lib/stores/settings.svelte';
import searchFixture from './__fixtures__/joox.search.json';
import detailFixture from './__fixtures__/joox.detail.json';

const ac = new AbortController();

/** A fetch mock that returns one JSON body for every call. */
function mockJsonFetch(body: unknown) {
	return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	});
}

/**
 * A fetch mock that distinguishes the upstream-detail call (carries `n=` via the
 * proxy path) from the probe HEAD/ranged-GET calls (hit the audio CDN URL directly).
 * Detail call → returns `detailBody`. Probe call → returns 200 (url is reachable).
 */
function mockResolveFetch(detailBody: unknown) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = (init?.method || 'GET').toUpperCase();
		// The metadata-proxy detail call goes through /api/joox/...
		if (url.startsWith('/api/joox')) {
			return new Response(JSON.stringify(detailBody), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		// Otherwise it is a probe against the resolved CDN url (HEAD then ranged GET).
		return new Response(method === 'HEAD' ? null : 'audio-bytes', {
			status: method === 'HEAD' ? 200 : 206,
			headers: { 'content-type': 'audio/flac' }
		});
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('joox.search (fixture-backed)', () => {
	// Test 1: Chinese-field mapping, colon uid (joox:${songmid}), inline lrc, songMid/jooxSongId/jooxIndex.
	it('maps Chinese field names into canonical Track[] keyed joox:${songmid}', async () => {
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));

		const tracks = await joox.search('周杰伦', 1, ac.signal);

		expect(tracks.length).toBe(searchFixture.data.songs.length);
		const first = tracks[0];
		const f0 = searchFixture.data.songs[0];
		// colon-form uid keyed by songmid (D-10)
		expect(first.uid).toBe(`joox:${f0.songmid}`);
		expect(first.source).toBe('joox');
		expect(first.songMid).toBe(f0.songmid);
		expect(first.jooxSongId).toBe(f0['歌曲ID']);
		// Chinese field name mapping
		expect(first.title).toBe(f0['歌曲名称']);
		expect(first.artist).toBe(f0['歌手']);
		expect(first.album).toBe(f0['专辑']);
		// lrc inline at search time
		expect(first.lrc).toBe(f0['歌词内容']);
		// jooxIndex is 1-based ORDERING only
		expect(first.jooxIndex).toBe(1);
		expect(tracks[2].jooxIndex).toBe(3);
		expect(first.keyword).toBe('周杰伦');
		expect(first.detailsLoaded).toBe(false);
	});

	it('hits the same-origin proxy /api/joox/search and NEVER sends a token from the client', async () => {
		const spy = mockJsonFetch(searchFixture);
		vi.stubGlobal('fetch', spy);

		await joox.search('hello', 1, ac.signal);

		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toMatch(/^\/api\/joox\/search\?/);
		expect(calledUrl).toContain('msg=hello');
		// the client must NOT inject the token or br — the proxy does that server-side
		expect(calledUrl).not.toMatch(/token=/i);
		expect(calledUrl).not.toMatch(/f84ao9lMF/);
	});

	it('THROWS on a contract-drift (non-200 / missing songs) body', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ code: 500, msg: 'upstream down' }));
		await expect(joox.search('x', 1, ac.signal)).rejects.toThrow();
	});
});

describe('joox.resolve — POSITION-INDEX IDENTITY FIX', () => {
	// Build the canonical search result set, then a helper to grab a known track.
	async function searchTracks(): Promise<Track[]> {
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
		return joox.search('周杰伦', 1, ac.signal);
	}

	// Test 2 (identity — happy path): reorder/paginate, resolve a known track whose
	// upstream detail returns a MATCHING songmid → resolves the SELECTED track.
	it('identity: after reorder, the correct track resolves when songmid matches', async () => {
		const tracks = await searchTracks();
		// REORDER (shuffle so position != original ordering)
		const reordered = [tracks[2], tracks[0], tracks[3], tracks[1]];
		// pick the track whose songmid the detail fixture matches ("稻香", 002cZ5jq3Hk8Yz)
		const target = reordered.find((t) => t.songMid === detailFixture.data.songmid)!;
		expect(target).toBeDefined();
		const originalSongMid = target.songMid;

		vi.stubGlobal('fetch', mockResolveFetch(detailFixture));
		const out = await joox.resolve(target, ac.signal);

		// resolved the SELECTED track, not whatever sits at position n
		expect(out.songMid).toBe(originalSongMid);
		expect(out.title).toBe('稻香');
		expect(out.audioUrl).toBeTruthy();
		expect(out.detailsLoaded).toBe(true);
	});

	// Test 3a (CROSS-FIELD match — 有人 case): upstream swaps which value lands in
	// `songmid` vs `歌曲ID` between search and detail, so the target's expected 歌曲ID
	// comes back as the returned `songmid`. The guard must confirm via cross-field token
	// match and resolve the song (no throw).
	it('identity: a cross-field swap (歌曲ID === returned songmid) resolves and plays', async () => {
		const tracks = await searchTracks();
		// target "晴天" (songMid=001Bnq3w0u8Pql, jooxSongId=songid-001Bnq3w0u8Pql)
		const target = tracks.find((t) => t.songMid === '001Bnq3w0u8Pql')!;
		expect(target).toBeDefined();

		// Field-swap: detail returns the target's expected 歌曲ID as its `songmid`.
		const crossFieldDetail = {
			code: 200,
			data: {
				songmid: target.jooxSongId, // == expected 歌曲ID (cross-field overlap)
				'歌曲ID': 'songid-some-other-value',
				'歌曲名称': '有人',
				'歌手': '周杰伦',
				'专辑': '叶惠美',
				'歌词内容': '[00:00.00]有人 - 周杰伦',
				'播放链接': {
					'无损FLAC': 'https://cdn.joox.example/audio/youren.flac'
				}
			}
		};

		vi.stubGlobal('fetch', mockResolveFetch(crossFieldDetail));
		const out = await joox.resolve(target, ac.signal);

		expect(out.detailsLoaded).toBe(true);
		expect(out.audioUrl).toBeTruthy();
	});

	// Test 3b (SOFT-ALLOW — partial/unconfirmed identity): a track with only `songid`
	// set (no songMid/jooxSongMid/jooxSongId) cannot reach the strong-disjoint case, so
	// an unconfirmed detail must SOFT-ALLOW: warn and play through, never throw.
	it('identity: partial/unconfirmed identity soft-allows (console.warn, no throw)', async () => {
		const tracks = await searchTracks();
		const base = tracks[0];
		// Hand-build a partial-identity track: clear all mid/songId anchors, keep songid only.
		const target: Track = {
			...base,
			songMid: undefined,
			jooxSongMid: undefined,
			jooxSongId: undefined,
			songid: 'lonely-songid-no-match',
			detailsLoaded: false,
			audioUrl: null
		};

		// Detail body whose tokens do NOT match the target's songid.
		const unrelatedDetail = {
			code: 200,
			data: {
				songmid: 'zzz-unrelated-mid',
				'歌曲ID': 'zzz-unrelated-songid',
				'歌曲名称': '陌生的歌',
				'歌手': '某人',
				'专辑': '某专辑',
				'歌词内容': '',
				'播放链接': {
					'无损FLAC': 'https://cdn.joox.example/audio/unrelated.flac'
				}
			}
		};

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.stubGlobal('fetch', mockResolveFetch(unrelatedDetail));

		const out = await joox.resolve(target, ac.signal);

		expect(out.detailsLoaded).toBe(true);
		expect(out.audioUrl).toBeTruthy();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	// Test 3c (STRONG-DISJOINT — fails loudly): both sides fully populated (mid + 歌曲ID)
	// with ZERO cross-field overlap → genuinely a different song → resolve THROWS,
	// detailsLoaded stays false. Wrong-song protection at full strength.
	it('identity: a strong-disjoint mismatch THROWS and leaves detailsLoaded false', async () => {
		const tracks = await searchTracks();
		const reordered = [tracks[1], tracks[3], tracks[0], tracks[2]];
		// target "晴天" (001Bnq3w0u8Pql / songid-001Bnq3w0u8Pql) — fully populated on both
		// mid and 歌曲ID — but the upstream detail returns "稻香" (002cZ5jq3Hk8Yz /
		// songid-002cZ5jq3Hk8Yz), also fully populated, with zero token overlap.
		const target = reordered.find((t) => t.songMid === '001Bnq3w0u8Pql')!;
		expect(target).toBeDefined();

		vi.stubGlobal('fetch', mockResolveFetch(detailFixture)); // returns 002cZ5... — WRONG song

		await expect(joox.resolve(target, ac.signal)).rejects.toThrow(/identity|mismatch|songmid/i);
		expect(target.detailsLoaded).toBe(false);
		expect(target.audioUrl).toBeNull();
	});

	// the upstream still requires n= — assert the client keeps sending it
	it('identity: still sends n= (jooxIndex) to the upstream proxy', async () => {
		const tracks = await searchTracks();
		const target = tracks.find((t) => t.songMid === detailFixture.data.songmid)!;
		const spy = mockResolveFetch(detailFixture);
		vi.stubGlobal('fetch', spy);

		await joox.resolve(target, ac.signal);

		const detailCall = spy.mock.calls.find((c) => String(c[0]).startsWith('/api/joox'));
		expect(detailCall).toBeDefined();
		expect(String(detailCall![0])).toMatch(/n=/);
	});
});

describe('joox.resolve — quality order (pickJooxPlayUrl)', () => {
	// D-03: pickJooxPlayUrl reorders the probe ladder via settings.defaultQuality.
	// Pin it per-case so the tier assertions are explicit about the active pref.
	let prevQuality: typeof settings.defaultQuality;
	beforeEach(() => {
		prevQuality = settings.defaultQuality;
	});
	afterEach(() => {
		settings.defaultQuality = prevQuality;
	});

	// Test 4: with multiple 播放链接 tiers, the highest-priority reachable tier wins.
	it('picks Atmos全景声 first and tags it lossless (lossless pref)', async () => {
		settings.defaultQuality = 'lossless'; // pin: verbatim top-tier-first order
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
		const tracks = await joox.search('周杰伦', 1, ac.signal);
		const target = tracks.find((t) => t.songMid === detailFixture.data.songmid)!;

		vi.stubGlobal('fetch', mockResolveFetch(detailFixture));
		const out = await joox.resolve(target, ac.signal);

		expect(out.audioUrl).toBe(detailFixture.data['播放链接']['Atmos全景声']);
		expect(out.quality).toBe('lossless');
		expect(out.qualityLabel).toBe('LOSSLESS');
		expect(out.jooxQualityText).toBe('Atmos全景声');
	});

	// D-03 NEW: under the '128' default the 128–160k band (AAC 192 / MP3 128) is probed
	// FIRST, so it wins over the lossless/320 tiers when present.
	it("probes the 128–160k band first when defaultQuality is '128'", async () => {
		settings.defaultQuality = '128';
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
		const tracks = await joox.search('周杰伦', 1, ac.signal);
		const target = tracks.find((t) => t.songMid === detailFixture.data.songmid)!;

		// A detail body that includes a 128-band tier alongside the lossless/320 tiers.
		const withBand = {
			...detailFixture,
			data: {
				...detailFixture.data,
				'播放链接': {
					...detailFixture.data['播放链接'],
					'AAC 192': 'https://cdn.joox.example/audio/002cZ5jq3Hk8Yz.192.aac',
					'MP3 128': 'https://cdn.joox.example/audio/002cZ5jq3Hk8Yz.128.mp3'
				}
			}
		};
		vi.stubGlobal('fetch', mockResolveFetch(withBand));
		const out = await joox.resolve(target, ac.signal);

		// AAC 192 leads the 128 band → wins over Atmos/FLAC/320 under the '128' pref
		expect(out.audioUrl).toBe(withBand.data['播放链接']['AAC 192']);
		expect(out.jooxQualityText).toBe('AAC 192');
		expect(out.quality).toBe('192k');
		expect(out.qualityLabel).toBe('192K');
		expect(out.detailsLoaded).toBe(true);
	});

	it('falls through to a lower tier when a higher one fails the probe (lossless pref)', async () => {
		settings.defaultQuality = 'lossless'; // pin: verbatim top-tier-first order
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
		const tracks = await joox.search('周杰伦', 1, ac.signal);
		const target = tracks.find((t) => t.songMid === detailFixture.data.songmid)!;

		const atmos = detailFixture.data['播放链接']['Atmos全景声'];
		const flac = detailFixture.data['播放链接']['无损FLAC'];
		// Atmos probe fails (network error); FLAC probe succeeds.
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.startsWith('/api/joox')) {
					return new Response(JSON.stringify(detailFixture), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					});
				}
				if (url === atmos) throw new Error('probe network error');
				if (url === flac) {
					const method = (init?.method || 'GET').toUpperCase();
					return new Response(method === 'HEAD' ? null : 'bytes', { status: 200 });
				}
				// any other tier: fail so FLAC is the winner
				throw new Error('unreachable');
			})
		);

		const out = await joox.resolve(target, ac.signal);
		expect(out.audioUrl).toBe(flac);
		expect(out.quality).toBe('lossless');
		expect(out.jooxQualityText).toBe('无损FLAC');
	});
});
