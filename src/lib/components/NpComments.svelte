<script lang="ts">
	import { browser } from '$app/environment';
	import { Capacitor } from '@capacitor/core';
	import { player } from '$lib/stores/player.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import {
		commentThreadKey,
		fetchComments,
		postComment,
		reportComment,
		relativeTime,
		type CommentItem,
		type CommentErr
	} from '$lib/services/comments';
	import { loadTurnstile, TURNSTILE_SITEKEY, type TurnstileApi } from '$lib/services/turnstile-widget';

	// quick-260926-nsz: the Comments pane — one public thread per SONG (every source copy and both
	// Chinese scripts share it; see commentThreadKey). No props: it reads player.current like the
	// other Now Playing panes. No IntersectionObserver (unlike NpRelated): this pane is mounted only
	// while its tab / wide column is selected, and the cost is ONE edge-cached GET per track change
	// through the apiFetch governor.

	const NAME_KEY = 'openmusic:comment-name:v1';
	const TEXT_MAX = 280;

	// ponytail: posting is web-only. The Capacitor WebView's origin is https://localhost and the
	// production Turnstile hostname allowlist is openmusic.lol only, so a native post could never
	// verify. Native reads and reports; the composer is replaced by a note. Upgrade path: add
	// localhost to the widget's domains AND to TURNSTILE_HOSTNAMES (weaker — any local page could
	// then mint tokens that pass the hostname check).
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

	let items = $state<CommentItem[]>([]);
	let loading = $state(false);
	let unavailable = $state(false);
	let threadKey = $state<string | null>(null);
	let name = $state(readName());
	let text = $state('');
	let posting = $state(false);
	let err = $state<CommentErr | null>(null);
	let armed = $state<string | null>(null); // the id whose Report button is on its confirm step
	let reported = $state<string[]>([]);
	let token = $state(''); // single-use Turnstile token; '' = none yet / spent / expired
	let tsEl = $state<HTMLElement | null>(null);

	// Supersede guard — a PLAIN field, deliberately not $state (the player.svelte.ts generation-guard
	// convention): the effect below must never read state it writes.
	let commentsFor = '';
	let ts: TurnstileApi | null = null;
	let widgetId: string | null = null;

	// The reporter stops seeing a comment at once, whatever the server decides.
	const visible = $derived(items.filter((i) => !reported.includes(i.id)));

	// Reads only player.current and the plain guard; writes the pane state it never reads, so it
	// cannot self-invalidate (cf. restore-effect-self-invalidation-loop).
	$effect(() => {
		const cur = player.current;
		if (!cur || commentsFor === cur.uid) return;
		commentsFor = cur.uid;
		items = [];
		err = null;
		armed = null;
		threadKey = null;
		unavailable = false;
		loading = true;
		void (async () => {
			const k = await commentThreadKey(cur.artist, cur.title);
			if (commentsFor !== cur.uid) return; // a newer song owns the pane — drop this reply
			if (!k) {
				unavailable = true;
				loading = false;
				return;
			}
			threadKey = k;
			const got = await fetchComments(k);
			if (commentsFor !== cur.uid) return;
			if (got === null) unavailable = true;
			else items = got;
			loading = false;
		})();
	});

	// Turnstile widget: script lazy-loaded once per app, rendered explicitly into the composer,
	// removed on unmount. Post stays disabled until the widget hands us a token.
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

	async function submit() {
		const body = text.trim();
		if (!threadKey || posting || !body || !token) return;
		const n = name.trim() || t('comments.defaultName');
		writeName(name.trim());
		posting = true;
		err = null;
		const uid = commentsFor;
		const r = await postComment(threadKey, n, body, token);
		// Tokens are single-use: reset after EVERY attempt, success or failure.
		token = '';
		if (ts && widgetId) ts.reset(widgetId);
		// Cleared BEFORE the supersede check: a song change mid-post must not leave Post disabled.
		posting = false;
		if (commentsFor !== uid) return; // song changed mid-post: the reply belongs to another thread
		if (r.ok) {
			items = r.items;
			text = '';
		} else err = r.err;
	}

	function report(id: string) {
		if (armed !== id) {
			armed = id; // first tap arms; the label flips to the confirm step
			return;
		}
		armed = null;
		reported = [...reported, id];
		if (threadKey) void reportComment(threadKey, id); // fire-and-forget
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
	{#if native}
		<p class="muted note">{t('comments.postOnWeb')}</p>
	{:else}
		<div class="composer">
			<input
				maxlength="24"
				bind:value={name}
				placeholder={t('comments.namePlaceholder')}
				aria-label={t('comments.namePlaceholder')}
				autocomplete="nickname"
				disabled={unavailable}
			/>
			<textarea
				maxlength={TEXT_MAX}
				bind:value={text}
				placeholder={t('comments.textPlaceholder')}
				aria-label={t('comments.textPlaceholder')}
				rows="3"
				disabled={unavailable}
			></textarea>
			<div class="ts" bind:this={tsEl}></div>
			<div class="bar">
				<!-- text.length, not code points: it counts what maxlength counts, so the number
				     reaches 0 exactly when the textarea stops accepting input. -->
				<span class="muted">{t('comments.remaining', { n: TEXT_MAX - text.length })}</span>
				<button
					class="post"
					disabled={!text.trim() || posting || !threadKey || !token || unavailable}
					onclick={submit}
					use:tapBounce>{t('comments.post')}</button
				>
			</div>
			{#if err}<p class="err">{t(errKey(err))}</p>{/if}
			<p class="muted note">{t('comments.publicNote')}</p>
		</div>
	{/if}

	{#if unavailable}
		<p class="empty">{t('comments.unavailable')}</p>
	{:else if loading}
		<p class="empty">{t('comments.loading')}</p>
	{:else if !visible.length}
		<p class="empty">{t('comments.empty')}</p>
	{:else}
		<ul class="list">
			{#each visible as c (c.id)}
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
	.muted { color: var(--color-text-muted); font-size: 0.75rem; }
	.note { margin: 0; }
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
