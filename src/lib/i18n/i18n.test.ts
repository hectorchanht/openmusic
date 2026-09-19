import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Import ONLY the PURE exports — NOT `t` (it reads `$state` via settings, which the
// node Vitest project can't compile). These helpers are fully deterministic.
import { lookupKey, interpolate, detectAppLang, dicts } from './index';

describe('lookupKey', () => {
	it('returns the value for the requested locale', () => {
		expect(lookupKey('nav.home', 'en')).toBe('Home');
		expect(lookupKey('nav.home', 'zh-Hant')).toBe('首頁');
		expect(lookupKey('nav.home', 'zh-Hans')).toBe('首页');
	});

	it('falls back to the en value when a key is missing in the requested locale', () => {
		// Force a hole in zh-Hant for this assertion, then restore it.
		const original = dicts['zh-Hant']['nav.home'];
		// Cast to a loose record so we can delete a key to simulate a missing translation.
		delete (dicts['zh-Hant'] as Record<string, string>)['nav.home'];
		expect(lookupKey('nav.home', 'zh-Hant')).toBe('Home');
		dicts['zh-Hant']['nav.home'] = original;
	});

	it('returns the raw key (never blank) when the key is missing in ALL dicts', () => {
		// lookupKey accepts `TranslationKey | string`; an unknown string returns itself.
		expect(lookupKey('does.not.exist', 'en')).toBe('does.not.exist');
		expect(lookupKey('does.not.exist', 'zh-Hant')).toBe('does.not.exist');
	});
});

describe('interpolate', () => {
	it('replaces {token} with the param value', () => {
		expect(interpolate('{count} tracks', { count: 3 })).toBe('3 tracks');
	});

	it('leaves unknown tokens intact', () => {
		expect(interpolate('{count} of {total}', { count: 2 })).toBe('2 of {total}');
	});

	it('returns the string unchanged when no params are given', () => {
		expect(interpolate('plain string')).toBe('plain string');
	});
});

describe('dictionaries', () => {
	// Phase 19 (Pitfall 5 / Wave 0): the parity + no-blank checks iterate ALL 15 locales (was
	// only en/zh-Hant/zh-Hans) so a key added only to en — e.g. the new menu.remix / toast.remixing
	// / menu.preparing — fails CI in every locale that is missing it, self-enforcing parity for
	// this phase AND all future ones.
	it('every locale exposes a key set IDENTICAL to en (all 15 locales)', () => {
		const enKeys = Object.keys(dicts.en).sort();
		for (const lang of Object.keys(dicts) as Array<keyof typeof dicts>) {
			expect(Object.keys(dicts[lang]).sort(), `${lang} key set must match en`).toEqual(enKeys);
		}
	});

	it('the Phase-19 keys are present in every locale', () => {
		for (const lang of Object.keys(dicts) as Array<keyof typeof dicts>) {
			for (const key of ['menu.remix', 'toast.remixing', 'menu.preparing'] as const) {
				expect(dicts[lang][key], `${lang}.${key} should exist`).toBeTruthy();
			}
		}
	});

	it('has no blank values in any locale (all 15 locales)', () => {
		for (const lang of Object.keys(dicts) as Array<keyof typeof dicts>) {
			for (const [key, val] of Object.entries(dicts[lang])) {
				expect(val, `${lang}.${key} should not be blank`).not.toBe('');
			}
		}
	});
});

describe('quick-260919-ebi dead strings', () => {
	// The parity test above only proves the 15 dictionaries AGREE. It stays perfectly green while
	// all 15 carry the SAME dead string — which is exactly the failure mode a settings sweep
	// produces. These assertions close that hole for the keys this task orphaned or introduced.
	//
	// Three descriptions were DELETED outright, because their live preview says the whole sentence
	// and a tooltip would only restate the picture:
	//   themeDesc        -> two cards painted in the two real palettes
	//   nowbarLyricsDesc -> two mini bars, artist line vs lyric line ("instead of the artist name")
	//   showSearchPillDesc -> the Home header mock with and without the pill
	//
	// The rest were SHORTENED and moved behind the SettingHint (i) disclosure rather than deleted,
	// because each carries something the mock cannot show — a trigger condition, a caveat, or a
	// distinction from a neighbouring setting. Keeping them PRESENT is the assertion: a later
	// "tidy-up" that deletes them would be deleting information, not clutter.
	const ABSENT = [
		'settings.themeDesc',
		'settings.nowbarLyricsDesc',
		'settings.showSearchPillDesc'
	] as const;
	const PRESENT = [
		'settings.optOn',
		'settings.appearanceMotion',
		'settings.aboutSetting',
		'settings.translateModeOffNote',
		'settings.translateModeOnNote',
		'settings.autoExpandDesc',
		'settings.showQualityTagDesc',
		'settings.showRandomizeDesc',
		'settings.tileDensityDesc'
	] as const;

	it('the deleted description keys are gone from EVERY locale, not just en', () => {
		for (const lang of Object.keys(dicts) as Array<keyof typeof dicts>) {
			for (const key of ABSENT) {
				expect(
					Object.prototype.hasOwnProperty.call(dicts[lang], key),
					`${lang}.${key} should be deleted — its live preview replaced it`
				).toBe(false);
			}
		}
	});

	it('the added + kept-short keys are present and non-blank in EVERY locale', () => {
		for (const lang of Object.keys(dicts) as Array<keyof typeof dicts>) {
			for (const key of PRESENT) {
				expect(dicts[lang][key], `${lang}.${key} should exist and be non-blank`).toBeTruthy();
			}
		}
	});

	it('no source file still references a deleted key', () => {
		// The dictionaries can be clean while a page still calls t('settings.themeDesc'), which
		// would render the raw key string on screen (lookupKey returns the key, never blank).
		const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
		const files: string[] = [];
		const walk = (dir: string) => {
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, e.name);
				if (e.isDirectory()) walk(full);
				// Skip tests: this file and settings-ui.test.ts NAME the deleted keys on purpose.
				else if (/\.(ts|svelte)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(full);
			}
		};
		walk(SRC);
		expect(files.length).toBeGreaterThan(100);
		for (const key of ABSENT) {
			const offenders = files.filter((f) => readFileSync(f, 'utf-8').includes(key));
			expect(offenders, `${key} is deleted but still referenced`).toEqual([]);
		}
	});

	it('the kept-short descriptions are actually SHORT in en (they moved into a tooltip)', () => {
		// The point of the disclosure was a quieter page. A 250-character paragraph behind an (i)
		// is still a paragraph; these were rewritten down, and this keeps them down.
		for (const key of ['settings.autoExpandDesc', 'settings.showQualityTagDesc', 'settings.showRandomizeDesc'] as const) {
			expect(dicts.en[key].length, `en.${key} should be a short line, not a paragraph`).toBeLessThan(90);
		}
	});
});

