# Phase 32: QQ-lossless-first resolve — Pattern Map

**Mapped:** 2026-08-31
**Files analyzed:** 8 modified + 1 net-new (+ 6 test files)
**Analogs found:** 8 / 9 (the connection-detection helper has no functional analog — a structural one is assigned)

Every target file in this phase is a MODIFICATION of an existing file except one. That makes most
"analogs" self-analogs: the pattern to copy is the sibling branch already living in the same file.
Where that is the case it is stated explicitly, because it is the cheapest correct answer.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/sources/qq.ts` — quality pref (D-02/D-04) | source adapter | request-response / transform | `src/lib/sources/quality.ts` `pickByQualityPref` + its use in `sources/joox.ts:143-166` | exact (same concern, sibling adapter) |
| `src/lib/sources/qq.ts` — strip `msg` (D-09) | source adapter | request-response | in-file: `qq.ts:220` URL build; `sources/kuwo.ts` single-param detail | self-analog |
| `src/lib/sources/qq.ts` — `http:`→`https:` (D-05) | source adapter | transform | `services/itunes-cover.ts` `upgradeArtwork` (a pure string upgrade at the adapter boundary) | role-match |
| `src/lib/sources/qq.ts` — direct-vs-proxy routing (D-12/D-13) | source adapter | request-response | `services/itunes-cover.ts:168-186` (absolute cross-origin CORS-open GET, never-throw) | role-match |
| `src/lib/config/defaults.ts` | config | n/a (literal) | in-file: `TRANSLATION_DEFAULTS` / `PLAYBACK_DEFAULTS` block | self-analog |
| `src/lib/services/api-base.ts` `apiUrl` | utility (fetch seam) | request-response | in-file: `apiUrl` itself + its posture doc-block | self-analog |
| `src/lib/services/dedupe.ts` `SOURCE_RANK` | service (pure) | transform | in-file: the ranked-comment block above the const | self-analog (one line + one comment) |
| `src/lib/stores/player.svelte.ts` `prebufferNext` (D-15) | runes store (god object) | streaming / file-I/O | in-file: `blob-store.ts` `MIN_BLOB_BYTES` floor (the "one guard at one boundary" precedent) | role-match |
| `src/lib/stores/player.svelte.ts` background mid-resolve (D-06/D-07) | runes store | event-driven / fire-and-forget | `services/prewarm.ts` `prewarmTrack` — **use this, not a generation guard** | exact |
| `src/lib/proxy/resolve-cache.ts` (D-10) | proxy primitive (edge) | CRUD (cache) | in-file: `resolveCacheKey` / `readResolveEntry` / `writeResolveEntry`; key-namespace precedent `/api/og/_resolve` | self-analog |
| `src/lib/proxy/resolve-edge.ts` (D-10) | proxy service (edge) | request-response | in-file: `resolveOnEdge` (swap kuwo search+detail → qq search) | self-analog |
| `src/routes/api/resolve/+server.ts` (D-10) | route (edge endpoint) | request-response | in-file: GET/POST/OPTIONS + `jsonResult` | self-analog |
| **NEW:** connection detection for `'auto'` | service (capability probe) | n/a (synchronous read) | **`src/lib/stores/online.svelte.ts`** for guard style; **`services/quality.ts`** for file placement/purity | partial (structural only) |

---

## Pattern Assignments

### 1. `src/lib/sources/qq.ts` — quality-pref selection (D-02 / D-04)

**Analog A (the ladder-reordering primitive):** `src/lib/sources/quality.ts` — the whole file, 39 lines.

```typescript
// PURE quality-ladder reordering (D-03). NO runes, NO `$app`, NO store import —
// the caller passes the preference as an ARGUMENT so this is node-unit-testable
// without mocking the settings store (RESEARCH Open Question 2).
const BAND_128 = /128|160|192/i;
const BAND_320 = /320/i;
const BAND_LOSSLESS = /flac|lossless|atmos|hi-?res|母带|无损/i;

export function pickByQualityPref(tiers: string[], pref: DefaultQuality): string[] {
	const band = pref === '128' ? BAND_128 : pref === '320' ? BAND_320 : null;
	// 'lossless' / 'auto' → leave the ladder as-is (top tier first).
	if (!band) return [...tiers];
	...
}
```

**Read this closely: `quality.ts` is where `'auto'` currently means nothing** (`if (!band) return [...tiers]`
— `'auto'` falls into the same branch as `'lossless'`). `BAND_LOSSLESS` is declared and **never used**.
D-02 is the decision that gives `'auto'` a value, so the executor picks ONE of two shapes:

- **(a)** resolve `'auto'` → a concrete `'lossless' | '320'` BEFORE calling into the ladder (the pref
  is narrowed at the caller; `quality.ts` stays untouched and `BAND_LOSSLESS` stays dead), or
- **(b)** teach `quality.ts` to accept the connection signal.

(a) keeps `quality.ts` pure and node-testable with no new injection — the reason its doc-block gives
for taking `pref` as an argument in the first place. Prefer (a).

**Analog B (the JOOX side of the ladder, for the side-by-side CONTEXT.md asked for):**
`src/lib/sources/joox.ts:120-166`.

```typescript
// JOOX quality tiers in descending preference. Ported VERBATIM from
// legacy/index.html:2467 (pickJooxPlayUrl order). Do NOT reorder.
const JOOX_QUALITY_ORDER = [
	'Atmos全景声', '无损FLAC', 'Hi-Res无损', '母带无损',
	'OGG 320', 'MP3 320', 'AAC 192', 'OGG 192', 'MP3 128', 'AAC 96', 'AAC 48'
];

