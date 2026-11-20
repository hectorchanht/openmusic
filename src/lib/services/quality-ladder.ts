// Adaptive quality ladder — NEVER-STOP doctrine, quality wing
// (Hector 2026-11-19, standing): "Auto reduce song quality if network
// not allowing — the goal is to keep speed + playable >>> quality."
// And the founding form: "most streaming services are even 128kb, no
// one cares as long as it is fast and stable. Lossless/FLAC is not a
// thing in streaming on mobile unless the user forces it (then it can
// be laggy, their choice). Fluent song all the time, any time, no
// matter what — stable playing with worst quality beats loading high
// quality with play-and-stop."
//
// WHERE THIS SITS in the defence order: buffer gate (wait for a head
// start) → QUALITY DOWNGRADE (same song, lower tier) → proxy rescue /
// smoothness skip (a different fetch path, or a different song). A
// lower tier of the SAME song beats both later defences, so this
// ladder is fed by the gate/hold telemetry the buffer gate already
// produces and answers at the ONE resolve seam (catalog's tier
// computation): every streaming resolve that carries no explicit
// per-call quality asks `ladderStreamingTier` what tier to fetch.
//
// POSTURE (fluent-first, per the ruling):
//  - Streaming lives in the LIGHT BAND by default. With Auto quality
//    ON, the home tier is at most '320' — the 'auto' pref resolving
//    to lossless on unmetered wifi (effectiveQuality's 32-D-02 rule)
//    is NOT a user force, so it does not stream FLAC; it homes at
//    the top of the light band instead.
//  - An EXPLICIT 'lossless' pref IS a force: the ladder never
//    overrides it (the lag is the user's accepted choice). The gate /
//    proxy / skip defences still apply around it.
//  - Explicit lossy prefs ('320' / '128') are a CEILING: the ladder
//    manages at or below them. '128' is the floor — there is no
//    lower streaming step, and none is invented.
//  - DOWNLOADS are not streaming: download resolves always pass an
//    explicit per-call quality, which bypasses this ladder entirely
//    (catalog's seam), so download behaviour is untouched.
//  - Auto quality OFF restores the pre-ladder behaviour exactly:
//    tier = effectiveQuality(pref), no state consulted.
//
// PRESSURE MODEL (no new probing traffic — the gate/hold signals are
// the measurement):
//  - A buffer-gate TIMEOUT (12s and the head start never arrived) or
//    a rebuffer-hold TIMEOUT (10s held and the buffer never recovered
//    to the healthy threshold) is hard evidence the current tier is
//    more than this network can carry → step down one step
//    ('320' → '128'), immediately.
//  - A hold that ends 'ready' is softer evidence: no step, but the
//    recovery clock restarts — one lucky refill does not prove the
//    network healed.
//  - RECOVERY is earned, never assumed: LADDER_RECOVER_SMOOTH_SEC of
//    CONTINUOUS stall-free playback (fed by the player's timeupdate
//    ticks, each tick's credit capped so a backgrounded tab or a
//    seek cannot fake it) steps back up one step and clears the
//    episode. Any pressure event zeroes the accumulated smooth time,
//    so the ladder cannot flap: down is instant, up takes two
//    proven minutes.
//
// The state machine is a plain class with all time injected through
// method arguments, so it is node-unit-testable without the player;
// `qualityLadder` below is the session singleton the player feeds
// and catalog reads (pressure is a property of the session's
// network, not of any component — the sleep-timer singleton is the
// in-repo precedent for this shape).
import type { DefaultQuality } from '$lib/stores/settings.svelte';
import { effectiveQuality, qualityRank } from '$lib/sources/quality';
import type { BufferGateOutcome } from '$lib/services/buffer-gate';

export type StreamingTier = Exclude<DefaultQuality, 'auto'>;
export type PressureState = 'ok' | 'tight' | 'bad';

/** Continuous stall-free playback that earns one step back up. */
export const LADDER_RECOVER_SMOOTH_SEC = 120;
/** Max smooth-time credit per playing tick. timeupdate fires ~4×/s
 *  while audio actually progresses; the cap means a throttled
 *  background tab (1 tick/s) still accrues honestly, while a seek
 *  jump or a long suspension between ticks can never credit more
 *  than a breath of playback. */
export const LADDER_TICK_CAP_SEC = 2;

export class QualityLadder {
	/** Steps below the home tier: 0 = home, 1 = one step down. The
	 *  lossy band has exactly one step ('320' → '128'); the field is
	 *  a number so a future finer band needs no shape change. */
	stepDown = 0;
	/** A pressure event has landed since the last full recovery. */
	private pressured = false;
	/** Continuous stall-free seconds banked toward recovery. */
	private smoothSec = 0;
	/** Wall clock of the previous playing tick (null = no baseline). */
	private lastTickAt: number | null = null;
	/** The uid whose current-track downgrade this episode already
	 *  spent — one downgrade per track per episode, never a loop. */
	private downgradeClaimUid: string | null = null;

	/** Coarse session pressure for logging/UI: 'bad' while stepped
	 *  down, 'tight' from a pressure event until recovery is proven,
	 *  'ok' otherwise. */
	get pressure(): PressureState {
		if (this.stepDown > 0) return 'bad';
		return this.pressured ? 'tight' : 'ok';
	}

