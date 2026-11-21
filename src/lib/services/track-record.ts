// track-record — the ONE canonical record per song (quick-261121-canon, brief §2.2).
//
// Doctrine: singleton + shared + unified. Before this module a song existed as up to ~16
// unrelated per-source Track instances, and its cover/title/artist/lyrics diverged per
// surface; pins were per-uid, so a correction fixed one instance and no other. The
// TrackRecord is the single truth: canonical key (versionedMatchKey — a live cut keeps its
// own record, per the crowd-pick precedent), canonical title/artist, ALL gate-passing cover
// candidates with provenance, the record-keyed pins, the known instance uids, and a
// downloaded flag. Persisted FOREVER via record-persist (no TTL on a positive resolution;
// Hector 2026-11-21: "cache forever and offline ok") — a downloaded song's record is
// eviction-protected, so offline play renders the same cover/lyrics as online.
//
// Pure `.ts` (the cover-cache posture): node-testable, never throws, SSR-safe. The network
// resolver is services/track-resolve.ts; the reactive wrapper is stores/records.svelte.ts.

import { matchKey, versionedMatchKey } from './dedupe';
import { hasHttpsScheme } from './url-safety';
import { createForeverStore, ensurePersistentStorage } from './record-persist';
import { getPinnedCover } from './cover-cache';
import { isOfficialTitle } from './song-variant';

/** One gate-passing cover candidate, provenance-stamped (WHY NOT ALL: keep them all). */
export interface TrackCoverCandidate {
	url: string;
	/** 'chain' | 'instance' | 'cache' | 'crowd' | 'pin' | 'download' | … */
	source: string;
	at: number;
}

/**
 * One playable provider variant of the song, living INSIDE the record (entity
 * resolution → golden record, Hector 2026-11-21): variants are never rendered as
 * duplicate rows — surfaces render the record's ONE default variant, and the full
 * set is enumerated only inside the sources modal (VersionPicker).
 */
export interface TrackVariant {
	uid: string;
	/** The instance's source id ('qq', 'netease', 'bilibili', …) — provenance. */
	source: string;
	/** The variant's own title as its provider named it (officialness is judged on it). */
	title: string;
	/** True when the variant is the official/original recording (正版原版) per the
	 * ONE existing gate, song-variant's isOfficialTitle — never re-derived here. */
	official: boolean;
	at: number;
}

export interface TrackRecord {
	/** Canonical key: versionedMatchKey(artist, title). */
	key: string;
	/** → ArtistRecord key (matchKey(artist, '')). */
	artistKey: string;
	title: string;
	artist: string;
	album: string | null;
	cover: {
		/** What renders: pin ?? crowd candidate ?? first candidate (resolver precedence). */
		chosen: string | null;
		candidates: TrackCoverCandidate[];
		/** The user's explicit pick, keyed by THIS RECORD — not by one instance's uid. */
		pin: string | null;
	};
	lyrics: {
		/** The instance/variant Now Playing renders for this song. */
		chosenRef: { uid: string; variant: string } | null;
		/** The uid whose pinned lyrics apply to EVERY instance of this song. */
		pinUid: string | null;
	};
	/** Uids known to be this song (from variants/dedupe/resolve hints). */
	instances: string[];
	/** ALL known provider variants of this song, in first-seen order (golden record:
	 * every variant lives inside the record as a selectable source — never a row). */
	variants: TrackVariant[];
	/** The user's pinned variant uid — beats the official default thereafter
	 * (precedence: pin > official/original > auto). */
	variantPinUid: string | null;
	/** True once the song is downloaded: the record travels with the download (protected). */
	downloaded: boolean;
	resolvedAt: number;
	version: number;
}

const STORE_KEY = 'openmusic:track-records:v1';

const store = createForeverStore<TrackRecord>(STORE_KEY, {
	// User intent and offline property are never quota-eviction victims.
	isProtected: (r) =>
		r.cover.pin !== null || r.lyrics.pinUid !== null || r.downloaded || r.variantPinUid !== null,
	stampOf: (r) => r.resolvedAt
});

/** The canonical song key (version-aware — "(Live)" is a different record from the studio cut). */
export function trackRecordKey(artist: string, title: string): string {
	return versionedMatchKey(artist ?? '', title ?? '');
}

