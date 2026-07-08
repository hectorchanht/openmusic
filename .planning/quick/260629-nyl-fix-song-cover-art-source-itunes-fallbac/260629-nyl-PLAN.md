---
phase: quick-260629-nyl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
  - src/lib/stores/player.svelte.ts
  - src/lib/stores/player.svelte.test.ts
  - src/lib/sources/netease.ts
  - src/lib/sources/netease.test.ts
  - src/lib/sources/qq.ts
  - src/lib/sources/qq.test.ts
  - src/lib/sources/kuwo.ts
  - src/lib/services/catalog.ts
  - src/lib/services/catalog.test.ts
autonomous: false
requirements: [COVER-UPNEXT, PLAY-RETRY, PLAY-EXTEND, LYRICS-REGRESSION]

must_haves:
  truths:
    - "Up-Next list rows show real album art (resolved on scroll-into-view), not a blank/gradient-only row"
    - "The now-playing carousel prev/next neighbor covers show resolved art when the raw track.cover is null"
    - "A transient (timeout-class) prefetch/probe failure on a Next-up song is re-resolved a few seconds later instead of being silently skipped forever"
    - "When the forward prefetch walk exhausts every candidate ahead without landing a playable one, the queue is eagerly extended with generated related songs so playback never stops"
    - "Songs that have lyrics upstream show them again — the false 'No lyrics for this track' regression is fixed at the extractor for whatever shape netease/qq now return"
    - "A single-source lyric miss no longer surfaces 'No lyrics' when another source has the lyrics for the same song (bounded cross-source lyric fallback)"
    - "Existing player + cover + source-adapter vitest suites stay green"
  artifacts:
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "Up-Next rows + carousel neighbors resolve covers via the shared lazyCover/resolvedCovers chain"
    - path: "src/lib/stores/player.svelte.ts"
      provides: "prefetchNext timeout-retry re-arm + eager ensureAhead on walk exhaustion"
    - path: "src/lib/sources/netease.ts"
      provides: "shape-tolerant exported extractLrcFromJson covering the current upstream lyric response"
    - path: "src/lib/services/catalog.ts"
      provides: "bounded cross-source lyric fallback inside ensureTrackDetails"
  key_links:
    - from: "src/lib/components/NowPlaying.svelte (Up-Next rows)"
      to: "src/lib/actions/lazyCover.ts → resolveCoverForTrack"
      via: "use:lazyCover onResolved → resolvedCovers map"
      pattern: "use:lazyCover"
    - from: "src/lib/stores/player.svelte.ts prefetchNext()"
      to: "scheduleRetryResolve() + ensureAhead()"
      via: "timeout-class skip arms a delayed retry; walk exhaustion eagerly grows the queue"
      pattern: "scheduleRetryResolve|ensureAhead"
    - from: "src/lib/services/catalog.ts ensureTrackDetails()"
      to: "searchAll + matchKey/scoreMatch + SOURCES[*].resolve"
      via: "lyric-miss track re-resolves a matched cross-source candidate for its lrc"
      pattern: "matchKey|scoreMatch|searchAll"
---

<objective>
Close three reported MusicSquare Mobile player defects, reusing existing services/stores
(NO parallel systems, NO new deps, NO new env vars, NO new /api routes):

1. Covers fail to show on the **Up-Next list** and the **now-playing carousel prev/next neighbors**.
   Every OTHER surface (now-playing main cover, search, library, artist, album, charts) already
   resolves covers via the shared chain — these two surfaces are the gap. Wire the EXISTING
   `use:lazyCover` action / `resolveCoverForTrack` chain (Deezer → iTunes → CN) into them.

2. Playback STOPS when 2-3 consecutive Up-Next entries are unplayable, even though they are
   "often playable later on click" (i.e. transient). Extend the EXISTING resilience machinery in
   `player.svelte.ts` so (a) a transient timeout-class prefetch failure re-resolves after a delay
   instead of being skipped-and-forgotten, and (b) when the forward walk exhausts playable
   candidates it eagerly extends the queue with generated related songs so `next()` always has
   somewhere to go. FAILURE_CAP / generation guards / skip-burst / loop-guard / no-premature-skip
   invariants are all preserved.

3. LYRICS REGRESSION: most songs now show "No lyrics for this track" even though they HAD lyrics
   before — almost certainly an upstream lyric ENDPOINT/SHAPE change in the dominant source(s)
   (netease and/or qq) so the existing extractor returns null on a true hit. Diagnose against the
   live `/api` proxy, fix the extractor to be tolerant of BOTH old and new shapes (never-throw,
   null only on a real miss), and add a bounded cross-source lyric fallback so one source's miss
   doesn't surface "No lyrics" when another source has them.

