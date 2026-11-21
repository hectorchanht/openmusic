// artist-record — ManyToCanon’s artist side. — the ONE canonical record per artist (quick-261121-canon, brief §2.3).
//
// Doctrine: singleton + shared + unified. Before this module an artist's image lived in three
// disconnected pipelines (search page-local, home backfill, artist-page hero) with three
// keyings, and a correction on one surface never reached the others. The ArtistRecord is the
// single truth every surface renders from: canonical key, display name, alias table, and the
// image (pin / candidates / chosen) — persisted FOREVER via record-persist (no TTL on a
// positive resolution; Hector 2026-11-21: "cache forever and offline ok").
//
// Pure `.ts` (the cover-cache posture): node-testable, never throws, SSR-safe. The reactive
// wrapper lives in stores/records.svelte.ts; the network resolver is services/artist-image.ts.

import { matchKey } from './dedupe';
import { hasHttpsScheme } from './url-safety';
import { createForeverStore, ensurePersistentStorage } from './record-persist';

/** One gate-passing artist-image candidate, provenance-stamped (WHY NOT ALL: keep them all). */
export interface ArtistImageCandidate {
	url: string;
	/** Where it came from: 'deezer-artist' | 'deezer-hit' | 'lastfm' | 'backfill' | 'pin' | … */
	source: string;
	at: number;
}

export interface ArtistRecord {
	/** Canonical key: matchKey(name, '') — the existing `artist:` cache family identity. */
	key: string;
	/** The spelling surfaces display (settings.artistLang pick happens at read time in tiles). */
	displayName: string;
	/** Every other spelling seen for this artist (raw source credits, script variants). */
	aliases: string[];
	/** Last.fm / MusicBrainz canonical name when known — seeds the alias table. */
	canonicalName: string | null;
	image: {
		/** What renders: pin ?? first candidate (candidates are stored in resolver precedence). */
		chosen: string | null;
		candidates: ArtistImageCandidate[];
		/** The user's explicit pick — record-keyed, so it fixes EVERY surface at once. */
		pin: string | null;
	};
	resolvedAt: number;
	version: number;
}

const STORE_KEY = 'openmusic:artist-records:v1';
const ALIAS_KEY = 'openmusic:artist-aliases:v1';

const store = createForeverStore<ArtistRecord>(STORE_KEY, {
	// A pinned artist image is user intent — never a quota-eviction victim.
	isProtected: (r) => r.image.pin !== null,
	stampOf: (r) => r.resolvedAt
});
const aliasStore = createForeverStore<string>(ALIAS_KEY, {
	isProtected: () => false,
	stampOf: () => 0
});

/** The canonical artist key for any spelling of a name. */
export function artistRecordKey(name: string): string {
	return matchKey(name ?? '', '');
}

function blankRecord(key: string, displayName: string): ArtistRecord {
	return {
		key,
		displayName,
		aliases: [],
		canonicalName: null,
		image: { chosen: null, candidates: [], pin: null },
		resolvedAt: 0,
		version: 0
	};
}

/** chosen = pin ?? first candidate in precedence order. Pure — inputs never mutated. */
function computeChosen(image: ArtistRecord['image']): string | null {
	if (image.pin) return image.pin;
	return image.candidates.length ? image.candidates[0].url : null;
}

/**
 * Merge incoming candidates into an existing list: dedupe by URL (first provenance wins —
 * the resolver feeds in precedence order, so the earliest writer is the highest-precedence
 * source), preserve order, never mutate either input (the enrich-merge determinism posture).
 */
export function mergeArtistCandidates(
	existing: ArtistImageCandidate[],
	incoming: ArtistImageCandidate[]
): ArtistImageCandidate[] {
	const seen = new Set(existing.map((c) => c.url));
	const out = [...existing];
	for (const c of incoming) {
		if (!c.url || seen.has(c.url)) continue;
		seen.add(c.url);
		out.push({ ...c });
	}
	return out;
}

function writeRecord(rec: ArtistRecord): void {
	ensurePersistentStorage();
	const all = store.read();
	all[rec.key] = rec;
	store.write(all);
}

/** Resolve a spelling to its canonical key via the alias table (identity when unaliased). */
export function canonicalArtistKey(name: string): string {
	const key = artistRecordKey(name);
	const target = aliasStore.read()[key];
	return typeof target === 'string' && target ? target : key;
}

/**
 * The record for any spelling of an artist's name (alias-resolved), or null when the artist
 * has never been resolved. Pure read, never throws.
 */
