<!-- quick-261021-menu7 (user): shared lyrics-timing toggle — used in the Fix lyrics
     picker (TrackMenu) and anywhere else the toggle is needed. Single source of truth
     for the "show/hide lyrics timing" affordance.
     quick-261021-menu8: uses the shared MenuActionButton so it looks like a button.
     NOTE: SettingPicker preview version reverted — it broke the Pages build. The
     toggle matches the button style, not the settings preview cards. -->
<script lang="ts">
	import { lyricSyncOpen, toggleLyricSyncOpen } from '$lib/stores/lyric-offset.svelte';
	import { t } from '$lib/i18n';
	import { Timer } from '@lucide/svelte';
	import MenuActionButton from '$lib/components/MenuActionButton.svelte';
</script>

<MenuActionButton icon={Timer} onclick={toggleLyricSyncOpen}>
	{lyricSyncOpen() ? t('menu.lyricsTimingHide') : t('menu.lyricsTiming')}
</MenuActionButton>
