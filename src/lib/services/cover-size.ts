// cover-size — render-time cover downsizing per display surface (quick-261006-o9u).
//
// The cover CACHE stores one URL per song shared by every surface — the hero (≤ ~390px)
// and 36px rows alike. Shrinking the STORED url would blur the hero; keeping it large
// wastes bytes on rows. So the resolver stores a mid-size master (400px iTunes / 500px
// Deezer, quick-261006-o9t) and each surface downsizes AT RENDER to what it actually
// paints. The browser downloads the smaller file; the cache keeps the master untouched,
// so pins, share tokens, the hero and the embedded-file art all keep working on the
// original URL. Render-only: never write a sizedCover() result back into the cache.
//
// Only hosts with a documented size-token convention are rewritten:
//  - *.mzstatic.com — `/<N>x<N>bb.<ext>` → `/<px>x<px>bb.jpg` (resizeMzstatic, chart-parse)
//  - *.dzcdn.net — `/images/<cover|artist>/<md5>/<W>x<H>-…` → the nearest standard rung
//    ≥ px (56 / 250 / 500 / 1000 — the sizes Deezer's CDN is known to serve)
// Every other host (QQ y.gtimg.cn, netease p1.music.126.net, YTM googleusercontent,
// Last.fm) passes through UNCHANGED — their resize conventions are host-specific and
// not safe to guess. A URL that is already ≤ px is never upsized.

import { resizeMzstatic } from './chart-parse';

/** Row art (36–64px @ up to 3x DPR) — the CompactRow / SongRow / Up-Next / Related size. */
export const ROW_COVER_PX = 200;
/** Shelf tiles + hero-adjacent surfaces (≤ ~200px @ 2x DPR). */
export const TILE_COVER_PX = 400;

/** The only square rungs Deezer's CDN is known to serve (cover_small/medium/big/xl). */
const DZ_STANDARD_SIZES = [56, 250, 500, 1000];

/** Smallest standard rung ≥ px (never invents a size the CDN may not serve). */
function dzRung(px: number): number {
	for (const s of DZ_STANDARD_SIZES) if (s >= px) return s;
	return 1000;
}

/**
 * Downsize a Deezer CDN cover/artist URL to the nearest standard rung ≥ px.
 * Pure, never throws. Returns the URL unchanged when the size token is absent
 * (not a dzcdn cover URL) or already ≤ px. Empty / null / undefined → null.
 */
export function resizeDzcdn(url: string | null | undefined, px = 250): string | null {
	if (!url) return null;
	const m = /\/images\/(cover|artist)\/[0-9a-f]{32}\/(\d+)x(\d+)-/.exec(url);
	if (!m) return url;
	const cur = Math.min(Number(m[2]), Number(m[3]));
	if (cur <= px) return url; // already small enough — never upsize
	const rung = dzRung(px);
	if (rung >= cur) return url;
	return url.replace(
		/(\/images\/(?:cover|artist)\/[0-9a-f]{32}\/)\d+x\d+(-)/,
		`$1${rung}x${rung}$2`
	);
}

/**
 * The cover URL sized for a `px`-wide display box. mzstatic → resizeMzstatic,
 * dzcdn → resizeDzcdn, every other host passes through unchanged. Pure, never
 * throws. Empty / null / undefined → null.
 */
export function sizedCover(url: string | null | undefined, px: number): string | null {
	if (!url) return null;
	let host = '';
	try {
		host = new URL(url).hostname.toLowerCase();
	} catch {
		return url; // not a parseable URL — leave it alone
	}
	if (host.endsWith('.mzstatic.com')) return resizeMzstatic(url, px);
	if (host === 'cdn-images.dzcdn.net' || host.endsWith('.dzcdn.net')) return resizeDzcdn(url, px);
	return url;
}
