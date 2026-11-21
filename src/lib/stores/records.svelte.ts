// records (reactive) — ManyToCanon's reactive wrapper for the canonical record
// stores (quick-261121-canon, brief §2.2–§2.5). Same "wrap, don't rewrite" split as
// cover-version.svelte.ts: the pure stores stay node-testable; this module adds the ONE
// global record-version signal and the sanctioned write seams (pin / refresh / download)
// that bump every affected signal so all mounted surfaces repaint from the new record.
//
// Pin writes DUAL-WRITE during migration: the record pin (canonical, per-song) AND the
// legacy per-uid pin (the storage older surfaces still read directly). The record pin is
// the truth; the legacy write keeps every un-migrated reader consistent with it.

import type { Track } from '$lib/sources/types';
import {
	pinTrackCover,
	pinTrackLyrics,
	markTrackDownloaded,
	recordTrackCoverCandidates,
	recordTrackVariant,
	pinTrackVariant,
	getVariantPin,
	getDefaultVariantUid,
	getTrackRecord,
	getTrackChosenCover,
	bustTrackRecord
} from '$lib/services/track-record';
import {
	pinArtistImage,
	bustArtistRecord,
	getArtistChosen,
	getArtistPin
} from '$lib/services/artist-record';
import { removeCachedArtistCover } from '$lib/services/cover-cache';
import { resolveTrackRecord } from '$lib/services/track-resolve';
import { resolveArtistImage } from '$lib/services/artist-image';
import { hasHttpsScheme } from '$lib/services/url-safety';
import { pinCover, unpinCover, removeCoverBoth, bumpCoverVersion } from './cover-version.svelte';
import { pinLyrics, unpinLyrics } from './lyric-pins.svelte';

const _v = $state({ n: 0 });
let bumpScheduled = false;

/** Read the current record version. CALL inside a $derived/template to depend on record writes. */
export function recordVersion(): number {
	return _v.n;
}

/** Bump the record signal (rAF-coalesced, sync in node/SSR — mirrors bumpCoverVersion). */
export function bumpRecords(): void {
	if (typeof requestAnimationFrame === 'undefined') {
		_v.n++;
		return;
	}
	if (bumpScheduled) return;
	bumpScheduled = true;
	requestAnimationFrame(() => {
		bumpScheduled = false;
		_v.n++;
	});
}

/** Reactive read of a song's canonical cover (pin > crowd > auto), or null. */
export function readRecordCover(artist: string, title: string): string | null {
	recordVersion();
	return getTrackChosenCover(artist, title);
}

/** Reactive read of an artist's canonical image (pin > auto), or null. */
export function readRecordArtistImage(name: string): string | null {
	recordVersion();
	return getArtistChosen(name);
}

/**
 * THE cover-pin writer (supersedes a bare pinCover call): pin for the RECORD (every
 * instance of the song, every surface) + the legacy per-uid pin for un-migrated readers.
 */
export function pinRecordCover(track: Track, url: string): void {
	if (!track?.uid) return;
	pinTrackCover(track.artist ?? '', track.title ?? '', url);
	pinCover(track.uid, url); // legacy dual-write (bumps coverVersion itself)
	bumpRecords();
}

/** Drop a song's cover pin at both layers (menu "use automatic" path). */
export function unpinRecordCover(track: Track): void {
	if (!track?.uid) return;
	pinTrackCover(track.artist ?? '', track.title ?? '', null);
	unpinCover(track.uid);
	bumpRecords();
}

/**
 * THE lyrics-pin writer: the LRC text stays in the per-uid lyric-pin store (D-2: the text
 * is the choice), and the RECORD learns WHICH uid holds this song's pinned lyrics — so the
 * pin now applies to every instance of the song at read time (lyric-pins.svelte readLyrics).
 */
export function pinRecordLyrics(track: Track, lrc: string): void {
	if (!track?.uid) return;
	pinLyrics(track.uid, lrc); // legacy store of the text (bumps lyricVersion itself)
	pinTrackLyrics(track.artist ?? '', track.title ?? '', track.uid);
	bumpRecords();
}

/** Drop a song's lyrics pin at both layers. */
export function unpinRecordLyrics(track: Track): void {
	if (!track?.uid) return;
	unpinLyrics(track.uid);
	pinTrackLyrics(track.artist ?? '', track.title ?? '', null);
	bumpRecords();
}

