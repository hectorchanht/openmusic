// PREVIEW RESCUE (Hector 2026-11-19) — "a 1-minute preview must never be what plays by default".
//
// THE INCIDENT: the shared link /song/周興哲/永不失聯的愛?u=qq003b8p2c1T2JPF played exactly 1:00
// and stopped. That QQ mid is a paywall 試聽： tang's detail reports `song_play_time: 60` and
// the served file is 737,512 bytes ≈ 60.0s at its 98kbps tier (both measured live), while the
// full 258s studio cut exists on kuwo (rid 37428520) and on QQ itself under another mid
// (004c4CEB3jfz7a, `song_play_time: 258`, playable URLs). Hector's rule: a preview-length file
// must NEVER be the default play when a full version of the same song by the original artist
// exists on any source — most users never open the source picker, so a preview that plays as
// "the song" reads as a broken app. The preview itself is NOT removed (classify, never
// remove): it stays in the VersionPicker, and an explicit pick there (`Track.explicitVersion`)
// plays it verbatim — the ban is only on it being the AUTOMATIC play.
//
// WHY IT ESCAPED (all three verified against the code + live APIs):
//   1. PINNED-UID BYPASS (the structural hole): the duration arbitration
//      (song-variant rankAutoCandidates / candidateTier / isImplausiblyShort) only runs inside
//      arbitration chains — the fallback race, auto-pick name resolves, dedupe collapse. A
//      concrete track (a search-row tap, a queue row, and above all a share link's pinned
//      `?u=` carrier, which share-arrival resolves DIRECTLY via ensureTrackDetails by design,
//      38-D-08) is played verbatim. Nothing on that path ever asked "is this the whole song?".
//   2. THRESHOLD BOUNDARY: the absolute short clause is `d < 60` and the QQ preview is
//      EXACTLY 60.0s — even where the check did run with no expectation, it waved through.
//   3. DURATION ARRIVES LATE: QQ search rows carry no duration; `Track.duration` becomes 60
//      only when resolve() maps `song_play_time`. So the earliest point ANY play path knows
//      the truth is right after the resolve — which is where the player consults this module
//      (play()'s network path and armTrack(), before the src is attached / armed). The
//      element would only ever report the same 60s, so a post-load detector could not fire
//      earlier or know more; metadata IS the earliest reliable signal.
//
// GENERALISED TO THE JUNK CLASS (Hector 2026-11-19, same day): the preview is one member
// of a junk drawer — 試聽 previews, 鈴聲/彩鈴 ringtones, 片段 fragments, sped/slowed and
// pitch-shifted edits, 環繞 re-encodes — whose shared property is impersonating the song
// while being a degraded cut of it. Hector's doctrine: junk stays in the catalog,
// classified and findable by deliberate search, but it must NOT LEAK — a simple click on
// any surface must land on the canonical version, and junk plays only when the user
// deliberately picks that version in the source/version picker. So the suspect gate has
// TWO triggers: a known duration in the preview band (isPreviewSuspect), or a junk marker
// in the title itself (song-variant.isJunkTitle — the title is positive evidence, which is
// why the D-03 unknown-duration neutrality below yields for junk-titled rows only). A
// title-junk rescue searches by the STRIPPED title (junklessTitle) so the canonical pool
// answers, and only an OFFICIAL-titled candidate may substitute — junk never replaces
// junk. Covers and wrong-artist rows are NOT click-rescued: they are separate catalog
// entries (their own dedupe group), and their no-leak guarantee lives in the arbitration
// layer itself — dedupe tiering never lets one take the original's slot, and
// isAutoAcceptable / isAcceptableSubstitute refuse them as substitutes in every chain.
//
// THE SHAPE: `findFullVersion(chosen)` is consulted ONLY for a preview SUSPECT (known
// duration ≤ PREVIEW_BAND_SEC — song-variant.isPreviewSuspect), so ordinary plays pay
// nothing. It reuses the standing arbitration wholesale — the same isAutoAcceptable gates
// (same song / same kind / same artist), the same rankAutoCandidates order, the same
// resolve walk cap as fallback's walkSource — and adds the one judgement those chains
// never needed: a candidate only counts as the FULL version when the pool's own durations
// convict the chosen track (song-variant.isPreviewLength against the longest reported
// length) or the candidate's own resolved duration clears the preview band with no longer
// expectation contradicting it. When nothing convicts — every source agrees the song is
// ~1 minute, or no source reports a longer cut — the answer is null and the chosen track
// plays as-is: genuine short tracks (intros, skits, interludes) are untouched.

