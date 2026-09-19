<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronDown, ChevronLeft, Languages, Replace } from '@lucide/svelte';
	import SettingToggle from '$lib/components/SettingToggle.svelte';
	import SettingPicker from '$lib/components/SettingPicker.svelte';
	import SettingHint from '$lib/components/SettingHint.svelte';
	import { settings, type LyricsLang, type SourceLang, type TranslateMode, type ZhScriptSetting } from '$lib/stores/settings.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t, type TranslationKey } from '$lib/i18n';

	onMount(() => settings.load());

	// `off` + 'auto' are chrome (label resolved in template via t()); language endonyms literal.
	// ju0: 'auto' added as a 17th option in all per-part pickers (was bio-only). At resolve
	// time, names.dn*/lyrics-translate effect maps it to settings.appLang.
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
	// Source-language tags for the skip whitelist (no 'off' — endonym labels are literal).
	const sources: { v: SourceLang; label: string }[] = [
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
	const modes: { v: TranslateMode; key: string }[] = [
		{ v: 'replace', key: 'settings.optReplace' },
		{ v: 'below', key: 'settings.optShowBelow' }
	];

	// quick-260919-hm2: 'bio' joins the per-part model. It used to be its own hand-rolled section
	// with its own option array and its own setter, purely because it is the one part with no
	// skip-language list — which the `skip` flag on `parts` below now expresses in one boolean.
	// bioLang's declared type is `'auto' | LyricsLang`, and LyricsLang ALREADY contains 'auto'
	// (see the ju0 note on the union), so the two are the same type and the map below is exact.
	type PartKey = 'artist' | 'title' | 'lyrics' | 'bio';
	const TARGET: Record<PartKey, () => LyricsLang> = {
		artist: () => settings.artistLang,
		title: () => settings.titleLang,
		lyrics: () => settings.lyricsLang,
		bio: () => settings.bioLang
	};
	const SKIP: Record<PartKey, () => SourceLang[]> = {
		artist: () => settings.artistSkip,
		title: () => settings.titleSkip,
		lyrics: () => settings.lyricsSkip,
		// Bio has no skip whitelist — names.dnBio() passes `[]` literally. Kept in the map so the
		// record stays total; the `skip: false` flag on `parts` is what hides the UI.
		bio: () => []
	};

	function setTarget(part: PartKey, v: LyricsLang) {
		if (part === 'artist') settings.artistLang = v;
		else if (part === 'title') settings.titleLang = v;
		else if (part === 'bio') settings.bioLang = v;
		else settings.lyricsLang = v;
		settings.save();
	}

	// --- the shared "apply to all" target (quick-260919-hm2) ---------------------------------
	//
	// DELIBERATELY DERIVED, NOT STORED. There is no fifth persisted field: the shared control
	// simply reports whether the four real targets agree, and writing it writes all four. That
	// means no new localStorage key, no migration, and no way for a stored "shared" value to
	// drift out of sync with the parts it claims to describe.
	//
	// WHAT HAPPENS WHEN THE FOUR DISAGREE (the decision this feature turns on): the shared
	// control reads as MIXED and no chip is selected. It does NOT adopt one part's value and it
	// does NOT write anything on render — a user who already set lyrics=繁體中文 and left the rest
	// Off opens this page and finds both facts intact. Mixed is a display state only; the four
	// parts collapse to one value exactly when the user taps a chip here, never before.
	//
	// SCOPE: these are the four parts the page has always exposed. `settings.lastfmLang` is NOT
	// swept in — despite looking like a sibling field, it targets Last.fm TAG chips (names.dnLastfm
	// → TagChips), has no control on this page, and "apply to all" must not silently change a
	// setting the user cannot see.
	const PART_KEYS = ['lyrics', 'artist', 'title', 'bio'] as const;
	const sharedTarget = $derived.by<LyricsLang | null>(() => {
		const first = TARGET.lyrics();
		return PART_KEYS.every((k) => TARGET[k]() === first) ? first : null;
	});
	function applyAll(v: LyricsLang) {
		settings.lyricsLang = v;
		settings.artistLang = v;
		settings.titleLang = v;
		settings.bioLang = v;
		settings.save();
	}
	/** One language value → its chip/summary label. 'off' and 'auto' are chrome (translated);
	 *  every other label is the language's own endonym, which is the same in every UI language. */
	function langLabel(v: LyricsLang): string {
		if (v === 'off') return t('settings.optOff');
		if (v === 'auto') return t('settings.bioAuto');
		return langs.find((l) => l.v === v)?.label ?? v;
	}
	function toggleSkip(part: PartKey, v: SourceLang) {
		const cur = SKIP[part]();
		const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
		if (part === 'artist') settings.artistSkip = next;
		else if (part === 'title') settings.titleSkip = next;
		else settings.lyricsSkip = next;
		settings.save();
	}
	function setMode(v: TranslateMode) { settings.translateMode = v; settings.save(); }
	// quick-260919-2jo: the Chinese SCRIPT lock. Endonyms are LITERAL here, exactly like `langs`
	// and `sources` above — a script's own name is the same in every UI language, so the pills
	// need no dictionary entry and only the heading + note are translated (2 new keys, not 5).
	const ZH_SCRIPTS: { v: ZhScriptSetting; label: string }[] = [
		{ v: 'off', label: '' },
		{ v: 'zh-Hant', label: '繁體中文' },
		{ v: 'zh-Hans', label: '简体中文' }
	];
	function setZhScript(v: ZhScriptSetting) { settings.zhScript = v; settings.save(); }

	// quick-260607-fnp: Lyrics lifted to the TOP (below the lyrics translate-mode control),
	// then artist + title.
	// quick-260919-hm2: bio joins the list instead of hand-rolling its own section below. Its
	// old `bioOptions` array existed only to float Auto above Off; it now shares `langs` with the
	// other three, so the four accordions are chip-for-chip identical (Off, Auto, then endonyms).
	// `skip` marks which parts have a source-language whitelist — bio does not.
	const parts: { key: PartKey; headingKey: TranslationKey; noteKey: TranslationKey; skip: boolean }[] = [
		{ key: 'lyrics', headingKey: 'settings.lyricsTranslation', noteKey: 'settings.translateLyricsNote', skip: true },
		{ key: 'artist', headingKey: 'settings.translateArtist', noteKey: 'settings.translateArtistNote', skip: true },
		{ key: 'title', headingKey: 'settings.translateTitle', noteKey: 'settings.translateTitleNote', skip: true },
		{ key: 'bio', headingKey: 'settings.translateLastfm', noteKey: 'settings.translateLastfmNote', skip: false }
	];

	// quick-260919-ebi: both labelled controls on this page now come from the ONE SettingPicker.
	// zhScript gets NO preview — the endonym labels 繁體中文 / 简体中文 already ARE the difference,
	// so a mockup could only redraw the same two words.
	const zhOptions = $derived(
		ZH_SCRIPTS.map((z) => ({ v: z.v, label: z.v === 'off' ? t('settings.optOff') : z.label }))
	);
	const modeOptions = $derived(modes.map((m) => ({ v: m.v, label: t(m.key as TranslationKey) })));

</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')} use:tapBounce><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupTranslation')}</h1>
	<button class="reset" onclick={() => { if (confirm(t('settings.resetConfirm'))) { settings.resetTranslation(); } }} use:tapBounce>{t('settings.resetGroup')}</button>
