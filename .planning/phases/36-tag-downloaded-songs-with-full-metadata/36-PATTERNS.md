# Phase 36: Tag downloaded songs with full metadata - Pattern Map

**Mapped:** 2026-09-13
**Files analyzed:** 16 new/modified
**Analogs found:** 13 / 16 (3 genuinely novel — see "No Analog Found")

---

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/lib/services/audio-tags.ts` | NEW | service (pure `.ts`) | transform (bytes in → bytes out) + lazy module load | `src/lib/services/media-artwork.ts` | exact (never-throw + byte work + exported ceiling constants) |
| `src/lib/services/audio-tags.test.ts` | NEW | test | round-trip / binary fixtures | `src/lib/services/media-artwork.test.ts` + `download-save.test.ts` | role-match (no binary-fixture precedent — see gaps) |
| `src/lib/services/retag.ts` | NEW | service (pure `.ts`) | batch, per-item failure isolation | `src/lib/services/downloads-queue.ts` (purity/shape) + `album/[name]/+page.svelte:420` `downloadAlbum` (the loop) | role-match (split across two analogs) |
| `src/lib/services/retag.test.ts` | NEW | test | batch isolation | `src/lib/services/download-track.test.ts` | role-match |
| `tests/fixtures/tiny.{mp3,m4a,flac}`, `tiny-nonfaststart.m4a`, `README.md` | NEW | test fixture (binary) | file-I/O | **none** | no analog |
| `src/routes/(app)/settings/downloads/+page.svelte` | NEW | route/page component | request-response (user action → batch) | `src/routes/(app)/settings/data/+page.svelte` | exact |
| `src/routes/(app)/settings/+page.svelte` | MOD | route (index) | config list | itself (add one `groups[]` row) | exact |
| `src/lib/i18n/{en,zh-Hans,zh-Hant,…16}.ts` | MOD | config (dictionary) | lookup | `src/lib/i18n/en.ts` + `i18n.test.ts` parity/quote guards | exact |
| `src/lib/services/download-track.ts` | MOD | service (orchestration) | request-response | itself (:119–:135 is the seam) | exact |
| `src/lib/services/download-track.test.ts` | MOD | test | orchestration mocks | itself (extend) | exact |
| `src/routes/(app)/album/[name]/+page.svelte` | MOD | route/page component | batch | itself (:420 `downloadAlbum`, :58 `albumArtist`) | exact |
| `src/routes/(app)/settings/about/+page.svelte` | MOD | route/page component | static content | itself (add a TagLib/LGPL attribution line) | exact |
| `src/service-worker.ts` | MOD | config/runtime shell | cache/precache | itself (:15 `ASSETS`) | exact |
| `.nvmrc` / `package.json` `engines` | MOD | config | — | itself | exact |
| `.github/workflows/{android-main,android-release,upstream-health}.yml` | MOD | config (CI) | — | itself (3× `node-version: 22`) | exact |
| `android/.../MediaStoreSaverPlugin.kt` | NOT MODIFIED | — | — | D-15 locks it unchanged; RESEARCH Pitfall 10 Shape A = zero Kotlin | n/a |

---

## Pattern Assignments

### `src/lib/services/audio-tags.ts` (service, transform)

**Analog: `src/lib/services/media-artwork.ts`** — the single closest file in the repo. It is a pure
`.ts` that does byte work, exports tunable ceiling constants, avoids `FileReader` *because of the node
test project*, and returns `null` as its never-throw sentinel. Copy its posture wholesale.

**Imports pattern** (`media-artwork.ts:43-44`) — path aliases only, no relative `../`:
```typescript
import { apiUrl } from '$lib/services/api-base';
import { hasHttpsScheme } from '$lib/services/url-safety';
```
For `audio-tags.ts` the equivalent is `import { browser } from '$app/environment';` only. **Do NOT
import a runes store** — see the purity contract analog below.

**Exported ceiling constant with a measured justification** (`media-artwork.ts:47-55`) — this is the
exact precedent for `TAG_MAX_BYTES` (RESEARCH Pitfall 2). Note the doc comment carries the *measured
number* that justifies the value:
```typescript
/**
 * Cap on the decoded image. Base64 inflates by 4/3 and the result crosses the Capacitor JSON
 * bridge as a string, so a huge cover would be paid for twice. The live probe recorded in
 * /api/og's header measured real covers at 72-104 KB, so 1 MB is far above anything legitimate
 * and only rejects a pathological response.
 */
