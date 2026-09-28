---
slug: page-switch-lag-tap-dead
status: awaiting_human_verify
trigger: "page switch is kinda lag — navigating between tabs/pages in the app feels sluggish"
created: 2026-09-19
updated: 2026-09-19
---

# Debug: page switch lag / dead taps

## Symptoms

**Expected:** Tapping a bottom-nav tab, a list row, or the artist name in NowPlaying navigates immediately — the new route paints without a dead gap.

**Actual:**
- Tap feels dead: a delay between tap and anything happening, on bottom tab nav and on entering detail pages.
- **Hard repro:** tapping the artist name in the NowPlaying sheet closes the sheet but does NOT redirect to the artist page. Sometimes the artist page is not reached on first click at all — a second tap is needed.

**Error messages:** none reported.

**Timeline:** always been like this — not a regression.

**Reproduction:**
1. Play a song, open NowPlaying.
2. Tap the artist name.
3. Sheet closes; artist route does not load.

Also: bottom tab switches and list-row → detail-page navigations feel sluggish on first tap.

**Environment:** all of them — deployed openmusic.lol on phone, Android APK (Capacitor WebView), desktop dev server. Platform-independent, so this is app code, not a device/network quirk.

## Current Focus

hypothesis: NowPlaying `openArtistName` collapses the sheet BEFORE `goto()`; the unmount's `$effect` cleanup calls `overlays.dismiss('nowplaying')` → `history.back()` → SvelteKit's popstate handler sets `token = {}` which invalidates the in-flight goto's `nav_token` → goto returns silently. TrackMenu hit the identical bug and was fixed with `overlays.navigateAway()`; NowPlaying was never migrated.
test: code trace of NowPlaying.svelte:401-419, overlays.svelte.ts dismiss/navigateAway, TrackMenu.svelte:412-424, @sveltejs/kit client.js:413/445/2809-2818
expecting: the only outbound goto() from inside a registered overlay that does NOT use navigateAway is NowPlaying.openArtistName
next_action: CYCLE 2 — the steady-lag blind spot is now user-confirmed as a separate bug (see Symptoms addendum). Measure where the ~1s goes on a plain Home-tab tap with no overlay open: before the URL changes (tap → goto blocked) vs after (mount/paint cost). Check home-route mount cost (forced reflows from offsetWidth/getBoundingClientRect in actions/component init across many rows, e.g. use:marquee), (app)-layout work re-run per navigation (Nowbar/NowPlaying, cover resolution, lazyCover/IntersectionObserver churn, library/settings reads), synchronous localStorage reads, and large unwindowed list renders on the critical path.

### Cycle 2 — Current Focus

hypothesis: The ~1 s Home-tab dead gap is the home route's synchronous render, dominated by cover-cache reads: every `getCachedCover*`/`getPinnedCover` re-parses the whole localStorage blob, ~300 tiles × parse(≤310 KB) per mount and per coverVersion bump.
test: Playwright harness (scratchpad/measure-nav.cjs) — /search → Home tab, 2000-entry cache, count big JSON.parse calls + long tasks + tap→URL vs tap→first home frame, before/after a memo.
expecting: after memoising the parsed record, big-parse count to first frame drops from ~1252 to a handful and the 1.0 s long task collapses toward the ~180 ms tiny-cache render floor; tap→URL stays ~20 ms.
next_action: CHECKPOINT — user confirms on device/deployed build that a Home-tab tap from another page now reacts immediately (URL + paint) with a warm cover cache. If still ~1 s: the remaining cost is the ~300-tile render / per-bump whole-grid re-render (see Cycle 2 resolution → remaining), not the parse — profile on device before touching anything.

