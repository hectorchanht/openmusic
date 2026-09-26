// App settings (Svelte 5 runes singleton). Standalone — imports nothing from
// player/library to avoid circular deps. Persisted to localStorage, SSR-guarded.
import { browser } from '$app/environment';
import type { SourceId } from '$lib/sources/types';
import { detectAppLang, type AppLang } from '$lib/i18n';
// WR-10: defaults.ts is the SINGLE source of truth — class-field init, load() fallbacks,
// and the reset-group methods all read the same consts (the header in defaults.ts promises
// exactly this). Never duplicate a default literal here.
import {
	DEFAULTS,
	GENERAL_DEFAULTS,
	APPEARANCE_DEFAULTS,
	TRANSLATION_DEFAULTS,
	PLAYBACK_DEFAULTS,
	UPNEXT_DEFAULTS,
	HOME_DEFAULTS,
	type UpnextMode,
	type QueueContext
} from '$lib/config/defaults';
// Pure util (no DOM/browser/store imports) — settings stays a LEAF store. Used by
// applyTheme() to derive --color-primary-hover from the chosen accent (UX-07 root-cause fix).
import { darken } from '$lib/services/color';
import { CHART_REGIONS, HOME_LAYOUT_VERSION, clampShelfSize, migrateDensity, migrateHomeLayout, type ChartRegion, type HomeDensity, type HomeLandingTab, type HomeSectionId } from '$lib/services/home-layout';

export type LyricsLang =
	| 'off'
	// ju0: 'auto' means "follow settings.appLang at translation time" — resolved by
	// names.dn*/lyrics-translate effect via effectiveTarget(). Pre-existing bioLang has
	// always been ('auto' | LyricsLang); ju0 widens this union so all 4 per-part pickers
	// share the same shape (artistLang/titleLang/lyricsLang/lastfmLang).
	| 'auto'
	| 'zh-Hant'
	| 'zh-Hans'
	| 'en'
	| 'ja'
	| 'ko'
	| 'es'
	| 'fr'
	| 'de'
	| 'pt'
	| 'ru'
	| 'ar'
	| 'hi'
	| 'id'
	| 'it'
	| 'vi'
	| 'th'
	| 'tr';
export type TranslateMode = 'replace' | 'below';
export type DefaultQuality = 'auto' | 'lossless' | '320' | '128';
export type DefaultSource = 'auto' | SourceId;
/** UI theme. Light theme overrides surface/text/border tokens via `[data-theme='light']`
 *  in app.css; dark is the default (no data-theme attribute). */
export type Theme = 'dark' | 'light';

const KEY = 'openmusic:settings:v1';
// (WR-10: the accent default lives in defaults.ts as GENERAL_DEFAULTS.accent / DEFAULT_ACCENT —
// the duplicate local const that used to shadow it was removed.)

/** Appearance-scale bounds (percent), shared by the store + the appearance settings UI.
 *  UX-03 / D-11: widened to 50–200. The clamp only WIDENS — previously-persisted 70–160
 *  values stay valid (clampInt re-clamps within the new, looser bounds). */
export const FONT_SCALE_MIN = 50;
export const FONT_SCALE_MAX = 200;
export const COVER_SCALE_MIN = 70;
export const COVER_SCALE_MAX = 150;
export const GRID_COLS_MIN = 2;
export const GRID_COLS_MAX = 5;

/** Coerce a persisted number into a safe integer in [min,max]; non-numbers → def. */
function clampInt(n: unknown, min: number, max: number, def: number): number {
	if (typeof n !== 'number' || !Number.isFinite(n)) return def;
	const f = Math.round(n);
	return f < min ? min : f > max ? max : f;
}

/** Source-language tags usable in a per-part skip whitelist (LyricsLang minus 'off'). */
export type SourceLang =
	| 'zh-Hant'
	| 'zh-Hans'
	| 'en'
	| 'ja'
	| 'ko'
	| 'es'
	| 'fr'
	| 'de'
	| 'pt'
	| 'it'
	| 'ru'
	| 'tr'
	| 'ar'
	| 'hi'
	| 'id'
	| 'vi'
	| 'th';

/**
 * quick-260919-2jo: the Chinese SCRIPT lock — force every displayed Chinese title / artist /
 * album into one script whatever the source returned. Deliberately its own 3-member union and
 * NOT `LyricsLang`: this is a script control, not a translation target, so 'en' / 'ja' / 'ko'
 * must be unrepresentable. The literal is repeated here rather than imported from
 * `$lib/services/zh-convert` (whose `ZhScript` is the 2-member subset) because `settings` is a
 * LEAF store — it imports nothing from the service/store layers, and this keeps it that way.
 */
export type ZhScriptSetting = 'off' | 'zh-Hant' | 'zh-Hans';

/**
 * quick-260919-l9e: the inline buttons a song row can show beside a song, BESIDES the ⋮ menu.
 * The ⋮ is deliberately NOT a member — it always renders, which is what makes "none of them"
 * a safe choice rather than a dead-end row.
 */
export type RowAction = 'like' | 'download';
/** The canonical set AND the default left-to-right order. The settings control iterates this to
 *  show a disabled action in a stable place, and load() validates against it. One source of truth. */
export const ROW_ACTIONS: readonly RowAction[] = ['like', 'download'];