Purpose: Broken cover art, surprise playback halts, and a broad "No lyrics" regression are the three
highest-friction defects currently on the live app.
Output: Updated NowPlaying.svelte (cover wiring), player.svelte.ts (retry + extend), netease/qq/kuwo
adapters + catalog (lyric extractor + cross-source lyric fallback), and extended vitest coverage.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

# NOTE: CLAUDE.md is STALE (describes the old vanilla index.html). The LIVE app is SvelteKit under
# src/. Do ALL work in src/. NEVER touch index.html.

# --- Cover chain (REUSE, do not reinvent) ---
@src/lib/actions/lazyCover.ts
@src/lib/services/cover-backfill.ts
@src/lib/services/cover-cache.ts

# --- Player store (REUSE, do not reinvent) ---
@src/lib/stores/player.svelte.ts
@src/lib/components/NowPlaying.svelte

# --- Lyrics path (REUSE, do not reinvent) ---
@src/lib/sources/netease.ts
@src/lib/sources/qq.ts
@src/lib/sources/kuwo.ts
@src/lib/services/catalog.ts
@src/lib/services/match-key.ts
@src/lib/services/score-match.ts

<interfaces>
<!-- Key contracts the executor needs — extracted from the codebase. Use these directly. -->

From src/lib/actions/lazyCover.ts:
```typescript
export interface LazyCoverParam {
  track: Track;
  onResolved: (uid: string, url: string) => void; // fires with a SOLID https url (cache hit / good existing / resolved)
}
export const lazyCover: Action<HTMLElement, LazyCoverParam>;
// Resolves on FIRST scroll-into-view, cache-first (uid→name), probes an existing https cover,
// repairs broken via the shared resolveCoverForTrack chain. Fires AT MOST ONCE per row. Never throws.
```

From src/lib/services/cover-backfill.ts:
```typescript
export async function resolveCoverForTrack(track: Track, signal?: AbortSignal): Promise<string | null>;
// Shared Deezer → iTunes → CN tier chain; writes BOTH cache layers on a SOLID https hit; never throws.
```

ESTABLISHED list-row cover pattern (search/library/artist/album rows all use this exact shape):
```svelte
<span class="art"
  use:lazyCover={{ track, onResolved: (uid, url) => { resolvedCovers = { ...resolvedCovers, [uid]: url }; } }}
  style:background-image={(resolvedCovers[track.uid] ?? track.cover) ? `url(${resolvedCovers[track.uid] ?? track.cover})` : fallbackCover(track)}>
</span>
```

From src/lib/stores/player.svelte.ts (existing private machinery to BUILD ON — do not duplicate):
```typescript
private static PREFETCH_MAX_CANDIDATES = 4;
private static PROBE_TIMEOUT_MS = 1500;
private static RETRY_RESOLVE_MAX = 2;          // bounded delayed re-resolve budget per uid
private static RETRY_RESOLVE_DELAY_MS = 4000;
private scheduleRetryResolve(uid: string): void; // arms ONE bounded, backed-off delayed prefetchNext re-run for a uid; deduped + budget-guarded; never throws
private handleDefinitiveFailure(uid: string): void; // strike → (budget) scheduleRetryResolve | (exhausted) promote to unplayableUids
private ensureAhead(): Promise<void>;          // grows the queue via buildSimilarQueue → buildDiversePicks when queue.length - indexOf(current) <= 2; queueGen-guarded; never throws
private async prefetchNext();                  // forward resolve+probe walk; probe.ok / probe.errored / timeout branches
private probePlayable(url): Promise<{ ok: boolean; errored: boolean }>; // errored:false on TIMEOUT (transient), errored:true on hard error
```

Existing prefetchNext walk control flow (the seam to extend — see lines ~1614-1666):
- `for step in 0..PREFETCH_MAX_CANDIDATES`: candIdx = firstIndex + step
  - `if candIdx >= queue.length: break`   ← runs off the end (no eager grow today)
  - skip if `unplayableUids.has(cand.uid)`
  - resolve; on throw → `continue` (transient, no mark)
  - no audioUrl → `handleDefinitiveFailure(cand.uid); continue`
  - `probe = await probePlayable(...)`; if `!probe.ok`:
      - `if probe.errored: handleDefinitiveFailure(cand.uid)`  ← hard error path (already retried at cap)
      - `continue`  ← TIMEOUT path: skipped silently, NEVER re-armed for retry (THE GAP for 2a)
  - probe.ok → write back resolved slot, `return` (landed)
