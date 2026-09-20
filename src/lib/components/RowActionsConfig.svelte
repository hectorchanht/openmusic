<script lang="ts">
	// RowActionsConfig — the Settings control for `settings.rowActions` (quick-260919-l9e).
	//
	// THE CONTROL IS SHAPED LIKE THE THING IT CONFIGURES. A chip multi-select would have told the
	// user which buttons are on but not where they land; this is a replica of a song row whose
	// inline buttons ARE the control — drag one to move it, tap it to switch it off. What you
	// configure looks like what you get. Same philosophy as the live cover-size / grid demos next
	// to it (quick-260618-goe) and the CSS mockups of quick-260919-ebi, taken one step further:
	// the preview is not a picture of the effect, it is the effect.
	//
	// A REPLICA, NOT AN INSTANCE. It deliberately does NOT mount <SongRow>: a real row wants a real
	// Track, and a preview that could like, download or play a song is a trap. The shape is
	// duplicated on purpose — if SongRow's layout moves, this moves with it BY HAND, which is the
	// cheaper half of the trade against wiring a fake Track through a component that talks to the
	// library and the player.
	//
	// THE OFF SLOTS. `settings.rowActions` is the ENABLED list in order; a switched-off action has
	// no position in it. So the strip shows the enabled ones first, in the user's order, then the
	// remaining ones trailing and dimmed — an off action keeps a stable, visible place to be
	// switched back on from, without inventing a second persisted order for things that do not
	// render. With two actions that is enough; if this list ever grows past ~4, revisit.
	//
	// KEYBOARD PARITY IS NOT OPTIONAL. A drag-only reorder is unusable without a pointer. Every
	// slot is a real <button>: Enter/Space toggles it (the native click), Left/Right move it. The
	// aria-label carries the state AND the position, because neither is conveyable by the visual
	// order alone.
	import { tick } from 'svelte';
	import { Heart, Download, MoreVertical } from '@lucide/svelte';
	import { settings, ROW_ACTIONS, type RowAction } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';

	let { title, artist }: { title: string; artist: string } = $props();

	const enabled = $derived(settings.rowActions);
	/** Enabled (in the user's order) first, then the switched-off remainder, dimmed. */
	const slots = $derived<RowAction[]>([
		...enabled,
		...ROW_ACTIONS.filter((a) => !enabled.includes(a))
	]);
	const labelOf = (a: RowAction) => t(a === 'like' ? 'menu.like' : 'menu.download');

	function commit(next: RowAction[]) {
		settings.rowActions = next;
		settings.save();
	}
	/** Re-focus the chip we just moved, by identity.
	 *  The {#each} is keyed, so Svelte MOVES a button's node rather than recreating it — and
	 *  re-inserting a focused element drops focus to <body> in Chrome. Without this a keyboard user
	 *  could act on a chip exactly once and then had nothing focused to press again, i.e. the whole
	 *  control gone. Both mutations below reorder the strip, so both need it. */
	async function refocus(a: RowAction) {
		await tick();
		stripEl?.querySelector<HTMLElement>(`[data-act="${a}"]`)?.focus();
	}
	async function toggle(a: RowAction) {
		commit(enabled.includes(a) ? enabled.filter((x) => x !== a) : [...enabled, a]);
		await refocus(a);
	}
	/** Move an ENABLED action `dir` steps along the order. A switched-off one has no order to move in. */
	async function move(a: RowAction, dir: -1 | 1) {
		const i = enabled.indexOf(a);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= enabled.length) return;
		const next = [...enabled];
		next[i] = next[j];
		next[j] = a;
		commit(next);
		await refocus(a);
	}

	// ---- Pointer drag-to-reorder ------------------------------------------------------------
	// The NpUpNext grip idiom (quick-260618-ink), turned on its side: that list drags vertically
	// between <li>s, this strip drags horizontally between slots. Custom pointer events, NOT native
	// HTML5 drag-and-drop, for the same reason — DnD is unusable on touch.
	//
	// One difference: there is no separate grip handle here, because the chip is only ~36px wide and
	// a handle beside it would double the control's width for the sake of a 12px target. The chip is
	// both the drag handle and the toggle, disambiguated the way the app already does it elsewhere
	// (swipeAction's WR-01 rule): a gesture that never passes SLOP is a TAP and the click stands; one
	// that does is a DRAG and the trailing click is suppressed.
	const SLOP = 6;
	let stripEl = $state<HTMLElement | null>(null);
	let dragFrom = $state(-1); // index within `enabled` while dragging (-1 = idle)
	let dragOver = $state(-1);
	let dragX = $state(0);
	// Plain fields, NOT $state — nothing reads them reactively, and the click suppressor must be
	// readable from the click handler that fires immediately after pointerup.
	let dragStartX = 0;
	let dragMoved = false;
	let suppressClick = false;

	/** Which enabled slot sits under client-X `x`, by measuring the rendered chips. */
	function slotIndexAt(x: number): number {
		if (!stripEl) return dragFrom;
		const chips = stripEl.querySelectorAll<HTMLElement>('[data-on="true"]');
		for (let i = 0; i < chips.length; i++) {
			const r = chips[i].getBoundingClientRect();
			if (x < r.left + r.width / 2) return i;
		}
		return chips.length - 1;
	}

	function down(e: PointerEvent, a: RowAction) {
		const i = enabled.indexOf(a);
		if (i < 0 || enabled.length < 2) return; // nothing to reorder against
		dragFrom = i;
		dragOver = i;
		dragStartX = e.clientX;
		dragX = 0;
		dragMoved = false;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function pmove(e: PointerEvent) {
		if (dragFrom < 0) return;
		const dx = e.clientX - dragStartX;
		if (!dragMoved && Math.abs(dx) < SLOP) return; // still a tap
		dragMoved = true;
		dragX = dx;
		dragOver = slotIndexAt(e.clientX);
	}
	function up() {
		if (dragFrom < 0) return;
		if (dragMoved) {
			suppressClick = true; // WR-01: the trailing click must not also toggle the chip
			if (dragOver >= 0 && dragOver !== dragFrom) {
				const next = [...enabled];
				const [moved] = next.splice(dragFrom, 1);
				next.splice(dragOver, 0, moved);
				commit(next);
			}
		}
		dragFrom = -1;
		dragOver = -1;
		dragX = 0;
	}
	function click(a: RowAction) {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		toggle(a);
	}
	function keydown(e: KeyboardEvent, a: RowAction) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault(); // otherwise the arrow scrolls the settings page instead
		move(a, e.key === 'ArrowLeft' ? -1 : 1);
	}
