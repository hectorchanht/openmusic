<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { ListStart, ListEnd, Download, Check, Heart, ListPlus, User, Share2, Info, X, Plus, Shuffle, Trash2, Moon, Sparkles, Layers, Image as ImageIcon } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { sleepTimer } from '$lib/stores/sleepTimer.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { marquee } from '$lib/actions/marquee';
	import { toast } from '$lib/stores/toast.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import { isGatedReady, shouldStartResolve } from './track-menu-gate';
	import { t } from '$lib/i18n';
	import { ensureTrackDetails } from '$lib/services/catalog';
	import { prewarmTrack } from '$lib/services/prewarm';
	// Gap 4 (26-10): the LAZY on-demand cross-source variant fetch (26-08) fed to the Play-from-source
	// picker — fired ONLY on the row tap, never on menu open (T-26-10-02).
	import { fetchVariants } from '$lib/services/variants';
	import VersionPicker from '$lib/components/VersionPicker.svelte';
	import { downloadTrack } from '$lib/services/download-track';
	// quick-260915-26g: the shared probe + the shared label formatter. TrackMenu cannot mount
	// DownloadControl (its Check state is blob-backed and its rows are full-width text buttons, not
	// 40x40 icons), so it consumes the same SERVICE instead — one implementation, two surfaces.
	import { probeDownload, formatDownloadMeta, type DownloadProbe } from '$lib/services/download-probe';
	// quick-260913-jq4: the Check state is backed by the offline copy, not the downloads list.
	import { blobStore } from '$lib/services/blob-store';
	import { browser } from '$app/environment';
	import { songShareUrl } from '$lib/services/share';
	// quick-260809-3uo: the share card now carries the cover the user is looking at — read from the
	// SAME shared reactive cache every other surface reads, plus the retained iTunes id.
	import { readCoverByUidOrName, readPinnedCover, pinCover } from '$lib/stores/cover-version.svelte';
	// quick-260915-w4f: the ENUMERATE-ALL cover collector. Imported for the picker only — it runs
	// alongside resolveTrackChain, never inside it, and fires ONLY on the Change-cover tap (Q1).
	import { collectCoverCandidates, type CoverCandidate } from '$lib/services/cover-backfill';
	import { recallItunesId } from '$lib/services/itunes-cover';
	import { isDeviceUid } from '$lib/services/device-track';
	import type { Track } from '$lib/sources/types';

	// `loading` = the menu opened on a discovery STUB and is still resolving the real Track
	// (home long-press). It pops INSTANTLY with a skeleton; the action buttons render once the
	// track resolves — so the menu never waits on the network before appearing.
	let { track, open, loading = false, onclose }: { track: Track | null; open: boolean; loading?: boolean; onclose: () => void } = $props();

	let pickerOpen = $state(false);
	let detailTrack = $state<Track | null>(null);
	const liked = $derived(track ? library.isLiked(track.uid) : false);
	const isDevice = $derived(!!track && isDeviceUid(track.uid));

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
					(player.current?.uid === track.uid ? player.resolvedCover : null) ??
					readCoverByUidOrName(track.uid, track.artist, track.title) ??
					track.cover ??
					null)
			: null
	);

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
		coverAc?.abort(); // quick-260915-w4f: never leave a candidate fan-out running behind a closed menu
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
		closeCoverPicker();
		close();
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
	const dlLabel = $derived(dlMeta ? `${t('menu.download')} \u00b7 ${dlMeta}` : t('menu.download'));

	async function doShare() {
		if (!track) return;
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
		const dTitle = names.dnTitle(track.title);
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
		const shareCover = activeCover;
		// An uncovered-tier cover (netease / qq / joox) simply yields no token and no regression — the
		// carrier is advisory, and the card falls back to the server tier chain exactly as today. The
		// iTunes id is recalled HERE because coverToken is pure: a store/storage never flows into a
		// pure service (CLAUDE.md), so the component does the lookup and passes the value in.
		const url = songShareUrl({ title: dTitle, artist: dArtist }, shareCover, recallItunesId(shareCover));
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
				<!-- D-09 AMENDED by quick-260913-je8: the header accent slot is DOWNLOAD now, not Like.
				     D-09's "Like is the sole header accent AND the mid-list Like row is removed" no
				     longer holds — Like is back as a text row below; the rest of D-09 (two-row marquee
				     header, explicit Close affordance) stands unchanged.
				     Download is DELIBERATELY duplicated (header icon + list row): both call the SAME
				     gated('download', doDownload) and read the SAME tri-state sources (inFlight +
				     library.downloading / isDownloaded), so the two can never disagree (D-11/D-12). -->
				<!-- 34 (RESEARCH bites #10/#11, UI-SPEC Contract 8): Download and Share are HIDDEN for
				     device: entries — downloading a file already on this phone and sharing a link to a
				     file only on this phone are both nonsense. This is a NEW visibility condition;
				     track-menu-gate.ts (isGatedReady/shouldStartResolve) is resolve TIMING and is
				     deliberately not extended. -->
				{#if !isDevice}
					{#if library.downloading.has(track.uid)}
						<button class="hd-btn" disabled aria-busy="true" aria-label={t('menu.preparing')}><span class="row-spinner motion-always"></span></button>
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
			     Content-Length), and THAT is the indeterminate state — it keeps the spinner. Once a
			     fraction exists the spinner's job is done: the bar says "moving" more precisely than
			     it could, so the icon goes static and the percentage carries the detail. The fill is
			     an 18%-opacity ::after, low enough that the label stays legible over it without any
			     stacking-context work. -->
			{@const frac = library.downloadProgress[track.uid]}
			<button
				class="mi"
				class:dl-progress={frac !== undefined}
				style:--dl={frac ?? 0}
				aria-busy="true"
				disabled
				aria-label={frac === undefined
					? t('menu.preparing')
					: `${t('menu.download')} ${Math.round(frac * 100)}%`}
			>
				{#if frac === undefined}<span class="row-spinner motion-always"></span>{:else}<Download size={18} />{/if}
				{t('menu.download')}
				{#if frac !== undefined}<span class="count">{Math.round(frac * 100)}%</span>{/if}
			</button>
		{:else if blobPresent === true}
			<button class="mi" disabled aria-disabled="true"><Check size={18} /> {t('menu.downloaded')}</button>
		{:else}
			<!-- quick-260915-26g: the probed format/size reuses the SAME `.count` slot the download
			     percentage already occupies, so it needs no new layout rule. The skeleton is aria-hidden
			     and the button keeps its `menu.download` name — no new i18n key for either. -->
			<button class="mi" aria-label={dlLabel} onclick={startDownload} use:tapBounce>
				<Download size={18} /> {t('menu.download')}
				{#if dlProbing}<span class="count skel" aria-hidden="true"></span>{:else if dlMeta}<span class="count">{dlMeta}</span>{/if}
			</button>
		{/if}
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
		<!-- Hidden for device: entries — a share link to a file only on this phone is nonsense
		     (and would emit a URL carrying a local uid). See the header fork's note. -->
		{#if !isDevice}
			<button class="mi" onclick={doShare} use:tapBounce><Share2 size={18} /> {t('menu.share')}</button>
		{/if}
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

<style>
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.45); border: none; }
	.menu, .modal { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto; }
	/* Legacy single-line head — STILL used by the playlist-picker + detail sub-sheets. */
	.menu-head { font-size: calc(13px * var(--fs-title, 1)); color: var(--color-text-muted); padding: 8px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.menu-head.row { display: flex; align-items: center; justify-content: space-between; }
	.x { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; }
	/* D-08/D-09/D-10: two-row marquee header + top-right action/Close cluster (quick-260913-je8:
	   the action slot is Download, was Like). Left text column flexes (min-width:0 so the clips can
	   shrink-and-ellipsis); right cluster is fixed-width. */
	.sheet-head { display: flex; align-items: center; gap: 12px; padding: 8px 10px; }
	.head-text { flex: 1; min-width: 0; }
	.hd-title { font-size: calc(15px * var(--fs-title, 1)); font-weight: 600; color: var(--color-text); line-height: 1.25; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; max-width: 100%; }
	.hd-artist { font-size: calc(13px * var(--fs-artist, 1)); font-weight: 400; color: var(--color-text-muted); line-height: 1.25; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; max-width: 100%; }
	.head-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 18px; }
	.hd-btn { min-width: 44px; min-height: 44px; display: grid; place-items: center; background: none; border: none; border-radius: 10px; color: var(--color-text); cursor: pointer; }
	.hd-btn:hover { background: var(--color-surface); }
	.hd-btn:disabled { opacity: 0.4; cursor: default; }
	/* quick-260913-je8: `.hd-btn.liked` is gone with the header Heart — the liked tint now rides
	   the shared `.mi.accent` on the list row. (Left in place it is an unused-CSS check failure.) */
	.mi { width: 100%; display: flex; align-items: center; gap: 12px; background: none; border: none; color: var(--color-text); font-size: 15px; padding: 12px; border-radius: 10px; cursor: pointer; text-align: left; }
	.mi:hover { background: var(--color-surface); }
	.mi:disabled { opacity: 0.4; cursor: default; }
	.mi.accent { color: var(--color-primary); }
	/* tabular-nums: the download percentage climbs digit by digit and would otherwise jitter the
	   row's right edge on every repaint (quick-260913-omi). Harmless for the playlist counts. */
	.mi .count { margin-left: auto; font-size: 12px; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
	/* quick-260915-26g: placeholder for the in-flight download probe. Static, not animated — the row
	   spinner two states over already owns the "working" signal and two of them would compete. */
	.mi .count.skel { display: inline-block; width: 64px; height: 11px; border-radius: var(--radius-full); background: var(--color-surface); }
	/* quick-260913-omi: download progress fill. `--dl` is the 0..1 fraction, set inline per render.
	   An ::after at 18% opacity sits UNDER the label without needing a stacking context — the tint
	   is light enough that the text and icon stay fully legible through it. The width transition is
	   deliberately un-tagged (no .motion-always) so app.css's reduce-motion rule kills it. */
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
	/* A disabled row is dimmed to 0.4; the progress row is disabled only because it is busy, and at
	   0.4 the bar and the percentage are hard to read. Keep it legible. */
	.mi.dl-progress:disabled { opacity: 1; }
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
	.cand .src { position: absolute; left: 0; right: 0; bottom: 0; font-size: 11px; padding: 2px 4px; background: rgba(0, 0, 0, 0.55); color: #fff; text-transform: capitalize; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.cand .tick { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; color: #fff; filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.8)); }
	.cover-wait { display: grid; place-items: center; padding: 28px 12px; }
	.cover-none { text-align: center; color: var(--color-text-muted); font-size: 13px; padding: 20px 12px; }
	.detail { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; padding: 6px 12px 14px; margin: 0; }
	.detail dt { color: var(--color-text-muted); font-size: 12px; }
	.detail dd { margin: 0; font-size: 13px; }
	.mono { font-family: ui-monospace, monospace; font-size: 11px; }
	.break { word-break: break-all; }
</style>
