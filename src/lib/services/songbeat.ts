// quick-261121-beat: Song Beat （歌曲節奏遊戲） — the PURE core (brief
// ~/workspace/openmusic-songbeat/brief-2026-11-21.md). Everything true about a run lives
// here and is DOM-free / store-free so it is node-testable like lrc.ts / tapalong.ts:
// the deterministic chart pipeline (§4), judgment windows (§5.1), the capped score
// (§5.2), the challenge-mode HP model (§5.3 as amended by C — WHY NOT ALL: no-fail is
// the default, the fail state lives inside the optional 挑戰 toggle), run-state
// derivation (seek/pause fall out of note states, §6), settings + bests + chart cache
// keys (§7/§5.4). Skins and components are thin callers; the core never touches the
// player, audio, or localStorage — callers pass storage values in and out.
//
// Lane identity is fixed HERE (§2.1): lane 0=kick, 1=snare, 2=pluck, 3=shaker — the
// same four sound identities as Tap-Along's PadIds, via LANE_PADS. Skins decide where
// lanes sit on screen; the core decides what they mean.

import type { LyricLine } from '$lib/services/lrc';
import type { PadId } from '$lib/services/tapalong';

export type Lane = 0 | 1 | 2 | 3;

/** Lane → instrument identity (brief §2.1). Index by lane number. */
export const LANE_PADS: readonly PadId[] = ['kick', 'snare', 'pluck', 'shaker'];

export function lanePad(lane: number): PadId {
	return LANE_PADS[Math.min(3, Math.max(0, Math.floor(lane) || 0))];
}

// ---- difficulty (§4.1.5 + Hector 2026-11-21 01:26: a fourth, HELL, tier) ----

export type Difficulty = 'relaxed' | 'standard' | 'fever' | 'hell';

export const DIFFICULTIES: readonly Difficulty[] = ['relaxed', 'standard', 'fever', 'hell'];

/** Greedy thinning floor: a fill/break candidate survives only if it lands at least
 *  this long after the last kept note. Anchors are exempt (never thinned). */
export const MIN_INTERVAL: Record<Difficulty, number> = {
	relaxed: 0.45,
	standard: 0.3,
	fever: 0.21,
	hell: 0.15
};

export const CHART_VERSION = 1;

// ---- skins (brief §2.2/§2.3, Workstream F — skins are RENDERERS over this core) ----
// Skin application order is LOCKED (feel → Square → Round → Highway → Character-Catch →
// Pulse → Rain): SONGBEAT_SKIN_IDS grows by exactly one entry per shipped skin, in that
// order, and the selector (services/songbeat-skins.ts) is driven by this list — an
// unshipped skin is never selectable and a shipped one never reorders.
export type SongBeatSkinId = 'square' | 'round' | 'highway' | 'character-catch' | 'pulse' | 'rain';

export const SONGBEAT_SKIN_IDS: readonly SongBeatSkinId[] = ['square', 'round', 'highway'];

export function isSongBeatSkinId(v: unknown): v is SongBeatSkinId {
	return typeof v === 'string' && (SONGBEAT_SKIN_IDS as readonly string[]).includes(v);
}

// ---- chart model (§4) ----

export interface ChartNote {
	/** Song time (seconds, lyric-clock: line times already carry the song's offset via
	 *  the caller's activeLineAt convention — notes use raw line times). */
	t: number;
	lane: number;
	type: 'tap' | 'hold';
	/** Hold duration in seconds (0 for taps). */
	dur: number;
	/** True for line-start anchors (priority 0 — never thinned, §4.1.1). */
	anchor: boolean;
}

export type ChartSource = 'lyric-est' | 'grid';

export interface Chart {
	notes: ChartNote[];
	source: ChartSource;
	version: number;
}

