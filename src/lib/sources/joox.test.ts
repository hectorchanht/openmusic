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

/**
 * A fetch mock for the plan-26-11 SELF-HEAL path. It distinguishes:
 *   - `/api/joox/search`  → returns `searchBody` (the CURRENT search order the self-heal reads
 *     to re-locate the stable songmid and derive the corrected `n`).
 *   - `/api/joox/detail?…&n=<N>` → returns `detailByN[N]` (per-n detail body), so the INITIAL
 *     n and the CORRECTED n can return DIFFERENT songs; a missing N yields an empty-data body.
 *   - anything else → a reachable probe (HEAD 200 / ranged-GET 206).
 * Search-call count is asserted off the returned spy's `.mock.calls`.
 */
function mockSelfHealFetch(searchBody: unknown, detailByN: Record<number, unknown>) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = (init?.method || 'GET').toUpperCase();
		if (url.startsWith('/api/joox/search')) {
			return new Response(JSON.stringify(searchBody), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		if (url.startsWith('/api/joox/detail')) {
			const m = url.match(/[?&]n=(\d+)/);
			const n = m ? Number(m[1]) : 1;
			const body = detailByN[n] ?? { code: 200, data: {} };
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
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

	// Test 3c (SELF-HEAL — stale n re-located by stable songmid, plan 26-11 / Gap 6): a would-be
	// strong-disjoint pick (both sides fully populated, zero cross-field overlap) SELF-HEALS: ONE
	// /api/joox/search re-locates the intended songmid at a CORRECTED index, the corrected detail
	// confirms → resolve returns the CORRECT song. NO throw. (Replaces the OLD throw-contract test.)
	it('identity: a stale-n strong-disjoint pick self-heals via songmid re-search → correct song', async () => {
		const tracks = await searchTracks();
		// target "晴天" (001Bnq3w0u8Pql / songid-001Bnq3w0u8Pql), jooxIndex=2 (fully populated).
		const target = tracks.find((t) => t.songMid === '001Bnq3w0u8Pql')!;
		expect(target).toBeDefined();
		const originalSongMid = target.songMid;

		// The correct 晴天 detail, keyed at the CORRECTED n=1 after the re-search.
		const qingtianDetail = {
			code: 200,
			data: {
				songmid: '001Bnq3w0u8Pql',
				'歌曲ID': 'songid-001Bnq3w0u8Pql',
				'歌曲名称': '晴天',
				'歌手': '周杰伦',
				'专辑': '叶惠美',
				'歌词内容': '[00:00.00]晴天 - 周杰伦',
				'播放链接': { '无损FLAC': 'https://cdn.joox.example/audio/qingtian.flac' }
			}
		};
		// A fresh search whose CURRENT order places 晴天 at index 0 → correctedN=1 (differs from n=2).
		const reSearchBody = {
			code: 200,
			data: {
				songs: [
					{
						songmid: '001Bnq3w0u8Pql',
						'歌曲ID': 'songid-001Bnq3w0u8Pql',
						'歌曲名称': '晴天',
						'歌手': '周杰伦',
						'专辑': '叶惠美'
					},
					{
						songmid: '002cZ5jq3Hk8Yz',
						'歌曲ID': 'songid-002cZ5jq3Hk8Yz',
						'歌曲名称': '稻香',
						'歌手': '周杰伦',
						'专辑': '魔杰座'
					}
				]
			}
		};

		// n=2 (the stale position) returns 稻香 (WRONG, strong-disjoint); n=1 (corrected) returns 晴天.
		vi.stubGlobal('fetch', mockSelfHealFetch(reSearchBody, { 1: qingtianDetail, 2: detailFixture }));

		const out = await joox.resolve(target, ac.signal);

		// Self-healed to the CORRECT song — not the wrong song sitting at the stale n.
		expect(out.songMid).toBe(originalSongMid);
		expect(out.title).toBe('晴天');
		expect(out.audioUrl).toBeTruthy();
		expect(out.detailsLoaded).toBe(true);
	});

	// Test 3d (UNRECOVERABLE mismatch — graceful never-throw, plan 26-11 / Gap 6): a would-be
	// strong-disjoint pick where the re-search does NOT contain the expected songmid (song gone)
	// → resolve returns the track UNRESOLVED (audioUrl=null, detailsLoaded=false), adopts NO
	// wrong-song field, and console.warns. NO throw. This is the failed-resolve sentinel that
	// player.play's `!resolved.audioUrl → runFallback → skip` path consumes.
	it('identity: an unrecoverable pick returns unresolved (audioUrl=null) and never throws', async () => {
		const tracks = await searchTracks();
		const target = tracks.find((t) => t.songMid === '001Bnq3w0u8Pql')!; // 晴天, jooxIndex=2
		expect(target).toBeDefined();

		// Re-search does NOT include 晴天 (001Bnq3w0u8Pql) → cannot re-locate → graceful fail.
		const reSearchWithoutTarget = {
			code: 200,
			data: {
				songs: [
					{
						songmid: '002cZ5jq3Hk8Yz',
						'歌曲ID': 'songid-002cZ5jq3Hk8Yz',
						'歌曲名称': '稻香',
						'歌手': '周杰伦',
						'专辑': '魔杰座'
					},
					{
						songmid: '0033yvWg2hT0Iz',
						'歌曲ID': 'songid-0033yvWg2hT0Iz',
						'歌曲名称': '七里香',
						'歌手': '周杰伦',
						'专辑': '七里香'
					}
				]
			}
		};

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// n=2 returns 稻香 (WRONG, strong-disjoint); the re-search cannot locate 晴天.
		vi.stubGlobal('fetch', mockSelfHealFetch(reSearchWithoutTarget, { 2: detailFixture }));

		const out = await joox.resolve(target, ac.signal);

		// Graceful failed-resolve sentinel — routed to runFallback/skip by player.play.
		expect(out).toBe(target); // same track object, no wrong-song substitution
		expect(out.audioUrl).toBeNull();
		expect(out.detailsLoaded).toBe(false);
		// Wrong-song fields NOT adopted (title stays 晴天, not 稻香).
		expect(out.title).toBe('晴天');
		expect(out.songMid).toBe('001Bnq3w0u8Pql');
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	// Test 3e (CONFIRMED fast path is bounded): a first-try confirm must NOT fire a self-heal
	// re-search (zero /api/joox/search calls — no fan-out).
	it('identity: a first-try confirm issues ZERO /api/joox/search calls (no self-heal)', async () => {
		const tracks = await searchTracks();
		const target = tracks.find((t) => t.songMid === detailFixture.data.songmid)!; // 稻香, confirmed
		const spy = mockResolveFetch(detailFixture);
		vi.stubGlobal('fetch', spy);

		const out = await joox.resolve(target, ac.signal);

		expect(out.detailsLoaded).toBe(true);
		const searchCalls = spy.mock.calls.filter((c) => String(c[0]).startsWith('/api/joox/search'));
		expect(searchCalls.length).toBe(0);
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
		// 32-D-02: the 'auto' cases stub `navigator`; drop it so later cases see the real one.
		vi.unstubAllGlobals();
	});

	// 32-D-02 / VALIDATION gate #2 — the cellular regression this seam exists to prevent.
	// Under the shipped 'auto' default with NO connection signal (the node project, and in
	// production iOS Safari + desktop Chrome), effectiveQuality resolves '320', so the probe
	// ladder must lead with the 320 band, NOT the Atmos/FLAC head of JOOX_QUALITY_ORDER.
	it("'auto' with no connection signal probes the 320 band FIRST, not lossless", async () => {
		settings.defaultQuality = 'auto';
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
		const tracks = await joox.search('周杰伦', 1, ac.signal);
		const target = tracks.find((t) => t.songMid === detailFixture.data.songmid)!;

		const spy = mockResolveFetch(detailFixture);
		vi.stubGlobal('fetch', spy);
		const out = await joox.resolve(target, ac.signal);

		expect(out.audioUrl).toBe(detailFixture.data['播放链接']['OGG 320']);
		expect(out.jooxQualityText).toBe('OGG 320');
		expect(out.quality).toBe('320k');
		// the FIRST probed url (first non-/api call) is the 320 tier — the ladder was reordered
		// before any probe ran, so Atmos/FLAC were never even reached.
		const firstProbe = spy.mock.calls.map((c) => String(c[0])).find((u) => !u.startsWith('/api'))!;
		expect(firstProbe).toBe(detailFixture.data['播放链接']['OGG 320']);
	});

	// 32-D-02: a positively-identified unmetered connection keeps the verbatim lossless-first order.
	it("'auto' on a wifi connection keeps the verbatim lossless-first order", async () => {
		settings.defaultQuality = 'auto';
		vi.stubGlobal('navigator', { connection: { type: 'wifi' } });
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
		const tracks = await joox.search('周杰伦', 1, ac.signal);
		const target = tracks.find((t) => t.songMid === detailFixture.data.songmid)!;

		vi.stubGlobal('fetch', mockResolveFetch(detailFixture));
		const out = await joox.resolve(target, ac.signal);

		expect(out.audioUrl).toBe(detailFixture.data['播放链接']['Atmos全景声']);
		expect(out.quality).toBe('lossless');
		expect(out.jooxQualityText).toBe('Atmos全景声');
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

describe('joox.resolve — graceful failed-resolve sentinel + bounded self-heal (plan 26-11)', () => {
	async function searchTracks(): Promise<Track[]> {
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
		return joox.search('周杰伦', 1, ac.signal);
	}

	// A re-search that does NOT contain 晴天 (001Bnq3w0u8Pql) → the self-heal cannot re-locate.
	const reSearchWithoutTarget = {
		code: 200,
		data: {
			songs: [
				{
					songmid: '002cZ5jq3Hk8Yz',
					'歌曲ID': 'songid-002cZ5jq3Hk8Yz',
					'歌曲名称': '稻香',
					'歌手': '周杰伦',
					'专辑': '魔杰座'
				}
			]
		}
	};

	// The graceful-fail return is the EXACT shape player.play's `!resolved.audioUrl` branch keys on.
	it('unrecoverable mismatch returns the passed-in track with audioUrl=null + detailsLoaded=false and adopts no wrong-song field', async () => {
		const tracks = await searchTracks();
		const target = tracks.find((t) => t.songMid === '001Bnq3w0u8Pql')!; // 晴天, jooxIndex=2
		const originalTitle = target.title;
		const originalSongId = target.jooxSongId;

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// n=2 returns 稻香 (WRONG, strong-disjoint); the re-search cannot locate 晴天.
		vi.stubGlobal('fetch', mockSelfHealFetch(reSearchWithoutTarget, { 2: detailFixture }));

		const out = await joox.resolve(target, ac.signal);

		// The failed-resolve sentinel: SAME track object, no wrong-song substitution.
		expect(out).toBe(target);
		expect(out.audioUrl).toBeNull();
		expect(out.detailsLoaded).toBe(false);
		// Wrong-song fields (稻香 / 002cZ5.../songid-002cZ5...) were NEVER copied onto the track.
		expect(out.title).toBe(originalTitle);
		expect(out.title).not.toBe('稻香');
		expect(out.jooxSongId).toBe(originalSongId);
		expect(out.songMid).toBe('001Bnq3w0u8Pql');
		warnSpy.mockRestore();
	});

	// BOUNDED: exactly one extra /api/joox/search on the disjoint path — no fan-out, no recursion.
	it('the disjoint self-heal fires AT MOST one /api/joox/search', async () => {
		const tracks = await searchTracks();
		const target = tracks.find((t) => t.songMid === '001Bnq3w0u8Pql')!; // 晴天, jooxIndex=2

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const spy = mockSelfHealFetch(reSearchWithoutTarget, { 2: detailFixture });
		vi.stubGlobal('fetch', spy);

		await joox.resolve(target, ac.signal);

		const searchCalls = spy.mock.calls.filter((c) => String(c[0]).startsWith('/api/joox/search'));
		expect(searchCalls.length).toBeLessThanOrEqual(1);
		expect(searchCalls.length).toBe(1);
		warnSpy.mockRestore();
	});

	// A CONFIRMED resolve makes ZERO self-heal search calls (the fast path never fans out).
	it('a confirmed resolve makes ZERO /api/joox/search calls', async () => {
		const tracks = await searchTracks();
		const target = tracks.find((t) => t.songMid === detailFixture.data.songmid)!; // 稻香, confirmed
		const spy = mockResolveFetch(detailFixture);
		vi.stubGlobal('fetch', spy);

		await joox.resolve(target, ac.signal);

		const searchCalls = spy.mock.calls.filter((c) => String(c[0]).startsWith('/api/joox/search'));
		expect(searchCalls.length).toBe(0);
	});
});
