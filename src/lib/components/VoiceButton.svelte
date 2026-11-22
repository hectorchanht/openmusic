<script lang="ts">
	// quick-261122-voice — the big floating AI voice button. Mounted by the (app) layout on every
	// tab (hidden under NowPlaying / Car Mode / while the sheet is open). ONE tap opens the sheet
	// AND starts listening — `voice.start()` runs inside the click handler because Web Speech
	// needs the user gesture. Large (64px) and high-contrast for the design target, an elderly
	// user who has never been shown the app.
	import { Mic } from '@lucide/svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { voice } from '$lib/stores/voice.svelte';
	import { t } from '$lib/i18n';
</script>

<button
	type="button"
	class="voice-fab"
	aria-label={t('voice.button')}
	title={t('voice.button')}
	use:tapBounce
	onclick={() => voice.start()}
>
	<Mic size={30} strokeWidth={2.25} />
</button>

<style>
	.voice-fab {
		position: fixed;
		inset-inline-end: 16px;
		bottom: calc(var(--nowbar-h) + var(--tabbar-h) + 14px);
		z-index: 22; /* above nowbar (20) / tabbar (21), below sheets (80) and toasts (90) */
		width: 64px;
		height: 64px;
		border-radius: 50%;
		border: 3px solid color-mix(in srgb, var(--color-on-primary) 25%, transparent);
		background: var(--color-primary);
		color: var(--color-on-primary);
		display: grid;
		place-items: center;
		cursor: pointer;
		box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45), 0 0 0 0 color-mix(in srgb, var(--color-primary) 60%, transparent);
		animation: voice-fab-breathe 3.2s ease-in-out infinite;
	}
	.voice-fab:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 3px;
	}
	/* A slow halo so the button reads as "press me" without words. */
	@keyframes voice-fab-breathe {
		0%, 100% { box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45), 0 0 0 0 color-mix(in srgb, var(--color-primary) 55%, transparent); }
		50% { box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45), 0 0 0 10px color-mix(in srgb, var(--color-primary) 0%, transparent); }
	}
	/* The in-app Reduce-motion setting is handled globally (app.css :root[data-reduce-motion]). */
	@media (prefers-reduced-motion: reduce) {
		.voice-fab { animation: none; }
	}
	/* Desktop: the tab bar becomes the side rail — only the now-bar sits below the button. */
	@media (min-width: 1024px) {
		.voice-fab { bottom: calc(var(--nowbar-h) + 18px); }
	}
</style>
