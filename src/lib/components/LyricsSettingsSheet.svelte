<!-- quick-261120-lsheet (Hector 2026-11-20): THE lyrics settings sheet — every
     lyrics revision lives here, in the Now Playing lyrics pane, and NOWHERE else
     (the Settings translation page's lyrics controls were removed in the same
     change; one function, one home). Opened by the sliders button at the right
     end of the NP tab row (lyrics tab only).

     Groups (spec ~/workspace/openmusic-lyrics-sheet-spec.md):
       1. 來源 Source — current source + the Fix-lyrics picker as a second level
          (same collectLyricCandidates / pin store seam as the track menu's
          picker) + the entry into the ONE shared LyricsEditor. ORIGINAL-language
          sources only: candidates are upstream LRCs; a provider-bundled human
          translation is never a source (MT doctrine 2026-11-20) — translation
          here is always machine-generated.
       2. 翻譯 Translation — settings.lyricsLang + settings.translateMode (the
          existing store fields, unchanged semantics) + the dedupe toggle
          (settings.lyricsDedupeIdentical, default ON).
       3. 顯示行 Lines shown — the two paren toggles.
       4. 同步 Timing — the lyric-offset fixer at the spec's ±0.1s step, writing
          the existing shared offset store; per-line timing routes to the editor.

     Sheet idiom copied from TrackMenu's sub-sheets (scrim + fly + dragClose +
     focusTrap + --radius-sheet family). All controls write the settings store
     and save() immediately, exactly as the old Settings page did. -->
