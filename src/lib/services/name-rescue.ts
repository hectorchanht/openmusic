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
import { apiFetch } from '$lib/services/api-base';
import { combinedSignal } from '$lib/services/abort-signal';
import { parseSearchEnvelope } from '$lib/sources/ytmusic';

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
 * `再愛你 - Zai Ai Ni` titles) whose zh partner carries CJK and differs from the query.
 * Pass 1 also requires the en artist to match the query. Pass 2 covers a catalog row whose en artist
 * is already CJK (`Mojito / 周杰倫`), but ONLY when its zh artist is one YTM itself localized from
 * the query artist on some row of the same response (en `Jay Chou` ↔ zh `周杰倫` on an official
 * video). Live-probe finding: a title-only pass 2 accepted uploader covers whose bilingual titles
 * carry the query title (`周杰倫 Jay Chou & 梁心頤 Lara 珊瑚海 Coral Sea 純鋼琴 / 張義 YImuzic`), which
 * then short-circuited the iTunes stage that finds the right answer. Returns the zh-TW artist +
 * cleaned title.
 */
export function pairYtmRows(enRows: YtmRow[], zhRows: YtmRow[], query: ZhName): ZhName | null {
	const qt = norm(query.title);
	if (!qt) return null;
	const zhById = new Map<string, YtmRow>();
	for (const z of zhRows) if (z?.songid && !zhById.has(z.songid)) zhById.set(z.songid, z);
	const pairs: Array<[YtmRow, YtmRow]> = [];
	for (const r of enRows) {
		const z = r?.songid ? zhById.get(r.songid) : undefined;
		if (z) pairs.push([r, z]);
	}
	const localized = new Set<string>();
	for (const [r, z] of pairs) {
		if (componentMatches(r.artist, query.artist) && hasCjk(z.artist ?? '')) localized.add(norm(z.artist));
	}
	for (const pass of [1, 2]) {
		for (const [r, z] of pairs) {
			if (!norm(r.title).includes(qt)) continue;
			const artistOk =
				pass === 1 ? componentMatches(r.artist, query.artist) : localized.has(norm(z.artist ?? ''));
			if (!artistOk) continue;
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
	// quick-260925-x8o: notify AFTER the persist attempt, so a quota failure still repaints the
	// display alias for this session.
	if (value) {
		for (const fn of rescueListeners) {
			try {
				fn(artist, title, value);
			} catch {
				// T-x8o-05: a broken listener never breaks the resolve path or the other listeners.
			}
		}
	}
}

/**
 * quick-260925-x8o — every verified pair, for DISPLAY. Deliberately ignores `at` / HIT_TTL_MS: a
 * verified pair is a fact about the song; the TTL only governs re-lookup, and MAX_ENTRIES (the
 * write-side eviction) still bounds the set. Misses and malformed entries are skipped (T-x8o-01 —
 * the store is user-writable and these values now reach text sinks: rows, document.title, the OS
 * media card, the download filename). Never throws.
 */
export function readRescueHits(): Array<{ key: string; zh: ZhName }> {
	if (typeof localStorage === 'undefined') return [];
	const out: Array<{ key: string; zh: ZhName }> = [];
	try {
		for (const [key, v] of Object.entries(loadRecord())) {
			const e = v as Partial<{ a: unknown; t: unknown; miss: unknown }> | null;
			if (!e || typeof e !== 'object' || e.miss === true) continue;
			if (validName(e.a) && validName(e.t)) out.push({ key, zh: { artist: e.a, title: e.t } });
		}
	} catch {
		// hostile record shape — show originals
	}
	return out;
}

/**
 * quick-260925-x8o — subscribe to verified-pair writes. A hook, not an import: the subscriber is
 * the runes store `names.svelte.ts` (live repaint via its `rev`), and this pure module must never
 * import a store (CLAUDE.md pure/runes split). Returns the unsubscriber.
 */
export type RescueHitListener = (artist: string, title: string, zh: ZhName) => void;
const rescueListeners = new Set<RescueHitListener>();

export function onRescueHit(fn: RescueHitListener): () => void {
	rescueListeners.add(fn);
	return () => rescueListeners.delete(fn);
}

// ---- Orchestrator (quick-260925-wa7) --------------------------------------------------------
// Same deadline as itunes-cover.ts. No caller signal: resolveStub has none, and playStub re-checks
// pendingGen after its single await anyway.
const LOOKUP_TIMEOUT_MS = 6000;
const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';

/** Never-throw GET → parsed JSON, or null on reject / non-OK / non-JSON. */
async function fetchJson(path: string): Promise<unknown> {
	try {
		const res = await apiFetch(path, { signal: combinedSignal(LOOKUP_TIMEOUT_MS) });
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}

function ytmRows(json: unknown, keyword: string): YtmRow[] {
	try {
		return json ? parseSearchEnvelope(json, keyword) : [];
	} catch {
		return []; // shelf-less body → contract-drift throw → nothing to pair
	}
}

function itunesResults(json: unknown): ItunesRow[] {
	const r = (json as { results?: unknown } | null)?.results;
	return Array.isArray(r) ? (r as ItunesRow[]) : [];
}

/**
 * quick-260925-wa7 — the Chinese {artist, title} of an English/romanized song name, or null. First
 * VERIFIED hit wins: stage 1 = our edge YTM search at hl=en + hl=zh-TW joined by videoId; stage 2
 * (only when stage 1 finds nothing) = iTunes HK↔US cross-store by trackId.
 *
 * iTunes is CLIENT-SIDE ONLY (spike 012: the shared Workers egress IP gets 403/429), so this must
 * never move into $lib/proxy/*. It goes through apiFetch — apiUrl passes an absolute https URL
 * through unchanged (32-D-13) — so dedupe, the concurrency cap and the circuit breaker apply.
 *
 * Cost ceiling (T-wa7-04): ≤ 2 YTM + ≤ 4 iTunes GETs per COLD rescue, each 6 s-bounded, only for a
 * weak/miss Latin query; the outcome is cached (hit 30 d, miss 1 d), so a re-tap costs nothing.
 * Never throws; a failed hop counts as empty.
 */
export async function lookupChineseName(artist: string, title: string): Promise<ZhName | null> {
	try {
		const cached = readRescueCache(artist, title);
		if (cached === 'miss') return null;
		if (cached) return cached;
		if (!norm(title)) return null; // nothing to look up (and nothing any pairing could verify)

		const query = { artist, title };
		const term = `${artist} ${title}`;
		const ytm = '/api/ytmusic/search?q=' + encodeURIComponent(term);
		const [en, zh] = await Promise.all([fetchJson(ytm + '&hl=en'), fetchJson(ytm + '&hl=zh-TW')]);
		let found = pairYtmRows(ytmRows(en, term), ytmRows(zh, term), query);

		if (!found) {
			const search = (country: string) =>
				fetchJson(
					`${ITUNES_SEARCH}?${new URLSearchParams({ term, entity: 'song', limit: '3', country })}`
				).then(itunesResults);
			const [hkSearch, usSearch] = await Promise.all([search('hk'), search('us')]);
			// Look each store's ids up in the OTHER store; ids are validated positive integers.
			const lookup = async (ids: number[], country: string) =>
				ids.length
					? itunesResults(await fetchJson(`${ITUNES_LOOKUP}?id=${ids.join(',')}&country=${country}`))
					: [];
			const [hkLookup, usLookup] = await Promise.all([
				lookup(itunesIds(usSearch), 'hk'),
				lookup(itunesIds(hkSearch), 'us')
			]);
			found = pairItunes(query, hkSearch, usSearch, hkLookup, usLookup);
		}

		writeRescueCache(artist, title, found);
		return found;
	} catch {
		return null;
	}
}
