// quick-261021-tap: Tap-Along 共鳴合奏 — the PURE half of the feature (the deck component and
// the tapalong store are thin callers, per the house pure-module pattern). Everything here is
// DOM-free and store-free so it is node-testable like lrc.ts: pad pattern shapes, intensity
// scaling, velocity-from-position, the pentatonic pluck ladder, inter-line break detection
// (call-and-response), and the in-mode settings shape + (de)serialisation.
//
// Design source: ~/workspace/openmusic-tap-resonance/brief-2026-11-21.md (APPROVED by Hector
// 2026-11-21). Load-bearing rules that live here:
//   - A vibration motor has no pitch: a pad's PATTERN (rhythm/duration envelope) is its timbre.
//   - Patterns scale by ONE intensity multiplier and are clamped so a scaled pattern never
//     exceeds ~120ms total — a drum hit must never become a buzz.
//   - The user's own tap is NEVER quantised (that rule is structural: nothing in this module
//     sits between pointerdown and the haptic/synth call — the guide logic below only ever
//     produces GUIDE events, never touches the user's hit).

import type { LyricLine } from '$lib/services/lrc';

export type PadId = 'kick' | 'snare' | 'pluck' | 'shaker';
export type TapAlongMode = 'free' | 'guided' | 'ensemble';
export type TapIntensity = 'low' | 'medium' | 'high';

/** The four pads, in canonical (right-handed) reading order for the 2×2 deck:
 *  snare/shaker on top, kick bottom-left (the heartbeat, brief §3.1), pluck bottom-right. */
export const PADS: readonly PadId[] = ['snare', 'shaker', 'kick', 'pluck'];

/** Left-handed mirror flips the deck horizontally (brief §3.6 in-mode setting). */
export function padOrder(mirror: boolean): PadId[] {
	return mirror ? ['shaker', 'snare', 'pluck', 'kick'] : [...PADS];
}

/** Base vibrate patterns (ms, alternating on/off starting ON) — brief §3.2 verbatim. */
export const PAD_PATTERNS: Record<PadId, readonly number[]> = {
	kick: [40],
	snare: [14, 28, 20],
	pluck: [22, 18, 12],
	shaker: [8, 14, 8, 14, 10]
};

/** The guide pulse: barely-there phrase heartbeat on lyric line starts (brief §3.2). */
export const GUIDE_PATTERN: readonly number[] = [7];

/** Chorus/resonance tail (brief §3.2) — exported for v2's chorus swell; v1 does not fire it. */
export const RESONANCE_TAIL_MS = 26;

/** A scaled pattern never exceeds this total duration. */
export const PATTERN_TOTAL_MAX_MS = 120;

export const INTENSITY_SCALES: Record<TapIntensity, number> = {
	low: 0.6,
	medium: 1.0,
	high: 1.3
};

/**
 * Scale a pattern by intensity × velocity, rounding to whole ms with a 1ms floor, then —
 * if the total exceeds PATTERN_TOTAL_MAX_MS — proportionally compress (floor 1ms per
 * segment) so the cap holds. Pure and total-preserving in shape: segment RATIOS survive.
 */
export function scalePattern(
	pattern: readonly number[],
	intensityScale: number,
	velocity = 1
): number[] {
	const mult = (Number.isFinite(intensityScale) ? intensityScale : 1) * (Number.isFinite(velocity) ? velocity : 1);
	let out = pattern.map((ms) => Math.max(1, Math.round(ms * mult)));
	const total = out.reduce((a, b) => a + b, 0);
	if (total > PATTERN_TOTAL_MAX_MS) {
		const k = PATTERN_TOTAL_MAX_MS / total;
		out = out.map((ms) => Math.max(1, Math.floor(ms * k)));
	}
	return out;
}

/**
 * Velocity without a pressure sensor (brief §3.2): tap position within the pad.
 * `frac` is the tap's distance from the pad centre as a fraction of the half-diagonal
 * (0 = dead centre, 1 = corner). Centre = full (1), edge = soft (floor 0.55).
 */
export function velocityFromPosition(frac: number): number {
	if (!Number.isFinite(frac)) return 1;
	const f = Math.min(1, Math.max(0, frac));
	return 1 - 0.45 * f;
}

/** C-major pentatonic ladder (Hz) — every sequence of taps is consonant with itself. */
export const PENTA_FREQS: readonly number[] = [
	261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0
];

