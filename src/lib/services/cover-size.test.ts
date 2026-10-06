import { describe, it, expect } from 'vitest';
import { resizeDzcdn, sizedCover, ROW_COVER_PX, TILE_COVER_PX } from './cover-size';

// cover-size (quick-261006-o9u) is the render-time downsizing layer: the cover cache keeps
// one mid-size master per song (400px iTunes / 500px Deezer) and each surface asks for what
// it actually paints. These tests pin the host routing, the Deezer standard-rung mapping,
// the never-upsize guard, and the passthrough for hosts with no size convention — all pure,
// node-runnable, no network.

const DZ_1000 = 'https://cdn-images.dzcdn.net/images/cover/abc123def456abc123def456abc123de/1000x1000-000000-80-0-0.jpg';
const DZ_ARTIST_1000 = 'https://e-cdns-images.dzcdn.net/images/artist/abc123def456abc123def456abc123de/1000x1000-000000-80-0-0.jpg';
const MZ_1200 = 'https://is1-ssl.mzstatic.com/image/thumb/abc/1200x1200bb.jpg';
const MZ_400 = 'https://is1-ssl.mzstatic.com/image/thumb/abc/400x400bb.jpg';

describe('cover-size constants', () => {
	it('ROW_COVER_PX covers 36–64px rows at 3x DPR', () => {
		expect(ROW_COVER_PX).toBe(200);
	});

	it('TILE_COVER_PX covers shelf tiles at 2x DPR', () => {
		expect(TILE_COVER_PX).toBe(400);
	});
});

describe('resizeDzcdn — Deezer size-token rewrite', () => {
	it('downsides 1000px to the nearest standard rung ≥ px (200 → 250)', () => {
		expect(resizeDzcdn(DZ_1000, 200)).toBe(
			'https://cdn-images.dzcdn.net/images/cover/abc123def456abc123def456abc123de/250x250-000000-80-0-0.jpg'
		);
	});

	it('rewrites artist-picture URLs too (same token shape)', () => {
		expect(resizeDzcdn(DZ_ARTIST_1000, 200)).toContain('250x250-');
	});

	it('400px asks for the 500 rung (nearest standard ≥ px)', () => {
		expect(resizeDzcdn(DZ_1000, 400)).toContain('500x500-');
	});

	it('never upsizes: a 250px URL asked for 400 stays 250', () => {
		const small = DZ_1000.replace('1000x1000-', '250x250-');
		expect(resizeDzcdn(small, 400)).toBe(small);
	});

	it('returns the URL unchanged when the size token is absent', () => {
		const u = 'https://cdn-images.dzcdn.net/images/cover/abc/500x500.jpg';
		expect(resizeDzcdn(u, 200)).toBe(u);
	});

	it('returns null for empty / null / undefined', () => {
		expect(resizeDzcdn('')).toBeNull();
		expect(resizeDzcdn(null)).toBeNull();
		expect(resizeDzcdn(undefined)).toBeNull();
	});
});

describe('sizedCover — per-host routing', () => {
	it('routes mzstatic URLs through resizeMzstatic', () => {
		expect(sizedCover(MZ_1200, 200)).toBe(
			'https://is1-ssl.mzstatic.com/image/thumb/abc/200x200bb.jpg'
		);
	});

	it('does not re-up an already-400px mzstatic URL asked for 400', () => {
		expect(sizedCover(MZ_400, 400)).toBe(MZ_400);
	});

	it('routes dzcdn URLs through resizeDzcdn', () => {
		expect(sizedCover(DZ_1000, 200)).toContain('250x250-');
	});

	it('passes QQ / netease / YTM / Last.fm URLs through unchanged', () => {
		const qq = 'http://y.gtimg.cn/music/photo_new/T002R300x300M000abc.jpg';
		const netease = 'https://p1.music.126.net/abc.jpg';
		const ytm = 'https://lh3.googleusercontent.com/abc=w120-h120-l90-rj';
		const lfm = 'https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg';
		expect(sizedCover(qq, 200)).toBe(qq);
		expect(sizedCover(netease, 200)).toBe(netease);
		expect(sizedCover(ytm, 200)).toBe(ytm);
		expect(sizedCover(lfm, 200)).toBe(lfm);
	});

	it('leaves unparseable strings alone (never throws)', () => {
		expect(sizedCover('not a url', 200)).toBe('not a url');
	});

	it('returns null for empty / null / undefined', () => {
		expect(sizedCover('', 200)).toBeNull();
		expect(sizedCover(null, 200)).toBeNull();
		expect(sizedCover(undefined, 200)).toBeNull();
	});
});