function blankRecord(artist: string, title: string): TrackRecord {
	return {
		key: trackRecordKey(artist, title),
		artistKey: matchKey(artist ?? '', ''),
		title: (title ?? '').trim(),
		artist: (artist ?? '').trim(),
		album: null,
		cover: { chosen: null, candidates: [], pin: null },
		lyrics: { chosenRef: null, pinUid: null },
		instances: [],
		variants: [],
		variantPinUid: null,
		downloaded: false,
		resolvedAt: 0,
		version: 0
	};
}

/** chosen = pin ?? crowd candidate ?? first candidate (candidates sit in precedence order). */
function computeChosen(cover: TrackRecord['cover']): string | null {
	if (cover.pin) return cover.pin;
	const crowd = cover.candidates.find((c) => c.source === 'crowd');
	if (crowd) return crowd.url;
	return cover.candidates.length ? cover.candidates[0].url : null;
}

/**
 * Merge incoming candidates into an existing list: dedupe by URL (first provenance wins —
 * the resolver feeds in precedence order), preserve order, never mutate either input
 * (the enrich-merge determinism posture; brief test 6).
 */
export function mergeTrackCandidates(
	existing: TrackCoverCandidate[],
	incoming: TrackCoverCandidate[]
): TrackCoverCandidate[] {
	const seen = new Set(existing.map((c) => c.url));
	const out = [...existing];
	for (const c of incoming) {
		if (!c.url || seen.has(c.url)) continue;
		seen.add(c.url);
		out.push({ ...c });
	}
	return out;
}

function writeRecord(rec: TrackRecord): void {
	ensurePersistentStorage();
	const all = store.read();
	all[rec.key] = rec;
	store.write(all);
}

/** The record for a song, or null when never resolved. Pure read, never throws. */
export function getTrackRecord(artist: string, title: string): TrackRecord | null {
	return store.read()[trackRecordKey(artist, title)] ?? null;
}

/**
 * Get the song's record, creating (and persisting) a blank one seeded from the hint when
 * absent. Used by migration-on-read and by the write paths that must attach to something.
 */
export function ensureTrackRecord(
	artist: string,
	title: string,
	hint: { album?: string | null; uid?: string } = {}
): TrackRecord {
	const existing = getTrackRecord(artist, title);
	if (existing) return existing;
	const rec = blankRecord(artist, title);
	if (hint.album?.trim()) rec.album = hint.album.trim();
	if (hint.uid) rec.instances = [hint.uid];
	rec.resolvedAt = Date.now();
	rec.version = 1;
	writeRecord(rec);
	return rec;
}

/**
 * Merge resolved cover candidates into the record (the resolver's write seam): candidates
 * join in precedence order, chosen recomputes (pin > crowd > auto), instances/album update,
 * and the record persists forever. Non-https candidates are refused (the value is painted
 * as an `<img src>`). Returns the updated record. Never throws.
 */
export function recordTrackCoverCandidates(
	artist: string,
	title: string,
	candidates: { url: string; source: string }[],
	hint: { album?: string | null; uid?: string } = {}
): TrackRecord {
	const rec = ensureTrackRecord(artist, title, hint);
	const clean = candidates
		.map((c) => ({ url: (c.url ?? '').trim(), source: c.source, at: Date.now() }))
		.filter((c) => hasHttpsScheme(c.url));
	rec.cover = { ...rec.cover, candidates: mergeTrackCandidates(rec.cover.candidates, clean) };
	rec.cover.chosen = computeChosen(rec.cover);
	if (hint.album?.trim()) rec.album = hint.album.trim();
	if (hint.uid && !rec.instances.includes(hint.uid)) rec.instances = [...rec.instances, hint.uid];
	rec.resolvedAt = Date.now();
	rec.version += 1;
	writeRecord(rec);
	return rec;
}

/**
 * Pin (or, with null, unpin) the song's cover at the RECORD level — one pin for every
 * instance of the song, on every surface. The pin also joins the candidates so unpinning
 * falls back to it. Never throws.
 */
