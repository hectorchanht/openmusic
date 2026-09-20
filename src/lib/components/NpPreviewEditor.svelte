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
	// DRAFT-THEN-COMMIT, unlike the song-row editor above it, which commits live. The difference
	// is not taste: a song row is on screen in every list the moment you leave this page, so a
	// live commit shows the user the real thing. The full-screen Now Playing view is NOT visible
	// from Settings — this mock is the only feedback there is — so a drag that overshoots must be
	// undoable without the user having to remember what "100%" looked like. Hence Cancel/Save.
	import { settings, FONT_SCALE_MIN, FONT_SCALE_MAX } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import { coverGradient } from '$lib/services/cover-gradient';
	import { tapBounce } from '$lib/actions/tapBounce';

	/** Demo text from the page (D-12): the current/last-played track, or the static fallback. */
	let { title, artist }: { title: string; artist: string } = $props();

	type NpTarget = 'npTitle' | 'npArtist' | 'lyrics';

	const persisted = () => ({
		npTitle: settings.fontScaleNpTitle,
		npArtist: settings.fontScaleNpArtist,
		lyrics: settings.fontScaleLyrics
	});

	let draft = $state(persisted());
	let target = $state<NpTarget>('npTitle');
	// PLAIN field, not $state — nothing renders from it; it only gates the re-seed effect below
	// (house convention: internal guards stay off the reactive graph).
	let touched = false;
	const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(persisted()));

	// Re-seed from the store while the draft is UNTOUCHED. The page header's "Reset this group"
	// button writes the store from under us; without this the mock would keep showing the old
	// numbers and Save would then push them straight back, quietly undoing the reset. A TOUCHED
	// draft is never clobbered — that is the user's in-progress edit.
	$effect(() => {
		const p = persisted();
		if (!touched) draft = p;
	});

	function onInput(v: number) {
		touched = true;
		draft = { ...draft, [target]: v };
	}
	function cancel() {
		draft = persisted();
		touched = false;
	}
	function save() {
		settings.fontScaleNpTitle = draft.npTitle;
		settings.fontScaleNpArtist = draft.npArtist;
		settings.fontScaleLyrics = draft.lyrics;
		settings.save();
		touched = false;
	}

	/** The i18n name + current DRAFT percentage each wing announces. Reuses the existing per-part
	 *  labels — the Now-Playing sliders are gone, their names are not. */
	const wing = (k: NpTarget) =>
		k === 'npTitle'
			? { name: t('settings.fontSizeNpTitle'), value: draft.npTitle }
			: k === 'npArtist'
				? { name: t('settings.fontSizeNpArtist'), value: draft.npArtist }
				: { name: t('settings.fontSizeLyrics'), value: draft.lyrics };
	const wingLabel = (k: NpTarget) =>
		t(target === k ? 'settings.wingPicked' : 'settings.wingPick', wing(k));
	const current = $derived(wing(target));
</script>

<!-- THE WHOLE TRICK: the DRAFT values are pushed as the same three custom properties the real
     surfaces read, but scoped to this subtree, where they shadow the :root values applyTheme()
     set. So the scoped rules below can be byte-copies of NowPlaying's/NpLyrics' formulas, the
     mock tracks the slider live, and the real app stays at the persisted size until Save. -->
<div
	class="np-mock"
	style:--fs-np-title={draft.npTitle / 100}
	style:--fs-np-artist={draft.npArtist / 100}
	style:--fs-lyrics={draft.lyrics / 100}
>
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

<!-- The GENERIC Cancel/Save strings, not new Now-Playing-specific ones. TrackMenu already reuses
     `tags.cancel` outside a tag dialog — these two words carry no tag meaning. -->
<div class="actions">
	<button class="mi" onclick={cancel} disabled={!dirty} use:tapBounce>{t('tags.cancel')}</button>
	<button class="mi primary" onclick={save} disabled={!dirty} use:tapBounce>{t('tags.save')}</button>
</div>

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
	.np-lyrics {
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: flex-start;
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
	/* quick-260920-kxz — WING, the second scoped copy of RowActionsConfig's ~10 lines. Copied on
	   purpose: a third component existing only to hold one small rule would cost more than the
	   duplication, and the two mocks legitimately differ (that one has a cover wing, this one
	   must not). See the note at RowActionsConfig's `.wing`. */
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
	.actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		margin-top: 8px;
	}
	.mi {
		padding: 8px 14px;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		color: var(--color-text);
		cursor: pointer;
	}
	.mi.primary {
		background: var(--color-primary);
		border-color: transparent;
		color: #fff;
	}
	.mi:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
