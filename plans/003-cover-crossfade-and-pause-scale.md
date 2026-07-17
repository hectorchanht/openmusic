# 003 — Cover Crossfade + Contextual Pause/Play Scale (Domain 4, HIGH + MEDIUM)

**Severity:** HIGH (crossfade) + MEDIUM (pause-scale)
**Depends on:** 001 (`--dur-slow`, spring token values)
**Edited file:** `src/lib/components/NowPlaying.svelte` only.
**Motion engine:** real `svelte/motion` `Spring` for the pause-scale (physics-based, interruptible)
— the brief's "Svelte's native motion engines" mandate, used exactly where it fits (state-driven,
not a 1:1 gesture, so it cannot regress the gesture actions).

---

## Part A — crossfade the current cover cell

Today `.cover-cell.cur` swaps `background-image` instantly on any non-swipe track change
(auto-advance, queue tap, prev/next, late cover resolve). Wrap the current image in a
`{#key effectiveCover}` layer so the outgoing image fades out while the incoming fades in — fully
contained inside `.cur`, so the `coverSwipe` strip transform is untouched. `xfadeMs` already
collapses to 0 under reduce-motion (existing derived at line 586-590).

**Replace** the current cell markup (lines 1242-1245):

```svelte
				<div class="cover-cell cur">
					{#key effectiveCover}
						<div
							class="cover-img"
							in:fade={{ duration: xfadeMs }}
							out:fade={{ duration: xfadeMs }}
							style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackCover(player.current)}
						></div>
					{/key}
				</div>
```

`fade` is already imported (line 13). Add the `.cover-img` rule to the `<style>` block, right
after the `.cover-cell.next` rule (line 1544):

```css
	/* plan 003: the current cell crossfades its art on a non-swipe track change / late resolve.
	   Two keyed layers stack at inset:0 and dissolve; the strip transform (coverSwipe) is on the
	   parent .cover-strip and is unaffected. */
	.cover-cell.cur { overflow: hidden; }
	.cover-img { position: absolute; inset: 0; background-size: cover; background-position: center; }
```

---

## Part B — pause/play scale via `Spring`

Add the import (with the other `svelte` imports, line 12-14 region):

```ts
	import { Spring } from 'svelte/motion';
```

Add the spring + driver `$effect` near the cover-carousel derivations (after `hasNextNeighbor`,
around line 567). Read the numeric spring params so they track the tokens conceptually:

```ts
	// ---- Contextual cover scale (plan 003, Domain 4) ----
	// Native players shrink the art when paused, expand when playing. A physics Spring drives the
	// scale so rapid play/pause toggles retarget smoothly mid-flight (interruptible — Emil). Only
	// applied while the sheet is CLOSED (the square hero); in half/full the cover is a full-bleed
	// banner where a scale would look wrong, so the target is pinned to 1 there. Reduce-motion (app
	// flag OR OS) snaps instantly via `{ instant: true }`.
	const coverScale = new Spring(1, { stiffness: 0.16, damping: 0.62 });
	$effect(() => {
		const playing = player.playing;
		const closed = sheetState === 'closed';
		const reduce = settings.reduceMotion || osReduceMotion;
		const target = !playing && closed ? 0.93 : 1;
		coverScale.set(target, reduce ? { instant: true } : undefined);
	});
```

Apply the spring to the `.cover` element. **Edit** the `.cover` open tag (lines 1208-1216) to add
the inline transform bound to `coverScale.current`:

```svelte
		<div
			class="cover"
			onclick={tapCoverCollapse}
			onkeydown={tapCoverKey}
			role="button"
			tabindex="0"
			bind:this={coverEl}
			aria-label={t('nowplaying.albumArt')}
			style:transform={`scale(${coverScale.current})`}
		></div>
```

*(the element keeps all its children — only the opening tag gains `style:transform`.)*

## Why `.cover` and not `.cover-strip`
`.cover` is the rounded, shadowed box; scaling it shrinks the art **and** its drop-shadow together
(the native look). Its children (`.cover-strip` inset:0 + cells) scale proportionally. `.cover`'s
existing `transition: width/height/margin/border-radius 0.32s` does **not** include `transform`, so
the Spring owns the transform per-frame with no CSS fighting it. In `.reflow` the target is 1, so
the banner is never scaled.

## Invariants preserved
- `effectiveCover` derivation, `healCover` self-heal `$effect`, and the neighbor `lazyCover` map
  are all untouched — only the *render* of the current cell changes.
- `coverSwipe` strip transform is on `.cover-strip`; the crossfade + scale are on `.cur`/`.cover`
  respectively, so the horizontal carousel gesture is byte-unaffected.
- Reduce-motion: crossfade `xfadeMs → 0`; scale `instant:true`.

## Verification
`pnpm check`. In app: hit Pause → hero shrinks ~7% with a soft spring; Play → springs back.
Auto-advance / tap a queue row → cover cross-dissolves instead of popping. Swipe carousel → still
slides 1:1 (unchanged). Toggle Reduce Motion → both become instant.
