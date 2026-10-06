<script lang="ts">
	// SettingsGear — the ONE settings shortcut for every page header (quick-261006-gear).
	//
	// The home page always had its own inline gear in `.topnav`; every other page reached
	// Settings only through the bottom nav (mobile) or the desktop rail — which is why the
	// user asked for the gear on every page's top-right corner. This component is now the
	// only place the shape is declared: a 44px circular ghost button with the Lucide Settings
	// glyph, `goto('/settings')` on tap, labelled via the existing `home.settings` key (the
	// home gear's aria-label) — no new i18n string. `use:tapBounce` sits on the button itself
	// (PageHeader D-3: never on a container holding other controls).
	import { Settings } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';
</script>

<button
	type="button"
	class="gear"
	aria-label={t('home.settings')}
	title={t('home.settings')}
	onclick={() => goto('/settings')}
	use:tapBounce><Settings size={20} /></button
>

<style>
	.gear {
		flex: none;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		background: none;
		border: none;
		color: var(--color-text);
		cursor: pointer;
		border-radius: 50%;
	}
	/* Hover-capable devices only — an ungated :hover latches a sticky ring under a held
	   finger on touch (PageHeader D-4). */
	@media (hover: hover) {
		.gear:hover {
			background: var(--color-surface-2);
		}
	}
</style>
