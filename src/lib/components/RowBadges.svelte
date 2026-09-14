<script lang="ts">
	// Shared PASSIVE row indicators (quick-260723): liked ♥ + downloaded ✓ glyphs for ANY song row,
	// plus a third state — downloaded-but-its-file-is-gone, which swaps the ✓ for a red alert (34-D-06).
	// Non-interactive (NO onclick) — they only SIGNAL state (library.isLiked / library.isDownloaded,
	// keyed on the track's RESOLVED uid). Like/download INITIATION stays in the ⋮ menu / DownloadControl.
	// Safe to nest inside a row <button> (plain <span>s, not interactive elements). One shared component
	// so every surface (home/search/artist/up-next/related) shows identical indicators with no style
	// drift (D-08 one-shared-thing philosophy). Renders NOTHING unless the row is liked and/or downloaded.
	//
	// Identity note: only rows carrying a real source uid (`<source>:<id>`) match — name-stub rows with
	// uid:'' (e.g. the charts DiscoveryTrack lists) can never light up, so they intentionally omit this.
	import { Heart, Check, CircleAlert } from '@lucide/svelte';
	import { library } from '$lib/stores/library.svelte';
	import { t } from '$lib/i18n';

	let { uid, size = 14 }: { uid: string; size?: number } = $props();

	const liked = $derived(!!uid && library.isLiked(uid));
	const downloaded = $derived(!!uid && library.isDownloaded(uid));
	// 34-D-06: an imported song whose file the OS no longer has is still a download — it stays
	// listed and is MARKED, never silently dropped. Same badge slot, so no row reflows.
	const unavailable = $derived(!!uid && library.isUnavailable(uid));
</script>

{#if liked || downloaded}
	<span class="row-badges">
		{#if liked}
			<span class="rb liked" aria-label={t('menu.liked')} title={t('menu.liked')}><Heart {size} fill="currentColor" /></span>
		{/if}
		{#if downloaded && unavailable}
			<span class="rb unavailable" aria-label={t('menu.unavailable')} title={t('menu.unavailable')}><CircleAlert {size} /></span>
		{:else if downloaded}
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
	/* 34-D-06 (UI-SPEC Contract 8): the pre-existing in-system literal used by /settings/data
	   .item.danger — no --color-danger token exists and this phase does not add one; full opacity
	   against the check's 0.6 is deliberate (this state must catch the eye). */
	.rb.unavailable {
		color: #ff7a90;
		opacity: 1;
	}
</style>
