<script lang="ts">
	// Shared PASSIVE row indicators (quick-260723): liked ♥ + downloaded ✓ glyphs for ANY song row,
	// plus a third state — downloaded-but-its-file-is-gone, which swaps the ✓ for a red alert (34-D-06).
	// Non-interactive (NO onclick) — they only SIGNAL state (library.isLiked / library.isDownloaded,
	// keyed on the track's RESOLVED uid). Like/download INITIATION stays in the ⋮ menu / DownloadControl.
	// Safe to nest inside a row <button> (plain <span>s, not interactive elements). One shared component
	// so every surface (home/search/artist/up-next/related) shows identical indicators with no style
	// drift (D-08 one-shared-thing philosophy). Renders NOTHING unless the row is liked and/or downloaded.
	//
	// quick-260919-l9e (D-5) — A PASSIVE BADGE YIELDS TO AN ACTIVE CONTROL. When the row itself renders
	// the button for a state (SongRow's inline ♥ / DownloadControl), the host passes hideLiked /
	// hideDownloaded and this component drops that glyph: two hearts for one fact is a bug, and
	// DownloadControl already draws the ✓ and the 34-D-06 ⚠ itself, so nothing is lost. Both default
	// false, so every pre-existing call site is byte-identical.
	//
	// Identity note: only rows carrying a real source uid (`<source>:<id>`) match — name-stub rows with
	// uid:'' (e.g. the charts DiscoveryTrack lists) can never light up, so they intentionally omit this.
	import { Heart, Check, CircleAlert } from '@lucide/svelte';
	import { library } from '$lib/stores/library.svelte';
	import { downloadState } from '$lib/components/download-state';
	import { t } from '$lib/i18n';

	let {
		uid,
		size = 14,
		hideLiked = false,
		hideDownloaded = false
	}: { uid: string; size?: number; hideLiked?: boolean; hideDownloaded?: boolean } = $props();

	// quick-260919-l9e (D-5): the suppression is gated at the $derived, NOT just in the markup — a
	// badge the row will never draw must not hold a live library subscription either (D-7: these
	// rows render 24+ at a time). quick-260919-v71 keeps that gate OUTSIDE the helper call for the
	// same reason: a suppressed badge must still subscribe to nothing.
	const liked = $derived(!hideLiked && !!uid && library.isLiked(uid));
	// 34-D-06: an imported song whose file the OS no longer has is still a download — it stays
	// listed and is MARKED, never silently dropped. Same badge slot, so no row reflows.
	//
	// quick-260919-v71: this used to be a bare `library.isDownloaded(uid)`, so the passive ✓ lit up
	// MID-download — isDownloaded is true from addDownload onward, which runs PRE-fetch by design so
	// a failed save keeps the song (DL-BUG-01). `downloading` is tested first via the shared helper,
	// so this badge and DownloadControl can never disagree about what in-flight looks like.
	const dl = $derived(
		!hideDownloaded && !!uid
			? downloadState({
					downloading: library.downloading.has(uid),
					downloaded: library.isDownloaded(uid),
					unavailable: library.isUnavailable(uid)
				})
			: 'idle'
	);
</script>

{#if liked || dl === 'downloaded' || dl === 'unavailable'}
	<span class="row-badges">
		{#if liked}
			<span class="rb liked" aria-label={t('menu.liked')} title={t('menu.liked')}><Heart {size} fill="currentColor" /></span>
		{/if}
		<!-- quick-260919-v71: a 'busy' row draws NO download glyph — this badge is PASSIVE, and the
		     active DownloadControl (or the TrackMenu bar) owns the in-flight visual. -->
		{#if dl === 'unavailable'}
			<span class="rb unavailable" aria-label={t('menu.unavailable')} title={t('menu.unavailable')}><CircleAlert {size} /></span>
		{:else if dl === 'downloaded'}
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
