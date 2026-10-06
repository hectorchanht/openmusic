<script lang="ts">
	// VersionPicker (Phase 26-04, VERSIONS-01; Gaps 4 & 5 closed in 26-08): a mobile-first sheet
	// listing the per-source variants of ONE song — the pre-dedupe rows that dedupeBest collapses
	// away. Tapping a variant plays THAT exact source's Track.
	//
	// Gap 5 (distinct rows): the raw `versions` list can carry N visually-identical hits from ONE
	// source (JOOX returned ~10 "That Should Be Me" rows). We collapse them at RENDER time via the
	// pure collapseVariants (intra-source de-dup, cross-source preserved) and label each row with a
	// version tag parsed from the title parens ((Live)/(Demo)/…) + the album as the subtitle
	// distinguisher — so this fix applies to EVERY picker mount (search page included) with no
	// search-page edit and no change to groupVariants.
	//
	// Gap 4 (lazy contexts): an optional `loading` prop lets a non-search caller (26-10 menu / up-next)
	// open the sheet and show a spinner while fetchVariants runs its single on-demand fan-out.
	//
	// Mirrors TrackMenu's sheet idiom EXACTLY (scrim + .menu + fly + dragClose + focusTrap + the
	// overlays open/dismiss $effect with untrack), so the OS/browser Back gesture closes the sheet
	// via the SINGLE dismiss path (host $effect cleanup is the ONLY overlays.dismiss caller).
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { names } from '$lib/stores/names.svelte';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { marquee } from '$lib/actions/marquee';
	import { t } from '$lib/i18n';
	import { collapseVariants, variantTag, type VersionTag } from '$lib/services/dedupe';
	import { SOURCES } from '$lib/sources/registry';
	import type { Track } from '$lib/sources/types';

	let {
		versions,
		open,
		onclose,
		onpick,
		loading = false,
		overlayId = 'versionpicker'
	}: {
		versions: Track[];
		open: boolean;
		onclose: () => void;
		onpick: (t: Track) => void;
		// OPTIONAL (Gap 4): render a spinner while a lazy on-demand variant fetch is in flight.
		loading?: boolean;
		// WR-02: the overlay-stack / history key for THIS instance. Defaults to 'versionpicker'
		// for back-compat, but co-mounted hosts (a page's own picker + the one inside the
		// TrackMenu it also mounts) MUST pass DISTINCT ids so a stray concurrent open pushes/pops
		// its own balanced history entry instead of colliding on one shared key (which orphans a
		// pushed history state → desyncs "history depth == overlay depth" → over-pops Back).
		overlayId?: string;
	} = $props();

	// Gap 5: collapse intra-source duplicates at render (cross-source variants are preserved as a
	// real choice). Applied here so the search-page mount AND the 26-10 menu/up-next mounts are fixed.
	const shown = $derived(collapseVariants(versions));

	// Quality label with a graceful fallback (many search stubs carry no quality pre-resolve).
	function qualityLabel(v: Track): string {
		return v.qualityLabel || v.quality || t('versions.unknownQuality');
	}
	// Gap 5 tag label: map the normalized enum to a LITERAL i18n key via a switch (NO dynamic
	// t('versions.tag.'+key) — that won't typecheck under strict; NO `as any`). An unrecognized
	// marker (vt.key === null) falls back to its raw title fragment.
	function tagLabel(vt: { key: VersionTag | null; text: string }): string {
		switch (vt.key) {
			case 'live': return t('versions.tag.live');
			case 'acoustic': return t('versions.tag.acoustic');
			case 'demo': return t('versions.tag.demo');
			case 'cover': return t('versions.tag.cover');
			case 'remix': return t('versions.tag.remix');
			case 'instrumental': return t('versions.tag.instrumental');
			case 'remaster': return t('versions.tag.remaster');
			default: return vt.text;
		}
	}
	// quick-261006-sdf: the sheet IS the source diff — every row must identify its source,
	// because the whole point of "Play from source" is choosing WHICH source plays. The
	// adapter label (网易云音乐 / QQ 音乐 / …) is the identity; duration rides the sub line so
	// same-title variants from different sources read apart at a glance.
	// quick-261006-zh: the label rides `names.zhLock` — the tongwentang (同文堂) script lock every
	// other page content goes through — so a zh-Hant user sees 網易雲音樂, not the Simplified
	// source string. No /api/translate round trip (brand names are never translated, only
	// re-scripted), and 'off' returns the label byte-for-byte.
	function sourceLabel(v: Track): string {
		return names.zhLock(SOURCES[v.source]?.label ?? v.source);
	}
	/** seconds → "m:ss" for the sub line. null when the source did not report a duration
	 *  (Track.duration is optional — never fabricate one). */
	function fmtDuration(sec: number | undefined): string | null {
		if (sec == null || !isFinite(sec) || sec <= 0) return null;
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60);
		return `${m}:${String(s).padStart(2, '0')}`;
	}
	// Gap 5 subtitle: album is the primary distinguisher when present (so two versions read apart),
	// else fall back to the quality label. Artist stays the lead so the row still identifies the song.
	// quick-261006-sdf: duration appended when known — it is often THE visible difference between
	// two sources' copies of the "same" song (live cut vs studio, intro skit present or not).
	function versionSub(v: Track): string {
		const artist = names.dnArtist(v.artist);
		const base = v.album && v.album.trim()
			? `${artist} · ${names.dnTitle(v.album)}`
			: `${artist} · ${qualityLabel(v)}`;
		const d = fmtDuration(v.duration);
		return d ? `${base} · ${d}` : base;
	}

	function pick(v: Track) {
		onpick(v);
		onclose();
	}

	// ---- back-gesture wiring (SINGLE dismiss path) ----
	// DEP IS `open` ONLY (mirrors TrackMenu): open pushes one history state; the $effect CLEANUP is
	// the SOLE overlays.dismiss caller, so scrim / drag / back-gesture all converge on one dismiss
	// site and history depth stays balanced. untrack the overlays calls so a sibling overlay
	// push/pop doesn't churn this effect (cleanup+reopen).
	$effect(() => {
		if (open) {
			// WR-02: capture the (stable) per-instance overlay id once, untracked, so this
			// effect's ONLY dependency stays `open` (mirrors TrackMenu) and the open/dismiss
			// pair always references the SAME id — keeping history push/pop balanced.
			const id = untrack(() => overlayId);
			untrack(() => overlays.open(id, () => onclose()));
			return () => untrack(() => overlays.dismiss(id));
		}
	});
