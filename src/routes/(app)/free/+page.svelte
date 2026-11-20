<script lang="ts">
	// /free — the "free forever" showcase / manifesto page (quick-261118-free, Hector via Muse).
	//
	// HONEST COPY ONLY: every claim below was checked against this repo before it was written —
	//  - per-song download is free; album / discography bulk ZIP is the ONE supporter-gated
	//    convenience (album/[name] + artist/[name]/albums `isSupporter()` gate, quick-261023-bulklock)
	//  - Your Radio = Last.fm/Deezer SIMILARITY seeded from play history (services/radio.ts) — not
	//    an AI model, and worded that way
	//  - the account syncs library (liked + playlists), history, search history and settings
	//    (backup-logic BACKUP_EXACT_KEYS). quick-261118-freeresume: since quick-261118-xdresume the
	//    PLAYER state (song + queue + position) travels too — the "Now playing" sync family (default
	//    ON, deselectable in Settings → Account), replace-wins by updatedAt, and syncOnce defers the
	//    pull while audio plays. The copy says exactly that: on open / return, never mid-song, newest wins.
	//  - gold + sakura are SUPPORTER_THEMES (settings.svelte.ts); the ☕ Tip jar button in the
	//    Home header (config/sponsored.ts) is the only support rail — quick-261119-tiponly:
	//    Hector cancelled every referral sponsor on 2026-11-19, tip jar only
	// Deliberately absent: any community-chat server link (Hector standing rule until a volunteer mod exists) and every
	// public-social share button — WhatsApp only. Comparison rows stay qualitative (no prices).
	import { onMount } from 'svelte';
	import { Check, Heart, Code2, Globe, MessageCircle, ShieldCheck, Users, Sparkles } from '@lucide/svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t, type TranslationKey } from '$lib/i18n';
	import { shareOrigin } from '$lib/services/share';
	import { DAWN_GATEWAY_URL, OPENMUSIC_REPO_URL, whatsappShareUrl } from '$lib/services/free-page';

	onMount(() => settings.load());

	const FREE_ITEMS: TranslationKey[] = [
		'free.item.streaming',
		'free.item.downloads',
		'free.item.lyrics',
		'free.item.radio',
		'free.item.playlists',
		'free.item.favourites',
		'free.item.history',
		'free.item.resume'
	];

	const ACCOUNT_ITEMS: TranslationKey[] = [
		'free.account.liked',
		'free.account.playlists',
		'free.account.history',
		'free.account.settings',
		'free.account.nowPlaying'
	];

	// [row label, OpenMusic, Spotify, YouTube Music] — qualitative, publicly-listed plan features.
	const COMPARE: [TranslationKey, TranslationKey, TranslationKey, TranslationKey][] = [
		['free.cmp.ads', 'free.cmp.none', 'free.cmp.freeTier', 'free.cmp.freeTier'],
		['free.cmp.account', 'free.cmp.notNeeded', 'free.cmp.required', 'free.cmp.googleAccount'],
		['free.cmp.offline', 'free.cmp.freePerSong', 'free.cmp.paidPlan', 'free.cmp.paidPlan'],
		['free.cmp.openSource', 'free.cmp.yes', 'free.cmp.no', 'free.cmp.no']
	];

	// quick-261118-freeshots (Hector via Muse: SHOW, DON'T TELL): real captures of the live app,
	// shipped untouched in static/show/ — cover tiles show the app's own gradient fallback because
	// the capture sandbox could not reach the image hosts; that is a real app state, not retouched.
	// Settings first (the depth story), then the settings list, then Home. 2560×1600 sources; the
	// width/height attrs reserve the 16:10 box so nothing shifts while they lazy-load.
	const SHOTS: { src: string; caption: TranslationKey; alt: TranslationKey }[] = [
		{ src: '/show/shot-settings-top.webp', caption: 'free.shot.settingsCaption', alt: 'free.shot.settingsAlt' },
		{ src: '/show/shot-settings-scroll.webp', caption: 'free.shot.listCaption', alt: 'free.shot.listAlt' },
		{ src: '/show/shot-home.webp', caption: 'free.shot.homeCaption', alt: 'free.shot.homeAlt' }
	];

	// Share the app's public origin (shareOrigin maps localhost / capacitor: to the deployed one).
	const waHref = $derived(whatsappShareUrl(t('free.shareText', { url: shareOrigin() || 'https://openmusic.lol' })));
</script>

<svelte:head><title>{t('free.title')} · OpenMusic</title></svelte:head>

<PageHeader title={t('free.title')} />

