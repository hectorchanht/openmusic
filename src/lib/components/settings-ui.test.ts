import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

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
/** Source with comments removed. These components DOCUMENT the rules they follow ("no <img>",
 *  "no url(...)", "a wrapper role=group"), so a gate reading raw text would match its own prose
 *  and either trip on nothing or pass on a comment. Always assert against the CODE. */
const readCode = (p: string) => stripComments(read(p));

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
	// Every settings page EXCEPT /settings/downloads, which is out of scope on purpose: its
	// toggles drive the `deviceImport` store inside a collapsed <details> on a native-only page,
	// and the chip idiom there is multi-select in half its call sites — a separate pass, not a
	// half-convert.
	//
	// /settings/home keeps ONE `.sw` rule deliberately: the bare section-visibility switch inside
	// the 44px drag-reorder rows. That is not a settings ROW — it has no label of its own and no
	// room for one — so SettingToggle does not fit and the exception is recorded here rather than
	// silently tolerated.
	const CONVERTED: [string, string[]][] = [
		[`${ROUTES}/+page.svelte`, ['row-toggle', 'sw', 'item']],
		[`${ROUTES}/general/+page.svelte`, ['row-toggle', 'sw', 'item']],
		[`${ROUTES}/appearance/+page.svelte`, ['row-toggle', 'sw', 'item']],
		[`${ROUTES}/translation/+page.svelte`, ['row-toggle', 'sw', 'item']],
		[`${ROUTES}/playback/+page.svelte`, ['row-toggle', 'sw', 'item']],
		[`${ROUTES}/data/+page.svelte`, ['row-toggle', 'sw', 'item']],
		[`${ROUTES}/home/+page.svelte`, ['row-toggle', 'item']]
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

	for (const [file, classes] of CONVERTED) {
		it(`${file} declares no local ${classes.map((c) => `.${c}`).join(' / ')} rule`, () => {
			const src = read(file);
			for (const cls of classes) {
				expect(declaresRule(src, cls), `${file} re-declares .${cls} — import the shared component`).toBe(false);
			}
		});
	}

	// The .seg pill row lived on four pages. SettingPicker is now its ONLY definition.
	it('no settings page re-declares the .seg segmented control', () => {
		for (const [file] of CONVERTED) {
			expect(declaresRule(read(file), 'seg'), `${file} re-declares .seg — use SettingPicker`).toBe(false);
		}
		expect(declaresRule(read('src/lib/components/SettingPicker.svelte'), 'seg')).toBe(true);
	});

	it('SettingToggle and SettingRow are the ONLY definitions of the two row kinds', () => {
		const toggle = readCode('src/lib/components/SettingToggle.svelte');
		const row = readCode('src/lib/components/SettingRow.svelte');
		// The boolean kind: a real switch, the carried-over 40x22 pill, and the accent left edge.
		expect(toggle).toMatch(/role="switch"/);
		expect(toggle).toMatch(/aria-checked=\{checked\}/);
		expect(declaresRule(toggle, 'sw')).toBe(true);
		expect(toggle).toMatch(/border-left-color: var\(--color-primary\)/);
		// The config kind: chevron ALWAYS present (never inside an {#if}), raised surface.
		expect(row).toMatch(/<ChevronRight size=\{18\} class="chev" \/>/);
		expect(row).toMatch(/background: var\(--color-surface-2\)/);
	});

	it('SettingPicker is the ONE picker, with the a11y vocabulary on both variants', () => {
		const picker = readCode('src/lib/components/SettingPicker.svelte');
		// Both variants: a group with a name, and every option a real <button> with aria-pressed.
		expect(picker.match(/role="group"/g) ?? []).toHaveLength(2);
		expect(picker.match(/aria-pressed=\{value === o\.v\}/g) ?? []).toHaveLength(2);
		expect(picker.match(/aria-label=\{o\.label\}/g) ?? []).toHaveLength(2);
		// The seg variant is the EXISTING pill row, not a second implementation of it.
		expect(picker).toMatch(/\.seg button\.on \{[\s\S]*?background: var\(--color-primary\)/);
		// Mocks never announce themselves; the button's aria-label is the accessible name.
		expect(picker).toMatch(/class="mock" aria-hidden="true"/);
	});

	// T-ebi-01: a preview that fetched a remote asset would leak a request and break offline, for
	// cosmetics. Previews are CSS/SVG only — this is the control, not a style preference.
	it('SettingPicker renders no image and requests nothing over the network', () => {
		const picker = readCode('src/lib/components/SettingPicker.svelte');
		expect(picker).not.toMatch(/<img/);
		expect(picker).not.toMatch(/url\(/);
	});

	// The descriptions moved off-screen behind an (i) disclosure. "Off-screen" must NOT mean
	// "gone for a screen reader", and on a mobile-first app it must not mean "hover-only" either.
	it('SettingHint hides the description visually WITHOUT removing it from the a11y tree', () => {
		const hint = readCode('src/lib/components/SettingHint.svelte');
		// Clipped, not removed. Any of these three would drop it out of the accessibility tree.
		expect(hint).toMatch(/clip-path: inset\(50%\)/);
		expect(hint).not.toMatch(/display:\s*none/);
		expect(hint).not.toMatch(/visibility:\s*hidden/);
		// A real button with a real name, so it is Tab-reachable and Enter/Space-operable.
		expect(hint).toMatch(/<button/);
		expect(hint).toMatch(/aria-expanded=\{open\}/);
		expect(hint).toMatch(/aria-controls=\{id\}/);
		expect(hint).toMatch(/aria-label=\{label/);
		// TAP is the primary affordance; hover is a pointer-device bonus, never the only way in.
		expect(hint).toMatch(/onclick=\{toggle\}/);
		expect(hint).toMatch(/open = !open/);
		// The (i) now sits INSIDE the title (an <h2>, a sub-heading, a <summary>), so the revealed
		// description is lifted out of that title's flow rather than pushed into it.
		expect(hint).toMatch(/position: absolute/);
		expect(hint).toMatch(/top: 100%/);
		expect(hint).toMatch(/@media \(hover: hover\)/);
	});

	it('the Theme preview is painted in LITERAL palette values, the one sanctioned exception', () => {
		const page = readCode(`${ROUTES}/appearance/+page.svelte`);
		// The dark card must look dark while the LIGHT theme is active, so tokens cannot be used.
		// These are the real app.css values; if they drift apart, the preview starts lying.
		for (const hex of ['#0b0b0f', '#f4f4f6', '#f7f7fa', '#1a1a22']) {
			expect(page, `appearance page should carry the literal ${hex}`).toContain(hex);
		}
		expect(page).toMatch(/variant="preview"/);
	});

	it('settings.themeDesc is gone from ALL 15 dictionaries (the two cards replaced it)', () => {
		const files = readdirSync('src/lib/i18n').filter(
			(f) => f.endsWith('.ts') && !['index.ts', 'detect.ts'].includes(f) && !f.endsWith('.test.ts')
		);
		expect(files).toHaveLength(15);
		for (const f of files) {
			expect(read(`src/lib/i18n/${f}`), `${f} still carries settings.themeDesc`).not.toContain(
				'"settings.themeDesc"'
			);
		}
	});

	it('each converted page imports the shared component it uses', () => {
		const uses: [string, string][] = [
			[`${ROUTES}/+page.svelte`, 'SettingRow'],
			[`${ROUTES}/data/+page.svelte`, 'SettingRow'],
			[`${ROUTES}/general/+page.svelte`, 'SettingToggle'],
			[`${ROUTES}/appearance/+page.svelte`, 'SettingToggle'],
			[`${ROUTES}/appearance/+page.svelte`, 'SettingPicker'],
			[`${ROUTES}/translation/+page.svelte`, 'SettingToggle'],
			[`${ROUTES}/playback/+page.svelte`, 'SettingPicker'],
			[`${ROUTES}/playback/+page.svelte`, 'SettingHint'],
			[`${ROUTES}/translation/+page.svelte`, 'SettingPicker'],
			[`${ROUTES}/translation/+page.svelte`, 'SettingHint'],
			[`${ROUTES}/home/+page.svelte`, 'SettingPicker'],
			[`${ROUTES}/home/+page.svelte`, 'SettingHint'],
			[`${ROUTES}/general/+page.svelte`, 'SettingHint'],
			[`${ROUTES}/appearance/+page.svelte`, 'SettingHint']
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
