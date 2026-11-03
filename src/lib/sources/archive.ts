// Internet Archive client adapter (quick-261020-arch) — the fully-legal catalog:
// public-domain + Creative-Commons audio (78rpm transfers, live-concert etree,
// LibriVox-adjacent music, netlabel releases). No API key exists or is needed.
//
// Follows the jamendo.ts pattern closely (keyless legal catalog, deterministic
// stream URLs, no lyrics). Differences worth knowing:
//   - archive.org search returns ITEMS, not tracks, so /api/archive/search does
//     the advancedsearch + per-item metadata fan-out at the edge and hands this
//     adapter flattened track rows (see the route + $lib/proxy/archive).
//   - Identity: songid = `<identifier>/<file>` — self-contained, so a restored
//     library track resolves with zero extra state (serializeTrack-safe), and
//     the download URL is DETERMINISTIC: no resolve-time network call at all.
//   - autoResolveEligible: false — archive pressings (78 transfers, audience
//     tapes) must never silently satisfy a resolve for a studio track, the
//     ytmusic/bilibili posture. Lyrics: none exist — lrc stays null, cleanly.

import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl } from '../services/lrc';
import { apiFetch } from '../services/api-base';
import { archiveHealth } from '../services/archive-health';
import type { ArchiveRow } from '../proxy/archive';

interface ArchiveSearchResponse {
	rows?: ArchiveRow[];
}

/** Filename fallback title: basename without extension, separators → spaces. */
function fileTitle(file: string): string {
	const base = file.slice(file.lastIndexOf('/') + 1);
	const dot = base.lastIndexOf('.');
	return (dot > 0 ? base.slice(0, dot) : base).replace(/[_-]+/g, ' ').trim();
}

/** The deterministic stream URL for an identifier/file pair (segment-encoded). */
export function archiveDownloadUrl(identifier: string, file: string): string {
	const encFile = file.split('/').map((seg) => encodeURIComponent(seg)).join('/');
	return `https://archive.org/download/${encodeURIComponent(identifier)}/${encFile}`;
}

export const archive: SourceAdapter = {
	id: 'archive',
	health: archiveHealth,
	label: 'Internet Archive',
	enabledByDefault: true,
	// Legal-catalog source: searchable, but never a silent stand-in on the floor.
	autoResolveEligible: false,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		// HEALTH-GATE short-circuit (archive-health, universal-gate rollout 2026-11-01):
		// after a run of HARD failures, skip the wasted call for a bounded window; the
		// gate then auto-opens for one probe whose outcome re-decides. Never-throw here.
		// Empty results are NEVER counted (see archive-health.ts — empty is a normal
		// answer for this sparse catalogue, not an outage shape).
		if (archiveHealth.isGated()) return [];

		const pg = Math.max(1, page || 1);
		const path = `/api/archive/search?keyword=${encodeURIComponent(keyword)}&page=${pg}`;

		// Fetch + parse in ONE try (the kuwoJson lesson) so every failure shape counts;
		// a caller abort is a supersede, not an outage — rethrown uncounted.
		let json: ArchiveSearchResponse | null;
		try {
			const res = await apiFetch(path, { signal });
			json = (await res.json()) as ArchiveSearchResponse | null;
		} catch (err) {
			if (!signal.aborted) archiveHealth.recordFail();
			throw err;
		}

		// Contract-drift guard: the route's anchor is { rows: [...] }.
		if (!json || !Array.isArray(json.rows)) {
			archiveHealth.recordFail();
			throw new Error('archive: contract-drift (expected {rows:[]} search body)');
		}
		// A well-formed body is a live upstream — instant recovery (empty included).
		archiveHealth.recordOk();

		const tracks: Track[] = [];
		json.rows.forEach((row, idx) => {
			if (!row.identifier || !row.file) return;
			const songid = `${row.identifier}/${row.file}`;
			tracks.push({
				uid: makeUid('archive', songid),
				source: 'archive',
				songid,
				title: row.title || row.itemTitle || fileTitle(row.file),
				artist: row.creator || '',
				album: row.itemTitle || '',
				// IA's item-image service is deterministic per identifier.
				cover: `https://archive.org/services/img/${encodeURIComponent(row.identifier)}`,
				audioUrl: null,
				lrc: null,
				lrcUrl: null,
				detailsLoaded: false,
				quality: null,
				qualityLabel: null,
				keyword,
				displayIndex: idx + 1,
				duration: row.lengthSec ?? undefined
			});
		});
		return tracks;
	},

	async resolve(track: Track, signal: AbortSignal): Promise<Track> {
		// Deterministic URL — no upstream call (the file identity IS the address).
		// `signal` is part of the contract; there is nothing async to abort, but a
		// caller that already gave up should not get a resolved track back.
		if (signal.aborted) throw new Error('archive: resolve aborted');
		const slash = track.songid.indexOf('/');
		if (slash <= 0 || slash === track.songid.length - 1) {
			throw new Error('archive: malformed songid (expected <identifier>/<file>)');
		}
		const identifier = track.songid.slice(0, slash);
		const file = track.songid.slice(slash + 1);
		track.audioUrl = archiveDownloadUrl(identifier, file);
		const q = inferQualityFromUrl(track.audioUrl);
		track.quality = q.tag;
		track.qualityLabel = q.label;
		track.detailsLoaded = true;
		return track;
	}
};
