<!--
	CoverArt — THE shared cover renderer (singleton; every cover surface routes through here).

	Hector 2026-11-20: covers display the Apple way — the WHOLE artwork at its natural
	aspect ratio, never centre-cropped (object-fit: cover was cutting faces off the wide
	16:9 video-source thumbnails). The fitted image (object-fit: contain) is centred over
	an ambient backdrop: the SAME artwork, cover-fitted, blurred + dimmed, filling the
	host box (the Apple Music / iOS player treatment). Square art (most album covers)
	fills the box exactly, so nothing visibly changes for it.

	Contract:
	- The component fills its host: position:absolute; inset:0. The HOST owns the box
	  (size, border-radius, position:relative, overflow:hidden) — layout never shifts.
	- `fallback` is a CSS background (the per-song gradient placeholder) painted as the
	  base layer: a missing cover shows it, and a DEAD url reveals it too — an <img>
	  error drops both layers (DEAD ≠ MISSING, the quick-260920-nyq rule the CSS
	  background path used to get from its layered gradient).
	- The host `onerror` hook fires at most once per src (dead-URL marking etc.); the
	  component hides the art itself, so hosts no longer hide elements by hand.
	- Both layers load the same URL (one fetch; the second is a cache hit) and keep the
	  host's loading posture (lazy by default — CSS backgrounds were the eager path this
	  app already moved away from, psi-home-163mb-payload-lcp).
-->
<script lang="ts">
	import type { HTMLImgAttributes } from 'svelte/elements';

	interface Props {
		src?: string | null;
		/** CSS background for the base layer (gradient placeholder). */
		fallback?: string;
		alt?: string;
		loading?: HTMLImgAttributes['loading'];
		referrerpolicy?: HTMLImgAttributes['referrerpolicy'];
		onerror?: (e: Event) => void;
	}

	let {
		src = null,
		fallback = undefined,
		alt = '',
		loading = 'lazy',
		referrerpolicy = undefined,
		onerror = undefined
	}: Props = $props();

	// The src whose load failed; both layers unrender so the fallback shows. Keyed by
	// src value, so a NEW src on the same instance starts un-failed (row reuse).
	let failedFor = $state<string | null>(null);

	function fail(e: Event) {
		if (!src || failedFor === src) return;
		failedFor = src;
		onerror?.(e);
	}
</script>

<span class="coverart" style:background={fallback}>
	{#if src && failedFor !== src}
		<img
			class="ca-ambient"
			src={src}
			alt=""
			aria-hidden="true"
			{loading}
			decoding="async"
			{referrerpolicy}
			onerror={fail}
		/>
		<img class="ca-fit" src={src} {alt} {loading} decoding="async" {referrerpolicy} onerror={fail} />
	{/if}
</span>

<style>
	.coverart {
		position: absolute;
		inset: 0;
		display: block;
		overflow: hidden;
		border-radius: inherit;
		background-size: cover;
		background-position: center;
	}
	/* Ambient backdrop: the same art, enlarged past the box edges so the blur never
	   bleeds transparency, dimmed so the fitted art stays the subject. */
	.ca-ambient {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transform: scale(1.35);
		filter: blur(14px) brightness(0.55) saturate(1.3);
		pointer-events: none;
	}
	/* The artwork itself: whole, at natural aspect — never cropped. */
	.ca-fit {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		pointer-events: none;
	}
</style>
