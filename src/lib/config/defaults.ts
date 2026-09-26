// Central settings defaults (quick-260607-k3y). Edit this file to change what new users
// see + what reset-to-default reverts to. The Settings class in stores/settings.svelte.ts
// reads from these consts on class-field init AND on the reset-group methods.
//
// Each group is a plain literal object — `as const` keeps the strings narrow for type
// inference. Adding a new setting: 1) add it here in the right group; 2) reference it in
// the Settings class field initializer; 3) it appears in the matching reset method
// automatically. No new infrastructure needed.

import type { AppLang } from '$lib/i18n';
import {
	DEFAULT_SECTION_ORDER,
	DEFAULT_HOME_TAGS,
	DEFAULT_HOME_COUNTRIES,
	SHELF_DEFAULT,
	DEFAULT_CHART_GENRES,
	CLASSIC_SECTIONS,
	HOME_LAYOUT_VERSION,
	type ChartRegion,
	type HomeDensity,
	type HomeLandingTab,
	type HomeSectionId
} from '$lib/services/home-layout';
import type { SourceId } from '$lib/sources/types';
import type { LyricsLang, SourceLang, TranslateMode, DefaultQuality, DefaultSource, Theme, ZhScriptSetting, RowAction } from '$lib/stores/settings.svelte';

/** The accent-color hex used when the user hasn't picked one. Pulled out so the General
 *  reset can restore it without importing from settings.svelte.ts (circular).
 *  quick-260925-vtg: teal — the user's own exported settings adopted as the defaults (was
 *  #7c5cff). #00c2b8 is already an ACCENT_PRESETS entry, so the picker highlights it. */
export const DEFAULT_ACCENT = '#00c2b8';

// ---- General ---------------------------------------------------------------------------
// First-visit detection lives in settings.load() (browser-language auto-detect). Reset reverts
// to 'en' explicitly — the user can re-pick after.
export const GENERAL_DEFAULTS = {
	appLang: 'en' as AppLang,
	accent: DEFAULT_ACCENT,
	reduceMotion: false,
	/** Include the `Song • Artist` title line in the Web Share payload. OFF by default:
	 *  concatenating share targets (WhatsApp) render `title` and `text` as two separate lines,
	 *  duplicating the OG card, which already shows `Song • Artist` under the link
	 *  (quick-260808-vzu). Opt in to get the context inline. */
	shareIncludeTitle: false,
	/** Light/dark theme — default 'dark' (today's design). 'light' flips data-theme on <html>
	 *  to surface the `[data-theme='light']` token overrides in app.css. */
	theme: 'dark' as Theme
} as const;

// ---- Appearance (per-part sizing) ------------------------------------------------------
export const APPEARANCE_DEFAULTS = {
	/** quick-260920-kxz: GLOBAL text scale, percent. Drives `--fs-app`, which multiplies the ROOT
	 *  font-size, so it reaches every rem-sized rule in one move (which is why the px→rem sweep in
	 *  the same task exists — a root multiplier cannot move `font-size: 14px`). It COMPOSES with,
	 *  never replaces, the per-part scales below: a title at 120% app × 120% title is 1.44×. */
	fontScaleApp: 100,
	fontScaleTitle: 100,
	fontScaleArtist: 100,
	fontScaleLyrics: 100,
	/** Now-playing title font scale — separate slider from `fontScaleTitle` because NP's
	 *  base size is ~1.5rem vs ~14px on list pages, so the same multiplier looks lopsided. */
	fontScaleNpTitle: 100,
	/** Now-playing artist font scale — paired with fontScaleNpTitle, same rationale. */
	fontScaleNpArtist: 100,
	coverScale: 100,
	homeGridCols: 3,
	/** quick-260919-l9e (D-1): which inline buttons a song row shows, IN ORDER — the array is a
	 *  left-to-right layout, not a set, so moving 'download' first really moves the button.
	 *  It lives in Appearance (not Playback) because it is what a list row LOOKS like, next to
	 *  the row-size controls — the other "what fills a row" knobs.
	 *
	 *  quick-260925-vtg supersedes quick-260920-kxz (which had flipped the default to neither
	 *  on): a fresh row shows Download then Like — the user's own exported settings adopted as
	 *  the defaults. Either can still be switched off from the Song rows editor in Settings →
	 *  Appearance, and an empty row stays safe because the ⋮ menu is NOT in this list and is
	 *  unconditional, so every action stays reachable. An existing user's persisted `[]` still
	 *  survives load() (Array.isArray guard, asserted in settings-persist).
	 *  WR-10: this literal lives HERE and nowhere else. */
	rowActions: ['download', 'like'] as readonly RowAction[]
} as const;

