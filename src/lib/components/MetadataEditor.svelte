<script lang="ts">
	// MetadataEditor (quick-260919-1eh) — edit the song title / artist / album of a file this app
	// holds an OFFLINE COPY of, and write them into the audio file's OWN tags.
	//
	// WHY IT EXISTS. Phase 36 taught the app to WRITE tags at download time and Phase 37 taught it to
	// READ them back; the missing verb is EDIT. A downloaded file has to be self-describing offline —
	// a wall of `Unknown - track01.m4a` in the phone's music app is the bug this closes.
	//
	// Chrome mirrors VersionPicker EXACTLY (scrim + .menu + fly + dragClose + focusTrap + the
	// overlays open/dismiss $effect with untrack), so the OS/browser Back gesture closes this sheet
	// through the SINGLE dismiss path — the host $effect cleanup is the only overlays.dismiss caller.
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { names } from '$lib/stores/names.svelte';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';
	import { retagOne } from '$lib/services/retag';
	import type { Track } from '$lib/sources/types';

	let {
		track,
		open,
		cover,
		lyrics,
		onclose,
		onsaved,
		overlayId = 'metadata-editor'
	}: {
		track: Track | null;
		open: boolean;
		// The cover the user is LOOKING at — TrackMenu's activeCover ladder (pin → the hero's cover
		// when this is the playing song → the shared reactive cache → the stub's art). Handed to the
		// SAME resolveArtworkDataUrl the download path uses, with its existing 6 s / 1 MB / https-only
		// bounds; this component never opens a fetch path of its own.
		cover: string | null;
		// Whatever lyrics the app ALREADY has for this song, or null. The editor never fires a network
		// resolve to go hunting for them — it is a metadata editor that has to work offline. With none,
		// none are written and the file's existing lyrics are preserved by omission.
		lyrics: string | null;
		onclose: () => void;
		onsaved: (patch: { title: string; artist: string; album: string }) => void;
		// WR-02: a DISTINCT overlay key. TrackMenu already co-mounts VersionPicker, and a shared id
		// orphans a pushed history state → desyncs "history depth == overlay depth" → over-pops Back.
		overlayId?: string;
	} = $props();

	let title = $state('');
	let artist = $state('');
	let album = $state('');
	let saving = $state(false);

	// Seed on OPEN only, with the track read untracked: a re-render that swaps the track object (the
	// host resolves a stub behind the sheet) must not wipe what the user has typed. Seeded from the
	// DISPLAY strings so the fields show exactly what is on screen — whatever the user then leaves in
	// the box is written VERBATIM, never re-run through the display-name translation on its way to
	// disk (an explicit edit is the user's exact intent).
	$effect(() => {
		if (!open) return;
		const tr = untrack(() => track);
		title = tr ? names.dnTitle(tr.title) : '';
		artist = tr ? names.dnArtist(tr.artist) : '';
		album = tr?.album ?? '';
		saving = false;
	});

	async function save() {
		if (!track?.uid || saving) return;
		saving = true;
		const patch = { title: title.trim(), artist: artist.trim(), album: album.trim() };
		// NO try/catch, and that is not an omission: retagOne NEVER rejects — every failure mode is a
		// discriminant, and every discriminant other than 'tagged' means the file on disk was not
		// touched at all. The never-throw contract IS the error handling here.
		//
		// It also owns the verify-before-write step (the tagged bytes are parsed back and must return
		// the written title before anything reaches the disk), which is exactly why this sheet calls
		// it instead of reaching for tagAudioBlob itself. A retag OVERWRITES a file that works.
		const result = await retagOne({ uid: track.uid, ...patch, cover, lyrics: lyrics || undefined });
		saving = false;
		if (result === 'tagged') {
			onsaved(patch);
			toast.show(t('toast.tagsSaved'));
			onclose();
		} else {
			toast.show(t('toast.tagsFailed'));
		}
	}

	// ---- back-gesture wiring (SINGLE dismiss path) — copied from VersionPicker verbatim. ----
	$effect(() => {
		if (open) {
			const id = untrack(() => overlayId);
			untrack(() => overlays.open(id, () => onclose()));
			return () => untrack(() => overlays.dismiss(id));
		}
	});
</script>

{#if open}
	<button class="scrim" aria-label={t('menu.close')} onclick={onclose}></button>
	<!-- use:dragClose lives on the sheet ROOT only, never on the inputs — a drag inside a text field
	     is text selection, not a dismiss gesture. -->
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose }} use:focusTrap>
		<div class="menu-head">{t('tags.title')}</div>
		<!-- Real <label for>, not placeholders: a placeholder disappears the moment the field has
		     content, which is exactly the state this sheet opens in (every field is prefilled). -->
		<label class="fld" for="mde-title">{t('tags.fieldTitle')}</label>
		<input
			id="mde-title"
			type="text"
			bind:value={title}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			disabled={saving}
		/>
		<label class="fld" for="mde-artist">{t('tags.fieldArtist')}</label>
		<input
			id="mde-artist"
			type="text"
			bind:value={artist}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			disabled={saving}
		/>
		<label class="fld" for="mde-album">{t('tags.fieldAlbum')}</label>
		<input
			id="mde-album"
			type="text"
			bind:value={album}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			disabled={saving}
		/>
		<p class="hint">{t('tags.hint')}</p>
		<div class="actions">
			<button class="mi" onclick={onclose} use:tapBounce>{t('tags.cancel')}</button>
			<button class="mi primary" disabled={saving} aria-busy={saving} onclick={save} use:tapBounce>
				{saving ? t('tags.saving') : t('tags.save')}
			</button>
		</div>
	</div>
{/if}

<style>
	/* Sheet chrome mirrors TrackMenu / VersionPicker — same tokens, same fly, same mobile sizing. */
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, 0.45); border: none; }
	.menu {
		position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81;
		background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px;
		padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
		max-height: 90vh; overflow-y: auto;
	}
	.menu-head { font-size: calc(13px * var(--fs-title, 1)); color: var(--color-text-muted); padding: 8px 10px; }
	.fld { display: block; font-size: 12px; color: var(--color-text-muted); padding: 8px 12px 4px; }
	input {
		width: 100%; box-sizing: border-box; min-height: 44px; padding: 10px 12px;
		background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px;
		color: var(--color-text);
		/* 16px minimum: anything smaller makes iOS Safari zoom the viewport on focus. */
		font-size: 16px;
	}
	input:disabled { opacity: 0.5; }
	.hint { color: var(--color-text-muted); font-size: 12px; line-height: 1.4; padding: 10px 12px 4px; margin: 0; }
	.actions { display: flex; gap: 8px; padding: 4px; }
	.mi {
		flex: 1; display: flex; align-items: center; justify-content: center; min-height: 44px;
		background: none; border: none; color: var(--color-text); font-size: 15px; padding: 12px;
		border-radius: 10px; cursor: pointer;
	}
	.mi:hover { background: var(--color-surface); }
	.mi:disabled { opacity: 0.4; cursor: default; }
	.mi.primary { color: var(--color-primary); font-weight: 600; }
</style>
