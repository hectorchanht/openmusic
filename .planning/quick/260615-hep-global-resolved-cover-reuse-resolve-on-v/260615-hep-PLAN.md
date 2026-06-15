---
phase: quick-260615-hep
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/stores/cover-version.svelte.ts
  - src/lib/stores/player.svelte.ts
  - src/routes/(app)/+page.svelte
autonomous: true
requirements: [COVER-GLOBAL-01, COVER-GLOBAL-02, COVER-GLOBAL-03]
must_haves:
  truths:
    - "A cover resolved on the now-playing page (track.cover OR resolved.cover OR async tier-chain) is written to BOTH cache layers (uid + name) so other surfaces reuse it"
    - "Every cover WRITE bumps a single global reactive version signal; every mounted tile that reads through the reactive helper repaints live the instant any cover lands anywhere"
    - "Homepage song tiles read uid-first then name (track.cover ?? getCachedCoverByUid(uid) ?? getCachedCover(artist,title) ?? fallback) — the uid layer is no longer skipped"
    - "Homepage song surfaces resolve covers on scroll-into-view, reusing the existing lazyCover action + onResolved (which writes both layers)"
    - "npm run check reports 0 errors; cover-cache.test.ts, cover-backfill.test.ts, lazyCover.test.ts, player.svelte.test.ts stay green"
  artifacts:
    - path: "src/lib/stores/cover-version.svelte.ts"
      provides: "Reactive cache-version signal + reactive read helpers wrapping the pure cover-cache getters"
      contains: "bumpCoverVersion"
    - path: "src/lib/stores/player.svelte.ts"
      provides: "Now-playing write-back of displayed cover into both cache layers"
      contains: "setCachedCoverByUid"
    - path: "src/routes/(app)/+page.svelte"
      provides: "uid-first reactive cover reads + lazyCover on song tiles"
      contains: "getCachedCoverByUid"
  key_links:
    - from: "src/lib/stores/player.svelte.ts"
      to: "src/lib/services/cover-cache.ts"
      via: "setCachedCoverByUid + setCachedCover on the sync resolvedCover paths"
      pattern: "setCachedCoverByUid\\(.*\\.uid"
    - from: "src/routes/(app)/+page.svelte"
      to: "src/lib/stores/cover-version.svelte.ts"
      via: "reactive read helper depended on by tileCover / row covers"
      pattern: "coverVersion|readCover"
    - from: "src/routes/(app)/+page.svelte"
      to: "src/lib/actions/lazyCover.ts"
      via: "use:lazyCover on song tiles, onResolved bumps version"
      pattern: "use:lazyCover"
---

<objective>
Make resolved song covers globally shared + resolved-on-view, extending the EXISTING cover pipeline
(cover-cache / cover-backfill / lazyCover) — no parallel resolver, no second cache.

Three root-cause gaps from CONTEXT.md:
1. The now-playing `track.cover` / `resolved.cover` SYNC display paths in player.svelte.ts set
   `resolvedCover` but never write the shared cache → other surfaces can't reuse that art.
2. There is no GLOBAL reactivity: the homepage's local `coverVer` only bumps from its own backfill
   onResolved; a cover landing from now-playing or a lazyCover row elsewhere never repaints homepage tiles.
3. Homepage song reads skip the uid layer (name-key only) and song tiles have NO lazyCover →
   no resolve-on-view, no uid-first reuse.

Purpose: "resolved once → shown everywhere, live." Honor the LOCKED decisions exactly.
Output: one thin reactive `.svelte.ts` wrapper, now-playing write-back, homepage uid-first reactive reads + lazyCover.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/quick/260615-hep-global-resolved-cover-reuse-resolve-on-v/260615-hep-CONTEXT.md
@./CLAUDE.md

<interfaces>
<!-- Pure cover-cache getters/setters (DO NOT edit cover-cache.ts — wrap it). From src/lib/services/cover-cache.ts: -->
export function getCachedCover(artist: string, title: string): string | null;
export function getCachedCoverByUid(uid: string): string | null;
export function getCachedArtistCover(artist: string): string | null;
export function setCachedCover(artist: string, title: string, url: string): void;        // no-op on empty/whitespace url; never throws
export function setCachedCoverByUid(uid: string, url: string): void;                      // no-op on empty url; never throws
export function setCachedArtistCover(artist: string, url: string): void;

<!-- From src/lib/services/cover-backfill.ts (already writes BOTH layers on a SOLID hit): -->
export async function resolveCoverForTrack(track: Track, signal?: AbortSignal): Promise<string | null>;
//   on SOLID https hit: setCachedCoverByUid(track.uid, url) AND setCachedCover(track.artist, track.title, url)
export async function backfillCovers(items: { artist; title }[], opts: { signal?; onResolved?: (key,url)=>void; max? }): Promise<void>;

