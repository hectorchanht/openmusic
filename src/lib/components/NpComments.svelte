<script lang="ts">
	import { browser } from '$app/environment';
	import { Capacitor } from '@capacitor/core';
	import { settings } from '$lib/stores/settings.svelte';
	import { comments } from '$lib/stores/comments.svelte';
	import { t } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { postComment, relativeTime, type CommentErr } from '$lib/services/comments';
	import { loadTurnstile, TURNSTILE_SITEKEY, type TurnstileApi } from '$lib/services/turnstile-widget';
	import { apiOrigin } from '$lib/services/api-base';
	import { BRIDGE_PATH, BRIDGE_MSG, bridgeOrigin, parseBridgeMessage } from '$lib/services/turnstile-bridge';

	// quick-260926-nsz: the Comments pane — one public thread per SONG (every source copy and both
	// Chinese scripts share it; see commentThreadKey). quick-260926-pb0: the thread is loaded by
	// NowPlaying into the `comments` store (one edge-cached GET per track, only while the Now Playing
	// pane is on screen) so the tab can show the count; this pane is a pure view of it plus the
	// composer, which sits behind a "Write a comment" button.

	const NAME_KEY = 'openmusic:comment-name:v1';
	const TEXT_MAX = 280;

	// quick-260926-ot5: native posts through a Turnstile BRIDGE. The Capacitor WebView's origin is
	// https://localhost, which the production hostname allowlist (openmusic.lol) rejects, so the app
	// frames https://openmusic.lol/turnstile-bridge: the widget renders on the real hostname,
	// siteverify reports openmusic.lol, and the token comes back over postMessage gated on origin +
	// source. Rejected: localhost in the prod allowlist (anyone could farm tokens from a local page),
	// and a real Capacitor server.hostname (new WebView origin = every user's localStorage/IndexedDB
	// wiped).
	const native = browser && Capacitor.isNativePlatform();

	function readName(): string {
		if (!browser) return '';
		try {
			return localStorage.getItem(NAME_KEY) ?? '';
		} catch {
			return ''; // private mode / storage disabled
		}
	}
	function writeName(n: string) {
		if (!browser) return;
		try {
			if (n) localStorage.setItem(NAME_KEY, n);
			else localStorage.removeItem(NAME_KEY);
		} catch {
			/* private mode — the name just is not remembered */
		}
	}

	let composing = $state(false);
	let name = $state(readName());
	let text = $state('');
	let posting = $state(false);
	let err = $state<CommentErr | null>(null);
	let armed = $state<string | null>(null); // the id whose Report button is on its confirm step
	let token = $state(''); // single-use Turnstile token; '' = none yet / spent / expired
	let tsEl = $state<HTMLElement | null>(null);
	let bridgeEl = $state<HTMLIFrameElement | null>(null);
	// Computed once, not reactive. A native build without VITE_API_BASE yields null → no iframe and
	// Post stays disabled (a dev-only misconfiguration, never the shipped APK).
	const bridgeHost = native ? bridgeOrigin(apiOrigin()) : null;
	const bridgeSrc = bridgeHost ? bridgeHost + BRIDGE_PATH : null;

	let ts: TurnstileApi | null = null;
	let widgetId: string | null = null;

	// A new song clears the previous thread's error line and armed Report. Reads only comments.uid
	// and writes state it never reads, so it cannot self-invalidate.
	$effect(() => {
		void comments.uid;
		err = null;
		armed = null;
	});

	// Turnstile widget: script lazy-loaded once per app, rendered explicitly into the composer,
	// removed on unmount. Post stays disabled until the widget hands us a token.
	// quick-260926-pb0: the `.ts` div (and the native bridge iframe) live inside the composing block,
	// so this effect only runs once the user taps "Write a comment", and its cleanup removes the
	// widget when Cancel / a successful post unmounts the div. Perf + privacy: readers never load
	// challenges.cloudflare.com.
	$effect(() => {
		const el = tsEl;
		if (!el || native) return;
		let gone = false;
		void loadTurnstile().then((api) => {
			if (gone) return;
			if (!api) {
				err = 'verify'; // script blocked or offline: say why Post stays disabled
				return;
			}
			ts = api;
			widgetId =
				api.render(el, {
					sitekey: TURNSTILE_SITEKEY,
					action: 'comment', // must equal TURNSTILE_ACTION in /api/comments
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
	// self-invalidate (cf. restore-effect-self-invalidation-loop). While the composer is closed
	// there is no iframe, so every message fails the source check and is ignored.
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

	// quick-260926-pb0: Cancel keeps the draft `text` — a mis-tapped Cancel must not eat a typed
	// comment; reopening shows it.
	function close() {
		composing = false;
		err = null;
		token = '';
	}

	async function submit() {
		const body = text.trim();
		const k = comments.key;
		const uid = comments.uid;
		if (!k || posting || !body || !token) return;
		const n = name.trim() || t('comments.defaultName');
		writeName(name.trim());
		posting = true;
		err = null;
		const r = await postComment(k, n, body, token);
		// Tokens are single-use: reset after EVERY attempt, success or failure.
		token = '';
		if (ts && widgetId) ts.reset(widgetId);
		else if (bridgeHost) bridgeEl?.contentWindow?.postMessage({ type: BRIDGE_MSG.reset }, bridgeHost);
		// Cleared BEFORE the supersede check: a song change mid-post must not leave Post disabled.
		posting = false;
		if (comments.uid !== uid) return; // song changed mid-post: the reply belongs to another thread
		if (r.ok) {
			// The reply is the whole thread, newest first: the new comment lands on top and the
			// tab count updates on the same tick. The name stays remembered (writeName above).
			comments.replace(r.items);
			text = '';
			composing = false;
		} else err = r.err; // composer stays open with the error line
	}

	function report(id: string) {
		if (armed !== id) {
			armed = id; // first tap arms; the label flips to the confirm step
			return;
		}
		armed = null;
		comments.report(id); // hides locally + fire-and-forget request
	}

	const errKey = (e: CommentErr) =>
		e === 'slow-down'
			? 'comments.slowDown'
			: e === 'invalid'
				? 'comments.invalid'
				: e === 'verify'
					? 'comments.errVerify'
					: 'comments.unavailable';
</script>

<div class="cm-pane">
	{#if composing}
		<div class="composer">
			<input
				maxlength="24"
				bind:value={name}
				placeholder={t('comments.namePlaceholder')}
				aria-label={t('comments.namePlaceholder')}
				autocomplete="nickname"
				disabled={comments.unavailable}
			/>
			<textarea
				maxlength={TEXT_MAX}
				bind:value={text}
				placeholder={t('comments.textPlaceholder')}
				aria-label={t('comments.textPlaceholder')}
				rows="3"
				disabled={comments.unavailable}
			></textarea>
			{#if bridgeSrc}
				<iframe class="ts-bridge" bind:this={bridgeEl} src={bridgeSrc} title="Cloudflare Turnstile" onload={hello}></iframe>
			{:else if !native}
				<div class="ts" bind:this={tsEl}></div>
			{/if}
			<div class="bar">
				<!-- text.length, not code points: it counts what maxlength counts, so the number
				     reaches 0 exactly when the textarea stops accepting input. -->
				<span class="muted">{t('comments.remaining', { n: TEXT_MAX - text.length })}</span>
				<span class="actions">
					<button class="cancel" onclick={close} use:tapBounce>{t('comments.cancel')}</button>
					<button
						class="post"
						disabled={!text.trim() || posting || !comments.key || !token || comments.unavailable}
						onclick={submit}
						use:tapBounce>{t('comments.post')}</button
					>
				</span>
			</div>
			{#if err}<p class="err">{t(errKey(err))}</p>{/if}
			<p class="muted note">{t('comments.publicNote')}</p>
		</div>
	{:else if !comments.unavailable}
		<div class="write-row">
			<button class="write" onclick={() => (composing = true)} use:tapBounce>{t('comments.write')}</button>
		</div>
	{/if}

	{#if comments.unavailable}
		<p class="empty">{t('comments.unavailable')}</p>
	{:else if comments.loading}
		<p class="empty">{t('comments.loading')}</p>
	{:else if !comments.visible.length}
		<p class="empty">{t('comments.empty')}</p>
	{:else}
		<ul class="list">
			{#each comments.visible as c (c.id)}
				<!-- Plain interpolation ONLY for name/text — never raw HTML (T-nsz-01). -->
				<li class="cm">
					<div class="head">
						<span class="name">{c.name}</span>
						<span class="muted">{relativeTime(c.t, Date.now(), settings.appLang)}</span>
						<button class="report" class:armed={armed === c.id} onclick={() => report(c.id)} use:tapBounce
							>{t(armed === c.id ? 'comments.reportConfirm' : 'comments.report')}</button
						>
					</div>
					<p class="text">{c.text}</p>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.cm-pane { min-height: 96px; padding: 0 2px; }
	.composer { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
	input,
	textarea {
		background: var(--color-surface);
		color: var(--color-text);
		border: none;
		border-radius: 8px;
		padding: 8px 10px;
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-size: 0.875rem;
	}
	textarea { resize: vertical; }
	input:disabled,
	textarea:disabled { opacity: 0.5; }
	.bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
	.post {
		background: var(--color-primary);
		color: #fff;
		border: none;
		border-radius: 999px;
		padding: 6px 14px;
		font-size: 0.8125rem;
		cursor: pointer;
	}
	.post:disabled { opacity: 0.5; cursor: default; }
	.actions { display: flex; gap: 8px; }
	.cancel {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
		min-height: 32px;
		padding: 6px 10px;
		cursor: pointer;
	}
	.write-row { margin-bottom: 14px; }
	/* Looks like an inert input: a tap opens the real composer. */
	.write {
		background: var(--color-surface);
		color: var(--color-text-muted);
		border: none;
		border-radius: 999px;
		padding: 8px 12px;
		width: 100%;
		text-align: left;
		font: inherit;
		font-size: 0.875rem;
		min-height: 40px;
		cursor: text;
	}
	.muted { color: var(--color-text-muted); font-size: 0.75rem; }
	.note { margin: 0; }
	/* 65px = the flexible widget's fixed height; the interactive challenge renders inside that box. */
	.ts-bridge { display: block; width: 100%; height: 65px; border: 0; }
	.err { color: #f66; font-size: 0.8125rem; margin: 0; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
	.head { display: flex; align-items: center; gap: 8px; }
	.name { font-weight: 600; font-size: 0.875rem; color: var(--color-text); }
	.text { margin: 2px 0 0; font-size: 0.875rem; color: var(--color-text); white-space: pre-wrap; overflow-wrap: anywhere; }
	.report {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		margin-left: auto;
		min-height: 32px;
		cursor: pointer;
	}
	.report.armed { color: #f66; }
	.empty { color: var(--color-text-muted); font-size: 0.875rem; text-align: center; padding: 24px; }
</style>
