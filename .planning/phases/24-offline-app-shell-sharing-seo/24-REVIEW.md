---
phase: 24-offline-app-shell-sharing-seo
reviewed: 2026-06-14T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - src/lib/services/share.ts
  - src/lib/services/sw-cache.ts
  - src/lib/stores/online.svelte.ts
  - src/service-worker.ts
  - svelte.config.js
  - src/app.html
  - src/lib/components/TrackMenu.svelte
  - src/routes/(app)/+layout.svelte
  - src/routes/(app)/song/[slug]/+page.ts
  - src/routes/(app)/song/[slug]/+page.svelte
  - src/routes/(app)/album/[name]/+page.ts
  - src/routes/(app)/artist/[name]/+page.ts
  - src/routes/(app)/album/[name]/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/routes/(app)/search/+page.svelte
  - src/routes/(app)/charts/top/+page.svelte
findings:
  critical: 1
  warning: 6
  info: 4
  total: 11
status: issues_found
---

# Phase 24: Code Review Report

**Reviewed:** 2026-06-14
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Reviewed the Phase 24 offline app-shell + sharing/SEO submission against the four focus areas.

- **SW cache-bypass correctness:** `shouldBypass` is sound and well-tested — non-GET, cross-origin, `range`, and same-origin `/api/*` are all bypassed before any cache touch. No `/api/*` or audio response can be cached. The bypass core is solid. However, the SW *fetch wrapper* (`service-worker.ts`) has a correctness bug: it caches `res.clone()` for ANY same-origin 200 GET including opaqueredirect / redirected responses, which throws and rejects the whole `respondWith` (see CR-01).
- **SSR-safety of entity routes:** I verified the SvelteKit 2.63.0 option-resolution order (`page_nodes.js#get_option` reduces root→leaf, leaf wins), so the per-page `ssr = true` correctly overrides the root `+layout.ts` `ssr = false`. The opt-in is valid; no `+page.server.ts`; entity `+page.svelte` module tops are import-clean. Good.
- **Share encode/decode + source enum:** round-trip is correct; the source enum matches the live `SourceId` union (`netease|qq|kuwo|joox|fivesing|jamendo`). Two real defects: `entityShareUrl` builds the key as `${source}${songid}` while the canonical `uid` is the COLON form `${source}:${songid}` — `parseEntityParam` returns `songid`, but no consumer in scope reconnects it to a colon-form uid (WR-02); and `parseEntityParam`'s greedy regex can mis-split a slug that itself contains a source name (WR-03).
- **Offline short-circuit:** the `online.isOnline` short-circuits are consistent across search/charts/album/artist, but every entity route leaves its skeleton stuck-on when the entity name is empty AND offline (the `n && !online.isOnline` guard requires a truthy name) (WR-01).

## Critical Issues

### CR-01: SW caches redirected / non-basic responses, throwing inside `respondWith` and breaking the fetch

**File:** `src/service-worker.ts:54-57`
**Issue:** After `shouldBypass` passes (same-origin, GET, non-`/api/`, no range), the handler does:
```ts
const res = await fetch(event.request);
if (res.status === 200) cache.put(event.request, res.clone());
return res;
```
`Cache.put()` **throws a TypeError** when the response is a redirect-followed response (`res.redirected === true`) or otherwise not storable. Any same-origin navigation/asset request that follows a 3xx (e.g. a trailing-slash redirect, an SSR entity route that 301s, or an auth/edge redirect on Cloudflare Pages) resolves to a `res.status === 200` with `res.redirected === true`. `cache.put` then rejects; because the `cache.put` promise is not awaited but the throw happens synchronously inside the async IIFE on the same tick as the `put` call resolution, the rejection surfaces as an unhandled rejection and — for the redirected-response case specifically — `cache.put` rejects the stored promise so the cloned body is discarded, but the **user-visible failure** is that `cache.put(request, redirectedResponse)` throws `TypeError: Cache.put() encountered a redirected response`. Since this is inside the `respondWith` async function, the throw rejects the `respondWith` promise and the browser shows a network error for that navigation. This is a correctness/availability defect on the primary app-shell path.
**Fix:** Only cache basic, non-redirected, same-origin 200 responses, and guard the put:
```ts
const res = await fetch(event.request);
if (res.status === 200 && res.type === 'basic' && !res.redirected) {
	const copy = res.clone();
	// don't let a put failure reject respondWith
	void cache.put(event.request, copy).catch(() => {});
}
return res;
```
(Alternatively reconstruct a clean `new Response(res.clone().body, res)` before putting.) Awaiting/catching the put also prevents the unhandled rejection.

## Warnings

### WR-01: Entity routes leave the skeleton stuck-on when the entity name is empty AND offline

