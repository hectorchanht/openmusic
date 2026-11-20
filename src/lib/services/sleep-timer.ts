// PURE sleep-timer helpers — NO runes, NO `$state`, NO `$app/environment`.
//
// This module is the node-Vitest-testable core of the sleep timer (TIMER-01). The
// runes store (src/lib/stores/sleepTimer.svelte.ts) and the player engine merely
// WRAP these helpers — exactly as the runes player store wraps media-session.ts.
//
// The throttle-proof, branchy, throw-prone logic (absolute-deadline math, the
// volume-fade curve with its divide-by-zero guard, the end-of-track-beats-repeat-one
// arbitration) lives HERE so it can be unit-tested in the node project, keeping the
// runes store and player thin callers. `canFadeVolume` takes a STRUCTURAL
// `{ volume: number }` (not `HTMLAudioElement`) so it stays node-testable with a fake
// object and carries zero runtime coupling to the DOM lib.

/** Clamp a value into the inclusive [0,1] range. */
function clamp01(v: number): number {
	if (!Number.isFinite(v) || v < 0) return 0;
	if (v > 1) return 1;
	return v;
}

/** A duration timer reaches its deadline at `now + minutes*60_000` (ABSOLUTE wall-clock, D-14). */
export function computeDeadline(now: number, minutes: number): number {
	return now + minutes * 60_000;
}

/** True only when an absolute deadline is set and `now` has reached or passed it. Null = off. */
export function isExpired(now: number, deadline: number | null): boolean {
	return deadline != null && now >= deadline;
}

/** Milliseconds left until the deadline, floored at 0. Null deadline (off) → 0. */
export function remainingMs(now: number, deadline: number | null): number {
	return deadline == null ? 0 : Math.max(0, deadline - now);
}

/**
 * Volume at a point in the fade-out: `startVol * (1 - elapsed/totalMs)`, clamped to
 * [0,1]. Returns 0 for `totalMs <= 0` so there is never a divide-by-zero / NaN / Infinity.
 */
export function fadeVolumeAt(elapsed: number, totalMs: number, startVol: number): number {
	if (totalMs <= 0) return 0;
	const frac = clamp01(elapsed / totalMs);
	return clamp01(startVol * (1 - frac));
}

/**
 * Write-then-readback feature detect for a writable `audio.volume` (iOS Safari ignores
 * volume writes — reads stay 1). Probes with a value guaranteed to differ from the
 * current one, reads it back, RESTORES the original either way, and returns whether the
 * write was honored. Any throw → false. Structural `{ volume }` keeps it node-testable.
 */
export function canFadeVolume(audio: { volume: number }): boolean {
	const original = audio.volume;
	const probe = original === 0 ? 0.5 : 0;
	try {
		audio.volume = probe;
		const read = audio.volume;
		audio.volume = original;
		return Math.abs(read - probe) < 0.001;
	} catch {
		return false;
	}
}

export type SleepMode = 'off' | 'minutes' | 'end-of-track';
export type RepeatMode = 'off' | 'one';

/**
 * Arbitrate what happens when a track ends (D-03 precedence):
 *   end-of-track sleep  → 'sleep-stop'   (sleep BEATS repeat-one)
 *   repeat-one          → 'repeat-rewind'
 *   otherwise           → 'advance'
 * Only `end-of-track` sleep mode alters the ended branch — `minutes`/`off` do not.
 */
export function decideEndedAction(
	sleepMode: SleepMode,
	repeatMode: RepeatMode
): 'sleep-stop' | 'repeat-rewind' | 'advance' {
	if (sleepMode === 'end-of-track') return 'sleep-stop';
	if (repeatMode === 'one') return 'repeat-rewind';
	return 'advance';
}
