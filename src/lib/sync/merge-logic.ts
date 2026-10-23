// quick-261023-syncmerge — merge-not-replace cross-device sync (PURE, node-testable).
//
// Replaces the old whole-key last-write-wins convergence on the sync PULL path: every data
// family present in the remote envelope is UNIONED with the local copy instead of
// overwriting it, so two devices that were used anonymously before signing in keep BOTH
// libraries rather than the last writer's only.
//
// A merge needs a memory for deletes or it resurrects them: every explicit removal records
// a namespaced tombstone in the library blob's `deleted` array, and the merge suppresses
// tombstoned subjects from the union (delete-wins). Re-adding clears the tombstone in the
// owning store — the merge itself NEVER clears a tombstone on liveness, because "the subject
// is live on either side" is indistinguishable between "re-added after the delete" and "a
// stale copy that never saw the delete"; clearing on liveness would make deletes never
// propagate. Known edge (documented, accepted): if device A deletes X and device B re-adds
// X, A's own tombstone still suppresses X on A until A re-adds it too — the two devices
// diverge on X, and converge again the moment A touches X.
//
// Tombstone namespaces (all inside the ONE `deleted: string[]` on the library blob, so the
// tombstones ride the already-synced library key — no new sync key, no server change):
//   u:<uid>   liked song / playlist track removed
//   f:<fold>  favourite artist removed (fold = foldArtistName)
//   p:<id>    whole playlist deleted (track uids are NOT tombstoned — a liked copy of a
//             song from a deleted playlist must survive)
//   h:<uid>   history entry wiped via clear-history
//   q:<fold>  search query removed (fold = trim().toLowerCase())
//
// Downloads + the unavailable marks NEVER travel: they describe this device's files ("real
// and authentic to device files"). slimLibraryForSync strips them on push, and
// mergeLibraryBlobs carries the local ones through untouched on pull.

import {
	BACKUP_FORMAT,
	BACKUP_MAGIC,
	LIBRARY_KEY,
	NAME_TR_PREFIX,
	SETTINGS_KEY,
	type BackupEnvelope
} from '$lib/backup/backup-logic';
import { HISTORY_CAP, HISTORY_KEY } from '$lib/history/history-logic';
import { SEARCH_HISTORY_CAP, SEARCH_HISTORY_KEY } from '$lib/search/search-history-logic';
import { isChineseLine, t2sConvertLineSync } from '$lib/services/zh-convert';

/** quick-261023-syncmerge: tombstone cap — FIFO-pruned, so the deleted set stays bounded. */
export const TOMBSTONE_CAP = 500;

/** Namespace constructors — the store layer calls these; the merge layer matches prefixes. */
export const tombTrack = (uid: string): string => `u:${uid}`;
export const tombFav = (folded: string): string => `f:${folded}`;
export const tombPlaylist = (id: string): string => `p:${id}`;
export const tombHistory = (uid: string): string => `h:${uid}`;
export const tombQuery = (folded: string): string => `q:${folded}`;

/**
 * quick-261023-syncmerge: the favourite-artist fold, byte-identical to the library store's
 * favKey (t2s fold for Chinese, trim+lowercase otherwise; a cold t2s falls back to the raw
 * key — exactly the store's pre-warm behaviour). The store imports this instead of keeping
 * its own copy, so the merge and the store can never drift apart.
 */
export function foldArtistName(name: string): string {
	const k = (name ?? '').trim().toLowerCase();
	return isChineseLine(k) ? (t2sConvertLineSync(k) ?? k) : k;
}

function isStrArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** PURE: union two tombstone lists, FIFO-pruned to TOMBSTONE_CAP. Never mutates. */
export function addTombstones(deleted: string[], keys: string[]): string[] {
	const seen = new Set(deleted);
	const out = [...deleted];
	for (const k of keys) {
		if (typeof k !== 'string' || !k || seen.has(k)) continue;
		seen.add(k);
		out.push(k);
	}
	return out.length > TOMBSTONE_CAP ? out.slice(out.length - TOMBSTONE_CAP) : out;
}

