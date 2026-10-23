<script lang="ts">
	// quick-261023-syncmerge-review — the first-sign-in review modal.
	//
	// On first sign-in, when BOTH this device and the cloud hold differing data, the sync
	// engine stays parked and THIS opens instead of an auto-merge. The preview is itemized
	// per family (incoming / on-this-device / will-be-removed, "like a tombstones list"),
	// and the user picks one of three resolutions. NOT dismissible — scrim, drag and back
	// do nothing; the three buttons are the only exits (they cover every outcome).
	// Mounted ONCE in the root layout, ungated, driven one-way by auth.firstSyncPreview.
	import { fly } from 'svelte/transition';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';
	import { auth } from '$lib/stores/auth.svelte';
	import type { PreviewList, SyncPreview } from '$lib/sync/merge-logic';

	let preview = $derived(auth.firstSyncPreview);
	let open = $derived(preview !== null);

	/** Cap rows per group so a 500-song library doesn't build a 1500-row modal. */
	const ROW_CAP = 12;

	function choose(c: 'merge' | 'mine' | 'theirs'): void {
		void auth.resolveFirstSyncChoice(c);
	}

	interface Section {
		key: string;
		title: string;
		groups: { label: string; kind: 'in' | 'out' | 'del'; rows: string[] }[];
		note?: string;
	}

	function sections(p: SyncPreview): Section[] {
		const out: Section[] = [];
		const fmtTrack = (x: { title: string; artist: string }): string =>
			x.artist ? `${x.title} — ${x.artist}` : x.title;
		const tracks = p.library.tracks;
		if (tracks.incoming.length + tracks.outgoing.length + tracks.willDelete.length > 0) {
			out.push({
				key: 'tracks',
				title: t('sync.review.library'),
				groups: [
					{ label: t('sync.review.fromCloud'), kind: 'in', rows: tracks.incoming.map(fmtTrack) },
					{ label: t('sync.review.fromDevice'), kind: 'out', rows: tracks.outgoing.map(fmtTrack) },
					{ label: t('sync.review.willRemove'), kind: 'del', rows: tracks.willDelete.map(fmtTrack) }
				]
			});
		}
		const pls = p.library.playlists;
		if (pls.incoming.length + pls.outgoing.length + pls.willDelete.length > 0) {
			const fmt = (x: { name: string; trackCount: number }): string => `${x.name} (${x.trackCount})`;
			out.push({
				key: 'playlists',
				title: t('sync.review.playlists'),
				groups: [
					{ label: t('sync.review.fromCloud'), kind: 'in', rows: pls.incoming.map(fmt) },
					{ label: t('sync.review.fromDevice'), kind: 'out', rows: pls.outgoing.map(fmt) },
					{ label: t('sync.review.willRemove'), kind: 'del', rows: pls.willDelete.map(fmt) }
				]
			});
		}
		const arts = p.library.artists;
		if (arts.incoming.length + arts.outgoing.length + arts.willDelete.length > 0) {
			out.push({
				key: 'artists',
				title: t('sync.review.artists'),
				groups: [
					{ label: t('sync.review.fromCloud'), kind: 'in', rows: arts.incoming },
					{ label: t('sync.review.fromDevice'), kind: 'out', rows: arts.outgoing },
					{ label: t('sync.review.willRemove'), kind: 'del', rows: arts.willDelete }
				]
			});
		}
		const h = p.history;
		if (h.incoming + h.outgoing + h.willDelete > 0) {
			out.push({
				key: 'history',
				title: t('sync.review.history'),
				groups: [
					{ label: t('sync.review.fromCloud'), kind: 'in', rows: h.incoming > 0 ? [`${h.incoming}`] : [] },
					{ label: t('sync.review.fromDevice'), kind: 'out', rows: h.outgoing > 0 ? [`${h.outgoing}`] : [] },
					{ label: t('sync.review.willRemove'), kind: 'del', rows: h.willDelete > 0 ? [`${h.willDelete}`] : [] }
				]
			});
		}
		const s = p.searches;
		if (s.incoming.length + s.outgoing.length + s.willDelete.length > 0) {
			const fmt = (x: { query: string }): string => x.query;
			out.push({
				key: 'searches',
				title: t('sync.review.searches'),
				groups: [
					{ label: t('sync.review.fromCloud'), kind: 'in', rows: s.incoming.map(fmt) },
					{ label: t('sync.review.fromDevice'), kind: 'out', rows: s.outgoing.map(fmt) },
					{ label: t('sync.review.willRemove'), kind: 'del', rows: s.willDelete.map(fmt) }
				]
			});
		}
		if (p.nameTr.length > 0) {
			out.push({
				key: 'names',
				title: t('sync.review.names'),
				groups: [
					{
						label: t('sync.review.fromCloud'),
						kind: 'in',
						rows: p.nameTr.filter((n) => n.incoming > 0).map((n) => `${n.incoming}`)
					},
					{
						label: t('sync.review.fromDevice'),
						kind: 'out',
						rows: p.nameTr.filter((n) => n.outgoing > 0).map((n) => `${n.outgoing}`)
					},
					{ label: t('sync.review.willRemove'), kind: 'del', rows: [] }
				]
			});
		}
		if (p.settings.differs) {
			out.push({
				key: 'settings',
				title: t('sync.review.settings'),
				groups: [],
				note: t('sync.review.settingsDiffers')
			});
		}
		return out;
	}

	let secs = $derived(preview ? sections(preview) : []);
