# Phase 34: Import device songs as native downloads - Pattern Map

**Mapped:** 2026-09-13
**Files analyzed:** 26 (9 new, 17 modified — i18n counted as one row for 15 files)
**Analogs found:** 24 / 26

Every excerpt below is copied verbatim from the repo at the cited `file:line`. Where a "closest analog"
is named, the planner should point the plan's action at that file and say *copy this shape*, not *follow
the pattern*.

---

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|---|
| `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt` | MOD | native plugin | request-response (cursor page) | **same file** — `saveToMusic` + `publicMusicPermsCallback` (`:94-133`) | exact |
| `android/app/src/main/AndroidManifest.xml` | MOD | config | — | same file `:53-62` (WRITE_EXTERNAL_STORAGE block + its comment) | exact |
| `src/lib/services/media-store.ts` | MOD | bridge typing | request-response | **same file** `:16-32` (`registerPlugin` + JSDoc'd interface) | exact |
| `src/lib/services/blob-store.ts` | MOD | service (platform-switched store) | file-I/O | **same file** — `nativeGet` `:135-153`, `nativeHas` `:158-168`, `nativeDel` `:170-190` | exact |
| `src/lib/services/device-filename.ts` | NEW | pure service | transform | `src/lib/services/download-filename.ts` (the literal inverse) + `match-key.ts:23-30` | exact |
| `src/lib/services/device-track.ts` | NEW | pure service | transform | `src/lib/services/downloads-queue.ts` (pure Track builder) + `types.ts:141-143` `makeUid` | exact |
| `src/lib/services/device-import.ts` | NEW | pure service | batch + orchestration | `src/lib/services/download-track.ts` (never-throw sentinel orchestration) | role-match |
| `src/lib/stores/import-rules.svelte.ts` | NEW | runes store | CRUD + localStorage | `src/lib/stores/searchHistory.svelte.ts` (thin store over a pure logic module) | exact |
| `src/lib/services/catalog.ts` | MOD | service | request-response | **same file** `ensureTrackDetails:345-359` (the existing top-of-function guard) | exact |
| `src/lib/stores/library.svelte.ts` | MOD | runes store | CRUD | **same file** `downloading`/`downloadProgress` `:33-45,168-199` (transient derived state) | exact |
| `src/lib/sources/types.ts` | MOD | model | — | **same file** `resolveByName:86-92`, `lrcUnresolved:94-104` (additive-optional marker) | exact |
| `src/lib/components/RowBadges.svelte` | MOD | component | — | **same file** (whole file, 51 lines) | exact |
| `src/lib/components/DownloadControl.svelte` | MOD | component | — | **same file** `:49-52` derived tri-state | exact |
| `src/lib/components/TrackMenu.svelte` | MOD | component | — | **same file** `:405-412` (`{#if}` affordance fork) | exact |
| `src/routes/(app)/settings/downloads/+page.svelte` | NEW | route (page) | — | `settings/playback/+page.svelte` (structure + full `<style>`) | exact |
| `src/routes/(app)/settings/+page.svelte` | MOD | route (index) | — | **same file** `groups` array `:14-24` | exact |
| `src/lib/i18n/{en,zh-Hans,zh-Hant,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi}.ts` | MOD ×15 | config (dict) | — | `en.ts:130-143` (`settings.group*` pairs) | exact |
| `src/lib/services/device-filename.test.ts` | NEW | test (pure) | — | `src/lib/services/download-filename.test.ts` | exact |
| `src/lib/services/device-track.test.ts` | NEW | test (pure) | — | same | exact |
| `src/lib/services/device-import.test.ts` | NEW | test (pure) | — | same | exact |
| `src/lib/services/blob-store.test.ts` | MOD | test (mocked Capacitor) | — | **same file** `:1-95` (the mock template) | exact |
| `src/lib/services/catalog.test.ts` | MOD | test | — | same file | exact |
| `src/lib/stores/library.svelte.test.ts` | MOD | test (runes + localStorage) | — | **same file** `:1-25` (localStorage stub) — **it already exists**, RESEARCH's "❔ check" is resolved | exact |
| `src/lib/stores/import-rules.svelte.test.ts` | NEW | test (runes) | — | `library.svelte.test.ts:1-25` | exact |
| `src/lib/services/fallback.ts` **or** the player fallback gate | MOD? | service | event-driven | *(no analog — see No Analog Found)* | none |
| ReDoS budget probe (inside `device-filename.ts`) | NEW | pure helper | transform | *(no analog — see No Analog Found)* | none |

---

## Pattern Assignments

### `MediaStoreSaverPlugin.kt` — `scanAudio` (native plugin, request-response)

**Analog:** the same file's `saveToMusic`. Copy its four-part shape exactly: *(1) validate args → reject,
(2) SDK/permission gate → `requestPermissionForAlias(..., "<name>PermsCallback")` and return,
(3) a `@PermissionCallback` that re-reads the args and re-enters, (4) a private `perform*` doing the work
in one `try/catch` → `call.reject(e.message ?: "...")`.*

**Permission declaration** (`:38-48`) — add aliases here, keep the existing one:
```kotlin
@CapacitorPlugin(
    name = "MediaStoreSaver",
    permissions = [
        Permission(strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE], alias = "publicMusic")
    ]
)
class MediaStoreSaverPlugin : Plugin() {
```

**Gate + callback pattern** (`:107-133`) — this is the template for the new `READ_MEDIA_AUDIO` flow:
```kotlin
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            getPermissionState("publicMusic") != PermissionState.GRANTED
        ) {
            requestPermissionForAlias("publicMusic", call, "publicMusicPermsCallback")
            return
        }

        performSave(call, fileName, sourcePath)
    }

    @PermissionCallback
    private fun publicMusicPermsCallback(call: PluginCall) {
        if (getPermissionState("publicMusic") != PermissionState.GRANTED) {
            call.reject("WRITE_EXTERNAL_STORAGE permission denied")
            return
        }
        val fileName = call.getString("fileName")
        val sourcePath = call.getString("sourcePath")
        if (fileName.isNullOrBlank() || sourcePath.isNullOrEmpty()) {
            call.reject("fileName and sourcePath are required")
            return
        }
        performSave(call, fileName, sourcePath)
    }
```
Note the callback **re-reads the args off the `PluginCall`** rather than closing over them — copy that.

**SDK-branched body + resolve shape** (`:144-173`) — `MediaStore.Audio.Media.getContentUri(...)`,
`ContentValues`, and `call.resolve(JSObject().put("uri", uri.toString()))`. The scan's resolve is
`JSObject().put("rows", JSArray()).put("total", n).put("version", v)`.

**Reject-on-throw tail** (`:192-194`):
```kotlin
        } catch (e: Exception) {
            call.reject(e.message ?: "saveToMusic failed")
        }
```

**Not-found-is-not-an-error** (`:222-225`) — `deleteFromMusic` swallows into `call.resolve()`. Use this
posture for a `scanAudio` page that legitimately returns zero rows; use `call.reject` only for a real
query failure (the TS side maps it to the `[]` sentinel either way).

---

### `src/lib/services/media-store.ts` — bridge typing

**Analog:** the whole file (32 lines). It is a comment header + one interface + one `registerPlugin`.
Add the new methods **to the existing interface** — do not create a second `registerPlugin` call.
```ts
import { registerPlugin } from '@capacitor/core';

export interface MediaStoreSaverPlugin {
	/** <JSDoc explaining the bridge contract AND what the TS side maps a reject to> */
	saveToMusic(opts: { fileName: string; sourcePath: string }): Promise<{ uri: string }>;
	deleteFromMusic(opts: { uri: string }): Promise<void>;
}

export const MediaStoreSaver = registerPlugin<MediaStoreSaverPlugin>('MediaStoreSaver');
```
House convention visible here: **every bridge method carries a JSDoc that names the never-throws mapping
on the TS side** (`media-store.ts:11-12`). New `scanAudio` / permission methods must do the same.

---

### `src/lib/services/blob-store.ts` — the `device:` branch (D-05, the single seam)

**Analog:** the same file's three native functions. All three share one shape: *`try` the platform call →
map every failure to the sentinel (`null` / `false` / `void`) → never rethrow.*

**`nativeGet` (`:135-153`) — the exact convertFileSrc + fetch + size-floor path to reuse:**
```ts
async function nativeGet(uid: string): Promise<Blob | null> {
	try {
		const { uri } = await Filesystem.getUri({ path: nativePath(uid), directory: NATIVE_DIR });
		// RAW fetch (not apiFetch — fetch→apiFetch audit): a LOCAL Capacitor file URI, not /api.
		const res = await fetch(Capacitor.convertFileSrc(uri));
		if (!res.ok) return null;
		const blob = await res.blob();
		return isUsableBlob(blob) ? blob : null;
	} catch {
		return null;
	}
}
```
The device read is this minus `Filesystem.getUri` (the content URI is derived from the uid) plus the
`blob.slice(0, blob.size, mime)` re-type from RESEARCH Pitfall 4. **`isUsableBlob` / `MIN_BLOB_BYTES`
(`:33-38`) already exist — reuse them, do not add a second size gate.**

**`nativeHas` (`:158-168`) — the truthful-badge branch (bite #4) attaches here:**
```ts
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

**`nativeDel` (`:170-190`) — where the Pitfall-1 refusal goes. The dangerous line is `:180`:**
```ts
	const uri = getStoredUri(uid);
	if (uri) {
		try {
			await MediaStoreSaver.deleteFromMusic({ uri });
		} catch { /* swallow */ }
		clearStoredUri(uid);
	}
```
Guard **above** `getStoredUri`, i.e. the first statement of `nativeDel`. Note `getStoredUri` /
`setStoredUri` / `clearStoredUri` (`:80-104`) are the existing try/catch-wrapped localStorage index
accessors — the D-09 merge lane writes through `setStoredUri`, it does not need a new index.

**Dispatch shape at each public export** (`:286-289`, `:303-306`) — the `device:` fork must sit *inside*
the native branch, mirroring this:
```ts
export async function has(uid: string): Promise<boolean> {
	if (!uid) return false;
	if (Capacitor.isNativePlatform()) return nativeHas(uid);
	…
}
```

---

### `src/lib/services/device-filename.ts` (pure service, transform)

**Analog:** `src/lib/services/download-filename.ts` — 37 lines, the literal inverse direction.

**Purity-contract header to mirror** (`download-filename.ts:1-11`):
```ts
// download-filename.ts — PURE, node-testable download-filename helpers (DL-FILE-01, D-08).
//
// PURITY CONTRACT (RESEARCH anti-pattern): this module MUST NOT import `$lib/stores/names` or any
// runes store … Keeping the helper store-free is what lets it live in the single Vitest node project
// (no jsdom, no runes).
```

**Extension set — source it from here, do not retype it** (`download-filename.ts:16`):
```ts
const AUDIO_EXT = /\.(mp3|flac|m4a|aac|ogg|wav)$/i;
```
UI-SPEC contract 5 adds `opus` OFF-by-default on top of this set. Export the list from ONE module so
import and export agree (RESEARCH "Don't Hand-Roll").

**Bracket / feat. stripping — IMPORT, do not rewrite** (`src/lib/services/match-key.ts:23-30`):
```ts
function norm(s: string): string {
	return (s || '')
		.toLowerCase()
		.replace(/[（(【\[].*?[)）\]】]/g, ' ') // drop (Live) / [Remaster] / 【...】
		.replace(/\s*-\s*(remaster|live|acoustic|explicit|feat\.?|ft\.?).*$/i, ' ')
		.replace(/[^\p{L}\p{N}]+/gu, '') // strip all punctuation/space (keeps CJK + latin + digits)
		.trim();
}
```
`norm` is module-private; only `matchKey` is exported. D-12's "strip bracketed tags" needs line 1 of
that chain **without** the punctuation-stripping line 3 (parsing must preserve display text). Either
export a `stripBrackets()` from `match-key.ts` or lift **those two regex literals verbatim** with a
comment pointing back at `match-key.ts:26-27` — do not author a third bracket regex.

---

### `src/lib/services/device-track.ts` (pure service, transform)

**Analog:** `src/lib/services/downloads-queue.ts` — a pure `Track[]` builder with a documented
never-throw/no-store contract. Copy the header shape (`:1-9`) and the defensive-input style (`:21-22`
`if (!Array.isArray(downloads) || downloads.length === 0) return [];`).

**uid minting** (`src/lib/sources/types.ts:141-143`) — use it, do not template-literal by hand:
```ts
export function makeUid(source: SourceId, songid: string): string {
	return `${source}:${songid}`;
}
```
RESEARCH recommends `device:<volumeName>-<_ID>`. The `-` fold precedent is `fivesingSongType`
(`types.ts:75-78`): *"songid is NOT unique across songtypes, so the uid folds songtype into the songid
via `${songtype}-${songid}`"*. Same reasoning, same separator.

**The additive-optional marker field** (RESEARCH option D). Copy the `resolveByName` declaration shape
verbatim — `types.ts:86-92`:
```ts
	/** A sourceless / songid-less name-only stub … `source`/`songid` on such a stub are
	 *  placeholders, never dispatched. Additive/optional so no existing construction or serialize
	 *  path changes (mirrors the Last.fm fields above). */
	resolveByName?: boolean;
```
A `device?: true` field declared in that exact style is a zero-risk `types.ts` edit; widening `SourceId`
(`types.ts:17-25`) is not — `SOURCES: Record<SourceId, SourceAdapter>` would stop compiling.

`isDeviceUid(uid)` belongs in this module and is the ONLY place a `'device:'` string literal may appear
outside it (same discipline as `matchKey` owning normalization).

---

### `src/lib/services/device-import.ts` (pure service, batch orchestration)

**Analog:** `src/lib/services/download-track.ts` — the repo's reference "orchestration that never throws
and returns a typed sentinel."

**Sentinel type + contract header** (`download-track.ts:8-22, 36`):
```ts
//   D-17 NEVER-THROWS: every failure path resolves a DownloadResult sentinel ('no-audio' | 'failed'),
//     never rejects. The caller localizes a toast off the result — this module NEVER navigates …
//     It deliberately imports NEITHER `$lib/i18n` NOR `$lib/stores/toast`: the i18n `t()` reads runes
//     `$state` and would break the single node Vitest project, and text localization is the UI layer's job

export type DownloadResult = 'saved' | 'no-audio' | 'failed';
```
**This is load-bearing for the import service:** it must return a structured result
(`{ status: 'ok' | 'denied' | 'failed', added, dropped, merged, skipped }`) and **must not import `t()`
or `toast`**. The settings page localizes. CLAUDE.md: *"stores emit a `TranslationKey`, a layout host
maps it via `t()`."*

**try / catch-sentinel / finally-cleanup skeleton** (`download-track.ts:129-160`):
```ts
	} catch {
		// DL-BUG-01 (D-09): a fetch/blob failure returns 'failed' …
		return 'failed';
	} finally {
		// DL-STATE-01: clear the per-uid spinner on every exit path.
		library.endDownload(track.uid);
	}
```

**Never-throw network boundary, for the per-page `scanAudio` call** — `itunes-cover.ts:12-19` states the
posture and `:168-182` implements it (`if (signal?.aborted) return null; … if (!res.ok) return null; …
catch { return null; }`). A rejected `scanAudio` page → `[]` for that page, not a thrown import.

---

### `src/lib/stores/import-rules.svelte.ts` (runes store, localStorage CRUD)

**Analog:** `src/lib/stores/searchHistory.svelte.ts` — 62 lines, the *whole file* is the pattern. It is
the "thin runes wrapper over a pure logic module" shape, and it owns the `openmusic:<domain>:v<N>` key
indirection (the key constant lives in the **pure** module, not the store).

```ts
// searchHistory.svelte.ts — WRAPS the pure node-testable logic module … Persisted to
// localStorage `openmusic:search-history:v1`, SSR-guarded.
import { browser } from '$app/environment';
import { SEARCH_HISTORY_KEY, parseSearchHistory, recordQuery, … } from '$lib/search/search-history-logic';

class SearchHistory {
	entries = $state<SearchHistoryEntry[]>([]);
	private loaded = false;

	/** Hydrate from localStorage once, in the browser. Call from the search page onMount. */
	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			this.entries = parseSearchHistory(localStorage.getItem(SEARCH_HISTORY_KEY));
		} catch {
			/* corrupt/unavailable — start empty */
		}
	}

	add(query: string) { this.entries = recordQuery(this.entries, query); this.save(); }

	private save() {
		if (!browser) return;
		try {
			localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(this.entries));
		} catch {
			/* quota — non-fatal */
		}
	}
}

