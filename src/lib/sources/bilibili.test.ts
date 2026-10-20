import { describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import { bilibili} from './bilibili';
import type { Track} from './types';
import searchFixture from './__fixtures__/bilibili.search.json';

const ac = new AbortController();

// The fixture is a trimmed capture of the real WBI-signed search response
// (quick-261020-bili live probe, 2026-10-20, query 周杰伦 晴天).

/** A fetch mock that returns one JSON body for every call. */
function mockJsonFetch(body: unknown) {
return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
return new Response(JSON.stringify(body), {
status: 200,
headers: { 'content-type': 'application/json'}
});
});
}

function stubTrack(overrides: Partial<Track> = {}): Track {
return {
uid: 'bilibili:BV1BZbSzZEGT',
source: 'bilibili',
songid: 'BV1BZbSzZEGT',
title: '｜《晴天》- 周杰伦',
artist: 'VV音乐局',
album: '',
cover: null,
audioUrl: null,
lrc: null,
lrcUrl: null,
detailsLoaded: false,
quality: null,
qualityLabel: null,
keyword: '周杰伦 晴天',
displayIndex: 1,
duration: 270,
...overrides
};
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('bilibili.search (fixture-backed)', () => {
it('maps signed-search rows into canonical Track[] keyed bilibili:${bvid}', async () => {
vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
const tracks = await bilibili.search('周杰伦 晴天', 1, ac.signal);
expect(tracks.length).toBe(searchFixture.data.result.length);

const first = tracks[0];
const f0 = searchFixture.data.result[0];
expect(first.uid).toBe(`bilibili:${f0.bvid}`);
expect(first.songid).toBe(f0.bvid);
expect(first.title).not.toContain('<em'); // highlight tags stripped
expect(first.title).toContain('晴天');
expect(first.artist).toBe(f0.author);
expect(first.cover).toMatch(/^https:/); // protocol-relative pic upgraded
expect(first.duration).toBe(270); // "4:30" → seconds
expect(first.audioUrl).toBeNull();
expect(first.detailsLoaded).toBe(false);
});

it('keeps non-music-typename rows (real uploads hide under 日常 — no partition filter)', async () => {
vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
const tracks = await bilibili.search('周杰伦 晴天', 1, ac.signal);
const typenames = searchFixture.data.result.map((r) => r.typename);
expect(new Set(typenames).size).toBeGreaterThan(1); // fixture itself mixes partitions
expect(tracks.length).toBe(typenames.length);
});

it('throws on contract drift (code!== 0 or result missing)', async () => {
vi.stubGlobal('fetch', mockJsonFetch({ code: -101, data: {}}));
await expect(bilibili.search('x', 1, ac.signal)).rejects.toThrow(/contract-drift/);
});
});

describe('bilibili.resolve', () => {
it('points audioUrl at the OWN stream route (never the raw CDN url) and labels by bandwidth', async () => {
vi.stubGlobal(
'fetch',
mockJsonFetch({ cid: 12345, url: 'https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/x.m4s?deadline=1', bandwidth: 184052})
);
const out = await bilibili.resolve(stubTrack(), ac.signal);
expect(out.audioUrl).toBe('/api/bilibili/stream?bvid=BV1BZbSzZEGT');
expect(out.audioUrl).not.toContain('bilivideo.com');
expect(out.quality).toBe('192k');
expect(out.qualityLabel).toBe('192K');
expect(out.detailsLoaded).toBe(true);
expect(out.lrc).toBeNull(); // bilibili has no lyrics — null cleanly
});

it('labels lower DASH tiers honestly (30216-class stream → 64K)', async () => {
vi.stubGlobal('fetch', mockJsonFetch({ cid: 1, url: 'https://upos.bilivideo.com/x.m4s', bandwidth: 65698}));
const out = await bilibili.resolve(stubTrack(), ac.signal);
expect(out.qualityLabel).toBe('64K');
});

it('throws when the resolve route finds no stream (gone / region-locked)', async () => {
vi.stubGlobal('fetch', mockJsonFetch({ url: null}));
await expect(bilibili.resolve(stubTrack(), ac.signal)).rejects.toThrow(/no playable audio/);
});
});

describe('bilibili registry posture', () => {
it('is search-only: enabledByDefault true, autoResolveEligible false', () => {
expect(bilibili.enabledByDefault).toBe(true);
expect(bilibili.autoResolveEligible).toBe(false);
});
});
