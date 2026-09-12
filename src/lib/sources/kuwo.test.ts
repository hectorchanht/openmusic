import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { kuwo } from './kuwo';
import type { Track } from './types';
import { settings } from '$lib/stores/settings.svelte';
import searchFixture from './__fixtures__/kuwo.search.json';
import detailFixture from './__fixtures__/kuwo.detail.json';
import { kuwoHealth } from '$lib/services/kuwo-health';

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
	kuwoHealth.__reset(); // the gate is module-scope — never let a trip leak between tests
});
afterEach(() => {
	vi.restoreAllMocks();
	kuwoHealth.__reset();
});

describe('kuwo.search (fixture-backed)', () => {
	// Test 1 (search): {code:200,data:[{rid,...}]} → Track[] keyed kuwo:<rid>.
	it('normalizes the recorded search fixture into canonical Track[] keyed kuwo:<rid>', async () => {
		const spy = mockFetchOnce(searchFixture);
		vi.stubGlobal('fetch', spy);

		const tracks = await kuwo.search('周杰伦', 1, ac.signal);

		expect(tracks.length).toBe(searchFixture.data.length);
		const first = tracks[0];
		const rid = String(searchFixture.data[0].rid);
		// colon-form uid kuwo:<rid> (D-10)
		expect(first.uid).toBe(`kuwo:${rid}`);
		expect(first.source).toBe('kuwo');
		// songid === rid (string-normalized)
		expect(first.songid).toBe(rid);
		expect(first.title).toBe(searchFixture.data[0].name);
		expect(first.artist).toBe(searchFixture.data[0].artist);
		expect(first.album).toBe(searchFixture.data[0].album);
		expect(first.cover).toBe(searchFixture.data[0].pic);
		expect(first.keyword).toBe('周杰伦');
		expect(first.displayIndex).toBe(1);
		expect(first.detailsLoaded).toBe(false);
		expect(first.audioUrl).toBeNull();

		// hits the same-origin proxy /api/kuwo/search with name
		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toMatch(/^\/api\/kuwo\/search\?/);
		expect(calledUrl).toContain('name=' + encodeURIComponent('周杰伦'));
	});

	// Test 2 (search contract-drift): code!==200 or missing data → THROW.
	it('THROWS when code!==200 (contract-drift for allSettled)', async () => {
		vi.stubGlobal('fetch', mockFetchOnce({ code: 500, data: [] }));
		await expect(kuwo.search('x', 1, ac.signal)).rejects.toThrow(/contract-drift/);
	});

	it('THROWS when data is missing/not an array (contract-drift)', async () => {
		vi.stubGlobal('fetch', mockFetchOnce({ code: 200, msg: 'no data' }));
		await expect(kuwo.search('x', 1, ac.signal)).rejects.toThrow(/contract-drift/);
	});
});