reasoning_checkpoint (cycle 2):
  hypothesis: "The home tab feels dead for ~1 s because the home route's mount renders ~300 tiles and each tile's cover read re-parses the entire cover-cache blob (no memo); at the module's own 2000-entry cap that is ~1250 × JSON.parse(310 KB) inside one long task before first paint."
  confirming_evidence:
    - "Harness: tap→pushState 17–71 ms in every run; tap→first home frame 1052–1082 ms with a 2000-entry cache vs ~180 ms with a 1.3 KB cache — the delay is entirely post-URL-change render."
    - "JSON.parse counter: 1252 parses of >1 KB strings before the first home frame; ~3300 within the next second as backfill bumps re-run every tile."
    - "CPU profile: JSON.parse = 2146 ms of 2388 ms JS self-time (90%); readRecord cover-cache.ts:141 is the #1 app frame even on the tiny-cache run."
    - "Code: readKey → readRecord → localStorage.getItem + JSON.parse on every call; tileCover() runs per tile and depends on coverVersion(); library rows read pin + uid + name (3 parses)."
  falsification_test: "If memoising the parsed record does not cut the pre-first-frame parse count to ≈2 and the long task to near the tiny-cache floor, the parse is not the dominant cost."
  fix_rationale: "Memoise the parsed record keyed on the raw string inside cover-cache.ts (the ONE place every reader funnels through — 19 sites in player, 11 in home, 6 lazyCover, etc. need no change). Removes the O(tiles × blob) work at the root rather than caching per call site."
  blind_spots: "The ~180 ms render floor (Svelte mounting ~300 unwindowed tiles + a 35 ms focus() reflow) remains and will be ~0.5 s on a slow phone; it is genuine per-mount work, not measured on-device here. Dev server (Vite unbundled) adds `(program)` overhead that prod does not have."

### Cycle 3 — Current Focus

hypothesis: The residual Home-tab lag is two linear-in-rows costs of the default config rendering 692 CompactRows (29 shelves × 24, 174 pager columns, 9392 DOM nodes) for a viewport that shows ~12 rows: (A) the synchronous mount of all 692 rows (≈0.66 ms/row at 4x CPU → a 455 ms long task), and (B) after paint, every coverVersion bump re-runs all 692 `tileCover()` reads and each memo HIT still does `localStorage.getItem` — a 310 KB string copy — so a single backfill resolve costs an 85 ms (1x) / 340 ms (4x) long task, repeated per bump.
test: measure-nav2.cjs on the PROD build (adapter-static + serve-build.cjs proxying /api to :4321), 1x + 4x CPU, split CPU profile at first frame, RO/MO/rAF/DOM counters; A/B via injected settings (hide tags+countries) and injected CSS (content-visibility).
expecting: (B) dropping getItem on a memo hit collapses post-paint long tasks from ~85/340 ms to Svelte re-evaluation only (~10/70 ms); (A) revealing shelves progressively (a few per frame) brings tap→first frame to the measured few-shelves floor (54–109 ms at 4x, no long task) without windowing or a dependency.
next_action: CHECKPOINT — user confirms on device (dev server via HMR or a deploy) that tapping the Home tab from another page paints at once and the page stays responsive while the lower shelves fill in over the next ~0.5–1 s. If still slow: the first frame is no longer row-bound — profile on device for the remaining marquee measure() layout thrash (see cycle-3 resolution → remaining) before touching anything.

