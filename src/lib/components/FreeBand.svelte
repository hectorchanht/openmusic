<script lang="ts">
	// quick-261118-free: the slim Home band linking to /free ("Free forever. No ads. See how we do
	// it →"). Placement is decided by the home page (right AFTER the first rendered shelf — Hector
	// via Muse, 2026-11-18); this component is only the band. A plain <a href> so it works with
	// SvelteKit's client router, keyboard and long-press "open in new tab" alike.
	import { Sparkles, ChevronRight } from '@lucide/svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';
</script>

<a class="free-band" href="/free" use:tapBounce data-testid="free-band">
	<Sparkles size={18} class="fb-icon" />
	<span class="fb-txt">
		<span class="fb-title">{t('free.bandTitle')}</span>
		<span class="fb-cta">{t('free.bandCta')}</span>
	</span>
	<ChevronRight size={18} class="dir-flip" />
</a>

<style>
	.free-band {
		display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box;
		margin: 6px 0 18px; padding: 12px 14px; min-height: 48px;
		border-radius: 14px; border: 1px solid color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
		background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface));
		color: var(--color-text); text-decoration: none;
	}
	.free-band :global(.fb-icon) { color: var(--color-primary); flex: none; }
	.fb-txt { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 8px; }
	.fb-title { font-weight: 700; font-size: 0.9375rem; }
	.fb-cta { font-size: 0.8125rem; color: var(--color-text-muted); }
	@media (hover: hover) { .free-band:hover { background: color-mix(in srgb, var(--color-primary) 16%, var(--color-surface)); } }
</style>
