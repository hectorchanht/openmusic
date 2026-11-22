<script lang="ts">
	// /analytics — the OpenMusic data dashboard for the pseudonymous store
	// (quick-261122-pseudo, step 3 of Hector's 2026-11-20 ruling). MAINTAINER-ONLY:
	// not linked from any nav; reads GET /api/analytics/report with the
	// ANALYTICS_READ_TOKEN bearer, which is typed in here and kept ONLY in this
	// browser's localStorage. Shows aggregates only — distinct users (day / week /
	// total), D1/D7 retention, top songs, the search-miss list, play failures by
	// source, lyrics-missing demand. No pseudo_id is ever returned by the API.
	// English literals by design (internal tool, like the About credits).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { apiUrl } from '$lib/services/api-base';
	import type { PseudoReport } from '$lib/services/pseudo-report';

	const TOKEN_KEY = 'openmusic:analytics-read-token:v1';
	let token = $state('');
	let report = $state<PseudoReport | null>(null);
	let error = $state('');
	let loading = $state(false);

	function readToken(): string {
		try {
			return localStorage.getItem(TOKEN_KEY) ?? '';
		} catch {
			return '';
		}
	}
	function saveToken(v: string) {
		try {
			if (v) localStorage.setItem(TOKEN_KEY, v);
			else localStorage.removeItem(TOKEN_KEY);
		} catch {
			/* private mode — keep it in memory only */
		}
	}

	async function load() {
		if (!token) return;
		loading = true;
		error = '';
		try {
			const res = await fetch(apiUrl('/api/analytics/report'), {
				headers: { authorization: `Bearer ${token}` }
			});
			const body = (await res.json()) as { ok: boolean; report?: PseudoReport; err?: string };
			if (!body.ok || !body.report) {
				error = body.err ?? `HTTP ${res.status}`;
				report = null;
			} else {
				report = body.report;
				saveToken(token);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'network error';
		} finally {
			loading = false;
		}
	}

	function pct(n: number, d: number): string {
		return d > 0 ? `${Math.round((n / d) * 100)}%` : '—';
	}

	const maxDaily = $derived(Math.max(1, ...(report?.dailyUsers.map((d) => d.users) ?? [1])));

	onMount(() => {
		token = readToken();
		if (token) void load();
	});
</script>

<svelte:head><title>Analytics · OpenMusic</title><meta name="robots" content="noindex" /></svelte:head>

<PageHeader title="Analytics" backLabel="Settings" onback={() => goto('/settings')} />

<form
	class="auth"
	onsubmit={(e) => {
		e.preventDefault();
		void load();
	}}
>
	<input type="password" placeholder="Read token" bind:value={token} autocomplete="off" />
	<button type="submit" disabled={loading || !token}>{loading ? 'Loading…' : 'Load'}</button>
	{#if token}<button type="button" onclick={() => { token = ''; saveToken(''); report = null; }}>Forget</button>{/if}
</form>
{#if error}<p class="err">Error: {error}</p>{/if}

{#if report}
	<p class="muted">Pseudonymous store · UTC day {report.today}</p>
	<section class="tiles">
		<div class="tile"><b>{report.users.today}</b><span>users today</span></div>
		<div class="tile"><b>{report.users.week}</b><span>users · 7 days</span></div>
		<div class="tile"><b>{report.users.total}</b><span>users · all time</span></div>
		<div class="tile"><b>{pct(report.retention.d1.returned, report.retention.d1.cohort)}</b><span>D1 return ({report.retention.d1.returned}/{report.retention.d1.cohort})</span></div>
		<div class="tile"><b>{pct(report.retention.d7.returned, report.retention.d7.cohort)}</b><span>D7 return ({report.retention.d7.returned}/{report.retention.d7.cohort})</span></div>
	</section>

	<section>
		<h2>Distinct users per day (14 days)</h2>
		<div class="bars">
			{#each report.dailyUsers as d (d.day)}
				<div class="bar" title="{d.day}: {d.users}"><i style="height:{(d.users / maxDaily) * 100}%"></i><small>{d.day.slice(5)}</small></div>
			{:else}<p class="muted">No events yet.</p>{/each}
		</div>
	</section>

	<section>
		<h2>Top songs (30 days)</h2>
		<table>
			<thead><tr><th>Song</th><th>Listeners</th><th>Plays</th></tr></thead>
			<tbody>
				{#each report.topSongs as s (s.song_id)}
					<tr><td>{s.title || s.song_id}<small>{s.artist}</small></td><td>{s.listeners}</td><td>{s.plays}</td></tr>
				{:else}<tr><td colspan="3" class="muted">None yet.</td></tr>{/each}
			</tbody>
		</table>
	</section>

	<section>
		<h2>Search misses (30 days)</h2>
		<table>
			<thead><tr><th>Query</th><th>Users</th><th>Misses</th><th>Last</th></tr></thead>
			<tbody>
				{#each report.searchMisses as m (m.query)}
					<tr><td>{m.query}</td><td>{m.users}</td><td>{m.misses}</td><td>{m.last_day}</td></tr>
				{:else}<tr><td colspan="4" class="muted">None yet.</td></tr>{/each}
			</tbody>
		</table>
	</section>

	<section>
		<h2>Play failures by source (30 days)</h2>
		<table>
			<thead><tr><th>Source</th><th>Stage</th><th>Failures</th></tr></thead>
			<tbody>
				{#each report.playFailures as f (f.source + '|' + f.stage)}
					<tr><td>{f.source || '—'}</td><td>{f.stage || '—'}</td><td>{f.failures}</td></tr>
				{:else}<tr><td colspan="3" class="muted">None yet.</td></tr>{/each}
			</tbody>
		</table>
	</section>

	<section>
		<h2>Lyrics missing (30 days)</h2>
		<table>
			<thead><tr><th>Song</th><th>Plays</th></tr></thead>
			<tbody>
				{#each report.lyricsMissing as l (l.song_id)}
					<tr><td>{l.title || l.song_id}<small>{l.artist}</small></td><td>{l.plays}</td></tr>
				{:else}<tr><td colspan="2" class="muted">None yet.</td></tr>{/each}
			</tbody>
		</table>
	</section>
{/if}

<style>
	.auth { display: flex; gap: 8px; margin: 12px 0; flex-wrap: wrap; }
	.auth input { flex: 1 1 180px; min-width: 0; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--color-border); background: var(--color-surface-2); color: var(--color-text); }
	.auth button { padding: 10px 14px; border-radius: 10px; border: 1px solid var(--color-border); background: var(--color-surface-2); color: var(--color-text); cursor: pointer; }
	.err { color: var(--color-danger, #e5484d); font-size: 0.85rem; }
	.muted { color: var(--color-text-muted); font-size: 0.8rem; }
	section { margin: 18px 0; }
	h2 { font-size: 0.95rem; margin: 0 0 8px; color: var(--color-text); }
	.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
	.tile { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 4px; }
	.tile b { font-size: 1.5rem; font-variant-numeric: tabular-nums; color: var(--color-text); }
	.tile span { font-size: 0.75rem; color: var(--color-text-muted); }
	.bars { display: flex; align-items: flex-end; gap: 4px; height: 120px; }
	.bar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; }
	.bar i { display: block; width: 100%; min-height: 2px; background: var(--color-primary); border-radius: 4px 4px 0 0; }
	.bar small { font-size: 0.6rem; color: var(--color-text-muted); }
	table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
	th, td { text-align: start; padding: 6px 4px; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: top; }
	th { color: var(--color-text-muted); font-weight: 500; }
	td small { display: block; color: var(--color-text-muted); }
	td:not(:first-child), th:not(:first-child) { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
