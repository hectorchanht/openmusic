---
phase: quick-260615-fva
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/Nowbar.svelte
autonomous: false
requirements: [SWIPE-GAP, NP-TEXT-XFADE, NOWBAR-XFADE]
must_haves:
  truths:
    - "Dragging the now-playing cover reveals a visible gutter between the current cover and the neighbor cover as they slide"
    - "A committed cover swipe still lands the neighbor cover perfectly centered (no off-centre frozen frame)"
    - "On the now-playing surface the current title+artist fade OUT while the next track's title+artist fade IN on track change"
    - "On the nowbar the current title+artist+cover fade OUT while the next track's title+artist+cover fade IN on track change"
    - "With reduce-motion on (OS pref OR the app setting), all new fades are disabled/instant and the cover gap slide is unaffected functionally"
  artifacts:
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "Gutter between carousel cells + crossfade on .meta title/artist"
      contains: "--cover-gap"
    - path: "src/lib/components/Nowbar.svelte"
      provides: "Crossfade on nowbar cover + title + artist"
      contains: "reduceMotion"
  key_links:
    - from: "src/lib/components/NowPlaying.svelte .cover-cell.prev/.next"
      to: ".cover-strip live translateX(dx) finger-follow"
      via: "calc(-100% - var(--cover-gap)) / calc(100% + var(--cover-gap)) cell offsets"
      pattern: "calc\\(.*100%.*cover-gap"
    - from: "src/lib/components/Nowbar.svelte fade transitions"
      to: "settings.reduceMotion"
      via: "duration guard"
      pattern: "reduceMotion"
---

<objective>
Polish the cover-swipe-to-change-track interaction on the now-playing surface and mirror its meta/cover crossfade on the nowbar.

Three changes, all built on the EXISTING `coverSwipe` action + `NowPlaying.svelte` 3-cell carousel + `Nowbar.svelte`:
1. SWIPE COVER GAP — a visible gutter between the current cover and the sliding neighbor in the NowPlaying carousel, with the 1:1 finger-follow drag and the 0.32s commit-settle both kept intact and the committed neighbor still landing centered.
2. NOW-PLAYING TEXT CROSSFADE — current title+artist fade out while the next track's title+artist fade in (replacing the current hard `{#key}` remount swap).
3. NOWBAR CROSSFADE — same title+artist crossfade on the mini bar, AND crossfade the nowbar cover (no hard swap).

Purpose: make the track-change transition feel native and smooth instead of a jarring instant hard-swap.
Output: edited `NowPlaying.svelte` + `Nowbar.svelte`; no new files, no new action, no new advance function.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<constraints_from_codebase>
- Commit MUST still go through `player.prev()` / `player.next()` (the coverSwipe action already calls these on commit). DO NOT add a new advance function.
- The `coverSwipe` action (src/lib/actions/coverSwipe.ts) writes `node.style.transform = translateX(<applied>px)` directly on the `.cover-strip` and on commit calls `resetTransform()` so the store swap repaints the freshly-derived cells. DO NOT change coverSwipe.ts — its node-tested contract (coverSwipe.test.ts) must stay green.
- Reduced-motion is BOTH an OS media query (`@media (prefers-reduced-motion: reduce)`) AND an app setting exposed as `settings.reduceMotion` (src/lib/stores/settings.svelte.ts) which writes `:root[data-reduce-motion]`. The global app.css rule `:root[data-reduce-motion] * { transition:none!important; animation:none!important; }` kills CSS transitions/animations but does NOT reliably stop Svelte JS-driven `transition:`/`fade` directives — so JS transitions MUST be guarded explicitly by `settings.reduceMotion` (and the import already used pattern), collapsing their `duration` to 0 when reduce-motion is active.
- Match existing design-token CSS conventions (CSS custom props like `--color-bg`, `--color-text`; the universal settle curve `cubic-bezier(.22,1,.36,1)`). No build step — plain Svelte 5 runes + `svelte/transition`.
</constraints_from_codebase>

<interfaces>
<!-- Extracted from the codebase — executor uses these directly, no exploration needed. -->

