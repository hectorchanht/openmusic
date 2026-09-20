<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Copy, Trash2, Upload } from '@lucide/svelte';
	import { actionLog } from '$lib/stores/actionLog.svelte';
	import { serializeActionLog } from '$lib/diagnostics/action-log-logic';
	import { apiFetch } from '$lib/services/api-base';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';

	/** Device-local upload token, namespaced like every other openmusic:<domain>:v<N> key. */
	const DIAG_TOKEN_KEY = 'openmusic:diag:v1';

	let msg = $state('');
	let uploading = $state(false);

	onMount(() => actionLog.load());

	function flash(m: string) {
		msg = m;
		setTimeout(() => (msg = ''), 1800);
	}

	// Newest-first for the viewer (the store keeps the buffer oldest-first for cheap append/cap).
	const rows = $derived([...actionLog.entries].reverse());

	/** HH:MM:SS.mmm in local time — the resolution needed to reason about sub-second auto-advance. */
	function fmtTime(ms: number): string {
		const d = new Date(ms);
		const p = (n: number, w = 2) => String(n).padStart(w, '0');
		return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
	}

	function fmtPayload(d?: Record<string, unknown>): string {
		if (!d) return '';
		try {
			return JSON.stringify(d);
		} catch {
			return '';
		}
	}

	async function copyLog() {
		const text = serializeActionLog(actionLog.entries);
		try {
			await navigator.clipboard.writeText(text);
			flash(t('settings.activityCopied'));
		} catch {
			/* clipboard unavailable — non-fatal */
		}
	}

	// D-04: uploading is an EXPLICIT user action ONLY. Bound to onclick and nothing else — no
	// timer, no app-start hook, no reactive trigger, no background retry. A failure flashes once
	// and STOPS. Three recorded fetch-flood freezes (api-fetch-flood-freeze) are why: uncapped
	// /api/* traffic saturates the connection pool and wedges the whole app. One tap = at most
	// one request.
	async function uploadLog() {
		if (uploading) return; // double-tap re-entrancy guard, NOT a retry
		const text = serializeActionLog(actionLog.entries);
		if (!text || text === '[]') return flash(t('settings.activityUploadEmpty'));

		// The token is typed in by the maintainer on their own device and kept there. It is the
		// WRITE-ONLY half of the two-token split (T-33-07/T-33-11) — the read token never touches a
		// device — and it is deliberately NOT a build-time env var: Vite inlines those into the
		// public client bundle (D-03, T-33-03).
		let token = '';
		try {
			token = localStorage.getItem(DIAG_TOKEN_KEY) ?? '';
		} catch {
			/* storage unavailable — prompt instead */
		}
		if (!token) {
			token = (prompt(t('settings.activityUploadPrompt')) ?? '').trim();
			if (!token) return;
			try {
				localStorage.setItem(DIAG_TOKEN_KEY, token);
			} catch {
				/* non-fatal — this upload still proceeds, the next one re-prompts */
			}
		}

		uploading = true;
		try {
			// Through apiFetch, never the raw platform call: a bodied POST skips the GET dedupe but
			// keeps the 8-way concurrency cap, the 25 s timeout and the circuit breaker.
			const res = await apiFetch('/api/diag', {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body: text
			});
			// One line of on-device audit so the viewer itself shows 401 vs 413 vs 200.
			actionLog.log('diag.upload', { status: res.status });
			if (res.status === 401) {
				// A mistyped token must not wedge the button forever — drop it so the NEXT tap
				// re-prompts. Still no automatic retry.
				try {
					localStorage.removeItem(DIAG_TOKEN_KEY);
				} catch {
					/* */
				}
			}
			flash(res.ok ? t('settings.activityUploaded') : t('settings.activityUploadFailed'));
		} catch {
			flash(t('settings.activityUploadFailed'));
		} finally {
			uploading = false;
		}
	}

	function clearLog() {
		actionLog.clear();
	}
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<PageHeader title={t('settings.activityHeading')} backLabel={t('settings.backToSettings')} onback={() => goto('/settings')} />

<div class="actions">
	<button class="item" onclick={copyLog} use:tapBounce><Copy size={18} /> {t('settings.activityCopy')}</button>
	<button class="item" onclick={uploadLog} disabled={uploading} use:tapBounce><Upload size={18} /> {t('settings.activityUpload')}</button>
	<button class="item danger" onclick={clearLog} use:tapBounce><Trash2 size={18} /> {t('settings.activityClear')}</button>
</div>

{#if rows.length === 0}
	<p class="empty">{t('settings.activityEmpty')}</p>
{:else}
	<ul class="log">
		{#each rows as e (e.t + '-' + e.ev)}
			<li class="row">
				<span class="ts">{fmtTime(e.t)}</span>
				<span class="ev">{e.ev}</span>
				{#if e.n && e.n > 1}<span class="n" title={fmtTime(e.tl ?? e.t)}>×{e.n}</span>{/if}
				{#if e.d}<span class="d">{fmtPayload(e.d)}</span>{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if msg}<p class="flash">{msg}</p>{/if}

<style>
	.actions { display: flex; gap: 8px; margin: 8px 0 12px; }
	.item { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 12px; border-radius: 12px; font-size: 0.875rem; cursor: pointer; }
	.item:hover { background: var(--color-surface); }
	.item.danger { color: #ff7a90; }
	.empty { color: var(--color-text-muted); font-size: 0.8125rem; text-align: center; margin: 32px 0; }
	.log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; max-height: calc(100dvh - var(--tabbar-h) - 180px); overflow-y: auto; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; }
	.row { display: flex; gap: 8px; align-items: baseline; padding: 6px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.6875rem; line-height: 1.4; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
	.row:last-child { border-bottom: none; }
	.ts { color: var(--color-text-muted); flex: none; }
	.ev { color: var(--color-text); font-weight: 600; flex: none; }
	.n { color: var(--color-accent, #ffb454); font-weight: 600; flex: none; }
	.d { color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; }
</style>
