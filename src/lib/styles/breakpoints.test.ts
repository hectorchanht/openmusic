import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// quick-260919-et3 (D-1): the app has EXACTLY TWO width breakpoints and this test is the guard.
//
// Before this task there was one — `@media (min-width: 640px)`, used twice to stop a 90vw column
// sprawling. The desktop rail adds `1024px` as the `lg` rung of that same sm/md/lg scale. A third
// number appearing here means someone invented a scale rather than reusing the two we have, which
// is how a responsive stylesheet turns into a pile of one-off widths — so this fails loudly and
// names the file:line, rather than being a convention nobody enforces.
//
// Node test, no jsdom (this project's Vitest has a single server project): it reads the files off
// disk and parses the `@media` preludes as text. That also makes it the ONLY automated evidence
// that a desktop change did not leak into the mobile cascade — Vitest here cannot render a layout.

const SRC = new URL('../../', import.meta.url).pathname; // src/
const ALLOWED = [640, 1024];

/** Every .svelte / .css file under src/, recursively. */
function styleFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) styleFiles(full, out);
		else if (/\.(svelte|css)$/.test(entry.name)) out.push(full);
	}
	return out;
}

/**
 * Blank out comments so a `@media (min-width: …)` written INSIDE a comment (app.css has several
 * prose references to media queries) is not mistaken for a real rule. Newlines are preserved so
 * reported line numbers stay accurate.
 */
function stripComments(text: string): string {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
		// `//` to end of line, but never the `//` in a `https://` URL.
		.replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead: string) => lead);
}

/** Each width feature in an `@media` prelude, as `{ px, line }`. */
function widthFeatures(text: string): { px: number; line: number }[] {
	const clean = stripComments(text);
	const found: { px: number; line: number }[] = [];
	const media = /@media([^{]*)\{/g;
	let m: RegExpExecArray | null;
	while ((m = media.exec(clean)) !== null) {
		const line = clean.slice(0, m.index).split('\n').length;
		for (const w of m[1].matchAll(/(?:min|max)-width\s*:\s*(\d+)px/g)) {
			found.push({ px: Number(w[1]), line });
		}
	}
	return found;
}

describe('breakpoint inventory (quick-260919-et3, D-1)', () => {
	const files = styleFiles(SRC);

	it('finds style files to scan (guards against a silently empty scan)', () => {
		expect(files.length).toBeGreaterThan(30); // 45 at the time of writing
	});

	it('uses exactly the two sanctioned width breakpoints: 640 and 1024', () => {
		const offenders: string[] = [];
		const seen = new Set<number>();
		for (const file of files) {
			for (const { px, line } of widthFeatures(readFileSync(file, 'utf8'))) {
				seen.add(px);
				if (!ALLOWED.includes(px)) offenders.push(`${relative(SRC, file)}:${line} → ${px}px`);
			}
		}
		expect(
			offenders,
			`Unsanctioned width breakpoint(s). The app has two: ${ALLOWED.join(', ')}px (sm/lg).\n` +
				`Reuse one, or change this allow-list deliberately.\n  ${offenders.join('\n  ')}`
		).toEqual([]);
		expect([...seen].sort((a, b) => a - b)).toEqual(ALLOWED);
	});

	it('still has the desktop breakpoint wired to the rail token', () => {
		const layout = readFileSync(join(SRC, 'routes/(app)/+layout.svelte'), 'utf8');
		expect(layout).toContain('min-width: 1024px');
		expect(readFileSync(join(SRC, 'app.css'), 'utf8')).toContain('--rail-w');
	});
});