	/** Test/seed hygiene: back to a fresh session. */
	reset(): void {
		this.stepDown = 0;
		this.pressured = false;
		this.smoothSec = 0;
		this.lastTickAt = null;
		this.downgradeClaimUid = null;
	}

	private applyHardPressure(): boolean {
		this.pressured = true;
		this.smoothSec = 0;
		this.lastTickAt = null;
		if (this.stepDown === 0) {
			this.stepDown = 1;
			return true;
		}
		return false;
	}

	private applySoftPressure(): void {
		this.pressured = true;
		this.smoothSec = 0;
		this.lastTickAt = null;
	}

	/**
	 * Feed a buffer-gate outcome (play()'s fresh-play gate). Only
	 * 'timeout' is bandwidth evidence — 'ready' is the common case
	 * and proves nothing either way (recovery is earned through
	 * playback ticks), and 'error' is a dead URL, which the failover
	 * chain owns, not the ladder. Returns true when this event newly
	 * stepped the ladder down.
	 */
	noteGateOutcome(outcome: BufferGateOutcome): boolean {
		if (outcome === 'timeout') return this.applyHardPressure();
		return false;
	}

	/** A mid-song rebuffer hold has begun: the recovery clock
	 *  restarts (the stall itself breaks any smooth run). */
	noteHoldStart(): void {
		this.applySoftPressure();
	}

	/**
	 * A rebuffer hold has ended. 'timeout' — the buffer never
	 * recovered to the healthy threshold inside the hold — is hard
	 * pressure (step down). 'ready' is soft pressure only: the src
	 * refilled once, the tier is not yet convicted. Returns true
	 * when this event newly stepped the ladder down.
	 */
	noteHoldEnd(outcome: BufferGateOutcome): boolean {
		if (outcome === 'timeout') return this.applyHardPressure();
		this.applySoftPressure();
		return false;
	}

	/**
	 * Feed one playing tick (the player's timeupdate, ~4×/s while
	 * audio progresses). Banks capped real elapsed time toward
	 * recovery; reaching LADDER_RECOVER_SMOOTH_SEC of continuous
	 * smooth play steps back up, clears the pressure episode and
	 * re-arms the per-track downgrade claim.
	 */
	notePlayingTick(nowMs: number): void {
		if (this.lastTickAt == null) {
			this.lastTickAt = nowMs;
			return;
		}
		const deltaSec = (nowMs - this.lastTickAt) / 1000;
		this.lastTickAt = nowMs;
		if (deltaSec <= 0) return;
		this.smoothSec += Math.min(deltaSec, LADDER_TICK_CAP_SEC);
		if (this.smoothSec >= LADDER_RECOVER_SMOOTH_SEC) {
			this.stepDown = 0;
			this.pressured = false;
			this.downgradeClaimUid = null;
			this.smoothSec = 0;
		}
	}

	/**
	 * The streaming tier a resolve should fetch under the ladder:
	 * the ONE answer catalog's seam reads for any resolve carrying
	 * no explicit per-call quality. See the header for the posture
	 * rules (off = pre-ladder behaviour; explicit lossless = force,
	 * exempt; 'auto'-lossless is not a force and homes at '320').
	 */
	tierFor(pref: DefaultQuality, autoOn: boolean): StreamingTier {
		if (!autoOn) return effectiveQuality(pref);
		if (pref === 'lossless') return 'lossless';
		const base = effectiveQuality(pref);
		const home: StreamingTier = base === 'lossless' ? '320' : base;
		if (home === '320' && this.stepDown > 0) return '128';
		return home;
	}

	/**
	 * Should the CURRENT track be re-resolved one tier lower right
	 * now? True only when the ladder is engaged (Auto on, not a
	 * forced lossless), it has actually stepped down, and the tier
	 * playing is provably above the ladder's tier (an unknown tier
	 * label proves nothing — no swap on a guess). Pure: the claim
	 * below is what spends the one-shot.
	 */
	shouldDowngradeCurrent(
		currentTierLabel: string | null | undefined,
		pref: DefaultQuality,
		autoOn: boolean
	): boolean {
		if (!autoOn || pref === 'lossless') return false;
		if (this.stepDown === 0) return false;
		const target = this.tierFor(pref, autoOn);
		const currentRank = qualityRank(currentTierLabel);
		return currentRank > 0 && currentRank > qualityRank(target);
	}

	/**
	 * Spend this episode's one current-track downgrade for `uid`.
	 * True = go ahead; false = already spent on this track (a
	 * second hold on the same song resumes/holds/skips through the
	 * other defences instead of re-resolving forever). The claim
	 * clears when recovery is proven (notePlayingTick) — a later,
	 * separate pressure episode may downgrade the track again.
	 */
	claimCurrentDowngrade(uid: string): boolean {
		if (this.downgradeClaimUid === uid) return false;
		this.downgradeClaimUid = uid;
		return true;
	}
}

/** The session singleton: the player feeds it gate/hold/tick
 *  telemetry; catalog reads it at the resolve seam. */
export const qualityLadder = new QualityLadder();

/** Convenience for the catalog seam (reads the session singleton). */
export function ladderStreamingTier(pref: DefaultQuality, autoOn: boolean): StreamingTier {
	return qualityLadder.tierFor(pref, autoOn);
}