/** mulberry32 — the brief's seeded PRNG (§4.1.6). Same seed → same stream, everywhere. */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Seed derivation (§4.1.6): first 8 hex of the song hash ^ version golden ^ difficulty salt. */
export function chartSeed(songHash: string, difficulty: Difficulty, version = CHART_VERSION): number {
	const head = parseInt((songHash || '0').slice(0, 8), 16) || 0;
	const salt = DIFFICULTIES.indexOf(difficulty) * 0x85ebca6b;
	return (head ^ Math.imul(version, 0x9e3779b9) ^ salt) >>> 0;
}

const SUNG_CHAR = /[\p{L}\p{N}]/u;

/** Sung characters of a lyric line (grapheme-ish code points, spaces/punct stripped —
 *  §4.1.2's `n`). */
export function sungChars(text: string): string[] {
	return [...(text ?? '')].filter((ch) => SUNG_CHAR.test(ch));
}

/** A line's end: explicit end, else the next line's start, else start+8 capped by the
 *  song duration when known (§4.1.1). */
export function lineEnd(lines: readonly LyricLine[], i: number, duration: number): number {
	const start = lines[i].time;
	const explicit = lines[i].end;
	if (typeof explicit === 'number' && explicit > start) return explicit;
	if (i + 1 < lines.length) return Math.max(start, lines[i + 1].time);
	return duration > start ? Math.min(duration, start + 8) : start + 8;
}

interface Candidate {
	t: number;
	priority: 0 | 1 | 2;
	anchor: boolean;
	hold: boolean;
	dur: number;
	chorus: boolean;
	firstChorus: boolean;
}

/**
 * The chart pipeline (§4.1): anchors on every line start, per-character syllable fills
 * (the UGC pre-allocation doctrine), sustained lines become holds, long windows get
 * sparse break notes, greedy thinning by difficulty, seeded rule-bound lane assignment.
 * Pure: same inputs → byte-identical chart (§4.2). No-lyrics input → the subdivision
 * grid fallback, honestly labelled `source: 'grid'`.
 */
export function generateChart(
	lines: readonly LyricLine[],
	duration: number,
	difficulty: Difficulty,
	songHash: string,
	version = CHART_VERSION
): Chart {
	const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
	if (!lines || lines.length === 0) {
		return { notes: laneAssign(gridCandidates(dur), difficulty, songHash, version), source: 'grid', version };
	}

	// Chorus bookkeeping: a line text occurring ≥2× marks its lines as chorus lines;
	// the first such line (in time order) is the chorus group's first anchor (§4.1.6).
	const textCount = new Map<string, number>();
	for (const l of lines) textCount.set(l.text, (textCount.get(l.text) ?? 0) + 1);
	let firstChorusSeen = false;

	// Median line window → the break-grid phrase step (§4.1.4).
	const windows: number[] = [];
	for (let i = 0; i < lines.length; i++) windows.push(Math.max(0, lineEnd(lines, i, dur) - lines[i].time));
	const sortedW = [...windows].sort((a, b) => a - b);
	const medianWindow = sortedW.length ? sortedW[Math.floor(sortedW.length / 2)] : 0;
	const phraseStep = Math.min(1.6, Math.max(0.8, medianWindow / 2));

	const candidates: Candidate[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const start = line.time;
		const end = lineEnd(lines, i, dur);
		const lineDur = Math.max(0, end - start);
		const chars = sungChars(line.text);
		const chorus = (textCount.get(line.text) ?? 0) >= 2;
		const firstChorus = chorus && !firstChorusSeen;
		if (chorus) firstChorusSeen = true;

		const sustained = lineDur >= 1.6 && chars.length > 0 && chars.length / Math.max(lineDur, 0.001) <= 2.2;
		// Anchor (§4.1.1) — a sustained line's anchor is a hold (§4.1.3).
		candidates.push({
			t: start,
			priority: 0,
			anchor: true,
			hold: sustained,
			dur: sustained ? Math.min(Math.max(lineDur * 0.75, 0.8), Math.max(0.8, lineDur - 0.3)) : 0,
			chorus,
			firstChorus
		});
		if (sustained) continue; // fills dropped — you hold what the singer holds

		// Syllable fills (§4.1.2).
		const n = chars.length;
		for (let k = 0; k < n; k++) {
			candidates.push({
				t: start + ((k + 0.5) / n) * lineDur,
				priority: 1,
				anchor: false,
				hold: false,
				dur: 0,
				chorus,
				firstChorus: false
			});
		}
		// Breaks (§4.1.4): a long non-hold window breathes with a sparse grid.
		if (lineDur >= 4) {
			for (let k = 1; k <= 6; k++) {
				const t = start + k * phraseStep;
				if (t >= end - 0.05) break;
				candidates.push({ t, priority: 2, anchor: false, hold: false, dur: 0, chorus, firstChorus: false });
			}
		}
	}

	// Thinning (§4.1.5): time order, anchors first on ties; anchors exempt.
	candidates.sort((a, b) => a.t - b.t || a.priority - b.priority);
	const minInterval = MIN_INTERVAL[difficulty];
	const kept: Candidate[] = [];
	let lastKept = -Infinity;
	for (const c of candidates) {
		if (c.t < 0) continue;
		if (dur > 0 && c.t > dur) continue;
		if (!c.anchor && c.t - lastKept < minInterval) continue;
		kept.push(c);
		lastKept = c.t;
	}

	return { notes: laneAssign(kept, difficulty, songHash, version), source: 'lyric-est', version };
}

