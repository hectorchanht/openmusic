---
phase: quick-260910-piz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/stores/attached-cover.ts
  - src/lib/stores/attached-cover.test.ts
  - src/lib/stores/player.svelte.ts
  - src/lib/stores/player.svelte.test.ts
  - src/routes/(app)/album/[name]/+page.svelte
autonomous: false
requirements: [quick-260910-piz]

must_haves:
  truths:
    - "After tapping the album page's play button (or a single row), EVERY Up Next row paints the album cover — no synthetic gradient on any album track"
    - "Advancing through several album tracks (next / swipe / auto-advance on ended) keeps the album cover on the NowPlaying hero with NO flip to a different image after the resolve lands — even when ensureTrackDetails returns a track carrying the source's own per-track thumbnail"
    - "Starting a DIFFERENT album replaces the attachment: its tracks paint the new album's art, never the previous album's"
    - "A fresh play from another surface (search / artist / home shelf / library / remix) does NOT inherit the album art — the attachment is cleared and the track resolves its own cover as today"
    - "A null / non-https album cover installs no attachment and leaves every queued track's cover untouched (never blanks a cover a track already carries)"
    - "No Track uid changes; setListQueue's album-and-next-song-bug re-anchor (uid, then same-song key) is untouched"
    - "Zero new network requests: no /api/deezer/search, iTunes, or CN cover calls attributable to queue rows or to advancing (attached tracks additionally skip the optional Deezer HQ upgrade, as t2g already specified)"
  artifacts:
    - path: "src/lib/stores/attached-cover.ts"
      provides: "pure AttachedCover type + seedCover(tracks, cover) + buildAttachment(tracks, cover) — https-gated, null-safe, node-testable, no runes"
      exports: ["AttachedCover", "seedCover", "buildAttachment"]
    - path: "src/lib/stores/attached-cover.test.ts"
      provides: "node unit tests: override / null + non-https pass-through / uid preservation / new objects / key set covers every track"
    - path: "src/lib/stores/player.svelte.ts"
      provides: "attachedCover generalised to { url, keys:Set }, installed by setQueue/setListQueue(cover), cleared on install-without-cover, clearQueue, and fresh non-member play; queue entries seeded at install"
      contains: "buildAttachment"
    - path: "src/lib/stores/player.svelte.test.ts"
      provides: "album-scope cases: advance keeps album art vs. differing source cover; different album swaps; fresh search play does not inherit; null cover is a no-op"
      contains: "quick-260910-piz"
    - path: "src/routes/(app)/album/[name]/+page.svelte"
      provides: "both setListQueue(all, 'album') sites + the setQueue([first]) fallback pass heroImg as the third argument"
      contains: "setListQueue(all, 'album', heroImg)"
  key_links:
    - from: "src/routes/(app)/album/[name]/+page.svelte playAlbum / playStub"
      to: "player.setListQueue(all, 'album', heroImg)"
      via: "third argument = the live heroImg at install time"
      pattern: "setListQueue\\(all, 'album', heroImg\\)"
    - from: "player.svelte.ts setQueue / setListQueue"
      to: "seedCover + buildAttachment"
      via: "seed the queue entries (symptom 1) AND install the list-scoped attachment (symptom 2) in the same call"
      pattern: "buildAttachment\\(this\\.queue"
    - from: "player.svelte.ts play() :2909 resolvedCover read + :3083 re-apply before `this.current = resolved`"
      to: "attachedCoverFor(track)"
      via: "keys.has(matchKey(track)) now matches EVERY album track, so the re-apply fires on every advance — this is what stops the hero flip"
      pattern: "keys\\.has\\(matchKey"
    - from: "src/lib/components/NowPlaying.svelte:1504 q-art"
      to: "track.cover"
      via: "resolvedCovers[uid] ?? track.cover — the seeded field paints the tile (Gap 3: no per-tile lazyCover; file NOT modified)"
      pattern: "track\\.cover"
---

<objective>
When a whole album is played from the album page, (1) every Up Next row must show the album cover and (2) the NowPlaying hero must KEEP the album cover across every track advance instead of flipping to the source's per-track thumbnail once the resolve lands.