/** PURE: drop tombstones (the store calls this on re-add — "re-add wins"). Never mutates. */
export function clearTombstones(deleted: string[], keys: string[]): string[] {
	if (keys.length === 0) return [...deleted];
	const drop = new Set(keys);
	return deleted.filter((k) => !drop.has(k));
}

/** PURE: read the deleted array off a library-shaped blob; anything else → []. */
export function readDeleted(lib: unknown): string[] {
	if (lib == null || typeof lib !== 'object' || Array.isArray(lib)) return [];
	const d = (lib as Record<string, unknown>).deleted;
	return isStrArray(d) ? [...d] : [];
}

/** PURE: the merged tombstone union of two library blobs, FIFO-capped. */
export function mergeDeletedSets(a: unknown, b: unknown): string[] {
	return addTombstones(readDeleted(a), readDeleted(b));
}

/** Structural minimum the merge needs — the real Track/Playlist types live in runes-land. */
interface SlimTrack {
	uid: string;
	[key: string]: unknown;
}

interface SlimPlaylist {
	id: string;
	[key: string]: unknown;
}

function asRecord(v: unknown): Record<string, unknown> {
	return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asTrackArray(v: unknown): SlimTrack[] {
	if (!Array.isArray(v)) return [];
	const out: SlimTrack[] = [];
	for (const t of v) {
		const r = asRecord(t);
		if (typeof r.uid === 'string' && r.uid) out.push({ ...r, uid: r.uid });
	}
	return out;
}

function asPlaylistArray(v: unknown): SlimPlaylist[] {
	if (!Array.isArray(v)) return [];
	const out: SlimPlaylist[] = [];
	for (const p of v) {
		const r = asRecord(p);
		if (typeof r.id === 'string' && r.id) out.push({ ...r, id: r.id });
	}
	return out;
}

/** PURE: union by uid — local order first, remote-only appended. Never mutates. */
export function unionTracks(local: unknown, remote: unknown): SlimTrack[] {
	const out = asTrackArray(local);
	const seen = new Set(out.map((t) => t.uid));
	for (const t of asTrackArray(remote)) {
		if (!seen.has(t.uid)) {
			seen.add(t.uid);
			out.push(t);
		}
	}
	return out;
}

/**
 * PURE: playlists unioned by id — local order first, remote-only appended; a playlist
 * present on both keeps the LOCAL name (a rename is this device's explicit choice) with
 * its tracks unioned by uid. Never mutates.
 */
export function unionPlaylists(local: unknown, remote: unknown): SlimPlaylist[] {
	const l = asPlaylistArray(local);
	const rmap = new Map(asPlaylistArray(remote).map((p) => [p.id, p]));
	const out: SlimPlaylist[] = [];
	const seen = new Set<string>();
	for (const p of l) {
		seen.add(p.id);
		const r = rmap.get(p.id);
		out.push(
			r ? { ...r, ...p, tracks: unionTracks(p.tracks, r.tracks) } : { ...p }
		);
	}
	for (const [id, p] of rmap) {
		if (!seen.has(id)) out.push({ ...p });
	}
	return out;
}

/** PURE: favourite-artist union, deduped on foldArtistName; local order first. */
export function unionFavArtists(local: unknown, remote: unknown): string[] {
	const asList = (v: unknown): string[] =>
		Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
	const out = asList(local);
	const seen = new Set(out.map(foldArtistName));
	for (const n of asList(remote)) {
		const f = foldArtistName(n);
		if (!f || seen.has(f)) continue;
		seen.add(f);
		out.push(n);
	}
	return out;
}

/**
 * PURE: merge two library blobs (local FULL, remote SLIMMED — the remote never carries
 * downloads/unavailable). Returns the payload to persist:
 *  - liked / playlist tracks: union by uid, then u: tombstones suppress
 *  - playlists: union by id (local name wins), then p: tombstones drop whole playlists
 *  - favArtists: union on foldArtistName, then f: tombstones suppress
 *  - deleted: union of both sides' tombstones, FIFO-capped
 *  - downloads / unavailable: the LOCAL copies carried through VERBATIM — they describe
 *    this device's files and never sync.
 */
export function mergeLibraryBlobs(localFull: unknown, remoteSlimmed: unknown): Record<string, unknown> {
	const L = asRecord(localFull);
	const R = asRecord(remoteSlimmed);
	const deleted = mergeDeletedSets(L, R);
	const tomb = new Set(deleted);
	const trackGone = (uid: string): boolean => tomb.has(`u:${uid}`);

	const liked = unionTracks(L.liked, R.liked).filter((t) => !trackGone(t.uid));
	const playlists = unionPlaylists(L.playlists, R.playlists)
		.filter((p) => !tomb.has(`p:${p.id}`))
		.map((p) => ({ ...p, tracks: asTrackArray(p.tracks).filter((t) => !trackGone(t.uid)) }));
	const favArtists = unionFavArtists(L.favArtists, R.favArtists).filter(
		(n) => !tomb.has(`f:${foldArtistName(n)}`)
	);

	return {
		liked,
		playlists,
		favArtists,
		deleted,
		// quick-261023-syncmerge: device-local, never synced — carried through verbatim.
		downloads: Array.isArray(L.downloads) ? L.downloads : [],
		unavailable: isStrArray(L.unavailable) ? [...L.unavailable] : []
	};
}

/**
 * PURE: history union by uid — local order first, remote-only appended, HISTORY_CAP,
 * h: tombstones suppress (clear-history propagates instead of resurrecting).
 */
export function mergeHistoryEntries(
	local: unknown,
	remote: unknown,
	tombstones: string[]
): Record<string, unknown>[] {
	const asList = (v: unknown): Record<string, unknown>[] => {
		if (!Array.isArray(v)) return [];
		return v.filter(
			(e): e is Record<string, unknown> =>
				e != null && typeof e === 'object' && !Array.isArray(e) && typeof (e as { uid?: unknown }).uid === 'string' && !!((e as { uid: string }).uid)
		);
	};
	const tomb = new Set(tombstones);
	const out = asList(local);
	const seen = new Set(out.map((e) => e.uid as string));
	for (const e of asList(remote)) {
		const uid = e.uid as string;
		if (!seen.has(uid)) {
			seen.add(uid);
			out.push(e);
		}
	}
	return out.filter((e) => !tomb.has(`h:${e.uid as string}`)).slice(0, HISTORY_CAP);
}

/**
 * PURE: search-history union by query (case-insensitive fold) — the fresher ts wins per
 * query, most-recent-first, SEARCH_HISTORY_CAP, q: tombstones suppress.
 */
export function mergeSearchHistoryEntries(
	local: unknown,
	remote: unknown,
	tombstones: string[]
): { query: string; ts: number }[] {
	const fold = (q: string): string => q.trim().toLowerCase();
	const asList = (v: unknown): { query: string; ts: number }[] => {
		if (!Array.isArray(v)) return [];
		const out: { query: string; ts: number }[] = [];
		for (const e of v) {
			const r = asRecord(e);
			if (typeof r.query === 'string' && r.query.trim()) {
				out.push({ query: r.query, ts: typeof r.ts === 'number' ? r.ts : 0 });
			}
		}
		return out;
	};
	const tomb = new Set(tombstones);
	const byFold = new Map<string, { query: string; ts: number }>();
	for (const e of [...asList(local), ...asList(remote)]) {
		const f = fold(e.query);
		const cur = byFold.get(f);
		if (!cur || e.ts > cur.ts) byFold.set(f, e);
	}
	return [...byFold.values()]
		.filter((e) => !tomb.has(`q:${fold(e.query)}`))
		.sort((a, b) => b.ts - a.ts)
		.slice(0, SEARCH_HISTORY_CAP);
}

/** PURE: name-tr union by key; on value conflict the LOCAL value wins. */
export function mergeNameTrRecords(local: unknown, remote: unknown): Record<string, string> {
	const asRec = (v: unknown): Record<string, string> => {
		const r = asRecord(v);
		const out: Record<string, string> = {};
		for (const [k, val] of Object.entries(r)) if (typeof val === 'string') out[k] = val;
		return out;
	};
	return { ...asRec(remote), ...asRec(local) };
}

/**
 * PURE: merge a validated remote envelope into the local envelope for the sync PULL path.
 * `localLibraryRaw` is the FULL local library blob text (the push-side slim strips
 * downloads/unavailable — the merge needs the full blob so those device-local fields
 * survive the round trip); falls back to the slimmed local envelope key when absent.
 *
 * Per family:
 *  - library / history / search-history / name-tr PRESENT remotely → union (tombstones apply)
 *  - any family ABSENT remotely → OMITTED (delete-wins): applyEnvelope's wipe then clears
 *    it locally, preserving the picker's uncheck-deletes-family semantics
 *  - settings PRESENT remotely → the remote blob wins whole (LWW — device prefs, rarely conflict)
 */
export function mergeEnvelopes(
	localEnv: BackupEnvelope,
	remoteEnv: BackupEnvelope,
	localLibraryRaw: string | null
): BackupEnvelope {
	const lk = asRecord(localEnv.keys);
	const rk = asRecord(remoteEnv.keys);
	const out: Record<string, unknown> = {};

	let localLibFull: unknown = null;
	if (localLibraryRaw != null) {
		try {
			localLibFull = JSON.parse(localLibraryRaw);
		} catch {
			localLibFull = null;
		}
	}
	if (localLibFull == null) localLibFull = lk[LIBRARY_KEY] ?? null;

	// h:/q: tombstones live in the library blob's deleted set — one union for every family.
	const tombstones = mergeDeletedSets(localLibFull, rk[LIBRARY_KEY]);

	if (rk[LIBRARY_KEY] !== undefined) out[LIBRARY_KEY] = mergeLibraryBlobs(localLibFull, rk[LIBRARY_KEY]);
	if (rk[HISTORY_KEY] !== undefined)
		out[HISTORY_KEY] = mergeHistoryEntries(lk[HISTORY_KEY], rk[HISTORY_KEY], tombstones);
	if (rk[SEARCH_HISTORY_KEY] !== undefined)
		out[SEARCH_HISTORY_KEY] = mergeSearchHistoryEntries(lk[SEARCH_HISTORY_KEY], rk[SEARCH_HISTORY_KEY], tombstones);
	if (rk[SETTINGS_KEY] !== undefined) out[SETTINGS_KEY] = rk[SETTINGS_KEY];
	for (const [k, v] of Object.entries(rk)) {
		if (k.startsWith(NAME_TR_PREFIX)) out[k] = mergeNameTrRecords(lk[k], v);
	}

	return {
		app: BACKUP_MAGIC,
		format: BACKUP_FORMAT,
		exportedAt: typeof remoteEnv.exportedAt === 'string' ? remoteEnv.exportedAt : '',
		keys: out
	};
}

// ---- quick-261023-syncmerge: pre-merge review preview -----------------------------------
// On first sign-in, when BOTH sides hold differing data, the app shows the diff BEFORE
// anything merges. previewMerge classifies, per family, what a merge WOULD do:
//   incoming   — on the cloud, not on this device (will be added)
//   outgoing   — on this device only (will be uploaded)
//   willDelete — on this device, but tombstoned on the OTHER side (will be removed locally)
// Items tombstoned LOCALLY are excluded from `incoming` — the merge would suppress them,
// so previewing them as incoming would be a lie.

/** One liked / history track row in the preview. */
export interface TrackPreviewItem {
	title: string;
	artist: string;
}

/** One playlist row in the preview. */
export interface PlaylistPreviewItem {
	name: string;
	trackCount: number;
}

/** One past-query row in the preview. */
export interface QueryPreviewItem {
	query: string;
}

export interface PreviewList<T> {
	incoming: T[];
	outgoing: T[];
	willDelete: T[];
}

/** What the first-sync review modal renders. Counts for history; itemized elsewhere. */
export interface SyncPreview {
	library: {
		tracks: PreviewList<TrackPreviewItem>;
		playlists: PreviewList<PlaylistPreviewItem>;
		artists: PreviewList<string>;
	};
	history: { incoming: number; outgoing: number; willDelete: number };
	searches: PreviewList<QueryPreviewItem>;
	nameTr: { key: string; incoming: number; outgoing: number }[];
	settings: { differs: boolean };
}

function trackLabel(t: Record<string, unknown>): TrackPreviewItem {
	return {
		title: typeof t.title === 'string' && t.title ? t.title : typeof t.uid === 'string' ? t.uid : '?',
		artist: typeof t.artist === 'string' ? t.artist : ''
	};
}

/** PURE: the itemized merge preview. Never throws; never mutates its inputs. */
export function previewMerge(localEnv: BackupEnvelope, remoteEnv: BackupEnvelope): SyncPreview {
	const lk = asRecord(localEnv.keys);
	const rk = asRecord(remoteEnv.keys);
	const localDel = new Set(readDeleted(lk[LIBRARY_KEY]));
	const remoteDel = new Set(readDeleted(rk[LIBRARY_KEY]));

	// ---- library: liked tracks ----
	const localLiked = asTrackArray(asRecord(lk[LIBRARY_KEY]).liked);
	const remoteLiked = asTrackArray(asRecord(rk[LIBRARY_KEY]).liked);
	const localUids = new Set(localLiked.map((t) => t.uid));
	const remoteUids = new Set(remoteLiked.map((t) => t.uid));
	const tracks: PreviewList<TrackPreviewItem> = { incoming: [], outgoing: [], willDelete: [] };
	for (const t of remoteLiked) {
		if (!localUids.has(t.uid) && !localDel.has(`u:${t.uid}`)) tracks.incoming.push(trackLabel(t));
	}
	for (const t of localLiked) {
		if (!remoteUids.has(t.uid)) tracks.outgoing.push(trackLabel(t));
		if (remoteDel.has(`u:${t.uid}`)) tracks.willDelete.push(trackLabel(t));
	}

	// ---- library: playlists ----
	const localPls = asPlaylistArray(asRecord(lk[LIBRARY_KEY]).playlists);
	const remotePls = asPlaylistArray(asRecord(rk[LIBRARY_KEY]).playlists);
	const localPids = new Set(localPls.map((p) => p.id));
	const remotePids = new Set(remotePls.map((p) => p.id));
	const plLabel = (p: SlimPlaylist): PlaylistPreviewItem => ({
		name: typeof p.name === 'string' && p.name ? p.name : p.id,
		trackCount: asTrackArray(p.tracks).length
	});
	const playlists: PreviewList<PlaylistPreviewItem> = { incoming: [], outgoing: [], willDelete: [] };
	for (const p of remotePls) {
		if (!localPids.has(p.id) && !localDel.has(`p:${p.id}`)) playlists.incoming.push(plLabel(p));
	}
	for (const p of localPls) {
		if (!remotePids.has(p.id)) playlists.outgoing.push(plLabel(p));
		if (remoteDel.has(`p:${p.id}`)) playlists.willDelete.push(plLabel(p));
	}

	// ---- library: favourite artists ----
	const localArtists = unionFavArtists(asRecord(lk[LIBRARY_KEY]).favArtists, []);
	const remoteArtists = unionFavArtists(asRecord(rk[LIBRARY_KEY]).favArtists, []);
	const localFolds = new Set(localArtists.map(foldArtistName));
	const remoteFolds = new Set(remoteArtists.map(foldArtistName));
	const artists: PreviewList<string> = { incoming: [], outgoing: [], willDelete: [] };
	for (const n of remoteArtists) {
		const f = foldArtistName(n);
		if (!localFolds.has(f) && !localDel.has(`f:${f}`)) artists.incoming.push(n);
	}
	for (const n of localArtists) {
		const f = foldArtistName(n);
		if (!remoteFolds.has(f)) artists.outgoing.push(n);
		if (remoteDel.has(`f:${f}`)) artists.willDelete.push(n);
	}

	// ---- history (counts only — entries have no timestamps to show) ----
	const localHist = mergeHistoryEntries(lk[HISTORY_KEY], [], []);
	const remoteHist = mergeHistoryEntries(rk[HISTORY_KEY], [], []);
	const localHistUids = new Set(localHist.map((e) => e.uid as string));
	const remoteHistUids = new Set(remoteHist.map((e) => e.uid as string));
	let hIn = 0;
	for (const u of remoteHistUids) if (!localHistUids.has(u) && !localDel.has(`h:${u}`)) hIn++;
	let hOut = 0;
	let hDel = 0;
	for (const u of localHistUids) {
		if (!remoteHistUids.has(u)) hOut++;
		if (remoteDel.has(`h:${u}`)) hDel++;
	}

	// ---- search history ----
	const localQ = mergeSearchHistoryEntries(lk[SEARCH_HISTORY_KEY], [], []);
	const remoteQ = mergeSearchHistoryEntries(rk[SEARCH_HISTORY_KEY], [], []);
	const localQFolds = new Set(localQ.map((e) => e.query.trim().toLowerCase()));
	const remoteQFolds = new Set(remoteQ.map((e) => e.query.trim().toLowerCase()));
	const searches: PreviewList<QueryPreviewItem> = { incoming: [], outgoing: [], willDelete: [] };
	for (const e of remoteQ) {
		const f = e.query.trim().toLowerCase();
		if (!localQFolds.has(f) && !localDel.has(`q:${f}`)) searches.incoming.push({ query: e.query });
	}
	for (const e of localQ) {
		const f = e.query.trim().toLowerCase();
		if (!remoteQFolds.has(f)) searches.outgoing.push({ query: e.query });
		if (remoteDel.has(`q:${f}`)) searches.willDelete.push({ query: e.query });
	}

	// ---- name-tr: per-language counts ----
	const nameTr: { key: string; incoming: number; outgoing: number }[] = [];
	for (const k of Object.keys(rk)) {
		if (!k.startsWith(NAME_TR_PREFIX)) continue;
		const l = asRecord(lk[k]);
		const r = asRecord(rk[k]);
		const lkeys = new Set(Object.keys(l).filter((x) => typeof l[x] === 'string'));
		const rkeys = new Set(Object.keys(r).filter((x) => typeof r[x] === 'string'));
		let incoming = 0;
		for (const x of rkeys) if (!lkeys.has(x)) incoming++;
		let outgoing = 0;
		for (const x of lkeys) if (!rkeys.has(x)) outgoing++;
		if (incoming > 0 || outgoing > 0) nameTr.push({ key: k, incoming, outgoing });
	}

	// ---- settings: differs? (a merge keeps the cloud copy — LWW) ----
	const settings = {
		differs:
			JSON.stringify(lk[SETTINGS_KEY] ?? null) !== JSON.stringify(rk[SETTINGS_KEY] ?? null)
	};

	return {
		library: { tracks, playlists, artists },
		history: { incoming: hIn, outgoing: hOut, willDelete: hDel },
		searches,
		nameTr,
		settings
	};
}

/** PURE: does this preview contain ANY difference worth reviewing? */
export function previewHasDiff(p: SyncPreview): boolean {
	const nonEmpty = <T>(l: PreviewList<T>): boolean =>
		l.incoming.length > 0 || l.outgoing.length > 0 || l.willDelete.length > 0;
	return (
		nonEmpty(p.library.tracks) ||
		nonEmpty(p.library.playlists) ||
		nonEmpty(p.library.artists) ||
		p.history.incoming > 0 ||
		p.history.outgoing > 0 ||
		p.history.willDelete > 0 ||
		nonEmpty(p.searches) ||
		p.nameTr.some((n) => n.incoming > 0 || n.outgoing > 0) ||
		p.settings.differs
	);
}