class Settings {
	/** UI-chrome language (separate from content translation; stays en/zh-Hant/zh-Hans). */
	appLang = $state<AppLang>(GENERAL_DEFAULTS.appLang);
	/** Per-part CONTENT translation targets (independent; reuse LyricsLang incl. ja/ko). */
	lyricsLang = $state<LyricsLang>(TRANSLATION_DEFAULTS.lyricsLang);
	/** Translate displayed ARTIST names to this language. */
	artistLang = $state<LyricsLang>(TRANSLATION_DEFAULTS.artistLang);
	/** Translate displayed SONG/ALBUM titles to this language. */
	titleLang = $state<LyricsLang>(TRANSLATION_DEFAULTS.titleLang);
	/** Translate Last.fm info (tags) to this language. */
	lastfmLang = $state<LyricsLang>(TRANSLATION_DEFAULTS.lastfmLang);
	/** Per-part skip whitelists: a text whose detected source ∈ list renders untouched. */
	artistSkip = $state<SourceLang[]>([...TRANSLATION_DEFAULTS.artistSkip]);
	titleSkip = $state<SourceLang[]>([...TRANSLATION_DEFAULTS.titleSkip]);
	lyricsSkip = $state<SourceLang[]>([...TRANSLATION_DEFAULTS.lyricsSkip]);
	lastfmSkip = $state<SourceLang[]>([...TRANSLATION_DEFAULTS.lastfmSkip]);
	/** Per-source enable map (ii6). Empty/absent → each adapter falls back to its
	 *  `enabledByDefault`. Explicit true/false overrides. Lets a user opt INTO 5sing
	 *  (`enabledByDefault: false`) without changing the adapter contract. */
	enabledSources = $state<Partial<Record<SourceId, boolean>>>({ ...PLAYBACK_DEFAULTS.enabledSources });
	/** Global up-next sourcing mode (Phase 17, QUEUE-03). Used when a context has no override
	 *  AND as the fallback for an unknown (`null`) context. Roadmap-locked default 'generated'. */
	upnextMode = $state<UpnextMode>(UPNEXT_DEFAULTS.mode);
	/** Per-context up-next sourcing overrides (D-01). Absent key → falls back to `upnextMode`.
	 *  Persisted (load/save) with a defensive parse mirroring `enabledSources`.
	 *  quick-260831-jtw: seeded from UPNEXT_DEFAULTS.perContext (album → 'same-list') instead of
	 *  the old bare `{}`, so a fresh install and a post-`resetPlayback()` install agree. WR-10:
	 *  the literal still lives only in defaults.ts. */
	upnextPerContext = $state<Partial<Record<Exclude<QueueContext, null>, UpnextMode>>>({
		...UPNEXT_DEFAULTS.perContext
	});
	/** Bio (Last.fm artist bio) target language. `'auto'` = follow appLang; `'off'` = untranslated
	 * (the default since quick-260925-vtg); otherwise an explicit language (quick-260607-fnp;
	 * supersedes the f4y note). */
	bioLang = $state<'auto' | LyricsLang>(TRANSLATION_DEFAULTS.bioLang);
	translateMode = $state<TranslateMode>(TRANSLATION_DEFAULTS.translateMode);
	/** quick-260919-2jo: force displayed Chinese into ONE script. 'off' is a byte-for-byte no-op —
	 *  every `names.dn*` return value is unchanged. Default 'zh-Hant' since quick-260925-vtg. */
	zhScript = $state<ZhScriptSetting>(TRANSLATION_DEFAULTS.zhScript);
	/** Hide the auto-generated translation for lyrics lines that came from a `(...)` clause
	 *  split out of their parent (typically an embedded-translation in the original LRC).
	 *  Off by default → those lines render + translate like any other line. */
	lyricsHideParenTranslation = $state<boolean>(TRANSLATION_DEFAULTS.lyricsHideParenTranslation);
	/** Hide the parens-derived lines themselves (the LRC's embedded clause). When ON, only
	 *  the parent line shows; the parenthesised content is dropped from the rendered list.
	 *  Independent of lyricsHideParenTranslation — combine for "show plain English-only". */
	lyricsHideParenLines = $state<boolean>(TRANSLATION_DEFAULTS.lyricsHideParenLines);

