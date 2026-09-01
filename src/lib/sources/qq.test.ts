import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { qq } from './qq';
import type { Track } from './types';
import { settings } from '$lib/stores/settings.svelte';
import searchFixture from './__fixtures__/qq.search.json';
import detailFixture from './__fixtures__/qq.detail.json';

const ac = new AbortController();

function mockFetchOnce(body: unknown, contentType = 'application/json') {
	return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': contentType }
		});
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('qq.search (fixture-backed)', () => {
	// Test 1 (bare-array shape): the recorded fixture is a BARE array.
	it('normalizes a BARE-array search body into canonical Track[] keyed qq:<song_mid>', async () => {
		const spy = mockFetchOnce(searchFixture);
		vi.stubGlobal('fetch', spy);

		const tracks = await qq.search('周杰伦', 1, ac.signal);

		expect(tracks.length).toBe(searchFixture.length);
		const first = tracks[0];
		// canonical COLON-form uid (D-10) keyed by song_mid
		expect(first.uid).toBe(`qq:${searchFixture[0].song_mid}`);
		expect(first.source).toBe('qq');
		expect(first.songid).toBe(searchFixture[0].song_mid);
		expect(first.songMid).toBe(searchFixture[0].song_mid);
		expect(first.qqId).toBe(searchFixture[0].song_mid);
		expect(first.title).toBe(searchFixture[0].song_title);
		expect(first.artist).toBe(searchFixture[0].singer_name);
		// detail re-uses the search keyword as msg (legacy:2080)
		expect(first.qqSearchKey).toBe('周杰伦');
		expect(first.keyword).toBe('周杰伦');
		// 1-based ordering (legacy:2069) — qqIndex + displayIndex
		expect(first.qqIndex).toBe(1);
		expect(first.displayIndex).toBe(1);
		// pay captured into BOTH pay and qqQualityText (legacy:2107-2108)
		expect(first.pay).toBe(searchFixture[0].pay);
		expect(first.qqQualityText).toBe(searchFixture[0].pay);
		// no audio/lrc at search time
		expect(first.audioUrl).toBeNull();
		expect(first.lrc).toBeNull();
		expect(first.detailsLoaded).toBe(false);

		// it hits the same-origin proxy /api/qq/search
		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toMatch(/^\/api\/qq\/search\?/);
		expect(calledUrl).toContain('msg=' + encodeURIComponent('周杰伦'));
	});

	// Test 2 (wrapped shape): the SAME logic against a {data:[...]} wrapper.
	it('normalizes a {data:[...]}-WRAPPED body identically (dual-format guard, legacy:2055)', async () => {
		vi.stubGlobal('fetch', mockFetchOnce({ data: searchFixture }));

		const tracks = await qq.search('周杰伦', 1, ac.signal);

		expect(tracks.length).toBe(searchFixture.length);
		expect(tracks[0].uid).toBe(`qq:${searchFixture[0].song_mid}`);
		expect(tracks[1].uid).toBe(`qq:${searchFixture[1].song_mid}`);
		expect(tracks[2].title).toBe(searchFixture[2].song_title);
	});

	// Test 3 (contract-drift): neither array nor {data:[]} → THROW (not return 0).
	it('THROWS on a body that is neither array nor {data:[]} (HTML error page)', async () => {
		vi.stubGlobal('fetch', mockFetchOnce('<html><body>502 Bad Gateway</body></html>', 'text/html'));
		// The HTML string parsed as JSON would fail; emulate an upstream that returns a
		// JSON object that is neither a bare array nor {data:[]}.
		vi.stubGlobal('fetch', mockFetchOnce({ error: 'rate limited' }));
		await expect(qq.search('x', 1, ac.signal)).rejects.toThrow(/contract-drift/);
	});
});

/** 32-D-05: the fixture carries the REAL upstream `http://isure6…` urls, and the adapter upgrades
 *  every returned url to https. Assertions therefore compare against the upgraded form — writing it
 *  as a transform of the fixture keeps the two in lockstep while still failing if the upgrade is
 *  dropped (the fixture side is http, so a missing upgrade cannot accidentally match). */
