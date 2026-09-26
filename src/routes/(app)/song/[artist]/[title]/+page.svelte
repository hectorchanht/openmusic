<script lang="ts">
	// SSR-safe carrier-free SONG share page (OG-PATH-01), SSR-safe BY CONSTRUCTION. This is the
	// crawler landing surface for /song/{artist}/{title}: it emits a per-song OG head + a static card
	// in the server HTML; the resolve-and-play interactivity runs CLIENT-ONLY. Near-copy of the legacy
	// /song/[slug] page — it consumes the same `{ og, name, artist }` load contract — with the cover
	// block upgraded from a bare gradient to the real /api/og card image (OG-PAGE-01).
	//
	// SSR-SAFETY (Pitfall 4): the ONLY module-top imports are PageOg, `browser`, `onMount`, the page
	// data type, and `apiUrl` (pure + store-free, so it does not pull the client graph). There is NO
	// top-level store import and NO store METHOD call at module scope — the player store (which pulls
	// the whole client graph) is imported LAZILY inside onMount under a `browser` guard, so SSR never
	// compiles the store graph in. i18n is likewise lazy-imported client-side (its index imports the
	// settings store), keeping this page store-free during SSR. quick-260926-kvz: the names store
	// (the script lock on the visible title / artist) is likewise imported lazily inside onMount.
	//
	// 38-D-13/38-D-06: the page RESOLVES on mount again. `share-arrival` is imported LAZILY inside
	// onMount (it imports the player store, so a module-top import would break the paragraph above)
	// and fires ONE detail call for the `?u=` carrier, or the name resolve when there is none. It
	// still starts NO audio on mount: quick-260809-38i's no-autoplay decision STANDS (D-06 — a share
	// navigation is not an in-page gesture and mobile autoplay policy rejects it). What moved back to
	// mount is the RESOLVE, never the playback; the "Play on openmusic" CTA is the gesture that makes
	// sound, and it starts an element that is already armed.
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import PageOg from '$lib/components/PageOg.svelte';
	import { apiUrl } from '$lib/services/api-base';
	import type { PageData } from './$types';
	// `import type` is ERASED at compile time, so this pulls nothing from share-arrival (and its
	// player-store graph) into SSR. The VALUE import stays lazy inside onMount.
	import type { ArrivalOutcome } from '$lib/services/share-arrival';

	let { data }: { data: PageData } = $props();

	// Display fields from the SSR load: data.name/data.artist are the decoded path segments, which are
	// the authoritative identity on this shape (OG-PATH-01 — there are no query carriers).
	const title = $derived(data.name || data.og.title);
	const artist = $derived(data.artist);
	// quick-260926-kvz: the VISIBLE text follows the Chinese script lock, client-side only. SSR and
	// crawlers get the raw route segments; `lock` is bound in onMount from a lazily-imported names
	// store and stays null during SSR. Reactive: zhLock reads names.rev and settings.zhScript, so a
	// cold dict repaints when warmLock lands and flipping the setting repaints. `title` / `artist` and
	// every raw `data.artist` / `data.name` use (the /api/og coverSrc, arriveShared, replayShared)
	// stay untouched — they are resolution keys, not display.
	let lock = $state<((s: string) => string) | null>(null);
	const shownTitle = $derived(lock ? lock(title) : title);
	const shownArtist = $derived(lock ? lock(artist) : artist);

	// OG-PAGE-01 / Pitfall 7: the in-app cover goes through apiUrl(), NEVER data.og.image. og.image is
	// an ABSOLUTE origin-derived URL for the meta tag; inside the Capacitor WebView that origin is
	// https://localhost, which has no server, so reusing it here would render a broken image in the
	// APK. apiUrl() stays relative on web and resolves to VITE_API_BASE on native.
	const coverSrc = $derived(
		apiUrl(
			`/api/og?type=song&artist=${encodeURIComponent(data.artist)}&title=${encodeURIComponent(data.name)}`
		)
	);
	// A broken <img> is worse than a gradient (the healCover precedent treats a cover error as a
	// first-class event), so an error falls back to the existing .cover--placeholder block.
	let coverFailed = $state(false);

	// DQ-3 arrival status. Drives the inline UI: 'resolving' shows a spinner, 'playing' means sound
	// is out, 'notfound' shows a clear message + retry. NEVER stays 'resolving' forever — every
	// arrive() settles it (no stuck loader).
	// 38-D-17/38-D-18: an 'armed' or 'noop' outcome maps back to 'idle'. The NOWBAR is the armed
	// indicator — it comes free from the (app) layout — so there is no extra status line for it and
	// NowPlaying deliberately stays collapsed.
	// quick-260809-38i: the status still only ever reaches 'playing' through a real user gesture.
	let status = $state<'idle' | 'resolving' | 'playing' | 'notfound'>('idle');
	// Lazily-imported i18n getter for the not-found message; null until the client import resolves,
	// in which case we render a plain English fallback (keeps the page SSR-safe + never blank).
	let notFoundMsg = $state('No playable version could be found for this song.');
	// Lazily-bound play handler — the PRIMARY path since quick-260809-38i (it was the fallback for the
	// autoplay-blocked case; removing the autoplay removes that whole class of failure). Still named
	// `retry` because it is also what re-runs the resolve after a 'notfound'.
	let retry = $state<(() => void) | null>(null);
	// 38-D-16: the mount-time arrival, held so a tap DURING it adopts the same promise instead of
	// firing a second resolve. Plain fields, not `$state` — nothing renders them, which is the house
	// rule for internal guards (CLAUDE.md, cf. player's `playGen`/`pendingGen`).
	let inflight: Promise<ArrivalOutcome> | null = null;
	// quick-260920-oja: the uid the arrival actually SEATED — the carrier's, or the name resolve's
	// after a D-10 fall-through. It is what lets a later tap tell "the shared song is still current"
	// from "the listener has played something else since", the notion the CTA never had. Plain field
	// like `inflight`, for the same reason: nothing renders it.
	let seatedUid: string | null = null;
	let ac: AbortController | null = null;

	/** The 'notfound' presentation — shared by the mount arrival and the CTA tap, both of which miss
	 *  the same way (quick-260920-oja: the tap re-resolves now, so it can reach this too). */
	async function showNotFound() {
		status = 'notfound';
		try {
			const { t } = await import('$lib/i18n');
			notFoundMsg = t('home.unplayable');
		} catch {
			/* keep the English fallback already set above */
		}
	}

	async function arrive(): Promise<ArrivalOutcome> {
		if (!browser || !data.name) {
			// No title segment → nothing to resolve (only reachable via the '-' empty guard). Treat as a
			// genuine miss rather than a stuck loader.
			status = 'notfound';
			return 'notfound';
		}
		status = 'resolving';
		// Lazy import keeps SSR store-free — share-arrival imports the player store (its own header
		// comment carries the same contract).
		const { arriveShared } = await import('$lib/services/share-arrival');
		const outcome = await arriveShared(
			{ artist: data.artist, title: data.name, u: data.u },
			ac?.signal
		);
		// quick-260920-oja: record WHICH song the arrival seated, before any status bookkeeping. On a
		// 'notfound' it seated nothing, and `current` is then whatever the listener already had — so
		// recording it there would make the CTA toggle a stranger's song.
		if (outcome !== 'notfound') {
			const { player } = await import('$lib/stores/player.svelte');
			seatedUid = player.current?.uid ?? null;
		}
		if (outcome === 'played') {
			status = 'playing';
			// 38-D-20: a warm arrival changed the music without the user touching the player, so it
			// says so — and says the recipient's queue survived. Both imports pull the client store
			// graph, hence lazy; the try/catch means a failed chunk costs a toast, never the page.
			try {
				const [{ toast }, { t }] = await Promise.all([
					import('$lib/stores/toast.svelte'),
					import('$lib/i18n')
				]);
				toast.show(t('toast.sharedPlaying'));
			} catch {
				/* no toast is a fine degradation — the music is already playing */
			}
		} else if (outcome === 'notfound') {
			await showNotFound();
		} else {
			// 'armed' | 'noop' — the song is seated in the nowbar, one tap from sound. No status line.
			status = 'idle';
		}
		return outcome;
	}

	// 38-D-19: the CTA handler. It is the real user gesture mobile autoplay policy requires, and it
	// starts an already-armed element instead of beginning a resolve.
	//
	// quick-260920-oja: it no longer REPLAYS the memoised mount outcome. `inflight` still serves the
	// case it was built for (38-D-16 — a tap DURING the resolve adopts it instead of firing a second
	// request), but the moment that promise has SETTLED it stops being the source of truth: awaiting
	// it returned the cached outcome instantly and the handler fell through to a bare `toggle()`,
	// which starts whatever is current NOW. A tap after the listener had played other songs therefore
	// did nothing at all (something else playing → the guard skipped) or started THAT song. The
	// decision moved into the shared service, where both pages and the service's own tests hold it.
	async function playNow() {
		if (!browser || !data.name) {
			await showNotFound();
			return;
		}
		if (inflight) {
			await inflight; // 38-D-16: adopt the in-flight mount resolve — never a second request.
			inflight = null; // …and it is spent: a later tap re-resolves instead of replaying it.
		}
		const { replayShared } = await import('$lib/services/share-arrival');
		const outcome = await replayShared(
			{ artist: data.artist, title: data.name, u: data.u },
			seatedUid,
			ac?.signal
		);
		if (outcome === 'notfound') {
			await showNotFound();
			return;
		}
		if (outcome !== 'played') return; // 'noop' — the page unmounted mid-resolve; nothing to show
		// Whatever it took (a start or a re-seat), the shared song holds the seat again.
		const { player } = await import('$lib/stores/player.svelte');
		seatedUid = player.current?.uid ?? seatedUid;
		status = 'playing';
	}

	onMount(() => {
		if (!browser) return;
		// quick-260926-kvz: lazy for the same reason as share-arrival (SSR-SAFETY header) — a failed
		// chunk keeps the raw text (never-throw).
		import('$lib/stores/names.svelte').then(({ names }) => (lock = (s) => names.zhLock(s))).catch(() => {});
		// onMount, NEVER a tracked rune effect: the arrival writes player state, and a tracked effect
		// that reads then writes that state self-invalidates into a loop
		// (restore-effect-self-invalidation-loop — see the untrack() block at
		// src/routes/+layout.svelte:24-33).
		// quick-260809-38i: the ref and its decision both stand — nothing here PLAYS. The resolve is
		// what fires on mount (38-D-13); `arrive()` never calls play() or toggle().
		ac = new AbortController();
		inflight = arrive();
		retry = () => void playNow();
		// A fast navigation away aborts before the name fan-out, rather than spending it on a dead view.
		return () => ac?.abort();
	});