reasoning_checkpoint (cycle 3):
  hypothesis: "Home-tab tap still feels slow because the home route mounts 692 rows synchronously (455 ms at 4x) and then, for every cover-version bump, re-reads a 310 KB localStorage string 692× (340 ms at 4x per bump, repeated 5–13× in the first 1.5 s)."
  confirming_evidence:
    - "Prod build (minified) 4x: tap→URL 13 ms, tap→first frame 484–539 ms = ONE long task 447–461 ms starting at pushState, then long tasks of 350–370 ms every ~450 ms for 1.5 s+."
    - "Counters at first frame: 692 .crow, 174 .column, 9392 nodes, 1374 ResizeObserver.observe, 1375 MutationObserver.observe, 1378 rAF (2 marquee spans per row)."
    - "Split CPU profile (unminified prod): POST-PAINT readRecord = 566–904 ms of 667–1071 ms JS at 1x, 2082 of 2678 ms at 4x — the memo avoids JSON.parse (parses stay 2) but every hit still copies the blob via getItem + memcmp."
    - "Hiding tags+countries (20 rows, 6 columns, 348 nodes) → tap→first frame 54–109 ms at 4x with NO long task: the mount cost is linear in rows, nothing fixed-cost."
    - "content-visibility:auto on .pager → 332–364 ms (only −30%) and a larger 159–198 ms second task — layout is a minority of the mount; component creation dominates."
  falsification_test: "If after (B) the post-paint long tasks stay ≥300 ms at 4x, the cost is Svelte re-evaluation not getItem. If after (A) tap→first frame at 4x stays ≥300 ms, the first frame is not row-bound."
  fix_rationale: "(B) makes the memo authoritative and invalidates it on the platform's own cross-tab signal (`storage` event) — the one case the raw-string compare existed for — so a hit is a Map lookup. (A) keeps the whole DOM model and all existing shelf code, only gating how many shelves are mounted per frame; no windowing infrastructure, no dependency."
  blind_spots: "Device numbers are inferred from 4x CPU throttle in headless Chromium; iOS Safari not measured. Cold-load (no top-picks cache) path is network-bound and unchanged. Per-bump Svelte re-evaluation of 692 rows remains after (B) — measured, not guessed, in the after-run."

### Device verification (after cycles 1+2, 2026-09-19)

DATA_START
User: "NowPlaying tap artist name loads on first tap. but tap home page is still slow"
Build tested: local dev server (has c077dbe + a314da2 via HMR).
Delta vs before: "somewhat better, still slow" — noticeably faster but still a visible lag.
DATA_END

Bug 1 (artist tap) CONFIRMED FIXED. Bug 2 (Home tab) improved but NOT fixed — the residual measured at ~183 ms in the lab is what the user still feels. Cycle 3 target: the home-route render cost (~300 unwindowed tiles). Confounds to control first: user tested on Vite DEV (unbundled, per-module overhead) — measure a production preview build alongside dev; re-confirm the delay is still AFTER the URL change.

### Symptoms addendum (cycle 2, 2026-09-19)

DATA_START
User: "like in other page, when i click home page, it take like a second to react and redirect"
DATA_END

Interpretation: tapping the Home bottom-nav tab from another page takes ~1s before anything happens and the route changes. Plain tab tap, NO overlay open — not the navigateAway race fixed in c077dbe. All platforms, always been this way.

reasoning_checkpoint:
  hypothesis: "NowPlaying.openArtistName collapses the sheet before goto(); the unmount cleanup's overlays.dismiss → history.back() makes SvelteKit's popstate handler reset `token`, so the in-flight goto bails at client.js:445 and the URL never changes."
  confirming_evidence:
    - "NowPlaying.svelte:401-405 was literally `player.collapse(); goto(...)`; TrackMenu.svelte:412-424 documents the identical failure and its navigateAway fix."
    - "kit client.js:2814 `token = {}` runs BEFORE the :2818 same-index early return; navigate() at :445 returns when `nav_token !== token`."
    - "Audit of every overlays.open() host: NowPlaying was the only outbound goto() still on the broken ordering (library fav-tile + search suggestion gotos run outside any registered overlay)."
  falsification_test: "If the artist page still fails to load on first tap with navigateAway in place, the cancel is coming from somewhere other than the dismiss back() (e.g. a second popstate source)."
  fix_rationale: "navigateAway runs goto() while the raw Back entry is still live, then sweeps close() handlers (→ player.collapse()) with `navigating` set so the cleanup dismiss skips history.back(). Removes the race rather than papering over it with a delay."
  blind_spots: "The steady 'every tab feels laggy' complaint was NOT reproduced or measured here — no shared blocking code path was found (loads sync, no nav hooks, actions inert, chunks SW-precached, touchstart already preloads). Intermittent dead taps right after dismissing ANY overlay ARE explained by the same back()→token race, but that has not been device-confirmed."