From src/lib/actions/coverSwipe.ts (DO NOT EDIT — for understanding only):
- On a committed horizontal drag, the action sets `node.style.transform = translateX(applied px)` live (1:1 finger follow), then on commit calls `onprev()`/`onnext()` and `resetTransform()` (drops the inline transform + transition so the host CSS resting state `translateX(0)` and the cell repaint take over).
- The strip's CSS commit-settle transition `transform 0.32s cubic-bezier(.22,1,.36,1)` is overridden to `none` by the action while dragging, then restored on release. The action measures `node.getBoundingClientRect().width` for its 0.28×width proportional commit — that width is the FULL strip width = one cover width (cells are `width:100%`).

Current NowPlaying carousel CSS (src/lib/components/NowPlaying.svelte, ~lines 1145-1160):
```
.cover-strip { position: absolute; inset: 0; will-change: transform; transition: transform 0.32s cubic-bezier(.22,1,.36,1); }
.cover-cell { position: absolute; top: 0; width: 100%; height: 100%; background-size: cover; background-position: center; }
.cover-cell.prev { left: -100%; }
.cover-cell.cur  { left: 0; }
.cover-cell.next { left: 100%; }
@media (prefers-reduced-motion: reduce) { .cover-strip { transition: none; } }
:global(:root[data-reduce-motion]) .cover-strip { transition: none; }
```

Current NowPlaying meta markup (~lines 915-925) — hard-swaps on track change via {#key}:
```
{#key player.current?.uid}
  <div class="title" use:marquee><span class="marquee-inner">{player.current ? names.dnTitle(player.current.title) : ''}</span></div>
  <button class="artist" use:marquee onclick={openArtist}><span class="marquee-inner">{player.current ? names.dnArtist(player.current.artist) : ''}</span></button>
{/key}
```

Current Nowbar art + meta markup (src/lib/components/Nowbar.svelte, ~lines 87-101) — hard-swaps:
```
<span class="np-art" style:background-image={...resolvedCover ?? np?.cover...}></span>
<span class="np-meta">
  <span class="np-title">{names.dnTitle(np?.title ?? "")}</span>
  <span class="np-artist">{names.dnArtist(np?.artist ?? "")} ...</span>
</span>
```

Available imports:
- `import { fade, crossfade } from 'svelte/transition';` (svelte/transition; NowPlaying already imports `fly` from it)
- `import { settings } from '$lib/stores/settings.svelte';` (already imported in NowPlaying; ADD to Nowbar)
- `settings.reduceMotion` → boolean
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add the carousel gutter (SWIPE COVER GAP) in NowPlaying.svelte</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
Introduce a `--cover-gap` CSS custom property on `.cover-strip` (e.g. `--cover-gap: 14px;` — pick a value that reads as a clear gutter at the `min(72vw,320px)` cover size; do NOT hardcode it into the cell rule literally, reference the var). Re-offset the neighbor cells so a gutter sits between covers during the drag: change `.cover-cell.prev { left: -100%; }` to `left: calc(-100% - var(--cover-gap)); }` and `.cover-cell.next { left: 100%; }` to `left: calc(100% + var(--cover-gap)); }`. Leave `.cover-cell.cur { left: 0; }` unchanged.

Why this is sufficient and keeps both invariants intact:
- The 1:1 finger-follow is UNAFFECTED — `coverSwipe` writes raw `translateX(dx)` on the strip; pushing the neighbor cells out by an extra gutter means the gutter is simply revealed as the strip slides. No change to coverSwipe.ts.
- The commit-settle still lands the neighbor centered — on commit the action calls `player.prev()/next()` then `resetTransform()`; the store swap re-derives `prevCover/cur/nextCover` and the strip repaints with the committed neighbor now occupying the `.cur` cell at `left:0`. The strip's resting transform is `translateX(0)`, so the new current cover is centered. The gutter only ever exists between cells mid-drag; it never displaces the resting current cell. (The action's proportional commit measures the same full strip width as before, so commit thresholds are unchanged.)

