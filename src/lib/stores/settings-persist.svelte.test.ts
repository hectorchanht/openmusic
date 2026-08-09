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
