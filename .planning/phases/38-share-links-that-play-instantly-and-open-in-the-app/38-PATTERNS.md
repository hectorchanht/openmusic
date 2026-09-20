# Phase 38: Share links that play instantly and open in the app - Pattern Map

**Mapped:** 2026-09-20
**Files analyzed:** 11 (3 new, 8 modified — the i18n set counts as one)
**Analogs found:** 9 / 11 (2 have no in-repo analog: the Capacitor listener, `assetlinks.json`)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/services/share-arrival.ts` (NEW) | service (pure) | transform + orchestrate | `src/lib/services/track-ready.ts` + `url-safety.ts` (pure predicate modules); `share.ts` `parseEntityParam` (safe parse) | exact |
| `src/lib/services/share-arrival.test.ts` (NEW) | test | — | `src/lib/services/match-key.test.ts` (pure, zero mocks); `fallback.test.ts` (mocked-registry shape) | exact |
| `static/.well-known/assetlinks.json` (NEW) | config / static asset | file-I/O (CDN) | `static/manifest.webmanifest`, `static/robots.txt` | partial (layout only) |
| `src/lib/services/share.ts` (MOD) | service (pure) | transform | itself — `songShareUrl` / `entityShareUrl` / `parseEntityParam` are the in-file precedent | exact |
| `src/lib/services/share.test.ts` (MOD) | test | — | itself (`describe('songShareUrl …')` at `:312`) | exact |
| `src/lib/stores/player.svelte.ts` (MOD) — `armTrack` | store method | request-response + persistence | `restore()` `player.svelte.ts:553-654` | exact |
| `src/lib/stores/player.svelte.ts` (MOD) — `spliceAndPlay` | store method | CRUD (queue) | `playNext()` `:2633-2641` + `relatedTapPlay` `NpRelated.svelte:151-166` | exact |
| `src/routes/(app)/song/[artist]/[title]/+page.svelte` (MOD) | route (SSR landing) | request-response | itself + `song/[slug]/+page.svelte:49-77` (character-identical sibling) | exact |
| `src/routes/(app)/song/[slug]/+page.svelte` (MOD) | route (SSR landing) | request-response | same as above | exact |
| `src/routes/(app)/+page.svelte` (MOD) — `?play=` decoder | route | event-driven (URL param) | itself `:669-686`; target shape is `NpRelated.svelte:151` | exact |
| `src/lib/components/NpRelated.svelte` (MOD) | component | event-driven (tap) | itself `:151-166` (this is a net DELETION) | exact |
| `src/lib/i18n/*.ts` × 15 (MOD) | config (dictionary) | — | `"toast.playingNext"` (`en.ts:394`, sibling line in all 15) | exact |
| `android/app/src/main/AndroidManifest.xml` (MOD) | config (native) | — | its own existing MAIN/LAUNCHER `<intent-filter>` + the commented `<uses-permission>` block | role-match |
| Capacitor deep-link listener (NEW or folded into `src/routes/+layout.svelte`) | route/provider | event-driven | **no `addListener` exists anywhere in `src/`** — composite: `Capacitor.isNativePlatform()` guard (`player.svelte.ts:1460`) + `$effect` teardown idiom (`NowPlaying.svelte:87-93`) + `untrack` mount rule (`+layout.svelte:22-40`) | **no direct analog — composite** |

---

## Pattern Assignments

### `src/lib/services/share-arrival.ts` (NEW — pure service)

**Analogs:** `src/lib/services/track-ready.ts`, `src/lib/services/url-safety.ts`, `src/lib/services/abort-signal.ts`

**Module-header pattern.** Every pure service in this repo opens with a `//` block that is a DECISION RECORD, not a description — it names the bug/duplication that caused the file to exist, then a `/** … */` JSDoc per export explaining the semantic distinction. Copy this shape verbatim (`url-safety.ts:1-27`):

```typescript
// url-safety — the shared https predicate used by every cover/art path.
//
// This existed as SIX byte-identical copies under four different names: `httpsOnly`
// (player.svelte.ts, attached-cover.ts), `isHttps` (lazyCover.ts, upnext-covers.ts, similar.ts) and
// `isSolidCover` (cover-backfill.ts). Each carried a comment explaining why it was inline — some
// variant of "kept inline so this module stays a PURE, node-testable .ts with no store import".
//
// That reasoning was sound about the DEPENDENCY and wrong about the REMEDY: what those modules
// needed to avoid was importing from `player.svelte.ts` (a runes store), not sharing a predicate.
// A dependency-free `.ts` — this file — satisfies both. […]

/**
 * True when `url` is a string whose scheme is https.
 *
 * The cover pipeline's meaning of "usable": an http or protocol-relative image is blocked as mixed
 * content on the deployed https origin […] Deliberately a PREFIX test, not a URL parse — this runs
 * per tile on render paths.
 */