async function pickJooxPlayUrl(links, outerSignal, quality?: DefaultQuality): Promise<PickedPlayUrl> {
	// WR-07: an explicit per-call quality (download path) wins over the streaming pref.
	const order = pickByQualityPref(JOOX_QUALITY_ORDER, quality ?? settings.defaultQuality);
	for (const name of order) {
		const u = links[name];
		if (!u) continue;
		if (!(await probeJooxAudioUrl(u, outerSignal))) continue;   // ← JOOX PROBES, QQ DOES NOT
		if (/母带|无损|flac|hi-res|atmos/i.test(name) || /\.flac(?:\?|$)/i.test(u)) {
			return { url: u, tag: 'lossless', label: 'LOSSLESS', text: name };
		}
		...
	}
}
```

**The two ladders side by side — the structural difference the planner needs:**

| | JOOX | QQ |
|---|---|---|
| Tier representation | a `Record<string,string>` keyed by human tier NAME → the array is reordered by name-regex | fixed FIELD names on one detail object (`song_play_url_sq`, `_pq`, `_hq`, `_standard`, `_fq`) |
| Selection mechanism | `pickByQualityPref` reorders a `string[]`, then a loop takes the first PRESENT-and-REACHABLE tier | a hand-written `if` chain — `pickBestPlayUrl` (`qq.ts:98-137`) |
| Pref handling | delegated wholly to `pickByQualityPref` | TWO hard-coded early-return promotions (`'128'`→standard, `'320'`→hq), then the verbatim lossless-first fallthrough |
| Reachability | probes every candidate (`probeJooxAudioUrl`, HEAD then ranged GET) | never probes — first present field wins |
| `'auto'` today | identical to `'lossless'` (`quality.ts` no-band branch) | falls THROUGH both promotions into the lossless-first ladder — i.e. QQ under `'auto'` already yields SQ |

**Consequence for planning:** QQ's `'auto'` path is *already* lossless-first. The only reason
playback is 98kbps is that `PLAYBACK_DEFAULTS.defaultQuality` is `'128'`, which hits the FIRST
early-return. So D-02's QQ-side work is: (i) change the default, (ii) make `'auto'` on cellular
return HQ. Excerpt of the exact branch to extend (`qq.ts:98-120`):

```typescript
function pickBestPlayUrl(d: QQDetailItem, quality?: DefaultQuality): BestPlayUrl {
	// D-03: absent an explicit per-call tier, read the user's streaming pref. WR-07: the
	// download path now passes settings.downloadQuality explicitly instead of temporarily
	// mutating settings.defaultQuality (which raced concurrent playback resolves).
	const pref = quality ?? settings.defaultQuality;
	if (pref === '128' && d.song_play_url_standard) {
		return { url: d.song_play_url_standard, tag: 'standard', label: 'STD',
		         text: `STD ${d.kbps_standard || ''}`.trim() };
	}
	// WR-03: '320' pref → promote HQ (~320k) ahead of the lossless-first ladder, mirroring
	// the '128'→STD promotion above and JOOX's pickByQualityPref 320 handling.
	if (pref === '320' && d.song_play_url_hq) {
		return { url: d.song_play_url_hq, tag: 'hq', label: 'HQ', text: `HQ ${d.kbps_hq || ''}`.trim() };
	}
	// lossless
	if (d.song_play_url_sq) return { url: d.song_play_url_sq, tag: 'lossless', ... };
```

The `'auto'`→cellular case is *literally the `'320'` branch already written*. Narrowing `'auto'` to
`'320'` upstream of `pickBestPlayUrl` reuses it with **zero new branches in this function**.

---

### 2. `src/lib/sources/qq.ts` — strip `msg` from the detail call (D-09)

**Self-analog.** The exact lines to change (`qq.ts:200-221`):

```typescript
	async resolve(track: Track, signal: AbortSignal, quality?: DefaultQuality): Promise<Track> {
		// 优先用搜索时用过的关键词，保证和原始排序一致 (legacy:2312-2315).
		const msg =
			(track.qqSearchKey || track.keyword || '').trim() ||
			((track.title || '') + ' ' + (track.artist || '')).trim();

		// 新接口用 mid：优先 qqId/songMid/songid (legacy:2317-2319).
		const mid = (track.qqId || track.songMid || track.songid || '').toString().trim();
		...
			const path = `/api/qq/detail?msg=${encodeURIComponent(msg)}&type=json&mid=${encodeURIComponent(mid)}`;
```

`msg` is computed ONLY for this URL — deleting the param makes the whole `const msg` block dead.
Note the SEARCH path (`qq.ts:148`) legitimately keeps `msg`; do not touch it. `track.qqSearchKey` is
still written at search time (`qq.ts:186`) and read by `joox.ts`-style keyword paths elsewhere —
grep before deleting the field, only the detail *usage* is in scope.

**Comment convention:** the existing `(legacy:NNNN)` refs are decision records (CLAUDE.md: "do not
remove existing decision-ref comments"). When the `legacy:2312-2315` port is deliberately reversed,
replace the ref with a `32-D-09` ref that says *why* it was reversed and that it was VERIFIED, e.g.
the note's measured evidence (`detail with WRONG msg + mid → correct song`).

---

### 3. `src/lib/sources/qq.ts` — `http:`→`https:` upgrade (D-05)

**Analog:** `src/lib/services/itunes-cover.ts` — a pure string upgrade applied at the adapter
boundary, with the reason in the comment. Same shape as its `artworkUrl100 → 600x600` swap. The
adapter (not the proxy) is the right home for the same reason `upgradeArtwork` lives beside the
fetch: the value is consumed as a URL attribute downstream and must be correct at the boundary.

Existing precedent for a URL-shape guard in this repo, `player.svelte.ts` uses `httpsOnly(...)`
before every cover-cache write:

```typescript
		// https-only (T-0bb-01); writeCoverBoth no-ops on empty/non-https — harmless even before
		// the myGen guards' discard points (real art only).
		if (httpsOnly(this.resolvedCover))
			writeCoverBoth(track.uid, track.artist, track.title, this.resolvedCover);
```

Place the upgrade inside `pickBestPlayUrl`'s return path (one helper, all 7 tiers covered) rather
than at the `track.audioUrl = best.url` assignment — one guard where every branch routes through,
per the same "one guard at one boundary" logic `blob-store.ts` records for `MIN_BLOB_BYTES`.

---

### 4. `src/lib/sources/qq.ts` — direct-vs-proxy call routing (D-12 / D-13)

**Analog:** `src/lib/services/itunes-cover.ts:168-186` — the ONE existing client module that fetches
an absolute cross-origin CORS-open upstream, and it documents exactly the trap D-13 names:

```typescript
async function fetchTopArtwork(url: string, signal?: AbortSignal): Promise<string | null> {
	if (signal?.aborted) return null;
	try {
		// RAW fetch (not apiFetch — fetch→apiFetch audit): `url` is an ABSOLUTE cross-origin
		// itunes.apple.com URL. apiFetch prepends the /api base (apiUrl) → would corrupt it. Not /api.
		const res = await fetch(url, { signal: combinedSignal(signal) });
		if (!res.ok) return null;
		const data = (await res.json()) as ItunesResponse;
		...
	} catch {
		// Non-ok / abort / timeout / malformed JSON / network failure → miss → gradient.
		return null;
	}
}
```

**This comment IS the D-13 justification, inverted.** itunes-cover chose raw fetch *because*
`apiUrl` would corrupt an absolute URL. D-13 chooses to fix `apiUrl` instead so the governor
applies. Once the guard lands, this comment becomes stale — the planner should note that
`itunes-cover.ts` could then route through `apiFetch` too, but that is OUT of scope (do not fold it
in; a `fetch→apiFetch` audit comment exists there and should be left alone unless the phase
explicitly widens).

**Bounded-signal helper to copy verbatim** (present identically in `itunes-cover.ts:156-161`,
`deezer.ts`, and `resolve-cache-client.ts` — three copies, so it is the established idiom):

```typescript
function combinedSignal(caller?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	if (!caller) return timeout;
	const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([caller, timeout]) : timeout;
}
```

**Fallback-to-proxy shape (D-12's retained path):** the closest precedent for "try one route, fall
back to the other, never throw" is `joox.ts`'s self-heal (`fetchJooxSearchSongs`), which documents
the split contract explicitly — worth mirroring:

```typescript
/**
 * ... NEVER-THROW (unlike the public search(), which throws on drift for the fan-out's typed error):
 * a contract-drift / network / abort failure yields [] so the self-heal degrades to a graceful
 * failed-resolve rather than a throw (return-a-sentinel convention, CLAUDE.md).
 */
```

Note the tension the executor must resolve deliberately: `qq.resolve` currently **re-throws** on
failure so `detailsLoaded` stays `false` and the next play retries (`qq.ts:275-281`). A
direct→proxy fallback must be a private never-throw helper *inside* resolve, with the public
`resolve` keeping its throw contract. Do not flip the public boundary.

---

### 5. `src/lib/services/api-base.ts` — `apiUrl` "already absolute" guard (D-13)

**Self-analog.** The whole function is 4 lines (`api-base.ts:26-29`):

```typescript
/**
 * Resolve an own-origin `/api/*` path against the configured API base.
 *
 * Returns `path` unchanged when `VITE_API_BASE` is unset/empty (web: same-origin relative),
 * and `BASE + path` when it is set (native: absolute cross-origin to the deployed proxy).
 */
export function apiUrl(path: string): string {
	const BASE = import.meta.env.VITE_API_BASE ?? '';
	return BASE + path;
}
```

**The module's posture doc-block (`api-base.ts:1-19`) is the comment style to extend** — it
enumerates the WEB branch, the NATIVE branch, the lazy-read reason, and the "adds NO secret, NEVER
decides CORS" scope statement. The new guard adds a THIRD branch and the doc-block must gain a
matching bullet, in the same voice. Note the existing lazy-read note is load-bearing for tests:

```
//  - BASE is read LAZILY inside apiUrl on every call (not captured at module load) so a
//    test's vi.stubEnv('VITE_API_BASE', ...) flips behavior across both branches without a
//    rebuild.
```

Keep it lazy; the new guard goes inside the function, not at module scope.

---

### 6. `src/lib/config/defaults.ts` — the default change + stale comment (D-02 / D-04)

**Self-analog** (`defaults.ts:81-89`):

```typescript
// ---- Playback --------------------------------------------------------------------------
export const PLAYBACK_DEFAULTS = {
	defaultQuality: '128' as DefaultQuality, // D-03 — 128–160k band for fast resolve
	downloadQuality: 'lossless' as DefaultQuality, // favours quality over speed
	defaultSource: 'auto' as DefaultSource,
	autoExpandOnPlay: false,
	/** Per-source enable map. Empty = each adapter's own enabledByDefault wins. */
	enabledSources: {} as Partial<Record<SourceId, boolean>>
} as const;
```

**THREE stale-comment sites, not one.** D-04 names only `defaults.ts:82`; the same wrong claim is
duplicated in two more places and both must move together or the decision record stays wrong:

`src/lib/stores/settings.svelte.ts:154-157`:
```typescript
	// D-03: default to the 128–160k band so audio URLs resolve/stream faster. The
	// source ladders (QQ/JOOX/Kuwo) read this via pickByQualityPref; higher tiers
	// remain user-selectable.
	defaultQuality = $state<DefaultQuality>(PLAYBACK_DEFAULTS.defaultQuality);
```

`src/lib/sources/qq.ts:88-96` (`pickBestPlayUrl`'s doc-block) — "D-03: when
`settings.defaultQuality === '128'` … so the **128–160k band** is preferred". Same 98kbps error.

**No i18n change needed.** The settings UI already offers the `'auto'` rung
(`src/routes/(app)/settings/playback/+page.svelte:16` → `settings.optAuto`) and the honest note key
`settings.defaultQualityNote` ("Best-effort — sources don't all expose bitrate") still reads true.
D-02 activates an existing, already-labelled option; zero of the 16 dictionaries change.

---

### 7. `src/lib/services/dedupe.ts` — promote `qq` in `SOURCE_RANK` (D-08)

**Self-analog.** One line plus its 20-line comment block (`dedupe.ts:8-25`). The comment block is
the actual artifact — every rank in it is justified in prose, so a new rank without a new paragraph
breaks the file's own convention:

```typescript
// Tie-break when quality is equal/unknown. Tune freely.
// 5sing is UGC (covers / 伴奏 / 原创) — it should NEVER win a tie against a mainstream CN
// source ... Rank lowest (hvu).
// Jamendo (ixw) is also non-mainstream — Creative-Commons indie ... Rank -1 ...
// Audius (0zn) is likewise non-mainstream ...
// YTMusic (Plan 27) is off the resolve floor (autoResolveEligible:false) ...
const SOURCE_RANK: Record<SourceId, number> = { netease: 4, qq: 3, kuwo: 2, joox: 1, fivesing: 0, jamendo: -1, audius: -1, ytmusic: -1 };
```

**The consumer** (`dedupe.ts:61-71`) — note the rank only breaks a QUALITY tie, and a user's
`defaultSource` preference outranks it:

```typescript
function better(a: Track, b: Track, preferred?: SourceId): Track {
	const qa = qualityRank(a);
	const qb = qualityRank(b);
	if (qa !== qb) return qa > qb ? a : b;
	// quality tie → a user-preferred source wins, else the static source ranking
	if (preferred) { ... }
	return SOURCE_RANK[a.source] >= SOURCE_RANK[b.source] ? a : b;
}
```

**Planner note:** the record is `Record<SourceId, number>` and exhaustive. Bumping qq to `5` is a
one-token diff; swapping qq↔netease (`qq: 4, netease: 3`) preserves the existing max. Prefer the
swap — it keeps the range unchanged so no other rank's relative meaning shifts. Also note the
tie-break only fires on EQUAL `qualityRank`; at search time both stubs are `quality: null` →
rank 0, which is exactly why netease currently wins every row (D-08's premise confirmed in code).

---

### 8. `src/lib/stores/player.svelte.ts` — `Content-Length` ceiling in `prebufferNext` (D-15)

**Self-analog.** The function in full (`player.svelte.ts:2565-2607`) — the doc-block is the
contract to preserve:

```typescript
	/**
	 * BOUNDED next-song blob pre-buffer (bg-lockscreen-stall-noskip). ...
	 * BOUNDED (the f7c2580 flood fix): prebufferedUid is claimed BEFORE the await and left set on BOTH a
	 * 200-OK AND a failure/abort, so a dead or slow URL is fetched AT MOST ONCE per uid and NEVER re-
	 * fetched on churn; single in-flight (a newer next aborts the prior); fired only from the ≥5s
	 * timeupdate prefetch gate (prewarmNextAssets), never on the never-stop churn. Skipped for a
	 * downloaded track (offline blob serves it) and where fetch/URL are absent. Raw fetch of media bytes
	 * (NOT apiFetch — media never routes through the /api governor). Never throws, never bumps playGen.
	 */
	private async prebufferNext(track: Track) {
		if (!browser) return;
		const url = track.audioUrl;
		if (!url) return;
		if (typeof fetch === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
		if (library.isDownloaded(track.uid)) return; // offline-blob branch already serves this locally
		if (this.prebufferedUid === track.uid) return; // already buffered OR already attempted (flood fix)
		this.prebufferController?.abort();
		this.prebufferController = new AbortController();
		const sig = this.prebufferController.signal;
		this.prebufferedUid = track.uid;
		try {
			const resp = await fetch(url, { signal: sig, referrerPolicy: 'no-referrer' });
			if (sig.aborted) return;
			if (!resp.ok) return; // dead URL — leave the uid claimed so it is NOT re-fetched (play() uses the CDN URL)
			const blob = await resp.blob();          // ← D-15's ceiling goes BEFORE this line
			if (sig.aborted) return;
			if (this.prebufferedBlobUrl) URL.revokeObjectURL(this.prebufferedBlobUrl);
			this.prebufferedBlobUrl = URL.createObjectURL(blob);
		} catch {
			/* abort / CORS / network — uid stays claimed (no re-fetch); play() falls back to the CDN URL */
		}
	}
```

**Insertion point:** between `if (!resp.ok) return;` and `await resp.blob()`. Reading
`resp.headers.get('content-length')` there costs nothing (head already arrived) and skipping means
returning early with `prebufferedUid` still claimed — which is the CORRECT behaviour and matches the
existing `!resp.ok` branch's comment verbatim ("leave the uid claimed so it is NOT re-fetched;
play() uses the CDN URL"). Absent/unparseable `Content-Length` must fall through to the blob (a
`Number.isFinite` check, never a truthiness check), or a header-less CDN silently loses the
`bg-lockscreen-stall-noskip` protection D-15 explicitly preserves.

**Threshold-constant style analog** — `src/lib/services/blob-store.ts:29-38`, the repo's canonical
"one magic number, one boundary, one paragraph of why":

```typescript
// 31-D-13: minimum plausible size for a stored audio Blob. 8192 bytes is well BELOW any real audio
// file (~0.5s of 128kbps) and well ABOVE a truncated/empty write, so the floor can only ever reject
// bytes that were never going to decode. A rejected Blob is returned as `null` — i.e. it behaves
// EXACTLY like a cache miss, and every reader ... already falls through to ensureTrackDetails on a
// null. That is why the gate lives at this single read boundary instead of at the three call sites:
// one guard, zero call-site cost, no reader can forget it.
const MIN_BLOB_BYTES = 8192;
```

Note this is the *inverse* guard (a floor, not a ceiling) on the same data path, and it already
demonstrates the arithmetic style D-15's ceiling needs (bytes, justified against a bitrate).
`private static UPPER_SNAKE` is the house form for a class tunable (CLAUDE.md); a module const is
fine too — `player.svelte.ts` uses both (`SRC_REDRIVE_CAP`, `FAILURE_CAP`).

**Provenance note the executor must not break:** the prebuffer blob is consumed at
`player.svelte.ts:2990-3000` and tagged `kind = 'prebuffer-blob'` precisely so `audio.error` can
discard it without evicting a library download (31-D-12). Skipping the prebuffer means that branch
simply does not fire — no other change is needed.

---

### 9. `src/lib/stores/player.svelte.ts` — background mid-resolve (D-06 / D-07)

**Analog: `src/lib/services/prewarm.ts` — the whole file (57 lines). Copy this, do NOT copy the
generation-guard idiom.** CONTEXT.md offers the executor a choice ("must follow it, or must be
explicitly fire-and-forget"); prewarm.ts is the pre-existing answer for exactly this shape and it
already carries the reasoning:

```typescript
// prewarm — speculative resolve fired on a user gesture, BEFORE the tap that plays (31-D-03).
//
// WHY IT IS A SERVICE AND NOT TWO INLINE COMPONENT EFFECT BODIES: there is no jsdom test project in
// this repo (vite.config.ts defines a single node `server` project), so logic living inside a
// `.svelte` file is unverifiable. ...
// POSTURE (mirrors the never-throw service boundary in deezer.ts:10-24):
//  - returns void, never awaits, NEVER throws: pre-warm is speculative work, so a failure must be
//    completely invisible — no error surfaced, no generation counter bumped, no effect on what plays.
//  - all state is PLAIN — this is a pure `.ts`, not a runes store; the UI never reads any of it.

const MAX_TRACKED_UIDS = 300;
const warmed = new Set<string>();

export function prewarmTrack(track: Track | null | undefined): void {
	if (!track?.uid) return;
	if (track.detailsLoaded && track.audioUrl) return;
	if (warmed.has(track.uid)) return;
	if (warmed.size >= MAX_TRACKED_UIDS) warmed.clear();
	warmed.add(track.uid);
	// Fire-and-forget. Recorded BEFORE the call so a second trigger during the in-flight resolve
	// (a re-rank, a re-opened menu) is suppressed by the Set rather than racing it.
	void ensureTrackDetails(track).catch(() => {});
}

/** TEST-ONLY: drop the dedupe state between cases (mirrors api-base.ts's `__resetGovernor`). */
export function __resetPrewarm(): void { warmed.clear(); }
```

Why this and not a generation guard: a generation guard exists to decide whether a late result may
**write back** to `current` / `audio.src`. D-07 forbids the write-back outright, so there is nothing
for a guard to protect and `myGen` would be dead code. Under D-07 the correct shape is a plain
uid-keyed dedupe Set + `void …catch(() => {})`, exactly as above. **Put it in a new pure `.ts`
service, not in `player.svelte.ts`** — CLAUDE.md lists the 3017-line god object as known debt and
prewarm.ts records the "unverifiable if it lives in a non-`.ts`" reason.

**For completeness, the canonical generation-guard instance** (so the planner can state in the plan
that it was deliberately NOT used) — `player.svelte.ts:2762-2772` + `:2901`:

```typescript
		// Bump the play-generation so any older in-flight fallback bails (gte). Skipped on a
		// fallback continuation — the fallback IS the continuation of the user's original intent
		// and must not invalidate itself.
		if (!opts?.fromFallback) this.playGen++;
		// CR-02: snapshot the generation right after the (conditional) bump and re-check it after
		// EVERY await below before writing current / audio.src / Media Session. ... Without this, a
		// slow resolve for an earlier tap could settle late and clobber the track the user actually chose.
		const myGen = this.playGen;
		...
			if (myGen !== this.playGen) return; // CR-02: superseded mid-resolve — discard
```

Also note the fire-and-forget precedent already inside the store for a non-write-back background
task (`player.svelte.ts:2953`), which the D-06 resolve mirrors:

```typescript
			// A cache HIT must never render worse than a MISS, so fill the lyrics pane out of band
			// through the same best-effort mechanism the offline-blob path uses — never awaited,
			// never throws, never bumps a generation.
			if (resolved.lrcUnresolved && !resolved.lrc) this.backfillLyrics(resolved);
```

---

### 10. `src/lib/proxy/resolve-cache.ts` + `resolve-edge.ts` + `routes/api/resolve/+server.ts` (D-10)

**Self-analogs.** What follows is the code that becomes DEAD or changes meaning when the stored
value is a permanent `song_mid` instead of an expiring URL.

**(a) Version/TTL encoding — `resolve-cache.ts:17-47`:**

```typescript
/**
 * Entry-shape version, carried IN the key. A shape change is a KEY change, never an in-place
 * migration: `cache.delete` is PoP-local (31-D-09) so old entries cannot be purged globally —
 * bumping `v` simply makes every PoP miss onto the new namespace and lets the old one expire.
 */
export const RESOLVE_CACHE_VERSION = '1';

/**
 * 15 minutes. CN audio URLs are signed and short-lived, so a long TTL just pins dead URLs;
 * an entry that dies EARLIER is handled by the D-09 bust (the client reports the failure and
 * the edge drops the entry) rather than by a shorter TTL for everyone.
 */
export const RESOLVE_TTL_S = 900;

export interface ResolveEntry {
	source: string | null;
	songid: string | null;
	url: string | null;          // ← the field D-10 removes
	avail: Record<string, 'ok' | 'dry'>;
}
```

**D-10 is a shape change → it is a KEY change.** The doc-block above already prescribes the
migration: bump `RESOLVE_CACHE_VERSION` to `'2'`. That is the entire migration; no purge, no
in-place read of the old shape. This is the single most important line for the planner to carry.

**(b) The key builder (unchanged, reuses `matchKey` per Claude's Discretion) —
`resolve-cache.ts:49-58`:**

```typescript
/**
 * The versioned, NORMALIZED synthetic own-origin cache key. `/api/resolve/_k` is NOT a real
 * route — it is a pure key namespace, exactly like `/api/og/_resolve`. Normalizing through
 * `matchKey()` collapses case, spacing, punctuation and query-order variants onto ONE entry.
 */
export function resolveCacheKey(origin: string, artist: string, title: string): Request {
	return ownOriginCacheKey(
		`${origin}/api/resolve/_k?v=${RESOLVE_CACHE_VERSION}&k=${encodeURIComponent(matchKey(artist, title))}`
	);
}
```

**(c) The TTL write — `resolve-cache.ts:99-114`. This is where `RESOLVE_TTL_S` is consumed, and the
line D-10 changes:**

```typescript
		await cache.put(
			key,
			new Response(JSON.stringify(entry), {
				status: 200,
				headers: {
					'content-type': 'application/json',
					'Cache-Control': `public, max-age=${RESOLVE_TTL_S}`      // ← permanent-mid: raise / drop
				}
			})
		);
```

**(d) What becomes DEAD under a never-expiring `song_mid`:**

| Code | Fate under D-10 | Evidence |
|---|---|---|
| `RESOLVE_TTL_S = 900` | value changes (a long `max-age`); the *comment* justifying 900 is entirely about signed URL lifetime and becomes false | `resolve-cache.ts:22-27` |
| `bustResolveEntry` (`resolve-cache.ts:120-135`) | **dead** — a permanent mid has nothing to bust | its doc-block: "the client reports a dead entry and the data center it reached drops it" |
| `POST` handler (`+server.ts:110-141`) | **dead** — its only job is calling `bustResolveEntry` | "31-D-09 cache bust. DELETE-ONLY, structurally" |
| `EdgeCache.delete` (`edge-cache.ts:14-24`) | interface member becomes unused *if no other route deletes* — grep before removing; the doc-block explicitly forbids replacing it with a cast | `edge-cache.ts:14-24` |
| `resolve-cache-client.ts` `servedUrls` / `reported` / `reportDeadUrl` | **dead** — the whole self-gating bust registry exists to report dead URLs | `resolve-cache-client.ts:41-56` |
| `+server.ts` `jsonResult`'s `'Cache-Control': 'no-store'` | **must STAY** — see below | `+server.ts:34-52` |

**Do not "simplify" the `no-store` when the bust goes away.** Its doc-block records a shipped bug:

```
 * Shipping `public, max-age=RESOLVE_TTL_S` here silently defeated the whole bust path: Cloudflare/
 * workerd stored the `{hit:true, entry}` JSON in the AUTOMATIC response cache keyed on the request
 * URL, so after a successful POST bust ... the next GET still came back `{hit:true}` with
 * `CF-Cache-Status: HIT` for up to 900s — handing the client back the exact dead URL it had just
 * reported. D-11 makes that path load-bearing, not an edge case.
```

D-11 carries forward ("advisory, never authoritative"), and a self-repairing STALE mid still needs
the entry re-fillable. Leave `no-store` and say so in the plan.

**(e) `resolve-edge.ts` — the edge-side resolver to retarget from kuwo to qq.** Its BOUNDS block and
its per-await abort re-checks are the pattern to preserve verbatim:

```typescript
// BOUNDS (T-31-03-06) — this is a background fill, not the user's hot path: `limit=10` on the
// search, `retries=1` on both calls, at most TWO subrequests, and no second source is walked.
const SEARCH_LIMIT = '10';
const RETRIES = 1;
const DRY: ResolveEntry = { source: null, songid: null, url: null, avail: { kuwo: 'dry' } };

export async function resolveOnEdge(artist, title, signal): Promise<ResolveEntry | null> {
	try {
		...
		const searchRes = await fetchWithRetry(searchUrl, { signal }, RETRIES);
		if (signal.aborted) return null; // supersedence re-check after every await
		if (!searchRes.ok) return null;
		...
		// matchKey — never a local lowercase/strip — so the edge normalizes IDENTICALLY to the
		// client's dedupe, cover cache and lyric fallback, and to resolveCacheKey's key folding.
		const want = matchKey(artist, title);
		const row = (searchBody.data as KuwoSearchRow[]).find(
			(r) => matchKey(String(r?.artist ?? ''), String(r?.name ?? '')) === want
		);
		...
	} catch {
		// Any throw (network, abort, malformed JSON, an unsupported buildUrl path) is a FAULT.
		return null;
	}
}
```

**Big simplification available and worth flagging:** a qq mid comes off the SEARCH row
(`song_mid` is on every search result — see the phase note, Finding 3). So `resolveOnEdge` for D-10
drops the DETAIL call entirely: **ONE subrequest, not two**, and the whole `detailUrl`/`detailBody`
block (`resolve-edge.ts:85-100`) becomes dead. Also note the file's standing rule, which the qq
rewrite must keep:

```typescript
		// This file deliberately contains ZERO references to the CLIENT fetch seam in
		// $lib/services/api-base — that governor is browser-side and must not run edge-side.
```

Edge fetches go through `fetchWithRetry` (`$lib/proxy/http.ts`) and the upstream URL through
`<source>Proxy.buildUrl` — so a qq version needs `qqProxy.buildUrl('search', …)` from
`$lib/proxy/qq.ts`, never a hand-written host string.

**(f) The FAULT-vs-NEGATIVE discipline (`resolve-cache.ts:82-97`) survives unchanged and must be
restated for the mid entry:**

```
 * NEGATIVE-CACHING RULE (D-06(c)) ... a CLEAN "kuwo searched and this song is not there" IS
 * written ... because a genuine negative makes the repeat crawl cost ZERO subrequests. An upstream
 * FAULT (network error, non-200, contract drift) must write NOTHING — a fault has to be retried
 * next request, not pinned for the whole TTL. Enforcing that is the CALLER's job.
```

With a PERMANENT entry this rule gets sharper, not looser: a wrongly-written negative is now
forever. The plan should call that out explicitly — a permanent negative for "qq has no mid for this
song" is a much bigger commitment than a 900s one, and the sane choice is to write negatives with a
SHORT `max-age` even while positives are permanent (two TTLs, one entry shape).

---

### 11. NEW: connection detection for `'auto'` (D-02 / D-03) — no functional analog

Nothing in `src/` reads `navigator.connection`. Confirmed by grep across `src/lib` + `src/routes`:
the only `navigator.*` reads are `onLine` (2 sites), `mediaSession` (1 site), plus `matchMedia`
reduced-motion probes.

**Imitate for STRUCTURE and PURITY: `src/lib/sources/quality.ts`** — a tiny pure `.ts` beside the
consumer, taking its input as an argument, node-testable with no store mock, with a doc-block that
states what it deliberately does NOT do. That is the file this helper should look like.

**Imitate for GUARD STYLE: `src/lib/stores/online.svelte.ts`** — the repo's only other
`navigator`-capability reader, in full (30 lines):

```typescript
// Reactive online/offline signal (Svelte 5 runes singleton, OFFL-03). Browser-guarded
// like history.svelte.ts: the $state initializer is SSR-safe and init() only attaches
// window listeners in the browser. The SSR default is `true` — entity routes now SSR
// (D-01/D-02) and any surface rendered server-side must ASSUME online rather than flash
// an offline state.
import { browser } from '$app/environment';

class Online {
	/** Mirrors navigator.onLine in the browser; defaults true under SSR (assume online). */
	isOnline = $state(browser ? navigator.onLine : true);

	init(): () => void {
		if (!browser) return () => {};
		const on = () => (this.isOnline = true);
		...
	}
}

export const online = new Online();
```

Read the two guard styles side by side and pick per the rule below:

| Guard form | Where used | When to use it |
|---|---|---|
| `import { browser } from '$app/environment'; if (!browser) return …` | `online.svelte.ts:11`, `blob-store.ts:178`, `prebufferNext` | SSR/native-build gating |
| `typeof navigator !== 'undefined' && 'mediaSession' in navigator` | `player.svelte.ts:1143` | genuine FEATURE detection of an optional API |
| `typeof indexedDB === 'undefined'` | `blob-store.ts:178` | optional platform API absent in some runtimes |

**`navigator.connection` needs BOTH** — `browser` for SSR, and an `in`/`typeof` probe because iOS
Safari ships no Network Information API at all (D-03's whole premise). `player.svelte.ts:1143` is
the exact double-guard precedent:

```typescript
		return typeof navigator !== 'undefined' && 'mediaSession' in navigator
```

**Typing:** `NetworkInformation` is NOT in the TS DOM lib for `navigator.connection`, and CLAUDE.md
records **zero `as any` in production source**. The house pattern for narrowing an untyped platform
API is the local structural interface + a single narrowing cast, as in `edge-cache.ts`:

```typescript
export interface EdgeCache { match(...): …; put(...): …; delete(...): …; }
interface EdgeCacheStorage { default?: EdgeCache; }

export function edgeCache(): EdgeCache | null {
	if (typeof caches === 'undefined') return null;
	return (caches as unknown as EdgeCacheStorage).default ?? null;
}
```

…and the inline `as { any?: … }` narrowing in `itunes-cover.ts:159`:

```typescript
	const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([caller, timeout]) : timeout;
```

Both are `as unknown as <local interface>` / `as { field?: T }` — never `as any`. Copy either.

**Recommended shape (from the two analogs above):** a pure `src/lib/sources/quality.ts` addition or
a sibling ~25-line `.ts`, exporting one function returning a narrowed `DefaultQuality`, taking no
store import, with the D-03 iOS tradeoff written into the doc-block so a future verifier reads the
decision instead of "fixing" it. Not a runes store — nothing in the UI reads it (the `online` store
is reactive only because banners subscribe to it; this value is read once per resolve).

---

## Shared Patterns

### Never-throw service boundary
**Source:** `src/lib/services/prewarm.ts:14-19`, `itunes-cover.ts:180-186`, `resolve-edge.ts:46-48`
**Apply to:** every new async function in this phase except `qq.resolve`'s public boundary
```typescript
	} catch {
		// Non-ok / abort / timeout / malformed JSON / network failure → miss → <sentinel>.
		return null;
	}
```
`qq.resolve` is the documented EXCEPTION and must keep re-throwing so `detailsLoaded` stays false:
```typescript
		} catch (e) {
			// 失败的话不要把 detailsLoaded 置 true，下次还有机会重试 (legacy:2392-2395).
			throw e instanceof Error ? e : new Error('qq detail error');
		}
```

### Bounded fetch (caller signal + hard deadline)
**Source:** `src/lib/services/itunes-cover.ts:156-161` (identical copies in `deezer.ts`,
`resolve-cache-client.ts`)
**Apply to:** the D-12 direct qq detail call
```typescript
function combinedSignal(caller?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	if (!caller) return timeout;
	const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([caller, timeout]) : timeout;
}
```

### Edge-side abort re-check after every await
**Source:** `src/lib/proxy/resolve-edge.ts:66-83`
**Apply to:** the D-10 `resolveOnEdge` rewrite
```typescript
		const searchRes = await fetchWithRetry(searchUrl, { signal }, RETRIES);
		if (signal.aborted) return null; // supersedence re-check after every await
```

### `matchKey` as the ONLY normalizer
**Source:** `src/lib/services/match-key.ts` + its two call sites (`resolve-cache.ts:56`,
`resolve-edge.ts:76-80`)
**Apply to:** the D-10 key and the D-10 row match. Note the deliberate divergence recorded in
`match-key.ts:9-15` — `matchKey` is `artist|title`, `dedupe.ts` `key()` is `title|artist`, and they
must NOT be unified. Do not "fix" it.

### TEST-ONLY module-state reset
**Source:** `api-base.ts:__resetGovernor`, `prewarm.ts:__resetPrewarm`,
`resolve-cache-client.ts:__resetResolveCacheClient`
**Apply to:** any new module holding a Set/Map (the D-06 dedupe Set)
```typescript
/** TEST-ONLY: drop the dedupe state between cases (mirrors api-base.ts's `__resetGovernor`). */
export function __resetPrewarm(): void { warmed.clear(); }
```

### Decision-ref comment tagging
**Source:** CLAUDE.md § Comments; live examples throughout (`31-D-07`, `WR-03`, `T-31-03-04`,
`quick-260629-nyl`, `(legacy:2330-2345)`)
**Apply to:** every change in this phase. Use `32-D-NN`. Where a phase-32 decision REVERSES an
existing ref (D-09 reverses `legacy:2312-2315`; D-02/D-04 reverse `D-03`), replace the ref with a
`32-D-NN` ref that names what it superseded and why — never silently delete the old one.

---

## Test Analogs

Single Vitest node/server project, no jsdom (`vite.config.ts`); tests co-located `<name>.test.ts`.

| Target file | Test file | Status |
|---|---|---|
| `sources/qq.ts` | `src/lib/sources/qq.test.ts` | exists — fixture-backed, **has tests that MUST change** |
| `sources/quality.ts` | `src/lib/sources/quality.test.ts` | exists — **has an `'auto'` test that MUST change** |
| `config/defaults.ts` | none (covered by `stores/settings.svelte.test.ts`) | **has a test that MUST change** |
| `services/api-base.ts` | `src/lib/services/api-base.test.ts` | exists — `apiUrl` branch tests |
| `services/dedupe.ts` | `src/lib/services/dedupe.test.ts` | exists |
| `stores/player.svelte.ts` | `src/lib/stores/player.svelte.test.ts` | exists — heavy `vi.mock` harness |
| `proxy/resolve-cache.ts` | `src/lib/proxy/resolve-cache.test.ts` | exists — in-memory cache shim |
| `proxy/resolve-edge.ts` | `src/lib/proxy/resolve-edge.test.ts` | exists |
| `routes/api/resolve/+server.ts` | none co-located | route tests live elsewhere; unit-test via `$lib` |
| NEW connection helper | NEW `<name>.test.ts` beside it | model on `quality.test.ts` |

### EXISTING TESTS THAT WILL FAIL AND MUST BE UPDATED (not "fixed")

`src/lib/stores/settings.svelte.test.ts:19-21` — pins the old default verbatim:
```typescript
describe('settings (D-03 defaultQuality default)', () => {
	it("defaults defaultQuality to '128' (D-03)", () => {
		expect(settings.defaultQuality).toBe('128');
```

`src/lib/sources/quality.test.ts:59-62` + `:70-72` — pin `'auto'` as a no-op:
```typescript
	it("pref 'auto' returns the input order unchanged", () => {
		const out = pickByQualityPref(JOOX_ORDER, 'auto');
		expect(out).toEqual(JOOX_ORDER);
	});
```
(If D-02 is implemented by narrowing `'auto'` upstream — recommended option (a) above — these two
stay GREEN untouched. That is a second argument for (a).)

`src/lib/sources/qq.test.ts:218-227` — the `'128'` promotion test stays valid (the pref still
exists), but the file pins `settings.defaultQuality = 'lossless'` in ~8 cases as a workaround for
the old default; those keep passing.

### Representative test excerpts to match for house style

**Pure-function test — `src/lib/sources/quality.test.ts:19-42`** (model for the connection helper
and any new ladder logic; note the invariant assertions at the end, not just the happy path):
```typescript
describe('pickByQualityPref (D-03)', () => {
	it("pref '128' moves the 128–192 band to the front (stable); sub-128 AAC stays in rest (WR-02)", () => {
		const out = pickByQualityPref(JOOX_ORDER, '128');
		expect(out[0]).toBe('AAC 192');
		expect(out.slice(0, 3)).toEqual(['AAC 192', 'OGG 192', 'MP3 128']);
		// WR-02: ... The old `aac` branch wrongly promoted 96/48kbps into the 128 band — a 128k
		// request could then yield a 48k stream.
		expect(out.slice(3)).toEqual([...]);
		// no tier dropped, none duplicated
		expect(out.length).toBe(JOOX_ORDER.length);
		expect([...out].sort()).toEqual([...JOOX_ORDER].sort());
	});
```

**Source-adapter test — `src/lib/sources/qq.test.ts:1-25, 87-94`** (fixture + stubbed global fetch +
per-case settings pin; model for D-05/D-09/D-12 assertions on the built URL):
```typescript
import searchFixture from './__fixtures__/qq.search.json';
import detailFixture from './__fixtures__/qq.detail.json';

function mockFetchOnce(body: unknown, contentType = 'application/json') {
	return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
			status: 200, headers: { 'content-type': contentType }
		});
	});
}
	// D-03: the ladder now reads settings.defaultQuality. Pin it per-case so the
	let prevQuality: typeof settings.defaultQuality;
		prevQuality = settings.defaultQuality;   // beforeEach
		settings.defaultQuality = prevQuality;   // afterEach
```
…and the URL assertion form D-09/D-12 need (`qq.test.ts:58-60`):
```typescript
		// it hits the same-origin proxy /api/qq/search
		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toMatch(/^\/api\/qq\/search\?/);
```
D-09 asserts the inverse: `expect(calledUrl).not.toMatch(/[?&]msg=/)`. D-12 asserts the detail URL
is the absolute upstream host.

**`apiUrl` branch test — `src/lib/services/api-base.test.ts:30-40`** (the exact shape D-13's guard
needs a third case added to):
```typescript
describe('apiUrl — VITE_API_BASE branch', () => {
	it('returns the path unchanged when VITE_API_BASE is unset/empty (web: same-origin relative)', () => {
		vi.stubEnv('VITE_API_BASE', '');
		expect(apiUrl('/api/x')).toBe('/api/x');
	});
	it('prepends the base when VITE_API_BASE is set (native: absolute cross-origin)', () => {
		vi.stubEnv('VITE_API_BASE', 'https://base.example');
		expect(apiUrl('/api/x')).toBe('https://base.example/api/x');
	});
});
```
Add: with the base SET, `apiUrl('https://tang.api.s01s.cn/...')` returns it unchanged. Note the
`afterEach` in that file calls `__resetGovernor()` because the breaker holds module state — a new
test that trips failures must do the same.

**Edge-cache test with an in-memory shim — `src/lib/proxy/resolve-cache.test.ts:21-36`** (model for
the D-10 permanent-entry tests; note the honest scope caveat in its header):
```typescript
// NOTE: `edgeCache()` returns null under vitest/`vite dev` by design, so REAL Cache API
// semantics (PoP scoping, put throwing on Vary:*) are NOT provable here — they are deferred to
// the manual verification in 31-VALIDATION.md. What IS provable ... is the LOGIC against an
// in-memory shim.
function stubCache() {
	const store = new Map<string, Response>();
	const putKeys: string[] = [];
	const cacheStub = {
		match: vi.fn(async (req: Request) => { const hit = store.get(req.url); return hit ? hit.clone() : undefined; }),
		put: vi.fn(async (req: Request, res: Response) => { putKeys.push(req.url); store.set(req.url, res.clone()); }),
		delete: vi.fn(async (req: Request) => store.delete(req.url))
	};
	return { store, putKeys, cacheStub: cacheStub satisfies EdgeCache };
}
```
The `satisfies EdgeCache` (not `as`) is the house form. A D-10 test asserting the `max-age` on the
stored response reads it off `store.get(key.url)!.headers.get('cache-control')`.

**Track factory for service tests — `src/lib/services/prewarm.test.ts:13-32`** (also in
`dedupe.test.ts` as `mk()`); copy one rather than writing a third variant.

**Store test harness — `src/lib/stores/player.svelte.test.ts:11-49`.** Every external seam is
`vi.mock`ed, `$app/environment` is forced `browser: true`, and `api-base` is partially mocked via
`importOriginal` so only `apiFetch` is stubbed:
```typescript
vi.mock('$app/environment', () => ({ browser: true }));
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn(...) }));
vi.mock('$lib/services/api-base', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/api-base')>();
	return { ...actual, apiFetch: mockApiFetch };
});
```
D-15's `Content-Length` test needs a `vi.stubGlobal('fetch', …)` returning a `Response` with an
explicit `content-length` header, then asserts `resp.blob` was never read / no `blob:` URL created.
`prebufferNext` is `private` — reach it the way the existing suite reaches private paths (drive
`prewarmNextAssets` via the public play/timeupdate path), or make the ceiling check a small exported
pure predicate in a `.ts` and unit-test that directly. **Prefer the exported predicate** — it is the
`media-session.ts` / `history-logic.ts` "extract the branchy bit, keep the store a thin caller"
pattern CLAUDE.md names, and it avoids adding to the 3017-line god object's test harness.

---

## Conventions

Derived repo-wide within `src/lib` via `gsd-tools verify conventions --derive --scope src/lib`
(the same deterministic module `gsd-code-reviewer` uses):

| Axis | Dominant | Share | Entropy | Status |
|---|---|---|---|---|
| file-name casing | — (`other` 95 / `camel` 63 / `kebab` 40) | 48% | 0.946 | **contested hotspot** |
| identifier casing | `camel` (495/521) | 95% | 0.203 | **named contract** |
| export style | `esm` (112/112) | 100% | 0 | **named contract** |
| import style | `esm` (174/174) | 100% | 0 | **named contract** |

**Named contracts** (≥70% dominance) — non-negotiable for this phase: `camelCase` identifiers,
ESM `export`/`import` only (no `module.exports`/`require` anywhere in `src/`), named exports (no
default exports in `$lib`).

**Contested hotspots (author's choice).** `file-name casing` is contested at 48% dominance and you
cannot deviate from the author's local choice. The 0.946 entropy is *not* drift — it is three
intentional, per-directory-consistent naming regimes overlapping in one scope, the same shape as
the canonical **CJS↔SDK dual-resolver** split (`bin/lib/**` CJS `module.exports`/`require` vs
`sdk/src/**` ESM `export`/`import`: each half internally consistent per-directory, contested only
when measured repo-wide). Here the three regimes are:

- `kebab-case.ts` — pure services/logic (`match-key.ts`, `resolve-cache.ts`, `api-base.ts`,
  `blob-store.ts`, `itunes-cover.ts`)
- `camelCase.svelte.ts` / `camelCase.ts` — runes stores and `use:` actions (`sleepTimer.svelte.ts`,
  `searchSession.svelte.ts`, `actionLog.svelte.ts`, `tapBounce.ts`, `dragReorder.ts`)
- `other` (the 95, mostly `PascalCase.svelte` + dotted `*.svelte.ts` / `*.test.ts`) — components
  and the runes/test suffixes

**Match the directory's local style, not the repo aggregate.** For this phase that means: the new
connection-detection helper goes in `src/lib/services/` or `src/lib/sources/` as **kebab-case
`.ts`** (it is pure logic — `quality.ts`, `match-key.ts`, `prewarm.ts` are its neighbours), NOT
`camelCase`, and NOT `.svelte.ts` (it holds no `$state`).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| NEW connection-detection helper | service (capability probe) | synchronous platform read | No code in `src/` reads `navigator.connection`. Structural analogs assigned (`quality.ts` for shape/purity, `online.svelte.ts` for guard style, `edge-cache.ts`/`itunes-cover.ts` for the no-`as any` narrowing). |
| `routes/api/resolve/+server.ts` | route | request-response | Modified, not new — and it is its own analog. Its own header names `api/deezer/search/+server.ts` as the template it was copied from, if a fresh sibling is ever needed. |

---

## Metadata

**Analog search scope:** `src/lib/sources/`, `src/lib/services/`, `src/lib/proxy/`,
`src/lib/stores/`, `src/lib/config/`, `src/routes/api/`, `src/routes/(app)/settings/`,
`src/lib/i18n/en.ts`
**Files read:** 24 source + 8 test + 2 planning docs
**Pattern extraction date:** 2026-08-31