/** The pluck pitch for the Nth consecutive tap (wraps the ladder). */
export function pluckFreq(step: number): number {
	const n = Number.isFinite(step) ? Math.max(0, Math.floor(step)) : 0;
	return PENTA_FREQS[n % PENTA_FREQS.length];
}

/** Idle longer than this and the pluck ladder restarts (a new phrase, not a run-on scale). */
export const PLUCK_IDLE_RESET_MS = 2000;

/** Next pluck step: +1 while taps keep flowing, back to 0 after an idle gap. */
export function nextPluckStep(step: number, msSinceLastTap: number): number {
	if (!Number.isFinite(msSinceLastTap) || msSinceLastTap > PLUCK_IDLE_RESET_MS) return 0;
	return (Number.isFinite(step) ? Math.max(0, Math.floor(step)) : 0) + 1;
}

/** Inter-line gap (seconds) beyond which a break counts as an instrumental break. */
export const BREAK_GAP_SEC = 2.5;

/**
 * Call-and-response geometry (brief §3.4 clock 1): for the active line `idx` at lyric-clock
 * time `clockNow` (already offset-adjusted by the caller, the activeLineAt convention),
 * decide whether we are inside the break AFTER that line. A line's end is the next line's
 * start (the standing lrc rule); the break is the LATTER HALF of an over-threshold gap —
 * the first half is still the line's tail/resonance, the second half is open space where
 * the user leads and the guide stays silent. The last line's end is `duration` (0/unknown
 * duration ⇒ no break — nothing to measure against).
 */
export function breakInfo(
	lines: readonly LyricLine[],
	idx: number,
	clockNow: number,
	duration = 0
): { inBreak: boolean; gapSec: number } {
	if (idx < 0 || idx >= lines.length || !Number.isFinite(clockNow)) {
		return { inBreak: false, gapSec: 0 };
	}
	const start = lines[idx].time;
	const end = idx + 1 < lines.length ? lines[idx + 1].time : duration > start ? duration : start;
	const gapSec = Math.max(0, end - start);
	const inBreak = gapSec > BREAK_GAP_SEC && clockNow >= start + gapSec / 2 && clockNow < end;
	return { inBreak, gapSec };
}

/**
 * Synth presence per mode: Free/Guided keep the kit tucked under the song; Ensemble is the
 * full-presence preset (brief §3.6). A multiplier on the user's volume setting, nothing more.
 */
export function modeSynthFactor(mode: TapAlongMode): number {
	return mode === 'ensemble' ? 1 : 0.8;
}

/** Halo energy a single tap adds (kick is the heartbeat — it feeds the halo most). */
export function haloBump(pad: PadId): number {
	return pad === 'kick' ? 0.5 : 0.35;
}

// ---- in-mode settings (brief §3.6: ANTIDOTE — they live in the mode, nowhere else) ----

export interface TapAlongSettings {
	intensity: TapIntensity;
	/** 0..1 synth volume (the in-mode slider). */
	synthVolume: number;
	guide: boolean;
	mirror: boolean;
	mode: TapAlongMode;
}

export const DEFAULT_TAPALONG_SETTINGS: TapAlongSettings = {
	intensity: 'medium',
	synthVolume: 0.55,
	guide: true,
	mirror: false,
	mode: 'guided'
};

/** Never-throw parse of the persisted settings blob; any bad field falls back per-field. */
export function parseTapAlongSettings(raw: string | null): TapAlongSettings {
	const d = DEFAULT_TAPALONG_SETTINGS;
	if (!raw) return { ...d };
	try {
		const v = JSON.parse(raw) as Partial<TapAlongSettings>;
		return {
			intensity: v.intensity === 'low' || v.intensity === 'high' || v.intensity === 'medium' ? v.intensity : d.intensity,
			synthVolume:
				typeof v.synthVolume === 'number' && Number.isFinite(v.synthVolume)
					? Math.min(1, Math.max(0, v.synthVolume))
					: d.synthVolume,
			guide: typeof v.guide === 'boolean' ? v.guide : d.guide,
			mirror: typeof v.mirror === 'boolean' ? v.mirror : d.mirror,
			mode: v.mode === 'free' || v.mode === 'ensemble' || v.mode === 'guided' ? v.mode : d.mode
		};
	} catch {
		return { ...d };
	}
}

export function serializeTapAlongSettings(s: TapAlongSettings): string {
	return JSON.stringify(s);
}
