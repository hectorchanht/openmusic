---
phase: quick-260625-pzs
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
  - src/lib/stores/player.svelte.ts
  - src/lib/components/TrackMenu.svelte
  - src/lib/util/artist-split.ts
  - src/lib/util/artist-split.test.ts
autonomous: true
requirements: [PZS-1, PZS-2, PZS-3, PZS-4, PZS-5]

must_haves:
  truths:
    - "Switching the browser tab away and back does NOT re-fetch lyric translations for the same track — the cached, complete translation re-renders instantly with no flicker and no /api/translate call"
    - "A track that has begun producing audio (a real playing/timeupdate fired) is never auto-advanced by a transient audio error — playback recovers in place instead of skipping after ~3s"
    - "The Related list supports swipe-right to add a song to the queue and swipe-left to play it next, identical to the search/library lists"
    - "Downloading a song does not interrupt current playback, does not re-trigger or wipe lyrics, and does not mutate player state"
    - "The now-playing artist string is split on connectors into individual artist names, each rendered as its own link to that single artist"
  artifacts:
    - path: "src/lib/util/artist-split.ts"
      provides: "Pure splitArtists(raw) helper splitting on , & 、 / feat. ft. x × &amp;"
      exports: ["splitArtists"]
    - path: "src/lib/util/artist-split.test.ts"
      provides: "Node-vitest coverage of the connector matrix"
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "Lyric-translation persistence cache, swipe-to-queue Related rows, per-artist links"
    - path: "src/lib/stores/player.svelte.ts"
      provides: "error-handler guard: no cross-source skip once the track has played"
    - path: "src/lib/components/TrackMenu.svelte"
      provides: "Download isolated from the active track / playback / lyrics"
  key_links:
    - from: "src/lib/components/NowPlaying.svelte translate $effect"
      to: "in-component completed-translation cache"
      via: "synchronous hydrate-before-fetch keyed by trKey"
      pattern: "trCache"
    - from: "src/lib/stores/player.svelte.ts error listener"
      to: "hasPlayedSinceSrc guard"
      via: "early return / no runFallback once audio has played"
      pattern: "hasPlayedSinceSrc"
    - from: "src/lib/components/NowPlaying.svelte related rows"
      to: "swipeAction"
      via: "use:swipeAction onSwipeRight/onSwipeLeft"
      pattern: "use:swipeAction"
    - from: "src/lib/components/NowPlaying.svelte artist row"
      to: "splitArtists"
      via: "per-name <a>/<button> goto(/artist/<name>)"
      pattern: "splitArtists"
---

<objective>
A deliberate batch of 5 loosely-coupled MusicSquare-Mobile player improvements, each an atomic,
independently-committable task. The app is the live SvelteKit tree under `src/` (Svelte 5 runes;
`.svelte.ts` rune stores) — NOT the stale `index.html` described in CLAUDE.md.

Purpose: Fix four playback/UX papercuts (lyric re-translation on tab focus, premature auto-skip,
download bleeding into playback, missing swipe-to-queue on Related) and one feature (per-artist
links in now-playing).
Output: 5 commits across NowPlaying.svelte, player.svelte.ts, TrackMenu.svelte, and a new pure
artist-split util + test.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md

Task ordering (independent / low-risk first):
  Task 1 — Split artist field (pure helper + isolated UI; zero playback risk)
  Task 2 — Swipe-to-queue on Related (reuses an existing action; UI-only)
  Task 3 — Cache translated lyrics (NowPlaying-local cache; no store changes)
  Task 4 — Download isolation (TrackMenu-local; touches only the download handler)
  Task 5 — No premature skip (player store error-handler guard; highest blast radius — last)

Each task = ONE commit. Suggested messages:
  feat(quick-260625-pzs-01): split now-playing artist into per-artist links
  feat(quick-260625-pzs-02): swipe-to-queue on the Related list
  fix(quick-260625-pzs-03): cache complete lyric translations so tab refocus doesn't refetch
  fix(quick-260625-pzs-04): isolate download from active playback + lyrics
  fix(quick-260625-pzs-05): don't auto-skip a track that has already started playing

