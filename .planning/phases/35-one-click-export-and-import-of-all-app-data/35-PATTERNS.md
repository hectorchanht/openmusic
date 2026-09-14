# Phase 35: One-click export and import of all app data — Pattern Map

**Mapped:** 2026-09-13
**Files analyzed:** 9 (3 new source, 4 new tests, 2 modified surfaces + package.json)
**Analogs found:** 8 / 9 (one genuinely new: `backup-io.ts` native branch has no exact analog)

Every excerpt below is verbatim from this repo at the cited `file:line`. Where an expected analog does **not** exist it is called out under "No Analog Found" — do not invent one.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/backup/backup-logic.ts` | pure logic module (serialize/parse codec) | transform (untrusted string → typed result) | `src/lib/stores/player-persist.ts` + `src/lib/search/search-history-logic.ts` | **exact** |
| `src/lib/backup/sweep.ts` | service (orchestration over `downloadTrack`) | batch / sequential | `src/routes/(app)/album/[name]/+page.svelte:420-437` (`downloadAlbum`) | role-match (loop shape is exact; it lives in a page today) |
| `src/lib/services/backup-io.ts` | service (platform seam) | file-I/O | `src/lib/services/blob-store.ts` (split) + `src/lib/services/download-save.ts` (web half, never-throw boolean) | **exact** for web half, **partial** for native half |
| `src/lib/backup/backup-logic.test.ts` | test (pure) | — | `src/lib/diagnostics/action-log-logic.test.ts` | **exact** |
| `src/lib/backup/backup-roundtrip.svelte.test.ts` | test (browser:true + memStore) | — | `src/lib/stores/settings-persist.svelte.test.ts:1-37` | **exact** |
| `src/lib/backup/sweep.test.ts` | test (mocked services) | — | `src/lib/services/download-save.test.ts` (mock/stub idiom) | role-match |
| `src/lib/services/backup-io.test.ts` | test (injected fake `doc`) | — | `src/lib/services/download-save.test.ts:13-31` | **exact** |
| `src/routes/(app)/settings/data/+page.svelte` | route page (modified) | request-response (button → action → flash) | **itself** — the six existing buttons are the analog | **exact** |
| `src/lib/i18n/*.ts` ×15 | config dictionary (modified) | — | `src/lib/i18n/en.ts` + `zh-Hant.ts` | **exact** |
| `package.json` | config (modified) | — | existing `@capacitor/*` entries | **exact** |

**Naming verdict** (per Conventions below): both new source files land in kebab-case directories (`$lib/backup/`, `$lib/services/`), so `backup-logic.ts` / `sweep.ts` / `backup-io.ts` are correct and uncontested. Neither is a runes file, so neither gets `.svelte.ts`.

---

## Pattern Assignments

### `src/lib/backup/backup-logic.ts` (pure logic, transform)

**Analog:** `src/lib/stores/player-persist.ts` (module shape + never-throw parse) and `src/lib/search/search-history-logic.ts` (per-entry validation + key const).

**Module header pattern** — `src/lib/stores/player-persist.ts:1-18`. Copy this structure (purity declaration → why it exists → type-only import note):

```ts
// PURE persistence codec — NO runes, NO `$state`, NO `$app/environment`, NEVER throws.
//
// This module is the node-Vitest-testable core of the player's localStorage persistence.
// The runes player store (src/lib/stores/player.svelte.ts) merely WRAPS these helpers
// behind its SSR guard + try/catch + removeItem branch + ... — exactly as that store already
// wraps media-session.ts and sleep-timer.ts (the established "extract a pure helper module the
// runes store thinly wraps" precedent). The `Track` import below is TYPE-ONLY — erased at
// runtime, so there is ZERO runtime coupling to the source layer and, crucially, this
// module does NOT import player.svelte.ts (that would be a circular import — forbidden).
import type { Track } from '$lib/sources/types';
```

Same header opener at `src/lib/search/search-history-logic.ts:1-5` and `src/lib/history/history-logic.ts:1-8`. **Three files, one shape — match it.**

**Exported key constant pattern** — `src/lib/stores/player-persist.ts:20-25` and `src/lib/search/search-history-logic.ts:12-17`:

```ts
/**
 * Load-bearing localStorage key — the persisted player shape `openmusic:player:v1`.
 * An existing user's saved state lives under this exact key; it MUST NOT change (bumping
 * it would silently drop every user's restore).
 */
export const STATE_KEY = 'openmusic:player:v1';
```

```ts
/** Most-recent-first cap. A mobile suggestion list wants a short cap (shorter than the
 *  play-history cap of 50). The persisted list never grows beyond this. */
export const SEARCH_HISTORY_CAP = 12;

