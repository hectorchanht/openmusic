// Central settings defaults (quick-260607-k3y). Edit this file to change what new users
// see + what reset-to-default reverts to. The Settings class in stores/settings.svelte.ts
// reads from these consts on class-field init AND on the reset-group methods.
//
// Each group is a plain literal object — `as const` keeps the strings narrow for type
// inference. Adding a new setting: 1) add it here in the right group; 2) reference it in
// the Settings class field initializer; 3) it appears in the matching reset method
// automatically. No new infrastructure needed.

//
// quick-261104-defs: EVERY default is a literal written in this file — no value is pulled in
// from another module. The imports below are TYPE-ONLY, which keeps this file a dependency
// LEAF: home-layout.ts and track-menu-order.ts import their default lists FROM here (one-way),
// so editing a value here is the whole change.

import type { AppLang } from '$lib/i18n';
import type { ChartGenre, ChartRegion, HomeDensity, HomeLandingTab, HomeSectionId } from '$lib/services/home-layout';
import type { MenuActionId } from '$lib/services/track-menu-order';
import type { SourceId } from '$lib/sources/types';
import type { LyricsLang, SourceLang, TranslateMode, DefaultQuality, DefaultSource, Theme, ZhScriptSetting, RowAction } from '$lib/stores/settings.svelte';

/** The accent-color hex used when the user hasn't picked one. Pulled out so the General
 *  reset can restore it without importing from settings.svelte.ts (circular).
 *  tiffany-261020: Tiffany blue (#0abab5, Pantone 1837C) — replaces the purple/teal era.
 *  It is ACCENT_PRESETS[0], so the picker highlights it. */
export const DEFAULT_ACCENT = '#0abab5';

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
	/** quick-260926-m72: where the active lyric line sits in the lyrics pane, percent of the VISIBLE
	 *  band (0 top, 50 centre, 100 bottom). Applies in every sheet state on phone and desktop. */
	lyricsAnchor: 50,
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
	 *  Appearance, and an empty row stays safe because the ⋮ menu opens on long-press (touch) /
	 *  right-click (desktop, quick-261010), so every action stays reachable even with the ⋮ hidden
	 *  via `showRowMenu`. An existing user's persisted `[]` still
	 *  survives load() (Array.isArray guard, asserted in settings-persist).
	 *  WR-10: this literal lives HERE and nowhere else. */
	rowActions: [] as readonly RowAction[],
	/** quick-261010-sar: the song row's trailing ⋮ menu button. Default ON (today's behavior).
	 *  quick-260919-l9e made it unconditional so a row could never become a dead end; that
	 *  rationale is superseded — long-press (touch) and right-click (desktop, quick-261010-rcm)
	 *  both open the same TrackMenu, so hiding the ⋮ loses no action. Toggled from the Song
	 *  rows editor in Settings → Appearance, where the replica's ⋮ IS the switch. */
	showRowMenu: true,
	/** quick-261006-mnu / quick-261021-menu2: the TrackMenu grid, IN ORDER (row-major, 4 columns).
	 *  quick-261104-defs: this list is ALSO the action catalog (track-menu-order.ts MENU_ACTIONS
	 *  reads it), so reorder freely, but deleting an id deletes that action from the menu. */
	trackMenuOrder: [
		// Group 1
		'remix',
		'share',
		'download',
		'like',
		// Group 2
		'versions',
		'changeCover',
		'changeLyrics',
		'goToArtist',
		'goToAlbum',
		// Group 3
		'customize',
		'downloadSource',
		'repeat',
		'addToPlaylist',
		// Group 4
		'detail',
		'sleepTimer',
		'editTags',
		'playNext',
		// The remainder of the catalog, in a stable order.
		'addQueue',
		'startRadio',
		'viewComments',
		'viewRelated',
		'shuffleQueue',
		'clearQueue'
	] as readonly MenuActionId[]
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
	/** quick-261102-srcpill (Hector 2026-11-02): show the current track's SOURCE pill
	 *  (registry adapter label — JOOX, Netease（GD）, …) immediately before the quality
	 *  tag on the Now-Playing page. ON by default: Hector asked for the pill to exist;
	 *  this toggle is the opt-out, mirroring showQualityTag beside it. */
	showSourceTag: true,
	/** quick-261024-vid1: the Now Playing MV video layer (ytmusic tracks). ON by default —
	 *  the layer is inert until the user taps Watch MV, so nobody pays its data cost by
	 *  accident; the toggle exists so it can be banished entirely (rows stop tagging too). */
	videoEnabled: true,
	/** quick-261024-vid1: height cap for the MV layer, shared by Settings and the Now
	 *  Playing quality menu (one setting, two surfaces). */
	videoQuality: 720 as VideoQuality,
	/** quick-260919-1we (D-7): make the docked mini player show the currently-sung lyric line in
	 *  place of the artist name. OFF by default, for the reason k5y originally gave for
	 *  showQualityTag (before quick-260925-vtg flipped it): it
	 *  REPLACES information already on screen with different information, so a user who never opens
	 *  Settings must keep exactly today's Nowbar. */
	nowbarLyrics: false,
	/** Per-source search enable map. quick-261104-defs: every source is listed explicitly — flip
	 *  one to `false` to ship it off. A source missing here falls back to its adapter's own
	 *  `enabledByDefault` (registry.ts getEnabledAdapters). */
	enabledSources: {
		qq: true,
		joox: true,
		netease: true,
		gdnetease: true,
		kuwo: true,
		suyin: true,
		kugou: true,
		migu: true,
		fivesing: true,
		jamendo: true,
		audius: true,
		archive: true,
		ccmixter: true,
		bilibili: true,
		ytmusic: true
	} as Partial<Record<SourceId, boolean>>
} as const;