Dev server: `npm run dev` (Vite, strictPort 4321 → http://localhost:4321). Tests: `npm test`
(vitest node project, see vite.config.ts — `*.svelte.test.ts` and pure helpers both run here).
Typecheck: `npm run check`.
</execution_context>

<context>
@.planning/STATE.md

<interfaces>
<!-- Verified from the live source tree. Use these directly — no re-exploration needed. -->

src/lib/actions/swipeAction.ts — the shared swipe-sideways action the OTHER lists already use:
```typescript
export interface SwipeActionOpts {
  onSwipeRight?: () => void;  // dx > 0 → queue (D-03)
  onSwipeLeft?: () => void;   // dx < 0 → play next (D-04)
  threshold?: number;         // default 96px
  enabled?: boolean;          // default true
}
export const swipeAction: Action<HTMLElement, SwipeActionOpts>;
```
It is PURE DOM (no haptics) — the host fires `hapticTick()` inside the callbacks. Already
tap-preserving + vertical-yielding + click-suppressing. Attach to the row `<button>`.

The CANONICAL swipe-to-queue usage (src/routes/(app)/search/+page.svelte:41-50, 559-583):
```
function swipeQueue(track: Track) { player.addToQueue(track); toast.show(t('toast.addedToQueue')); hapticTick(); }
function swipeNext(track: Track)  { player.playNext(track);   toast.show(t('toast.playingNext'));  hapticTick(); }
...
<li class="swipe-wrap">
  <span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
  <span class="reveal reveal-next"  aria-hidden="true"><ListStart size={20} /></span>
  <button class="row" ... use:swipeAction={{ onSwipeRight: () => swipeQueue(t), onSwipeLeft: () => swipeNext(t) }}>...</button>
</li>
```
search/+page.svelte:669-677 reveal CSS to mirror:
```
.swipe-wrap { position: relative; overflow: hidden; border-radius: 10px; }
.reveal { /* absolute, full-height, centred icon, behind the row */ }
.reveal-queue { left: 0; background: var(--color-primary); }
.reveal-next  { right: 0; background: var(--src-netease); }
```
`ListEnd`, `ListStart` import from `@lucide/svelte`. `hapticTick` is `import { tick as hapticTick } from '$lib/util/haptics'` — already imported in NowPlaying.svelte:25. `player.addToQueue`,
`player.playNext`, `toast.show`, `t` are all already in scope in NowPlaying.svelte.

src/lib/services/translate.ts — the translate client (ALREADY caches a COMPLETE batch in a
module `mem` Map + localStorage; gates persistence on the per-line `complete` flag so a soft-fail
echo is never cached; retries incomplete/transient results):
```typescript
export async function translateLines(lines: string[], to: string): Promise<string[]>; // out.length === lines.length
export interface TranslateResult { out: string[]; flags: boolean[]; complete: boolean; }
export async function translateLinesEx(lines: string[], to: string): Promise<TranslateResult>;
```
NowPlaying.svelte:244-309 — the translate `$effect`. The refetch-on-refocus bug is HERE, not in
the service: on every effect re-run for a key change it sets `translated = []` (line 281) and calls
`translateLines` again; a component remount / re-subscribe resets the plain `trKey = ''` so the
SAME track's translation is re-issued and the lyrics flash untranslated for the round-trip. The
render gate is `const showTr = $derived(settings.lyricsLang !== 'off' && translated.length === lines.length)` (line 310). Rows render `{translated[i]}` (lines 1229-1233).

NowPlaying.svelte:1095-1098 — the artist row to split (inside a `{#key player.current?.uid}`):
```
<button class="artist" use:marquee onclick={openArtist} in:fade out:fade>
  <span class="marquee-inner">{player.current ? names.dnArtist(player.current.artist) : ''}</span>
</button>
```
`openArtist()` (NowPlaying.svelte:455-460): `player.collapse(); goto('/artist/' + encodeURIComponent(player.current.artist))`. `goto` from `$app/navigation`, `names.dnArtist`,
`player.collapse` all in scope. The `/artist/[name]` route exists and decodes the param.

src/lib/components/TrackMenu.svelte:98-154 — `doDownload(resolved)`. It (a) calls
`ensureTrackDetails({...resolved, detailsLoaded:false, audioUrl:null, lrc:null}, undefined, settings.downloadQuality)` to force a fresh DOWNLOAD-quality resolve, (b) `library.addDownload(r)`,
(c) `fetch(r.audioUrl)` → blob → save. It operates on a COPY already, but the forced re-resolve +
the blob fetch saturate the shared CDN — player.svelte.ts:474-475 explicitly blames "the download
fetch saturating the shared CDN" for a lyrics-wipe on the active track. `gated('download', doDownload)` (line 284) resolves the stub if needed before calling doDownload. `player` is imported in TrackMenu.svelte.

src/lib/stores/player.svelte.ts:1118-1168 — the audio `error` listener. After the seek-window
re-resolve branch, it unconditionally `void this.runFallback(failed)` (cross-source swap → re-play
from 0 / advance). It does NOT check `this.hasPlayedSinceSrc` (the flag set true on the first
`playing`/`timeupdate`, lines 984 & 1054). That is the premature-skip path: a transient byte-fetch
error on an already-playing track fails over and restarts/skips after ~3s. Contrast the stall
WATCHDOG (armStall, lines 777-798) which DOES gate on `hasPlayedSinceSrc` (line 783) — the error
handler is missing the equivalent guard. `reresolveCurrent()` (lines 465-514) re-resolves the SAME
track, preserves the seek via `pendingSeek`, and is explicitly NOT an initial-load arm (D-14) — the
correct recover-in-place primitive.
</interfaces>

PRIOR LEARNINGS (must respect):
- `/api/translate` returns HTTP-200 echoing the originals on upstream flake (`complete:false`). The
  translate service already refuses to cache those. The in-component cache in Task 3 must store
  ONLY a complete render — never an echo. Use `translateLinesEx` (already exported) and cache the
  stitched output ONLY when its `complete === true` AND `stitched.length === lines.length` (the same
  gate the render uses). Combined with the service-level complete-gating, an incomplete result is
  never frozen.
- Do NOT gate any now-playing UI swap on the audio `playing` event (a reverted mobile-playback
  regression). Task 5 is about SUPPRESSING an erroneous auto-advance, not about UI gating — reading
  the EXISTING internal `hasPlayedSinceSrc` flag inside the error handler is the sanctioned approach
  (the watchdog already reads it; this only mirrors that read). Do NOT add any new `playing`-event
  dependency to component render paths.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Split now-playing artist into per-artist links</name>
  <files>src/lib/util/artist-split.ts, src/lib/util/artist-split.test.ts, src/lib/components/NowPlaying.svelte</files>
  <behavior>
    splitArtists(raw: string): string[]
    - "周杰倫, 費玉清"      -> ["周杰倫", "費玉清"]
    - "A & B"               -> ["A", "B"]
    - "甲、乙、丙"          -> ["甲", "乙", "丙"]
    - "A / B"               -> ["A", "B"]
    - "A feat. B"           -> ["A", "B"]   (also "ft.", "Feat.", "FT.")
    - "A x B" / "A × B"     -> ["A", "B"]   (collab x — standalone token only, not inside a name)
    - "A &amp; B"           -> ["A", "B"]   (HTML entity)
    - "  A  ,  B  "         -> ["A", "B"]   (each trimmed)
    - "Solo Artist"         -> ["Solo Artist"] (single name, no connector)
    - "Maxwell"             -> ["Maxwell"]  (embedded x NOT split)
    - ""                    -> []
    - dedupe exact repeats + drop empties after split
  </behavior>
  <action>
    Create `src/lib/util/artist-split.ts` exporting a PURE `splitArtists(raw: string): string[]`
    (no runes, no $app/*, no DOM — node-vitest-testable, mirroring src/lib/services/match-key.ts).
    Implementation: first replace the literal `&amp;` entity with `&`, then split the string on a
    single regex alternation of connectors — comma, ampersand `&`, Chinese enumeration comma `、`,
    slash `/`, the words `feat.`/`feat`/`ft.`/`ft` (case-insensitive, word-boundaried so they do not
    match inside a name), and the standalone collab tokens `x`/`×` (require surrounding whitespace so
    "Maxwell" / "Sixx" are NOT split). Trim each part, drop empties, and dedupe exact duplicates while
    preserving order. Return [] for empty/whitespace input.

    Write `src/lib/util/artist-split.test.ts` covering every row in the behavior block plus the
    negative cases ("Maxwell" stays one). Document the chosen `/` behavior in the test: a slash DOES
    split per the spec, so "AC/DC" -> ["AC","DC"] is acceptable and intentional (`/` is an explicit
    connector).

    In NowPlaying.svelte: import `splitArtists` from `$lib/util/artist-split`. Add a `$derived`
    `artistNames = splitArtists(player.current?.artist ?? '')`. Replace the single artist
    `<button class="artist" onclick={openArtist}>` (lines 1095-1098, inside the `{#key uid}` block)
    with the SAME `.artist`-styled container rendering one tappable element PER name. Each name element
    navigates to that single artist: `player.collapse(); goto('/artist/' + encodeURIComponent(name))`
    — reuse the openArtist navigation pattern parameterized by the per-name string (generalize
    `openArtist()` into `openArtistName(name)` or similar; do not leave a dead unused `openArtist`).
    Render display text through `names.dnArtist(name)` per name. Keep `use:marquee` on the row
    container and the in:/out:fade crossfade. Separate names with a small INERT separator span (e.g.
    `, ` or `·`) that is not a link. When `artistNames.length <= 1`, render exactly the single-link
    behavior (no separator) so the common case is unchanged.

    Do NOT change Nowbar.svelte (the collapsed bar keeps the single combined artist string — out of
    scope). Keep the existing `.artist` CSS class so styling/marquee is unchanged.
  </action>
  <verify>
    <automated>npm test -- artist-split && npm run check</automated>
  </verify>
  <done>splitArtists passes its test matrix; `npm run check` is clean; in the running app the
  now-playing screen shows a multi-artist song (e.g. any "A &amp; B" / "甲、乙" track) as separate
  tappable artist links, each opening that sole artist's page; a single-artist song renders exactly
  one link with no separator.</done>
</task>

<task type="auto">
  <name>Task 2: Swipe-to-queue on the Related list</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
    Apply the EXISTING shared `swipeAction` (do NOT write new gesture logic) to the Related-tab rows
    so they support swipe-right = add to queue and swipe-left = play next, exactly like the search /
    library / artist lists.

    In NowPlaying.svelte: import `swipeAction` from `$lib/actions/swipeAction` and add `ListEnd`,
    `ListStart` to the existing `@lucide/svelte` import (line 6). `hapticTick`, `toast`, `t`,
    `player.addToQueue`, `player.playNext` are already in scope. Add two small handlers mirroring
    search/+page.svelte:41-50 — `relatedSwipeQueue(track)` -> `player.addToQueue(track); toast.show(t('toast.addedToQueue')); hapticTick()` and `relatedSwipeNext(track)` ->
    `player.playNext(track); toast.show(t('toast.playingNext')); hapticTick()`.

    In the related markup (lines 1241-1246), wrap each related row `<li>` with `class="swipe-wrap"`,
    add the two reveal spans BEHIND the row (`<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>` and `<span class="reveal reveal-next" aria-hidden="true"><ListStart size={20} /></span>`), and add
    `use:swipeAction={{ onSwipeRight: () => relatedSwipeQueue(track), onSwipeLeft: () => relatedSwipeNext(track) }}`
    to the existing related row `<button class="row">`. Preserve the existing `use:longpress` /
    `onlongpress` (open menu) and `onclick` (play fresh) on that button — swipeAction is tap-preserving
    and vertical-yielding so tap-to-play and long-press menu keep working.

    Add reveal CSS to NowPlaying's `<style>` (mirror search/+page.svelte:669-677):
    `.swipe-wrap { position: relative; overflow: hidden; border-radius: 10px; }`, a `.reveal` rule
    (absolute, full height, flex-centred icon, sits behind the row — match search's z-order/colors),
    `.reveal-queue { left:0; background: var(--color-primary); }`,
    `.reveal-next { right:0; background: var(--src-netease); }`. Reuse existing design tokens. Apply
    this to the RELATED list ONLY — leave the Up-Next/queue list (which uses `use:swipeRemove`)
    untouched.
  </action>
  <verify>
    <automated>npm run check</automated>
  </verify>
  <done>`npm run check` clean; in the running app, on the now-playing Related tab a row follows the
  finger horizontally, swipe-right adds the song to the queue (toast "added to queue" + haptic) and
  swipe-left plays it next (toast "playing next"), the row springs back, and a plain tap still plays
  the song / long-press still opens the menu.</done>
</task>

<task type="auto">
  <name>Task 3: Cache complete lyric translations so tab refocus doesn't refetch</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
    Stop the lyric-translation `$effect` (lines 244-309) from re-issuing `/api/translate` for a track
    whose translation is already complete when the tab is blurred and refocused (or the component
    re-subscribes / re-renders). Cache the COMPLETE stitched output per `trKey` and hydrate it
    synchronously before any network call.

    Add a module-scoped (file-top, OUTSIDE the component instance so it survives a remount)
    `const trCache = new Map<string, string[]>();` keyed by the SAME `key` string the effect already
    computes (`${t.uid}:${lang}:${n}:${skip...}`). In the effect:
      1. After computing `key` and the existing `if (trKey === key) return;` guard, check `trCache`
         FIRST: `const cached = trCache.get(key); if (cached) { trKey = key; translated = cached; translating = false; return; }`
         — serves the cached COMPLETE translation with no flicker and no fetch on refocus/remount.
      2. Keep the existing `translated = []` reset for the genuine first-fetch path only (no cache hit),
         so a real track change still clears stale output.
      3. Switch the single `translateLines(sendText, lang)` call to `translateLinesEx(sendText, lang)`
         (update the import on line 16) and read `.out`. In the success branch compute the stitched
         array once; write it to `trCache` ONLY when the result `complete === true` AND
         `stitched.length === lines.length`. This guarantees a soft-fail echo (which `translateLinesEx`
         returns with `complete:false`) is never frozen as final.
      4. The synchronous all-whitelisted path (lines 300-304, `stitch([])`) MAY also populate `trCache`
         — it is trivially complete (every line is its own original / already target).

    Keep the `trKey === key` race guards on every async assignment. Do NOT touch the translate service
    itself — its mem/localStorage + complete-gating + transient-retry logic is already correct and must
    stay as-is.
  </action>
  <verify>
    <automated>npm test -- translate && npm run check</automated>
  </verify>
  <done>`npm run check` clean and the translate service tests still pass. In the running app with a
  CJK track and lyric translation enabled: open lyrics, let translation complete, switch to another
  browser tab and back (or background/foreground the page) — the translated lyrics remain rendered with
  NO untranslated flash and NO new POST to `/api/translate` (DevTools Network: zero new /api/translate
  on refocus for the same track). A genuine track change still fetches; a soft-fail (echoed originals)
  is never frozen (switching language and back still re-attempts).</done>
</task>

<task type="auto">
  <name>Task 4: Isolate download from active playback + lyrics</name>
  <files>src/lib/components/TrackMenu.svelte</files>
  <action>
    Make `doDownload` (TrackMenu.svelte:98-154) a pure side-effect that NEVER disturbs the currently-
    playing track, its lyrics, or player state.

    Audit + harden:
      1. `doDownload` already operates on a COPY (`{ ...resolved, detailsLoaded:false, ... }`) for the
         re-resolve and never assigns to `player.current` — keep that. Verify (and keep) that nothing
         in the function writes to the `player` store. `library.addDownload(r)` mutates the LIBRARY
         downloads list, which is the correct, intended effect of a download — NOT player state — and
         must stay.
      2. The real interference is the forced DOWNLOAD-quality re-resolve + the `fetch(r.audioUrl)` blob
         pull competing on the shared CDN with active playback (player.svelte.ts:474-475 cites this as
         the cause of a lyrics wipe on the active track via a stale-URL audio error). Mitigate WITHOUT
         changing playback: when the track being downloaded IS the currently-playing track
         (`player.current?.uid === resolved.uid`) AND `player.current.audioUrl` is already resolved at
         an acceptable quality, SKIP the forced re-resolve and reuse the already-resolved current
         track's URL/details for the download — avoiding a second concurrent resolve of the same song.
         For a NON-current track keep the existing download-quality re-resolve (it cannot affect
         playback — different song, separate copy).
      3. Ensure the blob `fetch` uses its own request only (it already does — a bare `fetch(r.audioUrl)`
         creating its own Response/blob, never the shared `<audio>` element). Do not introduce any
         shared audio element reuse.
      4. Confirm the function does not re-trigger lyrics: it must not null/clear `player.current.lrc`,
         must not call any player lyric-refill path, and must not bump `player.playGen`. It currently
         does none of these — keep it that way. Add a short comment documenting the isolation contract:
         "download must not touch player.current / lrc / playGen / the <audio> element."

    Net effect: downloading the song that is currently playing reuses the already-resolved URL (no
    duplicate resolve, no extra CDN pressure on the active stream); downloading any other song runs
    fully independently. No player-state mutation in either path.
  </action>
  <verify>
    <automated>npm run check</automated>
  </verify>
  <done>`npm run check` clean. In the running app: start a track playing with lyrics + translation
  showing, open the track menu on the SAME (currently-playing) song and tap Download — playback does
  not pause/restart/skip, the now-playing lyrics do not blank or re-translate, the progress bar keeps
  advancing, and the file still downloads. Downloading a DIFFERENT song while one is playing likewise
  leaves the active track's playback and lyrics untouched.</done>
</task>

<task type="auto">
  <name>Task 5: Don't auto-skip a track that has already started playing</name>
  <files>src/lib/stores/player.svelte.ts</files>
  <action>
    Stop the audio `error` listener (player.svelte.ts:1118-1168) from cross-source-failing-over (which
    restarts at 0 or advances to the next track) when the current track has ALREADY produced audio —
    the "plays ~3s then auto-advances" bug. A transient byte-fetch error / stale-range 403 AFTER
    playback started is a recoverable mid-track stall, not a load failure, and must NOT auto-skip.

    In the `error` listener, AFTER the existing seek-window re-resolve branch (the
    `if (sinceSeek < SEEK_ERROR_WINDOW_MS) { void this.reresolveCurrent(); return; }` block, which
    stays), add a guard mirroring the stall-watchdog's `hasPlayedSinceSrc` gate (armStall reads the
    SAME flag at line 783): if `this.hasPlayedSinceSrc` is true, the track is genuinely playing — do
    NOT route into `runFallback`. Instead recover in place by re-resolving the SAME track and resuming
    at the current position (reuse `reresolveCurrent()`, which preserves the seek via `pendingSeek` and
    does NOT bump the failure counters or treat this as an initial-load arm — see its D-14 comment).
    Concretely, place `if (this.hasPlayedSinceSrc) { void this.reresolveCurrent(); return; }` BEFORE
    the `this.errorBurst++` / `void this.runFallback(failed)` cross-source path. The cross-source
    fallback then only runs for a track that errored BEFORE ever producing audio (genuine
    initial-load / region-lock failure) — the intended never-stop behavior.

    Do NOT touch any UI render path and do NOT add a new `playing`-event dependency anywhere (respect
    the reverted player-displayed-defer regression — this change reads the EXISTING internal
    `hasPlayedSinceSrc` field exactly as the watchdog already does, and changes only the auto-advance
    decision). Do NOT weaken the genuine never-stop failover for tracks that never started: the
    consecutiveFailures / errorBurst loop-guard for pre-playback failures stays intact. Leave the
    commented-out errorBurst-cap block (lines 1154-1166) as-is. Add a brief comment at the new guard:
    a track that has produced audio (hasPlayedSinceSrc) must never be auto-skipped by the error path;
    a mid-track byte error re-resolves the same song in place rather than failing over / restarting.
  </action>
  <verify>
    <automated>npm test -- player && npm run check</automated>
  </verify>
  <done>`npm run check` clean and the player store tests still pass. In the running app, a track that
  starts playing keeps playing — it is no longer auto-advanced ~3s in by a transient error; if a
  mid-track byte error occurs the same song re-resolves and resumes near its current position rather
  than skipping. A track that fails to start at all (never fired playing/timeupdate) STILL fails over
  across sources / engages the never-stop loop-guard as before.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser ↔ /api/translate | Upstream-proxied translation; can soft-fail (200 echo) — already handled by translate.ts complete-gating, preserved by Task 3 |
| browser ↔ music CDN (audio bytes) | Direct `<audio>` byte fetch + the download blob fetch; region-locked / signed URLs can 403 transiently — Tasks 4 & 5 reduce cross-bleed |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-pzs-01 | Tampering | trCache (Task 3) caching a soft-fail echo as final | mitigate | Cache only complete renders (translateLinesEx `.complete === true` AND `stitched.length === lines.length`); service still refuses to persist echoes |
| T-pzs-02 | DoS (self-inflicted) | download blob fetch saturating the active stream's CDN (Task 4) | mitigate | Reuse the already-resolved current-track URL for the currently-playing song; never duplicate-resolve it |
| T-pzs-03 | Denial of playback | error-handler auto-skip on an already-playing track (Task 5) | mitigate | Guard runFallback on `hasPlayedSinceSrc`; recover-in-place via reresolveCurrent for mid-track errors |
| T-pzs-04 | Tampering | per-artist link param injection (Task 1) | mitigate | `encodeURIComponent(name)` on each split name (same as existing openArtist); route already `decodeURIComponent`s |
| T-pzs-SC | Tampering | npm/pip/cargo installs | accept | No new dependencies — all imports (@lucide/svelte, $lib/* helpers) already present; no install step in this plan |
</threat_model>

<verification>
- `npm run check` clean after every task (zero new type errors).
- `npm test` green (artist-split added; translate + player projects unaffected/extended).
- Manual browser pass on http://localhost:4321 per each task's <done>:
  1. Multi-artist now-playing -> separate tappable links; single artist -> one link.
  2. Related tab swipe-right/left queue/next; tap + long-press still work.
  3. Tab blur/focus on a translated CJK track -> no refetch, no flash (Network shows zero new
     /api/translate on refocus).
  4. Download the currently-playing song -> playback + lyrics undisturbed; file still downloads.
  5. A started track is never auto-skipped ~3s in; a never-started track still fails over.
</verification>

<success_criteria>
- 5 atomic commits, one per task, in the order listed (artist-split -> related-swipe -> lyric-cache
  -> download-isolation -> no-premature-skip).
- Each task touches only its named `src/` files (verified to exist).
- No regression to: the reverted playing-event UI gating (Task 5 reads an internal flag only, adds no
  UI/render `playing` dependency), the translate soft-fail handling (Task 3 caches only complete
  renders), or the genuine never-stop failover for tracks that never start.
- `npm run check` and `npm test` pass.
</success_criteria>

<output>
Create `.planning/quick/260625-pzs-batch-of-5-player-improvements-sveltekit/260625-pzs-SUMMARY.md` when done.
</output>
