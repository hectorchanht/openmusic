<script lang="ts">
	// NpPreviewEditor — the Settings control for the three NOW-PLAYING-only text scales
	// (quick-260920-kxz). Sibling of RowActionsConfig: same "the preview is not a picture of the
	// effect, it is the effect" rule, same wing affordance, one deliberate difference below.
	//
	// A REPLICA, NOT AN INSTANCE — the same call RowActionsConfig made and for a sharper reason:
	// <NowPlaying> wants the live player, and mounting it here would resolve URLs, seek and fight
	// the real playback for the one <audio> element. So the hero is rebuilt from its CSS
	// formulas, copied from NowPlaying.svelte (.title/.artist) and NpLyrics.svelte (.lyrics p),
	// and kept in step BY HAND if those move.
	//
	// COMMITS LIVE, exactly like the song-row editor above it (user call, quick-260920-kxz — this
	// started as draft-then-commit with Cancel/Save and was cut back). Because the store is written
	// on every drag, applyTheme() pushes the three custom properties to :root and the mock inherits
	// the REAL values — no local shadowing needed, and the actual Now Playing surface is already
	// resized by the time the user gets back to it. The page header's "Reset this group" therefore
	// flows into the mock for free; there is no draft to keep in step with it.
	import { settings, FONT_SCALE_MIN, FONT_SCALE_MAX } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import { coverGradient } from '$lib/services/cover-gradient';

	/** Demo text from the page (D-12): the current/last-played track, or the static fallback. */
	let { title, artist }: { title: string; artist: string } = $props();

	type NpTarget = 'npTitle' | 'npArtist' | 'lyrics';

	let target = $state<NpTarget>('npTitle');

	/** Write the selected part's scale straight to the store, same shape as the song-row editor's
	 *  `commit`. `settings.save()` persists AND runs applyTheme(), which is what repaints both this
	 *  mock and the real Now Playing view. */
	function onInput(v: number) {
		if (target === 'npTitle') settings.fontScaleNpTitle = v;
		else if (target === 'npArtist') settings.fontScaleNpArtist = v;
		else settings.fontScaleLyrics = v;
		settings.save();
	}

	/** The i18n name + current percentage each wing announces — read straight off the store, which
	 *  is now the single source of truth. Reuses the existing per-part labels: the Now-Playing
	 *  sliders are gone, their names are not. */
	const wing = (k: NpTarget) =>
		k === 'npTitle'
			? { name: t('settings.fontSizeNpTitle'), value: settings.fontScaleNpTitle }
			: k === 'npArtist'
				? { name: t('settings.fontSizeNpArtist'), value: settings.fontScaleNpArtist }
				: { name: t('settings.fontSizeLyrics'), value: settings.fontScaleLyrics };
	const wingLabel = (k: NpTarget) =>
		t(target === k ? 'settings.wingPicked' : 'settings.wingPick', wing(k));
	const current = $derived(wing(target));
</script>

<!-- No local custom properties: the scoped rules below are byte-copies of NowPlaying's/NpLyrics'
     formulas and read the SAME :root values applyTheme() sets, so the mock and the real surface
     cannot drift apart. -->
<div class="np-mock">
	<!-- No wing on the cover: NowPlaying's artwork is NOT sized by `--cover-scale` (that is a
	     list-tile scale), so a cover wing here would be a control for nothing. -->
	<span class="np-art" aria-hidden="true" style:background={coverGradient(title)}></span>
	<button
		type="button"
		class="wing np-title"
		class:sel={target === 'npTitle'}
		aria-pressed={target === 'npTitle'}
		aria-label={wingLabel('npTitle')}
		onclick={() => (target = 'npTitle')}>{title}</button
	>
	<button
		type="button"
		class="wing np-artist"
		class:sel={target === 'npArtist'}
		aria-pressed={target === 'npArtist'}
		aria-label={wingLabel('npArtist')}
		onclick={() => (target = 'npArtist')}>{artist}</button
	>
	<!-- Three lines with the middle one active, mirroring NpLyrics' muted/current split. The
	     demo text is the D-12 track name and artist — a lyric mock needs no strings of its own. -->
	<button
		type="button"
		class="wing np-lyrics"
		class:sel={target === 'lyrics'}
		aria-pressed={target === 'lyrics'}
		aria-label={wingLabel('lyrics')}
		onclick={() => (target = 'lyrics')}
	>
		<span class="ly">{artist}</span>
		<span class="ly active">{title}</span>
		<span class="ly">{artist}</span>
	</button>
