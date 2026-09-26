// name-rescue — English / romanized name → Chinese name lookup for Chinese songs (quick-260925-wa7).
//
// Shelves, radio and charts often carry the LABEL's English name for a Chinese song ("Coral Sea —
// Jay Chou" is 珊瑚海 — 周杰倫). The CN catalogs index the Chinese name, so an English query does not
// miss — it returns junk (a piano cover, a DJ remix, an unrelated same-title song) and resolveStub
// plays the best of it. resolveStub (discovery.ts) calls lookupChineseName ONLY when a CJK-free query
// resolved to nothing or to a WEAK best (`!isStrongMatch`), then re-searches once with the Chinese
// names.
//
// This module holds the PURE predicates + pairing rules + the bounded localStorage cache; the
// never-throw fetch orchestrator sits at the bottom. No runes, no `$app/*` — node-testable.
import { detectLang } from '$lib/i18n/detect';
import { matchKey, norm } from '$lib/services/match-key';

export interface ZhName {
	artist: string;
	title: string;
}

/** Any kana / hangul / Han in `s` — reuses the shared script classifier ('en' = no CJK at all). */
export function hasCjk(s: string): boolean {
	return detectLang(s) !== 'en';
}

/**
 * Normalized equality, or containment when the SHORTER side is ≥ 3 chars. quick-260925-wa7: the ≥ 3
 * floor is score-match's `length >= 2` substring guard raised by one, so a 2-char Latin token never
 * containment-matches (equality still covers it).
 */
export function componentMatches(a: string, b: string): boolean {
	const na = norm(a);
	const nb = norm(b);
	if (!na || !nb) return false;
	if (na === nb) return true;
	return Math.min(na.length, nb.length) >= 3 && (na.includes(nb) || nb.includes(na));
}

/**
 * quick-260925-wa7 — does `cand` really look like the song `query` asked for (title AND artist)?
 * Thresholded on purpose, unlike scoreMatch (which only ranks, D-03): resolveStub spends rescue
 * calls only when this is false for a CJK-free query.
 * ponytail: plain normalized containment, no fuzzy distance — upgrade to a token Jaccard if a real
 * false-weak shows up.
 */
export function isStrongMatch(query: ZhName, cand: ZhName): boolean {
	return componentMatches(query.title, cand.title) && componentMatches(query.artist, cand.artist);
}

/**
 * Strip decoration a CN catalog does not index: (…)/（…）/[…]/【…】 groups, a trailing ` - EP` /
 * ` - Single`, a `feat.`/`ft.` suffix. A generic ` - <text>` is KEPT — YTM's bilingual
 * `再愛你 - Zai Ai Ni` is data (quick-260925-wa7).
 */
