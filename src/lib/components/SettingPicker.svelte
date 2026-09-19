<script lang="ts" generics="V extends string">
	// quick-260919-ebi (F3) — THE one N-option settings picker. Two variants, one component:
	//
	//   variant='seg'     the existing labelled pill row (Chinese script, quality, up-next, …)
	//   variant='preview' live mini mockups the user taps to pick
	//
	// A second segmented-control implementation would itself be the defect this task exists to
	// remove, so the `seg` CSS below is lifted VERBATIM from translation/+page.svelte — the
	// quick-260919-2jo control is pixel-identical after adopting this.
	//
	// A11Y VOCABULARY, copied from the existing `.density-seg`/`.dseg-btn` on /settings/home rather
	// than invented: a wrapper role="group" + aria-label, and each option a REAL <button> with
	// aria-pressed. Real buttons are Tab-reachable and Enter/Space-operable, which is the whole
	// keyboard requirement — a roving-tabindex radiogroup would be more code and less robust.
	//
	// MOCK PRIMITIVES (the .mock-* classes below) are the shared box of parts every preview draws
	// from. They are declared :global() under the .mock wrapper this component owns, because a
	// `preview` snippet is compiled in the CALLING page's scope and would otherwise never match
	// these rules. The rules for writing one:
	//   - CSS/SVG only. No <img>, no `background-image: url(...)`, no network request. A preview
	//     that fetched a remote asset would leak a request (T-ebi-01) and break offline, for
	//     cosmetics.
	//   - Every colour is a THEME TOKEN, so dark and light are both correct with no per-theme
	//     branch. The one sanctioned exception is the Theme preview itself — see
	//     /settings/appearance, where the two cards are painted in literal palette values on
	//     purpose so the dark card looks dark while the light theme is active.
	//   - Any transition is wrapped in `@media (prefers-reduced-motion: no-preference)`.
	//   - Mocks are aria-hidden="true"; the option button's aria-label is the accessible name.
	import type { Component, Snippet } from 'svelte';
	import { tapBounce } from '$lib/actions/tapBounce';

	let {
		options,
		value,
		onpick,
		label,
		variant = 'seg',
		disabled = false,
		iconOnly = false
	}: {
		options: { v: V; label: string; icon?: Component<{ size?: number }>; preview?: Snippet }[];
		value: V;
		onpick: (v: V) => void;
		/** Group accessible name — the setting's own label. */
		label: string;
		variant?: 'seg' | 'preview';
		disabled?: boolean;
		/** seg only: render the option ICON alone. `label` still names the button for a11y. */
		iconOnly?: boolean;
	} = $props();
</script>

