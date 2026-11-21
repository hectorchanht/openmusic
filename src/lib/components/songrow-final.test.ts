import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// D-8 / quick-261121-row3 — Hector's FINAL song-row layout (settled 2026-11-21, brief:
// openmusic-songrow/brief.md). The row STACKS into three fixed lines — title alone, artist +
// ⋮, album + badges + like/download — beside a 64px cover, at a fixed 96px, with ≥44px hit
// areas and NO marquee in lists. These are source pins (the settings-ui / cover-art
// technique — no jsdom here): each one FAILS if a future edit re-squeezes a line, re-slims a
// hit box, brings the marquee back, or lets a control wander onto the title's line.
const read = (p: string) => readFileSync(p, 'utf-8');
const src = read('src/lib/components/SongRow.svelte');

/** The markup from `.meta` onward — script derivations share names with the markup
 *  expressions (albumText, artistLine), so segment assertions start here. */
const markup = src.slice(src.indexOf('<span class="meta">'));
const segment = (from: string, to: string) => {
	const a = markup.indexOf(from);
	const b = markup.indexOf(to, a);
	expect(a, `segment start ${from}`).toBeGreaterThanOrEqual(0);
	expect(b, `segment end ${to}`).toBeGreaterThan(a);
	return markup.slice(a, b);
};
const cssNum = (re: RegExp) => {
	const m = src.match(re);
	expect(m, String(re)).not.toBeNull();
	return Number(m![1]);
};

// The component's own geometry constants, as laid out in its <style> (asserted against the
// source in the geometry pin, then used as the basis for the width arithmetic).
const ROW_H = 96;
const PAD_Y = 10;
const PAD_X = 6;
const ROW_GAP = 12;
const ART = 64;
const L1 = 24;
const L2 = 20;
const L3 = 24;
const MENU_W = 36;
const LIKE_W = 36;
const DC_W = 32;
const L2_GAP = 4;
const L3_GAP = 2;
// At 360px the consuming lists carry 16px of page padding per side (the brief's basis).
const COLUMN = 360 - 2 * 16 - 2 * PAD_X - ART - ROW_GAP;

describe('FINAL geometry — the fixed 96px token', () => {
	it('.srow is exactly 96px tall (a fixed height, not a min-height content can stretch)', () => {
		expect(src).toMatch(/\.srow\s*\{[^}]*height: 96px/);
		expect(src).toMatch(/\.srow\s*\{[^}]*padding: 10px 6px/);
	});

	it('contain-intrinsic-size carries the same 96, so virtualised lists do not jump', () => {
		expect(src).toContain('contain-intrinsic-size: auto 96px');
		expect(src).not.toContain('contain-intrinsic-size: auto 56px');
	});

	it('the three line heights + space-between gaps + padding sum to the token', () => {
		const l1 = cssNum(/\.l1\s*\{\s*height: (\d+)px/);
		const l2 = cssNum(/\.l2\s*\{\s*height: (\d+)px/);
		const l3 = cssNum(/\.l3\s*\{\s*height: (\d+)px/);
		const col = cssNum(/\.meta\s*\{[^}]*height: (\d+)px/);
		expect([l1, l2, l3]).toEqual([L1, L2, L3]);
		// justify-content: space-between spreads the column's leftover as the two gaps.
		expect(col - (l1 + l2 + l3)).toBe(8);
		expect(col + 2 * PAD_Y).toBe(ROW_H);
	});

	it('the cover is the 64px base inside --cover-scale, capped at the 76px content box', () => {
		expect(src).toContain('width: min(calc(64px * var(--cover-scale, 1)), 76px)');
		expect(src).toContain('height: min(calc(64px * var(--cover-scale, 1)), 76px)');
	});
});

describe('FINAL widths at 360px — nobody is squeezed', () => {
	it('the title gets the whole meta column (≥ the brief’s 228px basis)', () => {
		expect(COLUMN).toBe(240);
		expect(COLUMN).toBeGreaterThanOrEqual(228);
	});

	it('the artist keeps ≥190px beside the ⋮ — ~1.9× the old shared-subtitle budget', () => {
		const artist = COLUMN - MENU_W - L2_GAP;
		expect(artist).toBe(200);
		expect(artist).toBeGreaterThanOrEqual(190);
		// Today's subtitle shares ~100px between artist + album pill (brief recon datum).
		expect(artist / 100).toBeGreaterThanOrEqual(1.9);
	});

	it('the 玖壹壹 · 高爾宣 OSN · 派偉俊 fixture fits the artist line whole, no ellipsis', () => {
		// The brief's measured width for the three-artist string at 13px type. The row's
		// artist renders at 12px (--fs-artist base), so the 13px measurement is conservative.
		const FIXTURE_PX = 174;
		expect(FIXTURE_PX).toBeLessThan(COLUMN - MENU_W - L2_GAP);
	});

	it('the album keeps ≥ the brief’s ~124px beside both line-3 actions', () => {
		const album = COLUMN - LIKE_W - DC_W - 2 * L3_GAP;
		expect(album).toBeGreaterThanOrEqual(124);
	});
});

describe('FINAL hit targets — ≥44px everywhere (the pre-FINAL 36px / 28px boxes fail this)', () => {
	it('every row control carries the shared 44×44 invisible expansion', () => {
		expect(src).toMatch(/\.ract::after,\s*\.srow :global\(\.dc\)::after\s*\{[^}]*width: 44px;[^}]*height: 44px;/);
	});

	it('the ⋮ is no longer slimmed: no 28px box remains anywhere in the row', () => {
		expect(src).not.toContain('width: 28px');
		expect(src).toMatch(/\.ract\.menu\s*\{[^}]*width: 36px;[^}]*height: 20px;[^}]*z-index: 2;/);
	});

	it('the ⋮ expansion is bottom-anchored (reaches up into line 1, never down into line 3)', () => {
		expect(src).toMatch(/\.ract\.menu::after\s*\{[^}]*bottom: 0;[^}]*transform: translateX\(-50%\);/);
	});

	it('controls inside .meta re-arm their pointer events (the meta visuals are inert)', () => {
		expect(src).toMatch(/\.ract\s*\{[^}]*pointer-events: auto;/);
		expect(src).toMatch(/\.srow :global\(\.dc\)\s*\{[^}]*pointer-events: auto;/);
	});
});