export const MAX_ART_BYTES = 1_000_000;

/** Per-fetch deadline. Artwork is decoration — it must never hold up a metadata write for long. */
export const ART_FETCH_TIMEOUT_MS = 6_000;
```
→ `export const TAG_MAX_BYTES = 40 * 1024 * 1024;` with a comment naming the measured ~6×-file-size
peak RSS and the 392 MB / 50 MB FLAC figure from RESEARCH.

**Never-throw + sentinel pattern** (`media-artwork.ts:77-95`) — the shape `audio-tags.ts` must mirror,
including the `catch` comment that *enumerates the failure classes it is absorbing*:
```typescript
/** Fetch one URL and encode it as a `data:` URL, or null on ANY failure. Never throws. */
async function fetchAsDataUrl(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(ART_FETCH_TIMEOUT_MS) });
		if (!res.ok) return null;
		const type = res.headers.get('content-type');
		if (!isImageType(type)) return null;
		const buf = await res.arrayBuffer();
		if (buf.byteLength === 0 || buf.byteLength > MAX_ART_BYTES) return null;
		// Strip any `; charset=…` parameter — the data: URL wants the bare MIME.
		const mime = (type ?? 'image/jpeg').split(';')[0].trim();
		return `data:${mime};base64,${bytesToBase64(new Uint8Array(buf))}`;
	} catch {
		// CORS rejection, offline, DNS failure, timeout, 404 — all land here as an ordinary
		// rejection instead of a native uncaught IOException. That is the entire point.
		return null;
	}
}
```

**Node-test-aware byte helper** (`media-artwork.ts:62-76`) — reuse `bytesToBase64` if base64 is ever
needed; more importantly, copy the *reasoning comment*, because `audio-tags.ts` faces the same
"no jsdom, no FileReader" environment:
```typescript
/**
 * Base64-encode bytes without FileReader (absent in the node test project) and without
 * `String.fromCharCode(...bytes)` (which blows the argument limit on a 100 KB image).
 * Chunked so the spread stays small.
 */
export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}
```

**Explicit purity contract in the header comment** — copy from `download-filename.ts:1-12`. This is
the exact discipline `audio-tags.ts` needs (it receives already-translated strings from
`names.dn*`, exactly as `buildDownloadFilename` does — RESEARCH Pattern 5):
```typescript
// download-filename.ts — PURE, node-testable download-filename helpers (DL-FILE-01, D-08).
//
// PURITY CONTRACT (RESEARCH anti-pattern): this module MUST NOT import `$lib/stores/names` or any
// runes store — the caller runs artist/title through `names.dnArtist`/`names.dnTitle` (D-05) with
// raw fallback (D-07, synchronous) and passes the ALREADY-translated strings in. Keeping the
// helper store-free is what lets it live in the single Vitest node project (no jsdom, no runes).
```

**Lazy dynamic-import pattern** (`src/lib/stores/player.svelte.ts:2117-2122`) — the repo's only
existing dynamic-import precedent. Note it is memo-free fire-and-forget there; `audio-tags.ts` needs
the memoized `??=` variant from RESEARCH Pattern 1, but the *comment style* (state WHY the import is
dynamic) transfers directly:
```typescript
// Dynamic import: download-track imports the player singleton, so a static import
// here would close a module cycle. Fire-and-forget + never-throw; `save:false` keeps
// the repair silent (no save dialog mid-playback).
void import('$lib/services/download-track')
	.then((m) => m.downloadTrack({ ...track }, { save: false }))
	.catch(() => {});