/** Versioned localStorage key — DISTINCT from the play-history `openmusic:history:v1`. */
export const SEARCH_HISTORY_KEY = 'openmusic:search-history:v1';
```

`backup-logic.ts` **may import** `HISTORY_KEY` from `$lib/history/history-logic` (`:14`) and `SEARCH_HISTORY_KEY` from `$lib/search/search-history-logic` (`:17`) — both pure. It must **own local copies** of `LIBRARY_KEY` / `SETTINGS_KEY` / `NAME_TR_PREFIX`, because those live in `.svelte.ts` runes files (see "Do Not Import" below).

**Never-throw parse pattern (bare sentinel)** — `src/lib/stores/player-persist.ts:120-159`. This is the doc-comment + `try`/`catch` structure to copy; the phase's `validateEnvelope` differs only in returning a discriminated union instead of `null` (D-11 needs the reason):

```ts
/**
 * Parse + reshape a persisted localStorage string into a restore payload. NEVER throws:
 * every failure mode degrades to null (the store early-returns on null, exactly as it did
 * across its old `!raw` / JSON.parse-catch / `!current.uid` early-returns — all three
 * collapse into this single null sentinel with identical observable behavior).
 *
 * Returns null when: raw is null/empty; JSON.parse throws (corrupt / tampered blob); or the
 * payload has no `current.uid` (the null-sentinel gate). ...
 */
export function parsePlayerState(raw: string | null): RestoredState | null {
	if (!raw) return null;
	let payload: { v?: number; current?: Partial<Track> | null; /* … */ } | null = null;
	try {
		payload = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!payload?.current?.uid) return null;
	return {
		current: reshape(payload.current as Partial<Track>),
		queue: (payload.queue ?? []).map(reshape),
		seek: Math.max(0, Number(payload.currentTime) || 0),
		shuffle: !!payload.shuffle,
		// D-11: 2-state migration — only an explicit 'one' is kept; any persisted repeat-all
		// (from a prior tri-state session), missing, or tampered value collapses to safe 'off'.
		repeatMode: payload.repeatMode === 'one' ? 'one' : 'off',
		// quick-260712-hm9: only a real string uid survives; absent (legacy blob) or garbage → null.
		anchorUid: typeof payload.upNextAnchorUid === 'string' ? payload.upNextAnchorUid : null
	};
}
```

Note the **comment density on every coercion line** — each guard names its decision ref and the tampering case it defends against. The new validator's per-key `Array.isArray` guards must carry the same (`35-D-10`, "Pitfall 7: library.load() does not guard these").

**Per-entry validation pattern (the one the importer should imitate for lists)** — `src/lib/search/search-history-logic.ts:54-76`:

```ts
/**
 * Parse a persisted search-history blob. Returns [] on null / parse error / non-array
 * (T-14-03 tampering: a corrupt store must never crash the app — mirrors parseHistory).
 */
export function parseSearchHistory(raw: string | null): SearchHistoryEntry[] {
	if (raw == null) return [];
	try {
		const v = JSON.parse(raw);
		if (!Array.isArray(v)) return [];
		// CR-01: validate per-ENTRY shape, not just that the blob is an array. A corrupt
		// store containing null / a number / an object without a string `query` would make
		// recordQuery's `.filter(e => e.query.toLowerCase()...)` throw — and add() runs
		// BEFORE run()'s try block, so an uncaught throw breaks the whole search form.
		return (v as unknown[]).filter(
			(e): e is SearchHistoryEntry =>
				e != null &&
				typeof (e as Partial<SearchHistoryEntry>).query === 'string' &&
				typeof (e as Partial<SearchHistoryEntry>).ts === 'number'
		);
	} catch {
		return [];
	}
}
```

> **Divergence the planner must state explicitly:** `parseSearchHistory` **filters** bad entries and keeps going. `validateEnvelope` must **reject the whole file** (D-10 atomicity). Same guard style, opposite disposition. Say so in a comment so nobody "fixes" it to match.

**Injectable-dependency trick (keeps `buildEnvelope` pure + testable without `vi.stubGlobal`)** — `src/lib/services/download-save.ts:18-28`:

```ts
/**
 * Save a blob to the user's Downloads via a hidden `<a download>` click. Returns `true` on a
 * successful click, `false` if the DOM / object-URL API is unavailable or the anchor throws — it
 * NEVER throws and NEVER navigates. `doc` is injectable (default `globalThis.document`) so callers
 * on the web pass nothing and the node test drives a fake document.
 */