describe('quote-style convention (IN-01)', () => {
	// CLAUDE.md mandates DOUBLE quotes for every key AND value in src/lib/i18n/*.ts (a
	// manual, formatter-less convention — no tool enforces it). This test makes the
	// convention self-enforcing: any object-entry line whose KEY or VALUE opens with a
	// single quote fails CI. The regex only inspects entry lines (indent → quoted key →
	// `:` → quoted value), so apostrophes INSIDE double-quoted values (e.g. "l'artiste")
	// never false-positive, and comment / brace / blank lines are ignored.
	const I18N_DIR = dirname(fileURLToPath(import.meta.url));
	const localeFiles = readdirSync(I18N_DIR).filter(
		(f) => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.test.ts')
	);
	// Capture the KEY delimiter (group 1) and the VALUE delimiter (group 2). Keys are
	// dotted identifiers with no embedded quotes, so [^'"]* is a safe key body.
	const ENTRY = /^\s*(['"])[^'"]*\1\s*:\s*(['"])/;

	it('discovers every locale source file (>= 15 dicts)', () => {
		expect(localeFiles.length).toBeGreaterThanOrEqual(15);
	});

	for (const file of localeFiles) {
		it(`${file} uses double quotes for every key AND value`, () => {
			const src = readFileSync(join(I18N_DIR, file), 'utf-8');
			const offenders = src
				.split('\n')
				.map((line, i) => ({ line, n: i + 1 }))
				.filter(({ line }) => {
					const m = ENTRY.exec(line);
					return m !== null && (m[1] === "'" || m[2] === "'");
				})
				.map(({ n }) => n);
			expect(offenders, `${file} has single-quoted key/value line(s) at: ${offenders.join(', ')}`).toEqual([]);
		});
	}
});

describe('detectAppLang', () => {
	it('maps Traditional Chinese locales to zh-Hant', () => {
		expect(detectAppLang('zh-TW')).toBe('zh-Hant');
		expect(detectAppLang('zh-Hant')).toBe('zh-Hant');
	});

	it('maps Simplified Chinese locales to zh-Hans', () => {
		expect(detectAppLang('zh-CN')).toBe('zh-Hans');
		expect(detectAppLang('zh-Hans')).toBe('zh-Hans');
		expect(detectAppLang('zh')).toBe('zh-Hans');
	});

	it('maps non-Chinese and undefined to en', () => {
		expect(detectAppLang('en-US')).toBe('en');
		expect(detectAppLang(undefined)).toBe('en');
	});
});
