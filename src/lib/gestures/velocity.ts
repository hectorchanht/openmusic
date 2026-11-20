// Pure pointer-velocity tracker — a tiny, dependency-free UI gesture helper shared by
// NowPlaying's 3-state sheet snap and the dragClose action. It records (clientY, timeStamp)
// samples during a drag and reports px/ms velocity from the last two points so a fast flick
// can step the sheet one state in the flick direction even when it barely moved in distance.
//
// SSR-safe / deterministic by design: the caller supplies the event time (e.timeStamp) — the
// module NEVER calls Date.now / performance.now, so its math is pure and unit-testable.

interface Sample {
	y: number;
	t: number;
}

export interface VelocityTracker {
	/** Record a (clientY, timeStamp) point; keeps only the last few samples. */
	sample(clientY: number, timeStamp: number): void;
	/**
	 * px/ms from the last two samples (delta-y / delta-t). Positive = moving DOWN
	 * (clientY increasing), negative = UP. Returns 0 with fewer than 2 samples or
	 * when delta-t <= 0 (guards divide-by-zero → no Infinity / NaN).
	 */
	velocity(): number;
	/** Clear samples so a new gesture does not inherit the previous one's velocity. */
	reset(): void;
}

// Only the most recent points matter for an instantaneous flick reading; trim to this many.
const MAX_SAMPLES = 3;

export function createVelocityTracker(): VelocityTracker {
	let samples: Sample[] = [];

	return {
		sample(clientY: number, timeStamp: number): void {
			samples.push({ y: clientY, t: timeStamp });
			if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES);
		},
		velocity(): number {
			if (samples.length < 2) return 0;
			const a = samples[samples.length - 2];
			const b = samples[samples.length - 1];
			const dt = b.t - a.t;
			if (dt <= 0) return 0; // guard divide-by-zero / non-monotonic timestamps
			return (b.y - a.y) / dt;
		},
		reset(): void {
			samples = [];
		}
	};
}
