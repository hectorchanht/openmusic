<script lang="ts">
	// Songs of the Year pack page — /charts/songs-of-year/[year]/[country].
	// Data comes from the songs-of-year registry (lazy per-year import); combos without
	// verified data render a "coming soon" state, never fabricated songs.
	// Row pattern mirrors the static 2026 pack pages (stubTrack + resolveStub + SongRow),
	// plus index={rank} since a year-end chart's rank is the point.
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SoyYearStrip from '$lib/components/SoyYearStrip.svelte';
	import SongRow from '$lib/components/SongRow.svelte';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import type { PackSong } from '$lib/data/cantopop-2026';
	import { loadSoyYear, loadSoySources, soyHasData, type SoySource } from '$lib/data/songs-of-year/registry';
	import { resolveStub } from '$lib/services/discovery';
	import { nameStub } from '$lib/services/similar';
	import { shuffle } from '$lib/services/shuffle';
	import { player } from '$lib/stores/player.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { t } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { Play, Shuffle, Download } from '@lucide/svelte';
	import { downloadAlbum as downloadPackTracks } from '$lib/services/download-album';
	import { goto } from '$app/navigation';
	import DownloadGateModal from '$lib/components/DownloadGateModal.svelte';
	import { isSupporter } from '$lib/config/sponsored';
	// quick-261010-posthog: pack_download_started when the supporter bulk-download begins.
	import { track } from '$lib/posthog';
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

	// Year selector — stay in the same country: tapping another year jumps
	// straight to that year's pack for this country (Hector 2026-10-11).
	// 2026 maps to the curated region packs; years without this country's
	// data fall back to the hub year view.
	const PACK_2026: Record<string, string> = {
		'Hong Kong': '/charts/cantopop-2026',
		Taiwan: '/charts/mandopop-2026',
		Japan: '/charts/jpop-2026',
		'South Korea': '/charts/kpop-2026',
		'United States': '/charts/western-2026',
		'United Kingdom': '/charts/western-2026'
	};
	function selectYear(y: string) {
		const yn = Number(y);
		if (yn === yearNum) return;
		if (yn === 2026) {
			goto(PACK_2026[country] ?? '/charts/songs-of-year');
			return;
		}
		if (soyHasData(yn, country)) {
			goto(`/charts/songs-of-year/${yn}/${encodeURIComponent(country)}`);
			return;
		}
		goto(`/charts/songs-of-year?year=${y}`);
	}

	const valid = $derived(soyHasData(yearNum, country));

	let songs = $state<PackSong[]>([]);
	let loadFailed = $state(false);
	// quick-261010-soysrc: chart source attribution for the footer (name + URL per dataset).
	let srcInfo = $state<SoySource | null>(null);

	$effect(() => {
		const y = yearNum;
		const c = country;
		if (!soyHasData(y, c)) {
			songs = [];
			srcInfo = null;
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
		loadSoySources(y)
			.then((s) => {
				if (!cancelled) srcInfo = s[c] ?? null;
			})
			.catch(() => {
				if (!cancelled) srcInfo = null;
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

	// Whole-list queue (album-page quick-260919-alb idiom): track 1 plays instantly via
	// playStub, the rest install as lazy name-only stub tracks (zero network; they resolve
	// when they reach the front). `sameList` keeps the installed list through the fresh-play tail.
	function packQueue(list: PackSong[], at = -1, real: Track | null = null): Track[] {
		return list
			.map((s, i) => (i === at && real ? real : nameStub(s.artist, s.title)))
			.filter((tr): tr is Track => tr !== null);
	}
	async function playAll() {
		if (!songs.length) return;
		const first = await player.playStub(songs[0].artist, songs[0].title, undefined, 'songs-of-year', {
			sameList: true
		});
		if (first) player.setListQueue(packQueue(songs, 0, first), 'songs-of-year');
		else if (player.pendingTrack == null) toast.show(t('home.unplayable'));
	}
	async function shufflePlay() {
		// Shuffle installs the WHOLE pack as Up Next in shuffled order.
		const shuffled = shuffle(songs);
		if (!shuffled.length) return;
		const first = await player.playStub(shuffled[0].artist, shuffled[0].title, undefined, 'songs-of-year', {
			sameList: true
		});
		if (first) player.setListQueue(packQueue(shuffled, 0, first), 'songs-of-year');
		else if (player.pendingTrack == null) toast.show(t('home.unplayable'));
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
		// quick-261010-posthog: the gate already passed — a real bulk download is starting.
		track('pack_download_started', { pack: `soy-${yearNum}-${country}` });
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

<SoyYearStrip active={String(yearNum)} onselect={selectYear} />

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

	<DownloadGateModal bind:open={gateOpen} />

	<!-- quick-261010-soysrc: chart source attribution — where this page's data came from. -->
	{#if srcInfo}
		<footer class="src">
			{t('pack.source')}: <a href={srcInfo.url} target="_blank" rel="noopener noreferrer">{srcInfo.name}</a>
		</footer>
	{/if}
{/if}

<style>
	.hero {
		padding: 24px 16px 8px;
		text-align: center;
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
	/* quick-261010-soysrc: muted source-attribution footer. */
	.src {
		color: var(--color-text-muted);
		font-size: 0.72rem;
		text-align: center;
		padding: 0 16px 40px;
	}
	.src a {
		color: inherit;
		text-decoration: underline;
	}
</style>