// ---- Up-next sourcing (Phase 17, QUEUE-03) ---------------------------------------------
// Per-context up-next sourcing. Each context resolves to one of two modes:
//   'same-list'  — snapshot the visible list at tap time (D-03); the exhaust engine still
//                  refills when the snapshot runs out.
//   'generated'  — tapped track + genre-similar generation (D-04); the global default.
// The types live HERE (not in a store) so both player.svelte.ts and settings.svelte.ts can
// import them without a circular dependency — defaults.ts is already imported by both.
export type UpnextMode = 'same-list' | 'generated';
/** quick-261103-tapsplice (Hector 2026-11-03): what a casual song TAP does to the
 * upcoming tail — 'preserve' splices the song into the existing queue (Related-tap
 * behaviour), 'generate' rebuilds the tail from the tapped song. Played history is
 * kept under BOTH; it is not part of this choice. Global, not per-context: a tap is
 * the most frequent gesture in the app and must not need a context matrix. */
export type TapUpnextMode = 'preserve' | 'generate';
/** MV video-layer height caps (quick-261024-vid1) — the quality picker's whole domain. */
export type VideoQuality = 720 | 480 | 360 | 240;
export const VIDEO_QUALITIES: readonly VideoQuality[] = [720, 480, 360, 240];
/** quick-261024-sets4 (Hector): the five country chart packs share ONE up-next setting —
 *  "只需要加一個 pack that apply to all country". `PACK_CONTEXTS` is the family the single
 *  'pack' key governs; a queue still carries its specific pack context, and
 *  `effectiveUpnextMode` resolves exact key → 'pack' family key → global mode. */
