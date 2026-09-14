// Round-trip coverage: export → import → simulated cold reload → the REAL stores' load() (35-D-08,
// 35-D-13).
//
// WHY THIS IS A SEPARATE FILE from backup-logic.test.ts: that file is pure — no mocks, no globals,
// because nothing in the codec reaches for one. The stores do: every load() early-returns unless
// `browser` is true, and the mock is module-scoped (one value per test file). So the store-level
// proof gets its own file with the browser-true harness (the settings-persist.svelte.test.ts:1-8
// idiom), and it carries the `.svelte.test.ts` suffix because the runes singletons it imports must
// go through the Svelte transform under the single node Vitest project.
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$app/environment', () => ({ browser: true }));

import { HISTORY_KEY } from '$lib/history/history-logic';
import { SEARCH_HISTORY_KEY } from '$lib/search/search-history-logic';
import { LIBRARY_KEY, SETTINGS_KEY, UNDO_KEY, applyEnvelope, buildEnvelope, serializeEnvelope, storageKeys, undoImport, validateEnvelope } from './backup-logic';

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

// FIRST sessionStorage use in the repo — the rollback snapshot lives here (35-D-09) so it cannot
// compete with the live keys for the persistent-store quota. Same `Storage` interface, so the stub
// above copies verbatim over a second Map.
const sessionMem = new Map<string, string>();
const sessionStorageMock: Storage = {
	get length() {
		return sessionMem.size;
	},
	clear: () => sessionMem.clear(),
	getItem: (k: string) => (sessionMem.has(k) ? (sessionMem.get(k) as string) : null),
	key: (i: number) => Array.from(sessionMem.keys())[i] ?? null,
	removeItem: (k: string) => void sessionMem.delete(k),
	setItem: (k: string, v: string) => void sessionMem.set(k, String(v))
};
vi.stubGlobal('sessionStorage', sessionStorageMock);

// The settings store needs both: load()'s first-visit branch reads `navigator.language`, and both
// load() and save() end in applyTheme(), which writes onto document.documentElement.
vi.stubGlobal('navigator', { language: 'en-US' });
vi.stubGlobal('document', { documentElement: { style: { setProperty: () => {} }, dataset: {} } });

const NAME_TR_KEY = 'openmusic:name-tr:v2:zh-Hant';
const PLAYER_SENTINEL = JSON.stringify({ v: 1, current: { uid: 'kuwo:sentinel' } });
const DIAG_SENTINEL = JSON.stringify('device-local-upload-token');

const LIKED = [
	{ uid: 'kuwo:1', source: 'kuwo', songid: '1', title: '有人', artist: '林宥嘉', songMid: 'MID-1', duration: 241 },
	{ uid: 'qq:2', source: 'qq', songid: '2', title: 'Bohemian Rhapsody', artist: 'Queen', songMid: 'MID-2', duration: 355 }
];
const PLAYLISTS = [{ id: 'p1', name: 'Late night', tracks: [LIKED[0]] }];
const DOWNLOADS = [LIKED[1]];
const HISTORY = [
	{ uid: 'kuwo:1', source: 'kuwo', songid: '1', title: '有人', artist: '林宥嘉', album: '', cover: null, quality: null, qualityLabel: null, keyword: '', displayIndex: 0 },
	{ uid: 'qq:2', source: 'qq', songid: '2', title: 'Bohemian Rhapsody', artist: 'Queen', album: '', cover: null, quality: null, qualityLabel: null, keyword: '', displayIndex: 1 }
];
const SETTINGS = { appLang: 'zh-Hant', theme: 'dark', showQualityTag: false };
const NAME_TR = JSON.stringify({ Foo: '福' });

/** Seed the source device: the five restorable key families plus two keys that must survive an
 *  import untouched (the player queue, 35-D-02, and the diag upload token). */
function seedSourceDevice() {
	memStore.set(LIBRARY_KEY, JSON.stringify({ liked: LIKED, playlists: PLAYLISTS, downloads: DOWNLOADS, favArtists: ['A'] }));
	memStore.set(HISTORY_KEY, JSON.stringify(HISTORY));
	memStore.set(SEARCH_HISTORY_KEY, JSON.stringify([{ query: 'x', ts: 1 }]));
	memStore.set(SETTINGS_KEY, JSON.stringify(SETTINGS));
	memStore.set(NAME_TR_KEY, NAME_TR);
	memStore.set('openmusic:player:v1', PLAYER_SENTINEL);
	memStore.set('openmusic:diag:v1', DIAG_SENTINEL);
}

/** Export the seeded state, wipe to a "fresh device" holding only the two sentinels, then import.
 *  Returns the exact pre-import contents so undo can be checked byte-for-byte. */
function exportWipeImport(): Record<string, string> {
	const text = serializeEnvelope(buildEnvelope((k) => localStorage.getItem(k), storageKeys(localStorage)));
	const res = validateEnvelope(text);
	expect(res.ok).toBe(true);
	if (!res.ok) throw new Error('unreachable — asserted ok above');
	memStore.clear();
	memStore.set('openmusic:player:v1', PLAYER_SENTINEL);
	memStore.set('openmusic:diag:v1', DIAG_SENTINEL);
	const freshDevice = Object.fromEntries(memStore);
	expect(applyEnvelope(res.envelope, localStorage, sessionStorage)).toBe('ok');
	return freshDevice;
}

describe('backup round-trip through the real stores', () => {
	beforeEach(() => {
		memStore.clear();
		sessionMem.clear();
	});

	it('exports then restores to identical store state', async () => {
		seedSourceDevice();
		exportWipeImport();

		// 35-D-13: the app forces a full reload so every singleton re-runs its existing load() cold.
		// resetModules is that reload — the once-guards and field initializers all start over.
		vi.resetModules();
		const { library } = await import('$lib/stores/library.svelte');
		const { history } = await import('$lib/stores/history.svelte');
		const { searchHistory } = await import('$lib/stores/searchHistory.svelte');
		const { settings } = await import('$lib/stores/settings.svelte');
		library.load();
		history.load();
		searchHistory.load();
		settings.load();

		expect(library.liked).toEqual(LIKED);
		expect(library.playlists[0].tracks).toHaveLength(1);
		expect(library.downloads).toHaveLength(1);
		expect(library.favArtists).toEqual(['A']);
		expect(history.entries).toHaveLength(2);
		expect(searchHistory.entries[0].query).toBe('x');
		expect(settings.appLang).toBe('zh-Hant');
		expect(settings.showQualityTag).toBe(false);
		// The name-translation cache is asserted as raw bytes: its owning store pulls in the
		// translate + zh-convert chain, which this node test has no business booting.
		expect(localStorage.getItem(NAME_TR_KEY)).toBe(NAME_TR);
		// 35-D-02 / secret: neither sentinel was touched by the import.
		expect(localStorage.getItem('openmusic:player:v1')).toBe(PLAYER_SENTINEL);
		expect(localStorage.getItem('openmusic:diag:v1')).toBe(DIAG_SENTINEL);
	});

	it('undo restores the pre-import bytes', () => {
		seedSourceDevice();
		const freshDevice = exportWipeImport();

		expect(undoImport(localStorage, sessionStorage)).toBe('ok');
		expect(Object.fromEntries(memStore)).toEqual(freshDevice);
		expect(sessionStorage.getItem(UNDO_KEY)).toBeNull();
	});
});
