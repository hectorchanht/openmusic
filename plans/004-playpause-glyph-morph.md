# 004 — Play/Pause Glyph Morph (Domain 1, MEDIUM)

**Severity:** MEDIUM
**Depends on:** 001 (`.play-glyph` global utility)
**Edited files:** `src/lib/components/NowPlaying.svelte`, `src/lib/components/Nowbar.svelte`

## Goal
Replace the instant `{#if player.playing}` destroy/recreate glyph swap with a cross-dissolve +
scale morph, using the shared `.play-glyph` global (plan 001). Both glyphs are always mounted and
stacked in one grid cell, so there is zero layout shift and the transition is interruptible (CSS
opacity/transform). No per-component keyframes.

---

## Part A — NowPlaying `.play` transport button (lines 1302-1304)

**Replace:**
```svelte
		<button class="play" aria-label={t('nowplaying.playPause')} onclick={() => player.toggle()} use:tapBounce>
			{#if player.playing}<Pause size={26} />{:else}<Play size={26} />{/if}
		</button>
```
**With:**
```svelte
		<button class="play" aria-label={t('nowplaying.playPause')} onclick={() => player.toggle()} use:tapBounce>
			<span class="play-glyph" class:is-playing={player.playing} aria-hidden="true">
				<span class="pg pg-play"><Play size={26} /></span>
				<span class="pg pg-pause"><Pause size={26} /></span>
			</span>
		</button>
```

`Play` and `Pause` are already imported (line 16). No CSS needed in-component — `.play-glyph`/`.pg`
live in `app.css` (plan 001). The button's `place-items:center` (line 1607) centers the grid.

---

## Part B — Nowbar `.np-btn` (lines 172-183)

Only the **else** branch changes (the `resolving` spinner branch is untouched). **Replace** the
`{:else}` button:

```svelte
		{:else}
			<button
				class="np-btn"
				aria-label={t("nowbar.playPause")}
				onclick={() => player.toggle()}
				use:tapBounce
			>
				<span class="play-glyph" class:is-playing={player.playing} aria-hidden="true">
					<span class="pg pg-play"><Play size={18} /></span>
					<span class="pg pg-pause"><Pause size={18} /></span>
				</span>
			</button>
		{/if}
```

`Play`/`Pause` already imported in Nowbar (line 10). `.np-btn` already `display:grid;
place-items:center` (lines 350-362), so the glyph centers with no extra CSS.

## Invariants preserved
- `player.toggle()` wiring, `use:tapBounce`, aria-labels unchanged.
- Nowbar `resolving` → Loader spinner branch untouched.
- No layout shift (grid-stacked identical-size glyphs). Reduce-motion → instant (plan 001 media
  block + the app-flag `:root[data-reduce-motion]` rule).

## Verification
`pnpm check`. In app: toggling play/pause cross-dissolves + scales the glyph on both the Nowbar and
the NowPlaying transport; no icon jump, no reflow. Reduce Motion on → instant swap.
