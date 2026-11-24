<script lang="ts">
	import { PenLine, Send, X } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import LoadingState from '$lib/components/LoadingState.svelte';
	import { comments } from '$lib/stores/comments.svelte';
	import { t } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { postComment, relativeTime, type CommentErr } from '$lib/services/comments';
	import {
		getCommentDraft,
		setCommentDraft,
		clearCommentDraft,
		getCommentName,
		setCommentName
	} from '$lib/services/comment-drafts';
	// quick-261122-ugcb3: the widget + native bridge live in the ONE shared TurnstileGate (the
	// community-lyrics submit mounts the same gate). See that file for the ot5 bridge rationale.
	import TurnstileGate from '$lib/components/TurnstileGate.svelte';

	// quick-260926-nsz: the Comments pane — one public thread per SONG (every source copy and both
	// Chinese scripts share it; see commentThreadKey). quick-260926-pb0: the thread is loaded by
	// NowPlaying into the `comments` store (one edge-cached GET per track, only while the Now Playing
	// pane is on screen) so the tab can show the count; this pane is a pure view of it plus the
	// composer, which sits behind a "Write a comment" button.

	const TEXT_MAX = 280;

	let composing = $state(false);
	let name = $state(getCommentName());
	let text = $state('');
	let posting = $state(false);
	let err = $state<CommentErr | null>(null);
	let armed = $state<string | null>(null); // the id whose Report button is on its confirm step
	let token = $state(''); // single-use Turnstile token; '' = none yet / spent / expired
	let gate = $state<{ reset: () => void } | null>(null);

	// A new song clears the previous thread's error line and armed Report. Reads only comments.uid
	// and writes state it never reads, so it cannot self-invalidate.
	$effect(() => {
		void comments.uid;
		err = null;
		armed = null;
	});

	// quick-261120-cdraft (Hector 2026-11-20): an unposted comment must NEVER be lost to a
	// track change. `draftKey` is the thread key the box's current text belongs to. The
	// SAVE effect persists on every change (localStorage only — it writes no $state, so it
	// cannot self-invalidate), which is what makes the draft durable at all times rather
	// than at some unload moment that may never fire. The RESTORE effect runs when the
	// thread key lands or changes: the previous song's text is already durable, so the box
	// simply takes the new song's draft. Cleared ONLY by a successful Post or an explicit
	// Cancel (see submit/close) — auto-advance, tab/pane close and reload all preserve it.
	let draftKey = $state<string | null>(null);
	$effect(() => {
		const k = comments.key;
		if (!k || k === draftKey) return;
		if (draftKey === null && text.trim()) {
			// Typed before the key resolved: that text belongs to THIS song — keep it.
			draftKey = k;
			setCommentDraft(k, text);
			return;
		}
		draftKey = k;
		text = getCommentDraft(k);
	});
	$effect(() => {
		const k = draftKey;
		const v = text;
		if (k) setCommentDraft(k, v);
	});
	// The name is global and is remembered as typed, not only after a post.
	$effect(() => {
		setCommentName(name);
	});

	// Turnstile: the shared gate lives inside the composing block, so the widget only loads once
	// the user taps "Write a comment", and Cancel / a successful post unmounts it (quick-260926-pb0).

	// quick-261120-cdraft: Cancel is one of only two deliberate endings for a draft (the
	// other is a successful Post), so it DISCARDS this song's draft — superseding the pb0
	// keep-on-Cancel behaviour. With drafts durable per song there must be a way to throw
	// one away, and this button is it. Track changes / tab or pane closes never clear.
	function close() {
		composing = false;
		err = null;
		token = '';
		if (draftKey) clearCommentDraft(draftKey);
		text = '';
	}

	async function submit() {
		const body = text.trim();
		const k = comments.key;
		const uid = comments.uid;
		if (!k || posting || !body || !token) return;
		const n = name.trim() || t('comments.defaultName');
		setCommentName(name.trim());
		posting = true;
		err = null;
		const r = await postComment(k, n, body, token);
		// Tokens are single-use: reset after EVERY attempt, success or failure.
		gate?.reset();
		// Cleared BEFORE the supersede check: a song change mid-post must not leave Post disabled.
		posting = false;
		if (comments.uid !== uid) return; // song changed mid-post: the reply belongs to another thread
		if (r.ok) {
			// The reply is the whole thread, newest first: the new comment lands on top and the
			// tab count updates on the same tick. The name stays remembered (setCommentName above).
			comments.replace(r.items);
			text = '';
			if (k) clearCommentDraft(k); // posted — the draft's one other deliberate ending
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
			<!-- quick-261120-cpost (Hector 2026-11-20): Post sits at the TOP of the composer,
			     above the name field — the on-screen keyboard covers the lower composer, and
			     the submit must stay visible and tappable while it is open. Same button,
			     same disabled logic; only its place moved. -->
			<div class="topbar">
				<button
					class="post"
					aria-label={t('comments.post')}
					title={t('comments.post')}
					disabled={!text.trim() || posting || !comments.key || !token || comments.unavailable}
					onclick={submit}
					use:tapBounce><Send size={16} /></button
				>
			</div>
			<input
				maxlength="24"
				bind:value={name}
				placeholder={t('comments.namePlaceholder')}
				aria-label={t('comments.namePlaceholder')}
				autocomplete="nickname"
				disabled={comments.unavailable}
			/>
			<div class="ta-wrap">
				<textarea
					maxlength={TEXT_MAX}
					bind:value={text}
					placeholder={t('comments.textPlaceholder')}
					aria-label={t('comments.textPlaceholder')}
					rows="3"
					disabled={comments.unavailable}
				></textarea>
				<!-- quick-261120-ccount (Hector 2026-11-20): the remaining count lives INSIDE
				     the input, bottom-right, so the limit reads as part of the box itself.
				     text.length, not code points: it counts what maxlength counts, so the
				     number reaches 0 exactly when the textarea stops accepting input. -->
				<span class="count">{t('comments.remaining', { n: TEXT_MAX - text.length })}</span>
			</div>
			<TurnstileGate bind:this={gate} bind:token onunavailable={() => (err = 'verify')} />
			<div class="bar">
				<span class="actions">
					<button class="cancel" aria-label={t('comments.cancel')} title={t('comments.cancel')} onclick={close} use:tapBounce><X size={16} /></button>
				</span>
			</div>
			{#if err}<p class="err">{t(errKey(err))}</p>{/if}
			<p class="muted note">{t('comments.publicNote')}</p>
		</div>
	{:else if !comments.unavailable}
		<div class="write-row">
			<button class="write" aria-label={t('comments.write')} title={t('comments.write')} onclick={() => (composing = true)} use:tapBounce><PenLine size={16} /></button>
		</div>
	{/if}

	{#if comments.unavailable}
		<p class="empty">{t('comments.unavailable')}</p>
	{:else if comments.loading}
		<LoadingState label={t('comments.loading')} rows={5} />
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
	.bar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
	/* quick-261120-cpost: the Post row at the composer's head, right-aligned like the bar it left. */
	.topbar { display: flex; justify-content: flex-end; }
	/* quick-261120-ccount: the counter inside the textarea's bottom-right corner. The wrap is
	   the positioned anchor; the textarea's extra bottom padding keeps text out of its corner. */
	.ta-wrap { position: relative; }
	.ta-wrap textarea { padding-bottom: 24px; display: block; }
	.count { position: absolute; right: 8px; bottom: 6px; color: var(--color-text-muted); font-size: 0.75rem; pointer-events: none; }
	.post {
		background: var(--color-primary);
		color: var(--color-on-primary); /* quick-261102-rrb */
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
		text-align: start;
		font: inherit;
		font-size: 0.875rem;
		min-height: 40px;
		cursor: text;
	}
	.muted { color: var(--color-text-muted); font-size: 0.75rem; }
	.note { margin: 0; }
	/* 65px = the flexible widget's fixed height; the interactive challenge renders inside that box. */
	.err { color: var(--color-danger-text); /* quick-261103-pga: was #f66 */ font-size: 0.8125rem; margin: 0; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
	.head { display: flex; align-items: center; gap: 8px; }
	.name { font-weight: 600; font-size: 0.875rem; color: var(--color-text); }
	.text { margin: 2px 0 0; font-size: 0.875rem; color: var(--color-text); white-space: pre-wrap; overflow-wrap: anywhere; }
	.report {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		margin-inline-start: auto;
		min-height: 32px;
		cursor: pointer;
	}
	.report.armed { color: var(--color-danger-text); }
	.empty { color: var(--color-text-muted); font-size: 0.875rem; text-align: center; padding: 24px; }
</style>
