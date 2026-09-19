<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    // quick-260919-ebi: Sun/Moon/Palette/Zap arrived with theme, accent and reduce-motion;
    // LayoutGrid stayed for "Covers & layout" but GRID_COLS_* left for /settings/home.
    import {
        ChevronLeft,
        Type,
        LayoutGrid,
        Sun,
        Moon,
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
    const num = (e: Event) =>
        Number((e.currentTarget as HTMLInputElement).value);
</script>

<svelte:head><title>{t("settings.title")}</title></svelte:head>

<header class="head">
    <button
        class="back"
        aria-label={t("settings.backToSettings")}
        onclick={() => goto("/settings")}
        use:tapBounce><ChevronLeft size={22} /></button
    >
    <h1>{t("settings.groupAppearance")}</h1>
    <button
        class="reset"
        onclick={() => {
            if (confirm(t("settings.resetConfirm"))) {
                settings.resetAppearance();
            }
        }}
        use:tapBounce>{t("settings.resetGroup")}</button
    >
</header>

<!-- quick-260919-ebi: Theme / Accent colour / Motion moved here from /settings/general — a page
     literally named Appearance that did not contain dark mode was the single worst findability bug
     in Settings. They sit ABOVE Text size because theme and accent frame everything below them. -->
<section>
    <h2><Sun size={15} /> {t("settings.theme")}</h2>
    <div class="seg">
        <button
            class:on={settings.theme === "dark"}
            onclick={() => setTheme("dark")}
            use:tapBounce><Moon size={15} /> {t("settings.themeDark")}</button
        >
        <button
            class:on={settings.theme === "light"}
            onclick={() => setTheme("light")}
            use:tapBounce><Sun size={15} /> {t("settings.themeLight")}</button
        >
    </div>
    <p class="note">{t("settings.themeDesc")}</p>
</section>

<section>
    <h2><Palette size={15} /> {t("settings.accentColor")}</h2>
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
    <p class="note">{t("settings.accentColorDesc")}</p>
</section>

<!-- quick-260919-ebi: "Motion" (settings.appearanceMotion), not the "Playback & motion" heading
     General borrowed — this page has no playback on it, so that key would have read as a lie. -->
<section>
    <h2><Zap size={15} /> {t("settings.appearanceMotion")}</h2>
    <button class="row-toggle" onclick={toggleMotion}>
        <span><Zap size={16} /> {t("settings.reduceMotion")}</span>
        <span class="sw" class:on={settings.reduceMotion}></span>
    </button>
    <p class="note">{t("settings.reduceMotionDesc")}</p>
</section>

<section>
    <h2><Type size={15} /> {t("settings.appearanceText")}</h2>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.fontSizeTitle")}</span><span class="val"
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
        <p class="note">{t("settings.fontSizeTitleDesc")}</p>
    </div>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.fontSizeArtist")}</span><span class="val"
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
        <p class="note">{t("settings.fontSizeArtistDesc")}</p>
    </div>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.fontSizeLyrics")}</span><span class="val"
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
        <p class="note">{t("settings.fontSizeLyricsDesc")}</p>
    </div>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.fontSizeNpTitle")}</span><span class="val"
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
        <p class="note">{t("settings.fontSizeNpTitleDesc")}</p>
    </div>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.fontSizeNpArtist")}</span><span class="val"
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
        <p class="note">{t("settings.fontSizeNpArtistDesc")}</p>
    </div>
</section>

<section>
    <h2><LayoutGrid size={15} /> {t("settings.appearanceLayout")}</h2>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.coverSize")}</span><span class="val"
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
        <p class="note">{t("settings.coverScaleDesc")}</p>
    </div>

    <!-- quick-260919-ebi: "Home grid columns" (+ its quick-260618-goe live grid demo) moved to
         /settings/home, directly after Items per shelf — the label says Home, and Home already
         owns shelf size and tile density. -->

    <p class="note">{t("settings.appearanceNote")}</p>
</section>

<style>
    .head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 14px 0 12px;
    }
    .head h1 {
        flex: 1;
    }
    .reset {
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        color: var(--color-text-muted);
        padding: 6px 12px;
        border-radius: 999px;
        font-size: 12px;
        cursor: pointer;
    }
    .reset:hover {
        color: var(--color-text);
    }
    .back {
        background: none;
        border: none;
        color: var(--color-text);
        cursor: pointer;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
    }
    .head h1 {
        font-size: 1.4rem;
        margin: 0;
    }
    section {
        margin: 18px 0;
    }
    section h2 {
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
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        font-size: 14px;
        margin-bottom: 6px;
    }
    .val {
        color: var(--color-primary);
        font-variant-numeric: tabular-nums;
        font-size: 13px;
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
        font-size: 12px;
        margin: 4px 0 0;
    }
    /* quick-260618-goe: live preview demos under Cover Size + Home Grid Columns. */
    .demo-cap {
        display: block;
        margin-top: 10px;
        font-size: 11px;
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
    .seg {
        display: inline-flex;
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        padding: 3px;
        gap: 3px;
    }
    .seg button {
        background: none;
        border: none;
        color: var(--color-text-muted);
        padding: 7px 16px;
        border-radius: 999px;
        font-size: 13px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .seg button.on {
        background: var(--color-primary);
        color: #fff;
    }
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
    .row-toggle {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        color: var(--color-text);
        padding: 13px 14px;
        border-radius: 12px;
        font-size: 14px;
        cursor: pointer;
        margin-bottom: 8px;
    }
    .row-toggle span:first-child {
        display: inline-flex;
        align-items: center;
        gap: 10px;
    }
    .sw {
        width: 40px;
        height: 22px;
        border-radius: 999px;
        background: var(--color-border);
        position: relative;
        transition: background 0.15s ease;
        flex: none;
    }
    .sw::after {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #fff;
        transition: transform 0.15s ease;
    }
    .sw.on {
        background: var(--color-primary);
    }
    .sw.on::after {
        transform: translateX(18px);
    }
    @media (prefers-reduced-motion: reduce) {
        .cover-demo-tile {
            transition: none;
        }
    }
</style>