// ---- Translation -----------------------------------------------------------------------
// Every per-part target defaults OFF, so no surface auto-translates unless the user opts in.
// artist/title/lastfm were already 'off' (k3y / f4y); quick-260925-vtg turns lyricsLang and
// bioLang 'off' too (they were 'auto') — the user's own exported settings adopted as the defaults.
export const TRANSLATION_DEFAULTS = {
	lyricsLang: 'off' as LyricsLang,
	artistLang: 'off' as LyricsLang,
	titleLang: 'off' as LyricsLang,
	lastfmLang: 'off' as LyricsLang,
	bioLang: 'off' as 'auto' | LyricsLang,
	// quick-260925-vtg — English titles/artists/lyrics are never translated by default (user's
	// exported settings); lastfmSkip left empty to match the export.
	artistSkip: ['en'] as readonly SourceLang[],
	titleSkip: ['en'] as readonly SourceLang[],
	lyricsSkip: ['en'] as readonly SourceLang[],
	lastfmSkip: [] as readonly SourceLang[],
	translateMode: 'replace' as TranslateMode,
	/** quick-260919-2jo (D-1) chose OFF so an EXISTING user saw no text change on their next app
	 *  open (and no silent change to the tags written into files they download).
	 *  quick-260925-vtg flips the DEFAULT to 'zh-Hant' — the user's own exported settings adopted
	 *  as the defaults. Existing users are still untouched: load() now accepts a persisted 'off'
	 *  as a real value (see the zhScript guard in settings.svelte.ts), so only a fresh install or
	 *  Reset lands on 'zh-Hant'.
	 *  WR-10: this literal lives HERE and nowhere else. */
	zhScript: 'zh-Hant' as ZhScriptSetting,
	/** Hide translations for lyrics lines extracted from a `(...)` clause. Default OFF —
	 *  parens-translations render alongside the parent line. */
	lyricsHideParenTranslation: false,
	/** Hide the parens-derived lines themselves (skip rendering them). Default OFF. */
	lyricsHideParenLines: false
} as const;

// ---- Playback --------------------------------------------------------------------------
export const PLAYBACK_DEFAULTS = {
	// 32-D-02 (SUPERSEDES the old D-03 '128' default): 'auto' now has a real meaning —
	// lossless on a connection positively identified as unmetered, '320' everywhere else.
	// See `sources/quality.ts` effectiveQuality for the whitelist and its fail-closed rule.
	// 32-D-04 (corrects the superseded D-03 comment, which claimed a "128–160k band"): the
	// '128' rung actually selects QQ's `song_play_url_standard`, MEASURED at 98 kbps — below
	// the band that comment asserted. The wrong number is why the default moved.
	defaultQuality: 'auto' as DefaultQuality,
	// quick-260925-vtg — same 'auto' rule as defaultQuality (32-D-02: lossless on unmetered,
	// '320' elsewhere), user's exported settings.
	downloadQuality: 'auto' as DefaultQuality,
	defaultSource: 'auto' as DefaultSource,
	autoExpandOnPlay: false,
	/** quick-260831-k5y: show the resolved track's quality tag (FLAC / 320 / …) on the
	 *  Now-Playing page. Shown by default per quick-260925-vtg (the user's own exported settings
	 *  adopted as the defaults); k5y's original "extra chrome" reasoning for OFF is superseded. */
	showQualityTag: true,
	/** quick-260919-1we (D-7): make the docked mini player show the currently-sung lyric line in
	 *  place of the artist name. OFF by default, for the reason k5y originally gave for
	 *  showQualityTag (before quick-260925-vtg flipped it): it
	 *  REPLACES information already on screen with different information, so a user who never opens
	 *  Settings must keep exactly today's Nowbar. */
	nowbarLyrics: false,
	/** Per-source enable map. Empty = each adapter's own enabledByDefault wins. */
	enabledSources: {} as Partial<Record<SourceId, boolean>>
} as const;

// ---- Up-next sourcing (Phase 17, QUEUE-03) ---------------------------------------------
// Per-context up-next sourcing. Each context resolves to one of two modes:
//   'same-list'  — snapshot the visible list at tap time (D-03); the exhaust engine still
//                  refills when the snapshot runs out.
//   'generated'  — tapped track + genre-similar generation (D-04); the global default.
// The types live HERE (not in a store) so both player.svelte.ts and settings.svelte.ts can
// import them without a circular dependency — defaults.ts is already imported by both.
export type UpnextMode = 'same-list' | 'generated';
/** Which surface started the current queue. `null` = unknown origin → global default. */
export type QueueContext =
	| 'liked'
	| 'search'
	| 'downloads'
	| 'playlist'
	| 'album'
	| 'artist'
	| 'home-discovery'
	| 'history'
	// Phase 19 (QUEUE-04 / D-06): an explicit Remix forces genre-generation regardless of the
	// user's global up-next setting. effectiveUpnextMode('remix') early-returns 'generated'.
	| 'remix'
	| null;
