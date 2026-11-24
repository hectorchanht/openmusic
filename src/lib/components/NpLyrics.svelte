<script module lang="ts">
	import { scrollBehavior } from '$lib/motion';
	// quick-260625-pzs-03: module-scoped (NOT per-instance) cache of COMPLETE lyric translations,
	// keyed by the SAME `key` string the translate $effect computes (`${uid}:${lang}:${n}:${skip}`).
	// Living at module scope means it survives a component remount / re-subscribe, so blurring and
	// refocusing the tab (which resets the per-instance plain `trKey = ''`) re-hydrates the cached
	// translation synchronously instead of re-issuing /api/translate. Only COMPLETE renders are
	// stored (T-pzs-01) — a soft-fail echo (translateLinesEx complete:false) is never frozen.
	//
	// quick-260919-np3: module scope matters MORE after the pane split — switching tabs on mobile now
	// unmounts this component outright, so every tab round-trip would otherwise re-issue the whole
	// batch. The cache absorbs that; the miss path is unchanged.
	const trCache = new Map<string, string[]>();
</script>

<script lang="ts">
	import { settings, effectiveTarget } from '$lib/stores/settings.svelte';
	import LoadingState from '$lib/components/LoadingState.svelte';
	import LyricsEditor from '$lib/components/LyricsEditor.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { player } from '$lib/stores/player.svelte';
	import { t } from '$lib/i18n';
	import { translateLinesEx, peekLineTranslation, bustLyricsTranslation } from '$lib/services/translate';
	// quick-261116-kvprog: pure chunk arithmetic for the progressive translation below.
	// quick-261116-lyrux: + the per-line pending arithmetic (Fix 1) and skeleton widths.
	// quick-261121-trfix: + applyUniqueChunkFlags (the genuine-flag stitch).
	import { chunkRanges, dedupeSendList, applyUniqueChunkResult, applyUniqueChunkFlags, initialPending, clearUniqueChunkPending, skeletonWidthPct, LYRICS_CHUNK_SIZE, LYRICS_CHUNK_CONCURRENCY } from '$lib/services/lyric-chunks';
	import { shouldTranslate, majorityLang } from '$lib/i18n/detect';
	import { reorderPairs, splitParenLines, serializeLRC, lineSeekFraction, activeLineAt, lineEndAt, lyricAnchorMetrics, formatLyricOffset, LYRIC_OFFSET_MAX, type LyricLine } from '$lib/services/lrc';
	// quick-261123-lyricspin: the pure middle-pin scroll-target maths (see lyric-center.ts).
	import { centeredScrollTop } from '$lib/services/lyric-center';
	import { charSpansFor, charFillAt, groupCharSpansBySurfaces, type TimedChar } from '$lib/services/lyric-chars';
	// quick-261116-lyrux (Fix 2): the publication seam the Nowbar reads for replace mode.
	import { lyricsTranslation, translationDuplicatesOriginal } from '$lib/stores/lyrics-translation.svelte';
	// quick-260919-2jo: the Chinese script lock for lyric text. `parseLyrics` replaces `parseLRC`
	// (the ORIGINAL lines); `lockLyricLines` covers the translation column, which is a SECOND source
	// of source-derived text produced after parse time.
	import { parseLyrics, lockLyricLines } from '$lib/stores/lyric-script.svelte';
	// quick-260919-1we (D-4): the user's explicit lyric pick, layered into a reactive READ so it
	// outranks whatever the chain (or a downloaded file's embedded tag) supplied.
	import { readLyrics } from '$lib/stores/lyric-pins.svelte';
	import { communityLyrics } from '$lib/stores/community-lyrics.svelte';
	// quick-260926-mis: per-song lyric TIME offset (±0.5s nudges; quick-260926-vur: + a slider).
	// quick-260926-mzn: + the shared listener consensus (effective read, fetch, vote, reset).
	import {
		setLyricOffset,
		getEffectiveLyricOffset,
		isSharedLyricOffset,
		ensureSharedLyricOffset,
		scheduleLyricOffsetVote,
		resetLyricOffset,
		lyricOffsetVersion,
		lyricSyncOpen,
		setLyricSyncOpen
	} from '$lib/stores/lyric-offset.svelte';
	import { Check, X } from '@lucide/svelte';
	// quick-261120-furi: furigana — the local finite-table readings engine
	// (services/furigana) + the user's per-song reading pins (Addendum 6).
	import { annotateLine, ensureFuriganaTables, hasKana, type FuriganaTables } from '$lib/services/furigana';
	import { applyFuriganaPins, pinReading, type PinnedFuriganaSpan } from '$lib/stores/furigana-pins.svelte';
	import { holdStep, pointerHoldEvent, HOLD_IDLE, type HoldEvent, type HoldState } from '$lib/services/lyric-hold';

	// quick-260919-np3: the lyrics pane, lifted OUT of NowPlaying.svelte verbatim. The ONLY semantic
	// edit is that both `tab === 'lyrics'` gates (auto-scroll anchor + translation) became the MOUNT —
	// the parent renders this component exactly when that tab is selected (mobile) or always, as the
	// middle column, at >=1280px. `sheetState` is the one piece of parent state the anchor maths
	// genuinely needs (the visible band differs per mode), so it arrives as a prop.
	let { sheetState }: { sheetState: 'closed' | 'half' | 'full' } = $props();

	// ---- lyrics ----
	// Lyrics pipeline: parse the LRC, then split any line carrying a `(...)` clause into its
	// own entry so each part (main text + parenthesised clause) flows through the per-line
	// translate path independently. The split entries carry `fromParen:true` so the renderer
	// can suppress their translations when settings.lyricsHideParenTranslation is on.
	//
	// quick-260919-1we (D-4): the SOURCE of this pipeline is `readLyrics(player.current)`, not
	// `player.current.lrc`. That one read is what makes a user's explicit pick in the Fix-lyrics
	// picker beat everything else, INCLUDING Phase 37's embedded-LRC enrichment for a downloaded
	// file — `enrichFromLocalFile` writes `current.lrc`, and `current.lrc` is only the SECOND rung
	// of readLyrics' pin → track.lrc → null order. It is also what repaints this pane the instant a
	// pick lands (readLyrics takes the lyricVersion() dependency), with no replay and no player call.
	//
	// quick-260919-2jo: `parseLyrics` = parseLRC + the Chinese script lock, so the pane repaints in
	// the locked script the instant the setting flips — mid-song, lyrics open, no reload. The lock
	// runs FIRST, before reorderPairs / splitParenLines, and that is safe by construction: both of
	// those decide on `dominantScript`, and an s2t/t2s conversion is Han→Han (it never changes a
	// line's script class) and never touches the bracket characters splitParenLines matches on.
	const lines = $derived<LyricLine[]>(
		(() => {
			const src = readLyrics(player.current);
			return src ? splitParenLines(reorderPairs(parseLyrics(src))) : [];
		})()
	);
	// quick-261019-lyrspin: while the track is still resolving (player.loading) or a lyric
	// backfill walk is in flight for it (player.lyricsFetching), an empty pane means "not yet",
	// not "none" — the template shows the spinner instead of the no-lyrics line.
	// quick-261122-ugcb3: a community fetch in flight for a no-upstream song is still "not yet",
	// not "no lyrics" — the skeleton holds until the community rung answers.
	const lyricsPending = $derived(
		player.loading || player.lyricsFetching || communityLyrics.isLoading(player.current?.uid)
	);
	// When multiple lyric lines share a timestamp (common in CN LRCs that ship the original
	// + an inline translation as two consecutive entries at the same time, plus our own
	// splitParenLines parent + paren clauses), ALL of them are simultaneously active for
	// the user — they're the same moment of the song. `activeLine` is the FIRST entry of
	// that group (used as the scroll anchor); `activeTime` is the shared timestamp so the
	// renderer can mark every sibling line active via `lines[i].time === activeTime`.
	//
	// quick-260919-1we: the scan itself now lives in `lrc.ts` (`activeLineAt`) so the Nowbar's
	// one-line variant runs the IDENTICAL code instead of a second copy that could drift. This is a
	// dedupe, not a change — `activeLine` / `activeTime` keep their names and meanings, so every
	// downstream consumer (the scroll anchor, the sibling-active test) is untouched.
	//
	// quick-260926-mis: `lyricOffset` is a $derived so the localStorage read happens once per track
	// change / offset write, NOT per timeupdate. activeLineAt still returns the line's OWN time, so
	// activeLine / activeTime and every consumer below are unchanged.
	//
	// quick-260926-mzn: the EFFECTIVE offset (local ?? listeners' consensus ?? 0). Nudges below add
	// to it, so nudging from a shared value adjusts the listeners' alignment and makes it local.
	const lyricOffset = $derived(getEffectiveLyricOffset(player.current?.uid));
	const offsetShared = $derived(isSharedLyricOffset(player.current?.uid));
	// quick-260926-mzn: ask for the listeners' consensus for this song's exact lyrics. Reads
	// player.current / lyricVersion (via readLyrics) / lyricOffsetVersion — the last so clearing a
	// local offset re-runs this and the shared value is fetched. ensureSharedLyricOffset writes NO
	// $state synchronously (only `_shared`, after its awaits, which this effect never reads), so it
	// is NOT the self-invalidating class that froze the app (restore-effect loop).
	$effect(() => {
		lyricOffsetVersion();
		const uid = player.current?.uid;
		const src = readLyrics(player.current);
		if (uid && src) ensureSharedLyricOffset(uid, src);
	});
	const active = $derived(activeLineAt(lines, player.currentTime, lyricOffset));
	const activeLine = $derived(active.idx);
	const activeTime = $derived(active.time);
	// quick-261122-ugcb4 — THE PER-CHARACTER HIGHLIGHT (B4, brief §2.4 + the two-surfaces rule,
	// Hector 2026-11-20 20:31): the NowPlaying pane shows EXACTLY which character is being sung —
	// the exquisite surface (the Nowbar keeps its one simple underline). Every sung line of the
	// active group renders per-character spans from charSpansFor: the user's hand-set timings when
	// the line carries them, else the equal-share PRE-ALLOCATION — so every lyric, upstream or
	// community, sweeps character by character from day one. Translation lines are not sung and
	// keep the plain line treatment.
	//
	// Cost discipline: this map changes per LINE (activeTime), never per tick; the per-frame fill
	// is written straight onto the spans' `--p` by the rAF loop below (the Nowbar underline idiom),
	// so nothing reactive runs at 60Hz and only the active line's handful of spans are touched.
	const activeChars = $derived.by(() => {
		const m = new Map<number, TimedChar[]>();
		if (activeTime < 0) return m;
		for (let i = 0; i < lines.length; i++) {
			const l = lines[i];
			if (l.time !== activeTime || l.fromParen || l.isTranslation) continue;
			m.set(i, charSpansFor(l, lineEndAt(lines, i, player.duration)));
		}
		return m;
	});
	let lyricsEl = $state<HTMLElement | null>(null);
	$effect(() => {
		const root = lyricsEl;
		if (!root || activeChars.size === 0) return;
		const off = lyricOffset;
		void activeChars; // re-collect the span nodes when the active line changes
		let els: HTMLElement[] = [];
		let raf = 0;
		const paint = () => {
			if (!els.length || !els[0].isConnected) els = Array.from(root.querySelectorAll<HTMLElement>('.ch'));
			const clock = player.liveTime() - off;
			for (const el of els) {
				const st = Number(el.dataset.s);
				const en = Number(el.dataset.e);
				el.style.setProperty('--p', String(charFillAt({ text: '', start: st, end: en }, clock)));
			}
		};
		if (!player.playing) {
			void player.currentTime;
			queueMicrotask(paint);
			return;
		}
		const loop = () => {
			paint();
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});
	let autoScroll = $state(true);
	// quick-260920-n6j: last padding written to `.lyrics`, as the exact CSS strings. Plain `let`s, not
	// $state — nothing reactive reads them; they only stop the anchor pass from rewriting an unchanged
	// value. Instance-scoped (NOT module-scoped like `trCache`) on purpose: a remount hands us a FRESH
	// element with no padding, and a surviving guard would skip re-applying it.
	let lastPadTop = '';
	let lastPadBottom = '';
	// quick-261123-lyricspin: the line-set key (`uid:lineCount`) whose INITIAL anchor has
	// already landed, plus when it landed. Plain fields (nothing renders them). The first
	// anchor for a fresh line set — lyrics finishing loading mid-playback, or a new track —
	// must be INSTANT, so the pane LANDS with the current active line at the middle instead
	// of rendering top-anchored and then gliding/jumping there. Later line changes glide.
	let initialAnchorKey = '';
	let initialAnchorAt = 0;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	// D-10/LYR-02: how long after manual scrolling STOPS before auto-scroll resumes. Raised from
	// the old 600ms (which snapped the view back mid-read) to ~3s.
	const RESUME_MS = 3000;
	// quick-260926-vur: hold/resume for auto-centre — pause WHILE a finger (or mouse button) is down,
	// resume RESUME_MS after the real release, momentum included. The old pointer-only tracking took
	// `pointercancel` as the lift, but Android/iOS fire it the moment a touch becomes a native scroll
	// with the finger still down, so the view snapped back mid-peek. Touches now go through touch
	// events (they keep firing through the scroll takeover); decisions live in services/lyric-hold.ts.
	// `hold` is a PLAIN field (nothing renders it); `autoScroll` stays $state for the anchor $effect.
	let hold: HoldState = HOLD_IDLE;
	function dispatch(e: HoldEvent) {
		const r = holdStep(hold, e);
		hold = r.state;
		if (r.action === 'none') return;
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = null;
		if (r.action === 'resume') {
			autoScroll = true;
			return;
		}
		autoScroll = false;
		if (r.action === 'arm') idleTimer = setTimeout(() => dispatch({ type: 'tick' }), RESUME_MS);
	}
	// Mouse only — pointerHoldEvent returns null for touch/pen, which the touch handlers own. The
	// window CAPTURE listeners catch a release outside the pane (a mouse has no scroll takeover, so
	// its pointercancel really is the end of the press).
	function lyricsPointerDown(e: PointerEvent) {
		const ev = pointerHoldEvent(e.pointerType, true);
		if (!ev) return;
		dispatch(ev);
		window.addEventListener('pointerup', windowMouseUp, { capture: true });
		window.addEventListener('pointercancel', windowMouseUp, { capture: true });
	}
	function windowMouseUp(e: PointerEvent) {
		const ev = pointerHoldEvent(e.pointerType, false);
		if (!ev) return; // a touch pointer lifting elsewhere is not this mouse press ending
		dispatch(ev);
		removeMouseListeners();
	}
	function removeMouseListeners() {
		window.removeEventListener('pointerup', windowMouseUp, { capture: true });
		window.removeEventListener('pointercancel', windowMouseUp, { capture: true });
	}
	// `e.touches` is the set REMAINING after the event, so a lift reads 0. Never preventDefault —
	// the pane must keep native scrolling (Svelte registers touchstart passive anyway).
	function lyricsTouch(e: TouchEvent) {
		dispatch({ type: 'touch', touches: e.touches.length });
	}
	// quick-260926-vur: `scroll` does not bubble and `.lyrics` never scrolls itself — the scroller is
	// the parent's `.panel` — so an `onscroll` on `.lyrics` never fired and the momentum re-arm
	// (Pitfall 1 / D-10: iOS keeps scrolling with no touch event after the lift) was dead. Listen on
	// the real scroller. The anchor pass's own smooth scroll lands here too and is a no-op while idle.
	$effect(() => {
		const panel = lyricsEl?.closest('.panel');
		if (!panel) return;
		const onScroll = () => dispatch({ type: 'scroll' });
		panel.addEventListener('scroll', onScroll, { passive: true });
		return () => panel.removeEventListener('scroll', onScroll);
	});
	// An unmount mid-hold leaks no timer and no window listener.
	$effect(() => () => {
		if (idleTimer) clearTimeout(idleTimer);
		removeMouseListeners();
	});
	// D-01/D-02/D-03: tap any lyric line to seek there. seekFraction is the only seek API and
	// already auto-plays when paused (D-03 free — no explicit play()). lineSeekFraction guards
	// duration <= 0 / non-finite → null, so no unbounded value reaches the audio element.
	// After seeking, 'force' clears the idle timer and turns autoScroll back on (D-02): this overrides
	// the suspend this tap's OWN touch/mouse press just set, so the anchor $effect re-runs on the
	// autoScroll flip and smooth-centers the now-active (tapped) line immediately.
	function seekToLine(line: LyricLine) {
		// quick-260926-mis: a realigned line seeks to where it is actually sung (line.time + offset).
		const frac = lineSeekFraction(line.time, player.duration, lyricOffset);
		if (frac !== null) player.seekFraction(frac); // D-03: auto-plays if paused
		dispatch({ type: 'force' });
	}
	// quick-260926-vur: the timing slider's half-range, a per-track RATCHET (±60 s by default, which
	// covers 20-40 s live intros; wider only for a larger offset from ±0.5 s taps or the listeners'
	// consensus). It only ever WIDENS within a track: if `max` shrank mid-drag the browser would re-map
	// the thumb's x to a new value under the finger (offset 70 → range ±120 → drag to 59.9 → range ±60
	// → value jumps to ~30). `rangeFor` is a plain field — only this derived reads it.
	let rangeFor = { uid: '', r: 60 };
	const sliderRange = $derived.by(() => {
		const uid = player.current?.uid ?? '';
		const need = Math.min(LYRIC_OFFSET_MAX, Math.max(60, Math.ceil(Math.abs(lyricOffset) / 60) * 60));
		if (rangeFor.uid !== uid) rangeFor = { uid, r: need };
		else if (need > rangeFor.r) rangeFor.r = need;
		return rangeFor.r;
	});
	// quick-260926-vur: the slider replaced hold-to-sync (the long-press fought hold-to-peek). Live:
	// activeLineAt already reads `lyricOffset`, and 'force' turns auto-centre on so the highlighted
	// line re-centres while dragging. The store normalizes (0.1 s, ±LYRIC_OFFSET_MAX); the vote is only
	// MARKED here and sent once at the end of the song / track change (quick-260926-wdv), so only the
	// final value of the listen is voted.
	function slideOffset(v: number) {
		const uid = player.current?.uid;
		if (!uid || !Number.isFinite(v)) return;
		setLyricOffset(uid, v);
		scheduleLyricOffsetVote(uid, readLyrics(player.current) ?? '');
		dispatch({ type: 'force' });
	}
	function nudgeOffset(delta: number) {
		const uid = player.current?.uid;
		if (!uid) return;
		setLyricOffset(uid, lyricOffset + delta);
		// quick-260926-mzn: a burst of nudges votes once, with the final value.
		scheduleLyricOffsetVote(uid, readLyrics(player.current) ?? '');
	}
	// quick-260926-mzn: local -> back to the listeners' value (or 0); shared-only -> explicit 0.
	// Never votes; cancels a pending vote. Semantics documented on resetLyricOffset.
	function resetOffset() {
		const uid = player.current?.uid;
		if (uid) resetLyricOffset(uid);
	}
	// Keyboard parity for the tappable lyric line is ENTER ONLY (plus Up/Down walking below) —
	// mirrors the cover's tapCoverKey and the grip's gripKey idiom, satisfying the a11y
	// click-needs-keydown rule. Space is NOT handled here: Space always means play/pause
	// app-wide (Hector 2026-11-22, transport-keys invariant 2).
	function seekToLineKey(e: KeyboardEvent, line: LyricLine) {
		// quick-261102-t5k: Up/Down walk the lines (the group is ONE tab stop now, see `focusIdx`).
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			const ps = [...(lyricsEl?.querySelectorAll<HTMLElement>('p[data-i]') ?? [])];
			const at = ps.indexOf(e.currentTarget as HTMLElement);
			const to = ps[at + (e.key === 'ArrowDown' ? 1 : -1)];
			if (to) {
				e.preventDefault();
				to.focus();
			}
			return;
		}
		if (e.key !== 'Enter') return;
		e.preventDefault();
		seekToLine(line);
	}
	// quick-260919-npfix (Fix 3): the anchoring body is now a NAMED function so it can run twice per
	// effect pass — once immediately, once after the sheet's reflow settles. See the $effect below.
	// Every reactive value it needs is read at the TOP, before any early return, so a synchronous
	// call from the effect registers all of them as dependencies (a call made from the deferred
	// timer registers nothing, which is what we want).
	function anchorActiveLine() {
		const idx = activeLine;
		// sheetState is a read dependency: re-anchor the active line whenever the sheet
		// changes mode (closed/half/full) while the same line stays active.
		// quick-260919-np3: the old `tab !== 'lyrics'` gate is GONE because it is now the mount —
		// this component only exists while the lyrics tab is selected (mobile) or as the middle
		// column at >=1280px. Same condition, expressed structurally.
		void sheetState;
		// quick-260926-m72: the phone-closed pin-to-top special case is GONE — the user wants the
		// active line centred in every sheet state (closed / half / full, phone and desktop), and the
		// centre is now the default of a configurable offset (settings.lyricsAnchor, percent of the
		// visible band). Read here, at the top, so the $effect re-anchors live when the Appearance
		// slider moves.
		// quick-261123-lyricspin (Hector 2026-11-23 21:36, real-device report): the middle-pin is
		// now an INVARIANT of this pane, not a preference — the active line is pinned at the
		// vertical middle (50%) at all times, so the anchor is fixed at 50 here regardless of
		// the stored Appearance value.
		const anchorPct = 50;
		// quick-261123-lyricspin: read the line-set identity at the TOP (before any return) so
		// the anchor $effect re-runs the moment a fresh line set renders — lyrics finishing
		// loading mid-playback must anchor in THAT pass, at the then-current active line.
		const anchorKey = `${player.current?.uid ?? ''}:${lines.length}`;
		// quick-260926-qat: the timing row's height enters/leaves `syncH` when it toggles, so the
		// effect must re-anchor on the flag; read at the top so the synchronous pass registers it.
		lyricSyncOpen();
		if (!autoScroll || idx < 0 || !lyricsEl) return;
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
		// Every early return is ABOVE this point: an empty, paused-autoScroll or manually-scrolled
		// pane never reaches the padding write below, so it never carries stray blank space.
		const cRect = container.getBoundingClientRect();
		// Anchor depends on the sheet mode. In HALF the sheet is position:absolute;inset:0 then
		// translated DOWN by halfOffset, so container.clientHeight spans the full viewport while only
		// the slice between the container top and the viewport bottom is actually VISIBLE. Centering on
		// clientHeight/2 would land below the visible fold (the reported "near the bottom" bug). So derive
		// the anchor from the live VISIBLE band (rect intersect viewport), which self-corrects for every mode:
		//   every mode -> settings.lyricsAnchor percent of the visible band
		const vh = typeof window !== 'undefined' ? window.innerHeight : cRect.bottom;
		// quick-260926-mis: the sticky `.sync` row permanently covers the scroller's top, so the usable
		// band starts below it — otherwise a low settings.lyricsAnchor parks the active line UNDER the
		// row. A plain DOM read (no $state), so this pass still writes nothing reactive.
		const syncH = container.querySelector<HTMLElement>('.sync')?.offsetHeight ?? 0;
		const visTop = Math.max(cRect.top + syncH, 0);
		const visBottom = Math.min(cRect.bottom, vh);
		const visHeight = Math.max(0, visBottom - visTop);
		const visTopWithin = visTop - cRect.top; // visible-band top, in container-local coords
		const { anchorWithin, padTop, padBottom } = lyricAnchorMetrics({
			visTopWithin,
			visHeight,
			clientHeight: container.clientHeight,
			lineHeight: el.offsetHeight,
			anchorPct
		});
		// quick-260920-n6j: the padding upgrade path the old ceiling comment named — TAKEN. The browser
		// clamps scrollTop to [0, scrollHeight - clientHeight], so without blank space beyond the head
		// and tail of the lyric those lines could never reach the anchor. Head pad = the anchor offset
		// (line 1 lands on the anchor at scrollTop 0); tail pad = clientHeight - anchor - line (the last
		// line lands on it at max scroll). Both are derived from the LIVE anchor.
		// Write only on CHANGE: padding shifts `offsetWithin`, and an unconditional write would
		// invalidate layout on every anchor pass (~4 Hz, once per timeupdate).
		const topPx = `${padTop}px`;
		const bottomPx = `${padBottom}px`;
		if (topPx !== lastPadTop) {
			lyricsEl.style.paddingTop = topPx;
			lastPadTop = topPx;
		}
		if (bottomPx !== lastPadBottom) {
			lyricsEl.style.paddingBottom = bottomPx;
			lastPadBottom = bottomPx;
		}
		// ONLY NOW measure the line: the padding above just moved it. `cRect` stays valid — inner
		// padding does not move the bounded `.panel` scroller's own rect.
		const elRect = el.getBoundingClientRect();
		const offsetWithin = elRect.top - cRect.top + container.scrollTop; // line top in container scroll-space
		// quick-261123-lyricspin: the middle-pin target — the line's CENTRE on the visible
		// band's CENTRE, clamped to the scrollable range (centeredScrollTop, lyric-center.ts).
		// At the fixed 50% anchor this equals `offsetWithin - anchorWithin`; the helper form
		// is the tested invariant, and anchorWithin still drives the head/tail padding above.
		void anchorWithin;
		const target = centeredScrollTop({
			lineTop: offsetWithin,
			lineHeight: el.offsetHeight,
			viewportHeight: visHeight,
			viewportTopOffset: visTopWithin,
			maxScrollTop: container.scrollHeight - container.clientHeight
		});
		// quick-261123-lyricspin: the FIRST anchor for a fresh line set is INSTANT ('auto') —
		// the pane lands with the current active line already at the middle, with no
		// top-anchored render and no visible glide/jump afterwards. The settle re-anchor
		// inside the same window is instant too (it corrects the same landing). Every
		// later line change glides as before.
		const isInitial = anchorKey !== initialAnchorKey || Date.now() - initialAnchorAt < REFLOW_SETTLE_MS + 50;
		if (anchorKey !== initialAnchorKey) {
			initialAnchorKey = anchorKey;
			initialAnchorAt = Date.now();
		}
		// quick-261102-s5t: reduce motion (app flag OR OS) jumps instead of gliding. Read here, after
		// the early returns, so it is not a dependency of the anchor effect.
		// quick-261102-u4t: the ONE reduce-motion decision ($lib/motion), not an inline copy.
		container.scrollTo({ top: target, behavior: isInitial ? 'auto' : scrollBehavior() });
	}

	// quick-260919-npfix (Fix 3): how long to wait before re-anchoring after a sheet-state change.
	// The sheet's own transform/inset transition is 0.28s and the `.np.reflow` cover reflow above it
	// is 0.32s, both on the shared cubic-bezier(.22,1,.36,1); 340ms clears the slower of the two.
	// Same number, and the same reason, as the parent's measureOffsets() settle fallback.
	const REFLOW_SETTLE_MS = 340;

	$effect(() => {
		// Immediate pass — also what registers this effect's dependencies (activeLine, autoScroll,
		// lyricsEl, sheetState, settings.lyricsAnchor are all read at the top of anchorActiveLine
		// before any return).
		anchorActiveLine();
		// SETTLE PASS — the missing half of "centred all the time". sheetState flips SYNCHRONOUSLY,
		// so the immediate pass above measures the container while the sheet + cover are still
		// mid-transition and scrolls to a target that is already stale by the time they land. Measured
		// on main at 1440x900, with the same line active throughout: closed -129px off the visible
		// centre (the top-pin, by design), half -118px, full -281px — and full stayed -281px four
		// seconds later, because nothing re-ran. One deferred re-anchor fixes all of them.
		// Safe to re-arm on every pass: it is a plain clearTimeout/setTimeout pair, and
		// anchorActiveLine is idempotent (offsetWithin is scroll-position-independent, so recomputing
		// mid-smooth-scroll yields the same target) and writes NO $state — the scrollTo it issues only
		// reaches the 'scroll' dispatch, which no-ops while not suspended. So this cannot become the
		// self-invalidating effect class that froze the app before.
		const settle = setTimeout(anchorActiveLine, REFLOW_SETTLE_MS);
		return () => clearTimeout(settle);
	});

	// ---- lyrics translation ----
	let translated = $state<string[]>([]);
	let translating = $state(false);
	// quick-261116-lyrux (Fix 1): per-line PENDING flags aligned to `lines` — a sent
	// line whose chunk has not settled yet. Drives the show-below skeleton and the
	// replace-mode inline spinner in the template, and is published with the
	// translation (Fix 2) so the Nowbar never serves a placeholder as a translation.
	let trPending = $state<boolean[]>([]);
	// quick-261121-trfix: per-line GENUINE flags aligned to `lines` — true only
	// where the slot holds a real translation (a settled chunk flagged the line
	// genuine, or the line cache seeded it). A SENT line that settled with flag
	// false is an ECHO: its slot holds the original, and the template must never
	// present it as a translation (below mode renders no .tr span for it at all).
	let trGenuine = $state<boolean[]>([]);
	// quick-261121-trfix: which positions the current run actually SENT to the
	// pipeline, aligned to `lines`. Pass-through positions (per-line skip /
	// already in the target) hold their original by construction — they are
	// neither genuine nor echoes.
	let trSent = $state<boolean[]>([]);
	// quick-261121-trfix: the last run settled with NO genuine line at all — the
	// pane shows the quiet unavailable/retry row instead of a fake translation.
	let trUnavailable = $state(false);
	// quick-261121-trfix: the last force-refresh request this instance consumed
	// (stores/lyrics-translation.svelte.ts requestRetranslate). Plain let — it is
	// compared inside the effect, never rendered.
	let lastRetranslateSeq = 0;
	// quick-261121-trfix: run GENERATION. The pre-trfix staleness guard compared
	// only the run key — sufficient while a key could never re-enter (the
	// trKey===key early return), but a force run deliberately re-enters the SAME
	// key, and the skip gate can supersede an in-flight run under the same key
	// too. Every new run (and the gate) bumps the generation; a worker whose
	// captured generation is no longer current is stale, whatever the key says.
	let trRunGen = 0;
	// The effective target of the CURRENT run, for the Fix 2 publish + Fix 3 file
	// sync. PLAIN let (not $state): written only by the translate effect below, read
	// by the publish effect after `translated` changes — a lang change always comes
	// with a fresh run, so the value is never stale at publish time.
	let trLang = '';
	let trKey = '';
	$effect(() => {
		// ju0: lyricsLang now allows 'auto' (→ appLang). Resolve once here so both the
		// rerun key, shouldTranslate(), and translateLines() all see the SAME final token.
		const rawLang = settings.lyricsLang;
		const lang = effectiveTarget(rawLang);
		trLang = lang;
		const skip = settings.lyricsSkip;
		const t = player.current;
		const n = lines.length;
		// quick-261116-lyrux: the exact lines array THIS run translates (the derived's
		// snapshot at effect time) — the Fix 3 LRC rebuild must use these, not whatever
		// the derived holds when the last chunk lands.
		const srcLines = lines;
		// quick-261121-trfix: a FORCE-REFRESH request for THIS track + target (sent
		// through the store by the Lyrics settings sheet or the pane's own retry /
		// re-translate rows) turns this pass into a force run even when the key is
		// unchanged: the pane freeze is dropped, the line-cache seed is skipped,
		// and each chunk busts its client caches before re-calling the pipeline.
		// Reading retranslateSeq here is what re-runs this effect when a request
		// lands; a request for another track/target is ignored, never consumed.
		const rtSeq = lyricsTranslation.retranslateSeq;
		const forceRun =
			rtSeq !== lastRetranslateSeq &&
			lyricsTranslation.retranslateUid === (t?.uid ?? '') &&
			lyricsTranslation.retranslateLang === lang;
		if (forceRun) lastRetranslateSeq = rtSeq;
		// quick-260919-np3: `tab !== 'lyrics'` dropped — the mount is that gate now (see above).
		if (rawLang === 'off' || !n || !t) {
			// quick-260618-fiz Fix 1: flipping INTO a no-translate state (lyricsLang → 'off', leaving
			// the lyrics tab, or losing the track/lines) must drop any stale translations immediately
			// rather than leaving the previous song's output rendered until the next translate round.
			// Reset trKey too so re-entering the active state re-runs the translation from scratch.
			if (translated.length) translated = [];
			if (translating) translating = false;
			if (trPending.length) trPending = [];
			if (trGenuine.length) trGenuine = [];
			if (trSent.length) trSent = [];
			trUnavailable = false;
			trKey = '';
			return;
		}
		// Per-line whitelist: only the lines whose detected source is NOT whitelisted (and
		// is not already in the target) get sent to /api/translate. Skipped lines keep
		// their ORIGINAL text in the corresponding output slot so index alignment +
		// showTr/translateMode (below/replace) render unchanged. Include skip in the key so
		// toggling the whitelist re-runs the effect.
		const key = `${t.uid}:${lang}:${n}:${skip.slice().sort().join(',')}`;
		if (trKey === key && !forceRun) return;
		// quick-261121-trfix (Hector 2026-11-21 00:48): WHOLE-SONG SKIP PRE-GATE —
		// ahead of the cache serve and ahead of ANY fetch. When the song's majority
		// source language (detectLang over the parsed lines; the track stores no
		// language) is on the user's skip list, translation never runs for this
		// song at all: zero translateLinesEx calls, originals only in both modes.
		// A mixed song (no majority) falls through to the per-line whitelist below.
		const songLang = majorityLang(srcLines.map((l) => l.text));
		if (songLang !== null && skip.includes(songLang)) {
			trRunGen++; // supersede any in-flight run for this key (see trRunGen)
			trKey = key;
			if (translated.length) translated = [];
			translating = false;
			trPending = [];
			trGenuine = [];
			trSent = [];
			trUnavailable = false;
			// Publish nothing for a gated song — drop any stale snapshot so the
			// Nowbar cannot serve a previous run's column for this track.
			lyricsTranslation.clear();
			return;
		}
		const sendIdx: number[] = [];
		const sendText: string[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (shouldTranslate(lines[i].text, lang, skip)) {
				sendIdx.push(i);
				sendText.push(lines[i].text);
			}
		}
		const sendSet = new Set(sendIdx);
		if (forceRun) {
			// The user rejected this song+target's cached translation: drop the
			// pane-level freeze for the key; the workers bust the service-level
			// caches (batch / line / segment) chunk by chunk below.
			trCache.delete(key);
		} else {
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
				trPending = [];
				// quick-261121-trfix: a frozen render is COMPLETE, so every sent
				// line in it is genuine (pass-through positions are neither).
				trSent = lines.map((_, i) => sendSet.has(i));
				trGenuine = lines.map((_, i) => sendSet.has(i));
				trUnavailable = false;
				// quick-261116-lyrux (Fix 3): a cache hit is still a COMPLETED translation —
				// offer it to the downloaded file too (the player's per-(uid, lang) session
				// cap + already-tagged check make the replay a no-op when it already landed).
				player.syncTranslatedLyricsToFile(t.uid, lang, serializeLRC(srcLines, cached));
				return;
			}
		}
		trKey = key;
		// quick-261120-maxsave (spec Addendum 2): collapse the send list to UNIQUE
		// texts before chunking — a chorus line repeated 3–4× is translated ONCE
		// and its settled result fans back out to every occurrence
		// (applyUniqueChunkResult / clearUniqueChunkPending keyed by uniqOf).
		const { unique: uniqText, uniqOf } = dedupeSendList(sendText);
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
			// quick-261116-lyrux: NOT offered to the Fix 3 file sync — nothing was translated,
			// so there is no translated LRC to embed (the file keeps whatever lyrics it has).
			const stitched = stitch([]);
			if (stitched.length === lines.length) trCache.set(key, stitched);
			translated = stitched;
			translating = false;
			trPending = [];
			// quick-261121-trfix: nothing was sent, so nothing is genuine and
			// nothing echoed — the aligned originals are the intended render.
			trSent = new Array<boolean>(n).fill(false);
			trGenuine = new Array<boolean>(n).fill(false);
			trUnavailable = false;
			return;
		}
		// WR-09: invalidate the PREVIOUS track's output immediately. The render gate is a pure
		// length comparison (translated.length === lines.length) — when the new track happens to
		// have the same line count, the old song's translations would otherwise render under the
		// new lyrics for the whole translate round-trip (and fully REPLACE them in replace mode).
		// quick-260618-fiz Fix 1: this synchronous reset ALSO makes a lyricsSkip/lyricsLang toggle
		// re-derive the CURRENT song's lyrics immediately — the key includes skip+lang, so flipping
		// either changes the key, drops the now-stale output here, and re-translates without a song
		// change (the "only applies to the next song" symptom was render staleness, not a dead effect).
		//
		// quick-261116-kvprog — PROGRESSIVE rendering ("show the early lines first"): instead of
		// clearing to [] and waiting for ONE whole-song batch, `translated` is initialized
		// SYNCHRONOUSLY to the CURRENT song's aligned originals (stitch([]) — built only from
		// this run's `lines`, so WR-09's protection is identical: a previous song's text can
		// never appear). The gate passes at once, the user reads lyrics instantly, and each
		// chunk's translations swap in place as they land. Pending slots show the original —
		// the same thing whitelisted/already-target slots have always shown.
		//
		// quick-261116-lyrux (Fix 1): …in REPLACE mode. In SHOW-BELOW mode that placeholder
		// made every in-flight line render TWICE (original + its own copy in the translation
		// slot) until its chunk landed — Hector's repro after un-skipping English. So the
		// sent positions are now tracked in `trPending` until their chunk settles, and the
		// template renders a SKELETON in a pending line's translation slot (below) or a
		// small inline spinner after its text (replace). Settled slots — genuine, echoed
		// or failed — render exactly as before.
		// quick-261121-trfix: CACHE-FIRST SEED (Hector's switch rule — a switch is
		// display/cache only, never a re-translation). The placeholder array is no
		// longer published blind: every sent line the LINE CACHE already holds
		// starts SETTLED — its cached translation in the slot, genuine, not
		// pending — so switching language or skip never placeholder-resets a line
		// that was already translated, and only genuinely-new lines show the
		// pending skeleton/spinner. When EVERY sent line is cached the switch
		// completes synchronously with zero fetches, freezing + file-syncing
		// exactly like a finished run. A FORCE run skips the seed — distrusting
		// this cache is its whole point.
		const slots0 = stitch([]);
		const genuine0 = new Array<boolean>(n).fill(false);
		const pending0 = initialPending(n, sendIdx);
		if (!forceRun) {
			let seeded = 0;
			for (let s = 0; s < sendIdx.length; s++) {
				const hit = peekLineTranslation(sendText[s], lang);
				if (hit === null) continue;
				slots0[sendIdx[s]] = hit;
				genuine0[sendIdx[s]] = true;
				pending0[sendIdx[s]] = false;
				seeded++;
			}
			if (seeded === sendIdx.length) {
				translated = slots0;
				trGenuine = genuine0;
				trPending = pending0;
				trSent = lines.map((_, i) => sendSet.has(i));
				trUnavailable = false;
				translating = false;
				if (slots0.length === lines.length) {
					trCache.set(key, slots0);
					player.syncTranslatedLyricsToFile(t.uid, lang, serializeLRC(srcLines, slots0));
				}
				return;
			}
		}
		translated = slots0;
		trGenuine = genuine0;
		trPending = pending0;
		trSent = lines.map((_, i) => sendSet.has(i));
		trUnavailable = false;
		translating = true;
		// Split the send-list into ORDERED chunks and fire them with bounded concurrency,
		// chunk 0 first (the lines at the top of the song — what the user reads first).
		// Each chunk is its OWN translateLinesEx call, so translateLinesEx's mem/localStorage
		// cache absorbs it individually: a revisit replays finished chunks instantly even
		// when the song as a whole never completed.
		// quick-261121-trfix: this run's generation — captured by the workers so a
		// superseded run (a force re-entry under the same key, a gate landing
		// mid-flight) can never write into the current run's arrays.
		const runGen = ++trRunGen;
		const ranges = chunkRanges(uniqText.length, LYRICS_CHUNK_SIZE);
		let nextRange = 0;
		let settledRanges = 0;
		let allComplete = true;
		const worker = async () => {
			while (nextRange < ranges.length) {
				const range = ranges[nextRange++];
				let stale = false;
				try {
					// quick-261120-segmix: segment routing ON for lyrics — a MIXED line's
					// Han runs convert offline while its English runs finally reach MT
					// (previously the whole line took the offline path and the English
					// stayed English). `skip` is this run's lyricsSkip snapshot, honoured
					// per segment inside the pipeline.
					const chunkLines = uniqText.slice(range.start, range.end);
					// quick-261121-trfix: a FORCE run busts this chunk's client caches
					// (the batch entry + per-line + per-segment entries for exactly
					// these lines and this target) immediately before the call, so
					// the pipeline genuinely re-derives what the user rejected.
					// Normal runs never bust anything.
					if (forceRun) bustLyricsTranslation(chunkLines, lang, { segments: true, skip });
					const res = await translateLinesEx(chunkLines, lang, { segments: true, skip });
					if (trKey !== key || runGen !== trRunGen) stale = true; // a newer song/lang/skip (or a force re-entry) owns the pane now
					else {
						// An incomplete chunk still surfaces its genuinely-translated
						// lines — it just keeps the song out of trCache below. Its echo
						// lines keep the original in the slot (replace mode shows the
						// original, as it must), but the flags stitch right below marks
						// them non-genuine so below mode never renders the echo AS a
						// translation (quick-261121-trfix).
						if (!res.complete) allComplete = false;
						translated = applyUniqueChunkResult(translated, sendIdx, uniqOf, range.start, res.out);
						trGenuine = applyUniqueChunkFlags(trGenuine, sendIdx, uniqOf, range.start, res.flags);
						// quick-261116-lyrux (Fix 1): this chunk has SETTLED — its lines
						// leave the pending set (skeleton/spinner off) whatever it returned.
						trPending = clearUniqueChunkPending(trPending, sendIdx, uniqOf, range.start, range.end);
					}
				} catch {
					// Deliberate change from the old whole-batch .catch (which blanked the
					// pane to []): a hard-failed chunk leaves its slots at the originals
					// and marks the song incomplete — strictly more useful, never frozen.
					// quick-261116-lyrux: a hard failure is still a settle — clear pending.
					if (trKey !== key || runGen !== trRunGen) stale = true;
					else {
						allComplete = false;
						trPending = clearUniqueChunkPending(trPending, sendIdx, uniqOf, range.start, range.end);
					}
				}
				if (stale) return;
				settledRanges++;
				if (settledRanges === ranges.length) {
					translating = false;
					// quick-261121-trfix: NO genuine line at all means the whole run
					// settled as an echo — raise the unavailable/retry row instead of
					// letting the pane pose as translated. (A PARTIAL echo just loses
					// its per-line .tr spans; the row is for the total case.)
					trUnavailable = sendIdx.length > 0 && !sendIdx.some((pos) => trGenuine[pos]);
					// quick-260625-pzs-03 / T-pzs-01, unchanged rule at song level: FREEZE
					// only a fully-translated render — EVERY chunk must have completed,
					// so an echoed chunk is never frozen as final.
					if (allComplete && translated.length === lines.length) {
						trCache.set(key, translated);
						// quick-261116-lyrux (Fix 3): the SAME completion moment — the
						// downloaded file learns the translated lyrics (rebuilt LRC:
						// this run's timestamps + the raw translation column). Partial
						// or echoed renders never reach this call.
						player.syncTranslatedLyricsToFile(t.uid, lang, serializeLRC(srcLines, translated));
					}
				}
			}
		};
		void Promise.all(
			Array.from({ length: Math.min(LYRICS_CHUNK_CONCURRENCY, ranges.length) }, () => worker())
		);
	});
	const showTr = $derived(settings.lyricsLang !== 'off' && translated.length === lines.length);
	// quick-260919-2jo: the rendered translation column, script-locked. Kept SEPARATE from
	// `translated` on purpose — `translated` stays the raw /api/translate output so `trCache`
	// (keyed `uid:lang:n:skip`, which deliberately has no lock segment) is never poisoned with
	// locked text and a lock flip costs no round-trip. This derived re-runs on the flip alone and
	// repaints in place. Positionally aligned, so `showTr`'s length gate and the `[i]` indexing in
	// the template are unchanged.
	const trLines = $derived(lockLyricLines(translated));
	// quick-261116-lyrux (Fix 2): PUBLISH the progressive state for the Nowbar's
	// replace-mode read (stores/lyrics-translation.svelte.ts). Post-lock lines
	// (trLines) so the bar renders exactly what this pane renders, plus the pending
	// flags so the bar never mistakes a placeholder original for a translation.
	// Re-runs on every chunk landing / pending change / lock flip / track change;
	// the store snapshot is replaced wholesale each time. A length mismatch (a
	// mid-run line change) skips the publish, and the reader additionally gates on
	// uid + lang, so a stale snapshot can never surface under another track/target.
	$effect(() => {
		const uid = player.current?.uid ?? '';
		const ls = trLines;
		const pend = trPending;
		const genuine = trGenuine;
		const sent = trSent;
		if (!uid || !ls.length || ls.length !== lines.length) return;
		// quick-261121-trfix: a settled ECHO line (sent, no longer pending, not
		// genuine) holds its ORIGINAL in the slot — publish it as blocked (the
		// store's pending flag is its "not a translation" signal) so the Nowbar's
		// replace mode never serves the original AS the translation.
		const blocked = pend.map((p, i) => p || (sent[i] === true && genuine[i] !== true));
		lyricsTranslation.publish(uid, trLang, ls, blocked);
	});
	// quick-261121-trfix: the pane-side force refresh — the same store request
	// the Lyrics settings sheet sends, consumed by the translate effect above
	// because the (uid, effective target) pair matches this pane's current run.
	function forceRetranslate() {
		const uid = player.current?.uid;
		if (!uid) return;
		lyricsTranslation.requestRetranslate(uid, effectiveTarget(settings.lyricsLang));
	}
	// quick-261102-t5k: every line was its own tab stop, so Tab had to cross the whole lyric to leave
	// the pane. Roving tabindex: only the active line (or the first, before the song starts) is
	// tabbable; Up/Down in seekToLineKey reach the rest. A line hidden by lyricsHideParenLines has no
	// <p>, which only means no line is tabbable until the next visible one goes active.
	const focusIdx = $derived(activeLine >= 0 ? activeLine : 0);
	// quick-261120-ugcb2: the No-lyrics CTA opens the ONE shared LyricsEditor (brief §2.1
	// entry point 1). Saving pins through the pin store, so `lines` re-derives and this pane
	// fills on the spot — the editor is wrong if Hector can't go from this empty state to
	// singing along in one sitting (brief §8, dogfood #1).
	let editorOpen = $state(false);

	// ---- furigana (quick-261120-furi, spec Addenda 3–6) ----
	// Ruby readings over kanji, from the LOCAL engine (zero network). The tables
	// are ~700KB of JSON in their own chunk, loaded ONLY when the toggle is on
	// and a kana-bearing line is actually on screen. Annotation is a $derived
	// over the SAME `lines` array the pane renders; the user's reading pins are
	// applied on top (applyFuriganaPins — the pin wins, Addendum 6). Toggle OFF,
	// tables not yet loaded, or a line with no kana → the template renders the
	// plain `{l.text}` exactly as before this feature existed.
	let furiTables = $state<FuriganaTables | null>(null);
	let furiLoadStarted = false;
	$effect(() => {
		if (!settings.lyricsFurigana || furiTables || furiLoadStarted) return;
		if (!lines.some((l) => hasKana(l.text))) return;
		furiLoadStarted = true;
		ensureFuriganaTables()
			.then((tb) => {
				furiTables = tb;
			})
			.catch(() => {
				furiLoadStarted = false; // a later toggle/track change may retry
			});
	});
	const furiLines = $derived.by<PinnedFuriganaSpan[][] | null>(() => {
		const tb = furiTables;
		if (!settings.lyricsFurigana || !tb) return null;
		return lines.map((l) =>
			hasKana(l.text) ? applyFuriganaPins(player.current?.uid ?? '', l.text, annotateLine(l.text, tb)) : []
		);
	});
	// quick-261122-sweepfix: the furigana branch renders the SAME per-character sweep as the
	// plain branch — the active line's timed characters re-grouped under the furigana surfaces
	// (groupCharSpansBySurfaces), so an annotated line also fills left→right from 0 instead of
	// taking the legacy whole-line white the moment it activates. A line whose surfaces do not
	// align with its characters maps to NO entry here and its <p> still carries .sweep (muted,
	// no flash) — it just renders its surfaces plain until the segmentations agree.
	const furiChars = $derived.by(() => {
		const m = new Map<number, TimedChar[][]>();
		if (!furiLines) return m;
		for (const [i, chs] of activeChars) {
			const spans = furiLines[i];
			if (!spans?.some((s) => s.chosen)) continue;
			const groups = groupCharSpansBySurfaces(chs, spans.map((s) => s.surface));
			if (groups) m.set(i, groups);
		}
		return m;
	});
	// The variant chooser: which word, in which line, is being re-read. A word
	// tap must NOT seek — the enclosing <p> seeks on click — so the opener
	// stopPropagation()s (see the template).
	let furiPick = $state<{ line: string; span: PinnedFuriganaSpan } | null>(null);
	function openFuriChooser(e: MouseEvent, lineText: string, span: PinnedFuriganaSpan) {
		e.stopPropagation();
		furiPick = { line: lineText, span };
	}
	function chooseReading(reading: string) {
		const uid = player.current?.uid;
		if (uid && furiPick) pinReading(uid, furiPick.line, furiPick.span.surface, reading);
		furiPick = null;
	}
