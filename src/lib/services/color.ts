// Pure colour math — no `browser` reads, no DOM, no store imports. Kept dependency-free
// and side-effect-free so settings.applyTheme() can import it without breaking leaf-store
// discipline, and so it is trivially unit-testable under the node Vitest project.

/** Darken a `#rrggbb` (leading `#` optional) hex by `amount` (0..1). Parses each channel,
 *  scales by `(1 - amount)`, clamps to 0..255 and rounds, then reassembles. Malformed input
 *  (named colours, 3-digit shorthand, empty) returns the input unchanged — never throws
 *  (T-17-07: hostile/malformed input is passed through, output is always a literal `#rrggbb`
 *  or the original string). Used by settings.applyTheme() to derive `--color-primary-hover`
 *  from the chosen accent. */
export function darken(hex: string, amount: number): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return hex;
	const n = parseInt(m[1], 16);
	const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 - amount))));
	const r = f(n >> 16);
	const g = f((n >> 8) & 0xff);
	const b = f(n & 0xff);
	return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Parse `#rrggbb` (leading `#` optional) to [r,g,b] 0..255, or null when malformed. */
function parseHex(hex: string): [number, number, number] | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	const n = parseInt(m[1], 16);
	return [n >> 16, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG 2.x relative luminance (sRGB linearisation). Malformed input reads as black (0). */
function relativeLuminance(hex: string): number {
	const rgb = parseHex(hex);
	if (!rgb) return 0;
	const [r, g, b] = rgb.map((c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours (1..21). */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const ON_DARK = '#0b0b0f';
const ON_LIGHT = '#ffffff';

/** quick-261102-rrb: text/icon colour for content sitting ON a `hex` fill — whichever of
 *  #0b0b0f / #ffffff has the higher WCAG contrast. The default tiffany primary (#0abab5) gets
 *  dark text (white was 2.41:1). Malformed input returns '#ffffff' (the pre-token behaviour),
 *  never throws (T-rrb-02). Set by settings.applyTheme() as `--color-on-primary`. */
export function onColor(hex: string): string {
	if (!parseHex(hex)) return ON_LIGHT;
	return contrastRatio(hex, ON_DARK) >= contrastRatio(hex, ON_LIGHT) ? ON_DARK : ON_LIGHT;
}