export const PACK_CONTEXTS = ['cantopop-2026', 'mandopop-2026', 'kpop-2026', 'jpop-2026', 'western-2026'] as const;
/** A key in the per-context settings map: any queue context, plus the 'pack' family key. */
export type UpnextSettingKey = Exclude<QueueContext, null> | 'pack';
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
	// quick-261006-44u: the track menu's Start-radio action — a similar-songs station seeded
	// from one track. Falls through to the global up-next mode like every non-album context.
	| 'radio'
	// quick-261010-cpop: the free 2026 廣東歌年選 pack page. Falls through to the global
	// up-next mode like the other discovery contexts.
	| 'cantopop-2026'
	// quick-261010-soy3: the other 2026 regional packs.
	| 'mandopop-2026'
	| 'kpop-2026'
	| 'jpop-2026'
	| 'western-2026'
	// quick-261010-disco2: the dynamic discography pack (album-by-album play).
	| 'discography-pack'
	// quick-261010-soy5: the dynamic Songs-of-the-Year pack pages ([year]/[country]).
	| 'songs-of-year'
	| null;
export const UPNEXT_DEFAULTS = {
	/** Global default sourcing mode — roadmap-locked to 'generated'. */
	mode: 'generated' as UpnextMode,
	/**
	 * Per-context overrides — ALBUM, ARTIST, the PACK FAMILY and songs-of-year. They resolve
	 * to 'same-list' (curated, ORDERED collections — users expect "play the rest of the
	 * album / this artist's list", and on a ranked pack tapping #4 means the next song is
	 * #5); EVERY other context resolves to the global `mode` ('generated'), so a tap
	 * anywhere else seeds Up-Next from the tapped song with similar songs
	 * (quick-261024-sets: Hector's app-wide rule — "everywhere seed"; sets3 pinned each pack
	 * individually, sets4 collapses them into the single 'pack' family key on his call).
	 *
	 * History: `artist` was pinned, dropped by quick-260831-jtw (an artist tap treated as an
	 * ordinary "play this song" tap), and is pinned AGAIN by quick-261024-sets on Hector's
	 * explicit call, which supersedes jtw. The artist page installs its ranked list on row
	 * taps (setListQueue(…, 'artist')), so this pin is what makes those taps keep the list
	 * through the fresh-play tail instead of regenerating over it.
	 *
	 * Also quick-260831-jtw: this object is the ACTUAL seed for `settings.upnextPerContext`
	 * (init + load fallback), not just what `resetPlayback()` spreads, and load() merges it
	 * UNDER any persisted per-context choices — so adding the artist pin here reaches existing
	 * installs automatically unless the user deliberately set the artist segment themselves.
	 * Wiring it as the seed also stops the album hot path from firing a full regenerate
	 * (track.getSimilar + a 20-track tail) that `setListQueue(all, 'album')` immediately discards
	 * via the queueGen guard.
	 */
	perContext: { album: 'same-list', artist: 'same-list', pack: 'same-list', 'songs-of-year': 'same-list' } as Partial<Record<UpnextSettingKey, UpnextMode>>,
	/** Casual song-tap behaviour (quick-261103-tapsplice, Hector 2026-11-03): 'preserve'
	 * by his pick — a casual tap must never destroy a queue the user built. */
	tap: 'preserve' as TapUpnextMode
} as const;

