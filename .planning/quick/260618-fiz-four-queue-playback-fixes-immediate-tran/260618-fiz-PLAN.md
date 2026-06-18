---
phase: quick-260618-fiz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/stores/player.svelte.ts
  - src/lib/stores/player.svelte.test.ts
  - src/lib/components/NowPlaying.svelte
  - src/routes/(app)/search/+page.svelte
  - src/routes/(app)/library/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
autonomous: true
requirements: [FIZ-1, FIZ-2, FIZ-3, FIZ-4]

must_haves:
  truths:
    - "Toggling the lyrics English-translation whitelist re-renders the CURRENTLY displayed lyrics immediately (no song change needed)"
    - "Swiping a track row right-to-left (leftward) enqueues it as the NEXT track (play-next), not a like toggle"
    - "When the up-next queue runs dry, the continuation is generated from the song that was playing when it emptied — not from the liked/favorites list"
    - "Clicking a NEW song clears prior auto/context queue entries but PRESERVES songs the user explicitly added via play-next / add-to-queue"
    - "Existing player + library tests stay green; new tests cover the changed enqueue/queue-replacement behavior"
  artifacts:
    - path: "src/lib/stores/player.svelte.ts"
      provides: "queue provenance (manualUids) preserved on fresh play; autoplay continuation seeded from last-played track"
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "lyrics translation reactive to the skip whitelist for the current track"
    - path: "src/routes/(app)/search/+page.svelte"
      provides: "swipe-left = play-next enqueue wiring"
  key_links:
    - from: "swipeAction onSwipeLeft (search/library/artist pages)"
      to: "player.playNext"
      via: "onSwipeLeft callback"
      pattern: "onSwipeLeft.*playNext"
    - from: "player fresh-play regenerate path"
      to: "manualUids preservation"
      via: "weaveFreshHistory / regenerate exclude set"
      pattern: "manualUids"
---

<objective>
Four interdependent queue/playback fixes in the SvelteKit player. All center on `src/lib/stores/player.svelte.ts` (the Svelte 5 runes queue/playback singleton) plus the lyrics view and the per-route swipe wiring.

Purpose: Bring queue + lyrics behavior in line with industry norms (Spotify/YT-Music) — immediate setting feedback, swipe-to-queue, smart autoplay continuation, and explicit-vs-auto queue provenance on replace.

Output: Modified player store + NowPlaying lyrics derivation + swipe-left rewiring in 3 route pages, with updated/added tests.

NOTE: The live app is SvelteKit under `src/`. `index.html` is a STALE legacy artifact — ignore it entirely. CLAUDE.md's "everything in index.html" claims are outdated (confirmed via memory + scouting).
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md

<interfaces>
<!-- Grounded contracts extracted from the codebase during scouting. Use these directly. -->

player.svelte.ts (class Player, exported singleton `player`):
- `queue = $state<Track[]>([])` — the up-next list (history-prefixed: a fresh click weaves prior tracks BEFORE current via weaveFreshHistory).
- `current = $state<Track | null>(null)`.
- `queueContext = $state<QueueContext>(null)` — which surface started the queue (null|'results'|'artist'|'remix'|...). Drives settings.effectiveUpnextMode.
- `private manualUids = new Set<string>()` — uids the user pinned via playNext/addToQueue/reorder; survive a fresh-play regenerate. Cleared by clearQueue().
- `private removedUids = new Set<string>()` — swiped-out uids; excluded from regen. Cleared on fresh play.
- `playNext(t: Track)` — adds t.uid to manualUids, splices t right AFTER current (deduped). Plays if nothing playing.
- `addToQueue(t: Track)` — adds t.uid to manualUids, appends t to end (deduped). Plays if nothing playing.
- `async play(track, opts?: { fresh?; fromFallback? })` — fresh=true regenerates the AUTO tail via regenerate(seed); preserves manual entries.
- `private async regenerate(seed)` — keeps head up to+including seed + manualEntries (filter by manualUids), replaces tail via buildSimilarQueue(seed, exclude). Already preserves manualUids. Uses settings.effectiveUpnextMode(queueContext).
- `private weaveFreshHistory(seed)` — on fresh play prepends captured history prefix before seed.
- `next()` — advances to nextPlayableIndex; at end-of-queue calls ensureAhead().then(advance).
- `private ensureAhead()` — when within 2 of end, appends buildDiversePicks(8, have). have = queue uids ∪ removedUids.
- `private async regenerate`/`ensureAhead` are the TWO auto-fill paths.
- `setQueue(tracks, context)` / `setListQueue(tracks, context)` — install a list; capture history prefix.