	// --- appearance / per-part sizing (quick-260607-fnp) -----------------------------------
	// Percent scales (100 = today's size). Applied app-wide as CSS custom properties in
	// applyTheme(); `app.css :root` defaults to 1× so SSR / no-JS / returning users see no change.
	/** quick-260920-kxz: GLOBAL text scale, percent. Unlike the per-part scales below it does not
	 *  target one rule — it drives `--fs-app`, which multiplies the ROOT font-size, so every
	 *  rem-sized rule in the app moves at once and the per-part scales multiply on top of it. */
	fontScaleApp = $state<number>(APPEARANCE_DEFAULTS.fontScaleApp);
	/** Song/track TITLE font scale, percent (clamped 70–160). */
	fontScaleTitle = $state<number>(APPEARANCE_DEFAULTS.fontScaleTitle);
	/** ARTIST/subtitle font scale, percent (clamped 70–160). */
	fontScaleArtist = $state<number>(APPEARANCE_DEFAULTS.fontScaleArtist);
	/** LYRICS line font scale, percent (clamped 70–160). */
	fontScaleLyrics = $state<number>(APPEARANCE_DEFAULTS.fontScaleLyrics);
	/** NOW-PLAYING title font scale, percent (clamped 70–160). Separate from fontScaleTitle
	 *  because NP base size is 1.5rem vs ~14px on list pages — same multiplier looks lopsided. */
	fontScaleNpTitle = $state<number>(APPEARANCE_DEFAULTS.fontScaleNpTitle);
	/** NOW-PLAYING artist font scale, percent (clamped 70–160). Separate from fontScaleArtist
	 *  for the same reason — NP artist baseline is 1rem vs ~12px on list pages. */
	fontScaleNpArtist = $state<number>(APPEARANCE_DEFAULTS.fontScaleNpArtist);
	/** Home COVER/tile size scale, percent (clamped 70–150). */
	coverScale = $state<number>(APPEARANCE_DEFAULTS.coverScale);
	/** Home fallback-grid COLUMN count (clamped 2–5; default 3 = today). */
	homeGridCols = $state<number>(APPEARANCE_DEFAULTS.homeGridCols);
	/** quick-260919-l9e: which inline buttons every SongRow shows, IN ORDER. The array IS the
	 *  left-to-right layout — reordering it reorders the buttons — so it is an ordered list, never
	 *  a set. A per-surface `actions` prop overrides it (Up Next must not grow a Download button
	 *  just because this is on); undefined means "follow the user". */
	rowActions = $state<RowAction[]>([...APPEARANCE_DEFAULTS.rowActions]);
	// 32-D-02 (SUPERSEDES D-03's "default to the 128–160k band" rationale): the default is
	// now 'auto' — lossless on a positively-identified unmetered connection, '320' otherwise.
	// Every source ladder (QQ/JOOX/Kuwo) resolves this pref through ONE seam,
	// `sources/quality.ts` effectiveQuality, before any ladder reordering runs; higher and
	// lower tiers remain user-selectable by hand.
	// 32-D-04: the superseded comment's "128–160k" was simply wrong — the '128' rung selects
	// QQ's `song_play_url_standard`, MEASURED at 98 kbps.
	defaultQuality = $state<DefaultQuality>(PLAYBACK_DEFAULTS.defaultQuality);
	/** Quality used when DOWNLOADING (re-resolved at this tier); favours quality over speed. */
	downloadQuality = $state<DefaultQuality>(PLAYBACK_DEFAULTS.downloadQuality);
	defaultSource = $state<DefaultSource>(PLAYBACK_DEFAULTS.defaultSource);
	accent = $state<string>(GENERAL_DEFAULTS.accent);
	reduceMotion = $state<boolean>(GENERAL_DEFAULTS.reduceMotion);
	/** Include the `Song • Artist` title line in the Web Share payload (quick-260808-vzu). */
	shareIncludeTitle = $state<boolean>(GENERAL_DEFAULTS.shareIncludeTitle);
	/** Light/dark theme. Default 'dark' (today's design). applyTheme() flips
	 *  the `data-theme` attribute on <html>. */
	theme = $state<Theme>(GENERAL_DEFAULTS.theme);
	autoExpandOnPlay = $state<boolean>(PLAYBACK_DEFAULTS.autoExpandOnPlay);
	/** quick-260831-k5y: render the resolved track's quality tag on the Now-Playing page.
	 *  Default lives in PLAYBACK_DEFAULTS.showQualityTag (ON since quick-260925-vtg). */
	showQualityTag = $state<boolean>(PLAYBACK_DEFAULTS.showQualityTag);
	/** quick-260919-1we (D-7): the docked Nowbar shows the currently-sung lyric line INSTEAD of the
	 *  artist name. Off by default (PLAYBACK_DEFAULTS.nowbarLyrics) — it replaces information
	 *  already on screen, so it is opt-in. */
	nowbarLyrics = $state<boolean>(PLAYBACK_DEFAULTS.nowbarLyrics);

	// --- home layout (quick-260606-w87) ---------------------------------------------
	// Every default here reproduces TODAY's home exactly, so a returning user with a v1
	// blob that has none of these fields loads with no visible change (non-destructive).
	/** Render order of the four discovery section groups (resolved via resolveSectionOrder). */
	homeSectionOrder = $state<string[]>([...HOME_DEFAULTS.homeSectionOrder]);
	/** Section ids the user has hidden (intersected with the known set at render). */
	homeHidden = $state<string[]>([...HOME_DEFAULTS.homeHidden]);
	/** Selected GENRE-tag subset (ordered — drives genre shelf order). quick-260919-hm1: the
	 *  default is now the FULL pool (every genre on). An existing install keeps its own selection
	 *  — load() only falls back to the default when the persisted value is missing/not an array. */
	homeTags = $state<string[]>([...HOME_DEFAULTS.homeTags]);
	/** Selected COUNTRY subset (ordered — drives country shelf order); default = curated set. */
	homeCountries = $state<string[]>([...HOME_DEFAULTS.homeCountries]);
	/** Main chart region (39-D-25). 'auto' is resolved at render by
	 *  resolveChartRegion(saved, appLang, navigator.language); load() allowlists the value. */
	homeChartRegion = $state<'auto' | ChartRegion>(HOME_DEFAULTS.homeChartRegion);
	/** Extra chart regions (ORDERED — drives the regions shelf order, like homeTags). */
	homeExtraRegions = $state<string[]>([...HOME_DEFAULTS.homeExtraRegions]);
	/** Selected chart genres (ORDERED — drives genre shelf order). An explicit [] is a real choice. */
	homeChartGenres = $state<string[]>([...HOME_DEFAULTS.homeChartGenres]);
	/** Tiles per shelf (clamped to [SHELF_MIN, SHELF_MAX] = [8,24] by clampShelfSize).
	 *  quick-260919-hm1: the DEFAULT is now 24 — the top of that range. An existing install is
	 *  untouched: the load() path below runs clampShelfSize over the PERSISTED number, so a saved
	 *  16 stays 16; only a blob with no homeShelfSize at all picks up the new default. */
	homeShelfSize = $state<number>(HOME_DEFAULTS.homeShelfSize);
	/** Which tab the app opens on at `/`. */
	homeLandingTab = $state<HomeLandingTab>(HOME_DEFAULTS.homeLandingTab);
	/** Home tile density. */
	homeDensity = $state<HomeDensity>(HOME_DEFAULTS.homeDensity);
	/** Per-section density OVERRIDE map (HOME-02 / D-07). Empty/absent → each section uses the
	 *  caller-supplied global default (the home page passes 'list'). A per-section entry flips
	 *  just that section to 'pile'/'grid'. Object-not-array load guard mirrors enabledSources;
	 *  values are migrated per-entry on load (quick-260618-goe). */
	homeSectionDensity = $state<Partial<Record<HomeSectionId, HomeDensity>>>({ ...HOME_DEFAULTS.homeSectionDensity });
	/** Show the search pill on home (default TRUE = today). */
	homeShowSearchPill = $state<boolean>(HOME_DEFAULTS.homeShowSearchPill);
	/** Show the Randomize button on home (default TRUE = today). */
	homeShowRandomize = $state<boolean>(HOME_DEFAULTS.homeShowRandomize);
	/** 39-D-40: persisted home-layout version. A PLAIN field, not $state: the UI never reads it —
	 *  it only gates the one-time layout migration in load() and is written by save(). */
	homeLayoutVersion: number = HOME_DEFAULTS.homeLayoutVersion;

