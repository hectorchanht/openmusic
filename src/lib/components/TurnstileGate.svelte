<script lang="ts">
	// quick-261122-ugcb3 — THE Turnstile gate, lifted VERBATIM out of NpComments so the community
	// lyrics submit (LyricsEditor, UGC B3) reuses the one widget + native-bridge path instead of a
	// second copy. Mount it where a public write needs a human check; read `token` (bindable) and
	// call `reset()` after EVERY attempt (tokens are single-use).
	//
	// quick-260926-ot5: native posts through a Turnstile BRIDGE. The Capacitor WebView's origin is
	// https://localhost, which the production hostname allowlist (openmusic.lol) rejects, so the app
	// frames https://openmusic.lol/turnstile-bridge: the widget renders on the real hostname,
	// siteverify reports openmusic.lol, and the token comes back over postMessage gated on origin +
	// source. Rejected: localhost in the prod allowlist (anyone could farm tokens from a local page),
	// and a real Capacitor server.hostname (new WebView origin = every user's localStorage/IndexedDB
	// wiped).
	//
	// ONE action app-wide ('comment'): the bridge page renders exactly BRIDGE_ACTION, so every
	// server that verifies these tokens (/api/comments, /api/lyrics) expects that same action.
	// Tokens are single-use, so sharing the action tag across endpoints opens no replay.
	import { browser } from '$app/environment';
	import { Capacitor } from '@capacitor/core';
	import { loadTurnstile, TURNSTILE_SITEKEY, type TurnstileApi } from '$lib/services/turnstile-widget';
	import { apiOrigin } from '$lib/services/api-base';
	import { BRIDGE_PATH, BRIDGE_MSG, bridgeOrigin, parseBridgeMessage } from '$lib/services/turnstile-bridge';

	let {
		token = $bindable(''),
		onunavailable
	}: {
		/** single-use Turnstile token; '' = none yet / spent / expired */
		token?: string;
		/** the script is blocked or offline — say why the submit stays disabled */
		onunavailable?: () => void;
	} = $props();

	const native = browser && Capacitor.isNativePlatform();
	// Computed once, not reactive. A native build without VITE_API_BASE yields null → no iframe and
	// the submit stays disabled (a dev-only misconfiguration, never the shipped APK).
	const bridgeHost = native ? bridgeOrigin(apiOrigin()) : null;
	const bridgeSrc = bridgeHost ? bridgeHost + BRIDGE_PATH : null;

	let tsEl = $state<HTMLElement | null>(null);
	let bridgeEl = $state<HTMLIFrameElement | null>(null);
	let ts: TurnstileApi | null = null;
	let widgetId: string | null = null;

	// Turnstile widget: script lazy-loaded once per app, rendered explicitly here, removed on
	// unmount. Perf + privacy: readers who never open a composer never load challenges.cloudflare.com.
	$effect(() => {
		const el = tsEl;
		if (!el || native) return;
		let gone = false;
		void loadTurnstile().then((api) => {
			if (gone) return;
			if (!api) {
				onunavailable?.();
				return;
			}
			ts = api;
			widgetId =
				api.render(el, {
					sitekey: TURNSTILE_SITEKEY,
					action: 'comment', // must equal TURNSTILE_ACTION in /api/comments and /api/lyrics
					theme: 'auto',
					size: 'flexible',
					callback: (tok: string) => (token = tok),
					'expired-callback': () => (token = ''),
					'error-callback': () => (token = '')
				}) ?? null;
		});
		return () => {
			gone = true;
			if (ts && widgetId) ts.remove(widgetId);
			widgetId = null;
			token = '';
		};
	});

	// Native bridge: take token/clear only from OUR iframe at the API origin. Reads no $state
	// synchronously (bridgeEl is read inside the handler only), so it runs once on mount and cannot
	// self-invalidate (cf. restore-effect-self-invalidation-loop).
	$effect(() => {
		const host = bridgeHost;
		if (!bridgeSrc || !host) return;
		const onMsg = (e: MessageEvent) => {
			if (e.origin !== host || !bridgeEl || e.source !== bridgeEl.contentWindow) return;
			const m = parseBridgeMessage(e.data);
			if (!m) return;
			token = m.type === BRIDGE_MSG.token ? m.token : '';
		};
		window.addEventListener('message', onMsg);
		return () => {
			window.removeEventListener('message', onMsg);
			token = '';
		};
	});

	// The bridge learns (and remembers) our origin from this hello; it never posts before it.
	function hello() {
		const host = bridgeHost;
		if (!host) return;
		bridgeEl?.contentWindow?.postMessage({ type: BRIDGE_MSG.hello }, host);
	}

	/** Spend the token: clear it and ask the widget (or the bridge) for a fresh one. */
	export function reset() {
		token = '';
		if (ts && widgetId) ts.reset(widgetId);
		else if (bridgeHost) bridgeEl?.contentWindow?.postMessage({ type: BRIDGE_MSG.reset }, bridgeHost);
	}
</script>

{#if bridgeSrc}
	<iframe class="ts-bridge" bind:this={bridgeEl} src={bridgeSrc} title="Cloudflare Turnstile" onload={hello}></iframe>
{:else if !native}
	<div class="ts" bind:this={tsEl}></div>
{/if}

<style>
	.ts-bridge { display: block; width: 100%; height: 65px; border: 0; }
</style>
