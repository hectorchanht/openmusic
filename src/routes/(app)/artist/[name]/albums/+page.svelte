<script lang="ts">
	// Discography page (quick-260831-qkx) — MERGED with the Discography Pack (quick-261023-discmerge,
	// Hector: one entrance for everything album-related).
	//
	// This page is now the SINGLE album entrance: the pack hero (artist + album count + year range),
	// the pack actions (Play all / Shuffle all / Download all with PER-ALBUM progress indicators /
	// Liner notes) and the full filterable discography list live together here. The old
	// `/artist/[name]/pack` route redirects here so no link dies.
	//
	// The artist page's album shelf deliberately shows albums + EPs only — Coldplay's real Deezer
	// discography is 123 releases (17 albums, 5 EPs, 101 singles), and an unfiltered horizontal
	// shelf is precisely the "not official album" noise that was reported. Nothing is hidden
	// though: this page lists EVERYTHING, newest-first, with a type filter PRESET to albums + EPs
	// (user decision, 2026-09-01) and a type label on every row.
	//
	// Source + ordering come from the same helpers the shelf uses ($lib/services/discography), so
	// there is one source of truth for "what order" and "what counts as an album".
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { BookOpen, Download, Play, Shuffle } from '@lucide/svelte';
	import { names } from '$lib/stores/names.svelte';
	import { online } from '$lib/stores/online.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { support } from '$lib/stores/support.svelte';
	import { toast as globalToast } from '$lib/stores/toast.svelte';
	import { t, type TranslationKey } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { marquee } from '$lib/actions/marquee';
	import { loadDiscography } from '$lib/services/discography-source';
	import {
		filterByType,
		typeLabelKey,
		releaseYear,
		albumHref,
		type DiscographyEntry,
		fallbackCoverSeed,
		type DiscographyFilter
	} from '$lib/services/discography';
	// quick-260919-2jo: the shared tab-URL mechanism (F2) — `/artist/X/albums?tab=single` is now
	// a real cold-load target, and switching the filter writes it back.
	import { pickTab, syncTabUrl } from '$lib/services/url-tab';
	// Pack actions moved in here (quick-261023-discmerge): tracklist fetch + stub resolve for
	// play-all/shuffle-all/download-all, and the shared per-album download orchestrator.
	import { fetchAlbumTracklist, resolvePackTracks } from '$lib/services/discography-pack';
	import { resolveStub } from '$lib/services/discovery';
	import { downloadAlbum as downloadAlbumTracks } from '$lib/services/download-album';
	import { downloadLabel } from '$lib/services/download-label';
	import type { Track } from '$lib/sources/types';

	const name = $derived(decodeURIComponent(page.params.name ?? ''));

	let albums = $state<DiscographyEntry[]>([]);
	let albumsFor = '';
	let loading = $state(true);
	// Preset to albums + EPs (user decision) — the noise is opt-IN, not opt-out. quick-260919-2jo:
	// seeded from `?tab=`, validated against VALID_FILTERS; anything else falls back to the preset.
	const VALID_FILTERS: ReadonlySet<string> = new Set(['main', 'single', 'all']);
	let filter = $state<DiscographyFilter>(pickTab(page.url, 'tab', VALID_FILTERS, 'main'));

	const shown = $derived(filterByType(albums, filter));

	const FILTERS: { id: DiscographyFilter; key: TranslationKey }[] = [
		{ id: 'main', key: 'artist.filterMain' },
		{ id: 'single', key: 'artist.filterSingle' },
		{ id: 'all', key: 'artist.filterAll' }
	];

	// Pack header: year range of the CURRENTLY SHOWN list (respects the filter).
	const yearRange = $derived.by(() => {
		const years = shown
			.map((a) => (a.releaseDate ?? '').slice(0, 4))
			.filter((y) => /^\d{4}$/.test(y))
			.sort();
		if (!years.length) return '';
		return years[0] === years[years.length - 1] ? years[0] : `${years[0]} – ${years[years.length - 1]}`;
	});

	// ---- pack actions state (quick-261023-discmerge) ----
	let playing = $state(false);
	let linerOpen = $state(false);
	let dlRunning = $state(false);
	let dlDoneAlbums = $state(0);
	let dlTotalAlbums = $state(0);
	/** Per-album download progress, keyed by albumKeyOf. Absent = not started/finished. */
	let dlProgress = $state<Record<string, { done: number; total: number }>>({});

	// Same key shape as the album page (`${name}|${artist}|${dzid}|${mbid}`) so the
	// library.beginAlbumJob claim dedupes across pages — a download started here is also
	// "running" on the album detail page and vice versa.
	const albumKeyOf = (al: DiscographyEntry) =>
		`${al.name}|${name}|${al.id ?? ''}|${al.mbid ?? ''}`;

	// quick-261010-disco2 (moved from the pack page): Play album-by-album (in discography order),
	// or shuffle all. Plays the FIRST playable song ASAP — fetch all tracklists (metadata, fast),
	// resolve + play one song immediately, then resolve the rest in the background and expand.
	async function playAll(shuffle = false) {
		if (playing || !shown.length) return;
		playing = true;
		try {
			const list = shown;
			const stubs: { artist: string; title: string }[] = [];
			let ai = 0;
			async function albumWorker() {
				while (ai < list.length) {
					const idx = ai++;
					const tracks = await fetchAlbumTracklist(list[idx], name);
					stubs.push(...tracks);
				}
			}
			await Promise.all([albumWorker(), albumWorker(), albumWorker(), albumWorker()]);
			if (!stubs.length) {
				globalToast.show(t('home.unplayable'));
				return;
			}
			const firstIdx = shuffle ? Math.floor(Math.random() * stubs.length) : 0;
			const firstStub = stubs[firstIdx];
			const firstTrack = await resolveStub(firstStub.artist, firstStub.title).catch(() => null);
			if (!firstTrack) {
				globalToast.show(t('home.unplayable'));
				return;
			}
			player.setQueue([firstTrack], 'discography-pack');
			await player.play(firstTrack, { context: 'discography-pack' });
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

	// quick-261023-discmerge: Download ALL — the filtered list, album by album, SEQUENTIALLY
	// (the qq detail host rate-limits bursts; parallel albums would trip it — see
	// download-album.ts quick-260930-x3q). Each album: fetch tracklist → resolve stubs (the
	// album page's resolveAll idiom: library.stubTrack memory so a second run is instant) →
	// the shared downloadAlbum orchestrator with a per-album onProgress that paints the row.
	// Never throws; a failed album is skipped and the run continues. Web: one zip per album
	// (the existing 40-D-03 behaviour); native: persists into Music/OpenMusic/<Artist>/<Album>/.
	async function downloadAll() {
		// donor-wall-ui 2026-10-14: bulk download is the SUPPORTER perk, same gate as the
		// album page — non-supporters get the donor wall, not a dead button.
		if (!support.isSupporter) {
			support.openSheet();
			return;
		}
		if (dlRunning || !shown.length) return;
		const list = shown.slice(); // snapshot — a filter switch mid-run must not mutate the run
		dlRunning = true;
		dlDoneAlbums = 0;
		dlTotalAlbums = list.length;
		dlProgress = {};
		const artist = names.dnArtist(name);
		globalToast.show(t('toast.downloading', { label: artist }));
		try {
			for (const al of list) {
				const key = albumKeyOf(al);
				// Claim-once per album (library store): a second tap — here or on the album
				// page — is a no-op while this album is in flight.
				if (!library.beginAlbumJob(key)) {
					dlDoneAlbums++;
					continue;
				}
				try {
					const album = names.dnTitle(al.name);
					const stubs = await fetchAlbumTracklist(al, name);
					const out: (Track | null)[] = stubs.map((s) => library.stubTrack(s.artist, s.title));
					let next = 0;
					const worker = async () => {
						for (let i = next++; i < stubs.length; i = next++) {
							if (out[i]) continue;
							const tr = await resolveStub(stubs[i].artist, stubs[i].title).catch(() => null);
							out[i] = tr;
							if (tr) library.rememberStub(stubs[i].artist, stubs[i].title, tr);
						}
					};
					await Promise.all(Array.from({ length: Math.min(4, stubs.length || 1) }, worker));
					const resolved = out.filter((tr): tr is Track => tr !== null);
					if (!resolved.length) continue; // nothing playable — skip, keep going
					dlProgress[key] = { done: 0, total: resolved.length };
					await downloadAlbumTracks(
						resolved,
						{ artist, album },
						(n, total) => {
							dlProgress[key] = { done: n, total };
						}
					);
				} catch {
					// 40-D-06 (album granularity): a failed album never aborts the run.
				} finally {
					library.endAlbumJob(key);
					delete dlProgress[key];
					dlDoneAlbums++;
				}
			}
			globalToast.show(t('pack.downloadAllDone', { saved: dlDoneAlbums, total: dlTotalAlbums }));
		} finally {
			dlRunning = false;
		}
	}

	// quick-260831-re9: source selection now lives in loadDiscography — MusicBrainz for CJK
	// artists (original-script titles, far deeper coverage), Deezer otherwise, Last.fm last.
	$effect(() => {
		const n = name;
		if (!online.isOnline) {
			loading = false;
			return;
		}
		if (n && albumsFor !== n) {
			albumsFor = n;
			albums = [];
			loading = true;
			void (async () => {
				try {
					const load = await loadDiscography(n);
					if (albumsFor !== n) return; // race guard
					albums = load.entries;
				} finally {
					if (albumsFor === n) loading = false;
				}
			})();
		}
	});
</script>

<svelte:head><title>{names.dnArtist(name)} — {t('artist.discography')}</title></svelte:head>

<PageHeader title={names.dnArtist(name)} backLabel={t('common.back')} showSettings />

<!-- quick-261023-discmerge: the pack hero, merged in — one entrance, all album functions. -->
<header class="hero">
	<p class="sub">{t('pack.albumCount', { count: shown.length })}{#if yearRange} · {yearRange}{/if}</p>
	<div class="actions">
		<button type="button" class="act" aria-label={t('pack.linerNotes')} title={t('pack.linerNotes')} onclick={() => (linerOpen = true)} use:tapBounce>
			<BookOpen size={20} />
		</button>
		<button type="button" class="act play" aria-label={t('pack.play')} title={t('pack.play')} onclick={() => playAll(false)} disabled={playing || dlRunning} use:tapBounce>
			<Play size={22} fill="currentColor" />
		</button>
		<button type="button" class="act" aria-label={t('pack.shuffle')} title={t('pack.shuffle')} onclick={() => playAll(true)} disabled={playing || dlRunning} use:tapBounce>
			<Shuffle size={20} />
		</button>
		<button
			type="button"
			class="act download"
			aria-label={t('pack.downloadAll')}
			title={t('pack.downloadAll')}
			aria-busy={dlRunning}
			disabled={dlRunning}
			onclick={downloadAll}
			use:tapBounce
		>
			<Download size={20} />
		</button>
	</div>
	{#if dlRunning}
		<p class="dl-status" role="status">{dlDoneAlbums}/{dlTotalAlbums}</p>
	{/if}
</header>

<div class="chips" role="tablist">
	{#each FILTERS as f (f.id)}
		<button
			class="chip"
			class:on={filter === f.id}
			role="tab"
			aria-selected={filter === f.id}
			onclick={() => { filter = f.id; syncTabUrl('tab', f.id, 'main'); }}
			use:tapBounce>{t(f.key)}</button
		>
	{/each}
</div>

{#if loading}
	<ul class="list">
		{#each Array(10) as _, i (i)}
			<li><span class="row" aria-hidden="true"><span class="sk sk-cover"></span><span class="sk sk-text"></span></span></li>
		{/each}
	</ul>
{:else if !shown.length}
	<p class="empty">{t('artist.discographyEmpty')}</p>
{:else}
	<ul class="list">
		{#each shown as al (al.mbid ?? al.id ?? al.name)}
			{@const key = albumKeyOf(al)}
			{@const prog = dlProgress[key]}
			<li>
				<!-- quick-260926-hze: album title + artist follow the script lock -->
				<button class="row" onclick={() => goto(names.lockUrl(albumHref(al, name)))} use:tapBounce>
					<span class="cover" style:background-image={al.image ? `url(${al.image}), ${fallbackCoverSeed(al.name)}` : fallbackCoverSeed(al.name)}></span>
					<span class="meta">
						<span class="al-name" use:marquee><span class="marquee-inner">{names.dnTitle(al.name)}</span></span>
						<span class="al-sub">
							{#if typeLabelKey(al.type)}{t(typeLabelKey(al.type) as TranslationKey)}{:else}{t('artist.albumLabel')}{/if}{#if releaseYear(al.releaseDate)}{' · ' + releaseYear(al.releaseDate)}{/if}
						</span>
						{#if prog}
							<span class="dlbar" role="progressbar" aria-valuenow={prog.done} aria-valuemin={0} aria-valuemax={prog.total}>
								<span class="dlfill" style:width={`${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%`}></span>
							</span>
							<span class="dltext">{prog.done}/{prog.total}</span>
						{/if}
					</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

{#if linerOpen}
	<div class="scrim" onclick={() => (linerOpen = false)} role="presentation">
		<div class="sheet" role="dialog" aria-label={t('pack.linerNotes')} onclick={(e) => e.stopPropagation()}>
			<h2>{t('pack.linerNotes')}</h2>
			<p><strong>{names.dnArtist(name)}</strong></p>
			<p>{t('pack.albumCount', { count: shown.length })}{#if yearRange} ({yearRange}){/if}.</p>
			<p class="muted">{t('pack.linerBody')}</p>
			<button type="button" class="close" onclick={() => (linerOpen = false)} use:tapBounce>{t('common.done')}</button>
		</div>
	</div>
{/if}

<style>
	/* quick-261023-discmerge: pack hero — the single entrance's header. */
	.hero { padding: 12px 16px 4px; text-align: center; }
	.sub { color: var(--color-text-muted); font-size: 0.85rem; margin: 0; }
	.actions { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 12px; }
	.act {
		display: flex; align-items: center; justify-content: center;
		width: 44px; height: 44px; border-radius: 50%;
		border: 1px solid var(--color-border); background: var(--color-surface);
		color: var(--color-text); cursor: pointer;
	}
	.act.play { width: 56px; height: 56px; background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
	.act.download { border-color: var(--color-primary); color: var(--color-primary); }
	.act:disabled { opacity: 0.45; cursor: default; }
	.dl-status { color: var(--color-primary); font-size: 0.78rem; font-weight: 600; margin: 8px 0 0; }

	/* quick-261007-hscroll: hide the scrollbar — same idiom as .artist-tiles on /search. */
	.chips { display: flex; gap: 8px; padding: 10px 4px 4px; overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; }
	.chips::-webkit-scrollbar { display: none; width: 0; }
	.chip { flex: 0 0 auto; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--color-border); background: none; color: var(--color-text-muted); font-size: 0.8rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
	.chip.on { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }

	.list { list-style: none; margin: 8px 0 0; padding: 0 0 32px; }
	.row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 4px; background: none; border: none; color: var(--color-text); text-align: left; cursor: pointer; }
	.cover { flex: 0 0 auto; width: 56px; height: 56px; border-radius: 6px; background-size: cover; background-position: center; }
	.meta { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
	.al-name { font-size: calc(0.95rem * var(--fs-title, 1)); font-weight: 600; white-space: nowrap; overflow: hidden; }
	.al-sub { font-size: 0.78rem; color: var(--color-text-muted); }
	.empty { color: var(--color-text-muted); padding: 24px 4px; text-align: center; }

	/* quick-261023-discmerge: per-album download progress on the row. */
	.dlbar { display: block; height: 3px; border-radius: 2px; background: var(--color-surface-2); overflow: hidden; margin-top: 4px; }
	.dlfill { display: block; height: 100%; background: var(--color-primary); border-radius: 2px; transition: width 0.2s; }
	.dltext { font-size: 0.7rem; color: var(--color-primary); font-weight: 600; }

	/* Liner-notes sheet (moved from the pack page). */
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

	.sk { display: block; background: var(--color-surface); border-radius: 6px; animation: pulse 1.2s ease-in-out infinite; }
	.sk-cover { width: 56px; height: 56px; flex: 0 0 auto; }
	.sk-text { height: 14px; width: 60%; }
	@keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.9; } }
	@media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
</style>
