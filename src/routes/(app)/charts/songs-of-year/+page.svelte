<script lang="ts">
	// Songs of the Year hub — all regional 2026 packs (Hector 2026-10-10: "Build all popular countries").
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { t, type TranslationKey } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { goto } from '$app/navigation';
	import { PACK_META as CANTOPOP_META, CANTOPOP_2026 } from '$lib/data/cantopop-2026';
	import { PACK_META_MANDOPOP_2026, MANDOPOP_2026 } from '$lib/data/mandopop-2026';
	import { PACK_META_KPOP_2026, KPOP_2026 } from '$lib/data/kpop-2026';
	import { PACK_META_JPOP_2026, JPOP_2026 } from '$lib/data/jpop-2026';
	import { PACK_META_WESTERN_2026, WESTERN_2026 } from '$lib/data/western-2026';
	import { ChevronRight } from '@lucide/svelte';

	const packs: { meta: { id: string; titleEn: string }; count: number; href: string; titleKey: TranslationKey }[] = [
		{ meta: CANTOPOP_META, count: CANTOPOP_2026.length, href: '/charts/cantopop-2026', titleKey: 'pack.title.cantopop' },
		{ meta: PACK_META_MANDOPOP_2026, count: MANDOPOP_2026.length, href: '/charts/mandopop-2026', titleKey: 'pack.title.mandopop' },
		{ meta: PACK_META_KPOP_2026, count: KPOP_2026.length, href: '/charts/kpop-2026', titleKey: 'pack.title.kpop' },
		{ meta: PACK_META_JPOP_2026, count: JPOP_2026.length, href: '/charts/jpop-2026', titleKey: 'pack.title.jpop' },
		{ meta: PACK_META_WESTERN_2026, count: WESTERN_2026.length, href: '/charts/western-2026', titleKey: 'pack.title.western' }
	];
</script>

<PageHeader backLabel={t('common.back')} showSettings />

<header class="hero">
	<span class="free-badge">免費 FREE</span>
	<h1>{t('home.songsOfYear')}</h1>
	<p class="sub">2026 · 5 regions</p>
</header>

<ul class="packs">
	{#each packs as p (p.meta.id)}
		<li>
			<button type="button" class="pack" onclick={() => goto(p.href)} use:tapBounce>
				<span class="meta">
					<span class="title">{t(p.titleKey)}</span>
					<span class="count">{p.meta.titleEn} · {p.count} {t('pack.songs')}</span>
				</span>
				<ChevronRight size={20} />
			</button>
		</li>
	{/each}
</ul>

<style>
	.hero { padding: 24px 16px 8px; text-align: center; }
	.free-badge {
		display: inline-block; padding: 3px 12px; border-radius: 999px;
		background: var(--color-primary); color: #fff; font-size: 0.72rem;
		font-weight: 700; letter-spacing: 0.08em; margin-bottom: 10px;
	}
	.hero h1 { font-size: calc(1.6rem * var(--fs-title, 1)); margin: 0; }
	.sub { color: var(--color-text-muted); font-size: 0.85rem; margin: 6px 0 0; }
	.packs { list-style: none; margin: 16px 0 0; padding: 0 16px 32px; display: grid; gap: 12px; }
	.pack {
		display: flex; align-items: center; justify-content: space-between; width: 100%;
		padding: 16px; border-radius: 12px; border: 1px solid var(--color-border);
		background: var(--color-surface); cursor: pointer; text-align: left;
	}
	.meta { display: flex; flex-direction: column; gap: 4px; }
	.title { font-size: 1.1rem; font-weight: 700; }
	.count { font-size: 0.85rem; color: var(--color-text-muted); }
</style>
