// quick-261021-tap: the Tap-Along synth kit — the iOS answer (brief §3.5). iOS Safari has no
// `navigator.vibrate`, so on iPhone the ensemble is HEARD: a tiny synthesized kit (kick thump,
// snare noise burst, pluck tone on the pentatonic ladder, shaker noise shimmer) layered quietly
// UNDER the song. All generated — zero audio assets, zero downloads.
//
// Hard boundaries:
//   - Its OWN AudioContext, created lazily on the first mode-entry/tap gesture (autoplay
//     policy) and resumed on later taps. It NEVER touches the player store's keepAliveCtx and
//     never routes the song itself through Web Audio (the native-<audio> architecture stands).
//   - Never throws: no AudioContext (old WebView, node tests without the seam) = silent no-op,
//     exactly the haptics contract.
//   - Master gain is hard-capped (MASTER_CAP) under the user's in-mode volume, so the kit can
//     never fight the vocal (brief §7).

import { pluckFreq, type PadId } from '$lib/services/tapalong';

/** The kit's absolute ceiling at slider=1 — conservative on purpose (brief §3.5/§7). */
export const MASTER_CAP = 0.5;

interface SynthNodes {
	ctx: AudioContext;
	master: GainNode;
	noise: AudioBuffer;
}

let nodes: SynthNodes | null = null;
let volume = 0.55; // mirrors DEFAULT_TAPALONG_SETTINGS.synthVolume until the deck sets it
let testCtx: AudioContext | null = null;

/** Test seam (house precedent: __resetNativeVisitorCache) — inject a fake AudioContext. */
export function setSynthContextForTests(ctx: AudioContext | null): void {
	testCtx = ctx;
	nodes = null;
}

function buildNoise(ctx: AudioContext): AudioBuffer {
	const len = Math.max(1, Math.floor(ctx.sampleRate * 0.25));
	const buf = ctx.createBuffer(1, len, ctx.sampleRate);
	const data = buf.getChannelData(0);
	for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
	return buf;
}

function ensure(): SynthNodes | null {
	if (nodes) return nodes;
	try {
		const ctx =
			testCtx ??
			(typeof window !== 'undefined'
				? new (window.AudioContext ??
						(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)()
				: null);
		if (!ctx) return null;
		const master = ctx.createGain();
		master.gain.value = volume * MASTER_CAP;
		master.connect(ctx.destination);
		nodes = { ctx, master, noise: buildNoise(ctx) };
		return nodes;
	} catch {
		return null;
	}
}

/** Create/resume the context from a user gesture (mode entry). Safe to call repeatedly. */
export function unlockSynth(): void {
	const n = ensure();
	if (!n) return;
	try {
		if (n.ctx.state === 'suspended') void n.ctx.resume();
	} catch {
		/* never throw */
	}
}

/** Set the kit volume (0..1 user slider × mode factor, applied by the caller). */
export function setSynthVolume(v: number): void {
	volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : volume;
	if (nodes) {
		try {
			nodes.master.gain.value = volume * MASTER_CAP;
		} catch {
			/* never throw */
		}
	}
}

function env(gain: GainNode, t: number, peak: number, dur: number): void {
	gain.gain.setValueAtTime(peak, t);
	gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
}

function tone(n: SynthNodes, freq: number, dur: number, type: OscillatorType, peak: number): void {
	const t = n.ctx.currentTime;
	const osc = n.ctx.createOscillator();
	const g = n.ctx.createGain();
	osc.type = type;
	osc.frequency.setValueAtTime(freq, t);
	env(g, t, peak, dur);
	osc.connect(g);
	g.connect(n.master);
	osc.start(t);
	osc.stop(t + dur + 0.02);
}

function thump(n: SynthNodes): void {
	const t = n.ctx.currentTime;
	const osc = n.ctx.createOscillator();
	const g = n.ctx.createGain();
	osc.type = 'sine';
	osc.frequency.setValueAtTime(150, t);
	osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
	env(g, t, 0.9, 0.18);
	osc.connect(g);
	g.connect(n.master);
	osc.start(t);
	osc.stop(t + 0.2);
}

function noiseBurst(n: SynthNodes, dur: number, filterFreq: number, peak: number): void {
	const t = n.ctx.currentTime;
	const src = n.ctx.createBufferSource();
	src.buffer = n.noise;
	const filter = n.ctx.createBiquadFilter();
	filter.type = 'highpass';
	filter.frequency.value = filterFreq;
	const g = n.ctx.createGain();
	env(g, t, peak, dur);
	src.connect(filter);
	filter.connect(g);
	g.connect(n.master);
	src.start(t);
	src.stop(t + dur + 0.02);
}

/**
 * Play one pad's sound. `pluckStep` walks the pentatonic ladder (services/tapalong owns the
 * ladder + step logic). Velocity scales the peak so an edge tap sounds softer than a centre
 * tap — the audible half of velocity-from-position.
 */
export function playPadSound(pad: PadId, pluckStep = 0, velocity = 1): void {
	const n = ensure();
	if (!n) return;
	try {
		if (n.ctx.state === 'suspended') void n.ctx.resume();
		const vel = Number.isFinite(velocity) ? Math.min(1, Math.max(0.3, velocity)) : 1;
		switch (pad) {
			case 'kick':
				thump(n);
				break;
			case 'snare':
				noiseBurst(n, 0.09, 1200, 0.45 * vel);
				break;
			case 'shaker':
				noiseBurst(n, 0.16, 5000, 0.2 * vel);
				break;
			case 'pluck':
				tone(n, pluckFreq(pluckStep), 0.5, 'triangle', 0.5 * vel);
				break;
		}
	} catch {
		/* never throw — a dead synth must never break a tap */
	}
}