import { searchAll, ensureTrackDetails } from '$lib/services/catalog';
import { cjkSearchQuery } from '$lib/services/dedupe';
import {
	isAutoAcceptable,
	rankAutoCandidates,
	isPreviewSuspect,
	isPreviewLength,
	isJunkTitle,
	junklessTitle,
	isOfficialTitle,
	PREVIEW_BAND_SEC
} from '$lib/services/song-variant';
import { isAutoResolveEligible } from '$lib/sources/registry';
import { isDeviceUid } from '$lib/services/device-track';
import type { Track } from '$lib/sources/types';

/** Resolve attempts per rescue — fallback walkSource's MAX_CANDIDATE_RESOLVES parity: enough
 *  for album cut + single cut + one spare, never a long serial stall on the play path. */
const MAX_RESCUE_RESOLVES = 3;

/** A duration the source actually reported (finite, positive) — undefined is "no evidence". */
function knownDuration(t: { duration?: number }): number | undefined {
	const d = t.duration;
	return typeof d === 'number' && isFinite(d) && d > 0 ? d : undefined;
}

/**
 * Find a playable FULL version of `chosen` (a resolved track that is junk-suspect: known
 * duration in the preview band, or a junk marker in its title) on any enabled source —
 * including the chosen track's OWN source under a different id (QQ carries the preview
 * mid and the full mid side by side). Returns the resolved full Track, or null when no
 * full version can be CONFIRMED: the suspect gate did not trip, the pool holds no
 * acceptable same-song candidate, every reporting source agrees the song is band-length,
 * or every walked candidate turned out to be another junk cut.
 * Never throws — a failed rescue is indistinguishable from "no rescue exists" by design,
 * and the caller plays the chosen track either way.
 */