## Evidence

- checked: src/lib/components/NowPlaying.svelte:401-405
  found: `openArtistName` = `player.collapse(); goto('/artist/...')` — collapse first, plain goto second, no navigateAway.
  implication: the sheet unmount ($effect cleanup at :419) runs `overlays.dismiss('nowplaying')` during the same microtask flush, while goto's navigate() is still awaiting load.
- checked: src/lib/stores/overlays.svelte.ts dismiss()
  found: dismiss() calls `history.back()` unless `navigating` is set; `navigateAway()` exists precisely to run goto FIRST with back() suppressed, then close every overlay.
  implication: the fix path already exists in the store; NowPlaying just bypasses it.
- checked: src/lib/components/TrackMenu.svelte:412-424
  found: comment records the same bug ("closing the overlay first makes goto() a silent NO-OP; dismiss's history.back() races goto") and gotoArtist() uses `overlays.navigateAway(() => goto(dest))`.
  implication: precedent fix; NowPlaying's artist link is the one sibling caller left on the broken ordering.
- checked: node_modules/@sveltejs/kit/src/runtime/client/client.js:413,445,2809-2818
  found: navigate() captures `nav_token = (token = {})` and bails at :445 if `nav_token !== token`; the popstate handler (:2814) sets `token = {}` BEFORE the `history_index === current_history_index` early return (:2818). The overlay's raw pushState entry sits above the origin entry which DOES carry HISTORY_INDEX, so back() lands on it and hits :2814.
  implication: direct mechanism for "closes but never navigates" — the dismiss back() cancels the goto even though SvelteKit itself then decides no navigation is needed. Also explains intermittent dead taps right after dismissing ANY overlay (menu/sheet): a tab or row tap within the back()→popstate window is cancelled the same way.
- checked: route +page.ts loads (all 6), (app)/+layout.svelte effects/onMount, actions tapBounce/longpress
  found: loads are synchronous string builders; no beforeNavigate/afterNavigate/onNavigate hooks anywhere; tapBounce never preventDefaults; longpress only arms a click-eater after a 450ms hold.
  implication: no shared code path delays a plain tap; nothing blocks paint on network.
- checked: src/service-worker.ts + .svelte-kit/output/client/_app/immutable/nodes
  found: SW precaches every `build` chunk; route chunks are 0.4–46 KB.
  implication: route-chunk fetch at click time is a cache hit on the PWA/APK; not a plausible shared lag cause.

### Cycle 2 evidence (plain Home-tab tap, no overlay)

- checked: src/routes/(app)/+layout.svelte tabbar (:374-406)
  found: tabs are plain `<a href>` + use:tapBounce; no onclick, no await, no scroll-to-top. `app.html` has `data-sveltekit-preload-data="hover"`.
  implication: nothing app-side runs between tap and SvelteKit's link handler; any pre-URL delay would have to be SvelteKit itself.