export function getArtistRecord(name: string): ArtistRecord | null {
	const rec = store.read()[canonicalArtistKey(name)];
	return rec ?? null;
}

/**
 * Register `alias` as another spelling of the artist named `canonicalName`. The alias maps
 * to the canonical record key so every spelling reads/writes ONE record; if the record was
 * created under the alias's key (resolved before the canonical name was known), it MIGRATES
 * to the canonical key so lookups by either spelling land on it. No-op when the alias IS
 * the canonical spelling. Never throws.
 */
export function registerArtistAlias(canonicalName: string, alias: string): void {
	const canonKey = artistRecordKey(canonicalName ?? '');
	const aliasKey = artistRecordKey(alias ?? '');
	if (!canonKey || !aliasKey || canonKey === aliasKey) return;
	const map = aliasStore.read();
	if (map[aliasKey] !== canonKey) {
		map[aliasKey] = canonKey;
		aliasStore.write(map);
	}
	const all = store.read();
	if (all[aliasKey] && !all[canonKey]) {
		all[canonKey] = { ...all[aliasKey], key: canonKey };
		delete all[aliasKey];
		store.write(all);
	}
	// Keep the record's own alias list in step (display/debug surface, deduped).
	const rec = store.read()[canonKey];
	if (rec && !rec.aliases.includes(alias)) {
		rec.aliases = [...rec.aliases, alias];
		writeRecord(rec);
	}
}

/**
 * Record a resolved artist image: merge it into the candidate list (provenance-stamped),
 * refresh display/canonical names when provided, recompute chosen (a pin still wins), and
 * persist forever. Only https URLs are recordable — the value is painted as an `<img src>`.
 * Returns the updated record, or null when the URL was rejected. Never throws.
 */
export function recordArtistImage(
	name: string,
	url: string,
	source: string,
	opts: { displayName?: string; canonicalName?: string | null } = {}
): ArtistRecord | null {
	const clean = (url ?? '').trim();
	if (!hasHttpsScheme(clean)) return null;
	const key = canonicalArtistKey(name);
	const existing = store.read()[key];
	const rec: ArtistRecord = existing ?? blankRecord(key, (name ?? '').trim());
	if (opts.displayName?.trim()) rec.displayName = opts.displayName.trim();
	// The canonical name is RECORDED here; the alias MAPPING is registerArtistAlias's job
	// (it migrates the record), called by whoever learned the canonical name.
	if (opts.canonicalName?.trim()) rec.canonicalName = opts.canonicalName.trim();
	rec.image = {
		...rec.image,
		candidates: mergeArtistCandidates(rec.image.candidates, [
			{ url: clean, source, at: Date.now() }
		])
	};
	rec.image.chosen = computeChosen(rec.image);
	rec.resolvedAt = Date.now();
	rec.version += 1;
	writeRecord(rec);
	return rec;
}

/**
 * Pin (or, with null, unpin) the artist's image at the RECORD level: the pin is what renders
 * on every surface from the next repaint. A pin also joins the candidate list so unpinning
 * falls back to it. Returns the updated record (null when the artist has no record and no
 * pin was given). Never throws.
 */
export function pinArtistImage(name: string, url: string | null): ArtistRecord | null {
	const key = canonicalArtistKey(name);
	const existing = store.read()[key];
	if (!existing && !url) return null;
	const rec: ArtistRecord = existing ?? blankRecord(key, (name ?? '').trim());
	const clean = (url ?? '').trim();
	rec.image = {
		...rec.image,
		pin: clean && hasHttpsScheme(clean) ? clean : null,
		candidates:
			clean && hasHttpsScheme(clean)
				? mergeArtistCandidates(rec.image.candidates, [{ url: clean, source: 'pin', at: Date.now() }])
				: rec.image.candidates
	};
	rec.image.chosen = computeChosen(rec.image);
	rec.resolvedAt = Date.now();
	rec.version += 1;
	writeRecord(rec);
	return rec;
}

/** The record-level pin for an artist (any spelling), or null. Pure read. */
export function getArtistPin(name: string): string | null {
	return getArtistRecord(name)?.image.pin ?? null;
}

/** The image every surface should render for an artist (pin ?? auto), or null. Pure read. */
export function getArtistChosen(name: string): string | null {
	return getArtistRecord(name)?.image.chosen ?? null;
}

/** Drop the artist's record entirely (force refresh — exactly this one record). Never throws. */
export function bustArtistRecord(name: string): void {
	const key = canonicalArtistKey(name);
	const all = store.read();
	if (key in all) {
		delete all[key];
		store.write(all);
	}
}