Both symptoms have ONE root cause (diagnosed by the orchestrator — do not re-derive): `player.attachedCover` (quick-260831-t2g) is a SINGLE `{ key, url }` entry set only in `playStub` for the ONE tapped stub. `attachedCoverFor(track)` is the ONLY thing that lets album art outrank a source's inline art at the two consumption sites (`play()` :2909 `resolvedCover` read, and :3083 `resolved = { ...resolved, cover: attached }` right before `this.current = resolved`). On advance to track 2 the key no longer matches → `attachedCoverFor` is null → the hero briefly paints the correct cover from the queue entry, then `ensureTrackDetails` returns `resolved` carrying the source's thumbnail (qq's http `y.gtimg.cn`), `this.current = resolved` commits it, and the hero flips. Meanwhile the album page's `resolveAll()` hands `setListQueue` a raw array with no cover seeded, so the Up Next tiles (which read `resolvedCovers[uid] ?? track.cover`, Gap 3) paint the gradient.

WHY THE SUPERSEDED PLAN (fa4ec76 / ac4d1fc) WAS INSUFFICIENT: it only seeded `track.cover` via a route-local `seedAlbumCover()` inside `resolveAllCached()`. That fixes the tiles (symptom 1) but NOT the hero flip (symptom 2): the :3083 re-apply fires only when `attachedCoverFor` MATCHES; otherwise `resolved` keeps the source cover and `this.current = resolved` silently overwrites the seed. The seed idea survives here — but it moves INTO the player's queue-install seam so it lands together with the attachment, and the attachment itself is generalised from one song to the whole installed list.

Purpose: t2g's contract — "every song on an album shows the album's art, siblings must never disagree" — must hold for the whole album, across every advance, and must stop applying the moment the user starts something else.
Output: one small pure module + node test, a surgical diff in `player.svelte.ts` (field shape, `attachedCoverFor`, `setQueue`, `setListQueue`, `clearQueue`, `playStub`, one line in `play()`), two call-site arguments in the album page, and four scope/invalidation cases in `player.svelte.test.ts`.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md (house style: tabs, single quotes, high comment density; quick-task-ID comments are load-bearing decision records — tag new work `quick-260910-piz`; NEVER remove t2g / COVER-01 / D-09 / D-13 / hep Site A+B / Gap 3 / album-and-next-song-bug / LSW-03 / i9u / fiz / WR-06 comments)
@src/lib/stores/player.svelte.ts (attachedCover field ~339-350; setQueue ~2173; queueWithAnchor ~2193; setListQueue ~2221; clearQueue ~2311; playStub cover attach ~2818-2833; play() resolvedCover read ~2903-2914; the :3083 re-apply; upgrade skip ~3236; attachedCoverFor ~3334-3340)
@src/lib/stores/player.svelte.test.ts (t2g describe at ~376-480 is the idiom to clone: real play() via mockRestore, mockEnsure/mockResolve, `mk(source, songid, artist, title)`, `flush()`, `makeFakeAudio()`, `(player as unknown as { attachedCover: unknown }).attachedCover = null` reset)
@src/lib/stores/player-persist.ts (precedent: "extract a pure helper module the runes store thinly wraps"; header comment style to mirror)
@src/routes/(app)/album/[name]/+page.svelte (heroImg ~107; playStub row-tap ~249-267; resolveAll ~351; resolveAllCached ~363; playAlbum ~380-400)
@src/lib/components/NowPlaying.svelte:1495-1505 (the Up Next tile consumer — READ ONLY, do not modify)

<interfaces>
<!-- Existing contracts. Use directly — no exploration needed. -->

From src/lib/sources/types.ts:
```ts
export type Track = { uid: string; source: SourceId; songid: string; title: string; artist: string; cover: string | null; audioUrl: string | null; /* … */ };
```

From src/lib/services/match-key.ts (pure, already imported by player.svelte.ts line 35):
```ts
export function matchKey(artist: string, title: string): string;
```

From src/lib/stores/player.svelte.ts (current shapes that CHANGE in Task 2):
```ts
const httpsOnly = (u?: string | null): u is string => typeof u === 'string' && u.startsWith('https:'); // module-private, line 55
private attachedCover: { key: string; url: string } | null = null;                                     // line 350
setQueue(tracks: Track[], context: QueueContext = null)                                                // line 2173
setListQueue(tracks: Track[], context: QueueContext = null)                                            // line 2221 — delegates to setQueue when !current
clearQueue()                                                                                           // line 2311
private attachedCoverFor(track: Track): string | null  // line 3336: matchKey(track.artist, track.title) === a.key ? a.url : null
```
`playStub(artist, title, cover, context)` line ~2826-2832 today:
```ts
if (httpsOnly(cover)) {
	tr = { ...tr, cover };
	this.attachedCover = { key: matchKey(tr.artist, tr.title), url: cover };
}
this.setQueue([tr], context);
void this.play(tr, { fresh: true });
```

External callers of setQueue/setListQueue (all pass <= 2 args today, so a third optional `cover` is backward compatible and every NON-album install clears the attachment for free):
- TrackMenu.svelte:279 `setQueue([seed], 'remix')`; (app)/+page.svelte:507/630/644/697 `setQueue(…, 'home-discovery')`; library/+page.svelte:181/186 `setListQueue(list, ctx)` / `(history.entries, 'history')`; search/+page.svelte:771/810 `setListQueue(results, 'search')` then `play(t, {fresh:true})`; artist/[name]/+page.svelte:198/595 `setQueue([picked, ...rest], 'artist')` / `setListQueue(songs, 'artist')`; album/[name]/+page.svelte:266/395/396.
- Home shelves (liked / downloads / history / playlists) call `play(t, {fresh:true, context})` DIRECTLY with no queue install (quick-260831-sp9) — that is why Task 2 also clears on a fresh non-member play.

Internal: `setQueue`/`setListQueue` are NOT called by regenerate/ensureAhead/recoverFromStop (they assign `this.queue` directly; WR-06 queueGen discards them if an explicit install supersedes), so the attachment survives the same-list grow of an album queue. `this.setQueue(` appears inside the class only at setListQueue's no-current delegate (2230) and playStub (2831).

From src/lib/components/NowPlaying.svelte:1504 (consumer — DO NOT modify):
```svelte
<span class="q-art" style:background-image={(resolvedCovers[track.uid] ?? track.cover) ? `url(…)` : fallbackCover(track)}></span>
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure attached-cover module + node tests</name>
  <files>src/lib/stores/attached-cover.ts, src/lib/stores/attached-cover.test.ts</files>
  <behavior>
    - seedCover([{cover:null},{cover:'https://kuwo/t.jpg'},{cover:'http://y.gtimg.cn/x.jpg'}], 'https://cdn.dzcdn.net/a.jpg') → every element's cover === the album url (OVERRIDE, including the one that already had an https source cover)
    - seedCover(tracks, null) / seedCover(tracks, 'http://…') / seedCover(tracks, '') → returns the SAME array reference (`toBe(input)`), covers untouched (pass-through never blanks a cover)
    - seedCover preserves uid/source/songid/title/artist/audioUrl, length and order; returns NEW element objects (input[0].cover still null after; out[0] !== input[0]); [] → []
    - buildAttachment(tracks, 'https://…') → { url, keys } where keys.size === number of distinct matchKey(artist,title) and keys.has(matchKey(t.artist, t.title)) for every input track (two source variants of one song → one key)
    - buildAttachment(tracks, null | 'http://…' | '') → null; buildAttachment([], 'https://…') → { url, keys: empty Set } (harmless: matches nothing)
  </behavior>
  <action>
    Create `src/lib/stores/attached-cover.ts` — PURE (no runes, no `$app/environment`, never throws), sibling to `player-persist.ts` and following its header style. Imports: `import type { Track } from '$lib/sources/types'` and `import { matchKey } from '$lib/services/match-key'`. Replicate the one-line `httpsOnly` guard locally (do NOT export it from the ~3000-line store).

    Exports (exactly three):
    - `export type AttachedCover = { url: string; keys: Set<string> }` — one url for the whole list, song-keyed membership (`matchKey(artist, title)`, NOT uid — keeps t2g's cross-source-fallback survival).
    - `export function seedCover(tracks: Track[], cover: string | null | undefined): Track[]` — if `!httpsOnly(cover)` return `tracks` unchanged (same reference); else `tracks.map((t) => ({ ...t, cover }))`.
    - `export function buildAttachment(tracks: Track[], cover: string | null | undefined): AttachedCover | null` — if `!httpsOnly(cover)` return null; else `{ url: cover, keys: new Set(tracks.map((t) => matchKey(t.artist, t.title))) }`.

    Header comment (load-bearing decision record, tag `quick-260910-piz`) must state, in order:
    1. WHAT: the album-scoped generalisation of quick-260831-t2g's single-song `attachedCover`. The player store thinly wraps these two helpers at its queue-install seams.
    2. WHY TWO helpers, both needed: `seedCover` writes `track.cover` so the Up Next TILES paint (Gap 3 / 26-10 removed per-tile lazyCover — tiles read `resolvedCovers[uid] ?? track.cover` only). `buildAttachment` is what makes the album art OUTRANK the source's own inline cover at play() (the :2909 resolvedCover read and the pre-`current = resolved` re-apply). Seeding alone was tried first and is NOT enough: `ensureTrackDetails` returns a track carrying the source thumbnail and `this.current = resolved` overwrites the seed unless the attachment matches.
    3. DECISION — OVERRIDE, not fill-in-when-null (t2g's stated contract: siblings must never disagree; the album cover is the merged best-quality art, CN inline covers are per-track thumbnails, often http y.gtimg.cn). Accepted trade-off: a rare per-track image that is legitimately better than the album art is replaced.
    4. NULL / NON-HTTPS GUARD: `heroImg` is null until the async Deezer/Last.fm enrich lands and may be non-https from Last.fm — then seedCover is a pass-through and buildAttachment returns null. Never blanks an existing cover.
    5. IDENTITY: uid untouched, so setListQueue's uid / same-song re-anchor (album-and-next-song-bug) is unaffected. Zero network — pure data.

    Write `attached-cover.test.ts` FIRST (vitest; `import { describe, it, expect } from 'vitest'`; build Track literals with a tiny local `mk(source, songid, artist, title, cover)` helper — cast `as Track` for untested fields, tests-only casts are tolerated). Run → RED → implement → GREEN.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run src/lib/stores/attached-cover.test.ts</automated>
  </verify>
  <done>attached-cover.test.ts green covering all five behaviors; the module exports exactly `AttachedCover`, `seedCover`, `buildAttachment`; imports limited to `type Track` and `matchKey`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Scope the attachment to the installed list in player.svelte.ts, wire the album page, add scope/invalidation tests</name>
  <files>src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts, src/routes/(app)/album/[name]/+page.svelte</files>
  <behavior>
    New describe in player.svelte.test.ts — `'album-scoped attached cover — every track, every advance (quick-260910-piz)'` — cloning the t2g describe's beforeEach (restore real play(), reset mockEnsure/mockCoverResolve/mockDeezerHQ/mockUidCover, null current/queue/resolvedCover/attachedCover, attach makeFakeAudio()). Album A = 'https://img/albumA.jpg', tracks mk('kuwo','A1','Coldplay','Yellow'), mk('kuwo','A2','Coldplay','Trouble'), mk('kuwo','A3','Coldplay','Spies') with cover:null.
    - SYMPTOM 1: after `playStub('Coldplay','Yellow', A, 'album')` (mockResolve → A1) + flush + `setListQueue([A1,A2,A3], 'album', A)`: `player.queue.every((t) => t.cover === A)`; queue uids deep-equal the input uids in order (identity untouched, current re-anchored into slot 0)
    - SYMPTOM 2: same setup; `mockEnsure.mockImplementation(async (t) => ({ ...t, cover: 'http://y.gtimg.cn/thumb.jpg', audioUrl: 'https://cdn/' + t.songid + '.mp3' }))`; `player.next()`; flush → `player.current?.uid` is A2's uid AND `player.current?.cover === A` AND `player.resolvedCover === A` AND `player.queue[1].cover === A`; repeat `next()` once more → A3 also === A; `mockCoverResolve` and `mockDeezerHQ` never called
    - DIFFERENT ALBUM SWAPS: after the above, `setListQueue([B1,B2], 'album', B)` (B = 'https://img/albumB.jpg', mk('kuwo','B1','Radiohead','Creep'), mk('kuwo','B2','Radiohead','Karma Police')); `player.play(B1, {fresh:true})`; flush; `next()`; flush → `resolvedCover === B` and `current.cover === B`, never A
    - FRESH PLAY FROM SEARCH DOES NOT INHERIT: album A installed + playing; `setListQueue([S1], 'search')` (no cover; S1 = mk('kuwo','S1','Coldplay','Yellow') — SAME song key as A1 on purpose, cover 'https://kuwo/s1.jpg'); `play(S1, {fresh:true})` with mockEnsure returning `{ ...t, cover: 'https://kuwo/s1.jpg' }`; flush → `current.cover === 'https://kuwo/s1.jpg'` and `resolvedCover === 'https://kuwo/s1.jpg'` (NOT A); `(player as unknown as { attachedCover: unknown }).attachedCover` is null
    - FRESH PLAY WITH NO QUEUE INSTALL (home shelf path) CLEARS: album A installed; `play(mk('kuwo','L1','Oasis','Wonderwall'), {fresh:true, context:'liked'})` directly; flush → attachedCover null and `resolvedCover` is not A
    - NULL COVER IS A NO-OP: `setListQueue([A1,A2], 'album', null)` → covers unchanged (null stays null), attachedCover null; `clearQueue()` after an install → attachedCover null
  </behavior>
  <action>
    Write the new describe FIRST (RED), then make the store changes below (GREEN), then `pnpm check`.

    **player.svelte.ts — surgical, no `$effect`, no new `$state` (the field stays a PLAIN class field per house convention):**

    1. Imports: add `import { seedCover, buildAttachment, type AttachedCover } from '$lib/stores/attached-cover';` next to the `player-persist` import (line ~52). `matchKey` stays imported (still used by `attachedCoverFor`).

    2. Field (line 350): change the type to `private attachedCover: AttachedCover | null = null;`. KEEP the entire t2g doc comment verbatim and APPEND a `quick-260910-piz` paragraph: was a single `{ key, url }` written only by playStub for the one tapped song, so the very next advance had no match and the hero flipped to the source thumbnail (`this.current = resolved`) while Up Next tiles stayed on the gradient. Now LIST-SCOPED: `{ url, keys }` for every song of the installed list. LIFECYCLE, stated exactly — INSTALLED by `setQueue`/`setListQueue` when the caller passes an https `cover` (the album page passes `heroImg`; playStub passes its `cover` for the optimistic one-track queue). CLEARED by (a) any `setQueue`/`setListQueue` WITHOUT a cover — every other surface (search / artist / library / home-discovery / remix) installs a list, so starting anything else drops it; (b) `clearQueue()`; (c) a fresh `play()` of a track whose song key is NOT in the set — the home shelves call `play({fresh})` with no queue install (quick-260831-sp9), so that seam is needed too. NOT persisted (same as t2g) — after a reload the seeded `track.cover` still paints tiles but the hero re-apply is gone until the next install; accepted residual, upgrade path = one `attachedCover` envelope field in player-persist.ts.

    3. `attachedCoverFor(track)` (line ~3336): body becomes `return a.keys.has(matchKey(track.artist, track.title)) ? a.url : null;`. Keep its doc comment; add `quick-260910-piz: set membership, not a single key`.

    4. `setQueue(tracks, context = null, cover: string | null = null)`: after the two `??=` captures and the `queueGen++`, change `this.queue = dedupeBest(tracks, settings.preferredSource)` to dedupe `seedCover(tracks, cover)`, then add `this.attachedCover = buildAttachment(this.queue, cover);` immediately after. Comment (`quick-260910-piz`): seeding here (not in the album page) is the single chokepoint every list surface goes through, and the attachment is installed in the same call so tiles and hero can never disagree; a missing/non-https cover means "this list has no album art" → attachment cleared, covers untouched. Update the method doc comment's parameter sentence to mention `cover`.

    5. `setListQueue(tracks, context = null, cover: string | null = null)`: pass `cover` through the no-current delegate `this.setQueue(tracks, context, cover)`; change `this.queue = this.queueWithAnchor(tracks, current)` to `this.queueWithAnchor(seedCover(tracks, cover), current)`; add `this.attachedCover = buildAttachment(this.queue, cover);` right after. Comment (`quick-260910-piz`): keys come from the ANCHORED queue so the current track (possibly a different-source variant) is a member by song key; the anchored `current` object itself is NOT re-covered here (it already carries playStub's attached cover, and `resolvedCover` was set at play time — retro-patching the live hero is out of scope). Do not touch the album-and-next-song-bug doc block or `queueWithAnchor`.

    6. `clearQueue()`: add `this.attachedCover = null; // quick-260910-piz: the list is gone, nothing left to scope the album art to` beside the LSW-03 anchor reset.

    7. `playStub` (~2826-2832): keep `if (httpsOnly(cover)) tr = { ...tr, cover };` (the played object must carry it) but DELETE the `this.attachedCover = { key: …, url: cover }` line — setQueue now owns installation — and change the install to `this.setQueue([tr], context, cover);`. Keep the whole t2g comment; append one line: `quick-260910-piz: the attachment is installed by setQueue (list-scoped) — setListQueue(all, 'album', heroImg) then widens it to the whole album`.

    8. `play()`: immediately BEFORE the COVER-01 / D-09 `this.resolvedCover =` block (~2903), add:
       `if (opts?.fresh && !this.attachedCoverFor(track)) this.attachedCover = null;`
       with a `quick-260910-piz` comment: a fresh user play of a song outside the attached list is a context switch (home shelves install no queue — quick-260831-sp9 — so setQueue's clear never runs for them); a fresh play OF a member (playStub → play) keeps it. Auto-advance / next() / fallback are non-fresh and never clear.

    9. :3083 re-apply block: code UNCHANGED. Append one sentence to the t2g comment: `quick-260910-piz: attachedCoverFor now matches every song of the installed list, so this re-apply fires on every album advance — the fix for the hero flipping to the source thumbnail on track 2+.`

    Leave the :2909 read order, hep Site A/B writes, the ~3236 upgrade skip, `queueWithAnchor`, `regenerate`, `ensureAhead`, `restore`, `persist` untouched.

    **album/[name]/+page.svelte:** pass `heroImg` as the third argument at the two `player.setListQueue(all, 'album')` sites (~266 row-tap, ~395 playAlbum) and the `player.setQueue([first], 'album')` fallback (~396) → `setListQueue(all, 'album', heroImg)` / `setQueue([first], 'album', heroImg)`. One shared `quick-260910-piz` comment above playAlbum's call: the player seeds every queued entry AND scopes the album-art attachment to the whole list at install; `heroImg` is read at install time (after the ~10s resolveAll) so an enrich that landed meanwhile is applied — if it is still null at that instant the queue carries no album art (accepted; no retro-patch). Keep `resolveAll`/`resolveAllCached` exactly as they are (no seeding there — it lives in the store now). Do NOT touch the `album-and-next-song-bug` comments, the t2g comment in the page's `playStub`, swipe/menu/download paths.

    Preserve every existing decision comment. `pnpm check` must be clean (the widened signatures are optional params — no caller changes beyond the album page).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm check && pnpm test</automated>
  </verify>
  <done>`pnpm check` 0 errors; full `pnpm test` green including the new describe (6 cases) and the untouched t2g describe; `grep -n "attachedCover = " src/lib/stores/player.svelte.ts` shows ONLY the two `buildAttachment(this.queue, cover)` assignments plus the null clears in clearQueue and play() (none left in playStub); `grep -c "setListQueue(all, 'album', heroImg)" "src/routes/(app)/album/[name]/+page.svelte"` is 2; `git diff --stat` touches only the five files in files_modified.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Behavioural verification — both symptoms, zero new cover fetches</name>
  <what-built>The album-art attachment is now scoped to the whole installed album list and re-applied on every advance, and every queued entry is seeded with the album cover at install. The executor must first attempt the checks itself if a browser tool is available: start `pnpm dev` (probe port 4321 via launch.json, else 5173 — do not assume), pick an album whose tracks resolve via kuwo (kuwo + Deezer are reachable in the sandbox; netease/qq are not).</what-built>
  <how-to-verify>
    1. Open the dev server → an artist page → an album showing a real hero cover (Deezer-enriched, not a gradient).
    2. DevTools → Network, filter `deezer` and `itunes`; note the request count.
    3. Tap the big play button; wait for the queue to build (~10s for a long album).
    4. SYMPTOM 1: expand Now Playing → Up Next. EXPECTED: every row's thumbnail is the album cover; no diagonal gradient on any album track.
    5. SYMPTOM 2: swipe / tap next through at least 3 tracks, waiting for each to actually start (progress bar moving). EXPECTED: the hero shows the album cover from the moment it paints and NEVER flips to a different image after the track starts. Nowbar art matches the hero. Let one track run to its end (or seek near the end) so an auto-advance also occurs — same expectation.
    6. NETWORK: EXPECTED zero NEW `deezer` / `itunes` requests since step 2 attributable to queue rows or advances (the only cover traffic is the album enrich that ran on page open).
    7. INVALIDATION A: go back, open a DIFFERENT album with a hero cover, tap play, advance once. EXPECTED: hero + Up Next show the NEW album's art, never the first album's.
    8. INVALIDATION B: go to Search, search a song that is on the first album, tap it. EXPECTED: it plays with its own cover (search result / source art), NOT the first album's cover; Up Next is the search list, rows carry their own covers.
    9. Row-tap path: back on the first album, tap a SINGLE row (not the play button). EXPECTED: same as steps 4-5 — the re-anchored album queue has album art on every row and across advances.
    10. Regression: open an album whose hero is still a gradient (no Deezer match) and play it. EXPECTED: no crash; rows keep whatever source thumbnail they have, the rest stay gradient (null heroImg is a pass-through).
  </how-to-verify>
  <files>none — verification only</files>
  <action>Start the dev server (probe 4321 then 5173), attempt steps 1-10 with a browser tool if available, then walk the user through the numbered steps. Do not edit code in this task; report any failing step (number + observed vs expected) for a follow-up. No `git push`, deploy, or APK build — pushes to main auto-deploy production.</action>
  <verify><human-check>Steps 1-10 observed on the live app</human-check></verify>
  <done>User types "approved" (all 10 steps behave as expected)</done>
  <resume-signal>Type "approved" or describe which step failed (step number + observed vs expected)</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Upstream enrich → track.cover / attachedCover.url | `heroImg` originates from Deezer/Last.fm responses and is written into `style:background-image: url(...)` on every Up Next row and the hero |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-piz-01 | Tampering | seedCover / buildAttachment cover value | mitigate | https-only gate (same as t2g `httpsOnly`): non-https / empty / null never seeded or attached; the value already renders identically on the album hero today — no new sink |
| T-piz-02 | Information Disclosure | localStorage persistence of queue | accept | Only a public CDN image URL is persisted per queue entry — already the case for the t2g-attached first track |
| T-piz-03 | Denial of Service | player.svelte.ts hot path (freeze history) | mitigate | No `$effect`, no new `$state`, no new fetches; attachment is a plain field written only at install seams; `keys.has` is O(1) per play |
| T-piz-SC | Tampering | npm installs | accept | No package installs in this plan |
</threat_model>

<verification>
- `pnpm check` clean, `pnpm test` green (attached-cover.test.ts, the new player describe, all existing suites incl. the t2g describe).
- Behavioural (checkpoint): (a) every Up Next row paints album art after album play AND row-tap; (b) advancing 3+ tracks incl. one auto-advance keeps the album art on the hero with no flip; (c) zero new cover-resolution network requests; (d) a different album swaps the art; (e) a search play does not inherit it; (f) null-hero album is a harmless pass-through.
- `git diff --stat` limited to the five files in `files_modified`; no `git push`, deploy, or APK build.
</verification>

<success_criteria>
- `attachedCover` is `{ url, keys }` scoped to the installed list; `attachedCoverFor` matches every album track so both consumption sites (:2909, :3083) apply the album art on every advance.
- Installed by `setQueue`/`setListQueue(…, cover)`; cleared on install-without-cover, `clearQueue`, and fresh non-member `play` — all stated in the field comment.
- Every queued album entry carries the album cover in `track.cover` when `heroImg` is https; Up Next rows render it.
- Zero added network requests; no lazyCover / resolve chain re-introduced; no `$effect` / new `$state`.
- Override decision, null guard, lifecycle, and the "seeding alone was insufficient" record live in `quick-260910-piz` comments; every pre-existing decision comment intact.
- uid identity unchanged → `setListQueue` re-anchor still works.
</success_criteria>

<output>
Create `.planning/quick/260910-piz-seed-the-album-cover-onto-every-resolved/260910-piz-SUMMARY.md` when done
</output>