</header>

<!-- quick-260919-ebi (F3): the translate-mode mocks use NEUTRAL BLOCK TEXT, not a real bilingual
     pair, and that is a deliberate call. Any real sample would have to pick an original language
     and a target language — which is itself a translation problem, and would need 15 versions of
     the mock to stay honest in every UI language. Dots stand for the original line, dashes for
     its translation, so the SHAPE (one line replaced vs two lines stacked) is the whole message
     and nothing needs translating. -->
{#snippet modeReplace()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-col" style:gap="6px">
			{#each [0, 1, 2] as r (r)}
				<span class="mock-text dim">&#8212; &#8212; &#8212;</span>
			{/each}
		</span>
	</span>
{/snippet}
{#snippet modeBelow()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-col" style:gap="6px">
			{#each [0, 1] as r (r)}
				<span class="mock-col" style:gap="1px">
					<span class="mock-text">&#8226;&#8226;&#8226; &#8226;&#8226;&#8226;</span>
					<span class="mock-text dim">&#8212; &#8212; &#8212;</span>
				</span>
			{/each}
		</span>
	</span>
{/snippet}

<!-- 0. Chinese script lock (quick-260919-2jo) — sits ABOVE everything else because it governs the
     names and titles the sections below then translate: the lock is applied LAST and has the last
     word (D-6), so a contradictory pair (titleLang zh-Hant + lock Simplified) resolves to the
     lock. Chinese-only by construction; see lockScriptSync's isChineseLine gate. -->
<section>
	<h2><Languages size={15} /> {t('settings.zhScript')}<SettingHint label={t('settings.zhScript')} text={t('settings.zhScriptNote')} /></h2>
	<SettingPicker label={t('settings.zhScript')} options={zhOptions} value={settings.zhScript} onpick={setZhScript} />
</section>

<hr class="div" />

<!-- 1. Lyrics translate mode — how translated lyrics display (replace vs show below). -->
<section>
	<!-- The (i) is hidden while the control is disabled: its text describes the two ENABLED states,
	     and the visible OFF note below already says why nothing here is pickable. -->
	<h2><Replace size={15} /> {t('settings.lyricsTranslateMode')}{#if settings.lyricsLang !== 'off'}<SettingHint label={t('settings.lyricsTranslateMode')} text={t('settings.translateModeOnNote')} />{/if}</h2>
	<!-- quick-260919-ebi (F3): replace-vs-below is a shape on screen, so it is picked by tapping
	     one of two lyric mockups. -->
	<SettingPicker
		variant="preview"
		label={t('settings.lyricsTranslateMode')}
		options={[
			{ ...modeOptions[0], preview: modeReplace },
			{ ...modeOptions[1], preview: modeBelow }
		]}
		value={settings.translateMode}
		onpick={setMode}
		disabled={settings.lyricsLang === 'off'}
	/>
	<!-- The OFF note is NOT the prose a preview replaces: it explains why the control above is
	     DISABLED, which no mockup of the enabled states can say. It stays on screen, unhidden,
	     because a disabled control with no visible reason is the confusing case. -->
	{#if settings.lyricsLang === 'off'}
		<p class="muted">{t('settings.translateModeOffNote')}</p>
	{/if}

	<!-- quick-260919-ebi (F2): the one shared boolean row — inset + switch + accent edge. These two
	     keep their prose: a before/after lyric pair would need a representative bilingual sample
	     line, and choosing that line is itself a translation problem. -->
	<SettingToggle
		label={t('settings.lyricsHideParenTranslation')}
		checked={settings.lyricsHideParenTranslation}
		onchange={() => { settings.lyricsHideParenTranslation = !settings.lyricsHideParenTranslation; settings.save(); }}
		hint={t('settings.lyricsHideParenTranslationNote')}
	/>

	<SettingToggle
		label={t('settings.lyricsHideParenLines')}
		checked={settings.lyricsHideParenLines}
		onchange={() => { settings.lyricsHideParenLines = !settings.lyricsHideParenLines; settings.save(); }}
		hint={t('settings.lyricsHideParenLinesNote')}
	/>
</section>

<hr class="div" />

<!-- 2. TRANSLATION TARGETS (quick-260919-hm2) — the four content parts, grouped.
     This page used to stack four independent sections, each with its own always-open 19-chip
     language list (plus three 17-chip skip lists): ~127 chips on screen before you had done
     anything. They are now ONE section of <details> accordions, and every language list starts
     CLOSED, so the page opens as five one-line rows that each state their current value.

     THE ACCORDION IS THE EXISTING `.advanced` <details>/<summary> IDIOM from the Playback page
     (Advanced > Sources), reused verbatim rather than reinvented — including the reason
     SettingHint stopPropagation()s its click: a hint inside a <summary> must not also toggle
     the accordion it explains.

     The "Apply to all" row sits FIRST and writes all four at once; the four per-part rows below
     it still set exactly one part each, so nothing that was individually settable stopped being
     individually settable. When the parts disagree, the shared row reads Mixed and selects
     nothing — it never flattens an existing per-part mix on render (see `sharedTarget`). -->
<section>
	<h2><Languages size={15} /> {t('settings.translateTargets')}</h2>

	<details class="advanced">
		<summary>
			<Languages size={15} />
			{t('settings.translateApplyAll')}
			<SettingHint label={t('settings.translateApplyAll')} text={t('settings.translateApplyAllNote')} />
			<span class="cur">{sharedTarget === null ? t('settings.translateMixed') : langLabel(sharedTarget)}</span>
			<span class="chev" aria-hidden="true"><ChevronDown size={15} /></span>
		</summary>
		<div class="chips">
			{#each langs as l (l.v)}
				<button class="chip" class:on={sharedTarget === l.v} onclick={() => applyAll(l.v)} use:tapBounce>{langLabel(l.v)}</button>
			{/each}
		</div>
	</details>

	{#each parts as part (part.key)}
		<details class="advanced">
			<summary>
				<Languages size={15} />
				{t(part.headingKey)}
				<SettingHint label={t(part.headingKey)} text={t(part.noteKey)} />
				<span class="cur">{langLabel(TARGET[part.key]())}</span>
				<span class="chev" aria-hidden="true"><ChevronDown size={15} /></span>
			</summary>
			<div class="chips">
				{#each langs as l (l.v)}
					<button class="chip" class:on={TARGET[part.key]() === l.v} onclick={() => setTarget(part.key, l.v)} use:tapBounce>{langLabel(l.v)}</button>
				{/each}
			</div>
			{#if part.skip}
				<div class="skip" class:disabled={TARGET[part.key]() === 'off'}>
					<p class="sublabel">{t('settings.skipLanguages')}<SettingHint label={t('settings.skipLanguages')} text={t('settings.skipLanguagesNote')} /></p>
					<div class="chips">
						{#each sources as s (s.v)}
							<button class="chip skipchip" class:on={SKIP[part.key]().includes(s.v)} disabled={TARGET[part.key]() === 'off'} onclick={() => toggleSkip(part.key, s.v)} use:tapBounce>{s.label}</button>
						{/each}
					</div>
				</div>
			{/if}
		</details>
	{/each}
</section>

<hr class="div" />

<section>
	<h2><Languages size={15} /> {t('settings.appLanguage')}</h2>
	<button class="link" onclick={() => goto('/settings/general')}>{t('settings.appLanguage')} →</button>
	<p class="muted">{t('settings.groupGeneralDesc')}</p>
</section>

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.head h1 { flex: 1; }
	.reset { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 6px 12px; border-radius: 999px; font-size: 12px; cursor: pointer; }
	.reset:hover { color: var(--color-text); }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	/* quick-260919-ebi: `position: relative` on every title that carries an inline (i) — it anchors
	   SettingHint's description panel, which is scoped and cannot set this on its host. */
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; position: relative; }
	.muted { color: var(--color-text-muted); font-size: 12px; margin: 8px 0 0; }
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	.chip:disabled { cursor: default; }
	.skip { margin-top: 12px; }
	.skip.disabled { opacity: 0.45; pointer-events: none; }
	.sublabel { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 8px; position: relative; }
	.skipchip.on { background: var(--color-surface); color: var(--color-primary); border-color: var(--color-primary); }
	/* quick-260919-hm2: the collapsed language lists. Lifted verbatim from the Playback page's
	   `.advanced` Advanced > Sources accordion so the two read as the same control. */
	.advanced { margin: 10px 0; padding: 10px 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; }
	/* The summary is a settings ROW, not a section heading, so it takes the app's row type (14px
	   sentence case, like .rlabel on the Home page and SettingToggle's label) rather than the
	   uppercase + letter-spaced heading type the Playback `.advanced` summary uses for its single
	   "Advanced > Sources" disclosure. That is also what makes "Lyrics translation · Auto (app
	   language)" fit on one 375px line — uppercase + 0.5px tracking did not. */
	.advanced summary { position: relative; display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--color-text); cursor: pointer; padding: 4px 0; }
	.advanced .chips { margin-top: 12px; }
	/* The row's CURRENT value, right-aligned — it is what makes a CLOSED page still readable:
	   five collapsed rows that each say what they are set to. */
	.cur { margin-left: auto; color: var(--color-text-muted); font-size: 13px; text-align: right; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	/* `display: flex` on a <summary> removes the UA disclosure marker, so the accordion would have
	   no affordance at all — fine for one "Advanced" footer, not for five rows that ARE the page.
	   This is that marker, put back explicitly and rotated on open. */
	.advanced .chev { display: inline-flex; flex: none; color: var(--color-text-muted); transition: transform 0.15s ease; }
	.advanced[open] .chev { transform: rotate(180deg); }
	@media (prefers-reduced-motion: reduce) {
		.advanced .chev { transition: none; }
	}
	/* An unselected .chip is --color-surface-2, and it now sits ON a --color-surface-2 panel, so
	   drop it a step to keep the fill visible. The selected states are restated at the higher
	   specificity the descendant selector creates. */
	.advanced .chip { background: var(--color-bg); }
	.advanced .chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	.advanced .skipchip.on { background: var(--color-surface); color: var(--color-primary); border-color: var(--color-primary); }
	/* quick-260919-ebi: the .seg CSS moved into SettingPicker.svelte — the quick-260919-2jo Chinese
	   script control is pixel-identical there, because the rules were lifted verbatim. */
	.link { background: none; border: none; color: var(--color-primary); cursor: pointer; font-size: 14px; padding: 0; }
	.div { border: none; border-top: 1px solid var(--color-border); margin: 4px 0; }
	/* quick-260919-ebi: the toggle-row CSS moved into SettingToggle.svelte. */
</style>
