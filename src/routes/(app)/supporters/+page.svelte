<script lang="ts">
	// /supporters — the public Supporters wall (2026-10-24).
	//
	// Lists ONLY the tippers who explicitly opted in on the SupporterSheet
	// verify step (display name + optional one-line message, stored server-side
	// in the SUPPORTERS_DB wall — see GET /api/sponsored/supporters). Nothing
	// here is inferred: no names from Gumroad, no emails, ever. Until the
	// first tipper opts in, the wall is an honest empty state.
	//
	// English literals, like the other sponsored surfaces (SupporterSheet's
	// verify section, the SponsoredStrip) — this page is not part of the
	// translated UI chrome.
	import { onMount } from 'svelte';
	import { Heart } from '@lucide/svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { support } from '$lib/stores/support.svelte';
	import { apiFetch } from '$lib/services/api-base';
	import { tapBounce } from '$lib/actions/tapBounce';

	type WallEntry = { name: string; message?: string; month: string };

	let entries = $state<WallEntry[]>([]);
	let loadState = $state<'loading' | 'ready' | 'error'>('loading');

	onMount(async () => {
		support.load();
		try {
			const res = await apiFetch('/api/sponsored/supporters');
			const data = (await res.json()) as { ok?: boolean; supporters?: WallEntry[] };
			entries = data?.supporters ?? [];
			// ok:false (no DB / D1 error) degrades to the empty wall, not an
			// error page — but a transport failure is worth its own line.
			loadState = 'ready';
		} catch {
			loadState = 'error';
		}
	});
</script>

<svelte:head><title>Supporters · OpenMusic</title></svelte:head>

<PageHeader title="Supporters" />

<section class="wall">
	<p class="lead">
		OpenMusic is free for everyone, forever. These listeners tipped to keep the
		servers running and the music coming — thank you, every one of you. ☕
	</p>

	<button class="cta" onclick={() => support.openSheet()} use:tapBounce>
		<Heart size={18} fill="currentColor" /> Become a supporter
	</button>

	{#if loadState === 'loading'}
		<p class="note">Loading the wall…</p>
	{:else if loadState === 'error'}
		<p class="note">The wall could not be loaded right now — please try again later.</p>
	{:else if entries.length === 0}
		<div class="empty">
			<p class="empty-title">No names here yet — be the first.</p>
			<p class="note">
				Tip any amount, then verify your license key in the supporter sheet
				and tick “Add my name to the public Supporters wall”. Your name
				could be the first one on this page.
			</p>
		</div>
	{:else}
		<ul class="entries">
			{#each entries as e (e.name + e.month + (e.message ?? ''))}
				<li class="entry">
					<div class="who">
						<span class="name">{e.name}</span>
						{#if e.month}<span class="month">{e.month}</span>{/if}
					</div>
					{#if e.message}<p class="msg">“{e.message}”</p>{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.wall { padding: 4px 16px 32px; max-width: 680px; margin: 0 auto; }
	.lead { font-size: 0.9375rem; line-height: 1.55; color: var(--color-text-muted); margin: 8px 0 0; }
	.cta { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; margin-top: 16px; padding: 13px; border-radius: 12px; font-size: 0.9375rem; font-weight: 700; background: var(--color-primary); color: #fff; border: none; cursor: pointer; }
	.note { font-size: 0.875rem; line-height: 1.55; color: var(--color-text-muted); margin: 16px 0 0; }
	.empty { margin-top: 20px; background: var(--color-surface); border: 1px dashed var(--color-border); border-radius: 14px; padding: 18px 16px; }
	.empty-title { font-size: 1rem; font-weight: 700; color: var(--color-text); margin: 0; }
	.empty .note { margin-top: 8px; }
	.entries { list-style: none; margin: 20px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
	.entry { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 14px; padding: 14px 16px; }
	.who { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
	.name { font-size: 0.9375rem; font-weight: 700; color: var(--color-text); overflow-wrap: anywhere; }
	.month { font-size: 0.75rem; color: var(--color-text-muted); flex: 0 0 auto; }
	.msg { margin: 6px 0 0; font-size: 0.875rem; font-style: italic; line-height: 1.5; color: var(--color-text-muted); overflow-wrap: anywhere; }
</style>