function gridCandidates(duration: number): Candidate[] {
	const out: Candidate[] = [];
	if (duration <= 4) return out;
	for (let t = 2; t <= duration - 2; t += 1.0) {
		out.push({ t, priority: 2, anchor: false, hold: false, dur: 0, chorus: false, firstChorus: false });
	}
	return out;
}

/**
 * Lane assignment (§4.1.6): seeded, in time order. Never 3 same-lane in a row; doubles
 * only on chorus anchors (Fever/Hell by PRNG gate, Standard on the group's first
 * anchor only, Relaxed never); a hold's lane stays clear until holdEnd + 0.25s —
 * conflicting notes are re-laned, and only a non-anchor is ever dropped.
 */
function laneAssign(
	kept: Candidate[],
	difficulty: Difficulty,
	songHash: string,
	version: number
): ChartNote[] {
	const rand = mulberry32(chartSeed(songHash, difficulty, version));
	const laneFreeAt = [-Infinity, -Infinity, -Infinity, -Infinity];
	const out: ChartNote[] = [];
	let prevLane = -1;
	let prevPrevLane = -1;

	const pickLane = (c: Candidate, avoid: number): number | null => {
		let lane = Math.floor(rand() * 4);
		if (lane === prevLane && lane === prevPrevLane) lane = (lane + 1 + Math.floor(rand() * 3)) % 4;
		// Try the drawn lane, then the others in rotation, for a hold-clear slot.
		for (let k = 0; k < 4; k++) {
			const cand = (lane + k) % 4;
			if (cand === avoid) continue;
			if (c.t >= laneFreeAt[cand]) return cand;
		}
		return c.anchor ? (avoid === 0 ? 1 : 0) : null; // anchors are never dropped
	};

	for (const c of kept) {
		const lane = pickLane(c, -1);
		if (lane === null) continue;
		out.push({ t: c.t, lane, type: c.hold ? 'hold' : 'tap', dur: c.hold ? c.dur : 0, anchor: c.anchor });
		if (c.hold) laneFreeAt[lane] = c.t + c.dur + 0.25;
		prevPrevLane = prevLane;
		prevLane = lane;

		// Doubles (§4.1.6): chorus anchors only.
		const wantsDouble =
			c.anchor &&
			!c.hold &&
			((difficulty === 'standard' && c.firstChorus) ||
				((difficulty === 'fever' || difficulty === 'hell') && c.chorus && rand() < (difficulty === 'hell' ? 0.65 : 0.5)));
		if (wantsDouble) {
			const lane2 = pickLane(c, lane);
			if (lane2 !== null && lane2 !== lane) {
				out.push({ t: c.t, lane: lane2, type: 'tap', dur: 0, anchor: true });
			}
		}
	}
	out.sort((a, b) => a.t - b.t || a.lane - b.lane);
	return out;
}

