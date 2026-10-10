<script lang="ts">
	// 2026 廣東歌年選 — the free Cantopop pack (Hector 2026-10-10: free for everyone, no paywall).
	// A static curated list; each row is a stub that resolves through the normal multi-source
	// search on tap (the charts/top stub pattern), so the pack ships no audio of its own.
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SongRow from '$lib/components/SongRow.svelte';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import { CANTOPOP_2026, PACK_META, type PackSong } from '$lib/data/cantopop-2026';
	import { resolveStub } from '$lib/services/discovery';
	import { player } from '$lib/stores/player.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { t } from '$lib/i18n';
	import type { Track } from '$lib/sources/types';

	function stubTrack(s: PackSong): Track {
		return {
			uid: '',
			source: 'netease',
			songid: '',
			title: s.title,
			artist: s.artist,
			album: '',
			cover: null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: '',
			displayIndex: 0
		};
	}

	async function play(s: PackSong) {
		const tr = await player.playStub(s.artist, s.title, undefined, 'cantopop-2026');
		if (tr === null && player.pendingTrack == null) toast.show(t('home.unplayable'));
	}

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);
	let menuLoading = $state(false);
	let menuGen = 0;
	async function openMenu(s: PackSong) {
		const gen = ++menuGen;
		menuTrack = stubTrack(s);
		menuLoading = true;
		menuOpen = true;
		const tr = await resolveStub(s.artist, s.title);
		if (gen !== menuGen || !menuOpen) return; // superseded / closed mid-resolve
		if (tr) {
			menuTrack = tr;
			menuLoading = false;
		} else {
			menuOpen = false;
			menuLoading = false;
		}
	}
</script>

<PageHeader backLabel={t('common.back')} showSettings />

<header class="hero">
	<span class="free-badge">免費 FREE</span>
	<h1>{PACK_META.title}</h1>
	<p class="sub">{PACK_META.titleEn} · {CANTOPOP_2026.length} 首歌</p>
	<p class="desc">{PACK_META.description}</p>
</header>

<ul class="list">
	{#each CANTOPOP_2026 as s, i (s.artist + s.title)}
		<li>
			<SongRow
				track={stubTrack(s)}
				index={i}
				smartArtist
				resolve={() => resolveStub(s.artist, s.title).catch(() => null)}
				onplay={() => play(s)}
				onrequestmenu={() => openMenu(s)}
			/>
		</li>
	{/each}
</ul>

<TrackMenu track={menuTrack} open={menuOpen} loading={menuLoading} onclose={() => (menuOpen = false)} />

<style>
	.hero {
		padding: 24px 16px 8px;
		text-align: center;
	}
	.free-badge {
		display: inline-block;
		padding: 3px 12px;
		border-radius: 999px;
		background: var(--color-primary);
		color: #fff;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		margin-bottom: 10px;
	}
	.hero h1 {
		font-size: calc(1.6rem * var(--fs-title, 1));
		margin: 0;
	}
	.sub {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		margin: 6px 0 0;
	}
	.desc {
		color: var(--color-text-muted);
		font-size: 0.8rem;
		margin: 4px 0 0;
	}
	.list {
		list-style: none;
		margin: 12px 0 0;
		padding: 0 8px 32px;
	}
	.list li {
		margin: 0;
	}
</style>
