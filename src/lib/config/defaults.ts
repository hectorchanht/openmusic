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
	type ChartRegion,
	type HomeDensity,
	type HomeLandingTab,
	type HomeSectionId
} from '$lib/services/home-layout';
import type { SourceId } from '$lib/sources/types';
import type { LyricsLang, SourceLang, TranslateMode, DefaultQuality, DefaultSource, Theme, ZhScriptSetting, RowAction } from '$lib/stores/settings.svelte';

/** The accent-color hex used when the user hasn't picked one. Pulled out so the General
 *  reset can restore it without importing from settings.svelte.ts (circular). */
export const DEFAULT_ACCENT = '#7c5cff';

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
	 *  quick-260920-kxz REVERSES l9e's "BOTH ON" default. l9e read the request "have these
	 *  buttons" as "have them by default"; the user has now asked for the opposite — a fresh row
	 *  shows neither Like nor Download, and either is switched on from the Song rows editor in
	 *  Settings → Appearance. The capability is unchanged, only its starting position.
	 *  NEITHER ON is safe for exactly the reason l9e already gave below: the ⋮ menu is NOT in this
	 *  list and is unconditional, so every action stays reachable from an empty row.
	 *  WR-10: this literal lives HERE and nowhere else. */
	rowActions: [] as readonly RowAction[]
} as const;

// ---- Translation -----------------------------------------------------------------------
// All per-part targets default OFF (k3y: matches today's installed-app behavior — content is
// never auto-translated unless the user opts in). bioLang defaults 'auto' (bio is the one
// "wants the app language" surface, established in fnp).
export const TRANSLATION_DEFAULTS = {
	lyricsLang: 'auto' as LyricsLang,
	artistLang: 'off' as LyricsLang,
	titleLang: 'off' as LyricsLang,
	lastfmLang: 'off' as LyricsLang,
	bioLang: 'auto' as 'auto' | LyricsLang,
	artistSkip: [] as readonly SourceLang[],
	titleSkip: [] as readonly SourceLang[],
	lyricsSkip: [] as readonly SourceLang[],
	lastfmSkip: [] as readonly SourceLang[],
	translateMode: 'replace' as TranslateMode,
	/** quick-260919-2jo (D-1): the Chinese script lock is OFF by default. "Default only show
	 *  either" reads as wanting it ON, but silently re-scripting every Chinese string for an
	 *  existing user on their next app open is the more surprising outcome — and it would also
	 *  silently change the tags written into files they download. It sits in the same group as
	 *  titleLang / artistLang, which are 'off' by default for the same reason (k3y / f4y).
	 *  WR-10: this literal lives HERE and nowhere else. */
	zhScript: 'off' as ZhScriptSetting,
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
	downloadQuality: 'lossless' as DefaultQuality, // favours quality over speed
	defaultSource: 'auto' as DefaultSource,
	autoExpandOnPlay: false,
	/** quick-260831-k5y: show the resolved track's quality tag (FLAC / 320 / …) on the
	 *  Now-Playing page. OFF by default — it is extra chrome, and the same value is already
	 *  reachable from the song detail sheet (TrackMenu) for anyone who wants it occasionally. */
	showQualityTag: false,
	/** quick-260919-1we (D-7): make the docked mini player show the currently-sung lyric line in
	 *  place of the artist name. OFF by default, for the same reason showQualityTag above is: it
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
	homeHidden: [] as string[],
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
	// 39-D-25: home chart settings. 'auto' region is resolved at render by resolveChartRegion.
	// Extra regions default to none (UI-11: smallest cold fan-out). Genres default to the locked
	// Asian-pop + Western-core set, sourced from home-layout.ts so the two never drift.
	// homeHidden stays [] and there is NO layout-version field here on purpose: both belong to the
	// one-time layout switch (migrateHomeLayout), which must not ship before the chart shelves
	// render: an early hide removes the classic shelves before anything replaces them, and an early
	// version stamp makes anyone who saves in between skip the switch.
	homeChartRegion: 'auto' as 'auto' | ChartRegion,
	homeExtraRegions: [] as string[],
	homeChartGenres: [...DEFAULT_CHART_GENRES] as string[]
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
