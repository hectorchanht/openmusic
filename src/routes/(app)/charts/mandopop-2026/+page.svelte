<script lang="ts">
	// 2026 廣東歌年選 — the free Cantopop pack (Hector 2026-10-10: free for everyone, no paywall).
	// A static curated list; each row is a stub that resolves through the normal multi-source
	// search on tap (the charts/top stub pattern), so the pack ships no audio of its own.
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SongRow from '$lib/components/SongRow.svelte';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import { MANDOPOP_2026, PACK_META_MANDOPOP_2026 } from '$lib/data/mandopop-2026';
	import type { PackSong } from '$lib/data/cantopop-2026';
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
		const tr = await player.playStub(s.artist, s.title, undefined, 'mandopop-2026');
		if (tr === null && player.pendingTrack == null) toast.show(t('home.unplayable'));
	}

	// quick-261010-soy2: header actions — Play the whole pack from the top, Shuffle the whole pack.
	// quick-261015-playall: Play installs the WHOLE pack as Up Next (the album-page
	// quick-260919-alb idiom) — track 1 plays instantly via playStub, the rest install as
	// lazy name-only stub tracks (zero network; they resolve when they reach the front).
	// `sameList` keeps the installed list through the fresh-play tail.
	function packQueue(list: PackSong[], at = -1, real: Track | null = null): Track[] {
		return list
			.map((s, i) => (i === at && real ? real : nameStub(s.artist, s.title)))
			.filter((tr): tr is Track => tr !== null);
	}
	async function playAll() {
		const list = MANDOPOP_2026;
		if (!list.length) return;
		const first = await player.playStub(list[0].artist, list[0].title, undefined, 'mandopop-2026', {
			sameList: true
		});
		if (first) player.setListQueue(packQueue(list, 0, first), 'mandopop-2026');
		else if (player.pendingTrack == null) toast.show(t('home.unplayable'));
	}
	async function shufflePlay() {
		// quick-261015-shuffleall: Shuffle installs the WHOLE pack as Up Next in shuffled
		// order (the album-page quick-260930-uy0 idiom — Shuffle passes a shuffled COPY).
		// `sameList` keeps the install through the fresh-play tail; NOT player.toggleShuffle()
		// (that only reorders the tail and is a no-op when shuffle is already on).
		const shuffled = shuffle(MANDOPOP_2026);
		if (!shuffled.length) return;
		const first = await player.playStub(shuffled[0].artist, shuffled[0].title, undefined, 'mandopop-2026', {
			sameList: true
		});
		if (first) player.setListQueue(packQueue(shuffled, 0, first), 'mandopop-2026');
		else if (player.pendingTrack == null) toast.show(t('home.unplayable'));
	}
	// quick-261010-soy4: Download all — tip-jar supporters only (same gate as discography pack).
	let downloading = $state(false);
	let gateOpen = $state(false);
	async function downloadAll() {
		// SUPPORTER CHOICE MODEL (Hector 2026-10-10): the tip-jar supporter
		// flag is dawn_supporter=1 (isSupporter()); the strip-hide flag no
		// longer implies supporter status.
		if (!isSupporter()) {
			gateOpen = true;
			return;
		}
		if (downloading) return;
		downloading = true;
		try {
			const stubs = MANDOPOP_2026.map((s) => ({ artist: s.artist, title: s.title }));
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
			await downloadPackTracks(resolved, { artist: 'OpenMusic', album: t('pack.title.mandopop') });
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
	<h1>{t('pack.title.mandopop')}</h1>
	<p class="sub">{PACK_META_MANDOPOP_2026.titleEn} · {MANDOPOP_2026.length} {t('pack.songs')}</p>
	<p class="desc">{t('pack.desc', { region: t('region.mandopop') })}</p>
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
	{#each MANDOPOP_2026 as s (s.artist + s.title)}
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

<DownloadGateModal bind:open={gateOpen} />
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