const upgraded = (url: string) => url.replace(/^http:\/\//i, 'https://');

describe('qq.resolve', () => {
	// D-03: the ladder now reads settings.defaultQuality. Pin it per-case so the quality
	// assertions reflect the intended tier rather than the live default — 32-D-02 moved that
	// default from '128' to 'auto', which resolves per-connection, so pinning matters MORE now.
	let prevQuality: typeof settings.defaultQuality;
	beforeEach(() => {
		prevQuality = settings.defaultQuality;
	});
	afterEach(() => {
		settings.defaultQuality = prevQuality;
	});

	function stubTrack(overrides: Partial<Track> = {}): Track {
		return {
			uid: 'qq:002Neh8l0RJHcS',
			source: 'qq',
			songid: '002Neh8l0RJHcS',
			title: '晴天',
			artist: '周杰伦',
			album: '',
			cover: null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: '周杰伦',
			displayIndex: 1,
			qqSearchKey: '周杰伦',
			qqIndex: 1,
			qqId: '002Neh8l0RJHcS',
			songMid: '002Neh8l0RJHcS',
			pay: '付费',
			qqQualityText: '付费',
			...overrides
		};
	}

	// Test 4 (quality priority): picks song_play_url_sq (lossless) when present.
	it('picks the sq (lossless) URL by priority, sets inline lrc, cover, qqQualityText', async () => {
		settings.defaultQuality = 'lossless'; // pin: assert the legacy top-tier-first order
		const spy = mockFetchOnce(detailFixture);
		vi.stubGlobal('fetch', spy);

		const out = await qq.resolve(stubTrack(), ac.signal);

		// sq beats pq>hq>standard>fallback (legacy:2330-2345), and 32-D-05 upgrades it to https
		expect(out.audioUrl).toBe(upgraded(detailFixture.song_play_url_sq));
		expect(out.audioUrl?.startsWith('https://')).toBe(true);
		// inline LRC from song_lyric (legacy:2369)
		expect(out.lrc).toBe(detailFixture.song_lyric);
		expect(out.cover).toBe(detailFixture.album_pic);
		expect(out.album).toBe(detailFixture.album_name);
		expect(out.pageUrl).toBe(detailFixture.song_h5_url);
		// qqQualityText carries the SQ kbps text from pickBestPlayUrl
		expect(out.qqQualityText).toBe(`SQ ${detailFixture.kbps_sq}`);
		// .flac → inferQualityFromUrl tags LOSSLESS
		expect(out.quality).toBe('lossless');
		expect(out.qualityLabel).toBe('LOSSLESS');
		expect(out.detailsLoaded).toBe(true);

		// hits the same-origin proxy /api/qq/detail with msg + mid
		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toMatch(/^\/api\/qq\/detail\?/);
		expect(calledUrl).toContain('mid=002Neh8l0RJHcS');
	});

	// quick-260629-nyl Task 3: the lyric read is widened to tolerate a NESTED lyric object
	// (`song_lyric: { lyric: '...' }` / `lyric: { lrc: '...' }`) WITHOUT dropping the existing
	// plain-string keys. A new-shape detail body must still yield out.lrc.
	it('extracts lrc from a NESTED song_lyric object (new shape), keeping the old string path green', async () => {
		settings.defaultQuality = 'lossless';
		const nested = {
			...detailFixture,
			song_lyric: { lyric: '[00:00.00]nested-qq-lyric' }
		};
		vi.stubGlobal('fetch', mockFetchOnce(nested));
		const out = await qq.resolve(stubTrack(), ac.signal);
		expect(out.lrc).toBe('[00:00.00]nested-qq-lyric');
		expect(out.detailsLoaded).toBe(true);
	});

	it('falls back to the `lyric` field when song_lyric is absent (old-shape tolerance preserved)', async () => {
		settings.defaultQuality = 'lossless';
		const onlyLyric = { ...detailFixture, song_lyric: undefined, lyric: '[00:00.00]plain-lyric' };
		vi.stubGlobal('fetch', mockFetchOnce(onlyLyric));
		const out = await qq.resolve(stubTrack(), ac.signal);
		expect(out.lrc).toBe('[00:00.00]plain-lyric');
	});

	// SRCH-01: QQ detail carries the track length in SECONDS as `song_play_time`. Map it
	// onto Track.duration so the 試聽 sub-60s penalty (Plan 04) is demonstrable end-to-end.
	it('maps numeric song_play_time (seconds) onto Track.duration', async () => {
		settings.defaultQuality = 'lossless';
		vi.stubGlobal('fetch', mockFetchOnce(detailFixture));
		const out = await qq.resolve(stubTrack(), ac.signal);
		expect(out.duration).toBe(detailFixture.song_play_time);
		expect(typeof out.duration).toBe('number');
	});

	// D-03: a missing/zero play-time must yield `undefined` (NOT 0) so scoreMatch never
	// penalizes it as a sub-60s clip.
	it('leaves duration undefined when song_play_time is missing (NOT 0)', async () => {
		settings.defaultQuality = 'lossless';
		const noTime = { ...detailFixture, song_play_time: undefined };
		vi.stubGlobal('fetch', mockFetchOnce(noTime));
		const out = await qq.resolve(stubTrack(), ac.signal);
		expect(out.duration).toBeUndefined();
	});

	it('leaves duration undefined when song_play_time is 0 (0 = unknown, never penalized)', async () => {
		settings.defaultQuality = 'lossless';
		const zeroTime = { ...detailFixture, song_play_time: 0 };
		vi.stubGlobal('fetch', mockFetchOnce(zeroTime));
		const out = await qq.resolve(stubTrack(), ac.signal);
		expect(out.duration).toBeUndefined();
	});

	// 32-D-05: the upgrade is IDEMPOTENT — a body that already carries https passes through
	// byte-identical, so a future upstream that fixes its scheme is not double-rewritten.
	it('leaves an already-https url unchanged (upgrade is idempotent)', async () => {
		settings.defaultQuality = 'lossless';
		const alreadyHttps = {
			...detailFixture,
			song_play_url_sq: 'https://isure6.stream.qqmusic.qq.com/F000AlreadyHttps.flac'
		};
		vi.stubGlobal('fetch', mockFetchOnce(alreadyHttps));

		const out = await qq.resolve(stubTrack(), ac.signal);
		expect(out.audioUrl).toBe('https://isure6.stream.qqmusic.qq.com/F000AlreadyHttps.flac');
	});

	// quality priority fallthrough: when sq/pq absent, hq is chosen — 32-D-18: and accom, which
	// used to sit ABOVE hq, must NEVER win here. accom is 伴奏 (the instrumental) and is .ogg,
	// which iOS Safari cannot decode; the fixture carries it precisely so this case pins it.
	it('falls through to hq when sq and pq are absent — accom never beats hq (32-D-18)', async () => {
		settings.defaultQuality = 'lossless'; // pin: legacy top-tier-first order
		const noLossless = {
			...detailFixture,
			song_play_url_sq: undefined,
			song_play_url_pq: undefined
		};
		vi.stubGlobal('fetch', mockFetchOnce(noLossless));

		const out = await qq.resolve(stubTrack(), ac.signal);
		expect(out.audioUrl).toBe(upgraded(detailFixture.song_play_url_hq));
		expect(out.audioUrl).not.toBe(upgraded(detailFixture.song_play_url_accom));
	});

	// 32-D-18: accom is demoted to LAST among the named tiers — reachable only when every real-song
	// rung is absent, and still ahead of the untagged bare-url fallback.
	it('uses accom only as a last resort, below fq (32-D-18)', async () => {
		settings.defaultQuality = 'lossless';
		const onlyAccom = {
			...detailFixture,
			song_play_url_sq: undefined,
			song_play_url_pq: undefined,
			song_play_url_hq: undefined,
			song_play_url_standard: undefined,
			song_play_url_fq: undefined
		};
		vi.stubGlobal('fetch', mockFetchOnce(onlyAccom));

		const out = await qq.resolve(stubTrack(), ac.signal);
		expect(out.audioUrl).toBe(upgraded(detailFixture.song_play_url_accom));
		// and it is labelled honestly as ACCOM, not presented as an HQ quality tier
		expect(out.qqQualityText).toBe(`ACCOM ${detailFixture.kbps_accom}`);
	});

	// 32-D-19: the ladder positively identified the hq rung, so inferQualityFromUrl (which relabels
	// EVERY non-FLAC url as 320K purely on the extension) must not clobber it. The hq tier measured
	// 193 kbps m4a on 3/3 probed tracks — a '320K' pill there is a lie to the user.
	it("keeps the ladder's own tier tag under '320' — inferQualityFromUrl never relabels it 320K", async () => {
		settings.defaultQuality = '320';
		vi.stubGlobal('fetch', mockFetchOnce(detailFixture));

		const out = await qq.resolve(stubTrack(), ac.signal);
		expect(out.audioUrl).toBe(upgraded(detailFixture.song_play_url_hq));
		expect(out.quality).toBe('hq');
		expect(out.qualityLabel).toBe('HQ');
	});

	// 32-D-02: 'auto' is resolved by effectiveQuality BEFORE the ladder branches. Under node there is
	// no navigator.connection, so it fails closed to '320' and reuses the existing hq promotion —
	// zero new branches. This exercises the shipped default end-to-end through the adapter.
	it("resolves the 'auto' pref through effectiveQuality and lands on hq with no connection signal", async () => {
		settings.defaultQuality = 'auto';
		vi.stubGlobal('fetch', mockFetchOnce(detailFixture));

		const out = await qq.resolve(stubTrack(), ac.signal);
		expect(out.audioUrl).toBe(upgraded(detailFixture.song_play_url_hq));
		expect(out.quality).toBe('hq');
	});

	// D-03 NEW: the '128' pref promotes the STANDARD tier ahead of sq/pq/hq. 32-D-04: that tier is
	// song_play_url_standard, MEASURED at 97-98 kbps — not the "128–160k band" the old claim said.
	it("promotes song_play_url_standard (STD, measured 97 kbps) when defaultQuality is '128'", async () => {
		settings.defaultQuality = '128';
		const spy = mockFetchOnce(detailFixture);
		vi.stubGlobal('fetch', spy);

		const out = await qq.resolve(stubTrack(), ac.signal);

		// STD wins over sq/pq/hq under the 128 pref
		expect(out.audioUrl).toBe(upgraded(detailFixture.song_play_url_standard));
		expect(out.qqQualityText).toBe(`STD ${detailFixture.kbps_standard}`);
		// 32-D-19: 'standard' survives; the .m4a extension does not turn it into a 320K badge
		expect(out.quality).toBe('standard');
		expect(out.qualityLabel).toBe('STD');
		expect(out.detailsLoaded).toBe(true);
	});

	// Test 5 (retry semantics): missing song_mid → throw AND detailsLoaded stays false.
	it('THROWS and leaves detailsLoaded=false on an invalid detail body (retry-on-next-play)', async () => {
		// Detail body lacking song_mid is invalid (legacy:2352-2355).
		vi.stubGlobal('fetch', mockFetchOnce({ song_title: 'oops', song_play_url: 'x.mp3' }));

		const track = stubTrack();
		await expect(qq.resolve(track, ac.signal)).rejects.toThrow(/invalid response/);
		// CRITICAL: detailsLoaded must remain false so a later play retries (legacy:2392-2395).
		expect(track.detailsLoaded).toBe(false);
	});

	// retry semantics when the track has no usable mid at all.
	it('THROWS and leaves detailsLoaded=false when the track has no mid', async () => {
		vi.stubGlobal('fetch', mockFetchOnce(detailFixture));
		const track = stubTrack({ qqId: '', songMid: '', songid: '' });
		await expect(qq.resolve(track, ac.signal)).rejects.toThrow(/missing mid/);
		expect(track.detailsLoaded).toBe(false);
	});
});