- Falls out of the loop with NOTHING landed when the whole window is dead/timed-out/off-end (THE GAP for 2b)

From src/lib/sources/netease.ts (lyric extractor — NOT currently exported; export it for unit testing):
```typescript
// resolve() fetches track.lrcUrl (/api/netease/lrc?id=...), content-type-sniffs json vs text,
// and for json calls extractLrcFromJson(lj). Today extractLrcFromJson reads:
//   string body | o.lrc | o.lyric | data.lrc | data.lyric | (typeof data === 'string')
function extractLrcFromJson(lj: unknown): string | null;
```

From src/lib/sources/qq.ts (~221) and kuwo.ts (~122) — inline lyric field reads:
```typescript
track.lrc = d.song_lyric || d.lyric || track.lrc;        // qq
lrc: d.lyric || track.lrc || null;                       // kuwo
```

From src/lib/services/catalog.ts:
```typescript
export async function ensureTrackDetails(track, signal?, quality?): Promise<Track>;
// Readiness guard (line 207): `track.detailsLoaded && track.audioUrl && (track.lrc || !track.lrcUrl)`
// → a source that yields no lrcUrl is "complete" with no lyrics and is NOT re-resolved.
export async function searchAll(keyword, page?, prefs?, signal?, onPartial?): Promise<SearchResult>;
// SearchResult.interleaved: Track[] — the existing cross-source search seam (TTL-cached).
```

From src/lib/services/match-key.ts + score-match.ts (REUSE for cross-source matching):
```typescript
export function matchKey(artist: string, title: string): string;          // normalized cross-source identity
export function scoreMatch(...): number;                                   // existing candidate scorer
```