export function hasHttpsScheme(url: string | null | undefined): url is string {
	return typeof url === 'string' && url.startsWith('https:');
}
```

**Import pattern for a pure service** (`track-ready.ts:20-21`) — `$lib/` alias, `import type` for types:

```typescript
import { RESOLVE_URL_TTL_S } from '$lib/proxy/resolve-cache';
import type { Track } from '$lib/sources/types';
```

**Small-exported-predicate pattern for `arrivalMode()`** — `track-ready.ts:38-54` is the closest size/shape match: one private helper + two named exports, each with a JSDoc that names WHICH callers ask that question:

```typescript
function isUrlFresh(track: Track): boolean {
	return (
		typeof track.resolvedAt === 'number' && Date.now() - track.resolvedAt < RESOLVED_URL_MAX_AGE_MS
	);
}

/**
 * "Can this track be handed to `<audio>` right now?" — it has a resolved url AND that url is still
 * inside the trust window.
 *
 * The question every PRE-WARM / REUSE path asks (player.warmAfter, prewarmTrack, …). None of
 * them care whether lyrics have landed.
 */
export function hasFreshAudioUrl(track: Track): boolean {
	return Boolean(track.detailsLoaded && track.audioUrl) && isUrlFresh(track);
}
```

**Never-throw-sentinel + closed-allowlist parse** — see `## Shared Patterns → Safe parse` below. The deep-link host check must copy `safe-image-url.ts` and the uid carrier must copy `parseEntityParam`.

**Threading a signal (`combinedSignal`)** — `abort-signal.ts:18-23`. Do NOT hand-roll an `AbortController` pair:

```typescript
export function combinedSignal(timeoutMs: number, caller?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	if (!caller) return timeout;
	const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([caller, timeout]) : timeout;
}
```

**Track-stub construction** — copy the field set of `share.ts:89-101` `stubToTrack` exactly. Missing fields silently change `isTrackReady`/resolve behaviour:

```typescript
/** Rehydrate a persisted stub into a full (unresolved) Track — audio URL/lyrics re-fetched on play. */
function stubToTrack(v: Stub): Track {
	return {
		...v,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: v.title,
		displayIndex: 1
	};
}
```

⚠️ **This module must NOT statically import `$lib/stores/player.svelte`** if the landing pages import it eagerly. The simpler contract (and the one the pages already hold) is: the pages `await import('$lib/services/share-arrival')` inside `onMount`, so this module may import the player store.

---

### `src/lib/services/share-arrival.test.ts` (NEW — test)

**Analog:** `src/lib/services/match-key.test.ts` (zero mocks, pure) — the right shape for `arrivalMode` / the carrier parse / the deep-link URL parse.

**Imports + header + describe naming** (`match-key.test.ts:1-9`) — the header comment states WHAT the unit is authoritative for and what is explicitly OUT of scope:

```typescript
import { describe, it, expect } from 'vitest';
import { matchKey } from './match-key';

// matchKey is the single source of truth for the {artist}+{title} normalization used
// to align Last.fm names with local tracks (Phase 8) and — reused — by Phase 13
// loved-sync reconciliation. These tests pin the deterministic, case/space/punct-
// insensitive, bracket-/feat.-suffix-folding behavior. CJK Traditional/Simplified
// folding is explicitly OUT (deferred to Phase 13).
describe('matchKey — {artist}+{title} normalization primitive', () => {
	it('is deterministic and stable for the same inputs', () => {
		expect(matchKey('Jay Chou', 'Dao Xiang')).toBe(matchKey('Jay Chou', 'Dao Xiang'));
	});
```

Note the relative `./match-key` import for the module under test (not `$lib/`), and the hostile-input case at `:44-48` — copy this for the carrier parse (`''`, garbage, unknown source, `undefined`):

```typescript
	it('tolerates empty / missing inputs without throwing', () => {
		expect(matchKey('', '')).toBe('|');
		// @ts-expect-error — guard against undefined at runtime even though typed string
		expect(matchKey(undefined, undefined)).toBe('|');
	});
```

If `arriveShared()` needs the registry/catalog mocked, copy `fallback.test.ts:10-42`'s `vi.mock` block — note each mock carries a comment explaining what the mock must MIRROR about the real thing:

```typescript
vi.mock('$lib/services/catalog', () => ({ searchAll: vi.fn(), ensureTrackDetails: vi.fn() }));
```

⚠️ `vite.config.ts` sets `expect.requireAssertions: true` — every `it()` must assert.

---

### `src/lib/services/share.ts` (MOD — uid carrier emit + D-30 enum fix)

**Analog:** itself. `songShareUrl` `:415-426` is the function being modified:

```typescript
export function songShareUrl(
	t: { title: string; artist: string },
	coverUrl?: string | null,
	itunesId?: string | null
): string {
	const base = shareOrigin(); // quick-260919-0mw — public origin when the runtime one is localhost/capacitor/file
	const path = `${base}/song/${encodePathSegment(t.artist)}/${encodePathSegment(t.title)}`;
	// quick-260809-3uo: a cover that does not tokenize adds NO param at all — never `?ci=` empty,
	// never a junk value. The path segments are untouched, so raw CJK survives (quick-260807-vl1).
	const token = coverToken(coverUrl, itunesId);
	return usableToken(token) ? `${path}?ci=${encodeURIComponent(token)}` : path;
}
```

