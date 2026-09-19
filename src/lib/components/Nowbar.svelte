<script lang="ts">
    // Reusable compact "now bar" (mtv-followup). Originally lived inline in (app)/+layout.svelte;
    // extracted here so NowPlaying.svelte can reuse the same shape as the YT-Music-style sticky
    // mini-bar when the queue/lyrics sheet is fully open. Two variants:
    //   - 'docked' (default): position:fixed near the bottom of the viewport, the original
    //     layout-level mini-player. `.np-open` calls player.expand() unless overridden.
    //   - 'embed': position:static, sits in the parent's normal flow. Used inside NowPlaying.svelte
    //     in the fullshrink layout so the cover/title/artist/play row stays visible above the
    //     open subnav sheet.
    import {
        Play,
        Pause,
        Loader,
        Moon,
        SkipBack,
        SkipForward,
        Volume1,
        Volume2,
        VolumeX,
    } from "@lucide/svelte";
    import { fade } from "svelte/transition";
    import { player, fmtTime } from "$lib/stores/player.svelte";
    import { names } from "$lib/stores/names.svelte";
    import { settings } from "$lib/stores/settings.svelte";
    import { sleepTimer } from "$lib/stores/sleepTimer.svelte";
    import { coverSwipe } from "$lib/actions/coverSwipe";
    import { tapBounce } from "$lib/actions/tapBounce";
    import { t, tMaybeKey } from "$lib/i18n";
    import { marquee } from "$lib/actions/marquee";
    // quick-260919-1we (F2): the docked mini player's lyric line. parseLRC + the SHARED active-line
    // scan, over the SHARED pin-aware lyrics read — so the line shown here is the same LRC the
    // NowPlaying pane shows, including a user's Fix-lyrics pick (D-4).
    // quick-260919-2jo: `parseLyrics`, NOT the raw `parseLRC` — the one lyric seam that applies the
    // Chinese script lock (and repaints live when it is flipped). Same signature, same output shape.
    import { activeLineAt } from "$lib/services/lrc";
    import { parseLyrics } from "$lib/stores/lyric-script.svelte";
    import { readLyrics } from "$lib/stores/lyric-pins.svelte";

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

    // quick-260919-1we (F2): the currently-sung line, or "" to keep the artist line.
    //
    // 1. parseLRC ONLY — deliberately no reorderPairs / splitParenLines. Those two exist to serve
    //    NowPlaying's stacked pane (an original/translation pair rendered on two rows); one line in
    //    an 11px row has no room for a pair, so raw parsed lines are the right granularity here.
    //    This derived depends on the lyric STRING, not on currentTime, so it costs one pass over the
    //    LRC per TRACK — not per tick. quick-260919-2jo: the script conversion rides INSIDE that same
    //    once-per-track pass (parseLyrics), so the per-tick scan below still walks plain strings.
    const lyricLines = $derived(parseLyrics(readLyrics(player.current)));
    // 2. The early return gates the whole scan: with the setting off this costs one boolean read per
    //    tick and nothing else. `variant !== "docked"` is D-8's embed exclusion — repeating the
    //    current line directly above NowPlaying's full lyrics pane is noise.
    // 3. It returns a STRING. player.currentTime changes ~4x/s so this re-evaluates ~4x/s, but
    //    Svelte 5 only writes the DOM when the VALUE changes — so the repaint (and the {#key} fade)
    //    happens on LINE change, never once per timeupdate tick. No $effect, no logAction, nothing
    //    else on the timeupdate firehose.
    //
    // parseLRC silently drops every line with no timestamp, so an unsynced plain-text LRC yields []
    // -> "" -> the artist line renders unchanged. Same for an instrumental and for no lyrics at all.
    // That is the whole degrade story; it needs no extra branch.
    // quick-260919-1we (correction): the layout SWITCH. D-8 made the lyric REPLACE the artist, and
    // the user rejected that trade - losing the artist was too much information. Their own two
    // options were a third line or artist-on-the-title-line; this is the second, because of what
    // D-8 was actually right about: the Nowbar is a fixed --nowbar-h (64px) docked bar and MUST NOT
    // jump. A third line makes the meta column 3 rows when a lyric exists and 2 when it doesn't -
    // a per-track, and during an instrumental gap a per-SECOND, height change. Moving the artist up
    // keeps the column at exactly TWO rows in every state there is:
    //   setting off          -> title / artist
    //   setting on, lyric    -> title . artist / lyric
    //   setting on, no lyric -> title . artist / (empty, height-reserved)
    // Two rows always, so nothing can shift: not between tracks, not when an LRC is unsynced
    // (parseLRC drops untimestamped lines -> [] -> ""), not in an instrumental gap, not when the
    // lyrics resolve async mid-track. The reserved row is a plain fixed height on .np-lyricrow, not
    // a &nbsp; or a min-height, so "empty" and "full" are byte-identical geometry.
    //
    // This is SETTING-driven, never TRACK-driven, and that is the whole point. Deciding the layout
    // per track (two-line-with-artist only for tracks that HAVE lyrics) would look tidier for a
    // no-lyric track but reintroduces exactly the jump D-8 forbade, one per track change and one
    // more whenever a late lyric resolve lands.
    const lyricsRow = $derived(settings.nowbarLyrics && variant === "docked");

    const lyricText = $derived.by(() => {
        if (!lyricsRow) return "";
        // A playback error must never be hidden behind a lyric. When there IS an error the Nowbar is
        // not the surface to show the song's poetry on, so the artist+error branch takes the row back.
        if (player.error) return "";
        const { idx } = activeLineAt(lyricLines, player.currentTime);
        return idx >= 0 ? lyricLines[idx].text : "";
    });

    // NP-05 boundaries (D-02): rubber-band a prev swipe on the first track, but always allow a
    // next swipe while a current track exists. player.next() owns queue growth, so an end-of-queue
    // left swipe must commit and let the store top up instead of resisting at the visual boundary.
    const npIndex = $derived(
        player.queue.findIndex((t) => t.uid === player.current?.uid),
    );
    const hasPrevNeighbor = $derived(npIndex !== 0);
    const hasNextNeighbor = $derived(!!player.current);

    // quick-260919-et3: the desktop player-bar gate. et3 already made this bar span rail-edge to
    // window-edge at >=1024px; this fills it in with the YouTube-Music transport (prev/play/next +
    // elapsed/total) and a volume control.
    //
    // This is a DOM gate, not just a CSS one, and the `(hover: hover)` half is the reason. iOS
    // ignores `audio.volume` entirely (writes are swallowed, reads stay 1), so a volume slider on a
    // touch surface is a control that visibly does nothing. A width-only query would render one on
    // a landscape tablet. Requiring a hover-capable pointer keeps every touch device — phone,
    // tablet, touchscreen laptop in touch mode — on the untouched mobile markup: no slider, no
    // speaker button, no transport, nothing in the DOM at all.
    //
    // `variant === "docked"` is the second exclusion: the `embed` variant renders INSIDE the open
    // NowPlaying sheet, which has its own full transport a few hundred pixels below.
    let hoverDesktop = $state(false);
    $effect(() => {
        const mq = window.matchMedia("(min-width: 1024px) and (hover: hover)");
        hoverDesktop = mq.matches;
        const onChange = () => (hoverDesktop = mq.matches);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    });
    const desktopBar = $derived(hoverDesktop && variant === "docked");

    // quick-260919-et3: the `2:06 / 2:33` readout. fmtTime is the store's existing NaN/Infinity-safe
    // formatter (player.svelte.ts) — not a second one.
    //
    // These are $derived and $derived is LAZY: on mobile `.np-time` is never rendered, so neither
    // one is ever read and neither is ever computed. player.currentTime is a ~4x/s firehose, but a
    // derived STRING only writes the DOM when the string changes — i.e. once per second, one text
    // node, no $effect and nothing else on the tick path (same property the 1we lyric row has).
    //
    // player.duration is documented as "0 until loadedmetadata; never NaN", so the unknown-duration
    // state is `duration > 0`, not a NaN check. It renders a fixed-width em dash pair and .np-time
    // carries a min-width, so the readout box is the same size before and after metadata lands and
    // the same size at 0:59 and 10:00 — no twitch, ever.
    const elapsedText = $derived(fmtTime(player.currentTime));
    const totalText = $derived(
        player.duration > 0 ? fmtTime(player.duration) : "—:—",
    );

    // quick-260919-et3: muted OR dragged to zero both read as "no sound", so both show VolumeX and
    // both label the button "Unmute" — clicking it must give sound back either way, which
    // player.toggleMute() + setVolume's unmute-on-raise contract already guarantee.
    const silent = $derived(player.muted || player.volume === 0);

    function fallbackCover(): string {
        return "linear-gradient(145deg,#3a2d63,#1a1326)";
    }
    function handleOpen() {
        if (onOpen) onOpen();
        else player.expand();
    }