export const UPNEXT_DEFAULTS = {
	/** Global default sourcing mode — roadmap-locked to 'generated'. */
	mode: 'generated' as UpnextMode,
	/**
	 * Per-context overrides — ALBUM ONLY. `album` resolves to 'same-list' (a curated, ordered
	 * collection — users expect "play the rest of the album"); EVERY other context, artist
	 * included, resolves to the global `mode` ('generated') so a tap anywhere else fills Up-Next
	 * with similar songs.
	 *
	 * quick-260831-jtw: `artist` used to be pinned to 'same-list' here on the theory that an
	 * artist page is a curated collection too. It is not — tapping a song on an artist page is
	 * an ordinary "play this song" tap and should seed genre-similar sourcing like search/home/
	 * charts/library do. Dropped.
	 *
	 * Also quick-260831-jtw: this object is now the ACTUAL seed for `settings.upnextPerContext`
	 * (init + load fallback), not just what `resetPlayback()` spreads. Before, a fresh install
	 * started at `{}` (album generated) while a post-reset install got album+artist same-list —
	 * the same app behaving two ways depending on whether the reset button had ever been pressed.
	 * Wiring it as the seed also stops the album hot path from firing a full regenerate
	 * (track.getSimilar + a 20-track tail) that `setListQueue(all, 'album')` immediately discards
	 * via the queueGen guard.
	 */
	perContext: { album: 'same-list' } as Partial<Record<Exclude<QueueContext, null>, UpnextMode>>
} as const;

// ---- Home layout -----------------------------------------------------------------------
// homeSectionOrder/homeTags/homeCountries pull from the canonical pools in home-layout.ts
// so this file stays a single source of truth (no risk of drift).
export const HOME_DEFAULTS = {
	homeSectionOrder: [...DEFAULT_SECTION_ORDER] as HomeSectionId[],
	// 39-D-39: the four classic Deezer/Last.fm shelves stay available but start hidden. A fresh
	// install and Reset-to-default get the chart layout from here; an existing install gets it from
	// the one-time migration in settings.load(), because its persisted `homeHidden: []` is a real
	// value the type guard keeps (this default never reaches it).
	homeHidden: [...CLASSIC_SECTIONS] as string[],
	homeTags: [...DEFAULT_HOME_TAGS] as string[],
	homeCountries: [...DEFAULT_HOME_COUNTRIES] as string[],
	homeShelfSize: SHELF_DEFAULT,
	homeLandingTab: 'home' as HomeLandingTab,
	homeDensity: 'grid' as HomeDensity,
	/** Per-section density OVERRIDE map (HOME-02 / D-07). Empty = every section uses the
	 *  caller-supplied global default (the home page passes 'list' for list-by-default). A
	 *  per-section entry flips just that section; resolved via resolveSectionDensity. */
	homeSectionDensity: {} as Partial<Record<HomeSectionId, HomeDensity>>,
	homeShowSearchPill: true,
	homeShowRandomize: true,
	// 39-D-25 locked 'auto' region + no extra regions + the 8-genre set. quick-260925-vtg
	// supersedes those three by explicit user request (the user's exported settings): region
	// 'hk', extra ['us'], genres = all 11 (sourced from home-layout.ts so the two never drift).
	// A persisted 'auto' is still honoured by load() and resolved at render by resolveChartRegion.
	homeChartRegion: 'hk' as 'auto' | ChartRegion,
	homeExtraRegions: ['us'] as string[],
	homeChartGenres: [...DEFAULT_CHART_GENRES] as string[],
	/** 39-D-40: the persisted home-layout version. A fresh install / reset is already on the chart
	 *  layout, so it starts at the current version and never runs the migration. */
	homeLayoutVersion: HOME_LAYOUT_VERSION
} as const;

/** All groups in one place — used to drive the reset-group helpers. */
export const DEFAULTS = {
	general: GENERAL_DEFAULTS,
	appearance: APPEARANCE_DEFAULTS,
	translation: TRANSLATION_DEFAULTS,
	playback: PLAYBACK_DEFAULTS,
	upnext: UPNEXT_DEFAULTS,
	home: HOME_DEFAULTS
} as const;

export type DefaultsGroup = keyof typeof DEFAULTS;