</script>

{#if lines.length}
	<!-- quick-260926-mis: offset control row. OUTSIDE `.lyrics` so it is not inside the padding the
	     anchor pass writes and never reaches `.lyrics`' hold handlers (tapping or dragging it does not
	     pause auto-scroll). Sticky so the readout stays visible while nudging after a scroll.
	     quick-260926-qat: hidden by default, opened from the track menu (TrackMenu "Adjust lyrics
	     timing"); the flag lives in the offset store so the menu, this pane and NowPlaying's tab switch
	     share one source. quick-260926-vur: the ✕ sits before the full-width native range slider so it
	     stays on the button line; one-way `value` — the readout/reset/nudges write the store and the
	     derived feeds the thumb back. -->
	{#if lyricSyncOpen()}
	<div class="sync">
		<button type="button" onclick={() => nudgeOffset(-0.5)} aria-label={t('lyrics.offsetEarlier')}>−0.5s</button>
		<button type="button" class="readout" onclick={resetOffset} aria-label={t('lyrics.offsetReset', { value: formatLyricOffset(lyricOffset) })}>{formatLyricOffset(lyricOffset)}</button>
		<button type="button" onclick={() => nudgeOffset(0.5)} aria-label={t('lyrics.offsetLater')}>+0.5s</button>
		<!-- quick-260926-mzn: provenance — shown only while the listeners' consensus is what's applied. -->
		{#if offsetShared}<span class="shared">{t('lyrics.offsetShared')}</span>{/if}
		<button type="button" class="close" onclick={() => setLyricSyncOpen(false)} aria-label={t('menu.lyricsTimingHide')}><X size={14} /></button>
		<input class="slider" type="range" min={-sliderRange} max={sliderRange} step="0.1" value={lyricOffset} aria-label={t('menu.lyricsTiming')} oninput={(e) => slideOffset(e.currentTarget.valueAsNumber)} />
	</div>
	{/if}
	{#if translating}
		<p class="tr-hint">{t('nowplaying.translating')}</p>
	{:else if trUnavailable}
		<!-- quick-261121-trfix: the run settled with NO genuine line (whole-song
		     echo) — say so plainly, and make the row itself the retry: one tap
		     force-runs this song + target again. -->
		<button type="button" class="tr-retry" onclick={forceRetranslate} use:tapBounce>{t('nowplaying.translationUnavailable')}</button>
	{:else if showTr && trSent.some(Boolean)}
		<!-- quick-261121-trfix (Hector 2026-11-21): force refresh AT THE POINT OF
		     USE — while a translation is on screen, one tap busts this song +
		     target's client caches and re-translates this song only. -->
		<button type="button" class="tr-refresh" onclick={forceRetranslate} use:tapBounce>{t('lyricsSettings.retranslate')}</button>
	{/if}
	<div class="lyrics" role="group" aria-label={t('nowplaying.lyrics')} bind:this={lyricsEl} onpointerdown={lyricsPointerDown} ontouchstart={lyricsTouch} ontouchend={lyricsTouch} ontouchcancel={lyricsTouch} onwheel={() => dispatch({ type: 'wheel' })}>
		{#each lines as l, i (i)}
			{@const isHiddenParen = (l.fromParen || l.isTranslation) && settings.lyricsHideParenLines}
			{@const isTr = l.fromParen || l.isTranslation}
			<!-- quick-261020-lyr4: Replace mode for EMBEDDED translations — hide the original
			     when a translation sibling shares its timestamp. The translation line itself
			     (isTr) always shows in Replace mode. -->
			{@const hideForReplace = settings.translateMode === 'replace' && !isTr && lines.some((o, j) => j !== i && o.time === l.time && (o.fromParen || o.isTranslation))}
			{#if !isHiddenParen && !hideForReplace}
				{@const hideTrForLine = isTr && settings.lyricsHideParenTranslation}
				{@const furi = furiLines?.[i]}
				{@const chs = activeChars.get(i)}
				<!-- quick-261122-sweepfix: a line that carries the per-character sweep (the plain
				     branch, or the furigana branch re-grouped via furiChars) must NOT also take
				     the legacy whole-line .active treatment — see the .sweep CSS below. Replace
				     mode renders the translation text plain (no sweep in this <p>), so it is
				     excluded and keeps the line treatment it has always had. -->
				{@const sweepLine = !!chs?.length && !(showTr && settings.translateMode === 'replace' && !hideTrForLine)}
				<!-- D-01: every lyric line is a tap target that seeks to its timestamp. The line stays a
				     semantic <p> so the anchor $effect's `querySelectorAll('p')[idx]` scroll-centering, the
				     `.lyrics p` centring/active/paren CSS, and the activeTime↔translated[i] index alignment
				     are ALL untouched (swapping to <button> would break the anchor lookup the plan forbids
				     editing). onkeydown gives Enter parity (seekToLineKey; Space = play/pause app-wide); role="button"+tabindex make
				     it a focusable control. A <p> cannot legally carry an interactive role/tabindex per ARIA,
				     so the three resulting advisories are silenced at element scope only. -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<p data-i={i} class:active={l.time === activeTime && activeTime >= 0} class:paren={l.fromParen} class:sweep={sweepLine} onclick={() => seekToLine(l)} onkeydown={(e) => seekToLineKey(e, l)} role="button" tabindex={i === focusIdx ? 0 : -1}>
					{#if showTr && settings.translateMode === 'replace' && !hideTrForLine}
						{trLines[i]}{#if trPending[i]}<span class="tr-spin motion-always" aria-hidden="true"></span>{/if}
					{:else if furi?.some((s) => s.chosen)}
						<!-- quick-261120-furi: annotated line — each read word is a ruby
						     span; tapping it opens the variant chooser (and does NOT
						     seek: openFuriChooser stopPropagation()s). Unread spans
						     (kana runs) render as plain text.
						     quick-261122-sweepfix: on the ACTIVE line the surfaces render
						     as per-character .ch spans (furiChars, re-grouped from the
						     line's timed characters) so the sweep fills them left→right
						     from 0 like every other sung line — the rAF loop's '.ch'
						     query reaches them unchanged. A surface with no group
						     (segmentation mismatch) falls back to its plain text. -->
						{#each furi as span, si}
							{@const g = furiChars.get(i)?.[si]}
							{#if span.chosen}<button type="button" class="fw" tabindex="-1" onclick={(e) => openFuriChooser(e, l.text, span)} aria-label="{span.surface} — {span.chosen}"><ruby>{#if g}{#each g as c, ci (ci)}<span class="ch" aria-hidden="true" data-s={c.start} data-e={c.end}>{c.text}</span>{/each}{:else}{span.surface}{/if}<rt class:pinned={span.pinned} class:est={span.estimated && !span.pinned}>{span.chosen}</rt></ruby></button>{:else if g}{#each g as c, ci (ci)}<span class="ch" aria-hidden="true" data-s={c.start} data-e={c.end}>{c.text}</span>{/each}{:else}{span.surface}{/if}
						{/each}
					{:else}
						{#if chs && chs.length}<span class="chs" aria-label={l.text}>{#each chs as c, ci (ci)}<span class="ch" aria-hidden="true" data-s={c.start} data-e={c.end}>{c.text}</span>{/each}</span>{:else}{l.text}{/if}
						{#if showTr && !hideTrForLine}
							{#if trPending[i]}
								<span class="tr tr-pending" aria-hidden="true"><span class="sk tr-skbar" style="--skw:{skeletonWidthPct(l.text)}%"></span></span>
							{:else if trSent[i] && !trGenuine[i]}
								<!-- quick-261121-trfix: a settled ECHO — the slot holds the
								     original, which is NOT a translation. Render nothing:
								     never the duplicate-original line an echo used to show
								     below itself (dedupe on OR off). Pass-through lines
								     (not sent) are unaffected — they keep the dedupe rule. -->
							{:else if !(settings.lyricsDedupeIdentical && translationDuplicatesOriginal(l.text, trLines[i] ?? ''))}
								<!-- quick-261120-lsheet: dedupe ON (default) — a "translation" identical
								     to the original is not rendered as a second line below it. -->
								<span class="tr" class:active={l.time === activeTime && activeTime >= 0}>{trLines[i]}</span>
							{/if}
						{/if}
					{/if}
				</p>
			{/if}
		{/each}
	</div>
{:else if lyricsPending}<LoadingState label={t('common.loading')} lines={6} />{:else}<div class="empty-wrap"><p class="empty">{t('nowplaying.noLyrics')}</p>{#if player.current?.uid}<button type="button" class="add-lyrics" onclick={() => (editorOpen = true)} use:tapBounce>{t('nowplaying.addLyrics')}</button>{/if}</div>{/if}

<!-- quick-261120-furi: the reading-variant chooser (Addendum 6 — WHY NOT ALL:
     every plausible reading is listed; the tap pins it for this song). Sheet
     idiom copied from LyricsSettingsSheet (scrim + sheet tokens). -->
{#if furiPick}
	<button class="furi-scrim" aria-label={t('menu.close')} onclick={() => (furiPick = null)}></button>
	<div class="furi-sheet" role="dialog" aria-modal="true" aria-label={t('lyrics.furiganaChoose')}>
		<div class="furi-head">
			<span class="furi-word">{furiPick.span.surface}</span>
			<span class="furi-title">{t('lyrics.furiganaChoose')}</span>
			{#if furiPick.span.estimated}<span class="furi-est">{t('lyrics.furiganaEstimated')}</span>{/if}
			<button type="button" class="furi-x" aria-label={t('menu.close')} onclick={() => (furiPick = null)} use:tapBounce><X size={16} /></button>
		</div>
		{#each furiPick.span.variants as v (v)}
			<button type="button" class="furi-opt" class:on={v === furiPick.span.chosen} onclick={() => chooseReading(v)} use:tapBounce>
				<span>{v}</span>
				{#if v === furiPick.span.chosen}<Check size={16} />{/if}
			</button>
		{/each}
		<p class="furi-hint">{t('lyrics.furiganaHint')}</p>
	</div>
{/if}

<LyricsEditor track={player.current} open={editorOpen} onclose={() => (editorOpen = false)} />

<style>
	/* quick-260919-np3: the lyrics SUBSET of NowPlaying.svelte's old panel CSS, moved verbatim with
	   the markup it styles (Svelte scopes styles per component). */
	/* quick-261019-lyr: the active line used to highlight with font-weight 700 — bold glyphs are
	   wider/taller than their regular twins, so every highlight triggered a reflow and the whole
	   lyric column visibly shifted (before/during/after). The highlight is now faux-bold via
	   text-shadow: it thickens the strokes with IDENTICAL glyph metrics, so the active line pops
	   with zero layout shift. Side padding still gives room against the parent's
	   `overflow: hidden` clip. word-break/overflow-wrap force even unbroken-character runs
	   (CJK with no spaces, or long URLs) to wrap inside the column instead of being clipped. */
	.lyrics { text-align: center; line-height: 1.3; }
	.lyrics p { font-size: calc(1rem * var(--fs-lyrics, 1)); color: var(--color-text-muted); transition: color 0.2s ease, text-shadow 0.2s ease, transform 0.2s ease; margin: 0; white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
	.lyrics p.active { color: var(--color-text); text-shadow: 0 0 0.5px currentColor, 0 0 0.5px currentColor; }
	/* quick-261122-sweepfix (Hector 2026-11-22): a line carrying the per-character sweep must
	   NEVER flash fully white when it becomes active — the whole-line colour + faux-bold shadow
	   above painted every glyph at full strength the moment .active landed, and only then did
	   the sweep restart from the left. A .sweep line stays at the muted base colour with no
	   shadow (its .ch spans carry the ONLY fill, via --p, from 0 at the line's start); the
	   inherited shadow is also killed on the spans themselves below, since a transparent-fill
	   glyph would otherwise show the parent's shadow through it. Paint-only, zero layout shift:
	   no font-weight, no metrics change. Same specificity as p.active, later in the sheet, so
	   it wins exactly the two properties it sets. Lines WITHOUT a sweep (translations, paren
	   siblings, replace-mode text, plain fallbacks) keep the .active treatment untouched. */
	.lyrics p.sweep { color: var(--color-text-muted); text-shadow: none; }
	/* quick-261122-ugcb4 — the per-character sweep. Each character is a text-clipped gradient:
	   the sung share in full text colour, the rest in the muted ink, with a soft 0.12em feather at
	   the sweep edge so the fill glides THROUGH a character rather than snapping per glyph. --p is
	   written per frame by the rAF loop (0 = not yet, 1 = sung). Paint-only: no filter / shadow on
	   the per-frame path (a per-glyph filter repaint is a phone-GPU cost the sweep does not need). */
	.lyrics .chs { display: inline; }
	.lyrics .ch {
		--p: 0;
		background-image: linear-gradient(
			90deg,
			var(--color-text) calc(var(--p) * 100% - 0.12em),
			color-mix(in srgb, var(--color-text) 42%, transparent) calc(var(--p) * 100% + 0.12em)
		);
		-webkit-background-clip: text;
		background-clip: text;
		text-shadow: none;
		color: transparent;
		-webkit-text-fill-color: transparent;
		white-space: pre-wrap;
	}
	/* paren-derived sibling line — slightly smaller / lower contrast than the parent so the
	   reader can tell "this is the embedded-translation part" at a glance. */
	.lyrics p.paren { font-size: calc(0.9rem * var(--fs-lyrics, 1)); opacity: 0.85; }
	.lyrics .tr { display: block; font-size: 0.82em; font-weight: 400; color: var(--color-text-muted); margin-top: 2px; transition: color 0.2s ease, text-shadow 0.2s ease; }
	/* quick-260618-t7p Task 3 + quick-261019-lyr: the per-line translation inside an active line is a
	   CHILD .tr span, so the .lyrics p.active emphasis does not reach it. Mirror the active-line
	   highlight (faux-bold text-shadow, not font-weight 700) so the active moment's translation
	   reads as highlighted in lockstep with the original — still with zero layout shift. */
	.lyrics .tr.active { color: var(--color-text); text-shadow: 0 0 0.5px currentColor, 0 0 0.5px currentColor; }
	/* quick-261116-lyrux (Fix 1): a PENDING line's translation slot in show-below mode —
	   a skeleton bar (the global .sk shimmer) standing where the translation will land,
	   in place of the duplicate original the placeholder array used to show. Sized off
	   the .tr row (bar 12px ≈ the 0.82em line box) so the pair's geometry barely moves
	   when the real text swaps in; width varies per line via skeletonWidthPct.
	   Skeleton ONLY in this mode — the standing XOR rule: replace mode's affordance is
	   the inline spinner below, never both in one area. */
	.lyrics .tr-skbar { display: block; height: 12px; width: var(--skw, 65%); margin: 2px auto 1px; }
	/* quick-261116-lyrux (Fix 1 amendment): REPLACE mode has no second slot to skeleton,
	   so a pending line keeps its (original) text plus ONE small inline spinner after
	   it — small element = spinner territory under the XOR rule. Border recipe mirrors
	   LoadingState's .ring at inline size; `.motion-always` is the app's spinner
	   pattern under reduce-motion (the "still working" signal keeps turning — a frozen
	   spinner reads as a hung app, quick-260809-mvz). */
	.lyrics .tr-spin { display: inline-block; width: 0.72em; height: 0.72em; margin-inline-start: 0.45em; vertical-align: -0.06em; border: 2px solid var(--color-text-muted); border-top-color: transparent; border-radius: 50%; animation: tr-spin-rot 0.7s linear infinite; }
	@keyframes tr-spin-rot { to { transform: rotate(360deg); } }
	/* quick-261102-s5t: muted, not the accent — a status line is not "live/on/go", and Tiffany
	   small text on the light floor was ~2:1. */
	.tr-hint { text-align: center; font-size: 0.6875rem; color: var(--color-text-muted); margin: 0 0 6px; }
	/* quick-261121-trfix: the unavailable/retry + force-refresh rows — the same
	   quiet status typography as .tr-hint, as real buttons (centred block, a
	   comfortable tap height). The retry row underlines: it is the one action. */
	.tr-retry, .tr-refresh { display: block; margin: 0 auto 6px; background: none; border: none; padding: 4px 10px; min-height: 28px; font-size: 0.6875rem; color: var(--color-text-muted); text-align: center; cursor: pointer; }
	.tr-retry { text-decoration: underline; text-underline-offset: 3px; }
	.empty { color: var(--color-text-muted); font-size: 0.875rem; text-align: center; padding: 24px; }
	/* quick-261120-ugcb2: the No-lyrics state carries the Add-lyrics CTA under the line —
	   a centred primary pill, the pane's one action. */
	.empty-wrap { display: flex; flex-direction: column; align-items: center; }
	.empty-wrap .empty { padding-bottom: 8px; }
	.add-lyrics { background: var(--color-primary); color: var(--color-on-primary); border: none; border-radius: 999px; padding: 8px 18px; font-size: 0.875rem; min-height: 40px; cursor: pointer; margin-bottom: 24px; }
	/* quick-261029-xor1: the fetching state is the shared LoadingState — skeleton ONLY
	   for lyrics (long text; spinner + skeleton together are banned, standing rule) —
	   the old scoped .row-spinner (quick-261019-lyrspin) retired with load1. */
	/* quick-260926-mis: quiet offset row. In normal flow above `.lyrics`, so it shifts every line by the
	   same amount and anchorActiveLine (live rects) still lands exactly. Opaque --color-bg (what .np /
	   .sheet paint) keeps it legible over lyrics scrolling beneath it. */
	.sync { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; padding: 4px 0 6px; font-size: 0.6875rem; color: var(--color-text-muted); background: var(--color-bg); }
	.sync button { background: none; border: 1px solid var(--color-text-muted); border-radius: 999px; color: inherit; font: inherit; padding: 2px 8px; min-width: 44px; min-height: 24px; cursor: pointer; }
	.sync .readout { font-variant-numeric: tabular-nums; border-style: dashed; }
	/* quick-260926-vur: own full-width line (flex-basis 100%, like the old hint). `touch-action: none`
	   keeps a slightly diagonal thumb drag a slider drag instead of a `.panel` vertical scroll on Android. */
	.sync .slider { flex-basis: 100%; margin: 2px 0 0; accent-color: var(--color-primary); touch-action: none; }
	/* quick-260926-mzn: "Synced by listeners", inline beside the readout it qualifies. */
	.sync .shared { font-size: 0.625rem; opacity: 0.7; }
	.sync .close { min-width: 44px; min-height: 24px; /* quick-261102-t5k: 24 -> 44 wide, like its siblings */ padding: 2px 4px; border: none; display: inline-flex; align-items: center; }
	/* quick-261120-furi: furigana — the read word is a bare button (inherits the
	   line's type entirely; only the ruby + rt are new geometry). rt is muted by
	   default, full-strength on the active line like .tr, dimmer still when the
	   reading is an ESTIMATED fallback, and accent when the user PINNED it —
	   three quiet states, no clutter (Dawn Apple Design). */
	.lyrics .fw { background: none; border: none; padding: 0 1px; margin: 0; font: inherit; color: inherit; cursor: pointer; }
	.lyrics ruby { ruby-position: over; }
	.lyrics rt { font-size: 0.52em; font-weight: 400; color: var(--color-text-muted); letter-spacing: 0.02em; transition: color 0.2s ease; }
	.lyrics p.active rt { color: var(--color-text); }
	.lyrics rt.est { opacity: 0.55; }
	.lyrics rt.pinned { color: var(--color-primary); opacity: 1; }
	/* The variant chooser — the LyricsSettingsSheet sheet idiom at pane scope. */
	.furi-scrim { position: fixed; inset: 0; z-index: 92; background: rgb(0 0 0 / 0.45); border: none; cursor: pointer; }
	.furi-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 93; max-height: 70dvh; overflow-y: auto; background: var(--color-bg); border-radius: var(--radius-sheet) var(--radius-sheet) 0 0; box-shadow: var(--ui-sheet-shadow); padding: 10px 14px calc(14px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 8px; }
	@media (min-width: 640px) { .furi-sheet { left: 50%; right: auto; width: min(420px, calc(100vw - 32px)); transform: translateX(-50%); border-radius: var(--radius-sheet); bottom: 16px; } }
	.furi-head { display: flex; align-items: center; gap: 8px; min-height: 32px; }
	.furi-word { font-size: 1.05rem; font-weight: 600; }
	.furi-title { color: var(--color-text-muted); font-size: 0.85rem; }
	.furi-est { color: var(--color-text-muted); font-size: 0.7rem; border: 1px solid var(--color-border); border-radius: 999px; padding: 1px 7px; }
	.furi-x { margin-left: auto; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: none; border-radius: 50%; background: var(--color-surface); color: var(--color-text); cursor: pointer; flex: none; }
	.furi-opt { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); color: var(--color-text); font-size: 1rem; cursor: pointer; text-align: start; }
	.furi-opt.on { border-color: var(--color-primary); }
	.furi-opt :global(svg) { color: var(--color-primary); flex: none; }
	.furi-hint { color: var(--color-text-muted); font-size: 0.75rem; line-height: 1.4; margin: 0; }
</style>