```
→ for `audio-tags.ts` the comment must name all three reasons from RESEARCH (bundle chunking,
SSR/Cloudflare node-entry avoidance, one-time wasm compile).

**Diagnostics hook** (`src/lib/stores/actionLog.svelte.ts:101`) — `logAction(ev, d?)` is the house
diagnostic channel (Settings → Activity log). RESEARCH Pitfall 2 asks for
`logAction('tag.skipped-size', …)`. **Caveat:** `actionLog.svelte.ts` is a RUNES store — importing it
from `audio-tags.ts` breaks the purity contract above. Log from the `download-track.ts` caller instead
(it already lives in the store layer), or have `audio-tags.ts` return a reason discriminant the caller
logs.

---

### `src/lib/services/audio-tags.test.ts` (test, round-trip + grep guards)

**Analog A — grep-a-function-body guardrail:** `src/lib/services/download-save.test.ts:95-100`. This is
the technique D-11 (never `displayIndex`) and D-13 (no second artwork fetch path) both want:
```typescript
describe('download-save — DL-BUG-01 guarantee: no navigation fallback in source', () => {
	it('the function source references neither window.open nor showSaveFilePicker on ANY path', () => {
		const src = saveBlobToDisk.toString();
		expect(src).not.toContain('window.open');
		expect(src).not.toContain('showSaveFilePicker');
	});
});
```

**Analog B — grep the whole MODULE source (comment-stripped), for import-level guarantees:**
`src/lib/services/download-track.test.ts:338-348`. Use this shape for D-13 ("no second fetch path")
and D-07/D-08 ("no year/genre/comment/encoder"). Note the comment-stripping filter — essential here,
because this phase's files will mention `displayIndex` / `fetch` in decision-ref comments:
```typescript
describe('downloadTrack — import contract (node compile safety + DL-BUG-01)', () => {
	it('imports neither $lib/i18n nor $lib/stores/toast, and contains no window.open', () => {
		const src = readFileSync(new URL('./download-track.ts', import.meta.url), 'utf8')
			.split('\n')
			.filter((l) => !l.trim().startsWith('//'))
			.join('\n');
		expect(src).not.toContain('$lib/i18n');
		expect(src).not.toContain('$lib/stores/toast');
		expect(src).not.toContain('window.open');
	});
});
```

**Analog C — module-shape assertion (named exports, no default):** `download-save.test.ts:32-38`.
Cheap and matches the "named exports throughout, no default exports in `$lib`" convention:
```typescript
import * as mod from './download-save';
…
expect(Object.keys(mod)).toEqual(['saveBlobToDisk']);
expect((mod as Record<string, unknown>).default).toBeUndefined();
```

**Analog D — constructing binary test data in the node project:**
`src/lib/services/media-artwork.test.ts:21-42` is the only existing precedent for magic-byte-shaped
fixtures, and it also documents the `Uint8Array` → `BodyInit` TS friction:
```typescript
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageResponse(bytes: Uint8Array, type = 'image/jpeg'): Response {
	// Response's BodyInit rejects Uint8Array<ArrayBufferLike>, and `bytes.buffer` widens to …
	new Uint8Array(body).set(bytes);
	…
}
…
const big = new Uint8Array(300_000).fill(0x41);
```
And `src/lib/services/download-progress.test.ts:32` for chunk construction:
```typescript
const chunk = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
```

**Analog E — reading a file from disk inside a test:** `download-track.test.ts:2` /
`share.test.ts:2` both do `import { readFileSync } from 'node:fs';` and address the file via
`new URL('./x.ts', import.meta.url)`. Use the same `new URL(..., import.meta.url)` addressing for the
binary fixtures (relative-to-test-file, not cwd-dependent).

---

### `src/lib/services/retag.ts` + `retag.test.ts` (service, batch with per-item isolation)

**Analog A — pure never-throw list builder over `library.downloads`:**
`src/lib/services/downloads-queue.ts` (whole file, 32 lines). Same input (`library.downloads: Track[]`),
same "pure, importing no UI and no player" posture. Copy its header comment shape and its
defensive-loop style:
```typescript
export function buildOfflineQueue(downloads: Track[], have: Set<string> = new Set()): Track[] {
	if (!Array.isArray(downloads) || downloads.length === 0) return [];
	const seen = new Set<string>();
	const out: Track[] = [];
	for (const t of downloads) {
		if (!t?.uid) continue;
		if (have.has(t.uid)) continue;
		if (seen.has(t.uid)) continue; // intra-list dedupe (registry should already be unique)
		seen.add(t.uid);
		out.push(t);
	}
	return out;
}
```

**Analog B — the sequential, per-item-isolated, staggered batch loop:**
`src/routes/(app)/album/[name]/+page.svelte:420-435`. This is the closest thing the repo has to D-19.
Note: **sequential `for…of` with `await`, a busy flag, a `finally` that clears it, a counter, and a
250 ms stagger** — NOT `Promise.allSettled` (which would flood the fetch governor; see the
`api-fetch-flood` memory):
```typescript
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
**Split per the repo's `.ts` / `.svelte` convention:** `retag.ts` owns the pure planner (what to retag,
in what order, and the per-item result reduction); the settings page owns the loop driver + toast, the
way the album page drives `downloadTrack`.

