<!-- quick-261021-menu7 (user): shared lyrics-timing toggle — used in the Fix lyrics
     picker (TrackMenu) and anywhere else the toggle is needed. Single source of truth
     for the "show/hide lyrics timing" affordance; all same-function UI reuses this. -->
<script lang="ts">
	import { lyricSyncOpen, toggleLyricSyncOpen } from '$lib/stores/lyric-offset.svelte';
	import { t } from '$lib/i18n';
	import { Timer } from '@lucide/svelte';
	import { tapBounce } from '$lib/actions/tapBounce';

	interface Props {
		/** Additional class for the button. */
		class?: string;
	}

	let { class: klass = '' }: Props = $props();
</script>

<button
	class="mi lyrics-timing-toggle {klass}"
	class:on={lyricSyncOpen()}
	aria-pressed={lyricSyncOpen()}
	onclick={toggleLyricSyncOpen}
	use:tapBounce
>
	<Timer size={18} />
	{lyricSyncOpen() ? t('menu.lyricsTimingHide') : t('menu.lyricsTiming')}
</button>

<style>
	.lyrics-timing-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 12px 16px;
		background: none;
		border: none;
		border-radius: 8px;
		color: var(--color-text);
		font-size: 0.9375rem;
		cursor: pointer;
		text-align: left;
	}
	.lyrics-timing-toggle.on {
		color: var(--color-accent, #1db954);
	}
	.lyrics-timing-toggle:active {
		background: rgba(255, 255, 255, 0.06);
	}
</style>