Pattern to preserve: an absent carrier appends **NO param at all** (`quick-260809-3uo`) — the `?u=` addition must follow the same rule (no `?u=` when there is no uid). The `?` vs `&` join when `ci` is present is the one new branch.

**D-30 — the stale enum** (`share.ts:459-470`). Both regexes must be updated together; the comment block above them already carries a `24-04 reconcile` note, so the fix extends that record rather than replacing it:

```typescript
/** The fixed source enum the readable share path encodes. Because source names are a closed
 *  set, `{source}{id}` is unambiguously separable from the cosmetic slug (D-04 / A7). This list
 *  MUST stay aligned with the live `SourceId` union in $lib/sources/types (24-04 reconcile: […] */
const ENTITY_SOURCE_RE = /^.*-(netease|qq|kuwo|joox|fivesing|jamendo)([A-Za-z0-9]+)$/;
const ENTITY_SOURCE_ONLY_RE = /^(netease|qq|kuwo|joox|fivesing|jamendo)([A-Za-z0-9]+)$/;
```

**Signature extension pattern** — add the uid as a **4th** positional argument (`t, coverUrl?, itunesId?, uid?`). This keeps `TrackMenu.svelte:783`'s call on ONE line with the first two args unchanged, which is what `share.test.ts:834`'s source-text regex pins.

---

### `src/lib/services/share.test.ts` (MOD — extend)

**Analog:** itself. The suite already owns a `songShareUrl` describe (`:312`) and the exact assertions that will go RED.

Three RED-on-landing families, all listed with line numbers in `## Shared Patterns → Pinned source-text tests` below. The safest way to extend without touching them: add a NEW `describe` for the carrier and adjust only the assertions the carrier genuinely invalidates.

**Existing shape to copy** (`:766-778`) — note the negative-case loop and the "exactly one `?`" assertion, both directly reusable for `?u=`:

```typescript
	it('a cover that tokenizes to NULL adds no param at all (never an empty or junk `ci=`)', () => {
		for (const cover of [null, undefined, '', 'https://p1.music.126.net/x/1.jpg', REAL_LF_GREY])
			expect(songShareUrl({ title: 'A', artist: 'B' }, cover)).not.toContain('?');
	});

	it('a tokenizable cover appends exactly one encoded ci, leaving the raw-CJK path intact', () => {
		const url = songShareUrl({ title: '你瞞我瞞', artist: '陳柏宇' }, REAL_DZ_1000);
		expect(url).toContain('/song/陳柏宇/你瞞我瞞?ci=');
		expect(url.match(/\?/g) ?? []).toHaveLength(1);
	});
```

---

### `src/lib/stores/player.svelte.ts` — `armTrack()` (MOD, new method)

**Analog:** `restore()` `player.svelte.ts:553-654`. Reuse steps 6–14 + 18; drop everything persistence-specific.

**Cover seed chain — copy VERBATIM** (`:576-589`). The comment is a decision record naming two prior bugs; carry a condensed form forward:

```typescript
		// cover-hero-mediacard-missing (Issue 2 + Issue 1): the restore path never calls play(), so
		// without this the OS media card had no metadata on a PWA reopen → it fell back to the bare
		// app name once the user resumed. Seed the ONE cover field (mirrors play()'s sync seed: track
		// cover → uid cache → name cache) so the hero/nowbar paint any known cover, THEN write the
		// media metadata from the restored track so title/artist are present the moment playback resumes.
		// quick-260915-w4f: the pin leads here too — a reload/PWA reopen must come back showing the
		// cover the user chose, not the source thumbnail on target.cover.
		this.resolvedCover =
			getPinnedCover(target.uid) ??
			target.cover ??
			getCachedCoverByUid(target.uid) ??
			getCachedCover(target.artist, target.title) ??
			null;
		this.syncMetadata();
		this.loading = true;
```

**Offline-first + resolve + queue-slot patch** (`:591-618`), and the **never-throw `try/catch/finally`** (`:649-653`):

```typescript
		try {
			// Offline-first restore: if the track is in library.downloads AND its blob is in
			// IDB, skip the network ensureTrackDetails entirely. […]
			let resolved: Track = target;
			let offlineBlob: Blob | null = null;
			if (library.isDownloaded(target.uid)) {
				offlineBlob = await blobStore.get(target.uid).catch(() => null);
			}
			if (!offlineBlob) {
				resolved = await ensureTrackDetails(target);
				this.current = resolved;
				const i = this.indexOf(target);
				if (i >= 0) this.queue[i] = resolved;
				// 31-D-08: an edge-cache hit resolved a url with no lyrics — fill the pane out of band
				// so a warm restore is never worse than a cold one.
				if (resolved.lrcUnresolved && !resolved.lrc) this.backfillLyrics(resolved);
			}
			…
		} catch {
			/* re-resolve failed — track stays in `current`, user can tap play to retry */
		} finally {
			this.loading = false;
		}
```