export const searchHistory = new SearchHistory();
```
Note precisely: `private loaded` is a **plain field, not `$state`** (CLAUDE.md's internal-counter rule);
`load()` is idempotent + `browser`-guarded; both localStorage touches are in `try/catch`; the singleton
is the only export. `library.svelte.ts:46-60` is the same shape with a `Partial<Shape>` tolerant parse
(`v.downloads ?? []`) — copy that for the rules payload so an old/absent key cannot break `load()`.

**Generation guard for the scan (a second import tap must not interleave)** — `player.svelte.ts:342,424`
declare them as plain fields:
```ts
	private pendingGen = 0;
	/** … it's an internal supersedence guard, like pendingGen */
	private playGen = 0;
```
and `reresolveCurrent` (`:641-668`) is the canonical usage — snapshot at entry, re-check after **every**
await:
```ts
	private async reresolveCurrent() {
		…
		const myGen = this.playGen;
		try {
			const resolved = await ensureTrackDetails(stub);
			if (myGen !== this.playGen) return; // newer play() superseded
			…
				const blob = await blobStore.get(resolved.uid).catch(() => null);
				if (myGen !== this.playGen) return; // WR-02: a newer play() landed mid-IDB-read
```
The import loop bumps `importGen` at the top of `runImport()` and re-checks after each `scanAudio` page.

**Progress `$state` shape** — `library.svelte.ts:33-45` is the closest precedent for "transient,
never-persisted reactive progress", and its comment explains *why* it is a separate field rather than a
richer value. The `downloadProgress` copy-on-write reassign (`:191-199`) is the idiom for a progress map.

---

### `src/lib/services/catalog.ts` — the `ensureTrackDetails` guard (bite #1, MANDATORY)

**Analog:** the same function's existing guard, `:345-359`:
```ts
export async function ensureTrackDetails(
	track: Track,
	signal?: AbortSignal,
	quality?: DefaultQuality
): Promise<Track> {
	if (isTrackReady(track)) return track;
	const resolved = await resolveTrackDetails(track, signal, quality);
	…
}
```
The device guard goes **above** `isTrackReady(track)` — RESEARCH Open Q5: a local file has no
`resolvedAt` semantics, so it must never reach the freshness check. The line it protects is `:518`:
```ts
	const resolved = fromMid ?? (await SOURCES[track.source].resolve(track, sig, quality));
```
The doc-comment on `ensureTrackDetails` (`:335-344`) already argues *"This wrapper owns the guard … so
both live at exactly ONE seam"* — the new guard extends that sentence, it does not contradict it.

---

### `src/lib/stores/library.svelte.ts` — unavailable state (D-06) + removeDownload guard (bite #3)

**Analog:** the same file's `downloading` / `downloadProgress` pair — the established way to add a new
per-uid state without touching the persisted shape.

**The declaration comment style to copy** (`:33-45`) — it states persistence, transience, and *why*:
```ts
	/** D-10 (DL-STATE-01): uids with a download IN FLIGHT — the single reactive source of
	 *  truth every download affordance … Deliberately kept OFF the player (D-18 …) and
	 *  TRANSIENT — never in the persisted payload / LibShape (a corrupt store can't wedge a
	 *  stuck spinner). begin/endDownload reassign a NEW Set … so the runes graph re-renders */
	downloading = $state<Set<string>>(new Set());
```
**Decide and document:** `unavailable` should be transient-per-session (recomputed on each import /
first failed read) OR persisted via `LibShape`. If persisted, it goes in `LibShape` (`:18-24`) and the
tolerant load (`:56-59` `v.downloads ?? []`) — that pattern already handles a missing field for free.

**The line that must change** (`:210-216`):
```ts
	removeDownload(uid: string) {
		this.downloads = this.downloads.filter((t) => t.uid !== uid);
		this.save();
		// kyf: also drop the cached blob so the offline cache stays consistent with the
		// registry (never throws — browser/SSR + IDB-missing return no-op).
		void blobStore.del(uid);
	}
```
RESEARCH Pitfall 10 recommends the D-06 guard live **here** (one place, both callers covered), with
`blobStore.del`'s refusal as the independent second guard.

**Public-API method style** (`:201-209`) — one-liners, `this.save()` after every mutation:
```ts
	isDownloaded(uid: string): boolean {
		return this.downloads.some((t) => t.uid === uid);
	}
```
`isUnavailable(uid)` (named by UI-SPEC contract 8) is this shape.

---

### `src/lib/components/RowBadges.svelte` — the unavailable glyph (UI-SPEC contract 8)

**Analog:** the whole file (51 lines). The edit is two lines inside an established structure:
```svelte
	import { Heart, Check } from '@lucide/svelte';
	import { library } from '$lib/stores/library.svelte';
	import { t } from '$lib/i18n';

	let { uid, size = 14 }: { uid: string; size?: number } = $props();

	const liked = $derived(!!uid && library.isLiked(uid));
	const downloaded = $derived(!!uid && library.isDownloaded(uid));
</script>

{#if liked || downloaded}
	<span class="row-badges">
		…
		{#if downloaded}
			<span class="rb downloaded" aria-label={t('menu.downloaded')} title={t('menu.downloaded')}><Check {size} /></span>
		{/if}
	</span>
{/if}
```
Conventions visible: per-icon lucide import; `$props()` destructure with an inline type; `$derived`
guarded on `!!uid`; **every glyph carries both `aria-label` and `title` from a `t()` key**; the colour
lives in the scoped `<style>` (`.rb.downloaded { color: var(--color-text-muted); opacity: 0.6; }`), not
inline — so the new `#ff7a90` unavailable colour gets its own `.rb.unavailable` rule.

**`DownloadControl.svelte`** — the fork attaches to the derived block at `:49-52`:
```ts
	const uid = $derived(resolved?.uid ?? track?.uid ?? '');
	const isDownloaded = $derived(!!uid && library.isDownloaded(uid));
	const isDownloading = $derived(localBusy || (!!uid && library.downloading.has(uid)));
```

**`TrackMenu.svelte`** — the Share/Download hide. The affordance-fork idiom is already there (`:405-412`);
extend the condition, do not add a wrapper:
```svelte
				{#if library.downloading.has(track.uid)}
					<button class="hd-btn" disabled aria-busy="true" …><span class="row-spinner motion-always"></span></button>
				{:else if blobPresent === true}
					<button class="hd-btn" disabled aria-disabled="true" …><Check size={20} /></button>
				{:else}
					<button class="hd-btn" aria-label={t('menu.download')} onclick={startDownload} use:tapBounce><Download size={20} /></button>
				{/if}
```
Share is the unconditional row at `:492`. UI-SPEC is explicit: **do not overload
`src/lib/components/track-menu-gate.ts`** — it holds resolve *timing* decisions, not visibility.

---

### `src/routes/(app)/settings/downloads/+page.svelte` (new route)

**Analog:** `src/routes/(app)/settings/playback/+page.svelte` (188 lines). Copy its skeleton and its
**entire `<style>` block** — UI-SPEC says this phase introduces no new token, and `.chip` / `.seg` /
`.row-toggle` / `.sw` / `.muted` / `section h2` are all defined there.

**Script head** (`playback:1-12`):
```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Music, Radio, Zap, … Download, Sliders } from '@lucide/svelte';
	import { settings, type DefaultQuality, type DefaultSource } from '$lib/stores/settings.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t, type TranslationKey } from '$lib/i18n';

	onMount(() => settings.load());
```

**Header** (`playback:71-75`) — `settings.backToSettings`, not `common.back`:
```svelte
<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')} use:tapBounce><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupPlayback')}</h1>
	<button class="reset" onclick={() => { if (confirm(t('settings.resetConfirm'))) { settings.resetPlayback(); } }} use:tapBounce>{t('settings.resetGroup')}</button>
</header>
```

**A section with chips + a note** (`playback:97-105`) — the rules-panel control template:
```svelte
<section>
	<h2><Radio size={15} /> {t('settings.defaultSource')}</h2>
	<div class="chips">
		{#each sources as s (s.v)}
			<button class="chip" class:on={settings.defaultSource === s.v} onclick={() => setSource(s.v)} use:tapBounce>{s.key ? t(s.key as TranslationKey) : s.literal}</button>
		{/each}
	</div>
	<p class="muted">{t('settings.defaultSourceNote')}</p>
</section>
```

**A toggle row** (`playback:107-118`) — for the parsing-preset checkboxes:
```svelte
	<button class="row-toggle" onclick={toggleExpand}>
		<span><Maximize2 size={16} /> {t('settings.autoExpand')}</span>
		<span class="sw" class:on={settings.autoExpandOnPlay}></span>
	</button>
	<p class="muted">{t('settings.autoExpandDesc')}</p>
```

**Progressive disclosure for the advanced regex field** (`playback:147-157`) — the `<details>` accordion
already exists and is styled:
```svelte
<details class="advanced">
	<summary><Sliders size={15} /> {t('settings.sourcesAdvanced')}</summary>
	<div class="chips">…</div>
	<p class="muted">{t('settings.sourcesAdvancedNote')}</p>
</details>
```

**A literal-vs-translated label list** (`playback:14-28`) — the exact idiom UI-SPEC needs for the
extension chips (`mp3`/`flac` stay literal, chrome is a key):
```ts
	// Quality tokens (320k/128k) are literal; Auto/Lossless are chrome.
	const qualities: { v: DefaultQuality; key?: string; literal?: string }[] = [
		{ v: 'auto', key: 'settings.optAuto' },
		{ v: '320', literal: '320k' },
	];
```

**Transient result message + counts** — `settings/data/+page.svelte:16-24,25` is the closer analog for
the post-scan summary:
```ts
	let msg = $state('');
	let counts = $state({ liked: 0, playlists: 0, downloads: 0 });

	onMount(() => { settings.load(); library.load(); counts = { … }; });

	function flash(m: string) { msg = m; setTimeout(() => (msg = ''), 1800); }
```

**Registering the row** — `settings/+page.svelte:14-24`, a one-line array entry:
```ts
	const groups: { href: string; icon: Component; title: TranslationKey; desc: TranslationKey }[] = [
		{ href: '/settings/playback', icon: Music, title: 'settings.groupPlayback', desc: 'settings.groupPlaybackDesc' },
		{ href: '/settings/data', icon: Database, title: 'settings.groupData', desc: 'settings.groupDataDesc' },
	];
```
UI-SPEC contract 7 requires this row to be filtered on `Capacitor.isNativePlatform()` — **no route in
`src/routes/` currently gates on that**, so it is new here; keep it to the two places UI-SPEC names.

---

### `src/lib/i18n/*.ts` (15 locale dictionaries)

**Analog:** `en.ts:130-143`. Double quotes on **key and value**, grouped under a `// --- comment ---`,
title/desc in pairs:
```ts
	"settings.groupData": "Data",
	"settings.groupDataDesc": "Library counts, clear data",
	"settings.groupActivity": "Activity log",
	"settings.groupActivityDesc": "Verbose player action log",
```
`en.ts:1-4` states the contract: *"SOURCE / REFERENCE locale … All locale files MUST expose an IDENTICAL
key set."* `en` defines `TranslationKey` → a missing key in `en` is a compile error; a missing key
elsewhere fails `i18n.test.ts`. Locale files present: `ar de en es fr hi id it pt ru th tr vi zh-Hans
zh-Hant` (15). Interpolation precedent for the summary counts: `t('settings.dataCounts', { liked, playlists, downloads })`
(`settings/data/+page.svelte:52`).

---

### Test files

**Pure `.ts` tests** (`device-filename` / `device-track` / `device-import`) — analog
`download-filename.test.ts`. No mocks needed at all; these modules import nothing from `$app` or a store.
`vite.config.ts` sets `expect.requireAssertions: true` — every `it()` must assert.

**Capacitor-boundary tests** (`blob-store.test.ts`) — **copy `blob-store.test.ts:19-88` verbatim**, do not
author a new mock set:
```ts
vi.mock('$app/environment', () => ({ browser: true }));

const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
	Capacitor: {
		isNativePlatform: () => isNativePlatform(),
		// WR-03: native get() resolves the file URI and streams it via convertFileSrc + fetch.
		convertFileSrc: (uri: string) => `http://localhost/_capacitor_file_${uri}`
	}
}));

