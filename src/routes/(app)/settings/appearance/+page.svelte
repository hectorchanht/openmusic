<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    // quick-260919-ebi: Sun/Moon/Palette/Zap arrived with theme, accent and reduce-motion;
    // LayoutGrid stayed for "Covers & layout" but GRID_COLS_* left for /settings/home.
    // quick-260920-kxz: LayoutGrid left with the "Covers & layout" heading — the section is now
    // "Song rows" (ListMusic), and Now playing got its own (Disc3).
    import {
        ListMusic,
        Disc3,
        Mic2,
        BadgeCheck,
        Music,
        RotateCcw,
    } from "@lucide/svelte";
    import {
        settings,
        FONT_SCALE_MIN,
        FONT_SCALE_MAX,
        COVER_SCALE_MIN,
        COVER_SCALE_MAX,
        LYRICS_ANCHOR_MIN,
        LYRICS_ANCHOR_MAX,
    } from "$lib/stores/settings.svelte";
    // Demo text is sourced from the current/last-played track (D-12). The page may import the
    // player — settings stays a LEAF store because the player read happens HERE, not in the
    // settings store (Pitfall 6 / SSR-leak rule).
    import { player } from "$lib/stores/player.svelte";
    import PageHeader from "$lib/components/PageHeader.svelte";
    import SettingPicker from "$lib/components/SettingPicker.svelte";
    import SettingHint from "$lib/components/SettingHint.svelte";
    import RowActionsConfig, {
        type RowScaleTarget,
    } from "$lib/components/RowActionsConfig.svelte";
    import NpPreviewEditor from "$lib/components/NpPreviewEditor.svelte";
    import { tapBounce } from "$lib/actions/tapBounce";
    import { t } from "$lib/i18n";
    import ConfirmModal from "$lib/components/ConfirmModal.svelte";

    onMount(() => settings.load());

    // User call 2026-10-06: the reset button opens an in-app confirm modal (not the
    // native window.confirm).
    let resetOpen = $state(false);

    // D-12: each slider's demo reads "example {name}" from the actual current/last-played track —
    // title-type sliders show the song name, artist-type sliders the artist name. Static fallback
    // (Stargazing / Myles Smith) when nothing has played yet.
    const demoTitle = $derived(player.current?.title ?? "Stargazing");
    const demoArtist = $derived(player.current?.artist ?? "Myles Smith");

    // Each slider writes the store + persists; applyTheme() (called inside save) pushes the new
    // CSS custom properties to <html> so every surface re-sizes live.
    //
    // quick-260920-kxz: the six per-part setters are gone. Five of them fed a flat list of
    // sliders under one "Text size" heading that mixed LIST-row scales with NOW-PLAYING-only
    // scales, so a user could not tell which surface a slider touched — the CSS wiring was
    // always split (--fs-title/--fs-artist/--cover-scale for rows, --fs-np-*/--fs-lyrics for the
    // full-screen view); only the page lied about it. Now each group is configured ON a replica
    // of its own surface, and the three Now-Playing scales live in NpPreviewEditor.
    // quick-260926-m72: where the active lyric line sits in the lyrics pane (percent of the
    // visible band). Commits live — NpLyrics reads the store, so an open pane re-anchors mid-drag.
    function setLyricsAnchor(v: number) {
        settings.lyricsAnchor = v;
        settings.save();
    }

    // ---- Song rows editor -------------------------------------------------------------
    // ONE slider, retargeted by whichever wing of the replica row is selected. Default 'title'
    // so the slider is never orphaned (a range input with nothing to drive is a dead control).
    let rowTarget = $state<RowScaleTarget>("title");
    const rowValue = $derived(
        rowTarget === "title"
            ? settings.fontScaleTitle
            : rowTarget === "artist"
              ? settings.fontScaleArtist
              : settings.coverScale,
    );
    const rowName = $derived(
        t(
            rowTarget === "title"
                ? "settings.fontSizeTitle"
                : rowTarget === "artist"
                  ? "settings.fontSizeArtist"
                  : "settings.coverSize",
        ),
    );
    // Cover size has its own, tighter bounds than the font scales.
    const rowMin = $derived(
        rowTarget === "cover" ? COVER_SCALE_MIN : FONT_SCALE_MIN,
    );
    const rowMax = $derived(
        rowTarget === "cover" ? COVER_SCALE_MAX : FONT_SCALE_MAX,
    );
    /** LIVE commit — write + save on every input event. The replica repaints because save() calls
     *  applyTheme(), which pushes the :root vars the replica reads. There is nothing to cancel
     *  here: this replica IS what every list in the app already looks like, so the user is
     *  watching the real result, not a proposal. NpPreviewEditor commits live the same way
     *  (quick-260920-kxz — it briefly had Cancel/Save; the user asked for immediate apply). */
    function setRow(v: number) {
        if (rowTarget === "title") settings.fontScaleTitle = v;
        else if (rowTarget === "artist") settings.fontScaleArtist = v;
        else settings.coverScale = v;
        settings.save();
    }
    // quick-261103-stg: theme / accent / reduce-motion (+ their handlers and the theme-card
    // PALETTE) moved UP to the /settings index General card — they change every screen, not one
    // surface. The display pickers below moved IN from Playback ("Playback & motion" held three
    // pure-display booleans). Handlers carried verbatim from there.
    // The preview picker hands back the PICKED state, so re-tapping the selected card is a no-op.
    // quick-260831-k5y: opt-in quality tag on the Now-Playing page.
    function toggleQualityTag(v: "off" | "on") { settings.showQualityTag = v === "on"; settings.save(); }
    // quick-261102-srcpill: the Now-Playing source pill, rendered before the quality tag.
    function toggleSourceTag(v: "off" | "on") { settings.showSourceTag = v === "on"; settings.save(); }
    // quick-260919-1we (D-7): opt-in lyric line in the docked mini player.
    function toggleNowbarLyrics(v: "off" | "on") { settings.nowbarLyrics = v === "on"; settings.save(); }
    const offOn = $derived([
        { v: "off" as const, label: t("settings.optOff") },
        { v: "on" as const, label: t("settings.optOn") },
    ]);
    const boolValue = (b: boolean) => (b ? "on" : "off");
    const num = (e: Event) =>
        Number((e.currentTarget as HTMLInputElement).value);