**File:** `src/routes/(app)/artist/[name]/+page.svelte:179-197`, `src/routes/(app)/album/[name]/+page.svelte:142-180`
**Issue:** The offline short-circuit is guarded as `if (n && !online.isOnline) { loading = false; return; }`. The leading `n &&` means that when the route param decodes to an empty string (a malformed/deep link such as `/artist/` or `/album/`) AND the device is offline, neither the short-circuit branch nor the `if (n && loadedFor !== n)` fetch branch runs. `loading` was initialized to `true` (artist also inits `enrichLoading/albumsLoading/relatedLoading/dzLoading` to `true`), so the page renders a skeleton that never resolves — a permanent stuck spinner with no offline state and no empty state. The skeleton flags are only ever cleared inside the same name-gated branches.
**Fix:** Drop the `n &&` from the offline short-circuit so an empty name still clears the loaders offline, or clear all loading flags up front when `!n`:
```ts
if (!online.isOnline) { loading = false; enrichLoading = false; albumsLoading = false; relatedLoading = false; dzLoading = false; return; }
```

### WR-02: `entityShareUrl` emits `${source}${songid}` but the canonical uid is the COLON form `${source}:${songid}` — decode cannot reconstruct a real uid

**File:** `src/lib/services/share.ts:175-197`
**Issue:** `Track.uid` is documented as the colon form `` `${source}:${songid}` `` (see `src/lib/sources/types.ts`). `entityShareUrl` builds the authoritative key as `const id = `${t.source}${t.songid}`` (no separator), and `parseEntityParam` returns `{ source, id }` where `id` is just `songid`. There is no separator between source and id, so for a numeric-only `songid` it round-trips, but the reconstructed identity is `source` + `id` — a consumer that wants to rebuild the canonical `uid` must know to join them as `source:id`. No file in this phase's scope actually consumes `parsed` to rebuild a uid (`song/[slug]/+page.ts` only uses it for `titleFromSlug`), so this is latent — but the moment a consumer does `parsed.source + ':' + parsed.id` vs `parsed.source + parsed.id` the two will disagree. The encode/decode pair is also asymmetric with the rest of the codebase's colon convention.
**Fix:** Make the share key explicit and separator-bearing, e.g. encode `${source}:${songid}` (URL-encoding the colon) or document that the authoritative reconstruction is `` `${parsed.source}:${parsed.id}` ``. At minimum add a `uid` helper next to `parseEntityParam` so callers never hand-join.

### WR-03: `parseEntityParam` greedily mis-splits a slug whose text contains a source name

**File:** `src/lib/services/share.ts:165-197`
**Issue:** `ENTITY_SOURCE_RE = /-(netease|qq|kuwo|joox|fivesing|jamendo)([A-Za-z0-9]+)$/`. Regex alternation/backtracking will match the LAST `-source<alnum>$` occurrence, but a slug whose cosmetic text ends in a source-name word produces a wrong split. Verified empirically:
- `parseEntityParam('qq-band-kuwo99')` → `{source:'kuwo', id:'99'}` (correct-ish by luck, last match)
- `parseEntityParam('netease-fan-club-qq42')` → `{source:'qq', id:'42'}` (correct)
- But a real id whose `songid` is alphanumeric and whose slug contains a trailing source token can split at the wrong boundary, and `ENTITY_SOURCE_ONLY_RE` anchored `^` will mis-parse a slug-less param like `kuwonetease123` as `{source:'kuwo', id:'netease123'}`. Because `songid` is matched as `[A-Za-z0-9]+` and several sources (joox, qq, fivesing) DO carry alphanumeric ids, the boundary is genuinely ambiguous.
**Fix:** Use a non-cosmetic separator between slug and key (e.g. encode the key after a `~` or `--` sentinel: `/{type}/{slug}--{source}{id}`), or require the id segment to match each source's known id charset. Anchoring on a dedicated delimiter removes the ambiguity entirely.

### WR-04: `decodeShare` v2 substitutes `[current]` for an empty/all-invalid queue, silently fabricating a queue

**File:** `src/lib/services/share.ts:120-123`
**Issue:** `return { current, queue: queue.length ? queue : [current] };`. When the encoded queue is present but every entry fails `isStub` (corrupted token, or a legitimately empty `q: []`), the decoder fabricates `queue:[current]`. A caller cannot distinguish "sender shared no queue" from "queue was corrupted/dropped" — both yield a one-item queue. If the intent is "no queue → just the current track", that is fine, but it conflates data loss (queue silently discarded) with the no-queue case. Combined with `encodeShare`'s cap, an oversized/truncated token degrades to single-track playback with no signal.
**Fix:** Return `queue: []` when the decoded queue is empty/invalid and let the consumer decide whether to seed `[current]`, OR document the substitution explicitly. Do not let a partially-corrupt `q` array (some valid, some not) silently drop entries without bound — `filter(isStub)` already drops bad ones; ensure that is intended.

