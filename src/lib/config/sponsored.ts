// Dawn "Sponsored" strip link config — the single source of truth for the
// home-page sponsored strip's outbound links.
//
// Paste a real URL into a slot to have its button appear; an EMPTY string means
// "no link for this slot" and the strip renders nothing for it. If every URL
// were empty the strip would render nothing at all (but the tip jar is always set).

export const TIP_JAR_URL = 'https://dawnlimited.gumroad.com/l/openmusic-tip';
export const WISE_URL = 'https://wise.com/invite/dic/hotungc3';
export const COINBASE_URL = 'https://advanced.coinbase.com/join/F95MLKD?src=referral-link';
export const BINANCE_URL = 'https://www.binance.com/activity/referral-entry/CPA?ref=CPA_0027L6WVRQ';

// Placeholder slots: render nothing until Hector pastes real links.
export const AIRALO_URL = '';
export const KOINLY_URL = '';
export const AIRWALLEX_URL = '';

/** Slot-level guard: a button renders only when its URL is non-empty. */
export function hasLink(url: string): boolean {
	return url.trim().length > 0;
}

export const hasTipJarLink = () => hasLink(TIP_JAR_URL);
export const hasWiseLink = () => hasLink(WISE_URL);
export const hasCoinbaseLink = () => hasLink(COINBASE_URL);
export const hasBinanceLink = () => hasLink(BINANCE_URL);
export const hasAiraloLink = () => hasLink(AIRALO_URL);
export const hasKoinlyLink = () => hasLink(KOINLY_URL);
export const hasAirwallexLink = () => hasLink(AIRWALLEX_URL);

/** True when the strip has anything to show at all. */
export function hasAnySponsorLink(): boolean {
	return [
		TIP_JAR_URL,
		WISE_URL,
		COINBASE_URL,
		BINANCE_URL,
		AIRALO_URL,
		KOINLY_URL,
		AIRWALLEX_URL
	].some(hasLink);
}
