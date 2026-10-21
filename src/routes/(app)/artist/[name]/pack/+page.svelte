<script lang="ts">
	// Discography Pack — dynamic complete discography for ANY artist (Hector 2026-10-10).
	// Reuses the artist page's loadDiscography (MusicBrainz for CJK).
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { getDiscographyPack, fetchAlbumTracklist, resolvePackTracks, type PackAlbum } from '$lib/services/discography-pack';
	import { resolveStub } from '$lib/services/discovery';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { Download, BookOpen, Play, Shuffle } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { player } from '$lib/stores/player.svelte';
	import { toast as globalToast } from '$lib/stores/toast.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { downloadAlbum as downloadAlbumTracks } from '$lib/services/download-album';
	import { downloadLabel } from '$lib/services/download-label';
	import DownloadControl from '$lib/components/DownloadControl.svelte';
	import { nameStub } from '$lib/services/similar';

	const artistName = $derived(decodeURIComponent(page.params.name ?? ''));

	let albums = $state<PackAlbum[]>([]);
	let loading = $state(true);
	let linerOpen = $state(false);
	let playing = $state(false);

	$effect(() => {
		const n = artistName;
		if (!n) return;
		loading = true;
		getDiscographyPack(n)
			.then((a) => {
				albums = a;
			})
			.finally(() => {
				loading = false;
			});
	});

	const yearRange = $derived.by(() => {
		const years = albums
			.map((a) => (a.releaseDate ?? '').slice(0, 4))
			.filter((y) => /^\d{4}$/.test(y))
			.sort();
		if (!years.length) return '';
		return years[0] === years[years.length - 1] ? years[0] : `${years[0]} – ${years[years.length - 1]}`;
	});

	function downloadAll() {
		// quick-261020-nogate: the tip gate is cancelled (Hector) — nothing blocks here any more.
		void doDownloadAll();
	}

	let downloading = $state(false);

	// quick-261020-packdl: per-album expandable tracklists with per-song download indicators.
	// Keyed by album index; each holds its fetched stubs (null = not fetched yet).
	let expanded = $state<Set<number>>(new Set());
	let albumTracks = $state<Map<number, { artist: string; title: string }[]>>(new Map());
	let loadingTracks = $state<Set<number>>(new Set());

	async function toggleAlbum(i: number) {
		if (expanded.has(i)) {
			expanded.delete(i);
			expanded = new Set(expanded);
			return;
		}
		expanded.add(i);
		expanded = new Set(expanded);
		if (albumTracks.has(i)) return; // already fetched
		const album = albums[i];
		if (!album) return;
		loadingTracks.add(i);
		loadingTracks = new Set(loadingTracks);
		try {
			const stubs = await fetchAlbumTracklist(album, artistName);
			albumTracks.set(i, stubs);
			albumTracks = new Map(albumTracks);
		} finally {
			loadingTracks.delete(i);
			loadingTracks = new Set(loadingTracks);
		}
	}

	// Bulk download: album-by-album tracklist → resolve → download.
	// Each album is a separate library job (keyed by artist+album) so the album page
	// shows the same in-flight state if the user navigates there mid-download.
	async function doDownloadAll() {
		if (downloading || !albums.length) return;
		downloading = true;
		const artist = names.dnArtist(artistName);
		let totalSaved = 0;
		let totalTracks = 0;
		try {
			for (const album of albums) {
				const albumName = names.dnTitle(album.name);
				const key = `${artist}::${albumName}`;
				if (!library.beginAlbumJob(key)) continue; // already downloading elsewhere
				const label = downloadLabel(artist, albumName);
				try {
					globalToast.show(t('toast.downloading', { label }));
					const stubs = await fetchAlbumTracklist(album, artistName);
					if (!stubs.length) continue;
					const resolved = await resolvePackTracks(stubs);
					if (!resolved.length) continue;
					const { saved, total } = await downloadAlbumTracks(
						resolved,
						{ artist, album: albumName },
						(n, total) => globalToast.show(t('toast.albumProgress', { label, n, total }))
					);
					totalSaved += saved;
					totalTracks += total;
				} finally {
					library.endAlbumJob(key);
				}
			}
			globalToast.show(t('toast.albumSaved', { label: artist, saved: totalSaved, total: totalTracks }));
		} finally {
			downloading = false;
		}
	}

	// quick-261010-disco2: Play album-by-album (in discography order), or shuffle all.
	// quick-261010-disco3: play the FIRST playable song ASAP — fetch all tracklists
	// (metadata, fast), resolve + play one song immediately, then resolve the rest
	// in the background and expand the queue.
	async function playAll(shuffle = false) {
		if (playing || !albums.length) return;
		playing = true;
		try {
			// 1. Fetch all album tracklists in parallel (metadata only — fast).
			const stubs: { artist: string; title: string }[] = [];
			let ai = 0;
			async function albumWorker() {
				while (ai < albums.length) {
					const idx = ai++;
					const tracks = await fetchAlbumTracklist(albums[idx], artistName);
					(albums[idx] as PackAlbum).tracks = tracks;
				}
			}
			await Promise.all([albumWorker(), albumWorker(), albumWorker(), albumWorker()]);
			for (const a of albums) {
				if (a.tracks) stubs.push(...a.tracks);
			}
			if (!stubs.length) {
				globalToast.show(t('home.unplayable'));
				return;
			}
			// 2. Resolve ONE song and play it immediately.
			const firstIdx = shuffle ? Math.floor(Math.random() * stubs.length) : 0;
			const firstStub = stubs[firstIdx];
			const firstTrack = await resolveStub(firstStub.artist, firstStub.title).catch(() => null);
			if (!firstTrack) {
				globalToast.show(t('home.unplayable'));
				return;
			}
			player.setQueue([firstTrack], 'discography-pack');
			await player.play(firstTrack, { context: 'discography-pack' });
			// 3. Resolve the rest in the background, then expand the queue.
			const remaining = stubs.filter((_, i) => i !== firstIdx);
			void resolvePackTracks(remaining).then((rest) => {
				if (!rest.length) return;
				let queue = [firstTrack, ...rest];
				if (shuffle) {
					const tail = queue.slice(1);
					for (let i = tail.length - 1; i > 0; i--) {
						const j = Math.floor(Math.random() * (i + 1));
						[tail[i], tail[j]] = [tail[j], tail[i]];
					}
					queue = [queue[0], ...tail];
				}
				player.setQueue(queue, 'discography-pack');
			});
		} finally {
			playing = false;
		}
	}
