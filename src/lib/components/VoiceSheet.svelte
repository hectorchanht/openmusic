<script lang="ts">
	// quick-261122-voice — the voice assistant sheet: listening → thinking → action card.
	// Mounted ONCE (ungated) by the (app) layout, driven by `voice.open`. The store owns the
	// flow; this host only renders and localizes (stores never localize — house rule), reads
	// the card aloud, and wires the overlays Back gesture (SleepTimerSheet's $effect idiom).
	//
	// Elderly-first shape: huge type, one decision per screen, two giant buttons (OK / No),
	// words appear live while speaking, the card is spoken aloud, and nothing plays until OK.
	import { untrack } from 'svelte';
	import { fly, fade } from '$lib/motion';
	import { Mic, Check, RotateCcw, X, Loader, Play, Pause, SkipForward, SkipBack, Heart, Clock, MessageCircle, SendHorizontal } from '@lucide/svelte';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { voice } from '$lib/stores/voice.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { coverGradient } from '$lib/services/cover-gradient';
	import { ttsLang, VOICE_LANGS, type VoiceLang } from '$lib/services/voice-intent';
	import { speak } from '$lib/services/voice-capture';
	import type { VoiceProposal } from '$lib/services/voice-plan';
	import CoverArt from '$lib/components/CoverArt.svelte';
	import { t, type TranslationKey } from '$lib/i18n';

	const LANG_LABEL: Record<VoiceLang, string> = { yue: '廣東話', cmn: '普通話', en: 'English' };

	let typed = $state('');

	$effect(() => {
		if (voice.open) {
			untrack(() => overlays.open('voice', () => voice.close()));
			return () => untrack(() => overlays.dismiss('voice'));
		}
	});

	function genreLabel(q: string): string {
		if (q === '粤剧') return t('voice.genreOpera');
		if (q === '80年代 粤语 金曲') return t('voice.genreGoldies');
		return names.dnTitle(q, '');
	}

	const NONE_KEY: Record<Extract<VoiceProposal, { kind: 'none' }>['reason'], TranslationKey> = {
		'not-found': 'voice.notFound',
		'not-understood': 'voice.notUnderstood',
		'no-liked': 'voice.noLiked',
		'no-history': 'voice.noHistory',
		'nothing-playing': 'voice.nothingPlaying'
	};
	const ERROR_KEY: Record<string, TranslationKey> = {
		denied: 'voice.errDenied',
		'no-speech': 'voice.errNoSpeech',
		network: 'voice.errNetwork',
		unsupported: 'voice.errUnsupported'
	};

	/** The card's one sentence — also what is read aloud and toasted after OK. */
	function cardText(p: VoiceProposal | null): string {
		if (!p) return '';
		switch (p.kind) {
			case 'play-song':
				return t('voice.willPlaySong', {
					title: names.dnTitle(p.track.title, p.track.artist),
					artist: names.dnArtist(p.track.artist)
				});
			case 'play-list':
				if (p.source === 'liked') return t('voice.willPlayLiked');
				if (p.source === 'history') return t('voice.willPlayHistory');
				if (p.source === 'artist') return t('voice.willPlayArtist', { artist: names.dnArtist(p.label) });
				return t('voice.willPlayGenre', { genre: genreLabel(p.label) });
			case 'control':
				return t(
					p.action === 'pause' ? 'voice.willPause'
						: p.action === 'resume' ? 'voice.willResume'
						: p.action === 'next' ? 'voice.willNext'
						: 'voice.willPrevious'
				);
			case 'answer':
				return p.text;
			case 'none':
				return t(NONE_KEY[p.reason], { query: names.dnTitle(p.query, '') });
		}
	}

	const sentence = $derived(cardText(voice.proposal));
	const actionable = $derived(
		!!voice.proposal && voice.proposal.kind !== 'none' && voice.proposal.kind !== 'answer'
	);
	const listCover = $derived(
		voice.proposal?.kind === 'play-list' ? (voice.proposal.tracks.find((tr) => tr.cover)?.cover ?? null) : null
	);

	// Read the card aloud once per proposal (a new proposal object = a new card).
	let spokenFor: VoiceProposal | null = null;
	$effect(() => {
		const p = voice.proposal;
		const phase = voice.phase;
		if (phase !== 'card' || !p || p === spokenFor) return;
		spokenFor = p;
		if (settings.voiceReadAloud) untrack(() => speak(sentence, ttsLang(voice.lang, settings.appLang)));
	});

	// After OK: a toast repeating what happened, with "Ask again" — the undo path for a
	// mis-heard request that only shows up once the music starts.
	let lastExecuted = 0;
	$effect(() => {
		const e = voice.executed;
		if (e.n === lastExecuted) return;
		lastExecuted = e.n;
		untrack(() =>
			toast.show(cardText(e.proposal), {
				action: { label: t('voice.askAgain'), run: () => voice.start() },
				duration: 6000
			})
		);
	});

	function pickLang(l: VoiceLang) {
		settings.voiceLang = l;
		settings.save();
		voice.listen();
	}

	function submitTyped(e: SubmitEvent) {
		e.preventDefault();
		voice.submitText(typed);
		typed = '';
	}
