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
	import { Capacitor } from '@capacitor/core';
	// quick-260919-3j1: the save goes through the app-wide SERIALIZER, not straight to retagOne. The
	// `saving` guard below already stops this sheet racing ITSELF; what it cannot see is the player's
	// automatic lyric embed or a cover/lyric pin firing from the track menu at the same moment. Two
	// concurrent wasm tag passes over a large file on a phone is an OOM, not a slowdown.
	import { syncFileTags } from '$lib/services/file-tag-sync';
	import { buildDownloadFilename } from '$lib/services/download-filename';
	// quick-260919-ejm: the sheet OPENS for an imported song now; only the rename affordance is
	// withheld. PURE module — no store, no cycle.
	import { isDeviceUid } from '$lib/services/device-track';
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
	// quick-260919-30x: the BASE name of the file on disk, without an extension.
	let filename = $state('');
	let saving = $state(false);

	// quick-260919-30x / D-8 — a plain const, not `$derived`: the platform cannot change at runtime.
	// The field is NATIVE-ONLY because the web branch of `blobStore.put` ignores `filename` entirely
	// (the IndexedDB record is uid-keyed) and the copy sitting in the browser's Downloads folder is
	// unreachable by any browser API — 1eh's documented platform ceiling. A visible field that
	// silently does nothing is worse than no field.
	//
	// quick-260919-ejm — THIS SHEET NOW OPENS FOR AN IMPORTED SONG. The comment that stood here said
	// it could not, and that is no longer true: TrackMenu's Edit-metadata row is gated on
	// `blobPresent` alone, and `retagOne` routes a device uid to the authorised IN-PLACE rewrite.
	// Everything in this sheet works for one — title, artist and album are written into the user's
	// own file, at its own path.
	//
	// THE ONE THING WITHHELD IS THE RENAME (D-7). `overwriteDeviceFile` cannot rename: the Kotlin
	// side never writes DISPLAY_NAME / RELATIVE_PATH / DATA, because moving or renaming a file the
	// user filed themselves is a separate capability that was not authorised. `retagOne` therefore
	// IGNORES `filename` on the device fork — so a File name field here would be a box that silently
	// does nothing, which is the same "worse than no field" argument the web build already lost.
	// This is the last guard standing, so it is the real one, not belt-and-braces.
	const native = Capacitor.isNativePlatform();
	const isDevice = $derived(!!track && isDeviceUid(track.uid));

	// Seed on OPEN only. The effect's ONLY dependency is `open` — the ENTIRE body is untracked, not
	// just the `track` read, and that is load-bearing twice over:
	//   1. `names.dnTitle/dnArtist` READ the reactive name map and settings, AND schedule a
	//      translation batch as a side effect. Tracked, a late translation landing would re-run this
	//      effect and wipe whatever the user had typed mid-edit — and the write-inside-an-effect is
	//      the self-invalidation loop shape this codebase has been bitten by before.
	//   2. A re-render that swaps the track object (the host resolving a stub behind the sheet) must
	//      not re-seed either.
	// Seeded from the DISPLAY strings so the fields show exactly what is on screen — whatever the
	// user then leaves in the box is written VERBATIM, never re-run through the display-name
	// translation on its way to disk (an explicit edit is the user's exact intent, not a string the
	// app derived).
	$effect(() => {
		if (!open) return;
		untrack(() => {
			const tr = track;
			title = tr ? names.dnTitle(tr.title) : '';
			artist = tr ? names.dnArtist(tr.artist) : '';
			album = tr?.album ?? '';
			// Seeded BLANK on purpose (D-7): blank means "derive the name from the title and artist",
			// which is exactly what this sheet writes today — so an untouched sheet produces a
			// byte-identical filename and the field has no regression surface. The derived name is
			// shown as the input's placeholder, which is what a placeholder is for: a default, not a
			// current value.
			filename = '';
			saving = false;
		});
	});

	async function save() {
		if (!track?.uid || saving) return;
		saving = true;
		const patch = { title: title.trim(), artist: artist.trim(), album: album.trim() };
		// NO try/catch, and that is not an omission: retagOne NEVER rejects — every failure mode is a
		// discriminant, and every discriminant other than 'tagged' means the file on disk was not
		// touched at all. The never-throw contract IS the error handling here.
		//
		// (`syncFileTags` preserves that contract: a rejection that somehow escaped maps to 'error'.)
		// It also owns the verify-before-write step (the tagged bytes are parsed back and must return
		// the written title before anything reaches the disk), which is exactly why this sheet calls
		// it instead of reaching for tagAudioBlob itself. A retag OVERWRITES a file that works.
		// quick-260919-30x: `filename` is deliberately NOT part of `patch`. `patch` feeds
		// `library.applyMetadata` / `player.adoptMetadata`, which are about the DISPLAY model; the
		// filename is a disk artifact and has no place in either. `|| undefined` so a blank field is
		// omission, never a blank name.
		const result = await syncFileTags({
			uid: track.uid,
			...patch,
			cover,
			lyrics: lyrics || undefined,
			filename: filename.trim() || undefined
		});
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
		{#if native && !isDevice}
			<!-- The one field with a placeholder: the derived name is the DEFAULT, not the current
			     value, so it belongs in the placeholder rather than in the box. The 'mp3' below is a
			     display-only stand-in — retagOne appends the REAL sniffed container, so the saved
			     file keeps its own type whatever this shows. -->
			<label class="fld" for="mde-filename">{t('tags.fieldFilename')}</label>
			<input
				id="mde-filename"
				type="text"
				bind:value={filename}
				placeholder={buildDownloadFilename(artist || '', title || '', 'mp3').replace(/\.mp3$/, '')}
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				disabled={saving}
			/>
			<p class="hint">{t('tags.filenameHint')}</p>
		{/if}
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
	.menu-head { font-size: calc(0.8125rem * var(--fs-title, 1)); color: var(--color-text-muted); padding: 8px 10px; }
	.fld { display: block; font-size: 0.75rem; color: var(--color-text-muted); padding: 8px 12px 4px; }
	input {
		width: 100%; box-sizing: border-box; min-height: 44px; padding: 10px 12px;
		background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px;
		color: var(--color-text);
		/* 16px minimum: anything smaller makes iOS Safari zoom the viewport on focus. */
		font-size: 1rem;
	}
	input:disabled { opacity: 0.5; }
	.hint { color: var(--color-text-muted); font-size: 0.75rem; line-height: 1.4; padding: 10px 12px 4px; margin: 0; }
	.actions { display: flex; gap: 8px; padding: 4px; }
	.mi {
		flex: 1; display: flex; align-items: center; justify-content: center; min-height: 44px;
		background: none; border: none; color: var(--color-text); font-size: 0.9375rem; padding: 12px;
		border-radius: 10px; cursor: pointer;
	}
	.mi:hover { background: var(--color-surface); }
	.mi:disabled { opacity: 0.4; cursor: default; }
	.mi.primary { color: var(--color-primary); font-weight: 600; }
</style>
