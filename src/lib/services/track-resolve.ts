// track-resolve — ManyToCanon’s ONE track resolver. — THE one TrackRecord resolver (quick-261121-canon, brief §2.2).
//
// Merges every existing cover feeder for a song into its canonical record, all through the
// feeders' own identity gates (resolveCoverForTrack's chain already runs isCoverOf on every
// candidate; the instance/cache/crowd values were gated when they were written):
//
//   chain    — resolveCoverForTrack (Deezer → iTunes → CN, first-solid-wins) — auto precedence #1
//   instance — the hint Track's own seeded cover                                — auto precedence #2
//   cache    — the shared cover-cache name layer                                — auto precedence #3
//   crowd    — the crowd-shared pick (its own family; outranks auto, under a pin)
//
// The merged record is the truth surfaces render; the AUTO chosen value is also written
// THROUGH to the shared cover-cache name layer so un-migrated surfaces keep working off
// the same truth (brief §2.2). A pin or crowd pick is never written into the auto cache
// (the cover-cache PIN/CROWD separation, unchanged). Resolution is lazy + once per song —
// callers fire it at the existing resolve points (play, menu, backfill), never per row.

import type { Track } from '$lib/sources/types';
import { getCachedCover, getCrowdCover, setCachedCover } from './cover-cache';
import { resolveCoverForTrack } from './cover-backfill';
import { hasHttpsScheme } from './url-safety';
import {
	getTrackRecord,
	recordTrackCoverCandidates,
	recordTrackVariant,
	type TrackRecord
} from './track-record';

/**
 * Resolve (or refresh) the canonical record for a song. With a `hint` Track the full chain
 * runs; without one, only the local feeders merge (cache + crowd) — the name-stub path.
 * Returns the record (null only when the song has no identity at all). Never throws.
 */
export async function resolveTrackRecord(
	artist: string,
	title: string,
	hint?: Track | null,
	signal?: AbortSignal
): Promise<TrackRecord | null> {
	const a = (artist ?? '').trim();
	const t = (title ?? '').trim();
	if (!a && !t) return null;
	const candidates: { url: string; source: string }[] = [];
	try {
		if (hint) {
			const chain = await resolveCoverForTrack(hint, signal).catch(() => null);
			if (hasHttpsScheme(chain)) candidates.push({ url: chain as string, source: 'chain' });
			if (hasHttpsScheme(hint.cover)) candidates.push({ url: hint.cover as string, source: 'instance' });
		}
		const cached = getCachedCover(a, t);
		if (cached) candidates.push({ url: cached, source: 'cache' });
		const crowd = getCrowdCover(hint?.uid ?? '', a, t);
		if (crowd) candidates.push({ url: crowd, source: 'crowd' });
	} catch {
		/* a feeder failed — merge whatever the record already holds (never throw) */
	}
	const rec = candidates.length
		? recordTrackCoverCandidates(a, t, candidates, { album: hint?.album ?? null, uid: hint?.uid })
		: getTrackRecord(a, t);
	// Golden record: the hint instance IS one of the song's variants — it lives
	// inside the record as a selectable source (never as a duplicate row).
	if (hint?.uid) {
		recordTrackVariant(a, t, { uid: hint.uid, source: hint.source, title: hint.title });
	}
	// Write-through: the AUTO chosen value feeds the shared name layer (un-migrated surfaces
	// read the same truth). Pin/crowd chosen values stay in their own families by design.
	if (rec && rec.cover.chosen && !rec.cover.pin) {
		const isCrowd = rec.cover.candidates.some((c) => c.source === 'crowd' && c.url === rec.cover.chosen);
		if (!isCrowd) setCachedCover(a, t, rec.cover.chosen);
	}
	return rec;
}