<script lang="ts">
	import { fly } from 'svelte/transition';
	import { Check, ChevronLeft, ChevronRight, Mic2, Pencil, Sparkles, X } from '@lucide/svelte';
	import { t } from '$lib/i18n';
	import { settings, type LyricsLang, type TranslateMode } from '$lib/stores/settings.svelte';
	import { SOURCES } from '$lib/sources/registry';
	import { names } from '$lib/stores/names.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { collectLyricCandidates, type LyricCandidate } from '$lib/services/catalog';
	import { combinedSignal } from '$lib/services/abort-signal';
	import { parseLyrics } from '$lib/stores/lyric-script.svelte';
	import { readLyrics, pinLyrics, unpinLyrics } from '$lib/stores/lyric-pins.svelte';
	import { player } from '$lib/stores/player.svelte';
	// quick-261120-gsync: the ONE shared gesture file-tag writer (TrackMenu calls it too).
	import { writeTagsForGesture } from '$lib/services/gesture-tag-sync';
	import {
		getEffectiveLyricOffset,
		setLyricOffset,
		resetLyricOffset,
		scheduleLyricOffsetVote
	} from '$lib/stores/lyric-offset.svelte';
	import { formatLyricOffset } from '$lib/services/lrc';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import type { Track } from '$lib/sources/types';
	import MenuActionButton from '$lib/components/MenuActionButton.svelte';
	import SettingPicker from '$lib/components/SettingPicker.svelte';
	import SettingToggle from '$lib/components/SettingToggle.svelte';
	import LyricsEditor from '$lib/components/LyricsEditor.svelte';

	let {
		open = false,
		onclose,
		track
	}: {
		open?: boolean;
		onclose: () => void;
		track: Track | null;
	} = $props();

	// The language options mirror the Settings translation page's list verbatim:
	// 'off'/'auto' are chrome (labels via t()), every other label is the language's
	// own endonym — the same in every UI language, so it needs no dictionary entry.
	const langs: { v: 'auto' | LyricsLang; label: string }[] = [
		{ v: 'off', label: 'Off' },
		{ v: 'auto', label: 'Auto' },
		{ v: 'zh-Hant', label: '繁體中文' },
		{ v: 'zh-Hans', label: '简体中文' },
		{ v: 'en', label: 'English' },
		{ v: 'ja', label: '日本語' },
		{ v: 'ko', label: '한국어' },
		{ v: 'es', label: 'Español' },
		{ v: 'fr', label: 'Français' },
		{ v: 'de', label: 'Deutsch' },
		{ v: 'pt', label: 'Português' },
		{ v: 'it', label: 'Italiano' },
		{ v: 'ru', label: 'Русский' },
		{ v: 'tr', label: 'Türkçe' },
		{ v: 'ar', label: 'العربية' },
		{ v: 'hi', label: 'हिन्दी' },
		{ v: 'id', label: 'Bahasa Indonesia' },
		{ v: 'vi', label: 'Tiếng Việt' },
		{ v: 'th', label: 'ไทย' }
	];
	const langOptions = $derived(
		langs.map((l) => ({
			v: l.v,
			label: l.v === 'off' ? t('settings.optOff') : l.v === 'auto' ? t('settings.bioAuto') : l.label
		}))
	);
	const modeOptions = $derived([
		{ v: 'replace' as TranslateMode, label: t('settings.optReplace') },
		{ v: 'below' as TranslateMode, label: t('settings.optShowBelow') }
	]);

	// --- source level ------------------------------------------------------------
	let level = $state<'main' | 'source'>('main');
	let candidates = $state<LyricCandidate[]>([]);
	let loading = $state(false);
	let gen = 0;
	let ac: AbortController | null = null;

	const pinnedLrc = $derived(track ? readLyrics(track) : null);
	const hasPin = $derived(!!track && pinnedLrc !== (track.lrc ?? null));

	async function openSource() {
		if (!track?.uid) return;
		level = 'source';
		const g = ++gen;
		ac?.abort();
		const ctrl = new AbortController();
		ac = ctrl;
		candidates = [];
		loading = true;
		const list = await collectLyricCandidates(
			track.artist,
			track.title,
			combinedSignal(15_000, ctrl.signal)
		);
		if (g !== gen || ctrl.signal.aborted) return;
		candidates = list;
		loading = false;
	}
	function pickCandidate(lrc: string) {
		if (!track?.uid) return;
		pinLyrics(track.uid, lrc);
		toast.show(t('toast.lyricsPinned'));
		// quick-261120-gpick: the sheet's pick is FULLY the track menu's pick now —
		// the pin also lands in the downloaded FILE through the ONE shared gesture
		// writer (TrackMenu.pickLyrics has written it since F3; this pick was the
		// one caller that silently skipped the file, so a sheet pick and a menu
		// pick for the same song left the file in different states). Same gates,
		// same failure toast; the service probes the blob itself — this sheet
		// never probed one on open (the same binding as useAutomatic below).
		writeTagsForGesture(track, { lyrics: lrc }, { onFailure: () => toast.show(t('toast.tagsFailed')) });
		level = 'main';
	}
	function useAutomatic() {
		if (!track?.uid) return;
		unpinLyrics(track.uid);
		// quick-261120-gsync: FULLY the track menu's reset now — the unpin also re-syncs
		// the downloaded FILE through the ONE shared gesture writer, with the post-unpin
		// fallback read (the track's own lrc). When the fallback is EMPTY there is no
		// write at all: the codec has no clear verb (an absent/empty `lyrics` field means
		// "leave the file's lyrics alone", retag.ts D-4), so the file keeps its embedded
		// LRC until a non-empty lyric set is written over it. The service probes the
		// blob itself — this sheet never probed one on open.
		const fallback = readLyrics(player.current?.uid === track.uid ? player.current : track);
		if (fallback) writeTagsForGesture(track, { lyrics: fallback }, { onFailure: () => toast.show(t('toast.tagsFailed')) });
		toast.show(t('menu.lyricsAuto'));
		level = 'main';
	}

	// --- editor ------------------------------------------------------------------
	let editorOpen = $state(false);
	function openEditor() {
		onclose();
		editorOpen = true;
	}

	// --- offset (group 4) ----------------------------------------------------------
	const offset = $derived(getEffectiveLyricOffset(track?.uid));
	function nudge(delta: number) {
		const uid = track?.uid;
		if (!uid) return;
		setLyricOffset(uid, offset + delta);
		scheduleLyricOffsetVote(uid, readLyrics(track) ?? '');
	}
	function resetOffset() {
		const uid = track?.uid;
		if (uid) resetLyricOffset(uid);
	}

	$effect(() => {
		if (!open) {
			level = 'main';
			ac?.abort();
		}
	});