From src/lib/stores/player.svelte.ts fillLyricsOffline (~519-535) — the generation-guard idiom to mirror:
```typescript
// re-resolves lyrics OFF the critical path, guarded by uid + a captured playGen snapshot; on success
// patches { lrc, lrcUrl } onto the SAME current track ONLY if myGen === this.playGen && current.uid === uid.
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Resolve covers on the Up-Next list + carousel neighbors in NowPlaying.svelte</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
Wire the EXISTING `use:lazyCover` action (already imported elsewhere; add the import from
`$lib/actions/lazyCover` if not present) into the two cover surfaces that currently never resolve,
mirroring the established search/library/artist/album row pattern EXACTLY. Do NOT build a new
resolver — `lazyCover` already calls the shared `resolveCoverForTrack` chain (Deezer → iTunes → CN),
is cache-first, in-flight-deduped, fires at most once per row, https-only, and never throws.

(a) Up-Next list rows (the `{#each upNextList as track, i (track.uid)}` block, ~line 1243-1268):
   - Add a local resolved-cover map: `let resolvedCovers = $state<Record<string, string>>({});`
     (place it near the other Up-Next state, e.g. by `upNextList`/`anchorIdx`). Reuse the
     `fallbackCover(t)` helper already defined in this file (line ~68) for the gradient on a miss.
   - Inside the `.q-row` button, BEFORE the `<span class="r-title">`, insert a cover thumbnail span:
     `<span class="q-art" use:lazyCover={{ track, onResolved: (uid, url) => { resolvedCovers = { ...resolvedCovers, [uid]: url }; } }} style:background-image={(resolvedCovers[track.uid] ?? track.cover) ? `url(${resolvedCovers[track.uid] ?? track.cover})` : fallbackCover(track)}></span>`
     Keep the existing `{#if skipped}<span class="r-skip">✗</span>{/if}`, `.r-title`, `.r-artist`
     children and ALL existing actions (use:swipeRemove, use:longpress, onclick, onlongpress, title)
     byte-for-byte — only ADD the art span. The art is rendered as an `<img src>`-equivalent CSS
     `background-image: url(...)` of an https-only string (T-0bb-01 posture); never throws → gradient.
   - Add a `.q-art` style rule in the existing `<style>` block (near `.r-title`/`.r-artist`, ~line 1549):
     small square thumbnail consistent with the row height (e.g. `width:36px;height:36px;border-radius:6px;background-size:cover;background-position:center;flex:none;margin-right:8px;`).
     Ensure `.list li`/`.q-row` flex layout keeps the art left of the title (the `.q-row` is already
     `display:flex` via `.row`; verify the title/artist still stack — wrap title+artist in a min-width:0
     column span if needed so the existing ellipsis behavior is preserved). Do NOT regress the dimmed
     `.q-row.skipped { opacity: 0.45 }` rule (the art dims with the row since it is a child).

(b) Carousel prev/next neighbor covers (the `cellBg` helper, ~line 478-479, used at lines 1135/1140):
   - The neighbors currently use raw `tk.cover` which is null for many sources → gradient forever.
     Resolve them via the SAME `resolvedCovers` map. Add `use:lazyCover` to the prev/next
     `.cover-cell` elements (lines ~1135 and ~1140 — `cellBg(prevCover)` / `cellBg(nextCover)`):
     change each to `use:lazyCover={{ track: prevCover, onResolved: (uid,url) => { resolvedCovers = { ...resolvedCovers, [uid]: url }; } }}` (guard: only attach when the neighbor is non-null —
     wrap with `{#if prevCover}`/`{#if nextCover}` or keep the empty 'none' cell when null), and
     change `cellBg` to read the resolved map first:
     `const cellBg = (tk) => tk ? ((resolvedCovers[tk.uid] ?? tk.cover) ? `url(${resolvedCovers[tk.uid] ?? tk.cover})` : fallbackCover(tk)) : 'none';`
   - Do NOT touch the CURRENT cell (`effectiveCover` at line 1138) — it already resolves via
     `player.resolvedCover` + the Last.fm swap and must keep that behavior.

CONSTRAINTS: https-only `<img>`/background-image (never inject), no new env var, no new npm dep,
lazy/post-paint (lazyCover defers to IntersectionObserver intersection), never-throw → gradient on
miss. This is a presentation-only change in ONE component; the store is untouched in this task.
  </action>
  <verify>
    <automated>npx vitest run src/lib/actions/lazyCover.test.ts src/lib/services/cover-backfill.test.ts src/lib/services/itunes-cover.test.ts</automated>
  </verify>
  <done>
NowPlaying Up-Next rows render a `.q-art` thumbnail wired through `use:lazyCover` (resolving via the
shared chain) and the carousel prev/next neighbors resolve covers via the same `resolvedCovers` map.
`npm run check` (svelte-check) passes for NowPlaying.svelte (no type/template errors). Existing cover
suites stay green. Manual dev-server check (final checkpoint) confirms Up-Next/carousel covers populate.
  </done>
</task>

<task type="auto">
  <name>Task 2: Up-next never-stop — retry transient timeouts + eagerly extend the queue on walk exhaustion</name>
  <files>src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts</files>
  <action>
Extend the EXISTING `prefetchNext()` forward walk (lines ~1593-1677) with two LAYERED mechanisms,
reusing the existing `scheduleRetryResolve()` / `ensureAhead()` / strike machinery. Add NO new
unbounded loops; respect every existing guard (seedUid stale-check after each await, abort signal,
in-flight dedupe, playGen/queueGen generation guards, FAILURE_CAP/loop-guard as the ultimate stop,
the no-premature-skip-of-an-already-started-track rule). Do NOT gate any new behavior on the audio
`playing` event (memory: that froze iOS — reverted).

(a) RETRY transient timeout-class probe failures (the "playable later on click" case):
   - Today the probe TIMEOUT branch (`!probe.ok && !probe.errored`, line ~1653-1654) does a bare
     `continue` — the candidate is skipped this round and NEVER re-armed for a delayed retry; only a
     definitive-at-cap failure schedules one. A timeout is exactly the transient class the user reports
     recovers on click. Arm a bounded, backed-off delayed re-resolve for it via the EXISTING
     `scheduleRetryResolve(cand.uid)` (it is already dedupe-guarded + budget-capped by RETRY_RESOLVE_MAX
     and re-runs prefetchNext after the delay — reuse it, do not duplicate). In the timeout branch,
     after deciding NOT to mark dead, call `this.scheduleRetryResolve(cand.uid)` BEFORE `continue`.
     Keep `probe.errored` (hard error) routing through `handleDefinitiveFailure` unchanged (it already
     re-arms at cap). A timeout must STILL NOT add to `unplayableUids` (no ✗ row for a transient).
   - scheduleRetryResolve already self-guards: if budget is exhausted for that uid it no-ops, so a
     persistently-timing-out candidate converges (a few delayed attempts, then it stops scheduling and
     the walk/next() simply routes past it on demand). No new constant needed.

(b) EXTEND the queue when the forward walk exhausts playable candidates (the "stops when 2-3
    consecutive are unplayable" case):
   - The walk `break`s on `candIdx >= queue.length` (ran off the end) and can fall out of the loop
     having landed NOTHING (every candidate ahead was dead/timed-out/off-end). Today nothing grows the
     queue here — growth is only reactive inside `next()`. Proactively top up: after the `for` loop,
     when no playable candidate was landed, eagerly call `void this.ensureAhead()` so generated related
     songs (buildSimilarQueue → buildDiversePicks) are appended BEFORE the track ends and `next()` is
     asked to advance. ensureAhead is already idempotent (single in-flight growPromise), queueGen-guarded,
     and only grows when `queue.length - indexOf(current) <= 2`, so this is a safe no-op when the tail is
     already long. Implement by tracking a `landed` boolean in the walk (set true right before the
     `return` on a probe-verified hit) and, after the loop, `if (!landed) void this.ensureAhead();`.
     Do this INSIDE the try, AFTER the loop, guarded by the same seedUid/abort stale-check so a
     superseded walk does not grow a stale queue. ensureAhead never throws and never bumps playGen.
   - Do NOT call `next()` or `runFallback()` from prefetchNext (it must stay a pure pre-resolve +
     grow optimization). The existing `next()` end-of-queue path (line ~2327: `ensureAhead().then(...)`)
     remains the authority for ACTUAL advancement; this change just guarantees the tail is non-empty by
     the time advancement is needed, so consecutive dead entries no longer leave next() with nothing.

Update the header comment block on prefetchNext to document both additions (timeout → delayed retry;
walk-exhaustion → eager ensureAhead) in the existing quick-260629-nyl voice/style.

TESTS (src/lib/stores/player.svelte.test.ts — extend, do not rewrite; the suite already mocks
ensureTrackDetails, buildSimilarQueue, buildDiversePicks, probePlayable is real but Audio is stubbed):
   - Add a test that a probe TIMEOUT on a Next-up candidate arms a delayed re-resolve: drive
     prefetchNext with a candidate whose probe times out (resolve `{ok:false, errored:false}`), use
     `vi.useFakeTimers()`, assert the candidate is NOT added to unplayableUids immediately, advance the
     fake clock past RETRY_RESOLVE_DELAY_MS, and assert prefetchNext re-ran (e.g. ensureTrackDetails /
     the resolve path is invoked again for that uid). Reuse the existing test's mocking idioms.
   - Add a test that when the forward walk lands NO playable candidate (all ahead resolve without an
     audioUrl or every probe fails), prefetchNext calls ensureAhead (assert buildSimilarQueue /
     buildDiversePicks is invoked, or that the growPromise path runs) so the queue is extended.
   - Keep all existing tests green (do not change their expectations).
  </action>
  <verify>
    <automated>npx vitest run src/lib/stores/player.svelte.test.ts</automated>
  </verify>
  <done>
prefetchNext arms `scheduleRetryResolve` on a transient probe timeout (no permanent ✗), and eagerly
calls `ensureAhead()` when the forward walk lands no playable candidate. New tests assert both
behaviors; the full player.svelte.test.ts suite passes; no existing test was weakened. All generation
guards / FAILURE_CAP / no-premature-skip invariants are preserved (no new unbounded loop, no new
playGen bump, no `playing`-event dependency).
  </done>
</task>

<task type="auto">
  <name>Task 3: Fix the "No lyrics" regression — shape-tolerant lyric extraction + bounded cross-source lyric fallback</name>
  <files>src/lib/sources/netease.ts, src/lib/sources/netease.test.ts, src/lib/sources/qq.ts, src/lib/sources/qq.test.ts, src/lib/sources/kuwo.ts, src/lib/services/catalog.ts, src/lib/services/catalog.test.ts</files>
  <action>
The "No lyrics for this track" regression is almost certainly an upstream lyric ENDPOINT/SHAPE change
in the dominant source(s) — netease and/or qq — so the existing extractor returns null on a real hit.
Lyrics for jamendo/audius/fivesing are genuinely null upstream (expected, NOT this regression) — do
NOT touch those. REUSE existing /api routes, services, and the match-key/score-match helpers; add NO
new endpoint, env var, or npm dep.

STEP 1 — DIAGNOSE against the live proxy (executor needs network; dev server on strictPort 4321):
   - Start `npm run dev` and hit the app's OWN proxy routes for a known-lyric song. For netease, find
     a songid via `/api/netease/search?id=<keyword>&limit=10` then fetch `/api/netease/lrc?id=<songid>`
     and inspect the RAW body + its Content-Type. Compare the actual JSON keys against what
     `extractLrcFromJson` reads (string | o.lrc | o.lyric | data.lrc | data.lyric | string data).
   - For qq, fetch `/api/qq/detail?msg=<kw>&type=json&mid=<mid>` and inspect whether `song_lyric` /
     `lyric` are still present or moved/renamed/nested (e.g. nested under a `data`/`lyric` object, or
     base64/escaped). For kuwo only if its `d.lyric` field also regressed.
   - Record the OLD vs NEW shape in the SUMMARY so the fix is auditable. If diagnosis shows the proxy
     ROUTE itself regressed (e.g. 404 / wrong upstream / empty body) rather than the JSON shape, fix the
     route under src/routes/api/<source>/... instead of (or in addition to) the extractor, and note it.

STEP 2 — FIX the extractor(s) for the CURRENT shape, tolerant of BOTH old and new:
   - netease.ts: EXPORT `extractLrcFromJson` (it is currently a private function — exporting it makes
     new-shape unit tests clean and is non-breaking). Widen it to also read whatever NEW key path
     diagnosis revealed (e.g. nested `data.lyric.lyric`, a `lrclist`/`lines` array joined back to LRC
     text, an array-of-{time,text}, base64-decoded payloads, etc.) WITHOUT removing the existing keys.
     Keep it never-throw (wrap any decode/parse in try/catch) and return null ONLY on a true miss. If
     the new shape is plain text under a key, return that string. Preserve the content-type sniff in
     resolve() (json vs text); if the endpoint now returns text where it used to return json (or vice
     versa), make resolve() robust to both (try json parse, fall back to text) rather than relying on
     the header alone.
   - qq.ts (~221): widen the `track.lrc = d.song_lyric || d.lyric || track.lrc` read to also cover the
     new field/nesting diagnosis found (e.g. `d.lyric?.lyric`, `d.song_lyric?.lyric`, a nested object).
     Keep it defensive (optional chaining, never throw), null only on a true miss.
   - kuwo.ts (~122): only if diagnosis shows its `d.lyric` also regressed — otherwise leave untouched.

STEP 3 — BOUNDED cross-source lyric fallback in catalog.ts `ensureTrackDetails`:
   - Problem: the readiness guard treats a track with no `lrcUrl` and no `lrc` as "complete" with no
     lyrics, and a single-source miss surfaces "No lyrics" even when another source HAS them. Add a
     bounded, best-effort fallback: AFTER the primary `SOURCES[track.source].resolve(...)` returns, if
     the resolved track has an audioUrl but STILL no `lrc` (and it is a source that SHOULD have lyrics —
     i.e. not jamendo/audius/fivesing), do ONE cross-source lyric lookup:
       (1) `searchAll(\`${track.artist} ${track.title}\`, 1, ...)` (the existing TTL-cached seam — cheap
           on a warm cache),
       (2) pick the best matching candidate from a DIFFERENT source using the EXISTING `matchKey` /
           `scoreMatch` helpers (do not hand-roll matching),
       (3) `SOURCES[candidate.source].resolve(candidate, sig)` and, if it yields a non-empty `lrc`, copy
           ONLY that `lrc` (and `lrcUrl` if relevant) onto the returned track (never overwrite the
           already-resolved audioUrl/quality from the primary source).
     Bound it strictly: at most ONE fallback candidate resolve per call, honor the AbortSignal, and
     never throw (wrap in try/catch → return the primary track unchanged on any failure). This must NOT
     fire for sources with no upstream lyrics (jamendo/audius/fivesing) and must NOT fire when the
     primary already produced lyrics. Keep it OFF the audio critical path semantics: ensureTrackDetails
     is already awaited before play, so guard the added latency by only doing the fallback when there is
     genuinely no lrc — and document that a future enhancement could move it post-paint if latency shows.
     (If the executor judges the added pre-play latency unacceptable, the equivalent acceptable
     placement is to widen player.svelte.ts's existing `fillLyricsOffline` generation-guarded backfill
     to ALSO run for a network track that resolved with no lrc — reusing the SAME uid+playGen guard —
     rather than blocking ensureTrackDetails. Pick ONE placement and justify it in the SUMMARY; do not
     do both.)

STEP 4 — GENERATION/RACE SAFETY:
   - If the fallback lands in catalog.ts, it returns the patched Track synchronously to the awaiting
     caller (play()/prefetch already gen-guard the assignment via myGen), so no extra guard is needed
     there — but ensure the AbortSignal is threaded so a superseded resolve aborts the extra searchAll.
   - If instead widening player.svelte.ts fillLyricsOffline-style backfill, mirror its EXACT idiom:
     capture `myGen = this.playGen` + `uid` before the async work, and patch `{ lrc, lrcUrl }` onto the
     current track ONLY when `myGen === this.playGen && this.current?.uid === uid` — so a stale lyric
     fetch never writes into a newer track.

TESTS:
   - netease.test.ts: add fixtures/inline JSON for the NEW shape diagnosis revealed and assert the
     exported `extractLrcFromJson` returns the LRC for both the old shape (keep existing cases green)
     and the new shape; assert null on a genuine empty/missing-lyric body. Also assert `netease.resolve`
     end-to-end produces `lrc` for a new-shape mocked `/api/netease/lrc` response.
   - qq.test.ts: extend the existing `qq.resolve` lyric assertion (currently expects
     `out.lrc === detailFixture.song_lyric`) with a NEW-shape fixture/mock and assert `out.lrc` is the
     lyric text. Keep the old-shape case green.
   - catalog.test.ts: add a test for the cross-source lyric fallback — mock the registry/`searchAll` so
     the primary source resolves with no lrc and a different source HAS the lyric; assert the returned
     track carries the cross-source `lrc` while keeping the primary's audioUrl, and assert it is bounded
     (at most one fallback candidate resolved) + never throws on a fallback failure. (If the chosen
     placement was the player backfill instead, add the equivalent test to player.svelte.test.ts using
     its existing ensureTrackDetails mock + gen-guard idiom.)
   - Keep ALL existing source-adapter + catalog + player suites green.
  </action>
  <verify>
    <automated>npx vitest run src/lib/sources/netease.test.ts src/lib/sources/qq.test.ts src/lib/sources/kuwo.test.ts src/lib/services/catalog.test.ts src/lib/stores/player.svelte.test.ts</automated>
  </verify>
  <done>
The live-diagnosed upstream lyric shape change is documented (old vs new) and `extractLrcFromJson`
(now exported) + the qq/(kuwo) field reads are tolerant of both shapes and return null only on a true
miss. A bounded, never-throw cross-source lyric fallback exists in ONE justified place (catalog
ensureTrackDetails OR the player backfill, not both) so a single-source miss no longer surfaces
"No lyrics" when another source has them. New old-shape + new-shape extraction tests and a fallback
test pass; all existing source/catalog/player suites stay green; generation/uid race safety preserved;
no new /api route, env var, or npm dep.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
- Item 1: Up-Next list rows and now-playing carousel prev/next neighbors now resolve album art via
  the shared cover chain (Deezer → iTunes → CN), so they show real covers instead of blank/gradient.
- Item 2: The player now re-resolves a transiently-failing (timeout) Next-up song after a short delay
  and eagerly extends the up-next queue with related songs when the forward walk runs out of playable
  candidates, so playback does not stop on 2-3 consecutive unplayable entries.
- Item 3: The "No lyrics for this track" regression is fixed — the lyric extractor now handles the
  current upstream netease/qq shape (and a bounded cross-source lyric fallback fills a single-source
  miss), so songs that have lyrics upstream show them again.
  All automated suites (player store + cover services + lazyCover + source adapters + catalog) pass.
  </what-built>
  <how-to-verify>
1. Start the dev server (strictPort 4321): `npm run dev` then open http://localhost:4321 on a phone
   or a mobile-emulated browser viewport.
2. COVERS — search a song, tap to play, open the now-playing screen:
   - Open the Up-Next ("queue") tab. Confirm each row shows a real album thumbnail (not just
     title/artist on a blank row) as rows scroll into view. A song with no source cover should
     populate art within a moment, not stay a gradient forever.
   - Swipe the cover carousel left/right: the prev/next neighbor covers should show real art (not a
     bare gradient) when the underlying track had no `cover`.
   - Confirm the home tiles / search / library covers are unchanged (no regression).
3. PLAYBACK NEVER STOPS — play a song and let it auto-advance through the up-next list (or rapidly
   skip): when you hit a stretch where 2-3 up-next songs were previously unplayable, confirm playback
   KEEPS GOING (it either recovers a transiently-dead song after a few seconds, or advances into newly
   generated related songs) instead of halting on a stuck/blank track. Confirm a song that is already
   playing is never auto-skipped, and the iOS lock-screen/background audio still works.
4. LYRICS — play several netease and qq songs that you KNOW have lyrics (e.g. popular Mandarin/Cantopop
   tracks). Open the Lyrics tab and confirm the lyrics render (and scroll/highlight) instead of
   "No lyrics for this track". Confirm a genuinely lyric-less source (jamendo/audius/fivesing) still
   shows the empty state correctly (no false lyrics). If a song's primary source has no lyrics but
   another source does, confirm the lyrics now appear.
5. Confirm `npm run check` and the vitest suites are green.
  </how-to-verify>
  <resume-signal>Type "approved" or describe any cover that stays blank / any case where playback still stops / any known-lyric song that still shows "No lyrics".</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → iTunes/Deezer/CN cover APIs | untrusted external JSON; URLs rendered as `<img>`/background-image |
| client → music-source proxies (resolve/probe) | untrusted audio URLs; transient failures vs permanent dead |
| client → /api/<source>/lrc and /api/<source>/detail | untrusted external lyric JSON/text; shape changes without notice |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-nyl-01 | Tampering/Injection | Resolved cover URL rendered into Up-Next/carousel background-image | mitigate | Reuse the existing https-only SOLID guard (isSolidCover / lazyCover isHttps) — only `https:` strings reach the DOM, rendered as background-image (never executable); inherits T-0bb-01 posture, no new sink |
| T-nyl-02 | DoS (self) | New cover resolves on Up-Next rows | accept/mitigate | lazyCover defers to IntersectionObserver, fires AT MOST ONCE per row, cache-first + module-level in-flight de-dupe — bounded fan-out identical to the already-shipped search/library rows |
| T-nyl-03 | DoS (self) | Delayed re-resolve on probe timeout + eager ensureAhead | mitigate | scheduleRetryResolve is dedupe-guarded + capped by RETRY_RESOLVE_MAX with linear backoff; ensureAhead has a single in-flight growPromise + queueGen guard + grows only when tail ≤ 2; FAILURE_CAP/loop-guard remain the ultimate stop — no unbounded resolve burst |
| T-nyl-04 | Denial (stale write) | Walk-exhaustion ensureAhead / timeout retry / lyric fallback racing a newer play | mitigate | Reuse existing seedUid/abort + playGen/queueGen guards (cover/queue) and the uid+playGen fillLyricsOffline idiom (lyric backfill) so a superseded resolve never writes into a newer track |
| T-nyl-05 | Tampering | Untrusted lyric JSON/text from /api/<source>/lrc|detail (shape change) | mitigate | extractLrcFromJson + qq/kuwo reads stay never-throw (try/catch around any decode/parse), return null on a true miss; widened to new shape WITHOUT dropping old keys; lyric text is rendered as plain text (parseLRC) — never as HTML/markup |
| T-nyl-06 | DoS (self) | Cross-source lyric fallback in ensureTrackDetails | mitigate | At most ONE fallback candidate resolve per call; reuses the TTL-cached searchAll seam; only fires when the primary yields no lrc AND the source should have lyrics; AbortSignal-threaded; never throws |
| T-nyl-SC | Tampering | npm/pip/cargo installs | mitigate | No new dependencies added (reuse existing services/actions/api routes); no install step in this plan |
</threat_model>

<verification>
- `npx vitest run src/lib/stores/player.svelte.test.ts src/lib/services/cover-backfill.test.ts src/lib/services/itunes-cover.test.ts src/lib/actions/lazyCover.test.ts src/lib/sources/netease.test.ts src/lib/sources/qq.test.ts src/lib/sources/kuwo.test.ts src/lib/services/catalog.test.ts` — all green (new tests added in Tasks 2 and 3; existing tests unchanged).
- `npm run check` (svelte-check) — no new type/template errors in NowPlaying.svelte, player.svelte.ts, the source adapters, or catalog.ts.
- Manual dev-server (strictPort 4321) verification per the final checkpoint: Up-Next + carousel covers populate; playback continues past 2-3 consecutive unplayable up-next entries; known-lyric netease/qq songs render lyrics again; no regression to home/search/library covers, iOS background audio, or genuinely-lyric-less sources.
</verification>

<success_criteria>
- Up-Next list rows and now-playing carousel prev/next neighbors show resolved album art (via the shared lazyCover chain), not perpetual gradients.
- A transient (timeout) prefetch/probe failure on a Next-up song is re-resolved after a bounded delay instead of being skipped-and-forgotten; a hard error path is unchanged.
- When the forward prefetch walk exhausts playable candidates, the queue is eagerly extended with generated related songs so `next()`/track-end always has somewhere to advance.
- The "No lyrics" regression is fixed: the lyric extractor handles the current upstream netease/qq shape (old + new tolerant, never-throw, null only on a true miss) and a bounded cross-source lyric fallback fills a single-source miss; genuinely-lyric-less sources are unaffected.
- No new npm dependency, no new env var, no new /api route, no parallel cover/resolve/lyric system; all existing invariants (generation guards, FAILURE_CAP/loop-guard, skip-burst batching, no-premature-skip, iOS background audio, DATA-03 per-source isolation) preserved.
- All targeted vitest suites pass.
</success_criteria>

<output>
Create `.planning/quick/260629-nyl-fix-song-cover-art-source-itunes-fallbac/260629-nyl-SUMMARY.md` when done
</output>