### WR-05: `slugify` combining-marks strip relies on a literal character-class range that may not cover all NFKD marks

**File:** `src/lib/services/share.ts:84`
**Issue:** `.replace(/[̀-ͯ]/g, '')` uses a literal range of the Combining Diacritical Marks block (U+0300–U+036F) embedded as raw characters in the source. NFKD decomposition also produces combining marks outside this block (e.g. U+1AB0–U+1AFF, U+20D0–U+20FF). For the cosmetic ASCII slug this is low-impact (the subsequent `[^a-z0-9]+` collapse drops them anyway), so the regex is redundant rather than wrong — but the embedded raw combining characters are fragile in source control / editors and the comment overstates coverage ("Strip combining marks").
**Fix:** Use the Unicode property escape `.replace(/\p{M}/gu, '')` (requires the `u` flag) which covers all mark categories, or remove the line entirely since `[^a-z0-9]+` already strips marks. Update the comment to match.

### WR-06: `doShare` / `shareAlbum` / `shareArtist` swallow ALL errors as "cancelled", hiding real clipboard/share failures

**File:** `src/lib/components/TrackMenu.svelte:143-147`, `src/routes/(app)/album/[name]/+page.svelte:487-489`, `src/routes/(app)/artist/[name]/+page.svelte:168-170`
**Issue:** The share handlers wrap `navigator.share`/`clipboard.writeText` in `try { ... } catch { /* cancelled */ }`. A genuine failure (clipboard permission denied, `navigator.share` rejecting for a non-cancel reason, an exception thrown building the URL) is indistinguishable from a user cancel, so the user gets no feedback and no toast — they tap Share and nothing happens. The non-`navigator.share` branch (`clipboard.writeText` + success toast) only shows the toast on success; a clipboard rejection there shows nothing.
**Fix:** Distinguish cancel from failure. `navigator.share` rejects with `AbortError` on user cancel; only swallow that. For the clipboard fallback, surface a failure toast:
```ts
catch (e) {
	if (e instanceof DOMException && e.name === 'AbortError') return; // user cancelled
	toast.show(t('toast.shareFailed'));
}
```

## Info

### IN-01: Dead code — `gotoAlbum` and unused `Disc` import in TrackMenu

**File:** `src/lib/components/TrackMenu.svelte:89-93, 269, 5`
**Issue:** `gotoAlbum()` is defined but its only call site (the "Go to album" menu item, line 269) is commented out. The `Disc` icon imported on line 5 is consequently unused. Dead code + unused import.
**Fix:** Remove `gotoAlbum`, the commented-out `<button>`, and `Disc` from the import — or restore the menu item if intended.

### IN-02: `app.html` baked SEO defaults must be kept in lockstep with `+layout.svelte` by hand

**File:** `src/app.html:20-24`
**Issue:** The comment states the baked `<title>`/`<meta description>` "MUST match +layout.svelte's TITLE/DESC verbatim," but there is no enforcement — the two will silently drift. This is a maintainability hazard, not a correctness bug today.
**Fix:** Extract the site-default title/description to a shared constant imported by both, or add a test asserting the two match.

### IN-03: Duplicated `fallbackCover`/`fallbackArtistCover`/`fallbackCoverSeed` hue-hash across four route files

**File:** `src/routes/(app)/album/[name]/+page.svelte:71-74`, `src/routes/(app)/artist/[name]/+page.svelte:97-112`, `src/routes/(app)/search/+page.svelte:190-223`, `src/routes/(app)/charts/top/+page.svelte:80-89`
**Issue:** The identical `(seed → hsl gradient)` hash function is copy-pasted (in three textual variants: by-Track, by-seed-string, by-name) across album, artist, search, and charts pages. Code duplication; a change to the gradient formula must be made in 6+ places.
**Fix:** Extract a single `gradientFromSeed(seed: string)` helper (plus thin `fromTrack`/`fromName` wrappers) into `$lib/util`.

### IN-04: `song/[slug]/+page.svelte` SSR-renders the `/?q=` fallback href, then swaps to `/?play=` on hydration

**File:** `src/routes/(app)/song/[slug]/+page.svelte:28-33`
**Issue:** `playToken = $derived(browser ? page.url.searchParams.get('play') : null)`. During SSR `browser` is false → `playToken` is null → the Play CTA href is the `/?q=<title>` fallback in the server HTML, then hydration replaces it with `/?play=<token>`. A non-JS visitor who clicks the SSR'd CTA gets a search instead of the shared queue. The `load` already decodes `?play=` server-side (`data.current`), so the token is available without the `browser` gate.
**Fix:** Read the token from the load data / `url` (available in SSR) instead of gating on `browser`:
```ts
const playToken = $derived(page.url.searchParams.get('play'));
```
`page.url` is populated during SSR, so the correct href renders server-side too.

---

_Reviewed: 2026-06-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
