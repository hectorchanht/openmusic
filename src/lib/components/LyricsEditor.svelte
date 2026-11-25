<script lang="ts">
	import { fly } from 'svelte/transition';
	import { X, Clock, Type, FileUp, Eye, Check, ChevronLeft, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, Link, Unlink, Anchor, LoaderCircle, Trash2, Plus } from '@lucide/svelte';
	import type { Track } from '$lib/sources/types';
	import { t } from '$lib/i18n';
	import { player } from '$lib/stores/player.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { pinLyrics } from '$lib/stores/lyric-pins.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { communityLyrics } from '$lib/stores/community-lyrics.svelte';
	import { lyricsSongKey, type SubmitErr } from '$lib/services/community-lyrics';
	import type { LyricCheckErr } from '$lib/proxy/community-lyrics';
	import TurnstileGate from '$lib/components/TurnstileGate.svelte';
	import { songKey } from '$lib/services/dedupe';
	import { activeLineAt, lineSeekFraction } from '$lib/services/lrc';
	import { scrollBehavior } from '$lib/motion';
	import {
		nextFollow,
		followScrollTarget,
		classifyPlayhead,
		type FollowEvent,
		type PlayheadSample
	} from '$lib/services/lyrics-editor-follow';
	import {
		getInputDraft,
		setInputDraft,
		clearInputDraft,
		lyricsDraftKey,
		encodeLyricsDraft,
		decodeLyricsDraft
	} from '$lib/services/input-drafts';
	import {
		splitPastedText,
		looksLikeLrc,
		estimateLines,
		editorLinesFromLrc,
		serializeEditorLines,
		editorLinesToLyricLines,
		nudgeEditorLine,
		moveEditorLine,
		stampEditorLine,
		hasDegenerateStamps,
		stampNextInSequence,
		rippleShiftDraft,
		anchorStretchLines,
		interludesFromEditorLines,
		insertInterlude,
		resizeInterlude,
		deleteInterlude,
		DEFAULT_INTERLUDE_SEC,
		type EditorLine,
		type EditorCascadeMode,
		type InterludeSegment
	} from '$lib/services/lyrics-editor';
	import { charSpansFor, charFillAt, nudgeCharStart, setCharStart, type TimedChar } from '$lib/services/lyric-chars';

	// quick-261120-ugcb2 — THE LyricsEditor (UGC lyrics Phase 1, brief §2.1–2.2): the ONE shared
	// editor behind the No-lyrics "Add lyrics" CTA and the Fix-lyrics picker's "Write / upload
	// your own" footer. No per-surface variants.
	//
	// The founding principle is the interaction design: users are lazy. ONE paste of plain text
	// (newlines = lines) produces a singable ESTIMATED lyric immediately — the estimator stamps
	// duration ÷ lines before the user is asked for anything. Refinement (drag on the timeline,
	// ±0.1s nudges, tap-to-stamp) is optional and promotes the draft out of the Estimated class.
	// Saving writes the existing pin store, so the lyric shows in the pane on the spot.
	let {
		track,
		open,
		initialLrc = null,
		onclose,
		onsaved
	}: {
		track: Track | null;
		open: boolean;
		initialLrc?: string | null;
		onclose: () => void;
		onsaved?: () => void;
	} = $props();

	let step = $state<'edit' | 'confirm'>('edit');
	let rawText = $state('');
	let lines = $state<EditorLine[]>([]);
	// quick-261125-cascade: the cascade mode (Single default) + the draft's interlude
	// (blank-time) segments. Segments are derived from the lines' chain on seed/paste
	// (interludesFromEditorLines — the ONE model playback reads too) and then carried
	// explicitly through every cascade operation.
	let mode = $state<EditorCascadeMode>('single');
	let segments = $state<InterludeSegment[]>([]);
	let estimated = $state(false);
	let title = $state('');
	let artist = $state('');
	let fileEl = $state<HTMLInputElement | null>(null);
	// The open-session seed guard: seed once per open, keyed by the track uid, so a parent
	// re-render (or the pin landing) never reseeds over the user's typing.
	let seededFor = '';

	const isCurrent = $derived(!!track && player.current?.uid === track.uid);
	// The duration every estimate / drag clamps against: the live player's when this track is
	// playing, else the track's own reported length, else 0 (estimator falls back nominally).
	const duration = $derived(
		isCurrent && player.duration > 0 ? player.duration : (track?.duration ?? 0)
	);
	const identity = $derived(songKey(artist, title));

	$effect(() => {
		if (!open || !track) return;
		const seedKey = track.uid;
		if (seededFor === seedKey) return;
		seededFor = seedKey;
		step = 'edit';
		retime = false;
		retimeCursor = 0;
		title = track.title ?? '';
		artist = track.artist ?? '';
		// quick-261122-rules (GOLD auto-cache rule): an unsaved working draft for this track wins
		// over the seed — a stray scrim tap / drag-close / reload must never cost the paste.
		const draft = decodeLyricsDraft(getInputDraft(lyricsDraftKey(track.uid)));
		// A fresh open always starts FOLLOWING (nextFollow 'open'); set directly, not via follow(),
		// so this seed effect never subscribes to the playhead.
		following = nextFollow(following, 'open');
		lastScrolled = -1;
		rawText = draft ? draft.raw : (initialLrc ?? '');
		if (draft) {
			lines = draft.lrc ? editorLinesFromLrc(draft.lrc, duration) : [];
			estimated = draft.estimated && lines.length > 0;
		} else if (initialLrc) {
			lines = editorLinesFromLrc(initialLrc, duration, isCurrent ? player.currentTime : undefined);
			estimated = false;
		} else {
			lines = [];
			estimated = false;
		}
		// quick-261125-cascade: interlude segments derive from the seeded chain, whichever
		// branch produced it (the LRC [start][end] gaps ARE the segments — one model).
		segments = interludesFromEditorLines(lines, duration);
	});
	$effect(() => {
		if (!open) seededFor = '';
	});

	// quick-261122-rules (GOLD: all user input is auto-cached; comment-drafts is the reference):
	// the working state is written on EVERY change — paste, keystroke, line text edit, import,
	// nudge / drag / stamp — and cleared only by Save. Close keeps it.
	function persistDraft() {
		if (!track?.uid) return;
		setInputDraft(
			lyricsDraftKey(track.uid),
			encodeLyricsDraft({ raw: rawText, lrc: lines.length ? serializeEditorLines(lines) : '', estimated })
		);
	}

	// STANDING RULE (Hector 2026-11-21, quick-261122-rules): follow the playing line UNLESS the
	// user is editing; editing suspends until the playback position is re-engaged (decisions in
	// services/lyrics-editor-follow.ts, guarded by lyrics-editor-follow.test.ts). Plain fields —
	// the render never reads them (the internal-guard convention).
	let following = true;
	let lastScrolled = -1;
	let linesEl = $state<HTMLElement | null>(null);
	function follow(ev: FollowEvent) {
		const was = following;
		following = nextFollow(following, ev);
		if (following && !was) {
			lastScrolled = -1;
			scrollToActive();
		}
	}
	function scrollToActive() {
		const target = followScrollTarget(following, preview.idx, lastScrolled, lines.length);
		if (target === null || !linesEl) return;
		// quick-261125-cascade graft: interlude rows are also .lines children, so the
		// lyric row for a LINE index is picked from the lyric rows only.
		const row = linesEl.querySelectorAll<HTMLElement>(':scope > .line:not(.interlude)')[target];
		if (!row) return;
		lastScrolled = target;
		// Scroll the bounded .lines list only (never scrollIntoView — it yanks every ancestor,
		// the NpLyrics anchor lesson) and centre the active row in it.
		linesEl.scrollTo({
			top: row.offsetTop - linesEl.clientHeight / 2 + row.clientHeight / 2,
			behavior: scrollBehavior()
		});
	}
	$effect(() => {
		void preview.idx;
		if (!open || step !== 'edit' || retime) return;
		scrollToActive();
	});
	// Re-engagement from OUTSIDE the editor too (lock-screen / Nowbar seek, pressing play).
	let lastSample: PlayheadSample | null = null;
	$effect(() => {
		const cur: PlayheadSample = {
			t: player.currentTime,
			wall: performance.now(),
			playing: player.playing
		};
		if (!open || !isCurrent) {
			lastSample = null;
			return;
		}
		const ev = classifyPlayhead(lastSample, cur);
		lastSample = cur;
		if (ev) follow(ev);
	});
	function onEditorFocusIn(e: FocusEvent) {
		const el = e.target as HTMLElement | null;
		if (el && el.matches('input, textarea')) follow('focus');
	}

	// The paste is the product: every keystroke re-derives the lines. LRC text keeps its real
	// timestamps; plain text is estimated on the spot. No button, no mode switch, no work asked.
	function onRawInput() {
		follow('edit');
		deriveLines();
		persistDraft();
	}
	function deriveLines() {
		if (!rawText.trim()) {
			lines = [];
			segments = [];
			estimated = false;
			return;
		}
		if (looksLikeLrc(rawText)) {
			// quick-261123-untimed: untimed lines typed into the raw box (headers above the
			// timed lines) survive the derive — stamped at the live playhead when this track
			// is the playing one (the real-time stamp), positional otherwise.
			lines = editorLinesFromLrc(rawText, duration, isCurrent ? player.currentTime : undefined);
			estimated = false;
		} else {
			lines = estimateLines(splitPastedText(rawText), duration);
			estimated = lines.length > 0;
		}
		segments = interludesFromEditorLines(lines, duration);
	}

	function onFile(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!f) return;
		void f.text().then((text) => {
			rawText = text;
			onRawInput();
		});
		(e.currentTarget as HTMLInputElement).value = '';
	}

	// quick-261123-cascade's cascadeAdjust retired by quick-261125-cascade: the ±0.1
	// Start/End buttons now dispatch through nudgeStart/nudgeEnd by mode (Single =
	// pinpoint nudgeEditorLine, Ripple = the train, Anchor = the pins); the pure
	// cascadeEditorLines helper stays in the service for its own tests.

	// Any hand adjustment promotes the draft out of the Estimated class (brief §2.2).
	function adjust(i: number, next: EditorLine, ev: FollowEvent = 'edit') {
		lines = lines.map((l, j) => (j === i ? next : l));
		estimated = false;
		follow(ev);
		persistDraft();
	}

	// quick-261125-cascade: mode dispatch for the ±0.1s boundary nudges. The pure
	// helpers own the maths; the component only routes by mode:
	//   start nudge — ripple: this line onward rides; anchor: line 1's start is the
	//     head pin (tail pin fixed, middles scale); otherwise Single.
	//   end nudge — ripple: the end IS the next line's chain joint, so the FOLLOWING
	//     lines ride (the pure draft shift chain-pulls this line's end along, or
	//     resizes the interlude sitting at the joint); anchor: the last line's end
	//     is the tail pin; otherwise Single.
	function applyDraft(r: { lines: EditorLine[]; segments: InterludeSegment[] }) {
		lines = r.lines;
		segments = r.segments;
		estimated = false;
		follow('edit');
		persistDraft();
	}
	function nudgeStart(i: number, delta: number) {
		const l = lines[i];
		if (mode === 'ripple') {
			applyDraft(rippleShiftDraft(lines, segments, i, delta, duration));
		} else if (mode === 'anchor' && i === 0 && lines.length > 1) {
			lines = anchorStretchLines(lines, l.start + delta, lines[lines.length - 1].end, duration);
			estimated = false;
			follow('edit');
			persistDraft();
		} else {
			adjust(i, nudgeEditorLine(l, 'start', delta, duration));
		}
	}
	function nudgeEnd(i: number, delta: number) {
		const l = lines[i];
		if (mode === 'ripple' && i < lines.length - 1) {
			applyDraft(rippleShiftDraft(lines, segments, i + 1, delta, duration));
		} else if (mode === 'anchor' && i === lines.length - 1 && lines.length > 1) {
			lines = anchorStretchLines(lines, lines[0].start, l.end + delta, duration);
			estimated = false;
			follow('edit');
			persistDraft();
		} else {
			adjust(i, nudgeEditorLine(l, 'end', delta, duration));
		}
	}

	// Interlude (blank-time) segment operations — insert before line `before`
	// (before == lines.length appends at the tail), resize by its end, delete.
	function addInterlude(before: number) {
		applyDraft(insertInterlude(lines, segments, before, DEFAULT_INTERLUDE_SEC, duration));
	}
	function resizeSeg(s: InterludeSegment, delta: number) {
		applyDraft(resizeInterlude(lines, segments, segments.indexOf(s), s.end + delta, duration));
	}
	function removeSeg(s: InterludeSegment) {
		applyDraft(deleteInterlude(lines, segments, segments.indexOf(s)));
	}
	/** Segments rendered immediately before line i (their end is the line's start). */
	function segsBefore(i: number): InterludeSegment[] {
		return segments.filter((s) => Math.abs(s.end - lines[i].start) < 0.05);
	}
	/** Segments after the last line (tail blank time). */
	const tailSegs = $derived(
		lines.length
			? segments.filter((s) => s.start >= lines[lines.length - 1].end - 0.05)
			: segments
	);

	// Timeline drag: pointer x → time across the track's duration; the segment moves whole,
	// snapped to 0.1s by moveEditorLine. Pointer capture keeps the drag alive off-element.
	let dragState: {
		i: number;
		startX: number;
		orig: EditorLine;
		origLines: EditorLine[];
		origSegments: InterludeSegment[];
		width: number;
	} | null = null;
	function segDown(e: PointerEvent, i: number) {
		if (!(duration > 0)) return;
		const tl = (e.currentTarget as HTMLElement).closest('.tl') as HTMLElement | null;
		if (!tl) return;
		dragState = {
			i,
			startX: e.clientX,
			orig: lines[i],
			origLines: lines,
			origSegments: segments,
			width: tl.clientWidth
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function segMove(e: PointerEvent) {
		if (!dragState || !(duration > 0) || dragState.width <= 0) return;
		const delta = ((e.clientX - dragState.startX) / dragState.width) * duration;
		// Ripple drags ride from the drag-start snapshot (not the live draft), so a
		// pointer stream applies ONE total delta — never a compounding sum.
		if (mode === 'ripple') {
			applyDraft(rippleShiftDraft(dragState.origLines, dragState.origSegments, dragState.i, delta, duration));
		} else {
			adjust(dragState.i, moveEditorLine(dragState.orig, delta, duration));
		}
	}
	function segUp() {
		dragState = null;
	}

	// quick-261122-ugcb4 — THE CHARACTER LAYER (B4, brief §2.4). Every line's characters are
	// ALREADY timed before the user looks: an equal share of the line's window each, in singing
	// order (charSpansFor's pre-allocation — estimate-first, recursively). Opening a line's
	// Characters row only lets the user adjust (改一改) a character's start at the one 0.1s
	// granularity — nudge or stamp at the playhead; the shared boundary with the previous
	// character moves with it. The first character is anchored to the line's own start.
	let charsOpen = $state(-1);
	let charSel = $state(1);
	function spansOf(l: EditorLine): TimedChar[] {
		return charSpansFor({ text: l.text, time: l.start, chars: l.chars }, l.end);
	}
	function toggleChars(i: number) {
		charsOpen = charsOpen === i ? -1 : i;
		charSel = 1;
	}
	function charAdjust(i: number, fn: (spans: TimedChar[], l: EditorLine) => TimedChar[]) {
		const l = lines[i];
		if (!l) return;
		adjust(i, { ...l, chars: fn(spansOf(l), l) });
	}
	function charsEven(i: number) {
		const l = lines[i];
		if (l) adjust(i, { start: l.start, end: l.end, text: l.text });
	}

	function stamp(i: number) {
		if (!isCurrent) return;
		// Ripple stamp = Hector's core case: line 1 tapped at the true singing start
		// re-aligns the WHOLE song by the same delta.
		if (mode === 'ripple') {
			applyDraft(rippleShiftDraft(lines, segments, i, player.currentTime - lines[i].start, duration));
		} else {
			adjust(i, stampEditorLine(lines[i], player.currentTime, duration), 'stamp');
		}
	}

	// quick-261122-tsfix — DEGENERATE STAMPS + RE-TIME. The predicate runs on the lines however
	// they were seeded (pin, community version, saved draft, fresh paste — the draft path is
	// covered because this is derived from `lines` itself, not from one seed branch). Detection
	// only OFFERS the repair; the user taps Distribute, or re-times by hand — never a silent
	// rewrite of what a source shipped.
	const degenerate = $derived(hasDegenerateStamps(lines, duration));
	function distributeEvenly() {
		// The estimator the plain-text paste path already uses; hand-set char spans do not
		// survive it (they re-derive as the estimator's even pre-allocation, like any paste).
		lines = estimateLines(lines.map((l) => l.text), duration);
		estimated = lines.length > 0;
		retime = false;
		retimeCursor = 0;
		follow('edit');
		persistDraft();
	}

	// Tap-to-sync re-time: while ON, one persistent button stamps the NEXT line at the
	// playhead and chains the previous line's end shut (stampNextInSequence) — one tap per
	// line in singing order rebuilds a broken timing in a single play-through. Only for the
	// playing track (the stamp button's isCurrent gate, same reason).
	let retime = $state(false);
	let retimeCursor = $state(0);
	function toggleRetime() {
		retime = !retime;
		if (retime) retimeCursor = 0;
	}
	function stampNext() {
		if (!isCurrent || retimeCursor >= lines.length) return;
		const r = stampNextInSequence(lines, retimeCursor, player.currentTime, duration);
		lines = r.lines;
		retimeCursor = r.cursor;
		estimated = false;
		follow('stamp');
		persistDraft();
		if (retimeCursor >= lines.length) retime = false; // the last tap completes the mode itself
	}
	// While re-timing, the cursor row owns the list scroll (the playhead-follow scroll stands
	// down — the two would fight over the same list).
	$effect(() => {
		void retimeCursor;
		if (!open || !retime || !linesEl) return;
		const row = linesEl.querySelectorAll<HTMLElement>(':scope > .line:not(.interlude)')[retimeCursor];
		if (!row) return;
		linesEl.scrollTo({
			top: row.offsetTop - linesEl.clientHeight / 2 + row.clientHeight / 2,
			behavior: scrollBehavior()
		});
	});

	// Live preview: the line being sung right now (this editor's draft, the real pane's maths —
	// activeLineAt is the one shared scan). Tapping a row seeks, like the pane itself.
	const preview = $derived(
		isCurrent && lines.length
			? activeLineAt(editorLinesToLyricLines(lines), player.currentTime)
			: { idx: -1, time: -1 }
	);
	function seekLine(l: EditorLine) {
		if (!isCurrent) return;
		const frac = lineSeekFraction(l.start, player.duration, 0);
		if (frac !== null) player.seekFraction(frac);
		follow('seek');
	}

	function fmt(sec: number): string {
		const s = Math.max(0, sec);
		const m = Math.floor(s / 60);
		const r = (s - m * 60).toFixed(1).padStart(4, '0');
		return `${m}:${r}`;
	}

	// quick-261122-ugcb3 (UGC B3) — SHARE WITH EVERYONE. The local pin ALWAYS lands first (the
	// Phase 1 contract: a save is instant and never waits on the network). When sharing is on, the
	// same text then goes to /api/lyrics behind check layer 3 — a signed-in account + Turnstile — and
	// THE CHECK; on acceptance the server's canonical text replaces the local pin (own accepted
	// submission auto-pins) and every listener gets it immediately. Default ON for a signed-in user
	// (users are lazy — sharing is not an extra step); anonymous users save locally and see how to
	// share. A failed share keeps the editor open on this step with the reason, the local copy kept.
	const signedIn = $derived(auth.user !== null);
	let share = $state(true);
	let token = $state('');
	let gate = $state<{ reset: () => void } | null>(null);
	let busy = $state(false);
	let shareErr = $state<{ err: SubmitErr | 'verify'; reason?: LyricCheckErr } | null>(null);
	const sharing = $derived(signedIn && share);
	const fetcher = (path: string, init?: RequestInit) => auth.authedFetch(path, init ?? {});

	$effect(() => {
		if (!open) {
			shareErr = null;
			busy = false;
		}
	});

	const errKey = (e: NonNullable<typeof shareErr>) =>
		e.err === 'check'
			? (`community.check.${e.reason ?? 'empty'}` as const)
			: e.err === 'slow-down'
				? 'comments.slowDown'
				: e.err === 'verify'
					? 'comments.errVerify'
					: e.err === 'signin'
						? 'community.signin'
						: e.err === 'invalid'
							? 'comments.invalid'
							: 'comments.unavailable';

	async function save() {
		if (!track?.uid || !lines.length || busy) return;
		const uid = track.uid;
		const lrc = serializeEditorLines(lines);
		pinLyrics(uid, lrc);
		clearInputDraft(lyricsDraftKey(track.uid)); // the draft's ONE deliberate ending (quick-261122-rules)
		if (!sharing) {
			toast.show(t('toast.lyricsPinned'));
			onsaved?.();
			onclose();
			return;
		}
		busy = true;
		shareErr = null;
		const k = await lyricsSongKey(artist, title);
		if (!k) {
			busy = false;
			shareErr = { err: 'unavailable' };
			return;
		}
		const r = await communityLyrics.submit(uid, fetcher, {
			k,
			lrc,
			estimated,
			title,
			artist,
			duration,
			token
		});
		// Tokens are single-use: reset after EVERY attempt, success or failure.
		gate?.reset();
		busy = false;
		if (r.ok) {
			pinLyrics(uid, r.lrc);
			toast.show(t('community.shared'));
			onsaved?.();
			onclose();
			return;
		}
		shareErr = { err: r.err, reason: r.reason };
	}
</script>

{#if open && track}
	<button class="scrim" aria-label={t('menu.close')} onclick={onclose}></button>
	<div class="sheet" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose }} use:focusTrap onfocusin={onEditorFocusIn}>
		<div class="head row">
			<span>{t('lyricsEditor.title')}</span>
			<button class="x" aria-label={t('menu.close')} onclick={onclose} use:tapBounce><X size={18} /></button>
		</div>

		{#if step === 'edit'}
			<textarea
				class="raw"
				rows="5"
				bind:value={rawText}
				oninput={onRawInput}
				placeholder={t('lyricsEditor.pasteHint')}
				aria-label={t('lyricsEditor.pasteHint')}
			></textarea>
			<div class="tools">
				<button type="button" class="tool" aria-label={t('lyricsEditor.import')} title={t('lyricsEditor.import')} onclick={() => fileEl?.click()} use:tapBounce><FileUp size={14} /></button>
				<input class="file" type="file" accept=".lrc,.txt,text/plain" bind:this={fileEl} onchange={onFile} />
				{#if lines.length}<span class="count">{t('lyricsEditor.linesCount', { count: lines.length })}</span>{/if}
				{#if estimated}<span class="badge">{t('lyricsEditor.estimated')}</span>{/if}
				{#if isCurrent && lines.length}
					<button type="button" class="tool" class:on={retime} aria-pressed={retime} aria-label={t('lyricsEditor.retime')} title={t('lyricsEditor.retime')} onclick={toggleRetime} use:tapBounce><Clock size={12} /></button>
				{/if}
				<!-- quick-261125-cascade: the cascade mode toggle (chain = Ripple-Train).
				     Icon + micro-label per the 2026-11-25 dense-controls rule. -->
				{#if lines.length}
					<div class="modes" role="group" aria-label={t('lyricsEditor.title')}>
						<button type="button" class="mode" class:on={mode === 'single'} onclick={() => (mode = 'single')} use:tapBounce><Unlink size={12} /> {t('lyricsEditor.modeSingle')}</button>
						<button type="button" class="mode" class:on={mode === 'ripple'} onclick={() => (mode = 'ripple')} use:tapBounce><Link size={12} /> {t('lyricsEditor.modeRipple')}</button>
						<button type="button" class="mode" class:on={mode === 'anchor'} onclick={() => (mode = 'anchor')} use:tapBounce><Anchor size={12} /> {t('lyricsEditor.modeAnchor')}</button>
					</div>
					<button type="button" class="tool" onclick={() => addInterlude(0)} use:tapBounce><Plus size={12} /> {t('lyricsEditor.addInterlude')}</button>
				{/if}
			</div>

			{#if degenerate && !retime}
				<div class="warn" role="alert">
					<p>{t('lyricsEditor.degenerate', { time: fmt(duration) })}</p>
					<button type="button" class="tool" aria-label={t('lyricsEditor.distribute')} title={t('lyricsEditor.distribute')} onclick={distributeEvenly} use:tapBounce><AlignVerticalDistributeCenter size={14} /></button>
				</div>
			{/if}

			{#if retime}
				<div class="retimebar">
					<button type="button" class="primary stampnext" onclick={stampNext} disabled={retimeCursor >= lines.length} use:tapBounce>
						<span class="sn-lab"><Clock size={14} /> {t('lyricsEditor.stampNext')}</span>
						{#if lines[retimeCursor]}<span class="sn-txt">{lines[retimeCursor].text}</span>{/if}
					</button>
					<span class="count">{retimeCursor}/{lines.length}</span>
				</div>
			{/if}

			<!-- quick-261125-cascade: an interlude row is a SPINNER ONLY in the lyric
			     position — no word ever sits where a lyric goes (2026-11-23 doctrine).
			     Times/duration are editor-side info beside it, never lyric text. -->
			{#snippet segRow(s: InterludeSegment)}
				<div class="line interlude" data-interlude role="group" aria-label="{t('lyricsEditor.blankTime')} {fmt(s.start)} – {fmt(s.end)}">
					<div class="segrow">
						<LoaderCircle size={14} class="spin" />
						<span class="seginfo">{fmt(s.start)} – {fmt(s.end)} · {(s.end - s.start).toFixed(1)}s</span>
						<button type="button" class="nb" onclick={() => resizeSeg(s, -0.1)} use:tapBounce>−0.1</button>
						<button type="button" class="nb" onclick={() => resizeSeg(s, 0.1)} use:tapBounce>+0.1</button>
						<button type="button" class="nb" aria-label={t('lyricsEditor.removeInterlude')} onclick={() => removeSeg(s)} use:tapBounce><Trash2 size={12} /></button>
					</div>
				</div>
			{/snippet}

			<div class="lines" bind:this={linesEl}>
				{#each lines as l, i (i)}
					{#each segsBefore(i) as s (s.start)}
						{@render segRow(s)}
					{/each}
					<div class="line" class:active={i === preview.idx} class:next={retime && i === retimeCursor}>
						<input class="txt" bind:value={lines[i].text} oninput={(e) => { lines[i].text = e.currentTarget.value; follow('edit'); persistDraft(); }} aria-label={l.text} />
						{#if duration > 0}
							<div class="tl">
								<div
									class="seg"
									style="left:{(l.start / duration) * 100}%;width:{Math.max(1.5, ((l.end - l.start) / duration) * 100)}%"
									onpointerdown={(e) => segDown(e, i)}
									onpointermove={segMove}
									onpointerup={segUp}
									role="slider"
									aria-label={t('lyricsEditor.start')}
									aria-valuemin={0}
									aria-valuemax={Math.round(duration)}
									aria-valuenow={Math.round(l.start)}
									tabindex="0"
									onkeydown={(e) => {
										if (e.key === 'ArrowLeft') {
											if (mode === 'ripple') applyDraft(rippleShiftDraft(lines, segments, i, -0.1, duration));
											else adjust(i, moveEditorLine(l, -0.1, duration));
										}
										if (e.key === 'ArrowRight') {
											if (mode === 'ripple') applyDraft(rippleShiftDraft(lines, segments, i, 0.1, duration));
											else adjust(i, moveEditorLine(l, 0.1, duration));
										}
									}}
								></div>
							</div>
						{/if}
						<div class="times">
							{#if retime && i === retimeCursor}<span class="badge">{t('lyricsEditor.nextLine')}</span>{/if}
							<span class="lab">{t('lyricsEditor.start')}</span>
							<button type="button" class="nb" onclick={() => nudgeStart(i, -0.1)} use:tapBounce>−0.1</button>
							<button type="button" class="tm" onclick={() => seekLine(l)} use:tapBounce>{fmt(l.start)}</button>
							<button type="button" class="nb" onclick={() => nudgeStart(i, 0.1)} use:tapBounce>+0.1</button>
							<span class="lab">{t('lyricsEditor.end')}</span>
							<button type="button" class="nb" onclick={() => nudgeEnd(i, -0.1)} use:tapBounce>−0.1</button>
							<span class="tm">{fmt(l.end)}</span>
							<button type="button" class="nb" onclick={() => nudgeEnd(i, 0.1)} use:tapBounce>+0.1</button>
							{#if isCurrent}
								<button type="button" class="nb stamp" aria-label={t('lyricsEditor.stamp')} title={t('lyricsEditor.stamp')} onclick={() => stamp(i)} use:tapBounce><Clock size={12} /></button>
							{/if}
							<button type="button" class="nb" class:on={charsOpen === i} aria-expanded={charsOpen === i} aria-label={t('lyricsEditor.chars')} title={t('lyricsEditor.chars')} onclick={() => toggleChars(i)} use:tapBounce><Type size={12} /></button>
							<button type="button" class="nb" aria-label={t('lyricsEditor.addInterlude')} onclick={() => addInterlude(i + 1)} use:tapBounce><Plus size={12} /></button>
						</div>
						{#if charsOpen === i}
							{@const spans = spansOf(l)}
							<div class="chars" role="group" aria-label={t('lyricsEditor.chars')}>
								{#each spans as c, ci (ci)}
									<button
										type="button"
										class="chip"
										class:sel={charSel === ci}
										style="--p:{isCurrent ? charFillAt(c, player.currentTime) : 0}"
										onclick={() => (charSel = ci)}
										aria-pressed={charSel === ci}
										><span class="cg">{c.text}</span><span class="ct">{fmt(c.start)}</span></button
									>
								{/each}
							</div>
							<div class="times">
								<span class="lab">{t('lyricsEditor.charStart')}</span>
								<button type="button" class="nb" disabled={charSel < 1} onclick={() => charAdjust(i, (sp, ln) => nudgeCharStart(sp, charSel, -0.1, ln.start, ln.end))} use:tapBounce>−0.1</button>
								<span class="tm">{fmt(spans[charSel]?.start ?? l.start)}</span>
								<button type="button" class="nb" disabled={charSel < 1} onclick={() => charAdjust(i, (sp, ln) => nudgeCharStart(sp, charSel, 0.1, ln.start, ln.end))} use:tapBounce>+0.1</button>
								{#if isCurrent}
									<button type="button" class="nb stamp" disabled={charSel < 1} aria-label={t('lyricsEditor.stamp')} title={t('lyricsEditor.stamp')} onclick={() => charAdjust(i, (sp, ln) => setCharStart(sp, charSel, Math.round(player.currentTime * 10) / 10, ln.start, ln.end))} use:tapBounce><Clock size={12} /></button>
								{/if}
								{#if l.chars}
									<button type="button" class="nb" aria-label={t('lyricsEditor.charsEven')} title={t('lyricsEditor.charsEven')} onclick={() => charsEven(i)} use:tapBounce><AlignHorizontalDistributeCenter size={12} /></button>
								{/if}
							</div>
							{#if !l.chars}<p class="hint">{t('lyricsEditor.charsHint')}</p>{/if}
						{/if}
					</div>
				{/each}
				{#each tailSegs as s (s.start)}
					{@render segRow(s)}
				{/each}
			</div>

			{#if lines.length}
				<button type="button" class="primary" aria-label={t('lyricsEditor.review')} title={t('lyricsEditor.review')} onclick={() => (step = 'confirm')} use:tapBounce><Eye size={16} /></button>
			{/if}
		{:else}
			<!-- Identity confirmation (brief §2.2): the lyric attaches to the confirmed clean
			     identity, not to one source's messy title. Phase 1 saves locally by uid; the
			     songKey readout is the identity Phase 2's community record will key on. -->
			<label class="fld"><span>{t('tags.fieldTitle')}</span><input bind:value={title} /></label>
			<label class="fld"><span>{t('tags.fieldArtist')}</span><input bind:value={artist} /></label>
			<p class="hint">{t('lyricsEditor.confirmHint')}</p>
			<!-- quick-261122-ugcb3: share with everyone (community B3). -->
			{#if signedIn}
				<label class="share">
					<input type="checkbox" bind:checked={share} />
					<span>{t('community.shareToggle')}</span>
				</label>
				{#if share}
					<p class="hint">{t('community.shareHint')}</p>
					<TurnstileGate bind:this={gate} bind:token onunavailable={() => (shareErr = { err: 'verify' })} />
				{/if}
			{:else}
				<p class="hint">{t('community.signinToShare')} <a href="/settings/account" onclick={onclose}>{t('community.signinLink')}</a></p>
			{/if}
			{#if shareErr}<p class="err" role="alert">{t(errKey(shareErr))}</p>{/if}
			<p class="hint">{t('lyricsEditor.linesCount', { count: lines.length })}{#if estimated} · {t('lyricsEditor.estimated')}{/if} · {identity}</p>
			<div class="row2">
				<button type="button" class="tool" aria-label={t('lyricsEditor.back')} title={t('lyricsEditor.back')} onclick={() => (step = 'edit')} use:tapBounce><ChevronLeft size={14} /></button>
				<button
					type="button"
					class="primary grow"
					onclick={save}
					disabled={busy || (sharing && !token)}
					use:tapBounce
					aria-label={sharing ? (token ? t('community.saveAndShare') : t('community.verifying')) : t('lyricsEditor.save')}
					><Check size={16} /></button
				>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* Sheet chrome mirrors the TrackMenu sub-sheet idiom (same scrim / fly / drag-close family),
	   one step higher so it can open over the menu that launched it. */
	.scrim { position: fixed; inset: 0; z-index: 90; background: rgba(0,0,0,0.45); border: none; }
	.sheet { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 91; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto; }
	.head { font-size: calc(0.8125rem * var(--fs-title, 1)); color: var(--color-text-muted); padding: 8px 10px; }
	.head.row { display: flex; align-items: center; justify-content: space-between; }
	.x { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; }
	.raw, .fld input { width: 100%; box-sizing: border-box; background: var(--color-surface); color: var(--color-text); border: none; border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 0.875rem; }
	.raw { resize: vertical; }
	.tools { display: flex; align-items: center; gap: 8px; padding: 6px 2px; flex-wrap: wrap; }
	.tool { background: none; border: 1px solid var(--color-border); border-radius: 999px; color: var(--color-text); font-size: 0.8125rem; padding: 6px 12px; min-height: 32px; cursor: pointer; }
	.file { display: none; }
	.count { color: var(--color-text-muted); font-size: 0.75rem; }
	.badge { color: var(--color-primary); font-size: 0.75rem; border: 1px solid var(--color-primary); border-radius: 999px; padding: 1px 8px; }
	.lines { position: relative; display: flex; flex-direction: column; gap: 8px; max-height: 46vh; overflow-y: auto; padding: 2px; }
	.line { background: var(--color-surface); border: 1px solid transparent; border-radius: 10px; padding: 6px 8px; }
	.line.active { border-color: var(--color-primary); }
	.txt { width: 100%; box-sizing: border-box; background: none; border: none; color: var(--color-text); font: inherit; font-size: 0.875rem; padding: 2px 0; }
	.tl { position: relative; height: 22px; background: var(--color-bg); border-radius: 6px; margin: 4px 0; touch-action: none; }
	.seg { position: absolute; top: 3px; bottom: 3px; background: var(--color-primary); opacity: 0.75; border-radius: 4px; cursor: grab; touch-action: none; }
	.times { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: 0.75rem; color: var(--color-text-muted); }
	.lab { min-width: 30px; }
	.nb { background: none; border: 1px solid var(--color-border); border-radius: 999px; color: var(--color-text); font: inherit; padding: 2px 7px; min-height: 24px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; }
	.tm { background: none; border: none; color: var(--color-text); font: inherit; font-variant-numeric: tabular-nums; min-width: 40px; cursor: pointer; }
	.primary { width: 100%; background: var(--color-primary); color: var(--color-on-primary); border: none; border-radius: 999px; padding: 10px 14px; font-size: 0.875rem; cursor: pointer; margin-top: 8px; }
	.fld { display: block; padding: 4px 2px; font-size: 0.75rem; color: var(--color-text-muted); }
	.fld span { display: block; margin-bottom: 4px; }
	.hint { color: var(--color-text-muted); font-size: 0.75rem; margin: 6px 2px 0; overflow-wrap: anywhere; }
	.row2 { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
	.row2 .primary { margin-top: 0; }
	.grow { flex: 1; }
	.primary:disabled { opacity: 0.55; cursor: default; }
	/* quick-261122-ugcb4: character chips. The chip's own fill previews the per-character sweep
	   (sung share in primary), so a nudge is SEEN against the playing song. */
	.nb.on { border-color: var(--color-primary); color: var(--color-primary); }
	.nb:disabled { opacity: 0.4; cursor: default; }
	.chars { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 0 4px; }
	.chip { display: inline-flex; flex-direction: column; align-items: center; min-width: 36px; min-height: 44px; padding: 3px 5px; border-radius: 8px; border: 1px solid var(--color-border); color: var(--color-text); font: inherit; cursor: pointer; background: linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 28%, transparent) calc(var(--p, 0) * 100%), var(--color-bg) calc(var(--p, 0) * 100%)); }
	.chip.sel { border-color: var(--color-primary); box-shadow: 0 0 0 1px var(--color-primary) inset; }
	.cg { font-size: 1rem; line-height: 1.2; white-space: pre; }
	.ct { font-size: 0.625rem; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
	/* quick-261122-tsfix: degenerate-stamp banner + re-time bar + the next-to-stamp cursor row. */
	.warn { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border: 1px solid var(--color-danger-text); border-radius: 10px; padding: 8px 10px; margin: 2px 2px 6px; }
	.warn p { margin: 0; font-size: 0.8125rem; flex: 1; min-width: 200px; }
	.retimebar { display: flex; align-items: center; gap: 8px; padding: 0 2px 6px; }
	.stampnext { margin-top: 0; flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 8px; }
	.sn-lab { display: inline-flex; align-items: center; gap: 4px; flex: none; }
	.sn-txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tool.on { border-color: var(--color-primary); color: var(--color-primary); }
	.line.next { border-color: var(--color-text-muted); border-style: dashed; }
	.share { display: flex; align-items: center; gap: 8px; padding: 8px 2px 0; font-size: 0.8125rem; color: var(--color-text); }
	.share input { width: 18px; height: 18px; accent-color: var(--color-primary); }
	.err { color: var(--color-danger-text); font-size: 0.75rem; margin: 6px 2px 0; }
	.hint a { color: var(--color-primary); }
	/* quick-261125-cascade: mode toggle + interlude rows. */
	.modes { display: inline-flex; gap: 4px; }
	.mode { display: inline-flex; align-items: center; gap: 3px; background: none; border: 1px solid var(--color-border); border-radius: 999px; color: var(--color-text-muted); font: inherit; font-size: 0.75rem; padding: 4px 9px; min-height: 32px; cursor: pointer; }
	.mode.on { color: var(--color-primary); border-color: var(--color-primary); }
	.interlude { border-style: dashed; }
	.segrow { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--color-text-muted); padding: 2px 0; }
	.seginfo { font-variant-numeric: tabular-nums; }
	.segrow :global(.spin) { animation: om-spin 1.2s linear infinite; color: var(--color-primary); flex: none; }
	@keyframes om-spin { to { transform: rotate(360deg); } }
</style>
