<script lang="ts">
	// quick-261024-about — the Now Playing "About" tab: the video's YouTube description,
	// always available for a ytmusic track (Hector's call — a first-class tab, not just a
	// lyrics fallback). Fetches lazily from /api/ytmusic/description/:videoId on mount and
	// on track change; loading / empty / error states are explicit, error offers a retry
	// (the edge 503s when YouTube's gate is up — transient, so a retry is honest).
	import { RotateCcw } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { t } from '$lib/i18n';
	import { fetchDescription, splitDescription, type DescriptionResult } from '$lib/services/description';

	let result = $state<DescriptionResult | null>(null);
	let forId = $state<string | null>(null);
	let attempt = $state(0);

	const videoId = $derived(player.current?.source === 'ytmusic' ? (player.current?.songid ?? null) : null);
	const segments = $derived(result?.kind === 'ok' ? splitDescription(result.text) : []);

	$effect(() => {
		const id = videoId;
		void attempt;
		if (!id) {
			result = null;
			forId = null;
			return;
		}
		if (forId === id && result !== null) return; // already loaded for this track
		forId = id;
		result = null;
		const ctrl = new AbortController();
		void fetchDescription(id, ctrl.signal).then((r) => {
			if (forId === id) result = r;
		});
		return () => ctrl.abort();
	});
</script>

<div class="about">
	{#if !videoId || result === null}
		<p class="muted">{t('about.loading')}</p>
	{:else if result.kind === 'error'}
		<div class="err" role="alert">
			<p>{t('about.error')}</p>
			<button onclick={() => attempt++}><RotateCcw size={14} /> {t('video.retry')}</button>
		</div>
	{:else if result.kind === 'empty'}
		<p class="muted">{t('about.empty')}</p>
	{:else}
		<p class="text">{#each segments as seg, i (i)}{#if seg.t === 'link'}<a href={seg.href} target="_blank" rel="noopener noreferrer">{seg.s}</a>{:else}{seg.s}{/if}{/each}</p>
	{/if}
</div>

<style>
	.about { padding: 14px 4px 30px; }
	.about .text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; font-size: 14px; color: var(--color-text); margin: 0; }
	.about .text a { color: var(--color-accent, #e5484d); text-decoration: underline; text-underline-offset: 2px; }
	.about .muted { color: var(--color-text-muted); font-size: 13.5px; margin: 0; }
	.about .err { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
	.about .err p { margin: 0; font-size: 13.5px; color: var(--color-text); }
	.about .err button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text); font-size: 12.5px; cursor: pointer; }
</style>
