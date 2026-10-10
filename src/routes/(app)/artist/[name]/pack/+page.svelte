<script lang="ts">
	// Discography Pack — dynamic complete discography for ANY artist (Hector 2026-10-10).
	// Reuses the artist page's loadDiscography (MusicBrainz for CJK). The "Download all" is
	// gated for tip-jar supporters (Gumroad license verification, V2 flow).
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { getDiscographyPack, type PackAlbum } from '$lib/services/discography-pack';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { Download, BookOpen, Play, Shuffle } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import DownloadGateModal from '$lib/components/DownloadGateModal.svelte';

	const artistName = $derived(decodeURIComponent(page.params.name ?? ''));

	let albums = $state<PackAlbum[]>([]);
	let loading = $state(true);
	let linerOpen = $state(false);
	let gateOpen = $state(false);

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

	/** Tip-jar supporter check (Gumroad license V2 flow sets dawn_sponsored_hidden=1). */
	function isSupporter(): boolean {
		try {
			return localStorage.getItem('dawn_sponsored_hidden') === '1';
		} catch {
			return false;
		}
	}

	function downloadAll() {
		if (!isSupporter()) {
			gateOpen = true;
			return;
		}
		// TODO: bulk download implementation (album-by-album tracklist → resolve → zip).
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
		<button type="button" class="act play" aria-label={t('pack.play')} title={t('pack.play')} use:tapBounce>
			<Play size={22} fill="currentColor" />
		</button>
		<button type="button" class="act" aria-label={t('pack.shuffle')} title={t('pack.shuffle')} use:tapBounce>
			<Shuffle size={20} />
		</button>
		<button
			type="button"
			class="act download"
			aria-label="Download all"
			title="Download all (tip-jar supporters)"
			onclick={downloadAll}
			use:tapBounce
		>
			<Download size={20} />
		</button>
	</div>
</header>

{#if loading}
	<p class="loading">{t('common.loading')}</p>
{:else}
	<ul class="albums">
		{#each albums as a (a.mbid ?? a.id ?? a.name)}
			<li>
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

<DownloadGateModal bind:open={gateOpen} />
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
</style>