**Read-modify-write target** — `src/lib/services/blob-store.ts:225/250/305`. `blobStore` exports
`{ put, get, has, del }` (`:322`). The web retag loop is `get(uid)` → tag → `put(uid, tagged, filename)`;
on native the same `put` re-runs `nativePut` (`:106-132`), which already does the **delete-and-re-save**
via `MediaStoreSaver.saveToMusic` + `setStoredUri` — i.e. RESEARCH Pitfall 10 **Shape A needs zero new
plumbing**, `put` already is the rewrite path. Note `nativePut`'s WR-01 best-effort comment:
```typescript
	try {
		const { uri: sourcePath } = await Filesystem.getUri({ path: nativePath(uid), directory: NATIVE_DIR });
		const { uri } = await MediaStoreSaver.saveToMusic({ fileName: filename ?? nativeFileName(uid), sourcePath });
		if (uri) setStoredUri(uid, uri);
	} catch {
		// public copy is visibility-only — best-effort; the offline copy already landed (WR-01).
	}
	return true;
```
`src/lib/services/media-store.ts` (32 lines) is the whole TS surface of the Kotlin plugin — confirm
there is no `updateInMusic`; there is not, which is why Shape A is the cheap option.

---

### `src/routes/(app)/settings/downloads/+page.svelte` (route/page component, request-response)

**Analog: `src/routes/(app)/settings/data/+page.svelte`** (79 lines) — exact match. It is the settings
sub-page that runs *bulk actions with a transient result message*, which is precisely the retag
control's shape. Copy the whole skeleton: header + back-nav, `onMount` store load, `flash()` for the
transient message, `.item` button rows each followed by a `.hint` paragraph, and the `<style>` block
verbatim (the CSS is duplicated per settings page in this repo — match it, don't extract it).

**Page skeleton** (`settings/data/+page.svelte:1-22`):
```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Trash2, RefreshCw, Languages, Image, Search, SlidersHorizontal } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';

	let msg = $state('');
	let counts = $state({ liked: 0, playlists: 0, downloads: 0 });

	onMount(() => {
		settings.load();
		library.load();
		counts = { liked: library.liked.length, playlists: library.playlists.length, downloads: library.downloads.length };
	});
```

**Transient result message (the "Retagged N of M" surface)** (`:27`):
```typescript
	function flash(m: string) { msg = m; setTimeout(() => (msg = ''), 1800); }
```
```svelte
{#if msg}<p class="flash">{msg}</p>{/if}
```

**Header + back-nav + action row markup** (`:44-62`):
```svelte
<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')} use:tapBounce><ChevronLeft size={22} /></button>
	<h1>{t('settings.data')}</h1>
</header>

<section>
	<p class="muted">{t('settings.dataCounts', { liked: counts.liked, playlists: counts.playlists, downloads: counts.downloads })}</p>
	<button class="item" onclick={clearCovers} use:tapBounce><Image size={18} /> {t('settings.clearCoverCache')}</button>
	<p class="hint">{t('settings.clearCoverCacheHint')}</p>
</section>
```
Note: `t('key', { params })` is the interpolation form — use it for "Retag all downloads ({count})".
Note: every interactive button carries `use:tapBounce` — repo-wide convention.

**Confirmation before a destructive/irreversible bulk action** (`:34-41`) — retag rewrites files on the
user's disk, so this `confirm()` precedent applies (D-17's "explicit consent" framing):
```typescript
	function clearLibrary() {
		if (confirm(t('settings.clearLibraryConfirm'))) {
			library.clearAll();
			…
			flash(t('settings.libraryCleared'));
		}
	}
```

---

### `src/routes/(app)/settings/+page.svelte` (MOD — add the index row)