export function saveBlobToDisk(
	blob: Blob,
	filename: string,
	doc: Document | undefined = globalThis.document
): boolean {
```

Mirror as `buildEnvelope(read: (k: string) => string | null, allKeys: readonly string[])`.

---

### `src/lib/services/backup-io.ts` (service, file-I/O, platform-split)

**Analog:** `src/lib/services/blob-store.ts` — the canonical two-branch service in this repo.

**Contract header (never-throws + SSR/platform posture)** — `blob-store.ts:7-16`. `backup-io.ts` must open with the same kind of block:

```ts
// Posture (matches the rest of the lib/services NEVER-THROWS pattern):
//  - Every method is SSR-guarded: on the server / unavailable IDB the API resolves to a
//    no-op / null. Callers always see a plain Promise — they cannot fail because IDB is
//    missing. A miss → null → caller uses the CDN URL transparently.
//  - The DB open is lazy + cached. A failed open caches the failure and resolves to null for
//    every subsequent call (no perpetual reconnect loop).
```

**Import block for a platform-split service** — `blob-store.ts:18-22` (this is the exact import vocabulary `backup-io.ts` needs, minus `write_blob`/`MediaStoreSaver`, plus `Share` and `Encoding`):

```ts
import { browser } from '$app/environment';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import write_blob from 'capacitor-blob-writer';
import { MediaStoreSaver } from './media-store';
```

**The split itself — one `isNativePlatform()` branch at the top of the exported function, native helper as a private module-level `async function native*`** — `blob-store.ts:286-300`:

```ts
export async function has(uid: string): Promise<boolean> {
	if (!uid) return false;
	if (Capacitor.isNativePlatform()) return nativeHas(uid);
	const db = await openDb();
	if (!db) return false;
	return new Promise<boolean>((resolve) => {
		try {
			const req = txStore(db, 'readonly').getKey(uid);
			req.onsuccess = () => resolve(req.result !== undefined);
			req.onerror = () => resolve(false);
		} catch {
			resolve(false);
		}
	});
}
```

**The private native helper — swallow everything, return the same sentinel type as the web branch** — `blob-store.ts:155-166`:

```ts
// quick-260913-jq4: existence WITHOUT reading the file. `stat` returns the size, so the same
// 31-D-13 floor applies — a truncated/empty on-disk copy reports absent on native exactly as it
// reads as a miss on web, and the two platforms can never disagree about what "downloaded" means.
async function nativeHas(uid: string): Promise<boolean> {
	try {
		const { size } = await Filesystem.stat({ path: nativePath(uid), directory: NATIVE_DIR });
		return typeof size === 'number' && size >= MIN_BLOB_BYTES;
	} catch {
		// not-found / any failure: absent (parity with nativeGet's null).
		return false;
	}
}
```

**Namespace export at the bottom** — `blob-store.ts:322`:

```ts
export const blobStore = { put, get, has, del };
```

> CLAUDE.md forbids default exports in `$lib`. `blob-store.ts` uses a namespace object; `download-save.ts` uses a single named export (and its test asserts `Object.keys(mod)).toEqual(['saveBlobToDisk'])`, `download-save.test.ts:36`). **For a two-function `backup-io.ts`, plain named exports match `download-save.ts` more closely — pick that.**

**Web half — do NOT rewrite it, call it** — `src/lib/services/download-save.ts:40-55`:

```ts
	let href: string | null = null;
	try {
		const a = doc.createElement('a');
		href = urlApi.createObjectURL(blob);
		a.download = filename;
		a.href = href;
		a.click();
		return true;
	} catch {
		// DL-BUG-01: a failure degrades to `false` — the caller shows a toast and the song stays in
		// the library Downloads list (re-streams on tap). It does NOT navigate anywhere.
		return false;
	} finally {
		// Revoke on every exit (success or throw) so the object URL never leaks.
		if (href && typeof urlApi.revokeObjectURL === 'function') urlApi.revokeObjectURL(href);
	}
```

That body carries a **grep-enforced guardrail** (`download-save.ts:13-16`): the co-located test greps this function's source for a new-tab/save-picker branch. `backup-io.ts`'s web branch calls `saveBlobToDisk(...)` — it must not reimplement any of the above.

---

### `src/lib/backup/sweep.ts` (service, batch/sequential)

**Analog:** `src/routes/(app)/album/[name]/+page.svelte:420-437` — the only sequential-pacing precedent in the repo.

```ts
	async function downloadAlbum() {
		if (!tracks.length || busyAction === 'download') return;
		busyAction = 'download';
		globalToast.show(t('toast.preparingDownload'));
		try {
			const resolved = await resolveAllCached();
			let saved = 0;
			for (const tr of resolved) {
				const res = await downloadTrack(tr, { persist: false });
				if (res === 'saved') saved++;
				// Stagger so browser doesn't squash concurrent downloads / hit per-origin caps.
				await new Promise((r) => setTimeout(r, 250));
			}
			globalToast.show(saved > 0 ? t('toast.downloaded') : resolved.length ? t('toast.noAudio') : t('album.unplayable'));
		} finally {
			busyAction = null;
		}
	}
```

Copy: the re-entrancy guard (`if (busy) return`), `for … await`, the 250 ms stagger **with its comment**, the counter, and `finally { busy = null }`. The sweep adds three things the album loop does not have: a **stop flag** checked at the top of each iteration, a **`blobStore.has` re-probe** per iteration (idempotence/resumability), and `{ save: false }` instead of `{ persist: false }`.

> **`api-fetch-flood-freeze` flag (load-bearing).** `download-track.ts:106-109` fetches audio bytes with a **raw `fetch`**, deliberately outside the `apiFetch` governor (`MAX_CONCURRENT_REQUESTS = 8`). The governor protects only the *resolve* half (`ensureTrackDetails`). A parallel 200-song sweep is exactly the incident shape. **Concurrency 1, non-negotiable.** Do not add a global cap to the media path (out of scope, and the raw-fetch decision is documented as deliberate).

**`downloadTrack` signature + the `save:false` mode** — `src/lib/services/download-track.ts:54-68`:

```ts
/**
 * Download ONE song: resolve→addDownload→fetch→(persist)→save. Isolation-safe, never-throws,
 * never-navigates. `opts.persist` defaults TRUE; `persist:false` (the album bulk path) skips
 * `blobStore.put` — matching album's current behavior (no offline blob / no native public copy) —
 * while addDownload + saveBlobToDisk + begin/end still run.
 *
 * 31-D-12: `opts.save` also defaults TRUE; `save:false` is the SILENT background repair mode — the
 * offline blob is re-persisted and the library record refreshed, but no `<a download>` click fires.
 * The repair is triggered by a playback error the user never asked about, so popping a file-save
 * dialog mid-song would itself be the bug.
 */
