// Support-rail link config — the single source of truth for the tip jar.
// quick-261119-tiponly (Hector 2026-11-19): the tip jar is now the ONLY
// support rail. Every referral sponsor was cancelled and its URL/helper
// deleted from this file (the cancelled names live only in the ban list of
// sponsored-strip.test.ts); the gold ☕ Tip jar pill in the Home header is
// all that remains.
//
// An EMPTY TIP_JAR_URL would render nothing at all (but the tip jar is always set).

export const TIP_JAR_URL = 'https://dawnlimited.gumroad.com/l/openmusic-tip';

// The Gumroad product permalink used by POST /api/sponsored/verify — license
// keys from the tip jar's receipts are verified against this product.
export const GUMROAD_PRODUCT_PERMALINK = 'openmusic-tip';

// ADMIN UNLOCK (Hector 2026-10-10: "generate me an admin license key to unlock
// all app"): the master key's SHA-256, NOT the plaintext — this repo is public
// and the key was delivered to Hector in chat only. /api/sponsored/verify
// accepts either a valid Gumroad tip-jar key OR an input whose SHA-256 matches
// this hash. Stakes are low (it only grants supporter status), so hash-in-code
// is proportionate; brute-forcing a 32-char key from its hash is infeasible.
export const ADMIN_KEY_SHA256 = '67d2d8519b0160af28a8d8f6c3cc97d810fda37161d2b10b1359d480c4ecad77';

// SUPPORTER CHOICE MODEL (Hector 2026-10-10): verifying a tip-jar license key
// sets dawn_supporter=1 and persists the key itself. It does NOT hide the
// tip-jar button.
// Hiding stays a user choice via SPONSORED_HIDE_KEY (Settings → Supporter toggle).
// Marking supporter status is also the seed for future feature unlocks (gate via
// isSupporter()).
export const SUPPORTER_KEY = 'dawn_supporter';

// localStorage flag hiding the tip-jar button — set ONLY by the user's explicit
// toggle on the Settings → Supporter page (never auto-set on verify). The key
// name is historical (from the retired sponsored strip) and must not change,
// or existing supporters would lose their hide choice.
export const SPONSORED_HIDE_KEY = 'dawn_sponsored_hidden';

// localStorage slot for the user's own verified tip-jar license key, persisted
// after a successful verify so the Settings input pre-fills on return and the
// key can be copied for reuse on another device/app. Only ever sent to
// /api/sponsored/verify on explicit Verify clicks — never auto-submitted.
export const TIP_LICENSE_KEY = 'dawn_tip_license_key';

/** URL guard: a button renders only when its URL is non-empty. */
export function hasLink(url: string): boolean {
	return url.trim().length > 0;
}

export const hasTipJarLink = () => hasLink(TIP_JAR_URL);

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

/**
 * quick-261023-perks — SUPPORTER TIERS. Three tiers by tip amount; the badge
 * renders from the stored tier. HONEST LIMITATION: Gumroad's keyless license
 * verify (/v2/licenses/verify) returns NO amount — only success/uses/refunded.
 * Sale amounts need a Gumroad access token (server-side /v2/sales), which
 * Hector has not provided. Until then every verified tip lands on 'bronze'
 * and the tier only upgrades when the amount becomes readable (or Hector's
 * admin key, which lands on 'gold'). The plumbing (stored tier, badge render,
 * wall entry) is real; the thresholds below are the activation spec.
 */
export type SupporterTier = 'bronze' | 'silver' | 'gold';

export const SUPPORTER_TIER_KEY = 'dawn_supporter_tier';

export const SUPPORTER_TIERS: Record<SupporterTier, { badge: string; minTipUSD: number }> = {
	bronze: { badge: '☕', minTipUSD: 0 },
	silver: { badge: '🥈', minTipUSD: 10 },
	gold: { badge: '🥇', minTipUSD: 25 }
};

/** SSR-safe read of the stored tier — 'bronze' unless a higher tier was recorded. */
export function getSupporterTier(): SupporterTier {
	if (typeof localStorage === 'undefined') return 'bronze';
	try {
		const v = localStorage.getItem(SUPPORTER_TIER_KEY);
		if (v === 'silver' || v === 'gold') return v;
		return 'bronze';
	} catch {
		return 'bronze';
	}
}

/** Persist the tier. Best-effort — a quota failure just keeps the old tier. */
export function setSupporterTier(tier: SupporterTier): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(SUPPORTER_TIER_KEY, tier);
	} catch {
		/* ignore */
	}
}

/** The badge glyph for the current tier — what the Settings card renders. */
export function supporterBadge(): string {
	return SUPPORTER_TIERS[getSupporterTier()].badge;
}