// ---- GROW-OUT hit geometry (Hector 2026-11-23 22:09, standing law for Song Beat) ----
// The shared skeleton EVERY skin renders by — skins change the skin, never this
// geometry. Each note starts INSIDE its hit box and GROWS outward, crossing the box's
// border and continuing outside: the distance travelled inside before the border
// EQUALS the distance travelled outside past it (approach and overshoot are mirror
// images around the border), and THE BORDER IS THE PERFECT LINE — the moment the
// growing note aligns with the border (signed offset 0) is the PERFECT hit moment;
// the judgment windows (§5.1) are symmetric around that crossing by construction.

/** Signed time of a note relative to song time: negative before its hit moment,
 *  0 AT the hit moment, positive after. (now − note.t) */
export interface GrowOutState {
	/** Note size as a multiple of the hit-box size: 0 at the window start (a point
	 *  inside the box), 1 exactly AT the border, 2 at the mirror end of the window. */
	scale: number;
	/** Signed distance from the border, in border units (box half-size = 1):
	 *  −1 at the window start, 0 at the border, +1 at the mirror end. */
	offset: number;
	/** Unsigned distance from the border — EQUAL at equal time offsets before and
	 *  after the perfect moment (the symmetry pin, songbeat-geometry.test.ts). */
	borderDistance: number;
	/** True only at the exact hit moment — border alignment IS perfect (§5.1). */
	atBorder: boolean;
	phase: 'approach' | 'perfect' | 'overshoot';
}

/** Grow-out state for a signed dt (now − note.t, seconds) over the approach window.
 *  Pure: same inputs → same geometry on every skin, so a skin switch mid-run can
 *  never change where a note sits relative to its border. */
export function growOut(signedDt: number, approachSec: number): GrowOutState {
	const window = approachSec > 0 ? approachSec : 1.6;
	const offset = signedDt / window;
	return {
		scale: 1 + offset,
		offset,
		borderDistance: Math.abs(offset),
		atBorder: signedDt === 0,
		phase: signedDt < 0 ? 'approach' : signedDt > 0 ? 'overshoot' : 'perfect'
	};
}

// ---- judgment (§5.1) ----

export type Judgment = 'perfect' | 'great' | 'good' | 'miss';

export const WINDOW_PERFECT = 0.07;
export const WINDOW_GREAT = 0.13;
export const WINDOW_GOOD = 0.2;
export const MISS_AFTER = 0.22;

/** Judgment for a signed delta (tap − note, seconds), or null outside the GOOD window
 *  (the tap is then a ghost, §3.2). Boundaries are inclusive per the §9 pins. */
export function judgeDelta(dt: number): Judgment | null {
	const a = Math.abs(dt);
	if (a <= WINDOW_PERFECT) return 'perfect';
	if (a <= WINDOW_GREAT) return 'great';
	if (a <= WINDOW_GOOD) return 'good';
	return null;
}

export function weightOf(j: Judgment): number {
	return j === 'perfect' ? 1 : j === 'great' ? 0.7 : j === 'good' ? 0.4 : 0;
}

/** Grade from accuracy (§5.2): S ≥95 · A ≥88 · B ≥75 · C ≥60 · D below. */
export function gradeOf(accuracy: number): string {
	return accuracy >= 0.95 ? 'S' : accuracy >= 0.88 ? 'A' : accuracy >= 0.75 ? 'B' : accuracy >= 0.6 ? 'C' : 'D';
}

// ---- HP model (§5.3, challenge toggle ON only; hell drains faster per Hector 01:26) ----

export interface HpDeltas {
	miss: number;
	perfect: number;
	great: number;
}