export async function downloadTrack(
	track: Track,
	opts?: { persist?: boolean; save?: boolean }
): Promise<DownloadResult> {
```

`export type DownloadResult = 'saved' | 'no-audio' | 'failed';` — `download-track.ts:39`.
The `save:false` early return is `download-track.ts:138-141`. **The sweep uses `{ save: false }`, NOT `{ persist: false }`** — `persist:false` skips `blobStore.put`, which is the exact thing the sweep is trying to restore.

**`blobStore.has` signature + its own header** — `src/lib/services/blob-store.ts:269-288`:

```ts
/**
 * quick-260913-jq4: "is there an offline copy for `uid`?" — WITHOUT materializing it.
 *
 * WHY THIS IS NOT `get(uid) !== null`. The UI asks this question on every menu open, and a stored
 * blob is a whole audio file (a lossless track is tens of MB). `get` would pull those bytes into
 * memory just to compare against null. `getKey` answers from the index alone.
 *
 * WHY THE UI ASKS IT AT ALL. `library.isDownloaded` is membership in the downloads REFERENCE list,
 * and `addDownload` deliberately runs BEFORE the fetch (DL-BUG-01: a failed download still leaves
 * the song re-streamable). ...
 */
export async function has(uid: string): Promise<boolean> {
```

Contrast with the list-membership answer the rest of the UI uses — `src/lib/stores/library.svelte.ts:201-203`:

```ts
	isDownloaded(uid: string): boolean {
		return this.downloads.some((t) => t.uid === uid);
	}
```

D-07 says the Data page uses `blobStore.has`. **Do not migrate `DownloadControl.svelte` in this phase.**

---

### `src/routes/(app)/settings/data/+page.svelte` (route page, modified)

**Analog: itself.** The six existing buttons define the vocabulary exactly; the three new ones must be indistinguishable.

**Script-block state + flash** — `:15-24`:

```svelte
	let msg = $state('');
	let counts = $state({ liked: 0, playlists: 0, downloads: 0 });

	onMount(() => {
		settings.load();
		library.load();
		counts = { liked: library.liked.length, playlists: library.playlists.length, downloads: library.downloads.length };
	});

	function flash(m: string) { msg = m; setTimeout(() => (msg = ''), 1800); }
```

**Direct-localStorage + try/catch action** — `:26-33` (this is the precedent for the new code touching `localStorage` straight from the page, and the `catch { /* */ }` comment style):

```svelte
	function clearPicks() {
		try { localStorage.removeItem(TOP_PICKS_KEY); } catch { /* */ }
		try { localStorage.removeItem(HOME_LIBRARY_KEY); } catch { /* */ } // hhd: also reset library shelves
		flash(t('settings.picksCleared'));
	}
	function clearSearchHistory() { try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch { /* */ } flash(t('settings.searchHistoryCleared')); }
```

**Destructive-confirm pattern (D-08's dialog)** — `:35-41`:

```svelte
	function clearLibrary() {
		if (confirm(t('settings.clearLibraryConfirm'))) {
			library.clearAll();
			counts = { liked: 0, playlists: 0, downloads: 0 };
			flash(t('settings.libraryCleared'));
		}
	}
```

**Button markup — `.item` + icon + `use:tapBounce` + a `.hint` paragraph underneath** — `:53-64`:

```svelte
	<button class="item" onclick={clearPicks} use:tapBounce><RefreshCw size={18} /> {t('settings.clearPicks')}</button>
	<p class="hint">{t('settings.clearPicksDesc')}</p>
	…
	<button class="item danger" onclick={clearLibrary} use:tapBounce><Trash2 size={18} /> {t('settings.clearLibrary')}</button>
	<p class="hint">{t('settings.clearLibraryDesc')}</p>
```

**Every button has a matching `.hint` line.** Three new buttons ⇒ three labels **and** three hint keys, on top of the confirm + three failure strings.

**Flash host + styles (already present — reuse, do not add new classes)** — `:67`, `:76-78`:

```svelte
{#if msg}<p class="flash">{msg}</p>{/if}
```
```css
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 15px; cursor: pointer; text-align: left; margin-bottom: 8px; }
	.item.danger { color: #ff7a90; }
	.flash { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--tabbar-h) + 70px); background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; }
```

Icon imports come from `@lucide/svelte`, per-icon, on one line — `:4`:

```svelte
	import { ChevronLeft, Trash2, RefreshCw, Languages, Image, Search, SlidersHorizontal } from '@lucide/svelte';
```

The hidden `<input type="file">` has **no analog on this page** — see "No Analog Found".

---

### `src/lib/i18n/*.ts` ×15 (config, modified)

**Analog:** `en.ts` (reference locale) + any non-en dict.

**`en.ts:1-9`** — note: no `Dict` type import (it *defines* the type), double quotes on key AND value, section comments with `// --- name ---`:

```ts
// English UI-chrome dictionary. SOURCE / REFERENCE locale: values are the CURRENT
// verbatim on-screen text, so selecting `en` is a visual no-op. ...
const en = {
	// --- nav (bottom tab bar) ---
	"nav.home": "Home",
	"nav.search": "Search",
	"nav.library": "Library",
```

**Every other locale** — `zh-Hant.ts:1-8` (imports `type { Dict }` with **double-quoted** module specifier — note `from "./index"`, not `'./index'`; this file is inside the double-quote zone):

```ts
// Traditional Chinese (繁體中文) UI-chrome dictionary.
// Key set is IDENTICAL to en.ts (enforced by the `Dict` type + the i18n unit test).
import type { Dict } from "./index";

const zhHant: Dict = {
	// --- nav ---
	"nav.home": "首頁",
```

**What one added key looks like in practice** — the existing settings/data keys are the template (`en.ts:106,108,122,450,454`):

```ts
	"settings.dataCounts": "{liked} liked · {playlists} playlists · {downloads} downloads",
	"settings.clearLibrary": "Clear library",
	"settings.clearLibraryConfirm": "Clear all liked songs, playlists and downloads?",
	"settings.clearLibraryDesc": "Permanently deletes all your liked songs, playlists and downloads on this device; this cannot be undone, so export a backup first if you want to keep them.",
```
and the same four keys in `zh-Hant.ts:100,102,116,441`. Note the `{token}` interpolation form — `interpolate` replaces `{token}` (`i18n.test.ts:33-34`), so `t('backup.sweepDone', { saved, failed })` works with no new machinery.

**What enforces parity** — `src/lib/i18n/i18n.test.ts:46-56`:

```ts
describe('dictionaries', () => {
	// Phase 19 (Pitfall 5 / Wave 0): the parity + no-blank checks iterate ALL 15 locales ...
	it('every locale exposes a key set IDENTICAL to en (all 15 locales)', () => {
		const enKeys = Object.keys(dicts.en).sort();
		for (const lang of Object.keys(dicts) as Array<keyof typeof dicts>) {
			expect(Object.keys(dicts[lang]).sort(), `${lang} key set must match en`).toEqual(enKeys);
		}
	});
```

plus a no-blank-values check at `:66-70`. **15 locales confirmed by `ls`:** ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant. (CONTEXT D-11 says 16 — it is wrong; RESEARCH already corrected this.)

Registering a new locale is not in scope; all 15 are already wired at `index.ts:12-26`.

---

### Tests

**Pure-module test (no mocks, no globals)** — `src/lib/diagnostics/action-log-logic.test.ts:1-25`. Includes the **key-literal pin** the phase needs for D-01/D-02:

```ts
import { describe, it, expect } from 'vitest';
import {
	ACTION_LOG_CAP,
	ACTION_LOG_KEY,
	appendEntry,
	parseActionLog,
	serializeActionLog,
	type ActionLogEntry
} from './action-log-logic';

describe('action-log constants', () => {
	it('uses the versioned openmusic key + 2000-entry cap', () => {
		expect(ACTION_LOG_KEY).toBe('openmusic:action-log:v1');
		expect(ACTION_LOG_CAP).toBe(2000);
	});
});

describe('parseActionLog', () => {
	it('returns [] for null', () => {
		expect(parseActionLog(null)).toEqual([]);
	});
```

**The `browser:true` + in-memory `Storage` harness** — `src/lib/stores/settings-persist.svelte.test.ts:1-37`, verbatim. The header comment explains why this is a *separate file* — copy that reasoning into the round-trip test's header:

```ts
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
```

Identical stub at `src/lib/stores/library.svelte.test.ts:14-25`. `length` and `key(i)` **are implemented** — required for the `name-tr` prefix enumeration.

**`sessionStorage` stub: does not exist yet.** `grep -rn "sessionStorage" src/` returns **nothing** — verified this session. Because `sessionStorage` is the same `Storage` interface, the block above copies verbatim with `vi.stubGlobal('sessionStorage', …)` and a second `Map`. Flag it in the plan as new-but-trivial, and note Research A4 (unverified that `sessionStorage` survives `location.reload()` in the Capacitor WebView — probe before building Undo).

**Fake-`doc` / stubbed-global test idiom for `backup-io.test.ts`** — `src/lib/services/download-save.test.ts:11-38`:

```ts
// A minimal fake <a> + document.createElement, plus a stubbed URL.createObjectURL/revokeObjectURL —
// the vi.stubGlobal shim idiom mirrors blob-store.test.ts.
function makeFakeDoc() {
	const click = vi.fn();
	const anchor = { download: '', href: '', click } as unknown as HTMLAnchorElement;
	const createElement = vi.fn((_tag: string) => anchor);
	const doc = { createElement } as unknown as Document;
	return { doc, anchor, click, createElement };
}

function stubUrl() {
	const createObjectURL = vi.fn((_b: Blob) => 'blob:fake-object-url');
	const revokeObjectURL = vi.fn((_u: string) => undefined);
	vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
	return { createObjectURL, revokeObjectURL };
}

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('download-save — module shape', () => {
	it('exports exactly saveBlobToDisk (named, no default)', () => {
		expect(typeof saveBlobToDisk).toBe('function');
		expect(Object.keys(mod)).toEqual(['saveBlobToDisk']);
		expect((mod as Record<string, unknown>).default).toBeUndefined();
	});
});
```

**Test project config** — `vite.config.ts:6-22` (one node project, `expect.requireAssertions: true`, `.svelte.test.ts` included):

```ts
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					// Includes `*.svelte.test.ts` too: the sveltekit Vite plugin transforms `$state`
					// runes for node ... No jsdom client project exists, so a `.svelte.test.ts` must
					// run under this node project.
					include: ['src/**/*.{test,spec}.{js,ts}']
				}
			}
		]
	}