</script>

<div class="cfg-row" class:no-anim={settings.reduceMotion} bind:this={stripEl}>
	<span class="cfg-art" aria-hidden="true"></span>
	<span class="cfg-meta" aria-hidden="true">
		<span class="cfg-title">{title}</span>
		<span class="cfg-sub">{artist}</span>
	</span>
	{#each slots as a (a)}
		{@const on = enabled.includes(a)}
		{@const pos = enabled.indexOf(a) + 1}
		<button
			class="slot"
			class:on
			class:lifted={on && enabled.indexOf(a) === dragFrom}
			class:over={on && enabled.indexOf(a) === dragOver && dragOver !== dragFrom}
			data-act={a}
			data-on={on}
			aria-pressed={on}
			aria-label={on
				? t('settings.rowButtonOn', { name: labelOf(a), pos, total: enabled.length })
				: t('settings.rowButtonOff', { name: labelOf(a) })}
			title={labelOf(a)}
			style:transform={on && enabled.indexOf(a) === dragFrom && dragX ? `translateX(${dragX}px)` : undefined}
			onpointerdown={(e) => down(e, a)}
			onpointermove={pmove}
			onpointerup={up}
			onpointercancel={up}
			onclick={() => click(a)}
			onkeydown={(e) => keydown(e, a)}
		>
			{#if a === 'like'}<Heart size={18} fill={on ? 'currentColor' : 'none'} />{:else}<Download size={18} />{/if}
		</button>
	{/each}
	<!-- The ⋮ is FIXED: not toggleable, not reorderable, and shown here precisely so the user can
	     SEE that it is always there — which is what makes switching everything else off safe. -->
	<span class="cfg-opt" aria-label={t('menu.options')} title={t('menu.options')}>
		<MoreVertical size={18} />
	</span>
</div>

<style>
	/* Mirrors SongRow's `.srow` geometry (gap 12, 44px art, 36px actions, 44px menu) so the strip
	   reads as the row it configures. The rank column is omitted — it is not configurable. */
	.cfg-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 6px;
		border-radius: 8px;
		background: var(--color-surface);
	}
	.cfg-art {
		flex: none;
		width: calc(44px * var(--cover-scale, 1));
		height: calc(44px * var(--cover-scale, 1));
		border-radius: 6px;
		background: linear-gradient(145deg, hsl(258 55% 38%), hsl(298 55% 22%));
	}
	.cfg-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.cfg-title,
	.cfg-sub {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		line-height: 1.3;
	}
	.cfg-title {
		font-size: calc(0.875rem * var(--fs-title, 1));
		font-weight: 600;
	}
	.cfg-sub {
		font-size: calc(0.75rem * var(--fs-artist, 1));
		color: var(--color-text-muted);
	}
	.slot {
		flex: none;
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		padding: 0;
		background: none;
		border: 1px dashed transparent;
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		cursor: grab;
		/* The chip is a drag target: keep the horizontal axis, let the page still pan vertically. */
		touch-action: pan-y;
	}
	/* A switched-off action still shows, dimmed and outlined, so it has a place to be switched back
	   on from — and so the strip never silently loses a control the user cannot find again. */
	.slot:not(.on) {
		opacity: 0.4;
		border-color: var(--color-border);
		cursor: pointer;
	}
	.slot.on {
		color: var(--color-primary);
	}
	.slot:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	.slot.lifted {
		opacity: 0.85;
		cursor: grabbing;
		z-index: 1;
	}
	.slot.over {
		border-color: var(--color-primary);
		border-style: dashed;
	}
	/* Only the SPRING-BACK is animated; the drag itself follows the finger 1:1 (direct
	   manipulation, not decoration). Reduced motion drops the spring and the chip simply lands.
	   BOTH gates: the OS query AND the in-app `settings.reduceMotion` flag, which is the one
	   tapBounce says is authoritative here (a user who ticked the box gets it regardless of OS). */
	@media (prefers-reduced-motion: no-preference) {
		.cfg-row:not(.no-anim) .slot:not(.lifted) {
			transition: transform 0.15s ease;
		}
	}
	.cfg-opt {
		flex: none;
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		color: var(--color-text-muted);
	}
</style>