{#if variant === 'preview'}
	<div class="previews" role="group" aria-label={label}>
		{#each options as o (o.v)}
			<button
				class="card"
				class:on={value === o.v}
				aria-pressed={value === o.v}
				aria-label={o.label}
				{disabled}
				onclick={() => onpick(o.v)}
				use:tapBounce
			>
				<span class="mock" aria-hidden="true">
					{#if o.preview}{@render o.preview()}{/if}
				</span>
				<span class="cap">{o.label}</span>
			</button>
		{/each}
	</div>
{:else}
	<div class="seg" class:disabled role="group" aria-label={label}>
		{#each options as o (o.v)}
			<button
				class:on={value === o.v}
				class:icon-only={iconOnly}
				aria-pressed={value === o.v}
				aria-label={o.label}
				{disabled}
				onclick={() => onpick(o.v)}
				use:tapBounce
			>
				{#if o.icon}<o.icon size={iconOnly ? 12 : 15} />{/if}
				{#if !iconOnly}{o.label}{/if}
			</button>
		{/each}
	</div>
{/if}

<style>
	/* ---- variant='seg' — carried VERBATIM from translation/+page.svelte ------------------- */
	.seg {
		display: inline-flex;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 3px;
		gap: 3px;
	}
	.seg.disabled {
		opacity: 0.5;
	}
	.seg button {
		background: none;
		border: none;
		color: var(--color-text-muted);
		padding: 7px 16px;
		border-radius: 999px;
		font-size: 13px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.seg button.on {
		background: var(--color-primary);
		color: #fff;
	}
	.seg button:disabled {
		cursor: default;
	}
	/* The compact icon-only form the per-context up-next rows use (was `.upnext-row .seg button`). */
	.seg button.icon-only {
		padding: 6px 12px;
		font-size: 12px;
	}

	/* ---- variant='preview' — a responsive row of tappable mockup cards ------------------- */
	.previews {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.card {
		flex: 1 1 130px;
		min-width: 120px;
		max-width: 220px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: var(--color-surface-2);
		/* A 2px ring even when OFF, in a transparent colour, so selecting never reflows the row. */
		border: 2px solid transparent;
		outline: 1px solid var(--color-border);
		outline-offset: -3px;
		border-radius: var(--radius-md, 12px);
		padding: 10px;
		cursor: pointer;
		color: var(--color-text);
	}
	.card.on {
		border-color: var(--color-primary);
	}
	.card:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.cap {
		font-size: 12px;
		color: var(--color-text-muted);
		text-align: center;
	}
	.card.on .cap {
		color: var(--color-primary);
	}

	/* ---- the shared mock primitives ------------------------------------------------------
	   :global() because `preview` snippets are compiled in the CALLING page's scope. Every rule
	   is nested under .mock, which this component owns, so nothing leaks app-wide. */
	.mock {
		display: block;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 6px);
		padding: 6px;
		overflow: hidden;
	}
	/* A full app-chrome frame: header on top, body in the middle, a docked bar at the bottom. */
	.mock :global(.mock-chrome) {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 5px;
		height: 74px;
	}
	/* A horizontal bar — a header strip, or the docked mini player. */
	.mock :global(.mock-bar) {
		display: flex;
		align-items: center;
		gap: 4px;
		background: var(--color-surface-2);
		border-radius: 4px;
		padding: 3px 4px;
		flex: none;
	}
	/* A stand-in for a line of text. Width comes from the caller (style:width). */
	.mock :global(.mock-line) {
		display: block;
		height: 4px;
		border-radius: 2px;
		background: var(--color-text);
		opacity: 0.75;
		flex: none;
	}
	.mock :global(.mock-line.dim) {
		background: var(--color-text-muted);
		opacity: 0.85;
	}
	.mock :global(.mock-line.accent) {
		background: var(--color-primary);
		opacity: 1;
	}
	/* A line of REAL (tiny) text, for the previews whose whole point is a label — the FLAC badge
	   sitting next to a song title, or artist-vs-lyric in the mini bar. Untranslated literals only
	   (a format name, a static demo song), so this never needs 15 versions. */
	.mock :global(.mock-text) {
		font-size: 7px;
		line-height: 1.3;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.mock :global(.mock-text.dim) {
		color: var(--color-text-muted);
	}
	/* A cover tile. */
	.mock :global(.mock-tile) {
		display: block;
		aspect-ratio: 1 / 1;
		border-radius: 3px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		flex: none;
	}
	/* A tiny pill — the FLAC badge, the Randomize chip, the search pill. */
	.mock :global(.mock-badge) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 6px;
		line-height: 1;
		letter-spacing: 0.3px;
		padding: 2px 4px;
		border-radius: 999px;
		background: var(--color-primary);
		color: #fff;
		flex: none;
	}
	.mock :global(.mock-badge.ghost) {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	/* Generic row/column helpers so a preview snippet never needs its own CSS. */
	.mock :global(.mock-row) {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.mock :global(.mock-col) {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		flex: 1;
	}
	.mock :global(.mock-grid) {
		display: grid;
		gap: 3px;
	}

	/* Motion is OPT-IN behind no-preference (T-ebi-03): every mock is static by default, so a
	   reduce-motion user sees a correct still preview rather than a blank card. */
	@media (prefers-reduced-motion: no-preference) {
		.card {
			transition: border-color 0.15s ease;
		}
	}
</style>