```

---

## The Five Owning Stores — exact persisted shapes

This is the authoritative payload reference for the envelope. Each `load()` shows what tolerance already exists (so the validator only needs to cover what `load()` does *not*).

### 1. `openmusic:library:v1` — `src/lib/stores/library.svelte.ts`

Key + shape (`:10`, `:18-24`):

```ts
const KEY = 'openmusic:library:v1';

export interface Playlist { id: string; name: string; tracks: Track[]; }

interface LibShape {
	liked: Track[];
	playlists: Playlist[];
	downloads: Track[];
	/** kmn: favourite artists (names). Optional in storage for non-destructive migration. */
	favArtists?: string[];
}
```

`load()` / `save()` (`:48-81`) — **the three unguarded casts are the reason the validator must `Array.isArray` them** (Pitfall 7):

```ts
	/** Hydrate from localStorage once, in the browser. Call from a layout onMount. */
	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const v = JSON.parse(raw) as Partial<LibShape>;
				this.liked = v.liked ?? [];
				this.playlists = v.playlists ?? [];
				this.downloads = v.downloads ?? [];
				this.favArtists = Array.isArray(v.favArtists) ? v.favArtists : [];
			}
		} catch {
			/* corrupt/unavailable — start empty */
		}
	}

	private save() {
		if (!browser) return;
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({ liked: this.liked, playlists: this.playlists, downloads: this.downloads, favArtists: this.favArtists })
			);
		} catch {
			/* quota — non-fatal */
		}
	}
