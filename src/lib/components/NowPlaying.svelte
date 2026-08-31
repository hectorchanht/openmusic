<script module lang="ts">
	// quick-260625-pzs-03: module-scoped (NOT per-instance) cache of COMPLETE lyric translations,
	// keyed by the SAME `key` string the translate $effect computes (`${uid}:${lang}:${n}:${skip}`).
	// Living at module scope means it survives a component remount / re-subscribe, so blurring and
	// refocusing the tab (which resets the per-instance plain `trKey = ''`) re-hydrates the cached
	// translation synchronously instead of re-issuing /api/translate. Only COMPLETE renders are
	// stored (T-pzs-01) — a soft-fail echo (translateLinesEx complete:false) is never frozen.
	const trCache = new Map<string, string[]>();
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { Spring } from 'svelte/motion';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
	import { ChevronDown, MoreVertical, Heart, SkipBack, SkipForward, Play, Pause, Repeat, Repeat1, GripVertical, Moon, ListEnd, ListStart, Layers } from '@lucide/svelte';
	import { player, fmtTime } from '$lib/stores/player.svelte';
	import { sleepTimer } from '$lib/stores/sleepTimer.svelte';
	import { settings, effectiveTarget } from '$lib/stores/settings.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { t, tMaybeKey } from '$lib/i18n';
	import { searchAll } from '$lib/services/catalog';
	import { dedupeBest } from '$lib/services/dedupe';
	// Gap 4 (26-10): the LAZY on-demand cross-source variant fetch (26-08) fed to the per-row
	// version picker — fired ONLY on a trigger tap, never on list render (T-26-10-02).
	import { fetchVariants } from '$lib/services/variants';
	import { translateLinesEx } from '$lib/services/translate';
	import { shouldTranslate } from '$lib/i18n/detect';
	import { enrichTrack } from '$lib/services/lastfm';
	import { longpress } from '$lib/actions/longpress';
	import { lazyCover } from '$lib/actions/lazyCover';
	// cover-hero-mediacard-missing (Issue 1): the reactive cover-cache read helper the up-next rows /
	// home tiles use — the hero current cell now falls back to it so a cover that lands anywhere for
	// the current song repaints the hero live (one resolved cover reused EVERYWHERE, cached).
	import { readCoverByUidOrName } from '$lib/stores/cover-version.svelte';
	import { marquee } from '$lib/actions/marquee';
	import { swipeRemove } from '$lib/actions/swipeRemove';
	import { swipeAction } from '$lib/actions/swipeAction';
	import { coverSwipe } from '$lib/actions/coverSwipe';
	import { scrub } from '$lib/actions/scrub';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { toast } from '$lib/stores/toast.svelte';
	import { tick as hapticTick } from '$lib/util/haptics';
	import { splitArtists } from '$lib/util/artist-split';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import VersionPicker from '$lib/components/VersionPicker.svelte';
	import RowBadges from '$lib/components/RowBadges.svelte';
	import Nowbar from '$lib/components/Nowbar.svelte';
	import { parseLRC, reorderPairs, splitParenLines, lineSeekFraction, type LyricLine } from '$lib/services/lrc';
	import { createVelocityTracker } from '$lib/gestures/velocity';
	import type { Track } from '$lib/sources/types';

	type Tab = 'queue' | 'lyrics' | 'related';
	let tab = $state<Tab>('lyrics');
	// shuffle/repeat moved to the store (gte) so the audio `ended` handler + next() can read
	// them. The transport buttons below bind to player.shuffle / player.repeatMode directly.

	// ii6: derived "is current track liked" for the transport heart button (Like replaces
	// Shuffle in the transport row; Shuffle moved into the TrackMenu kebab menu).
	const currentLiked = $derived(player.current ? library.isLiked(player.current.uid) : false);
	function toggleCurrentLike() {
		if (!player.current) return;
		hapticTick();
		library.toggleLike(player.current);
		toast.show(library.isLiked(player.current.uid) ? t('toast.liked') : t('toast.unliked'));
	}


	// quick-260629-nyl Task 1: lazily-resolved cover map for the Up-Next list rows AND the
	// carousel prev/next neighbors. Mirrors the established search/library/artist/album row idiom
	// (a reactive uid→url record repainted via onCoverResolved). Values are SOLID https URLs only
	// (lazyCover's isHttps gate) — safe for the existing background-image render path, no widening
	// of the injection surface (T-nyl-01 / inherits T-0bb-01). The carousel CURRENT cell is NOT
	// driven by this map (it keeps player.resolvedCover, which since quick-260809-38i also carries the
	// adopted Last.fm swap — see effectiveCover); it
	// instead self-heals a DEAD player.resolvedCover via player.healCover in its own $effect near the
	// effectiveCover derivation (quick-260704-20e) — the map stays neighbors-only.
	let resolvedCovers = $state<Record<string, string>>({});
	function onCoverResolved(uid: string, url: string) {
		resolvedCovers = { ...resolvedCovers, [uid]: url };
	}

	// shared context menu for current track + long-pressed queue/related rows
	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);
	function openMenu(t: Track | null) {
		menuTrack = t;
		menuOpen = !!t;
	}

	// Gap 4 (26-10): a single lazily-fed VersionPicker reachable from EVERY Up-Next row. A played/
	// queued song carries only its own source, so the variant list is discovered on demand — but
	// ONLY when the user taps a row's version trigger (openVersionPicker), never on list render, so
	// the Up-Next surface stays a zero-fan-out list (T-26-10-02). `versionGen`/`versionAc` are PLAIN
	// (non-reactive) supersedence guards — the house idiom (see player.svelte.ts playGen): a second
	// open bumps the token + aborts the prior fetch so a stale in-flight result can never land.
	let pickerVersions = $state<Track[]>([]);
	let pickerOpen = $state(false);
	let pickerLoading = $state(false);
	let versionGen = 0;
	let versionAc: AbortController | null = null;
	// aria-label resolved OUTSIDE the {#each upNextList as track} block (mirrors the search page's
	// verOpenLabel) — $derived so it re-resolves on an appLang change.
	const verOpenLabel = $derived(t('versions.open'));

	async function openVersionPicker(track: Track) {
		const gen = ++versionGen;
		versionAc?.abort();
		const ac = new AbortController();
		versionAc = ac;
		// Open immediately with the spinner; the single fetchVariants fan-out runs behind the sheet.
		pickerVersions = [];
		pickerLoading = true;
		pickerOpen = true;
		const list = await fetchVariants(track, ac.signal);
		// Supersedence: a newer open (or a close/abort) invalidates this result.
		if (gen !== versionGen || ac.signal.aborted) return;
		pickerVersions = list;
		pickerLoading = false;
	}
	function closeVersionPicker() {
		pickerOpen = false;
		versionAc?.abort(); // cancel any in-flight fetch when the sheet is dismissed.
	}

	function fallbackCover(t: Track | null): string {
		if (!t) return 'linear-gradient(145deg,#3a2d63,#1a1326)';
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	// ---- progress / scrubber (plan 002) ----
	const frac = $derived(player.duration > 0 ? player.currentTime / player.duration : 0);
	// While a live scrub is in flight, the UI shows the PREVIEW fraction (finger position) and the
	// audio is NOT seeked until release — so playback never stutters mid-drag. displayFrac is what
	// the rail + time readout render; it falls back to the real playback frac when not scrubbing.
	let scrubbing = $state(false);
	let scrubFrac = $state(0);
	const displayFrac = $derived(scrubbing ? scrubFrac : frac);
	const displayTime = $derived(
		scrubbing && player.duration > 0 ? scrubFrac * player.duration : player.currentTime
	);
	function onScrubPreview(f: number) {
		scrubFrac = f;
		scrubbing = true;
	}
	function onScrubCommit(f: number) {
		player.seekFraction(f); // clamps [0,1] internally; auto-plays if paused (same as tap-to-seek)
	}
	function onScrubEnd() {
		scrubbing = false;
	}
	// Keyboard parity retained: arrows nudge ±5s via the store (unchanged behaviour).
	function seekKey(e: KeyboardEvent) {
		if (player.duration <= 0) return;
		if (e.key === 'ArrowRight') player.seekFraction((player.currentTime + 5) / player.duration);
		else if (e.key === 'ArrowLeft') player.seekFraction((player.currentTime - 5) / player.duration);
	}

	// ---- lyrics ----
	// Lyrics pipeline: parse the LRC, then split any line carrying a `(...)` clause into its
	// own entry so each part (main text + parenthesised clause) flows through the per-line
	// translate path independently. The split entries carry `fromParen:true` so the renderer
	// can suppress their translations when settings.lyricsHideParenTranslation is on.
	const lines = $derived<LyricLine[]>(
		player.current?.lrc ? splitParenLines(reorderPairs(parseLRC(player.current.lrc))) : []
	);
	// When multiple lyric lines share a timestamp (common in CN LRCs that ship the original
	// + an inline translation as two consecutive entries at the same time, plus our own
	// splitParenLines parent + paren clauses), ALL of them are simultaneously active for
	// the user — they're the same moment of the song. `activeLine` is the FIRST entry of
	// that group (used as the scroll anchor); `activeTime` is the shared timestamp so the
	// renderer can mark every sibling line active via `lines[i].time === activeTime`.
	const activeIndexAndTime = $derived.by(() => {
		let idx = -1;
		let maxTime = -1;
		const now = player.currentTime;
		for (let i = 0; i < lines.length; i++) {
			const t = lines[i].time;
			if (t > now) break;
			if (t > maxTime) {
				maxTime = t;
				idx = i;
			}
		}
		return { idx, maxTime };
	});
	const activeLine = $derived(activeIndexAndTime.idx);
	const activeTime = $derived(activeIndexAndTime.maxTime);
	let lyricsEl = $state<HTMLElement | null>(null);
	// D-11/LYR-03: trailing-spacer height (px) ≈ half the visible band, set from the anchor
	// $effect's visHeight. A REAL element growing scrollHeight is required because browsers clamp
	// scrollTo to content bounds — without it the last lines pin to the bottom instead of centring.
	// NO top spacer (D-12).
	let spacerH = $state(0);
	let autoScroll = $state(true);
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	// D-10/LYR-02: how long after manual scrolling STOPS before auto-scroll resumes. Raised from
	// the old 600ms (which snapped the view back mid-read) to ~3s.
	const RESUME_MS = 3000;
	// Touch-presence auto-scroll: pause WHILE a finger is down (or wheel is active), resume a
	// short grace after release.
	//
	// The browser fires `pointercancel` on a touch that the page's scroll gesture has claimed
	// — this used to be treated as a release, which scheduled the resume timer + flipped
	// autoScroll back to true while the user's finger was STILL on the panel scrolling away
	// from the active line. Fix: only true `pointerup` releases. Track active pointers in a
	// Set so multi-touch (and the lost-pointer case where the element never sees pointerup
	// because the scroll claimed it) still resolves — a window-level pointerup capture-phase
	// listener catches the real finger-lift even after pointercancel stole it from the panel.
	const pressedPointers = new Set<number>();
	function lyricsTouched(e: PointerEvent) {
		autoScroll = false;
		if (idleTimer) clearTimeout(idleTimer);
		pressedPointers.add(e.pointerId);
		if (typeof window !== 'undefined') {
			window.addEventListener('pointerup', windowPointerUp, { capture: true });
			window.addEventListener('pointercancel', windowPointerUp, { capture: true });
		}
	}
	function windowPointerUp(e: PointerEvent) {
		// `pointerup` is the real finger-lift — release; `pointercancel` from the window means
		// the OS truly cancelled (app backgrounded, etc.), also release. The element-local
		// `pointercancel` handler is dropped from the JSX below precisely because it fires
		// during a scroll-gesture takeover even though the finger is still down.
		if (!pressedPointers.has(e.pointerId)) return;
		pressedPointers.delete(e.pointerId);
		if (pressedPointers.size === 0) {
			window.removeEventListener('pointerup', windowPointerUp, { capture: true });
			window.removeEventListener('pointercancel', windowPointerUp, { capture: true });
			lyricsReleased();
		}
	}
	function lyricsReleased() {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => (autoScroll = true), RESUME_MS);
	}
	function lyricsWheel() {
		// No release event for a wheel — pause, then schedule the same grace resume.
		autoScroll = false;
		if (idleTimer) clearTimeout(idleTimer);
		lyricsReleased();
	}
	// Pitfall 1 / D-10: iOS momentum scrolling keeps firing `scroll` events with NO further
	// pointer or wheel events after the finger lifts — so a timer armed at pointerup/wheel would
	// resume auto-scroll mid-glide and snap the view back. bumpResume re-arms the RESUME_MS timer
	// on every scroll tick while suspended, so resume only fires ~3s after scrolling TRULY stops
	// (momentum included). It is a no-op once auto-scroll is already on, so the anchor $effect's
	// own programmatic smooth-scroll never re-suspends itself.
	function bumpResume() {
		if (autoScroll) return;
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => (autoScroll = true), RESUME_MS);
	}
	// D-01/D-02/D-03: tap any lyric line to seek there. seekFraction is the only seek API and
	// already auto-plays when paused (D-03 free — no explicit play()). lineSeekFraction guards
	// duration <= 0 / non-finite → null, so no unbounded value reaches the audio element.
	// After seeking we clear the idle timer and force autoScroll back on (D-02): this overrides
	// the suspend that this tap's OWN lyricsTouched pointerdown just set, so the anchor $effect
	// re-runs on the autoScroll flip and smooth-centers the now-active (tapped) line immediately.
	function seekToLine(line: LyricLine) {
		const frac = lineSeekFraction(line.time, player.duration);
		if (frac !== null) player.seekFraction(frac); // D-03: auto-plays if paused
		if (idleTimer) clearTimeout(idleTimer);
		autoScroll = true;
	}
	// Keyboard parity for the tappable lyric line (Enter/Space) — mirrors the cover's tapCoverKey
	// and the grip's gripKey idiom, satisfying the a11y click-needs-keydown rule.
	function seekToLineKey(e: KeyboardEvent, line: LyricLine) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		seekToLine(line);
	}
	$effect(() => {
		const idx = activeLine;
		// sheetState is a read dependency: re-anchor the active line whenever the sheet
		// changes mode (closed/half/full) while the same line stays active.
		const mode = sheetState;
		if (tab !== 'lyrics' || !autoScroll || idx < 0 || !lyricsEl) return;
		// quick-260618-t7p Task 2: `idx` (activeLine) is an index into the FULL `lines` array, but the
		// rendered <p> list is FILTERED when settings.lyricsHideParenLines is ON, so a positional
		// querySelectorAll('p')[idx] selected the wrong (or out-of-range) element → over-scroll /
		// off-centre. Each rendered <p> now carries data-i={i} (its FULL-array index), so select the
		// active line by that index space directly. FALLBACK: when the active line is itself a hidden
		// paren line (no rendered <p> for that idx), anchor on the nearest rendered line with the
		// largest data-i <= idx (the previous visible line) so the view still anchors sanely.
		let el = lyricsEl.querySelector(`p[data-i="${idx}"]`) as HTMLElement | null;
		if (!el) {
			let best = -1;
			for (const p of lyricsEl.querySelectorAll<HTMLElement>('p[data-i]')) {
				const di = Number(p.dataset.i);
				if (Number.isFinite(di) && di <= idx && di > best) {
					best = di;
					el = p;
				}
			}
		}
		// Scope the scroll to the bounded .panel container (the overflow-y:auto scroller) and
		// move it manually — never the ancestor-walking scroll-into-view API, which yanks the
		// sheet to full in half mode. Compute the line's offset RELATIVE TO the container via rect deltas
		// (offsetParent-agnostic), then anchor it inside the panel without changing sheetState.
		const container = lyricsEl.closest('.panel') as HTMLElement | null;
		if (!el || !container) return;
		const elRect = el.getBoundingClientRect();
		const cRect = container.getBoundingClientRect();
		const offsetWithin = elRect.top - cRect.top + container.scrollTop; // line top in container scroll-space
		// Anchor depends on the sheet mode. In HALF the sheet is position:absolute;inset:0 then
		// translated DOWN by halfOffset, so container.clientHeight spans the full viewport while only
		// the slice between the container top and the viewport bottom is actually VISIBLE. Centering on
		// clientHeight/2 would land below the visible fold (the reported "near the bottom" bug). So derive
		// the anchor from the live VISIBLE band (rect intersect viewport), which self-corrects for every mode:
		//   closed -> anchor near the visible TOP (tiny peek height, top-pin per spec)
		//   half / full -> center within the visible band
		const vh = typeof window !== 'undefined' ? window.innerHeight : cRect.bottom;
		const visTop = Math.max(cRect.top, 0);
		const visBottom = Math.min(cRect.bottom, vh);
		const visHeight = Math.max(0, visBottom - visTop);
		spacerH = Math.round(visHeight / 2); // D-11: end spacer ≈ half the visible band → last line can center
		const visTopWithin = visTop - cRect.top; // visible-band top, in container-local coords
		const TOP_PAD = 12; // breathing room when top-pinned (closed)
		const anchorWithin =
			mode === 'closed'
				? visTopWithin + TOP_PAD
				: visTopWithin + visHeight / 2 - el.offsetHeight / 2; // visible-band center
		container.scrollTo({ top: offsetWithin - anchorWithin, behavior: 'smooth' });
	});

	// ---- lyrics translation ----
	let translated = $state<string[]>([]);
	let translating = $state(false);
	let trKey = '';
	$effect(() => {
		// ju0: lyricsLang now allows 'auto' (→ appLang). Resolve once here so both the
		// rerun key, shouldTranslate(), and translateLines() all see the SAME final token.
		const rawLang = settings.lyricsLang;
		const lang = effectiveTarget(rawLang);
		const skip = settings.lyricsSkip;
		const t = player.current;
		const n = lines.length;
		if (tab !== 'lyrics' || rawLang === 'off' || !n || !t) {
			// quick-260618-fiz Fix 1: flipping INTO a no-translate state (lyricsLang → 'off', leaving
			// the lyrics tab, or losing the track/lines) must drop any stale translations immediately
			// rather than leaving the previous song's output rendered until the next translate round.
			// Reset trKey too so re-entering the active state re-runs the translation from scratch.
			if (translated.length) translated = [];
			if (translating) translating = false;
			trKey = '';
			return;
		}
		// Per-line whitelist: only the lines whose detected source is NOT whitelisted (and
		// is not already in the target) get sent to /api/translate. Skipped lines keep
		// their ORIGINAL text in the corresponding output slot so index alignment +
		// showTr/translateMode (below/replace) render unchanged. Include skip in the key so
		// toggling the whitelist re-runs the effect.
		const key = `${t.uid}:${lang}:${n}:${skip.slice().sort().join(',')}`;
		if (trKey === key) return;
		// quick-260625-pzs-03: serve a previously-COMPLETED translation for this exact key from the
		// module-scoped cache BEFORE any reset/fetch. On a tab blur→focus or component remount the
		// per-instance `trKey` was reset to '' so this same track's effect re-runs; the cache hit
		// re-renders the finished translation synchronously — no untranslated flash, no /api/translate
		// round-trip. Only complete renders ever land in trCache (populated below), so a soft-fail
		// echo is never served as final.
		const cached = trCache.get(key);
		if (cached) {
			trKey = key;
			translated = cached;
			translating = false;
			return;
		}
		trKey = key;
		// WR-09: invalidate the PREVIOUS track's output immediately. The render gate is a pure
		// length comparison (translated.length === lines.length) — when the new track happens to
		// have the same line count, the old song's translations would otherwise render under the
		// new lyrics for the whole translate round-trip (and fully REPLACE them in replace mode).
		// quick-260618-fiz Fix 1: this synchronous clear ALSO makes a lyricsSkip/lyricsLang toggle
		// re-derive the CURRENT song's lyrics immediately — the key includes skip+lang, so flipping
		// either changes the key, drops the now-stale output here, and re-translates without a song
		// change (the "only applies to the next song" symptom was render staleness, not a dead effect).
		translated = [];
		translating = true;
		const sendIdx: number[] = [];
		const sendText: string[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (shouldTranslate(lines[i].text, lang, skip)) {
				sendIdx.push(i);
				sendText.push(lines[i].text);
			}
		}
		const stitch = (out: string[]) => lines.map((l, i) => {
			const pos = sendIdx.indexOf(i);
			return pos === -1 ? l.text : (out[pos] ?? l.text);
		});
		// quick-260618-fiz Fix 1: the all-whitelisted case (every line skipped / already target →
		// sendText.length === 0) resolves to the aligned ORIGINALS. Set it SYNCHRONOUSLY (stitch([])
		// maps each line to its own text) rather than waiting on a resolved-empty promise, so showTr
		// (translated.length === lines.length) stays true the instant the user whitelists the last
		// source — the originals render immediately instead of flashing untranslated for a microtask.
		if (!sendText.length) {
			// All-whitelisted / already-target: the stitched output is the aligned originals — trivially
			// COMPLETE (every line is its own text), so it is safe to cache (quick-260625-pzs-03 step 4).
			const stitched = stitch([]);
			if (stitched.length === lines.length) trCache.set(key, stitched);
			translated = stitched;
			translating = false;
			return;
		}
		// quick-260625-pzs-03: translateLinesEx exposes `complete` so we only FREEZE a fully-translated
		// batch. A transient soft-fail echoes the originals with complete:false — it is rendered (so the
		// user sees the originals meanwhile) but NOT cached, so switching language/back re-attempts it.
		translateLinesEx(sendText, lang)
			.then((res) => {
				if (trKey !== key) return;
				const stitched = stitch(res.out);
				translated = stitched;
				// Cache ONLY a complete render whose length matches (same gate the render uses). This is
				// the T-pzs-01 mitigation: an incomplete/echoed result is never frozen as final.
				if (res.complete && stitched.length === lines.length) trCache.set(key, stitched);
			})
			.catch(() => { if (trKey === key) translated = []; })
			.finally(() => { if (trKey === key) translating = false; });
	});
	const showTr = $derived(settings.lyricsLang !== 'off' && translated.length === lines.length);
	// ---- related ----
	let related = $state<Track[]>([]);
	let relatedLoading = $state(false);
	let relatedFor = '';
	$effect(() => {
		const t = player.current;
		if (tab === 'related' && t && relatedFor !== t.uid) {
			relatedFor = t.uid;
			related = [];
			relatedLoading = true;
			searchAll(t.artist, 1)
				.then((r) => {
					if (relatedFor !== t.uid) return; // race guard: a newer track took over
					related = dedupeBest(r.interleaved, settings.preferredSource).filter((x) => x.uid !== t.uid).slice(0, 20);
					relatedLoading = false;
				})
				.catch(() => {
					if (relatedFor !== t.uid) return;
					related = [];
					relatedLoading = false;
				});
		}
	});

	// ---- Last.fm enrichment (Phase 8, ENRICH-01/02) ----
	// Best-effort, OFF the playback critical path: keyed on the current uid, the
	// $effect void-fires enrichTrack (never awaited, never blocks) and assigns the
	// result only if the uid still matches (race guard, mirrors the related/trKey
	// idiom). A non-Last.fm track / absent key resolves to the all-empty shape, so
	// nothing renders and the source cover is never disturbed.
	let enrichedFor = '';
	$effect(() => {
		const cur = player.current;
		const uid = cur?.uid ?? '';
		if (!cur || enrichedFor === uid) return;
		enrichedFor = uid;
		// quick-260809-38i: no local per-uid reset is needed any more — the adopted cover lives in
		// player.resolvedCover, which play() already repoints on every track change.
		void enrichTrack(cur).then((r) => {
			if (player.current?.uid !== uid) return; // track changed mid-flight — discard
			// Tags/genre chips are hidden now (quick-260607-f4y) — enrichment is kept ONLY for
			// the hi-res Last.fm cover-art adoption below.
			if (r.lastfmArt) maybeSwapCover(r.lastfmArt, cur);
		});
	});

	// Preload the Last.fm cover candidate BEFORE swapping (D-04 guardrail 4 — no
	// flash). Swap only when the source cover is absent OR the preloaded image is
	// strictly larger than a sane threshold (D-04 guardrail 3). A real cover NEVER
	// regresses to a placeholder/broken image — the endpoint already filtered the
	// grey-star/empty art, and we keep the source cover when lastfmArt is null
	// (ENRICH-02 overrides D-03). Best-effort + async — never blocks first paint.
	//
	// quick-260809-38i — INVARIANT CHANGE: the winner is PROMOTED, not held locally. The adopted art
	// used to land in a component-local $state field, so it won on the hero ONLY while the
	// Nowbar (player.resolvedCover ?? np.cover) and the OS media card kept the old album — one song,
	// three covers. `player.adoptCover` now commits it to the single shared field + BOTH cache layers,
	// so every reader follows. What is measured is UNCHANGED: the candidate is still weighed against
	// `forTrack.cover` (the raw SOURCE cover), never against resolvedCover — that comparison is what
	// produces the correct cover, so only the destination moved.
	function maybeSwapCover(art: string, forTrack: Track) {
		if (typeof Image === 'undefined') return; // SSR guard
		// Adopt the Last.fm art only when its real width exceeds the source cover's
		// (D-04 g3: STRICTLY larger — never downgrade a good cover). `srcWidth = 0`
		// means the source is missing/broken, so any valid art is an improvement.
		const adopt = (srcWidth: number) => {
			const img = new Image();
			img.onload = () => {
				if (player.current?.uid !== forTrack.uid) return; // track changed — abort
				// quick-260809-38i: hand the verified winner to the ONE shared authority (the store
				// re-checks the uid, the https gate and same-url idempotence itself).
				if (img.naturalWidth > srcWidth) player.adoptCover(forTrack.uid, art);
			};
			img.onerror = () => {}; // broken candidate → keep the source cover
			img.src = art;
		};
		if (!forTrack.cover) {
			adopt(0); // no source cover → any non-placeholder Last.fm art wins
			return;
		}
		// Measure the source cover first (naturalWidth needs a load) so the swap is a
		// genuine resolution upgrade, not a same-size/smaller regression (WR-03).
		const src = new Image();
		src.onload = () => {
			if (player.current?.uid === forTrack.uid) adopt(src.naturalWidth);
		};
		src.onerror = () => adopt(0); // source cover broken → Last.fm art beats nothing
		src.src = forTrack.cover;
	}

	// Effective now-playing cover: the single player.resolvedCover field (COVER-01 / D-09) — which
	// already encompasses track.cover, the uid/name cache, the async tier-chain resolve AND (since
	// quick-260809-38i) the adopted hi-res Last.fm swap, so a no-cover-source track shows resolved art
	// here once the chain lands. The swap no longer needs a head position in this chain: it IS
	// resolvedCover the moment maybeSwapCover adopts it.
	//
	// cover-hero-mediacard-missing (Issue 1): FINAL fallback = the reactive cover cache (uid → name).
	// Before this, the hero was the ONLY cover surface not bound to the cache: it read resolvedCover
	// alone, while the up-next rows + carousel neighbors resolve via use:lazyCover and read the cache
	// reactively. resolvedCover is refreshed only in play()'s narrow windows (resolveCoverAsync fires
	// once, when it starts null + gen-guarded; healCover only repairs a non-null DEAD url), so a cover
	// that lands in the cache via a SIBLING surface (the same song's up-next row, a backfill, another
	// tile) after those windows showed on up-next but never on the hero — the reported "hero blank
	// while up-next has it". readCoverByUidOrName depends on coverVersion(), so the hero now repaints
	// the instant ANY cover lands for the current song. Null (all miss) → the seeded gradient (D-12).
	const effectiveCover = $derived(
		player.resolvedCover ??
			(player.current
				? readCoverByUidOrName(player.current.uid, player.current.artist, player.current.title)
				: null)
	);

	// quick-260704-20e: self-heal a DEAD current cover — the counterpart to the neighbor cells'
	// use:lazyCover. resolvedCover is seeded FIRST from track.cover (a source-CDN thumbnail that
	// frequently expires / is served over http:), so a non-null-but-dead URL paints the current cell
	// black (the reported bug). This $effect takes reactive deps on the current uid + effectiveCover
	// and fires player.healCover (probe → evict → re-resolve under the playGen guard) at most once per
	// uid+url. It returns early when effectiveCover is null (a true miss shows the gradient — nothing
	// to probe). Fire-and-forget: healCover is never-throw, one-shot, and generation-guarded, so
	// re-runs on re-render are safe.
	//
	// quick-260809-38i: the old "a local swap is showing → skip the heal" opt-out is GONE rather than
	// moved. An adopted cover is onload-VERIFIED before adoptCover commits it, so healCover's probe
	// simply loads and takes its zero-network fast path (step 5, `alive → return`) — the opt-out was
	// protecting against work that cannot happen. A live adopted cover can never be evicted here.
	$effect(() => {
		const uid = player.current?.uid;
		const cover = effectiveCover; // reactive dep — re-run when the displayed cover changes
		if (!uid) return; // no current track
		if (!cover) return; // true miss → gradient; nothing to probe
		void player.healCover(uid); // fire-and-forget; the one-shot guard lives in the store
	});

	// ---- Cover carousel (NP-01 / D-01) ----
	// A rigid 3-cell strip [prev | current | next] with neighbors flush against the current cell: each
	// cell is `position:absolute` at left -100% / 0 / 100% so the strip's RESTING transform is
	// translateX(0) (the current cell fills the cover; the neighbors sit flush off-screen and slide in
	// 1:1 mid-drag with no gutter between covers).
	// use:coverSwipe is attached to the strip element itself, so
	// the action's own live `translateX(dx)` IS the 1:1 lockstep follow (UI-SPEC §1) — no separate
	// transform to drive and no `ondrag` needed here (the action writes node.style.transform itself).
	// The strip's CSS commit-settle transition `transform 0.32s cubic-bezier(.22,1,.36,1)` is
	// overridden to `none` by the action while dragging, then restored on release/commit.
	//
	// Neighbors are derived from the PUBLIC player.queue by uid (indexOf is private in the store),
	// mirroring the PATTERNS neighbor-lookup. On commit the coverSwipe action calls player.prev()/
	// next() (D-03 — NO new advance fn); the store swap re-derives ci/prevCover/nextCover and the
	// strip repaints the committed neighbor as the new current cell.
	const ci = $derived(player.queue.findIndex((tk) => tk.uid === player.current?.uid));
	// quick-260618-lsw: the Up-Next LIST slices from the ANCHOR's live index, NOT from the live
	// current index `ci`. The store sets upNextAnchorUid ONLY on a fresh play / new-list install, so
	// an auto-advance (which advances `current`/`ci` but leaves the anchor put) keeps the just-played
	// song in the list — only the `.q-row.playing` highlight (keyed off the live current) moves down.
	// The findIndex-by-uid each render keeps the anchor correct across drag-reorder and removals (the
	// row moves with its uid). CLAMP: if the anchor uid is gone from the queue (removed) or never set
	// (cold/restore), fall back to the live current index `ci` (the 260618-ink behavior) so the list
	// still renders with current first and never goes blank.
	const anchorIdx = $derived(
		player.upNextAnchorUid
			? player.queue.findIndex((tk) => tk.uid === player.upNextAnchorUid)
			: -1
	);
	const upNextStart = $derived(anchorIdx >= 0 ? anchorIdx : ci >= 0 ? ci : 0);
	const upNextList = $derived(player.queue.slice(upNextStart)); // [anchor, ...current, ...tail]
	const prevCover = $derived(ci > 0 ? player.queue[ci - 1] : null);
	const nextCover = $derived(ci >= 0 && ci + 1 < player.queue.length ? player.queue[ci + 1] : null);
	// hasPrev is false at the first queued track; player.prev() restarts the song when currentTime
	// > 3, so that is the only prev rubber-band case. hasNext intentionally stays true whenever
	// there is a current track: player.next() owns end-of-queue growth, so a left swipe should commit
	// and let the store top up instead of resisting at the visual boundary.
	const hasPrevNeighbor = $derived(prevCover !== null && ci !== 0);
	const hasNextNeighbor = $derived(!!player.current);

	// ---- Contextual cover scale (plan 003, Domain 4) ----
	// Native players shrink the art when paused, expand when playing. A physics Spring drives the
	// scale so rapid play/pause toggles retarget smoothly mid-flight (interruptible — Emil). Only
	// applied while the sheet is CLOSED (the square hero); in half/full the cover is a full-bleed
	// banner where a scale would look wrong, so the target is pinned to 1 there. Reduce-motion (app
	// flag OR OS) snaps instantly via `{ instant: true }`. osReduceMotion is derived below (line ~600).
	const coverScale = new Spring(1, { stiffness: 0.16, damping: 0.62 });
	$effect(() => {
		const playing = player.playing;
		const closed = sheetState === 'closed';
		const reduce = settings.reduceMotion || osReduceMotion;
		const target = !playing && closed ? 0.93 : 1;
		coverScale.set(target, reduce ? { instant: true } : undefined);
	});
	// Cell background: current cell uses the effective (possibly Last.fm-swapped) cover; the prev/next
	// neighbors resolve through the SAME shared resolvedCovers map (lazyCover → Deezer→iTunes→CN) so a
	// null-cover neighbor shows real art instead of a perpetual gradient (quick-260629-nyl Task 1).
	// Resolved url wins over the raw track.cover; gradient fallback only on a true miss. null → 'none'.
	const cellBg = (tk: Track | null) =>
		tk
			? (resolvedCovers[tk.uid] ?? tk.cover)
				? `url(${resolvedCovers[tk.uid] ?? tk.cover})`
				: fallbackCover(tk)
			: 'none';

	// ---- Meta crossfade (NP-TEXT-XFADE) ----
	// On track change the {#key uid} block remounts title+artist, so an in:/out:fade crossfades the
	// outgoing text out while the incoming fades in. This is a Svelte JS transition, so the global
	// app.css `:root[data-reduce-motion] * { transition:none!important }` rule does NOT stop it —
	// it must be guarded explicitly. settings.reduceMotion is the app flag (already wired to
	// :root[data-reduce-motion]); we also OR the OS prefers-reduced-motion query so OS-only users
	// get the instant swap too. Duration 0 → instant remount, no animated fade.
	const osReduceMotion =
		typeof window !== 'undefined' && window.matchMedia
			? window.matchMedia('(prefers-reduced-motion: reduce)').matches
			: false;
	const xfadeMs = $derived(settings.reduceMotion || osReduceMotion ? 0 : 200);

	// quick-260625-pzs-01: the now-playing artist string is split into individual names so each
	// renders its own link to that SOLE artist. openArtistName generalises the old single-artist
	// openArtist navigation, parameterised by the per-name string (T-pzs-04: encodeURIComponent the
	// name exactly as before — the /artist/[name] route decodeURIComponent's the param).
	const artistNames = $derived(splitArtists(player.current?.artist ?? ''));
	// quick-260831-k5y: the resolved track's quality tag (FLAC / 320 / …), shown under the
	// title/artist when settings.showQualityTag is on. `qualityLabel` is the source's own
	// wording and wins; `quality` is the raw tier. Null for a stub that has not resolved yet
	// AND for a source that reports no tier — both render nothing (never an empty pill).
	// Same read order as TrackMenu.svelte:429 / VersionPicker.svelte:58.
	const qualityTag = $derived(player.current?.qualityLabel || player.current?.quality || null);
	function openArtistName(name: string) {
		if (!name) return;
		player.collapse();
		goto(`/artist/${encodeURIComponent(name)}`);
	}

	// quick-260625-pzs-02: swipe-to-queue on the Related list, mirroring search/+page.svelte:41-50.
	// swipe-right = add to queue (D-03), swipe-left = play next (D-04). Reuses the shared swipeAction
	// (tap-preserving + vertical-yielding) so tap-to-play and long-press menu keep working.
	function relatedSwipeQueue(track: Track) {
		player.addToQueue(track);
		toast.show(t('toast.addedToQueue'));
		hapticTick();
	}
	function relatedSwipeNext(track: Track) {
		player.playNext(track);
		toast.show(t('toast.playingNext'));
		hapticTick();
	}

	// ---- back-gesture: NowPlaying only renders while player.expanded, so mount == overlay
	// open. The back gesture runs player.collapse() (→ unmount → cleanup dismisses); the
	// header ChevronDown, cover drag-collapse, and openArtist all also call player.collapse(),
	// so they route through the SAME single dismiss path (the $effect cleanup). History depth
	// stays balanced: open pushes 1 state, cleanup's dismiss() pops it (or back-gesture's
	// closeTop already popped it → dismiss is a no-op).
	$effect(() => {
		// untrack: overlays.open/dismiss READ the $state overlay stack internally (isTop/has).
		// Without untrack this effect would capture that stack as a dependency and RE-RUN
		// (cleanup-dismiss then re-open, churning history) every time ANY other overlay (e.g.
		// the track menu) pushes/pops — desyncing history depth so the menu can't be dismissed.
		untrack(() => overlays.open('nowplaying', () => player.collapse()));
		return () => untrack(() => overlays.dismiss('nowplaying'));
	});

	// ---- Keyboard shortcuts (gte) — Space/←/→ on the open NowPlaying overlay.
	// NowPlaying only renders while player.expanded, so mount == overlay open; the cleanup
	// removes the listener on collapse. Suppress when typing in inputs / textareas / contentEditable
	// or while an IME composition is active so we never break text entry.
	$effect(() => {
		if (typeof window === 'undefined') return;
		function isTextEntry(el: EventTarget | null): boolean {
			if (!(el instanceof HTMLElement)) return false;
			const tag = el.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
			return el.isContentEditable;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.isComposing) return;
			if (isTextEntry(e.target)) return;
			if (e.key === ' ' || e.code === 'Space') {
				// WR-08: the focusTrap keeps focus on a NowPlaying control, and Space-activates-
				// the-focused-button is the platform convention — let focused interactive
				// elements win; only an unfocused-control Space toggles play/pause.
				const el = e.target as HTMLElement | null;
				if (
					el instanceof HTMLButtonElement ||
					el?.getAttribute('role') === 'button' ||
					el?.getAttribute('role') === 'slider'
				)
					return;
				e.preventDefault();
				player.toggle();
			} else if (e.key === 'ArrowLeft') {
				player.prev();
			} else if (e.key === 'ArrowRight') {
				player.next();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	// ---- NP top drag-down to collapse ----
	// Wrapping container (.np-top) carries the drag, so a downward swipe ANYWHERE on the
	// cover/meta/prog/transport collapses the player back to the nowbar. The sheet area
	// (grip/subnav/panel) is OUTSIDE this wrapper — it owns its own up/down snap machine.
	//
	// Slop-threshold capture: pointerdown just records the start position; no capture, no
	// `dragging=true`, no preventDefault. Only after the user moves ≥SLOP px vertically AND
	// the vertical component dominates the horizontal one does the wrapper claim the gesture
	// (setPointerCapture + dragging=true). Below that threshold the click reaches the button /
	// progress-bar / artist link normally, so taps don't get hijacked.
	let dragY = $state(0); // page-collapse translate (`.np` transform); only used on the closed-state down path
	let dragging = $state(false); // page-collapse drag in flight (drives `.np` transition:none)
	let dragArmed = false;
	let startY = 0;
	let startX = 0;
	const DRAG_SLOP = 8;
	// plan 005: flick-to-collapse. The page-collapse path was distance-only (dragY > 120); add a
	// velocity tracker so a fast downward flick dismisses too, matching the sheet snap machine and
	// the coverSwipe/dragClose gestures. Reuses the shared pure tracker (no Date.now — WR-safe).
	const collapseVel = createVelocityTracker();
	const COLLAPSE_FLICK_V = 0.5; // px/ms — same flick threshold as gripVel / coverSwipe FLICK_V
	// A cover vertical drag is a one-shot commit to one of two owners, chosen at the slop threshold:
	//   • snap-machine — when the sheet is OPEN (half/full), OR when it is closed and the gesture goes
	//     UP. Mirrors the grip 1:1: drives gripActive/sheetDragging/sheetDragY/gripMoved/gripVel so the
	//     `.np-top` translateY(${gripMoved}px) follows the finger with ZERO new transform code, and the
	//     same gripUp() FLICK/nearest-snap release logic commits sheetState.
	//   • page-collapse — ONLY when the sheet is `closed` AND the gesture goes DOWN: today's
	//     `dragY > 120 → player.collapse()` behaviour, unchanged.
	// `npTopDeleg` is set at commit so npTopMove/npTopUp know which owner drives the rest of the gesture.
	let npTopDeleg: 'none' | 'snap' | 'collapse' = 'none';
	let npTopStartState: SheetState = 'closed'; // sheetState captured at the moment of vertical commit
	function npTopDown(e: PointerEvent) {
		dragArmed = true;
		dragging = false;
		npTopDeleg = 'none';
		startY = e.clientY;
		startX = e.clientX;
		collapseVel.reset();
		collapseVel.sample(e.clientY, e.timeStamp);
	}
	function npTopMove(e: PointerEvent) {
		if (!dragArmed) return;
		const dy = e.clientY - startY;
		const dx = e.clientX - startX;
		// Axis-dominance claim (D-05): vertical wins ONLY after the slop threshold AND when the vertical
		// component dominates — `Math.abs(dy) > DRAG_SLOP && Math.abs(dy) > Math.abs(dx)`. A
		// horizontal-dominant drag falls through (no capture) so coverSwipe owns the carousel; nothing is
		// captured on pointerdown, so a sub-slop tap reaches the cover's onclick (Pitfall 7 invariant).
		// NOTE: the threshold is now on `Math.abs(dy)` (was `dy > DRAG_SLOP`, downward-only) so an UPWARD
		// drag also commits — this is the fix that lets the cover expand the sheet.
		if (npTopDeleg === 'none') {
			if (Math.abs(dy) > DRAG_SLOP && Math.abs(dy) > Math.abs(dx)) {
				(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
				npTopStartState = sheetState;
				if (sheetState !== 'closed') {
					// Sheet OPEN → the ENTIRE gesture (up OR down) is owned by the snap machine.
					npTopDeleg = 'snap';
					startGripFromCover(e);
				} else {
					// Sheet CLOSED → tentatively page-collapse, but a gesture that turns out to be UPWARD
					// is handed to the snap machine instead (decided here, by initial direction). A
					// downward commit from closed keeps today's page-collapse path.
					if (dy < 0) {
						npTopDeleg = 'snap';
						startGripFromCover(e);
					} else {
						npTopDeleg = 'collapse';
						dragging = true;
					}
				}
			} else {
				return;
			}
		}
		if (npTopDeleg === 'snap') {
			// Feed the snap machine exactly as gripMove does (no parallel impl).
			gripVel.sample(e.clientY, e.timeStamp);
			gripMoved = e.clientY - gripStartY; // may be NEGATIVE (up) — the downward-only clamp is gone
			sheetDragY = Math.max(0, Math.min(closedOffset, offsetFor(sheetState) + gripMoved));
		} else if (npTopDeleg === 'collapse') {
			collapseVel.sample(e.clientY, e.timeStamp);
			dragY = Math.max(0, dy);
		}
	}
	// Replicate gripDown's start sequence for a cover-initiated vertical drag. Does NOT
	// stopPropagation / re-capture (npTopMove already captured on `.np-top`) and does NOT read a
	// subnav tab (the cover is not a subnav button) — otherwise identical to gripDown so the cover
	// drives the SAME machine state the grip does.
	function startGripFromCover(e: PointerEvent) {
		disarmGripClickSuppressor();
		gripActive = true;
		gripStartY = e.clientY;
		gripMoved = e.clientY - startY; // continue from the slop already travelled (no jump on commit)
		gripStartTab = null;
		gripStartPlainButton = false;
		if (snapTimer) clearTimeout(snapTimer);
		gripVel.reset();
		gripVel.sample(e.clientY, e.timeStamp);
		measureOffsets();
		sheetDragging = true;
		sheetDragY = Math.max(0, Math.min(closedOffset, offsetFor(sheetState) + gripMoved));
	}
	function npTopUp() {
		const deleg = npTopDeleg;
		dragArmed = false;
		npTopDeleg = 'none';
		if (deleg === 'none') return; // tap path — let the cover's onclick do its thing
		if (deleg === 'snap') {
			// Hand the release to the grip snap machine: FLICK steps one state via gripVel/FLICK_V,
			// else nearest-snap with the same directional bias; snapTimer commits sheetState and clears
			// the transient drag state. An open-sheet DOWN gesture steps full→half→closed here — it does
			// NOT collapse the page. Page-collapse only happens on a subsequent CLOSED+down gesture.
			gripUp();
			return;
		}
		// deleg === 'collapse' — closed-state downward drag: distance OR a fast downward flick.
		dragging = false;
		const v = collapseVel.velocity(); // px/ms; > 0 = moving DOWN
		if (dragY > 120 || (v > COLLAPSE_FLICK_V && dragY > 8)) player.collapse();
		dragY = 0;
	}

	// ---- sheet: 3-state snap machine (closed / half / full) ----
	// translateY is measured in "full coordinates": 0 = full (sheet fills .np),
	// halfOffset = half-open (~50% down), closedOffset = closed/peek (sheet at its
	// resting peek height). The grip AND the subnav row both drive this via the same
	// gripDown/gripMove/gripUp pointer handlers. Mirrors the old live-drag idiom.
	type SheetState = 'closed' | 'half' | 'full';
	let sheetState = $state<SheetState>('closed');
	let sheetEl = $state<HTMLElement | null>(null);
	let transportEl = $state<HTMLElement | null>(null); // transport row → live bottom edge for flush half offset
	let coverEl = $state<HTMLElement | null>(null); // cover banner → its 0.32s reflow must settle before re-measuring halfOffset
	let sheetDragY = $state(0); // px in full-coordinates (0 = full, closedOffset = closed)
	let sheetDragging = $state(false); // forces absolute layout while dragging/snapping
	let gripActive = $state(false); // true only while finger is down (transition off)
	let subnavMoved = $state(false); // set true when the gesture passed the 8px drag threshold
	let gripStartY = 0;
	let gripMoved = $state(0);
	let gripStartTab: Tab | null = null; // gesture-transient: the subnav tab the gesture started on (null = grip/empty)
	let gripStartPlainButton = false; // gesture-transient: started on a subnav button WITHOUT data-tab (e.g. Clear) — WR-02
	let closedOffset = 300; // distance from full-top to closed/peek-top (measured at drag start)
	let halfOffset = $state(150); // distance from full-top to half-open-top; reactive so the resting-half transform updates when re-measured
	let snapTimer: ReturnType<typeof setTimeout> | null = null;
	let gripSuppressTimer: ReturnType<typeof setTimeout> | null = null; // NP-xx: self-expiry handle for the window-level grip trailing-click suppressor (mirrors coverSwipe WR-05)
	// Pointer-velocity tracker for the grip drag → a fast flick steps ONE state in the
	// flick direction even when distance is small (slow-drag falls back to nearest-by-position).
	const gripVel = createVelocityTracker();
	const FLICK_V = 0.5; // px/ms threshold that counts as a deliberate flick

	/** translateY (full-coordinate px) for a given resting state. */
	function offsetFor(s: SheetState): number {
		return s === 'full' ? 0 : s === 'half' ? halfOffset : closedOffset;
	}

	/** Measure closed/half offsets from the live layout at drag/tap start. */
	function measureOffsets() {
		const np = sheetEl?.closest('.np') as HTMLElement | null;
		if (!sheetEl || !np) return;
		const npRect = np.getBoundingClientRect();
		// When closed the sheet is in normal flow → real peek distance. When half/full it
		// is absolute, so derive a sensible peek height from the container instead.
		if (sheetState === 'closed') {
			closedOffset = Math.max(80, sheetEl.getBoundingClientRect().top - npRect.top);
		} else {
			closedOffset = Math.max(80, npRect.height * 0.72);
		}
		// Flush half-open: the panel top sits exactly at the bottom edge of the transport
		// row (no dead gap). Fall back to the old fraction only when the ref isn't mounted.
		halfOffset = transportEl
			? Math.round(transportEl.getBoundingClientRect().bottom - npRect.top)
			: Math.round(npRect.height * 0.5);
		// Keep ordering sane: half must sit between full(0) and closed.
		halfOffset = Math.max(20, Math.min(closedOffset - 20, halfOffset));
	}

	// NP-xx grip ghost-click fix: a TAP on the grip synchronously moves the sheet, and the browser's
	// trailing compatibility click (fired after pointerup at the tap coordinates) lands on whatever
	// element now sits under the finger — the play toggle (.play onclick) or the seek slider (.track
	// onclick={seek}) — causing an unwanted play/pause or a seek-back. This one-shot suppressor swallows
	// that trailing click. It mirrors the coverSwipe.ts trailing-click-suppressor idiom (coverSwipe.ts
	// lines 89-118 / 188-200) with ONE load-bearing deviation: coverSwipe arms on the gesture NODE
	// (setPointerCapture retargets the click to that node), but the grip's ghost click does NOT target
	// the grip — it targets the unrelated element (.play / .track) that slid under the finger after the
	// sheet moved. So the listener MUST be at WINDOW level, CAPTURE phase, to intercept the click before
	// it reaches its real (unrelated) target. A node-level / bubble-phase listener could not catch it.
	function disarmGripClickSuppressor() {
		window.removeEventListener('click', suppressGripClick, true);
		if (gripSuppressTimer !== null) {
			clearTimeout(gripSuppressTimer);
			gripSuppressTimer = null;
		}
	}
	function suppressGripClick(e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		disarmGripClickSuppressor();
	}
	function armGripClickSuppressor() {
		// Drop any stale suppressor first (a prior tap's trailing click may never have fired).
		disarmGripClickSuppressor();
		window.addEventListener('click', suppressGripClick, true);
		// WR-05 self-expiry: a touch tap often produces NO trailing click, so the suppressor must
		// self-disarm after a 350ms safety window rather than linger and swallow a later real click.
		gripSuppressTimer = setTimeout(disarmGripClickSuppressor, 350);
	}

	function gripDown(e: PointerEvent) {
		e.stopPropagation();
		// A new gesture drops a stale suppressor from a prior tap whose trailing click never fired
		// (mirror coverSwipe down() stale-suppressor cleanup, lines 122-124).
		disarmGripClickSuppressor();
		gripActive = true;
		subnavMoved = false;
		gripStartY = e.clientY;
		gripMoved = 0;
		// Remember which subnav tab (if any) the gesture started on, so a TAP switches that
		// tab with priority over the generic grip toggle. null = grip handle / empty nav area.
		// WR-02: only buttons WITH data-tab count as tabs; a plain subnav button (e.g. the
		// Clear-queue button) must act alone — its tap must NOT fall through to the generic
		// grip toggle (Clear used to also snap the sheet to a different state).
		const btn = (e.target as HTMLElement).closest('.subnav button[data-tab]') as HTMLElement | null;
		gripStartTab = btn ? (btn.dataset.tab as Tab) : null;
		gripStartPlainButton = !btn && !!(e.target as HTMLElement).closest('.subnav button');
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		if (snapTimer) clearTimeout(snapTimer);
		gripVel.reset();
		gripVel.sample(e.clientY, e.timeStamp);
		measureOffsets();
		sheetDragging = true;
		sheetDragY = offsetFor(sheetState);
	}
	function gripMove(e: PointerEvent) {
		if (!gripActive) return;
		e.stopPropagation();
		gripVel.sample(e.clientY, e.timeStamp);
		gripMoved = e.clientY - gripStartY;
		if (Math.abs(gripMoved) >= 8) subnavMoved = true;
		const start = offsetFor(sheetState);
		sheetDragY = Math.max(0, Math.min(closedOffset, start + gripMoved));
	}
	function gripUp() {
		if (!gripActive) return;
		gripActive = false;
		if (Math.abs(gripMoved) < 8) {
			// TAP → reset transient drag state regardless of branch taken below.
			sheetDragging = false;
			sheetDragY = 0;
			if (gripStartTab) {
				// Tap originated on a subnav item → switch to that tab (+ half-open from
				// closed) with priority over the generic toggle.
				selectTab(gripStartTab);
				gripStartTab = null;
				// selectTab() is invoked directly here, so suppress the trailing click to prevent both
				// the tab button's own onclick double-firing AND a ghost click when closed→half moves
				// the sheet and the transport slides under the finger.
				armGripClickSuppressor();
				return;
			}
			if (gripStartPlainButton) {
				// WR-02: tap on a non-tab subnav button (e.g. Clear queue) — its own onclick
				// acts alone; the generic grip toggle must NOT also change the sheet state.
				gripStartPlainButton = false;
				return;
			}
			// Tap on the grip handle / empty nav area → generic single step:
			// closed→half, half→closed, full→half.
			sheetState = sheetState === 'closed' ? 'half' : sheetState === 'full' ? 'half' : 'closed';
			gripStartTab = null;
			// The reported bug: this state reassignment moves the sheet, and the trailing compatibility
			// click lands on the .play toggle / .track seek slider that slid under the finger. Suppress it.
			armGripClickSuppressor();
			return;
		}
		gripStartTab = null;
		gripStartPlainButton = false;
		let target: SheetState;
		// FLICK → a fast pointer velocity steps ONE state in the flick direction, regardless
		// of how far the finger travelled (down = toward closed, up = toward full), clamped at
		// the ends. v > 0 = moving DOWN, v < 0 = moving UP.
		const v = gripVel.velocity();
		if (Math.abs(v) > FLICK_V) {
			if (v > 0) {
				// downward flick: full → half → closed (clamp)
				target = sheetState === 'full' ? 'half' : 'closed';
			} else {
				// upward flick: closed → half → full (clamp)
				target = sheetState === 'closed' ? 'half' : 'full';
			}
		} else {
			// SLOW DRAG → snap to the nearest of {full,half,closed}, biased by drag direction so a
			// deliberate swipe overshoots one state (up = toward full, down = toward closed).
			const dir = gripMoved < 0 ? -1 : 1; // -1 = swiped up, +1 = swiped down
			const bias = closedOffset * 0.12 * dir; // shift the decision point with the swipe
			const pos = sheetDragY + bias;
			const dHalf = Math.abs(pos - halfOffset);
			const dFull = Math.abs(pos - 0);
			const dClosed = Math.abs(pos - closedOffset);
			if (dFull <= dHalf && dFull <= dClosed) target = 'full';
			else if (dClosed <= dHalf && dClosed <= dFull) target = 'closed';
			else target = 'half';
		}
		sheetDragY = offsetFor(target); // animate (transition on now that gripActive=false)
		if (snapTimer) clearTimeout(snapTimer);
		snapTimer = setTimeout(() => {
			sheetState = target;
			sheetDragging = false;
			sheetDragY = 0;
			if (target === 'half') applyHalfInset();
		}, 290);
	}

	// HB6 (restores the gcy half→closed tap, kept atop the gww closed→toggle): a sub-slop TAP on the
	// cover dispatches on sheetState:
	//   - `closed` → toggle play/pause via player.toggle() (the same API the transport `.play` button
	//     uses); the closed cover doubles as a play/pause target.
	//   - `half`   → collapse the sheet to `closed` (the gcy behavior, restored by user request).
	//   - `full`   → NO-OP (unchanged).
	// This onclick only ever fires on a genuine tap: coverSwipe never setPointerCaptures on pointerdown
	// and arms a one-shot click suppressor on a committed swipe, so a committed carousel swipe does NOT
	// replay this. No extra movement guard beyond the state check (sub-slop-tap-reaches-onclick invariant).
	function tapCoverCollapse() {
		if (sheetState === 'closed') player.toggle();
		else if (sheetState === 'half') sheetState = 'closed';
		// `full` is a no-op.
	}
	// Keyboard parity for the cover's role="button" (Enter/Space) — mirrors the grip's gripKey idiom
	// and satisfies the a11y click-needs-keydown rule. Inherits the closed→toggle / half→no-op behavior.
	function tapCoverKey(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		tapCoverCollapse();
	}

	/** Grip keyboard step (Enter/Space): mirrors the TAP single-step. */
	function gripKey(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		sheetState = sheetState === 'closed' ? 'half' : sheetState === 'full' ? 'half' : 'closed';
	}

	/** Subnav item tap: switch tab; open to half from closed. Suppressed if it was a drag. */
	function selectTab(next: Tab) {
		if (subnavMoved) {
			subnavMoved = false;
			return; // gesture was a drag on the subnav row — don't switch tabs
		}
		tab = next;
		if (sheetState === 'closed') {
			sheetState = 'half';
			// small delay so layout is ready before we measure inset
			// (2 frames + short timeout is safer than immediate)
			setTimeout(() => applyHalfInset(), 30);
		}
	}

	// Resting half reads halfOffset for its transform, but tap/keyboard paths enter half
	// without going through measureOffsets() (only the drag path measures). Recompute the
	// flush offset whenever the sheet rests in half (and on layout-affecting changes).
	// SEPARATE from the back-gesture $effect above — measureOffsets() is idempotent and
	// guards on null refs.
	//
	// BUG-2 ROOT CAUSE FIX: the .cover runs a 0.32s width/height/margin reflow when entering
	// half/full. Measuring transportEl.bottom DURING that transition overshoots by the
	// cover-shrink delta → a visible dead gap. So defer the measurement until the reflow has
	// SETTLED: re-measure on the cover's transitionend (one-shot) AND via a double-rAF + a
	// ~340ms timeout fallback for the cases where no transition fires (already-reflowed tap
	// into half, or prefers-reduced-motion). All listeners/timers are torn down on cleanup so
	// nothing leaks or fires after the sheet leaves half.
	$effect(() => {
		if (sheetState !== 'half' || sheetDragging) return;
		// Measure immediately (best-effort) then again once the reflow settles for the flush value.
		measureOffsets();
		let raf1 = 0;
		let raf2 = 0;
		const onSettled = () => measureOffsets();
		const cover = coverEl;
		cover?.addEventListener('transitionend', onSettled, { once: true });
		// double-rAF: wait two frames so layout has flushed, then re-measure.
		raf1 = requestAnimationFrame(() => {
			raf2 = requestAnimationFrame(onSettled);
		});
		// timeout fallback (> the 0.32s reflow) for when no transitionend fires at all.
		const fallback = setTimeout(onSettled, 340);
		return () => {
			cover?.removeEventListener('transitionend', onSettled);
			if (raf1) cancelAnimationFrame(raf1);
			if (raf2) cancelAnimationFrame(raf2);
			clearTimeout(fallback);
		};
	});

	// ---- Up-Next reorder: custom pointer/touch drag on the far-right grip handle ----
	// (NOT native HTML5 DnD — poor on touch). On drop we call player.reorderQueue,
	// which pins the moved track manual so it survives the next fresh-play regen.
	let queueListEl = $state<HTMLElement | null>(null);
	// quick-260618-ink (tweak 2): one-shot latch — plain let (NOT $state) so reading it does not make
	// the scroll effect re-run; reset to false when the list closes so the next open re-fires.
	let upNextScrollDone = false;
	let dragFrom = $state(-1); // source row index while dragging (-1 = idle)
	let dragOver = $state(-1); // current target row index
	let rowDragY = $state(0); // px the lifted row follows the finger
	let rowDragStartY = 0;

	/** Find the queue row index under client-Y `y` by measuring each <li>'s rect. */
	function rowIndexAt(y: number): number {
		if (!queueListEl) return dragFrom;
		const items = queueListEl.querySelectorAll('li');
		for (let i = 0; i < items.length; i++) {
			const r = items[i].getBoundingClientRect();
			if (y < r.top + r.height / 2) return i;
		}
		return items.length - 1;
	}

	function gripDragDown(e: PointerEvent, index: number) {
		e.stopPropagation(); // don't trigger the row's play onclick
		dragFrom = index;
		dragOver = index;
		rowDragStartY = e.clientY;
		rowDragY = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function gripDragMove(e: PointerEvent) {
		if (dragFrom < 0) return;
		rowDragY = e.clientY - rowDragStartY;
		dragOver = rowIndexAt(e.clientY);
	}
	function gripDragUp() {
		if (dragFrom < 0) return;
		// list is sliced from current (upNextStart); reorderQueue needs queue-absolute indices.
		if (dragOver >= 0 && dragOver !== dragFrom)
			player.reorderQueue(dragFrom + upNextStart, dragOver + upNextStart);
		dragFrom = -1;
		dragOver = -1;
		rowDragY = 0;
	}

	// quick-260618-ink (tweak 2): ONE-SHOT scroll-to-current on Up-Next OPEN only. Latched by
	// upNextScrollDone, reset when the list closes. Deliberately NOT a mutation-driven scroll —
	// 260615-mnr removed continuous auto-scroll (overflow-anchor:none) and that must not return.
	$effect(() => {
		// Only `tab` + `sheetState` are TRACKED reads — the open/visibility transitions. The row
		// lookup happens inside the rAF callback (untracked DOM read), so a queue mutation alone
		// never re-fires this scroll.
		const isOpen = tab === 'queue' && sheetState !== 'closed';
		if (!isOpen) {
			upNextScrollDone = false; // re-arm for the next open
			return;
		}
		if (upNextScrollDone) return;
		upNextScrollDone = true; // latch immediately so a reactive re-tick cannot re-scroll
		if (typeof window === 'undefined') return;
		// The DOM may not be laid out the same tick the tab flips; wait one frame so layout flushed.
		requestAnimationFrame(() => {
			const container = queueListEl?.closest('.panel') as HTMLElement | null;
			const playingRow = queueListEl?.querySelector('.q-row.playing') as HTMLElement | null;
			const li = playingRow?.closest('li') as HTMLElement | null;
			if (!container || !li) return;
			// Pin the current row to the container TOP (block:'start' semantics) via rect deltas —
			// NOT Element.scrollIntoView() ancestor-walking (it yanks the sheet to full).
			const liRect = li.getBoundingClientRect();
			const cRect = container.getBoundingClientRect();
			const offsetWithin = liRect.top - cRect.top + container.scrollTop;
			container.scrollTo({ top: offsetWithin, behavior: 'smooth' });
		});
	});

	function applyHalfInset() {
		return;
		// if (!sheetEl || !transportEl) return;
		// const np = sheetEl.closest('.np') as HTMLElement | null;
		// if (!np) return;
		// const npRect = np.getBoundingClientRect();
		// const tRect = transportEl.getBoundingClientRect();
		// const top = Math.round(tRect.bottom - npRect.top);
		// sheetEl.style.setProperty('--sheet-half-top', top + 'px');
	}
</script>

<section
	class="np"
	class:reflow={sheetState !== 'closed'}
	class:fullshrink={sheetState == 'full'}
	transition:fly={{ y: 600, duration: 320, easing: cubicOut }}
	style:transform={dragY ? `translateY(${dragY}px)` : undefined}
	style:transition={dragging ? 'none' : 'transform 0.28s cubic-bezier(.22,1,.36,1)'}
	use:focusTrap
>
	<!-- NP-04: top running-line loader. The indeterminate variant ONLY (always `indet`, only
	     the sliver — no determinate seek `<i style:width>`, that one is the Nowbar's seek progress).
	     Reuses the nowbar's `np-prog indet` + `sliver` class names verbatim so it inherits the
	     shared `np-indet` keyframe. Mounted as the FIRST child of `.np`, full-bleed under
	     `env(safe-area-inset-top)`, above the cover and `.bar`. DEFAULT per 20-UI-SPEC §6:
	     render in ALL sheet states (unconditional `{#if player.loading}`). The suppress-in-full
	     fallback (`&& sheetState !== 'full'`) is NOT applied — no visual duplication with the
	     embedded Nowbar's own `.np-prog` is expected (the Nowbar's bar sits at its own top edge
	     inside the flow, while this loader is absolutely pinned to the notch-safe top of `.np`). -->
	{#if player.loading}
		<div class="np-top-loader np-prog indet"><i class="sliver motion-always"></i></div>
	{/if}
	{#if sheetState === 'full'}
		<!-- mtv-followup: reuse the existing docked Nowbar as the sticky top bar when the
		     subnav sheet is fully open. Same cover/title/artist/play layout as the
		     bottom-of-screen mini-player; tapping it collapses the sheet (returns to the
		     full Now Playing view, sheet closed). The lower header (.bar) is hidden by CSS
		     so the underlying NP chrome doesn't leak through. -->
		<Nowbar variant="embed" onOpen={() => { sheetState = 'closed'; sheetDragY = offsetFor('closed'); }} />
	{/if}
	<header class="bar">
		<button class="icon" aria-label={t('nowplaying.collapse')} onclick={() => player.collapse()} use:tapBounce><ChevronDown /></button>
		<!-- <span class="ctx">{t('nowplaying.nowPlaying')}</span> -->
		<button class="icon" aria-label={t('nowplaying.options')} onclick={() => openMenu(player.current)} use:tapBounce><MoreVertical /></button>
	</header>

	<!-- Wrapping container so the whole top half of NP (cover + meta + prog + transport)
	     accepts the swipe-down-to-collapse gesture. Slop-thresholded capture: a tap on any
	     button/artist link inside still fires its click handler normally; only a clear
	     vertical drag claims the gesture and translates the panel downward. -->
	<div
		class="np-top"
		role="group"
		aria-label={t('nowplaying.albumArt')}
		onpointerdown={npTopDown}
		onpointermove={npTopMove}
		onpointerup={npTopUp}
		onpointercancel={npTopUp}
		style:transform={
			(sheetDragging)
				? `translateY(${gripMoved}px)`
				: undefined
		}
	>
	<!-- AXIS-ARBITRATION CONTRACT (D-05 / Pitfall 7 — the highest-risk interaction in v1.2):
	     The cover region hosts THREE pointer paths that must NEVER both capture:
	       • HORIZONTAL carousel — use:coverSwipe on `.cover-strip` (below). Owns the X axis. Arms on
	         down WITHOUT setPointerCapture; commits + captures in pointermove ONLY after the 8px slop
	         and |dx|>|dy| dominance check; yields (goes passive, no capture) on vertical dominance so
	         a down-drag started on the cover flows up to npTopMove. touch-action: pan-y set by the
	         action on attach so the browser hands it the X axis.
	       • VERTICAL collapse — npTop*/.np-top wrapper (unchanged). Owns the Y axis. `.np-top` keeps
	         touch-action: pan-x so the wrapper yields the horizontal pan to the action; npTopMove
	         captures ONLY after `dy > DRAG_SLOP && |dy| > |dx|`, so it never steals a horizontal swipe.
	       • TAP — the `.cover` onclick (tap-to-collapse-in-half, NP-03). A sub-slop tap reaches it
	         because neither path captures on pointerdown; a committed swipe does NOT replay it because
	         coverSwipe arms a one-shot capture-phase click suppressor on the strip (stops the bubble to
	         `.cover`). NO extra movement guard is added beyond the sheetState check.
	     Net: |dy|>|dx| past slop → vertical collapse; |dx|>|dy| past slop → carousel; sub-slop → tap. -->
	<div
		class="cover"
		onclick={tapCoverCollapse}
		onkeydown={tapCoverKey}
		role="button"
		tabindex="0"
		bind:this={coverEl}
		aria-label={t('nowplaying.albumArt')}
		style:transform={`scale(${coverScale.current})`}
	>
		<!-- Rigid 3-cell carousel strip: prev | current | next, neighbors flush against the current
		     cell, 1:1 lockstep (no parallax/scale/fade — UI-SPEC §1). Neighbors sit flush off-screen
		     and slide in mid-drag with no gutter; the committed neighbor lands centered.
		     overflow:hidden clips the off-strip neighbor. The
		     strip's resting transform is translateX(0) (current cell at left:0); coverSwipe translates
		     it live, then settles the committed neighbor to center over 0.32s before the store swap
		     re-derives the cells. No accent/color/glow on arm (UI-SPEC §3 — positional feedback only). -->
		<div
			class="cover-strip"
			use:coverSwipe={{
				onprev: () => player.prev(),
				onnext: () => player.next(),
				hasPrev: hasPrevNeighbor,
				hasNext: hasNextNeighbor
			}}
		>
			<!-- quick-260629-nyl Task 1: the prev/next neighbor cells resolve their cover via the SAME
			     use:lazyCover chain (Deezer→iTunes→CN) the Up-Next rows use, repainting through the shared
			     resolvedCovers map (cellBg reads it first). Attach the action ONLY when the neighbor is
			     non-null (an empty cell stays 'none'); the CURRENT cell is untouched (effectiveCover). -->
			{#if prevCover}
				<div class="cover-cell prev" use:lazyCover={{ track: prevCover, onResolved: onCoverResolved }} style:background-image={cellBg(prevCover)}></div>
			{:else}
				<div class="cover-cell prev" style:background-image="none"></div>
			{/if}
			<div class="cover-cell cur">
				<!-- plan 003: the current cell crossfades its art on a non-swipe track change / late
				     resolve. Two keyed layers stack at inset:0 and dissolve; the strip transform
				     (coverSwipe) is on the parent .cover-strip and is unaffected. xfadeMs → 0 under
				     reduce-motion, so it becomes an instant swap. -->
				{#key effectiveCover}
					<div
						class="cover-img"
						in:fade={{ duration: xfadeMs }}
						out:fade={{ duration: xfadeMs }}
						style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackCover(player.current)}
					></div>
				{/key}
			</div>
			{#if nextCover}
				<div class="cover-cell next" use:lazyCover={{ track: nextCover, onResolved: onCoverResolved }} style:background-image={cellBg(nextCover)}></div>
			{:else}
				<div class="cover-cell next" style:background-image="none"></div>
			{/if}
		</div>
	</div>

	<div class="meta">
		<!-- {#key uid}: .title/.artist are single persistent nodes, so the marquee action would
		     never re-measure on a track change (box width is unchanged). Re-keying remounts them
		     per track → fresh measure AND drives the in:/out:fade crossfade (outgoing text fades
		     out while incoming fades in; xfadeMs collapses to 0 under reduce-motion). .marquee-inner
		     wraps the text so the GLOBAL transform-based marquee in app.css drives them (gmy unified
		     the artist + NowPlaying drift onto one system). Genre/tag chips intentionally hidden
		     (quick-260607-f4y). -->
		{#key player.current?.uid}
			<div class="title" use:marquee in:fade={{ duration: xfadeMs }} out:fade={{ duration: xfadeMs }}><span class="marquee-inner">{player.current ? names.dnTitle(player.current.title) : ''}</span></div>
			<!-- quick-260625-pzs-01: one tappable link PER artist name (split on connectors). The row
			     keeps use:marquee + the in:/out:fade crossfade; names are joined by an INERT ` · `
			     separator span (not a link). When there is a single name (the common case) exactly one
			     link renders with no separator — visually unchanged from before. -->
			<div class="artist" use:marquee in:fade={{ duration: xfadeMs }} out:fade={{ duration: xfadeMs }}><span class="marquee-inner">{#each artistNames as name, i (name + i)}{#if i > 0}<span class="artist-sep" aria-hidden="true"> · </span>{/if}<button class="artist-link" onclick={() => openArtistName(name)}>{names.dnArtist(name)}</button>{/each}</span></div>
		{/key}
		<!-- quick-260831-k5y: opt-in quality tag. OUTSIDE the {#key} block on purpose — the value
		     lands asynchronously after ensureTrackDetails, so it repaints in place rather than
		     remounting with the title/artist crossfade. Renders nothing at all when the track has
		     no tag, so an unresolved stub leaves no empty box. -->
		{#if settings.showQualityTag && qualityTag}
			<div class="quality-tag">{qualityTag}</div>
		{/if}
	</div>

	{#if player.error}
		<p class="np-error" role="alert">{tMaybeKey(player.error)}</p>
	{/if}

	<div class="prog">
		<div
			class="scrubber"
			class:scrubbing
			style:--scrub-frac={displayFrac}
			role="slider"
			tabindex="0"
			aria-label={t('nowplaying.seek')}
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={Math.round(displayFrac * 100)}
			onkeydown={seekKey}
			use:scrub={{ onSeek: onScrubCommit, onPreview: onScrubPreview, onScrubEnd }}
		>
			<div class="scrub-fill"></div>
			<div class="scrub-knob"></div>
		</div>
		<div class="times">
			<span>{fmtTime(displayTime)}</span>
			<span>{player.duration > 0 ? fmtTime(player.duration) : '--:--'}</span>
		</div>
	</div>

	{#if sleepTimer.active}
		<!-- Full sleep-timer readout (D-07: now-playing shows the FULL mm:ss, end-of-track shows the
		     label). Tappable → opens the SAME global sheet as the nowbar/track-menu (D-08). The .t /
		     class:on idiom reads as active. -->
		<div class="st-row">
			<button class="t st-readout on" aria-label={t('menu.sleepTimer')} onclick={() => (sleepTimer.sheetOpen = true)} use:tapBounce>
				<Moon size={16} />
				{#if sleepTimer.mode === 'minutes'}{fmtTime(sleepTimer.remaining / 1000)}{:else}{t('timer.endOfTrack')}{/if}
			</button>
		</div>
	{/if}

	<div class="transport" bind:this={transportEl}>
		<button class="t" class:on={currentLiked} aria-pressed={currentLiked} aria-label={currentLiked ? t('menu.liked') : t('menu.like')} onclick={toggleCurrentLike} use:tapBounce><Heart size={20} fill={currentLiked ? 'currentColor' : 'none'} /></button>
		<button class="t" aria-label={t('nowplaying.previous')} onclick={() => player.prev()} use:tapBounce><SkipBack size={26} /></button>
		<button class="play" aria-label={t('nowplaying.playPause')} onclick={() => player.toggle()} use:tapBounce>
			<span class="play-glyph" class:is-playing={player.playing} aria-hidden="true">
				<span class="pg pg-play"><Play size={26} /></span>
				<span class="pg pg-pause"><Pause size={26} /></span>
			</span>
		</button>
		<button class="t" aria-label={t('nowplaying.next')} onclick={() => player.next()} use:tapBounce><SkipForward size={26} /></button>
		<button class="t" class:on={player.repeatMode !== 'off'} aria-pressed={player.repeatMode !== 'off'} aria-label={player.repeatMode === 'one' ? t('nowplaying.repeatModeOne') : t('nowplaying.repeat')} onclick={() => player.cycleRepeat()} use:tapBounce>
			{#if player.repeatMode === 'one'}<Repeat1 size={20} />{:else}<Repeat size={20} />{/if}
		</button>
	</div>
	</div>

	<div
		class="sheet"
		class:half={sheetState === 'half'} 
		class:full={sheetState === 'full'}		
		class:dragging={sheetDragging}
		bind:this={sheetEl}
		style:transform={
			(sheetDragging)
				? `translateY(${gripMoved}px)`
				: undefined
		}
		style:transition={
			gripActive
				? 'none'
				: 'transform 0.28s cubic-bezier(.22,1,.36,1), inset 0.28s cubic-bezier(.22,1,.36,1)'
		}
		style:inset={
			sheetState === 'half'
				? `var(--sheet-half-top, 260px) 0 0 0`
				: sheetState !== 'closed'
					? '0'
					: undefined
		}
	>
		<div class="grip" role="button" tabindex="0" aria-label={sheetState === 'closed' ? t('nowplaying.expandPanel') : t('nowplaying.collapsePanel')}
			onpointerdown={gripDown} onpointermove={gripMove} onpointerup={gripUp} onpointercancel={gripUp}
			onkeydown={gripKey}>
			<span class="handle"></span>
		</div>

		<nav class="subnav"
			onpointerdown={gripDown} onpointermove={gripMove} onpointerup={gripUp} onpointercancel={gripUp}>
			<button data-tab="queue" class:active={tab === 'queue'} onclick={() => selectTab('queue')} use:tapBounce>{t('nowplaying.upNext')}</button>
			<button data-tab="lyrics" class:active={tab === 'lyrics'} onclick={() => selectTab('lyrics')} use:tapBounce>{t('nowplaying.lyrics')}</button>
			<button data-tab="related" class:active={tab === 'related'} onclick={() => selectTab('related')} use:tapBounce>{t('nowplaying.related')}</button>
		</nav>

		<div class="panel">
			{#if tab === 'queue'}
				{#if upNextList.length}
					<ul class="list" bind:this={queueListEl}>
						{#each upNextList as track, i (track.uid)}
							{@const skipped = player.isUnplayable(track.uid)}
							<li
								class:lifted={i === dragFrom}
								class:over={i === dragOver && i !== dragFrom}
								style:transform={i === dragFrom && rowDragY ? `translateY(${rowDragY}px)` : undefined}
							>
								<!-- Gap 4 (26-10): per-row version-picker trigger. A SIBLING tap target (its own ≥44px hit
								     area) placed BEFORE the swipeable .q-row button — NEVER nested inside it (no button-in-button)
								     so use:swipeRemove/longpress/grip stay intact. Shown on EVERY row (variants are discovered on
								     demand — the picker's loading/empty states cover a ≤1-variant song); opening fires the single
								     lazy fetchVariants fan-out (T-26-10-02). Mirrors search/+page.svelte's .row-line/.ver pattern. -->
								<button class="ver" aria-label={verOpenLabel} onclick={() => openVersionPicker(track)} use:tapBounce><Layers size={18} /></button>
								<!-- quick-260615-i9u (Feature A): a probe-confirmed-dead Up-Next entry stays IN the queue
								     (nextPlayableIndex just routes past it) — render it dimmed with a leading ✗ and branch
								     the row tap to retry-that-exact-track instead of a fresh play. swipeRemove/longpress/grip
								     are deliberately untouched so reorder + swipe-remove keep working on a skipped row. -->
								<button class="row q-row" class:playing={track.uid === player.current?.uid} class:skipped use:swipeRemove={{ onremove: () => player.removeFromQueue(track.uid), enabled: track.uid !== player.current?.uid }} use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); openMenu(track); }} onclick={(e) => { (e.currentTarget as HTMLElement)?.blur(); skipped ? player.retryUnplayable(track) : player.play(track, {fresh: false}); }} title={skipped ? t('nowplaying.skippedRetry') : undefined}>
									<!-- Gap 3 (26-10): the Up-Next LIST tile paints from the SEEDED cover (26-07 seeds the
									     name-stub's cover with the Last.fm image; search/resolved tracks carry their real cover),
									     with a gradient on a true miss — NO per-tile use:lazyCover Deezer→iTunes→CN chain (that
									     was the observed /api/deezer/search flood — T-26-10-01). The `resolvedCovers[track.uid] ??`
									     read is KEPT (zero-cost): the map is still fed by the prev/next CAROUSEL neighbors below,
									     so a row that WAS a neighbor keeps its resolved cover, but the list itself resolves nothing.
									     Accepted trade-off: an Up-Next tile no longer self-heals a dead cover via the chain — only the
									     now-playing track gets the optional HQ upgrade (per the UAT). https-only; never throws. -->
									<span class="q-art" style:background-image={(resolvedCovers[track.uid] ?? track.cover) ? `url(${resolvedCovers[track.uid] ?? track.cover})` : fallbackCover(track)}></span>
									<span class="q-text">
										{#if skipped}<span class="r-skip" aria-hidden="true">✗</span>{/if}
										<span class="r-title">{names.dnTitle(track.title)}</span>
										<span class="r-artist">{names.dnArtist(track.artist)}</span>
									</span>
									<!-- quick-260723: passive liked/downloaded indicators on up-next rows. -->
									<RowBadges uid={track.uid} />
								</button>
								<button
									class="grip-handle"
									aria-label={t('nowplaying.reorderTrack')}
									onpointerdown={(e) => gripDragDown(e, i)}
									onpointermove={gripDragMove}
									onpointerup={gripDragUp}
									onpointercancel={gripDragUp}
									onclick={(e) => e.stopPropagation()}
								><GripVertical size={18} /></button>
							</li>
						{/each}
					</ul>
				{:else}<p class="empty">{t('nowplaying.noQueue')}</p>{/if}
			{:else if tab === 'lyrics'}
				{#if lines.length}
					{#if translating}<p class="tr-hint">{t('nowplaying.translating')}</p>{/if}
					<div class="lyrics" role="group" aria-label={t('nowplaying.lyrics')} bind:this={lyricsEl} onpointerdown={lyricsTouched} onwheel={lyricsWheel} onscroll={bumpResume}>
						{#each lines as l, i (i)}
							{#if !(l.fromParen && settings.lyricsHideParenLines)}
								{@const hideTrForLine = l.fromParen && settings.lyricsHideParenTranslation}
								<!-- D-01: every lyric line is a tap target that seeks to its timestamp. The line stays a
								     semantic <p> so the anchor $effect's `querySelectorAll('p')[idx]` scroll-centering, the
								     `.lyrics p` centring/active/paren CSS, and the activeTime↔translated[i] index alignment
								     are ALL untouched (swapping to <button> would break the anchor lookup the plan forbids
								     editing). onkeydown gives Enter/Space parity (seekToLineKey); role="button"+tabindex make
								     it a focusable control. A <p> cannot legally carry an interactive role/tabindex per ARIA,
								     so the three resulting advisories are silenced at element scope only. -->
								<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
								<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
								<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
								<p data-i={i} class:active={l.time === activeTime && activeTime >= 0} class:paren={l.fromParen} onclick={() => seekToLine(l)} onkeydown={(e) => seekToLineKey(e, l)} role="button" tabindex="0">
									{#if showTr && settings.translateMode === 'replace' && !hideTrForLine}
										{translated[i]}
									{:else}
										{l.text}
										{#if showTr && !hideTrForLine}<span class="tr" class:active={l.time === activeTime && activeTime >= 0}>{translated[i]}</span>{/if}
									{/if}
								</p>
							{/if}
						{/each}
					</div>
				{:else}<p class="empty">{t('nowplaying.noLyrics')}</p>{/if}
			{:else}
				{#if related.length}
					<ul class="list">
						{#each related as track (track.uid)}
							<!-- quick-260625-pzs-02: reveal layers sit BEHIND the row; the row translateX
							     (use:swipeAction) slides to expose them. Right-drag → queue, left-drag → play
							     next. aria-hidden (the same actions stay reachable via the long-press menu). -->
							<li class="swipe-wrap related-swipe">
								<span class="reveal reveal-queue" aria-hidden="true"><ListEnd size={20} /></span>
								<span class="reveal reveal-next" aria-hidden="true"><ListStart size={20} /></span>
								<button class="row rel-row" use:longpress onlongpress={(e) => { (e.currentTarget as HTMLElement)?.blur(); openMenu(track); }} onclick={() => player.play(track, { fresh: true })} use:swipeAction={{ onSwipeRight: () => relatedSwipeQueue(track), onSwipeLeft: () => relatedSwipeNext(track) }}><span class="r-meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-artist">{names.dnArtist(track.artist)}</span></span><RowBadges uid={track.uid} /></button>
							</li>
						{/each}
					</ul>
				{:else if relatedLoading}
					<ul class="list" aria-label={t('nowplaying.loadingRelated')}>
						<span class="vh">{t('nowplaying.loadingRelated')}</span>
						{#each Array(8) as _, i (i)}
							<li><span class="row skel" aria-hidden="true"><span class="r-title sk"></span><span class="r-artist sk"></span></span></li>
						{/each}
					</ul>
				{:else}<p class="empty">{t('nowplaying.noRelated')}</p>{/if}
			{/if}
		</div>
	</div>

	<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

	<!-- Gap 4 (26-10): ONE VersionPicker mount driven by the per-row trigger. `loading` is bound to the
	     in-flight fetchVariants state so the sheet opens instantly with a spinner; onpick plays the chosen
	     source's EXACT variant fresh (the user explicitly re-picked the source). -->
	<VersionPicker
		versions={pickerVersions}
		open={pickerOpen}
		loading={pickerLoading}
		overlayId="versionpicker-page"
		onclose={closeVersionPicker}
		onpick={(v) => player.play(v, { fresh: true })}
	/>
</section>

<style>
	/* quick-260611-fr9: top is intentionally FLUSH (0) — content starts at the very top with no
	   gap above the header (.bar). The header and .np-top follow immediately, neither carries a
	   top margin. Bottom safe-area inset is preserved; only the TOP is flush. */
	.np { position: fixed; inset: 0; z-index: 50; background: var(--color-bg); display: flex; flex-direction: column; padding: 0 18px env(safe-area-inset-bottom); overflow: hidden; }
	/* NP-04: top running-line loader. .np-prog / .np-prog.indet / .sliver + the np-indet
	   keyframe + reduced-motion override are copied byte-for-byte from Nowbar.svelte so the
	   loader is visually identical to the nowbar's indeterminate bar. .np-top-loader pins it
	   full-bleed at the notch-safe top edge of .np: top:env(safe-area-inset-top), left/right:0
	   (padding on .np does not offset an absolutely-positioned child's left/right:0, so it
	   spans the full width), z-index:60 sits above the cover and .bar (within the z-index:50
	   .np) yet below any modal. */
	/* Two-class selector so `top` wins over .np-prog's `top: 0` regardless of source order
	   (equal-specificity single-class rules would let the later .np-prog override it). */
	.np-top-loader.np-prog { top: env(safe-area-inset-top); z-index: 60; }
	.np-prog {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: rgba(255, 255, 255, 0.12);
	}
	.np-prog > i {
		display: block;
		height: 100%;
		background: var(--color-primary);
		transition: width 0.25s linear;
	}
	.np-prog.indet {
		overflow: hidden;
	}
	.np-prog.indet > i.sliver {
		width: 35%;
		transition: none;
		animation: np-indet 1.1s ease-in-out infinite;
	}
	@keyframes np-indet {
		0% {
			transform: translateX(-110%);
		}
		100% {
			transform: translateX(310%);
		}
	}
	/* quick-260809-mvz: no reduced-motion gate on this rail — same call as the Nowbar copy it mirrors.
	   The markup carries `.motion-always` (app.css's escape hatch) so the app's reduce-motion setting
	   cannot freeze it, and the OS-pref 2.2s slowdown is gone so it runs at one speed everywhere. */
	.bar { display: flex; align-items: center; justify-content: space-between; }
	.icon { background: none; border: none; color: var(--color-text); cursor: pointer; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; }
	.icon:hover { background: var(--color-surface-2); }
	/* The .np-top wrapper carries the drag-down gesture (slop-thresholded so clicks still
	   fire). touch-action: pan-x leaves horizontal scrolling intact (none here, but
	   defensive) while letting our pointer handlers own vertical motion. */
	.np-top { touch-action: pan-x; }
	.cover { position: relative; z-index: 1; width: min(72vw, 320px); height: auto; aspect-ratio: 1/1; margin: 4px auto; border-radius: 16px; overflow: hidden; background-size: cover; background-position: center; box-shadow: 0 18px 50px rgba(0,0,0,0.5); cursor: grab; transition: width 0.32s cubic-bezier(.22,1,.36,1), height 0.32s cubic-bezier(.22,1,.36,1), margin 0.32s cubic-bezier(.22,1,.36,1), border-radius 0.32s cubic-bezier(.22,1,.36,1); }
	.cover:active { cursor: grabbing; }
	/* NP-01 carousel: the rigid strip fills .cover and rests at translateX(0) (current cell visible).
	   The commit-settle uses the cover-reflow personality (0.32s, same universal curve); coverSwipe
	   overrides this to `none` while dragging (1:1 finger-follow), then restores it on release so the
	   committed neighbor / spring-back animates. will-change keeps the slide smooth. */
	.cover-strip { position: absolute; inset: 0; will-change: transform; transition: transform 0.32s cubic-bezier(.22,1,.36,1); }
	/* Each cell is exactly one cover wide and flush against its neighbors: prev is pushed one cover
	   width to the left (-100%), current fills the box (0), next is pushed one cover width to the
	   right (100%). Adjacent covers touch with no gutter between them.
	   The gutter is purely positional — it is revealed as the strip slides under the 1:1 finger-follow
	   (coverSwipe writes raw translateX(dx)); it never displaces the resting current cell at left:0, so
	   a committed neighbor still lands perfectly centered after the store re-derives the cells. No
	   parallax, no scale, no fade, no accent (UI-SPEC §1/§3). An absent neighbor → background-image
	   'none' (a blank edge during the rubber-band, which never commits anyway). */
	.cover-cell { position: absolute; top: 0; width: 100%; height: 100%; background-size: cover; background-position: center; }
	.cover-cell.prev { left: -100%; }
	.cover-cell.cur { left: 0; }
	.cover-cell.next { left: 100%; }
	/* plan 003: the current cell crossfades its art on a non-swipe track change / late resolve.
	   Two keyed .cover-img layers stack at inset:0 and dissolve; overflow:hidden clips them to
	   the cell so a mid-fade layer never bleeds over a neighbor. */
	.cover-cell.cur { overflow: hidden; }
	.cover-img { position: absolute; inset: 0; background-size: cover; background-position: center; }
	/* Reduced motion (OS pref OR the app's :root[data-reduce-motion] setting, app.css): the carousel
	   commit-settle / spring-back collapses to instant — the track still changes, only the slide
	   animation is removed (UI-SPEC §1 reduced-motion row). The action restores `transition` inline on
	   release; setting it to `none` here is overridden by that inline value during the active gesture
	   but applies to the resting strip so the post-swap repaint does not animate. */
	@media (prefers-reduced-motion: reduce) { .cover-strip { transition: none; } }
	:global(:root[data-reduce-motion]) .cover-strip { transition: none; }
	.meta { margin: 4px 2px 12px; transition: margin 0.32s cubic-bezier(.22,1,.36,1); display: flex; flex-direction: column; align-items: flex-start; gap: 0px; }
	/* Reflow (sheet half/full): cover becomes a full-bleed YT-Music banner that the
	   header overlaps at the top and the meta overlaps at the bottom. */
	.np.reflow .cover { width: auto; aspect-ratio: auto; height: 30vh; margin: 0 -18px; border-radius: 0; }
	.np.reflow .cover::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.35) 100%); }
	.np.reflow .bar { position: absolute; top: 0; left: 18px; right: 18px; z-index: 2; }
	.np.reflow .meta { position: relative; z-index: 2; margin-top: -42px; padding: 0 2px; }
	/* lw9-followup: .title is now a solid theme-coloured pill, no need for the legibility
	   text-shadow anymore. */

	/* mtv-followup: sheet FULL state → reuse the docked Nowbar as a sticky top bar. The
	   existing .bar/.cover/.meta/.prog/.transport are all hidden (Nowbar carries the same
	   information in a single compact row) and the sheet starts below the bar so the queue
	   never overlaps it. .fullshrink is a strict superset of .reflow so the overrides win. */
	.np.fullshrink .bar,
	.np.fullshrink .cover,
	.np.fullshrink .meta,
	.np.fullshrink .prog,
	.np.fullshrink .transport,
	.np.fullshrink .np-error { display: none; }
	/* The embedded Nowbar sits in static flow at the top of .np. Reserve viewport below it for
	   the absolute-positioned sheet so the top bar isn't painted over. The 76px = Nowbar height
	   (var(--nowbar-h)) + .np's own padding-top (8px); pinned numerically here because .np.fullshrink
	   adds no extra padding-top and the sheet is `position:absolute` with explicit inset. */
	.np.fullshrink .sheet.full { inset: calc(var(--nowbar-h) + 4px) 0 0 0; }
	/* .np.fullshrink :global(.nowbar.embed) { margin-bottom: 0px; } */
	/* Title + Artist sit on top of the album cover (.reflow mode), so they need a solid box to
	   stay legible against any cover. The box bg tracks the theme (`--color-bg` = near-black
	   in dark / near-white in light) and the text colour inverts to match (`--color-text`),
	   giving black-on-white in light theme + white-on-black in dark theme. `display: inline-block`
	   sizes the pill to the text instead of stretching across the column. */
	/* NP big title/artist use the dedicated --fs-np-* multipliers (separated from --fs-title /
	   --fs-artist used by list pages). The base sizes diverge enough that one shared slider
	   couldn't both raise the list rows AND keep NP balanced; two sliders solve it. */
	.title { display: inline-block; max-width: 100%; vertical-align: bottom; background: var(--color-bg); color: var(--color-text); padding: 1px; border-radius: none; font-size: calc(1.5rem * var(--fs-np-title, 1)); font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.artist { display: inline-block; max-width: 100%; vertical-align: bottom; background: var(--color-bg); border: none; padding: 1px; border-radius: none; color: var(--color-text); font-size: calc(1rem * var(--fs-np-artist, 1)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	/* quick-260625-pzs-01: per-artist tappable link inside the .artist row. Carries the underline +
	   pointer the old single .artist button had; the inert separator is non-interactive. */
	.artist-link { background: none; border: none; padding: 0; color: inherit; font: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
	.artist-sep { color: var(--color-text-muted); text-decoration: none; cursor: default; }
	/* quick-260831-k5y: small muted pill under the artist row. Sized off the NP artist scale so
	   it tracks the appearance settings, and always smaller than the artist line it sits below. */
	.quality-tag { display: inline-block; margin-top: 4px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--color-border); color: var(--color-text-muted); font-size: calc(0.7rem * var(--fs-np-artist, 1)); font-weight: 600; letter-spacing: 0.02em; line-height: 1.5; white-space: nowrap; }
	/* Marquee lives globally in app.css (transform-based .marquee-inner). The .title/.artist
	   clips above + the use:marquee action + inner .marquee-inner span in the markup are the
	   only per-file pieces — the global rule animates them. (gmy unified the drift.) */
	.np-error { color: #ff6b6b; font-size: 13px; text-align: center; margin: 2px 2px 10px; }
	.prog { margin: 4px 0; }
	/* plan 002: the seek rail is now the shared global `.scrubber` (app.css) driven by
	   use:scrub — the old local `.track`/`.fill`/`.knob` rules were removed. */
	/* plan 006: tabular-nums so the ticking current-time readout never jitters horizontally. */
	.times { display: flex; justify-content: space-between; font-size: 11px; color: var(--color-text-muted); margin-top: 4px; font-variant-numeric: tabular-nums; }
	.transport { display: flex; align-items: center; justify-content: space-between; margin: 10px 4px 22px; }
	.t { background: none; border: none; color: var(--color-text); cursor: pointer; opacity: 0.85; display: grid; place-items: center; }
	.t.on { color: var(--color-primary); opacity: 1; }
	.st-row { display: flex; justify-content: center; margin: 2px 4px 0; }
	.st-readout { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 13px; font-variant-numeric: tabular-nums; background: var(--color-surface); }
	.play { width: 62px; height: 62px; border-radius: 50%; border: none; background: #fff; color: #000; cursor: pointer; display: grid; place-items: center; }
	.sheet { display: flex; flex-direction: column; flex: 1; min-height: 0; will-change: transform; user-select: none; -webkit-user-select: none; }
	.sheet.full {
    /* position: absolute; */
    inset: 0;
    z-index: 5;
    background: var(--color-bg);
    padding: 4px 0px env(safe-area-inset-bottom);
		/* margin-top: 68px; */
	}

	/* Half-open: sheet occupies the real area below the transport row, no transform hack. */
	.sheet.half {
		/* position: absolute; */
		/* inset-top will be set via inline style using halfSheetTop() */
		inset: var(--sheet-half-top, 260px) 0 0 0;
		z-index: 5;
		background: var(--color-bg);
		padding: 0px 0px env(safe-area-inset-bottom);
		margin-top: 0px;
		box-sizing: border-box;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	/* Ensure the panel takes all available height in half/full so lyrics/queue scroll normally */
	.sheet.half .panel,
	.sheet.full .panel {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior-y: contain;
	}
	.grip { display: flex; justify-content: center; padding: 0px; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
	.grip:active { cursor: grabbing; }
	.handle { width: 44px; height: 5px; border-radius: 999px; background: var(--color-text-muted); opacity: 0.6; }
	.subnav { display: flex; justify-content: space-around; padding-bottom: 6px; touch-action: none; user-select: none; -webkit-user-select: none; }
	.subnav button { background: none; border: none; color: var(--color-text-muted); font-size: 13px; min-height: 40px; padding: 8px 12px; cursor: pointer; border-bottom: 2px solid transparent; }
	.subnav button.active { color: var(--color-text); border-bottom-color: var(--color-primary); }
	/* NP-02: contain over-scroll/bounce to the panel edges so half-open scroll never chains to
	   the page behind the sheet. NO touch-action: none — the panel keeps its pan-y scroll (the
	   browser owns vertical scrolling here). iOS <16 lacks overscroll-behavior support, so it is
	   best-effort there; no JS scroll-lock workaround is added in this phase. */
	/* quick-260615-mnr: disable CSS scroll-anchoring. The Up-Next queue is a keyed {#each}
	   on track.uid; every queue mutation (track advance moving the played song to history,
	   removeFromQueue, retryUnplayable, reorder) adds/removes/reorders rows ABOVE the fold,
	   changing height above the viewport. With the default `overflow-anchor: auto` the browser
	   re-pinned scroll to an anchor node — the visually-distinct `.row.playing` row — yanking it
	   back into view on every change so the user couldn't freely scroll the queue. The lyrics tab
	   does its own explicit `container.scrollTo(...)` (it never relies on anchoring), and the
	   related tab doesn't auto-scroll, so disabling anchoring here is safe for all three tabs. */
	.panel { flex: 1; overflow-y: auto; overscroll-behavior-y: contain; overflow-anchor: none; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 8px 6px; border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; }
	/* quick-260625-pzs-02: swipe-to-queue on the RELATED list only (mirrors search/+page.svelte:669-677).
	   The reveal spans sit BEHIND the row; the row's translateX (use:swipeAction) slides to expose the
	   correct side. The related .row is normally transparent, so it gets an opaque bg + z-index here so
	   the reveal stays masked at rest and clipped during travel. The Up-Next list (use:swipeRemove) is
	   untouched. */
	.related-swipe { position: relative; overflow: hidden; border-radius: 10px; }
	.related-swipe .reveal {
		position: absolute; top: 0; bottom: 0; width: 96px; display: flex; align-items: center;
		justify-content: center; color: #fff; pointer-events: none;
	}
	.related-swipe .reveal-queue { left: 0; color: var(--color-text-muted); }
	.related-swipe .reveal-next { right: 0; color: var(--color-text-muted); }
	.related-swipe .row { position: relative; z-index: 1; }
	/* MENU-03 / D-12: hover-capable devices only — touch otherwise latches this :hover
	   background on a queue/related row under a held finger while the track menu opens. */
	@media (hover: hover) { .row:hover { background: var(--color-surface); } }
	.row.playing { background: rgba(124,92,255,0.15); }
	/* Queue rows: play-button + far-right grip side by side. */
	.list li { display: flex; align-items: center; gap: 2px; }
	.q-row { flex: 1; min-width: 0; }
	/* quick-260629-nyl Task 1: Up-Next rows lay the lazy album-art thumbnail to the LEFT of a
	   min-width:0 text column so the title/artist still stack and ellipsis as before. Only the
	   Up-Next `.q-row` is switched to row-direction; the generic `.row` (related skeleton/list)
	   keeps its column layout untouched. The art dims with the row via `.q-row.skipped` (child). */
	.q-row { flex-direction: row; align-items: center; gap: 0; }
	/* Gap 4 (26-10): per-row version-picker trigger — a SIBLING of the .q-row button (never nested,
	   no button-in-button), its own ≥44px tap target mirroring search/+page.svelte's .ver. */
	.ver {
		flex: 0 0 auto; width: 44px; height: 44px; display: grid; place-items: center;
		background: none; border: none; border-radius: var(--radius-full, 999px);
		color: var(--color-text-muted); cursor: pointer;
	}
	@media (hover: hover) { .ver:hover { background: var(--color-surface); color: var(--color-text); } }
	.q-art { width: 36px; height: 36px; border-radius: 6px; background-size: cover; background-position: center; background-color: rgba(255,255,255,0.04); flex: none; margin-right: 8px; }
	.q-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
	.grip-handle { flex: 0 0 auto; background: none; border: none; color: var(--color-text-muted); opacity: 0.55; cursor: grab; touch-action: none; display: grid; place-items: center; padding: 8px 6px; border-radius: 8px; }
	.grip-handle:active { cursor: grabbing; opacity: 0.9; }
	.list li.lifted { position: relative; z-index: 2; opacity: 0.92; }
	.list li.lifted .q-row { background: var(--color-surface); box-shadow: 0 6px 18px rgba(0,0,0,0.4); }
	.list li.over .q-row { box-shadow: inset 0 2px 0 var(--color-primary); }
	.r-title { font-size: calc(14px * var(--fs-title, 1)); font-weight: 600; color: var(--color-text);}
	.r-artist { font-size: calc(12px * var(--fs-artist, 1)); color: var(--color-text-muted); }
	/* quick-260723: Related list rows go row-direction so RowBadges sit at the trailing edge; the
	   text stacks inside .r-meta. The shared `.row` (column) + its skeleton variant stay untouched. */
	.row.rel-row { flex-direction: row; align-items: center; gap: 8px; }
	.rel-row .r-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
	/* quick-260615-i9u (Feature A): a probe-confirmed-dead Up-Next row, dimmed + leading ✗. Tapping
	   it retries that exact track. Reuses existing design tokens (no new hardcoded colors). */
	.q-row.skipped { opacity: 0.45; }
	.r-skip { font-size: calc(12px * var(--fs-artist, 1)); font-weight: 600; color: var(--color-text-muted); margin-right: 6px; }
	/* Related-tab loading skeleton: placeholder rows mirror the real .row shape
	   (stacked title + artist bars) so the list keeps its size/shape while fetching.
	   Bars use the global `.sk` shimmer; reduce-motion handled there. */
	.row.skel { pointer-events: none; gap: 6px; }
	.row.skel .sk { display: block; }
	.row.skel .r-title { width: 55%; height: 14px; }
	.row.skel .r-artist { width: 38%; height: 12px; }
	/* Visually-hidden screen-reader cue for the skeleton list. */
	.vh { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
	/* Side padding gives the active line's transform: scale + bold weight room to grow
	   without bumping the parent's `overflow: hidden` clip. word-break/overflow-wrap force
	   even unbroken-character runs (CJK with no spaces, or long URLs) to wrap inside the
	   column instead of being clipped at the edges. */
	.lyrics { text-align: center; line-height: 1.3; }
	.lyrics p { font-size: calc(1rem * var(--fs-lyrics, 1)); color: var(--color-text-muted); transition: color 0.2s ease, transform 0.2s ease; margin: 0; white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
	.lyrics p.active { color: var(--color-text); font-weight: 700; }
	/* paren-derived sibling line — slightly smaller / lower contrast than the parent so the
	   reader can tell "this is the embedded-translation part" at a glance. */
	.lyrics p.paren { font-size: calc(0.9rem * var(--fs-lyrics, 1)); opacity: 0.85; }
	.lyrics .tr { display: block; font-size: 0.82em; font-weight: 400; color: var(--color-text-muted); margin-top: 2px; }
	/* quick-260618-t7p Task 3: the per-line translation inside an active line is a CHILD .tr span, so
	   .lyrics p.active (which only restyles the <p>'s own color/weight) does not reach it and the base
	   .lyrics .tr pins a muted color/weight 400 — the translation stayed un-highlighted while its parent
	   line was active. Mirror the active-line emphasis (same tokens as .lyrics p.active) so the active
	   moment's translation reads as highlighted in lockstep with the original. */
	.lyrics .tr.active { color: var(--color-text); font-weight: 700; }
	/* D-11/LYR-03: end spacer — height is set inline from spacerH (≈ half the visible band) so the
	   last lines can reach the vertical center. flex-shrink:0 keeps it from collapsing inside the
	   flex column. */
	.tr-hint { text-align: center; font-size: 11px; color: var(--color-primary); margin: 0 0 6px; }
	.empty { color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 24px; }
</style>
