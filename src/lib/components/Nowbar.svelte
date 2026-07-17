<script lang="ts">
    // Reusable compact "now bar" (mtv-followup). Originally lived inline in (app)/+layout.svelte;
    // extracted here so NowPlaying.svelte can reuse the same shape as the YT-Music-style sticky
    // mini-bar when the queue/lyrics sheet is fully open. Two variants:
    //   - 'docked' (default): position:fixed near the bottom of the viewport, the original
    //     layout-level mini-player. `.np-open` calls player.expand() unless overridden.
    //   - 'embed': position:static, sits in the parent's normal flow. Used inside NowPlaying.svelte
    //     in the fullshrink layout so the cover/title/artist/play row stays visible above the
    //     open subnav sheet.
    import { Play, Pause, Loader, Moon } from "@lucide/svelte";
    import { fade } from "svelte/transition";
    import { player, fmtTime } from "$lib/stores/player.svelte";
    import { names } from "$lib/stores/names.svelte";
    import { settings } from "$lib/stores/settings.svelte";
    import { sleepTimer } from "$lib/stores/sleepTimer.svelte";
    import { coverSwipe } from "$lib/actions/coverSwipe";
    import { tapBounce } from "$lib/actions/tapBounce";
    import { t, tMaybeKey } from "$lib/i18n";
    import { marquee } from "$lib/actions/marquee";

    type Variant = "docked" | "embed";

    let {
        variant = "docked",
        onOpen,
    }: {
        variant?: Variant;
        onOpen?: () => void;
    } = $props();

    const np = $derived(player.current ?? player.pendingTrack);
    const resolving = $derived(!player.current && !!player.pendingTrack);

    // NOWBAR-XFADE: on track change the {#key np?.uid} block remounts the cover + title + artist so
    // an in:/out:fade crossfades the outgoing content out while the incoming fades in (mirrors the
    // NowPlaying meta crossfade). This is a Svelte JS transition, so the global app.css
    // `:root[data-reduce-motion] * { transition:none!important }` rule does NOT stop it — it must be
    // guarded explicitly. settings.reduceMotion is the app flag (wired to :root[data-reduce-motion]);
    // OR the OS prefers-reduced-motion query so OS-only users also get the instant swap. Duration 0
    // → instant remount, no animated fade. The existing @media .np-open { transition:none } rule
    // stays as-is — it governs the coverSwipe slide, not this content fade.
    const osReduceMotion =
        typeof window !== "undefined" && window.matchMedia
            ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
            : false;
    const xfadeMs = $derived(
        settings.reduceMotion || osReduceMotion ? 0 : 200,
    );
    // Track-identity key for the crossfade remount. player.current is a full Track (has uid);
    // player.pendingTrack is a {artist,title,cover} stub with no uid — fall back to artist|title so
    // an optimistic stub also keys distinctly and crossfades when the real track resolves.
    const npKey = $derived(
        player.current?.uid ?? `${np?.artist ?? ""}|${np?.title ?? ""}`,
    );

    // NP-05 boundaries (D-02): rubber-band a prev swipe on the first track, but always allow a
    // next swipe while a current track exists. player.next() owns queue growth, so an end-of-queue
    // left swipe must commit and let the store top up instead of resisting at the visual boundary.
    const npIndex = $derived(
        player.queue.findIndex((t) => t.uid === player.current?.uid),
    );
    const hasPrevNeighbor = $derived(npIndex !== 0);
    const hasNextNeighbor = $derived(!!player.current);

    function fallbackCover(): string {
        return "linear-gradient(145deg,#3a2d63,#1a1326)";
    }
    function handleOpen() {
        if (onOpen) onOpen();
        else player.expand();
    }
</script>