export function cleanTitle(s: string): string {
	return (s || '')
		.replace(/[（(【\[].*?[)）\]】]/g, ' ')
		.replace(/\s+(?:-\s*)?(?:feat|ft)\.\s.*$/i, ' ')
		.replace(/\s+-\s+(?:EP|Single)\s*$/i, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** A candidate Chinese pair, or null when it gives the re-search nothing new/usable. */
function zhCandidate(query: ZhName, artist: string, title: string): ZhName | null {
	const t = cleanTitle(title);
	const a = artist.trim();
	if (!t || !a) return null;
	if (!hasCjk(a) && !hasCjk(t)) return null;
	if (matchKey(a, t) === matchKey(query.artist, query.title)) return null;
	return { artist: a, title: t };
}

/** The slice of an InnerTube search row the pairing reads (structurally satisfied by `Track`). */
export interface YtmRow {
	songid: string;
	title: string;
	artist: string;
}

/**
 * quick-260925-wa7 stage 1 — join YTM hl=en and hl=zh-TW rows by videoId (songid). Accept an en row
 * only with ENGLISH EVIDENCE (its title contains the query title — YTM labels often ship bilingual
 * `再愛你 - Zai Ai Ni` titles) whose zh partner carries CJK and differs from the query. Pass 1 also
 * requires the en artist to match; pass 2 drops that (a CJK en-artist like `Mojito / 周杰倫` is
 * legitimate). Returns the zh-TW artist + cleaned title.
 */
export function pairYtmRows(enRows: YtmRow[], zhRows: YtmRow[], query: ZhName): ZhName | null {
	const qt = norm(query.title);
	if (!qt) return null;
	const zhById = new Map<string, YtmRow>();
	for (const z of zhRows) if (z?.songid && !zhById.has(z.songid)) zhById.set(z.songid, z);
	for (const requireArtist of [true, false]) {
		for (const r of enRows) {
			const z = r?.songid ? zhById.get(r.songid) : undefined;
			if (!z || !norm(r.title).includes(qt)) continue;
			if (requireArtist && !componentMatches(r.artist, query.artist)) continue;
			const out = zhCandidate(query, z.artist ?? '', z.title ?? '');
			if (out) return out;
		}
	}
	return null;
}

/** Untrusted iTunes Search/Lookup result row. */
export interface ItunesRow {
	trackId?: unknown;
	trackName?: unknown;
	artistName?: unknown;
}

function itunesId(v: unknown): number | null {
	const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
	return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

/** Positive-integer trackIds of a result list, in order (bad rows skipped). */
export function itunesIds(rows: ItunesRow[]): number[] {
	const ids: number[] = [];
	for (const r of rows ?? []) {
		const id = itunesId(r?.trackId);
		if (id !== null && !ids.includes(id)) ids.push(id);
	}
	return ids;
}

/**
 * quick-260925-wa7 stage 2 — iTunes HK↔US cross-store pairing by trackId. Accept an id only when the
 * US side's title AND artist match the query (the label's English names) and the HK side carries CJK
 * and differs from the query. Returns the HK artist + cleaned title. Untrusted rows: a non-positive-
 * integer trackId or a missing/non-string name is skipped, never thrown on.
 */
export function pairItunes(
	query: ZhName,
	hkSearch: ItunesRow[],
	usSearch: ItunesRow[],
	hkLookup: ItunesRow[],
	usLookup: ItunesRow[]
): ZhName | null {
	type Side = { t: string; a: string };
	const byId = new Map<number, { hk?: Side; us?: Side }>();
	const fill = (rows: ItunesRow[], store: 'hk' | 'us') => {
		for (const r of rows ?? []) {
			const id = itunesId(r?.trackId);
			const t = r?.trackName;
			const a = r?.artistName;
			if (id === null || typeof t !== 'string' || !t || typeof a !== 'string' || !a) continue;
			const e = byId.get(id) ?? {};
			if (!e[store]) e[store] = { t, a };
			byId.set(id, e);
		}
	};
	fill(hkSearch, 'hk');
	fill(hkLookup, 'hk');
	fill(usSearch, 'us');
	fill(usLookup, 'us');
	for (const id of [...itunesIds(hkSearch), ...itunesIds(usSearch)]) {
		const e = byId.get(id);
		if (!e?.hk || !e.us) continue;
		if (!componentMatches(e.us.t, query.title) || !componentMatches(e.us.a, query.artist)) continue;
		const out = zhCandidate(query, e.hk.a, e.hk.t);
		if (out) return out;
	}
	return null;
}

// ---- Outcome cache (quick-260925-wa7) --------------------------------------------------------
// One flat JSON record keyed by matchKey(artist, title): a hit lives 30 d, a miss 1 d, so a shelf
// re-tap costs zero lookups. Read-side TTL with no delete-on-read and a write-side oldest-first cap
// (both mirror cover-cache.ts). T-wa7-03: the store is user-writable, but a value is only ever used
// as the TEXT of a search query to our own /api/* (no HTML/URL/src sink), so shape + length guards
// suffice.
export const NAME_RESCUE_KEY = 'openmusic:name-rescue:v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const HIT_TTL_MS = 30 * DAY_MS;
const MISS_TTL_MS = DAY_MS;
const MAX_ENTRIES = 500;
const MAX_NAME_LEN = 200;

type CacheEntry = { a: string; t: string; at: number } | { miss: true; at: number };

function loadRecord(): Record<string, unknown> {
	try {
		const raw = localStorage.getItem(NAME_RESCUE_KEY);
		const rec: unknown = raw ? JSON.parse(raw) : null;
		return rec && typeof rec === 'object' && !Array.isArray(rec)
			? (rec as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

const validName = (v: unknown): v is string =>
	typeof v === 'string' && v.length > 0 && v.length <= MAX_NAME_LEN;

export function readRescueCache(artist: string, title: string): ZhName | 'miss' | null {
	if (typeof localStorage === 'undefined') return null;
	const rec = loadRecord();
	const key = matchKey(artist, title);
	if (!Object.prototype.hasOwnProperty.call(rec, key)) return null;
	const e = rec[key] as Partial<{ a: unknown; t: unknown; at: unknown; miss: unknown }> | null;
	if (!e || typeof e !== 'object') return null;
	if (typeof e.at !== 'number' || !Number.isFinite(e.at)) return null;
	const age = Date.now() - e.at;
	if (e.miss === true) return age > MISS_TTL_MS ? null : 'miss';
	if (!validName(e.a) || !validName(e.t)) return null;
	return age > HIT_TTL_MS ? null : { artist: e.a, title: e.t };
}

export function writeRescueCache(artist: string, title: string, value: ZhName | null): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const rec = loadRecord();
		const key = matchKey(artist, title);
		const at = Date.now();
		const entry: CacheEntry = value ? { a: value.artist, t: value.title, at } : { miss: true, at };
		delete rec[key]; // re-insert at the end so equal timestamps still evict oldest-write-first
		rec[key] = entry;
		const keys = Object.keys(rec);
		if (keys.length > MAX_ENTRIES) {
			const ageOf = (k: string) => {
				const v = (rec[k] as { at?: unknown } | null)?.at;
				return typeof v === 'number' && Number.isFinite(v) ? v : -Infinity;
			};
			const oldest = keys.sort((x, y) => ageOf(x) - ageOf(y)).slice(0, keys.length - MAX_ENTRIES);
			for (const k of oldest) delete rec[k];
		}
		localStorage.setItem(NAME_RESCUE_KEY, JSON.stringify(rec));
	} catch {
		// quota / private mode — the rescue still works, it just is not remembered.
	}
}