/** Pin an artist's image at the record level (every surface, forever). */
export function pinRecordArtistImage(name: string, url: string | null): void {
	pinArtistImage(name, url);
	bumpCoverVersion();
	bumpRecords();
}

/**
 * Point-of-use FORCE REFRESH for one song (standing FORCE REFRESH rule, brief §2.5):
 * bust EXACTLY this song's record + its shared cover-cache entries, re-run the one
 * resolver, and repaint. Narrow by construction — no other song's data is touched.
 * Returns the fresh chosen cover (or null). Never throws.
 */
export async function refreshTrackRecord(track: Track, signal?: AbortSignal): Promise<string | null> {
	if (!track) return null;
	const artist = track.artist ?? '';
	const title = track.title ?? '';
	// USER INTENT SURVIVES a refresh: the bust rebuilds AUTO data only — the cover pin, the
	// lyrics pin and the downloaded flag are captured first and restored after the resolve.
	const before = getTrackRecord(artist, title);
	bustTrackRecord(artist, title);
	removeCoverBoth(track.uid ?? '', artist, title);
	const rec = await resolveTrackRecord(artist, title, track, signal).catch(() => null);
	if (before?.cover.pin) pinTrackCover(artist, title, before.cover.pin);
	if (before?.lyrics.pinUid) pinTrackLyrics(artist, title, before.lyrics.pinUid);
	if (before?.downloaded) markTrackDownloaded(artist, title, track.uid || undefined);
	bumpCoverVersion();
	bumpRecords();
	return getTrackRecord(artist, title)?.cover.chosen ?? rec?.cover.chosen ?? null;
}

/**
 * Point-of-use FORCE REFRESH for one artist's image: bust exactly that record + its shared
 * cache entry, then re-run the one resolver (force bypasses the negative memo).
 */
export async function refreshArtistRecord(name: string, signal?: AbortSignal): Promise<string | null> {
	const pin = getArtistPin(name); // user intent survives the bust (see refreshTrackRecord)
	bustArtistRecord(name);
	removeCachedArtistCover(name);
	const url = await resolveArtistImage(name, signal, { force: true }).catch(() => null);
	if (pin) pinArtistImage(name, pin);
	bumpCoverVersion();
	bumpRecords();
	return pin ?? url;
}

/**
 * Download carry (Hector 2026-11-21): when a song finishes downloading, its canonical
 * record is marked downloaded — eviction-protected forever — and seeded with the art the
 * download resolved, so offline play/game renders the same cover/lyrics as online.
 */
export function carryRecordWithDownload(track: Track, resolvedCover?: string | null): void {
	if (!track) return;
	const artist = track.artist ?? '';
	const title = track.title ?? '';
	const cover = resolvedCover ?? track.cover ?? null;
	if (hasHttpsScheme(cover)) {
		recordTrackCoverCandidates(artist, title, [{ url: cover as string, source: 'download' }], {
			album: track.album ?? null,
			uid: track.uid
		});
	}
	markTrackDownloaded(artist, title, track.uid || undefined);
	bumpRecords();
}

/** The song's record (reactive read for components that need more than the cover). */
export function readTrackRecord(artist: string, title: string) {
	recordVersion();
	return getTrackRecord(artist, title);
}

// --- Golden-record variants (Hector 2026-11-21): the sources modal's seams. ---

/**
 * Register a batch of provider variants inside the song's record — called when
 * the sources modal (VersionPicker) enumerates them, so the record accumulates
 * EVERY known variant as a selectable source while surfaces keep rendering one.
 */
export function registerRecordVariants(track: Track, variants: Track[]): void {
	for (const v of variants) {
		if (v?.uid) recordTrackVariant(track.artist, track.title, { uid: v.uid, source: v.source, title: v.title });
	}
	bumpRecords();
}

/** The record's default-variant uid (pin > official > auto) — reactive read. */
export function readDefaultVariantUid(track: Track): string | null {
	recordVersion();
	return getDefaultVariantUid(track.artist, track.title);
}

/** The user's pinned variant uid for the song — reactive read. */
export function readVariantPin(track: Track): string | null {
	recordVersion();
	return getVariantPin(track.artist, track.title);
}

/** Pin (or unpin, with null) the song's default-play variant at the record level. */
export function pinRecordVariant(track: Track, uid: string | null): void {
	pinTrackVariant(track.artist, track.title, uid);
	bumpRecords();
}