```

`clearAll()` — the D-08 wipe step for the biggest key, already written (`:218-224`):

```ts
	clearAll() {
		this.liked = [];
		this.playlists = [];
		this.downloads = [];
		this.favArtists = [];
		this.save();
	}
```

> `clearAll()` **also fires `save()`**, writing an empty blob. For an import that immediately overwrites `KEY` and then reloads, that extra write is harmless; if the plan prefers a pure `localStorage.removeItem(KEY)` wipe (consistent with the other four keys), say which and why — do not leave it ambiguous.

### 2. `openmusic:history:v1` — `src/lib/history/history-logic.ts` + `src/lib/stores/history.svelte.ts`

Key + cap + whitelist (`history-logic.ts:10-33`): `HISTORY_CAP = 50`, `HISTORY_KEY = 'openmusic:history:v1'`, `HistoryEntry` is an 11-field flat record (`uid, source, songid, title, artist, album, cover, quality, qualityLabel, keyword, displayIndex`). Persisted value is a bare `HistoryEntry[]`.

Thin store wrapper (`history.svelte.ts:21-51`) — **this is the exact load/save shape for a pure-logic-backed key**:

```ts
	/** Hydrate from localStorage once, in the browser. Call from each sub-route onMount. */
	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			this.entries = parseHistory(localStorage.getItem(HISTORY_KEY));
		} catch {
			/* corrupt/unavailable — start empty */
		}
	}
	…
	private save() {
		if (!browser) return;
		try {
			localStorage.setItem(HISTORY_KEY, JSON.stringify(this.entries));
		} catch {
			/* quota — non-fatal */
		}
	}
```

### 3. `openmusic:search-history:v1` — `src/lib/search/search-history-logic.ts` + `searchHistory.svelte.ts`

`SEARCH_HISTORY_CAP = 12` (`:14`), `SEARCH_HISTORY_KEY` (`:17`), entry is `{ query: string; ts: number }` (`:20-23`). Persisted value is a bare array. Store wrapper `searchHistory.svelte.ts:23-56` is byte-for-byte the same shape as `history.svelte.ts` above.

### 4. `openmusic:settings:v1` — `src/lib/stores/settings.svelte.ts`

Key (`:56`) + the WR-10 note:

```ts
const KEY = 'openmusic:settings:v1';
// (WR-10: the accent default lives in defaults.ts as GENERAL_DEFAULTS.accent / DEFAULT_ACCENT —
// the duplicate local const that used to shadow it was removed.)
```

`load()` head (`:217-243`) — **every field individually guarded, every fallback from `defaults.ts`**:

```ts
	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const v = JSON.parse(raw) as Partial<Settings>;
				// First-visit-only auto-detect: if no appLang was ever saved, infer it from
				// the browser; otherwise the saved choice always wins. (browser-guarded above.)
				this.appLang = (v.appLang as AppLang) ?? detectAppLang(navigator.language);
				// WR-10: every load() fallback reads the SAME defaults.ts consts as the class-field
				// init and the reset-group methods — never a duplicated literal.
				this.lyricsLang = (v.lyricsLang as LyricsLang) ?? TRANSLATION_DEFAULTS.lyricsLang;
				…
				this.artistSkip = Array.isArray(v.artistSkip) ? (v.artistSkip as SourceLang[]) : [];
				this.enabledSources =
					v.enabledSources && typeof v.enabledSources === 'object' && !Array.isArray(v.enabledSources)
						? (v.enabledSources as Partial<Record<SourceId, boolean>>)
						: {};