similar.ts:
- `buildSimilarQueue(track: Track, excludeUids?: Set<string>): Promise<Track[]>` — Last.fm artist.getSimilar → top tracks; falls back to same-artist search. Already seeds from a track's artist. THIS is the existing "related/autoplay" mechanism.

picks.ts:
- `buildDiversePicks(count, have): Promise<Track[]>` — RANDOM diverse picks (NOT seeded from a song). This is what ensureAhead currently uses at queue-dry — the root of Fix 3.

swipeAction.ts (use:swipeAction):
- opts `{ onSwipeRight?, onSwipeLeft?, threshold?, enabled? }`.
- dx > 0 (rightward) → onSwipeRight; dx < 0 (LEFTWARD, right-to-left) → onSwipeLeft.
- Currently wired in 3 routes: onSwipeRight = addToQueue, onSwipeLeft = toggle like.

NowPlaying.svelte (lyrics block):
- `lines = $derived(player.current?.lrc ? splitParenLines(reorderPairs(parseLRC(player.current.lrc))) : [])`.
- Lyrics translation runs in a `$effect` keyed by `${t.uid}:${lang}:${n}:${skip...}` (skip = settings.lyricsSkip). It already includes skip in the key.
- `translated = $state<string[]>([])`; `showTr = $derived(settings.lyricsLang !== 'off' && translated.length === lines.length)`.
- The "exclude/include English translation" control = toggling `'en'` in `settings.lyricsSkip` (a SourceLang whitelist; a line whose detected source ∈ list renders untranslated).

settings.svelte.ts:
- `lyricsSkip = $state<SourceLang[]>(...)`, `lyricsLang = $state<LyricsLang>(...)`. Toggled on /settings/translation via toggleSkip(); calls settings.save().
- `effectiveUpnextMode(ctx): 'same-list' | 'generated'`.

i18n (confirmed existing keys — do NOT introduce new tokens):
- `toast.addedToQueue` = "Added to queue" (used by the RIGHT swipe / addToQueue today).
- `toast.playingNext` = "Playing next" — the correct toast for the LEFT swipe play-next action.
- `menu.playNext` = "Play next".
- `toast.liked`/`toast.unliked` — used by the soon-to-be-removed like swipe.
</interfaces>