export function pinTrackCover(artist: string, title: string, url: string | null): TrackRecord {
	const rec = ensureTrackRecord(artist, title);
	const clean = (url ?? '').trim();
	rec.cover = {
		...rec.cover,
		pin: clean && hasHttpsScheme(clean) ? clean : null,
		candidates:
			clean && hasHttpsScheme(clean)
				? mergeTrackCandidates(rec.cover.candidates, [{ url: clean, source: 'pin', at: Date.now() }])
				: rec.cover.candidates
	};
	rec.cover.chosen = computeChosen(rec.cover);
	rec.resolvedAt = Date.now();
	rec.version += 1;
	writeRecord(rec);
	return rec;
}

/**
 * The record's cover pin for a song — WITH the per-uid migration (brief §2.4): when the
 * record has no pin yet but one of its instances carries a legacy per-uid pin, that pin is
 * adopted INTO the record (seeded on read) so the user's old correction becomes canonical
 * for the whole song. `hintUid` is the instance the caller is holding; it is registered as
 * an instance when the record is created by this read. Pure-ish read (may persist the
 * migration), never throws.
 */
export function getTrackCoverPin(artist: string, title: string, hintUid?: string): string | null {
	const rec = getTrackRecord(artist, title);
	if (rec?.cover.pin) return rec.cover.pin;
	// Migration candidates: the record's known instances, then the caller's instance.
	const uids = [...(rec?.instances ?? []), ...(hintUid ? [hintUid] : [])];
	for (const uid of uids) {
		const legacy = getPinnedCover(uid);
		if (legacy) {
			const target = rec ?? ensureTrackRecord(artist, title, { uid: hintUid });
			if (hintUid && !target.instances.includes(hintUid)) {
				target.instances = [...target.instances, hintUid];
			}
			target.cover = {
				...target.cover,
				pin: legacy,
				candidates: mergeTrackCandidates(target.cover.candidates, [
					{ url: legacy, source: 'pin', at: Date.now() }
				])
			};
			target.cover.chosen = computeChosen(target.cover);
			target.resolvedAt = Date.now();
			target.version += 1;
			writeRecord(target);
			return legacy;
		}
	}
	return null;
}

/** Pin the song's lyrics by INSTANCE uid — the pin then applies to every instance (§2.2). */
export function pinTrackLyrics(artist: string, title: string, uid: string | null): TrackRecord {
	const rec = ensureTrackRecord(artist, title);
	rec.lyrics = { ...rec.lyrics, pinUid: uid || null };
	if (uid && !rec.instances.includes(uid)) rec.instances = [...rec.instances, uid];
	rec.resolvedAt = Date.now();
	rec.version += 1;
	writeRecord(rec);
	return rec;
}

/** Set the lyrics ref Now Playing renders for this song (the playing instance/variant). */
export function setTrackLyricsRef(
	artist: string,
	title: string,
	ref: { uid: string; variant: string } | null
): TrackRecord {
	const rec = ensureTrackRecord(artist, title);
	rec.lyrics = { ...rec.lyrics, chosenRef: ref };
	rec.resolvedAt = Date.now();
	rec.version += 1;
	writeRecord(rec);
	return rec;
}

/**
 * Mark the song downloaded: its record now travels with the download — flagged, and
 * eviction-protected forever (record-persist). The downloading instance is registered and
 * becomes the lyrics chosenRef when none is set (the offline copy is the playable one).
 */
export function markTrackDownloaded(artist: string, title: string, uid?: string): TrackRecord {
	const rec = ensureTrackRecord(artist, title, { uid });
	rec.downloaded = true;
	if (uid && !rec.lyrics.chosenRef) rec.lyrics = { ...rec.lyrics, chosenRef: { uid, variant: 'download' } };
	rec.resolvedAt = Date.now();
	rec.version += 1;
	writeRecord(rec);
	return rec;
}

/** The cover every surface should render for the song (pin > crowd > auto), or null. */
export function getTrackChosenCover(artist: string, title: string): string | null {
	return getTrackRecord(artist, title)?.cover.chosen ?? null;
}

/** Drop the song's record entirely (force refresh — exactly this one record). Never throws. */
export function bustTrackRecord(artist: string, title: string): void {
	const key = trackRecordKey(artist, title);
	const all = store.read();
	if (key in all) {
		delete all[key];
		store.write(all);
	}
}

