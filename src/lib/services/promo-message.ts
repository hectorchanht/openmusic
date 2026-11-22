// promo-message — the ready-written share messages, rendered from the deck canon
// (quick-261122-sharefeed; GOLD RULE "feed it to their mouth" 喂到口邊, Hector 2026-11-21).
//
// Users do not write their own promo text, so Share hands them a finished, friend-tone message.
// The words are NOT authored here: they come verbatim from the promo copy deck （一按複製・推介訊息）,
// vendored as promo-canon.json by scripts/sync-promo-canon.mjs. This module only:
//   - maps each canon language to a stable id and picks the default for this user,
//   - fills the canon's slots (greeting {name}, the " — Hector" sign-off → the user's own name),
//   - optionally leads with the track being shared (a language-neutral line, so no copy forks),
//   - builds the wa.me handoff.
// PURE (no $state, no browser): node-testable, and promo-message.test.ts pins the drift check.
import canon from './promo-canon.json';

/** Stable ids for the six canon languages. 'yue' = 廣東話 (HK), 'zh-TW' = 台灣繁體. */
export type PromoLangId = 'yue' | 'zh-TW' | 'zh-CN' | 'en' | 'ja' | 'ko';

/** Canon `lang` label → id. A canon entry whose label is missing here fails the drift test. */
const LABEL_TO_ID: Record<string, PromoLangId> = {
	廣東話: 'yue',
	繁體中文: 'zh-TW',
	简体中文: 'zh-CN',
	English: 'en',
	日本語: 'ja',
	한국어: 'ko'
};

/** The deck signs every full message as Hector; in-app it becomes the SENDER's own name. */
export const CANON_SIGNATURE = ' — Hector';

/** The bare app link the canon carries. */
export const PROMO_LINK: string = canon.link;

/** Where the canon lives (provenance; shown nowhere, recorded for the sync path). */
export const PROMO_CANON_SOURCE: string = canon.source;

export interface PromoLang {
	id: PromoLangId;
	/** The canon's own language label (廣東話 / 繁體中文 / … — already in its own script). */
	label: string;
	region: string;
	/** Greeting used in the {name} slot (the in-app sheet has no recipient field). */
	generic: string;
	/** Canon full text, verbatim (slots unfilled). */
	text: string;
	/** Canon ultra-short version for this language, verbatim, when the deck has one. */
	short: string | null;
}

type CanonFull = { lang: string; region: string; generic: string; text: string };
type CanonShort = { lang: string; text: string };

/** Every canon language, in DECK order. */
export const PROMO_LANGS: readonly PromoLang[] = (canon.full as CanonFull[]).flatMap((f) => {
	const id = LABEL_TO_ID[f.lang];
	if (!id) return [];
	const short = (canon.short as CanonShort[]).find((s) => s.lang === f.lang)?.text ?? null;
	return [{ id, label: f.lang, region: f.region, generic: f.generic, text: f.text, short }];
});

export function promoLang(id: PromoLangId): PromoLang {
	return PROMO_LANGS.find((l) => l.id === id) ?? PROMO_LANGS.find((l) => l.id === 'en')!;
}

/** Is this an HK/Macau locale (→ Cantonese copy rather than Taiwan Traditional)? */
function isHkLocale(tag: string): boolean {
	const l = tag.toLowerCase();
	return l.startsWith('yue') || /-(hk|mo)\b/.test(l);
}

/**
 * The message language this user sees FIRST — their own app language.
 *
 * `appLang` is settings.appLang (typed loosely: the canon has ja/ko, which the app UI does not
 * speak yet; a future 'ja'/'ko' AppLang maps straight through). `deviceLangs` is
 * navigator.languages, consulted only where the app language cannot answer:
 *  - zh-Hant splits on region: an HK/Macau device → 廣東話, otherwise 台灣繁體.
 *  - a non-canon app language (en, es, fr, …) on a Japanese / Korean device → ja / ko, because the
 *    app UI simply has no ja/ko option to have been picked; otherwise English.
 */
export function defaultPromoLang(appLang: string, deviceLangs: readonly string[] = []): PromoLangId {
	const a = appLang.toLowerCase();
	if (a.startsWith('ja')) return 'ja';
	if (a.startsWith('ko')) return 'ko';
	if (a.startsWith('yue')) return 'yue';
	if (a === 'zh-hant' || a === 'zh-tw' || a === 'zh-hk' || a === 'zh-mo') {
		return isHkLocale(a) || deviceLangs.some(isHkLocale) ? 'yue' : 'zh-TW';
	}
	if (a.startsWith('zh')) return 'zh-CN';
	for (const d of deviceLangs) {
		const l = d.toLowerCase();
		if (l.startsWith('ja')) return 'ja';
		if (l.startsWith('ko')) return 'ko';
	}
	return 'en';
}

/** Default first, then the rest in deck order — the order the sheet's language pills render in. */
export function orderedPromoLangs(first: PromoLangId): PromoLang[] {
	const head = PROMO_LANGS.filter((l) => l.id === first);
	return [...head, ...PROMO_LANGS.filter((l) => l.id !== first)];
}

/** Sender-name hygiene: one line, trimmed, capped (it is pasted into someone else's chat). */
export const SENDER_MAX = 40;
export function cleanSender(raw: string | null | undefined): string {
	return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, SENDER_MAX).trim();
}

export interface PromoTrack {
	title: string;
	artist: string;
	/** The song's own share link (songShareUrl). */
	url: string;
}

/** The language-neutral lead naming the shared track — no prose, so no per-language copy fork. */
export function trackLead(track: PromoTrack): string {
	const who = track.artist.trim();
	return `🎧 ${track.title.trim()}${who ? ` — ${who}` : ''}\n${track.url}\n\n`;
}

/**
 * The FULL ready-to-send message for one language: canon text with the greeting slot filled, the
 * sign-off carrying the sender's name (or dropped when none is set — a stranger's message must
 * never go out signed "Hector"), led by the shared track when given.
 */
export function renderPromo(
	id: PromoLangId,
	opts: { sender?: string | null; track?: PromoTrack | null } = {}
): string {
	const lang = promoLang(id);
	let body = lang.text.replace('{name}', lang.generic);
	const sender = cleanSender(opts.sender);
	if (body.endsWith(CANON_SIGNATURE)) {
		body = body.slice(0, -CANON_SIGNATURE.length) + (sender ? ` — ${sender}` : '');
	}
	return (opts.track ? trackLead(opts.track) : '') + body;
}

/** The ultra-short canon line, verbatim (no slots), or null when the deck has none for `id`. */
export function renderShort(id: PromoLangId): string | null {
	return promoLang(id).short;
}

/** WhatsApp handoff: wa.me with the full message pre-filled (recipient chosen in WhatsApp). */
export function whatsappUrl(text: string): string {
	return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
