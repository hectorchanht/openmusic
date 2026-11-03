import { describe, it, expect } from 'vitest';
import { darken, contrastRatio, onColor } from './color';

// Pure color util — no DOM, no browser, no store imports. Runs under the node project
// alongside detect.ts/i18n.test.ts. Asserts per-channel darkening + clamp + malformed
// passthrough (T-17-07: hostile/malformed input returns the input unchanged, never throws).
describe('darken (Phase 17 UX-07 accent-hover derivation)', () => {
	const channels = (hex: string): [number, number, number] => {
		const n = parseInt(hex.replace('#', ''), 16);
		return [n >> 16, (n >> 8) & 0xff, n & 0xff];
	};

	it('darkens each channel of a valid #rrggbb (within 0..255) for the default accent', () => {
		const out = darken('#7c5cff', 0.12);
		expect(out).toMatch(/^#[0-9a-f]{6}$/);
		const [r, g, b] = channels(out);
		const [r0, g0, b0] = channels('#7c5cff');
		// Each channel decreased (darker) and stays in range.
		expect(r).toBeLessThan(r0);
		expect(g).toBeLessThan(g0);
		expect(b).toBeLessThan(b0);
		for (const c of [r, g, b]) {
			expect(c).toBeGreaterThanOrEqual(0);
			expect(c).toBeLessThanOrEqual(255);
		}
	});

	it("halves each channel for amount 0.5 → '#ffffff' becomes '#808080'", () => {
		expect(darken('#ffffff', 0.5)).toBe('#808080');
	});

	it("clamps at 0 → '#000000' stays '#000000' for amount 0.5", () => {
		expect(darken('#000000', 0.5)).toBe('#000000');
	});

	it("accepts both '#rrggbb' and 'rrggbb' (leading # optional)", () => {
		expect(darken('ffffff', 0.5)).toBe('#808080');
		expect(darken('#ffffff', 0.5)).toBe('#808080');
	});

	it('returns malformed input unchanged and never throws', () => {
		// Named color, 3-digit shorthand, empty string — all unmatched by /^#?[0-9a-f]{6}$/i.
		expect(darken('red', 0.12)).toBe('red');
		expect(darken('#fff', 0.12)).toBe('#fff');
		expect(darken('', 0.12)).toBe('');
	});

	it('amount 0 returns the same color; amount 1 returns #000000', () => {
		expect(darken('#7c5cff', 0)).toBe('#7c5cff');
		expect(darken('#7c5cff', 1)).toBe('#000000');
	});
});

// quick-261102-rrb: --color-on-primary pick — whichever of #0b0b0f / #ffffff has higher WCAG
// contrast. Expectations follow the computed ratios (e.g. #7c5cff: dark 4.52 vs white 4.35).
describe('contrastRatio / onColor (quick-261102-rrb on-primary token)', () => {
	it('black vs white is ~21:1 and order-independent', () => {
		expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
	});

	it('picks dark text for the tiffany default and other bright accents', () => {
		expect(onColor('#0abab5')).toBe('#0b0b0f');
		expect(onColor('#ff8a00')).toBe('#0b0b0f');
		expect(onColor('#1db954')).toBe('#0b0b0f');
	});

	it('picks the higher-contrast side for mid-luminance accents', () => {
		for (const hex of ['#7c5cff', '#ff0033']) {
			const dark = contrastRatio(hex, '#0b0b0f');
			const light = contrastRatio(hex, '#ffffff');
			expect(onColor(hex)).toBe(dark >= light ? '#0b0b0f' : '#ffffff');
		}
	});

	it('extremes: black fill → white, white fill → dark', () => {
		expect(onColor('#000000')).toBe('#ffffff');
		expect(onColor('#ffffff')).toBe('#0b0b0f');
	});

	it('malformed input returns #ffffff and never throws', () => {
		expect(onColor('red')).toBe('#ffffff');
		expect(onColor('#abc')).toBe('#ffffff');
		expect(onColor('')).toBe('#ffffff');
	});

	it('light-theme border #80808a is >= 3:1 against surface-2 #ececf2', () => {
		expect(contrastRatio('#80808a', '#ececf2')).toBeGreaterThanOrEqual(3);
	});
});
