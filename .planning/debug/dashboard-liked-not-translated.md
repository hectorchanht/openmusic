---
slug: dashboard-liked-not-translated
status: resolved
trigger: "Song title and artist name in the dashboard liked songs section are still not translated to target language."
created: 2026-06-16T02:06
updated: 2026-06-16T02:16
---

# Debug Session: dashboard-liked-not-translated

## Symptoms
- Expected: Home/dashboard "Liked songs" shelf renders title + artist translated to the per-part target (e.g. zh-Hant), same as freshly-searched songs now do.
- Actual: Those liked songs are STILL untranslated (Simplified/original) AFTER the /api/translate fix (committed c7bd905).
- Context: follows resolved sessions translation-not-applied + library-tracks-not-translated. /api/translate echo-mode + batch bugs are fixed and committed.

## Current Focus
- hypothesis: POISONED CLIENT CACHE (not a render-coverage gap, not the API anymore). During the echo-mode period the API returned ORIGINALS, and BOTH client cache layers stored those originals as if they were final translations:
  (1) names store — names.svelte.ts `items.forEach((orig,i) => m.set(orig, out[i] ?? orig))` then persist() to localStorage `openmusic:name-tr:<lang>`. Echo → out[i]===orig → caches orig→orig.
  (2) translate.ts — `mem.set(key, out)` + localStorage `openmusic:lyrics-tr:<to>:<hash>`. Echo → out===lines → caches originals.
  On next render the resolver hits the cache and returns the cached ORIGINAL, never re-requesting. Liked/downloaded songs were viewed repeatedly during the bug → their names are cached as originals → permanently stuck until cache cleared. Freshly-searched songs use names not yet in cache → re-request hits the fixed API → translate. Explains "STILL not translated" + why it's the liked/library surfaces specifically.
- test: inspect localStorage `openmusic:name-tr:<target>` for identity entries (key===value); clear caches and confirm rows translate on next render.
- expecting: cache holds identity (orig→orig) entries for the stuck names; post-clear they translate.
- next_action: confirm + fix so (a) existing poisoned entries are abandoned (bump a cache-namespace version) AND (b) the caches no longer persist a no-op fallback as a final result.

## Evidence
- timestamp: 2026-06-16T02:06 — COVERAGE confirmed OK on dashboard: home liked shelf renders via libraryShelf snippet — compact path CompactRow title={names.dnTitle}/subtitle={names.dnArtist} (+page.svelte:850-851); comfortable path librarySongRow al-name {names.dnTitle(track.title)} / al-count {names.dnArtist(track.artist)} (+page.svelte:839-840). Both wrap. NOT a missing-wrapper gap.
- timestamp: 2026-06-16T02:06 — POISON WRITE 1 (names): names.svelte.ts:58-63 caches out[i]??orig per item and persists to localStorage openmusic:name-tr:<lang>. resolve() (78-94) returns cached hit without re-requesting.
- timestamp: 2026-06-16T02:06 — POISON WRITE 2 (translate helper): translate.ts:37-48 caches `out` (===lines on echo/fallback) in mem + localStorage openmusic:lyrics-tr:<to>:<hash>.
- timestamp: 2026-06-16T02:06 — API is fixed/committed (c7bd905): echo-mode detection + 20-line chunking + bounded per-line concurrency. So new requests translate; the problem is the stale cached originals from before the fix.
- timestamp: 2026-06-16T02:11 — CODE-CONFIRMED the poison mechanism end-to-end: names.svelte.ts:61 `m.set(orig, out[i] ?? orig)` writes orig→orig on echo; :84 `if (hit !== undefined) return hit` serves it forever (no re-request). translate.ts:41-47 persists echo originals identically. Both are HIT-without-revalidate caches → permanent stick.
- timestamp: 2026-06-16T02:11 — LIVE API confirms fix is active on dev (5173/5175): POST {lines:["杜国华","周杰伦","邓紫棋"],to:"zh-Hant"} → ["杜國華","周杰倫","鄧紫棋"]. Port 4321 is a DIFFERENT (Astro) project — 404 on /api/translate — not relevant.
- timestamp: 2026-06-16T02:11 — DISTINGUISHER for re-poison: a fallback line is returned as the ORIGINAL, indistinguishable from a line that legitimately translates to itself (e.g. a name already Traditional). Caching either is what stuck the names. The clean fix is a server-side per-line "did I actually translate this" signal.

