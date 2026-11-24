<script lang="ts">
	// quick-261122-books — this component IS the Library's Books tab (廣播劇 / 有聲書 / 說書),
	// mounted under /library?tab=books only, same shape as RadioList (Your Radio): mounting is
	// what makes it lazy, the host page owns the ONE TrackMenu (rows request it via
	// `onrequestmenu`).
	//
	// The page's ONE job: resume + discover long-form listening. Continue listening is the
	// primary action. Everything that orders chapters goes through services/book-chapters.ts —
	// a flat list of scattered chapters (783, 948, 95…) is the defect this tab exists to fix.
	// No new route in v1 (the playlist-detail pin precedent): the series view is local state.
	// No new audio source: the existing searchAll fan-out already carries these catalogues.
	import { onMount } from 'svelte';
	import { BookHeadphones, Play, ChevronLeft, ChevronDown, X, Bookmark } from '@lucide/svelte';
	import { searchAll } from '$lib/services/catalog';
	import { groupSeries, sortChapters, seriesKey, seriesQuery, chaptersFrom } from '$lib/services/book-chapters';
	import { coverGradient } from '$lib/services/cover-gradient';
	import { hasHttpsScheme } from '$lib/services/url-safety';
	import { books } from '$lib/stores/books.svelte';
	import { history as playHistory } from '$lib/stores/history.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import SongRow from '$lib/components/SongRow.svelte';
	import SwipeReveal from '$lib/components/SwipeReveal.svelte';
	import type { Track } from '$lib/sources/types';
	import type { BookProgress } from '$lib/services/book-progress';
	import type { TranslationKey } from '$lib/i18n';

	let { onrequestmenu }: { onrequestmenu: (t: Track) => void } = $props();

	onMount(() => {
		// history first: a cold first visit seeds the resume rows from what was already played
		playHistory.load();
		books.load(playHistory.entries);
	});

	/** A series the view can open: identity + display + whatever chapters are already known. */
	interface OpenSeries {
		key: string;
		name: string;
		narrator: string;
		seed: Track[];
	}

	// ---- Discover: a few genre seeds, each one search fan-out grouped into series ----
	// The seeds are SEARCH TERMS in the catalogues' own language (simplified — what the CN
	// providers index), not UI copy; the chip label is the localised genre name.
	const GENRES: { q: string; label: TranslationKey }[] = [
		{ q: '有声书', label: 'books.genreAudiobook' },
		{ q: '广播剧', label: 'books.genreDrama' },
		{ q: '评书', label: 'books.genreStorytelling' }
	];
	let genre = $state<string | null>(null);
	let discoverLoading = $state(false);
	let discover = $state<{ key: string; name: string; narrator: string; chapters: Track[] }[]>([]);
	// plain field — supersedence guard, never rendered (store convention)
	let discoverGen = 0;

	async function pickGenre(q: string) {
		if (genre === q) return;
		genre = q;
		const my = ++discoverGen;
		discoverLoading = true;
		discover = [];
		try {
			const r = await searchAll(q);
			if (my !== discoverGen) return;
			discover = groupSeries(r.interleaved);
		} catch {
			if (my === discoverGen) discover = [];
		} finally {
			if (my === discoverGen) discoverLoading = false;
		}
	}

	// ---- Series view ----
	let open = $state<OpenSeries | null>(null);
	let chapters = $state<Track[]>([]);
	let chaptersLoading = $state(false);
	let page = $state(1);
	let hasMore = $state(false);
	let seriesGen = 0;

	const resumeRow = $derived<BookProgress | null>(open ? (books.progress.find((r) => r.key === open!.key) ?? null) : null);

	/** Search results that belong to THIS series: same key, or (a narrator spelled differently
	 *  across sources) the same series name when nothing matches by key. */
	function belongs(s: OpenSeries, list: Track[]): Track[] {
		const byKey = list.filter((x) => seriesKey(x) === s.key);
		if (byKey.length) return byKey;
		const nameKey = s.key.slice(0, s.key.indexOf('|'));
		return list.filter((x) => seriesKey(x).startsWith(nameKey + '|'));
	}

	async function fetchChapters(s: OpenSeries, p: number): Promise<Track[]> {
		// quick-261122-books: search the CORE title (seriesQuery) — a marketing-stuffed album
		// string returned nothing live. If nothing in that page belongs to this series, retry once
		// qualified by the narrator (a common title shared by many books).
		const q = seriesQuery(s.name);
		try {
			const r = await searchAll(q, p);
			const hit = belongs(s, r.interleaved);
			if (hit.length || !s.narrator) return hit;
			const r2 = await searchAll(`${q} ${s.narrator}`, p);
			return belongs(s, r2.interleaved);
		} catch {
			return [];
		}
	}

	async function openSeries(s: OpenSeries) {
		open = s;
		const resume = books.progress.find((r) => r.key === s.key);
		const known = resume ? [...s.seed, resume.entry as Track] : s.seed;
		chapters = sortChapters(known);
		page = 1;
		const my = ++seriesGen;
		chaptersLoading = true;
		const found = await fetchChapters(s, 1);
		if (my !== seriesGen) return;
		chapters = sortChapters([...chapters, ...found]);
		hasMore = found.length > 0;
		chaptersLoading = false;
	}

	async function loadMore() {
		if (!open || chaptersLoading) return;
		const s = open;
		const my = ++seriesGen;
		chaptersLoading = true;
		const found = await fetchChapters(s, page + 1);
		if (my !== seriesGen) return;
		page += 1;
		const before = chapters.length;
		chapters = sortChapters([...chapters, ...found]);
		hasMore = chapters.length > before;
		chaptersLoading = false;
	}

	function closeSeries() {
		seriesGen++;
		open = null;
		chapters = [];
		chaptersLoading = false;
	}

	/** Play-from-here: `ch` and every later chapter, in order, pinned (sameList) — the book is
	 *  the queue, never a generated Up Next and never shuffled. */
	function playFrom(list: Track[], ch: Track) {
		const tail = chaptersFrom(list, ch);
		player.setListQueue(tail, 'playlist');
		player.play(tail[0], { fresh: true, sameList: true });
	}

	/** Continue listening — the tab's primary action. Fetches the series' chapters (memoised
	 *  search) so Up Next is the rest of the book; with no network it still plays the chapter. */
	async function continueBook(r: BookProgress) {
		const entry = r.entry as Track;
		const s: OpenSeries = { key: r.key, name: r.name, narrator: r.narrator, seed: [entry] };
		const found = await fetchChapters(s, 1);
		playFrom(sortChapters([entry, ...found]), entry);
	}

	function coverStyle(cover: string | null | undefined, name: string): string {
		return hasHttpsScheme(cover) ? `url("${cover}")` : coverGradient(name);
	}

	function openFromProgress(r: BookProgress) {
		void openSeries({ key: r.key, name: r.name, narrator: r.narrator, seed: [r.entry as Track] });
	}