# Live lyrics translation: src/lib/components/NowPlaying.svelte lines ~226-272
# Swipe wiring sites: search/+page.svelte ~42-49,572 ; library/+page.svelte ~29-35,221,251,270,303 ; artist/[name]/+page.svelte ~129-136,490
# Queue model: player.svelte.ts manualUids (~609), playNext (~1257), addToQueue (~1268), regenerate (~1977), ensureAhead (~1310), next (~2050)
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix 2 — swipe right-to-left enqueues as next (play-next), not like</name>
  <files>src/routes/(app)/search/+page.svelte, src/routes/(app)/library/+page.svelte, src/routes/(app)/artist/[name]/+page.svelte</files>
  <behavior>
    - Swiping a row leftward (right-to-left, dx < 0 → onSwipeLeft) calls player.playNext(track) (enqueue as next), NOT library.toggleLike.
    - The existing rightward swipe (onSwipeRight) behavior is preserved as-is (add to queue / append).
    - The swipe-left affordance label/icon/toast reflects the new "play next" action — no remaining "like"/"unlike" wording or Heart icon on the LEFT reveal layer.
  </behavior>
  <action>
    In all three route pages, find the `swipeLike`/`likeTrack` handler bound to `onSwipeLeft` and the `swipeQueue`/`queueTrack` handler bound to `onSwipeRight`. Repoint `onSwipeLeft` to call `player.playNext(track)` (the existing play-next enqueue — reuse it, do NOT duplicate logic). Keep `onSwipeRight` = `player.addToQueue` (append) unchanged.
    Replace the left-swipe toast with the existing `t('toast.playingNext')` key (confirmed present in i18n; "Playing next"). Do NOT introduce a new token. Drop the `wasLiked`/`toggleLike`/`toast.liked`/`toast.unliked` logic from the left-swipe handler.
    Update the LEFT reveal layer markup (the `.reveal-like` span with the Heart icon, behind the row) to a play-next affordance: swap the Heart for an icon that reads as "play next / queue" — reuse the icon the right reveal already uses, or `ListPlus`/`ListMusic`/`Plus` from `@lucide/svelte` (check the page's existing lucide imports first; add the import if needed). Rename the `.reveal-like` class to e.g. `.reveal-next` for clarity and update the matching CSS selector. Remove the now-dead `library.isLiked(...)` fill expression on that reveal. Do NOT touch the right reveal layer.
    Remove now-unused `swipeLike`/`likeTrack`/`wasLiked` locals if nothing else references them. Keep the `library` import only if still used elsewhere on the page (grep the file before deleting any import). The artist page's separate action-bar `likeTrack` (line ~134, used by a non-swipe button) is UNRELATED — only change the swipe binding, leave the action-bar handler intact.
    Per FIZ-2.
  </action>
  <verify>
    <automated>grep -n "onSwipeLeft" "src/routes/(app)/search/+page.svelte" "src/routes/(app)/library/+page.svelte" "src/routes/(app)/artist/[name]/+page.svelte" | grep -ci "playnext" ; npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -5</automated>
  </verify>
  <done>All `onSwipeLeft` bindings in the 3 route pages call player.playNext; no left-swipe handler calls toggleLike; the LEFT reveal layer no longer shows a Heart/like affordance; the left-swipe toast is `toast.playingNext`; svelte-check passes with no new errors.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Fix 4 — explicit queue entries survive fresh play; auto/context entries are cleared</name>
  <files>src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts</files>
  <behavior>
    - Given a queue with [current, autoPickA, manualX (added via playNext), autoPickB], when the user explicitly plays a NEW song (play(newTrack, {fresh:true})), the resulting queue preserves manualX and the new current, but does NOT retain autoPickA/autoPickB as leftovers from the old context.
    - Songs added via playNext()/addToQueue() (tracked in manualUids) are preserved across the fresh-play rebuild.
    - A non-fresh advance (next/auto-advance/failover) never triggers this rebuild (unchanged).
    - clearQueue() still resets manualUids (unchanged).
  </behavior>
  <action>
    Investigate the CURRENT fresh-play rebuild in regenerate() (player.svelte.ts ~1977): it already computes `head` (everything up to+including seed) + `manualEntries` (queue entries whose uid ∈ manualUids and not in head) + freshly generated `auto`, then sets queue = [head, manualEntries, auto]. This is the provenance mechanism — manualUids IS the "explicit vs auto" tag. Determine whether the bug is that auto/context entries leak through.
    The leak path: weaveFreshHistory() (~1952) PREPENDS the captured history prefix (prior current + earlier played tracks) and anchors the seed, but the prior queue's UNPLAYED auto/context tail can survive into the woven baseline when the seed sits mid-queue. Trace both fresh branches in play() (~1882): the 'generated' branch calls regenerate() (which drops the old tail by rebuilding it), but the 'same-list' branch does NOT call regenerate() — so the old auto/context tail survives there.
    Fix: ensure that on a FRESH play, regardless of upnext mode, prior-queue entries that are NOT in the new history prefix, NOT the seed, and NOT in manualUids do not survive. Concretely: factor a small private helper (e.g. `preserveManual(seed: Track, generatedTail: Track[]): Track[]`) that returns [woven-history-head-up-to+including-seed, ...manualEntries (uid ∈ manualUids, excluding head), ...generatedTail] using queueWithAnchor for the seed-anchored ordering. Have the 'generated' branch keep using regenerate() (already correct) and have the 'same-list' branch route through the same preserve-manual logic so stale auto/context entries are dropped while manualUids entries are re-inserted after the seed. Keep manualUids as the single provenance source (no new per-Track origin field — STATE.md side-state discipline: a plain Set, never a Track field).
    Re-read this.queue at write time (Pitfall 1 — never a closed-over snapshot) and bump queueGen on the rebuild (WR-06) so any in-flight regenerate/ensureAhead discards.
    Add tests to player.svelte.test.ts: (1) fresh play of a new song with a manual entry preserves the manual entry and drops auto picks; (2) fresh play in 'same-list' context still drops stale auto/context entries while keeping manual ones; (3) non-fresh advance leaves the queue untouched. Use the existing test harness (mockSimilar at line 77, library mock) — grep the test file for the setup helpers before writing.
    Per FIZ-4.
  </action>
  <verify>
    <automated>npx vitest run src/lib/stores/player.svelte.test.ts 2>&1 | tail -15</automated>
  </verify>
  <done>Fresh play preserves manualUids entries and the new current while clearing prior auto/context entries in BOTH upnext modes; non-fresh advance is unchanged; new tests pass and the full player.svelte.test.ts suite stays green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Fix 3 — autoplay continuation at queue-dry seeds from the last-played song</name>
  <files>src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts</files>
  <behavior>
    - When the up-next queue is within 2 of the end (ensureAhead trigger) OR fully exhausted at next(), the appended continuation is generated from the song that was playing when it emptied (its artist/title), using buildSimilarQueue(currentTrack, exclude) — NOT buildDiversePicks (random) and NOT the liked/favorites list.
    - The exclude set still unions queue uids + removedUids so the continuation never duplicates queued/swiped-away songs.
    - Graceful fallback preserved: buildSimilarQueue already falls back to same-artist search; if it still yields nothing, fall back to buildDiversePicks so the queue never dead-ends with sources truly dry.
    - Best-effort + re-entrancy guard (growing flag / growPromise) + queueGen supersedence guard all preserved.
  </behavior>
  <action>
    In ensureAhead() (player.svelte.ts ~1310), replace the `buildDiversePicks(8, have)` call with a last-played-seeded continuation: `buildSimilarQueue(current, have)` where `current` is the live current track (the song playing when the queue is running dry) and `have` = queue uids ∪ removedUids (as today). buildSimilarQueue already seeds from `track.artist` via Last.fm getSimilar with a same-artist search fallback — this IS the "related by the playing track's artist/title" mechanism the task asks for (no new fetch needed; reuse it). `have` is already a Set<string>, matching buildSimilarQueue's excludeUids param.
    Preserve the myQueueGen supersedence check, the growing flag/growPromise, and the queueWithAnchor write-back verbatim.
    Add a defensive fallback: if buildSimilarQueue returns empty (Last.fm dry AND same-artist search empty), fall back to buildDiversePicks(8, have) so an exhausted queue with an obscure artist still grows rather than dead-ending (never-stop invariant, STATE.md Phase 16). Keep buildDiversePicks imported.
    Document the assumption in a comment: "continuation is seeded from the CURRENT track (the song playing as the queue empties), per quick-260618-fiz Fix 3 — buildSimilarQueue (artist.getSimilar → same-artist fallback) is the existing related mechanism; buildDiversePicks is now only the last-resort fallback."
    Add a test: when ensureAhead fires near end-of-queue, buildSimilarQueue is called with the CURRENT track (assert the seed arg) and its picks are appended; assert buildDiversePicks is NOT called when buildSimilarQueue returns picks, and IS called as the fallback when buildSimilarQueue returns []. buildSimilarQueue is already mocked (test line 32). Grep the test file for an existing buildDiversePicks mock; add one (vi.mock('$lib/services/picks', ...)) if absent.
    Per FIZ-3.
  </action>
  <verify>
    <automated>npx vitest run src/lib/stores/player.svelte.test.ts 2>&1 | tail -15</automated>
  </verify>
  <done>ensureAhead seeds the continuation from the current (last-played) track via buildSimilarQueue; buildDiversePicks is only the empty-result fallback; the liked/favorites list is no longer the source; existing tests stay green and the new ensureAhead-seeding test passes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Fix 1 — lyrics translation re-renders immediately when the English-translation toggle flips</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <behavior>
    - With the now-playing lyrics tab open on a song, toggling settings.lyricsSkip (adding/removing 'en') re-derives the DISPLAYED lyrics immediately — no song change required.
    - Toggling settings.lyricsLang likewise re-derives immediately.
    - Skipped (whitelisted-source) lines render their original text; non-skipped lines render their translation; index alignment with `lines` is preserved.
    - showTr render gate (translated.length === lines.length) stays correct after a toggle, including the all-whitelisted case.
  </behavior>
  <action>
    Investigate the lyrics translation `$effect` (NowPlaying.svelte ~226-271). It already keys on `settings.lyricsSkip` and `settings.lyricsLang` via the rerun `key` and re-runs translateLines on change — so the EFFECT is reactive. The "only applies to next song" symptom is render staleness: early-return guards and the no-send-lines path can leave the previously-rendered `translated` array (or a mis-gated showTr) showing until something else changes.
    Make the displayed lyrics ROBUSTLY reactive to the setting (task-preferred reactive-derivation approach):
    1. On the early-return branches (`tab !== 'lyrics' || rawLang === 'off' || !n || !t`), set `translated = []` BEFORE returning where it is currently missing, so flipping into a no-translate state (e.g. lyricsLang → 'off') drops stale translations immediately rather than leaving them rendered.
    2. Confirm `translated = []` is set synchronously at the top of the active path when `key` changes (it is at ~251) so a flip clears stale output before the async re-translate completes.
    3. Fix the all-whitelisted case: when `sendText.length === 0` (every line whitelisted/already target), the work resolves to `[]`, and the `.then` sets `translated = stitch(out)`. Verify `stitch([])` returns all originals aligned to `lines.length` (it maps each line to its original when not in sendIdx) so showTr stays true and originals render. If the zero-send path currently leaves `translated = []` (mis-gating showTr to false), make it set `translated = stitch([])` synchronously instead of waiting on a resolved-empty promise.
    Leave translateMode/lyricsHideParen* alone (already read reactively in the template). Keep translate.ts cache-poison hardening untouched. Do NOT change parseLRC/reorderPairs/splitParenLines.
    Per FIZ-1.
  </action>
  <verify>
    <automated>npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -5</automated>
  </verify>
  <done>Flipping settings.lyricsSkip ('en') or settings.lyricsLang on an open lyrics tab clears stale translations synchronously and re-derives the current song's displayed lyrics without a song change; the all-whitelisted case renders aligned originals; svelte-check passes.</done>
</task>

<task type="auto">
  <name>Task 5: Full verification sweep</name>
  <files>(no edits — verification only)</files>
  <action>
    Run the full test + type-check sweep to prove all four fixes compose and nothing regressed: vitest (full run) and svelte-check. Confirm player.svelte.test.ts and library.svelte.test.ts are green. If any failure surfaces, fix it within the relevant task's files before completing.
  </action>
  <verify>
    <automated>npx vitest run 2>&1 | tail -20 && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -5</automated>
  </verify>
  <done>Full vitest suite passes (including player + library tests); svelte-check reports no new errors; all four fixes coexist.</done>
</task>

</tasks>

<verification>
- Fix 1: Manual — open a song's lyrics, toggle English-translation whitelist on /settings/translation, return to now-playing → displayed lyrics reflect the new setting without replaying. Automated — svelte-check clean.
- Fix 2: `grep onSwipeLeft` in the 3 routes shows playNext, not toggleLike; svelte-check clean.
- Fix 3 + Fix 4: player.svelte.test.ts green with new tests asserting (a) ensureAhead seeds from current via buildSimilarQueue, (b) fresh play preserves manualUids + drops auto/context entries.
- Full sweep: `npx vitest run` + `npx svelte-check` both clean.
</verification>

<success_criteria>
- All four fixes implemented, grounded in real functions: player.playNext (Fix 2), regenerate/manualUids (Fix 4), ensureAhead/buildSimilarQueue (Fix 3), NowPlaying lyrics $effect (Fix 1).
- No duplicated enqueue logic (Fix 2 reuses player.playNext; Fix 3 reuses buildSimilarQueue).
- Existing tests stay green; new tests cover changed queue-replacement + autoplay-seeding behavior.
- Svelte 5 runes reactivity patterns respected ($state/$derived/$effect; manualUids stays a plain side-state Set, no Track-level origin field).
</success_criteria>

<output>
Create `.planning/quick/260618-fiz-four-queue-playback-fixes-immediate-tran/260618-fiz-SUMMARY.md` when done.
</output>