describe('kuwo.resolve', () => {
	// D-03: resolve requests level=zp (lossless) by default, but level=128k when the
	// user pref is the 128–160k band. Pin the pref per-case so the level assertions are
	// explicit rather than tracking the live default ('128').
	let prevQuality: typeof settings.defaultQuality;
	beforeEach(() => {
		prevQuality = settings.defaultQuality;
	});
	afterEach(() => {
		settings.defaultQuality = prevQuality;
	});

	function stubTrack(overrides: Partial<Track> = {}): Track {
		return {
			uid: 'kuwo:158395650',
			source: 'kuwo',
			songid: '158395650',
			title: '晴天',
			artist: '周杰伦',
			album: '叶惠美',
			cover: null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: '周杰伦',
			displayIndex: 1,
			...overrides
		};
	}

	// Test 3 (resolve): sets audioUrl, inline lrc, lrcUrl=null, quality via inferQualityFromUrl.
	it('sets audioUrl + inline lrc + quality (level=zp lossless) and marks loaded', async () => {
		settings.defaultQuality = 'lossless'; // pin: requests level=zp
		const spy = mockFetchOnce(detailFixture);
		vi.stubGlobal('fetch', spy);

		const out = await kuwo.resolve(stubTrack(), ac.signal);

		expect(out.audioUrl).toBe(detailFixture.data.url);
		expect(out.lrc).toBe(detailFixture.data.lyric);
		expect(out.lrcUrl).toBeNull();
		expect(out.cover).toBe(detailFixture.data.pic);
		// .flac → LOSSLESS (inferQualityFromUrl)
		expect(out.quality).toBe('lossless');
		expect(out.qualityLabel).toBe('LOSSLESS');
		expect(out.detailsLoaded).toBe(true);

		// hits the same-origin proxy /api/kuwo/detail with id + level matching the pref
		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toMatch(/^\/api\/kuwo\/detail\?/);
		expect(calledUrl).toContain('id=158395650');
		expect(calledUrl).toContain('level=zp');
	});

	// 32-D-02 NEW: under the shipped 'auto' default with NO connection signal (node here;
	// iOS Safari + desktop Chrome in production) effectiveQuality resolves '320' — and kuwo
	// has NO distinct 320 rung, so it stays on level=zp. That honesty gap is PRE-EXISTING and
	// is what `settings.defaultQualityNote` already discloses; it is deliberately NOT "fixed"
	// here. What matters for gate #2 is that the literal 'auto' never reaches the level pick.
	it("requests level=zp when defaultQuality is 'auto' with no connection signal", async () => {
		settings.defaultQuality = 'auto';
		const spy = mockFetchOnce(detailFixture);
		vi.stubGlobal('fetch', spy);

		await kuwo.resolve(stubTrack(), ac.signal);

		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toContain('level=zp');
		expect(calledUrl).not.toContain('level=128k');
		expect(calledUrl).not.toContain('auto');
	});

	// D-03 NEW: the '128' default requests level=128k (best-effort A1 token) not zp.
	it("requests level=128k when defaultQuality is '128'", async () => {
		settings.defaultQuality = '128';
		const spy = mockFetchOnce(detailFixture);
		vi.stubGlobal('fetch', spy);

		await kuwo.resolve(stubTrack(), ac.signal);

		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toContain('level=128k');
		expect(calledUrl).not.toContain('level=zp');
	});

	// a non-flac url infers 320K (else branch of inferQualityFromUrl)
	it('infers 320K when the resolved url is not lossless', async () => {
		const mp3Detail = { code: 200, data: { ...detailFixture.data, url: 'https://x.kuwo.cn/a.mp3' } };
		vi.stubGlobal('fetch', mockFetchOnce(mp3Detail));

		const out = await kuwo.resolve(stubTrack(), ac.signal);
		expect(out.quality).toBe('320k');
		expect(out.qualityLabel).toBe('320K');
	});

	// Test 4 (resolve throw): code!==200 → THROW (legacy:2402, preserved verbatim).
	it('THROWS on code!==200 detail body (legacy throw model)', async () => {
		vi.stubGlobal('fetch', mockFetchOnce({ code: 404, data: null }));
		await expect(kuwo.resolve(stubTrack(), ac.signal)).rejects.toThrow(/detail failed/);
	});
});

// kuwo-health. MEASURED 2026-09-12: kw-api.cenguigui.cn serves an invalid TLS certificate, so
// Cloudflare returns 526 for every request, persistently, at ~1.0s each. kuwo is FIRST in the
// resolve floor (kuwo-first, RESOLVE-01), so while it is down every cold resolve and every
// cross-source fallback walk spends its first second on a source that cannot succeed. The gate
// removes those calls — it adds none.
describe('kuwo health gate', () => {
	function failingFetch() {
		return vi.fn(async () => {
			throw new Error('526');
		});
	}

	it('short-circuits search once the upstream has failed enough times', async () => {
		vi.stubGlobal('fetch', failingFetch());

		// Three real attempts, each rejecting the way a 526 does.
		for (let i = 0; i < 3; i++) {
			await expect(kuwo.search('x', 1, ac.signal)).rejects.toThrow();
		}

		// Gated now: the next search must return [] WITHOUT touching the network.
		const spy = vi.fn(async () => {
			throw new Error('should not be called');
		});
		vi.stubGlobal('fetch', spy);

		await expect(kuwo.search('x', 1, ac.signal)).resolves.toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});

	it('a healthy search clears the gate immediately', async () => {
		vi.stubGlobal('fetch', failingFetch());
		for (let i = 0; i < 3; i++) {
			await expect(kuwo.search('x', 1, ac.signal)).rejects.toThrow();
		}

		kuwoHealth.recordOk(); // what a well-formed body does

		const spy = mockFetchOnce(searchFixture);
		vi.stubGlobal('fetch', spy);
		const out = await kuwo.search('x', 1, ac.signal);

		expect(spy).toHaveBeenCalled(); // no longer short-circuited
		expect(out.length).toBeGreaterThan(0);
	});

	// resolve is deliberately NOT gated: it is only reached for a track already chosen, so
	// short-circuiting it would turn a gated window into an unplayable track. The gate exists to
	// stop SPECULATIVE calls (search / the fallback walk), not to refuse a direct request.
	it('does NOT gate resolve, even while the gate is tripped', async () => {
		for (let i = 0; i < 5; i++) kuwoHealth.recordFail();
		expect(kuwoHealth.isGated()).toBe(true);

		const spy = mockFetchOnce(detailFixture);
		vi.stubGlobal('fetch', spy);

		await kuwo.resolve(
			{ songid: '123', source: 'kuwo' } as unknown as Track,
			ac.signal
		);

		expect(spy).toHaveBeenCalled();
	});
});