<!-- From src/lib/actions/lazyCover.ts (resolve-on-view; reuse as-is): -->
export interface LazyCoverParam { track: Track; onResolved: (uid: string, url: string) => void; }
export const lazyCover: Action<HTMLElement, LazyCoverParam>;
//   reads uid→name cache, probes/repairs existing cover, runs resolveCoverForTrack; SSR/in-flight/once guards built in.

<!-- From src/lib/components/CompactRow.svelte — the pattern to MIRROR (track variant): -->
//   <span class="art" use:lazyCover={{ track, onResolved: (_uid, url) => (resolvedCover = url) }}
//         style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackGradient(seed)}></span>
//   local: let resolvedCover = $state<string|null>(null); const effectiveCover = $derived(resolvedCover ?? cover);

<!-- From src/lib/services/lastfm.ts — homepage discovery tiles carry NO uid/Track: -->
export interface DiscoveryTrack { artist: string; title: string; image: string | null; mbid: string | null; }
<!-- Library shelves DO carry full Track[] (uid present). makeUid form is 'source:songid' (colon). -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add the global reactive cover-version signal (thin wrapper, SSR-safe)</name>
  <files>src/lib/stores/cover-version.svelte.ts</files>
  <action>
    Create a NEW reactive wrapper module — DO NOT edit cover-cache.ts (its tests import the pure
    functions from a plain `.ts` and must not pull a rune-compiled `$state` into node vitest).
    This implements LOCKED decision #2 (global cache-version signal) via "wrap, don't rewrite".

    Export, from this `.svelte.ts`:
    - A module-scoped reactive counter via Svelte 5 runes. Because top-level `$state` is allowed in
      `.svelte.ts`, hold the counter in a small object: `const _v = $state({ n: 0 });` and export a
      getter `export function coverVersion(): number { return _v.n; }` (a function so callers create
      a reactive dependency by CALLING it inside a `$derived`/template — mirrors the existing
      homepage `void coverVer` idiom but global).
    - `export function bumpCoverVersion(): void { _v.n++; }` — called after every cover WRITE.
    - Reactive READ helpers that depend on the signal then delegate to the PURE getters, enforcing
      the LOCKED read order (uid-first → name → null). Import the pure getters from
      '$lib/services/cover-cache':
        `export function readCoverByUidOrName(uid: string, artist: string, title: string): string | null {
            coverVersion(); // reactive dependency — recompute when any cover lands
            return getCachedCoverByUid(uid) ?? getCachedCover(artist, title);
         }`
        `export function readCoverByName(artist: string, title: string): string | null {
            coverVersion();
            return getCachedCover(artist, title);
         }`
        `export function readArtistCover(artist: string): string | null {
            coverVersion();
            return getCachedArtistCover(artist);
         }`
    - A SINGLE write-through helper that other modules call so the bump always pairs with the write
      (keeps "every write bumps" true in ONE place):
        `export function writeCoverBoth(uid: string, artist: string, title: string, url: string): void {
            setCachedCoverByUid(uid, url);
            setCachedCover(artist, title, url);
            bumpCoverVersion();
         }`
      (Import setCachedCoverByUid/setCachedCover from cover-cache. This is the canonical both-layers
      writer for decision #1 — callers use it instead of two separate setters + a manual bump.)

    SSR-safety: the module imports only pure functions + runes; it touches NO browser globals at
    module top level (the underlying cover-cache setters already guard localStorage in try/catch).
    The runes compile fine under SvelteKit's SSR because this is a `.svelte.ts` file. Do NOT add any
    `$effect` or DOM access here.

    Add a header comment: this is the reactive wrapper for the pure cover-cache (quick-260615-hep,
    LOCKED decision #2); cover-cache.ts stays pure so cover-cache.test.ts / cover-backfill.test.ts
    remain node-runnable; the name key (matchKey) is the cross-surface bridge.
  </action>
  <verify>
    <automated>npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "cover-version|error" | head; npx vitest --run src/lib/services/cover-cache.test.ts src/lib/services/cover-backfill.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>cover-version.svelte.ts exists exporting coverVersion(), bumpCoverVersion(), readCoverByUidOrName, readCoverByName, readArtistCover, writeCoverBoth; svelte-check shows 0 errors for the file; cover-cache.test.ts + cover-backfill.test.ts stay green (cover-cache.ts unchanged).</done>
</task>

<task type="auto">
  <name>Task 2: Now-playing write-back — every displayed cover feeds both cache layers + bumps</name>
  <files>src/lib/stores/player.svelte.ts</files>
  <action>
    Implements LOCKED decisions #1 + #4 (now-playing must feed the shared cache; both keys). Today
    three sites set `this.resolvedCover` from a displayed cover but never write the shared cache, so
    other surfaces can't reuse it. Wire writeCoverBoth into each WHERE THE COVER IS A REAL https URL.

    Import at top: `import { writeCoverBoth } from '$lib/stores/cover-version';` (alongside the
    existing cover-cache import at line 30). Use the existing isHttps-style guard inline — only write
    a non-empty https URL (mirror cover-backfill's isSolidCover; an http/data/blank URL must NOT be
    cached, per T-0bb-01). Add a tiny local guard if none is in scope:
    `const httpsOnly = (u?: string|null): u is string => typeof u === 'string' && u.startsWith('https:');`

    Site A — the SYNC set in play() (~line 1498-1499): after
      `this.resolvedCover = track.cover ?? getCachedCoverByUid(track.uid) ?? getCachedCover(...) ?? null;`
      if `httpsOnly(this.resolvedCover)` then `writeCoverBoth(track.uid, track.artist, track.title, this.resolvedCover)`.
      This captures the `track.cover` path (the CONTEXT.md ~line 1590 gap's sibling) AND any value
      that came only from one cache layer, re-writing it to BOTH layers + bumping so the homepage
      (and every mounted tile) repaints live.

    Site B — the resolved.cover adoption (~line 1585-1590): inside `if (resolved.cover) { ... }`,
      after `library.adoptCover(resolved)` and the `if (!this.resolvedCover) this.resolvedCover = resolved.cover;`,
      if `httpsOnly(resolved.cover)` then `writeCoverBoth(resolved.uid, resolved.artist, resolved.title, resolved.cover)`.
      (resolved.cover came from ensureTrackDetails — a real fetched cover other surfaces should reuse.)

    Site C — resolveCoverAsync (~line 1700-1701): the async tier chain via resolveCoverForTrack
      ALREADY writes both cache layers internally, so do NOT double-write — but it does NOT bump the
      reactive signal. After `this.resolvedCover = url;` add `bumpCoverVersion();` (import it too) so
      a late async cover land repaints other mounted tiles. (resolveCoverForTrack handles caching;
      we only add the global repaint signal here.)

    Do NOT change generation-guard logic, MediaMetadata writes, or any control flow — only ADD the
    cache write + bump at the three points. Keep all writes inside the existing `myGen`/superseded
    guards already in place (Site A/B run before the guards' discard points but write only real art,
    which is harmless; Site C is already after its guard).
  </action>
  <verify>
    <automated>npx vitest --run src/lib/stores/player.svelte.test.ts 2>&1 | tail -8; npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "player.svelte.ts.*error" | head</automated>
  </verify>
  <done>player.svelte.ts writes both cache layers (writeCoverBoth) on the two sync resolvedCover sites for https covers, bumps the version after the async land, imports from cover-version; player.svelte.test.ts stays green; no new svelte-check errors.</done>
</task>

<task type="auto">
  <name>Task 3: Homepage — uid-first reactive reads + lazyCover on song tiles</name>
  <files>src/routes/(app)/+page.svelte</files>
  <action>
    Implements LOCKED decisions #2 (consume global signal) + #3 (resolve-on-view) + the read-order
    fix (homepage currently skips the uid layer). Mirror CompactRow's existing lazyCover usage.

    (a) READ ORDER + GLOBAL REACTIVITY. Replace the homepage's local `coverVer` reactivity with the
        global signal so a cover landing ANYWHERE (now-playing, lazyCover, backfill) repaints tiles:
        - Import: `import { coverVersion, readCoverByName, readArtistCover } from '$lib/stores/cover-version';`
          and also `getCachedCoverByUid` is ALREADY needed — add it to the existing cover-cache import.
        - In `tileCover()` (~line 252): replace `void coverVer;` with `coverVersion();` (reactive dep
          on the GLOBAL signal). Keep the render order; for the track branch keep name-key
          (DiscoveryTrack has NO uid) but route through `readCoverByName(item.artist, item.title)`;
          for the artist branch use `readArtistCover(item.artistName)`.
        - `libraryRowCover(track)` (~line 581-582) and the `librarySongRow` `rowCover` (~line 818):
          these rows DO carry a full Track with a uid → fix the skipped uid layer. Replace
          `track.cover ?? getCachedCover(track.artist, track.title)` with
          `track.cover ?? readCoverByUidOrName(track.uid, track.artist, track.title)` (import
          readCoverByUidOrName too). This adds uid-first AND makes the read reactive to the global signal.
        - The backfill onResolved callbacks (~line 299/307) currently do `() => coverVer++`. Replace
          with `() => bumpCoverVersion()` (import it) so the homepage backfill feeds the SAME global
          signal — every surface repaints, not just this page. Remove the now-unused local
          `let coverVer = $state(0);` declaration (~line 269) once all references are migrated.

    (b) RESOLVE-ON-VIEW on song tiles that carry a real Track (uid present): the library-track
        surfaces. The COMPACT path already uses CompactRow with `track={track}` → lazyCover is
        ALREADY wired there (mirror confirmed). The gap is the COMFORTABLE `librarySongRow` snippet
        (~line 817-826): add `use:lazyCover` to its `.al-cover` span exactly like CompactRow's track
        variant. Add a local resolved-cover state per row is not possible in a snippet, so instead
        wire lazyCover with onResolved → `writeCoverBoth` is already triggered inside lazyCover via
        resolveCoverForTrack; the visible repaint comes from the reactive `rowCover` reading the
        global signal. Concretely, on the `<span class="al-cover">` add:
          `use:lazyCover={{ track, onResolved: () => bumpCoverVersion() }}`
        so when lazyCover resolves (it writes both cache layers internally), the bump makes the
        reactive `rowCover` recompute and the <img> paint. Keep the existing
        `style:background-image` fallback + the `<img>` onerror=hideOnError pattern.

    (c) DISCOVERY tiles (DiscoveryTrack — top-hits/tags/countries comfortable `.album` tiles at
        ~line 790-798, and CompactRow discovery rows). These carry NO uid, so lazyCover (which needs
        a Track) is NOT the right tool; their resolve-on-view is ALREADY handled by `scheduleBackfill`
        + `backfillCovers`. After (a) they now (i) read via the reactive global signal and (ii) bump
        the global signal on resolve, so a discovery cover that lands repaints everywhere. Leave the
        backfill mechanism intact; do NOT build a synthetic uid stub for discovery tiles (avoid a
        parallel resolver). This satisfies decision #3 for discovery tiles via the existing capped
        backfill, and decision #2 makes them globally reactive. Add a one-line comment at the
        discovery `.album` tile noting resolve-on-view is via scheduleBackfill+global signal (not lazyCover, no uid).

    Do NOT change shelf ordering, density logic, play handlers, or the fallback grid. Only the cover
    read source, the reactive signal, and the lazyCover wiring on real-Track rows change.
  </action>
  <verify>
    <automated>npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -cE "error" ; npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "\\+page.svelte" | grep -i error | head; npx vitest --run src/lib/actions/lazyCover.test.ts 2>&1 | tail -4</automated>
  </verify>
  <done>Homepage: tileCover + library row reads depend on coverVersion() (global) and read uid-first for Track rows; librarySongRow uses use:lazyCover; backfill onResolved + now-playing all bump the SAME global signal; local coverVer removed; svelte-check 0 errors; lazyCover.test.ts green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| resolved cover URL → `<img src>` / CSS background | Cover strings rendered into the DOM; only https URLs are safe |
| localStorage cover-cache | Persisted strings read back and rendered |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-hep-01 | Tampering | Cover URL rendered to DOM | mitigate | Reuse the existing https-only guard (isSolidCover / httpsOnly) at EVERY new write site (player Sites A/B); never cache/render an http/data/blank URL (T-0bb-01 invariant preserved). |
| T-hep-02 | Denial of Service | Global reactive signal bump on every write | accept | A `$state` counter increment is O(1); writes are already gated (skip-cached, in-flight de-dupe, CAP=6 pool in backfill). No new fetch fan-out is added (discovery tiles keep the existing capped backfill; lazyCover keeps its once-per-row + in-flight guards). |
| T-hep-03 | Tampering | SSR safety of the reactive wrapper | mitigate | cover-version.svelte.ts touches no browser globals at module top; cover-cache setters keep their localStorage try/catch; no $effect/DOM in the wrapper. |
| T-hep-SC | Tampering | npm/pip/cargo installs | mitigate | No package installs in this plan — N/A (no new dependencies; reuses existing pipeline). |
</threat_model>

<verification>
- `npm run check` → 0 errors.
- `npx vitest --run` → cover-cache.test.ts, cover-backfill.test.ts, lazyCover.test.ts, player.svelte.test.ts all green (cover-cache.ts + cover-backfill.ts source UNCHANGED — the wrapper is additive).
- Manual smoke (optional): play a song on now-playing whose homepage tile was a gradient → after the cover lands, navigate home → the same song tile shows that cover live (uid or name match), no refresh.
</verification>

<success_criteria>
- A new `src/lib/stores/cover-version.svelte.ts` is the SINGLE reactive wrapper; cover-cache.ts stays pure.
- Now-playing writes every displayed https cover to BOTH layers (writeCoverBoth) and bumps after the async land.
- Homepage reads uid-first for Track rows, name-key for discovery, all through the global reactive signal; librarySongRow resolves-on-view via lazyCover; the SAME global signal is bumped from now-playing, lazyCover, and backfill.
- No parallel resolver, no second cache. All four named test files stay green; `npm run check` is 0 errors.
</success_criteria>

<output>
Create `.planning/quick/260615-hep-global-resolved-cover-reuse-resolve-on-v/260615-hep-01-SUMMARY.md` when done.
</output>