**Analog: itself, `:13-24`.** One typed row appended to `groups[]`; `title`/`desc` are
`TranslationKey`s, so both keys must exist in all 16 dictionaries or `pnpm check` fails:
```typescript
const groups: { href: string; icon: Component; title: TranslationKey; desc: TranslationKey }[] = [
	{ href: '/settings/playback', icon: Music, title: 'settings.groupPlayback', desc: 'settings.groupPlaybackDesc' },
	{ href: '/settings/data', icon: Database, title: 'settings.groupData', desc: 'settings.groupDataDesc' },
	…
];
```
Place the `downloads` row next to `playback`/`data`. Icon from `@lucide/svelte` (per-icon named import,
tree-shaking) — e.g. `Download` / `Tags`.

---

### `src/lib/i18n/*.ts` (MOD — 16 dictionaries)

**Analog: `src/lib/i18n/en.ts`.** `en` is the reference locale and defines `TranslationKey`. Entry style
— **double quotes on key AND value**, grouped under a `// --- section ---` comment:
```typescript
	"settings.dataCounts": "{liked} liked · {playlists} playlists · {downloads} downloads",
	"settings.groupData": "Data",
	"settings.groupDataDesc": "Library counts, clear data",
	"settings.clearCoverCache": "Clear cover cache",
```

**Two CI guards already enforce this — plan for both** (`src/lib/i18n/i18n.test.ts:46-57` and `:75-108`):
```typescript
	it('every locale exposes a key set IDENTICAL to en (all 15 locales)', () => {
		const enKeys = Object.keys(dicts.en).sort();
		for (const lang of Object.keys(dicts) as Array<keyof typeof dicts>) {
			expect(Object.keys(dicts[lang]).sort(), `${lang} key set must match en`).toEqual(enKeys);
		}
	});
```
```typescript
	// CLAUDE.md mandates DOUBLE quotes for every key AND value in src/lib/i18n/*.ts …
	const ENTRY = /^\s*(['"])[^'"]*\1\s*:\s*(['"])/;
```
Adding one key to `en` alone turns **16 test cases red**. Every new string is a 16-file edit.

---

### `src/lib/services/download-track.ts` (MOD — the single tag seam)

**Analog: itself.** The insertion point is between `:119-127` (`readBlobWithProgress`) and `:128-135`
(`extFromAudioUrl` / `buildDownloadFilename` / `blobStore.put`). Current code:
```typescript
		const blob = await readBlobWithProgress(
			resp,
			(fraction) => library.setDownloadProgress(track.uid, fraction),
			{ type: audioMimeForUrl(r.audioUrl, resp.headers?.get?.('content-type')) }
		);

		const ext = extFromAudioUrl(r.audioUrl);
		const filename = buildDownloadFilename(names.dnArtist(r.artist), names.dnTitle(r.title), ext);

		if (opts?.persist !== false) {
			await blobStore.put(r.uid, blob, filename);
		}
		if (opts?.save === false) return 'saved';
		return saveBlobToDisk(blob, filename) ? 'saved' : 'failed';
```
Three structural facts the planner must respect:
1. `names.dnArtist(r.artist)` / `names.dnTitle(r.title)` are computed **inline at `:129`**. RESEARCH
   Pattern 5 requires hoisting them to two `const`s so the tag and the filename cannot disagree.
2. The options bag at `:67` is `opts?: { persist?: boolean; save?: boolean }` — widening it with
   `trackNumber?` / `albumArtist?` is additive and touches no other caller.
3. The outer `try/catch` at `:146` and `finally` at `:151` stay untouched; `tagAudioBlob` must never
   reject so the D-17 contract holds by construction.

**Contract-comment style to extend** (`download-track.ts:8-24`) — the header enumerates each named
contract with its ID and the reason. Add the 36-D-06 contract in the same voice:
```typescript
// CONTRACTS (all three MUST hold — asserted in download-track.test.ts):
//
//   D-17 NEVER-THROWS: every failure path resolves a DownloadResult sentinel ('no-audio' | 'failed'),
//     never rejects. …
//   D-18 DOWNLOAD ISOLATION (quick-260625-pzs-04): download work must NOT cross into playback. …
//   DL-BUG-01 (D-09): a failed save returns 'failed' — it NEVER `window.open`s the raw stream URL …
```

