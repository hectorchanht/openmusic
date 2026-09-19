import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// quick-260919-ebi (F2) — STRUCTURAL gate for the shared settings row/picker components.
//
// Vitest here is ONE node/server project with NO jsdom, so a Svelte component cannot be rendered
// in a test. Everything below therefore reads SOURCE with readFileSync and asserts on the text —
// the same technique i18n.test.ts already uses for the quote-style convention.
//
// What this gate is for: `.row-toggle` (a boolean) and `.item` (navigates to a sub-page) used to
// be byte-identical boxes re-declared on six pages. Deleting the copies once is easy; keeping them
// deleted is the hard part, so a re-declaration fails CI instead of quietly drifting back.

const ROUTES = 'src/routes/(app)/settings';
const read = (p: string) => readFileSync(p, 'utf-8');

/** Strip `//` line comments and `<!-- -->` / CSS block comments so a comment that MENTIONS a class
 *  (every one of the deletion notes below does) can never self-invalidate the gate. */
function stripComments(src: string): string {
	return src
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((l) => !/^\s*\/\//.test(l))
		.join('\n');
}

/** True when the file declares a CSS RULE whose selector uses the class (`.foo {`,
 *  `.foo span:first-child {`, `.foo.on::after {`), not merely mentions the name. The `\b` after
 *  the class name is load-bearing: it keeps `.sw` from matching `.swatch` / `.swatches`. */
function declaresRule(src: string, cls: string): boolean {
	return new RegExp(`(^|[\\s,>+~])\\.${cls}\\b[^{;}\\n]*\\{`, 'm').test(stripComments(src));
}

describe('shared settings rows (quick-260919-ebi F2)', () => {
	// Pages fully converted in task 2. /settings/downloads is OUT OF SCOPE on purpose: its toggles
	// drive the `deviceImport` store inside a collapsed <details> on a native-only page, and the
	// chip idiom there is multi-select in half its call sites — a separate pass, not a half-convert.
	// /settings/playback and /settings/home are added to this list by tasks 4 and 5, which replace
	// their remaining toggle rows with previews outright (converting them first would be churn).
	const CONVERTED = [
		`${ROUTES}/+page.svelte`,
		`${ROUTES}/general/+page.svelte`,
		`${ROUTES}/appearance/+page.svelte`,
		`${ROUTES}/translation/+page.svelte`,
		`${ROUTES}/data/+page.svelte`
	];

	// The gate is only worth having if it actually trips, so pin the helper itself.
	it('declaresRule sees a real rule, ignores comments, and does not confuse .sw with .swatch', () => {
		expect(declaresRule('\t.row-toggle { color: red; }', 'row-toggle')).toBe(true);
		expect(declaresRule('\t.row-toggle span:first-child { gap: 10px; }', 'row-toggle')).toBe(true);
		expect(declaresRule('\t.sw.on::after { transform: none; }', 'sw')).toBe(true);
		expect(declaresRule('\t/* .row-toggle moved to SettingToggle.svelte */', 'row-toggle')).toBe(false);
		expect(declaresRule('\t<!-- .item is now SettingRow -->', 'item')).toBe(false);
		expect(declaresRule('\t.swatches { display: flex; }\n\t.swatch { width: 34px; }', 'sw')).toBe(false);
	});

	for (const file of CONVERTED) {
		it(`${file} declares no local .row-toggle / .sw / .item rule`, () => {
			const src = read(file);
			for (const cls of ['row-toggle', 'sw', 'item']) {
				expect(declaresRule(src, cls), `${file} re-declares .${cls} — import the shared component`).toBe(false);
			}
		});
	}

	it('SettingToggle and SettingRow are the ONLY definitions of the two row kinds', () => {
		const toggle = read('src/lib/components/SettingToggle.svelte');
		const row = read('src/lib/components/SettingRow.svelte');
		// The boolean kind: a real switch, the carried-over 40x22 pill, and the accent left edge.
		expect(toggle).toMatch(/role="switch"/);
		expect(toggle).toMatch(/aria-checked=\{checked\}/);
		expect(declaresRule(toggle, 'sw')).toBe(true);
		expect(toggle).toMatch(/border-left-color: var\(--color-primary\)/);
		// The config kind: chevron ALWAYS present (never inside an {#if}), raised surface.
		expect(row).toMatch(/<ChevronRight size=\{18\} class="chev" \/>/);
		expect(row).toMatch(/background: var\(--color-surface-2\)/);
	});

	it('each converted page imports the shared component it uses', () => {
		const uses: [string, string][] = [
			[`${ROUTES}/+page.svelte`, 'SettingRow'],
			[`${ROUTES}/data/+page.svelte`, 'SettingRow'],
			[`${ROUTES}/general/+page.svelte`, 'SettingToggle'],
			[`${ROUTES}/appearance/+page.svelte`, 'SettingToggle'],
			[`${ROUTES}/translation/+page.svelte`, 'SettingToggle']
		];
		for (const [file, comp] of uses) {
			// Quote style differs per file (appearance/ was prettier'd to double quotes), so match
			// the import PATH rather than a whole quoted statement.
			const src = read(file);
			expect(src, `${file} should import ${comp}`).toMatch(
				new RegExp(`import ${comp} from ['"]\\$lib/components/${comp}\\.svelte['"]`)
			);
			expect(src, `${file} should USE <${comp}`).toContain(`<${comp}`);
		}
	});
});