</script>

<PageOg og={data.og} />

<section class="song-share">
	{#if coverFailed}
		<div class="cover cover--placeholder" aria-hidden="true"></div>
	{:else}
		<!-- Decorative: the title + artist are rendered as text immediately below. -->
		<img class="cover" src={coverSrc} alt="" onerror={() => (coverFailed = true)} />
	{/if}
	<h1 class="title">{shownTitle}</h1>
	{#if shownArtist}
		<p class="artist">{shownArtist}</p>
	{/if}

	{#if status === 'resolving'}
		<p class="status" aria-live="polite"><span class="spinner motion-always" aria-hidden="true"></span> Finding a playable version…</p>
	{:else if status === 'playing'}
		<p class="status" aria-live="polite">Now playing on openmusic.</p>
	{:else if status === 'notfound'}
		<p class="status status--error" aria-live="polite">{notFoundMsg}</p>
	{/if}

	<!-- quick-260809-38i: still the ONLY thing that starts audio — the page resolves on mount but
	     never plays. 38-D-19: this tap starts the already-armed element. 38-D-16: it is deliberately
	     NOT disabled during 'resolving' — a tap mid-flight ADOPTS the in-flight resolve (the spinner
	     line still shows), and after a 'notfound' it re-runs it. Available client-side only (retry is
	     bound in onMount). -->
	<button class="play-cta" onclick={() => retry?.()} disabled={retry === null}>
		Play on openmusic
	</button>
</section>

<style>
	.song-share {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem 1.25rem 6rem;
		text-align: center;
	}
	.cover {
		width: 240px;
		height: 240px;
		max-width: 70vw;
		max-height: 70vw;
		border-radius: 16px;
		object-fit: cover;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}
	.cover--placeholder {
		background: linear-gradient(135deg, #2a2a36, #14141a);
	}
	.title {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0.5rem 0 0;
		line-height: 1.2;
	}
	.artist {
		margin: 0;
		opacity: 0.7;
		font-size: 1rem;
	}
	.status {
		margin: 0.25rem 0 0;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.95rem;
		opacity: 0.85;
	}
	.status--error {
		color: #ff7a7a;
		opacity: 1;
	}
	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.play-cta {
		margin-top: 0.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.75rem 1.75rem;
		border-radius: 999px;
		background: var(--accent, #6c5ce7);
		color: #fff;
		font-weight: 600;
		text-decoration: none;
		border: none;
		cursor: pointer;
	}
	.play-cta:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
