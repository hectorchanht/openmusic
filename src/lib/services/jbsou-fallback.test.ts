import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchJbsouStreamUrl } from './jbsou-fallback';
import { jbsouHealth } from './jbsou-health';
import { __resetGovernor } from './api-base';
import type { Track } from '$lib/sources/types';

const ac = new AbortController();
const JB_URL = 'https://m801.music.126.net/20261101/deadbeef/song.mp3';

function stubTrack(): Track {
	return {
		uid: 'netease:3440441479',
		source: 'netease',
		songid: '3440441479',
		title: '晴天',
		artist: 'Jay',
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '周杰伦',
		displayIndex: 1
	};
}

/** A fetch stub that answers ONLY /api/jbsou/resolve; anything else is a test bug. */
function stubJbsou(body: unknown, status = 200) {
	return vi.fn(async (input: RequestInfo | URL) => {
		const u = String(input);
		if (!u.includes('/api/jbsou/resolve')) throw new Error(`unexpected fetch ${u}`);
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	});
}

beforeEach(() => {
	jbsouHealth.__reset();
	__resetGovernor();
});
afterEach(() => {
	vi.restoreAllMocks();
	jbsouHealth.__reset();
	__resetGovernor();
});

describe('fetchJbsouStreamUrl', () => {
	it('returns the rescued url on a 200 {url} and records ok', async () => {
		const spy = stubJbsou({ url: JB_URL });
		vi.stubGlobal('fetch', spy);

		const out = await fetchJbsouStreamUrl('netease', stubTrack(), ac.signal);

		expect(out).toBe(JB_URL);
		const called = String(spy.mock.calls[0][0]);
		expect(called).toContain('/api/jbsou/resolve?type=netease');
		expect(called).toContain('id=3440441479');
		expect(called).toContain(`title=${encodeURIComponent('晴天')}`);
	});

	it('a 200 {url:null} is a clean no-match — null back, and it records OK (live pipe)', async () => {
		// Trip the streak to 2 fails first: a no-match must CLEAR it, not add to it.
		vi.stubGlobal('fetch', stubJbsou({ error: 'down' }, 503));
		await fetchJbsouStreamUrl('netease', stubTrack(), ac.signal);
		await fetchJbsouStreamUrl('netease', stubTrack(), ac.signal);

		vi.stubGlobal('fetch', stubJbsou({ url: null }));
		const out = await fetchJbsouStreamUrl('netease', stubTrack(), ac.signal);
		expect(out).toBeNull();

		// If the no-match had counted as a third failure the gate would now be tripped and
		// this call would never reach fetch — it must go through and succeed.
		const spy = stubJbsou({ url: JB_URL });
		vi.stubGlobal('fetch', spy);
		expect(await fetchJbsouStreamUrl('netease', stubTrack(), ac.signal)).toBe(JB_URL);
		expect(spy).toHaveBeenCalled();
	});

	it('503s record failures and trip the gate — a gated call never reaches fetch', async () => {
		const spy = stubJbsou({ error: 'jbsou upstream failed' }, 503);
		vi.stubGlobal('fetch', spy);

		for (let i = 0; i < 3; i++) {
			expect(await fetchJbsouStreamUrl('netease', stubTrack(), ac.signal)).toBeNull();
		}
		expect(jbsouHealth.isGated()).toBe(true);

		spy.mockClear();
		expect(await fetchJbsouStreamUrl('netease', stubTrack(), ac.signal)).toBeNull();
		expect(spy).not.toHaveBeenCalled();
	});

	it('a non-JSON 200 body is a pipe failure shape, not a no-match', async () => {
		vi.stubGlobal('fetch', stubJbsou('<html>challenge</html>'));
		expect(await fetchJbsouStreamUrl('netease', stubTrack(), ac.signal)).toBeNull();
		// one failure recorded — gate not yet tripped (threshold is 3)
		expect(jbsouHealth.isGated()).toBe(false);
	});

	it('never throws on a network rejection', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		await expect(fetchJbsouStreamUrl('qq', stubTrack(), ac.signal)).resolves.toBeNull();
	});

	it('skips the call entirely for a title-less track', async () => {
		const spy = stubJbsou({ url: JB_URL });
		vi.stubGlobal('fetch', spy);
		const t = stubTrack();
		t.title = '';
		expect(await fetchJbsouStreamUrl('netease', t, ac.signal)).toBeNull();
		expect(spy).not.toHaveBeenCalled();
	});
});
