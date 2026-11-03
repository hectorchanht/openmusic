// Support (donor wall) UI state — 2026-10-14 donor-wall-ui.
//
// UI-ONLY phase: no payment wiring, no donor verification. `isSupporter` reads a
// localStorage flag that nothing ever sets, so it is always false today — the
// gating call sites (album "Download all") are already correct for the future
// verification leg: tap → donor wall opens; when verified, the real download runs.
//
// NAMING NOTE: "donor" in this codebase means a fallback AUDIO SOURCE
// (downloadFromDonor, the cross-source donor walk). This feature is the donation
// donor, so it is named "support/supporter" everywhere to avoid colliding with
// that established meaning.
import { browser } from '$app/environment';

class Supporter {
	/** The donor-wall sheet visibility (mounted ONCE in (app)/+layout.svelte). */
	sheetOpen = $state(false);
	/** Donor-verified — always false until the Ko-fi/GitHub verification leg lands. */
	isSupporter = $state(false);

	load() {
		if (!browser) return;
		try {
			this.isSupporter = localStorage.getItem('openmusic:supporter:v1') === '1';
		} catch {
			// Never break the app for a flag read.
		}
	}

	openSheet() {
		this.sheetOpen = true;
	}

	closeSheet() {
		this.sheetOpen = false;
	}
}

export const support = new Supporter();