**🔴 The `audio.src` direct assign — mirror it, do NOT route through `driveSrc`** (`:619-642`). The 31-D-12 comment is the load-bearing bit; carry its reasoning into the new method:

```typescript
			if (!this.audio) return;
			if (this.cachedBlobUrl) {
				URL.revokeObjectURL(this.cachedBlobUrl);
				this.cachedBlobUrl = null;
			}
			let src: string;
			if (offlineBlob) {
				this.cachedBlobUrl = URL.createObjectURL(offlineBlob);
				src = this.cachedBlobUrl;
			} else if (resolved.audioUrl) {
				src = resolved.audioUrl;
			} else {
				return;
			}
			const audio = this.audio;
			// 31-D-12: record provenance for the audio.error handler. restore() deliberately keeps its
			// DIRECT assign (it is not routed through driveSrc) — routing it would newly subject a boot
			// restore to the re-drive brake, a behaviour change in the freeze-sensitive core.
			this.lastSrcKind = offlineBlob ? 'download-blob' : 'url';
			audio.src = src;
```

**DROP from the copy:** `parsePlayerState` read (`:559`), `this.queue`/`shuffle`/`repeatMode` install (`:563-565`), `upNextAnchorUid` re-anchor (`:575`), `pendingSeek` (`:637`, `:645-648`).

**Generation guard** — `restore()` has none (it is the boot path). `armTrack` is supersedable by a user tap, so copy the guard idiom from `playStub` (`:3196`, `:3211`) instead:

```typescript
		const gen = ++this.pendingGen;
		…
		// Superseded by a newer tap while we were resolving → discard silently. Do NOT touch
		// pendingTrack/loading; the newer playStub call owns them now.
		if (gen !== this.pendingGen) return null;
```

---

### `src/lib/stores/player.svelte.ts` — `spliceAndPlay()` (MOD, new method)

**Analogs:** `playNext()` `:2633-2641` and `relatedTapPlay` `NpRelated.svelte:151-166`.

`playNext` — note the two-line body + `if (!this.current) this.play(t); else this.persist();` tail. **That first branch is D-29's autoplay trap:**

```typescript
	playNext(t: Track, opts: { pin?: boolean } = {}) {
		if (opts.pin !== false) this.manualUids.add(t.uid); // explicit manual add — preserved across regen
		const q = this.queue.filter((x) => x.uid !== t.uid);
		const i = q.findIndex((x) => x.uid === this.current?.uid);
		q.splice(i >= 0 ? i + 1 : 0, 0, t);
		this.queue = q;
		if (!this.current) this.play(t);
		else this.persist();
	}
```

The JSDoc above it (`:2620-2632`) is the template for the new method's doc — it explains the `pin` semantics and names the concrete bug pinning caused. **Relocate, do not delete**, the two `NpRelated.svelte:141-165` comment blocks onto `spliceAndPlay`:

```typescript
	// quick-260910-qjv: a Related TAP is "queue at the top and play", not "nuke my queue". It used
	// to be play({ fresh: true }) — the fresh branch weaves history, re-anchors upNextAnchorUid to
	// the tapped song, clears removedUids and REGENERATES the tail, so every row the user had lined
	// up vanished. Composed from two existing store methods instead, zero store diff: […]
	function relatedTapPlay(track: Track) {
		// Tapping the now-playing song is a NO-OP, not a restart […]
		if (player.current?.uid === track.uid) return;
		// pin:false — this tap means "play this now", NOT "pin this for later". playNext is borrowed
		// purely for its splice-after-current positioning […]
		player.playNext(track, { pin: false });
		// Cold start: with no current, playNext plays the track itself (setting current
		// synchronously), so this guard is what prevents a double play().
		// No toast/haptic — the row becoming the playing track IS the feedback.
		if (player.current?.uid !== track.uid) void player.play(track, { fresh: false });
	}
```

**Return-a-receipt pattern** for the D-03 no-op signal: `removeFromQueue` `:2660` already returns `QueueRemoval | null`, so a `boolean`/receipt return from a queue method is established here.

---

### `src/routes/(app)/song/[artist]/[title]/+page.svelte` + `src/routes/(app)/song/[slug]/+page.svelte` (MOD)

**Analog:** each other — the two `resolveAndPlay` bodies are character-identical apart from one guard comment (`[artist]/[title]:49-82` vs `[slug]:44-77`). This is the file pair that collapses into ONE call to `share-arrival`.

**The SSR-safety contract to preserve verbatim** (`[artist]/[title]/+page.svelte:1-19`) — the header comment IS the contract; update it, never drop it:

```svelte
<script lang="ts">
	// SSR-safe carrier-free SONG share page (OG-PATH-01), SSR-safe BY CONSTRUCTION. […]
	//
	// SSR-SAFETY (Pitfall 4): the ONLY module-top imports are PageOg, `browser`, `onMount`, the page
	// data type, and `apiUrl` (pure + store-free, so it does not pull the client graph). There is NO
	// top-level store import and NO store METHOD call at module scope — the player store (which pulls
	// the whole client graph) is imported LAZILY inside onMount under a `browser` guard, so SSR never
	// compiles the store graph in. i18n is likewise lazy-imported client-side (its index imports the
	// settings store), keeping this page store-free during SSR.
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import PageOg from '$lib/components/PageOg.svelte';
	import { apiUrl } from '$lib/services/api-base';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
```

**The lazy-import-under-browser-guard pattern** (`:54-75`) — this is the exact idiom to extend. Note `browser` guard first, `await import()` for BOTH the store and i18n, and the try/catch around i18n with a pre-set English fallback:

```typescript
	async function resolveAndPlay() {
		if (!browser || !data.name) {
			// No title segment → nothing to resolve (only reachable via the '-' empty guard). Treat as a
			// genuine miss rather than a stuck loader.
			status = 'notfound';
			return;
		}
		status = 'resolving';
		// Lazy imports keep SSR store-free (both pull the client store graph).
		const { player } = await import('$lib/stores/player.svelte');
		try {
			const { t } = await import('$lib/i18n');
			notFoundMsg = t('home.unplayable');
		} catch {
			/* keep the English fallback already set above */
		}
		const tr = await player.playStub(data.artist, data.name, null, 'home-discovery');
		// Mirror the home idiom: playStub returns null for BOTH a genuine miss AND a supersede; a
		// supersede leaves pendingTrack pointing at the newer song (don't flag notfound then).
		if (tr === null && player.pendingTrack == null) status = 'notfound';
		else status = 'playing';
	}
```

**The `onMount` block being replaced** (`:77-82`) — its `quick-260809-38i` comment is exactly the STALE comment Pitfall 10 flags. Rewrite to the new invariant (*resolve on mount, never PLAY on mount*), keeping the `quick-260809-38i` ref:

```typescript
	onMount(() => {
		// quick-260809-38i: bind the handler ONLY — no resolve, no playback. Opening a share link must
		// start NO audio; the "Play on openmusic" control below runs the exact same resolve on a real
		// user gesture, which is also the gesture mobile browsers require for playback anyway.
		retry = () => void resolveAndPlay();
	});
```

**`onMount` with an AbortController teardown** — closest in-repo shape is `DownloadControl.svelte:110-118` (an `$effect`, but the return-a-disposer form is identical and `onMount` accepts the same):

```typescript
		const ac = new AbortController();
		probing = true;
		untrack(() => probeDownload(target, ac.signal)).then((p) => {
			if (!ac.signal.aborted) {
				probed = p;
				probing = false;
			}
		});
		return () => ac.abort();
```

⚠️ **`onMount`, never `$effect`.** See `## Shared Patterns → untrack / onMount` below.

**`+page.ts` — DO NOT TOUCH.** `[artist]/[title]/+page.ts:42-57`'s loader is synchronous and performs NO fetch (T-24-08 / SSRF posture). `export const ssr = true; export const prerender = false;` stay. Reading a new `?u=` param there is allowed (it already reads `url.searchParams.get('ci')`) but adding any fetch is not.

---

### `src/routes/(app)/+page.svelte` (MOD — legacy `?play=` decoder, D-12)

**Analog:** the block itself (`:669-686`) — this is the `setQueue` + `fresh: true` shape being replaced by `spliceAndPlay`:

```typescript
		// Shared link: /?play=<token> → reconstruct the current track + up-next queue and play
		// through the SAME continuity path normal tap-to-play uses […]
		const token = new URLSearchParams(location.search).get('play');
		if (token) {
			const { current, queue } = decodeShare(token);
			if (current) {
				// Multi-item queue → install it; otherwise seed a 1-item queue (legacy/single-track
				// token). fresh:true makes the player regenerate a similar-artist up-next + prefetch,
				// matching a normal fresh play so the shared song keeps playing continuously.
				player.setQueue(queue.length > 1 ? queue : [current], 'home-discovery');
				player.play(current, { fresh: true });
			}
			// Clear the params via the global window.history (the play-history store is imported as
			// `playHistory`, so `window.history` is the real History API here).
			window.history.replaceState(null, '', location.pathname);
		}
```

⚠️ The `token` variable is read again at `:693` (`if (!token && cached.useFallback …)`). Keep that binding alive. `window.history.replaceState` cleanup stays.

⚠️ This page DOES import the player store at module top (it is not an SSR landing surface) — the lazy-import rule is specific to the two `/song/*` routes.

---

### `src/lib/components/NpRelated.svelte` (MOD — net deletion)