</script>

<PageHeader backLabel={t('common.back')} showSettings />

<header class="hero">
	<h1>{names.dnArtist(artistName)}</h1>
	<p class="sub">Discography Pack · {albums.length} albums{#if yearRange} · {yearRange}{/if}</p>
	<div class="actions">
		<button type="button" class="act" aria-label="Liner notes" title="Liner notes" onclick={() => (linerOpen = true)} use:tapBounce>
			<BookOpen size={20} />
		</button>
		<button type="button" class="act play" aria-label={t('pack.play')} title={t('pack.play')} onclick={() => playAll(false)} disabled={playing} use:tapBounce>
			<Play size={22} fill="currentColor" />
		</button>
		<button type="button" class="act" aria-label={t('pack.shuffle')} title={t('pack.shuffle')} onclick={() => playAll(true)} disabled={playing} use:tapBounce>
			<Shuffle size={20} />
		</button>
		<button
			type="button"
			class="act download"
			aria-label="Download all"
			aria-busy={downloading}
			disabled={downloading}
			title="Download all"
			onclick={downloadAll}
			use:tapBounce
		>
			{#if downloading}<span class="row-spinner motion-always"></span>{:else}<Download size={20} />{/if}
		</button>
	</div>
</header>

{#if loading}
	<p class="loading">{t('common.loading')}</p>
{:else}
	<ul class="albums">
		{#each albums as a, i (a.mbid ?? a.id ?? a.name)}
			<li>
				<div class="album-row">
					<button type="button" class="album" onclick={() => goto(`/album/${encodeURIComponent(a.name)}?artist=${encodeURIComponent(artistName)}${a.mbid ? `&mbid=${a.mbid}` : ''}${a.id ? `&dzid=${a.id}` : ''}`)} use:tapBounce>
						{#if a.image}
							<img src={a.image} alt="" loading="lazy" />
						{:else}
							<span class="noimg" aria-hidden="true">{a.name.slice(0, 1)}</span>
						{/if}
						<span class="meta">
							<span class="title">{names.dnTitle(a.name)}</span>
							<span class="year">{(a.releaseDate ?? '').slice(0, 4)}{a.type ? ` · ${a.type}` : ''}</span>
						</span>
					</button>
					<button type="button" class="expand" aria-label={expanded.has(i) ? 'Collapse' : 'Expand'} aria-expanded={expanded.has(i)} onclick={() => toggleAlbum(i)} use:tapBounce>
						<span class="chev" class:open={expanded.has(i)}>›</span>
					</button>
				</div>
				{#if expanded.has(i)}
					<div class="tracklist">
						{#if loadingTracks.has(i)}
							<p class="muted">Loading…</p>
						{:else if albumTracks.get(i)?.length}
							<ul>
								{#each albumTracks.get(i) ?? [] as stub, j (j)}
									{@const stubTrack = nameStub(stub.artist, stub.title, a.image)}
									<li class="track-row">
										<span class="t-num">{j + 1}</span>
										<span class="t-title">{names.dnTitle(stub.title)}</span>
										{#if stubTrack}
											<DownloadControl track={stubTrack} />
										{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="muted">No tracklist available.</p>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if linerOpen}
	<div class="scrim" onclick={() => (linerOpen = false)} role="presentation">
		<div class="sheet" role="dialog" aria-label="Liner notes" onclick={(e) => e.stopPropagation()}>
			<h2>Liner Notes</h2>
			<p><strong>{names.dnArtist(artistName)}</strong></p>
			<p>Complete discography: {albums.length} albums{#if yearRange} ({yearRange}){/if}.</p>
			<p class="muted">Curated from MusicBrainz. Tap any album for its tracklist and download.</p>
			<button type="button" class="close" onclick={() => (linerOpen = false)} use:tapBounce>{t('common.done')}</button>
		</div>
	</div>
{/if}

<style>
	.hero { padding: 24px 16px 8px; text-align: center; }
	.hero h1 { font-size: calc(1.6rem * var(--fs-title, 1)); margin: 0; }
	.sub { color: var(--color-text-muted); font-size: 0.85rem; margin: 6px 0 0; }
	.actions { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 16px; }
	.act {
		display: flex; align-items: center; justify-content: center;
		width: 44px; height: 44px; border-radius: 50%;
		border: 1px solid var(--color-border); background: var(--color-surface);
		color: var(--color-text); cursor: pointer;
	}
	.act.play { width: 56px; height: 56px; background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
	.act.download { border-color: var(--color-primary); color: var(--color-primary); }
	.loading { text-align: center; color: var(--color-text-muted); padding: 32px; }
	.albums { list-style: none; margin: 16px 0 0; padding: 0 8px 32px; display: grid; gap: 8px; }
	.album {
		display: flex; align-items: center; gap: 12px; width: 100%;
		padding: 8px; border: none; background: none; cursor: pointer; text-align: left;
		border-radius: 8px;
	}
	.album img, .noimg {
		width: 56px; height: 56px; border-radius: 6px; object-fit: cover; flex-shrink: 0;
		background: var(--color-surface); display: flex; align-items: center; justify-content: center;
		font-size: 1.5rem; color: var(--color-text-muted);
	}
	.meta { min-width: 0; display: flex; flex-direction: column; }
	.title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.year { font-size: 0.8rem; color: var(--color-text-muted); }
	.scrim {
		position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 50;
		display: flex; align-items: flex-end; justify-content: center;
	}
	.sheet {
		background: var(--color-bg); border-radius: 16px 16px 0 0; padding: 24px;
		max-width: 480px; width: 100%; max-height: 70vh; overflow-y: auto;
	}
	.sheet h2 { margin: 0 0 12px; }
	.muted { color: var(--color-text-muted); font-size: 0.85rem; }
	.close {
		margin-top: 16px; padding: 10px 24px; border-radius: 8px;
		background: var(--color-primary); color: #fff; border: none; cursor: pointer;
	}
	/* quick-261020-packdl: expandable per-album tracklist with per-song download indicators */
	.album-row { display: flex; align-items: stretch; gap: 4px; }
	.album-row .album { flex: 1; min-width: 0; }
	.expand {
		flex: none; width: 44px; display: flex; align-items: center; justify-content: center;
		background: none; border: none; color: var(--color-text-muted); cursor: pointer;
	}
	.chev { display: inline-block; font-size: 1.6rem; line-height: 1; transition: transform 0.2s; }
	.chev.open { transform: rotate(90deg); }
	.tracklist { padding: 4px 0 12px 56px; }
	.tracklist ul { list-style: none; margin: 0; padding: 0; }
	.track-row {
		display: flex; align-items: center; gap: 10px;
		padding: 8px 0; border-bottom: 1px solid var(--color-border);
		font-size: 0.9rem;
	}
	.t-num { flex: none; width: 24px; color: var(--color-text-muted); font-size: 0.8rem; text-align: right; }
	.t-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
