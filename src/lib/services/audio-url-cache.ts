// quick-261119-mcache — PERSISTED RESOLVED-AUDIO-URL CACHE (the replay-cache fix).
//
// WHY THIS EXISTS. A replay only reuses the browser's media cache when <audio> is handed the
// SAME url — the HTTP cache is keyed by url, byte for byte. Kuwo breaks that by construction:
// /api/kuwo/detail is never edge-cached (its urls are signed + expiring) and the resolver chain
// mints a FRESH signed url on every resolve — measured live 2026-11-19, the same track
// (kuwo:493469900) resolved seconds apart returned
//   car-er.kuwo.cn/903bc237…/6affbba9/…/M800002D6AwU0KgO4w.mp3
//   car-er.kuwo.cn/dcac7110…/6affbbbd/…/M800002D6AwU0KgO4w.mp3
// — same file, different signature + timestamp segment. So every replay was a cold download from
// a China CDN with NO Cache-Control (ETag + Last-Modified only → heuristic caching at best),
// which is the measured first-play-stutters / second-play-smooth asymmetry: the "smooth" second
// play was only ever the in-memory track object surviving, never the browser cache.
//
// THE FIX. Persist the resolved url per (uid, quality tier) in localStorage and let the adapter
// serve it inside a conservative TTL instead of re-resolving. A replay — even after a full page
// reload — then attaches the identical url, so the browser media cache and ETag revalidation
// can finally do their job, and the ~2.5 s resolver leg is skipped entirely.
//
// TTL EVIDENCE (measured 2026-11-19/20, see ~/workspace/openmusic-mediacache/audit.md): the
// token's hex segment is the ISSUE time (== resolve time + ~3 s), not an expiry — lifetime
// cannot be parsed out of the url, so it was probed empirically: a url resolved at 03:19:07Z was
// range-probed every 10 min and stayed 206-alive for the full probe window recorded in the
// audit. AUDIO_URL_TTL_MS sits well inside that proven floor with margin, and the two safety
// nets below cover the tail:
//   - reportDeadAudioUrl(url) — SELF-GATING like reportDeadUrl / reportDeadDirectUrl: the
//     player calls it unconditionally on every audio.error; only urls THIS cache served are
//     evicted, so a stale entry self-heals on first failure and is never re-served.
//   - The player's own re-resolve path is untouched: an eviction just means the next play
//     resolves fresh, exactly the pre-cache behaviour.
//
// SCOPE. Kuwo is wired today (the measured rotating case). The cache is deliberately generic —
// keyed by uid + tier, source-agnostic — so another rotating-url adapter can adopt it with a
// get/set pair; sources whose url is already stable or already cached (netease/audius via
// direct-url-cache, qq via the edge resolve cache, ytmusic/bilibili via own-origin proxy urls)
// must NOT be added: a second cache over a working one is how TTLs start disagreeing.
//
// House shape (mirrors cover-cache.ts): one JSON record in localStorage, {u,t} entries,
// read-side TTL, write-side oldest-first cap eviction, every storage touch try/catch — a
// storage failure degrades to "no cache", never a throw into the resolve path.
import { hasHttpsScheme } from './url-safety';

/**
 * 45 minutes — inside the empirically probed kuwo signed-url lifetime floor (audit.md) with
 * margin; deliberately NOT longer: the cost of a too-short TTL is one re-resolve, the cost of a
 * too-long one is a dead url served to <audio> (mitigated, but not free — see header).
 */
export const AUDIO_URL_TTL_MS = 45 * 60 * 1000;

const CACHE_KEY = 'openmusic:audio-url-cache:v1';

/** A replay-heavy session touches a handful of distinct songs; the cap only bounds growth. */
const MAX_ENTRIES = 128;

type AudioUrlEntry = { u: string; t: number };
type AudioUrlRecord = Record<string, AudioUrlEntry>;

/** In-memory mirror, loaded lazily from localStorage on first touch (cover-cache cycle-3 shape). */
let mirror: AudioUrlRecord | null = null;

function load(): AudioUrlRecord {
	if (mirror) return mirror;
	try {
		const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CACHE_KEY) : null;
		const parsed = raw ? (JSON.parse(raw) as unknown) : null;
		mirror =
			parsed && typeof parsed === 'object' && !Array.isArray(parsed)
				? (parsed as AudioUrlRecord)
				: {};
	} catch {
		mirror = {};
	}
	return mirror;
}

function persist(): void {
	try {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(CACHE_KEY, JSON.stringify(load()));
		}
	} catch {
		// Quota / private mode — the in-memory mirror still serves this session.
	}
}

function keyOf(uid: string, quality: string): string {
	return `${uid}|${quality}`;
}

/**
 * The persisted url for (uid, quality tier), or null on miss/expiry. Expired entries are
 * evicted on read (and the eviction persisted) so a later reportDeadAudioUrl scan never trips
 * over them. Tier is part of the key: a lossless url must never serve a 128k caller.
 */
export function getCachedAudioUrl(uid: string, quality: string): string | null {
	const record = load();
	const key = keyOf(uid, quality);
	const entry = record[key];
	if (!entry || typeof entry.u !== 'string' || typeof entry.t !== 'number') return null;
	if (Date.now() - entry.t >= AUDIO_URL_TTL_MS) {
		delete record[key];
		persist();
		return null;
	}
	return entry.u;
}

/**
 * Persist a SUCCESSFUL resolve. Only https urls are stored (the url-safety house rule — a
 * mixed-content url must never be replayed from cache later). Re-writing a key refreshes its
 * TTL and its eviction recency; beyond the cap the oldest-written entries go first.
 */
export function setCachedAudioUrl(uid: string, quality: string, url: string): void {
	if (!url || !hasHttpsScheme(url)) return;
	const record = load();
	const key = keyOf(uid, quality);
	delete record[key];
	record[key] = { u: url, t: Date.now() };
	const keys = Object.keys(record);
	if (keys.length > MAX_ENTRIES) {
		const oldest = keys
			.slice()
			.sort((a, b) => (record[a]?.t ?? 0) - (record[b]?.t ?? 0))
			.slice(0, keys.length - MAX_ENTRIES);
		for (const k of oldest) delete record[k];
	}
	persist();
}

/**
 * URL-based invalidation for the player's audio.error handler. SELF-GATING: a url this cache
 * never served is a silent no-op, so the caller needs no provenance check (the reportDeadUrl /
 * reportDeadDirectUrl contract). Removes every tier entry serving the url.
 */
export function reportDeadAudioUrl(url: string): void {
	if (!url) return;
	const record = load();
	let changed = false;
	for (const key of Object.keys(record)) {
		if (record[key]?.u === url) {
			delete record[key];
			changed = true;
		}
	}
	if (changed) persist();
}

/** TEST-ONLY: drop ONLY the in-memory mirror (storage kept) — simulates a page reload. */
export function __dropAudioUrlMirrorForTest(): void {
	mirror = null;
}

/** TEST-ONLY: drop the mirror + storage so module state cannot leak across tests. */
export function __resetAudioUrlCache(): void {
	mirror = {};
	try {
		if (typeof localStorage !== 'undefined') localStorage.removeItem(CACHE_KEY);
	} catch {
		// no-op — mirror already cleared
	}
}