**Analog:** itself. `relatedTapPlay` `:151-166` collapses to `player.spliceAndPlay(track)`. Its sibling handlers show the house shape for a row action (`:130-139`) — note these DO toast, and `relatedTapPlay` deliberately does NOT:

```typescript
	function relatedSwipeQueue(track: Track) {
		player.addToQueue(track);
		toast.show(t('toast.addedToQueue'));
		hapticTick();
	}
```

D-20's share toast follows THIS shape (`toast.show(t('…'))`), not `relatedTapPlay`'s silence.

---

### `src/lib/i18n/*.ts` — 15 files (MOD)

**Analog:** `"toast.playingNext"` — `en.ts:394`, and the sibling line in all 14 others.

**DOUBLE QUOTES on key AND value.** No formatter enforces this; `svelte-check` will not catch it.

| File | Line of the `toast.*` block | Sample |
|---|---|---|
| `en.ts` | 394 | `"toast.playingNext": "Playing next",` |
| `ar.ts` `de.ts` `es.ts` `fr.ts` `hi.ts` `id.ts` `it.ts` `pt.ts` `ru.ts` `th.ts` `tr.ts` `vi.ts` | 342 | `"toast.playingNext": "Als nächstes wird gespielt",` (de) |
| `zh-Hans.ts` | 368 | `"toast.playingNext": "下一首播放",` |
| `zh-Hant.ts` | 368 | `"toast.playingNext": "下一首播放",` |

**Complete list (all 15 must change):** `ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant`.

**Header + section-comment convention** (`en.ts:1-9`) — `en` is the reference locale, keys grouped under `// --- section ---` markers:

```typescript
// English UI-chrome dictionary. SOURCE / REFERENCE locale: values are the CURRENT
// verbatim on-screen text, so selecting `en` is a visual no-op. All three locale
// files (en / zh-Hant / zh-Hans) MUST expose an IDENTICAL key set.
const en = {
	// --- nav (bottom tab bar) ---
	"nav.home": "Home",
```

**Parity enforcement** (`i18n.test.ts:51-56`) — automatic, no new test needed. A key added to `en` only fails CI in 14 locales:

```typescript
	it('every locale exposes a key set IDENTICAL to en (all 15 locales)', () => {
		const enKeys = Object.keys(dicts.en).sort();
		for (const lang of Object.keys(dicts) as Array<keyof typeof dicts>) {
			expect(Object.keys(dicts[lang]).sort(), `${lang} key set must match en`).toEqual(enKeys);
		}
	});
```

There is also a per-phase explicit-key test at `:58-60` (`['menu.remix', 'toast.remixing', 'menu.preparing']`) — an optional precedent for pinning this phase's new key by name.

---

### `android/app/src/main/AndroidManifest.xml` (MOD)

**Analog:** the file's own existing `<intent-filter>` (`:20-23`) and its commented `<uses-permission>` block (`:42-63`), which is the in-file precedent for a **long XML comment carrying the decision record**:

```xml
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>
```