</script>

{#if open}
	{@const s = open}
	<section class="series" aria-label={names.dnTitle(s.name)}>
		<button class="back" aria-label={t('books.allBooks')} title={t('books.allBooks')} onclick={closeSeries} use:tapBounce><ChevronLeft size={18} /></button>
		<header class="series-head">
			<span class="cover lg" style:background-image={coverStyle(resumeRow?.entry.cover ?? chapters.find((c) => c.cover)?.cover, s.name)}></span>
			<div class="series-meta">
				<h2>{names.dnTitle(s.name)}</h2>
				<p class="sub">{names.dnArtist(s.narrator)}{#if chapters.length > 1} · {t('books.chapters', { n: chapters.length })}{/if}</p>
				{#if chapters.length}
					<button class="primary" onclick={() => playFrom(chapters, (resumeRow?.entry as Track | undefined) ?? chapters[0])} use:tapBounce>
						<Play size={16} />
						{resumeRow ? t('books.continue') : t('library.playAll')}
					</button>
				{/if}
			</div>
		</header>
		{#if chapters.length}
			<ul class="list">
				{#each chapters as ch (ch.uid)}
					{@const isResume = resumeRow?.entry.uid === ch.uid}
					<li class="row-wrap" class:resume={isResume}>
						{#if isResume}<span class="resume-tag"><Bookmark size={12} /> {t('books.current')}</span>{/if}
						<div class="swipe">
							<SwipeReveal />
							<SongRow track={ch} smartArtist onplay={() => playFrom(chapters, ch)} onrequestmenu={() => onrequestmenu(ch)} />
						</div>
					</li>
				{/each}
			</ul>
		{/if}
		{#if chaptersLoading}
			<p class="hint" aria-live="polite"><span class="spinner motion-always" aria-hidden="true"></span></p>
		{:else if !chapters.length}
			<p class="empty"><BookHeadphones size={28} /><span>{t('books.noChapters')}</span></p>
		{:else if hasMore}
			<button class="more" aria-label={t('artist.showMore')} title={t('artist.showMore')} onclick={loadMore} use:tapBounce><ChevronDown size={20} /></button>
		{/if}
	</section>
{:else}
	<section aria-labelledby="books-continue">
		<h2 id="books-continue" class="sec">{t('books.continue')}</h2>
		{#if books.progress.length}
			<ul class="cards">
				{#each books.progress as r (r.key)}
					<li class="card">
						<button class="card-main" onclick={() => openFromProgress(r)} use:tapBounce>
							<span class="cover" style:background-image={coverStyle(r.entry.cover, r.name)}></span>
							<span class="card-meta">
								<span class="card-title">{names.dnTitle(r.name)}</span>
								<span class="card-sub">{names.dnArtist(r.narrator)}</span>
								<span class="chip">{t('books.chapter', { n: r.n })}</span>
							</span>
						</button>
						<button class="card-play" aria-label={`${t('books.continue')} · ${names.dnTitle(r.name)}`} title={t('books.continue')} onclick={() => continueBook(r)} use:tapBounce><Play size={18} /></button>
						<button class="card-x" aria-label={`${t('books.remove')} · ${names.dnTitle(r.name)}`} title={t('books.remove')} onclick={() => books.remove(r.key)} use:tapBounce><X size={14} /></button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty"><BookHeadphones size={28} /><span>{t('books.empty')}</span></p>
		{/if}
	</section>

	<section aria-labelledby="books-discover">
		<h2 id="books-discover" class="sec">{t('books.discover')}</h2>
		<div class="chips" role="group" aria-labelledby="books-discover">
			{#each GENRES as g (g.q)}
				<button class="gchip" class:active={genre === g.q} aria-pressed={genre === g.q} onclick={() => pickGenre(g.q)} use:tapBounce>{t(g.label)}</button>
			{/each}
		</div>
		{#if discoverLoading}
			<p class="hint" aria-live="polite"><span class="spinner motion-always" aria-hidden="true"></span></p>
		{:else if genre && !discover.length}
			<p class="empty-sm">{t('books.noChapters')}</p>
		{:else if discover.length}
			<ul class="cards">
				{#each discover as d (d.key)}
					<li class="card">
						<button class="card-main" onclick={() => openSeries({ key: d.key, name: d.name, narrator: d.narrator, seed: d.chapters })} use:tapBounce>
							<span class="cover" style:background-image={coverStyle(d.chapters.find((c) => c.cover)?.cover, d.name)}></span>
							<span class="card-meta">
								<span class="card-title">{names.dnTitle(d.name)}</span>
								<span class="card-sub">{names.dnArtist(d.narrator)}</span>
								{#if d.chapters.length > 1}<span class="chip muted">{t('books.chapters', { n: d.chapters.length })}</span>{/if}
							</span>
						</button>
						<button class="card-play" aria-label={`${t('books.playFromHere')} · ${names.dnTitle(d.name)}`} title={t('books.playFromHere')} onclick={() => playFrom(d.chapters, d.chapters[0])} use:tapBounce><Play size={18} /></button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.sec { font-size: 1rem; margin: 4px 0 10px; }
	section + section { margin-top: 22px; }
	.cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.card { position: relative; display: flex; align-items: center; gap: 4px; background: var(--color-surface-2); border-radius: var(--radius-md); padding: 6px 6px 6px 0; min-width: 0; }
	.card-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; background: none; border: none; color: var(--color-text); text-align: start; padding: 4px 4px 4px 8px; cursor: pointer; border-radius: var(--radius-md); }
	.cover { flex: none; width: 56px; height: 56px; border-radius: 8px; background-size: cover; background-position: center; }
	.cover.lg { width: 96px; height: 96px; border-radius: 12px; }
	.card-meta { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
	.card-title { font-weight: 600; font-size: 0.9375rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.card-sub { color: var(--color-text-muted); font-size: 0.8125rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.chip { align-self: flex-start; font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--color-primary); color: var(--color-on-primary); }
	.chip.muted { background: var(--color-surface); color: var(--color-text-muted); }
	.card-play { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; border: none; background: var(--color-primary); color: var(--color-on-primary); cursor: pointer; }
	.card-x { flex: none; display: grid; place-items: center; width: 32px; height: 44px; border: none; background: none; color: var(--color-text-muted); cursor: pointer; }
	.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
	.gchip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); border-radius: 999px; padding: 10px 16px; min-height: 44px; font-size: 0.875rem; cursor: pointer; }
	.gchip.active { background: var(--color-primary); color: var(--color-on-primary); border-color: transparent; }
	.back { display: inline-flex; align-items: center; gap: 4px; background: none; border: none; color: var(--color-text-muted); font-size: 0.875rem; padding: 8px 8px 8px 0; min-height: 44px; cursor: pointer; }
	.series-head { display: flex; gap: 14px; align-items: flex-end; margin: 4px 0 16px; min-width: 0; }
	.series-meta { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
	.series-meta h2 { margin: 0; font-size: calc(1.2rem * var(--fs-title, 1)); overflow-wrap: anywhere; }
	.sub { margin: 0; color: var(--color-text-muted); font-size: 0.8125rem; }
	.primary { align-self: flex-start; white-space: nowrap; margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; background: var(--color-primary); color: var(--color-on-primary); border: none; border-radius: 999px; padding: 0 18px; min-height: 44px; font-weight: 600; font-size: 0.875rem; cursor: pointer; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.row-wrap { display: flex; flex-direction: column; gap: 2px; }
	.swipe { position: relative; overflow: hidden; border-radius: 10px; }
	.row-wrap.resume .swipe { box-shadow: inset 3px 0 0 var(--color-primary); }
	.resume-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 0.6875rem; font-weight: 600; color: var(--color-primary); padding: 6px 8px 0; }
	.more { width: 100%; margin-top: 12px; min-height: 44px; border-radius: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); cursor: pointer; }
	.hint { display: grid; place-items: center; padding: 20px 0; margin: 0; }
	.spinner { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--color-border); border-top-color: var(--color-primary); animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.empty { display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--color-text-muted); padding: 32px 16px; text-align: center; font-size: 0.875rem; margin: 0; }
	.empty-sm { color: var(--color-text-muted); font-size: 0.8125rem; padding: 4px 8px; margin: 0; }
</style>
