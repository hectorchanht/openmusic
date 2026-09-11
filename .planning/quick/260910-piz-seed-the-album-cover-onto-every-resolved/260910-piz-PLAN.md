---
phase: quick-260910-piz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/routes/(app)/album/[name]/seed-cover.ts
  - src/routes/(app)/album/[name]/seed-cover.test.ts
  - src/routes/(app)/album/[name]/+page.svelte
autonomous: false
requirements: [quick-260910-piz]

must_haves:
  truths:
    - "After tapping the album page's play button, EVERY Up Next row paints the album cover (no synthetic gradient) — not just the currently playing track"
    - "Tapping a single album row (playStub path) yields the same result: the re-anchored album queue carries the album cover on every entry"
    - "Zero new network requests are issued to seed the covers — no /api/deezer/search, no iTunes, no CN cover-resolution calls during queue build"
    - "A null / non-https heroImg never blanks a cover a resolved track already carries (tracks pass through untouched)"
    - "Seeding does not change any Track uid, so setListQueue still re-anchors `current` into the album list by uid / same-song key"
    - "An album cover that arrives AFTER resolvedCache is filled is still applied on the next resolveAllCached() read"
  artifacts:
    - path: "src/routes/(app)/album/[name]/seed-cover.ts"
      provides: "pure seedAlbumCover(tracks, cover): Track[] — override-with-album-art, https-gated, null-safe"
      exports: ["seedAlbumCover"]
    - path: "src/routes/(app)/album/[name]/seed-cover.test.ts"
      provides: "node unit tests for override / null pass-through / non-https pass-through / uid preservation / new-object return"
    - path: "src/routes/(app)/album/[name]/+page.svelte"
      provides: "resolveAllCached() returns seedAlbumCover(raw, heroImg) on every read"
      contains: "seedAlbumCover"
  key_links:
    - from: "src/routes/(app)/album/[name]/+page.svelte resolveAllCached"
      to: "seedAlbumCover"
      via: "seed at READ time over the raw memoised array, reading the live heroImg"
      pattern: "seedAlbumCover\\(.*heroImg"
    - from: "playAlbum / playStub in +page.svelte"
      to: "player.setListQueue(all, 'album')"
      via: "the seeded array (unchanged call sites — they already consume resolveAllCached())"
      pattern: "setListQueue\\(all, 'album'\\)"
    - from: "src/lib/components/NowPlaying.svelte:1504 q-art"
      to: "track.cover"
      via: "resolvedCovers[track.uid] ?? track.cover — the seeded field paints the tile (Gap 3: no per-tile lazyCover)"
      pattern: "track\\.cover"
---

<objective>
When a user plays a whole album (or taps one row, which re-anchors the album queue), every resolved album track that lands in Up Next should already carry the album cover — which the page already knows as `heroImg`. Today only the ONE track handed to `player.playStub(..., heroImg)` (quick-260831-t2g) gets it; the `resolveAll()` array that feeds `setListQueue` carries no cover, so every other Up Next row renders the gradient.

