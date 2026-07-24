<script lang="ts">
	// Shared PASSIVE row indicators (quick-260723): liked ♥ + downloaded ✓ glyphs for ANY song row.
	// Non-interactive (NO onclick) — they only SIGNAL state (library.isLiked / library.isDownloaded,
	// keyed on the track's RESOLVED uid). Like/download INITIATION stays in the ⋮ menu / DownloadControl.
	// Safe to nest inside a row <button> (plain <span>s, not interactive elements). One shared component
	// so every surface (home/search/artist/up-next/related) shows identical indicators with no style
	// drift (D-08 one-shared-thing philosophy). Renders NOTHING unless the row is liked and/or downloaded.
	//
	// Identity note: only rows carrying a real source uid (`<source>:<id>`) match — name-stub rows with
	// uid:'' (e.g. the charts DiscoveryTrack lists) can never light up, so they intentionally omit this.
	import { Heart, Check } from '@lucide/svelte';
	import { library } from '$lib/stores/library.svelte';
	import { t } from '$lib/i18n';

	let { uid, size = 14 }: { uid: string; size?: number } = $props();

	const liked = $derived(!!uid && library.isLiked(uid));
	const downloaded = $derived(!!uid && library.isDownloaded(uid));
</script>

{#if liked || downloaded}
	<span class="row-badges">
		{#if liked}
			<span class="rb liked" aria-label={t('menu.liked')} title={t('menu.liked')}><Heart {size} fill="currentColor" /></span>
		{/if}
		{#if downloaded}
			<span class="rb downloaded" aria-label={t('menu.downloaded')} title={t('menu.downloaded')}><Check {size} /></span>
		{/if}
	</span>
{/if}

<style>
	.row-badges {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.rb {
		display: grid;
		place-items: center;
	}
	/* liked heart = accent (matches TrackMenu .hd-btn.liked); downloaded check = greyed. */
	.rb.liked {
		color: var(--color-primary);
	}
	.rb.downloaded {
		color: var(--color-text-muted);
		opacity: 0.6;
	}
</style>
