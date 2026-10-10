<script lang="ts">
	// 2026 廣東歌年選 — the free Cantopop pack (Hector 2026-10-10: free for everyone, no paywall).
	// A static curated list; each row is a stub that resolves through the normal multi-source
	// search on tap (the charts/top stub pattern), so the pack ships no audio of its own.
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SongRow from '$lib/components/SongRow.svelte';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import { KPOP_2026, PACK_META_KPOP_2026 } from '$lib/data/kpop-2026';
	import type { PackSong } from '$lib/data/cantopop-2026';
	import { resolveStub } from '$lib/services/discovery';
	import { player } from '$lib/stores/player.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { t } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { Play, Shuffle } from '@lucide/svelte';
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
		const tr = await player.playStub(s.artist, s.title, undefined, 'kpop-2026');
		if (tr === null && player.pendingTrack == null) toast.show(t('home.unplayable'));
	}

	// quick-261010-soy2: header actions — Play from the top, Shuffle a random pick.
	// Stubs can't queue, so both go through playStub (the artist-page playArtistRandom idiom).
	async function playAll() {
		const s = KPOP_2026[0];
		if (!s) return;
		await play(s);
	}
	async function shufflePlay() {
		const s = KPOP_2026[Math.floor(Math.random() * KPOP_2026.length)];
		if (!s) return;
		await play(s);
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
	<h1>{PACK_META_KPOP_2026.title}</h1>
	<p class="sub">{PACK_META_KPOP_2026.titleEn} · {KPOP_2026.length} 首歌</p>
	<p class="desc">{PACK_META_KPOP_2026.description}</p>
	<!-- quick-261010-soy2: Play / Shuffle action bar (album-page visual language). -->
	<div class="actions">
		<button
			type="button"
			class="act play"
			aria-label={t('pack.play')}
			title={t('pack.play')}
			onclick={playAll}
			use:tapBounce
		>
			<Play size={22} fill="currentColor" />
		</button>
		<button
			type="button"
			class="act"
			aria-label={t('pack.shuffle')}
			title={t('pack.shuffle')}
			onclick={shufflePlay}
			use:tapBounce
		>
			<Shuffle size={20} />
		</button>
	</div>
</header>

<ul class="list">
	{#each KPOP_2026 as s (s.artist + s.title)}
		<li>
			<SongRow
				track={stubTrack(s)}
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
	/* quick-261010-soy2: Play / Shuffle action bar (album-page visual language). */
	.actions {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 16px;
		margin-top: 16px;
	}
	.act {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
	}
	.act.play {
		width: 56px;
		height: 56px;
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: #fff;
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