const getUri = vi.fn(…); const deleteFile = vi.fn(…);
const stat = vi.fn((_opts: { path: string; directory: string }) => Promise.resolve({ size: 200000 }));
vi.mock('@capacitor/filesystem', () => ({
	Filesystem: { getUri: (o: unknown) => getUri(o as never), deleteFile: …, stat: … },
	Directory: { Data: 'DATA', External: 'EXTERNAL' }
}));

const saveToMusic = vi.fn(…); const deleteFromMusic = vi.fn((_opts: { uri: string }) => Promise.resolve());
vi.mock('./media-store', () => ({ MediaStoreSaver: { saveToMusic: …, deleteFromMusic: … } }));

function installLocalStorageShim() {
	const map = new Map<string, string>();
	const ls = { getItem: (k) => …, setItem: …, removeItem: …, clear: …, key: …, get length() { return map.size; } };
	vi.stubGlobal('localStorage', ls);
	return map;
}
```
Extensions needed: `convertFileSrc` must also map `content:/` → `/_capacitor_content_`; the
`./media-store` factory gains `scanAudio`; `global.fetch` is stubbed to return a sized `Blob`. The
Pitfall-1 test is `expect(deleteFromMusic).not.toHaveBeenCalled()` — `deleteFromMusic` is already a
`vi.fn` in this file, so that assertion is free.

**Runes-store tests** — `library.svelte.test.ts:1-25` **already exists** (RESEARCH's "❔ check" is
resolved). Its localStorage stub is the template:
```ts
vi.mock('$app/environment', () => ({ browser: true }));
import { library } from './library.svelte';