```

T-vzu-01 boolean posture (`:300-302`) — only an explicit boolean wins:

```ts
				this.autoExpandOnPlay =
					typeof v.autoExpandOnPlay === 'boolean' ? v.autoExpandOnPlay : PLAYBACK_DEFAULTS.autoExpandOnPlay;
				this.showQualityTag =
					typeof v.showQualityTag === 'boolean' ? v.showQualityTag : PLAYBACK_DEFAULTS.showQualityTag;
```

`save()` (`:362-367…`) is an explicit field-by-field `JSON.stringify({ … })` whitelist, ~44 fields, with retired fields commented rather than deleted:

```ts
	save() {
		if (!browser) return;
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					appLang: this.appLang,
					lyricsLang: this.lyricsLang,
					// `nameLang` is fully retired (quick-260607-f4y): no longer written and no
					// longer read on load. The per-part fields below are the only name targets.
					artistLang: this.artistLang,
```

> **Validator scope for this key: "non-null, non-array object" and nothing more.** Duplicating ~150 lines of per-field defence would go stale. Put that sentence in the plan verbatim so nobody builds it.

### 5. `openmusic:name-tr:v2:<lang>` — `src/lib/stores/names.svelte.ts` — **PREFIX FAMILY**

Key generator (`:45-47`):

```ts
// Bump to abandon all previously-persisted (possibly poisoned) name translations.
const STORE_VER = 'v2';
const keyFor = (lang: string) => `openmusic:name-tr:${STORE_VER}:${lang}`;
```

Per-language hydrate + persist (`:87-114`) — the persisted value is a flat `Record<original, translated>`:

```ts
	private langCache(lang: string): Map<string, string> {
		let m = this.cache.get(lang);
		if (!m) {
			m = new Map();
			if (browser && !this.hydrated.has(lang)) {
				this.hydrated.add(lang);
				this.purgeStale();
				try {
					const raw = localStorage.getItem(keyFor(lang));
					if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) m.set(k, v);
				} catch { /* ignore */ }
			}
			this.cache.set(lang, m);
		}
		return m;
	}

	private persist(lang: string) {
		if (!browser) return;
		try {
			const m = this.cache.get(lang);
			if (m) localStorage.setItem(keyFor(lang), JSON.stringify(Object.fromEntries(m)));
		} catch { /* quota */ }
	}
```

**The prefix-enumeration idiom to copy** (appears twice — `purgeStale` `:72-84` and `clearCache` `:282-293`). Here is `clearCache`'s, the one the export/wipe should mirror:

```ts
		if (browser) {
			try {
				const keys: string[] = [];
				for (let i = 0; i < localStorage.length; i++) {
					const k = localStorage.key(i);
					if (k && k.startsWith('openmusic:name-tr:')) keys.push(k);
				}
				for (const k of keys) localStorage.removeItem(k);
			} catch {
				/* ignore */
			}
		}