## Eliminated
- hypothesis: dashboard liked shelf doesn't wrap text in dn* resolvers. — ELIMINATED: both density paths wrap (Evidence).
- hypothesis: API still broken / dev server stale. — ELIMINATED: live POST against 5173/5175 translates correctly; the API code is committed (c7bd905).

## Alternative hypotheses (if cache-poison disproven)
- Dev server not running committed API code (HMR didn't reload the server endpoint) — ELIMINATED (live probe translates).
- shouldTranslate now returns false for these specific names — low priority; same names translate elsewhere.

## Resolution
- root_cause: CONFIRMED — POISONED CLIENT TRANSLATION CACHE. During the earlier /api/translate echo-mode window the endpoint returned the ORIGINAL (untranslated) text as a "successful" batch. Both client cache layers persisted those originals as FINAL translations: names.svelte.ts wrote identity entries (orig→orig) to localStorage `openmusic:name-tr:<lang>` and the resolver returns a cache HIT without ever revalidating; translate.ts persisted echo output to `openmusic:lyrics-tr:<to>:<hash>` identically. Liked/library songs were viewed repeatedly during the buggy window → their names were cached as identity entries → permanently stuck on Simplified even after the API was fixed. Freshly-searched names were never cached during the bug, so they re-request the (now fixed) API and translate — which is exactly why the symptom is specific to the liked/library surfaces and presents as "STILL not translated".
- fix: Two parts, both implemented + verified.
  (a) ABANDON POISONED ENTRIES via cache-namespace version: names.svelte.ts now persists under `openmusic:name-tr:v2:<lang>` (STORE_VER) and purges every pre-version `openmusic:name-tr:*` key once on first hydration; translate.ts persists under `openmusic:lyrics-tr:v2:<to>:<hash>` (CACHE_VER) and purges pre-version `openmusic:lyrics-tr:*` keys once. So all echo-era poisoned entries are ignored AND removed (no quota buildup) with NO user action.
  (b) STOP RE-POISONING via a server-side genuine-translation signal: /api/translate now emits a per-line `flags: boolean[]` (true = genuinely translated, false = fell back to original on echo/failure/genuinely-identical). The `translated`/length contract is unchanged (flags is additive). New client helper translateLinesEx returns {out, flags, complete}; translate.ts persists a lyrics batch ONLY when every non-blank line was genuinely translated; names.svelte.ts caches ONLY genuinely-translated names. A fallback line stays uncached (eligible for retry) instead of poisoning the cache. To prevent a re-request STORM for names that are genuinely unchanged in the target script, each (lang,name) is retried at most MAX_ATTEMPTS=2 per session, then renders the original. The legacy translateLines(string[]) wrapper is preserved so NowPlaying's lyrics caller is unchanged.
- verification: `npx svelte-check` 0 errors / 0 warnings (4287 files). New unit suite src/lib/services/translate.test.ts (8 tests, all pass): persists only complete batches, refuses to persist on a fallback line, blank-lines don't block persistence, infers flags when server omits them, versioned cache hit serves without re-request, purges pre-version poisoned keys, wrapper preserves string[] contract, off/empty pass-through. Live dev (5173): (1) Simplified names → ["杜國華","周杰倫","鄧紫棋"], flags [true,true,true]; (2) already-Traditional ["林憶蓮","陳奕迅"] → unchanged, flags [false,false] (won't be cached, bounded retry, no storm); (3) single line 简体中文测试→簡體中文測試 flag [true]; (4) blank-boundary lyrics ['','歌词第一行','第二行','',''] → aligned len 5, flags [false,true,false,false,false]; (5) empty → [],[]; (6) 60-name batch (over old echo threshold) → 60 aligned lines, 45 genuinely-translated flags, single batched response (no request storm). Home route GET / → 200. Pre-existing failures in home-layout.test.ts + catalog.test.ts (shelf sizing / adapter stagger timers) verified present on the clean baseline — unrelated to this change.
- files_changed:
  - src/routes/api/translate/+server.ts (per-line genuine-translation `flags` signal; LineResult threaded through translateChunk/perLine; reply() emits {translated, flags})
  - src/lib/services/translate.ts (translateLinesEx returning {out,flags,complete}; CACHE_VER=v2 key + pre-version purge; persist only complete batches; translateLines back-compat wrapper)
  - src/lib/stores/names.svelte.ts (STORE_VER=v2 key + pre-version purge; cache only genuinely-translated names via flags; MAX_ATTEMPTS=2 bounded retry to avoid a re-request storm for unchanged names)
  - src/lib/services/translate.test.ts (NEW — 8 tests pinning the poison-resistant cache contract)