{#if np}
    <div class="nowbar" class:embed={variant === "embed"}>
        <div class="np-prog" class:indet={player.loading}>
            {#if player.loading}
                <i class="sliver"></i>
            {:else}
                <i
                    style:width={`${player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0}%`}
                ></i>
            {/if}
        </div>
        <!-- NP-05 (D-06): a horizontal swipe on the content row slides it 1:1 and snaps, or slides
             off + swaps the track on commit/flick — the lighter mini-player surface, NOT a peeking
             multi-cover carousel. The node-tested coverSwipe drives node.style.transform itself, so
             no local slideX binding is needed (same idiom as NowPlaying's .cover-strip). Direction
             matches the cover: drag left→right = prev, right→left = next, same 0.28×width commit +
             0.5px/ms flick + boundary rubber-band only for prev at the first track. coverSwipe NEVER setPointerCapture-s on
             pointerdown and arms a one-shot trailing-click suppressor only on a committed swipe, so a
             sub-slop tap still reaches onclick={handleOpen} (tap-to-expand, D-07) while a committed
             swipe never replays it. Attached to .np-open ONLY — the .np-prog loader rail above sits
             OUTSIDE this button and stays visually pinned while the content slides (UI-SPEC §5). -->
        <button
            class="np-open"
            aria-label={t("nowbar.openNowPlaying")}
            disabled={resolving}
            onclick={handleOpen}
            use:coverSwipe={{
                onprev: () => player.prev(),
                onnext: () => player.next(),
                hasPrev: hasPrevNeighbor,
                hasNext: hasNextNeighbor,
                enabled: !resolving,
            }}
        >
            <!-- COVER-01 (D-09): the single player.resolvedCover field is the primary art source —
                 it is set synchronously on play() from track/cache and reactively updated when the
                 async tier chain lands, so a no-cover-source track shows resolved art here once the
                 chain settles. While still resolving an optimistic stub (current null, pendingTrack
                 set), fall back to the tapped np.cover, then to the seeded gradient (D-12).
                 NOWBAR-XFADE: .np-art + .np-meta are wrapped in {#key npKey} so a track change
                 remounts them and the in:/out:fade crossfades cover + text together. They stay
                 DIRECT flex children of .np-open (no wrapper element) so the 10px gap + ellipsis
                 layout is byte-unchanged. coverSwipe is on the un-keyed .np-open button, so the
                 gesture surface is never remounted mid-drag (the slide is the button transform; the
                 crossfade is the inner content swap on the post-commit store change). -->
            {#key npKey}
                <span
                    class="np-art"
                    in:fade={{ duration: xfadeMs }}
                    out:fade={{ duration: xfadeMs }}
                    style:background-image={(player.resolvedCover ?? np?.cover)
                        ? `url(${player.resolvedCover ?? np?.cover})`
                        : fallbackCover()}
                ></span>
                <span
                    class="np-meta"
                    in:fade={{ duration: xfadeMs }}
                    out:fade={{ duration: xfadeMs }}
                >
                    <span class="np-title" use:marquee>
                        <span class="marquee-inner">
                        {names.dnTitle(np?.title ?? "")}
                        </span>
                    </span>
                    <span class="np-artist" use:marquee>
                        <span class="marquee-inner">
                        {names.dnArtist(np?.artist ?? "")}
                        {#if player.error}· <span class="err"
                            >{tMaybeKey(player.error)}</span
                        >{/if}
                        </span>
                    </span>
                </span>
            {/key}
        </button>
        {#if sleepTimer.active}
            <!-- Active sleep-timer indicator: tappable, opens the global sheet (D-08). On the
			     nowbar D-07 allows icon-only; the mm:ss countdown is shown for minutes mode when
			     present. The . st-label container is min-0 so the short countdown never breaks the
			     row layout (memory rule). End-of-track mode shows the moon alone. -->
            <button
                class="st-badge"
                aria-label={t("menu.sleepTimer")}
                onclick={() => (sleepTimer.sheetOpen = true)}
                use:tapBounce
            >
                <Moon size={16} />
                {#if sleepTimer.mode === "minutes"}<span class="st-label"
                        >{fmtTime(sleepTimer.remaining / 1000)}</span
                    >{/if}
            </button>
        {/if}
        {#if resolving}
            <span
                class="np-btn np-spin"
                aria-label={t("common.loading")}
                aria-busy="true"><Loader size={18} /></span
            >
        {:else}
            <button
                class="np-btn"
                aria-label={t("nowbar.playPause")}
                onclick={() => player.toggle()}
                use:tapBounce
            >
                <span
                    class="play-glyph"
                    class:is-playing={player.playing}
                    aria-hidden="true"
                >
                    <span class="pg pg-play"><Play size={18} /></span>
                    <span class="pg pg-pause"><Pause size={18} /></span>
                </span>
            </button>
        {/if}
    </div>
{/if}

<style>
    .nowbar {
        /* quick-260611-fr9: docked nowbar blends flush with the tabbar as one continuous bottom
		   surface (YT-Music style). Full-width, bottom flush on top of the tabbar (which owns the
		   safe-area inset — do NOT add safe-area padding here or it double-counts), rounded TOP
		   corners only + square bottom, single divider (tabbar's own border-top). The `.embed`
		   variant below is unchanged. */
        position: fixed;
        left: 0;
        right: 0;
        bottom: var(--tabbar-h);
        height: var(--nowbar-h);
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        background: var(--color-bg);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        /* Top + sides only — no bottom border so there's no double divider against the tabbar. */
        /*border-width: 1px 1px 0 1px;
        border-style: solid;
        border-color: rgba(255, 255, 255, 0.08);*/
        margin: 0 auto;
        z-index: 20;
        overflow: hidden;
        border-top: 1px solid var(--color-border);
    }

    /* Ensure child content stays interactive and on top */
    .nowbar > * {
        position: relative;
        z-index: 2;
    }
    /* Embed variant: same visual shell, no fixed positioning. Parent (.np.fullshrink) owns
	   the placement so this bar can sit at the top of the now-playing view. */
    .nowbar.embed {
        position: static;
        left: auto;
        right: auto;
        bottom: auto;
        margin: 0;
        padding-left: 0;
        padding-right: 0;
        max-width: none;
        z-index: 4;
    }
    .np-prog {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: rgba(255, 255, 255, 0.12);
    }
    .np-prog > i {
        display: block;
        height: 100%;
        background: var(--color-primary);
        transition: width 0.25s linear;
    }
    .np-prog.indet {
        overflow: hidden;
    }
    .np-prog.indet > i.sliver {
        width: 35%;
        transition: none;
        animation: np-indet 1.1s ease-in-out infinite;
    }
    @keyframes np-indet {
        0% {
            transform: translateX(-110%);
        }
        100% {
            transform: translateX(310%);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .np-prog.indet > i.sliver {
            animation-duration: 2.2s;
        }
    }
    .np-open[disabled] {
        cursor: default;
    }
    .np-spin {
        display: grid;
        place-items: center;
        opacity: 0.85;
    }
    .np-spin :global(svg) {
        animation: np-spin 0.9s linear infinite;
    }
    @keyframes np-spin {
        to {
            transform: rotate(360deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .np-spin :global(svg) {
            animation: none;
        }
    }
    .np-open {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 10px;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        text-align: left;
        color: inherit;
    }
    /* NP-05 reduced-motion: coverSwipe sets the spring-back/commit `transition` inline on .np-open,
       so collapse it to instant here (the track change still happens, only the slide animation is
       removed — UI-SPEC §5 / mirrors NowPlaying's .cover-strip reduced-motion override). */
    @media (prefers-reduced-motion: reduce) {
        .np-open {
            transition: none !important;
        }
    }
    .np-art {
        width: 44px;
        height: 44px;
        border-radius: 8px;
        background-size: cover;
        background-position: center;
        flex: none;
    }
    .np-meta {
        min-width: 0;
        display: flex;
        flex-direction: column;
        background: var(--color-bg);
        padding: 1px;
        border-radius: none;
    }
    /* Nowbar surface is always the dark-translucent purple panel (in both themes), so the
	   text colors are pinned to light tones rather than tracking --color-text — otherwise the
	   light theme inverts text to near-black and the nowbar reads as dark-on-dark. */
    .np-title {
        display: block;
        font-size: 13px;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--color-text);
    }
    .np-artist {
        display: block;
        font-size: 11px;
        color: var(--color-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .err {
        color: #ff7a90;
    }
    .np-btn {
        background: var(--color-primary);
        border: none;
        color: #fff;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        cursor: pointer;
        flex: none;
        display: grid;
        place-items: center;
        transition: transform 0.12s ease;
    }
    /* MENU-03 / D-12: hover-capable devices only — on touch a held finger latches the
       :active scale; use:tapBounce supplies the one-shot touch press feedback instead. */
    @media (hover: hover) {
        .np-btn:active {
            transform: scale(0.92);
        }
    }
    /* Sleep-timer badge: a small subtle variant of .np-btn (NOT the primary play button) — pill,
	   transparent, sits to the LEFT of the play button. min-0 label so the mm:ss never overflows. */
    .st-badge {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: none;
        min-width: 0;
        max-width: 88px;
        height: 32px;
        padding: 0 10px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: var(--color-text);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        transition: transform 0.12s ease;
    }
    @media (hover: hover) {
        .st-badge:active {
            transform: scale(0.92);
        }
    }
    .st-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
