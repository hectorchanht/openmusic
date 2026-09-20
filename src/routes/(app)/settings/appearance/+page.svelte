<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    // quick-260919-ebi: Sun/Moon/Palette/Zap arrived with theme, accent and reduce-motion;
    // LayoutGrid stayed for "Covers & layout" but GRID_COLS_* left for /settings/home.
    import {
        Type,
        LayoutGrid,
        Sun,
        Palette,
        Zap,
    } from "@lucide/svelte";
    import {
        settings,
        ACCENT_PRESETS,
        FONT_SCALE_MIN,
        FONT_SCALE_MAX,
        COVER_SCALE_MIN,
        COVER_SCALE_MAX,
        type Theme,
    } from "$lib/stores/settings.svelte";
    // Demo text is sourced from the current/last-played track (D-12). The page may import the
    // player — settings stays a LEAF store because the player read happens HERE, not in the
    // settings store (Pitfall 6 / SSR-leak rule).
    import { player } from "$lib/stores/player.svelte";
    import PageHeader from "$lib/components/PageHeader.svelte";
    import SettingToggle from "$lib/components/SettingToggle.svelte";
    import SettingPicker from "$lib/components/SettingPicker.svelte";
    import SettingHint from "$lib/components/SettingHint.svelte";
    import RowActionsConfig from "$lib/components/RowActionsConfig.svelte";
    import { tapBounce } from "$lib/actions/tapBounce";
    import { t } from "$lib/i18n";

    onMount(() => settings.load());

    // D-12: each slider's demo reads "example {name}" from the actual current/last-played track —
    // title-type sliders show the song name, artist-type sliders the artist name. Static fallback
    // (Stargazing / Myles Smith) when nothing has played yet.
    const demoTitle = $derived(player.current?.title ?? "Stargazing");
    const demoArtist = $derived(player.current?.artist ?? "Myles Smith");

    // Each slider writes the store + persists; applyTheme() (called inside save) pushes the new
    // CSS custom properties to <html> so every surface re-sizes live.
    function setTitle(v: number) {
        settings.fontScaleTitle = v;
        settings.save();
    }
    function setArtist(v: number) {
        settings.fontScaleArtist = v;
        settings.save();
    }
    function setLyrics(v: number) {
        settings.fontScaleLyrics = v;
        settings.save();
    }
    function setNpTitle(v: number) {
        settings.fontScaleNpTitle = v;
        settings.save();
    }
    function setNpArtist(v: number) {
        settings.fontScaleNpArtist = v;
        settings.save();
    }
    function setCover(v: number) {
        settings.coverScale = v;
        settings.save();
    }
    // quick-260919-ebi: theme / accent / reduce-motion handlers moved here from
    // /settings/general along with their rows.
    function setTheme(v: Theme) {
        settings.theme = v;
        settings.save();
    }
    function setAccent(hex: string) {
        settings.accent = hex;
        settings.save();
    }
    function toggleMotion() {
        settings.reduceMotion = !settings.reduceMotion;
        settings.save();
    }

    // quick-260919-ebi (F3): THE sanctioned literal-colour exception to the mock-primitive rule.
    // Every other preview in the app paints itself from theme tokens so it is automatically correct
    // in both themes. These two cards must do the OPPOSITE: the dark card has to look dark while
    // the LIGHT theme is active, and vice versa — that contrast IS the thing being previewed, and a
    // token would make both cards identical and the picker useless. The values are the real palette
    // from app.css (`:root` and `:root[data-theme='light']`, the blocks applyTheme() drives), not
    // eyeballed approximations; if app.css changes, these change with it.
    type Palette = {
        bg: string;
        surface2: string;
        border: string;
        text: string;
        muted: string;
    };
    const PALETTE: Record<Theme, Palette> = {
        dark: {
            bg: "#0b0b0f",
            surface2: "#1d1d27",
            border: "#888888",
            text: "#f4f4f6",
            muted: "#a0a0ad",
        },
        light: {
            bg: "#f7f7fa",
            surface2: "#ececf2",
            border: "#c5c5cf",
            text: "#1a1a22",
            muted: "#5a5a66",
        },
    };
    const num = (e: Event) =>
        Number((e.currentTarget as HTMLInputElement).value);
