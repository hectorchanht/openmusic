<script lang="ts">
	// SSR-safe carrier-free ALBUM share page (OG-PATH-01), SSR-safe BY CONSTRUCTION.
	//
	// PLANNER DECISION (Claude's discretion per CONTEXT): this route is an SSR OG *landing*, not a
	// second album implementation. It emits the crawler card + a minimal title block server-side, then
	// hands the recipient to the ONE existing album page (~1000 lines: tracklist, Last.fm enrich,
	// Deezer album info, download/share controls) instead of duplicating it. Crawlers never run JS, so
	// they keep the SSR head; a human gets replaceState-forwarded on hydration. OG-PATH-02's
	// getAlbumTracklist / enrichAlbum resolution therefore runs on the legacy page, keyed by the same
	// decoded segments this route forwards.
	//
	// DEVIATION from RESEARCH Open Question 2 / Pitfall 10 (which recommends repointing the in-app
	// album nav at artist/[name]/+page.svelte:464 to the 2-segment shape): because THIS route
	// redirects to the legacy one, doing that would make every in-app album tap a double hop. The
	// internal nav deliberately STAYS on the legacy `?artist=` shape; the 2-segment loader is exercised
	// by its own unit test and by shared links.
	//
	// SSR-SAFETY (Pitfall 4): the ONLY module-top imports are PageOg, `browser`, `onMount`, `goto` and
	// the page data type. NO store import and NO store method call at module scope, so SSR never
	// compiles the client store graph in. `goto` is a $app/navigation function — import-safe on the
	// server and only ever CALLED under the `browser` guard below. quick-260926-hze / kvz: the names
	// store (the forward's lockUrl and the visible title / artist lock) is imported lazily in onMount.
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import PageOg from '$lib/components/PageOg.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const name = $derived(data.name || data.og.title);
	const artist = $derived(data.artist);
	// quick-260926-kvz: the VISIBLE text follows the Chinese script lock, client-side only. SSR and
	// crawlers get the raw route segments; `lock` is bound in onMount from a lazily-imported names
	// store and stays null during SSR. Reactive: zhLock reads names.rev and settings.zhScript, so a
	// cold dict repaints when warmLock lands and flipping the setting repaints. `name` / `artist` and
	// every raw `data.artist` / `data.name` use (the forward target) stay untouched —
	// they are resolution keys, not display.
	let lock = $state<((s: string) => string) | null>(null);
	const shownName = $derived(lock ? lock(name) : name);
	const shownArtist = $derived(lock ? lock(artist) : artist);

	onMount(() => {
		if (!browser || !data.name) return;
		// Forward to the single album implementation, which keys off params.name + ?artist=.
		// encodeURIComponent (not encodePathSegment) — the legacy route decodes with SvelteKit's own
		// single decode and reads `artist` as a plain query param, so the literal text must survive.
		// replaceState so the share URL does not linger in history behind the real page.
		const target =
			'/album/' +
			encodeURIComponent(data.name) +
			(data.artist ? '?artist=' + encodeURIComponent(data.artist) : '');
		// quick-260926-hze: forward to the script-LOCKED album URL. The names store comes in by a
		// DYNAMIC import so the SSR-SAFETY invariant above (no module-top store import) holds; the
		// (app) layout has already loaded that chunk, so there is no extra fetch. A chunk failure
		// still forwards unlocked, never stranding the recipient on "Opening album…".
		// Known ceiling: on a cold share-link open the lock dict is usually still cold, so lockUrl
		// is identity here and the layout's afterNavigate address-bar rewrite fixes the bar.
		import('$lib/stores/names.svelte')
			.then(({ names }) => {
				// quick-260926-kvz: lock the visible text for the moment before the forward lands.
				lock = (s) => names.zhLock(s);
				return goto(names.lockUrl(target), { replaceState: true });
			})
			.catch(() => goto(target, { replaceState: true }));
	});
</script>

<PageOg og={data.og} />

<section class="album-share">
	<h1 class="title">{shownName}</h1>
	{#if shownArtist}
		<p class="artist">{shownArtist}</p>
	{/if}
	<p class="status" aria-live="polite">Opening album on openmusic…</p>
</section>

<style>
	.album-share {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 3rem 1.25rem 6rem;
		text-align: center;
	}
	.title {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
		line-height: 1.2;
	}
	.artist {
		margin: 0;
		opacity: 0.7;
		font-size: 1rem;
	}
	.status {
		margin: 0.5rem 0 0;
		font-size: 0.95rem;
		opacity: 0.85;
	}
</style>
