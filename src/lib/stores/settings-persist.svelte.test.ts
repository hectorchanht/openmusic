// Genuine load()/save() round-trip coverage for the settings singleton (quick-260808-vzu).
//
// WHY THIS IS A SEPARATE FILE from settings.svelte.test.ts: that file's cases depend on
// `browser === false` — it asserts applyTheme() is a no-op and that load() never runs, so the
// $state field initializers hold. Flipping `$app/environment` to browser=true here would break
// those cases (the mock is module-scoped, one value per test file). So the persistence path gets
// its own file with the browser-true harness (the library.svelte.test.ts:10-25 idiom).
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$app/environment', () => ({ browser: true }));

const memStore = new Map<string, string>();
const localStorageMock: Storage = {
	get length() {
		return memStore.size;
	},
	clear: () => memStore.clear(),
	getItem: (k: string) => (memStore.has(k) ? (memStore.get(k) as string) : null),
	key: (i: number) => Array.from(memStore.keys())[i] ?? null,
	removeItem: (k: string) => void memStore.delete(k),
	setItem: (k: string, v: string) => void memStore.set(k, String(v))
};
vi.stubGlobal('localStorage', localStorageMock);
// Settings-specific globals the library harness does not need: load()'s first-visit branch reads
// `navigator.language` (detectAppLang), and BOTH load() and save() end in applyTheme(), which
// writes CSS custom properties + dataset flags onto document.documentElement.
vi.stubGlobal('navigator', { language: 'en-US' });
vi.stubGlobal('document', { documentElement: { style: { setProperty: () => {} }, dataset: {} } });

const KEY = 'openmusic:settings:v1';

// `settings` is a module-scope singleton carrying a `loaded` once-guard, so every load case needs
// a FRESH module instance. Registered vi.mock factories survive resetModules.
async function freshSettings() {
	vi.resetModules();
	const { settings } = await import('./settings.svelte');
	return settings;
}

describe('settings persistence round-trip — shareIncludeTitle (quick-260808-vzu)', () => {
	beforeEach(() => memStore.clear());

	it('defaults to false when nothing is persisted', async () => {
		const settings = await freshSettings();
		settings.load();
		expect(settings.shareIncludeTitle).toBe(false);
	});

	it('an explicitly persisted `true` wins on load', async () => {
		memStore.set(KEY, JSON.stringify({ appLang: 'en', shareIncludeTitle: true }));
		const settings = await freshSettings();
		settings.load();
		expect(settings.shareIncludeTitle).toBe(true);
	});

	// T-vzu-01 (tampering): localStorage is user/extension-writable, so a non-boolean must fall
	// back to the defaults.ts const rather than being coerced truthy ('yes' is a truthy string).
	it('a corrupt non-boolean falls back to the default (false)', async () => {
		memStore.set(KEY, JSON.stringify({ appLang: 'en', shareIncludeTitle: 'yes' }));
		const settings = await freshSettings();
		settings.load();
		expect(settings.shareIncludeTitle).toBe(false);
	});

	it('save() writes the field into the persisted blob', async () => {
		const settings = await freshSettings();
		settings.shareIncludeTitle = true;
		settings.save();
		expect(JSON.parse(localStorage.getItem(KEY) as string).shareIncludeTitle).toBe(true);
	});

	// The 4th store touchpoint: without resetGeneral() the "reset group" button silently leaves
	// this setting stuck at the user's old value.
	it('resetGeneral() reverts the field AND the persisted blob', async () => {
		const settings = await freshSettings();
		settings.shareIncludeTitle = true;
		settings.save();
		settings.resetGeneral();
		expect(settings.shareIncludeTitle).toBe(false);
		expect(JSON.parse(localStorage.getItem(KEY) as string).shareIncludeTitle).toBe(false);
	});
});