</script>

{#if voice.open}
	<button class="scrim" aria-label={t('voice.close')} onclick={() => voice.close()} transition:fade={{ duration: 150 }}></button>
	<div
		class="sheet"
		role="dialog"
		aria-modal="true"
		aria-label={t('voice.button')}
		transition:fly={{ y: 320, duration: 220 }}
		use:focusTrap
	>
		<button class="x" aria-label={t('voice.close')} onclick={() => voice.close()} use:tapBounce><X size={26} /></button>

		{#if voice.phase === 'listening'}
			<p class="prompt" aria-live="polite">{t('voice.listening')}</p>
			<button class="mic live" aria-label={t('voice.done')} onclick={() => voice.finishListening()} use:tapBounce>
				<span class="ring"></span>
				<Mic size={56} strokeWidth={2} />
			</button>
			<p class="heard" aria-live="polite">{voice.transcript || t('voice.hint')}</p>
			<button class="done" onclick={() => voice.finishListening()} use:tapBounce>{t('voice.done')}</button>
			<div class="langs" role="radiogroup" aria-label={t('settings.voiceLang')}>
				{#each VOICE_LANGS as l (l)}
					<button
						role="radio"
						aria-checked={voice.lang === l}
						class="lang"
						class:on={voice.lang === l}
						onclick={() => pickLang(l)}
					>{LANG_LABEL[l]}</button>
				{/each}
			</div>
		{:else if voice.phase === 'thinking'}
			{#if voice.transcript}<p class="said"><span>{t('voice.heard')}</span> “{voice.transcript}”</p>{/if}
			<div class="spinner" aria-live="polite"><Loader size={48} class="spin" /> <span>{t('voice.thinking')}</span></div>
		{:else if voice.phase === 'card' && voice.proposal}
			{@const p = voice.proposal}
			{#if voice.transcript}<p class="said"><span>{t('voice.heard')}</span> “{voice.transcript}”</p>{/if}
			<div class="card" class:muted={!actionable}>
				{#if p.kind === 'play-song'}
					<div class="art"><CoverArt src={p.track.cover} fallback={coverGradient(p.track.uid)} /></div>
				{:else if p.kind === 'play-list'}
					<div class="art">
						{#if p.source === 'liked'}<span class="glyph"><Heart size={56} fill="currentColor" /></span>
						{:else if p.source === 'history'}<span class="glyph"><Clock size={56} /></span>
						{:else}<CoverArt src={listCover} fallback={coverGradient(p.label)} />{/if}
					</div>
				{:else if p.kind === 'control'}
					<div class="art glyph-box">
						{#if p.action === 'pause'}<Pause size={64} />{:else if p.action === 'resume'}<Play size={64} />{:else if p.action === 'next'}<SkipForward size={64} />{:else}<SkipBack size={64} />{/if}
					</div>
				{:else if p.kind === 'answer'}
					<div class="art glyph-box small"><MessageCircle size={40} /></div>
				{/if}
				<p class="sentence" aria-live="assertive">{sentence}</p>
			</div>

			{#if actionable}
				<div class="actions">
					<button class="ok" onclick={() => voice.confirm()} use:tapBounce><Check size={34} strokeWidth={3} /> {t('voice.ok')}</button>
					<button class="no" onclick={() => voice.listen()} use:tapBounce><RotateCcw size={26} /> {t('voice.no')}</button>
				</div>
				{#if p.kind === 'play-song' && p.alternates.length}
					<p class="alt-head">{t('voice.orOneOf')}</p>
					<div class="alts">
						{#each p.alternates as alt (alt.uid)}
							<button class="alt" onclick={() => voice.pickAlternate(alt.uid)} use:tapBounce>
								<span class="alt-art"><CoverArt src={alt.cover} fallback={coverGradient(alt.uid)} /></span>
								<span class="alt-text"><b>{names.dnTitle(alt.title, alt.artist)}</b><small>{names.dnArtist(alt.artist)}</small></span>
							</button>
						{/each}
					</div>
				{/if}
			{:else}
				<div class="actions">
					<button class="ok" onclick={() => voice.listen()} use:tapBounce><Mic size={30} /> {t('voice.askAgain')}</button>
					<button class="no" onclick={() => voice.close()} use:tapBounce>{t('voice.close')}</button>
				</div>
			{/if}
		{:else if voice.phase === 'error'}
			<p class="prompt err" aria-live="assertive">{t(ERROR_KEY[voice.error ?? 'no-speech'])}</p>
			{#if voice.error !== 'unsupported' && voice.error !== 'denied'}
				<button class="mic" aria-label={t('voice.askAgain')} onclick={() => voice.listen()} use:tapBounce><Mic size={56} /></button>
			{/if}
			<form class="type" onsubmit={submitTyped}>
				<input bind:value={typed} placeholder={t('voice.typePlaceholder')} aria-label={t('voice.typePlaceholder')} enterkeyhint="go" />
				<button type="submit" aria-label={t('voice.ok')} disabled={!typed.trim()}><SendHorizontal size={22} /></button>
			</form>
		{/if}
	</div>
{/if}

<style>
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, 0.6); border: none; }
	.sheet {
		position: fixed; left: 0; right: 0; bottom: 0; z-index: 81;
		max-width: 560px; margin: 0 auto;
		max-height: 92dvh; overflow-y: auto;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border); border-bottom: none;
		border-radius: 24px 24px 0 0;
		padding: 28px 20px calc(24px + env(safe-area-inset-bottom, 0px));
		display: flex; flex-direction: column; align-items: center; gap: 18px;
		box-shadow: 0 -12px 48px rgba(0, 0, 0, 0.55);
		text-align: center;
	}
	.x { position: absolute; top: 10px; inset-inline-end: 10px; width: 48px; height: 48px; border-radius: 50%; border: none; background: var(--color-surface); color: var(--color-text); display: grid; place-items: center; cursor: pointer; }
	.prompt { font-size: 1.5rem; font-weight: 700; line-height: 1.3; margin: 12px 40px 0; color: var(--color-text); }
	.prompt.err { color: var(--color-text); font-size: 1.3rem; }
	.mic {
		position: relative; width: 132px; height: 132px; border-radius: 50%;
		border: none; background: var(--color-primary); color: var(--color-on-primary);
		display: grid; place-items: center; cursor: pointer;
	}
	.mic .ring { position: absolute; inset: -10px; border-radius: 50%; border: 4px solid var(--color-primary); opacity: 0.6; animation: voice-pulse 1.4s ease-out infinite; }
	@keyframes voice-pulse { from { transform: scale(0.92); opacity: 0.7; } to { transform: scale(1.25); opacity: 0; } }
	.heard { font-size: 1.6rem; font-weight: 600; min-height: 2.2em; margin: 0; color: var(--color-text); word-break: break-word; }
	.done { min-height: 56px; padding: 0 32px; border-radius: 28px; border: 2px solid var(--color-border); background: var(--color-surface); color: var(--color-text); font-size: 1.2rem; font-weight: 700; cursor: pointer; }
	.langs { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
	.lang { min-height: 44px; padding: 0 18px; border-radius: 22px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text-muted); font-size: 1.05rem; cursor: pointer; }
	.lang.on { background: var(--color-surface); color: var(--color-primary); border-color: var(--color-primary); font-weight: 700; }
	.said { margin: 12px 40px 0; font-size: 1.15rem; color: var(--color-text-muted); }
	.said span { display: block; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; }
	.spinner { display: flex; flex-direction: column; align-items: center; gap: 12px; font-size: 1.4rem; font-weight: 600; color: var(--color-text); padding: 24px 0; }
	.spinner :global(.spin) { animation: voice-spin 1s linear infinite; color: var(--color-primary); }
	@keyframes voice-spin { to { transform: rotate(360deg); } }
	.card { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 18px; border-radius: 20px; background: var(--color-surface); border: 2px solid var(--color-primary); }
	.card.muted { border-color: var(--color-border); }
	.art { width: 168px; height: 168px; border-radius: 16px; overflow: hidden; position: relative; background: var(--color-surface-2); display: grid; place-items: center; }
	.art :global(img) { width: 100%; height: 100%; object-fit: cover; }
	.glyph, .glyph-box { color: var(--color-primary); display: grid; place-items: center; }
	.glyph-box.small { width: 80px; height: 80px; border-radius: 50%; }
	.sentence { font-size: 1.6rem; font-weight: 800; line-height: 1.3; margin: 0; color: var(--color-text); word-break: break-word; }
	.card.muted .sentence { font-weight: 600; font-size: 1.4rem; }
	.actions { width: 100%; display: flex; flex-direction: column; gap: 12px; }
	.ok, .no { width: 100%; min-height: 72px; border-radius: 20px; display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 1.6rem; font-weight: 800; cursor: pointer; }
	.ok { border: none; background: var(--color-primary); color: var(--color-on-primary); }
	.no { min-height: 60px; font-size: 1.25rem; border: 2px solid var(--color-border); background: transparent; color: var(--color-text); }
	.alt-head { margin: 4px 0 0; color: var(--color-text-muted); font-size: 1rem; align-self: flex-start; }
	.alts { width: 100%; display: flex; flex-direction: column; gap: 8px; }
	.alt { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 8px; border-radius: 14px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); text-align: start; cursor: pointer; }
	.alt-art { width: 48px; height: 48px; border-radius: 8px; overflow: hidden; flex: none; position: relative; }
	.alt-art :global(img) { width: 100%; height: 100%; object-fit: cover; }
	.alt-text { display: flex; flex-direction: column; min-width: 0; }
	.alt-text b { font-size: 1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.alt-text small { font-size: 0.95rem; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.type { width: 100%; display: flex; gap: 8px; }
	.type input { flex: 1; min-width: 0; min-height: 56px; border-radius: 16px; border: 2px solid var(--color-border); background: var(--color-surface); color: var(--color-text); font-size: 1.2rem; padding: 0 16px; }
	.type button { width: 56px; min-height: 56px; border-radius: 16px; border: none; background: var(--color-primary); color: var(--color-on-primary); display: grid; place-items: center; cursor: pointer; }
	.type button:disabled { opacity: 0.4; }
</style>