export function hpDeltas(difficulty: Difficulty): HpDeltas {
	return difficulty === 'hell' ? { miss: -12, perfect: 1, great: 1 } : { miss: -8, perfect: 2, great: 1 };
}

// ---- run state (derived from note states, §2.1/§6) ----

export type NoteState = 'pending' | 'holding' | 'hit' | 'missed' | 'skipped';

export interface NoteRun {
	state: NoteState;
	judgment: Judgment | null;
	weight: number;
	/** Hold released at <60% — weight 0.4, combo resets, HP treats it as a miss (§5.1/§5.3). */
	broke: boolean;
	/** Song time the hold head was pressed (tap time incl. calibration), while holding. */
	holdStart: number | null;
}

export interface Run {
	chart: Chart;
	difficulty: Difficulty;
	challenge: boolean;
	notes: NoteRun[];
}

export function createRun(chart: Chart, difficulty: Difficulty, challenge: boolean): Run {
	return {
		chart,
		difficulty,
		challenge,
		notes: chart.notes.map(() => ({ state: 'pending', judgment: null, weight: 0, broke: false, holdStart: null }))
	};
}

export interface TapOutcome {
	kind: 'hit' | 'ghost';
	index: number;
	judgment: Judgment | null;
	/** Signed delta (tap − note) for the early/late hint; 0 for ghosts. */
	dt: number;
}

/**
 * A lane press. Judges the NEAREST pending note in the lane inside the GOOD window;
 * anything else is a ghost — it consumes nothing, breaks nothing (§3.2). `songTime`
 * is the audio-clock time; `calibrationSec` shifts Δt for device touch latency (§7).
 * Hold heads enter `holding`; resolution happens in tapUp / advanceRun.
 */
export function tapDown(run: Run, lane: number, songTime: number, calibrationSec = 0): TapOutcome {
	const tapT = songTime + calibrationSec;
	let best = -1;
	let bestDt = 0;
	let bestAbs = Infinity;
	for (let i = 0; i < run.chart.notes.length; i++) {
		const note = run.chart.notes[i];
		if (note.lane !== lane || run.notes[i].state !== 'pending') continue;
		const dt = tapT - note.t;
		const a = Math.abs(dt);
		if (a <= WINDOW_GOOD && a < bestAbs) {
			best = i;
			bestDt = dt;
			bestAbs = a;
		}
	}
	if (best < 0) return { kind: 'ghost', index: -1, judgment: null, dt: 0 };
	const note = run.chart.notes[best];
	const nr = run.notes[best];
	const judgment = judgeDelta(bestDt);
	nr.judgment = judgment;
	if (note.type === 'hold') {
		nr.state = 'holding';
		nr.holdStart = tapT;
		nr.weight = weightOf(judgment ?? 'miss');
	} else {
		nr.state = 'hit';
		nr.weight = weightOf(judgment ?? 'miss');
	}
	return { kind: 'hit', index: best, judgment, dt: bestDt };
}

/**
 * A lane release: resolves a holding note in that lane (§5.1). Released inside
 * [tail − 0.20, …] → full head weight; held ≥60% → weight capped at GREAT, combo
 * kept; held <60% → break (weight 0.4, broke=true). No holding note → no-op.
 */
export function tapUp(run: Run, lane: number, songTime: number, calibrationSec = 0): TapOutcome {
	const tapT = songTime + calibrationSec;
	for (let i = 0; i < run.chart.notes.length; i++) {
		const note = run.chart.notes[i];
		if (note.lane !== lane || run.notes[i].state !== 'holding') continue;
		const nr = run.notes[i];
		const tail = note.t + note.dur;
		nr.state = 'hit';
		if (tapT >= tail - 0.2) {
			// full head weight — nr.weight already carries it
		} else {
			const held = Math.max(0, tapT - note.t);
			const frac = note.dur > 0 ? held / note.dur : 1;
			if (frac >= 0.6) {
				nr.weight = Math.min(nr.weight, weightOf('great'));
			} else {
				nr.weight = weightOf('good');
				nr.judgment = 'good';
				nr.broke = true;
			}
		}
		nr.holdStart = null;
		return { kind: 'hit', index: i, judgment: nr.judgment, dt: 0 };
	}
	return { kind: 'ghost', index: -1, judgment: null, dt: 0 };
}