<article class="free">
	<section class="hero" data-section="hero">
		<Sparkles size={28} class="hero-icon" />
		<h2>{t('free.heroTitle')}</h2>
		<p class="pledge">{t('free.heroPledge')}</p>
	</section>

	<section class="card" data-section="everything">
		<h2>{t('free.everythingTitle')}</h2>
		<ul class="checks">
			{#each FREE_ITEMS as k (k)}
				<li><Check size={16} class="ck" /> <span>{t(k)}</span></li>
			{/each}
		</ul>
		<p class="note strong">{t('free.everythingLead')}</p>
	</section>

	<section class="show" data-section="show">
		<h2>{t('free.showTitle')}</h2>
		{#each SHOTS as s (s.src)}
			<figure>
				<img src={s.src} alt={t(s.alt)} width="2560" height="1600" loading="lazy" decoding="async" />
				<figcaption>{t(s.caption)}</figcaption>
			</figure>
		{/each}
	</section>

	<section class="card" data-section="account">
		<h2>{t('free.accountTitle')}</h2>
		<p>{t('free.accountBody')}</p>
		<ul class="checks">
			{#each ACCOUNT_ITEMS as k (k)}
				<li><Check size={16} class="ck" /> <span>{t(k)}</span></li>
			{/each}
		</ul>
		<p class="note">{t('free.accountNote')}</p>
	</section>

	<section class="card honest" data-section="honest">
		<h2><Heart size={18} fill="currentColor" /> {t('free.honestTitle')}</h2>
		<p>{t('free.honestBody')}</p>
		<p>{t('free.honestRail')}</p>
		<p>{t('free.honestThemes')}</p>
		<p class="strong">{t('free.honestPlain')}</p>
	</section>

	<section class="card" data-section="flex">
		<h2><Users size={18} /> {t('free.flexTitle')}</h2>
		<p>{t('free.flexBody')}</p>
		<p>{t('free.flexCost')}</p>
		<p>{t('free.flexOpen')}</p>
		<a class="link-row" href={OPENMUSIC_REPO_URL} target="_blank" rel="noopener noreferrer" use:tapBounce>
			<Code2 size={18} /> <span>{t('free.flexRepo')}</span>
		</a>
		<p class="note">{t('free.flexCredit')}</p>
	</section>

	<section class="card" data-section="compare">
		<h2>{t('free.compareTitle')}</h2>
		<p class="note">{t('free.compareLead')}</p>
		<div class="tablewrap">
			<table>
				<thead>
					<tr>
						<th scope="col"><span class="sr">{t('free.cmp.feature')}</span></th>
						<th scope="col" class="om">OpenMusic</th>
						<th scope="col">Spotify</th>
						<th scope="col">YouTube Music</th>
					</tr>
				</thead>
				<tbody>
					{#each COMPARE as [label, om, sp, yt] (label)}
						<tr>
							<th scope="row">{t(label)}</th>
							<td class="om">{t(om)}</td>
							<td>{t(sp)}</td>
							<td>{t(yt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="note">{t('free.compareFootnote')}</p>
	</section>

	<section class="card" data-section="gateway">
		<h2><Globe size={18} /> {t('free.gatewayTitle')}</h2>
		<p>{t('free.gatewayBody')}</p>
		<a class="link-row" href={DAWN_GATEWAY_URL} target="_blank" rel="noopener noreferrer" use:tapBounce>
			<Globe size={18} /> <span>{t('free.gatewayLink')}</span>
		</a>
	</section>

	<section class="card" data-section="share">
		<h2>{t('free.shareTitle')}</h2>
		<p>{t('free.shareBody')}</p>
		<a class="wa" href={waHref} target="_blank" rel="noopener noreferrer" use:tapBounce>
			<MessageCircle size={18} /> {t('free.shareWhatsApp')}
		</a>
	</section>

	<p class="promise" data-section="data">
		<ShieldCheck size={16} /> <span>{t('free.dataPromise')}</span>
	</p>
</article>

<style>
	.free { padding: 4px 0 32px; max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
	.hero { text-align: center; padding: 18px 8px 6px; }
	.hero :global(.hero-icon) { color: var(--color-primary); }
	.hero h2 { font-size: calc(1.6rem * var(--fs-title, 1)); margin: 6px 0 8px; }
	.pledge { font-size: 1rem; line-height: 1.5; color: var(--color-text); margin: 0; font-weight: 600; }
	.card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 14px; padding: 16px; }
	.card h2 { display: flex; align-items: center; gap: 8px; font-size: 1.0625rem; margin: 0 0 10px; color: var(--color-text); }
	.card p { margin: 0 0 8px; font-size: 0.9375rem; line-height: 1.55; color: var(--color-text-muted); }
	.card p:last-child { margin-bottom: 0; }
	.strong { color: var(--color-text) !important; font-weight: 700; }
	.note { font-size: 0.8125rem !important; }
	.show h2 { font-size: 1.0625rem; margin: 4px 0 10px; color: var(--color-text); }
	.show figure { margin: 0 0 16px; }
	.show img { display: block; width: 100%; height: auto; aspect-ratio: 2560 / 1600; border-radius: 12px; border: 1px solid var(--color-border); background: var(--color-surface); }
	.show figcaption { margin-top: 8px; font-size: 0.875rem; line-height: 1.5; color: var(--color-text-muted); text-align: center; }
	.honest { border-style: dashed; border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border)); }
	.honest h2 :global(svg) { color: var(--color-primary); }
	.checks { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.checks li { display: flex; align-items: flex-start; gap: 8px; font-size: 0.9375rem; line-height: 1.45; color: var(--color-text); }
	.checks :global(.ck) { color: var(--color-primary); flex: none; margin-top: 3px; }
	.link-row { display: flex; align-items: center; gap: 10px; margin: 6px 0 10px; padding: 12px 14px; min-height: 48px; box-sizing: border-box; border-radius: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); text-decoration: none; font-size: 0.9375rem; font-weight: 600; }
	.tablewrap { overflow-x: auto; margin: 4px 0 10px; }
	table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
	th, td { padding: 8px 6px; text-align: start; border-bottom: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent); vertical-align: top; }
	thead th { color: var(--color-text-muted); font-weight: 600; }
	tbody th { color: var(--color-text); font-weight: 600; }
	td { color: var(--color-text-muted); }
	.om { color: var(--color-primary); font-weight: 700; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	.wa { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; box-sizing: border-box; margin-top: 4px; padding: 13px; min-height: 48px; border-radius: 12px; font-size: 0.9375rem; font-weight: 700; background: #25d366; color: #0b2e17; text-decoration: none; }
	.promise { display: flex; align-items: flex-start; gap: 8px; margin: 4px 4px 0; font-size: 0.8125rem; line-height: 1.5; color: var(--color-text-muted); }
	.promise :global(svg) { flex: none; margin-top: 2px; color: var(--color-primary); }
</style>
