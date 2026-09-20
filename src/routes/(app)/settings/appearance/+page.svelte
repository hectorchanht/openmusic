<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    // quick-260919-ebi: Sun/Moon/Palette/Zap arrived with theme, accent and reduce-motion;
    // LayoutGrid stayed for "Covers & layout" but GRID_COLS_* left for /settings/home.
    // quick-260920-kxz: LayoutGrid left with the "Covers & layout" heading — the section is now
    // "Song rows" (ListMusic), and Now playing got its own (Disc3).
    import {
        Type,
        ListMusic,
        Disc3,
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
    import RowActionsConfig, {
        type RowScaleTarget,
    } from "$lib/components/RowActionsConfig.svelte";
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
    //
    // quick-260920-kxz: the six per-part setters are gone. Five of them fed a flat list of
    // sliders under one "Text size" heading that mixed LIST-row scales with NOW-PLAYING-only
    // scales, so a user could not tell which surface a slider touched — the CSS wiring was
    // always split (--fs-title/--fs-artist/--cover-scale for rows, --fs-np-*/--fs-lyrics for the
    // full-screen view); only the page lied about it. Now each group is configured ON a replica
    // of its own surface, and the three Now-Playing scales live in NpPreviewEditor.
    function setApp(v: number) {
        settings.fontScaleApp = v;
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
    /** LIVE commit (locked decision) — write + save on every input event. The replica repaints
     *  because save() calls applyTheme(), which pushes the :root vars the replica reads. There is
     *  nothing to cancel here: this replica IS what every list in the app already looks like, so
     *  the user is watching the real result, not a proposal. (Now playing, which the user cannot
     *  see from this page, gets draft-then-commit instead — see NpPreviewEditor.) */
    function setRow(v: number) {
        if (rowTarget === "title") settings.fontScaleTitle = v;
        else if (rowTarget === "artist") settings.fontScaleArtist = v;
        else settings.coverScale = v;
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

<!-- quick-260920-kxz: ONE global slider replaces the five-slider "Text size" block. It is the
     only sizing control on this page that is not attached to a mock, and it does not need one —
     the settings page itself is rendered at the size being dragged, so the preview is the page. -->
<section>
    <h2>
        <Type size={15} /> {t("settings.fontSizeApp")}<SettingHint
            label={t("settings.fontSizeApp")}
            text={t("settings.fontSizeAppDesc")}
        />
    </h2>

    <div class="ctl">
        <div class="lab">
            <span>{t("settings.fontSizeApp")}</span><span class="val"
                >{settings.fontScaleApp}%</span
            >
        </div>
        <input
            type="range"
            min={FONT_SCALE_MIN}
            max={FONT_SCALE_MAX}
            step="5"
            value={settings.fontScaleApp}
            oninput={(e) => setApp(num(e))}
            aria-label={t("settings.fontSizeApp")}
        />
        <!-- quick-260920-kxz: this note moved up from "Covers & layout", where it was a
             half-truth ("sizes apply across the whole app" described no slider on the page).
             Next to the global scale it is simply what the control does. -->
        <p class="note">{t("settings.appearanceNote")}</p>
    </div>
</section>

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

<!-- quick-260920-kxz: the Now playing editor mounts here (Task 3). -->

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
    /* quick-260920-kxz: `.editor-lab` sits UNDER its mock, not above it — the mock is the
       subject being configured, the readout is its caption. */
    .editor-lab {
        margin-top: 12px;
    }
    .note {
        color: var(--color-text-muted);
        font-size: 0.75rem;
        margin: 4px 0 0;
    }
    /* quick-260920-kxz: the quick-260618-goe cover-demo tiles + `.demo-cap` (and the
       reduced-motion block that damped their transition) are gone with the section that held
       them — the replica row's cover wing replaced them. */
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
</style>