**RAW-fetch annotation convention** — the repo tags every non-`apiFetch` fetch with a
`// RAW fetch (not apiFetch — fetch→apiFetch audit): …` justification (`:114-116`). `resolveArtworkDataUrl`
introduces one new request on this path; RESEARCH's seam audit flags it — annotate it in the same form.

---

### `src/lib/services/download-track.test.ts` (MOD — extend)

**Analog: itself.** Three reusable blocks:

**Hoisted mock bag + `vi.mock` factories** (`:15-43`) — add `$lib/services/audio-tags` and
`$lib/services/media-artwork` here:
```typescript
const mocks = vi.hoisted(() => ({
	library: { beginDownload: vi.fn(…), endDownload: vi.fn(…), addDownload: vi.fn(…), … },
	player: { current: null as Track | null, playGen: 0 },
	names: { dnArtist: vi.fn((s: string) => s), dnTitle: vi.fn((s: string) => s) },
	put: vi.fn(async (_uid: string, _blob: Blob, _filename?: string) => true),
	saveBlobToDisk: vi.fn((_blob: Blob, _filename: string) => true)
}));
vi.mock('$lib/stores/names.svelte', () => ({ names: mocks.names }));
vi.mock('$lib/services/blob-store', () => ({ blobStore: { put: mocks.put }, put: mocks.put }));
```

**Isolation contract via throwing setters** (`:303-335`) — the D-18 guard that must survive:
```typescript
		Object.defineProperty(mocks.player, 'current', {
			configurable: true, get: () => cur,
			set: () => { throw new Error('player.current was assigned — DOWNLOAD ISOLATION broken'); }
		});
```

**Asserting on `blobStore.put`'s captured args — the model for "the tagged blob keeps its MIME type"**
(`:382-387`):
```typescript
		const [, storedBlob, storedName] = mocks.put.mock.calls[0];
		expect(storedBlob.type).toBe('audio/mp4');
		// the filename's extension and the media type now agree
		expect(storedName).toBe('Tame Impala - Dracula.m4a');
```

---

### `src/routes/(app)/album/[name]/+page.svelte` (MOD — thread D-11/D-12)

**Analog: itself.** `albumArtist` **already exists** as a `$derived` at `:58` — D-12's value needs no
new derivation:
```typescript
	// The album artist is carried in the URL by the artist-page link (?artist=…). It is
	// NOT derived from tracks[0] (the stubs have no resolved artist until tap, and the
	// album.getInfo query NEEDS the artist up front). Absent param (deep link) → '' → the
	const albumArtist = $derived(page.url.searchParams.get('artist') ?? '');
```
D-11's track number is the index of `resolved` in the `:427` loop (`String(i + 1)` from
`resolved.entries()`), **not** `tr.displayIndex`. Note `albumArtist` can be `''` on a deep link — pass
`albumArtist || undefined` so D-12's fallback to the track's own artist engages.

---

### `src/service-worker.ts` (MOD — keep the wasm out of install-time precache)

**Analog: itself, `:15` and `:60-66`.** The one-line change site:
```typescript
const ASSETS = [...build, ...files]; // app bundle + static/ files
```
Cache-first lookup at `:61` keys off the same `ASSETS` array, so filtering `.wasm` out of `ASSETS`
correctly routes it to the network-then-cache branch at `:69-84` (which already caches basic
same-origin 200s). **Do NOT touch `sw-cache.ts`'s `shouldBypass`** — the file's own header comment
says all bypass logic lives there and the SW does not reimplement it; this is an *asset-list* change,
not a bypass change. Style note: the comment must carry a decision ref, matching every other change in
this file (`T-24-02`, `quick-260713-7pi`, `CR-01`).

---

### `src/routes/(app)/settings/about/+page.svelte` (MOD — TagLib LGPL/MPL attribution)

**Analog: itself, `:15-22` and `:44-47`.** The page holds a `features` array of **literal English
strings** explicitly marked as *not* part of the translated UI chrome — the correct home for a licence
notice (no 16-locale edit needed):
```typescript
	// What the app does today (literal — brand/credits text, not part of the translated UI chrome).
	const features = [ 'Search + stream across Netease, QQ, Kuwo & JOOX, …', … ];
```
And the external-link row pattern for the licence URL:
```svelte
	<a class="item link" href={REPO} target="_blank" rel="noopener noreferrer"><Code2 size={18} /> <span>Source code on GitHub</span></a>
```

