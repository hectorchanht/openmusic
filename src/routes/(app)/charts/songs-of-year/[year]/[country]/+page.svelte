<script lang="ts">
	// Songs of the Year pack page — /charts/songs-of-year/[year]/[country].
	// Data comes from the songs-of-year registry (lazy per-year import); combos without
	// verified data render a "coming soon" state, never fabricated songs.
	// Row pattern mirrors the static 2026 pack pages (stubTrack + resolveStub + SongRow),
	// plus index={rank} since a year-end chart's rank is the point.
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SongRow from '$lib/components/SongRow.svelte';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import type { PackSong } from '$lib/data/cantopop-2026';
	import { loadSoyYear, soyHasData } from '$lib/data/songs-of-year/registry';
	import { resolveStub } from '$lib/services/discovery';
	import { player } from '$lib/stores/player.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { t } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { Play, Shuffle, Download } from '@lucide/svelte';
	import { downloadAlbum as downloadPackTracks } from '$lib/services/download-album';
	import { goto } from '$app/navigation';
	import DownloadGateModal from '$lib/components/DownloadGateModal.svelte';
	import { isSupporter } from '$lib/config/sponsored';
	import type { Track } from '$lib/sources/types';

	// Defensive param decode (same idiom as charts/countries/[country]).
	const yearNum = $derived(Number(page.params.year));
	const country = $derived.by(() => {
		const raw = page.params.country ?? '';
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	});

	const valid = $derived(soyHasData(yearNum, country));

	let songs = $state<PackSong[]>([]);
	let loadFailed = $state(false);

	$effect(() => {
		const y = yearNum;
		const c = country;
		if (!soyHasData(y, c)) {
			songs = [];
			return;
		}
		loadFailed = false;
		let cancelled = false;
		loadSoyYear(y)
			.then((m) => {
				if (cancelled) return;
				songs = m[c] ?? [];
				if (!songs.length) loadFailed = true;
			})
			.catch(() => {
				if (!cancelled) loadFailed = true;
			});
		return () => {
			cancelled = true;
		};
	});

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
		const tr = await player.playStub(s.artist, s.title, undefined, 'songs-of-year');
		if (tr === null && player.pendingTrack == null) toast.show(t('home.unplayable'));
	}

	async function playAll() {
		const s = songs[0];
		if (!s) return;
		await play(s);
	}
	async function shufflePlay() {
		const s = songs[Math.floor(Math.random() * songs.length)];
		if (!s) return;
		await play(s);
	}
	// Download all — tip-jar supporters only (same gate as the 2026 pack pages).
	let downloading = $state(false);
	let gateOpen = $state(false);
	async function downloadAll() {
		if (!isSupporter()) {
			gateOpen = true;
			return;
		}
		if (downloading) return;
		downloading = true;
		try {
			const stubs = songs.map((s) => ({ artist: s.artist, title: s.title }));
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
			await downloadPackTracks(resolved, { artist: 'OpenMusic', album: `${country} ${yearNum}` });
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

{#if !valid || loadFailed}
	<header class="hero">
		<h1>{country} · {page.params.year}</h1>
		<p class="sub">{t('lastfm.comingSoon')}</p>
		<div class="actions">
			<button type="button" class="act back" onclick={() => goto('/charts/songs-of-year')} use:tapBounce>
				{t('common.back')}
			</button>
		</div>
	</header>
{:else}
	<header class="hero">
		<span class="free-badge">免費 FREE</span>
		<h1>{country} · {yearNum}</h1>
		<p class="sub">{t('soy.yearEndSub')} · {songs.length} {t('pack.songs')}</p>
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
		{#each songs as s, i (s.artist + s.title)}
			<li>
				<SongRow
					track={stubTrack(s)}
					index={i + 1}
					smartArtist
					resolve={() => resolveStub(s.artist, s.title).catch(() => null)}
					onplay={() => play(s)}
					onrequestmenu={() => openMenu(s)}
				/>
			</li>
		{/each}
	</ul>

	<TrackMenu track={menuTrack} open={menuOpen} loading={menuLoading} onclose={() => (menuOpen = false)} />

	<DownloadGateModal bind:open={gateOpen} />
{/if}

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
	.act.back {
		width: auto;
		height: auto;
		border-radius: 999px;
		padding: 10px 24px;
		font-size: 0.9rem;
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
