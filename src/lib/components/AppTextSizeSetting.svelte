<script lang="ts">
	// App text size (the ONE global font scale, settings.fontScaleApp) — extracted from
	// Settings → Appearance to the top-level Settings page, directly below App language
	// (Hector 2026-10-24: it is a general, every-day control, not an appearance-editor
	// surface like the Song rows / Now Playing replica editors, which stay in Appearance).
	// Single shared component per the shared-component rule — the slider markup, bounds and
	// live-commit write live ONLY here; Appearance no longer carries a copy.
	//
	// Commits LIVE like every other size control in the app: each input writes the store and
	// persists; save() → applyTheme() pushes the CSS custom properties to <html>, so the
	// Settings page itself re-renders at the size being dragged — the page is the preview.
	// The host page owns settings.load() (both /settings and /settings/appearance call it on
	// mount), so this component deliberately does not load.
	import { Type } from '@lucide/svelte';
	import { settings, FONT_SCALE_MIN, FONT_SCALE_MAX } from '$lib/stores/settings.svelte';
	import SettingHint from '$lib/components/SettingHint.svelte';
	import { t } from '$lib/i18n';

	function setApp(v: number) {
		settings.fontScaleApp = v;
		settings.save();
	}
	const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
</script>

<section class="app-text-size">
	<h2>
		<Type size={15} /> {t('settings.fontSizeApp')}<SettingHint
			label={t('settings.fontSizeApp')}
			text={t('settings.fontSizeAppDesc')}
		/>
	</h2>
	<div class="lab">
		<span>{t('settings.fontSizeApp')}</span><span class="val">{settings.fontScaleApp}%</span>
	</div>
	<input
		type="range"
		min={FONT_SCALE_MIN}
		max={FONT_SCALE_MAX}
		step="5"
		value={settings.fontScaleApp}
		oninput={(e) => setApp(num(e))}
		aria-label={t('settings.fontSizeApp')}
	/>
	<p class="note">{t('settings.appearanceNote')}</p>
</section>

<style>
	/* Card chrome matches the Settings page's promoted General section (.general) so the
	   extracted control sits naturally directly below it; the inner type styles are carried
	   verbatim from the Appearance page section this replaces. */
	.app-text-size { margin: 8px 0 4px; padding: 14px; border: 1px solid var(--color-border); border-radius: 14px; background: var(--color-surface-1); }
	.app-text-size h2 { position: relative; display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 14px; }
	.lab { position: relative; display: flex; align-items: baseline; justify-content: space-between; font-size: 0.875rem; margin-bottom: 6px; }
	.val { color: var(--color-primary); font-variant-numeric: tabular-nums; font-size: 0.8125rem; }
	input[type='range'] { width: 100%; accent-color: var(--color-primary); }
	.note { color: var(--color-text-muted); font-size: 0.75rem; margin: 4px 0 0; }
</style>