Update the stale "edge-to-edge (no gutter)" comments in BOTH the CSS block (~line 1146) and the markup comment (~line 892) to describe the new gutter so the next reader isn't misled. Keep the existing reduced-motion rules on `.cover-strip` byte-unchanged — the gap is positional, not animated, so it needs no reduce-motion guard.
  </action>
  <verify>
    <automated>npx vitest run src/lib/actions/coverSwipe.test.ts && grep -q "cover-gap" src/lib/components/NowPlaying.svelte && grep -q "calc(-100% - var(--cover-gap))" src/lib/components/NowPlaying.svelte && grep -q "calc(100% + var(--cover-gap))" src/lib/components/NowPlaying.svelte</automated>
  </verify>
  <done>`.cover-strip` declares `--cover-gap`; prev/next cells use `calc(±100% ± var(--cover-gap))`; coverSwipe.test.ts still green; cur cell unchanged at left:0; stale "no gutter" comments updated.</done>
</task>

<task type="auto">
  <name>Task 2: Crossfade NowPlaying title+artist on track change</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
Replace the hard `{#key player.current?.uid}` remount swap of `.meta` (title + artist) with a per-track crossfade: the OUTgoing track's title+artist fade out while the INcoming track's fade in, synced with the commit.

Approach (keep it CSS/Svelte-transition driven, no new JS animation loop):
- Wrap the title+artist block in `{#key player.current?.uid}` STILL (the key drives mount/unmount of the per-track instance so transitions fire on change), but add Svelte `transition:fade` (in+out) to the keyed block — OR use `in:fade out:fade` on the wrapper element. Use a short duration matching the surface feel (~180-220ms) so it overlaps the 0.32s cover settle without lagging. Preserve `use:marquee` and the `.marquee-inner` span on title and artist exactly (the marquee re-measures on remount — that behavior is intentional and must stay), and preserve the artist's `onclick={openArtist}`.
- REDUCED-MOTION GUARD: the fade is a Svelte JS transition, so the global app.css `!important` rule does NOT stop it. Compute the effective duration from `settings.reduceMotion` AND the OS pref: e.g. a `$derived` like `const xfadeMs = $derived(settings.reduceMotion ? 0 : 200)` (settings.reduceMotion is already wired to `:root[data-reduce-motion]`; the OS `prefers-reduced-motion` reduce-motion users typically set the app flag too, but to be safe you MAY also read `window.matchMedia('(prefers-reduced-motion: reduce)').matches` behind the existing `typeof window` guard at module init). Pass `{ duration: xfadeMs }` to the fade so reduce-motion users get an instant swap (duration 0). Do NOT remove the {#key} — only the transition is gated to 0.

Do not touch the cover carousel, the sheet machine, lyrics, or any unrelated meta CSS. The `.title`/`.artist` pill styling stays unchanged.
  </action>
  <verify>
    <automated>npx svelte-check --threshold error 2>&1 | tail -5; grep -q "fade" src/lib/components/NowPlaying.svelte && grep -Eq "reduceMotion" src/lib/components/NowPlaying.svelte</automated>
  </verify>
  <done>NowPlaying title+artist crossfade in/out on `player.current.uid` change; fade duration collapses to 0 when `settings.reduceMotion`; marquee + openArtist preserved; svelte-check clean (no new errors).</done>
</task>

<task type="auto">
  <name>Task 3: Crossfade Nowbar cover + title + artist on track change</name>
  <files>src/lib/components/Nowbar.svelte</files>
  <action>
Mirror the NowPlaying crossfade on the mini nowbar for BOTH variants ('docked' and 'embed'): on track change, the current cover (`.np-art`) AND the current title+artist (`.np-meta`) fade OUT while the next track's fade IN. Currently they hard-swap because `np` (= `player.current ?? player.pendingTrack`) reactively updates the same persistent nodes.

Approach:
- Add `import { fade } from 'svelte/transition';` and `import { settings } from '$lib/stores/settings.svelte';` to the script.
- Key the cover and meta on the track identity so the transition fires. Use the SAME track-identity the rest of the bar uses: derive a key such as `np?.uid` (the resolved/pending track's uid). Wrap `.np-art` and `.np-meta` together in `{#key np?.uid}` (a single keyed group so cover + text fade together as one unit, matching the now-playing feel) and apply `transition:fade={{ duration: xfadeMs }}` to that group — OR `in:fade out:fade`. Keep `disabled={resolving}`, `onclick={handleOpen}`, and the `use:coverSwipe={{...}}` on the `.np-open` button untouched and OUTSIDE the keyed group so the swipe gesture surface is never remounted mid-drag.
- IMPORTANT — keep the swipe slide intact: `coverSwipe` writes `transform` on `.np-open`. Do NOT key/remount `.np-open` itself; only key the inner `.np-art` + `.np-meta` content. The cover crossfade is the CONTENT fading, layered under the coverSwipe slide of the button — both can coexist (slide = button transform during drag; crossfade = inner content swap on the post-commit store change).
- REDUCED-MOTION GUARD: same as Task 2 — `const xfadeMs = $derived(settings.reduceMotion ? 0 : 200)`; pass `{ duration: xfadeMs }`. The existing `@media (prefers-reduced-motion: reduce) .np-open { transition: none !important; }` stays as-is (it governs the coverSwipe slide, not the JS fade).
- Preserve the `.np-prog` loader rail, the sleep-timer badge, and the play/loader button exactly — only `.np-art` + `.np-meta` get the crossfade.
  </action>
  <verify>
    <automated>npx svelte-check --threshold error 2>&1 | tail -5; grep -q "from 'svelte/transition'" src/lib/components/Nowbar.svelte && grep -q "reduceMotion" src/lib/components/Nowbar.svelte && grep -q "coverSwipe" src/lib/components/Nowbar.svelte</automated>
  </verify>
  <done>Nowbar `.np-art` + `.np-meta` crossfade in/out on track change (both variants); coverSwipe stays attached to the un-keyed `.np-open`; fade duration 0 under reduceMotion; loader rail + sleep badge + play button untouched; svelte-check clean.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Cover-swipe gutter on NowPlaying + title/artist crossfade on NowPlaying + cover/title/artist crossfade on the Nowbar. Reduce-motion guards collapse the fades to instant.</what-built>
  <how-to-verify>
On a phone (or DevTools mobile emulation) with a multi-track queue playing:
1. Open Now Playing. Drag the cover sideways slowly — confirm a visible GAP (gutter) appears between the current cover and the neighbor cover as they slide (covers no longer touch). Let go past the commit point — confirm the neighbor cover lands perfectly CENTERED (no off-centre frozen frame, no jump). Confirm a sub-slop tap still collapses the sheet (in half) and a vertical drag still collapses to the nowbar.
2. Change track (swipe-commit, skip button, or auto-advance) — confirm the NowPlaying title+artist FADE out/in (the old text fades while the new fades in), not a hard snap.
3. Collapse to the nowbar. Change track — confirm the nowbar COVER fades out/in AND the title+artist fade out/in (no hard swap). Confirm a horizontal swipe on the nowbar still changes track and a tap still expands.
4. Turn ON reduce-motion (Settings → reduce motion, or OS-level) — repeat track changes: confirm BOTH crossfades are now INSTANT (no fade), and the cover gap is still visible during a drag (the gap is positional, not animated).
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues (e.g. "neighbor lands off-centre", "nowbar cover still hard-swaps", "fade still animates under reduce-motion").</resume-signal>
</task>

</tasks>

<verification>
- `npx vitest run src/lib/actions/coverSwipe.test.ts` green (the action contract is untouched).
- `npx svelte-check --threshold error` reports no NEW errors in the two edited components.
- `--cover-gap` var present; prev/next cells offset by the gutter; cur cell at left:0 unchanged.
- `fade` + `reduceMotion` guard present in both NowPlaying.svelte and Nowbar.svelte.
- coverSwipe still attached to the un-keyed `.np-open` / `.cover-strip` (gesture surface never remounted mid-drag).
</verification>

<success_criteria>
- A drag on the now-playing cover shows a clear gutter between current and neighbor covers; a committed swipe lands the neighbor centered with the 0.32s settle.
- NowPlaying title+artist crossfade on track change.
- Nowbar cover + title + artist crossfade on track change.
- Reduce-motion (OS pref or app setting) makes both crossfades instant; gesture + commit still function; coverSwipe.test.ts green; svelte-check clean.
- No new advance function; commit still routes through player.prev()/next(); coverSwipe.ts unchanged.
</success_criteria>

<output>
Create `.planning/quick/260615-fva-polish-cover-swipe-track-change-transiti/260615-fva-SUMMARY.md` when done.
</output>