---

### Node 24 bump (`.nvmrc`, `package.json`, 3 workflows)

No code analog needed — these are literal value edits. Current state, verified:

| File | Current | Target |
|---|---|---|
| `.nvmrc` | `22` | `24` |
| `package.json` `engines.node` | `">=22"` | `">=24"` |
| `.npmrc` | `engine-strict=true` | **unchanged** (the guard is correct; RESEARCH rejects disabling it) |
| `.github/workflows/upstream-health.yml:51` | `node-version: 22` | `24` |
| `.github/workflows/android-release.yml:42` | `node-version: 22` | `24` |
| `.github/workflows/android-main.yml:42` | `node-version: 22` | `24` |
| Cloudflare Pages | reads `.nvmrc` | also set `NODE_VERSION` env var (RESEARCH A8) |

`package.json` is **tab-indented** like the rest of the repo.

---

## Shared Patterns

### Never-throw service returning a sentinel
**Source:** `src/lib/services/media-artwork.ts:77-95` (canonical); same posture in `deezer.ts`,
`itunes-cover.ts`, `fallback.ts`.
**Apply to:** `audio-tags.ts`, `retag.ts`.
**Rule:** throw internally so a transient failure is never cached, map every rejection to a sentinel at
the *exported* boundary. For this phase the sentinel is `null` from `writeAudioTags` / the **original
blob** from the `download-track.ts`-facing wrapper (D-06). The `catch` block gets a comment naming the
failure classes it absorbs.

### Load-bearing comments with decision refs
**Source:** every file read for this map. Two tagging systems in use: quick-task IDs
(`quick-260913-tmi`, `quick-260625-pzs-04`) and decision refs (`D-17`, `DL-FILE-01`, `WR-01`, `T-24-02`).
**Apply to:** all new and modified files.
**Rule:** each non-obvious choice carries its ref. This phase's refs are `36-D-01` … `36-D-19` —
`download-track.ts` already namespaces cross-phase refs (e.g. `31-D-12` at `:141`), so use the
`36-D-NN` form. Never delete an existing decision-ref comment.

### Path aliases + `import type` + named exports
**Source:** `download-track.ts:26-36`.
```typescript
import type { Track } from '$lib/sources/types';
import { library } from '$lib/stores/library.svelte';
import { blobStore } from '$lib/services/blob-store';
```
**Apply to:** every new `.ts`/`.svelte`. No deep relative imports, no default exports in `$lib`,
`import type` for type-only.

### `use:tapBounce` on every interactive control
**Source:** `settings/data/+page.svelte` (every `<button>`), `settings/+page.svelte`, album page.
**Apply to:** the retag button and the back-nav button on the new settings page.

### Settings page CSS is duplicated, not shared
**Source:** `settings/data/+page.svelte:71-78` vs `settings/about/+page.svelte:50-61` — the
`.head`/`.back`/`.item`/`.hint`/`.flash` rules are copy-pasted per page.
**Apply to:** `settings/downloads/+page.svelte` — copy the block from `settings/data`. Do not extract a
shared stylesheet; that is a repo-wide refactor this phase should not open.

### i18n: stores/services emit keys, UI calls `t()`
**Source:** `download-track.ts:11-14` — "it deliberately imports NEITHER `$lib/i18n` NOR
`$lib/stores/toast`".
**Apply to:** `audio-tags.ts` and `retag.ts` must import neither. The settings page localizes.

---

## Conventions

Derived deterministically over `src/lib/services` (the subtree that gains `audio-tags.ts` / `retag.ts`):

| Axis | Dominant | Share | Entropy | Status |
|------|----------|-------|---------|--------|
| file-name casing | *(none)* | 46% | 0.931 | **contested hotspot** |
| identifier casing | `camel` | 97% | 0.133 | **named contract** |
| export style | `esm` | 100% | 0.000 | **named contract** |
| import style | `esm` | 100% | 0.000 | **named contract** |

