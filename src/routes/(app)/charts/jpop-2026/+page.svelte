<script lang="ts">
	// 2026 廣東歌年選 — the free Cantopop pack (Hector 2026-10-10: free for everyone, no paywall).
	// A static curated list; each row is a stub that resolves through the normal multi-source
	// search on tap (the charts/top stub pattern), so the pack ships no audio of its own.
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SongRow from '$lib/components/SongRow.svelte';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import YearSelector from '$lib/components/YearSelector.svelte';
	import { JPOP_2026, PACK_META_JPOP_2026 } from '$lib/data/jpop-2026';
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
	// quick-261023-bulklock: bulk ZIP downloads are a supporter perk.
	import { goto } from '$app/navigation';
	// quick-261010-posthog: pack_download_started when the supporter bulk-download begins.
	import { track } from '$lib/posthog';
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
		const tr = await player.playStub(s.artist, s.title, undefined, 'jpop-2026');
		// quick-261024-sets: install the pack UNPINNED — the Up-next sourcing setting for this context
		// decides: 'generated' (default) regenerates the tail from this song, a user's
		// 'same-list' choice keeps the pack. No sameList pin anywhere outside album/artist.
		if (tr) player.setListQueue(packQueue(JPOP_2026), 'jpop-2026');
		if (tr === null && player.pendingTrack == null) toast.show(t('home.unplayable'));
	}

	// quick-261010-soy2: header actions — Play the pack from the top, Shuffle the pack.
	// quick-261015-playall: the pack installs as lazy name-only stub tracks (zero network;
	// they resolve when they reach the front).
	// quick-261024-sets (Hector 2026-10-24): NO sameList pin any more — the install is unpinned, so the
	// Up-next sourcing setting decides what Up Next becomes: 'generated' (the default for
	// every non-album/artist context) regenerates the tail from the first song; a user who
	// set this pack's context to 'same-list' in Settings → Playback keeps the whole pack.
	function packQueue(list: PackSong[], at = -1, real: Track | null = null): Track[] {
		return list
			.map((s, i) => (i === at && real ? real : nameStub(s.artist, s.title)))
			.filter((tr): tr is Track => tr !== null);
	}
	async function playAll() {
		const list = JPOP_2026;
		if (!list.length) return;
		const first = await player.playStub(list[0].artist, list[0].title, undefined, 'jpop-2026');
		if (first) player.setListQueue(packQueue(list, 0, first), 'jpop-2026');
		else if (player.pendingTrack == null) toast.show(t('home.unplayable'));
	}
	async function shufflePlay() {
		// quick-261015-shuffleall: Shuffle starts from a shuffled COPY (NOT
		// player.toggleShuffle() — that only reorders the tail and is a no-op when shuffle
		// is already on). quick-261024-sets: the shuffled pack installs unpinned, same as Play.
		const shuffled = shuffle(JPOP_2026);
		if (!shuffled.length) return;
		const first = await player.playStub(shuffled[0].artist, shuffled[0].title, undefined, 'jpop-2026');
		if (first) player.setListQueue(packQueue(shuffled, 0, first), 'jpop-2026');
		else if (player.pendingTrack == null) toast.show(t('home.unplayable'));
	}
	// quick-261023-chartfree: chart packs stay free for everyone (Hector).
	let downloading = $state(false);
	async function downloadAll() {
		if (downloading) return;
		downloading = true;
		// quick-261010-posthog: a real bulk download is starting.
		track('pack_download_started', { pack: 'jpop-2026' });
		try {
			const stubs = JPOP_2026.map((s) => ({ artist: s.artist, title: s.title }));
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
			await downloadPackTracks(resolved, { artist: 'OpenMusic', album: t('pack.title.jpop') });
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

<!-- Year picker: scrollable year pills; other years open the songs-of-year hub route. -->
<YearSelector region="jpop" year={2026} />

<header class="hero">
	<h1>{t('pack.title.jpop')}</h1>
	<p class="sub">{PACK_META_JPOP_2026.titleEn} · {JPOP_2026.length} {t('pack.songs')}</p>
	<p class="desc">{t('pack.desc', { region: t('region.jpop') })}</p>
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
	{#each JPOP_2026 as s (s.artist + s.title)}
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
