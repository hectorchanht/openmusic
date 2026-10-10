<script lang="ts">
	// 2026 廣東歌年選 — the free Cantopop pack (Hector 2026-10-10: free for everyone, no paywall).
	// A static curated list; each row is a stub that resolves through the normal multi-source
	// search on tap (the charts/top stub pattern), so the pack ships no audio of its own.
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SongRow from '$lib/components/SongRow.svelte';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import { WESTERN_2026, PACK_META_WESTERN_2026 } from '$lib/data/western-2026';
	import type { PackSong } from '$lib/data/cantopop-2026';
	import { resolveStub } from '$lib/services/discovery';
	import { player } from '$lib/stores/player.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { t } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { Play, Shuffle, Download } from '@lucide/svelte';
	import { downloadAlbum as downloadPackTracks } from '$lib/services/download-album';
	import { goto } from '$app/navigation';
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
		const tr = await player.playStub(s.artist, s.title, undefined, 'western-2026');
		if (tr === null && player.pendingTrack == null) toast.show(t('home.unplayable'));
	}

	// quick-261010-soy2: header actions — Play from the top, Shuffle a random pick.
	// Stubs can't queue, so both go through playStub (the artist-page playArtistRandom idiom).
	async function playAll() {
		const s = WESTERN_2026[0];
		if (!s) return;
		await play(s);
	}
	async function shufflePlay() {
		const s = WESTERN_2026[Math.floor(Math.random() * WESTERN_2026.length)];
		if (!s) return;
		await play(s);
	}
	// quick-261010-soy4: Download all — tip-jar supporters only (same gate as discography pack).
	let downloading = $state(false);
	async function downloadAll() {
		try {
			if (localStorage.getItem('dawn_sponsored_hidden') !== '1') {
				goto('/settings');
				return;
			}
		} catch {
			goto('/settings');
			return;
		}
		if (downloading) return;
		downloading = true;
		try {
			const stubs = WESTERN_2026.map((s) => ({ artist: s.artist, title: s.title }));
			const out: (Track | null)[] = new Array(stubs.length).fill(null);
			let next = 0;
			async function worker() {
				while (next < stubs.length) {
					const i = next++;
					try {
						out[i] = await resolveStub(stubs[i].artist, stubs[i].title);
					} catch {
						out[i] = null;
					}
				}
			}
			await Promise.all([worker(), worker(), worker(), worker()]);
			const resolved = out.filter((tr): tr is Track => tr !== null);
			if (!resolved.length) {
				toast.show(t('home.unplayable'));
				return;
			}
			await downloadPackTracks(resolved, { artist: 'OpenMusic', album: t('pack.title.western') });
		} finally {
			downloading = false;
		}
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
	<h1>{t('pack.title.western')}</h1>
	<p class="sub">{PACK_META_WESTERN_2026.titleEn} · {WESTERN_2026.length} {t('pack.songs')}</p>
	<p class="desc">{t('pack.desc', { region: t('region.western') })}</p>
	<!-- quick-261010-soy2: Play / Shuffle action bar (album-page visual language). -->
	<!-- quick-261010-soy4: Download button BEFORE Play (tip-jar supporters only). -->
	<div class="actions">
		<button
			type="button"
			class="act download"
			aria-label="Download all"
			title="Download all"
			onclick={downloadAll}
			disabled={downloading}
			use:tapBounce
		>
			<Download size={20} />
		</button>
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
	{#each WESTERN_2026 as s (s.artist + s.title)}
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
	.act.download {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
	.act.download:disabled {
		opacity: 0.5;
		cursor: wait;
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