// quick-260919-l9e. ORDER IS LOAD-BEARING here in a way shareIncludeTitle's boolean is not: this
// array is the left-to-right layout of the inline row buttons, so a round-trip that preserved the
// MEMBERS but not the ORDER would silently rearrange every song row on the next app open.
describe('settings persistence round-trip — rowActions (quick-260919-l9e)', () => {
	beforeEach(() => memStore.clear());

	// quick-260920-kxz REVERSED the default from ['like','download'] to []: a fresh row shows
	// neither button, and either is switched on from the Song rows editor. The persisted-list
	// cases below are UNCHANGED — only the "what does a fresh install get" assertions move.
	it('defaults to [] when nothing is persisted (quick-260920-kxz)', async () => {
		const settings = await freshSettings();
		settings.load();
		expect(settings.rowActions).toEqual([]);
	});

	it('a persisted subset wins on load', async () => {
		memStore.set(KEY, JSON.stringify({ appLang: 'en', rowActions: ['like'] }));
		const settings = await freshSettings();
		settings.load();
		expect(settings.rowActions).toEqual(['like']);
	});

	it('a persisted ORDER survives the round-trip (the array is a layout, not a set)', async () => {
		memStore.set(KEY, JSON.stringify({ appLang: 'en', rowActions: ['download', 'like'] }));
		const settings = await freshSettings();
		settings.load();
		expect(settings.rowActions).toEqual(['download', 'like']);
	});

	// An empty array is a legitimate user choice ("no inline buttons"), NOT corruption — the ⋮ is
	// unconditional, so there is no dead end to rescue the user from.
	it('a persisted EMPTY array is honoured, not replaced by the default', async () => {
		memStore.set(KEY, JSON.stringify({ appLang: 'en', rowActions: [] }));
		const settings = await freshSettings();
		settings.load();
		expect(settings.rowActions).toEqual([]);
	});

	// T-l9e-01 (tampering): localStorage is user/extension-writable.
	it.each([['like'], [null], [{}], [7]])('a corrupt non-array (%p) falls back to the default ([])', async (bad) => {
		memStore.set(KEY, JSON.stringify({ appLang: 'en', rowActions: bad }));
		const settings = await freshSettings();
		settings.load();
		expect(settings.rowActions).toEqual([]);
	});

	it('unknown and duplicate members are dropped rather than poisoning the order', async () => {
		memStore.set(KEY, JSON.stringify({ appLang: 'en', rowActions: ['like', 'bogus', 7, 'like', 'download'] }));
		const settings = await freshSettings();
		settings.load();
		expect(settings.rowActions).toEqual(['like', 'download']);
	});

	it('save() writes the field into the persisted blob', async () => {
		const settings = await freshSettings();
		settings.rowActions = ['download'];
		settings.save();
		expect(JSON.parse(localStorage.getItem(KEY) as string).rowActions).toEqual(['download']);
	});

	// quick-260920-kxz: the starting value has to be NON-empty now, or the case would pass
	// trivially against the new [] default without ever proving that reset touched the field.
	it('resetAppearance() reverts the field AND the persisted blob', async () => {
		const settings = await freshSettings();
		settings.rowActions = ['download', 'like'];
		settings.save();
		settings.resetAppearance();
		expect(settings.rowActions).toEqual([]);
		expect(JSON.parse(localStorage.getItem(KEY) as string).rowActions).toEqual([]);
	});
});

// quick-260920-kxz. fontScaleApp is the ROOT text multiplier — the one scale that can make the
// whole app, Settings included, unreadable if a bad value survives load(). So the clamp gets a
// case of its own on top of the usual default / round-trip / reset trio (T-kxz-01).
describe('settings persistence round-trip — fontScaleApp (quick-260920-kxz)', () => {
	beforeEach(() => memStore.clear());

	it('defaults to 100 when nothing is persisted', async () => {
		const settings = await freshSettings();
		settings.load();
		expect(settings.fontScaleApp).toBe(100);
	});

	it('a persisted value loads and save() writes it back into the blob', async () => {
		memStore.set(KEY, JSON.stringify({ appLang: 'en', fontScaleApp: 130 }));
		const settings = await freshSettings();
		settings.load();
		expect(settings.fontScaleApp).toBe(130);
		settings.save();
		expect(JSON.parse(localStorage.getItem(KEY) as string).fontScaleApp).toBe(130);
	});

	// T-kxz-01 (tampering): localStorage is user/extension-writable. An out-of-range value must
	// land on the bound, not on <html> — 250% would push Settings itself off the screen.
	it('an out-of-range value clamps to FONT_SCALE_MAX, and resetAppearance() returns it to 100', async () => {
		memStore.set(KEY, JSON.stringify({ appLang: 'en', fontScaleApp: 250 }));
		const settings = await freshSettings();
		const { FONT_SCALE_MAX } = await import('./settings.svelte');
		settings.load();
		expect(settings.fontScaleApp).toBe(FONT_SCALE_MAX);
		expect(FONT_SCALE_MAX).toBe(200);
		settings.resetAppearance();
		expect(settings.fontScaleApp).toBe(100);
		expect(JSON.parse(localStorage.getItem(KEY) as string).fontScaleApp).toBe(100);
	});
});

