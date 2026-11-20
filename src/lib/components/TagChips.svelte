<script lang="ts">
	// Display-only tag-chip row (Phase 8, D-05/D-06). Renders up to the first 5 tags.
	// Built Phase-9-ready: pass `onTagClick` to make the chips tappable→discovery
	// WITHOUT a rewrite — when provided each chip renders as a <button>, otherwise as
	// a non-interactive <span> styled identically. Renders NOTHING when tags is empty
	// (no empty row). The DISPLAYED label is gated through names.dnLastfm (lastfmLang +
	// lastfmSkip): target=off ⇒ original tag, else non-whitelisted tags translate when
	// results arrive (originals shown immediately). The ORIGINAL tag is still used for
	// onTagClick/aria/keying so discovery searches the real tag string.
	import { t } from '$lib/i18n';
	import { names } from '$lib/stores/names.svelte';

	interface Props {
		tags: string[];
		/** Phase 9: when set, chips become tappable buttons (discovery). Default = display-only. */
		onTagClick?: (tag: string) => void;
	}
	let { tags, onTagClick }: Props = $props();

	const MAX = 5;
	const shown = $derived((tags ?? []).slice(0, MAX));
</script>

{#if shown.length}
	<div class="chips" role="list" aria-label={t('nowplaying.lastfmTags')}>
		{#each shown as tag (tag)}
			<span class="chip-item" role="listitem">
				{#if onTagClick}
					<button class="chip" type="button" aria-label={tag} onclick={() => onTagClick?.(tag)}>{names.dnLastfm(tag)}</button>
				{:else}
					<span class="chip" aria-label={tag}>{names.dnLastfm(tag)}</span>
				{/if}
			</span>
		{/each}
	</div>
{/if}

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 6px 2px 0;
	}
	/* Semantic listitem wrapper (ARIA: direct child of role=list). Sizes to its chip. */
	.chip-item {
		display: inline-flex;
		max-width: 100%;
		min-width: 0;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		font: inherit;
		font-size: 0.75rem;
		line-height: 1;
		padding: 6px 10px;
		border-radius: var(--radius-full);
		background: var(--color-surface-2);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		white-space: nowrap;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Interactive variant (Phase 9): identical look, tap affordance. */
	button.chip {
		cursor: pointer;
		transition: color 0.15s ease, border-color 0.15s ease;
	}
	button.chip:hover,
	button.chip:active {
		color: var(--color-primary);
		border-color: var(--color-primary);
	}
</style>
