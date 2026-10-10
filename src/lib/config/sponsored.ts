// Dawn "Sponsored" strip link config — the single source of truth for the
// home-page sponsored strip's outbound links.
//
// Paste a real URL into a slot to have its button appear; an EMPTY string means
// "no link for this slot" and the strip renders nothing for it. If every URL
// were empty the strip would render nothing at all (but the tip jar is always set).

export const TIP_JAR_URL = 'https://dawnlimited.gumroad.com/l/openmusic-tip';

// The Gumroad product permalink used by POST /api/sponsored/verify — license
// keys from the tip jar's receipts are verified against this product.
export const GUMROAD_PRODUCT_PERMALINK = 'openmusic-tip';

// ADMIN UNLOCK (Hector 2026-10-10: "generate me an admin license key to unlock
// all app"): the master key's SHA-256, NOT the plaintext — this repo is public
// and the key was delivered to Hector in chat only. /api/sponsored/verify
// accepts either a valid Gumroad tip-jar key OR an input whose SHA-256 matches
// this hash. Stakes are low (it only hides the sponsored strip), so hash-in-code
// is proportionate; brute-forcing a 32-char key from its hash is infeasible.
export const ADMIN_KEY_SHA256 = '67d2d8519b0160af28a8d8f6c3cc97d810fda37161d2b10b1359d480c4ecad77';

// SUPPORTER CHOICE MODEL (Hector 2026-10-10): verifying a tip-jar license key
// sets dawn_supporter=1 and persists the key itself. It does NOT hide the strip.
// Hiding stays a user choice via SPONSORED_HIDE_KEY (Settings → Supporter toggle).
// Marking supporter status is also the seed for future feature unlocks (gate via
// isSupporter()).
export const SUPPORTER_KEY = 'dawn_supporter';

// localStorage flag hiding the strip — set ONLY by the user's explicit toggle
// on the Settings → Supporter page (never auto-set on verify).
export const SPONSORED_HIDE_KEY = 'dawn_sponsored_hidden';

// localStorage slot for the user's own verified tip-jar license key, persisted
// after a successful verify so the Settings input pre-fills on return and the
// key can be copied for reuse on another device/app. Only ever sent to
// /api/sponsored/verify on explicit Verify clicks — never auto-submitted.
export const TIP_LICENSE_KEY = 'dawn_tip_license_key';

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

/**
 * SSR-safe check for verified-supporter status — the future feature-gating
 * hook (nothing gated yet). True only in the browser when a tip-jar key has
 * verified successfully (localStorage dawn_supporter === "1").
 */
export function isSupporter(): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		return localStorage.getItem(SUPPORTER_KEY) === '1';
	} catch {
		/* storage unavailable (private mode) — treat as non-supporter */
		return false;
	}
}
