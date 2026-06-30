<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Copy, Trash2 } from '@lucide/svelte';
	import { actionLog } from '$lib/stores/actionLog.svelte';
	import { serializeActionLog } from '$lib/diagnostics/action-log-logic';
	import { t } from '$lib/i18n';

	let msg = $state('');

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

	function clearLog() {
		actionLog.clear();
	}
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')}><ChevronLeft size={22} /></button>
	<h1>{t('settings.activityHeading')}</h1>
</header>

<div class="actions">
	<button class="item" onclick={copyLog}><Copy size={18} /> {t('settings.activityCopy')}</button>
	<button class="item danger" onclick={clearLog}><Trash2 size={18} /> {t('settings.activityClear')}</button>
</div>

{#if rows.length === 0}
	<p class="empty">{t('settings.activityEmpty')}</p>
{:else}
	<ul class="log">
		{#each rows as e (e.t + '-' + e.ev)}
			<li class="row">
				<span class="ts">{fmtTime(e.t)}</span>
				<span class="ev">{e.ev}</span>
				{#if e.d}<span class="d">{fmtPayload(e.d)}</span>{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if msg}<p class="flash">{msg}</p>{/if}

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	.actions { display: flex; gap: 8px; margin: 8px 0 12px; }
	.item { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 12px; border-radius: 12px; font-size: 14px; cursor: pointer; }
	.item:hover { background: var(--color-surface); }
	.item.danger { color: #ff7a90; }
	.empty { color: var(--color-text-muted); font-size: 13px; text-align: center; margin: 32px 0; }
	.log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; max-height: calc(100dvh - var(--tabbar-h) - 180px); overflow-y: auto; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; }
	.row { display: flex; gap: 8px; align-items: baseline; padding: 6px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.4; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
	.row:last-child { border-bottom: none; }
	.ts { color: var(--color-text-muted); flex: none; }
	.ev { color: var(--color-text); font-weight: 600; flex: none; }
	.d { color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; }
</style>