	private loaded = false;

	/** Preferred source for dedupe tie-break (undefined = no preference). */
	get preferredSource(): SourceId | undefined {
		return this.defaultSource === 'auto' ? undefined : this.defaultSource;
	}

	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		let migrated = false;
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const v = JSON.parse(raw) as Partial<Settings>;
				// First-visit-only auto-detect: if no appLang was ever saved, infer it from
				// the browser; otherwise the saved choice always wins. (browser-guarded above.)
				this.appLang = (v.appLang as AppLang) ?? detectAppLang(navigator.language);
				// WR-10: every load() fallback reads the SAME defaults.ts consts as the class-field
				// init and the reset-group methods — never a duplicated literal.
				this.lyricsLang = (v.lyricsLang as LyricsLang) ?? TRANSLATION_DEFAULTS.lyricsLang;
				// Names default to NO translation (quick-260607-f4y): the legacy `nameLang`
				// migration is intentionally dropped so returning users are NOT auto-translated.
				// Only an explicit per-part `artistLang`/`titleLang` opts back in.
				this.artistLang = (v.artistLang as LyricsLang) ?? TRANSLATION_DEFAULTS.artistLang;
				this.titleLang = (v.titleLang as LyricsLang) ?? TRANSLATION_DEFAULTS.titleLang;
				this.lastfmLang = (v.lastfmLang as LyricsLang) ?? TRANSLATION_DEFAULTS.lastfmLang;
				// quick-260925-vtg — an absent key reads defaults.ts, not a literal (WR-10); a
				// persisted `[]` still wins (Array.isArray).
				this.artistSkip = Array.isArray(v.artistSkip)
					? (v.artistSkip as SourceLang[])
					: [...TRANSLATION_DEFAULTS.artistSkip];
				this.titleSkip = Array.isArray(v.titleSkip) ? (v.titleSkip as SourceLang[]) : [...TRANSLATION_DEFAULTS.titleSkip];
				this.lyricsSkip = Array.isArray(v.lyricsSkip)
					? (v.lyricsSkip as SourceLang[])
					: [...TRANSLATION_DEFAULTS.lyricsSkip];
				this.lastfmSkip = Array.isArray(v.lastfmSkip)
					? (v.lastfmSkip as SourceLang[])
					: [...TRANSLATION_DEFAULTS.lastfmSkip];
				this.enabledSources =
					v.enabledSources && typeof v.enabledSources === 'object' && !Array.isArray(v.enabledSources)
						? (v.enabledSources as Partial<Record<SourceId, boolean>>)
						: {};
				// Up-next sourcing (Phase 17). perContext: same object-not-array guard as
				// enabledSources (T-17-01 — malformed → safe defaults); mode validated against the
				// 2-value union, else the global default.
				// quick-260831-jtw: MERGE over UPNEXT_DEFAULTS.perContext rather than replacing it,
				// so an absent key (or a malformed blob) picks up the album → 'same-list' default
				// instead of silently falling through to the global 'generated'.
				// DECISION (quick-260831-jtw) — a persisted per-context value WINS; there is NO
				// migration. A key can only be in here because the user tapped that segment in
				// Settings → Playback (or hit reset), i.e. it is an explicit choice, and silently
				// overwriting it is worse than a rare stale preference the user can change in one
				// tap. A one-shot migration would also need its own persisted version marker —
				// without one it re-applies on every load and makes artist='same-list' impossible
				// to select. So a user who deliberately pinned artist to 'same-list' keeps it.
				this.upnextPerContext = {
					...UPNEXT_DEFAULTS.perContext,
					...(v.upnextPerContext && typeof v.upnextPerContext === 'object' && !Array.isArray(v.upnextPerContext)
						? (v.upnextPerContext as Partial<Record<Exclude<QueueContext, null>, UpnextMode>>)
						: {})
				};
				this.upnextMode =
					v.upnextMode === 'same-list' || v.upnextMode === 'generated'
						? v.upnextMode
						: UPNEXT_DEFAULTS.mode;
				this.bioLang = (v.bioLang as 'auto' | LyricsLang) ?? TRANSLATION_DEFAULTS.bioLang;
				// Appearance scales (fnp): clamp to safe bounds; absent → the defaults.ts values.
				// quick-260920-kxz / T-kxz-01 (tampering): same clamp as every sibling scale. A
				// tampered 0 or 10000 here would make the WHOLE app unreadable (it is the root
				// multiplier), so the bounds are what keeps Settings itself reachable to undo it.
				this.fontScaleApp = clampInt(v.fontScaleApp, FONT_SCALE_MIN, FONT_SCALE_MAX, APPEARANCE_DEFAULTS.fontScaleApp);
				this.fontScaleTitle = clampInt(v.fontScaleTitle, FONT_SCALE_MIN, FONT_SCALE_MAX, APPEARANCE_DEFAULTS.fontScaleTitle);
				this.fontScaleArtist = clampInt(v.fontScaleArtist, FONT_SCALE_MIN, FONT_SCALE_MAX, APPEARANCE_DEFAULTS.fontScaleArtist);
				this.fontScaleLyrics = clampInt(v.fontScaleLyrics, FONT_SCALE_MIN, FONT_SCALE_MAX, APPEARANCE_DEFAULTS.fontScaleLyrics);
				this.fontScaleNpTitle = clampInt(v.fontScaleNpTitle, FONT_SCALE_MIN, FONT_SCALE_MAX, APPEARANCE_DEFAULTS.fontScaleNpTitle);
				this.fontScaleNpArtist = clampInt(v.fontScaleNpArtist, FONT_SCALE_MIN, FONT_SCALE_MAX, APPEARANCE_DEFAULTS.fontScaleNpArtist);
				this.coverScale = clampInt(v.coverScale, COVER_SCALE_MIN, COVER_SCALE_MAX, APPEARANCE_DEFAULTS.coverScale);
				this.homeGridCols = clampInt(v.homeGridCols, GRID_COLS_MIN, GRID_COLS_MAX, APPEARANCE_DEFAULTS.homeGridCols);
				// quick-260919-l9e / T-l9e-01 (tampering): localStorage is user/extension-writable.
				// DELIBERATE ASYMMETRY — do not "fix" this into a single fallback: a valid but EMPTY
				// array SURVIVES (it means "no inline buttons", a legitimate choice — the ⋮ is
				// unconditional so the row can never become unreachable), while a NON-array is
				// replaced by the default. Unknown and duplicate members are DROPPED rather than
				// poisoning the order.
				this.rowActions = Array.isArray(v.rowActions)
					? (v.rowActions as unknown[]).filter(
							(x, i, a): x is RowAction => ROW_ACTIONS.includes(x as RowAction) && a.indexOf(x) === i
						)
					: [...APPEARANCE_DEFAULTS.rowActions];
				this.translateMode = (v.translateMode as TranslateMode) ?? TRANSLATION_DEFAULTS.translateMode;
				// quick-260919-2jo / T-2jo-02: VALIDATED against the union, not cast. A tampered or
				// stale `openmusic:settings:v1` must never hand a garbage token to lockScriptSync's
				// direction dispatch — anything that is not a valid union member falls back to the
				// default (the upnextMode guard's shape, not translateMode's bare cast).
				// quick-260925-vtg — 'off' is a real persisted choice (and the pre-vtg default), so it
				// must pass the guard now that the default is 'zh-Hant'; only absent/garbage falls to
				// the default.
				this.zhScript =
					v.zhScript === 'off' || v.zhScript === 'zh-Hant' || v.zhScript === 'zh-Hans'
						? v.zhScript
						: TRANSLATION_DEFAULTS.zhScript;
				// Booleans: an explicit persisted boolean wins; anything else (absent/tampered)
				// falls back to the defaults.ts const (same single-source rule as above).
				this.lyricsHideParenTranslation =
					typeof v.lyricsHideParenTranslation === 'boolean'
						? v.lyricsHideParenTranslation
						: TRANSLATION_DEFAULTS.lyricsHideParenTranslation;
				this.lyricsHideParenLines =
					typeof v.lyricsHideParenLines === 'boolean'
						? v.lyricsHideParenLines
						: TRANSLATION_DEFAULTS.lyricsHideParenLines;
				this.defaultQuality = (v.defaultQuality as DefaultQuality) ?? PLAYBACK_DEFAULTS.defaultQuality;
				this.downloadQuality = (v.downloadQuality as DefaultQuality) ?? PLAYBACK_DEFAULTS.downloadQuality;
				this.defaultSource = (v.defaultSource as DefaultSource) ?? PLAYBACK_DEFAULTS.defaultSource;
				this.accent = (v.accent as string) ?? GENERAL_DEFAULTS.accent;
				this.reduceMotion =
					typeof v.reduceMotion === 'boolean' ? v.reduceMotion : GENERAL_DEFAULTS.reduceMotion;
				// T-vzu-01: localStorage is tamperable, so only an explicit boolean wins — a truthy
				// string like 'yes' must NOT flip the share payload shape (quick-260808-vzu).
				this.shareIncludeTitle =
					typeof v.shareIncludeTitle === 'boolean' ? v.shareIncludeTitle : GENERAL_DEFAULTS.shareIncludeTitle;
				// Theme is validated against the 2-value union; anything else → the default.
				this.theme = v.theme === 'light' || v.theme === 'dark' ? v.theme : GENERAL_DEFAULTS.theme;
				this.autoExpandOnPlay =
					typeof v.autoExpandOnPlay === 'boolean' ? v.autoExpandOnPlay : PLAYBACK_DEFAULTS.autoExpandOnPlay;
				this.showQualityTag =
					typeof v.showQualityTag === 'boolean' ? v.showQualityTag : PLAYBACK_DEFAULTS.showQualityTag;
				this.nowbarLyrics =
					typeof v.nowbarLyrics === 'boolean' ? v.nowbarLyrics : PLAYBACK_DEFAULTS.nowbarLyrics;
				// --- home layout (w87) — every default reproduces today's home -----------
				// Arrays use an Array.isArray guard → fall back to the today-equivalent
				// default (full order / nothing hidden / full tag+country pool). The pure
				// resolvers (resolveSectionOrder/resolveSubset) do the corrupt-VALUE
				// cleanup at render time; here we only guard the TYPE.
				this.homeSectionOrder = Array.isArray(v.homeSectionOrder)
					? (v.homeSectionOrder as string[])
					: [...HOME_DEFAULTS.homeSectionOrder];
				this.homeHidden = Array.isArray(v.homeHidden)
					? (v.homeHidden as string[])
					: [...HOME_DEFAULTS.homeHidden];
				this.homeTags = Array.isArray(v.homeTags)
					? (v.homeTags as string[])
					: [...HOME_DEFAULTS.homeTags];
				this.homeCountries = Array.isArray(v.homeCountries)
					? (v.homeCountries as string[])
					: [...HOME_DEFAULTS.homeCountries];
				// 39-D-25 / T-39-25: allowlist guard like homeLandingTab. A bare cast like bioLang
				// would let 'cn' or garbage reach the chart fetch planner.
				// quick-260925-vtg — 'auto' (the "Auto (…)" chip) is honoured as a persisted value; it
				// only survived before because the fallback literal happened to be 'auto'. Absent /
				// garbage / 'cn' now fall to the defaults.ts value ('hk', itself allowlisted), not a
				// literal (WR-10).
				this.homeChartRegion =
					v.homeChartRegion === 'auto' ||
					(typeof v.homeChartRegion === 'string' && (CHART_REGIONS as readonly string[]).includes(v.homeChartRegion))
						? (v.homeChartRegion as 'auto' | ChartRegion)
						: HOME_DEFAULTS.homeChartRegion;
				// T-39-26: TYPE guard only. resolveExtraRegions / resolveChartGenres clean the values at
				// render, and an explicit [] genre list is a real choice, so it is kept.
				this.homeExtraRegions = Array.isArray(v.homeExtraRegions)
					? (v.homeExtraRegions as string[])
					: [...HOME_DEFAULTS.homeExtraRegions];
				this.homeChartGenres = Array.isArray(v.homeChartGenres)
					? (v.homeChartGenres as string[])
					: [...HOME_DEFAULTS.homeChartGenres];
				// Shelf size is clamped to [6,24] on load (T-w87-01): a poisoned 999/"x"/
				// negative becomes a safe value, never breaking the fan-out / page size.
				this.homeShelfSize = clampShelfSize(v.homeShelfSize);
				// CR-01 / T-w87-05: validate against the 3-value union (same pattern as theme/
				// upnextMode). A bare cast would let a corrupt persisted string reach the
				// layout's LANDING_PATHS[...] lookup → goto(undefined) → 404 on every launch.
				this.homeLandingTab =
					v.homeLandingTab === 'home' || v.homeLandingTab === 'search' || v.homeLandingTab === 'library'
						? v.homeLandingTab
						: HOME_DEFAULTS.homeLandingTab;
				// quick-260618-goe — non-destructive migration: a returning user's legacy
				// 'compact'/'comfortable' value resolves to the renamed 'list'/'pile' so their
				// layout is unchanged; garbage falls back to the default.
				this.homeDensity = migrateDensity(v.homeDensity) ?? HOME_DEFAULTS.homeDensity;
				// Per-section density map (HOME-02 / D-07): same object-not-array guard as
				// enabledSources (T-23-06 — a malformed Array/non-object → safe {}). Each entry is
				// then migrated through migrateDensity (quick-260618-goe); entries whose value does
				// not migrate (garbage) are DROPPED so the persisted map is cleaned on next save.
				this.homeSectionDensity = (() => {
					const raw = v.homeSectionDensity;
					if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
					const out: Partial<Record<HomeSectionId, HomeDensity>> = {};
					for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
						const next = migrateDensity(val);
						if (next) out[k as HomeSectionId] = next;
					}
					return out;
				})();
				// 39-D-40 — the one-time switch to the chart layout (RESEARCH Pattern 5). Same record as
				// the upnextPerContext block above: a one-shot migration needs its own persisted version
				// marker, or it re-applies on every load. Absent / non-number = 1 (every pre-chart blob);
				// a forged higher number only skips the switch (T-39-35). UI-SPEC §3: silent (no toast or
				// banner), runs once, and only inserts the chart ids at the old chart slot, hides the four
				// classic shelves and carries their density — library sections, relative order, shelf
				// size, landing tab and chrome toggles are untouched. It runs AFTER the type guards and
				// the density coercion above, so migrateHomeLayout only ever sees arrays and valid
				// densities (T-39-37).
				const ver = typeof v.homeLayoutVersion === 'number' ? v.homeLayoutVersion : 1;
				if (ver < HOME_LAYOUT_VERSION) {
					const m = migrateHomeLayout(this.homeSectionOrder, this.homeHidden, this.homeSectionDensity);
					this.homeSectionOrder = m.order;
					this.homeHidden = m.hidden;
					this.homeSectionDensity = m.density;
					migrated = true;
				}
				this.homeLayoutVersion = HOME_LAYOUT_VERSION;
				// Booleans default TRUE via nullish-coalescing — NOT `!!v.x`, which would flip
				// an ABSENT field to false and HIDE the chrome for a returning user (regression).
				this.homeShowSearchPill = v.homeShowSearchPill ?? HOME_DEFAULTS.homeShowSearchPill;
				this.homeShowRandomize = v.homeShowRandomize ?? HOME_DEFAULTS.homeShowRandomize;
			} else {
				// Truly first visit (nothing saved yet): auto-detect UI language once.
				this.appLang = detectAppLang(navigator.language);
			}
		} catch {
			/* corrupt — keep defaults */
		}
		// 39-D-40 / RESEARCH Pitfall 5: the save is REQUIRED. Without a persisted version, a user who
		// re-enables Top hits would have it re-hidden on every load (T-39-36). Only a migrated load
		// writes; a first visit and an already-current blob do not.
		if (migrated) this.save();
		this.applyTheme();
	}

	save() {
		if (!browser) return;
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					appLang: this.appLang,
					lyricsLang: this.lyricsLang,
					// `nameLang` is fully retired (quick-260607-f4y): no longer written and no
					// longer read on load. The per-part fields below are the only name targets.
					artistLang: this.artistLang,
					titleLang: this.titleLang,
					lastfmLang: this.lastfmLang,
					artistSkip: this.artistSkip,
					titleSkip: this.titleSkip,
					lyricsSkip: this.lyricsSkip,
					lastfmSkip: this.lastfmSkip,
					enabledSources: this.enabledSources,
					upnextPerContext: this.upnextPerContext,
					upnextMode: this.upnextMode,
					bioLang: this.bioLang,
					fontScaleApp: this.fontScaleApp,
					fontScaleTitle: this.fontScaleTitle,
					fontScaleArtist: this.fontScaleArtist,
					fontScaleLyrics: this.fontScaleLyrics,
					fontScaleNpTitle: this.fontScaleNpTitle,
					fontScaleNpArtist: this.fontScaleNpArtist,
					coverScale: this.coverScale,
					homeGridCols: this.homeGridCols,
					rowActions: this.rowActions,
					translateMode: this.translateMode,
					zhScript: this.zhScript,
					lyricsHideParenTranslation: this.lyricsHideParenTranslation,
					lyricsHideParenLines: this.lyricsHideParenLines,
					defaultQuality: this.defaultQuality,
					downloadQuality: this.downloadQuality,
					defaultSource: this.defaultSource,
					accent: this.accent,
					reduceMotion: this.reduceMotion,
					shareIncludeTitle: this.shareIncludeTitle,
					theme: this.theme,
					autoExpandOnPlay: this.autoExpandOnPlay,
					showQualityTag: this.showQualityTag,
					nowbarLyrics: this.nowbarLyrics,
					// --- home layout (w87) ---
					homeSectionOrder: this.homeSectionOrder,
					homeHidden: this.homeHidden,
					homeTags: this.homeTags,
					homeCountries: this.homeCountries,
					homeChartRegion: this.homeChartRegion,
					homeExtraRegions: this.homeExtraRegions,
					homeChartGenres: this.homeChartGenres,
					homeShelfSize: this.homeShelfSize,
					homeLandingTab: this.homeLandingTab,
					homeDensity: this.homeDensity,
					homeSectionDensity: this.homeSectionDensity,
					homeShowSearchPill: this.homeShowSearchPill,
					homeShowRandomize: this.homeShowRandomize,
					homeLayoutVersion: this.homeLayoutVersion
				})
			);
		} catch {
			/* quota */
		}
		this.applyTheme();
	}

	/** Apply live-affecting settings to <html>. */
	applyTheme() {
		if (!browser) return;
		const r = document.documentElement;
		r.style.setProperty('--color-primary', this.accent);
		// UX-07 ROOT-CAUSE FIX: the hover var was pinned at #6a48f0 in app.css and never set at
		// runtime, so hover surfaces (buttons/tabs/chips) ignored the chosen accent. Derive it from
		// the accent — ~12% darken matches today's #7c5cff → #6a48f0 relationship (A3).
		r.style.setProperty('--color-primary-hover', darken(this.accent, 0.12));
		// Appearance scales (fnp) — multipliers off the per-rule base sizes. 100% → 1 (no change).
		// quick-260920-kxz: the ROOT multiplier — app.css turns it into
		// `html { font-size: calc(100% * var(--fs-app, 1)) }`, so it moves every rem rule at once
		// and the per-part multipliers below compose on top of the rescaled root.
		r.style.setProperty('--fs-app', String(this.fontScaleApp / 100));
		r.style.setProperty('--fs-title', String(this.fontScaleTitle / 100));
		r.style.setProperty('--fs-artist', String(this.fontScaleArtist / 100));
		r.style.setProperty('--fs-lyrics', String(this.fontScaleLyrics / 100));
		r.style.setProperty('--fs-np-title', String(this.fontScaleNpTitle / 100));
		r.style.setProperty('--fs-np-artist', String(this.fontScaleNpArtist / 100));
		r.style.setProperty('--cover-scale', String(this.coverScale / 100));
		r.style.setProperty('--home-grid-cols', String(this.homeGridCols));
		if (this.reduceMotion) r.dataset.reduceMotion = '1';
		else delete r.dataset.reduceMotion;
		// Light/dark theme: set `data-theme="light"` for the light token set; remove the attr
		// for the default dark theme so `:root` rules apply without any extra specificity.
		if (this.theme === 'light') r.dataset.theme = 'light';
		else delete r.dataset.theme;
	}

	/** Reset the Appearance settings group — theme, accent, reduce-motion, the global + five
	 *  per-part font scales (quick-260920-kxz added fontScaleApp) and cover size (k3y: reads `DEFAULTS.appearance`; theme/accent/reduceMotion read
	 *  `DEFAULTS.general`). Used by the /settings/appearance reset button + Data tab.
	 *
	 *  quick-260919-ebi: reset-group MEMBERSHIP follows the rows, so "Reset this group" keeps
	 *  meaning "reset what this page shows". theme/accent/reduceMotion moved in from resetGeneral()
	 *  and homeGridCols moved out to resetHome(), mirroring the four row moves. The fields
	 *  themselves stay in GENERAL_DEFAULTS / APPEARANCE_DEFAULTS — defaults.ts is untouched, only
	 *  which reset() touches which field changed. */
	resetAppearance() {
		const d = DEFAULTS.appearance;
		const g = DEFAULTS.general;
		this.theme = g.theme;
		this.accent = g.accent;
		this.reduceMotion = g.reduceMotion;
		this.fontScaleApp = d.fontScaleApp;
		this.fontScaleTitle = d.fontScaleTitle;
		this.fontScaleArtist = d.fontScaleArtist;
		this.fontScaleLyrics = d.fontScaleLyrics;
		this.fontScaleNpTitle = d.fontScaleNpTitle;
		this.fontScaleNpArtist = d.fontScaleNpArtist;
		this.coverScale = d.coverScale;
		this.rowActions = [...d.rowActions];
		this.save();
	}

	/** Reset the General settings group (app language + share title).
	 *  k3y; shareIncludeTitle added quick-260808-vzu — miss this touchpoint and "reset" silently
	 *  leaves the setting stuck at the user's old value.
	 *  quick-260919-ebi: accent / reduceMotion / theme left for resetAppearance() with their rows. */
	resetGeneral() {
		const d = DEFAULTS.general;
		this.appLang = d.appLang;
		this.shareIncludeTitle = d.shareIncludeTitle;
		this.save();
	}

	/** Reset the Translation settings (all per-part target langs + skip whitelists + mode). k3y. */
	resetTranslation() {
		const d = DEFAULTS.translation;
		this.lyricsLang = d.lyricsLang;
		this.artistLang = d.artistLang;
		this.titleLang = d.titleLang;
		this.lastfmLang = d.lastfmLang;
		this.bioLang = d.bioLang;
		this.artistSkip = [...d.artistSkip];
		this.titleSkip = [...d.titleSkip];
		this.lyricsSkip = [...d.lyricsSkip];
		this.lastfmSkip = [...d.lastfmSkip];
		this.translateMode = d.translateMode;
		this.zhScript = d.zhScript; // quick-260919-2jo / quick-260925-vtg — back to TRANSLATION_DEFAULTS.zhScript ('zh-Hant')
		this.lyricsHideParenTranslation = d.lyricsHideParenTranslation;
		this.lyricsHideParenLines = d.lyricsHideParenLines;
		this.save();
	}

	/** Reset the Playback settings (quality + source + auto-expand + per-source toggles). k3y. */
	resetPlayback() {
		const d = DEFAULTS.playback;
		this.defaultQuality = d.defaultQuality;
		this.downloadQuality = d.downloadQuality;
		this.defaultSource = d.defaultSource;
		this.autoExpandOnPlay = d.autoExpandOnPlay;
		this.showQualityTag = d.showQualityTag;
		this.nowbarLyrics = d.nowbarLyrics;
		this.enabledSources = { ...d.enabledSources };
		this.upnextPerContext = { ...DEFAULTS.upnext.perContext };
		this.upnextMode = DEFAULTS.upnext.mode;
		this.save();
	}

	/** Resolve the effective up-next sourcing mode for a queue context (Phase 17, QUEUE-03).
	 *  A `null` (unknown) context resolves to the global `upnextMode`; otherwise a per-context
	 *  override wins, falling back to the global default. Settings stays a LEAF store — this
	 *  resolver depends on no other store. */
	effectiveUpnextMode(ctx: QueueContext): UpnextMode {
		// Phase 19 (QUEUE-04 / D-06): an explicit Remix ALWAYS generates, regardless of any
		// global 'same-list' override or per-context setting. This early return makes Remix's
		// force-generate airtight (the 'remix' QueueContext carries no other behaviour).
		if (ctx === 'remix') return 'generated';
		if (!ctx) return this.upnextMode;
		return this.upnextPerContext[ctx] ?? this.upnextMode;
	}

	/** Reset the Home layout settings (section order/hidden + tag/country selection + size +
	 *  grid columns + density + landing tab + chrome toggles). k3y.
	 *  quick-260919-ebi: homeGridCols arrived from resetAppearance() with its slider. The VALUE
	 *  still lives in APPEARANCE_DEFAULTS (defaults.ts untouched) — only the group changed. */
	resetHome() {
		const d = DEFAULTS.home;
		this.homeGridCols = DEFAULTS.appearance.homeGridCols;
		this.homeSectionOrder = [...d.homeSectionOrder];
		this.homeHidden = [...d.homeHidden];
		this.homeTags = [...d.homeTags];
		this.homeCountries = [...d.homeCountries];
		this.homeChartRegion = d.homeChartRegion;
		this.homeExtraRegions = [...d.homeExtraRegions];
		this.homeChartGenres = [...d.homeChartGenres];
		this.homeShelfSize = d.homeShelfSize;
		this.homeLandingTab = d.homeLandingTab;
		this.homeDensity = d.homeDensity;
		this.homeSectionDensity = { ...d.homeSectionDensity };
		this.homeShowSearchPill = d.homeShowSearchPill;
		this.homeShowRandomize = d.homeShowRandomize;
		this.homeLayoutVersion = d.homeLayoutVersion;
		this.save();
	}
}

export const settings = new Settings();

/** Resolve an 'auto' translation target to the current app language (ju0). Off + explicit
 * lang codes pass through. appLang ⊆ LyricsLang so the result is always a usable token for
 * translateLines / shouldTranslate. */
export function effectiveTarget(target: 'auto' | LyricsLang): LyricsLang {
	return target === 'auto' ? (settings.appLang as LyricsLang) : target;
}

export const ACCENT_PRESETS = ['#7c5cff', '#1db954', '#ff0033', '#00c2b8', '#ff8a00', '#ff4d6d'];