```

Note the **collect-then-mutate** two-pass shape — indices shift during removal, so never `removeItem` inside the index loop. The prefix literal `'openmusic:name-tr:'` is already a bare literal in **two** places here (`:78`, `:287`); a third copy in `backup-logic.ts` is the correct, dependency-free choice (importing `names.svelte.ts` would drag `$state` + `settings` + `translate` + `zh-convert` into the node test).

`purgeStale()` (`:69-85`) deletes every `openmusic:name-tr:` key not matching the current `STORE_VER` on first hydration — so an imported stale-version key self-cleans and needs no migration entry.

---

## Shared Patterns

### Never-throw service contract
**Source:** `src/lib/services/blob-store.ts:7-16` (posture block), `src/lib/services/download-track.ts:10-14` (D-17 contract), `src/lib/services/download-save.ts:18-23`.
**Apply to:** `backup-logic.ts`, `backup-io.ts`, `sweep.ts` — all three.
Sentinel vocabulary already in use: `null` (blob-store get), `false` (saveBlobToDisk, native writes), `[]` (parsers), a string union (`DownloadResult`). Phase 35 adds a discriminated union — a deliberate, documented widening, not a new convention.

### Services never localize
**Source:** `src/lib/services/download-track.ts:10-14`:
```ts
//   D-17 NEVER-THROWS: ... The caller localizes a toast off the result — this module NEVER navigates and
//     NEVER opens a play page. It deliberately imports NEITHER `$lib/i18n` NOR `$lib/stores/toast`:
//     the i18n `t()` reads runes `$state` and would break the single node Vitest project, and text
//     localization is the UI layer's job (stores/services emit data, the caller localizes).
```
**Apply to:** `backup-logic.ts` (returns `reason: 'not-ours' | 'newer' | 'damaged'`), `sweep.ts` (returns counts). The page maps to `t()`.

### `browser` guard + try/catch on every localStorage touch
**Source:** the identical `if (!browser) return; try { … } catch { /* … */ }` in `library.svelte.ts:49-63`, `:66-81`; `history.svelte.ts:22-30`, `:44-51`; `names.svelte.ts:106-114`; `settings.svelte.ts:217-221`, `:362-365`.
**Apply to:** every read/write in the export, import, snapshot and undo paths. The catch comment is always a short lowercase phrase: `/* quota — non-fatal */`, `/* corrupt/unavailable — start empty */`, `/* ignore */`, `/* */`.

### Decision-ref comments
**Source:** house style throughout — `D-11`, `WR-10`, `T-vzu-01`, `CR-01`, `31-D-12`, `DL-BUG-01`, `quick-260913-jq4`.
**Apply to:** all new code, tagged `35-D-NN`. Never delete an existing ref comment.

### Do-not-import list (circular / runes contamination)
`backup-logic.ts` and `sweep.ts` are pure `.ts`. They must **not** import `library.svelte.ts`, `settings.svelte.ts`, `names.svelte.ts`, `player.svelte.ts`, or `$lib/i18n`. They **may** import `$lib/history/history-logic`, `$lib/search/search-history-logic`, and type-only `$lib/sources/types`.
Caveat: `sweep.ts` calling `downloadTrack` does pull in `library`/`player`/`settings` transitively (`download-track.ts:27-30`) — so `sweep.test.ts` must `vi.mock` `$lib/services/download-track` and `$lib/services/blob-store` rather than run them. Alternatively keep `sweep.ts` dependency-injected (`sweep(tracks, { has, download })`) — the `saveBlobToDisk(doc)` precedent. **Planner: pick one and state it.**

---

## Conventions

Derived with `gsd-tools.cjs verify conventions --derive --scope src/lib` (241 files, 598 identifiers).

| Axis | Dominant | Share | Entropy | Status |
|---|---|---|---|---|
| file-name casing | *(none)* | 47% | 0.962 | **contested hotspot** |
| identifier casing | `camel` | 95% | 0.189 | **named contract** |
| export style | `esm` | 100% | 0.000 | **named contract** |
| import style | `esm` | 100% | 0.000 | **named contract** |

**Contested hotspots (author's choice).** `file-name-casing` is contested repo-wide but **internally consistent per directory** — the same intentional-split shape as the canonical CJS↔SDK dual-resolver prototype (`bin/lib/**` CJS vs `sdk/src/**` ESM: each half self-consistent, contested only when measured across both). Match the *directory's* local style, never the repo-wide aggregate:

- `src/lib/services/`, `src/lib/history/`, `src/lib/search/`, `src/lib/diagnostics/` — **100% kebab-case** (`blob-store.ts`, `download-track.ts`, `history-logic.ts`). → `backup-logic.ts`, `sweep.ts`, `backup-io.ts` are correct.
- `src/lib/stores/` — **split by kind**: runes singletons are camelCase (`actionLog.svelte.ts`, `searchHistory.svelte.ts`, `sleepTimer.svelte.ts`, `swUpdate.svelte.ts`), pure helpers are kebab-case (`player-persist.ts`, `cover-version.svelte.ts`, `attached-cover.ts`). Phase 35 adds nothing here.
- `src/lib/components/` — PascalCase. `src/routes/**` — SvelteKit `+page.svelte` / `+server.ts`.

Beyond the derived axes, CLAUDE.md pins three things no tool checks: **tabs** for indentation, **single quotes** in TS/JS, and **double quotes in `src/lib/i18n/*.ts` for keys, values, and even the `from "./index"` module specifier**. There is no prettier/eslint/biome — `pnpm check` (`svelte-check`) is the only gate, so style is review-enforced.

---

## No Analog Found

| File / concern | Role | Data Flow | Reason |
|---|---|---|---|
| Hidden `<input type="file">` + `await file.text()` | UI element | file-I/O (in) | **Nothing in `src/` reads a user-picked file.** `grep` finds no `type="file"` in the app. Genuinely new. Follow RESEARCH Answer 6: `accept="application/json,.json"` (the bare `.json` form hits an unguarded `validTypes[0]` in Capacitor's `showFilePicker`). |
| `@capacitor/share` usage | native service | file-I/O (out) | The package is **not installed**. `navigator.share` is called inline in three components (`TrackMenu.svelte:317`, `album/[name]/+page.svelte:519`, `artist/[name]/+page.svelte:255`) and always with `{ title, text }`, **never `{ files }`**. `src/lib/services/share.ts` is a URL/token builder, not a share-sheet helper. The closest structural analog is `blob-store.ts`'s native branch (`Filesystem` + `Capacitor.isNativePlatform()`), which covers the *shape* but not the API. |
| `sessionStorage` | storage | — | **Zero occurrences in `src/`** — verified this session. The `Storage` interface is identical to `localStorage`, so the test stub (`settings-persist.svelte.test.ts:11-22`) copies verbatim; but there is no in-repo precedent for its *runtime* behaviour. RESEARCH A4 flags the open question (does it survive `location.reload()` in the Capacitor WebView?) — probe before building Undo. |
| `location.reload()` after a state write | UI | — | No existing call site. New, but a one-liner; D-13 locks it. |
| A per-key migration framework | — | — | **`MIGRATIONS` has no analog because there is no migration in the repo.** No exported key has ever bumped its version segment; `library:v1` absorbed a schema change additively (`favArtists?`, `library.svelte.ts:22-23`). Write the empty `Record` with a comment; do not build a framework. |

---

## Metadata

**Analog search scope:** `src/lib/stores/`, `src/lib/services/`, `src/lib/history/`, `src/lib/search/`, `src/lib/diagnostics/`, `src/lib/i18n/`, `src/routes/(app)/settings/data/`, `src/routes/(app)/album/[name]/`, `vite.config.ts`
**Files read in full or in targeted ranges:** 18
**Conventions derivation:** `gsd-tools.cjs verify conventions --derive --scope src/lib` — 4 axes, not skipped
**Pattern extraction date:** 2026-09-13
