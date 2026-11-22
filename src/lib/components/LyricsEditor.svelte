<script lang="ts">
	import { fly } from 'svelte/transition';
	import { X, Clock } from '@lucide/svelte';
	import type { Track } from '$lib/sources/types';
	import { t } from '$lib/i18n';
	import { player } from '$lib/stores/player.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { pinLyrics } from '$lib/stores/lyric-pins.svelte';
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
		type EditorLine
	} from '$lib/services/lyrics-editor';

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
			lines = editorLinesFromLrc(initialLrc, duration);
			estimated = false;
		} else {
			lines = [];
			estimated = false;
		}
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
		const row = linesEl.children[target] as HTMLElement | undefined;
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
		if (!open || step !== 'edit') return;
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
			estimated = false;
			return;
		}
		if (looksLikeLrc(rawText)) {
			lines = editorLinesFromLrc(rawText, duration);
			estimated = false;
		} else {
			lines = estimateLines(splitPastedText(rawText), duration);
			estimated = lines.length > 0;
		}
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

	// Any hand adjustment promotes the draft out of the Estimated class (brief §2.2).
	function adjust(i: number, next: EditorLine, ev: FollowEvent = 'edit') {
		lines = lines.map((l, j) => (j === i ? next : l));
		estimated = false;
		follow(ev);
		persistDraft();
	}

	// Timeline drag: pointer x → time across the track's duration; the segment moves whole,
	// snapped to 0.1s by moveEditorLine. Pointer capture keeps the drag alive off-element.
	let dragState: { i: number; startX: number; orig: EditorLine; width: number } | null = null;
	function segDown(e: PointerEvent, i: number) {
		if (!(duration > 0)) return;
		const tl = (e.currentTarget as HTMLElement).closest('.tl') as HTMLElement | null;
		if (!tl) return;
		dragState = { i, startX: e.clientX, orig: lines[i], width: tl.clientWidth };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function segMove(e: PointerEvent) {
		if (!dragState || !(duration > 0) || dragState.width <= 0) return;
		const delta = ((e.clientX - dragState.startX) / dragState.width) * duration;
		adjust(dragState.i, moveEditorLine(dragState.orig, delta, duration));
	}
	function segUp() {
		dragState = null;
	}

	function stamp(i: number) {
		if (!isCurrent) return;
		adjust(i, stampEditorLine(lines[i], player.currentTime, duration), 'stamp');
	}

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

	function save() {
		if (!track?.uid || !lines.length) return;
		pinLyrics(track.uid, serializeEditorLines(lines));
		clearInputDraft(lyricsDraftKey(track.uid)); // the draft's ONE deliberate ending
		toast.show(t('toast.lyricsPinned'));
		onsaved?.();
		onclose();
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
				<button type="button" class="tool" onclick={() => fileEl?.click()} use:tapBounce>{t('lyricsEditor.import')}</button>
				<input class="file" type="file" accept=".lrc,.txt,text/plain" bind:this={fileEl} onchange={onFile} />
				{#if lines.length}<span class="count">{t('lyricsEditor.linesCount', { count: lines.length })}</span>{/if}
				{#if estimated}<span class="badge">{t('lyricsEditor.estimated')}</span>{/if}
			</div>

			<div class="lines" bind:this={linesEl}>
				{#each lines as l, i (i)}
					<div class="line" class:active={i === preview.idx}>
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
										if (e.key === 'ArrowLeft') adjust(i, moveEditorLine(l, -0.1, duration));
										if (e.key === 'ArrowRight') adjust(i, moveEditorLine(l, 0.1, duration));
									}}
								></div>
							</div>
						{/if}
						<div class="times">
							<span class="lab">{t('lyricsEditor.start')}</span>
							<button type="button" class="nb" onclick={() => adjust(i, nudgeEditorLine(l, 'start', -0.1, duration))} use:tapBounce>−0.1</button>
							<button type="button" class="tm" onclick={() => seekLine(l)} use:tapBounce>{fmt(l.start)}</button>
							<button type="button" class="nb" onclick={() => adjust(i, nudgeEditorLine(l, 'start', 0.1, duration))} use:tapBounce>+0.1</button>
							<span class="lab">{t('lyricsEditor.end')}</span>
							<button type="button" class="nb" onclick={() => adjust(i, nudgeEditorLine(l, 'end', -0.1, duration))} use:tapBounce>−0.1</button>
							<span class="tm">{fmt(l.end)}</span>
							<button type="button" class="nb" onclick={() => adjust(i, nudgeEditorLine(l, 'end', 0.1, duration))} use:tapBounce>+0.1</button>
							{#if isCurrent}
								<button type="button" class="nb stamp" onclick={() => stamp(i)} use:tapBounce><Clock size={12} /> {t('lyricsEditor.stamp')}</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			{#if lines.length}
				<button type="button" class="primary" onclick={() => (step = 'confirm')} use:tapBounce>{t('lyricsEditor.review')}</button>
			{/if}
		{:else}
			<!-- Identity confirmation (brief §2.2): the lyric attaches to the confirmed clean
			     identity, not to one source's messy title. Phase 1 saves locally by uid; the
			     songKey readout is the identity Phase 2's community record will key on. -->
			<label class="fld"><span>{t('tags.fieldTitle')}</span><input bind:value={title} /></label>
			<label class="fld"><span>{t('tags.fieldArtist')}</span><input bind:value={artist} /></label>
			<p class="hint">{t('lyricsEditor.confirmHint')}</p>
			<p class="hint">{t('lyricsEditor.linesCount', { count: lines.length })}{#if estimated} · {t('lyricsEditor.estimated')}{/if} · {identity}</p>
			<div class="row2">
				<button type="button" class="tool" onclick={() => (step = 'edit')} use:tapBounce>{t('lyricsEditor.back')}</button>
				<button type="button" class="primary grow" onclick={save} use:tapBounce>{t('lyricsEditor.save')}</button>
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
</style>