</script>

<!-- quick-260919-et3: the play/pause control, lifted into a snippet so the desktop transport
     cluster and the mobile right-hand button are the SAME markup rather than two copies that
     drift. Exactly one call site renders per breakpoint. The resolving-spinner branch, the
     .motion-always escape hatch and the .play-glyph crossfade are all carried over verbatim. -->
{#snippet playControl()}
    {#if resolving}
        <span
            class="np-btn np-spin motion-always"
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
{/snippet}

{#if np}
    <div class="nowbar" class:embed={variant === "embed"}>
        <div class="np-prog" class:indet={player.loading}>
            {#if player.loading}
                <!-- quick-260809-mvz: `.motion-always` — the indeterminate loader rail is the same
                     kind of "still working" signal as the spinner, so neither reduce-motion gate
                     may touch it. Full speed everywhere; see the .sliver rule below. -->
                <i class="sliver motion-always"></i>
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
        {#if desktopBar}
            <!-- quick-260919-et3: the YouTube Music transport cluster — prev / play / next then
                 `2:06 / 2:33`, pinned to the LEFT of the bar as in the reference. It sits OUTSIDE
                 .np-open on purpose: .np-open is the tap-to-expand + coverSwipe surface, and a
                 nested <button> there would be invalid HTML and would fight the gesture.
                 Reuses nowplaying.previous / nowplaying.next — the same actions, so the same
                 labels; no new keys for something already named. -->
            <div class="np-transport">
                <button
                    class="np-t"
                    aria-label={t("nowplaying.previous")}
                    onclick={() => player.prev()}
                    use:tapBounce><SkipBack size={20} /></button
                >
                {@render playControl()}
                <button
                    class="np-t"
                    aria-label={t("nowplaying.next")}
                    onclick={() => player.next()}
                    use:tapBounce><SkipForward size={20} /></button
                >
                <span class="np-time">{elapsedText} / {totalText}</span>
            </div>
        {/if}
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
                        {names.dnTitle(np?.title ?? "")}{#if lyricsRow}<span
                                class="np-tl-artist"
                                >· {names.dnArtist(np?.artist ?? "")}</span
                            >{/if}
                        </span>
                    </span>
                    <!-- quick-260919-1we (correction): the second row. With lyricsRow on it belongs
                         to the lyric ALONE - the artist moved up to the title line, so a lyric no
                         longer costs it (the user's objection to D-8). .np-lyricrow pins the row's
                         height so an empty lyric (no LRC / unsynced / instrumental gap) occupies the
                         same box a full one does; see the lyricsRow comment for why that is the one
                         thing this row must guarantee.
                         The error branch stays FIRST and still wins: a playback failure is not
                         something to hide behind a song's poetry, and the second row is where the
                         Nowbar has always put it.
                         xfadeMs is the file's existing reduced-motion-aware duration (0 under
                         settings.reduceMotion OR the OS query) - reused, not a second motion gate.
                         in: only, no out:: an outgoing line animating while the incoming one arrives
                         in the same 11px row reads as a smear. The {#key lyricText} block is the
                         1we performance property and is unchanged - it remounts on the line VALUE
                         changing, i.e. per LINE, never per timeupdate tick. -->
                    <span class="np-artist" class:np-lyricrow={lyricsRow} use:marquee>
                        <span class="marquee-inner">
                        {#if player.error}
                            {#if !lyricsRow}{names.dnArtist(np?.artist ?? "")} · {/if}<span class="err"
                                >{tMaybeKey(player.error)}</span
                            >
                        {:else if lyricsRow}
                            {#if lyricText}
                                {#key lyricText}
                                    <span class="np-lyric" in:fade={{ duration: xfadeMs }}>{lyricText}</span>
                                {/key}
                            {/if}
                        {:else}
                            {names.dnArtist(np?.artist ?? "")}
                        {/if}
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
        {#if desktopBar}
            <!-- quick-260919-et3: the far-right volume control. A NATIVE <input type="range"> —
                 it is keyboard-operable, screen-reader-labelled and drag-correct for free, and a
                 hand-rolled pointer-drag slider would be a hundred lines to get worse.
                 `value={player.muted ? 0 : player.volume}` keeps the thumb honest while muted
                 without destroying the level the store is holding for the unmute. -->
            <div class="np-vol">
                <button
                    class="np-volbtn"
                    aria-label={t(silent ? "nowbar.unmute" : "nowbar.mute")}
                    onclick={() => player.toggleMute()}
                    use:tapBounce
                >
                    {#if silent}<VolumeX size={18} />{:else if player.volume < 0.5}<Volume1
                            size={18}
                        />{:else}<Volume2 size={18} />{/if}
                </button>
                <input
                    class="np-volrange"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    aria-label={t("nowbar.volume")}
                    value={player.muted ? 0 : player.volume}
                    oninput={(e) =>
                        player.setVolume(e.currentTarget.valueAsNumber)}
                />
            </div>
        {:else}
            {@render playControl()}
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
    /* quick-260809-mvz: no reduced-motion slowdown. The rail ran at 2.2s instead of 1.1s under the
       OS pref, which is the same "still working" signal moving at half speed for no benefit — it
       runs at one speed everywhere now, like the spinner it sits next to. */
    .np-open[disabled] {
        cursor: default;
    }
    /* quick-260809-mvz: the rotation moved OFF the inner <svg> onto .np-spin itself. app.css's
       reduce-motion escape hatch is a `.motion-always` CLASS, and we cannot put a class on the
       Lucide-rendered svg — but .np-btn is a solid 40px circle, so spinning the button box instead
       of the glyph is pixel-identical. The resolve spinner now turns under both reduce-motion
       gates; a frozen one reads as a hung app. */
    .np-spin {
        display: grid;
        place-items: center;
        opacity: 0.85;
        animation: np-spin 0.9s linear infinite;
    }
    @keyframes np-spin {
        to {
            transform: rotate(360deg);
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
    /* quick-260919-1we (correction): the artist, appended to the title line so the lyric can have
       the second row to itself. Regular weight at 0.7 opacity keeps the title the thing the eye
       lands on - this is the same line, not a promotion. */
    .np-tl-artist {
        font-weight: 400;
        opacity: 0.7;
        margin-left: 4px;
    }
    /* quick-260919-1we (correction): the height reservation, and the only load-bearing rule in this
       change. The second row is fixed at its own line box whether it holds a lyric, an error, or
       nothing at all, so the docked bar's geometry is identical for a track with an LRC, a track
       with an unsynced LRC, a track with no lyrics, and a track sitting in an instrumental gap.
       Without this the empty row would collapse to 0 and the title would slide down. */
    .np-lyricrow {
        height: 14px;
        line-height: 14px;
    }
    .np-lyric {
        font-size: 11px;
        color: var(--color-text);
        opacity: 0.9;
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

    /* quick-260919-et3 (D-6): at desktop the tab bar is a LEFT RAIL, so nothing occupies the
       bottom edge any more — the docked nowbar drops to the floor and starts where the rail ends.
       `right: 0`, the height, the blur and the border-top all still apply, so it spans rail-edge
       to window-edge: the YouTube Music desktop player bar, for three declarations.

       `:not(.embed)` is a guard, not decoration — `.embed` is the position:static variant that
       NowPlaying mounts inside itself, and a leaked `left` offset there would shove it sideways
       inside the sheet.

       Explicitly NOT done: a desktop two-pane now-playing (cover left, queue + lyrics right), a
       desktop-specific transport layout, or any restructuring of NowPlaying.svelte. Tapping this
       bar at desktop still opens the same full-screen sheet, which still covers the rail. That is
       a deliberate omission, not an oversight: CLAUDE.md flags NowPlaying.svelte (~2000 lines) as
       a re-render hotspot to SPLIT, and growing it with a desktop variant is how it got that big. */
    @media (min-width: 1024px) {
        .nowbar:not(.embed) {
            left: var(--rail-w);
            bottom: 0;
        }

        /* quick-260919-et3 (fill-in): the transport + volume clusters. EVERY rule for them lives
           inside this media query — not because the elements could otherwise leak (they are
           `{#if desktopBar}`-gated and simply do not exist on mobile) but because the file's
           mobile-safety audit greps for exactly that, and a rule sitting outside would be a false
           positive that costs someone a re-audit.

           Both clusters are `flex: none` inside a `height: var(--nowbar-h)` / `overflow: hidden`
           bar, and their tallest child is the existing 40px .np-btn. The bar's height is a fixed
           custom property, so 64px is structurally guaranteed in every state (lyric, no lyric,
           instrumental gap, error) — the 1we measurement stands untouched. */
        .np-transport {
            display: flex;
            align-items: center;
            gap: 4px;
            flex: none;
        }
        /* Prev/next: flat ghost buttons, deliberately NOT the filled primary circle — the play
           button stays the one accented control in the cluster, as in the reference. */
        .np-t {
            background: none;
            border: none;
            color: var(--color-text);
            width: 34px;
            height: 34px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            cursor: pointer;
            opacity: 0.85;
            transition:
                background 0.12s ease,
                transform 0.12s ease;
        }
        .np-t:hover {
            background: rgba(255, 255, 255, 0.1);
            opacity: 1;
        }
        .np-t:active {
            transform: scale(0.92);
        }
        /* tabular-nums + min-width is the no-twitch pair: equal-width digits stop the readout
           breathing every second, and the reserved box stops 0:59 -> 10:00 (and the pre-metadata
           em-dash state) from nudging the cover and title sideways. */
        .np-time {
            margin-left: 8px;
            font-size: 12px;
            color: var(--color-text);
            opacity: 0.7;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
            min-width: 84px;
            text-align: center;
        }

        .np-vol {
            display: flex;
            align-items: center;
            gap: 6px;
            flex: none;
        }
        .np-volbtn {
            background: none;
            border: none;
            color: var(--color-text);
            width: 34px;
            height: 34px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            cursor: pointer;
            opacity: 0.85;
            transition:
                background 0.12s ease,
                transform 0.12s ease;
        }
        .np-volbtn:hover {
            background: rgba(255, 255, 255, 0.1);
            opacity: 1;
        }
        .np-volbtn:active {
            transform: scale(0.92);
        }
        /* `appearance: none` + an explicit track/thumb is required because the two vendors
           disagree about everything else; the element itself stays a native range input, so
           keyboard arrows, Home/End and pointer capture keep working for free. */
        .np-volrange {
            -webkit-appearance: none;
            appearance: none;
            width: 90px;
            height: 4px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.25);
            cursor: pointer;
        }
        .np-volrange::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: var(--color-text);
            cursor: pointer;
        }
        .np-volrange::-moz-range-thumb {
            width: 12px;
            height: 12px;
            border: none;
            border-radius: 50%;
            background: var(--color-text);
            cursor: pointer;
        }
    }
</style>