export interface AdvanceEvent {
	index: number;
	kind: 'miss' | 'hold-complete';
}

/**
 * Advance the run to `songTime`: pending taps (and unpressed hold heads) past
 * +MISS_AFTER become misses; holds still held at tail + 0.05 complete at full head
 * weight (§5.1). Idempotent at a frozen time (pause, §6).
 */
export function advanceRun(run: Run, songTime: number): AdvanceEvent[] {
	const events: AdvanceEvent[] = [];
	for (let i = 0; i < run.chart.notes.length; i++) {
		const note = run.chart.notes[i];
		const nr = run.notes[i];
		if (nr.state === 'pending' && songTime > note.t + MISS_AFTER) {
			nr.state = 'missed';
			nr.judgment = 'miss';
			nr.weight = 0;
			events.push({ index: i, kind: 'miss' });
		} else if (nr.state === 'holding' && songTime >= note.t + note.dur + 0.05) {
			nr.state = 'hit';
			nr.holdStart = null;
			events.push({ index: i, kind: 'hold-complete' });
		}
	}
	return events;
}

/**
 * Seek re-derivation (§6): notes after the new time return to pending (judgments
 * revoked — stats recompute from states); pending notes fully before it become
 * skipped (excluded from N, never misses). Notes already resolved before the new
 * time keep their states.
 */
export function seekRun(run: Run, songTime: number): void {
	for (let i = 0; i < run.chart.notes.length; i++) {
		const note = run.chart.notes[i];
		const nr = run.notes[i];
		if (note.t > songTime) {
			nr.state = 'pending';
			nr.judgment = null;
			nr.weight = 0;
			nr.broke = false;
			nr.holdStart = null;
		} else if (nr.state === 'pending' || nr.state === 'holding' || nr.state === 'skipped') {
			if (note.t + MISS_AFTER < songTime) {
				nr.state = 'skipped';
				nr.judgment = null;
				nr.weight = 0;
				nr.broke = false;
				nr.holdStart = null;
			} else if (nr.state === 'skipped') {
				nr.state = 'pending';
			}
		}
	}
}

// ---- visible notes for the lane-field skins (Workstream F: Highway / Rain) ----

export interface VisibleNote {
	index: number;
	lane: number;
	t: number;
	type: ChartNote['type'];
	dur: number;
	/** GROW-OUT input (Hector 2026-11-23 22:09): now − note.t — negative while the
	 *  note approaches, 0 AT the judge line (the border = PERFECT), positive past it.
	 *  Lane skins position via growOut(signedDt, approachSec) and nothing else, so
	 *  travel inside the line mirrors travel outside it exactly. */
	signedDt: number;
	/** 0 at the approach-window start → 1 at the hit moment. */
	progress: number;
	holding: boolean;
	/** 0→1 across a hold's duration while it is being held. */
	holdProgress: number;
}

/**
 * Every note a lane-field skin must draw at `now`: pending notes inside
 * [−MISS_AFTER, +approachSec] of their hit moment, plus holds currently being
 * held. Resolved notes (hit / missed / skipped) are never returned — the pop and
 * flash layers carry their feedback. Pure derivation from run state (§6): a
 * seek or pause re-derives the same field, nothing is cached.
 */