Purpose: Gap 3 (26-10) deliberately removed per-tile `use:lazyCover` from Up Next to kill the `/api/deezer/search` flood, so those tiles paint ONLY from the seeded `track.cover`. The fix must therefore happen at queue-build time, as pure data seeding, with zero new fetches.
Output: one pure function + its co-located node test, and a one-line change to `resolveAllCached()` — the single chokepoint every consumer (play-album, row-tap re-anchor, like, download, add-to-playlist, `albumLiked`) already reads from.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md (house style: tabs, single quotes, high comment density; quick-task-ID comments are load-bearing decision records — tag with `quick-260910-piz`, keep the t2g / Gap 3 / album-and-next-song-bug comments intact)
@src/routes/(app)/album/[name]/+page.svelte (heroImg ~107; playStub ~249-267; resolveAll ~351; resolveAllCached ~363; albumLiked ~374; playAlbum ~380-400)
@src/routes/(app)/album/[name]/loader.test.ts (co-located vitest idiom in this route dir — import style, describe/it/expect)
@src/lib/sources/types.ts (Track: `cover: string | null`, `uid`)
@.planning/quick/260831-t2g-attach-a-known-cover-to-the-played-track/260831-t2g-SUMMARY.md (precedent: attached album cover WINS over the source's inline art, https-only gate)

<interfaces>
<!-- Existing contracts. Use directly — no exploration needed. -->

From src/lib/sources/types.ts:
```ts
export type Track = { uid: string; source: SourceId; songid: string; title: string; artist: string; cover: string | null; audioUrl: string | null; /* … */ };
```

From src/lib/stores/player.svelte.ts (module-private — DO NOT import; replicate the one-liner):
```ts
const httpsOnly = (u?: string | null): u is string => typeof u === 'string' && u.startsWith('https:');
```
`play()` seeds `resolvedCover` from `track.cover` first (line ~331), so a seeded https cover also skips per-song cover resolution when the queue advances.

From src/lib/components/NowPlaying.svelte:1504 (the consumer — DO NOT modify):
```svelte
<span class="q-art" style:background-image={(resolvedCovers[track.uid] ?? track.cover) ? `url(…)` : fallbackCover(track)}></span>
```

From +page.svelte (current, the two lines that change):
```ts
async function resolveAllCached(): Promise<Track[]> {
	if (resolvedCache && resolvedCache.length) return resolvedCache;
	const r = await resolveAll();
	resolvedCache = r;
	return r;
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure seedAlbumCover() + co-located node tests</name>
  <files>src/routes/(app)/album/[name]/seed-cover.ts, src/routes/(app)/album/[name]/seed-cover.test.ts</files>
  <behavior>
    - Given tracks [{cover:null}, {cover:'https://cn/thumb.jpg'}, {cover:'http://y.gtimg.cn/x.jpg'}] and cover 'https://cdn.dzcdn.net/a.jpg' → every returned track has cover === 'https://cdn.dzcdn.net/a.jpg' (OVERRIDE, including the track that already had an https source cover)
    - Given cover null → returns tracks with covers unchanged (the null-cover track stays null, the https one keeps its own) — seeding null never blanks a cover
    - Given cover 'http://…' (non-https) or '' → same pass-through as null
    - uid, source, songid, title, artist, audioUrl are identical before and after on every element (order preserved, same length)
    - Seeding returns NEW objects: the input array and its elements are not mutated (`input[0].cover` still null after the call; `out[0] !== input[0]`)
    - Empty input → empty output (no throw)
  </behavior>
  <action>
    Create `seed-cover.ts` in the route dir (a non-`+`-prefixed file in a SvelteKit route dir is an ordinary module; `loader.test.ts` already establishes co-located tests here). Export ONE pure function `seedAlbumCover(tracks: Track[], cover: string | null): Track[]`. `import type { Track } from '$lib/sources/types'`.

    Logic: if `cover` is not a string starting with `https:` → return `tracks` unchanged (pass-through; do not map). Otherwise return `tracks.map((t) => ({ ...t, cover }))` — new objects, never mutating `resolveStub`'s returns (they flow into the player store and get persisted).

    Header comment (load-bearing decision record, tag `quick-260910-piz`) must state, in this order:
    1. WHY at queue-build time: Gap 3 (26-10) removed per-tile lazyCover from Up Next (the `/api/deezer/search` flood); those tiles paint from the seeded `track.cover` only. Zero network — pure data.
    2. DECISION — OVERRIDE, not fill-in-when-null. Rationale: matches quick-260831-t2g's stated contract ("it WINS over the source's own inline cover on purpose") so the played track and its queued siblings can never disagree; the album cover is the merged best-quality art (Deezer hi-res > Last.fm) while CN inline covers are per-track thumbnails (often http y.gtimg.cn); the user arrived via the album hero, so matching it is the expected result. Tradeoff accepted: a rare per-track image that is legitimately better than the album art is replaced — consistency across the album wins.
    3. NULL / NON-HTTPS GUARD: `heroImg` is null until the async Deezer/Last.fm enrich lands and may be non-https from Last.fm; in that case tracks pass through untouched — seeding must never blank a cover a track already carries (same https-only gate as player.svelte.ts `httpsOnly`, replicated here rather than exported from the ~3000-line god object).
    4. IDENTITY: `uid` is untouched, so `setListQueue`'s uid / same-song re-anchor (album-and-next-song-bug fix) is unaffected.

    Write `seed-cover.test.ts` FIRST (vitest, node project — `import { describe, it, expect } from 'vitest'`, `import { seedAlbumCover } from './seed-cover'`), build minimal Track literals with a small `mk(overrides)` helper (cast via `as Track` if needed for non-tested fields; the repo tolerates casts in tests only). Run, see RED, then implement, see GREEN.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run "src/routes/(app)/album/\[name\]/seed-cover.test.ts"</automated>
  </verify>
  <done>seed-cover.test.ts passes with all 6 behaviors covered; seedAlbumCover is the only export; no imports beyond `type Track`.</done>
</task>

<task type="auto">
  <name>Task 2: Seed at the resolveAllCached() chokepoint, at READ time</name>
  <files>src/routes/(app)/album/[name]/+page.svelte</files>
  <action>
    Import `seedAlbumCover` from `./seed-cover`. Change ONLY `resolveAllCached()`:

    - Keep `resolvedCache` holding the RAW unseeded `resolveAll()` result (memoisation unchanged; the WR-08 reset on navigation and the `albumLiked` derived — which reads uids only — are untouched).
    - Return `seedAlbumCover(raw, heroImg)` on EVERY read, both the cache-hit branch and the fresh-resolve branch (i.e. `const raw = resolvedCache?.length ? resolvedCache : (resolvedCache = await resolveAll()); return seedAlbumCover(raw, heroImg);` — expressed as two clear statements is fine).

    Add a `quick-260910-piz` comment on the function explaining the ORDERING decision: the Deezer/Last.fm enrich that produces `heroImg` is async and independent of the ~10s `resolveAll` fan-out, so the cache can be filled while `heroImg` is still null. Seeding at READ time over the raw array (a ≤30-element map, no I/O) means a cover that arrives after the cache is filled is applied on the next `resolveAllCached()` call instead of being baked out by the memo. Also note the residual: if `heroImg` is still null at the exact moment `playAlbum()` calls `setListQueue`, that queue carries no seeded cover — accepted, no retro-patching of the live queue (would widen into player.svelte.ts; the t2g `playStub(…, heroImg)` for the first track is unchanged).

    Do NOT touch: `resolveAll()`, the two `player.playStub(..., heroImg, 'album')` call sites, the `setListQueue(all, 'album')` lines or their album-and-next-song-bug comments, the t2g comment in `playStub`, `swipeQueue`/`swipeNext`/`openMenu`/`DownloadControl` (single-row paths — seeding those is out of this task's scope: the report is about the album-queue Up Next rows).

    Update the `resolveAll()` doc comment's neighbour only if needed for accuracy; keep every existing decision-ref comment.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm check && pnpm test</automated>
  </verify>
  <done>`pnpm check` reports 0 errors; full `pnpm test` is green (including seed-cover.test.ts and the existing loader.test.ts); `grep -n "seedAlbumCover" "src/routes/(app)/album/[name]/+page.svelte"` shows the import plus exactly one call inside resolveAllCached(); `git diff --stat` touches only the three files in files_modified.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Behavioural verification — every Up Next row paints the album cover, zero new cover fetches</name>
  <what-built>Album-queue tracks now reach Up Next with the album cover seeded onto `track.cover` at queue-build time (pure data, no fetches). Before asking the human, the executor must attempt the check itself if a browser tool is available: start `pnpm dev` (port 4321 via launch.json or 5173 bare — probe, don't assume; Deezer + kuwo are reachable in the sandbox, netease/qq are not, so pick an album that resolves via kuwo).</what-built>
  <how-to-verify>
    1. Open the dev server, navigate to an artist page, open an album that shows a real hero cover (Deezer-enriched).
    2. Open DevTools → Network, filter `deezer/search` and `itunes` — note the current count.
    3. Tap the big play button. Wait for the queue to build (~10s for a long album).
    4. Expand Now Playing → Up Next tab. EXPECTED: every row's thumbnail is the album cover; no row shows the diagonal gradient.
    5. EXPECTED in Network: zero NEW `deezer/search` / iTunes / cover-resolution requests attributable to the queue rows (the only cover-related traffic is the album enrich that already ran on page open).
    6. Go back, tap a SINGLE row instead. EXPECTED: same — the re-anchored album queue's Up Next rows all carry the album cover, and next() advances through the album (re-anchor intact).
    7. Regression: open an album whose hero is still a gradient/skeleton (no Deezer match) and play it. EXPECTED: no crash; rows that had a source thumbnail keep it, the rest stay gradient (null heroImg is a pass-through).
  </how-to-verify>
  <files>none — verification only</files>
  <action>Start the dev server (probe 4321 then 5173), attempt steps 1-7 yourself with a browser tool if one is available, then walk the user through the numbered steps in how-to-verify. Do not edit code in this task; report any failing step for a follow-up.</action>
  <verify><human-check>Steps 1-7 in how-to-verify observed on the live app</human-check></verify>
  <done>User types "approved" (all 7 steps behave as expected)</done>
  <resume-signal>Type "approved" or describe which rows/covers were wrong (step number + observed vs expected)</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Upstream enrich → track.cover | `heroImg` originates from Deezer/Last.fm responses and is written into a `style:background-image: url(...)` on every Up Next row |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-piz-01 | Tampering | seedAlbumCover cover value | mitigate | https-only gate (same as t2g `httpsOnly`): non-https / empty / null never seeded; the value is already rendered identically on the album hero and rows today, so no new sink |
| T-piz-02 | Information Disclosure | localStorage persistence of queue | accept | Only a public CDN image URL is persisted — already the case for the t2g-attached first track |
| T-piz-SC | Tampering | npm installs | accept | No package installs in this plan |
</threat_model>

<verification>
- `pnpm check` clean, `pnpm test` green (new seed-cover.test.ts + all existing suites).
- Behavioural (checkpoint): all Up Next rows paint album art after album play AND after single-row tap; no new cover-resolution network calls; null-hero album is a harmless pass-through.
- `git diff --stat` limited to the three files in `files_modified`; no `git push`, deploy, or APK build (pushes to main auto-deploy production).
</verification>

<success_criteria>
- Every queued album track carries the album cover in `track.cover` when `heroImg` is https; Up Next rows render it instead of the gradient.
- Zero added network requests; no lazyCover / resolve chain re-introduced.
- Override decision + null-guard + read-time-seeding ordering are recorded in `quick-260910-piz` comments; existing t2g / Gap 3 / album-and-next-song-bug comments intact.
- uid identity unchanged → `setListQueue` re-anchor still works.
</success_criteria>

<output>
Create `.planning/quick/260910-piz-seed-the-album-cover-onto-every-resolved/260910-piz-SUMMARY.md` when done
</output>