- checked: Playwright (headless Chromium 1228, 390x844 mobile emulation) against the Vite dev server :4321, /search → Home tab, 5 runs, fresh profile (cover-cache 1.3 KB, top-picks 75 KB)
  found: pointerdown→click 1 ms; pointerdown→pushState 17–71 ms; ONE long task of 177–199 ms starting exactly at pushState (= the home route render). CPU profile top JS self-time: `readRecord cover-cache.ts:141` 44–51 ms (already #1 with a 1.3 KB cache), then Svelte runtime internals, `scrollWidth` (marquee) 3–4 ms, `focus` 33 ms.
  implication: the delay is AFTER the URL changes — it is mount/paint cost of the home route, not a blocked goto. `readRecord` is `localStorage.getItem` + `JSON.parse` of the WHOLE cover-cache blob, called once per cache read with no memo.
- checked: src/lib/services/cover-cache.ts readRecord/readKey/readPins; src/lib/stores/cover-version.svelte.ts readers; call-site count
  found: every `getCachedCover*` / `getPinnedCover` → `readKey` → `readRecord()` → full `JSON.parse`. Home `tileCover()` runs once per discovery tile (~270 track + ~18 artist tiles default config) and takes a `coverVersion()` dependency, so every backfill bump re-runs all of them. Library rows do PIN + uid + name = up to 3 parses each. 19 read sites in player.svelte.ts, 11 in home, 6 in library, 6 in lazyCover, 3 each in SongRow/CompactRow.
  implication: cost scales as (tiles × cache-blob size); MAX_ENTRIES=2000 ≈ 250 KB, so a real user's warm cache means ~300 × parse(250 KB) on every home mount — the ~1 s.
- checked: harness BASELINE with a seeded 2000-entry cover cache (310 KB — the module's own MAX_ENTRIES), 3 runs each at 1x and 4x CPU throttle
  found: tap→pushState 18–45 ms; tap→first home frame 1052–1082 ms (median 1073) as ONE long task of 1022–1055 ms starting at pushState; a JSON.parse counter (>1 KB strings) reads 1252 parses before the first frame and ~3300 within the next second (backfill bumps re-running every tile). CPU profile: JSON.parse 2146 ms of 2388 ms JS self-time (90%). At 4x CPU: tap→first frame 4031–5141 ms (median 4619), single long task 3.9–5.1 s.
  implication: reproduces the user's "~1 s before anything happens" exactly, and the ~4–5 s at phone-like CPU explains why it feels worse on device. The gap is entirely post-URL-change render; the dominant cost is re-parsing the cover cache once per tile.
- checked: harness AFTER memoising the parsed record in cover-cache.ts (same seeded cache, same runs)
  found: tap→pushState 17–44 ms (unchanged); tap→first home frame 173–224 ms (median 183) — the long task is now 151–176 ms, i.e. AT the tiny-cache floor measured before (177–199 ms); parses before first frame = 2 (cache + pins), still 2 after one second. At 4x CPU: 651–834 ms (median 695). Remaining profile #1 is readRecord at 150–320 ms over the 2.5 s window = localStorage.getItem copying the 310 KB string ~3000× during post-paint backfill bumps + the `===` memcmp; not on the pre-paint path.
  implication: 1073 → 183 ms (5.9x) / 4619 → 695 ms at 4x. Hypothesis confirmed; the remainder is Svelte mounting ~300 tiles plus the post-paint whole-grid re-render per coverVersion bump (the per-key signal deferred in cover-version.svelte.ts).

### Cycle 3 evidence (prod build, residual Home-tab lag)

- checked: dev (:4321) vs a prod adapter-static build (build/, served by scratchpad/serve-build.cjs with /api proxied to :4321), same seeded 310 KB cover cache, 3 runs each
  found: BEFORE — dev 1x tap→URL 15 ms / tap→first frame 160–206 ms (median 171), 4x 727–789 ms (median 739); prod 1x 6 ms / 112–148 ms (median 116), 4x 484–539 ms (median 492). Both builds: ONE mount long task at pushState (dev 140–158 / prod 100–107 ms at 1x; 671–696 / 447–461 ms at 4x) then repeated ~85 ms (1x) / 340–400 ms (4x) long tasks every ~100/450 ms for 1.5 s+.
  implication: dev overhead is ~30%, not the bug. The delay is still entirely AFTER the URL change, and at phone-like CPU the prod build has a ~0.5 s dead gap followed by ~350 ms freezes — the user's "somewhat better, still slow".
- checked: DOM/observer counters at first frame (measure-nav2.cjs), default home config
  found: 692 `.crow` rows, 174 pager columns, 9392 DOM nodes, 1374 ResizeObserver.observe + 1375 MutationObserver.observe + 1378 requestAnimationFrame (use:marquee ×2 per row) for a 390×844 viewport that shows ~12 rows. Default config = 9 sections, DEFAULT_HOME_TAGS = all 22 tags + 7 countries → 29 shelves × SHELF_DEFAULT 24 = 696 items, every CompactPager column rendered.
  implication: the mount is a fixed 692-row render regardless of what is visible.
- checked: CPU profile (unminified prod, 100 µs sampling) split at first frame
  found: MOUNT phase JS self-time 61–79 ms (1x) / 278 ms (4x), 80% in the Svelte runtime chunk (set_attributes, update_reaction, cloneNode, create_effect) — component creation, not app code; the rest of the 455 ms task is style/layout + observer callbacks. POST-PAINT: `readRecord` = 566–904 of 667–1071 ms (1x) and 2082 of 2678 ms (4x) JS; parses stayed at 2 — so the memo killed the parse but every hit still ran `localStorage.getItem` (a 310 KB string copy) and `===` (memcmp), ~700× per coverVersion bump, 7–18 bumps/1.5 s from backfill writes. `focus` 31–35 ms (150 ms at 4x) = SvelteKit reset_focus forcing the first layout of the 9392-node DOM.
  implication: two independent linear-in-rows costs — (A) the synchronous mount of every row, (B) the per-bump whole-grid re-read.
- checked: A/B by injected settings — homeHidden = [tags, countries] (3 shelves: 20 rows, 6 columns, 348 nodes)
  found: tap→first frame 54–109 ms at 4x, NO long task (vs 487–530 ms).
  implication: mount cost is linear in rendered rows (~0.66 ms/row at 4x); nothing fixed-cost hides behind it.
- checked: A/B by injected CSS `.pager{content-visibility:auto;contain-intrinsic-size:auto 200px}`
  found: 332–364 ms at 4x (−30%) and a LARGER second task (159–198 ms).
  implication: layout is a minority of the mount; skipping off-screen layout does not fix it.
- checked: fix B — memo authoritative (Storage-identity + `storage` event invalidation), fix A — progressive shelf reveal (3 shelves with the page, then 1 per frame; `popstate` mounts all); minified prod rebuilt, same seeded cache, 3 runs each
  found: prod 1x tap→URL 6–36 ms, tap→first frame 19–47 ms (median 22) with ZERO long tasks in 1.5 s (was 116 median + 6–8 × 85 ms tasks); prod 4x 46–94 ms (median 48) (was 492), remaining tasks 50–72 ms starting only at +430–680 ms where backfill writes land (was 455 ms + 340–400 ms × 5). Dev 1x 33–73 ms (was 171), dev 4x 106–158 ms (was 739). All 692 rows / 174 columns are in the DOM by +1.5 s (1x) / +2.5 s (4x). Back-nav check (back-nav.cjs): popstate first frame = 692 rows, scrollY 2500 → 2500 restored.
  implication: hypothesis confirmed — B removed ~85% of post-paint JS (readRecord gone from the profile), A moved the first frame to the few-shelves floor. Residual post-paint JS at 4x ≈ 760 ms/2.5 s: marquee `measure()` layout thrash (~160 ms, 2 observers per row) + 13–23 backfill `JSON.stringify`/setItem of the 310 KB blob (~100 ms) + Svelte re-evaluation per bump.

## Eliminated

- hypothesis: the residual lag is Vite dev-server overhead (unbundled modules) rather than app work
  evidence: prod build is only ~30% faster (116 vs 171 ms at 1x; 492 vs 739 ms at 4x) and shows the same mount long task + post-paint task train
  timestamp: 2026-09-19 (cycle 3)
- hypothesis: skipping off-screen layout (`content-visibility: auto` on the pagers) is enough
  evidence: −30% at 4x (364 vs 530 ms) and a bigger follow-up task; the profile puts 80% of mount JS in Svelte component creation, which content-visibility cannot skip
  timestamp: 2026-09-19 (cycle 3)
- hypothesis: the post-paint stutter is Svelte re-evaluating 692 rows per coverVersion bump
  evidence: profile attributes 78–85% of post-paint JS to `readRecord` (getItem copy of the 310 KB blob); after making the memo authoritative the bump cost fell to Svelte-only and no longer registers as a long task at 1x
  timestamp: 2026-09-19 (cycle 3)
- hypothesis: an action (tapBounce / longpress / drag) swallows or delays the artist-link click
  evidence: tapBounce is pointerdown-only visual; longpress's click-eater arms only after a 450ms hold; NP drag uses slop threshold with no preventDefault below 8px
  timestamp: 2026-09-19
- hypothesis: a `+page.ts` load blocks paint on network
  evidence: all six loads are synchronous OG string builders, no fetch
  timestamp: 2026-09-19

## Resolution

root_cause: NowPlaying.openArtistName ran `player.collapse()` before `goto()`. Collapsing unmounts the sheet, whose `$effect` cleanup calls `overlays.dismiss('nowplaying')` → `history.back()`. SvelteKit's popstate handler resets its navigation `token` before checking whether the history index changed, so the in-flight goto's `nav_token` no longer matches and navigate() returns without ever changing the URL. The sheet closes; the artist route never loads. TrackMenu had the same bug and was already migrated to `overlays.navigateAway()`; NowPlaying was the last caller on the broken ordering.
fix: `openArtistName` now calls `overlays.navigateAway(() => goto('/artist/...'))` — goto runs while the overlay's raw Back entry is still live, then the store sweeps close() handlers (→ player.collapse()) with history.back() suppressed. Stale comment on the single-dismiss path updated. Added src/lib/stores/overlays.svelte.test.ts pinning the invariant (dismiss pops; navigateAway keeps the stack open during goto, sweeps afterwards, never back()s).
verification: pnpm check 0 errors; pnpm test 140 files / 2872 tests pass incl. the 3 new overlays checks. Device/browser confirmation pending (checkpoint).
files_changed: [src/lib/components/NowPlaying.svelte, src/lib/stores/overlays.svelte.test.ts]

### Cycle 2 resolution (plain Home-tab tap ~1 s dead gap)

root_cause: The gap is after the URL changes — it is the home route's synchronous render. Every cover-cache read (`getCachedCover` / `getCachedCoverByUid` / `getCachedArtistCover` / `getPinnedCover`) went `readKey → readRecord → localStorage.getItem + JSON.parse` of the WHOLE blob with no memo. The home page calls `tileCover()` once per discovery tile (~300 in the default config) and every `coverVersion()` bump re-runs all of them; library rows read pin + uid + name. At the module's own 2000-entry cap the blob is ~310 KB, so one Home-tab tap performed 1252 full parses (~1.0 s) inside a single long task before the first frame — 4–5 s at phone-like CPU. Not the c077dbe overlay race; it has always been this way because the cost grows with the cache the app itself fills.
fix: `memoRecord(key)` in src/lib/services/cover-cache.ts — one parsed-record memo keyed on the RAW stored string, used by both the cover cache and the pin store. A hit is getItem + a string `===` (memcmp), no parse; writers hand the memo the string they just stored so the read after every backfill write is a hit; a throwing setItem drops the memo first so an in-place-mutated record is never served as if on disk. Keying on the raw string (not "did we write") keeps it correct under other-tab writes and the test stubs. Every reader funnels through this module, so the 50+ call sites (player 19, home 11, library 6, lazyCover 6, rows 3+3) needed no change. Three regression tests added to cover-cache.test.ts (zero parses over 300 reads; rewritten-underneath re-parses; failed setItem leaves disk authoritative).
verification: pnpm check 0 errors; pnpm test full suite green (see run below); harness before/after: tap→first home frame 1073 → 183 ms (1x), 4619 → 695 ms (4x CPU); big parses to first frame 1252 → 2; tap→URL ~18 ms unchanged. Device/browser confirmation pending (checkpoint).
files_changed_cycle2: [src/lib/services/cover-cache.ts, src/lib/services/cover-cache.test.ts]
remaining: the ~150–180 ms render floor (Svelte mounting ~300 unwindowed tiles, a 30 ms focus() reflow) and the post-paint whole-grid re-render per coverVersion bump (~85–110 ms at 1x, ~350 ms at 4x) are genuine per-mount work, not this bug; a per-key cover signal or tile windowing would be the next step if the user still feels it on device. → addressed in cycle 3 below.

### Cycle 3 resolution (residual Home-tab lag after the memo)

root_cause: Two linear-in-rows costs of the default home config, which renders 692 CompactRows (29 shelves × 24, 174 pager columns, 9392 DOM nodes, 2 marquee observers per row) for a viewport showing ~12 rows. (A) All 692 rows mounted in ONE synchronous render: a 455 ms long task on a 4x-throttled prod build (100 ms at 1x), 80% of its JS in Svelte component creation — the "tap Home, nothing happens" gap. (B) After paint, every coverVersion bump re-ran all 692 `tileCover()` reads, and each memo HIT still executed `localStorage.getItem` — a 310 KB string copy — so one backfilled cover cost an 85 ms (1x) / 340–400 ms (4x) long task, repeated 7–18× in the first 1.5 s: the page painted but stayed frozen/janky. Not dev-server overhead (prod is only ~30% faster).
fix: (B) `memoRecord` in src/lib/services/cover-cache.ts is now authoritative for the document: a hit is an identity compare on the Storage object it was read from (no getItem), invalidated by write()/clear() and by the platform `storage` event (fires only in OTHER tabs — the one external writer); `clearCoverCache` routes through `cache.clear()`. (A) src/routes/(app)/+page.svelte reveals shelves against a flat budget consumed in the user's section order: REVEAL_INITIAL=3 with the page, then REVEAL_PER_FRAME=1 per requestAnimationFrame until every shelf is in, then Infinity so Randomize/revalidate render in full; `navigating.type === 'popstate'` starts at Infinity so SvelteKit's synchronous scroll restore is never clamped. No windowing, no dependency — every shelf still ends up in the DOM.
verification: pnpm check 0 errors; pnpm test 140 files / 2877 tests pass (memo suite rewritten: hit never calls getItem; clearCoverCache drops the memo; `storage` event invalidates via a fresh module with a fake window). Harness (minified prod, seeded 310 KB cache, 3 runs): tap→first frame 1x 116 → 22 ms median with zero long tasks in 1.5 s; 4x 492 → 48 ms, post-paint tasks 340–400 → 50–72 ms. Dev: 171 → 34 ms (1x), 739 → 158 ms (4x). Back-nav: 692 rows in frame 1, scrollY restored. Device confirmation pending (checkpoint).
files_changed_cycle3: [src/lib/services/cover-cache.ts, src/lib/services/cover-cache.test.ts, src/routes/(app)/+page.svelte]
remaining_cycle3: residual post-paint JS at 4x ≈ 760 ms over 2.5 s, none of it on the tap→paint path — marquee `measure()` layout thrash (~160 ms: 1374 observers each read scrollWidth after the previous one wrote a class; batch reads-then-writes in one rAF if it ever matters), 13–23 backfill `JSON.stringify`+setItem of the 310 KB blob (~100 ms; absent on a warm cache), and Svelte re-evaluating 692 rows per bump (a per-key cover signal would remove it). Default config still renders 692 rows the user mostly never scrolls to — a product-level cap (fewer default tags / lazy pager columns) is the real ceiling.
