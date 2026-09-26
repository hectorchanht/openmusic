<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { ListStart, ListEnd, Download, Check, Heart, ListPlus, User, Share2, Info, X, Plus, Shuffle, Repeat, Repeat1, Trash2, Moon, Sparkles, Layers, Image as ImageIcon, ChevronDown, Tags, Mic2, EyeOff } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { sleepTimer } from '$lib/stores/sleepTimer.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { dragClose } from '$lib/actions/dragClose';
	// quick-260916-0d9: the Download row's SECOND gesture. Q4 — longpress and the parent sheet's
	// dragClose are mutually exclusive by the SAME 8px threshold: any move >8px cancels the longpress
	// timer (longpress.ts `move`) and is the only thing that starts a drag (dragClose.ts, `rawDy >
	// DRAG_START`), so a stationary hold never drags and a drag never opens the picker.
	import { longpress } from '$lib/actions/longpress';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { marquee } from '$lib/actions/marquee';
	import { toast } from '$lib/stores/toast.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import { isGatedReady, shouldStartResolve } from './track-menu-gate';
	import { t } from '$lib/i18n';
	import { ensureTrackDetails, collectLyricCandidates, type LyricCandidate } from '$lib/services/catalog';
	import { prewarmTrack } from '$lib/services/prewarm';
	// Gap 4 (26-10): the LAZY on-demand cross-source variant fetch (26-08) fed to the Play-from-source
	// picker — fired ONLY on the row tap, never on menu open (T-26-10-02).
	// quick-260916-0d9: the SAME fan-out feeds the Download-from picker (Q1 — no second copy of
	// song-identity matching), with `versionsIncludingOwn` assembling its rows.
	import { fetchVariants, versionsIncludingOwn } from '$lib/services/variants';
	import { mapWithConcurrency } from '$lib/services/discovery';
	import { SOURCES } from '$lib/sources/registry';
	import VersionPicker from '$lib/components/VersionPicker.svelte';
	import DownloadRing from '$lib/components/DownloadRing.svelte';
	// quick-260919-1eh: the tag-edit sheet. Same co-mount arrangement as VersionPicker above — it
	// owns its own overlay lifecycle under a DISTINCT overlayId.
	import MetadataEditor from '$lib/components/MetadataEditor.svelte';
	// quick-260919-vrq: the app's ONLY boolean-control idiom (a real <button role="switch"
	// aria-checked>). No `type="checkbox"` exists anywhere in src, so the Remove-download confirm
	// borrows this rather than hand-rolling one.
	import SettingToggle from '$lib/components/SettingToggle.svelte';
	import { downloadTrack } from '$lib/services/download-track';
	// quick-260915-26g: the shared probe + the shared label formatter. TrackMenu cannot mount
	// DownloadControl (its Check state is blob-backed and its rows are full-width text buttons, not
	// 40x40 icons), so it consumes the same SERVICE instead — one implementation, two surfaces.
	// quick-260919-3j1 (F2): `localFileMeta` is the SIBLING of probeDownload — same module, same
	// formatter, opposite question. probeDownload asks the CDN "what WOULD I get"; localFileMeta
	// reads the bytes on the device and answers "what DO I have", with no network at all.
	import { probeDownload, localFileMeta, formatDownloadMeta, type DownloadProbe } from '$lib/services/download-probe';
	// quick-260913-jq4: the Check state is backed by the offline copy, not the downloads list.
	import { blobStore } from '$lib/services/blob-store';
	// quick-260919-3j1: the app-wide SERIALIZER in front of retagOne — the ONE tag-write path
	// (verify-before-write, and a `device:` uid refused as its first statement). Never retagOne
	// directly: two concurrent wasm passes over a 27 MB FLAC on a phone is an OOM.
	import { syncFileTags } from '$lib/services/file-tag-sync';
	import type { RetagEntry } from '$lib/services/retag';
	import { browser } from '$app/environment';
	import { songShareUrl, coverToken } from '$lib/services/share';
	// quick-260809-3uo: the share card now carries the cover the user is looking at — read from the
	// SAME shared reactive cache every other surface reads, plus the retained iTunes id.
	import { readCoverByUidOrName, readPinnedCover, pinCover } from '$lib/stores/cover-version.svelte';
	// quick-260915-w4f: the ENUMERATE-ALL cover collector. Imported for the picker only — it runs
	// alongside resolveTrackChain, never inside it, and fires ONLY on the Change-cover tap (Q1).
	// quick-260920-l82: the share-card carrier chain now lives beside the display chain in
	// cover-backfill.ts — this component no longer calls a cover tier directly (CLAUDE.md "Shared
	// Primitives — import these, never re-inline them"). `resolveShareCover` also owns the session memo.
	import { collectCoverCandidates, resolveShareCover, type CoverCandidate } from '$lib/services/cover-backfill';
	// quick-260919-1we: the lyrics picker's ENUMERATE-ALL collector + the pin read/write pair. Same
	// posture as the cover picker one line up — the parallel walk fires ONLY on the Fix-lyrics tap
	// (T-1we-03), never on menu open. `readLyrics` is D-4's single read (pin → track.lrc → null).
	import { readLyrics, pinLyrics, unpinLyrics } from '$lib/stores/lyric-pins.svelte';
	import { parseLyrics } from '$lib/stores/lyric-script.svelte';
	import { combinedSignal } from '$lib/services/abort-signal';
	import { recallItunesId } from '$lib/services/itunes-cover';
	import { isDeviceUid } from '$lib/services/device-track';
	import { excludeUid } from '$lib/services/import-exclusions';
	import type { Track } from '$lib/sources/types';

	// `loading` = the menu opened on a discovery STUB and is still resolving the real Track
	// (home long-press). It pops INSTANTLY with a skeleton; the action buttons render once the
	// track resolves — so the menu never waits on the network before appearing.
	let { track, open, loading = false, onclose }: { track: Track | null; open: boolean; loading?: boolean; onclose: () => void } = $props();

	let pickerOpen = $state(false);
	// quick-260919-vrq — the Remove-download CONFIRM, and why it is a SHEET rather than window.confirm.
	// The confirm carries a toggle whose position changes what the removal actually does (files die vs
	// files stay), and confirm() cannot hold a control. So it mirrors the playlist picker above
	// exactly: same scrim / .menu / fly / dragClose / focusTrap, its own overlay id, reset in close().
	// `rmDeleteFile` defaults ON — that is today's removeDownload behaviour (999.1-D-11: both copies),
	// so the row keeps meaning what its label says — and is re-armed on every open so an untick made
	// for one song never silently carries over to the next.
	let rmOpen = $state(false);
	let rmDeleteFile = $state(true);
	let detailTrack = $state<Track | null>(null);
	// quick-260919-1eh: the metadata editor sheet's open flag. No lazy fan-out to guard — the sheet
	// seeds itself from the track already in hand and saves offline, so there is no gen/abort pair.
	let tagsOpen = $state(false);
	const liked = $derived(track ? library.isLiked(track.uid) : false);
	const isDevice = $derived(!!track && isDeviceUid(track.uid));
	// quick-260919-dlring: is there an artist worth navigating TO? A name-stub and a `device:` import
	// with no artist tag both arrive with an empty (or whitespace-only) `artist`, and `/artist/` with
	// an empty param is not a page. Gates the header text control below; gotoArtist() re-checks it so
	// the `menu.goToArtist` row cannot route there either.
	const hasArtist = $derived(!!track && track.artist.trim() !== '');

	// Gap 4 (26-10): a lazily-fed VersionPicker reachable from the long-press menu — "Play from
	// source". A queued/played song carries only its own source, so the cross-source variants are
	// discovered on demand — but ONLY when the user taps the Play-from-source row (openVersions),
	// NEVER on menu open (no background fan-out; T-26-10-02). versionGen/versionAc are PLAIN
	// (non-reactive) supersedence guards (house idiom): a re-open bumps the token + aborts the prior
	// fetch so a stale result can't land. The sheet's overlay lifecycle is owned ENTIRELY by
	// VersionPicker (WR-02: keyed with the DISTINCT id 'versionpicker-menu' so it never collides with
	// the host page's own co-mounted VersionPicker) — so it converges on the SINGLE dismiss path; a
	// SECOND trackmenu-scoped overlay entry would double-push one history state per open and over-pop
	// the Back gesture (the invariant Task 3 verifies).
	let versionsOpen = $state(false);
	let versionsLoading = $state(false);
	let versionsList = $state<Track[]>([]);
	let versionGen = 0;
	let versionAc: AbortController | null = null;

	// quick-260915-w4f: the cover picker. Same shape as the Play-from-source picker above and for the
	// same reason — the candidate fan-out is a real cost (Deezer + iTunes + a full CN searchAll), so it
	// fires ONLY on the Change-cover row tap, never on menu open (T-26-10-02 posture). coverGen /
	// coverAc are PLAIN fields: supersedence guards the UI never reads reactively (house convention).
	let coverOpen = $state(false);
	let coverLoading = $state(false);
	let coverCandidates = $state<CoverCandidate[]>([]);
	let coverGen = 0;
	let coverAc: AbortController | null = null;

	// quick-260919-1we: the LYRICS picker — the exact same shape as the cover picker above, for the
	// exact same reason. The lyric chain is first-source-wins and sometimes wins wrong (wrong song,
	// wrong language, an instrumental's LRC), so this lets the user override it once, per song,
	// permanently. The candidate walk is a parallel per-source fan-out (a real cost), so it fires ONLY
	// on the Fix-lyrics row tap, never on menu open (T-1we-03 / T-26-10-02 posture). lyricGen /
	// lyricAc are PLAIN fields: supersedence guards the UI never reads reactively (house convention).
	let lyricsOpen = $state(false);
	let lyricsLoading = $state(false);
	let lyricCandidates = $state<LyricCandidate[]>([]);
	let lyricGen = 0;
	let lyricAc: AbortController | null = null;

	// quick-260916-0d9 — the "Download from…" picker. Same shape as the two pickers above and opened
	// the same opt-in way (T-26-10-02 posture), except the trigger is a LONG-PRESS on the Download row
	// rather than a row of its own: one tap must keep doing exactly what it does today.
	// `dlPickProbes` is uid → probe; ABSENT means still probing (skeleton), a probe whose `track` is
	// null means that source refused (disabled "Unavailable" row). dlPickGen / dlPickAc are PLAIN
	// fields — supersedence guards the UI never reads reactively (house convention).
	let dlPickOpen = $state(false);
	let dlPickLoading = $state(false);
	let dlPickList = $state<Track[]>([]);
	let dlPickProbes = $state<Record<string, DownloadProbe | undefined>>({});
	let dlPickGen = 0;
	let dlPickAc: AbortController | null = null;

	// The cover the user is CURRENTLY looking at for this track. Hoisted out of doShare (it needed the
	// identical expression) so the picker can tick the active tile and the share card can carry it —
	// one precedence chain, two consumers. Widest authority first: the user's pin, then the hero's own
	// cover when this IS the playing song, then the shared cache every list row reads, then the stub's art.
	//
	// 🔴 The cache lookup MUST use the RAW track.artist / track.title, NOT the display-language strings
	// (see doShare's note below) — the name layer is matchKey'd on raw CATALOG metadata.
	const activeCover = $derived(
		track
			? (readPinnedCover(track.uid) ??
					// quick-260920-oj8 — closes the quick-260920-nyq deferred item. This rung was
					// `player.resolvedCover`, the OLD precedence: nyq made the hero / Nowbar / OS card paint
					// from the shared cache first, so for the playing song this ladder could tick a picker
					// tile that is NOT the art on screen. The user's call is one resolver everywhere —
					// "same song, same cover everywhere" — so it reads the ONE now-playing reader
					// (`displayCover`: pin → uid → name → resolvedCover, embedded `data:` kept ahead of the
					// https-only cache per 37-D-02). Not re-inlined: the getter is the single seam.
					(player.current?.uid === track.uid ? player.displayCover : null) ??
					readCoverByUidOrName(track.uid, track.artist, track.title) ??
					track.cover ??
					null)
			: null
	);

	// quick-260920-kn4 — THE SHARE-CARD COVER FALLBACK (share card only; displayed art untouched).
	//
	// ROOT CAUSE. quick-260919-0mw put YouTube Music at the FRONT of resolveTrackChain, so
	// `activeCover` above is now usually a lh3.googleusercontent.com / i.ytimg.com URL. `coverToken`
	// is a CLOSED grammar (d: Deezer · l: Last.fm · k: kuwo · i: iTunes-by-id) and returns null for
	// those hosts, so `songShareUrl` emits no `?ci=` at all, /api/og re-resolves from artist+title
	// TEXT, and on a miss serves the branded OpenMusic fallback. The carrier grammar was simply never
	// revisited when the tier order changed.
	//
	// REJECTED: adding googleusercontent/ytimg to the grammar. Their artwork URLs are opaque
	// irregular paths with `=w120-h120-s-l90-rj` suffixes — nothing structural to close a grammar
	// over (the same reason iTunes is carried by ID, not by path). It would also WIDEN the set of
	// hosts /api/og fetches, which T-3uo-02 forbids.
	//
	// SO: while the menu is open, PREWARM a carriable cover for the same song via `resolveShareCover`
	// (cover-backfill.ts — iTunes, then Deezer on a miss). Its iTunes tier runs `fetchTopArtwork →
	// rememberItunesId`, which retains the numeric id against that URL, so `recallItunesId` in doShare
	// yields it and `coverToken` emits `i:<id>`. quick-260920-l82: the DEEZER tier is new and closes
	// kn4's residual gap — a song iTunes does not carry now yields `d:<32hex>` rather than the branded
	// card. It is a PREWARM and not an await in
	// doShare because navigator.share() must run synchronously inside the user gesture on iOS Safari.
	let shareCoverFallback = $state<string | null>(null);
	$effect(() => {
		// Tracked deps, read up-front and kept to exactly {open, track, activeCover}.
		const target = track;
		const cover = activeCover;
		if (!open || !target) {
			shareCoverFallback = null;
			return;
		}
		// NEVER override a working carrier: if the cover the user is looking at already tokenizes
		// (Deezer / Last.fm / kuwo / iTunes-with-id), the link is byte-identical to before and no
		// request is made at all. recallItunesId is a sync localStorage read, not reactive.
		if (coverToken(cover, recallItunesId(cover)) !== null) {
			shareCoverFallback = null;
			return;
		}
		// quick-260920-l82: no memo branch here any more — memoisation lives inside resolveShareCover.
		// A memo hit therefore lands one microtask later instead of synchronously; doShare reads
		// `shareCoverFallback` on a later user tap, so the ordering is unaffected.
		const ac = new AbortController();
		// The whole `target` Track is passed, so the RAW target.artist / target.title travel inside it,
		// NOT the display-language names.dn* strings — same rule as activeCover's cache lookup above:
		// the iTunes/Deezer search term must be the catalog metadata.
		// combinedSignal is the shared primitive (never hand-roll a second timeout); 8 s is the
		// ceiling because this is a background nicety behind a menu the user may close at any moment —
		// long enough for a slow mobile round-trip, short enough that a hung request cannot outlive
		// the session's interest in it.
		// untrack for the same reason the sibling effects give: resolveShareCover's iTunes tier reads
		// and writes the `itunes:` id family of the cover cache and Deezer's ttl-cache reads
		// localStorage — those reads would otherwise re-invalidate this effect (the restore-effect
		// self-invalidation loop).
		untrack(() => resolveShareCover(target, combinedSignal(8_000, ac.signal))).then((url) => {
			// Drop a late result for a song the user has already navigated past — exactly like the
			// localProbe effect below. No stale cover is ever carried for the wrong song.
			if (ac.signal.aborted || track?.uid !== target.uid) return;
			if (url) shareCoverFallback = url;
		});
		// 🔴 The no-cache-write prohibition now lives with the chain: resolveShareCover writes NEITHER
		// cover-cache layer, pinned by its "NO cover-cache write on a hit" test in cover-backfill.test.ts.
		// This component must still never call writeCoverBoth here — `activeCover` reads
		// readCoverByUidOrName, so a write would flip the art the app DISPLAYS on every list row and
		// on the hero. The fallback lives in this $state and the service-level memo, nowhere else.
		return () => ac.abort();
	});

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

	// 31-D-03 PRE-WARM (trigger 2 of the phase's two; trigger 1 is the top search result). Opening
	// this menu is a strong intent signal, so speculatively resolve THIS ONE track now — the tap that
	// follows then short-circuits on ensureTrackDetails' readiness guard instead of paying a cold
	// resolve. TrackMenu is mounted from seven route pages, so this single effect also covers every
	// page's long-press for free (a long-press only sets `open`). This is `gated()` minus the spinner
	// and minus the toast: pre-warm is speculative, so it must stay completely invisible on failure.
	//
	// NOT a T-26-10-02 VIOLATION — read this together with the header comment at :42-51. T-26-10-02
	// bans a cross-source FAN-OUT on menu open: `openVersions` → `fetchVariants` searches EVERY
	// enabled source, which is why it stays opt-in behind the Play-from-source row tap. 31-D-03
	// authorises exactly ONE single-track `ensureTrackDetails` — one resolve on the track's own
	// source, not a search across sources. Different traffic shape, different rule; both stand.
	// Dedupe (per uid, and against an in-flight resolve) lives in prewarmTrack, so re-opening the
	// same menu issues nothing.
	$effect(() => {
		if (open && track) prewarmTrack(track);
	});

	function close() {
		pickerOpen = false;
		tagsOpen = false; // quick-260919-1eh: reset alongside the other sheet flags
		rmOpen = false; // quick-260919-vrq: same — a confirm must never outlive the menu that raised it
		coverAc?.abort(); // quick-260915-w4f: never leave a candidate fan-out running behind a closed menu
		dlPickAc?.abort(); // quick-260916-0d9: same rule for the download-picker probe pool
		lyricAc?.abort(); // quick-260919-1we: same rule for the lyric-candidate walk
		onclose();
	}
	// Gap 4 (26-10): open the Play-from-source picker + fire the SINGLE lazy variant fan-out. Called
	// ONLY from the Play-from-source row tap — NEVER from a menu-open $effect (opt-in; T-26-10-02).
	async function openVersions() {
		if (!track) return;
		const gen = ++versionGen;
		versionAc?.abort();
		const ac = new AbortController();
		versionAc = ac;
		// Open immediately with the spinner; the single fetchVariants fan-out runs behind the sheet.
		versionsList = [];
		versionsLoading = true;
		versionsOpen = true;
		const list = await fetchVariants(track, ac.signal);
		if (gen !== versionGen || ac.signal.aborted) return; // superseded / cancelled
		versionsList = list;
		versionsLoading = false;
	}
	function closeVersions() {
		versionsOpen = false;
		versionAc?.abort(); // cancel any in-flight fetch when the sheet is dismissed.
	}
	// quick-260915-w4f: open the cover picker + fire the SINGLE candidate fan-out (Q1). Mirrors
	// openVersions exactly — gen bump + abort the prior fetch, open the sheet IMMEDIATELY with a
	// spinner so the sheet never waits on the network, then fill it.
	async function openCoverPicker() {
		// like-state-wrong-track-menu / 8a848d9: a uid-less name stub has no identity to pin against,
		// so there is nothing to key a pin by. The row is disabled for the same reason as Like.
		if (!track?.uid) return;
		const gen = ++coverGen;
		coverAc?.abort();
		const ac = new AbortController();
		coverAc = ac;
		coverCandidates = [];
		coverLoading = true;
		coverOpen = true;
		const list = await collectCoverCandidates(track, ac.signal);
		if (gen !== coverGen || ac.signal.aborted) return; // superseded / cancelled
		coverCandidates = list;
		coverLoading = false;
	}
	function closeCoverPicker() {
		coverOpen = false;
		coverAc?.abort();
	}
	// Pin the tapped candidate. pinCover persists it (own key, no TTL/LRU — Q3) and bumps the shared
	// reactive signal, so every list row repaints. player.adoptCover is a no-op unless this song is
	// CURRENT; when it is, it is what repaints the NowPlaying hero, the Nowbar and the OS media card
	// instantly — it is already the ONE promotion seam, and Task 2 taught it to accept a pin (Q5).
	function pickCover(url: string) {
		if (!track?.uid) return;
		pinCover(track.uid, url);
		player.adoptCover(track.uid, url);
		toast.show(t('toast.coverPinned'));
		// quick-260919-3j1 (F1 / D-1): and, when this app holds an offline copy, put the art in the
		// FILE. The pin above is what makes the choice permanent IN THE APP; a pin lives in
		// localStorage keyed by uid, so it is invisible to the phone's own music app, to any other
		// player, and to the file itself.
		writeTagsForGesture({ cover: url });
		closeCoverPicker();
		close();
	}

	// quick-260919-3j1 — THE ONE ENTRY BUILDER the two pin gestures share, so they cannot drift apart.
	// A component-local function over `track` / `names` / `player`, deliberately NOT a new module:
	// the one thing it must never become is a second copy of the Settings sweep's construction.
	//
	// D-7: `names.dnTitle` / `dnArtist` / `zhLock` is a VERBATIM copy of that sweep's entry
	// (settings/downloads/+page.svelte). `library.applyMetadata` persists an editor edit into
	// library.downloads, so `dnTitle(track.title, track.artist)` reproduces the user's OWN edit, not the catalog
	// string — a cover pin cannot clobber a manual metadata edit.
	//
	// NO `filename`: the sticky base recorded by quick-260919-3j1's blob-store index is what keeps a
	// user-typed file name from being reverted by a rewrite that knows nothing about it.
	//
	// `lyrics` is the SAME expression the <MetadataEditor> mount at the bottom of this file uses, so
	// a cover pin can never blank the lyrics the app is currently showing.
	function fileSyncEntry(overrides: Partial<RetagEntry>): RetagEntry | null {
		if (!track?.uid) return null;
		return {
			uid: track.uid,
			title: names.dnTitle(track.title, track.artist),
			artist: names.dnArtist(track.artist),
			album: names.zhLock(track.album),
			cover: activeCover,
			lyrics: readLyrics(track && player.current?.uid === track.uid ? player.current : track) ?? undefined,
			...overrides
		};
	}

	// quick-260919-3j1 (D-1) — THE REWRITE TRIGGER, AND THE LINE NOTHING AUTOMATIC MAY CROSS.
	//
	// This fires on an EXPLICIT TAP only: a cover pin or a lyric pin, one song, one wasm pass —
	// identical in cost and shape to the metadata editor's Save that already ships. An automatic
	// cover resolve, `cover-backfill`, `adoptCover` or `healCover` must NEVER reach this line.
	// `healCover` alone can fire PER RENDER on a flaky image; rewriting a 27 MB FLAC's tags there
	// would be catastrophic. The pin already makes the user's choice permanent in the app without
	// touching the file, which is why no automatic path needs this at all.
	//
	// Gate on `blobPresent === true`, never `!== false`: it starts `null` and is filled by the menu's
	// own open-effect, so `!== false` would fire a rewrite for a song this app has no copy of.
	//
	// quick-260919-ejm (D-6) — `isDevice` STAYS, and it is now a DELIBERATE BOUNDARY, not an echo of
	// a `retagOne` guard that has been lifted. Do not "fix" this by symmetry with the Edit-metadata
	// row above. A user-file rewrite happens from exactly TWO explicit gestures — Edit metadata ->
	// Save, and the confirmed Settings -> Downloads sweep — and a one-tap cover or lyric pin is
	// neither: silently rewriting 27 MB of someone's own FLAC as a side effect of tapping a
	// thumbnail is not what was authorised. The pin already makes the choice permanent IN THE APP
	// for an imported file, which is the whole user-visible benefit, with none of the risk.
	//
	// FIRE-AND-FORGET: the pin has already repainted every surface, so the file write must never
	// block the sheet closing. Success needs no toast (`toast.coverPinned` / `toast.lyricsPinned`
	// already said it); only a real failure speaks, through the existing `toast.tagsFailed`.
	//
	// THE HONEST CEILING: pinning while OFFLINE still writes the text tags, but the ART cannot be
	// fetched — `resolveArtworkDataUrl` fails, `tagAudioBlob` then simply runs no picture setter, so
	// the file's existing art survives untouched. The Settings -> Downloads sweep repairs it later,
	// because that sweep now reads the pin (the other half of this task).
	function writeTagsForGesture(overrides: Partial<RetagEntry>) {
		if (blobPresent !== true || isDevice) return;
		const entry = fileSyncEntry(overrides);
		if (!entry) return;
		void syncFileTags(entry).then((r) => {
			if (r !== 'tagged' && r !== 'device-skipped') toast.show(t('toast.tagsFailed'));
		});
	}

	// quick-260919-1we (D-6): opening the sheet IS the reloader. Nothing caches a resolved LRC
	// client-side (apiFetch's GET dedupe is in-flight only), so every open re-walks the sources live —
	// which is why there is no always-visible "Reload" button: it would re-run the walk that just ran.
	// Mirrors openCoverPicker exactly: gen bump + abort the prior walk, open the sheet IMMEDIATELY
	// with a spinner so it never waits on the network, then fill it.
	async function openLyricsPicker() {
		// Same reason the Like and Change-cover rows are disabled: a uid-less name stub has no
		// identity to pin against (D-1 — the pin record is keyed per uid).
		if (!track?.uid) return;
		const gen = ++lyricGen;
		lyricAc?.abort();
		const ac = new AbortController();
		lyricAc = ac;
		lyricCandidates = [];
		lyricsLoading = true;
		lyricsOpen = true;
		// combinedSignal is the shared caller-signal + timeout primitive (never hand-roll a second
		// controller). The 15s ceiling is T-1we-03: a hung upstream must not pin the sheet on a spinner.
		const list = await collectLyricCandidates(track.artist, track.title, combinedSignal(15_000, ac.signal));
		if (gen !== lyricGen || ac.signal.aborted) return; // superseded by a re-tap / cancelled
		lyricCandidates = list;
		lyricsLoading = false;
	}
	function closeLyricsPicker() {
		lyricsOpen = false;
		lyricAc?.abort();
	}
	// Pin the tapped LRC. D-4: NO player call is needed — pinLyrics bumps the shared reactive signal
	// and every lyrics surface reads through readLyrics(), so the NowPlaying pane and the Nowbar line
	// repaint on the spot with no replay and no `player.current` surgery.
	function pickLyrics(lrc: string) {
		if (!track?.uid) return;
		pinLyrics(track.uid, lrc);
		toast.show(t('toast.lyricsPinned'));
		// quick-260919-3j1 (F3): and into the FILE, when this app holds an offline copy. The pin above
		// stays the in-app mechanism (it bumps the shared signal and every lyrics surface repaints
		// through readLyrics, 1we's D-4) — but a pin lives in localStorage keyed by uid, so it is
		// invisible to the phone's music app, to any other player, and to the file itself. The whole
		// point of F3 is that the downloaded file is SELF-SUFFICIENT. Same explicit-tap-only gate as
		// pickCover; see writeTagsForGesture.
		writeTagsForGesture({ lyrics: lrc });
		closeLyricsPicker();
		close();
	}
	// D-6: drop the pin and fall the read back to the app's own lyrics. Reuses menu.lyricsAuto as the
	// toast text rather than minting a sixth key for one sentence.
	function resetLyrics() {
		if (!track?.uid) return;
		unpinLyrics(track.uid);
		toast.show(t('menu.lyricsAuto'));
		closeLyricsPicker();
		close();
	}
	function playNext() { if (track) { player.playNext(track); toast.show(t('toast.playingNext')); } close(); }
	function addQueue() { if (track) { hapticTick(); player.addToQueue(track); toast.show(t('toast.addedToQueue')); } close(); }
	// ii6: Shuffle moved off the NowPlaying transport row into the menu. Shown only when
	// there's a queue to shuffle (otherwise the action would be a no-op).
	function shuffleQueue() { player.toggleShuffle(); close(); }
	// quick-260919-0mw (correction): Repeat follows Shuffle off the NowPlaying transport row into this
	// menu, so the transport row can hand its slot to Download. Same shape as shuffleQueue — cycle,
	// then close — because a menu row that stays open after acting reads as "nothing happened".
	// Closing costs the in-place cycle the old button had, so the row must show WHICH mode it is in
	// before the tap, not after: the label itself swaps between the two existing nowplaying.* keys
	// (see the template), which is the only state readout that survives the menu closing.
	function cycleRepeatMode() { player.cycleRepeat(); close(); }
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
		// quick-260919-dlring: `hasArtist` is re-checked HERE, not only at the two call sites, so no
		// caller can route to `/artist/` with an empty name. Navigating with the RAW track.artist is
		// load-bearing — names.dnArtist is a display translation and the route must not see it.
		if (!track || !hasArtist) return;
		const dest = `/artist/${encodeURIComponent(track.artist)}`;
		overlays.navigateAway(() => goto(dest));
	}

	// Gated run callback (D-02): invoked by gated('download', …) with the resolved track. Thin delegate
	// to the SHARED downloadTrack (29-03) — the ONE isolation-safe, never-throws, never-navigates save
	// path. The bespoke fetch → offline-blob → save-picker → anchor → new-tab-stream fallback that used
	// to live here is DELETED (DL-BUG-01: a failed save can no longer open a media page); its logic
	// (filename build, quality-reuse, offline blob, anchor save) now lives in download-track.ts +
	// download-save.ts + download-filename.ts.
	//
	// DOWNLOAD ISOLATION CONTRACT (D-18, quick-260625-pzs-04): download work must NOT touch the player —
	// no assign to player.current, no clearing its lrc, no player.playGen bump, no reuse of the shared
	// <audio>. downloadTrack upholds this (reads player.current READ-ONLY to reuse an already-resolved
	// URL) so the guarantee is preserved by delegation.
	//
	// D-12: we deliberately do NOT onclose() first — the Download row reflects its per-uid state
	// (library.downloading / isDownloaded) inline whether or not the menu stays open. The result
	// sentinel is localized to a toast here (the service is i18n-free by contract).
	// quick-260913-jq4: Download DOES NOT go through gated() any more (D-02 still stands for Remix
	// and Detail — they genuinely need a resolved audioUrl in hand before they can run).
	//
	// gated() pre-resolved the stub and then vetoed on `!resolved.audioUrl` with toast.noAudio
	// BEFORE doDownload ever ran. That veto was both redundant and wrong here:
	//   - it resolves at the STREAMING default, while downloadTrack forces its own fresh resolve at
	//     settings.downloadQuality — so it could reject a download that would have succeeded, and
	//     the user saw an instant "no audio available" on the first tap instead of a spinner;
	//   - downloadTrack already brackets library.beginDownload/endDownload SYNCHRONOUSLY before its
	//     first await, so the per-uid spinner appears on the same tick and spans the REAL operation;
	//   - downloadTrack never throws and returns 'no-audio' itself when there truly is none.
	// One resolve, one authority, and the toast now reports what actually happened.
	async function startDownload() {
		if (!track) return;
		if (library.downloading.has(track.uid)) return; // D-03 equivalent: a second tap while busy is a no-op
		toast.show(t('toast.preparingDownload'));
		// quick-260915-26g: the label and the file must agree. The probe already resolved this song AT
		// settings.downloadQuality, so pass that Track back in — downloadTrack's reuseInput branch then
		// saves the exact file the row just measured instead of re-resolving a third time.
		const picked = dlProbe?.track && dlProbe.track.uid === track.uid ? dlProbe.track : track;
		const res = await downloadTrack(picked);
		toast.show(
			res === 'saved'
				? t('toast.downloaded')
				: res === 'no-audio'
					? t('toast.noAudio')
					: t('toast.downloadFailedKeptInLibrary')
		);
		// The Check state is blob-backed (see `blobPresent`), so re-probe rather than assume: 'saved'
		// only means the anchor click fired, which is true even when the user cancels the save dialog.
		await probeBlob();
	}

	// quick-260919-30x — "Don't import again" for an IMPORTED (device:) song.
	//
	// THIS IS NOT A DELETE, and the distinction is the whole feature. `library.removeDownload` drops
	// the library row and then calls `blobStore.del`, whose native branch REFUSES a `device:` uid as
	// its FIRST statement (34 Pitfall 1) — so `deleteFromMusic` (a MediaStore contentResolver.delete,
	// which really does destroy the file) is never reached. The user's own audio file is not read,
	// renamed, moved or deleted: it stays in their Music/ or Download/ folder under its own name and
	// their phone's music app still lists it. The only things that change are the in-memory +
	// localStorage library row and the new exclusion mark.
	//
	// The mark is what makes the removal STICK: without it the next device scan finds the same file
	// and imports it straight back. `toast.noImportDone` says "stays on your phone" for the same
	// reason — a row that reads like a delete has to promise, in the moment, that it is not one.
	function noImport() {
		if (!track?.uid) return;
		// excludeUid BEFORE removeDownload: the label is read off the track, and the removal is what
		// makes the row disappear. `names.dn*` so the recovery list reads in the user's display script.
		excludeUid(track.uid, `${names.dnArtist(track.artist)} - ${names.dnTitle(track.title, track.artist)}`.trim());
		library.removeDownload(track.uid);
		toast.show(t('toast.noImportDone'));
		close();
	}

	// quick-260919-vrq — "Remove download" for an APP-DOWNLOADED song, behind a confirm sheet.
	//
	// (a) TOGGLE ON (the default) = delete + exclude, which is what the user asked for verbatim
	//     ("checkbox on remove file on disk and auto added to exclude list"). The exclusion mark is
	//     belt-and-braces rather than dead state: `deleteFromMusic` never throws, so a MediaStore
	//     delete that fails SILENTLY leaves a Music/OpenMusic copy behind that a later scan could
	//     find — the mark records the user's intent against exactly that case.
	// (b) TOGGLE OFF = the library row only. `blobStore.del` is never reached, so the app-private
	//     file and the Music/OpenMusic entry (native) or the IndexedDB copy (web) all survive. NO
	//     exclusion mark is written: the user chose to KEEP the file, and a mark keyed on the APP uid
	//     would not block a rescan anyway — a rescan imports that surviving file under a NEW
	//     `device:` uid. So neither the toast nor the body copy promises it cannot come back.
	// (c) APP DOWNLOADS ONLY. `blobStore.del` REFUSES a `device:` uid as its first statement (34
	//     Pitfall 1), so "delete the offline copy" is something the app literally cannot do for an
	//     import — offering the toggle there would be a UI lie. `device:` keeps noImport.
	// (d) ON THE WEB the toggle is SHOWN, not hidden or disabled: the browser build's `blobStore.del`
	//     deletes the IndexedDB offline copy, which is real reachable bytes. Only a file saved through
	//     the browser's own download folder is out of reach, and `menu.removeDownloadBody` says so —
	//     the same truth `settings.retagDownloadsDesc` already tells.
	function openRemoveDownload() {
		if (!track?.uid) return;
		rmDeleteFile = true;
		rmOpen = true;
	}
	function confirmRemoveDownload() {
		if (!track?.uid) return;
		// Same label expression as noImport — `names.dn*` so the recovery list reads in the user's
		// display script.
		if (rmDeleteFile)
			excludeUid(track.uid, `${names.dnArtist(track.artist)} - ${names.dnTitle(track.title, track.artist)}`.trim());
		library.removeDownload(track.uid, { deleteFile: rmDeleteFile });
		toast.show(t('toast.downloadRemoved'));
		rmOpen = false;
		close();
	}

	// quick-260913-jq4 — WHAT "DOWNLOADED" MEANS. `library.isDownloaded(uid)` is membership in the
	// downloads REFERENCE list, and `library.addDownload` deliberately runs BEFORE the fetch so a
	// failed download still leaves the song re-streamable (DL-BUG-01). On top of that the web save is
	// an `<a download>` click, which reports success even when the user cancels the browser's save
	// dialog — the platform gives no cancel signal. So the list happily says "Downloaded" with
	// nothing stored anywhere.
	//
	// The offline copy CAN be checked, and it is the thing that actually makes an offline play work,
	// so the Check state reads that instead. `null` = not probed yet → render the normal Download
	// affordance (the probe is a single indexed key lookup; it lands in ms).
	//
	// The downloads list keeps its own meaning ("the user asked for this offline") and is untouched;
	// migrating the other surfaces that render download state to this probe is a separate change.
	let blobPresent = $state<boolean | null>(null);
	async function probeBlob() {
		const uid = track?.uid;
		if (!browser || !uid) return;
		const present = await blobStore.has(uid);
		if (track?.uid === uid) blobPresent = present; // ignore a probe the user has already navigated past
	}
	$effect(() => {
		const uid = track?.uid;
		if (!open || !uid) {
			blobPresent = null;
			return;
		}
		let alive = true;
		untrack(() => blobStore.has(uid)).then((present) => {
			if (alive) blobPresent = present;
		});
		return () => {
			alive = false;
		};
	});

	// quick-260915-26g — THE ONE OPT-IN PROBE SURFACE. `settings.downloadQuality` is a request, not a
	// promise (kuwo answers "lossless" with a 320K mp3), so the Download row states what the tap will
	// ACTUALLY produce: `FLAC · 38.2 MB`, measured. The user chose that truth over an instant guess and
	// accepted its cost.
	//
	// THE COST, EXPLICITLY. This sits beside the 31-D-03 prewarm and does NOT replace it: prewarm
	// resolves at the STREAMING tier, and a download-tier (lossless) url must never become the url the
	// player streams — that is how a phone on cellular ends up pulling a 52 MB FLAC. So at
	// downloadQuality='lossless' a menu open costs prewarm + the probe's resolve + one HEAD; at
	// auto/320/128 the probe reuses the freshly-resolved track and issues only the HEAD. Re-opening the
	// same menu costs nothing (the service memoises per uid|quality).
	let dlProbe = $state<DownloadProbe | null>(null);
	let dlProbing = $state(false);
	$effect(() => {
		// GATE ON `=== false`, NOT `!== true`. `blobPresent` starts null and is filled by the async
		// effect above, so `!== true` would fire a resolve + HEAD on EVERY open — including for an
		// already-downloaded song, whose Download row is not even rendered — and then abort it a tick
		// later. Waiting for a definite "not downloaded" costs one tick and saves a guaranteed wasted
		// round-trip; this app is specifically sensitive to menu-open request volume. Do not simplify.
		const target = track;
		if (!open || !target || isDevice || blobPresent !== false) {
			dlProbe = null;
			dlProbing = false;
			return;
		}
		const ac = new AbortController();
		dlProbing = true;
		// untrack: probeDownload reads settings/player internally and those reads would otherwise
		// re-invalidate this effect (the restore-effect self-invalidation loop). Same discipline as the
		// blobPresent effect above; the cleanup aborts on close so no stale label lands on the next song.
		untrack(() => probeDownload(target, ac.signal)).then((p) => {
			if (!ac.signal.aborted) {
				dlProbe = p;
				dlProbing = false;
			}
		});
		return () => ac.abort();
	});
	const dlMeta = $derived(dlProbe ? formatDownloadMeta(dlProbe) : null);

	// quick-260919-3j1 (F2) — the MIRROR of the dlProbe effect above, and deliberately so.
	//
	// The two are MUTUALLY EXCLUSIVE by their gates: the download probe fires only on
	// `blobPresent === false`, this one only on `blobPresent === true`, so neither can ever run for
	// the same song. Same `===` discipline for the same reason stated above — `blobPresent` starts
	// null, so `!== false` would fire on EVERY open and abort a tick later.
	//
	// UNLIKE dlProbe: no `isDevice` exclusion, on purpose. An imported file is exactly the case where
	// the app's catalog metadata is thinnest and the file's own numbers are the only truth.
	// `blobStore.stat` reads a device uid in place through the same content-URI path `nativeGet`
	// uses, and READING is always permitted — it is writing, moving and deleting that are refused.
	//
	// `localFileMeta` reads nothing reactive, but the untrack keeps this effect's dependency set to
	// exactly {open, track, blobPresent} — the same discipline the two effects beside it follow
	// (restore-effect self-invalidation loop).
	let localProbe = $state<DownloadProbe | null>(null);
	$effect(() => {
		const target = track;
		if (!open || !target || blobPresent !== true) {
			localProbe = null;
			return;
		}
		let alive = true;
		untrack(() => localFileMeta(target)).then((p) => {
			// drop a late result the user has already navigated past
			if (alive && track?.uid === target.uid) localProbe = p;
		});
		return () => {
			alive = false;
		};
	});
	const localMeta = $derived(localProbe ? formatDownloadMeta(localProbe) : null);
	const dlLabel = $derived(dlMeta ? `${t('menu.download')} \u00b7 ${dlMeta}` : t('menu.download'));

	// quick-260916-0d9 \u2014 OPEN THE "Download from\u2026" SHEET (long-press only; one tap is unchanged).
	//
	// Q2 PROBE COST. The sheet opens on the SAME tick with the own-source row already labelled: the
	// main Download row's `dlProbe` was measured under the exact `uid|downloadQuality` memo key
	// `probeDownload` would use, so seeding it costs zero network AND guarantees that row is never a
	// skeleton (the service would answer instantly anyway \u2014 seeding skips even the microtask).
	// `fetchVariants` then runs behind a spinner line (its searchAll is D-04 TTL-memoised, so a
	// re-open is free), and every OTHER candidate is probed through `mapWithConcurrency(\u2026, 2, \u2026)`.
	//
	// WHY 2, AND DO NOT RAISE IT. Each probe is one governed `ensureTrackDetails` + one raw HEAD/Range,
	// so 2 in flight can hold at most 2 of `apiFetch`'s MAX_CONCURRENT_REQUESTS=8 slots, leaving >=6
	// for playback. An uncapped `/api/*` fan-out is precisely what froze this app (api-fetch-flood-freeze).
	async function openDownloadPicker() {
		if (!track?.uid || isDevice) return;
		const gen = ++dlPickGen;
		dlPickAc?.abort();
		const ac = new AbortController();
		dlPickAc = ac;
		const target = track;
		dlPickProbes = dlProbe?.track?.uid === target.uid ? { [target.uid]: dlProbe } : {};
		dlPickList = versionsIncludingOwn(target, []);
		dlPickLoading = true;
		dlPickOpen = true;
		const found = await fetchVariants(target, ac.signal);
		if (gen !== dlPickGen || ac.signal.aborted) return; // superseded / cancelled
		dlPickList = versionsIncludingOwn(target, found);
		dlPickLoading = false;
		// Per-item write INSIDE fn so each row fills the instant its own probe lands, rather than the
		// whole sheet unblanking at the end. untrack: probeDownload reads settings/player internally
		// and this runs inside a user handler, not an effect \u2014 the guard matches the dlProbe effect's.
		await mapWithConcurrency(
			dlPickList.filter((v) => !(v.uid in dlPickProbes)),
			2,
			async (v) => {
				const p = await untrack(() => probeDownload(v, ac.signal));
				if (gen !== dlPickGen || ac.signal.aborted) return;
				dlPickProbes = { ...dlPickProbes, [v.uid]: p };
			}
		);
	}
	function closeDownloadPicker() {
		dlPickOpen = false;
		dlPickAc?.abort(); // closing the sheet cancels every probe still in flight (T-0d9-01)
	}
	// quick-260916-0d9 \u2014 Q5 IDENTITY. `track` (the ORIGINAL the menu opened on) carries the identity;
	// `audioFrom` carries the row's MEASURED audio. downloadTrack spreads the original, so
	// library.addDownload and blobStore.put both key by the original uid \u2014 which is what makes
	// `library.isDownloaded(track.uid)` true and `player.play(track)` take the offline-blob branch and
	// play the source the user actually chose. It also skips the re-resolve, so the bytes saved are the
	// bytes the row promised (never a larger re-resolved file \u2014 the 52 MB-FLAC-on-cellular incident).
	async function pickDownload(v: Track) {
		if (!track) return;
		const p = dlPickProbes[v.uid];
		if (!p?.track?.audioUrl) return; // the row is disabled in that state anyway
		if (library.downloading.has(track.uid)) return; // D-03 equivalent: a second tap while busy is a no-op
		closeDownloadPicker();
		toast.show(t('toast.preparingDownload'));
		const res = await downloadTrack(track, { audioFrom: p.track });
		toast.show(
			res === 'saved'
				? t('toast.downloaded')
				: res === 'no-audio'
					? t('toast.noAudio')
					: t('toast.downloadFailedKeptInLibrary')
		);
		// D-12: the menu itself stays open \u2014 the Download row reflects downloading/downloaded inline.
		await probeBlob();
	}

	async function doShare() {
		if (!track) return;
		// quick-260920-kn4 — read the carried cover BEFORE onclose(). `onclose()` flips `open` to
		// false in the parent, which makes the prewarm effect above reset `shareCoverFallback` to
		// null. Effects flush after this synchronous handler in Svelte 5, so today the order is
		// already safe — reading first makes it correct regardless of flush timing.
		//
		// The fallback is the resolveShareCover prewarm result (iTunes, else Deezer), used ONLY when the displayed cover could not be
		// tokenized (see the effect above for why YTM hosts cannot be). It never overrides a working
		// carrier, so links for Deezer/Last.fm/kuwo/iTunes covers are unchanged.
		const shareCover = shareCoverFallback ?? activeCover;
		onclose();
		// SHARE-02 / DQ-1 / DQ-4 / OG-PATH-02 (quick-260614-1w3, supersedes D-04/D-06 for the SONG
		// surface): build the SHORT readable link `/song/{artist}/{title}` — CARRIER-FREE (no `?` at
		// all: no base64 `?play=` queue token, no `{source}{id}` suffix, no `n`/`a`/`c` params). The
		// two path segments ARE the authoritative title+artist; the song page resolves a playable
		// track from them at open time and unfurls its OG card from them server-side.
		//
		// quick-260723-r4p (YouTube-Music-style card) — both former carriers are now retired:
		//  (a) OG-ZH-01 / RESEARCH §E.17: no `dn`/`da` QUERY carriers. The title/artist go in the PATH.
		//  (b) OG-EP-01: no cover read here — the card image is the own-origin /api/og endpoint, which
		//      re-resolves the album art server-side (so a shared card no longer depends on whatever
		//      happened to be in this device's cover cache).
		//
		// quick-260808-urx: the path now carries the DISPLAY-language names — the exact text this
		// user sees on screen — not the raw catalog metadata. A zh-Hant user looking at 夢伴 / 李悅君
		// shares `/song/李悅君/夢伴`, never the Simplified 梦伴 / 李悦君 ("if the user is zht … it
		// should not show in zhs while sharing"). Simplified is an internal RESOLUTION concern.
		//
		// This is NOT a reversal of OG-ZH-01: the `dn`/`da` QUERY CARRIERS stay dead. Display text
		// rides the PATH, which is the SINGLE value used for both display and resolution — the
		// failure mode OG-ZH-01 killed was a converted display carrier diverging from the
		// resolution key, not Traditional text per se.
		//
		// Reliability (verified — do not re-check): names.resolve() returns the cached display
		// string and falls back to the RAW text on a miss, so share time returns exactly what the
		// UI rendered; for zh-Hant the s2t dict is boot-warmed (quick-260712-et3), so it is
		// synchronous. Both strings are computed ONCE here so the URL and the OS share-sheet title
		// (also user-visible text) cannot disagree.
		//
		// The recipient-side resolution risk this reintroduces — a Traditional query against the
		// mostly-Simplified CN index — is closed by resolveStub's t2s rescue-on-miss (quick-260808-urx).
		// quick-260925-x8o: the title passes its artist too. dnArtist aliases a rescued artist alone,
		// so a bare title would build a HYBRID /song/周杰倫/Coral Sea the recipient cannot rescue (a
		// non-Latin artist skips the wa7 rescue); the pair gives /song/周杰倫/珊瑚海.
		const dTitle = names.dnTitle(track.title, track.artist);
		const dArtist = names.dnArtist(track.artist);
		// quick-260809-3uo — CARRY THE COVER THE USER IS ACTUALLY LOOKING AT.
		//
		// WHY at all: /api/og re-resolves the card cover server-side from artist+title TEXT, through a
		// chain that is independent of the client's. So a song the app is visibly showing art for could
		// still unfurl a BLANK card — reported for 你瞞我瞞 / 陳柏宇, whose in-app cover comes from the
		// client's iTunes tier (Quinquennium). Adding more server tiers is whack-a-mole; the client
		// already knows the answer right here. What travels is a SHORT COVER ID, never a URL (see
		// coverToken), so no sharer-supplied host or path can reach /api/og's fetcher.
		//
		// Precedence, widest-authority first: the hero's own cover when this IS the playing song, then
		// the SAME shared cache every list row reads (so sharing from a row matches the row), then the
		// stub's art.
		//
		// 🔴 The cache lookup MUST use the RAW track.artist / track.title, NOT dArtist / dTitle. The
		// name layer is matchKey'd on the raw CATALOG metadata; passing the display-language strings
		// (quick-260808-urx converts them — zh-Hant 夢伴 for catalog 梦伴) would miss the cache for
		// exactly the users the display conversion exists for.
		// An uncovered-tier cover (netease / qq / joox) simply yields no token and no regression — the
		// carrier is advisory, and the card falls back to the server tier chain exactly as today. The
		// iTunes id is recalled HERE because coverToken is pure: a store/storage never flows into a
		// pure service (CLAUDE.md), so the component does the lookup and passes the value in.
		// 38-D-08: the 4th arg is the song IDENTITY (uid/source/songid) — a direct detail resolve, not a
		// name search. Args 1-2 stay display names (OG-ZH-01); share.ts skips device:/non-decodable ids.
		const url = songShareUrl({ title: dTitle, artist: dArtist }, shareCover, recallItunesId(shareCover), track);
		try {
			const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
			// quick-260808-vkd — the link rides `text`, NOT `url`. DO NOT "fix" this back.
			// The Web Share API spec URL-PARSES `ShareData.url` and re-serializes it, and the WHATWG
			// URL serializer percent-encodes every path code point above U+007E — so a `url` member
			// silently undoes encodePathSegment's raw-CJK output (quick-260807-vl1) at the very last
			// step, and `喺呢到大` reaches the recipient as `%E5%96%BA…`. `ShareData.text` is NOT
			// parsed; it is passed through verbatim. Nothing is lost by the swap: WhatsApp / iMessage
			// / Slack auto-linkify a bare URL inside shared text and still fetch its OG card.
			// Sending BOTH is not an option — many targets concatenate `text` and `url`, which would
			// put the link in the message twice (once readable, once encoded), worse than the bug.
			// quick-260808-vzu — the title line is now OPT-IN (settings.shareIncludeTitle, default
			// OFF). Concatenating targets (WhatsApp) render `title` and `text` as two separate lines,
			// so an unconditional title showed `Song • Artist` above the link and then AGAIN inside
			// the OG card the link unfurls into. It is a SETTING, not a deletion — some users want the
			// context inline, so the old behavior is one toggle away in Settings → General. Tradeoff
			// when OFF: targets that use `title` as a subject line (email, some Slack surfaces) get a
			// barer share. No placeholder title in the OFF branch — the Web Share spec needs at least
			// one of title/text/url, and `{ text: url }` satisfies it.
			if (nav.share) await nav.share(settings.shareIncludeTitle ? { title: `${dTitle} • ${dArtist}`, text: url } : { text: url });
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
	// quick-260919-vrq: the remove-download confirm's own balanced entry — same shape + untrack guard,
	// distinct id so Back pops exactly this sheet, and Back is a DISMISS, so it removes nothing.
	$effect(() => {
		if (rmOpen && track) {
			untrack(() => overlays.open("trackmenu-rmdl", () => (rmOpen = false)));
			return () => untrack(() => overlays.dismiss("trackmenu-rmdl"));
		}
	});
	$effect(() => {
		if (detailTrack) {
			untrack(() => overlays.open("trackmenu-detail", () => (detailTrack = null)));
			return () => untrack(() => overlays.dismiss("trackmenu-detail"));
		}
	});
	// quick-260915-w4f: the cover picker's own balanced overlay entry (same shape + `untrack` guard
	// as the two above, distinct id so Back pops exactly this sheet).
	$effect(() => {
		if (coverOpen && track) {
			untrack(() => overlays.open("trackmenu-cover", () => closeCoverPicker()));
			return () => untrack(() => overlays.dismiss("trackmenu-cover"));
		}
	});
	// quick-260916-0d9: the download picker's own balanced overlay entry — distinct id so Back pops
	// exactly this sheet, and its close handler aborts the probe pool on every dismiss route.
	$effect(() => {
		if (dlPickOpen && track) {
			untrack(() => overlays.open("trackmenu-dlpick", () => closeDownloadPicker()));
			return () => untrack(() => overlays.dismiss("trackmenu-dlpick"));
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
			<!-- quick-260919-dlring: the header text block IS the Go-to-artist control. It routes
			     through the SAME gotoArtist() as the `menu.goToArtist` row below — one route-building
			     path, one overlays.navigateAway() dismissal, so the two can never disagree (exactly
			     the header-icon + list-row precedent D-09/je8 set for Download). Note gotoArtist()
			     navigates with the RAW track.artist; names.dnArtist is display-only and must never
			     reach the route.
			     A <button> that is a SIBLING of .head-actions, never a wrapper around it — the Like /
			     Download / Close buttons must not end up nested inside a button. The two clip elements
			     are <span>s (not <div>s) so the button's phrasing-only content model holds; `use:marquee`
			     is untouched and the CSS gives them back `display: block`, so the two-row shape and the
			     header height are byte-identical to the div version.
			     NO usable artist (a name-stub, or a `device:` import with no artist tag) → `disabled`.
			     A disabled button is not focusable and not clickable, so the header degrades to inert
			     text rather than becoming a control that navigates nowhere; `.head-text` carries no
			     `:disabled` dimming, so it still LOOKS exactly like the plain block it used to be. -->
			<button
				class="head-text"
				onclick={gotoArtist}
				disabled={!hasArtist}
				aria-label={hasArtist ? `${t('menu.goToArtist')}: ${names.dnArtist(track.artist)}` : undefined}
			>
				{#key track.uid}
					<span class="hd-title" use:marquee><span class="marquee-inner">{names.dnTitle(track.title, track.artist)}</span></span>
					<span class="hd-artist" use:marquee><span class="marquee-inner">{names.dnArtist(track.artist)}</span></span>
				{/key}
			</button>
			<div class="head-actions">
				<!-- D-09 AMENDED by quick-260913-je8: the header accent slot is DOWNLOAD now, not Like.
				     D-09's "Like is the sole header accent AND the mid-list Like row is removed" no
				     longer holds — Like is back as a text row below; the rest of D-09 (two-row marquee
				     header, explicit Close affordance) stands unchanged.
				     Download is DELIBERATELY duplicated (header icon + list row): both call the SAME
				     gated('download', doDownload) and read the SAME tri-state sources (inFlight +
				     library.downloading / isDownloaded), so the two can never disagree (D-11/D-12). -->
				<!-- 34 (RESEARCH bites #10/#11, UI-SPEC Contract 8): Download is HIDDEN for device:
				     entries — downloading a file already on this phone is nonsense. This is a NEW
				     visibility condition.
				     quick-260920-kia: Contract 8's SHARE half is SUPERSEDED — Share is unconditional;
				     see the Share row's note below for why the "local uid in the URL" premise no longer
				     holds. The `!isDevice` fork below gates DOWNLOAD ONLY.
				     track-menu-gate.ts (isGatedReady/shouldStartResolve) is resolve TIMING and is
				     deliberately not extended. -->
				<!-- quick-260919-et3: Like as a header icon, BEFORE Download. Duplicated with the Like
				     text row below on exactly the precedent D-09/je8 set for Download (header icon +
				     list row): both call the same like() and read the same `liked` derived, so the two
				     can never disagree. NOT wrapped in the !isDevice guard — that guard exists because
				     downloading a file already on this phone is nonsense, which says nothing about
				     liking an imported song. Same `!track.uid` disable as the row: a name-stub has no
				     identity to like yet. -->
				<button
					class="hd-btn"
					class:accent={liked}
					aria-pressed={liked}
					disabled={!track.uid}
					aria-label={liked ? t('menu.liked') : t('menu.like')}
					title={liked ? t('menu.liked') : t('menu.like')}
					onclick={like}
					use:tapBounce
				>
					<Heart size={20} fill={liked ? 'currentColor' : 'none'} />
				</button>
				{#if !isDevice}
					{#if library.downloading.has(track.uid)}
						<!-- quick-260919-dlring: same shared ring as the list row below and as every
						     DownloadControl — determinate when downloadProgress has a fraction for this
						     uid, spinning when it does not. The 20px glyph sizes it, so the header's
						     44×44 measured slot is unchanged. -->
						{@const hdFrac = library.downloadProgress[track.uid]}
						<button
							class="hd-btn dl-busy"
							disabled
							aria-busy="true"
							aria-label={hdFrac === undefined
								? t('menu.preparing')
								: `${t('menu.download')} ${Math.round(hdFrac * 100)}%`}
						>
							<DownloadRing value={hdFrac}><Download size={20} /></DownloadRing>
						</button>
					{:else if blobPresent === true}
						<button class="hd-btn" disabled aria-disabled="true" aria-label={t('menu.downloaded')}><Check size={20} /></button>
					{:else}
						<!-- quick-260915-26g: icon-only slot, so the probed detail rides the label/tooltip. -->
						<button class="hd-btn" aria-label={dlLabel} title={dlLabel} onclick={startDownload} use:tapBounce><Download size={20} /></button>
					{/if}
				{/if}
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
			{#if inFlight.has('remix')}<span class="row-spinner motion-always"></span>{:else}<Sparkles size={18} />{/if} {t('menu.remix')}
		</button>
		<!-- Gap 4 (26-10): Play from source — opens a lazily-fed VersionPicker. The variant fetch fires
		     ONLY on THIS tap (openVersions), never on menu open (opt-in; T-26-10-02). Shown for every
		     track (variants discovered on demand; the picker's loading/empty states cover a single-source
		     song). Available for the current track too (switch the playing source). -->
		<button class="mi" onclick={openVersions} use:tapBounce><Layers size={18} /> {t('menu.versions')}</button>
		<!-- quick-260915-w4f: Change cover. The cover chain is first-solid-wins and sometimes wins wrong
		     (wrong album, live-version art, a low-res CN thumbnail); this lets the user override it once,
		     per song, permanently. The candidate fan-out fires on THIS tap only (Q1). `disabled` mirrors
		     the Like row: a uid-less stub has no identity to pin against. -->
		<button class="mi" disabled={!track.uid} onclick={openCoverPicker} use:tapBounce><ImageIcon size={18} /> {t('menu.changeCover')}</button>
		<!-- quick-260919-1we: Fix lyrics. Same story as Change cover one line up, for the lyric chain:
		     it is first-source-wins and sometimes wins wrong (wrong song, wrong language, an
		     instrumental's LRC), and until now the user had no way to correct it. The per-source walk
		     fires on THIS tap only (T-1we-03). `disabled` mirrors the Like / Change-cover rows: a
		     uid-less stub has no identity to pin against (D-1). -->
		<button class="mi" disabled={!track.uid} onclick={openLyricsPicker} use:tapBounce><Mic2 size={18} /> {t('menu.fixLyrics')}</button>
		<!-- quick-260919-1eh: Edit metadata. Shown ONLY for a file the app actually holds bytes for.
		     `blobPresent` is the blob-backed probe, NOT library.isDownloaded — quick-260913-jq4
		     explains why the reference list lies (it is populated BEFORE the fetch, and the web save
		     is an <a download> click that reports success even when the user cancels the dialog), so
		     the list happily says "Downloaded" with nothing stored anywhere.

		     quick-260919-ejm: the `!isDevice` half is GONE. It was the UI mirror of a service refusal
		     that no longer exists — `retagOne` now routes an imported uid to the authorised in-place
		     rewrite (`overwriteDeviceFile`) instead of to `blobStore.put`, so the duplicate-file
		     hazard that justified hiding this row is avoided by routing rather than by hiding.
		     `blobPresent` is true for an imported file because `blobStore.has` reads the user's file
		     in place (34-D-05), which is exactly the right meaning here: there are bytes to edit. -->
		{#if blobPresent}
			<button class="mi" onclick={() => (tagsOpen = true)} use:tapBounce><Tags size={18} /> {t('menu.editTags')}</button>
		{/if}
		<!-- quick-260919-0mw (correction): Repeat, relocated from the NowPlaying transport row.
		     Deliberately OUTSIDE the queue.length > 1 gate that wraps Shuffle: shuffling a
		     one-track queue is a no-op, but repeat-ONE on a one-track queue is the single most
		     obvious reason to reach for repeat at all. Gated on player.current instead — there has
		     to be something playing for a repeat mode to mean anything.
		     PLAY-10 / D-10: repeat is BINARY here (off ↔ one), not the three-state off/one/all
		     cycle it is in most players — player.cycleRepeat() has no 'all' branch. So this row is
		     the same two-state shape as the Shuffle row above it and needs no extra affordance.
		     State legibility, three ways, because the menu CLOSES on tap and a kebab row is read
		     from a cold start every time (unlike the button, which sat in the user's eyeline):
		       1. class:on — the shared active-row highlight. NOTE it had no CSS rule at all until
		          this change (see .mi.on in the style block): the Shuffle row has carried the class
		          since ii6 while rendering identically on and off. Adding the rule there rather
		          than a repeat-only class fixes both rows at once.
		       2. icon swap — Repeat1 (the glyph with the 1) when repeat-one is armed, exactly the
		          swap the transport button did.
		       3. the LABEL swaps to "Repeat one" — the decisive one, and free: both nowplaying.*
		          keys already exist in all 15 dictionaries from the button this replaces, so no new
		          key was minted. Highlight-alone would be ambiguous in a list where several rows
		          can be highlighted at once. -->
		{#if player.current}
			<button class="mi" class:on={player.repeatMode !== 'off'} aria-pressed={player.repeatMode !== 'off'} onclick={cycleRepeatMode} use:tapBounce>
				{#if player.repeatMode === 'one'}<Repeat1 size={18} />{:else}<Repeat size={18} />{/if}
				{player.repeatMode === 'one' ? t('nowplaying.repeatModeOne') : t('nowplaying.repeat')}
			</button>
		{/if}
		{#if player.queue.length > 1}
			<button class="mi" class:on={player.shuffle} onclick={shuffleQueue} use:tapBounce><Shuffle size={18} /> {t('menu.shuffleQueue')}</button>
			<button class="mi" onclick={clearQueue} use:tapBounce><Trash2 size={18} /> {t('menu.clearQueue')}</button>
		{/if}
		<!-- Download: tri-state (D-11/D-12). Already downloaded → Check + greyed disabled ("Downloaded").
		     Otherwise GATED — resolve-then-act at settings.downloadQuality via downloadTrack. The busy
		     state reads BOTH the gated stub-resolve (inFlight) AND the shared per-uid library.downloading
		     set, so the row shows its spinner whether or not this menu stays open (D-12). -->
		<!-- Hidden for device: entries — see the header fork's note. -->
		{#if !isDevice}
		{#if library.downloading.has(track.uid)}
			<!-- quick-260913-omi: real byte progress, not a decorative animation. `downloadProgress`
			     is absent until the first bytes land (and stays absent for a response with no
			     Content-Length), and THAT is the indeterminate state.
			     quick-260919-dlring REVERTED here (and ONLY here): omi's full-width ::after tint is the
			     indicator for this row again. The ring stays in every other download affordance —
			     DownloadControl and this menu's own header button — but inside the menu's LIST content
			     the bar already spans the row and the `.count` already prints the exact figure, so a
			     ring beside them is a third rendering of one number. The glyph is therefore STATIC in
			     both states: no ring, no spinner. It is the same Download glyph the idle row shows, so
			     the icon box never empties and the label never shifts — it just stops being a second
			     busy indicator. The indeterminate state keeps a bar too (a sliding one, below) rather
			     than a spinner, so the bar is the row's ONLY progress channel in both states. -->
			{@const frac = library.downloadProgress[track.uid]}
			<button
				class="mi dl-busy dl-progress"
				class:dl-indeterminate={frac === undefined}
				class:motion-always={frac === undefined}
				style:--dl={frac ?? 0}
				aria-busy="true"
				disabled
				aria-label={frac === undefined
					? t('menu.preparing')
					: `${t('menu.download')} ${Math.round(frac * 100)}%`}
			>
				<Download size={18} />
				{t('menu.download')}
				{#if frac !== undefined}<span class="count">{Math.round(frac * 100)}%</span>{/if}
			</button>
		{:else if blobPresent === true}
			<!-- quick-260919-3j1 (F2): the SAME `.count` slot the Download row's probed `FLAC · 38.2 MB`
			     label and the download percentage already occupy — no new layout rule, no new key
			     (formatDownloadMeta composes source tokens + unit symbols). This is the parity the
			     user asked for: a song that is NOT downloaded says what it would be, a song that IS
			     downloaded says what it is. -->
			<button class="mi" disabled aria-disabled="true">
				<Check size={18} /> {t('menu.downloaded')}
				{#if localMeta}<span class="count">{localMeta}</span>{/if}
			</button>
		{:else}
			<!-- quick-260915-26g: the probed format/size reuses the SAME `.count` slot the download
			     percentage already occupies, so it needs no new layout rule. The skeleton is aria-hidden
			     and the button keeps its `menu.download` name — no new i18n key for either. -->
			<!-- quick-260916-0d9: ONE tap is byte-for-byte the old behaviour; a ~450ms HOLD opens the
			     "Download from…" sheet instead. The trailing native click a hold produces is eaten by
			     longpress's DOCUMENT-capture suppressor (quick-260913-p2k moved it to document
			     precisely so a sheet mounted under the finger is covered), so `onclick={startDownload}`
			     does NOT also fire — verified in longpress.ts, not assumed. The parent sheet's
			     dragClose cannot fire either: it needs rawDy > 8px, the same distance that cancels the
			     longpress timer. The hold hint on title/aria-label makes it discoverable.
			     quick-260919-vrq: the caret is no longer a decorative hint — it is a SIBLING BUTTON
			     that opens the same “Download from…” sheet on a PLAIN TAP. A <button> cannot nest a
			     <button>, so making the caret tappable forces the row to split in two. Its accessible
			     name reuses `menu.downloadFrom` deliberately: that string names exactly the sheet it
			     opens, so the caret needs no new key. Splitting the row does NOT weaken the hold:
			     longpress.ts attaches its one-shot click suppressor on DOCUMENT in the CAPTURE phase,
			     i.e. target-agnostic, so a hold's trailing click is eaten wherever it lands — the main
			     button, the caret, or the sheet that just mounted under the finger (read in
			     longpress.ts `clickCapture`, not assumed). -->
			<div class="mi-split">
				<button class="mi" aria-label={`${dlLabel} · ${t('menu.downloadHoldHint')}`} title={t('menu.downloadHoldHint')} onclick={startDownload} onlongpress={openDownloadPicker} use:longpress use:tapBounce>
					<Download size={18} /> {t('menu.download')}
					{#if dlProbing}<span class="count skel" aria-hidden="true"></span>{:else if dlMeta}<span class="count">{dlMeta}</span>{/if}
				</button>
				<button type="button" class="mi-caret" aria-label={t('menu.downloadFrom')} title={t('menu.downloadFrom')} onclick={openDownloadPicker} use:tapBounce><ChevronDown size={14} /></button>
			</div>
		{/if}
		{/if}
		<!-- quick-260919-30x: Don't import again. The mirror image of the row above — that one is for
		     a file the APP owns, this one is for a file the USER owns, so they sit together.
		     `{#if isDevice}` and ONLY isDevice: for an app-downloaded song `removeDownload` already
		     deletes both copies the app itself created (the app-private file and the public
		     Music/OpenMusic/ entry, 999.1-D-11), so no file survives for a scan to find — an
		     exclusion recorded against it would be dead state forever and the label would be a lie,
		     since no scan ever imports an app download under its own uid.
		     For a device: uid nothing on disk is touched at all — see noImport() above.

		     quick-260919-vrq AMENDS BOTH HALVES OF THAT. (1) "Nothing exposes removal for an app
		     download" is no longer true — the `{:else if}` below IS that removal, behind a confirm
		     sheet. (2) The dead-state argument held only while removal ALWAYS destroyed both copies;
		     it stops holding the moment the user can KEEP the file, because a surviving Music/OpenMusic
		     copy is exactly what a later scan can re-import. (It comes back under a NEW `device:` uid,
		     so a uid-keyed mark is not a guaranteed block either — see confirmRemoveDownload.) The
		     two rows stay mutually exclusive, now by STRUCTURE: if / else-if, never both.

		     quick-260919-vrq (placement): this pair sits directly BELOW the Download row rather
		     than up beside Edit metadata. Remove-download is the inverse of the row above it and
		     the two are mutually exclusive states of one thing, so reading them apart made the
		     menu answer "can I download this?" in two separate places.
		     
		     THE GATE, "is there something to remove": EITHER thing removeDownload clears — an offline
		     copy (`blobPresent === true`, the blob-backed truth of quick-260913-jq4) OR a downloads-list
		     row (`library.isDownloaded`, which can be true with NO blob at all: addDownload runs before
		     the fetch, and the web `<a download>` save reports success on a cancelled dialog).
		     `blobPresent` alone would leave that stale row unremovable from here; `isDownloaded` alone
		     would hide the row for a blob whose list entry was lost. `=== true` and not merely truthy,
		     so the row cannot flash in during the `null` pre-probe tick. `!isDevice` is implied. -->
		{#if isDevice}
			<button class="mi" onclick={noImport} use:tapBounce><EyeOff size={18} /> {t('menu.noImport')}</button>
		{:else if blobPresent === true || library.isDownloaded(track.uid)}
			<button class="mi" onclick={openRemoveDownload} use:tapBounce><Trash2 size={18} /> {t('menu.removeDownload')}</button>
		{/if}
		<!-- quick-260913-je8: the mid-list Like row is RESTORED (D-09 had removed it when Like owned
		     the header accent slot — the header is Download now, so the only Like affordance has to
		     live here). Same like() + `liked` derived as before; .mi.accent carries the liked tint so
		     this needs no new CSS and no new i18n keys. -->
		<!-- like-state-wrong-track-menu: a name-stub (uid:'') has no identity to like yet; the row waits for
		     the host page's resolve to swap in the real Track rather than firing a no-op + wrong toast. -->
		<button class="mi" class:accent={liked} aria-pressed={liked} disabled={!track.uid} onclick={like} use:tapBounce>
			<Heart size={18} fill={liked ? 'currentColor' : 'none'} /> {liked ? t('menu.liked') : t('menu.like')}
		</button>
		<button class="mi" onclick={() => { pickerOpen = true; }} use:tapBounce><ListPlus size={18} /> {t('menu.addToPlaylist')}</button>
		<!-- Opens the GLOBAL SleepTimerSheet (mounted in the app layout) — not a local sub-sheet
		     here, so the timer indicator is reachable from the nowbar + now-playing too (D-08). -->
		<button class="mi" onclick={() => { close(); tick().then(() => (sleepTimer.sheetOpen = true)); }} use:tapBounce><Moon size={18} /> {t('menu.sleepTimer')}</button>
		<button class="mi" onclick={gotoArtist} use:tapBounce><User size={18} /> {t('menu.goToArtist')}</button>
		<!-- quick-260920-kia: Share is UNCONDITIONAL — UI-SPEC Contract 8's `!isDevice` guard on
		     Share (see the header fork's note) is SUPERSEDED. Its rationale ("a share link to a file
		     only on this phone is nonsense, and would emit a URL carrying a local uid") was wrong
		     about the mechanism: songShareUrl() emits a NAME-based /song/{artist}/{title} catalog
		     link, and share.ts uidCarrier() returns null for isDeviceUid() (38-D-08), so an imported
		     local track shares a valid catalog link and no device: uid ever reaches the URL. Sharing
		     an imported song therefore means what sharing any other song means: "here is this song".
		     NO runtime guard is added in doShare() — the device skip already lives at the one place
		     every caller routes through (share.ts), pinned by share.test.ts "a `device:` uid carries
		     NOTHING". Do not reintroduce a device guard here. -->
		<button class="mi" onclick={doShare} use:tapBounce><Share2 size={18} /> {t('menu.share')}</button>
		<!-- Detail: GATED — resolves details to populate the detail sheet's audioUrl/quality rows. -->
		<button class="mi" aria-busy={inFlight.has('detail')} aria-label={inFlight.has('detail') ? t('menu.preparing') : undefined} onclick={() => gated('detail', doDetail)} use:tapBounce>
			{#if inFlight.has('detail')}<span class="row-spinner motion-always"></span>{:else}<Info size={18} />{/if} {t('menu.detail')}
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

<!-- quick-260919-vrq: the Remove-download CONFIRM. Mounted OUTSIDE the {#if open && track} block for
     the same reason as the playlist picker above — it has to survive the parent menu closing. The
     boolean is a SettingToggle because that is the app's only boolean-control idiom (a real
     <button role="switch" aria-checked>, so the state is exposed to assistive tech) and no
     `type="checkbox"` exists anywhere in src. Cancel, the scrim, a drag-down and the Back gesture all
     converge on `rmOpen = false` through the overlay's close handler: NOTHING is removed on any
     dismiss route, only the explicit Remove button acts. -->
{#if rmOpen && track}
	<button class="scrim" aria-label={t('menu.close')} onclick={() => (rmOpen = false)}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (rmOpen = false) }} use:focusTrap>
		<div class="menu-head">{t('menu.removeDownload')}</div>
		<p class="hint">{t('menu.removeDownloadBody')}</p>
		<SettingToggle label={t('menu.removeDownloadDeleteFile')} checked={rmDeleteFile} onchange={() => (rmDeleteFile = !rmDeleteFile)} />
		<div class="actions">
			<button class="mi" onclick={() => (rmOpen = false)} use:tapBounce>{t('tags.cancel')}</button>
			<button class="mi danger" onclick={confirmRemoveDownload} use:tapBounce><Trash2 size={18} /> {t('menu.removeDownloadAction')}</button>
		</div>
	</div>
{/if}

{#if detailTrack}
	<button class="scrim" aria-label={t('menu.close')} onclick={() => (detailTrack = null)}></button>
	<div class="modal" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (detailTrack = null) }} use:focusTrap>
		<div class="menu-head row"><span>{t('menu.trackDetail')}</span><button class="x" aria-label={t('menu.close')} onclick={() => (detailTrack = null)} use:tapBounce><X size={18} /></button></div>
		<dl class="detail">
			<dt>{t('menu.detailTitle')}</dt><dd>{names.dnTitle(detailTrack.title, detailTrack.artist)}</dd>
			<dt>{t('menu.detailArtist')}</dt><dd>{names.dnArtist(detailTrack.artist)}</dd>
			<dt>{t('menu.detailAlbum')}</dt><dd>{detailTrack.album ? names.dnTitle(detailTrack.album) : '—'}</dd>
			<dt>{t('menu.detailQuality')}</dt><dd>{detailTrack.qualityLabel || detailTrack.quality || t('menu.detailUnknown')}</dd>
			<!-- quick-260919-3j1 (F2): the file this app actually holds — container + real size, read
			     from the local bytes. ASYMMETRY WORTH RECORDING: this lane also works for an imported
			     `device:` song, which the Downloaded row above does NOT render for (it sits inside
			     `{#if !isDevice}`). Left as-is rather than restructuring the device branch — for an
			     imported file the Detail sheet is the right home for its numbers anyway. -->
			<dt>{t('menu.detailFile')}</dt><dd>{localMeta ?? t('menu.detailUnknown')}</dd>
			<dt>{t('menu.detailSource')}</dt><dd>{detailTrack.source}</dd>
			<dt>{t('menu.detailUid')}</dt><dd class="mono">{detailTrack.uid}</dd>
			<dt>{t('menu.detailAudioUrl')}</dt><dd class="mono break">{detailTrack.audioUrl || t('menu.detailNotResolved')}</dd>
		</dl>
	</div>
{/if}

<!-- quick-260915-w4f: the cover picker. Mounted OUTSIDE the {#if open && track} block (like the
     playlist-picker / detail sub-sheets) so it survives the menu closing on a pick. Thumbnails are
     `<img src>` ATTRIBUTES, never CSS url() (T-rvy-01); every candidate already passed the https
     gate in collectCoverCandidates (T-w4f-01). -->
{#if coverOpen && track}
	<button class="scrim" aria-label={t('menu.close')} onclick={closeCoverPicker}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: closeCoverPicker }} use:focusTrap>
		<div class="menu-head row"><span>{t('menu.changeCover')}</span><button class="x" aria-label={t('menu.close')} onclick={closeCoverPicker} use:tapBounce><X size={18} /></button></div>
		{#if coverLoading && !coverCandidates.length}
			<div class="cover-wait"><span class="row-spinner motion-always"></span></div>
		{:else if !coverCandidates.length}
			<p class="cover-none">{t('menu.coverPickerNone')}</p>
		{:else}
			<div class="cover-grid">
				{#each coverCandidates as c (c.url)}
					<button class="cand" class:on={c.url === activeCover} aria-pressed={c.url === activeCover} onclick={() => pickCover(c.url)} use:tapBounce>
						<img src={c.url} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
						<span class="src">{c.source === 'deezer' ? 'Deezer' : c.source === 'itunes' ? 'iTunes' : c.source}</span>
						{#if c.url === activeCover}<span class="tick"><Check size={14} /></span>{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<!-- quick-260919-1we: the lyrics picker. Mounted OUTSIDE the {#if open && track} block (like the cover
     picker above) so it survives the menu closing on a pick. One row per SOURCE that actually returned
     an LRC (D-5), labelled from the registry exactly like the Download-from rows, with the first
     timestamped line as a preview so the user can tell two candidates apart without playing them.
     The LRC text is rendered as Svelte text interpolation, which escapes — no {@html} anywhere in this
     feature (T-1we-02). -->
{#if lyricsOpen && track}
	{@const pinnedNow = readLyrics(track)}
	<button class="scrim" aria-label={t('menu.close')} onclick={closeLyricsPicker}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: closeLyricsPicker }} use:focusTrap>
		<div class="menu-head row"><span>{t('menu.fixLyrics')}</span><button class="x" aria-label={t('menu.close')} onclick={closeLyricsPicker} use:tapBounce><X size={18} /></button></div>
		{#if lyricsLoading && !lyricCandidates.length}
			<div class="cover-wait"><span class="row-spinner motion-always"></span></div>
		{:else if !lyricCandidates.length}
			<p class="cover-none">{t('menu.lyricsPickerNone')}</p>
			<!-- D-6: Retry is shown ONLY on a dry walk — the one affordance that is not redundant with
			     re-opening the sheet, because the sheet is already open. -->
			<button class="mi" onclick={openLyricsPicker} use:tapBounce><Mic2 size={18} /> {t('menu.lyricsRetry')}</button>
		{:else}
			{#each lyricCandidates as c (c.source)}
				<!-- quick-260919-2jo: the preview is script-locked, the CANDIDATE is not. `pickLyrics(c.lrc)`
				     still pins the RAW upstream text, so the pin stays source data and re-renders through
				     the lock like anything else. Locking the preview is what makes it honest: with the lock
				     on, two candidates that differ only in script WILL render identically once picked. -->
				{@const preview = parseLyrics(c.lrc).find((l) => l.text.trim())?.text ?? ''}
				<button class="mi" onclick={() => pickLyrics(c.lrc)} use:tapBounce>
					{#if c.lrc === pinnedNow}<Check size={18} />{:else}<Mic2 size={18} />{/if}
					<span class="dl-src">{SOURCES[c.source]?.label ?? c.source}</span>
					{#if preview}<span class="count lyr-prev">{preview}</span>{/if}
				</button>
			{/each}
		{/if}
		<!-- D-6: Use-automatic is shown ONLY when a pin exists. `readLyrics` leads with the pin and falls
		     back to track.lrc, so "the read differs from the track's own lrc" IS "a pin exists". -->
		{#if pinnedNow !== (track.lrc ?? null)}
			<button class="mi" onclick={resetLyrics} use:tapBounce><Sparkles size={18} /> {t('menu.lyricsAuto')}</button>
		{/if}
	</div>
{/if}

<!-- quick-260916-0d9 — the "Download from…" sheet. Mounted OUTSIDE the {#if open && track} block (like
     the other sub-sheets) so it survives the menu closing on a pick. One row per SOURCE: the own
     source first (already labelled from the main row's probe), then whatever the single fan-out
     found, each filling in as its own capped probe lands. A source whose probe came back empty is a
     DISABLED "Unavailable" row — a blocked upstream degrades one row, never the sheet. -->
{#if dlPickOpen && track}
	<button class="scrim" aria-label={t('menu.close')} onclick={closeDownloadPicker}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: closeDownloadPicker }} use:focusTrap>
		<div class="menu-head row"><span>{t('menu.downloadFrom')}</span><button class="x" aria-label={t('menu.close')} onclick={closeDownloadPicker} use:tapBounce><X size={18} /></button></div>
		{#each dlPickList as v (v.uid)}
			{@const p = dlPickProbes[v.uid]}
			{@const meta = p ? formatDownloadMeta(p) : null}
			{@const unavailable = p !== undefined && !p.track?.audioUrl}
			<button class="mi" disabled={unavailable} aria-disabled={unavailable} onclick={() => pickDownload(v)} use:tapBounce>
				<Download size={18} />
				<span class="dl-src">{SOURCES[v.source]?.label ?? v.source}</span>
				{#if p === undefined}<span class="count skel" aria-hidden="true"></span>
				{:else if unavailable}<span class="count">{t('menu.downloadUnavailable')}</span>
				{:else if meta}<span class="count">{meta}</span>{/if}
			</button>
		{/each}
		{#if dlPickLoading}
			<p class="dl-wait" aria-busy="true"><span class="row-spinner motion-always"></span>{t('versions.loading')}</p>
		{/if}
	</div>
{/if}

<!-- Gap 4 (26-10): the Play-from-source VersionPicker. Mounted OUTSIDE the {#if open && track} menu
     block (like the playlist-picker/detail sub-sheets) so it survives the menu closing on a pick.
     WR-02: this TrackMenu-hosted picker uses the DISTINCT overlay id 'versionpicker-menu' so it never
     collides with the host page's own VersionPicker (which is co-mounted on the same route); each
     pushes/pops its own balanced history entry via the single dismiss path (Back gesture stays sane).
     loading is bound to the in-flight fetchVariants state; onpick plays the chosen source's EXACT
     variant fresh, then closes the menu. -->
<VersionPicker
	versions={versionsList}
	open={versionsOpen}
	loading={versionsLoading}
	overlayId="versionpicker-menu"
	onclose={closeVersions}
	onpick={(v) => { player.play(v, { fresh: true }); close(); }}
/>

<!-- quick-260919-1eh: the metadata editor. Mounted OUTSIDE the {#if open && track} menu block, like
     the VersionPicker above, so it survives the menu closing on save. `cover` is the SAME activeCover
     ladder the share card and the cover picker already read — one precedence chain, now three
     consumers. `lyrics` is what the app HAS: the playing song's resolved lrc, else the row's own
     (the editor never fires a network resolve to go hunting — it must work offline).

     quick-260919-1we (D-4): that read now goes through `readLyrics`, so a retag writes the lyrics the
     user CHOSE in the Fix-lyrics picker into the file, not the superseded ones the chain happened to
     pick first. The current-track preference is kept — player.current carries the resolved lrc a list
     row may still be a stub for.

     onsaved fires BOTH repaint seams, always: applyMetadata repaints the library list rows (in-place
     proxy mutation, so already-rendered home shelves update too), adoptMetadata repaints the
     NowPlaying hero, the Nowbar and the OS media card — those read player.current directly, so the
     library write alone would leave them showing the old title until the next track change. -->
<MetadataEditor
	{track}
	open={tagsOpen}
	cover={activeCover}
	lyrics={readLyrics(track && player.current?.uid === track.uid ? player.current : track)}
	onclose={() => (tagsOpen = false)}
	onsaved={(patch) => {
		if (!track) return;
		library.applyMetadata(track.uid, patch);
		player.adoptMetadata(track.uid, patch);
		close();
	}}
/>

<style>
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.45); border: none; }
	.menu, .modal { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto; }
	/* Legacy single-line head — STILL used by the playlist-picker + detail sub-sheets. */
	.menu-head { font-size: calc(0.8125rem * var(--fs-title, 1)); color: var(--color-text-muted); padding: 8px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.menu-head.row { display: flex; align-items: center; justify-content: space-between; }
	.x { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; }
	/* D-08/D-09/D-10: two-row marquee header + top-right action/Close cluster (quick-260913-je8:
	   the action slot is Download, was Like). Left text column flexes (min-width:0 so the clips can
	   shrink-and-ellipsis); right cluster is fixed-width. */
	.sheet-head { display: flex; align-items: center; gap: 12px; padding: 8px 10px; }
	/* quick-260919-dlring: `.head-text` is a <button> now (Go to artist). Every declaration past the
	   original `flex`/`min-width` pair is a UA reset — the box must stay pixel-identical to the div it
	   replaced, so no padding, no border, no UA font, and text-align: left instead of the button
	   default centre. `display: block` keeps the two rows stacked (a button is inline-block and
	   would shrink-wrap). Deliberately NO `:disabled` opacity: with no artist to visit this button is
	   inert, and inert must look like the plain text block it used to be, not like a greyed control. */
	.head-text {
		flex: 1;
		min-width: 0;
		display: block;
		appearance: none;
		background: none;
		border: 0;
		padding: 0;
		margin: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		-webkit-tap-highlight-color: transparent;
	}
	.head-text:not(:disabled) { cursor: pointer; }
	/* `display: block` because these are <span>s now (phrasing content, so they are legal inside the
	   button above) — everything else is unchanged from when they were <div>s. */
	.hd-title { display: block; font-size: calc(0.9375rem * var(--fs-title, 1)); font-weight: 600; color: var(--color-text); line-height: 1.25; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; max-width: 100%; }
	.hd-artist { display: block; font-size: calc(0.8125rem * var(--fs-artist, 1)); font-weight: 400; color: var(--color-text-muted); line-height: 1.25; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; max-width: 100%; }
	.head-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 18px; }
	.hd-btn { min-width: 44px; min-height: 44px; display: grid; place-items: center; background: none; border: none; border-radius: 10px; color: var(--color-text); cursor: pointer; }
	.hd-btn:hover { background: var(--color-surface); }
	.hd-btn:disabled { opacity: 0.4; cursor: default; }
	/* quick-260919-et3: the header Heart is back (before Download), so the liked tint needs a rule
	   here again. je8 had removed `.hd-btn.liked` when the header slot became Download. Named
	   `.accent` to match `.mi.accent` on the list row rather than reviving a second name for the
	   same idea — and declared, not merely applied: `class:accent` with no matching rule is the
	   exact defect quick-260919-0mw found on the Shuffle row, where an active state had rendered
	   pixel-identical to inactive since ii6. */
	.hd-btn.accent { color: var(--color-primary); }
	.mi { width: 100%; display: flex; align-items: center; gap: 12px; background: none; border: none; color: var(--color-text); font-size: 0.9375rem; padding: 12px; border-radius: 10px; cursor: pointer; text-align: left; }
	.mi:hover { background: var(--color-surface); }
	.mi:disabled { opacity: 0.4; cursor: default; }
	.mi.accent { color: var(--color-primary); }
	/* quick-260919-0mw (correction): the ACTIVE-state rule for a toggle row. `class:on` was already
	   in the markup on the Shuffle row (ii6) but NO rule ever matched it, so shuffle-on and
	   shuffle-off rendered pixel-identical. Relocating Repeat here needed a real active state, and
	   the fix belongs on the shared `.on`, not on a repeat-only class - one rule, and the Shuffle
	   row above it starts showing the state it has been claiming to show all along. Same declaration
	   as `.accent` because it is the same idea: this row is not neutral right now. */
	.mi.on { color: var(--color-primary); }
	/* quick-260919-vrq — the remove-download confirm's body copy + button pair. `.hint` and `.actions`
	   are taken VERBATIM from MetadataEditor.svelte (its footer is the same shape: a paragraph of
	   explanation over a Cancel/commit pair), so the two sheets read identically; noted here because
	   that makes two files carrying the declaration. The danger tint is #ff7a90, the literal already
	   in system use by SettingRow's `.danger` and RowBadges' `.unavailable` — app.css defines no
	   --color-danger token and this task does not invent one. */
	.hint { color: var(--color-text-muted); font-size: 0.75rem; line-height: 1.4; padding: 10px 12px 4px; margin: 0; }
	.actions { display: flex; gap: 8px; padding: 4px; }
	.mi.danger { color: #ff7a90; }
	/* tabular-nums: the download percentage climbs digit by digit and would otherwise jitter the
	   row's right edge on every repaint (quick-260913-omi). Harmless for the playlist counts. */
	.mi .count { margin-left: auto; font-size: 0.75rem; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
	/* quick-260915-26g: placeholder for the in-flight download probe. Static, not animated — the row
	   spinner two states over already owns the "working" signal and two of them would compete. */
	.mi .count.skel { display: inline-block; width: 64px; height: 11px; border-radius: var(--radius-full); background: var(--color-surface); }
	/* quick-260916-0d9 — download picker. The source label takes the row's free space and ellipsises
	   (CJK source labels plus a `FLAC · 38.2 MB` count still fit one line at 375px; a long count
	   ellipsises the label, which is the right thing to lose). */
	.dl-src { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	/* quick-260919-1we: the candidate's first sung line, so two sources are distinguishable without
	   playing either. Capped so a long line never pushes the source label out of the row. */
	.lyr-prev { max-width: 55%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.dl-wait { display: flex; align-items: center; gap: 10px; color: var(--color-text-muted); font-size: 0.8125rem; padding: 10px 12px; margin: 0; }
	/* quick-260919-vrq: the Download row is now TWO sibling buttons in a flex wrapper (a tappable
	   caret cannot live inside a <button>). The caret's two old decoration-only rules went with it —
	   the glyph is a real control now, so it no longer needs a rule to fake a right-edge position.
	   `.mi` declares `width: 100%`, which as a flex item would size it off the wrapper rather than
	   the free space, so `flex: 1` + `min-width: 0` is what actually lets it take the row and lets
	   its label ellipsise. `.count`'s own `margin-left: auto` still pushes the meta to the main
	   button's right edge, so the icon/label/meta rhythm is unchanged. The caret repeats `.mi`'s
	   12px vertical padding so the row height is identical, with 14px horizontal for a ~42px target. */
	.mi-split { display: flex; align-items: center; }
	.mi-split .mi { flex: 1; min-width: 0; }
	.mi-caret { flex: none; display: flex; align-items: center; background: none; border: none; color: var(--color-text-muted); padding: 12px 14px; border-radius: 10px; cursor: pointer; }
	.mi-caret:hover { background: var(--color-surface); }
	/* quick-260913-omi: download progress fill, RESTORED by quick-260919-dlring's row revert. `--dl`
	   is the 0..1 fraction, set inline per render. An ::after at 18% opacity sits UNDER the label
	   without needing a stacking context — the tint is light enough that the text and icon stay fully
	   legible through it. The width transition is deliberately un-tagged (no .motion-always) so
	   app.css's reduce-motion rule kills it. */
	.mi.dl-progress { position: relative; overflow: hidden; }
	.mi.dl-progress::after {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: calc(var(--dl, 0) * 100%);
		background: var(--color-primary);
		opacity: 0.18;
		transition: width 120ms linear;
		pointer-events: none;
	}
	/* Indeterminate (no Content-Length, or no bytes yet): omi parked a SPINNER here, but the row's
	   glyph is no longer allowed to indicate anything, so the bar covers this state instead — a
	   fixed-width tint sliding across the row, the standard indeterminate idiom. `transform` is used
	   (not `left`) so it never triggers layout, and `--dl` is ignored while this class is on.
	   The markup pairs this class with `.motion-always`, app.css's escape hatch, for the same reason
	   the spinner carried it: a frozen indeterminate bar reads as 32% progress, i.e. a lie. The
	   DETERMINATE row stays un-tagged, so its width transition is still killed by reduce-motion. */
	.mi.dl-indeterminate::after {
		width: 32%;
		transition: none;
		animation: dl-slide 1.4s ease-in-out infinite;
	}
	@keyframes dl-slide {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(313%); }
	}
	/* omi's other call, kept by quick-260919-dlring: a disabled row is dimmed to 0.4, but this one is
	   disabled only because it is BUSY, and at 0.4 the bar and the percentage are hard to read.
	   `.dl-busy` covers the indeterminate case too — an undimmed bar is the point of the state.
	   The header button joins the same rule: it is the SAME state, and at 0.4 its ring read as an
	   already-greyed Downloaded tick. Its OTHER disabled states (the Check) stay dimmed — the class
	   is on the busy fork only. */
	.mi.dl-busy:disabled,
	.hd-btn.dl-busy:disabled { opacity: 1; }
	/* MENU-01 inline resolve spinner — neutral (NOT accent), sits in the leading 18px icon box so
	   the row width does not shift. quick-260809-mvz: keeps rotating under BOTH reduce-motion gates
	   (markup carries `.motion-always`, app.css's escape hatch) — a frozen spinner reads as a hung
	   app. aria-busy + the menu.preparing label still carry the state for non-visual users. */
	.row-spinner { width: 16px; height: 16px; flex: none; border: 2px solid var(--color-text-muted); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	/* quick-260915-w4f — cover picker grid. 3 columns fits a 375px viewport with the sheet's insets
	   (~105px tiles), four rows deep for the 12-candidate cap. */
	.cover-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 4px 8px 12px; }
	.cand { position: relative; padding: 0; border: 2px solid transparent; border-radius: 10px; overflow: hidden; background: var(--color-surface); cursor: pointer; aspect-ratio: 1; }
	.cand img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.cand.on { border-color: var(--color-primary); }
	.cand .src { position: absolute; left: 0; right: 0; bottom: 0; font-size: 0.6875rem; padding: 2px 4px; background: rgba(0, 0, 0, 0.55); color: #fff; text-transform: capitalize; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.cand .tick { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; color: #fff; filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.8)); }
	.cover-wait { display: grid; place-items: center; padding: 28px 12px; }
	.cover-none { text-align: center; color: var(--color-text-muted); font-size: 0.8125rem; padding: 20px 12px; }
	.detail { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; padding: 6px 12px 14px; margin: 0; }
	.detail dt { color: var(--color-text-muted); font-size: 0.75rem; }
	.detail dd { margin: 0; font-size: 0.8125rem; }
	.mono { font-family: ui-monospace, monospace; font-size: 0.6875rem; }
	.break { word-break: break-all; }
</style>
