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

	it("defaults to ['like','download'] when nothing is persisted", async () => {
		const settings = await freshSettings();
		settings.load();
		expect(settings.rowActions).toEqual(['like', 'download']);
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
	it.each([['like'], [null], [{}], [7]])('a corrupt non-array (%p) falls back to the default', async (bad) => {
		memStore.set(KEY, JSON.stringify({ appLang: 'en', rowActions: bad }));
		const settings = await freshSettings();
		settings.load();
		expect(settings.rowActions).toEqual(['like', 'download']);
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

	it('resetAppearance() reverts the field AND the persisted blob', async () => {
		const settings = await freshSettings();
		settings.rowActions = [];
		settings.save();
		settings.resetAppearance();
		expect(settings.rowActions).toEqual(['like', 'download']);
		expect(JSON.parse(localStorage.getItem(KEY) as string).rowActions).toEqual(['like', 'download']);
	});
});