</div>

<div class="lab editor-lab">
	<span>{current.name}</span><span class="val">{current.value}%</span>
</div>
<input
	type="range"
	min={FONT_SCALE_MIN}
	max={FONT_SCALE_MAX}
	step="5"
	value={current.value}
	aria-label={t('settings.editorSlider', { name: current.name })}
	oninput={(e) => onInput(Number((e.currentTarget as HTMLInputElement).value))}
/>

<style>
	.np-mock {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		padding: 12px;
		border-radius: 12px;
		background: var(--color-surface);
	}
	.np-art {
		width: min(40%, 140px);
		aspect-ratio: 1 / 1;
		border-radius: 12px;
		align-self: center;
	}
	/* quick-260920-kxz — WING, the second scoped copy of RowActionsConfig's ~10 lines. Copied on
	   purpose: a third component existing only to hold one small rule would cost more than the
	   duplication, and the two mocks legitimately differ (that one has a cover wing, this one
	   must not). See the note at RowActionsConfig's `.wing`.
	   ORDER IS LOAD-BEARING — this block MUST stay ABOVE the per-part size rules below. `font:
	   inherit` is a SHORTHAND and therefore resets `font-size` to the inherited value, wiping the
	   `calc(Nrem * var(--fs-*, 1))` formulas. Svelte scopes both selectors to the same (0,2,0)
	   specificity (`.wing.svelte-x` vs `.np-title.svelte-x`), so nothing but source order breaks
	   the tie: declared after, the reset wins and the mock silently stops resizing — which is
	   exactly the bug this ordering fixes. Do NOT "fix" a recurrence by swapping the shorthand for
	   longhands; `font-weight: inherit` / `line-height: inherit` would just move the same override
	   onto `.np-title`'s weight 800 and line-height 1.2. Keep the reset first. */
	.wing {
		position: relative;
		border: 0;
		padding: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		border-radius: 6px;
		outline: 1.5px dashed color-mix(in srgb, var(--color-primary) 55%, transparent);
		outline-offset: 3px;
		background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
	}
	.wing.sel {
		outline-style: solid;
		outline-color: var(--color-primary);
		background-color: color-mix(in srgb, var(--color-primary) 18%, transparent);
	}
	.wing:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	/* Copied from NowPlaying.svelte `.title` — weight, line-height and the nowrap/ellipsis clamp
	   included, because how a long title truncates is exactly what a size change decides. */
	.np-title {
		font-size: calc(1.5rem * var(--fs-np-title, 1));
		font-weight: 800;
		line-height: 1.2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	/* NowPlaying.svelte `.artist`. */
	.np-artist {
		font-size: calc(1rem * var(--fs-np-artist, 1));
	}
	/* CENTRED, and full-width to centre against — NpLyrics.svelte's `.lyrics` is
	   `text-align: center; line-height: 1.3`, so a left-aligned replica was simply wrong about the
	   surface it mocks (quick-260920-kxz). `.wing`'s `text-align: left` reset is declared above, so
	   this wins the same-specificity tie on source order — see the ORDER IS LOAD-BEARING note. */
	.np-lyrics {
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-self: stretch;
		align-items: center;
		text-align: center;
		line-height: 1.3;
		max-width: 100%;
	}
	/* NpLyrics.svelte `.lyrics p` + `p.active`. */
	.ly {
		font-size: calc(1rem * var(--fs-lyrics, 1));
		color: var(--color-text-muted);
	}
	.ly.active {
		color: var(--color-text);
		font-weight: 700;
	}
	/* Matches the appearance page's own `.editor-lab` — the readout is the mock's caption. */
	.editor-lab {
		position: relative;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		font-size: 0.875rem;
		margin: 12px 0 6px;
	}
	.val {
		color: var(--color-primary);
		font-variant-numeric: tabular-nums;
		font-size: 0.8125rem;
	}
	input[type='range'] {
		width: 100%;
		accent-color: var(--color-primary);
	}
</style>
