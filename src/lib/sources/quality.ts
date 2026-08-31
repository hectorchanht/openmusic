// PURE quality-ladder reordering (D-03). NO runes, NO `$app`, NO store import —
// the caller passes the preference as an ARGUMENT so this is node-unit-testable
// without mocking the settings store (RESEARCH Open Question 2).
//
// The per-source ladders (QQ `pickBestPlayUrl`, JOOX `JOOX_QUALITY_ORDER`) are
// ordered top-tier-first. `pickByQualityPref` reorders that list to put the band
// matching the user's `defaultQuality` preference FIRST, preserving the relative
// order within and outside the band (a stable partition). The adapter then picks
// the first PRESENT/REACHABLE tier off the reordered list, so the pref biases the
// selection toward the requested band while still falling through to whatever the
// source actually has (best-effort — matches the honest `defaultQualityNote`).
import type { DefaultQuality } from '$lib/stores/settings.svelte';

/** 128–160k band — JOOX `AAC 192`/`OGG 192`/`MP3 128`, QQ STD (128kbps).
 *  WR-02: match by BITRATE NUMBER only. A bare `aac` branch over-matched sub-128k
 *  tiers (`AAC 96`, `AAC 48`), which could promote a 48kbps stream ahead of 320/lossless
 *  when the user asked for 128k. The numbers express the band unambiguously. */
const BAND_128 = /128|160|192/i;
/** 320k band. */
const BAND_320 = /320/i;
/** Lossless / hi-res / atmos band — same vocabulary used in joox.ts/dedupe.ts. */
const BAND_LOSSLESS = /flac|lossless|atmos|hi-?res|母带|无损/i;

/**
 * Return a REORDERED copy of `tiers` with the band matching `pref` moved to the
 * front (stable). `'lossless'` and `'auto'` return the input order unchanged
 * (top-tier-first, today's behavior). Never mutates `tiers`.
 */
export function pickByQualityPref(tiers: string[], pref: DefaultQuality): string[] {
	const band = pref === '128' ? BAND_128 : pref === '320' ? BAND_320 : null;
	// 'lossless' → leave the ladder as-is (top tier first). 32-D-02: 'auto' also lands here,
	// but it is now a TOLERATED LEGACY INPUT rather than the live path — every adapter
	// pre-resolves the pref through `effectiveQuality` below, so a real 'auto' never reaches
	// this function anymore. Behavior is deliberately unchanged (the 'auto' no-op tests stay).
	if (!band) return [...tiers];

	const inBand: string[] = [];
	const rest: string[] = [];
	for (const tier of tiers) {
		(band.test(tier) ? inBand : rest).push(tier);
	}
	return [...inBand, ...rest];
}

/** The Network Information API subset we read. NOT in `lib.dom.d.ts`, so narrow it
 *  LOCALLY — the same discipline `proxy/edge-cache.ts` uses for the Cloudflare
 *  `caches.default` gap. No `any` cast — this repo has zero of those in production source. */
interface NetInfo {
	type?: 'bluetooth' | 'cellular' | 'ethernet' | 'none' | 'wifi' | 'wimax' | 'other' | 'unknown';
	saveData?: boolean;
}

/**
 * Resolve the `'auto'` rung to a CONCRETE tier — the ONE seam every pref-reading adapter
 * calls (32-D-02 / 32-D-03). Non-`'auto'` prefs pass through untouched.
 *
 * WHITELIST that FAILS CLOSED to `'320'`: lossless only on a connection we can POSITIVELY
 * identify as unmetered. Per MDN browser-compat-data, `NetworkInformation.type` is the
 * accurate metering value but ships on Chrome Android 38+ and WebView Android 50+ only —
 * it is FALSE on Safari/iOS entirely and ChromeOS-only on Chrome desktop. So iOS AND desktop
 * web get `'320'` under the new `'auto'` default: a DELIBERATE, user-approved tradeoff
 * (32-D-03), NOT a bug to fix. Android Chrome and the Capacitor APK do get wifi-lossless,
 * and picking `'lossless'` by hand always works everywhere.
 *
 * `effectiveType` is deliberately NOT consulted: it estimates SPEED, not metering, so fast
 * cellular reports `'4g'` and would be handed FLAC — the exact case 32-D-02 exists to avoid.
 * `saveData` is honoured because it is the one signal a user explicitly opts into.
 *
 * The `typeof navigator` probe is the SSR/edge guard. This file's contract is "NO runes, NO
 * `$app`, NO store import" (see the header), so it feature-detects instead of importing
 * `browser` — CLAUDE.md's browser-guard rule explicitly allows the feature-detect form, and
 * `player.svelte.ts`'s mediaSession probe is the in-repo precedent.
 *
 * Return type EXCLUDES `'auto'` so the compiler proves no adapter ladder can still see it.
 */
export function effectiveQuality(pref: DefaultQuality): Exclude<DefaultQuality, 'auto'> {
	if (pref !== 'auto') return pref;
	if (typeof navigator === 'undefined') return '320';
	const c = (navigator as Navigator & { connection?: NetInfo }).connection;
	if (!c || c.saveData === true) return '320';
	return c.type === 'wifi' || c.type === 'ethernet' ? 'lossless' : '320';
}