</script>

{#if open && track}
	<button class="scrim" aria-label={t('menu.close')} onclick={onclose}></button>
	<div
		class="sheet"
		role="dialog"
		aria-modal="true"
		aria-label={level === 'source' ? t('menu.fixLyrics') : t('lyricsSettings.title')}
		transition:fly={{ y: 240, duration: 200 }}
		use:dragClose={{ onclose }}
		use:focusTrap
	>
		<div class="sheet-head">
			{#if level === 'source'}
				<button class="back" aria-label={t('lyricsEditor.back')} onclick={() => (level = 'main')} use:tapBounce><ChevronLeft size={18} /></button>
				<span>{t('menu.fixLyrics')}</span>
			{:else}
				<span>{t('lyricsSettings.title')}</span>
			{/if}
			<button class="x" aria-label={t('menu.close')} onclick={onclose} use:tapBounce><X size={18} /></button>
		</div>

		{#if level === 'source'}
			{#if loading && !candidates.length}
				<div class="wait"><span class="row-spinner motion-always"></span></div>
			{:else if !candidates.length}
				<p class="none">{t('menu.lyricsPickerNone')}</p>
				<MenuActionButton icon={Mic2} onclick={openSource}>{t('menu.lyricsRetry')}</MenuActionButton>
			{:else}
				{#each candidates as c (c.source)}
					{@const current = c.lrc === pinnedLrc}
					{@const text = parseLyrics(c.lrc).map((l) => l.text.trim()).filter(Boolean).join('\n')}
					<div class="lyr-card" class:on={current}>
						<div class="lyr-head">
							<span class="dl-src">{names.zhLock(SOURCES[c.source]?.label ?? c.source)}</span>
							{#if current}<span class="lyr-cur"><Check size={14} /> {t('menu.currentLyrics')}</span>{/if}
						</div>
						<div class="lyr-body" role="group" aria-label={t('nowplaying.lyrics')} data-no-drag>{text}</div>
						<MenuActionButton icon={Mic2} onclick={() => pickCandidate(c.lrc)}>{t('menu.useTheseLyrics')}</MenuActionButton>
					</div>
				{/each}
			{/if}
			{#if hasPin}
				<MenuActionButton icon={Sparkles} onclick={useAutomatic}>{t('menu.lyricsAuto')}</MenuActionButton>
			{/if}
			<MenuActionButton icon={Pencil} onclick={openEditor}>{t('menu.writeOwnLyrics')}</MenuActionButton>
		{:else}
			<h3 class="grp">{t('lyricsSettings.source')}</h3>
			<button class="row" onclick={openSource} use:tapBounce>
				<span class="row-label">{t('menu.fixLyrics')}</span>
				<span class="row-value">{hasPin ? t('lyricsSettings.yourVersion') : t('lyricsSettings.autoSource')}</span>
				<ChevronRight size={16} />
			</button>
			<MenuActionButton icon={Pencil} onclick={openEditor}>{t('menu.writeOwnLyrics')}</MenuActionButton>

			<h3 class="grp">{t('lyricsSettings.translation')}</h3>
			<SettingPicker
				label={t('settings.lyricsTranslation')}
				options={langOptions}
				value={settings.lyricsLang}
				onpick={(v) => { settings.lyricsLang = v; settings.save(); }}
			/>
			{#if settings.lyricsLang !== 'off'}
				<SettingPicker
					label={t('settings.lyricsTranslateMode')}
					options={modeOptions}
					value={settings.translateMode}
					onpick={(v) => { settings.translateMode = v; settings.save(); }}
				/>
			{/if}
			<SettingToggle
				label={t('lyricsSettings.dedupe')}
				checked={settings.lyricsDedupeIdentical}
				onchange={() => { settings.lyricsDedupeIdentical = !settings.lyricsDedupeIdentical; settings.save(); }}
			/>

			<h3 class="grp">{t('lyricsSettings.display')}</h3>
			<SettingToggle
				label={t('settings.embeddedTranslations')}
				checked={settings.lyricsHideParenLines}
				onchange={() => { settings.lyricsHideParenLines = !settings.lyricsHideParenLines; settings.save(); }}
			/>
			<SettingToggle
				label={t('settings.inlineTranslations')}
				checked={settings.lyricsHideParenTranslation}
				onchange={() => { settings.lyricsHideParenTranslation = !settings.lyricsHideParenTranslation; settings.save(); }}
			/>

			<h3 class="grp">{t('lyricsSettings.sync')}</h3>
			<div class="offset-row">
				<button type="button" onclick={() => nudge(-0.1)} aria-label={t('lyrics.offsetEarlier')} use:tapBounce>−0.1s</button>
				<button type="button" class="readout" onclick={resetOffset} aria-label={t('lyrics.offsetReset', { value: formatLyricOffset(offset) })} use:tapBounce>{formatLyricOffset(offset)}</button>
				<button type="button" onclick={() => nudge(0.1)} aria-label={t('lyrics.offsetLater')} use:tapBounce>+0.1s</button>
			</div>
			<p class="hint">{t('lyricsSettings.perLineHint')}</p>
		{/if}
	</div>
{/if}

<LyricsEditor open={editorOpen} onclose={() => (editorOpen = false)} {track} initialLrc={track ? readLyrics(track) : null} />

<style>
	/* Sheet family idiom — see LyricsEditor.svelte / TrackMenu .menu (same tokens). */
	.scrim { position: fixed; inset: 0; z-index: 90; background: rgb(0 0 0 / 0.45); border: none; cursor: pointer; }
	.sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 91; max-height: 86dvh; overflow-y: auto; background: var(--color-bg); border-radius: var(--radius-sheet) var(--radius-sheet) 0 0; box-shadow: var(--ui-sheet-shadow); padding: 10px 14px calc(14px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 8px; }
	/* quick-261120-segfix: this sheet is a SCROLLING flex column — its children keep
	   their geometry and the column scrolls. Without this, flex shrink compressed the
	   two SettingPicker rows to clipped strips (their overflow-x:auto zeroes their
	   automatic minimum size) while min-height siblings rendered fine. */
	.sheet > :global(*) { flex: none; }
	@media (min-width: 640px) { .sheet { left: 50%; right: auto; width: min(560px, calc(100vw - 32px)); transform: translateX(-50%); border-radius: var(--radius-sheet); bottom: 16px; } }
	.sheet-head { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 0.95rem; min-height: 32px; }
	.sheet-head .x { margin-left: auto; }
	.sheet-head .x, .sheet-head .back { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: none; border-radius: 50%; background: var(--color-surface); color: var(--color-text); cursor: pointer; flex: none; }
	.grp { margin: 10px 0 0; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-text-muted); }
	.row { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); color: var(--color-text); cursor: pointer; text-align: start; }
	.row-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.row-value { color: var(--color-text-muted); font-size: 0.85rem; flex: none; }
	.row :global(svg) { color: var(--color-text-muted); flex: none; }
	.wait { display: grid; place-items: center; padding: 28px 0; }
	.row-spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--color-border); border-top-color: var(--color-primary); animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.none { color: var(--color-text-muted); font-size: 0.85rem; margin: 8px 0; }
	.lyr-card { border: 1px solid var(--color-border); border-radius: 12px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
	.lyr-card.on { border-color: var(--color-primary); }
	.lyr-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.85rem; }
	.lyr-cur { display: inline-flex; align-items: center; gap: 4px; color: var(--color-primary); font-size: 0.8rem; }
	.lyr-body { max-height: 7.5em; overflow-y: auto; white-space: pre-line; font-size: 0.8rem; line-height: 1.5; color: var(--color-text-muted); }
	.offset-row { display: flex; align-items: center; justify-content: center; gap: 8px; }
	.offset-row button { min-height: 44px; padding: 6px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-full); background: var(--color-surface); color: var(--color-text); cursor: pointer; font-variant-numeric: tabular-nums; }
	.offset-row .readout { min-width: 84px; font-weight: 600; }
	.hint { color: var(--color-text-muted); font-size: 0.75rem; line-height: 1.4; margin: 0; }
</style>