// ---- Home layout -----------------------------------------------------------------------
// quick-261104-defs: every list below is a literal. home-layout.ts derives DEFAULT_SECTION_ORDER /
// DEFAULT_HOME_TAGS / DEFAULT_HOME_COUNTRIES / DEFAULT_CHART_GENRES / SHELF_DEFAULT /
// HOME_LAYOUT_VERSION FROM these (one-way), so the two never drift.
export const HOME_DEFAULTS = {
	/** quick-260925-vtg: the user's exported order. MUST stay a permutation of all 18
	 *  HOME_SECTIONS ids (home-layout.test.ts) — reorder, never add/remove. */
	homeSectionOrder: [
		'radio',
		'downloads',
		'liked',
		'chart-songs',
		'new-releases',
		'chart-artists',
		'chart-albums',
		'yt-trending',
		'genres',
		'top-hits',
		'top-artists',
		'regions',
		'tags',
		'countries',
		// quick-261010-soy: "Songs of the Year" sits right after the country shelves.
		'songs-of-year',
		'fav-artists',
		'playlists',
		'history'
	] as HomeSectionId[],
	// 39-D-39: the four classic Deezer/Last.fm shelves (CLASSIC_SECTIONS) stay available but start
	// hidden. A fresh install and Reset-to-default get the chart layout from here; an existing
	// install gets it from the one-time migration in settings.load(), because its persisted
	// `homeHidden: []` is a real value the type guard keeps (this default never reaches it).
	homeHidden: ['top-hits', 'top-artists', 'tags', 'countries'] as string[],
	/** quick-260919-hm1: the WHOLE DISCOVERY_TAGS pool, curated CJK/global mix first. Each tag is
	 *  one `tag.getTopTracks` call on a cold home — fewer tags = fewer requests. */
	homeTags: [
		'cantopop',
		'mandopop',
		'pop',
		'hip-hop',
		'rock',
		'k-pop',
		'electronic',
		'latin',
		'rnb',
		'dance',
		'indie',
		'j-pop',
		'classical',
		'jazz',
		'metal',
		'country',
		'reggae',
		'soul',
		'folk',
		'afrobeats',
		'lo-fi',
		'workout'
	] as string[],
	/** ISO 3166-1 NAMES from DISCOVERY_COUNTRIES, not codes. */
	homeCountries: ['United States', 'Hong Kong', 'Japan', 'Taiwan', 'China', 'South Korea', 'United Kingdom'] as string[],
	/** quick-260919-hm1: items per shelf, clamped to [SHELF_MIN=8, SHELF_MAX=24] on load. 24 is
	 *  under HomeGridPager's MAX_TILES=27, so a full shelf renders whole. */
	homeShelfSize: 24,
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
	// 'hk', extra ['us'], genres = all 11. A persisted 'auto' is still honoured by load() and
	// resolved at render by resolveChartRegion.
	homeChartRegion: 'hk' as 'auto' | ChartRegion,
	homeExtraRegions: ['us'] as string[],
	/** Every CHART_GENRES pool genre, in pool order. */
	homeChartGenres: [
		'cantopop',
		'mandopop',
		'kpop',
		'jpop',
		'hiphop',
		'rock',
		'dance',
		'rnb',
		'electronic',
		'alternative',
		'asian'
	] as ChartGenre[],
	/** 39-D-40: NOT a preference — the persisted home-layout version that gates the one-time chart
	 *  migration in settings.load(). Only bump it alongside a new migrateHomeLayout step. */
	homeLayoutVersion: 2
} as const;

/** All groups in one place — used to drive the reset-group helpers. */
// quick-261020-sync: SYNC_DEFAULTS is DELIBERATELY not a member — the sync-item
// selection is ACCOUNT-level (it follows the user across devices inside the settings
// blob), and no "Reset this group" button may ever touch it.

/**
 * quick-261020-sync: which data families travel in the cross-device sync envelope.
 * One member per envelope key family in $lib/backup/backup-logic.ts (SETTINGS_KEY,
 * LIBRARY_KEY, HISTORY_KEY, SEARCH_HISTORY_KEY, NAME_TR_PREFIX). The sync ENGINE reads
 * this through the settings blob and filters push/pull to the selected set; unchecking
 * a family drops it from the cloud copy on the next push (last-write-wins).
 */
export interface SyncItems {
	settings: boolean;
	library: boolean;
	history: boolean;
	searchHistory: boolean;
	nameTr: boolean;
}

export const SYNC_DEFAULTS = {
	/** Everything syncs on a fresh account — an unchecked item is an explicit choice. */
	items: {
		settings: true,
		library: true,
		history: true,
		searchHistory: true,
		nameTr: true
	} satisfies SyncItems
};

export const DEFAULTS = {
	general: GENERAL_DEFAULTS,
	appearance: APPEARANCE_DEFAULTS,
	translation: TRANSLATION_DEFAULTS,
	playback: PLAYBACK_DEFAULTS,
	upnext: UPNEXT_DEFAULTS,
	home: HOME_DEFAULTS
} as const;

export type DefaultsGroup = keyof typeof DEFAULTS;