// ---------------------------------------------------------------------------
// Variants — entity resolution → golden record (Hector 2026-11-21 02:06 CST).
// ONE RENDER: a song renders exactly once everywhere; every provider variant
// lives inside this record as a selectable source. DEFAULT PLAY = OFFICIAL/
// ORIGINAL (正版原版): the record's default variant resolves by the precedence
// pin > official > auto (first-seen). The user may switch to any variant in the
// sources modal, and pinning one overrides the default thereafter.
// ---------------------------------------------------------------------------

/** The record's variant list, tolerating records persisted before the field existed. */
function variantsOf(rec: TrackRecord): TrackVariant[] {
	return Array.isArray(rec.variants) ? rec.variants : [];
}

/**
 * Register one provider variant inside the record (dedupe by uid; the variant's
 * officialness is judged ONCE by the existing isOfficialTitle gate on its own
 * title). Also registers the uid as a known instance. Returns the record.
 */
export function recordTrackVariant(
	artist: string,
	title: string,
	variant: { uid: string; source: string; title: string }
): TrackRecord {
	const rec = ensureTrackRecord(artist, title, { uid: variant.uid });
	const variants = variantsOf(rec);
	if (variant.uid && !variants.some((v) => v.uid === variant.uid)) {
		rec.variants = [
			...variants,
			{
				uid: variant.uid,
				source: variant.source ?? '',
				title: variant.title ?? '',
				official: isOfficialTitle(variant.title ?? ''),
				at: Date.now()
			}
		];
		rec.resolvedAt = Date.now();
		rec.version += 1;
		writeRecord(rec);
	}
	return rec;
}

/** Pin (or, with null, unpin) the song's default-play variant at the RECORD level. */
export function pinTrackVariant(artist: string, title: string, uid: string | null): TrackRecord {
	const rec = ensureTrackRecord(artist, title, uid ? { uid } : {});
	rec.variantPinUid = uid || null;
	rec.resolvedAt = Date.now();
	rec.version += 1;
	writeRecord(rec);
	return rec;
}

/** The user's pinned variant uid for the song, or null. */
export function getVariantPin(artist: string, title: string): string | null {
	return getTrackRecord(artist, title)?.variantPinUid ?? null;
}

/**
 * The record's ONE default variant — the only variant a surface renders/plays
 * first. PURE. Precedence (Hector's survivorship rule): the user's pin, then the
 * first OFFICIAL/ORIGINAL variant, then the first-seen variant (auto). A pin
 * naming a not-yet-registered uid still wins (the pin is the user's word; the
 * variant entry may register later), returned as a minimal entry.
 */
export function defaultVariantOf(rec: TrackRecord | null): TrackVariant | null {
	if (!rec) return null;
	const variants = variantsOf(rec);
	if (rec.variantPinUid) {
		return (
			variants.find((v) => v.uid === rec.variantPinUid) ?? {
				uid: rec.variantPinUid,
				source: '',
				title: rec.title,
				official: false,
				at: 0
			}
		);
	}
	return variants.find((v) => v.official) ?? variants[0] ?? null;
}

/** The default variant's uid for a song (pin > official > auto), or null. */
export function getDefaultVariantUid(artist: string, title: string): string | null {
	return defaultVariantOf(getTrackRecord(artist, title))?.uid ?? null;
}

/**
 * ONE RENDER, as a pure list transform: collapse a mixed list of per-source
 * tracks to ONE row per canonical record. The representative is the record's
 * default variant when it is in the group (pin > official > auto), else the
 * first official-titled track, else the first track. Group order = first
 * appearance. Surfaces that list songs run their rows through this (or through
 * the record-aware dedupe) so duplicate-source rows can never render.
 */
export function collapseToCanonicalRows<T extends { artist: string; title: string; uid: string }>(
	tracks: T[]
): T[] {
	const groups = new Map<string, T[]>();
	for (const t of tracks) {
		const key = trackRecordKey(t.artist, t.title);
		const group = groups.get(key);
		if (group) group.push(t);
		else groups.set(key, [t]);
	}
	const out: T[] = [];
	for (const group of groups.values()) {
		const first = group[0];
		const defaultUid = getDefaultVariantUid(first.artist, first.title);
		const rep =
			(defaultUid ? group.find((t) => t.uid === defaultUid) : undefined) ??
			group.find((t) => isOfficialTitle(t.title)) ??
			first;
		out.push(rep);
	}
	return out;
}