</script>

{#if open}
	<button class="scrim" aria-label={t('menu.close')} onclick={onclose}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose }} use:focusTrap>
		<div class="menu-head">{t('versions.title')}</div>
		{#if loading}
			<p class="loading" aria-busy="true"><span class="row-spinner motion-always"></span>{t('versions.loading')}</p>
		{:else if shown.length === 0}
			<p class="empty">{t('versions.empty')}</p>
		{:else}
			{#each shown as v (v.uid)}
				{@const vt = variantTag(v.title)}
				<button class="mi" onclick={() => pick(v)} use:tapBounce>
					<span class="ver-meta">
						<span class="ver-title">
							<span class="ver-name" use:marquee><span class="marquee-inner">{names.dnTitle(v.title, v.artist)}</span></span>
						</span>
						<!-- quick-261006-tag: the source pill lives in the TAG ROW with the version
						     tag — never in the title line, where it stole width from the song name.
						     The row always renders (the source pill is unconditional); the version
						     tag joins it only when the title carries one. -->
						<span class="tag-row">
							<span class="src">{sourceLabel(v)}</span>
							{#if vt}<span class="ver-tag">{tagLabel(vt)}</span>{/if}
						</span>
						<span class="ver-sub">{versionSub(v)}</span>
					</span>
				</button>
			{/each}
		{/if}
	</div>
{/if}

<style>
	/* Sheet chrome mirrors TrackMenu (Pitfall-safe: same tokens, same fly, same mobile sizing). */
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, 0.45); border: none; }
	.menu {
		position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81;
		background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px;
		padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
		max-height: 90vh; overflow-y: auto;
	}
	.menu-head { font-size: calc(0.8125rem * var(--fs-title, 1)); color: var(--color-text-muted); padding: 8px 10px; }
	.empty { color: var(--color-text-muted); font-size: 0.875rem; padding: 8px 12px 12px; margin: 0; }
	/* Gap 4 loading affordance — mirrors TrackMenu's .row-spinner idiom, including the
	   quick-260809-mvz `.motion-always` exemption that keeps it turning under reduce-motion. */
	.loading { display: flex; align-items: center; gap: 10px; color: var(--color-text-muted); font-size: 0.875rem; padding: 12px; margin: 0; }
	.row-spinner { width: 16px; height: 16px; flex: none; border: 2px solid var(--color-text-muted); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.mi {
		width: 100%; display: flex; align-items: center; gap: 12px; min-height: 44px;
		background: none; border: none; color: var(--color-text); font-size: 0.9375rem; padding: 12px;
		border-radius: 10px; cursor: pointer; text-align: left;
	}
	.mi:hover { background: var(--color-surface); }
	.ver-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	/* Title row: the name gets the full width — the source pill was evicted to .tag-row
	   (quick-261006-tag) so long titles never lose space to it. */
	.ver-title { font-size: 0.875rem; font-weight: 600; color: var(--color-text); min-width: 0; }
	.ver-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
	/* Tag row: source pill + version tag side by side under the title. */
	.tag-row { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
	/* quick-261006-sdf: the source pill — the row's identity in this sheet. Primary-tinted (not
	   muted like .ver-tag) because it is the decision the user is here to make. The text itself is
	   re-scripted by `names.zhLock` (tongwentang script lock, like all page content), so no locale
	   key is minted for the brand labels. */
	.src {
		flex: 0 0 auto; font-size: 0.625rem; font-weight: 700; letter-spacing: 0.02em; white-space: nowrap;
		color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 14%, transparent);
		padding: 1px 7px; border-radius: 6px; width: fit-content;
	}
	/* Gap 5 version tag — a muted pill next to the title, consistent weight with .src but subdued. */
	.ver-tag {
		flex: 0 0 auto; font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
		color: var(--color-text-muted); background: var(--color-surface); padding: 1px 6px; border-radius: 6px;
		width: fit-content;
	}
	.ver-sub { font-size: 0.75rem; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
