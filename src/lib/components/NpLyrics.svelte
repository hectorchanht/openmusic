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
	import { reorderPairs, splitParenLines, lineSeekFraction, activeLineAt, type LyricLine } from '$lib/services/lrc';
	// quick-260919-2jo: the Chinese script lock for lyric text. `parseLyrics` replaces `parseLRC`
	// (the ORIGINAL lines); `lockLyricLines` covers the translation column, which is a SECOND source
	// of source-derived text produced after parse time.
	import { parseLyrics, lockLyricLines } from '$lib/stores/lyric-script.svelte';
	// quick-260919-1we (D-4): the user's explicit lyric pick, layered into a reactive READ so it
	// outranks whatever the chain (or a downloaded file's embedded tag) supplied.
	import { readLyrics } from '$lib/stores/lyric-pins.svelte';

	// quick-260919-np3: the lyrics pane, lifted OUT of NowPlaying.svelte verbatim. The ONLY semantic
	// edit is that both `tab === 'lyrics'` gates (auto-scroll anchor + translation) became the MOUNT —
	// the parent renders this component exactly when that tab is selected (mobile) or always, as the
	// middle column, at >=1280px. `sheetState` is the one piece of parent state the anchor maths
	// genuinely needs (closed top-pins, half/full centres), so it arrives as a prop.
	// quick-260919-npfix (Fix 3): `wide` is the parent's ALREADY-COMPUTED >=1280px matchMedia flag
	// (NowPlaying.svelte `wide`, the quick-260919-np3 three-column breakpoint) handed down rather
	// than a second matchMedia listener here — one source of truth for that rung, and this pane has
	// no business owning a breakpoint the parent uses to decide whether it is mounted at all.
	let { sheetState, wide }: { sheetState: 'closed' | 'half' | 'full'; wide: boolean } = $props();

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
	const active = $derived(activeLineAt(lines, player.currentTime));
	const activeLine = $derived(active.idx);
	const activeTime = $derived(active.time);
	let lyricsEl = $state<HTMLElement | null>(null);
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
		const mode = sheetState;
		const desktop = wide;
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
		const visTopWithin = visTop - cRect.top; // visible-band top, in container-local coords
		const TOP_PAD = 12; // breathing room when top-pinned (closed)
		// quick-260919-npfix (Fix 3): the top-pin is a PHONE compromise, not the intent. It exists
		// because a closed sheet on a phone is a ~100px peek — there is no room to centre in, so the
		// active line is pinned to the top of the strip instead. At >=1280px the closed peek is the
		// whole lyrics COLUMN (measured 305px tall at 1440x900, and it only grows with the window),
		// which is ample; top-pinning there just parks the line you are reading in the upper third for
		// no reason. So `closed` top-pins only on the narrow layout, and desktop centres in all three
		// sheet states — which is the ask. half/full are unchanged on both layouts.
		const anchorWithin =
			mode === 'closed' && !desktop
				? visTopWithin + TOP_PAD
				: visTopWithin + visHeight / 2 - el.offsetHeight / 2; // visible-band center
		// ponytail: the FIRST and LAST lines still clamp to the pane edge, because the browser clamps
		// scrollTop to [0, scrollHeight - clientHeight] and there is no content beyond them to scroll
		// past. That is a CONTENT limit, not a mode limit — measured at 1440x900, every line that can
		// be centred lands within 1px in all three states, while the tail of a 56-line lyric in `full`
		// (791px band, 394px of scroll) sits up to ~136px high. Upgrade path if this ever matters: half
		// a band's worth of blank scroll padding above and below `.lyrics`, Spotify-style. Not taken
		// here — it pushes real lyric text down by ~400px in `full` to buy edge-centring nobody asked
		// for, and the ask was about the three sheet modes.
		container.scrollTo({ top: offsetWithin - anchorWithin, behavior: 'smooth' });
	}

	// quick-260919-npfix (Fix 3): how long to wait before re-anchoring after a sheet-state change.
	// The sheet's own transform/inset transition is 0.28s and the `.np.reflow` cover reflow above it
	// is 0.32s, both on the shared cubic-bezier(.22,1,.36,1); 340ms clears the slower of the two.
	// Same number, and the same reason, as the parent's measureOffsets() settle fallback.
	const REFLOW_SETTLE_MS = 340;

	$effect(() => {
		// Immediate pass — also what registers this effect's dependencies (activeLine, autoScroll,
		// lyricsEl, sheetState, wide are all read at the top of anchorActiveLine before any return).
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
		// reaches bumpResume(), which no-ops while autoScroll is on. So this cannot become the
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
	.tr-hint { text-align: center; font-size: 11px; color: var(--color-primary); margin: 0 0 6px; }
	.empty { color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 24px; }
</style>