**Contested hotspots (author's choice).** The file-name axis reads contested only because the deriver
bins dotted names (`download-track.test.ts`, `player.svelte.ts`) as `other` — 47 of 103. The real repo
rule is stated in `CLAUDE.md` and is *not* ambiguous: pure logic is **kebab-case `<name>.ts`**, runes
stores are **`<name>.svelte.ts`**, components are **`PascalCase.svelte`**, tests are co-located
`<name>.test.ts`. Follow that, not the histogram: `audio-tags.ts` / `audio-tags.test.ts` /
`retag.ts` / `retag.test.ts`.

The prototype intentional-contested split this repo mirrors is the CJS↔ESM dual resolver (CJS
`module.exports`/`require` in one half, ESM `export`/`import` in the other): each half is internally
consistent per-directory and contested only repo-wide. Here there is no such split —
`src/lib/services` is 100% ESM named exports. Match the directory's local style; for this phase that
means ESM named exports, `camelCase` identifiers, `SCREAMING_SNAKE_CASE` module constants
(`TAG_MAX_BYTES`, matching `MAX_ART_BYTES` / `ART_FETCH_TIMEOUT_MS`), tabs, single quotes
(**except** `src/lib/i18n/*.ts`, which is double quotes and CI-enforced).

---

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|---|---|---|---|
| `tests/fixtures/tiny.{mp3,m4a,flac}` + `tiny-nonfaststart.m4a` | test fixture (binary) | file-I/O | **There is no `tests/` directory and no committed binary fixture anywhere in the repo.** Every existing test constructs bytes inline (`media-artwork.test.ts:21`, `download-progress.test.ts:32`). Vitest `include` is `src/**/*.{test,spec}.{js,ts}` (`vite.config.ts:18`), so a top-level `tests/fixtures/` is not picked up as tests — fine, but it breaks the repo's otherwise-universal co-location rule. **Planner decision needed:** `tests/fixtures/` (RESEARCH's proposal) vs `src/lib/services/__fixtures__/`. Co-location is the stronger repo signal; either way, address fixtures via `new URL('./…', import.meta.url)` (the `download-track.test.ts:341` / `i18n.test.ts` idiom), never a cwd-relative path. |
| A third-party **runtime** npm dependency (`taglib-wasm`) | config | — | **First one ever.** `package.json` runtime `dependencies` are Capacitor plugins + `@lucide/svelte` only; every service is hand-written over platform `fetch`/`URL`/`IndexedDB`. There is no precedent for pinning, vendoring, or licence-attributing a runtime dep. Follow RESEARCH's rules directly (exact pin, no caret, no auto-bump, attribution on the About page). |
| A wasm asset in the Vite/SvelteKit/Capacitor build | config | — | No `.wasm` exists in the repo or the build today. `service-worker.ts:15` `ASSETS = [...build, ...files]` has never had a non-JS/CSS emitted asset to reason about, and `cap sync` has never copied one into `android/app/src/main/assets/public/`. RESEARCH A4/A5 are both `[ASSUMED]` — verify with one `pnpm build` + grep, and one `pnpm apk`. |
| `updateInMusic` on the Kotlin MediaStore plugin | native bridge | file-I/O | Intentionally absent — `media-store.ts` exposes only `saveToMusic`/`deleteFromMusic`. RESEARCH Pitfall 10 **Shape A** avoids needing a new one; `blobStore.put` already performs a full re-save. If the planner picks Shape B, there is no `@PluginMethod` analog in-repo beyond the two existing methods in `MediaStoreSaverPlugin.kt`. |

---

## Metadata

**Analog search scope:** `src/lib/services/`, `src/routes/(app)/settings/`,
`src/routes/(app)/album/[name]/`, `src/lib/i18n/`, `src/lib/stores/`, `src/service-worker.ts`,
`.github/workflows/`, root config.
**Files read in full:** `media-artwork.ts`, `download-filename.ts`, `download-track.ts`,
`download-save.test.ts`, `downloads-queue.ts`, `media-store.ts`, `service-worker.ts`,
`settings/data/+page.svelte`, `settings/+page.svelte`, `settings/about/+page.svelte`.
**Files read in part:** `download-track.test.ts`, `blob-store.ts`, `player.svelte.ts`,
`album/[name]/+page.svelte`, `i18n/i18n.test.ts`, `i18n/en.ts`, `actionLog.svelte.ts`, `vite.config.ts`.
**Pattern extraction date:** 2026-09-13
