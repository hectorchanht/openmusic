<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { ListStart, ListEnd, Download, Heart, ListPlus, Disc, User, Share2, Info, X, Plus, Shuffle, Trash2, Moon, Sparkles } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { sleepTimer } from '$lib/stores/sleepTimer.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { marquee } from '$lib/actions/marquee';
	import { toast } from '$lib/stores/toast.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import { isGatedReady, shouldStartResolve } from './track-menu-gate';
	import { t } from '$lib/i18n';
	import { ensureTrackDetails } from '$lib/services/catalog';
	import { blobStore } from '$lib/services/blob-store';
	import { songShareUrl } from '$lib/services/share';
	import type { Track } from '$lib/sources/types';

	// `loading` = the menu opened on a discovery STUB and is still resolving the real Track
	// (home long-press). It pops INSTANTLY with a skeleton; the action buttons render once the
	// track resolves — so the menu never waits on the network before appearing.
	let { track, open, loading = false, onclose }: { track: Track | null; open: boolean; loading?: boolean; onclose: () => void } = $props();

	let pickerOpen = $state(false);
	let detailTrack = $state<Track | null>(null);
	const liked = $derived(track ? library.isLiked(track.uid) : false);

	// MENU-01 (D-02/D-03): per-action in-flight set drives the inline row spinners. A gated
	// action (Download / Detail / Remix) is tappable on a STUB — tapping kicks off the resolve,
	// shows the spinner on that row, and the action fires automatically once data arrives. Exactly
	// one resolve per action key (second tap while spinning = no-op); cleared in `finally` on
	// success OR failure (never a stuck spinner). `new Set(...)` reassign keeps it reactive.
	let inFlight = $state(new Set<string>());
	async function gated(key: string, run: (resolved: Track) => void | Promise<void>) {
		if (!track) return;
		if (!shouldStartResolve(inFlight, key)) return; // D-03: a second tap while spinning is a no-op
		if (isGatedReady(track)) return void run(track); // fast path: already resolved, run on the stub now
		inFlight = new Set(inFlight).add(key);
		try {
			const resolved = await ensureTrackDetails(track);
			if (!resolved.audioUrl) { toast.show(t('toast.noAudio')); return; } // graceful fail, no stuck spinner
			await run(resolved);
		} catch {
			toast.show(t('toast.noAudio')); // never a stuck spinner on throw
		} finally {
			const next = new Set(inFlight); next.delete(key); inFlight = next;
		}
	}

	function close() {
		pickerOpen = false;
		onclose();
	}
	function playNext() { if (track) { player.playNext(track); toast.show(t('toast.playingNext')); } close(); }
	function addQueue() { if (track) { hapticTick(); player.addToQueue(track); toast.show(t('toast.addedToQueue')); } close(); }
	// ii6: Shuffle moved off the NowPlaying transport row into the menu. Shown only when
	// there's a queue to shuffle (otherwise the action would be a no-op).
	function shuffleQueue() { player.toggleShuffle(); close(); }
	// GLN-5: clear-queue relocated here from the NowPlaying subnav. Clearing a queue that is just
	// [current] is a no-op, so the item is gated to queue.length > 1 in the template.
	function clearQueue() { player.clearQueue(); close(); }
	function like() {
		if (!track) return;
		hapticTick();
		library.toggleLike(track);
		// Post-toggle: isLiked == true means we just LIKED it; false means we just UNLIKED.
		// Use past-tense toast keys (ii6 — previously read 'menu.like' which is the action verb).
		toast.show(library.isLiked(track.uid) ? t('toast.liked') : t('toast.unliked'));
	}
	// goto* navigate away (TrackMenu unmounts) so a local toast can't render — the page change
	// IS the feedback. like()/detail keep their on-page feedback (toast / heart toggle / sheet).
	//
	// overlays.navigateAway() runs the goto() while this menu (and any now-playing sheet) is
	// still open, then closes them with history.back() suppressed. Doing onclose()/collapse()
	// FIRST and then goto() — the obvious version — is exactly what was broken: closing the
	// overlay makes goto() resolve as a silent NO-OP, and the dismiss's history.back() races
	// the goto() (single overlay → back cancels goto, the menu nav "does nothing"; stacked
	// overlays → goto lands then back over-pops, snapping the URL home). See the overlays store.
	function gotoArtist() {
		if (!track) return;
		const dest = `/artist/${encodeURIComponent(track.artist)}`;
		overlays.navigateAway(() => goto(dest));
	}
	function gotoAlbum() {
		if (!track?.album) return;
		const dest = `/album/${encodeURIComponent(track.album)}`;
		overlays.navigateAway(() => goto(dest));
	}

	// quick-260625-pzs-04: does the currently-playing track's already-resolved quality satisfy the
	// requested DOWNLOAD tier? If so we can reuse its URL for the download instead of forcing a second
	// concurrent resolve of the same song (T-pzs-02). Conservative: only reuse when we are confident
	// the streamed quality already meets/exceeds the wanted tier.
	//   - 'auto'     → any resolved URL is acceptable
	//   - '320'/'128'→ any resolved stream (320k or lossless) meets/exceeds the tier
	//   - 'lossless' → reuse ONLY when the current stream is already lossless; otherwise re-resolve
	function currentQualityMeets(curQuality: string | null, want: typeof settings.downloadQuality): boolean {
		if (want === 'auto' || want === '320' || want === '128') return true;
		// want === 'lossless'
		return (curQuality ?? '').toLowerCase() === 'lossless';
	}

	// Gated run callback (D-02): invoked by gated('download', …) with the resolved track. The gate
	// guarantees `resolved.audioUrl` is present before we get here, but Download re-resolves at the
	// user's DOWNLOAD quality (separate from the streaming default the gate resolved at).
	async function doDownload(resolved: Track) {
		onclose();
		toast.show(t('toast.preparingDownload'));
		// quick-260625-pzs-04 — DOWNLOAD ISOLATION CONTRACT: this function must NOT touch the player.
		// It must never assign to player.current, never null/clear player.current.lrc, never call any
		// player lyric-refill path, never bump player.playGen, and never reuse the shared <audio>
		// element. It re-resolves/fetches on COPIES + its own fetch() only. The library.addDownload(r)
		// below mutates the LIBRARY downloads list (the intended download effect — NOT player state).
		//
		// T-pzs-02: when the song being downloaded IS the currently-playing track AND its audio is
		// already resolved at an acceptable quality, REUSE that resolved URL/details instead of forcing
		// a second concurrent DOWNLOAD-quality resolve of the same song. A duplicate resolve + the blob
		// fetch saturate the shared CDN and have caused a stale-URL audio error → lyrics wipe on the
		// active track (player.svelte.ts:474-475). For a NON-current track the re-resolve is harmless
		// (different song, separate copy) so it is kept.
		let r: Track;
		const cur = player.current;
		const reuseCurrent =
			cur != null &&
			cur.uid === resolved.uid &&
			!!cur.audioUrl &&
			cur.detailsLoaded &&
			currentQualityMeets(cur.quality, settings.downloadQuality);
		if (reuseCurrent) {
			// Reuse the already-resolved current track's URL/details (a fresh COPY — never the live
			// player.current reference, so nothing downstream can mutate the playing track).
			r = { ...(cur as Track) };
		} else {
			// Re-resolve at the user's DOWNLOAD quality (separate from the streaming default).
			// WR-07: the tier is threaded through ensureTrackDetails as an explicit per-call
			// parameter — never the old temporary settings.defaultQuality swap, which raced
			// concurrent playback resolves and could be persisted by a mid-window save().
			// Force a fresh resolve (clear cached details on a COPY — the queue track is left
			// untouched).
			r = await ensureTrackDetails(
				{ ...resolved, detailsLoaded: false, audioUrl: null, lrc: null },
				undefined,
				settings.downloadQuality
			).catch(() => resolved);
		}
		library.addDownload(r);
		if (!r.audioUrl) return toast.show(t('toast.noAudio'));
		try {
			// RAW fetch (not apiFetch — fetch→apiFetch audit): this is a MEDIA download-to-blob of the
			// resolved audio stream. audioUrl is often an ABSOLUTE CDN URL (qq/kuwo/joox) — apiFetch would
			// corrupt it — and a full-file body must not be routed through the JSON governor's dedup/cap.
			const resp = await fetch(r.audioUrl);
			const blob = await resp.blob();
			// kyf: persist the SAME blob into the offline cache (IndexedDB) so a later
			// player.play() of this uid streams from the local blob instead of the CDN. Never
			// throws — a write failure leaves the file-on-disk path intact + degrades to
			// re-streaming on next play.
			await blobStore.put(r.uid, blob);
			const ext = (r.audioUrl.split('?')[0].match(/\.(mp3|flac|m4a|aac|ogg|wav)$/i)?.[1] ?? 'mp3').toLowerCase();
			const filename = `${r.artist} - ${r.title}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_');
			const mime = ({ mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav' } as Record<string, string>)[ext] ?? 'audio/mpeg';
			// Desktop (Chrome/Edge): real Save-As dialog via the File System Access API. Cancelling
			// (AbortError) means cancel — return silently, NO toast, NO anchor fallback. Any other
			// picker error falls through to the anchor download below.
			if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
				try {
					const handle = await (window as any).showSaveFilePicker({
						suggestedName: filename,
						types: [{ description: 'Audio', accept: { [mime]: ['.' + ext] } }]
					});
					const writable = await handle.createWritable();
					await writable.write(blob);
					await writable.close();
					toast.show(t('toast.downloaded'));
					return;
				} catch (err: any) {
					if (err?.name === 'AbortError') return; // user cancelled — cancel means cancel
					// otherwise fall through to the anchor download
				}
			}
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = filename;
			a.click();
			URL.revokeObjectURL(a.href);
			toast.show(t('toast.downloaded'));
		} catch {
			window.open(r.audioUrl, '_blank');
			toast.show(t('toast.openedAudio'));
		}
	}
	async function doShare() {
		if (!track) return;
		onclose();
		// SHARE-02 / DQ-1 / DQ-4 (quick-260614-1w3, supersedes D-04/D-06 for the SONG surface): build
		// the SHORT readable link `/song/{slug}?n={title}&a={artist}` — no base64 `?play=` queue token
		// and no `{source}{id}` suffix. The link carries only the current song; the song page resolves
		// a playable track by name+artist at open time and always unfurls an OG card from n/a.
		const url = songShareUrl(track);
		try {
			const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
			if (nav.share) await nav.share({ title: `${track.title} — ${track.artist}`, url });
			else { await navigator.clipboard.writeText(url); toast.show(t('toast.shareCopied')); }
		} catch { /* cancelled */ }
	}
	// Gated run callback (D-02): the gate already resolved the track, so just open the detail sheet
	// with the resolved object (audioUrl/quality rows populated). The menu stays open behind the
	// detail sub-sheet (its own overlay entry), matching the prior behavior.
	function doDetail(resolved: Track) {
		detailTrack = resolved;
	}
	// Remix (QUEUE-04 / D-04..D-07): play the seed first, then seed a force-generated up-next from
	// it via the existing fresh-play regenerate path — NO new queue mechanism. setQueue([seed],
	// 'remix') records the 'remix' QueueContext (effectiveUpnextMode('remix') === 'generated', from
	// 19-01); play(seed,{fresh:true}) → regenerate → dedupeBest([seed, ...manualEntries, ...auto])
	// preserves manual pins (D-05) and discards the prior generated tail. Gated → seed has audioUrl.
	function doRemix(seed: Track) {
		toast.show(t('toast.remixing'));
		player.setQueue([seed], 'remix');
		void player.play(seed, { fresh: true });
		close();
	}
	function addToPlaylist(id: string) { if (track) library.addToPlaylist(id, track); pickerOpen = false; toast.show(t('toast.addedToPlaylist')); }
	function newPlaylist() {
		const name = prompt(t('menu.newPlaylistPrompt'));
		if (name && track) { const pl = library.createPlaylist(name); library.addToPlaylist(pl.id, track); toast.show(t('toast.playlistCreated')); }
		pickerOpen = false;
	}

	// ---- back-gesture wiring (SINGLE dismiss path) ----
	// Each sheet registers with the overlays stack while open. The back gesture invokes
	// the registered close handler (which only flips state false); UI close handlers
	// (scrim/X/drag) likewise only flip state false. The $effect CLEANUP is the ONE site
	// that calls overlays.dismiss(id) — so scrim, X, drag and back-gesture all converge on
	// a single dismiss site and history depth stays balanced (open pushed 1 state; either
	// the cleanup's dismiss() pops it, or closeTop() already popped it → dismiss is a no-op).
	$effect(() => {
		// untrack the overlays calls: open/dismiss read the $state overlay stack internally,
		// so without untrack this effect would re-run (cleanup+reopen, churning history) whenever
		// ANOTHER overlay (picker/detail/nowplaying) pushes or pops.
		//
		// DEP IS `open` ONLY — deliberately NOT `track`. The home long-press opens the menu on a
		// discovery STUB then reassigns `track` (stub → resolved) after resolveStub. If `track`
		// were a dep, that reassignment would re-run the effect: cleanup fires overlays.dismiss
		// (→ history.back()) and the body re-runs overlays.open (→ pushState) in the same flush —
		// a back()+push churn that desyncs history depth and over-pops Back into the PREVIOUS
		// route (long-press a home tile → bounced to /library or /search). The render guard
		// `{#if open && track}` still gates visibility; overlays.open is idempotent.
		if (open) {
			untrack(() => overlays.open("trackmenu-menu", () => onclose()));
			return () => untrack(() => overlays.dismiss("trackmenu-menu"));
		}
	});
	$effect(() => {
		if (pickerOpen && track) {
			untrack(() => overlays.open("trackmenu-picker", () => (pickerOpen = false)));
			return () => untrack(() => overlays.dismiss("trackmenu-picker"));
		}
	});
	$effect(() => {
		if (detailTrack) {
			untrack(() => overlays.open("trackmenu-detail", () => (detailTrack = null)));
			return () => untrack(() => overlays.dismiss("trackmenu-detail"));
		}
	});
</script>

{#if open && track}
	<button class="scrim" aria-label={t('menu.closeMenu')} onclick={close}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: close }} use:focusTrap>
		<!-- D-08/D-09/D-10: two-row marquee header (song/artist, display-only) + a top-right
		     Like+Close cluster. Replaces the old single ellipsised `{title} · {artist}` line.
		     {#key track.uid} remounts the clips on a stub→resolved reassignment so use:marquee
		     re-measures the wider resolved text (NowPlaying analog; Pitfall 2). The keyframe is
		     GLOBAL in app.css (Pitfall 4) — the component styles only the clip wrappers. -->
		<div class="sheet-head">
			<div class="head-text">
				{#key track.uid}
					<div class="hd-title" use:marquee><span class="marquee-inner">{names.dnTitle(track.title)}</span></div>
					<div class="hd-artist" use:marquee><span class="marquee-inner">{names.dnArtist(track.artist)}</span></div>
				{/key}
			</div>
			<div class="head-actions">
				<!-- Like is the SOLE accent in the header (D-09); the mid-list Like row is removed.
				     Reuses the existing like() + liked derived; the Heart import stays (Pitfall 7). -->
				<button class="hd-btn" class:liked aria-pressed={liked} aria-label={liked ? t('menu.liked') : t('menu.like')} onclick={like} use:tapBounce><Heart size={20} fill={liked ? 'currentColor' : 'none'} /></button>
				<!-- NEW explicit Close affordance (today close is scrim/drag only). It ONLY flips
				     state via close() → the $effect cleanup is the SOLE overlays.dismiss caller, so
				     scrim/X/drag/back all converge on one dismiss path (overlay invariant; D-09). -->
				<button class="hd-btn" aria-label={t('menu.closeMenu')} onclick={close} use:tapBounce><X size={20} /></button>
			</div>
		</div>
		{#if loading && !track.title}
			<!-- HEADER-ONLY skeleton (D-11): two stacked .sk bars matching the 2-row header shape,
			     using the GLOBAL .sk class. Home stubs usually carry title/artist so this only
			     fills the rare pre-data instant; the action list ALWAYS renders below (D-01). -->
			<div class="sheet-head" aria-hidden="true">
				<div class="head-text">
					<div class="sk" style="height:15px;width:65%"></div>
					<div class="sk" style="height:12px;width:45%;margin-top:6px"></div>
				</div>
			</div>
		{/if}
		<!-- D-01: the action list ALWAYS renders (no `loading` gate around the buttons — `loading`
		     now only drives the header-only skeleton above). Gated rows (Download / Detail / Remix)
		     are tappable on a stub and resolve-then-act with an inline spinner (D-02/D-03). -->
		{#if track && track.uid !== player.current?.uid}
			<button class="mi" onclick={playNext} use:tapBounce><ListStart size={18} /> {t('menu.playNext')}</button>
			<button class="mi" onclick={addQueue} use:tapBounce><ListEnd size={18} /> {t('menu.addToQueue')}</button>
		{/if}
		<!-- Remix: GATED (needs audioUrl to play the seed) — Sparkles + the inline spinner.
		     Sits in the queue-actions cluster after Play next / Add to queue (D-07). -->
		<button class="mi" aria-busy={inFlight.has('remix')} aria-label={inFlight.has('remix') ? t('menu.preparing') : undefined} onclick={() => gated('remix', doRemix)} use:tapBounce>
			{#if inFlight.has('remix')}<span class="row-spinner"></span>{:else}<Sparkles size={18} />{/if} {t('menu.remix')}
		</button>
		{#if player.queue.length > 1}
			<button class="mi" class:on={player.shuffle} onclick={shuffleQueue} use:tapBounce><Shuffle size={18} /> {t('menu.shuffleQueue')}</button>
			<button class="mi" onclick={clearQueue} use:tapBounce><Trash2 size={18} /> {t('menu.clearQueue')}</button>
		{/if}
		<!-- Download: GATED — resolve-then-act at settings.downloadQuality inside the run callback. -->
		<button class="mi" aria-busy={inFlight.has('download')} aria-label={inFlight.has('download') ? t('menu.preparing') : undefined} onclick={() => gated('download', doDownload)} use:tapBounce>
			{#if inFlight.has('download')}<span class="row-spinner"></span>{:else}<Download size={18} />{/if} {t('menu.download')}
		</button>
		<button class="mi" onclick={() => { pickerOpen = true; }} use:tapBounce><ListPlus size={18} /> {t('menu.addToPlaylist')}</button>
		<!-- Opens the GLOBAL SleepTimerSheet (mounted in the app layout) — not a local sub-sheet
		     here, so the timer indicator is reachable from the nowbar + now-playing too (D-08). -->
		<button class="mi" onclick={() => { close(); tick().then(() => (sleepTimer.sheetOpen = true)); }} use:tapBounce><Moon size={18} /> {t('menu.sleepTimer')}</button>
		<!-- <button class="mi" onclick={gotoAlbum} disabled={!track.album}><Disc size={18} /> {t('menu.goToAlbum')}</button> -->
		<button class="mi" onclick={gotoArtist} use:tapBounce><User size={18} /> {t('menu.goToArtist')}</button>
		<button class="mi" onclick={doShare} use:tapBounce><Share2 size={18} /> {t('menu.share')}</button>
		<!-- Detail: GATED — resolves details to populate the detail sheet's audioUrl/quality rows. -->
		<button class="mi" aria-busy={inFlight.has('detail')} aria-label={inFlight.has('detail') ? t('menu.preparing') : undefined} onclick={() => gated('detail', doDetail)} use:tapBounce>
			{#if inFlight.has('detail')}<span class="row-spinner"></span>{:else}<Info size={18} />{/if} {t('menu.detail')}
		</button>
	</div>
{/if}

{#if pickerOpen && track}
	<button class="scrim" aria-label={t('menu.close')} onclick={() => (pickerOpen = false)}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (pickerOpen = false) }} use:focusTrap>
		<div class="menu-head">{t('menu.addToPlaylist')}</div>
		{#each library.playlists as pl (pl.id)}
			<button class="mi" onclick={() => addToPlaylist(pl.id)} use:tapBounce><ListPlus size={18} /> {pl.name} <span class="count">{pl.tracks.length}</span></button>
		{/each}
		<button class="mi accent" onclick={newPlaylist} use:tapBounce><Plus size={18} /> {t('menu.newPlaylist')}</button>
	</div>
{/if}

{#if detailTrack}
	<button class="scrim" aria-label={t('menu.close')} onclick={() => (detailTrack = null)}></button>
	<div class="modal" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (detailTrack = null) }} use:focusTrap>
		<div class="menu-head row"><span>{t('menu.trackDetail')}</span><button class="x" aria-label={t('menu.close')} onclick={() => (detailTrack = null)} use:tapBounce><X size={18} /></button></div>
		<dl class="detail">
			<dt>{t('menu.detailTitle')}</dt><dd>{names.dnTitle(detailTrack.title)}</dd>
			<dt>{t('menu.detailArtist')}</dt><dd>{names.dnArtist(detailTrack.artist)}</dd>
			<dt>{t('menu.detailAlbum')}</dt><dd>{detailTrack.album ? names.dnTitle(detailTrack.album) : '—'}</dd>
			<dt>{t('menu.detailQuality')}</dt><dd>{detailTrack.qualityLabel || detailTrack.quality || t('menu.detailUnknown')}</dd>
			<dt>{t('menu.detailSource')}</dt><dd>{detailTrack.source}</dd>
			<dt>{t('menu.detailUid')}</dt><dd class="mono">{detailTrack.uid}</dd>
			<dt>{t('menu.detailAudioUrl')}</dt><dd class="mono break">{detailTrack.audioUrl || t('menu.detailNotResolved')}</dd>
		</dl>
	</div>
{/if}

<style>
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.45); border: none; }
	.menu, .modal { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto; }
	/* Legacy single-line head — STILL used by the playlist-picker + detail sub-sheets. */
	.menu-head { font-size: calc(13px * var(--fs-title, 1)); color: var(--color-text-muted); padding: 8px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.menu-head.row { display: flex; align-items: center; justify-content: space-between; }
	.x { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; }
	/* D-08/D-09/D-10: two-row marquee header + top-right Like/Close cluster. Left text column
	   flexes (min-width:0 so the clips can shrink-and-ellipsis); right cluster is fixed-width. */
	.sheet-head { display: flex; align-items: center; gap: 12px; padding: 8px 10px; }
	.head-text { flex: 1; min-width: 0; }
	.hd-title { font-size: calc(15px * var(--fs-title, 1)); font-weight: 600; color: var(--color-text); line-height: 1.25; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; max-width: 100%; }
	.hd-artist { font-size: calc(13px * var(--fs-artist, 1)); font-weight: 400; color: var(--color-text-muted); line-height: 1.25; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; max-width: 100%; }
	.head-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 18px; }
	.hd-btn { min-width: 44px; min-height: 44px; display: grid; place-items: center; background: none; border: none; border-radius: 10px; color: var(--color-text); cursor: pointer; }
	.hd-btn:hover { background: var(--color-surface); }
	.hd-btn.liked { color: var(--color-primary); }
	.mi { width: 100%; display: flex; align-items: center; gap: 12px; background: none; border: none; color: var(--color-text); font-size: 15px; padding: 12px; border-radius: 10px; cursor: pointer; text-align: left; }
	.mi:hover { background: var(--color-surface); }
	.mi:disabled { opacity: 0.4; cursor: default; }
	.mi.accent { color: var(--color-primary); }
	.mi .count { margin-left: auto; font-size: 12px; color: var(--color-text-muted); }
	/* MENU-01 inline resolve spinner — neutral (NOT accent), sits in the leading 18px icon box so
	   the row width does not shift. Reduced-motion (OS pref + the app's [data-reduce-motion] rule)
	   drops the rotation; the row stays announced busy via aria-busy + the menu.preparing label. */
	.row-spinner { width: 16px; height: 16px; flex: none; border: 2px solid var(--color-text-muted); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (prefers-reduced-motion: reduce) { .row-spinner { animation: none; } }
	:global(:root[data-reduce-motion]) .row-spinner { animation: none; }
	.detail { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; padding: 6px 12px 14px; margin: 0; }
	.detail dt { color: var(--color-text-muted); font-size: 12px; }
	.detail dd { margin: 0; font-size: 13px; }
	.mono { font-family: ui-monospace, monospace; font-size: 11px; }
	.break { word-break: break-all; }
</style>
