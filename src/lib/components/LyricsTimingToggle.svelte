<!-- quick-261021-menu7 (user): shared lyrics-timing toggle — used in the Fix lyrics
     picker (TrackMenu) and anywhere else the toggle is needed. Single source of truth
     for the "show/hide lyrics timing" affordance.
     quick-261021-menu9 (user): looks like the settings page — uses SettingPicker with
     visual preview mockups, same as the translation settings toggles. -->
<script lang="ts">
	import { lyricSyncOpen, toggleLyricSyncOpen } from '$lib/stores/lyric-offset.svelte';
	import { t } from '$lib/i18n';
	import SettingPicker from '$lib/components/SettingPicker.svelte';
</script>

{#snippet timingShow()}
	<div class="mock">
		<div class="mock-text">[00:12.34] Hello world</div>
		<div class="mock-text dim">[00:15.67] Second line here</div>
	</div>
{/snippet}

{#snippet timingHide()}
	<div class="mock">
		<div class="mock-text">Hello world</div>
		<div class="mock-text dim">Second line here</div>
	</div>
{/snippet}

<SettingPicker
	variant="preview"
	label={t('menu.lyricsTiming')}
	options={[
		{ v: 'show', label: t('settings.optShow'), preview: timingShow },
		{ v: 'hide', label: t('settings.optHide'), preview: timingHide }
	]}
	value={lyricSyncOpen() ? 'show' : 'hide'}
	onpick={(v) => { if ((v === 'show') !== lyricSyncOpen()) toggleLyricSyncOpen(); }}
/>

<style>
	.mock {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px;
	}
	.mock-text {
		font-size: 0.75rem;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mock-text.dim {
		opacity: 0.6;
	}
</style>