</script>

<svelte:head><title>{t("settings.title")}</title></svelte:head>

<PageHeader title={t("settings.groupAppearance")} backLabel={t("settings.backToSettings")} onback={() => goto("/settings")}>
    {#snippet trailing()}
        <button
            class="reset"
            onclick={() => {
                if (confirm(t("settings.resetConfirm"))) {
                    settings.resetAppearance();
                }
            }}
            use:tapBounce>{t("settings.resetGroup")}</button
        >
    {/snippet}
</PageHeader>

<!-- quick-260919-ebi: Theme / Accent colour / Motion moved here from /settings/general — a page
     literally named Appearance that did not contain dark mode was the single worst findability bug
     in Settings. They sit ABOVE Text size because theme and accent frame everything below them. -->
<!-- quick-260919-ebi (F3): one mini app-chrome mock, rendered twice in the two real palettes —
     header bar, two content lines with a cover tile, and the docked now-bar. The paragraph that
     used to explain "switches the whole app between a dark and a light look" is gone, because the
     two cards show exactly that and the sentence could only restate it. -->
{#snippet chrome(p: Palette)}
    <span
        class="mock-chrome"
        style:background={p.bg}
        style:border-radius="3px"
        style:padding="5px"
    >
        <span class="mock-bar" style:background={p.surface2}>
            <span class="mock-line" style:background={p.text} style:width="40%"
            ></span>
        </span>
        <span class="mock-row">
            <span
                class="mock-tile"
                style:background={p.surface2}
                style:border-color={p.border}
                style:width="18px"
            ></span>
            <span class="mock-col">
                <span
                    class="mock-line"
                    style:background={p.text}
                    style:width="80%"
                ></span>
                <span
                    class="mock-line"
                    style:background={p.muted}
                    style:width="55%"
                ></span>
            </span>
        </span>
        <span class="mock-bar" style:background={p.surface2}>
            <span
                class="mock-tile"
                style:background={p.bg}
                style:border-color={p.border}
                style:width="10px"
            ></span>
            <span class="mock-col">
                <span
                    class="mock-line"
                    style:background={p.text}
                    style:width="70%"
                ></span>
                <span
                    class="mock-line"
                    style:background={p.muted}
                    style:width="45%"
                ></span>
            </span>
        </span>
    </span>
{/snippet}

<section>
    <h2><Sun size={15} /> {t("settings.theme")}</h2>
    <SettingPicker
        variant="preview"
        label={t("settings.theme")}
        value={settings.theme}
        onpick={setTheme}
        options={[
            {
                v: "dark" as Theme,
                label: t("settings.themeDark"),
                preview: darkCard,
            },
            {
                v: "light" as Theme,
                label: t("settings.themeLight"),
                preview: lightCard,
            },
        ]}
    />
</section>
{#snippet darkCard()}{@render chrome(PALETTE.dark)}{/snippet}
{#snippet lightCard()}{@render chrome(PALETTE.light)}{/snippet}

<section>
    <h2><Palette size={15} /> {t("settings.accentColor")}<SettingHint label={t("settings.accentColor")} text={t("settings.accentColorDesc")} /></h2>
    <div class="swatches">
        {#each ACCENT_PRESETS as c (c)}
            <button
                class="swatch"
                class:on={settings.accent === c}
                style:background={c}
                aria-label={c}
                onclick={() => setAccent(c)}
                use:tapBounce
            ></button>
        {/each}
    </div>
</section>

<!-- quick-260919-ebi: "Motion" (settings.appearanceMotion), not the "Playback & motion" heading
     General borrowed — this page has no playback on it, so that key would have read as a lie. -->
<section>
    <h2><Zap size={15} /> {t("settings.appearanceMotion")}</h2>
    <!-- quick-260919-ebi (F2): the one shared boolean row — inset + switch + accent edge. -->
    <SettingToggle
        icon={Zap}
        label={t("settings.reduceMotion")}
        checked={settings.reduceMotion}
        onchange={toggleMotion}
        hint={t("settings.reduceMotionDesc")}
    />
</section>

<section>
    <h2><Type size={15} /> {t("settings.appearanceText")}</h2>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.fontSizeTitle")}<SettingHint label={t("settings.fontSizeTitle")} text={t("settings.fontSizeTitleDesc")} /></span><span class="val"
                >{settings.fontScaleTitle}%</span
            >
        </div>
        <input
            type="range"
            min={FONT_SCALE_MIN}
            max={FONT_SCALE_MAX}
            step="5"
            value={settings.fontScaleTitle}
            oninput={(e) => setTitle(num(e))}
        />
        <span
            class="prev"
            style:font-size={`${(1.05 * settings.fontScaleTitle) / 100}rem`}
            >{demoTitle}</span
        >
    </div>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.fontSizeArtist")}<SettingHint label={t("settings.fontSizeArtist")} text={t("settings.fontSizeArtistDesc")} /></span><span class="val"
                >{settings.fontScaleArtist}%</span
            >
        </div>
        <input
            type="range"
            min={FONT_SCALE_MIN}
            max={FONT_SCALE_MAX}
            step="5"
            value={settings.fontScaleArtist}
            oninput={(e) => setArtist(num(e))}
        />
        <span
            class="prev muted"
            style:font-size={`${(0.9 * settings.fontScaleArtist) / 100}rem`}
            >{demoArtist}</span
        >
    </div>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.fontSizeLyrics")}<SettingHint label={t("settings.fontSizeLyrics")} text={t("settings.fontSizeLyricsDesc")} /></span><span class="val"
                >{settings.fontScaleLyrics}%</span
            >
        </div>
        <input
            type="range"
            min={FONT_SCALE_MIN}
            max={FONT_SCALE_MAX}
            step="5"
            value={settings.fontScaleLyrics}
            oninput={(e) => setLyrics(num(e))}
        />
        <span
            class="prev muted"
            style:font-size={`${(1 * settings.fontScaleLyrics) / 100}rem`}
            >{demoTitle}</span
        >
    </div>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.fontSizeNpTitle")}<SettingHint label={t("settings.fontSizeNpTitle")} text={t("settings.fontSizeNpTitleDesc")} /></span><span class="val"
                >{settings.fontScaleNpTitle}%</span
            >
        </div>
        <input
            type="range"
            min={FONT_SCALE_MIN}
            max={FONT_SCALE_MAX}
            step="5"
            value={settings.fontScaleNpTitle}
            oninput={(e) => setNpTitle(num(e))}
        />
        <span
            class="prev"
            style:font-size={`${(1.5 * settings.fontScaleNpTitle) / 100}rem`}
            >{demoTitle}</span
        >
    </div>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.fontSizeNpArtist")}<SettingHint label={t("settings.fontSizeNpArtist")} text={t("settings.fontSizeNpArtistDesc")} /></span><span class="val"
                >{settings.fontScaleNpArtist}%</span
            >
        </div>
        <input
            type="range"
            min={FONT_SCALE_MIN}
            max={FONT_SCALE_MAX}
            step="5"
            value={settings.fontScaleNpArtist}
            oninput={(e) => setNpArtist(num(e))}
        />
        <span
            class="prev muted"
            style:font-size={`${(1 * settings.fontScaleNpArtist) / 100}rem`}
            >{demoArtist}</span
        >
    </div>
</section>

<section>
    <h2><LayoutGrid size={15} /> {t("settings.appearanceLayout")}</h2>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.coverSize")}<SettingHint label={t("settings.coverSize")} text={t("settings.coverScaleDesc")} /></span><span class="val"
                >{settings.coverScale}%</span
            >
        </div>
        <input
            type="range"
            min={COVER_SCALE_MIN}
            max={COVER_SCALE_MAX}
            step="5"
            value={settings.coverScale}
            oninput={(e) => setCover(num(e))}
        />
        <!-- quick-260618-goe (decision #4): live cover-size demo — three mock cover tiles
             sized off coverScale, the SAME relationship the crow fix now uses. aria-hidden. -->
        <span class="demo-cap">{t("settings.preview")}</span>
        <div class="cover-demo" aria-hidden="true">
            {#each [0, 1, 2] as i (i)}
                <span
                    class="cover-demo-tile"
                    style:width={`${(56 * settings.coverScale) / 100}px`}
                    style:height={`${(56 * settings.coverScale) / 100}px`}
                    style:background={`linear-gradient(145deg, hsl(${i * 90 + 200} 55% 38%), hsl(${i * 90 + 240} 55% 22%))`}
                ></span>
            {/each}
        </div>
    </div>

    <!-- quick-260919-l9e: the song-row buttons. NO chip list and NO separate preview — the control
         IS a replica of the row it configures, so what you arrange is what you get (the same
         what-you-see philosophy as the cover-size demo above, one step further). The .lab wrapper
         is what anchors SettingHint's panel; a bare label has no `position: relative`. -->
    <div class="ctl">
        <div class="lab">
            <span
                >{t("settings.rowButtons")}<SettingHint
                    label={t("settings.rowButtons")}
                    text={t("settings.rowButtonsDesc")}
                /></span
            >
        </div>
        <RowActionsConfig title={demoTitle} artist={demoArtist} />
    </div>

    <!-- quick-260919-ebi: "Home grid columns" (+ its quick-260618-goe live grid demo) moved to
         /settings/home, directly after Items per shelf — the label says Home, and Home already
         owns shelf size and tile density. -->

    <p class="note">{t("settings.appearanceNote")}</p>
</section>

<style>
    .reset {
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        color: var(--color-text-muted);
        padding: 6px 12px;
        border-radius: 999px;
        font-size: 0.75rem;
        cursor: pointer;
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
    .prev {
        display: inline-block;
        margin-top: 8px;
        font-weight: 700;
        line-height: 1.2;
    }
    .prev.muted {
        color: var(--color-text-muted);
        font-weight: 600;
    }
    .note {
        color: var(--color-text-muted);
        font-size: 0.75rem;
        margin: 4px 0 0;
    }
    /* quick-260618-goe: live preview demos under Cover Size + Home Grid Columns. */
    .demo-cap {
        display: block;
        margin-top: 10px;
        font-size: 0.6875rem;
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.4px;
    }
    .cover-demo {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        margin-top: 6px;
    }
    .cover-demo-tile {
        display: block;
        border-radius: var(--radius-md);
        background-color: var(--color-surface-2);
        flex: none;
        transition: width 0.12s ease, height 0.12s ease;
    }
    /* quick-260919-ebi: the segmented control, accent swatches and toggle row that arrived with
       theme / accent / reduce-motion, carried VERBATIM from /settings/general so nothing jumps. */
    /* quick-260919-ebi: the .seg CSS moved into SettingPicker.svelte; the accent swatches below
       stay local because the swatch IS already its own preview (a colour is a colour). */
    .swatches {
        display: flex;
        gap: 12px;
    }
    .swatch {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
    }
    .swatch.on {
        border-color: #fff;
        box-shadow:
            0 0 0 2px var(--color-bg),
            0 0 0 4px currentColor;
    }
    /* quick-260919-ebi: the toggle-row CSS moved into SettingToggle.svelte. */
    @media (prefers-reduced-motion: reduce) {
        .cover-demo-tile {
            transition: none;
        }
    }
</style>