</script>

{#if open && preview}
	<div class="scrim" aria-hidden="true"></div>
	<div
		class="review-modal"
		role="alertdialog"
		aria-modal="true"
		aria-label={t('sync.review.title')}
		transition:fly={{ y: 240, duration: 200 }}
		use:focusTrap
	>
		<div class="rm-title">{t('sync.review.title')}</div>
		<p class="rm-desc">{t('sync.review.desc')}</p>
		<div class="rm-body">
			{#each secs as sec (sec.key)}
				<div class="rm-section">
					<div class="rm-sec-title">{sec.title}</div>
					{#if sec.note}
						<div class="rm-note">{sec.note}</div>
					{/if}
					{#each sec.groups as g (g.label + g.kind)}
						{#if g.rows.length > 0}
							<div class="rm-group">
								<div class="rm-group-label {g.kind}">{g.label} · {g.rows.length}</div>
								<ul class="rm-rows">
									{#each g.rows.slice(0, ROW_CAP) as row (row)}
										<li class="rm-row {g.kind}">{row}</li>
									{/each}
								</ul>
								{#if g.rows.length > ROW_CAP}
									<div class="rm-more">+{g.rows.length - ROW_CAP}</div>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
		<div class="rm-actions">
			<button class="rm-btn primary" onclick={() => choose('merge')} use:tapBounce
				>{t('sync.review.merge')}</button
			>
			<div class="rm-row2">
				<button class="rm-btn" onclick={() => choose('mine')} use:tapBounce
					>{t('sync.review.keepMine')}</button
				>
				<button class="rm-btn" onclick={() => choose('theirs')} use:tapBounce
					>{t('sync.review.useTheirs')}</button
				>
			</div>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: rgba(0, 0, 0, 0.55);
	}
	.review-modal {
		position: fixed;
		left: 12px;
		right: 12px;
		bottom: 16px;
		top: 64px;
		z-index: 91;
		display: flex;
		flex-direction: column;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 16px;
		max-width: 680px;
		margin: 0 auto;
		box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}
	.rm-title {
		font-size: calc(1.05rem * var(--fs-title, 1));
		font-weight: 700;
		color: var(--color-text);
		padding: 14px 16px 4px;
	}
	.rm-desc {
		margin: 0;
		padding: 0 16px 10px;
		font-size: 0.88rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}
	.rm-body {
		flex: 1;
		overflow-y: auto;
		padding: 0 16px 8px;
		-webkit-overflow-scrolling: touch;
	}
	.rm-section {
		margin-bottom: 14px;
	}
	.rm-sec-title {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 6px;
	}
	.rm-note {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin-bottom: 6px;
	}
	.rm-group {
		margin-bottom: 8px;
	}
	.rm-group-label {
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 4px;
	}
	.rm-group-label.in {
		color: var(--color-primary);
	}
	.rm-group-label.out {
		color: var(--color-text);
	}
	.rm-group-label.del {
		color: #ff5a76;
	}
	.rm-rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rm-row {
		font-size: 0.86rem;
		color: var(--color-text);
		padding: 5px 8px;
		border-radius: 8px;
		background: var(--color-surface);
		margin-bottom: 3px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rm-row.del {
		color: var(--color-text-muted);
		text-decoration: line-through;
	}
	.rm-more {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		padding: 2px 8px;
	}
	.rm-actions {
		padding: 10px 16px 16px;
		border-top: 1px solid var(--color-border);
		background: var(--color-surface-2);
	}
	.rm-btn {
		width: 100%;
		min-height: 48px;
		border-radius: 12px;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}
	.rm-btn.primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: #fff;
		margin-bottom: 8px;
	}
	.rm-row2 {
		display: flex;
		gap: 8px;
	}
	.rm-row2 .rm-btn {
		flex: 1;
	}
</style>