// 39-D-25: the three home-chart settings (Chart region / More regions / Genres). Region gets an
// ALLOWLIST guard on load (T-39-25) — a bare cast like bioLang would let 'cn' or garbage reach the
// chart fetch planner. The two lists get a TYPE guard only (T-39-26); resolveExtraRegions /
// resolveChartGenres clean the values at render.
describe('settings persistence round-trip — home chart settings (39-D-25)', () => {
	beforeEach(() => memStore.clear());

	const DEFAULT_GENRES = ['cantopop', 'mandopop', 'kpop', 'jpop', 'hiphop', 'rock', 'dance', 'rnb'];

	async function loadWith(blob: Record<string, unknown>) {
		memStore.set(KEY, JSON.stringify({ appLang: 'en', ...blob }));
		const settings = await freshSettings();
		settings.load();
		return settings;
	}

	it('homeChartRegion defaults to auto when nothing is persisted', async () => {
		const settings = await freshSettings();
		settings.load();
		expect(settings.homeChartRegion).toBe('auto');
	});

	it('homeExtraRegions defaults to [] when nothing is persisted', async () => {
		const settings = await freshSettings();
		settings.load();
		expect(settings.homeExtraRegions).toEqual([]);
	});

	it('homeChartGenres defaults to the 8 locked genres when nothing is persisted', async () => {
		const settings = await freshSettings();
		settings.load();
		expect(settings.homeChartGenres).toEqual(DEFAULT_GENRES);
	});

	it('a blob without the three keys (existing install) loads the defaults', async () => {
		const settings = await loadWith({ homeHidden: ['radio'] });
		expect(settings.homeChartRegion).toBe('auto');
		expect(settings.homeExtraRegions).toEqual([]);
		expect(settings.homeChartGenres).toEqual(DEFAULT_GENRES);
	});

	it('a persisted offered region (tw) wins on load', async () => {
		expect((await loadWith({ homeChartRegion: 'tw' })).homeChartRegion).toBe('tw');
	});

	it('a persisted cn region loads as auto (cn is not an offered region)', async () => {
		expect((await loadWith({ homeChartRegion: 'cn' })).homeChartRegion).toBe('auto');
	});

	it('a non-string region (42) loads as auto', async () => {
		expect((await loadWith({ homeChartRegion: 42 })).homeChartRegion).toBe('auto');
	});

	it('an upper-case region (HK) loads as auto — the allowlist is case-sensitive', async () => {
		expect((await loadWith({ homeChartRegion: 'HK' })).homeChartRegion).toBe('auto');
	});

	it('a garbage region string loads as auto', async () => {
		expect((await loadWith({ homeChartRegion: 'garbage' })).homeChartRegion).toBe('auto');
	});

	it('persisted homeExtraRegions load in their saved order', async () => {
		expect((await loadWith({ homeExtraRegions: ['tw', 'jp'] })).homeExtraRegions).toEqual(['tw', 'jp']);
	});

	it('a non-array homeExtraRegions falls back to []', async () => {
		expect((await loadWith({ homeExtraRegions: 'tw' })).homeExtraRegions).toEqual([]);
	});

	it('persisted homeChartGenres load in their saved order', async () => {
		expect((await loadWith({ homeChartGenres: ['rock', 'kpop'] })).homeChartGenres).toEqual(['rock', 'kpop']);
	});

	it('an explicit empty homeChartGenres [] is preserved (a real choice, not a corrupt value)', async () => {
		expect((await loadWith({ homeChartGenres: [] })).homeChartGenres).toEqual([]);
	});

	it('a non-array homeChartGenres ({}) falls back to the 8 defaults', async () => {
		expect((await loadWith({ homeChartGenres: {} })).homeChartGenres).toEqual(DEFAULT_GENRES);
	});

	it('save() writes all three keys into the persisted blob', async () => {
		const settings = await freshSettings();
		settings.homeChartRegion = 'jp';
		settings.homeExtraRegions = ['kr', 'us'];
		settings.homeChartGenres = ['jpop'];
		settings.save();
		const blob = JSON.parse(localStorage.getItem(KEY) as string);
		expect(blob.homeChartRegion).toBe('jp');
		expect(blob.homeExtraRegions).toEqual(['kr', 'us']);
		expect(blob.homeChartGenres).toEqual(['jpop']);
	});

	it('resetHome() reverts all three fields AND the persisted blob', async () => {
		const settings = await loadWith({ homeChartRegion: 'tw', homeExtraRegions: ['jp'], homeChartGenres: [] });
		settings.resetHome();
		expect(settings.homeChartRegion).toBe('auto');
		expect(settings.homeExtraRegions).toEqual([]);
		expect(settings.homeChartGenres).toEqual(DEFAULT_GENRES);
		const blob = JSON.parse(localStorage.getItem(KEY) as string);
		expect(blob.homeChartRegion).toBe('auto');
		expect(blob.homeExtraRegions).toEqual([]);
		expect(blob.homeChartGenres).toEqual(DEFAULT_GENRES);
	});

	// T-39-27: a version stamp written before the new shelves render would let anyone who saves in
	// between skip the one-time layout migration. Remove this test only together with the change
	// that wires migrateHomeLayout into load().
	it('does not write homeLayoutVersion yet (the one-time layout switch owns it)', async () => {
		const settings = await freshSettings();
		settings.load();
		settings.save();
		expect(Object.keys(JSON.parse(localStorage.getItem(KEY) as string))).not.toContain('homeLayoutVersion');
	});
});
