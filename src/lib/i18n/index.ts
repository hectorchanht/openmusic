// Lightweight runes-based i18n for UI chrome (NO external dependency).
//
// Design:
//  - `en` is the source/reference dictionary; its keys define `TranslationKey`,
//    so a missing key is a compile error at every `t()` call site.
//  - PURE helpers (`lookupKey`, `interpolate`, `detectAppLang`, `getDict`) are
//    importable WITHOUT touching `$state` — the i18n unit test drives these in the
//    node Vitest project (which can't compile runes).
//  - `t()` is the ONLY reactive wrapper: it reads `settings.appLang` ($state) on
//    every call, so any template / `$derived` re-renders when the language changes
//    (same model as names.dn + rev). No page reload.
import en from './en';
import { settings } from '$lib/stores/settings.svelte';
import { dictSignal } from './dict-signal.svelte';

export type AppLang =
	| 'en'
	| 'zh-Hant'
	| 'zh-Hans'
	| 'es'
	| 'fr'
	| 'de'
	| 'pt'
	| 'it'
	| 'ru'
	| 'tr'
	| 'ar'
	| 'hi'
	| 'id'
	| 'vi'
	| 'th';
export type TranslationKey = keyof typeof en;
export type Dict = Record<TranslationKey, string>;

type LocaleModule = { default: Dict };

// quick-261006-i18n: per-locale dynamic imports. Each non-English locale becomes
// its own chunk, fetched on demand via ensureLocale(). `en` stays statically
// imported: it is the TranslationKey source AND the runtime fallback, and it is
// small next to the other 14 dictionaries (the old static import block pulled
// ~600 KB of dictionaries into the initial bundle for every user).
const localeLoaders: { [L in AppLang]?: () => Promise<LocaleModule> } = {
	'zh-Hant': () => import('./zh-Hant'),
	'zh-Hans': () => import('./zh-Hans'),
	es: () => import('./es'),
	fr: () => import('./fr'),
	de: () => import('./de'),
	pt: () => import('./pt'),
	it: () => import('./it'),
	ru: () => import('./ru'),
	tr: () => import('./tr'),
	ar: () => import('./ar'),
	hi: () => import('./hi'),
	id: () => import('./id'),
	vi: () => import('./vi'),
	th: () => import('./th')
};

// Dictionaries actually in memory. `en` ships in the initial bundle; every other
// locale is added here by ensureLocale() and cached for the session.
const loadedDicts = new Map<AppLang, Dict>([['en', en]]);
const inflight = new Map<AppLang, Promise<void>>();

/**
 * Load a locale's dictionary chunk (no-op when already loaded; concurrent callers
 * share one import). Never throws: a failed chunk load just leaves the `en`
 * fallback in place, so a flaky network can never blank the UI.
 *
 * Callers: the app layout fires this for settings.appLang at boot; the language
 * picker fires it on switch. t() falls back to `en` until the chunk lands, then
 * re-renders via dictSignal.
 */
export function ensureLocale(lang: AppLang): Promise<void> {
	if (loadedDicts.has(lang)) return Promise.resolve();
	const existing = inflight.get(lang);
	if (existing) return existing;
	const loader = localeLoaders[lang];
	if (!loader) return Promise.resolve(); // 'en' or unknown — nothing to fetch
	const p = loader()
		.then((mod) => {
			loadedDicts.set(lang, mod.default);
			dictSignal.bump();
		})
		.catch(() => {
			// Never-throw by design (see above).
		})
		.finally(() => {
			inflight.delete(lang);
		});
	inflight.set(lang, p);
	return p;
}

/** Synchronous read of the best dictionary available right now: loaded locale → en. */
export function getDict(lang: AppLang): Dict {
	return loadedDicts.get(lang) ?? en;
}

/**
 * Test/SSR helper: load every locale and return the full table. The app itself
 * never calls this (it would defeat the lazy loading); the parity tests do.
 */
export async function loadAllLocales(): Promise<Record<AppLang, Dict>> {
	await Promise.all((Object.keys(localeLoaders) as AppLang[]).map((l) => ensureLocale(l)));
	const table = {} as Record<AppLang, Dict>;
	for (const [lang, dict] of loadedDicts) table[lang] = dict;
	return table;
}

/** Replace `{token}` occurrences with params[token]; leave unknown tokens intact. Pure. */
export function interpolate(str: string, params?: Record<string, string | number>): string {
	if (!params) return str;
	return str.replace(/\{(\w+)\}/g, (whole, token: string) =>
		Object.prototype.hasOwnProperty.call(params, token) ? String(params[token]) : whole
	);
}

/** Pure resolver: loaded dict[lang][key] → en[key] → raw key (NEVER blank). */
export function lookupKey(key: TranslationKey | string, lang: AppLang): string {
	const inLang = getDict(lang)[key as TranslationKey];
	if (inLang !== undefined) return inLang;
	const inEn = en[key as TranslationKey];
	if (inEn !== undefined) return inEn;
	return key;
}

/**
 * Map a navigator-style language string to an AppLang. Pure + SSR-safe
 * (takes the string as an argument; no `navigator` access here).
 *   zh-TW / zh-Hant → zh-Hant; zh-CN / zh-Hans / zh → zh-Hans; else en.
 */
export function detectAppLang(navLang?: string): AppLang {
	if (!navLang) return 'en';
	const l = navLang.toLowerCase();
	if (l.startsWith('zh')) {
		if (l.includes('tw') || l.includes('hant') || l.includes('hk') || l.includes('mo')) return 'zh-Hant';
		return 'zh-Hans';
	}
	// Match the 2-letter prefix against the supported world locales (pt-BR → pt, etc.).
	const two = l.slice(0, 2);
	const supported: AppLang[] = ['es', 'fr', 'de', 'pt', 'it', 'ru', 'tr', 'ar', 'hi', 'id', 'vi', 'th'];
	if ((supported as string[]).includes(two)) return two as AppLang;
	return 'en';
}

/**
 * Reactive translate. Reads `settings.appLang` ($state) on EVERY call so callers
 * re-render on language change. Also reads `dictSignal.version` so callers
 * re-render a second time when the newly-selected locale's chunk ARRIVES
 * (quick-261006-i18n): until then lookupKey serves the in-bundle `en` fallback.
 * Returns interpolate(lookupKey(...), params).
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
	void dictSignal.version; // subscribe: repaint when a locale chunk lands
	return interpolate(lookupKey(key, settings.appLang), params);
}

/**
 * Tolerant reactive translate for store-emitted strings that MAY be a TranslationKey or MAY be an
 * arbitrary runtime message (WR-07). `player.error` is usually an i18n key (e.g.
 * 'toast.playbackStopped') but the catch-all in play() can also store a raw exception message.
 * lookupKey already falls back to the raw string for an unknown key, so a known key is localized
 * and anything else renders verbatim. Reads settings.appLang ($state) so callers re-render on a
 * language switch, exactly like t(). Also subscribes to dictSignal.version so a late-arriving
 * locale chunk repaints (quick-261006-i18n).
 */
export function tMaybeKey(s: string, params?: Record<string, string | number>): string {
	void dictSignal.version; // subscribe: repaint when a locale chunk lands
	return interpolate(lookupKey(s, settings.appLang), params);
}