export function visibleNotes(run: Run, now: number, approachSec: number): VisibleNote[] {
	const out: VisibleNote[] = [];
	const window = approachSec > 0 ? approachSec : 1.6;
	for (let i = 0; i < run.chart.notes.length; i++) {
		const n = run.chart.notes[i];
		const st = run.notes[i].state;
		if (st === 'holding') {
			const p = n.dur > 0 ? Math.min(1, Math.max(0, (now - n.t) / n.dur)) : 1;
			out.push({ index: i, lane: n.lane, t: n.t, type: n.type, dur: n.dur, signedDt: now - n.t, progress: 1, holding: true, holdProgress: p });
		} else if (st === 'pending') {
			const dt = n.t - now;
			if (dt < -MISS_AFTER || dt > window) continue;
			out.push({
				index: i,
				lane: n.lane,
				t: n.t,
				type: n.type,
				dur: n.dur,
				signedDt: now - n.t,
				progress: Math.min(1, Math.max(0, 1 - dt / window)),
				holding: false,
				holdProgress: 0
			});
		}
	}
	return out;
}

// ---- derived stats (§5.2/§5.3) ----

export interface RunStats {
	total: number;
	/** Resolved for scoring: hit + missed (skipped excluded from N, §5.2). */
	resolved: number;
	/** Settled either way (hit + missed + skipped) — the completion measure. */
	settled: number;
	counts: Record<Judgment, number>;
	combo: number;
	maxCombo: number;
	accuracy: number;
	score: number;
	grade: string;
	/** Challenge mode only: derived HP (100 start). Casual runs report 100 untouched. */
	hp: number;
	failed: boolean;
	/** True once every note is settled and at least one note exists. */
	complete: boolean;
}

export function runStats(run: Run): RunStats {
	const counts: Record<Judgment, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
	let combo = 0;
	let maxCombo = 0;
	let weightSum = 0;
	let resolved = 0;
	let settled = 0;
	let hp = 100;
	let failed = false;
	const deltas = hpDeltas(run.difficulty);

	for (let i = 0; i < run.chart.notes.length; i++) {
		const nr = run.notes[i];
		if (nr.state === 'skipped') {
			settled++;
			continue;
		}
		if (nr.state !== 'hit' && nr.state !== 'missed') continue;
		settled++;
		resolved++;
		weightSum += nr.weight;
		// HP moves only until the round ends: once HP reaches 0 the run is over, and
		// notes resolved later (a seek artefact in derived state) cannot revive it.
		if (nr.state === 'missed') {
			counts.miss++;
			combo = 0;
			if (run.challenge && !failed) hp += deltas.miss;
		} else {
			const j = nr.judgment ?? 'good';
			counts[j]++;
			if (nr.broke) {
				combo = 0;
				if (run.challenge && !failed) hp += deltas.miss;
			} else {
				combo++;
				if (combo > maxCombo) maxCombo = combo;
				if (run.challenge && !failed) {
					if (j === 'perfect') hp += deltas.perfect;
					else if (j === 'great') hp += deltas.great;
				}
			}
		}
		if (run.challenge && !failed) {
			hp = Math.min(100, hp);
			if (hp <= 0) {
				hp = 0;
				failed = true;
			}
		}
	}

	const accuracy = resolved > 0 ? weightSum / resolved : 0;
	const score = resolved > 0 ? Math.round(900_000 * (weightSum / resolved) + 100_000 * (maxCombo / resolved)) : 0;
	return {
		total: run.chart.notes.length,
		resolved,
		settled,
		counts,
		combo,
		maxCombo,
		accuracy,
		score,
		grade: gradeOf(accuracy),
		hp: run.challenge ? hp : 100,
		failed: run.challenge && failed,
		complete: run.chart.notes.length > 0 && settled >= run.chart.notes.length
	};
}

// ---- settings (§7) ----

export interface SongBeatSettings {
	/** Active skin (brief §2.3) — a renderer choice only; switching mid-run preserves
	 *  every note state because skins own no run state (§2.2). Default 'square'. */
	skin: SongBeatSkinId;
	difficulty: Difficulty;
	/** 挑戰模式 — the fail state lives here, default OFF (Amendment C). */
	challenge: boolean;
	approachSec: number;
	calibrationMs: number;
	mirror: boolean;
}

