<script lang="ts">
	// quick-261122-ugcb3 — the ONE community-lyrics list (UGC B3, brief §4), mounted in BOTH
	// Fix-lyrics pickers (TrackMenu's sheet and the NP LyricsSettingsSheet) — no per-picker copy.
	// Each community version is a labelled candidate: its class (Estimated / Synced / Unsynced) and
	// its pin count. Three verbs per version:
	//   Use      → the picker's own pick handler (pin + downloaded-file sync, unchanged) AND this
	//              listener's ONE vote for the song moves onto it (pins are the vote — the
	//              most-pinned version becomes canonical for everyone).
	//   Edit     → fork-to-edit: the shared LyricsEditor opens seeded with this version.
	//   Report   → two-tap confirm (the comments idiom); hidden locally at once, server hides at 3.
	import { Check, Flag, Mic2, Pencil, Users } from '@lucide/svelte';
	import { t } from '$lib/i18n';
	import type { Track } from '$lib/sources/types';
	import { auth } from '$lib/stores/auth.svelte';
	import { communityLyrics } from '$lib/stores/community-lyrics.svelte';
	import { parseLyrics } from '$lib/stores/lyric-script.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import MenuActionButton from '$lib/components/MenuActionButton.svelte';
	import type { CommunityVersion } from '$lib/services/community-lyrics';

	let {
		track,
		current,
		onpick,
		onfork
	}: {
		track: Track | null;
		/** the lyric the app shows now (readLyrics) — marks the matching version as current */
		current: string | null;
		onpick: (lrc: string) => void;
		onfork: (lrc: string) => void;
	} = $props();

	const fetcher = (path: string, init?: RequestInit) => auth.authedFetch(path, init ?? {});
	const uid = $derived(track?.uid ?? null);
	const versions = $derived(communityLyrics.versionsFor(uid));
	let armed = $state<string | null>(null);

	// One edge-cached GET per song per session (ensure is idempotent).
	$effect(() => {
		if (track?.uid) void communityLyrics.ensure(track);
	});

	const clsKey = (v: CommunityVersion) =>
		v.cls === 'estimated' ? 'lyricsEditor.estimated' : v.cls === 'plain' ? 'community.unsynced' : 'community.synced';

	function use(v: CommunityVersion) {
		if (!uid) return;
		onpick(v.lrc);
		void communityLyrics.pin(uid, fetcher, v.id);
	}
	function report(v: CommunityVersion) {
		if (!uid) return;
		if (armed !== v.id) {
			armed = v.id;
			return;
		}
		armed = null;
		void communityLyrics.report(uid, fetcher, v.id);
	}
</script>

{#if versions.length}
	<h3 class="grp"><Users size={14} /> {t('community.title')}</h3>
	{#each versions as v, i (v.id)}
		{@const on = v.lrc === current}
		{@const text = parseLyrics(v.lrc).map((l) => l.text.trim()).filter(Boolean).join('\n') || v.lrc}
		<div class="lyr-card" class:on>
			<div class="lyr-head">
				<span class="src">
					{#if i === 0}<span class="canon">{t('community.top')}</span>{/if}
					<span class="cls">{t(clsKey(v))}</span>
					<span class="pins">{t('community.pins', { count: v.pins })}</span>
				</span>
				{#if on}<span class="lyr-cur"><Check size={14} /> {t('menu.currentLyrics')}</span>{/if}
			</div>
			<div class="lyr-body" role="group" aria-label={t('nowplaying.lyrics')} data-no-drag>{text}</div>
			<MenuActionButton icon={Mic2} onclick={() => use(v)}>{t('menu.useTheseLyrics')}</MenuActionButton>
			<div class="row">
				<button type="button" class="mini" onclick={() => onfork(v.lrc)} use:tapBounce><Pencil size={13} /> {t('community.fork')}</button>
				<button type="button" class="mini" class:armed={armed === v.id} onclick={() => report(v)} use:tapBounce
					><Flag size={13} /> {t(armed === v.id ? 'comments.reportConfirm' : 'comments.report')}</button
				>
			</div>
		</div>
	{/each}
{/if}

<style>
	.grp { display: flex; align-items: center; gap: 6px; margin: 10px 8px 2px; font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
	.lyr-card { border: 1px solid var(--color-border); border-radius: 12px; margin: 6px 4px; overflow: hidden; }
	.lyr-card.on { border-color: var(--color-primary); }
	.lyr-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px 2px; font-size: 0.8125rem; color: var(--color-text-muted); }
	.src { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
	.canon { color: var(--color-primary); font-weight: 600; }
	.cls { border: 1px solid var(--color-border); border-radius: 999px; padding: 0 7px; font-size: 0.6875rem; }
	.pins { font-size: 0.75rem; font-variant-numeric: tabular-nums; }
	.lyr-cur { display: inline-flex; align-items: center; gap: 4px; flex: none; color: var(--color-primary); font-size: 0.75rem; white-space: nowrap; }
	.lyr-body { max-height: 7.5em; overflow-y: auto; white-space: pre-line; font-size: 0.8rem; line-height: 1.5; color: var(--color-text-muted); padding: 4px 12px; }
	.row { display: flex; gap: 8px; padding: 0 12px 10px; }
	.mini { display: inline-flex; align-items: center; gap: 4px; background: none; border: 1px solid var(--color-border); border-radius: 999px; color: var(--color-text); font: inherit; font-size: 0.75rem; padding: 4px 10px; min-height: 32px; cursor: pointer; }
	.mini.armed { border-color: var(--color-danger-text); color: var(--color-danger-text); }
</style>