export async function findFullVersion(
	chosen: Track,
	signal?: AbortSignal
): Promise<Track | null> {
	// TWO suspect triggers (see header): duration evidence, or junk evidence in the title.
	// A plain-titled track with unknown duration stays neutral (D-03) and pays nothing.
	const byDuration = isPreviewSuspect(chosen);
	const byTitle = !byDuration && isJunkTitle(chosen.title);
	if (!byDuration && !byTitle) return null;
	// A device file is the user's own bytes — its length is whatever they imported (34-D-06
	// truthfulness: never substitute a stream for the user's file under its identity).
	if (isDeviceUid(chosen.uid)) return null;
	const query = `${chosen.artist} ${chosen.title}`.trim();
	if (!query) return null;
	// A junk-titled row is searched by its stripped title FIRST — "晴天（48秒鈴聲版）" asked
	// verbatim can bury the canonical cut under its own junk drawer; "晴天" cannot.
	const cleanQuery = byTitle
		? `${chosen.artist} ${junklessTitle(chosen.title)}`.trim()
		: query;

	// One fat pool across every enabled source (walkSource's page-8 idiom), gated by the ONE
	// auto-acceptance predicate. A source flagged off the auto-resolve floor (ytmusic) is
	// never adopted for a track it did not originate — fallbackOrder's rule, mirrored; the
	// chosen track's own source always stays eligible (its full mid is the incident's fix).
	const collect = async (q: string): Promise<Track[]> => {
		try {
			const result = await searchAll(q, 8, {}, signal);
			return result.interleaved.filter(
				(c) =>
					c.uid !== chosen.uid &&
					(c.source === chosen.source || isAutoResolveEligible(c.source)) &&
					isAutoAcceptable(chosen, c)
			);
		} catch {
			return [];
		}
	};

	let acceptable = await collect(cleanQuery);
	if (signal?.aborted) return null;
	if (acceptable.length === 0 && cleanQuery !== query) {
		acceptable = await collect(query);
		if (signal?.aborted) return null;
	}
	if (acceptable.length === 0) {
		// tryFallback's bilingual-split second pass (quick-261103-cjk): a bilingual title can
		// defeat the strict CN engines under its full spelling; the CJK half alone hits.
		const split = cjkSearchQuery(chosen.artist, chosen.title);
		if (split && split !== query) {
			acceptable = await collect(split);
			if (signal?.aborted) return null;
		}
	}
	if (acceptable.length === 0) return null;

	// The expected full length: the LONGEST duration the acceptable pool actually reports.
	let expected: number | undefined;
	for (const c of acceptable) {
		const d = knownDuration(c);
		if (d !== undefined && (expected === undefined || d > expected)) expected = d;
	}
	// GENUINE-SHORT EXEMPTION: every acceptable row REPORTS a duration and none runs past
	// the preview band — the sources agree the song itself is ~1 minute. Resolving them
	// could only hand back the same lengths, so the chosen track plays as-is, unsearched
	// further and unsubstituted.
	if (
		expected !== undefined &&
		expected <= PREVIEW_BAND_SEC &&
		acceptable.every((c) => knownDuration(c) !== undefined)
	) {
		return null;
	}

	const ranked = rankAutoCandidates(acceptable, chosen, { expectedSec: expected });
	let bestFull: Track | null = null;
	let tentative: Track | null = null;
	for (const stub of ranked.slice(0, MAX_RESCUE_RESOLVES)) {
		if (signal?.aborted) return null;
		let resolved: Track;
		try {
			resolved = await ensureTrackDetails(stub, signal);
		} catch {
			if (signal?.aborted) return null;
			continue; // this candidate's resolve blew up — try the pool's next row
		}
		if (signal?.aborted) return null;
		if (!resolved.audioUrl) continue;
		// Title-junk rescue: only an OFFICIAL-titled candidate may substitute — a full-length
		// 環繞 re-encode or a 258s remix is still junk, and junk never replaces junk.
		if (byTitle && !isOfficialTitle(resolved.title)) continue;
		const rd = knownDuration(resolved);
		if (rd !== undefined) {
			// Judge the candidate against the expectation gathered WITHOUT it first: a 60s
			// candidate that merely sets the max itself is another preview, not a full
			// version. It counts as full only when it clears the band outright and no
			// longer known expectation convicts it (isPreviewLength against that judge).
			const judge = expected;
			const full =
				rd > PREVIEW_BAND_SEC &&
				(judge === undefined || !isPreviewLength(resolved, judge));
			if (expected === undefined || rd > expected) expected = rd;
			if (full && (!bestFull || rd > (knownDuration(bestFull) ?? 0))) bestFull = resolved;
			continue;
		}
		// Playable but duration-silent (kuwo's detail carries no length): hold as the
		// tentative substitute — it may only be used when the chosen track stands
		// CONFIRMED as a preview against a known expectation (below).
		if (!tentative) tentative = resolved;
	}
	// A later candidate can raise the expectation past an earlier "full" pick (a 120s cut
	// accepted before a 258s row resolved) — re-judge the winner against the final pool
	// truth before it may substitute.
	if (bestFull && expected !== undefined && isPreviewLength(bestFull, expected)) {
		bestFull = null;
	}
	if (bestFull) return bestFull;
	// The duration-silent candidate substitutes ONLY when the chosen stands confirmed as
	// junk: by duration (some source proved the song runs materially longer than the file
	// that was about to play) or by title marker (byTitle — the marker IS the conviction).
	if (tentative && expected !== undefined && (byTitle || isPreviewLength(chosen, expected))) {
		return tentative;
	}
	return null;
}
