import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// quick-261122-npfix (Hector 2026-11-22) — the Now Playing transport row is EXACTLY five
// controls (Heart · Prev · PLAY · Next · Download) with play at the TRUE centre: offset ≤ 1px at
// phone and iPad widths. Regression history: c366f48 (2026-10), quick-261103-npcenter, and
// quick-261121-beat (a duplicate game button made the row six wide → play ~22px left of centre).
//
// No jsdom here (single node project), so this is a source pin + layout arithmetic: it reads the
// REAL markup and the REAL <style> widths out of NowPlaying.svelte, then lays the row out exactly
// as `display:flex; justify-content:space-between` does. It FAILS if a sixth control is added,
// one is removed, the order changes, or a slot's width drifts so the two side pairs are unequal.
const src = readFileSync('src/lib/components/NowPlaying.svelte', 'utf-8');

/** The `.transport` element's inner markup, nesting-aware. */
function transportMarkup(): string {
	const open = '<div class="transport"';
	const start = src.indexOf(open);
	expect(start, 'transport row present').toBeGreaterThanOrEqual(0);
	const bodyStart = src.indexOf('>', start) + 1;
	let depth = 1;
	const re = /<(\/?)div\b[^>]*>/g;
	re.lastIndex = bodyStart;
	let m: RegExpExecArray | null;
	while ((m = re.exec(src))) {
		depth += m[1] ? -1 : 1;
		if (depth === 0) return src.slice(bodyStart, m.index);
	}
	throw new Error('unclosed .transport');
}

/** Direct children of the row (comments stripped), as their opening tags. */
function directChildren(markup: string): string[] {
	const body = markup.replace(/<!--[\s\S]*?-->/g, '');
	const out: string[] = [];
	let depth = 0;
	const re = /<(\/?)(button|span|div|a)\b[^>]*?(\/?)>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body))) {
		const [tag, close, , selfClose] = m;
		if (close) { depth--; continue; }
		if (depth === 0) out.push(tag);
		if (!selfClose) depth++;
	}
	return out;
}

/** A CSS rule's declared px value for a property, e.g. cssPx('.play', 'width'). */
function cssPx(selector: string, prop: string): number {
	const style = src.slice(src.indexOf('<style'));
	const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const rule = style.match(new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`));
	expect(rule, `rule ${selector}`).not.toBeNull();
	const decl = rule![1].match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`));
	expect(decl, `${selector} { ${prop} }`).not.toBeNull();
	return Number(decl![1]);
}

/** Slot width of one direct child, from its class + the stylesheet. */
function slotWidth(tag: string): number {
	if (/class="play\b/.test(tag)) return cssPx('.play', 'width');
	if (/class="t-dl"/.test(tag)) return cssPx('.t-dl', 'min-width');
	if (/class="t\b/.test(tag)) return cssPx('.transport .t', 'min-width');
	throw new Error(`unknown transport child: ${tag}`);
}

/** justify-content:space-between — returns each item's centre x within a row of `rowW`. */
function layoutSpaceBetween(widths: number[], rowW: number): number[] {
	const free = rowW - widths.reduce((a, b) => a + b, 0);
	const gap = widths.length > 1 ? free / (widths.length - 1) : 0;
	const centres: number[] = [];
	let x = 0;
	for (const w of widths) { centres.push(x + w / 2); x += w + gap; }
	return centres;
}

const children = directChildren(transportMarkup());

describe('Now Playing transport row (quick-261122-npfix)', () => {
	it('has EXACTLY five controls — no duplicated game button', () => {
		expect(children).toHaveLength(5);
		expect(transportMarkup()).not.toMatch(/Gamepad2|nowplaying\.game|selectTab\('game'\)/);
	});

	it('is Heart · Prev · PLAY · Next · Download, in that order', () => {
		expect(children[0]).toMatch(/toggleCurrentLike|menu\.like/);
		expect(children[1]).toMatch(/nowplaying\.previous/);
		expect(children[2]).toMatch(/class="play\b/);
		expect(children[3]).toMatch(/nowplaying\.next/);
		expect(children[4]).toMatch(/class="t-dl"/);
	});

	it('uses the shared DownloadControl, not a hand-rolled download button', () => {
		expect(transportMarkup()).toMatch(/<span class="t-dl"><DownloadControl\b/);
	});

	// Row widths: .transport has `margin: 0 4px`, so the row is viewport − 8 on phone; the iPad
	// widths cover portrait/landscape incl. the 1024px max-width:420px cap.
	const VIEWPORTS: Array<[string, number]> = [
		['iPhone SE', 320], ['iPhone 13 mini', 375], ['iPhone 15', 393], ['iPhone Pro Max', 430],
		['iPad mini', 744], ['iPad', 768], ['iPad Air', 820], ['iPad Pro 11', 834], ['iPad landscape', 1024]
	];
	for (const [name, vw] of VIEWPORTS) {
		it(`centres play within 1px at ${name} (${vw}px)`, () => {
			const rowW = vw >= 1024 ? 420 : vw - 8;
			const widths = children.map(slotWidth);
			const centres = layoutSpaceBetween(widths, rowW);
			const offset = Math.abs(centres[2] - rowW / 2);
			expect(offset, `play centre ${centres[2]} vs row centre ${rowW / 2}`).toBeLessThanOrEqual(1);
		});
	}

	it('every control keeps a ≥44px hit area', () => {
		for (const tag of children) expect(slotWidth(tag)).toBeGreaterThanOrEqual(44);
	});
});
