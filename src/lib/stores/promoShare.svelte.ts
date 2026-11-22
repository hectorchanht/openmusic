// promoShare — the "ready-written for you" share sheet's state (quick-261122-sharefeed).
//
// GOLD RULE — FEED IT TO THEIR MOUTH （喂到口邊, Hector 2026-11-21): users only send what is
// handed to them finished. The track ⋮ menu's Share opens PromoShareSheet (mounted ONCE in
// (app)/+layout.svelte, the SupporterSheet precedent) showing the canon promo message in the
// user's own language, signed with the name they gave once, one tap from the clipboard or
// WhatsApp. The words come from services/promo-message (deck canon) — none are authored here.
//
// Persistence: the sender name lives at `openmusic:share:v1` ({ sender }) and is applied to every
// language version. Nothing else is stored.
//
// Counting: share opens / copies / WhatsApp taps are anonymous TOTALS via analytics.trackShare —
// language + variant only, never the sender name or any identity (data doctrine).
import { browser } from '$app/environment';
import { settings } from '$lib/stores/settings.svelte';
import { trackShare, type ShareAction } from '$lib/analytics';
import {
	cleanSender,
	defaultPromoLang,
	renderPromo,
	renderShort,
	type PromoLangId,
	type PromoTrack
} from '$lib/services/promo-message';

export const PROMO_SHARE_KEY = 'openmusic:share:v1';

/** Clipboard write with the textarea fallback (older WebViews / denied permission). Never throws. */
export async function writeClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		try {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.setAttribute('readonly', '');
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			const ok = document.execCommand('copy');
			document.body.removeChild(ta);
			return ok;
		} catch {
			return false;
		}
	}
}

class PromoShare {
	sheetOpen = $state(false);
	/** The track the sheet was opened for (null = share the app itself). */
	track = $state<PromoTrack | null>(null);
	/** Lead the message with the shared track (on by default when there is one). */
	includeTrack = $state(true);
	/** The message language currently shown. */
	lang = $state<PromoLangId>('en');
	/** The language this user sees FIRST (pills render it leftmost). */
	defaultLang = $state<PromoLangId>('en');
	/** "Who's sending" — persisted, applied to every language. */
	sender = $state('');

	private loaded = false;

	load(): void {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const raw = localStorage.getItem(PROMO_SHARE_KEY);
			if (!raw) return;
			const v = JSON.parse(raw) as { sender?: unknown };
			if (typeof v?.sender === 'string') this.sender = cleanSender(v.sender);
		} catch {
			/* storage unavailable / corrupt — start blank */
		}
	}

	setSender(raw: string): void {
		// Keep what the user is typing (spaces included) in the field; persist the cleaned value.
		this.sender = raw.slice(0, 60);
		try {
			localStorage.setItem(PROMO_SHARE_KEY, JSON.stringify({ sender: cleanSender(raw) }));
		} catch {
			/* storage unavailable — the name just won't survive a reload */
		}
	}

	open(track: PromoTrack | null = null): void {
		this.load();
		const deviceLangs = browser && typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
		this.defaultLang = defaultPromoLang(settings.appLang, deviceLangs);
		this.lang = this.defaultLang;
		this.track = track;
		this.includeTrack = true;
		this.sheetOpen = true;
		trackShare('open', this.lang);
	}

	close(): void {
		this.sheetOpen = false;
	}

	/** The full message exactly as it will be copied / sent. */
	message(lang: PromoLangId = this.lang): string {
		return renderPromo(lang, {
			sender: this.sender,
			track: this.includeTrack ? this.track : null
		});
	}

	private count(action: ShareAction, variant: 'full' | 'short' | 'link' = 'full'): void {
		trackShare(action, this.lang, variant);
	}

	/** One-tap copy of the FULL message (link included). */
	async copyFull(): Promise<boolean> {
		const ok = await writeClipboard(this.message());
		if (ok) this.count('copy', 'full');
		return ok;
	}

	async copyShort(): Promise<boolean> {
		const text = renderShort(this.lang);
		if (!text) return false;
		const ok = await writeClipboard(text);
		if (ok) this.count('copy', 'short');
		return ok;
	}

	/** The plain copy-link path (what Share did before this sheet). */
	async copyLink(): Promise<boolean> {
		if (!this.track) return false;
		const ok = await writeClipboard(this.track.url);
		if (ok) this.count('copy', 'link');
		return ok;
	}

	/** Counted when the WhatsApp handoff link is tapped (the anchor itself navigates). */
	countWhatsApp(): void {
		this.count('wa', 'full');
	}
}

export const promoShare = new PromoShare();
