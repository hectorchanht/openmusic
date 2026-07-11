<script lang="ts">
	// VersionPicker (Phase 26-04, VERSIONS-01): a mobile-first sheet listing the per-source
	// variants of ONE song — the pre-dedupe search rows that dedupeBest collapses away. Tapping a
	// variant plays THAT exact source's Track. No new API calls: `versions` is a slice of the
	// already-fetched search result set (see search/+page.svelte groupVariants wiring).
	//
	// Mirrors TrackMenu's sheet idiom EXACTLY (scrim + .menu + fly + dragClose + focusTrap + the
	// overlays open/dismiss $effect with untrack), so the OS/browser Back gesture closes the sheet
	// via the SINGLE dismiss path (host $effect cleanup is the ONLY overlays.dismiss caller).
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { names } from '$lib/stores/names.svelte';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';
	import { SOURCES } from '$lib/sources/registry';
	import type { Track } from '$lib/sources/types';

	let {
		versions,
		open,
		onclose,
		onpick
	}: {
		versions: Track[];
		open: boolean;
		onclose: () => void;
		onpick: (t: Track) => void;
	} = $props();

	// Registry-driven human label for a source id (never names a source inline). Falls back to the
	// raw source id if the registry has no label for it.
	function sourceLabel(v: Track): string {
		return SOURCES[v.source]?.label ?? v.source;
	}
	// Quality label with a graceful fallback (many search stubs carry no quality pre-resolve).
	function qualityLabel(v: Track): string {
		return v.qualityLabel || v.quality || t('versions.unknownQuality');
	}

	function pick(v: Track) {
		onpick(v);
		onclose();
	}

	// ---- back-gesture wiring (SINGLE dismiss path) ----
	// DEP IS `open` ONLY (mirrors TrackMenu): open pushes one history state; the $effect CLEANUP is
	// the SOLE overlays.dismiss caller, so scrim / drag / back-gesture all converge on one dismiss
	// site and history depth stays balanced. untrack the overlays calls so a sibling overlay
	// push/pop doesn't churn this effect (cleanup+reopen).
	$effect(() => {
		if (open) {
			untrack(() => overlays.open('versionpicker', () => onclose()));
			return () => untrack(() => overlays.dismiss('versionpicker'));
		}
	});
</script>

{#if open}
	<button class="scrim" aria-label={t('menu.close')} onclick={onclose}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose }} use:focusTrap>
		<div class="menu-head">{t('versions.title')}</div>
		{#if versions.length === 0}
			<p class="empty">{t('versions.empty')}</p>
		{:else}
			{#each versions as v (v.uid)}
				<button class="mi" onclick={() => pick(v)} use:tapBounce>
					<span class="src">{sourceLabel(v)}</span>
					<span class="ver-meta">
						<span class="ver-title">{names.dnTitle(v.title)}</span>
						<span class="ver-sub">{names.dnArtist(v.artist)} · {qualityLabel(v)}</span>
					</span>
				</button>
			{/each}
		{/if}
	</div>
{/if}

<style>
	/* Sheet chrome mirrors TrackMenu (Pitfall-safe: same tokens, same fly, same mobile sizing). */
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, 0.45); border: none; }
	.menu {
		position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81;
		background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px;
		padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
		max-height: 90vh; overflow-y: auto;
	}
	.menu-head { font-size: calc(13px * var(--fs-title, 1)); color: var(--color-text-muted); padding: 8px 10px; }
	.empty { color: var(--color-text-muted); font-size: 14px; padding: 8px 12px 12px; margin: 0; }
	.mi {
		width: 100%; display: flex; align-items: center; gap: 12px; min-height: 44px;
		background: none; border: none; color: var(--color-text); font-size: 15px; padding: 12px;
		border-radius: 10px; cursor: pointer; text-align: left;
	}
	.mi:hover { background: var(--color-surface); }
	/* Source chip — a fixed-width leading label so the rows align on the variant metadata. */
	.src {
		flex: 0 0 auto; min-width: 56px; text-align: center; font-size: 12px; font-weight: 700;
		color: var(--color-primary); text-transform: uppercase; letter-spacing: 0.03em;
		padding: 4px 8px; border-radius: 8px; background: var(--color-surface);
	}
	.ver-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.ver-title { font-size: 14px; font-weight: 600; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.ver-sub { font-size: 12px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