describe('FINAL marquee — lists ellipsise, they never scroll', () => {
	it('SongRow neither imports nor applies use:marquee', () => {
		expect(src).not.toContain("from '$lib/actions/marquee'");
		// The application pins scope to the markup: the D-2 history comment in the script
		// legitimately NAMES the old action while recording its removal.
		expect(markup).not.toContain('use:marquee');
		expect(markup).not.toContain('marquee-inner');
	});

	it('the per-line text box clips with an ellipsis', () => {
		expect(src).toMatch(/\.txt\s*\{[^}]*text-overflow: ellipsis;/);
		expect(src).toMatch(/\.txt\s*\{[^}]*overflow: hidden;/);
	});
});

describe('FINAL title-uncontested — line 1 holds the title and NO action element', () => {
	const l1 = segment('class="line l1"', 'class="line l2"');

	it('line 1 renders the title derivation and nothing else', () => {
		expect(l1).toContain('r-title');
		expect(l1).toContain('names.dnTitle(track.title, track.artist)');
		expect(l1).not.toContain('<button');
		expect(l1).not.toContain('DownloadControl');
		expect(l1).not.toContain('RowBadges');
		expect(l1).not.toContain('ract');
	});

	it('the ⋮ lives on line 2, with the artist', () => {
		const l2 = segment('class="line l2"', 'class="line l3"');
		expect(l2).toContain('{artistLine}');
		expect(l2).toContain('class="ract menu"');
	});
});

describe('FINAL artist line — the album can never fold the artist again', () => {
	const l2 = segment('class="line l2"', 'class="line l3"');
	const l3 = segment('class="line l3"', '</style>');

	it('line 2 holds ONLY the artist and the ⋮ — no album, no download control', () => {
		expect(l2).not.toContain('albumText');
		expect(l2).not.toContain('DownloadControl');
		expect(l2).not.toContain('RowBadges');
	});

	it('line 3 holds the album text, the badges and the actions', () => {
		expect(l3).toContain('{albumText}');
		expect(l3).toContain('<RowBadges');
		expect(l3).toContain('<DownloadControl');
	});

	it('the album pill is demoted: no .album-tag / .r-sub markup or CSS rule remains', () => {
		// Rule/markup checks, not bare words: the D-8 comments name the old classes while
		// recording the demotion.
		expect(markup).not.toContain('class="album-tag"');
		expect(markup).not.toContain('class="r-sub"');
		expect(src).not.toMatch(/\.album-tag\s*\{/);
		expect(src).not.toMatch(/\.r-sub\s*\{/);
	});
});

describe('FINAL state slots — liked / downloaded render on line 3', () => {
	const l3 = segment('class="line l3"', '</style>');

	it('the liked state fills the heart in the line-3 like slot', () => {
		expect(l3).toContain("fill={liked ? 'currentColor' : 'none'}");
		expect(l3).toContain('class:on={liked}');
	});

	it('the download slot is DownloadControl, and the badges stand down per D-5', () => {
		expect(l3).toContain("hideLiked={acts.includes('like')}");
		expect(l3).toContain("hideDownloaded={acts.includes('download')}");
	});
});
