<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Languages, Replace } from '@lucide/svelte';
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

	type PartKey = 'artist' | 'title' | 'lyrics';
	const TARGET: Record<PartKey, () => LyricsLang> = {
		artist: () => settings.artistLang,
		title: () => settings.titleLang,
		lyrics: () => settings.lyricsLang
	};
	const SKIP: Record<PartKey, () => SourceLang[]> = {
		artist: () => settings.artistSkip,
		title: () => settings.titleSkip,
		lyrics: () => settings.lyricsSkip
	};

	function setTarget(part: PartKey, v: LyricsLang) {
		if (part === 'artist') settings.artistLang = v;
		else if (part === 'title') settings.titleLang = v;
		else settings.lyricsLang = v;
		settings.save();
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
	function setBio(v: 'auto' | LyricsLang) { settings.bioLang = v; settings.save(); }

	// quick-260607-fnp: Lyrics lifted to the TOP (below the lyrics translate-mode control),
	// then artist + title. Bio info renders as its OWN picker section below (supersedes the
	// f4y read-only note — the user keeps a per-part bio language picker, default = Auto).
	const parts: { key: PartKey; headingKey: TranslationKey; noteKey: TranslationKey }[] = [
		{ key: 'lyrics', headingKey: 'settings.lyricsTranslation', noteKey: 'settings.translateLyricsNote' },
		{ key: 'artist', headingKey: 'settings.translateArtist', noteKey: 'settings.translateArtistNote' },
		{ key: 'title', headingKey: 'settings.translateTitle', noteKey: 'settings.translateTitleNote' }
	];
	// Bio target options: Auto (follow app/device language — DEFAULT) + the standard list
	// (Off + languages). `langs` already starts with Off, so just prepend Auto.
	// const bioOptions: { v: 'auto' | LyricsLang; label: string }[] = [{ v: 'auto', label: '' }, ...langs];

	// Prepend Auto, but filter out the existing 'auto' item from the rest of the array
	const bioOptions = [{ v: 'auto' as const, label: '' }, ...langs.filter(l => l.v !== 'auto')];

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

<!-- 2. Per-part language pickers — lyrics (lifted to top), then artist, title. -->
{#each parts as part, i (part.key)}
	<section>
		<h2><Languages size={15} /> {t(part.headingKey)}<SettingHint label={t(part.headingKey)} text={t(part.noteKey)} /></h2>
		<div class="chips">
			{#each langs as l (l.v)}
				<button class="chip" class:on={TARGET[part.key]() === l.v} onclick={() => setTarget(part.key, l.v)} use:tapBounce>{l.v === 'off' ? t('settings.optOff') : l.v === 'auto' ? t('settings.bioAuto') : l.label}</button>
			{/each}
		</div>
		<div class="skip" class:disabled={TARGET[part.key]() === 'off'}>
			<p class="sublabel">{t('settings.skipLanguages')}<SettingHint label={t('settings.skipLanguages')} text={t('settings.skipLanguagesNote')} /></p>
			<div class="chips">
				{#each sources as s (s.v)}
					<button class="chip skipchip" class:on={SKIP[part.key]().includes(s.v)} disabled={TARGET[part.key]() === 'off'} onclick={() => toggleSkip(part.key, s.v)} use:tapBounce>{s.label}</button>
				{/each}
			</div>
		</div>
	</section>
	<hr class="div" />
{/each}

<!-- 3. Bio info — per-part picker; Auto follows the app/device language (default). -->
<section>
	<h2><Languages size={15} /> {t('settings.translateLastfm')}<SettingHint label={t('settings.translateLastfm')} text={t('settings.translateLastfmNote')} /></h2>
	<div class="chips">
		{#each bioOptions as o (o.v)}
			<button class="chip" class:on={settings.bioLang === o.v} onclick={() => setBio(o.v)} use:tapBounce>{o.v === 'auto' ? t('settings.bioAuto') : o.v === 'off' ? t('settings.optOff') : o.label}</button>
		{/each}
	</div>
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
	/* quick-260919-ebi: the .seg CSS moved into SettingPicker.svelte — the quick-260919-2jo Chinese
	   script control is pixel-identical there, because the rules were lifted verbatim. */
	.link { background: none; border: none; color: var(--color-primary); cursor: pointer; font-size: 14px; padding: 0; }
	.div { border: none; border-top: 1px solid var(--color-border); margin: 4px 0; }
	/* quick-260919-ebi: the toggle-row CSS moved into SettingToggle.svelte. */
</style>