export const SONGBEAT_SETTINGS_KEY = 'openmusic:songbeat:v1';

export const APPROACH_OPTIONS: readonly number[] = [2.0, 1.6, 1.25];

export const DEFAULT_SONGBEAT_SETTINGS: SongBeatSettings = {
	skin: 'square',
	difficulty: 'standard',
	challenge: false,
	approachSec: 1.6,
	calibrationMs: 0,
	mirror: false
};

/** Never-throw per-field parse (house pattern, mirrors parseTapAlongSettings). */
export function parseSongBeatSettings(raw: string | null): SongBeatSettings {
	const d = DEFAULT_SONGBEAT_SETTINGS;
	if (!raw) return { ...d };
	try {
		const v = JSON.parse(raw) as Partial<SongBeatSettings>;
		return {
			skin: isSongBeatSkinId(v.skin) ? v.skin : d.skin,
			difficulty: DIFFICULTIES.includes(v.difficulty as Difficulty) ? (v.difficulty as Difficulty) : d.difficulty,
			challenge: typeof v.challenge === 'boolean' ? v.challenge : d.challenge,
			approachSec:
				typeof v.approachSec === 'number' && APPROACH_OPTIONS.includes(v.approachSec) ? v.approachSec : d.approachSec,
			calibrationMs:
				typeof v.calibrationMs === 'number' && Number.isFinite(v.calibrationMs)
					? Math.min(150, Math.max(-150, Math.round(v.calibrationMs)))
					: d.calibrationMs,
			mirror: typeof v.mirror === 'boolean' ? v.mirror : d.mirror
		};
	} catch {
		return { ...d };
	}
}

export function serializeSongBeatSettings(s: SongBeatSettings): string {
	return JSON.stringify(s);
}

// ---- bests (§5.4: per song + difficulty + MODE — casual and challenge never merge) ----

export type BeatMode = 'casual' | 'challenge';

export function bestKey(songHash: string, difficulty: Difficulty, mode: BeatMode): string {
	return `openmusic:songbeat:best:v1:${songHash}:${difficulty}:${mode}`;
}

export interface BestRecord {
	score: number;
	grade: string;
	accuracy: number;
	maxCombo: number;
}

export function parseBest(raw: string | null): BestRecord | null {
	if (!raw) return null;
	try {
		const v = JSON.parse(raw) as Partial<BestRecord>;
		if (typeof v.score !== 'number' || !Number.isFinite(v.score)) return null;
		return {
			score: v.score,
			grade: typeof v.grade === 'string' ? v.grade : '',
			accuracy: typeof v.accuracy === 'number' ? v.accuracy : 0,
			maxCombo: typeof v.maxCombo === 'number' ? v.maxCombo : 0
		};
	} catch {
		return null;
	}
}

/** A best is written only by a completed run with ≥90% of the chart resolved (§5.4);
 *  a failed run never writes one, at any %. */
export function bestEligible(stats: RunStats): boolean {
	return !stats.failed && stats.complete && stats.total > 0 && stats.resolved / stats.total >= 0.9;
}

// ---- chart cache (§4.2: an optimisation, never a source of truth) ----

export function chartCacheKey(songHash: string, difficulty: Difficulty): string {
	return `openmusic:songbeat:chart:v1:${songHash}:${difficulty}`;
}

export function serializeChart(chart: Chart): string {
	return JSON.stringify(chart);
}

export function parseChart(raw: string | null): Chart | null {
	if (!raw) return null;
	try {
		const v = JSON.parse(raw) as Chart;
		if (!v || !Array.isArray(v.notes) || (v.source !== 'lyric-est' && v.source !== 'grid')) return null;
		for (const n of v.notes) {
			if (typeof n.t !== 'number' || typeof n.lane !== 'number' || (n.type !== 'tap' && n.type !== 'hold')) return null;
		}
		return { notes: v.notes, source: v.source, version: typeof v.version === 'number' ? v.version : CHART_VERSION };
	} catch {
		return null;
	}
}