Indentation here is **4 SPACES**, not tabs (this file is Capacitor-generated XML — match the file, not CLAUDE.md's TS rule). `launchMode="singleTask"` + `exported="true"` are already present (D-26). Add a SECOND `<intent-filter>` inside the same `<activity>`; do not modify the existing one. The exact block + its comment is in RESEARCH §2b.

---

### `static/.well-known/assetlinks.json` (NEW)

**Analog:** `static/manifest.webmanifest` — the only other hand-authored JSON in `static/`. No build step, no template, no import; files are copied 1:1 by both adapters.

```
static/
├── favicon.svg
├── icon-maskable.svg
├── icons/
├── manifest.webmanifest
├── og.jpg
├── og.svg
├── robots.txt
└── sitemap.xml
```

Nothing special applies. RESEARCH §1 empirically verified the dot-directory survives `adapter-cloudflare` AND `adapter-static`, lands in `_routes.json`'s `exclude`, and serves `200 application/json`. JSON cannot carry comments — put the "the first fingerprint is the machine-local debug key" note in the commit message, not the file.

---

### Capacitor deep-link listener (NEW — **NO IN-REPO ANALOG**)

`grep -rn "addListener" src` → **zero matches.** `@capacitor/app` has no JS importer anywhere. This is the first Capacitor *listener* in the codebase, so the planner composes it from three existing patterns:

**1. The platform guard** — every Capacitor call site uses `Capacitor.isNativePlatform()` from `@capacitor/core`, NOT a `browser` check. 12 call sites; the canonical one is `player.svelte.ts:1459-1467`:

```typescript
	private get ms(): PlayerMediaSession | null {
		if (Capacitor.isNativePlatform()) {
			this.nativeMs ??= createNativeMediaSession();
			return this.nativeMs;
		}
		return typeof navigator !== 'undefined' && 'mediaSession' in navigator
			? navigator.mediaSession
			: null;
	}
```

The *file-level* precedent for "this file is the phase's only native branch" is `backup-io.ts:7,35`:

```typescript
// D-18: this file is the phase's only isNativePlatform() branch. The page above it stays
…
	if (Capacitor.isNativePlatform()) return shareBackupNative(json, filename);
```

**2. Listener + teardown** — nearest shape is `NowPlaying.svelte:87-93` (a DOM listener, but the add-then-`return () => remove` structure is the one to mirror):

```typescript
	$effect(() => {
		if (typeof window === 'undefined' || !window.matchMedia) return;
		const mq = window.matchMedia(WIDE_MQ);
		const onChange = (e: MediaQueryListEvent) => (wide = e.matches);
		wide = mq.matches;
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});
```

Capacitor's `addListener` is async and returns a handle — the disposer must be captured inside the async IIFE and released via a mutable `off` binding (shape in RESEARCH §3d).

**3. Mount point + the `untrack`/`onMount` rule** — `src/routes/+layout.svelte:22-40` is the only place mounted once for the whole app lifetime, and its comment is the rule:

```svelte
	$effect(() => {
		if (audioEl) {
			// ROOT CAUSE FIX (debug-song-click-lrc-flood-noplay): attach()/restore() WRITE player $state
			// (queue, current, resolvedCover, loading — resolvedCover + syncMetadata were added to
			// restore() in 26e413a). Running them tracked meant this effect READ that state and then
			// MUTATED it → the effect SELF-INVALIDATED and re-ran restore() over and over → repeated
			// audio.src re-set (the (canceled) media flood) + repeated lrc re-fetch + loading pinned true
			// (nowbar stuck on the loading line, never expands). […] untrack() runs the ONE-TIME
			// setup WITHOUT tracking, so the effect fires once per <audio> mount […]
			untrack(() => {
				player.attach(audioEl);
				void player.restore();
			});
		}
	});
```

Contrast comment at `:48-50` (the `document.title` effect is deliberately NOT untracked because it writes a DOM property, not `$state`) — that distinction is the house rule to cite.

⚠️ **`src/routes/+layout.svelte` uses DOUBLE quotes** for its imports/strings, unlike the `/song/*` pages which use single. Match the file you are editing.

---

## Shared Patterns

### Safe parse / closed-enum allowlist (V5 input validation)
**Sources:** `src/lib/services/share.ts:503-512` (`parseEntityParam`) and `src/lib/proxy/safe-image-url.ts:33-51` (`safeImageUrl`)
**Apply to:** the `?u=` carrier parse **and** the deep-link host check in `share-arrival.ts`

`parseEntityParam` — returns `null` on no-match, NEVER throws, and states in its JSDoc that it is "the validation gate before the param is used downstream":

```typescript
export function parseEntityParam(
	param: string
): { source: string; id: string; uid: string } | null {
	if (typeof param !== 'string' || !param) return null;
	const m = param.match(ENTITY_SOURCE_RE) ?? param.match(ENTITY_SOURCE_ONLY_RE);
	if (!m) return null;
	const source = m[1];
	const id = m[2];
	return { source, id, uid: `${source}:${id}` };
}
```

`safeImageUrl` — the URL host-allowlist idiom for the deep-link check. Every line is annotated as load-bearing in the file header (`:9-19`); the character screen runs BEFORE the parse, `new URL()` lives in a try/catch, and the returned value is the PARSED `href`, not the raw input:

```typescript
export function safeImageUrl(
	raw: string | null | undefined,
	allowed: ImageHostAllowlist
): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null;
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		const ok =
			(allowed.exact?.includes(host) ?? false) ||
			allowed.suffix.some((h) => host.endsWith(h));
		return ok ? u.href : null;
	} catch {
		return null;
	}
}
```

> The dot-anchored-suffix note at `:15-16` (`endsWith('.dzcdn.net')` rejects `evil-dzcdn.net`) applies directly to `openmusic.lol` — an exact-match host check is what the deep-link needs, and `evil-openmusic.lol` is the attack it must reject.

### `untrack` / `onMount` — never a tracked `$effect` that calls the player store
**Source:** `src/routes/+layout.svelte:22-40` (excerpted above)
**Apply to:** both `/song/*` mount resolves, the deep-link listener
Rule: code calling a player method that writes `$state` lives in `onMount`, or is wrapped in `untrack()`. Do not un-untrack the existing block.

### Toast — store emits a key, UI maps it
**Sources:** `src/lib/stores/toast.svelte.ts:26-40` (`show`), `src/lib/components/NpRelated.svelte:132`, `src/routes/(app)/+layout.svelte:40-41,69,119`
**Apply to:** the D-20 warm-arrival toast
Call site shape is `toast.show(t('toast.<key>'))`. The store→UI channel for player-emitted messages is `player.notice` read one-way by the `(app)` layout host (`:40-41`: "the host READS the store and INVOKES the store-…"). A store must never call `t()` itself.

### Governed fetch
**Source:** `src/lib/services/api-base.ts` (`apiFetch`)
**Apply to:** everything new
Automatic — resolving via `ensureTrackDetails` / `resolveStub` already routes through the governor (adapters call `apiFetch` internally). The pattern to FOLLOW is: **add no raw `fetch` anywhere.**

### Pinned source-text tests (Pitfall 7 — flag loudly)
**Sources:** `src/lib/services/share.test.ts:834`, `src/lib/i18n/…`/`names.test.ts:219`
These assert against the RAW SOURCE TEXT of `src/lib/components/TrackMenu.svelte:783`:

```typescript
	it('still passes a cover argument to songShareUrl', () => {
		// RED under: dropping the 2nd argument — the exact regression that restores the blank card.
		// Anchored on the call HEAD with its TRAILING COMMA, single-line: a regex spanning the
		// multi-line body would be unfalsifiable (nested braces match almost anything).
		expect(src).toMatch(/songShareUrl\(\{ title: dTitle, artist: dArtist \}, /);
	});
```

The live call at `TrackMenu.svelte:783` must stay single-line with the first two args unchanged:

```typescript
		const url = songShareUrl({ title: dTitle, artist: dArtist }, shareCover, recallItunesId(shareCover));
```

**Also going RED on the carrier (budget for them):** `share.test.ts:314-315` (`endsWith('/song/Jay-Chou/Dao-Xiang')`), `:318` (`carries ZERO query params`), `:762` (`not.toContain('?')`), `:768`, `:784`, `names.test.ts:205-207`, `names.test.ts:245`.

---

## Conventions

Derived from `src/lib/services` (134 files) via the shared deterministic module.

| Axis | Dominant | Share | Entropy | Status |
|---|---|---|---|---|
| file-name casing | *(none)* — kebab is the plurality | 47% | 0.902 | **contested hotspot** |
| identifier casing | `camel` | 97% | 0.151 | **named contract** |
| export style | `esm` (named `export`) | 100% | 0.000 | **named contract** |
| import style | `esm` | 100% | 0.000 | **named contract** |

New files must use named ESM exports (no default exports in `$lib`) and `camelCase` identifiers.

**Contested hotspots (author's choice).** The file-name axis reads contested only because the deriver
bins `<name>.test.ts` and `<name>.svelte.ts` as `other`. The repo's real rule is a DELIBERATE split
encoded in CLAUDE.md, and it is per-directory-consistent exactly like the CJS↔SDK dual-resolver
prototype (`bin/lib/**` CJS vs `sdk/src/**` ESM — each half internally consistent, contested only
repo-wide):

- Runes stores → `<name>.svelte.ts` (the suffix is REQUIRED for the Vite runes transform)
- Pure services/logic → kebab-case `<name>.ts`
- Components → `PascalCase.svelte`; actions (`use:`) → `camelCase.ts`; tests → co-located `<name>.test.ts`

For this phase: `share-arrival.ts` (kebab, pure) + `share-arrival.test.ts`. Match the directory's
local style; do not deviate.

**Verbatim conventions the planner must carry into every task:**

| Rule | Detail |
|---|---|
| Indentation | **TABS** in `.ts`/`.svelte`. Exception: `AndroidManifest.xml` is 4 SPACES (Capacitor-generated) |
| Quotes | Single quotes in TS. **EXCEPT** `src/lib/i18n/*.ts` → DOUBLE quotes for key AND value. `src/routes/+layout.svelte` happens to use double — match the file being edited |
| Imports | `$lib/` / `$app/` aliases, never deep relative. **Exception:** a test imports its subject relatively (`./match-key`) |
| Type imports | `import type { Track } from '$lib/sources/types';` |
| Exports | Named only; no default exports in `$lib` |
| Comments | High density, load-bearing. Tag new behaviour `38-D-NN` (decision ref) or `quick-NNNNNN-xxx`. Never delete an existing decision-ref comment — RELOCATE it when code moves |
| Runes | `$state`/`$derived`/`$effect`/`$props` only. Internal non-reactive counters are PLAIN class fields, not `$state` |
| Type safety | Zero `as any` in production source (all existing ones are in tests) |
| Gate | `pnpm check` (svelte-check) is the only lint/format gate. `pnpm test` = vitest `--run`, `expect.requireAssertions: true` |

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Capacitor `appUrlOpen` / `getLaunchUrl()` listener | provider | event-driven | `grep -rn "addListener" src` → zero matches. `@capacitor/app` has no JS importer. Composed from three partial analogs (see its section); the literal shape is RESEARCH §3d |
| `static/.well-known/assetlinks.json` | config | file-I/O | No JSON asset precedent beyond `manifest.webmanifest`; the document shape comes from RESEARCH §2a / Google's digital-asset-links docs |

---

## Metadata

**Analog search scope:** `src/lib/services/`, `src/lib/stores/`, `src/lib/components/`, `src/lib/proxy/`, `src/lib/i18n/`, `src/routes/`, `android/app/src/main/`, `static/`
**Files read:** 22
**Pattern extraction date:** 2026-09-20