</script>

<svelte:head><title>{t("settings.title")}</title></svelte:head>

<PageHeader title={t("settings.groupAppearance")} backLabel={t("settings.backToSettings")} onback={() => goto("/settings")}>
    {#snippet trailing()}
        <button
            class="reset"
            onclick={() => (resetOpen = true)}
            use:tapBounce
            aria-label={t("settings.resetGroup")}
            title={t("settings.resetGroup")}
            ><RotateCcw size={16} /></button
        >
    {/snippet}
</PageHeader>

<ConfirmModal
    open={resetOpen}
    title={t("settings.resetGroup")}
    body={t("settings.resetConfirm")}
    confirmLabel={t("settings.resetGroup")}
    onconfirm={() => settings.resetAppearance()}
    onclose={() => (resetOpen = false)}
/>

<!-- quick-261024-sets: the ONE global slider (App text size) MOVED to the top-level
     Settings page (quick-261103-stg: now inside its General card). The surface-specific editors below
     (Song rows, Now playing) stay here: they configure a replica of their own surface. -->
<!-- quick-260920-kxz: the Song rows editor. The replica row carries BOTH controls now — the
     wings pick which part the single slider below resizes, and the button strip inside the same
     row still drags/toggles the inline actions. One mock, everything a list row can be told.
     The old "Covers & layout" section's standalone cover tiles are gone with it: the row's own
     cover wing IS the tile being resized, so a second picture of it could only disagree. -->
<section>
    <h2>
        <ListMusic size={15} /> {t("settings.songRowEditor")}<SettingHint
            label={t("settings.songRowEditor")}
            text={t("settings.songRowEditorDesc")}
        />
    </h2>

    <div class="ctl">
        <RowActionsConfig
            title={demoTitle}
            artist={demoArtist}
            target={rowTarget}
            onselect={(k) => (rowTarget = k)}
        />
        <div class="lab editor-lab">
            <span>{rowName}</span><span class="val">{rowValue}%</span>
        </div>
        <input
            type="range"
            min={rowMin}
            max={rowMax}
            step="5"
            value={rowValue}
            oninput={(e) => setRow(num(e))}
            aria-label={t("settings.editorSlider", { name: rowName })}
        />
    </div>
</section>

<!-- quick-260920-kxz: the Now playing editor. Like the Song rows editor above it, it commits
     LIVE — every drag writes the store and persists. It was built draft-then-commit (Cancel/Save)
     on the theory that a surface you cannot see from Settings needs an undo; the user asked for
     immediate apply instead, so the mock plus the per-group Reset carry that weight. -->
<section>
    <h2>
        <Disc3 size={15} /> {t("settings.npEditor")}<SettingHint
            label={t("settings.npEditor")}
            text={t("settings.npEditorDesc")}
        />
    </h2>

    <div class="ctl">
        <NpPreviewEditor title={demoTitle} artist={demoArtist} />
    </div>
</section>

<!-- quick-260926-m72: lyrics highlight position. The readout is the actual offset the pane uses
     (percent of the visible band; 50% = centred in every sheet state). -->
<section>
    <h2>
        <Mic2 size={15} /> {t("settings.lyricsAnchor")}<SettingHint
            label={t("settings.lyricsAnchor")}
            text={t("settings.lyricsAnchorDesc")}
        />
    </h2>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.lyricsAnchor")}</span><span class="val"
                >{settings.lyricsAnchor}%</span
            >
        </div>
        <input
            type="range"
            min={LYRICS_ANCHOR_MIN}
            max={LYRICS_ANCHOR_MAX}
            step="5"
            value={settings.lyricsAnchor}
            oninput={(e) => setLyricsAnchor(num(e))}
            aria-label={t("settings.lyricsAnchor")}
        />
    </div>
</section>

<!-- showQualityTag — the same title line with and without the FLAC badge. Literally the
     difference. `FLAC` is a format name, not chrome, so it needs no i18n key. -->
{#snippet tagOff()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-row">
			<span class="mock-tile" style:width="16px"></span>
			<span class="mock-col">
				<span class="mock-text">Stargazing</span>
				<span class="mock-line dim" style:width="50%"></span>
			</span>
		</span>
	</span>
{/snippet}
{#snippet tagOn()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-row">
			<span class="mock-tile" style:width="16px"></span>
			<span class="mock-col">
				<span class="mock-row">
					<span class="mock-text">Stargazing</span>
					<span class="mock-badge">FLAC</span>
				</span>
				<span class="mock-line dim" style:width="50%"></span>
			</span>
		</span>
	</span>
{/snippet}

<!-- showSourceTag (quick-261102-srcpill) — the same title line with just the quality
     badge vs with the SOURCE badge added immediately BEFORE it, exactly as the pills
     render on Now Playing. `JOOX` is a brand name, not chrome, so it needs no i18n key. -->
{#snippet srcTagOff()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-row">
			<span class="mock-tile" style:width="16px"></span>
			<span class="mock-col">
				<span class="mock-row">
					<span class="mock-text">Stargazing</span>
					<span class="mock-badge">FLAC</span>
				</span>
				<span class="mock-line dim" style:width="50%"></span>
			</span>
		</span>
	</span>
{/snippet}
{#snippet srcTagOn()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-row">
			<span class="mock-tile" style:width="16px"></span>
			<span class="mock-col">
				<span class="mock-row">
					<span class="mock-text">Stargazing</span>
					<span class="mock-badge">JOOX</span>
					<span class="mock-badge">FLAC</span>
				</span>
				<span class="mock-line dim" style:width="50%"></span>
			</span>
		</span>
	</span>
{/snippet}

<!-- nowbarLyrics — the mini bar showing the artist name vs showing a lyric line. The demo text
     is the same static fallback the Appearance demos use (Stargazing / Myles Smith), and the
     lyric is a generic stand-in rather than an invented lyric string, so nothing needs
     translating into 15 languages to draw a two-line mock. -->
{#snippet lyricsOff()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-bar">
			<span class="mock-tile" style:width="14px"></span>
			<span class="mock-col">
				<span class="mock-text">Stargazing</span>
				<span class="mock-text dim">Myles Smith</span>
			</span>
		</span>
	</span>
{/snippet}
{#snippet lyricsOn()}
	<span class="mock-chrome" style:justify-content="center">
		<span class="mock-bar">
			<span class="mock-tile" style:width="14px"></span>
			<span class="mock-col">
				<span class="mock-text">Stargazing</span>
				<span class="mock-text dim">&#9834; &#8212;&#8212;&#8212;&#8212;</span>
			</span>
		</span>
	</span>
{/snippet}

<section>
    <h2><BadgeCheck size={15} /> {t("settings.songBadges")}</h2>
	<h3 class="sub"><BadgeCheck size={14} /> {t("settings.showQualityTag")}<SettingHint label={t("settings.showQualityTag")} text={t("settings.showQualityTagDesc")} /></h3>
	<SettingPicker
		variant="preview"
		label={t("settings.showQualityTag")}
		options={[
			{ ...offOn[0], preview: tagOff },
			{ ...offOn[1], preview: tagOn }
		]}
		value={boolValue(settings.showQualityTag)}
		onpick={toggleQualityTag}
	/>

	<h3 class="sub"><Music size={14} /> {t("settings.showSourceTag")}<SettingHint label={t("settings.showSourceTag")} text={t("settings.showSourceTagDesc")} /></h3>
	<SettingPicker
		variant="preview"
		label={t("settings.showSourceTag")}
		options={[
			{ ...offOn[0], preview: srcTagOff },
			{ ...offOn[1], preview: srcTagOn }
		]}
		value={boolValue(settings.showSourceTag)}
		onpick={toggleSourceTag}
	/>

	<h3 class="sub"><Mic2 size={14} /> {t("settings.nowbarLyrics")}</h3>
	<!-- quick-260919-ebi: no hint here — the two mini bars ARE the sentence this used to carry
	     ("shows the current lyric line instead of the artist name"), word for word. -->
	<SettingPicker
		variant="preview"
		label={t("settings.nowbarLyrics")}
		options={[
			{ ...offOn[0], preview: lyricsOff },
			{ ...offOn[1], preview: lyricsOn }
		]}
		value={boolValue(settings.nowbarLyrics)}
		onpick={toggleNowbarLyrics}
	/>
</section>

<style>
    /* quick-261006-ico: icon-only reset — 40px ghost circle. */
    .reset {
        background: none;
        border: 1px solid var(--color-border);
        color: var(--color-text-muted);
        width: 40px;
        height: 40px;
        padding: 0;
        border-radius: 50%;
        cursor: pointer;
        display: inline-grid;
        place-items: center;
        flex: none;
    }
    .reset:hover {
        color: var(--color-text);
    }
    section {
        margin: 18px 0;
    }
    /* quick-260919-ebi: `position: relative` on every title that carries an inline (i) — it
       anchors SettingHint's description panel, which is scoped and cannot set this on its host. */
    section h2 {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--color-text-muted);
        margin: 0 0 14px;
    }
    .ctl {
        margin: 0 0 18px;
    }
    .lab {
        position: relative;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        font-size: 0.875rem;
        margin-bottom: 6px;
    }
    .val {
        color: var(--color-primary);
        font-variant-numeric: tabular-nums;
        font-size: 0.8125rem;
    }
    input[type="range"] {
        width: 100%;
        accent-color: var(--color-primary);
    }
    /* quick-260920-kxz: `.editor-lab` sits UNDER its mock, not above it — the mock is the
       subject being configured, the readout is its caption. */
    .editor-lab {
        margin-top: 12px;
    }
    /* quick-260920-kxz: the quick-260618-goe cover-demo tiles + `.demo-cap` (and the
       reduced-motion block that damped their transition) are gone with the section that held
       them — the replica row's cover wing replaced them. */
    /* quick-261103-stg: accent swatches moved to the /settings General card. */
    .sub { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; font-weight: 600; margin: 16px 0 8px; position: relative; }
    /* quick-260919-ebi: the toggle-row CSS moved into SettingToggle.svelte. */
</style>