const memStore = new Map<string, string>();
const localStorageMock: Storage = {
	get length() { return memStore.size; },
	clear: () => memStore.clear(),
	getItem: (k: string) => (memStore.has(k) ? (memStore.get(k) as string) : null),
	key: (i: number) => Array.from(memStore.keys())[i] ?? null,
	removeItem: (k: string) => void memStore.delete(k),
	setItem: (k: string, v: string) => void memStore.set(k, String(v))
};
vi.stubGlobal('localStorage', localStorageMock);
```

---

## Shared Patterns

### 1. Never-throw service boundary
**Source:** `src/lib/services/itunes-cover.ts:13-19` (the contract, stated), `:168-182` (the code),
`blob-store.ts:135-153` (file-I/O flavour), `download-track.ts:8-13` (sentinel flavour).
**Apply to:** `device-import.ts`, `device-track.ts`, the new `blobStore` device branch, the
`media-store` scan wrapper.
```
//  - This module only BUILDS the search URL and does a BOUNDED `fetch`. Every network path
//    NEVER throws: a non-ok response / empty results / malformed JSON / abort / any throw all
//    return null. A null → the caller leaves the gradient (never a broken image …)
```
Rule extracted: **throw internally so a transient failure is never cached, map to the sentinel at the
exported boundary.** Sentinels in use: `null`, `false`, `[]`, `void`, `'failed'`.

### 2. Fix the shared function, never the call sites
**Source:** `blob-store.ts:28-33` — the comment that justifies `MIN_BLOB_BYTES` living at one read
boundary. Same argument D-05 makes for the device branch. Quote it in the new code's comment.
```
// … A rejected Blob is returned as `null` — i.e. it behaves EXACTLY like a cache miss, and every
// reader (restore / reresolveCurrent / play) already falls through … That is why the gate lives at
// this single read boundary instead of at the three call sites: one guard, zero call-site cost, no
// reader can forget it.
```

### 3. Generation guard
**Source:** `player.svelte.ts:342,424` (plain private fields), `:641-668` (usage).
**Apply to:** the paged scan loop in the import store.
Idiom: bump at the top of the async entry point; `const myGen = this.importGen;` then
`if (myGen !== this.importGen) return;` after **every** await.

### 4. `browser` + `isNativePlatform()` guarding
**Source:** `searchHistory.svelte.ts:25,53` (`if (!browser) return`), `blob-store.ts:286-288`
(`if (Capacitor.isNativePlatform())`), `cover-version.svelte.ts:14-16` (why a `.svelte.ts` is SSR-safe).
**Apply to:** the rules store, the settings page, the import service.

### 5. Decision-ref comments
**Source:** every file read. Every non-obvious line carries `D-NN` / `WR-NN` / `quick-NNNNNN-xxx`.
**Apply to:** all new files — RESEARCH mandates `34-D-NN` refs.
Concrete example (`download-track.ts:101-103`): a comment that names the decision, the reason, and the
bug it prevents.

### 6. Runes conventions
- Store singleton: `export const library = new Library();` (`library.svelte.ts:227`).
- Public reactive field: `downloads = $state<Track[]>([]);` — explicit generic.
- Internal counter: `private loaded = false;` / `private playGen = 0;` — **plain field**.
- Component props: `let { uid, size = 14 }: { uid: string; size?: number } = $props();` (`RowBadges:15`).
- Component derived: `const liked = $derived(!!uid && library.isLiked(uid));`.
- Copy-on-write reassign for reactive maps/sets (`library.svelte.ts:172,193`).

### 7. Shared primitives — IMPORT, do not re-inline
CLAUDE.md's table, checked against this phase's temptations:

| Temptation in Phase 34 | Import this instead | Location |
|---|---|---|
| A bracket/`feat.`-stripping regex for D-12 | `match-key.ts` `norm()` regexes | `services/match-key.ts:26-27` |
| An audio-extension regex for the D-12 chips | `AUDIO_EXT` | `services/download-filename.ts:16` |
| A filesystem-name sanitizer | `buildDownloadFilename` char class | `services/download-filename.ts:36` |
| A "is this track playable" check | `isTrackReady` / `hasFreshAudioUrl` | `services/track-ready.ts` |
| A size floor for the device blob | `isUsableBlob` / `MIN_BLOB_BYTES` | `services/blob-store.ts:33-38` |
| A caller-signal + timeout combiner | `combinedSignal` | `services/abort-signal.ts` |
| A same-song matcher for the D-09 merge | `matchKey(artist, title)` | `services/match-key.ts:37` |
| A uid builder | `makeUid` | `sources/types.ts:141` |
| A second `registerPlugin('MediaStoreSaver')` | the existing export | `services/media-store.ts:32` |
| A localStorage content-URI index | `getStoredUri`/`setStoredUri`/`clearStoredUri` | `services/blob-store.ts:80-104` |

---

## Conventions

Derived from the repo (`gsd-tools verify conventions --derive --scope src/lib/services`, n=103 files):

| Axis | Dominant | Share | Entropy | Status |
|---|---|---|---|---|
| file-name casing | *(none)* — `kebab` 39 / `camel` 17 / `other` 47 | 46% | 0.931 | contested hotspot |
| identifier casing | `camel` (310/319) | 97% | 0.133 | named contract |
| export style | `esm` (50/50) | 100% | 0 | named contract |
| import style | `esm` (83/83) | 100% | 0 | named contract |

**file-name casing is a measurement artifact, not a real split.** The 47-file `other` bucket is the
repo's *dotted* suffixes — `x.test.ts` and `x.svelte.ts` — which the deriver cannot classify. The actual
rule is stated in CLAUDE.md and holds everywhere: **kebab-case for pure `.ts` services**
(`download-filename.ts`, `match-key.ts`, `blob-store.ts`), **`<name>.svelte.ts` for runes stores**
(suffix REQUIRED so the Vite plugin transforms runes), **PascalCase for components**, **co-located
`<name>.test.ts` / `<name>.svelte.test.ts`**. So: `device-filename.ts`, `device-track.ts`,
`device-import.ts`, `import-rules.svelte.ts`, `device-import.test.ts`.

**Contested hotspots (author's choice).** The prototype intentional-contested split in this ecosystem is
the **CJS↔SDK dual resolver** — `bin/lib/**` is CJS (`module.exports`/`require`), `sdk/src/**` is ESM
(`export`/`import`); each half is internally consistent per-directory and contested only repo-wide.
Reviewers and planners match the **directory's local style**, not the repo-wide majority. This repo has
no CJS half (100% ESM), but the same rule applies to its own local outlier:
`settings/appearance/+page.svelte` uses 4-space indent + double quotes while every other settings page
uses tabs + single quotes. UI-SPEC line 32 rules explicitly: *that file is the OUTLIER; do not copy it.*
New files under `src/routes/(app)/settings/` follow `playback/` and `data/`. `src/lib/i18n/*.ts` is the
other deliberate local deviation — double quotes for every key AND value, enforced by convention only.

---

## No Analog Found

| File / concern | Role | Data Flow | Reason |
|---|---|---|---|
| ReDoS save-time probe + scan budget-abort (inside `device-filename.ts`) | pure helper | transform | No user-supplied regex is compiled anywhere in `src/`. No `performance.now()` budget loop exists. RESEARCH Pitfall 8 is the only design input; the 50 ms / 2 s numbers are unmeasured. |
| Free-text `<input type="text">` / `<textarea>` styling | component | — | UI-SPEC line 381: **no text input exists anywhere in `src/`**. UI-SPEC sets the styling itself; there is nothing to copy from. |
| Barring cross-source fallback for `device:` uids (RESEARCH bite #6 / Open Q2) | service | event-driven | `fallback.ts` has no per-track opt-out; every existing gate is per-*source*. Planner decision, no precedent. |
| `Capacitor.isNativePlatform()` gating inside a route/component | route | — | First UI-layer native gate in the app — every existing call is in `src/lib/services/*` or `player.svelte.ts:1246`. Copy the *call*, but there is no UI precedent for the conditional-render shape. |
| MediaStore paged cursor query in Kotlin | native plugin | batch | `MediaStoreSaverPlugin.kt` is write-only today — no `contentResolver.query` anywhere in `android/`. The `@PluginMethod` *envelope* has an exact analog (`saveToMusic`); the cursor body does not. RESEARCH's sketch (§"Pattern 2") is the input. |

---

## Metadata

**Analog search scope:** `src/lib/services/`, `src/lib/stores/`, `src/lib/components/`, `src/lib/sources/`,
`src/lib/i18n/`, `src/routes/(app)/settings/**`, `android/app/src/main/`
**Files read this session:** 22
**Pattern extraction date:** 2026-09-13
