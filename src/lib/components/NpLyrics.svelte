<script module lang="ts">
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
	import { player } from '$lib/stores/player.svelte';
	import { t } from '$lib/i18n';
	import { translateLinesEx } from '$lib/services/translate';
	import { shouldTranslate } from '$lib/i18n/detect';
	import { reorderPairs, splitParenLines, lineSeekFraction, activeLineAt, lyricAnchorMetrics, formatLyricOffset, LYRIC_OFFSET_MAX, type LyricLine } from '$lib/services/lrc';
	// quick-260919-2jo: the Chinese script lock for lyric text. `parseLyrics` replaces `parseLRC`
	// (the ORIGINAL lines); `lockLyricLines` covers the translation column, which is a SECOND source
	// of source-derived text produced after parse time.
	import { parseLyrics, lockLyricLines } from '$lib/stores/lyric-script.svelte';
	// quick-260919-1we (D-4): the user's explicit lyric pick, layered into a reactive READ so it
	// outranks whatever the chain (or a downloaded file's embedded tag) supplied.
	import { readLyrics } from '$lib/stores/lyric-pins.svelte';
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
	import { X } from '@lucide/svelte';
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
	let lyricsEl = $state<HTMLElement | null>(null);
	let autoScroll = $state(true);
	// quick-260920-n6j: last padding written to `.lyrics`, as the exact CSS strings. Plain `let`s, not
	// $state — nothing reactive reads them; they only stop the anchor pass from rewriting an unchanged
	// value. Instance-scoped (NOT module-scoped like `trCache`) on purpose: a remount hands us a FRESH
	// element with no padding, and a surviving guard would skip re-applying it.
	let lastPadTop = '';
	let lastPadBottom = '';
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
	// Keyboard parity for the tappable lyric line (Enter/Space) — mirrors the cover's tapCoverKey
	// and the grip's gripKey idiom, satisfying the a11y click-needs-keydown rule.
	function seekToLineKey(e: KeyboardEvent, line: LyricLine) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
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
		const anchorPct = settings.lyricsAnchor;
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
		container.scrollTo({ top: offsetWithin - anchorWithin, behavior: 'smooth' });
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
	let trKey = '';
	$effect(() => {
		// ju0: lyricsLang now allows 'auto' (→ appLang). Resolve once here so both the
		// rerun key, shouldTranslate(), and translateLines() all see the SAME final token.
		const rawLang = settings.lyricsLang;
		const lang = effectiveTarget(rawLang);
		const skip = settings.lyricsSkip;
		const t = player.current;
		const n = lines.length;
		// quick-260919-np3: `tab !== 'lyrics'` dropped — the mount is that gate now (see above).
		if (rawLang === 'off' || !n || !t) {
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
	// quick-260919-2jo: the rendered translation column, script-locked. Kept SEPARATE from
	// `translated` on purpose — `translated` stays the raw /api/translate output so `trCache`
	// (keyed `uid:lang:n:skip`, which deliberately has no lock segment) is never poisoned with
	// locked text and a lock flip costs no round-trip. This derived re-runs on the flip alone and
	// repaints in place. Positionally aligned, so `showTr`'s length gate and the `[i]` indexing in
	// the template are unchanged.
	const trLines = $derived(lockLyricLines(translated));
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
	{#if translating}<p class="tr-hint">{t('nowplaying.translating')}</p>{/if}
	<div class="lyrics" role="group" aria-label={t('nowplaying.lyrics')} bind:this={lyricsEl} onpointerdown={lyricsPointerDown} ontouchstart={lyricsTouch} ontouchend={lyricsTouch} ontouchcancel={lyricsTouch} onwheel={() => dispatch({ type: 'wheel' })}>
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
						{trLines[i]}
					{:else}
						{l.text}
						{#if showTr && !hideTrForLine}<span class="tr" class:active={l.time === activeTime && activeTime >= 0}>{trLines[i]}</span>{/if}
					{/if}
				</p>
			{/if}
		{/each}
	</div>
{:else}<p class="empty">{t('nowplaying.noLyrics')}</p>{/if}

<style>
	/* quick-260919-np3: the lyrics SUBSET of NowPlaying.svelte's old panel CSS, moved verbatim with
	   the markup it styles (Svelte scopes styles per component). */
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
	.tr-hint { text-align: center; font-size: 0.6875rem; color: var(--color-primary); margin: 0 0 6px; }
	.empty { color: var(--color-text-muted); font-size: 0.875rem; text-align: center; padding: 24px; }
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
	.sync .close { min-width: 24px; min-height: 24px; padding: 2px 4px; border: none; display: inline-flex; align-items: center; }
</style>
